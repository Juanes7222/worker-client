import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const YTDLP = process.env.YTDLP_BIN ?? "yt-dlp";

export interface VideoMeta {
  duration: number;
  title: string;
  available: boolean;
}

export async function fetchMetadata(url: string): Promise<VideoMeta> {
  try {
    const { stdout } = await execFileAsync(
      YTDLP,
      ["--dump-json", "--no-playlist", url],
      { timeout: 30_000 }
    );
    const data = JSON.parse(stdout);
    return { duration: data.duration ?? 0, title: data.title ?? "", available: true };
  } catch {
    return { duration: 0, title: "", available: false };
  }
}