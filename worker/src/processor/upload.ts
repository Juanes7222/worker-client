import fs from "fs";
import path from "path";
import FormData from "form-data";
import axios, { AxiosError } from "axios";
import { logger } from "../logger";

export interface UploadResult {
  fileId: string;
  azuraPath: string;
  accepted: boolean;
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

const BODY_PREVIEW_LIMIT = 300;

/**
 * Express answers an unmatched route with a full HTML error page. Logging it raw
 * buries the useful part of the failure, so the markup is flattened and capped.
 */
function describeBody(data: unknown): string {
  const text = typeof data === "string" ? data : JSON.stringify(data ?? "");
  const flattened = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return flattened.length > BODY_PREVIEW_LIMIT
    ? `${flattened.slice(0, BODY_PREVIEW_LIMIT)}…`
    : flattened;
}

export async function uploadToAzuracast(
  localPath: string,
  uploadProxyUrl: string,
  jobId: string,
  title: string,
  artist: string,
  workerSecret: string
): Promise<UploadResult> {
  const filename = path.basename(localPath);
  const fileBuffer = fs.readFileSync(localPath);
  const titleBuffer = Buffer.from(title, "utf8");
  const artistBuffer = Buffer.from(artist, "utf8");
  const jobIdBuffer = Buffer.from(jobId, "utf8");

  logger.info("Upload", "Uploading via backend proxy", {
    filename,
    jobId,
    url: uploadProxyUrl,
    size: fileBuffer.length,
  });

  const form = new FormData();
  form.append("title", titleBuffer, {
    contentType: "text/plain; charset=utf-8",
    knownLength: titleBuffer.length,
  });
  form.append("artist", artistBuffer, {
    contentType: "text/plain; charset=utf-8",
    knownLength: artistBuffer.length,
  });
  form.append("jobId", jobIdBuffer, {
    contentType: "text/plain; charset=utf-8",
    knownLength: jobIdBuffer.length,
  });
  form.append("file", fileBuffer, {
    filename,
    contentType: "audio/mpeg",
    knownLength: fileBuffer.length,
  });

  const contentLength = form.getLengthSync();
  logger.info("Upload", "Request headers", { contentLength });

  try {
    const response = await axios.post(uploadProxyUrl, form, {
      headers: {
        "X-Worker-Secret": workerSecret,
        "X-Job-Id": jobId,
        ...form.getHeaders(),
        "content-length": contentLength,
      },
      timeout: 600_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      // A 301/302 makes axios replay the request as a GET without the body, which
      // the backend answers with "Cannot GET /admin-api/workers/upload" and the
      // real reason stays invisible. Failing on the redirect names the cause.
      maxRedirects: 0,
    });

    if (response.status === 202) {
      logger.info("Upload", "Upload accepted by backend (background processing)", { jobId });
      return { fileId: "", azuraPath: "", accepted: true };
    }

    const data = response.data as { fileId: string; azuraPath: string };
    logger.info("Upload", "Upload complete via proxy", { jobId, fileId: data.fileId });
    return { fileId: String(data.fileId), azuraPath: data.azuraPath, accepted: false };

  } catch (err) {
    if (err instanceof AxiosError && err.response) {
      const status = err.response.status;
      const location = err.response.headers?.location;

      if (status >= 300 && status < 400) {
        const msg =
          `Proxy upload redirected [${status}] from ${uploadProxyUrl} to ${location ?? "unknown"}: ` +
          "a POST cannot follow a redirect. Point PUBLIC_URL at the host that answers " +
          "directly, without the www prefix.";
        logger.error("Upload", msg, { status, location });
        throw new UploadError(msg, status, false);
      }

      const msg = `Proxy upload failed [${status}]: ${describeBody(err.response.data)}`;
      logger.error("Upload", msg, { status });
      const isRetryable = status >= 500 || status === 408 || status === 429;
      throw new UploadError(msg, status, isRetryable);
    }
    throw err;
  }
}