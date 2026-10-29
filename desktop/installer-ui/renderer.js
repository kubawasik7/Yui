const $ = (id) => document.getElementById(id);
const pathInput = $('install-path');
const validationText = $('validation');
const installButton = $('install');
let launchPath = null;
let validateTimer;
let installInfo;

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${name}-view`));
}

function setValidation(message = '') {
  validationText.textContent = message;
  installButton.disabled = Boolean(message) || !installInfo?.hasEngine;
}

async function validatePath() {
  window.clearTimeout(validateTimer);
  validateTimer = window.setTimeout(async () => {
    const result = await window.yuiSetup.validate(pathInput.value.trim());
    setValidation(result.valid ? '' : result.message);
  }, 180);
}

window.yuiSetup.getInfo().then((info) => {
  installInfo = info;
  $('version').textContent = `YUI DESKTOP  /  VERSION ${info.version}`;
  $('size-note').textContent = `APP SIZE  ${info.installedSize}`;
  pathInput.value = info.installPath;
  if (!info.hasEngine) setValidation('The installer package is incomplete. Rebuild or download Yui Setup again.');
  else validatePath();
});

window.yuiSetup.onState((state) => {
  if (state.state === 'installing') {
    $('install-status').textContent = state.message;
    showView('installing');
  } else if (state.state === 'complete') {
    $('complete-message').textContent = state.message;
    showView('complete');
  } else if (state.state === 'error') {
    $('error-message').textContent = state.message;
    showView('error');
  }
});

pathInput.addEventListener('input', validatePath);
$('browse').addEventListener('click', async () => {
  const chosen = await window.yuiSetup.chooseFolder();
  if (!chosen) return;
  pathInput.value = chosen;
  await validatePath();
});

installButton.addEventListener('click', async () => {
  installButton.disabled = true;
  const result = await window.yuiSetup.install({
    path: pathInput.value.trim(),
    createDesktopShortcut: $('desktop-shortcut').checked
  });
  if (result.ok) launchPath = result.executable;
  else {
    $('error-message').textContent = result.message;
    showView('error');
  }
});

$('launch').addEventListener('click', async () => {
  const result = await window.yuiSetup.launch(launchPath);
  if (!result.ok) $('complete-message').textContent = result.message;
});
$('finish').addEventListener('click', () => window.yuiSetup.close());
$('retry').addEventListener('click', () => { showView('welcome'); validatePath(); });
$('error-close').addEventListener('click', () => window.yuiSetup.close());
$('minimize').addEventListener('click', () => window.yuiSetup.minimize());
$('close').addEventListener('click', () => window.yuiSetup.close());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.yuiSetup.close();
});
