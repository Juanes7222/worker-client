import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { URL } from "url";
import FormData from "form-data";
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

function collectResponseBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", (err) => reject(err));
  });
}

export async function uploadToAzuracast(
  localPath: string,
  uploadProxyUrl: string,
  jobId: string,
  title: string,
  workerSecret: string
): Promise<UploadResult> {
  const filename = path.basename(localPath);

  logger.info("Upload", "Uploading via backend proxy", { filename, jobId, url: uploadProxyUrl });

  const form = new FormData();
  form.append("file", fs.createReadStream(localPath), { filename });
  form.append("title", title);
  form.append("jobId", jobId);

  const url = new URL(uploadProxyUrl);
  const isHttps = url.protocol === "https:";

  const requestOptions: http.RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "X-Worker-Secret": workerSecret,
      "X-Job-Id": jobId,
      ...form.getHeaders(),
    },
  };

  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = isHttps ? https.request(requestOptions) : http.request(requestOptions);

    request.setTimeout(600_000, () => {
      request.destroy();
      reject(new Error("Upload request timed out after 600 seconds"));
    });

    request.on("error", (err) => {
      reject(err);
    });

    request.on("response", (response) => {
      resolve(response);
    });

    form.pipe(request);
  });

  const body = await collectResponseBody(res);

  if (res.statusCode !== 200 && res.statusCode !== 202) {
    const msg = `Proxy upload failed [${res.statusCode}]: ${body}`;
    logger.error("Upload", msg, { status: res.statusCode });
    const isRetryable =
      res.statusCode === undefined ||
      res.statusCode >= 500 ||
      res.statusCode === 408 ||
      res.statusCode === 429;
    throw new UploadError(msg, res.statusCode ?? 0, isRetryable);
  }

  if (res.statusCode === 202) {
    logger.info("Upload", "Upload accepted by backend (background processing)", { jobId });
    return { fileId: "", azuraPath: "", accepted: true };
  }

  const data = JSON.parse(body) as { fileId: string; azuraPath: string };
  logger.info("Upload", "Upload complete via proxy", { jobId, fileId: data.fileId, azuraPath: data.azuraPath });
  return { fileId: String(data.fileId), azuraPath: data.azuraPath, accepted: false };
}
