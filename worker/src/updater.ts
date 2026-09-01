import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import * as semver from "semver";
import unzipper from "unzipper";
import { config } from "./config";
import { logger } from "./logger";

const INSTALL_DIR = path.resolve(__dirname, "..", "..");
const PENDING_ZIP = path.join(INSTALL_DIR, ".pending.zip");
const PENDING_DIR = path.join(INSTALL_DIR, ".pending");

let pendingUpdate: { version: string; sha256: string; url: string } | null = null;

export function setPendingUpdate(update: { version: string; sha256: string; url: string } | null): void {
  pendingUpdate = update;
}

export function getPendingUpdate(): { version: string; sha256: string; url: string } | null {
  return pendingUpdate;
}

function baseHttpUrl(): string {
  return config.serverWsUrl.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}

export async function downloadAndVerify(url: string, expectedSha256: string): Promise<string> {
  const httpUrl = url.startsWith("/") ? baseHttpUrl() + url : url;
  const res = await axios.get(httpUrl, {
    responseType: "stream",
    headers: {
      "x-worker-secret": config.workerSecret,
      "x-worker-version": config.version,
    },
    timeout: 120_000,
  });

  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(PENDING_ZIP);

  await new Promise<void>((resolve, reject) => {
    (res.data as NodeJS.ReadableStream).on("data", (chunk: Buffer) => hash.update(chunk));
    (res.data as NodeJS.ReadableStream).pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    (res.data as NodeJS.ReadableStream).on("error", reject);
  });

  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    try {
      fs.unlinkSync(PENDING_ZIP);
    } catch {}
    throw new Error(`SHA256 mismatch: expected ${expectedSha256} got ${actual}`);
  }
  return PENDING_ZIP;
}

export async function applyUpdate(zipPath: string, version?: string): Promise<void> {
  if (fs.existsSync(PENDING_DIR)) {
    fs.rmSync(PENDING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PENDING_DIR, { recursive: true });

  await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: PENDING_DIR })).promise();

  const pendingMain = path.join(PENDING_DIR, "main.js");
  const pendingDistMain = path.join(PENDING_DIR, "dist", "main.js");
  if (!fs.existsSync(pendingMain) && !fs.existsSync(pendingDistMain)) {
    throw new Error("ZIP sin main.js/dist/main.js");
  }

  const backupMain = path.join(INSTALL_DIR, "main.js.bak");
  const currentMain = path.join(INSTALL_DIR, "main.js");
  if (fs.existsSync(currentMain)) {
    fs.copyFileSync(currentMain, backupMain);
  }

  for (const entry of fs.readdirSync(PENDING_DIR)) {
    const src = path.join(PENDING_DIR, entry);
    const dest = path.join(INSTALL_DIR, entry);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.renameSync(src, dest);
  }

  fs.rmSync(PENDING_DIR, { recursive: true, force: true });
  try {
    fs.unlinkSync(zipPath);
  } catch {}

  if (version) {
    try {
      fs.writeFileSync(path.join(INSTALL_DIR, "version.txt"), version, "utf8");
    } catch {}
  }

  const winsw = path.join(INSTALL_DIR, "bins", "WinSW.exe");
  if (fs.existsSync(winsw)) {
    const { exec } = await import("child_process");
    exec(`"${winsw}" restart`, (err) => {
      if (err) {
        exec(`"${winsw}" stop`, () => {
          exec(`"${winsw}" start`, () => {});
        });
      }
    });
  } else {
    logger.warn("Updater", "WinSW no encontrado, reinicio manual requerido");
    process.exit(0);
  }
}

export async function handleUpdateAvailable(
  msg: { version: string; sha256: string; url: string },
  isIdle: () => boolean
): Promise<void> {
  if (semver.valid(msg.version) && semver.valid(config.version) && semver.lte(msg.version, config.version)) {
    logger.info("Updater", "Version ya actual", { current: config.version, incoming: msg.version });
    return;
  }

  if (!isIdle()) {
    setPendingUpdate(msg);
    logger.info("Updater", "Update aplazado, worker busy", { version: msg.version });
    return;
  }

  logger.info("Updater", "Descargando update", { version: msg.version });
  try {
    const zip = await downloadAndVerify(msg.url, msg.sha256);
    await applyUpdate(zip, msg.version);
    logger.info("Updater", "Update aplicado, reiniciando", { version: msg.version });
  } catch (err) {
    logger.error("Updater", "Fallo al aplicar update", { error: String(err), version: msg.version });
  }
}
