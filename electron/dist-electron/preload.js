"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const lavozApi = {
    loadConfig: () => electron_1.ipcRenderer.invoke('load-config'),
    checkStatus: () => electron_1.ipcRenderer.invoke('check-status'),
    install: (config) => electron_1.ipcRenderer.invoke('install', config),
    uninstall: () => electron_1.ipcRenderer.invoke('uninstall'),
    startService: () => electron_1.ipcRenderer.invoke('start-service'),
    stopService: () => electron_1.ipcRenderer.invoke('stop-service'),
    readLogs: () => electron_1.ipcRenderer.invoke('read-logs'),
    closeApp: () => electron_1.ipcRenderer.invoke('close-app'),
    minimizeApp: () => electron_1.ipcRenderer.invoke('minimize-app'),
};
electron_1.contextBridge.exposeInMainWorld('lavoz', lavozApi);
