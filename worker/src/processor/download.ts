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

function lastNonEmptyLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function ensureTempDir(): void {
  if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
  }
}

export async function downloadAsMp3(videoId: string, url: string): Promise<string> {
  ensureTempDir();

  // The filename will be based on the video title.
  // yt-dlp sanitizes invalid characters for the OS.
  const outputTemplate = path.join(config.tempDir, "%(title).200s.%(ext)s");

  logger.info("Download", "Starting download", { videoId, bin: YTDLP });

  const args = [
    "--no-playlist",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--embed-metadata",
    "--ffmpeg-location", FFMPEG,
    "--js-runtimes", `deno:${DENO}`,
    "--print", "after_move:filepath",
    "--no-progress",
    "--quiet",
    "--no-warnings",
    ...(process.platform === "win32" ? ["--windows-filenames"] : []),
    "-o", outputTemplate,
    url,
  ];

  let stdout = "";
  try {
    const result = await execFileAsync(YTDLP, args, {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout?.toString() ?? "";
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() ?? "";
    const out = error?.stdout?.toString?.() ?? "";
    throw new Error(
      `yt-dlp failed for ${videoId}: ${stderr || out || error?.message || "unknown error"}`
    );
  }

  const finalPath = lastNonEmptyLine(stdout);
  if (!finalPath) {
    throw new Error(`yt-dlp did not return the final filepath for ${videoId}`);
  }

  if (!fs.existsSync(finalPath)) {
    throw new Error(`MP3 not found after download: ${finalPath}`);
  }

  const stats = fs.statSync(finalPath);
  if (stats.size < 1024) {
    throw new Error(
      `Downloaded MP3 is too small (${stats.size} bytes), likely corrupt: ${finalPath}`
    );
  }

  logger.info("Download", "Download complete", {
    videoId,
    path: finalPath,
    size: stats.size,
  });

  return finalPath;
}

export function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}