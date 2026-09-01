import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { UploadError } from "./upload";

const execFileAsync = promisify(execFile);
const YTDLP = process.env.YTDLP_BIN ?? "yt-dlp";

function findCookiesFile(): string | null {
  const envPath = process.env.YTDLP_COOKIES_PATH ?? process.env.COOKIES_PATH;
  if (envPath) {
    const abs = path.isAbsolute(envPath) ? envPath : path.resolve(__dirname, envPath);
    if (fs.existsSync(abs)) return abs;
  }
  // Worker runs as INSTALL_DIR/main.js -> INSTALL_DIR = dirname(tempDir) or dirname(__dirname)
  // Try both to work in dev (src/) and production (INSTALL_DIR/)
  const candidates: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require("../config").config as { tempDir: string };
    const installDir = path.dirname(cfg.tempDir);
    candidates.push(path.join(installDir, "cookies.txt"));
    candidates.push(path.join(installDir, "bins", "cookies.txt"));
  } catch {}
  candidates.push(path.join(__dirname, "cookies.txt"));
  candidates.push(path.join(__dirname, "..", "cookies.txt"));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getYtDlpCookiesArgs(): string[] {
  const p = findCookiesFile();
  return p ? ["--cookies", p] : [];
}

export interface VideoMeta {
  duration: number;
  title: string;
  available: boolean;
  artist: string;
}

export class MetadataError extends UploadError {
  constructor(message: string, retryable: boolean) {
    super(message, 0, retryable);
    this.name = "MetadataError";
  }
}

const NON_RETRYABLE_PATTERNS: RegExp[] = [
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
  /requires payment/i,
  /not available in your country/i,
  /geo.?blocked/i,
  /premium content/i,
];

const RETRYABLE_LIVE_PATTERNS: RegExp[] = [
  /this live event will begin/i,
  /premiere will begin/i,
  /waiting for .* live/i,
  /live event will begin in/i,
];

function classifyMetadataError(raw: string): boolean {
  if (RETRYABLE_LIVE_PATTERNS.some((re) => re.test(raw))) return true;
  if (NON_RETRYABLE_PATTERNS.some((re) => re.test(raw))) return false;
  // transient/network/bot-detection -> retryable
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchMetadata(url: string): Promise<VideoMeta> {
  await sleep(400 + Math.random() * 800);
  try {
    const { stdout } = await execFileAsync(
      YTDLP,
      [
        "--dump-json",
        "--no-playlist",
        "--extractor-args",
        "youtube:player_client=android,web",
        "--extractor-retries",
        "2",
        "--retry-sleep",
        "1",
        "--sleep-requests",
        "1",
        "--sleep-interval",
        "1",
        ...getYtDlpCookiesArgs(),
        url,
      ],
      { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);

    // Upcoming/premiere without media yet -> retryable later, don't treat as permanent failure
    if (
      data.live_status === "is_upcoming" ||
      (typeof data.release_timestamp === "number" && data.release_timestamp * 1000 > Date.now())
    ) {
      throw new MetadataError(
        `Metadata fetch failed: This live event will begin at ${data.live_status ?? "future"} (${url})`,
        true
      );
    }

    if (data.availability && data.availability !== "public" && data.availability !== "available") {
      const msg = `Video availability=${data.availability} for ${url}`;
      const retryable = classifyMetadataError(msg + " " + (data.title ?? ""));
      if (!retryable) throw new MetadataError(`Metadata fetch failed: ${msg}`, false);
    }

    return {
      duration: data.duration ?? 0,
      title: data.title ?? "",
      available: true,
      artist: data.artist ?? data.channel ?? data.uploader ?? "",
    };
  } catch (err) {
    if (err instanceof MetadataError) throw err;
    const raw = String(err);
    const retryable = classifyMetadataError(raw);
    throw new MetadataError(`Metadata fetch failed: ${raw}`, retryable);
  }
}
