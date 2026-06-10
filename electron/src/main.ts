import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, ExecOptions } from 'child_process';
import * as os from 'os';
import { WorkerConfig, ActionResult, WorkerStatus } from './types';

const LOCAL_APP_DATA  = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const CONFIG_PATH     = path.join(os.homedir(), '.lavoz-worker', 'config.json');
const INSTALL_DIR     = path.join(LOCAL_APP_DATA, 'LaVozWorker');
const BINS_DIR        = path.join(INSTALL_DIR, 'bins');

const SERVICE_EXE     = path.join(BINS_DIR, 'WinSW.exe');
const SERVICE_XML     = path.join(INSTALL_DIR, 'lavoz-service.xml');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 620,
    resizable: false,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0f0f0f',
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


ipcMain.handle('load-config', (): WorkerConfig | null => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as WorkerConfig;
    }
  } catch {}
  return null;
});

ipcMain.handle('check-status', (): Promise<WorkerStatus> => {
  return new Promise((resolve) => {
    exec('sc query LaVozWorker', (_, stdout) => {
      if (!stdout) { resolve({ installed: false, running: false }); return; }
      resolve({ installed: true, running: stdout.includes('RUNNING') });
    });
  });
});

ipcMain.handle('install', async (
  _event: IpcMainInvokeEvent,
  config: WorkerConfig
): Promise<ActionResult> => {
  try {
    ensureDirectoryExists(INSTALL_DIR);
    ensureDirectoryExists(BINS_DIR);
    ensureDirectoryExists(path.dirname(CONFIG_PATH));

    // 1. Save config for the UI to reload later
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    // 2. Copy compiled worker (dist/) to install dir
    copyDirectoryRecursive(getWorkerSourcePath(), INSTALL_DIR);

    // 3. Copy portable binaries: node.exe, yt-dlp.exe, WinSW.exe
    copyDirectoryRecursive(getBinsSourcePath(), BINS_DIR);

    // 4. Write .env with all worker variables including absolute binary paths
    fs.writeFileSync(
      path.join(INSTALL_DIR, '.env'),
      buildEnvironmentFileContent(config)
    );

    // 5. Write WinSW service descriptor XML
    fs.writeFileSync(SERVICE_XML, buildServiceXml());

    // 6. Register and start the Windows service via WinSW
    await executeSystemCommand(`"${SERVICE_EXE}" install "${SERVICE_XML}"`);
    await executeSystemCommand(`"${SERVICE_EXE}" start`);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('uninstall', async (): Promise<ActionResult> => {
  try {
    if (fs.existsSync(SERVICE_EXE)) {
      // Stop may fail if already stopped — ignore that error
      await executeSystemCommand(`"${SERVICE_EXE}" stop`).catch(() => {});
      await executeSystemCommand(`"${SERVICE_EXE}" uninstall`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('start-service', (): Promise<ActionResult> => {
  return new Promise((resolve) => {
    exec(`"${SERVICE_EXE}" start`, (err) => {
      resolve({ ok: !err, error: err?.message });
    });
  });
});

ipcMain.handle('stop-service', (): Promise<ActionResult> => {
  return new Promise((resolve) => {
    exec(`"${SERVICE_EXE}" stop`, (err) => {
      resolve({ ok: !err, error: err?.message });
    });
  });
});

ipcMain.handle('read-logs', (): string => {
  const logPath = path.join(INSTALL_DIR, 'logs', 'worker.log');
  try {
    if (!fs.existsSync(logPath)) return '';
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-100).join('\n');
  } catch {
    return '';
  }
});

ipcMain.handle('close-app',    () => app.quit());
ipcMain.handle('minimize-app', () => mainWindow?.minimize());

// ── Path resolvers ───────────────────────────────────────────────

/**
 * In development: uses worker/dist relative to this file.
 * In packaged .exe: uses the extraResources bundle.
 */
function getWorkerSourcePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'worker-dist');
  }
  return path.join(__dirname, '..', '..', 'worker', 'dist');
}

/**
 * In development: uses resources/bins relative to the repo root.
 * In packaged .exe: uses the extraResources bundle.
 */
function getBinsSourcePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bins');
  }
  return path.join(__dirname, '..', '..', 'resources', 'bins');
}

// ── Builders ────────────────────────────────────────────────────

/**
 * Writes all worker environment variables.
 * NODE_BIN and YTDLP_BIN point to the portable binaries so the worker
 * never depends on the system PATH.
 */
function buildEnvironmentFileContent(config: WorkerConfig): string {
  const nodeBin  = path.join(BINS_DIR, 'node.exe');
  const ytDlpBin = path.join(BINS_DIR, 'yt-dlp.exe');

  return [
    `SERVER_WS_URL=${config.serverWsUrl}`,
    `WORKER_ID=${config.workerId}`,
    `WORKER_NAME=${config.workerName}`,
    `WORKER_SECRET=${config.workerSecret}`,
    `WORKER_MAX_CONCURRENT_JOBS=1`,
    `AZURACAST_BASE_URL=${config.azuracastBaseUrl}`,
    `AZURACAST_API_KEY=${config.azuracastApiKey}`,
    `AZURACAST_STATION_ID=${config.azuracastStationId}`,
    `AZURACAST_PLAYLIST_ID=${config.azuracastPlaylistId ?? ''}`,
    `MAX_VIDEO_DURATION_SECONDS=600`,
    `TEMP_DOWNLOAD_DIR=${path.join(INSTALL_DIR, 'temp')}`,
    `NODE_BIN=${nodeBin}`,
    `YTDLP_BIN=${ytDlpBin}`,
  ].join('\n');
}

/**
 * Generates the WinSW XML descriptor that defines the Windows service.
 * WinSW uses the portable node.exe to run the compiled worker entry point.
 * See: https://github.com/winsw/winsw
 */
function buildServiceXml(): string {
  const nodeBin    = path.join(BINS_DIR, 'node.exe');
  const scriptPath = path.join(INSTALL_DIR, 'main.js');
  const logsDir    = path.join(INSTALL_DIR, 'logs');

  ensureDirectoryExists(logsDir);

  return [
    '<service>',
    '  <id>LaVozWorker</id>',
    '  <name>La Voz de la Verdad Worker</name>',
    '  <description>Audio processing worker for stream automation</description>',
    `  <executable>${nodeBin}</executable>`,
    `  <arguments>"${scriptPath}"</arguments>`,
    `  <workingdirectory>${INSTALL_DIR}</workingdirectory>`,
    `  <logpath>${logsDir}</logpath>`,
    '  <log mode="roll-by-size">',
    '    <sizeThreshold>5120</sizeThreshold>',
    '    <keepFiles>3</keepFiles>',
    '  </log>',
    '  <env name="NODE_ENV" value="production"/>',
    '  <onfailure action="restart" delay="10 sec"/>',
    '  <onfailure action="restart" delay="20 sec"/>',
    '  <onfailure action="none"/>',
    '</service>',
  ].join('\n');
}


function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function copyDirectoryRecursive(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Source not found: ${source}`);
  }
  ensureDirectoryExists(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath      = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function executeSystemCommand(command: string, options: ExecOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}