import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  serverWsUrl:       requireEnv("SERVER_WS_URL"),
  workerId:          requireEnv("WORKER_ID"),
  workerSecret:      requireEnv("WORKER_SECRET"),
  workerName:        optionalEnv("WORKER_NAME", "unnamed-worker"),
  maxConcurrentJobs: parseInt(optionalEnv("WORKER_MAX_CONCURRENT_JOBS", "1"), 10),
  maxDurationSeconds: parseInt(optionalEnv("MAX_VIDEO_DURATION_SECONDS", "600"), 10),
  tempDir:           optionalEnv("TEMP_DOWNLOAD_DIR", path.resolve(__dirname, "..", "temp")),
};