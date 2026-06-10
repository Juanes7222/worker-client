"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const LOCAL_APP_DATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const CONFIG_PATH = path.join(os.homedir(), '.lavoz-worker', 'config.json');
const INSTALL_DIR = path.join(LOCAL_APP_DATA, 'LaVozWorker');
const BINS_DIR = path.join(INSTALL_DIR, 'bins');
const SERVICE_EXE = path.join(BINS_DIR, 'WinSW.exe');
const SERVICE_XML = path.join(INSTALL_DIR, 'lavoz-service.xml');
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.ipcMain.handle('load-config', () => {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    }
    catch { }
    return null;
});
electron_1.ipcMain.handle('check-status', () => {
    return new Promise((resolve) => {
        (0, child_process_1.exec)('sc query LaVozWorker', (_, stdout) => {
            if (!stdout) {
                resolve({ installed: false, running: false });
                return;
            }
            resolve({ installed: true, running: stdout.includes('RUNNING') });
        });
    });
});
electron_1.ipcMain.handle('install', async (_event, config) => {
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
        fs.writeFileSync(path.join(INSTALL_DIR, '.env'), buildEnvironmentFileContent(config));
        // 5. Write WinSW service descriptor XML
        fs.writeFileSync(SERVICE_XML, buildServiceXml());
        // 6. Register and start the Windows service via WinSW
        await executeSystemCommand(`"${SERVICE_EXE}" install "${SERVICE_XML}"`);
        await executeSystemCommand(`"${SERVICE_EXE}" start`);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('uninstall', async () => {
    try {
        if (fs.existsSync(SERVICE_EXE)) {
            // Stop may fail if already stopped — ignore that error
            await executeSystemCommand(`"${SERVICE_EXE}" stop`).catch(() => { });
            await executeSystemCommand(`"${SERVICE_EXE}" uninstall`);
        }
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('start-service', () => {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(`"${SERVICE_EXE}" start`, (err) => {
            resolve({ ok: !err, error: err?.message });
        });
    });
});
electron_1.ipcMain.handle('stop-service', () => {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(`"${SERVICE_EXE}" stop`, (err) => {
            resolve({ ok: !err, error: err?.message });
        });
    });
});
electron_1.ipcMain.handle('read-logs', () => {
    const logPath = path.join(INSTALL_DIR, 'logs', 'worker.log');
    try {
        if (!fs.existsSync(logPath))
            return '';
        const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-100).join('\n');
    }
    catch {
        return '';
    }
});
electron_1.ipcMain.handle('close-app', () => electron_1.app.quit());
electron_1.ipcMain.handle('minimize-app', () => mainWindow?.minimize());
// ── Path resolvers ───────────────────────────────────────────────
/**
 * In development: uses worker/dist relative to this file.
 * In packaged .exe: uses the extraResources bundle.
 */
function getWorkerSourcePath() {
    if (electron_1.app.isPackaged) {
        return path.join(process.resourcesPath, 'worker-dist');
    }
    return path.join(__dirname, '..', '..', 'worker', 'dist');
}
/**
 * In development: uses resources/bins relative to the repo root.
 * In packaged .exe: uses the extraResources bundle.
 */
function getBinsSourcePath() {
    if (electron_1.app.isPackaged) {
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
function buildEnvironmentFileContent(config) {
    const nodeBin = path.join(BINS_DIR, 'node.exe');
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
function buildServiceXml() {
    const nodeBin = path.join(BINS_DIR, 'node.exe');
    const scriptPath = path.join(INSTALL_DIR, 'main.js');
    const logsDir = path.join(INSTALL_DIR, 'logs');
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
function ensureDirectoryExists(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
}
function copyDirectoryRecursive(source, destination) {
    if (!fs.existsSync(source)) {
        throw new Error(`Source not found: ${source}`);
    }
    ensureDirectoryExists(destination);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, destinationPath);
        }
        else {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}
function executeSystemCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, options, (error) => {
            if (error) {
                reject(error);
            }
            else {
                resolve();
            }
        });
    });
}
