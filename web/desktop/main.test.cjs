'use strict';

// Main-process integration with mocked Electron APIs. These tests verify wiring,
// not Chromium rendering or actual Windows installation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

function event() { return { prevented: false, preventDefault() { this.prevented = true; } }; }
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Mocked main process did not reach the expected state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function loadMain(t) {
  const userData = await mkdtemp(join(tmpdir(), 'flaghack-main-test-'));
  t.after(() => rm(userData, { recursive: true, force: true }));
  const windows = [];
  const handlers = new Map();
  const sessions = new Map();
  const hostCalls = [];
  let hostCloseCalls = 0;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true, didEnableSandbox: false, finalQuits: 0,
    enableSandbox() { this.didEnableSandbox = true; },
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    getVersion: () => '1.0.0',
    getPath: () => userData,
    exit() { this.finalQuits += 1; },
    quit() { const quitting = event(); this.emit('before-quit', quitting); if (!quitting.prevented) this.finalQuits += 1; },
  });
  class MockWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.shown = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: '' }, sent: [],
        getURL: () => this.webContents.mainFrame.url,
        setWindowOpenHandler: (callback) => { this.webContents.openWindow = callback; },
        send: (...args) => this.webContents.sent.push(args),
        executeJavaScript: async () => this.preferences || {},
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show() { this.shown = true; }
    focus() { this.focused = true; }
    async loadFile(path) { this.webContents.mainFrame.url = pathToFileURL(path).href; }
    async loadURL(url) { this.webContents.mainFrame.url = url; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const session = {
    fromPartition(name) {
      if (!sessions.has(name)) {
        const current = {
          setPermissionRequestHandler(fn) { this.permissionRequest = fn; },
          setPermissionCheckHandler(fn) { this.permissionCheck = fn; },
          webRequest: {
            onBeforeRequest(fn) { this.beforeRequest = fn; },
            onHeadersReceived(fn) { this.headersReceived = fn; },
          },
        };
        sessions.set(name, current);
      }
      return sessions.get(name);
    },
  };
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const dialog = {
    response: 0, confirmations: [], errors: [],
    showErrorBox(...args) { this.errors.push(args); },
    async showMessageBox(_parent, options) { this.confirmations.push(options); return { response: this.response }; },
  };
  const autoUpdater = new EventEmitter();
  Object.assign(autoUpdater, {
    checkCalls: 0, downloadCalls: 0, installCalls: [],
    setFeedURL(options) { this.feed = options; },
    async checkForUpdates() { this.checkCalls += 1; this.emit('update-available', { version: '1.1.0' }); },
    async downloadUpdate() { this.downloadCalls += 1; this.emit('update-downloaded', { version: '1.1.0' }); },
    quitAndInstall(...args) { this.installCalls.push(args); },
  });
  const electron = { app, BrowserWindow: MockWindow, ipcMain, dialog, session, Menu: { setApplicationMenu() {} } };
  let source = await readFile(join(__dirname, 'main.cjs'), 'utf8');
  // Substitute only the ESM host-loading boundary; all other main code executes
  // unchanged. Keep the production packaged path assertion explicit.
  const hostImport = "await import(pathToFileURL(join(__dirname, '..', 'dist-desktop', 'host.js')).href)";
  assert.ok(source.includes(hostImport));
  source = source.replace(hostImport, "require('test:host')");
  const context = {
    __dirname, console, URL, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'electron-updater') return { autoUpdater };
      if (name === 'test:host') return { startHost: async (options) => { hostCalls.push(options); return { port: 49321, close: async () => { hostCloseCalls += 1; } }; } };
      if (name === '../package.json') return { desktopChannel: 'stable' };
      return require(name);
    },
  };
  vm.runInNewContext(source, context, { filename: join(__dirname, 'main.cjs') });
  await until(() => windows.length > 0 && windows[0].shown);
  const launcher = windows[0];
  const sender = () => ({ sender: launcher.webContents, senderFrame: launcher.webContents.mainFrame });
  const invoke = (name, ...args) => handlers.get(name)(sender(), ...args);
  return { app, windows, launcher, handlers, sessions, ipcMain, dialog, autoUpdater, hostCalls, getHostCloseCalls: () => hostCloseCalls, userData, invoke, sender };
}

test('launcher starts sandboxed, local-only and with explicit-action IPC', async (t) => {
  const context = await loadMain(t);
  assert.equal(context.app.didEnableSandbox, true);
  const prefs = context.launcher.options.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(basename(prefs.preload), 'preload.cjs');
  assert.equal(context.autoUpdater.checkCalls, 0);
  assert.equal(context.invoke('launcher:get').channel, 'stable');
  assert.equal(context.launcher.webContents.openWindow({ url: 'https://example.invalid' }).action, 'deny');
  const navigation = event();
  context.launcher.webContents.emit('will-navigate', navigation, 'https://example.invalid');
  assert.equal(navigation.prevented, true);
  const local = context.sessions.get('flaghack-launcher');
  assert.equal(local.permissionCheck(), false);
  let result;
  local.webRequest.beforeRequest({ url: 'https://example.invalid/script.js' }, (value) => { result = value; });
  assert.equal(result.cancel, true);
  local.webRequest.beforeRequest({ url: pathToFileURL(join(__dirname, 'launcher.js')).href }, (value) => { result = value; });
  assert.equal(result.cancel, false);
});

test('launcher IPC rejects other renderers, child frames and unexpected documents', async (t) => {
  const context = await loadMain(t);
  const handler = context.handlers.get('launcher:check');
  assert.throws(() => handler({ sender: {}, senderFrame: context.launcher.webContents.mainFrame }), /Untrusted/);
  assert.throws(() => handler({ sender: context.launcher.webContents, senderFrame: { url: context.launcher.webContents.mainFrame.url } }), /Untrusted/);
  const original = context.launcher.webContents.mainFrame.url;
  context.launcher.webContents.mainFrame.url = pathToFileURL(join(__dirname, 'other.html')).href;
  assert.throws(() => handler(context.sender()), /Untrusted/);
  context.launcher.webContents.mainFrame.url = original;
  assert.equal(context.autoUpdater.checkCalls, 0);
});

test('Play starts one loopback host, restricts game requests and returns to launcher after saving', async (t) => {
  const context = await loadMain(t);
  await Promise.all([context.invoke('launcher:play'), context.invoke('launcher:play')]);
  assert.equal(context.hostCalls.length, 1);
  assert.equal(context.hostCalls[0].bind, '127.0.0.1');
  assert.equal(context.hostCalls[0].port, 0);
  assert.match(context.hostCalls[0].password, /^[a-f0-9]{48}$/);
  assert.equal(basename(context.hostCalls[0].staticDir), 'dist');
  assert.equal(context.windows.length, 2);
  const game = context.windows[1];
  assert.equal(game.options.webPreferences.nodeIntegration, false);
  assert.equal(game.options.webPreferences.contextIsolation, true);
  assert.equal(game.options.webPreferences.sandbox, true);
  const current = context.sessions.get('persist:flaghack-game');
  for (const [url, allowed] of [
    ['http://127.0.0.1:49321/assets/main.js', true],
    ['http://127.0.0.1:49321/api/info', false],
    ['http://127.0.0.1:49322/assets/main.js', false],
    ['https://example.invalid/script.js', false],
    ['file:///etc/passwd', false],
  ]) {
    let result;
    current.webRequest.beforeRequest({ url }, (value) => { result = value; });
    assert.equal(result.cancel, !allowed);
  }
  assert.equal(current.permissionCheck(game.webContents, 'media', 'http://127.0.0.1:49321'), false);
  assert.equal(current.permissionCheck(game.webContents, 'pointerLock', 'http://127.0.0.1:49321'), true);
  assert.equal(current.permissionCheck(game.webContents, 'pointerLock', 'https://example.invalid'), false);
  game.preferences = { 'fh.settings.v1': '{"volume":0.4}', 'fh.training.v1': '{"seals":["arrival"]}', unknown: 'ignored' };
  const closing = event();
  game.emit('close', closing);
  assert.equal(closing.prevented, true);
  await until(() => game.isDestroyed());
  const saved = JSON.parse(await readFile(join(context.userData, 'game-preferences.json'), 'utf8'));
  assert.deepEqual(saved, { 'fh.settings.v1': '{"volume":0.4}', 'fh.training.v1': '{"seals":["arrival"]}' });
  assert.equal(context.launcher.focused, true);
});

test('native install confirmation defaults to Cancel and only confirmation invokes installer', async (t) => {
  const context = await loadMain(t);
  await context.invoke('launcher:check');
  await context.invoke('launcher:download');
  assert.deepEqual(context.autoUpdater.installCalls, []);
  await context.invoke('launcher:install');
  assert.deepEqual(context.autoUpdater.installCalls, []);
  assert.equal(context.dialog.confirmations[0].defaultId, 0);
  assert.equal(context.dialog.confirmations[0].cancelId, 0);
  context.dialog.response = 1;
  await context.invoke('launcher:install');
  assert.deepEqual(context.autoUpdater.installCalls, [[false, true]]);
});

test('quit snapshots game settings, flushes storage and closes the host once', async (t) => {
  const context = await loadMain(t);
  await context.invoke('launcher:play');
  context.windows[1].preferences = { 'fh.handle.v1': 'Fixture Player' };
  context.app.quit();
  await until(() => context.app.finalQuits === 1);
  assert.equal(context.getHostCloseCalls(), 1);
  assert.deepEqual(JSON.parse(await readFile(join(context.userData, 'game-preferences.json'), 'utf8')), { 'fh.handle.v1': 'Fixture Player' });
  // Session callbacks may still receive requests while windows are closing.
  const current = context.sessions.get('persist:flaghack-game');
  assert.doesNotThrow(() => current.webRequest.beforeRequest({ url: 'https://example.invalid/' }, () => {}));
  assert.doesNotThrow(() => current.webRequest.headersReceived({ responseHeaders: {} }, () => {}));
});

test('Play and duplicate install requests cannot race an open native confirmation', async (t) => {
  const context = await loadMain(t);
  await context.invoke('launcher:check');
  await context.invoke('launcher:download');
  let resolveConfirmation;
  let confirmations = 0;
  context.dialog.showMessageBox = () => {
    confirmations += 1;
    return new Promise((resolve) => { resolveConfirmation = resolve; });
  };
  const pendingInstall = context.invoke('launcher:install');
  await assert.rejects(context.invoke('launcher:play'), /update action/);
  await context.invoke('launcher:install');
  assert.equal(confirmations, 1);
  assert.equal(context.hostCalls.length, 0);
  assert.equal(context.windows.length, 1);
  resolveConfirmation({ response: 0 });
  await pendingInstall;
  assert.deepEqual(context.autoUpdater.installCalls, []);
  await context.invoke('launcher:play');
  assert.equal(context.hostCalls.length, 1);
});
