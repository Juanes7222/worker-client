import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";
import { logger } from "../logger";

export interface UploadResult {
  fileId: string;
  azuraPath: string;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export async function uploadToAzuracast(
  localPath: string,
  uploadProxyUrl: string,
  title: string,
  workerSecret: string
): Promise<UploadResult> {
  const filename = path.basename(localPath);

  logger.info("Upload", "Uploading via backend proxy", { filename, url: uploadProxyUrl });

  const form = new FormData();
  form.append("file", fs.createReadStream(localPath), { filename });
  form.append("title", title);

  let response: Awaited<ReturnType<typeof fetch>>;

  try {
    response = await fetch(uploadProxyUrl, {
      method: "POST",
      headers: {
        "X-Worker-Secret": workerSecret,
      },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err) {
    const msg = String(err);
    logger.error("Upload", "Network error during proxy upload", { error: msg });
    throw new UploadError(`Network error: ${msg}`, 0, true);
  }

  if (!response.ok) {
    const body = await response.text();
    const msg = `Proxy upload failed [${response.status}]: ${body}`;
    logger.error("Upload", msg, { status: response.status });
    const isRetryable = response.status >= 500 || response.status === 408 || response.status === 429;
    throw new UploadError(msg, response.status, isRetryable);
  }

  const data = (await response.json()) as { fileId: string; azuraPath: string };

  logger.info("Upload", "Upload complete via proxy", { fileId: data.fileId, azuraPath: data.azuraPath });
  return { fileId: String(data.fileId), azuraPath: data.azuraPath };
}
