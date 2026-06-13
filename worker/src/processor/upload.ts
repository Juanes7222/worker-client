import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";
import { logger } from "../logger";

export interface UploadResult {
  fileId: string;
  azuraPath: string;
}

export async function uploadToAzuracast(
  localPath: string,
  uploadProxyUrl: string,
  title: string
): Promise<UploadResult> {
  const filename = path.basename(localPath);

  logger.info("Upload", "Uploading via backend proxy", { filename, url: uploadProxyUrl });

  const form = new FormData();
  form.append("file", fs.createReadStream(localPath), { filename });
  form.append("title", title);

  const response = await fetch(uploadProxyUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Proxy upload failed [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as { fileId: string; azuraPath: string };

  logger.info("Upload", "Upload complete via proxy", { fileId: data.fileId, azuraPath: data.azuraPath });
  return { fileId: String(data.fileId), azuraPath: data.azuraPath };
}
