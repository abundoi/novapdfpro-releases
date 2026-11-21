const { contextBridge, ipcRenderer } = require('electron');

const isTestMode = ipcRenderer.sendSync('app:is-test-mode') === true;

contextBridge.exposeInMainWorld('electronAPI', {
  isTestMode,

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized-change', (_, val) => callback(val));
  },

  // Native File Dialogs & Explorer File Opening
  openPdfDialog: (filePath) => ipcRenderer.invoke('dialog:open-pdf', filePath),
  consumeInitialPdf: () => ipcRenderer.invoke('app:consume-initial-pdf'),
  onOpenPdfFile: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:open-pdf-file', listener);
    return () => ipcRenderer.removeListener('app:open-pdf-file', listener);
  },
  openMultiplePdfsDialog: () => ipcRenderer.invoke('dialog:open-multiple-pdfs'),
  savePdfDialog: (options) => ipcRenderer.invoke('dialog:save-pdf', options),

  // File System & Backups
  saveBackup: (options) => ipcRenderer.invoke('fs:save-backup', options),
  listBackups: () => ipcRenderer.invoke('fs:list-backups'),
  getAppInfo: () => ipcRenderer.invoke('fs:get-app-info'),
  checkFileExists: (filePath) => ipcRenderer.invoke('fs:check-file', filePath),

  // Windows File Associations ("Open with" & Default PDF Reader)
  getPdfAssociationStatus: () => ipcRenderer.invoke('os:get-pdf-association-status'),
  registerOpenWith: () => ipcRenderer.invoke('os:register-open-with'),
  setDefaultPdfReader: () => ipcRenderer.invoke('os:set-default-pdf-reader'),

  // Local Ollama AI
  checkOllama: (endpoint) => ipcRenderer.invoke('ollama:check-status', endpoint),
  generateOllama: (payload) => ipcRenderer.invoke('ollama:generate', payload),

  // Subscription & Offline Licensing
  licenseGetStatus: () => ipcRenderer.invoke('license:get-status'),
  licenseActivate: (payload) => ipcRenderer.invoke('license:activate', payload),
  licenseImportOffline: (payload) => ipcRenderer.invoke('license:import-offline', payload),
  licenseRefresh: (payload) => ipcRenderer.invoke('license:refresh', payload),
  licenseDeactivate: (payload) => ipcRenderer.invoke('license:deactivate', payload),
  licenseSyncTrial: (payload) => ipcRenderer.invoke('license:sync-trial', payload),
  ...(isTestMode
    ? { licenseSetMode: (mode) => ipcRenderer.invoke('license:set-mode', mode) }
    : {}),
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external', url),
});
