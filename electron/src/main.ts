import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exec, ExecOptions } from 'child_process';
import * as os from 'os';

interface WorkerConfig {
  serverWsUrl: string;
  workerId: string;
  workerName: string;
  workerSecret: string;
  azuracastBaseUrl: string;
  azuracastApiKey: string;
  azuracastStationId: string;
  azuracastPlaylistId?: string;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

interface WorkerStatus {
  installed: boolean;
  running: boolean;
}

const LOCAL_APP_DATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const CONFIG_PATH = path.join(os.homedir(), '.lavoz-worker', 'config.json');
const INSTALL_DIR = path.join(LOCAL_APP_DATA, 'LaVozWorker');
const SERVICE_SCRIPT = path.join(INSTALL_DIR, 'install-service.js');
const SERVICE_EXECUTABLE = path.join(INSTALL_DIR, 'lavoz-service.exe');
const SERVICE_CONFIG_XML = path.join(INSTALL_DIR, 'lavoz-service.xml');

let mainWindow: BrowserWindow | null = null;

/**
 * Initializes and displays the main application window.
 */
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('load-config', (): WorkerConfig | null => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as WorkerConfig;
    }
  } catch {
    // Fails silently to return null on invalid or missing config
  }
  return null;
});

ipcMain.handle('check-status', (): Promise<WorkerStatus> => {
  return new Promise((resolve) => {
    exec('sc query LaVozWorker', (_, stdout) => {
      if (!stdout) {
        resolve({ installed: false, running: false });
        return;
      }
      resolve({
        installed: true,
        running: stdout.includes('RUNNING'),
      });
    });
  });
});

ipcMain.handle('install', async (_event: IpcMainInvokeEvent, config: WorkerConfig): Promise<ActionResult> => {
  try {
    ensureDirectoryExists(INSTALL_DIR);
    ensureDirectoryExists(path.dirname(CONFIG_PATH));

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    const workerSource = getWorkerSourcePath();
    copyDirectoryRecursive(workerSource, INSTALL_DIR);

    // The WinSW executable should be bundled in your extraResources or worker-dist
    // and copied to INSTALL_DIR during the copyDirectoryRecursive step.

    await executeSystemCommand(`npm install --omit=dev`, { cwd: INSTALL_DIR });

    fs.writeFileSync(path.join(INSTALL_DIR, '.env'), buildEnvironmentFileContent(config, INSTALL_DIR));
    fs.writeFileSync(SERVICE_CONFIG_XML, buildServiceConfigurationXml(INSTALL_DIR));

    await executeSystemCommand(`"${SERVICE_EXECUTABLE}" install`, { cwd: INSTALL_DIR });
    await executeSystemCommand(`"${SERVICE_EXECUTABLE}" start`, { cwd: INSTALL_DIR });

    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  }
});
ipcMain.handle('uninstall', async (): Promise<ActionResult> => {
  try {
    if (fs.existsSync(SERVICE_EXECUTABLE)) {
      await executeSystemCommand(`"${SERVICE_EXECUTABLE}" stop`, { cwd: INSTALL_DIR });
      await executeSystemCommand(`"${SERVICE_EXECUTABLE}" uninstall`, { cwd: INSTALL_DIR });
    }
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  }
});

ipcMain.handle('start-service', (): Promise<ActionResult> => {
  return new Promise((resolve) => {
    exec(`"${SERVICE_EXECUTABLE}" start`, { cwd: INSTALL_DIR }, (err) => {
      resolve({ ok: !err, error: err?.message });
    });
  });
});

ipcMain.handle('stop-service', (): Promise<ActionResult> => {
  return new Promise((resolve) => {
    exec(`"${SERVICE_EXECUTABLE}" stop`, { cwd: INSTALL_DIR }, (err) => {
      resolve({ ok: !err, error: err?.message });
    });
  });
});

ipcMain.handle('read-logs', (): string => {
  const logPath = path.join(INSTALL_DIR, 'logs', 'worker.log');
  try {
    if (!fs.existsSync(logPath)) {
      return '';
    }
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-100).join('\n');
  } catch {
    return '';
  }
});

ipcMain.handle('close-app', () => app.quit());
ipcMain.handle('minimize-app', () => mainWindow?.minimize());

/**
 * Resolves the path to the compiled worker source depending on the execution environment.
 */
function getWorkerSourcePath(): string {
  if (app.isPackaged) {
    // In packaged .exe, the compiled worker is bundled within extraResources
    return path.join(process.resourcesPath, 'worker-dist');
  }
  return path.join(__dirname, '..', '..', 'worker', 'dist');
}

/**
 * Creates a directory and its parents if they do not exist.
 */
function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

/**
 * Recursively copies all contents from a source directory to a destination directory.
 */
function copyDirectoryRecursive(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(
      `Worker dist not found at: ${source}\nRun "pnpm build" inside the worker/ folder first.`
    );
  }
  ensureDirectoryExists(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

/**
 * Generates the environment variables string for the worker configuration.
 */
function buildEnvironmentFileContent(config: WorkerConfig, installDirectory: string): string {
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
    `TEMP_DOWNLOAD_DIR=${path.join(installDirectory, 'temp')}`,
  ].join('\n');
}

function buildServiceConfigurationXml(installDirectory: string): string {
  const nodeExecutable = process.execPath; 
  const scriptPath = path.join(installDirectory, 'main.js');

  return `
<service>
  <id>LaVozWorker</id>
  <name>La Voz de la Verdad Worker</name>
  <description>Audio processing worker for stream automation</description>
  <executable>${nodeExecutable}</executable>
  <arguments>"${scriptPath}"</arguments>
  <log mode="roll"></log>
  <workingdirectory>${installDirectory}</workingdirectory>
  <env name="NODE_ENV" value="production"/>
</service>
`.trim();
}

/**
 * Generates the Windows service installation script.
 */
function buildServiceScriptContent(installDirectory: string): string {
  const escapedDirectoryPath = installDirectory.replace(/\\/g, '\\\\');

  return `
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'LaVozWorker',
  description: 'La Voz de la Verdad - Audio processing worker',
  script: path.join('${escapedDirectoryPath}', 'main.js'),
  workingDirectory: '${escapedDirectoryPath}',
  env: [{ name: 'NODE_ENV', value: 'production' }],
});

const action = process.argv[2];

if (action === 'install') {
  svc.on('install', () => { svc.start(); process.exit(0); });
  svc.on('error', (e) => { console.error(e); process.exit(1); });
  svc.install();
} else if (action === 'uninstall') {
  svc.on('uninstall', () => { process.exit(0); });
  svc.on('error', (e) => { console.error(e); process.exit(1); });
  svc.uninstall();
}
`;
}

/**
 * Wraps child_process.exec in a Promise for async/await usage.
 */
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