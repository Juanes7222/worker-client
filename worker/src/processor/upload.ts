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

export async function uploadToAzuracast(
  localPath: string,
  uploadProxyUrl: string,
  jobId: string,
  title: string,
  workerSecret: string
): Promise<UploadResult> {
  const filename = path.basename(localPath);
  const fileBuffer = fs.readFileSync(localPath);
  const titleBuffer = Buffer.from(title, "utf8");
  const jobIdBuffer = Buffer.from(jobId, "utf8");

  logger.info("Upload", "Uploading via backend proxy", {
    filename,
    jobId,
    url: uploadProxyUrl,
    size: fileBuffer.length,
  });

  const form = new FormData();
  form.append("title", title);
  form.append("jobId", jobId);
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
      const msg = `Proxy upload failed [${status}]: ${JSON.stringify(err.response.data)}`;
      logger.error("Upload", msg, { status });
      const isRetryable = status >= 500 || status === 408 || status === 429;
      throw new UploadError(msg, status, isRetryable);
    }
    throw err;
  }
}