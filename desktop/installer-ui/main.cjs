const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const PRODUCT = 'Yui';
const INSTALL_ROOT = path.join(app.getPath('localAppData'), 'Programs', PRODUCT);
const PAYLOAD_ROOT = path.join(process.resourcesPath, 'payload');
let windowRef;
let installInProgress = false;
let installedExecutable;
let manifest = { version: '1.0.0', installedBytes: 0 };

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.ceil(bytes / (1024 ** 2))} MB`;
}

function readManifest() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(PAYLOAD_ROOT, 'installer-manifest.json'), 'utf8'));
    if (typeof value.version === 'string' && Number.isFinite(value.installedBytes)) manifest = value;
  } catch {
    // A missing manifest is reported by the installation readiness check.
  }
}

function send(channel, value) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send(channel, value);
}

function findExistingDirectory(target) {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function validateTarget(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || target.length > 240) {
    return { valid: false, message: 'Choose a valid absolute Windows folder path.' };
  }
  const destination = path.resolve(target);
  if (destination === path.parse(destination).root) return { valid: false, message: 'Choose a folder below the drive root.' };

  const enginePath = path.join(PAYLOAD_ROOT, 'Yui Install Engine.exe');
  if (!fs.existsSync(enginePath)) return { valid: false, message: 'The installation package is incomplete. Download or rebuild the Yui installer.' };

  if (fs.existsSync(destination)) {
    let stat;
    try { stat = fs.statSync(destination); } catch { return { valid: false, message: 'Yui cannot access this folder.' }; }
    if (!stat.isDirectory()) return { valid: false, message: 'The selected installation path must be a folder.' };
    const entries = fs.readdirSync(destination);
    const isYui = fs.existsSync(path.join(destination, 'Yui.exe')) && fs.existsSync(path.join(destination, 'resources', 'app.asar'));
    if (entries.length && !isYui) return { valid: false, message: 'This folder is not empty and does not contain an existing Yui installation.' };
  }

  const parent = findExistingDirectory(destination);
  if (!parent) return { valid: false, message: 'The selected drive or parent folder does not exist.' };
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    const probe = path.join(parent, `.yui-write-check-${process.pid}`);
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
  } catch {
    return { valid: false, message: 'Yui cannot write to this location. Choose a folder you can access.' };
  }

  try {
    const drive = fs.statfsSync(parent);
    const available = drive.bavail * drive.bsize;
    const minimum = Math.max(512 * 1024 * 1024, manifest.installedBytes + 256 * 1024 * 1024);
    if (available < minimum) return { valid: false, message: `There is not enough free space. Free at least ${formatBytes(minimum)} on this drive.` };
    const temporaryRoot = findExistingDirectory(app.getPath('temp'));
    if (temporaryRoot) {
      const tempDrive = fs.statfsSync(temporaryRoot);
      const tempAvailable = tempDrive.bavail * tempDrive.bsize;
      if (tempAvailable < minimum) return { valid: false, message: `The temporary drive needs at least ${formatBytes(minimum)} free while Yui is being installed.` };
    }
  } catch {
    // Some Windows filesystems do not expose free-space information.
  }
  return { valid: true, path: destination };
}

function isYuiRunning() {
  try {
    const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Yui.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    return result.status === 0 && /^"Yui\.exe"/im.test(result.stdout || '');
  } catch {
    return false;
  }
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1120,
    height: 660,
    minWidth: 900,
    minHeight: 530,
    resizable: true,
    frame: false,
    show: false,
    backgroundColor: '#0d0f12',
    title: 'Yui Setup',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'installer-ui', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('file://')) event.preventDefault();
  });
  windowRef.once('ready-to-show', () => windowRef.show());
  windowRef.on('close', (event) => { if (installInProgress) event.preventDefault(); });
  windowRef.on('closed', () => { windowRef = null; });
  windowRef.loadFile(path.join(app.getAppPath(), 'installer-ui', 'index.html'));
}

ipcMain.handle('setup:info', () => ({
  name: PRODUCT,
  version: manifest.version,
  installPath: INSTALL_ROOT,
  installedSize: manifest.installedBytes ? formatBytes(manifest.installedBytes) : '—',
  hasEngine: fs.existsSync(path.join(PAYLOAD_ROOT, 'Yui Install Engine.exe'))
}));

ipcMain.handle('setup:choose-folder', async () => {
  const result = await dialog.showOpenDialog(windowRef, {
    title: 'Choose where to install Yui',
    defaultPath: INSTALL_ROOT,
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('setup:validate', (_event, target) => validateTarget(target));
ipcMain.handle('setup:minimize', () => windowRef?.minimize());
ipcMain.handle('setup:close', () => { if (!installInProgress) app.quit(); });

ipcMain.handle('setup:install', async (_event, options) => {
  if (installInProgress) return { ok: false, message: 'An installation is already running.' };
  const validation = validateTarget(options?.path);
  if (!validation.valid) return { ok: false, message: validation.message };
  if (isYuiRunning()) return { ok: false, message: 'Close Yui before installing or updating it, then try again.' };

  installInProgress = true;
  send('setup:state', { state: 'installing', message: 'Preparing the Yui installation…' });
  const enginePath = path.join(PAYLOAD_ROOT, 'Yui Install Engine.exe');
  const result = await new Promise((resolve) => {
    let started = false;
    const child = spawn(enginePath, ['/S', `/D=${validation.path}`], {
      cwd: PAYLOAD_ROOT,
      env: { ...process.env, YUI_CREATE_DESKTOP_SHORTCUT: options.createDesktopShortcut ? '1' : '0' },
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('spawn', () => {
      started = true;
      send('setup:state', { state: 'installing', message: 'Copying Yui files and registering the app…' });
    });
    child.once('error', (error) => resolve({ ok: false, message: `Could not start the installer: ${error.message}` }));
    child.once('exit', (code, signal) => {
      if (!started) return resolve({ ok: false, message: 'The Yui installer could not be started.' });
      const executable = path.join(validation.path, 'Yui.exe');
      const archive = path.join(validation.path, 'resources', 'app.asar');
      if (code === 0 && fs.existsSync(executable) && fs.existsSync(archive)) resolve({ ok: true, path: validation.path, executable });
      else resolve({ ok: false, message: `Installation did not complete (installer exit code ${code ?? signal ?? 'unknown'}). Your existing Yui data was left untouched.` });
    });
  });

  installInProgress = false;
  if (result.ok) installedExecutable = result.executable;
  send('setup:state', result.ok
    ? { state: 'complete', message: 'Yui is installed and ready.' }
    : { state: 'error', message: result.message });
  return result;
});

ipcMain.handle('setup:launch', async (_event, executable) => {
  if (typeof executable !== 'string' || !installedExecutable || path.resolve(executable) !== path.resolve(installedExecutable) || !fs.existsSync(installedExecutable)) {
    return { ok: false, message: 'The Yui app could not be found at the installation path.' };
  }
  const error = await shell.openPath(installedExecutable);
  if (error) return { ok: false, message: error };
  app.quit();
  return { ok: true };
});

app.whenReady().then(() => { readManifest(); createWindow(); });
app.on('window-all-closed', () => app.quit());
