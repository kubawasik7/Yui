const { app, BrowserWindow, dialog, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const APP_NAME = 'Yui';
const DEFAULT_API_PORT = 8080;
const BACKEND_START_TIMEOUT_MS = 60_000;
const CONFIG_TEMPLATE = [
  '# Yui local connection settings. Keep credentials in Windows user environment variables.',
  'DATABASE_URL=jdbc:postgresql://localhost:5432/wordstead',
  'DATABASE_USER=wordstead',
  'GEMINI_MODEL=gemini-3.5-flash-lite',
  '',
  '# Set DATABASE_PASSWORD in your Windows user environment for PostgreSQL.',
  '# GEMINI_API_KEY is optional and should also be set as a Windows user environment variable.',
  ''
].join('\r\n');

app.setName(APP_NAME);
const userDataDirectory = path.join(app.getPath('appData'), APP_NAME);
fs.mkdirSync(userDataDirectory, { recursive: true });
app.setPath('userData', userDataDirectory);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let managedBackend = null;
let apiPort = null;
let appServer = null;
let backendLogStream = null;
let desktopLogPath = null;
let backendLogPath = null;
let shuttingDown = false;

function log(message) {
  const line = `${new Date().toISOString()} ${message}\r\n`;
  try {
    fs.appendFileSync(desktopLogPath, line, 'utf8');
  } catch {
    // Logging must not prevent the app from starting.
  }
}

function ensureUserDirectories() {
  const userData = app.getPath('userData');
  const logsDirectory = path.join(userData, 'logs');
  fs.mkdirSync(logsDirectory, { recursive: true });
  desktopLogPath = path.join(logsDirectory, 'desktop.log');
  backendLogPath = path.join(logsDirectory, 'backend.log');
  const configPath = path.join(userData, 'config.properties');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, CONFIG_TEMPLATE, { encoding: 'utf8', flag: 'wx' });
  }
  return { userData, configPath };
}

function readLocalConfig(configPath) {
  const values = {};
  for (const line of fs.readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function runtimeEnvironment(config, port) {
  return {
    ...process.env,
    SERVER_PORT: String(port),
    SERVER_ADDRESS: '127.0.0.1',
    DATABASE_URL: config.DATABASE_URL || process.env.DATABASE_URL || 'jdbc:postgresql://localhost:5432/wordstead',
    DATABASE_USER: config.DATABASE_USER || process.env.DATABASE_USER || 'wordstead',
    DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GEMINI_MODEL: config.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isYuiBackendReady(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1200 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(response.statusCode === 200 && JSON.parse(body).service === 'yui-api');
        } catch {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function backendCommand(port, config) {
  const env = runtimeEnvironment(config, port);
  if (app.isPackaged) {
    const javaPath = path.join(process.resourcesPath, 'runtime', 'bin', 'java.exe');
    const jarPath = path.join(process.resourcesPath, 'backend', 'yui-api.jar');
    if (!fs.existsSync(javaPath) || !fs.existsSync(jarPath)) {
      throw new Error('The packaged Java runtime or backend JAR is missing. Rebuild the Windows installer.');
    }
    return { command: javaPath, args: ['-jar', jarPath], cwd: app.getPath('userData'), env };
  }

  const repositoryRoot = path.resolve(__dirname, '..');
  const backendDirectory = path.join(repositoryRoot, 'backend');
  const command = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  return {
    command,
    args: ['-f', path.join(backendDirectory, 'pom.xml'), 'spring-boot:run'],
    cwd: backendDirectory,
    env
  };
}

function terminateManagedBackend() {
  const child = managedBackend;
  managedBackend = null;
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function startBackend(config) {
  if (!app.isPackaged && await isYuiBackendReady(DEFAULT_API_PORT)) {
    log(`Using the already running development API on 127.0.0.1:${DEFAULT_API_PORT}.`);
    return DEFAULT_API_PORT;
  }

  const port = app.isPackaged ? await findFreePort() : DEFAULT_API_PORT;
  const launch = backendCommand(port, config);
  backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
  log(`Starting the managed backend on 127.0.0.1:${port}.`);
  managedBackend = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    windowsHide: true,
    shell: process.platform === 'win32' && launch.command.endsWith('.cmd'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  managedBackend.stdout.pipe(backendLogStream);
  managedBackend.stderr.pipe(backendLogStream);

  let exitInfo = null;
  managedBackend.on('error', (error) => {
    exitInfo = `Could not start backend process: ${error.message}`;
  });
  managedBackend.on('exit', (code, signal) => {
    exitInfo = `Backend exited before becoming ready (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`;
  });

  const deadline = Date.now() + BACKEND_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitInfo) throw new Error(`${exitInfo}\nBackend log: ${backendLogPath}`);
    if (await isYuiBackendReady(port)) {
      log(`Backend is ready on 127.0.0.1:${port}.`);
      return port;
    }
    await wait(400);
  }
  throw new Error(`Backend did not become ready within ${BACKEND_START_TIMEOUT_MS / 1000} seconds.\nBackend log: ${backendLogPath}`);
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function sendNotFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

function proxyApiRequest(request, response) {
  const headers = { ...request.headers, host: `127.0.0.1:${apiPort}` };
  delete headers.connection;
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: apiPort,
    path: request.url,
    method: request.method,
    headers
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    delete responseHeaders.connection;
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'The local Yui API is unavailable.' }));
  });
  request.pipe(upstream);
}

function serveFrontend(request, response, frontendRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendNotFound(response);
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    return sendNotFound(response);
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const resolvedRoot = path.resolve(frontendRoot);
  let filePath = path.resolve(resolvedRoot, relativePath);
  if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) return sendNotFound(response);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (pathname.includes('.')) return sendNotFound(response);
    filePath = path.join(resolvedRoot, 'index.html');
  }

  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(filePath).on('error', () => sendNotFound(response)).pipe(response);
}

async function startFrontendServer() {
  const frontendRoot = path.join(process.resourcesPath, 'frontend');
  const server = http.createServer((request, response) => {
    if (request.url === '/api' || request.url.startsWith('/api/')) return proxyApiRequest(request, response);
    serveFrontend(request, response, frontendRoot);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  appServer = server;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the local app address.');
  const url = `http://127.0.0.1:${address.port}`;
  log(`Serving the desktop UI at ${url}.`);
  return url;
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'app.ico') : path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0D0F12',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== new URL(url).origin) event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow.loadURL(url);
}

async function startApplication() {
  const { configPath } = ensureUserDirectories();
  const config = readLocalConfig(configPath);
  apiPort = await startBackend(config);

  if (app.isPackaged) {
    await createMainWindow(await startFrontendServer());
    return;
  }

  const developmentUrl = process.env.YUI_DESKTOP_DEV_URL || 'http://127.0.0.1:4200';
  await createMainWindow(developmentUrl);
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startApplication).catch((error) => {
    log(`Startup failed: ${error.stack || error.message || error}`);
    dialog.showErrorBox('Yui could not start', `${error.message || error}\n\nConfiguration: ${path.join(app.getPath('userData'), 'config.properties')}\nLogs: ${path.join(app.getPath('userData'), 'logs')}`);
    app.quit();
  });

  app.on('before-quit', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (appServer) appServer.close();
    terminateManagedBackend();
    backendLogStream?.end();
    log('Application is shutting down.');
  });

  app.on('window-all-closed', () => app.quit());
}
