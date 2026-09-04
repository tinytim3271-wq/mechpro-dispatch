const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const diagnostics = require('./diagnostics-bridge');

const trustedOrigins = new Set([
  'https://www.yourcarguy806.com',
  'https://yourcarguy806.com',
  'https://njz0co209l.execute-api.us-east-1.amazonaws.com',
  'https://cognito-idp.us-east-1.amazonaws.com',
]);

function isAppFileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'file:') return false;
    const appRoot = path.resolve(__dirname, '..');
    const target = path.normalize(decodeURIComponent(url.pathname));
    return target === path.join(appRoot, 'index.html') || target.startsWith(appRoot + path.sep);
  } catch {
    return false;
  }
}

function isTrustedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return isAppFileUrl(rawUrl);
    return trustedOrigins.has(url.origin);
  } catch {
    return false;
  }
}

function isTrustedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && trustedOrigins.has(url.origin);
  } catch {
    return false;
  }
}

function registerDiagnosticsIpc() {
  const handlers = {
    'diagnostics:listAdapters': () => diagnostics.listAdapters(),
    'diagnostics:connect': (_e, params) => diagnostics.connect(params),
    'diagnostics:disconnect': () => diagnostics.disconnect(),
    'diagnostics:getConnectionStatus': () => diagnostics.getConnectionStatus(),
    'diagnostics:readVin': () => diagnostics.readVin(),
    'diagnostics:identifyEcus': () => diagnostics.identifyEcus(),
    'diagnostics:readDtcs': () => diagnostics.readDtcs(),
    'diagnostics:clearDtcs': () => diagnostics.clearDtcs(),
    'diagnostics:startLiveLog': () => diagnostics.startLiveLog(),
    'diagnostics:stopLiveLog': () => diagnostics.stopLiveLog(),
    'diagnostics:pollLiveLog': (_e, since) => diagnostics.pollLiveLog(since),
    'diagnostics:identifyVehicle': () => diagnostics.identifyVehicle(),
  };
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return { ok: true, result: await handler(event, ...args) };
      } catch (error) {
        return { ok: false, error: error.message || 'Diagnostic operation failed' };
      }
    });
  });
}
function createWindow() {
  const smokeTest = process.argv.includes('--smoke-test');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#18252b',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  if (smokeTest) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`({
          desktop: Boolean(window.mechproDesktop),
          diagnostics: Boolean(window.mechproDiagnostics),
          title: document.title,
          loginText: document.querySelector('.login-panel')?.innerText || ''
        })`);
        const passed = result.desktop
          && result.diagnostics
          && result.title.includes('MechPro')
          && result.loginText.includes('active subscription');
        console.log(JSON.stringify({ smokeTest: passed ? 'passed' : 'failed', ...result }));
        app.exit(passed ? 0 : 1);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  }
  window.once('ready-to-show', () => window.show());
  void window.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  registerDiagnosticsIpc();
  if (process.platform === 'win32' || process.env.MECHPRO_START_J2534 === '1') {
    diagnostics.ensureHost().catch((error) => {
      console.error('[j2534] failed to start host:', error.message);
    });
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => diagnostics.stopHost());
app.on('window-all-closed', () => app.quit());
