import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

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

  // Use a fixed, ASCII-safe filename to avoid Windows path encoding issues
  // with titles containing accented characters or special symbols.
  const outputTemplate = path.join(config.tempDir, `${videoId}.%(ext)s`);

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

  const reportedPath = lastNonEmptyLine(stdout);
  const expectedPath = path.join(config.tempDir, `${videoId}.mp3`);

  // Prefer the path yt-dlp reported; fall back to the expected path if
  // stdout was empty or the reported path doesn't exist (encoding edge cases).
  const finalPath = (reportedPath && fs.existsSync(reportedPath))
    ? reportedPath
    : expectedPath;

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

  await ensureUtf8Metadata(finalPath, videoId);

  return finalPath;
}

async function ensureUtf8Metadata(filePath: string, videoId: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `${videoId}.utf8.mp3`
  );

  try {
    await execFileAsync(FFMPEG, [
      "-i", filePath,
      "-c", "copy",
      "-map_metadata", "0",
      "-id3v2_version", "4",
      "-y",
      tempPath,
    ], { timeout: 60_000 });

    const tempStats = fs.statSync(tempPath);
    if (tempStats.size < 1024) {
      fs.unlinkSync(tempPath);
      return;
    }

    fs.renameSync(tempPath, filePath);
    logger.info("Download", "ID3 tags re-encoded to UTF-8", { videoId });
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    logger.warn("Download", "Failed to re-encode ID3 tags, using original file", {
      videoId,
      error: String(err),
    });
  }
}

export function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}