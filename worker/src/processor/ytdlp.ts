import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

export const YTDLP_BIN = process.env.YTDLP_BIN ?? "yt-dlp";
export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's signature and n-parameter
 * challenges. Without one, current yt-dlp only exposes the formats it can reach
 * unauthenticated, which on many sessions is just the storyboards, and the
 * download dies with "Only images are available for download".
 *
 * The runtime is resolved from the installation instead of trusted from a single
 * env var: once the packaged deno.exe is missing, DENO_BIN still points at it and
 * passing a nonexistent path is worse than passing nothing, because it satisfies
 * the flag while leaving yt-dlp without a runtime. The shipped node.exe (and the
 * node binary running this worker) are the fallback, so it can never be absent.
 */
interface JsRuntime {
  name: "deno" | "node";
  bin: string;
}

let cachedJsRuntime: JsRuntime | null | undefined;

function binaryName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function isExistingFile(candidate: string): boolean {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveJsRuntime(): JsRuntime | null {
  if (cachedJsRuntime !== undefined) return cachedJsRuntime;

  const installDir = path.dirname(config.tempDir);
  const candidates: JsRuntime[] = [
    { name: "deno", bin: process.env.DENO_BIN ?? "" },
    { name: "deno", bin: path.join(installDir, "bins", binaryName("deno")) },
    { name: "node", bin: process.env.NODE_BIN ?? "" },
    { name: "node", bin: path.join(installDir, "bins", binaryName("node")) },
    { name: "node", bin: process.execPath },
  ];

  const found = candidates.find((candidate) => isExistingFile(candidate.bin)) ?? null;
  cachedJsRuntime = found;

  if (found) {
    logger.info("YTDLP", "JavaScript runtime resolved", { runtime: found.name, bin: found.bin });
  } else {
    logger.warn("YTDLP", "No JavaScript runtime found, YouTube extraction will be degraded");
  }

  return found;
}

function findCookiesFile(): string | null {
  const envPath = process.env.YTDLP_COOKIES_PATH ?? process.env.COOKIES_PATH;
  if (envPath) {
    const absolute = path.isAbsolute(envPath) ? envPath : path.resolve(__dirname, envPath);
    if (fs.existsSync(absolute)) return absolute;
  }

  // tempDir is INSTALL_DIR/temp, so its parent holds the installed binaries.
  const installDir = path.dirname(config.tempDir);
  const candidates = [
    path.join(installDir, "cookies.txt"),
    path.join(installDir, "bins", "cookies.txt"),
    path.join(__dirname, "cookies.txt"),
    path.join(__dirname, "..", "cookies.txt"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

let cookiesLogged = false;

/**
 * Arguments every yt-dlp invocation needs. Both passes (metadata and download)
 * must agree, otherwise the format list the metadata pass sees is not the one
 * the download pass picks from.
 */
export function getSharedYtDlpArgs(): string[] {
  const args = ["--no-playlist"];

  const runtime = resolveJsRuntime();
  if (runtime) {
    args.push("--js-runtimes", `${runtime.name}:${runtime.bin}`);
  }

  const cookies = findCookiesFile();
  if (cookies) {
    args.push("--cookies", cookies);
    if (!cookiesLogged) {
      cookiesLogged = true;
      logger.info("YTDLP", "Using cookies file", { path: cookies });
    }
  }

  // Escape hatch: pinning a client by hand is worse than letting yt-dlp walk its
  // own list (a pinned android client is served SABR-only on many sessions), but
  // an operator may still need to force one without shipping a new worker.
  const pinnedClient = process.env.YTDLP_PLAYER_CLIENT?.trim();
  if (pinnedClient) {
    args.push("--extractor-args", `youtube:player_client=${pinnedClient}`);
  }

  return args;
}

const EXTRACTION_BROKEN_PATTERNS: RegExp[] = [
  /only images are available/i,
  /requested format is not available/i,
  /sabr-only/i,
  /no supported javascript runtime/i,
  /nsig extraction failed/i,
];

/**
 * Failures that say nothing about the video and everything about the extractor:
 * YouTube changed something and the installed yt-dlp is too old. They stay
 * retryable, and the retry is worth nothing unless the binary is refreshed first.
 */
export function looksLikeExtractionBreakage(raw: string): boolean {
  return EXTRACTION_BROKEN_PATTERNS.some((pattern) => pattern.test(raw));
}

export function refreshYtDlpAfterExtractionFailure(raw: string, context: string): void {
  if (!looksLikeExtractionBreakage(raw)) return;
  logger.warn("YTDLP", "Extraction looks outdated, forcing an update before the next attempt", { context });
  void forceYtDlpUpdate();
}

const UPDATE_ENABLED = process.env.YTDLP_AUTO_UPDATE !== "0";
const UPDATE_INTERVAL_MS = Math.max(
  parseInt(process.env.YTDLP_AUTO_UPDATE_INTERVAL_MS ?? "86400000", 10) || 86_400_000,
  60_000
);

/**
 * A job that keeps failing on an outdated extractor retries with a short backoff,
 * so an unthrottled forced update would pull the whole binary once a minute.
 * This floor keeps the self-healing while the backend walks its own retry ladder.
 */
const FORCED_UPDATE_FLOOR_MS = 10 * 60 * 1000;

let lastAttemptAt = 0;
let updateInFlight: Promise<void> | null = null;

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const withOutput = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof withOutput.stderr === "string" ? withOutput.stderr.trim() : "";
    const stdout = typeof withOutput.stdout === "string" ? withOutput.stdout.trim() : "";
    const described = stderr || stdout || (typeof withOutput.message === "string" ? withOutput.message : "");
    if (described) return lastLine(described);
  }

  return String(error);
}

export async function readYtDlpVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(YTDLP_BIN, ["--version"], { timeout: 20_000 });
    return stdout.trim() || null;
  } catch (error) {
    logger.warn("YTDLP", "Could not read the yt-dlp version", { error: describeError(error) });
    return null;
  }
}

/**
 * Called once per job, not on an import-time interval: an update replaces the
 * executable, and doing that while another yt-dlp process holds the file on
 * Windows fails with a locked-file error that looks like a download failure.
 */
export async function ensureYtDlpReady(): Promise<void> {
  if (!UPDATE_ENABLED) return;
  if (Date.now() - lastAttemptAt < UPDATE_INTERVAL_MS) return;
  await runUpdate("scheduled");
}

export function forceYtDlpUpdate(): Promise<void> {
  if (!UPDATE_ENABLED) return Promise.resolve();
  if (Date.now() - lastAttemptAt < FORCED_UPDATE_FLOOR_MS) {
    logger.info("YTDLP", "An update was attempted recently, keeping the current binary");
    return Promise.resolve();
  }
  return runUpdate("after an extraction failure");
}

function runUpdate(reason: string): Promise<void> {
  if (updateInFlight) return updateInFlight;
  lastAttemptAt = Date.now();
  updateInFlight = performUpdate(reason).finally(() => {
    updateInFlight = null;
  });
  return updateInFlight;
}

async function performUpdate(reason: string): Promise<void> {
  const before = await readYtDlpVersion();
  logger.info("YTDLP", "Checking for a yt-dlp update", { reason, bin: YTDLP_BIN, version: before });

  try {
    const { stdout, stderr } = await execFileAsync(YTDLP_BIN, ["--update"], { timeout: 300_000 });
    const after = await readYtDlpVersion();

    if (after && after !== before) {
      logger.info("YTDLP", "yt-dlp updated", { from: before, to: after });
      return;
    }

    logger.info("YTDLP", "yt-dlp is already current", {
      version: after ?? before,
      output: lastLine(`${stdout}${stderr}`),
    });
  } catch (error) {
    const message = describeError(error);
    if (/unknown option|no update|not possible to update|unsupported/i.test(message)) {
      logger.info("YTDLP", "This yt-dlp build cannot self-update", { error: message });
      return;
    }
    logger.warn("YTDLP", "yt-dlp auto-update failed", { error: message });
  }
}
