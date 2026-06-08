import "dotenv/config";

export const config = {
  serverWsUrl: process.env.SERVER_WS_URL ?? "",
  workerId: process.env.WORKER_ID ?? "",
  workerName: process.env.WORKER_NAME ?? "unnamed-worker",
  workerSecret: process.env.WORKER_SECRET ?? "",
  maxConcurrentJobs: parseInt(process.env.WORKER_MAX_CONCURRENT_JOBS ?? "1", 10),
  maxDurationSeconds: parseInt(process.env.MAX_VIDEO_DURATION_SECONDS ?? "600", 10),
  tempDir: process.env.TEMP_DOWNLOAD_DIR ?? "/tmp/yt-downloads",
};