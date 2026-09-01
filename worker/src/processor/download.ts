import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../logger";
import { UploadError } from "./upload";

const execFileAsync = promisify(execFile);

const YTDLP = process.env.YTDLP_BIN ?? "yt-dlp";
const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const DENO = process.env.DENO_BIN ?? "deno";

export class YtDlpError extends UploadError {
  constructor(message: string, retryable: boolean) {
    super(message, 0, retryable);
    this.name = "YtDlpError";
  }
}

function findCookiesFile(): string | null {
  // 1) Explicit env (portable: can be relative to INSTALL_DIR)
  const envPath = process.env.YTDLP_COOKIES_PATH ?? process.env.COOKIES_PATH;
  if (envPath) {
    const abs = path.isAbsolute(envPath) ? envPath : path.resolve(__dirname, envPath);
    if (fs.existsSync(abs)) return abs;
  }
  // 2) Fixed install layout: INSTALL_DIR/cookies.txt and INSTALL_DIR/bins/cookies.txt
  // config.tempDir = INSTALL_DIR/temp -> INSTALL_DIR = dirname(tempDir)
  const installDir = path.dirname(config.tempDir);
  const candidates = [
    path.join(installDir, "cookies.txt"),
    path.join(installDir, "bins", "cookies.txt"),
    path.join(__dirname, "cookies.txt"),
    path.join(__dirname, "..", "cookies.txt"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getYtDlpCookiesArgs(): string[] {
  const p = findCookiesFile();
  if (p) {
    logger.info("YTDLP", "Using cookies file", { path: p });
    return ["--cookies", p];
  }
  return [];
}

let ytDlpUpdateScheduled = false;
function ensureYtDlpAutoUpdate(): void {
  if (ytDlpUpdateScheduled) return;
  if (process.env.YTDLP_AUTO_UPDATE === "0") return;
  ytDlpUpdateScheduled = true;
  const intervalMs = parseInt(process.env.YTDLP_AUTO_UPDATE_INTERVAL_MS ?? "86400000", 10);
  const doUpdate = async () => {
    try {
      logger.info("YTDLP", "Checking for yt-dlp update", { bin: YTDLP });
      await execFileAsync(YTDLP, ["--update"], { timeout: 120_000 });
      logger.info("YTDLP", "yt-dlp update check finished");
    } catch (err: any) {
      const msg = String(err?.stderr ?? err?.message ?? err);
      // --update not supported on nightly/portable builds -> not fatal
      if (/unknown option|no update/i.test(msg)) {
        logger.info("YTDLP", "yt-dlp --update not supported for this build", { msg });
      } else {
        logger.warn("YTDLP", "yt-dlp auto-update failed", { error: msg });
      }
    }
  };
  setTimeout(doUpdate, 30_000);
  setInterval(doUpdate, intervalMs);
}
ensureYtDlpAutoUpdate();

const NON_RETRYABLE_YTDLP_PATTERNS: RegExp[] = [
  /private video/i,
  /video unavailable/i,
  /this video is unavailable/i,
  /has been removed/i,
  /has been terminated/i,
  /account associated with this video has been terminated/i,
  /copyright/i,
  /members-only/i,
  /join this channel to get access/i,
  /only available to music premium/i,
  /video was deleted/i,
  /unsupported url/i,
  /sign in to confirm your age/i,
  /age[ -]restricted/i,
  /not available in your country/i,
  /geo.?blocked/i,
];

const RETRYABLE_LIVE_PATTERNS: RegExp[] = [
  /this live event will begin/i,
  /premiere will begin/i,
  /waiting for .* live/i,
];

function classifyDownloadError(raw: string): boolean {
  if (RETRYABLE_LIVE_PATTERNS.some((re) => re.test(raw))) return true;
  if (NON_RETRYABLE_YTDLP_PATTERNS.some((re) => re.test(raw))) return false;
  return true;
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function downloadAsMp3(videoId: string, url: string): Promise<string> {
  // Throttle inter-job to avoid bot-detection burst (normal PCs hammering sequentially)
  const jitter = 800 + Math.random() * 1700;
  await sleep(jitter);
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
    "--extractor-args", "youtube:player_client=android,web",
    "--extractor-retries", "3",
    "--fragment-retries", "3",
    "--retry-sleep", "2",
    "--concurrent-fragments", "3",
    "--sleep-requests", "1",
    "--sleep-interval", "2",
    "--max-sleep-interval", "5",
    ...getYtDlpCookiesArgs(),
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
    const raw = stderr || out || error?.message || "unknown error";
    const retryable = classifyDownloadError(raw);
    throw new YtDlpError(`yt-dlp failed for ${videoId}: ${raw}`, retryable);
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