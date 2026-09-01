const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const trustedOrigins = new Set([
  'https://www.yourcarguy806.com',
  'https://njz0co209l.execute-api.us-east-1.amazonaws.com',
  'https://cognito-idp.us-east-1.amazonaws.com',
]);

function isTrustedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'file:' || trustedOrigins.has(url.origin);
  } catch {
    return false;
  }
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
    if (url.startsWith('https://')) void shell.openExternal(url);
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
          title: document.title,
          loginText: document.querySelector('.login-panel')?.innerText || ''
        })`);
        const passed = result.desktop
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());