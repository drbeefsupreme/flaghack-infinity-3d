'use strict';
const { app, BrowserWindow, ipcMain, dialog, session, Menu } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { createStorageWriter } = require('./storage.cjs');
const storage = createStorageWriter();
const { autoUpdater } = require('electron-updater');
const { createUpdater } = require('./updater.cjs');
const launcherUrl = pathToFileURL(join(__dirname, 'launcher.html')).href;
let launcher, game, host, updater, origin, quitting = false;
let gamePreferences = {}, savedPreferences = '', storagePath;
const gameKeys = ['fh.training.v1', 'fh.settings.v1', 'fh.handle.v1'];

app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = game || launcher; if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start).catch(fatal);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  const active = host;
  host = null;
  const deadline = setTimeout(() => app.exit(0), 3500);
  captureGamePreferences().then(() => Promise.all([active ? active.close() : Promise.resolve(), storage.flush()])).catch(console.error).finally(() => { clearTimeout(deadline); app.quit(); });
});

function fatal(error) {
  console.error(error);
  dialog.showErrorBox('FLAGHACK could not start', 'The local game could not start. No update was installed. Close the app and try again.\n\n' + (error instanceof Error ? error.message : String(error)));
  app.quit();
}
function lockWindow(win, allowed) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => dialog.showErrorBox('FLAGHACK window stopped', 'Close this window and reopen the game. Your installed files have not changed.'));
}
function sameOrigin(url) { try { return new URL(url).origin === origin; } catch { return false; } }
function launcherSender(event) { return launcher && !launcher.isDestroyed() && event.sender === launcher.webContents && event.senderFrame === launcher.webContents.mainFrame && event.senderFrame.url === launcherUrl; }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { if (!launcherSender(event)) throw new Error('Untrusted launcher request'); return fn(...args); }); }

function saveGamePreferences(values) {
  if (!values || typeof values !== 'object') return;
  const clean = {};
  for (const key of gameKeys) if (typeof values[key] === 'string' && values[key].length <= 65536) clean[key] = values[key];
  const serialized = JSON.stringify(clean);
  if (serialized === savedPreferences) return;
  gamePreferences = clean;
  savedPreferences = serialized;
  storage.write(storagePath, clean).catch(error => { if (savedPreferences === serialized) savedPreferences = ''; console.error(error); });
}
async function captureGamePreferences() {
  if (!game || game.isDestroyed()) return;
  try {
    const values = await game.webContents.executeJavaScript('Object.fromEntries(' + JSON.stringify(gameKeys) + '.map(key => [key, localStorage.getItem(key)]))');
    saveGamePreferences(values);
  } catch (error) { console.error('Could not save final game preferences:', error); }
}

async function start() {
  Menu.setApplicationMenu(null);
  storagePath = join(app.getPath('userData'), 'game-preferences.json');
  try { gamePreferences = JSON.parse(await readFile(storagePath, 'utf8')); } catch { gamePreferences = {}; }
  const gameSender = event => game && !game.isDestroyed() && event.sender === game.webContents && event.senderFrame === game.webContents.mainFrame && sameOrigin(event.senderFrame.url);
  ipcMain.on('game:restore', event => { event.returnValue = gameSender(event) ? gamePreferences : {}; });
  ipcMain.on('game:save', (event, values) => {
    if (!gameSender(event) || !values || typeof values !== 'object') return;
    saveGamePreferences(values);
  });
  const prefsPath = join(app.getPath('userData'), 'launcher.json');
  let channel = require('../package.json').desktopChannel || (app.getVersion().includes('-iteration.') ? 'iteration' : 'stable');
  try { const saved = JSON.parse(await readFile(prefsPath, 'utf8')); if (['stable', 'iteration'].includes(saved.channel)) channel = saved.channel; } catch { /* first run or invalid preferences */ }
  updater = createUpdater({ autoUpdater, isPackaged: app.isPackaged, version: app.getVersion(), initialChannel: channel,
    onState: state => { if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:state', state); },
    onChannelChange: value => storage.write(prefsPath, { channel: value }),
  });
  const launcherSession = session.fromPartition('flaghack-launcher');
  launcherSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  launcherSession.setPermissionCheckHandler(() => false);
  const root = pathToFileURL(__dirname + '/').href;
  launcherSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(root) }));
  launcher = new BrowserWindow({ width: 850, height: 610, minWidth: 700, minHeight: 520, show: false, backgroundColor: '#100d19', title: 'FLAGHACK Launcher', icon: join(__dirname, 'icon.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), partition: 'flaghack-launcher', contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false } });
  lockWindow(launcher, url => url === launcherUrl);
  handle('launcher:get', () => updater.getState());
  handle('launcher:channel', value => { if (!['stable', 'iteration'].includes(value)) throw new Error('Unknown channel'); return updater.setChannel(value); });
  handle('launcher:check', () => updater.check());
  handle('launcher:download', () => updater.download());
  handle('launcher:install', async () => {
    if (startingGame || confirmingInstall || (game && !game.isDestroyed())) return { message: 'Close the game before installing an update.' };
    if (!updater.getState().canInstall) throw new Error('No update is ready');
    confirmingInstall = true;
    let choice;
    try { choice = await dialog.showMessageBox(launcher, { type: 'question', buttons: ['Cancel', 'Install and restart'], defaultId: 0, cancelId: 0, title: 'Install FLAGHACK update?', message: 'The launcher will close and run the downloaded Windows installer.', detail: 'Only install updates you intended to download. Save or finish any game first.' }); } finally { confirmingInstall = false; }
    if (choice.response === 1 && !game && !startingGame && !quitting) updater.install();
    return updater.getState();
  });
  handle('launcher:play', async () => { await play(); return { message: 'Game opened. Close its window to return to the launcher.' }; });
  await launcher.loadFile(join(__dirname, 'launcher.html'));
  launcher.show();
}
let startingGame, confirmingInstall = false;
async function play() {
  if (quitting || confirmingInstall || updater.getState().status === 'installing') throw new Error('Wait for the update action to finish before opening the game.');
  if (game && !game.isDestroyed()) { game.show(); game.focus(); return; }
  if (startingGame) return startingGame;
  startingGame = openGame();
  try { await startingGame; } finally { startingGame = null; }
}
async function openGame() {
  if (!host) {
    const { startHost } = await import(pathToFileURL(join(__dirname, '..', 'dist-desktop', 'host.js')).href);
    host = await startHost({ password: randomBytes(24).toString('hex'), port: 0, bind: '127.0.0.1', serverName: 'Local desktop', staticDir: join(__dirname, '..', 'dist') });
    origin = `http://127.0.0.1:${host.port}`;
  }
  const wsOrigin = origin.replace('http:', 'ws:');
  const gameSession = session.fromPartition('persist:flaghack-game');
  gameSession.setPermissionRequestHandler((wc, permission, callback) => callback(!!wc && sameOrigin(wc.getURL()) && ['pointerLock', 'fullscreen'].includes(permission)));
  gameSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => !!wc && sameOrigin(requestingOrigin) && ['pointerLock', 'fullscreen'].includes(permission));
  gameSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    callback({ cancel: url === origin + '/api/info' || !(sameOrigin(url) || url.startsWith(wsOrigin + '/') || url.startsWith('data:') || url.startsWith('blob:')) });
  });
  gameSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': [`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${wsOrigin}; object-src 'none'; frame-src 'none'; base-uri 'none'`],
  } }));
  game = new BrowserWindow({ width: 1440, height: 900, minWidth: 960, minHeight: 600, show: false, backgroundColor: '#100d19', title: 'FLAGHACK ∞', icon: join(__dirname, 'icon.png'), webPreferences: { preload: join(__dirname, 'game-preload.cjs'), partition: 'persist:flaghack-game', contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false } });
  const current = game;
  let closing = false;
  current.on('close', event => {
    if (closing || quitting) return;
    event.preventDefault();
    closing = true;
    const deadline = setTimeout(() => { if (!current.isDestroyed()) current.destroy(); }, 3000);
    captureGamePreferences().then(() => storage.flush()).catch(console.error).finally(() => { clearTimeout(deadline); if (!current.isDestroyed()) current.destroy(); });
  });
  lockWindow(current, sameOrigin);
  current.on('closed', () => { game = null; if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); } });
  try { await current.loadURL(origin + '/'); current.show(); } catch (error) { current.destroy(); throw error; }
}
