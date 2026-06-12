import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

// Uses the portable yt-dlp binary path from config when available,
// falling back to system PATH for local development.
const YTDLP = process.env.YTDLP_BIN ?? "yt-dlp";
const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const DENO = process.env.DENO_BIN ?? "deno";

export async function downloadAsMp3(videoId: string, url: string): Promise<string> {
  if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
  }

  const outputTemplate = path.join(config.tempDir, `${videoId}.%(ext)s`);
  const expectedPath   = path.join(config.tempDir, `${videoId}.mp3`);

  logger.info("Download", "Starting download", { videoId, bin: YTDLP });

  const args = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--no-playlist",
    "--ffmpeg-location", FFMPEG,
    "--js-runtimes", `deno:${DENO}`,
    "-o", outputTemplate,
    url,
  ];

  await execFileAsync(YTDLP, args, { timeout: 300_000 });

  if (!fs.existsSync(expectedPath)) {
    throw new Error(`MP3 not found after download: ${expectedPath}`);
  }

  logger.info("Download", "Download complete", { videoId, path: expectedPath });
  return expectedPath;
}

export function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}