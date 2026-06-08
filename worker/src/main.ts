import "dotenv/config";
import { logger } from "./logger";
import { startWorkerClient } from "./workerClient";

process.on("uncaughtException", (err) => {
  logger.error("Process", "Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Process", "Unhandled rejection", { reason: String(reason) });
});

logger.info("Process", "La Voz de la Verdad Worker starting", {
  workerId: process.env.WORKER_ID,
  server:   process.env.SERVER_WS_URL,
});

startWorkerClient();