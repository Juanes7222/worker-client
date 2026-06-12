import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";
import { logger } from "../logger";

export interface AzuracastConfig {
  baseUrl: string;
  apiKey: string;
  stationId: string;
  playlistId: string;
}

export interface UploadResult {
  fileId: string;
  azuraPath: string;
}

export async function uploadToAzuracast(
  localPath: string,
  azuracast: AzuracastConfig
): Promise<UploadResult> {
  const { baseUrl, apiKey, stationId, playlistId } = azuracast;
  const filename = path.basename(localPath);

  logger.info("Upload", "Uploading to AzuraCast", { filename });

  const form = new FormData();
  form.append("file", fs.createReadStream(localPath), { filename });

  const uploadUrl = `${baseUrl}/api/station/${stationId}/files`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AzuraCast upload failed [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as { id: string; path: string };

  if (playlistId) {
    await fetch(`${baseUrl}/api/station/${stationId}/file/${data.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ playlists: [{ id: playlistId }] }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      logger.warn("Upload", "Could not assign to playlist", { fileId: data.id, playlistId });
    });
  }

  logger.info("Upload", "Upload complete", { fileId: data.id, azuraPath: data.path });
  return { fileId: String(data.id), azuraPath: data.path };
}
