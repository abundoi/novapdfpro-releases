const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');
const { LicenseManager } = require('./licenseManager.cjs');

function loadMainBuildConfig() {
  try {
    const cfgPath = path.join(__dirname, 'build-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {
    // Ignore optional config
  }
  return {};
}

const MAIN_BUILD_CONFIG = loadMainBuildConfig();
const IS_PRODUCTION_RELEASE = MAIN_BUILD_CONFIG.productionRelease === true;
const IS_E2E_TEST = !IS_PRODUCTION_RELEASE && process.env.NOVAPDFPRO_E2E_TEST === '1';

let mainWindow = null;
let pendingOpenPdfPath = null;

function isSafePdfPath(targetPath) {
  try {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const resolved = path.resolve(targetPath);
    if (path.extname(resolved).toLowerCase() !== '.pdf') return false;
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

function readPdfPayload(filePath) {
  if (!isSafePdfPath(filePath)) return null;
  const resolved = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(resolved);
  const stats = fs.statSync(resolved);
  return {
    filePath: resolved,
    name: path.basename(resolved),
    size: stats.size,
    lastModified: stats.mtimeMs,
    data: fileBuffer,
  };
}

function extractPdfArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = String(argv[i] || '').replace(/^"|"$/g, '').trim();
    if (!arg || arg.startsWith('-')) continue;
    if (isSafePdfPath(arg)) return path.resolve(arg);
  }
  return null;
}

pendingOpenPdfPath = extractPdfArg(process.argv);

if (!IS_E2E_TEST) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, commandLine) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      const pdfArg = extractPdfArg(commandLine);
      if (pdfArg && mainWindow && !mainWindow.isDestroyed()) {
        const payload = readPdfPayload(pdfArg);
        if (payload) {
          mainWindow.webContents.send('app:open-pdf-file', payload);
        }
      }
    });
  }
}

// Determine storage paths (standard or portable)
const isPortable = process.env.PORTABLE_EXECUTABLE_DIR || fs.existsSync(path.join(__dirname, '../portable.flag'));
const baseStorageDir = isPortable
  ? path.join(__dirname, '../data')
  : path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'NovaPDFPro');

const paths = {
  documents: path.join(baseStorageDir, 'documents'),
  backups: path.join(baseStorageDir, 'backups'),
  thumbnails: path.join(baseStorageDir, 'thumbnails'),
  temp: path.join(baseStorageDir, 'temp'),
  logs: path.join(baseStorageDir, 'logs'),
};

const licenseManager = new LicenseManager(baseStorageDir, app.getVersion());

// Ensure directories exist
Object.values(paths).forEach((p) => {
  try {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch (e) {
    console.error('Failed to create directory:', p, e);
  }
});

function createWindow() {
  const iconCandidate = path.join(__dirname, '../NovaPDFPro.ico');
  const fallbackIconCandidate = path.join(__dirname, '../installer/NovaPDFPro.ico');
  const windowIcon = fs.existsSync(iconCandidate)
    ? iconCandidate
    : fs.existsSync(fallbackIconCandidate)
    ? fallbackIconCandidate
    : undefined;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'NovaPDFPro — Offline Desktop Edition',
    icon: windowIcon,
    backgroundColor: '#090d16',
    frame: false, // Custom sleek titlebar
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      devTools: IS_E2E_TEST || process.env.NODE_ENV === 'development',
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  const allowedPortalOrigin = 'https://novapdf.appmys.com';
  const isAllowedExternalUrl = (targetUrl) => {
    if (typeof targetUrl !== 'string') return false;
    if (targetUrl === 'ms-settings:defaultapps' || targetUrl.startsWith('ms-settings:defaultapps?')) {
      return true;
    }
    try {
      const parsed = new URL(targetUrl);
      if (parsed.origin === allowedPortalOrigin && parsed.protocol === 'https:') return true;
      if (
        (IS_E2E_TEST || process.env.NODE_ENV === 'development') &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Load from dev server or production dist
  const isDev = process.env.NODE_ENV === 'development' && !IS_PRODUCTION_RELEASE;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const distPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distPath)) {
      mainWindow.loadFile(distPath);
    } else {
      mainWindow.loadURL('http://localhost:5173');
    }
  }

  // Block navigation and redirects outside app bundle, disallow webviews
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const allowedLocal =
      navUrl.startsWith('file://') ||
      (isDev && process.env.VITE_DEV_SERVER_URL && navUrl.startsWith(process.env.VITE_DEV_SERVER_URL));
    if (!allowedLocal) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-redirect', (event, redirectUrl) => {
    const allowedLocal =
      redirectUrl.startsWith('file://') ||
      (isDev && process.env.VITE_DEV_SERVER_URL && redirectUrl.startsWith(process.env.VITE_DEV_SERVER_URL));
    if (!allowedLocal) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Handle external links safely with strict allowlist
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
  });
}

// Window control handlers
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// File dialog handlers
ipcMain.handle('dialog:open-pdf', async (event, targetPath) => {
  let filePath = targetPath;
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open PDF Document',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    filePath = result.filePaths[0];
  }

  return readPdfPayload(filePath);
});

ipcMain.handle('app:consume-initial-pdf', async () => {
  if (!pendingOpenPdfPath) return null;
  const target = pendingOpenPdfPath;
  pendingOpenPdfPath = null;
  return readPdfPayload(target);
});

ipcMain.handle('dialog:open-multiple-pdfs', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF Documents to Merge',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  return result.filePaths.map((fp) => readPdfPayload(fp)).filter(Boolean);
});

ipcMain.handle('dialog:save-pdf', async (event, { defaultName, data }) => {
  try {
    if (licenseManager.getStatus().tier === 'FREE') {
      return { success: false, error: 'Pro license or active trial required to save edited PDFs.' };
    }
    const safeName = path.basename(String(defaultName || 'Document_Edited.pdf').replace(/[<>:"/\\|?*]/g, '_'));
    const normalizedDefault = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Updated PDF Document',
      defaultPath: normalizedDefault,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });

    if (result.canceled || !result.filePath) return null;

    let targetPath = result.filePath;
    if (path.extname(targetPath).toLowerCase() !== '.pdf') {
      targetPath += '.pdf';
    }
    const tempPath = `${targetPath}.tmp.${Date.now()}`;
    const buffer = Buffer.from(data);

    // Safe atomic save
    fs.writeFileSync(tempPath, buffer);
    if (fs.existsSync(targetPath)) {
      try {
        const backupPath = path.join(paths.backups, `${path.basename(targetPath)}.bak.${Date.now()}`);
        fs.copyFileSync(targetPath, backupPath);
      } catch {
        // Ignore backup error if directory restricted
      }
    }
    fs.renameSync(tempPath, targetPath);

    return { success: true, filePath: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Storage and file system operations
ipcMain.handle('fs:save-backup', async (event, { name, data }) => {
  try {
    const filename = `${name.replace(/\.[^/.]+$/, '')}_bak_${Date.now()}.pdf`;
    const fullPath = path.join(paths.backups, filename);
    fs.writeFileSync(fullPath, Buffer.from(data));
    return { success: true, path: fullPath, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:list-backups', async () => {
  try {
    const files = fs.readdirSync(paths.backups);
    return files.map((f) => {
      const p = path.join(paths.backups, f);
      const s = fs.statSync(p);
      return { filename: f, path: p, size: s.size, mtime: s.mtimeMs };
    });
  } catch {
    return [];
  }
});

ipcMain.handle('fs:get-app-info', async () => {
  return {
    isPortable,
    baseStorageDir,
    paths,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
});

ipcMain.handle('fs:check-file', async (event, targetPath) => {
  try {
    return { exists: isSafePdfPath(targetPath), filePath: String(targetPath || '') };
  } catch {
    return { exists: false, filePath: String(targetPath || '') };
  }
});

ipcMain.on('app:is-test-mode', (event) => {
  event.returnValue = IS_E2E_TEST;
});

// Offline & Online Licensing IPC Handlers
ipcMain.handle('license:get-status', async () => {
  return licenseManager.getStatus();
});

ipcMain.handle('license:activate', async (event, { licenseKey, portalUrl }) => {
  try {
    return await licenseManager.activateKey(licenseKey, portalUrl);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('license:import-offline', async (event, { token }) => {
  try {
    return licenseManager.importOfflineToken(token);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('license:refresh', async (event, { portalUrl } = {}) => {
  try {
    return await licenseManager.refresh(portalUrl);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('license:deactivate', async (event, { portalUrl } = {}) => {
  try {
    return await licenseManager.deactivate(portalUrl);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('license:sync-trial', async (event, { portalUrl } = {}) => {
  try {
    return await licenseManager.syncTrialWithServer(portalUrl);
  } catch (err) {
    return { success: false, offline: true, error: err.message };
  }
});

ipcMain.handle('license:set-mode', async (event, mode) => {
  if (!IS_E2E_TEST) {
    return licenseManager.getStatus();
  }
  return licenseManager.setModeForTesting(mode);
});

ipcMain.handle('app:open-external', async (event, targetUrl) => {
  if (typeof targetUrl !== 'string') return false;
  if (targetUrl === 'ms-settings:defaultapps' || targetUrl.startsWith('ms-settings:defaultapps?')) {
    await shell.openExternal(targetUrl);
    return true;
  }
  try {
    const parsed = new URL(targetUrl);
    if (
      (parsed.protocol === 'https:' && (parsed.origin === 'https://novapdf.appmys.com' || parsed.origin === 'https://ollama.com')) ||
      (IS_E2E_TEST && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    ) {
      await shell.openExternal(targetUrl);
      return true;
    }
  } catch {
    // Reject invalid URLs
  }
  return false;
});

// Windows File Associations: Right-Click "Open with NovaPDFPro" & Default PDF Reader
function resolveLauncherInfo() {
  const rootDir = path.resolve(__dirname, '..');
  const nativeExe = path.join(rootDir, 'NovaPDFPro.exe');
  const icoA = path.join(rootDir, 'NovaPDFPro.ico');
  const icoB = path.join(rootDir, 'installer', 'NovaPDFPro.ico');
  const iconPath = fs.existsSync(icoA) ? icoA : fs.existsSync(icoB) ? icoB : nativeExe;
  if (fs.existsSync(nativeExe)) {
    return {
      exePath: nativeExe,
      iconPath,
      command: `"${nativeExe}" "%1"`,
    };
  }
  return {
    exePath: process.execPath,
    iconPath,
    command: `"${process.execPath}" "${rootDir}" "%1"`,
  };
}

function queryRegValue(keyPath, valueName) {
  try {
    const args = valueName ? ['query', keyPath, '/v', valueName] : ['query', keyPath, '/ve'];
    const out = execFileSync('reg.exe', args, { encoding: 'utf8', timeout: 1500, windowsHide: true });
    const re = new RegExp(`${valueName ? valueName : '\\(Default\\)'}\\s+REG_\\w+\\s+([^\\r\\n]+)`, 'i');
    const match = out.match(re);
    return match && match[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function keyExistsReg(keyPath) {
  try {
    execFileSync('reg.exe', ['query', keyPath], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function setRegValue(keyPath, valueName, type, value) {
  const args = valueName
    ? ['add', keyPath, '/v', valueName, '/t', type, '/d', value, '/f']
    : ['add', keyPath, '/ve', '/t', type, '/d', value, '/f'];
  execFileSync('reg.exe', args, { stdio: 'ignore', timeout: 1500, windowsHide: true });
}

function notifyShellAssociationsChanged() {
  try {
    const psScript =
      "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, uint uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);'; [Win32.NativeMethods]::SHChangeNotify(0x08000000, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero)";
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', b64], {
      windowsHide: true,
    });
  } catch {
    // Non-fatal
  }
}

function registerWindowsPdfAssociations() {
  if (process.platform !== 'win32') return { success: false, error: 'Windows only' };
  const { exePath, iconPath, command } = resolveLauncherInfo();
  const iconValue = iconPath.toLowerCase().endsWith('.ico') ? iconPath : `${iconPath},0`;

  // 1. Custom ProgID
  setRegValue('HKCU\\Software\\Classes\\NovaPDFPro.PDF', null, 'REG_SZ', 'NovaPDFPro PDF Document');
  setRegValue('HKCU\\Software\\Classes\\NovaPDFPro.PDF', 'FriendlyTypeName', 'REG_SZ', 'PDF Document');
  setRegValue('HKCU\\Software\\Classes\\NovaPDFPro.PDF\\DefaultIcon', null, 'REG_SZ', iconValue);
  setRegValue('HKCU\\Software\\Classes\\NovaPDFPro.PDF\\shell\\open', null, 'REG_SZ', 'Open with NovaPDFPro');
  setRegValue('HKCU\\Software\\Classes\\NovaPDFPro.PDF\\shell\\open\\command', null, 'REG_SZ', command);

  // 2. Windows Explorer "Open with" menu & direct right-click PDF verb
  setRegValue('HKCU\\Software\\Classes\\.pdf\\OpenWithProgids', 'NovaPDFPro.PDF', 'REG_SZ', '');
  setRegValue('HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\NovaPDFPro', null, 'REG_SZ', 'Open with NovaPDFPro');
  setRegValue('HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\NovaPDFPro', 'Icon', 'REG_SZ', iconValue);
  setRegValue('HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\NovaPDFPro\\command', null, 'REG_SZ', command);

  // 3. RegisteredApplications & Capabilities for Windows Settings -> Default Apps
  const appExeName = path.basename(exePath);
  setRegValue(`HKCU\\Software\\Classes\\Applications\\${appExeName}`, 'FriendlyAppName', 'REG_SZ', 'NovaPDFPro');
  setRegValue(`HKCU\\Software\\Classes\\Applications\\${appExeName}\\SupportedTypes`, '.pdf', 'REG_SZ', '');
  setRegValue(`HKCU\\Software\\Classes\\Applications\\${appExeName}\\shell\\open\\command`, null, 'REG_SZ', command);

  setRegValue('HKCU\\Software\\NovaPDFPro\\Capabilities', 'ApplicationName', 'REG_SZ', 'NovaPDFPro');
  setRegValue(
    'HKCU\\Software\\NovaPDFPro\\Capabilities',
    'ApplicationDescription',
    'REG_SZ',
    'Enterprise-Grade Offline PDF Reader & Editor'
  );
  setRegValue('HKCU\\Software\\NovaPDFPro\\Capabilities\\FileAssociations', '.pdf', 'REG_SZ', 'NovaPDFPro.PDF');
  setRegValue('HKCU\\Software\\RegisteredApplications', 'NovaPDFPro', 'REG_SZ', 'Software\\NovaPDFPro\\Capabilities');

  notifyShellAssociationsChanged();
  return { success: true, exePath };
}

function getWindowsPdfAssociationStatus() {
  if (process.platform !== 'win32') {
    return { supported: false, isRegisteredOpenWith: false, isDefaultReader: false, currentProgId: '' };
  }
  const userChoiceProgId =
    queryRegValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice', 'ProgId') || '';
  const hkcuDotPdf = queryRegValue('HKCU\\Software\\Classes\\.pdf', null) || '';
  const currentProgId = userChoiceProgId || hkcuDotPdf;
  const isDefaultReader = currentProgId.toLowerCase() === 'novapdfpro.pdf';
  const isRegisteredOpenWith =
    keyExistsReg('HKCU\\Software\\Classes\\NovaPDFPro.PDF') &&
    keyExistsReg('HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\NovaPDFPro');
  return {
    supported: true,
    isRegisteredOpenWith,
    isDefaultReader,
    currentProgId,
    exePath: resolveLauncherInfo().exePath,
  };
}

ipcMain.handle('os:get-pdf-association-status', async () => {
  return getWindowsPdfAssociationStatus();
});

ipcMain.handle('os:register-open-with', async () => {
  try {
    const regRes = registerWindowsPdfAssociations();
    return { ...regRes, status: getWindowsPdfAssociationStatus() };
  } catch (err) {
    return { success: false, error: err.message, status: getWindowsPdfAssociationStatus() };
  }
});

ipcMain.handle('os:set-default-pdf-reader', async () => {
  try {
    registerWindowsPdfAssociations();
    setRegValue('HKCU\\Software\\Classes\\.pdf', null, 'REG_SZ', 'NovaPDFPro.PDF');
    notifyShellAssociationsChanged();

    const status = getWindowsPdfAssociationStatus();
    let openedWindowsSettings = false;
    if (!status.isDefaultReader) {
      // Windows 10/11 protects UserChoice with a per-user hash; guide user to Default Apps in 1 click
      await shell.openExternal('ms-settings:defaultapps');
      openedWindowsSettings = true;
    }
    return { success: true, openedWindowsSettings, status };
  } catch (err) {
    return { success: false, error: err.message, status: getWindowsPdfAssociationStatus() };
  }
});

// Ollama Local AI integration (100% offline, strictly localhost-only SSRF guard)
function validateLocalOllamaUrl(rawEndpoint, apiPath) {
  const url = new URL(apiPath, rawEndpoint || 'http://localhost:11434');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Blocked unsupported Ollama protocol');
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Local AI endpoint must point to localhost / 127.0.0.1');
  }
  return url;
}

ipcMain.handle('ollama:check-status', async (event, endpoint = 'http://localhost:11434') => {
  return new Promise((resolve) => {
    try {
      const url = validateLocalOllamaUrl(endpoint, '/api/tags');
      const startTime = Date.now();
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const data = JSON.parse(body);
            const models = (data.models || []).map((m) => (typeof m === 'string' ? m : m.name));
            resolve({
              available: true,
              models,
              latencyMs,
              endpoint: url.origin,
              version: data.version || 'Ollama Local Daemon',
            });
          } catch {
            resolve({
              available: true,
              models: [],
              latencyMs,
              endpoint: url.origin,
              warning: 'Local AI server reached, but returned non-JSON response.',
            });
          }
        });
      });
      req.on('error', (err) => {
        resolve({
          available: false,
          models: [],
          endpoint: String(endpoint),
          error: `Could not connect to ${endpoint} (${err.code || err.message}). Please ensure Ollama is installed and running.`,
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({
          available: false,
          models: [],
          endpoint: String(endpoint),
          error: `Connection to ${endpoint} timed out.`,
        });
      });
    } catch (err) {
      resolve({
        available: false,
        models: [],
        endpoint: String(endpoint),
        error: err.message,
      });
    }
  });
});

ipcMain.handle('ollama:generate', async (event, { endpoint = 'http://localhost:11434', model, prompt, systemPrompt }) => {
  return new Promise((resolve) => {
    try {
      if (typeof prompt !== 'string' || prompt.length > 250000) {
        return resolve({ success: false, error: 'Prompt must be text within 250,000 characters.' });
      }
      if (systemPrompt && (typeof systemPrompt !== 'string' || systemPrompt.length > 50000)) {
        return resolve({ success: false, error: 'System prompt exceeds maximum allowed size.' });
      }

      const payload = JSON.stringify({
        model: model || 'llama3',
        prompt,
        system: systemPrompt,
        stream: false,
      });

      const url = validateLocalOllamaUrl(endpoint, '/api/generate');
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 60000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode >= 400 || parsed.error) {
                resolve({ success: false, error: parsed.error || `Local AI server error (HTTP ${res.statusCode})` });
              } else {
                resolve({ success: true, response: parsed.response });
              }
            } catch (err) {
              resolve({ success: false, error: 'Failed to parse AI response: ' + err.message });
            }
          });
        }
      );

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Local AI inference timed out after 60 seconds.' });
      });

      req.write(payload);
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

app.whenReady().then(() => {
  // 1. Strict zero-trust permission handlers
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (typeof session.defaultSession.setDevicePermissionHandler === 'function') {
    session.defaultSession.setDevicePermissionHandler(() => false);
  }
  if (typeof session.defaultSession.setBluetoothPairingHandler === 'function') {
    session.defaultSession.setBluetoothPairingHandler(() => false);
  }

  // 2. Strict Content Security Policy (CSP) & security headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob: file: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none';"
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
      },
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
