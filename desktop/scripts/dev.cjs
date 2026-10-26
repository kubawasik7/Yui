const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(desktopRoot, '..', 'frontend');
const angularCli = path.join(frontendRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const frontend = spawn(process.execPath, [angularCli, 'serve', '--host', '127.0.0.1'], {
  cwd: frontendRoot,
  stdio: 'inherit',
  windowsHide: true
});

let electron = null;
let stopping = false;

function stopTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stopTree(electron);
  stopTree(frontend);
  process.exitCode = exitCode;
}

function frontendIsReady() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:4200', (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(700, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function launchElectronWhenReady() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !stopping) {
    if (frontend.exitCode !== null) throw new Error('Angular dev server exited before becoming ready.');
    if (await frontendIsReady()) {
      const electronBinary = require('electron');
      electron = spawn(electronBinary, ['.'], {
        cwd: desktopRoot,
        env: { ...process.env, YUI_DESKTOP_DEV_URL: 'http://127.0.0.1:4200' },
        stdio: 'inherit',
        windowsHide: true
      });
      electron.once('error', (error) => {
        console.error(`Could not start Electron: ${error.message}`);
        stop(1);
      });
      electron.once('exit', (code) => stop(code ?? 0));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('Angular dev server did not become ready within 90 seconds.');
}

frontend.once('error', (error) => {
  console.error(`Could not start Angular CLI: ${error.message}`);
  stop(1);
});
frontend.once('exit', (code) => {
  if (!stopping) stop(code ?? 1);
});
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

launchElectronWhenReady().catch((error) => {
  console.error(error.message);
  stop(1);
});
