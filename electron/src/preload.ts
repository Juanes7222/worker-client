import { contextBridge, ipcRenderer } from 'electron';
import { WorkerConfig, ActionResult, WorkerStatus, InstallDefaults } from './types';

export interface LaVozApi {
  loadDefaults: () => Promise<InstallDefaults>;
  loadConfig:   () => Promise<WorkerConfig | null>;
  checkStatus:  () => Promise<WorkerStatus>;
  install:      (config: WorkerConfig) => Promise<ActionResult>;
  uninstall:    () => Promise<ActionResult>;
  startService: () => Promise<ActionResult>;
  stopService:  () => Promise<ActionResult>;
  readLogs:     () => Promise<string>;
  copyLogs:     () => Promise<string>;
  closeApp:     () => Promise<void>;
  minimizeApp:  () => Promise<void>;
}

const lavozApi: LaVozApi = {
  loadDefaults: () => ipcRenderer.invoke('load-defaults'),
  loadConfig:   () => ipcRenderer.invoke('load-config'),
  checkStatus:  () => ipcRenderer.invoke('check-status'),
  install:      (config) => ipcRenderer.invoke('install', config),
  uninstall:    () => ipcRenderer.invoke('uninstall'),
  startService: () => ipcRenderer.invoke('start-service'),
  stopService:  () => ipcRenderer.invoke('stop-service'),
  readLogs:     () => ipcRenderer.invoke('read-logs'),
  copyLogs:     () => ipcRenderer.invoke('copy-logs'),
  closeApp:     () => ipcRenderer.invoke('close-app'),
  minimizeApp:  () => ipcRenderer.invoke('minimize-app'),
};

contextBridge.exposeInMainWorld('lavoz', lavozApi);

declare global {
  interface Window {
    lavoz: LaVozApi;
  }
}
