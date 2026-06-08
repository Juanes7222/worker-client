import WebSocket from "ws";
import { config } from "./config";
import { fetchMetadata } from "./processor/metadata";
import { downloadAsMp3, deleteFile } from "./processor/download";
import { uploadToAzuracast } from "./processor/upload";
import { AssignJobMessage, WorkerMessage } from "./types/protocol.types";

type StatusReporter = (jobId: string, status: string) => void;

let socket: WebSocket;
let reconnectDelay = 3000;

export function startWorkerClient(): void {
  connect();
}

function connect(): void {
  console.log(`[Worker] Connecting to ${config.serverWsUrl}`);
  socket = new WebSocket(config.serverWsUrl);

  socket.on("open", () => {
    reconnectDelay = 3000;
    console.log("[Worker] Connected");
    send({ type: "register", workerId: config.workerId, secret: config.workerSecret, name: config.workerName, maxConcurrentJobs: config.maxConcurrentJobs });
    startHeartbeat();
  });

  socket.on("message", async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "assign_job") {
      await handleJob(message as AssignJobMessage);
    }
  });

  socket.on("close", () => {
    console.warn(`[Worker] Disconnected. Reconnecting in ${reconnectDelay}ms`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });

  socket.on("error", (err) => {
    console.error("[Worker] Socket error:", err.message);
  });
}

function startHeartbeat(): void {
  setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      send({ type: "heartbeat", workerId: config.workerId, status: "idle" });
    }
  }, 20_000);
}

function send(message: WorkerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function reportStatus(jobId: string, status: string): void {
  send({ type: "job_status", workerId: config.workerId, jobId, status });
}

async function handleJob(job: AssignJobMessage): Promise<void> {
  const { jobId, videoId, url, title, azuracast } = job;

  send({ type: "job_ack", workerId: config.workerId, jobId });

  let localPath: string | null = null;

  try {
    reportStatus(jobId, "CHECKING_METADATA");
    const meta = await fetchMetadata(url);

    if (!meta.available) {
      send({ type: "job_error", workerId: config.workerId, jobId, error: "Video not available", retryable: false });
      return;
    }

    if (meta.duration > job.maxDurationSeconds) {
      reportStatus(jobId, "IGNORED");
      return;
    }

    reportStatus(jobId, "DOWNLOADING");
    localPath = await downloadAsMp3(videoId, url);

    reportStatus(jobId, "UPLOADING");
    const { fileId, azuraPath } = await uploadToAzuracast(localPath, azuracast);

    deleteFile(localPath);

    send({
      type: "job_done",
      workerId: config.workerId,
      jobId,
      azuracastFileId: fileId,
      azuracastPath: azuraPath,
      duration: meta.duration,
    });

  } catch (err) {
    if (localPath) deleteFile(localPath);
    send({
      type: "job_error",
      workerId: config.workerId,
      jobId,
      error: String(err),
      retryable: true,
    });
  }
}