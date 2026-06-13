import WebSocket from "ws";
import { config } from "./config";
import { logger } from "./logger";
import { fetchMetadata } from "./processor/metadata";
import { downloadAsMp3, deleteFile } from "./processor/download";
import { uploadToAzuracast, UploadError } from "./processor/upload";
import { AssignJobMessage, WorkerMessage } from "./types/protocol.types";

let socket: WebSocket;
let reconnectDelay = 3000;
let heartbeatTimer: NodeJS.Timeout | null = null;
let activeJobs = 0;

export function startWorkerClient(): void {
  connect();
}

function connect(): void {
  logger.info("WorkerClient", "Connecting", { url: config.serverWsUrl });
  socket = new WebSocket(config.serverWsUrl, {
    headers: {
      "User-Agent": "LaVozWorker/1.0",
    },
  });

  socket.on("open", () => {
    reconnectDelay = 3000;
    logger.info("WorkerClient", "Connected");
    send({
      type: "register",
      workerId: config.workerId,
      secret: config.workerSecret,
      name: config.workerName,
      maxConcurrentJobs: config.maxConcurrentJobs,
    });
    startHeartbeat();
  });

  socket.on("message", (raw) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      logger.warn("WorkerClient", "Invalid JSON from server");
      return;
    }

    const type = message.type as string;
    switch (type) {
      case "acknowledge":
        logger.info("WorkerClient", "Registration acknowledged by server");
        break;
      case "ping":
        send({ type: "pong", workerId: config.workerId });
        break;
      case "assign_job":
        if (activeJobs >= config.maxConcurrentJobs) {
          logger.warn("WorkerClient", "Received assign_job but already at max concurrency", {
            activeJobs,
            maxConcurrentJobs: config.maxConcurrentJobs,
          });
          return;
        }
        void handleJob(message as unknown as AssignJobMessage);
        break;
      default:
        logger.warn("WorkerClient", "Unknown message type from server", { type });
    }
  });

  socket.on("close", () => {
    logger.warn("WorkerClient", "Disconnected", { reconnectDelay });
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });

  socket.on("error", (err) => {
    logger.error("WorkerClient", "Socket error", {
      error: err.message,
      code: (err as any).code,
      errno: (err as any).errno,
      syscall: (err as any).syscall,
    });
  });
}

function startHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  heartbeatTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      const status = activeJobs > 0 ? "busy" : "idle";
      const heartbeatMsg: WorkerMessage = {
        type: "heartbeat",
        workerId: config.workerId,
        status,
        ...(activeJobs > 0 ? {} : {}), // currentJobId is optional; we omit it when idle
      };
      send(heartbeatMsg);
    }
  }, 20_000);
}

function send(message: WorkerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      logger.error("WorkerClient", "Failed to send message", { error: String(err) });
    }
  }
}

function reportStatus(jobId: string, status: string): void {
  send({ type: "job_status", workerId: config.workerId, jobId, status });
}

async function handleJob(job: AssignJobMessage): Promise<void> {
  const { jobId, videoId, url, azuracast } = job;

  activeJobs++;
  logger.info("WorkerClient", "Job started", { jobId, videoId, activeJobs });

  send({ type: "job_ack", workerId: config.workerId, jobId });

  let localPath: string | null = null;

  try {
    reportStatus(jobId, "CHECKING_METADATA");
    const meta = await fetchMetadata(url);

    if (meta.duration > job.maxDurationSeconds) {
      logger.info("WorkerClient", "Video ignored: exceeds max duration", {
        videoId,
        duration: meta.duration,
        max: job.maxDurationSeconds,
      });
      reportStatus(jobId, "IGNORED");
      send({
        type: "job_done",
        workerId: config.workerId,
        jobId,
        azuracastFileId: "",
        azuracastPath: "",
        duration: meta.duration,
        ignored: true,
      });
      return;
    }

    reportStatus(jobId, "DOWNLOADING");
    localPath = await downloadAsMp3(videoId, url);

    reportStatus(jobId, "UPLOADING");
    const { fileId, azuraPath } = await uploadToAzuracast(localPath, job.uploadProxyUrl, job.title, config.workerSecret);

    deleteFile(localPath);
    localPath = null;

    send({
      type: "job_done",
      workerId: config.workerId,
      jobId,
      azuracastFileId: fileId,
      azuracastPath: azuraPath,
      duration: meta.duration,
    });

    logger.info("WorkerClient", "Job completed", { jobId, videoId, azuraPath });
  } catch (err) {
    if (localPath) {
      deleteFile(localPath);
      localPath = null;
    }

    const errorMessage = String(err);
    const isRetryable = err instanceof UploadError ? err.retryable : true;
    logger.error("WorkerClient", "Job failed", { jobId, videoId, error: errorMessage, retryable: isRetryable });

    send({
      type: "job_error",
      workerId: config.workerId,
      jobId,
      error: errorMessage,
      retryable: isRetryable,
    });
  } finally {
    activeJobs--;
    logger.info("WorkerClient", "Job finished", { jobId, activeJobs });
  }
}
