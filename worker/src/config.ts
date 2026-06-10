import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// When running as a packaged service, main.js is directly in INSTALL_DIR.
// When running with tsx during development, main.ts is inside src/.
// Try both paths so the worker works in both environments.
const envPathProduction = path.resolve(__dirname, ".env");
const envPathDevelopment = path.resolve(__dirname, "..", ".env");

const envPath = fs.existsSync(envPathProduction) ? envPathProduction : envPathDevelopment;

dotenv.config({ path: envPath });

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
