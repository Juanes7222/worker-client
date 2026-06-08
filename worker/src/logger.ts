import fs from "fs";
import path from "path";
import { config } from "./config";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  [key: string]: unknown;
}

const LOG_DIR  = path.join(config.tempDir, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "worker.log");
const MAX_BYTES = 5 * 1024 * 1024;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
  } catch {}
}

function write(level: LogLevel, context: string, message: string, meta?: object): void {
  ensureLogDir();
  rotateIfNeeded();

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
  console[level === "error" ? "error" : "log"](line);
}

export const logger = {
  info:  (context: string, message: string, meta?: object) => write("info",  context, message, meta),
  warn:  (context: string, message: string, meta?: object) => write("warn",  context, message, meta),
  error: (context: string, message: string, meta?: object) => write("error", context, message, meta),
};