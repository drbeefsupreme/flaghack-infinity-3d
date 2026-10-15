'use strict';

// Real electron-updater protocol/version/checksum tests against a local HTTP
// fixture. No Electron windows, GitHub traffic, executable launch or publication.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { mkdtemp, writeFile, mkdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { NsisUpdater } = require('electron-updater');
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor');
const { configureRequestUrl, configureRequestOptions } = require('builder-util-runtime');
const { createUpdater } = require('./updater.cjs');

const PREFIX = '/elmorei/flaghack-infinity-3d/releases/download/';
const PAYLOAD = Buffer.from('Inert fixture bytes, not a Windows executable.\n'.repeat(8192));
const CHECKSUM = createHash('sha512').update(PAYLOAD).digest('base64');

// Preserve the adapter's actual fixed feed paths while routing only those known
// public hosts into this test server. Any unexpected host fails the test locally.
class FixtureExecutor extends NodeHttpExecutor {
  constructor(port) { super(); this.port = port; }
  createRequest(options, callback) {
    assert.equal(options.hostname, 'github.com');
    assert.ok(options.path.startsWith(PREFIX));
    return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port: this.port, agent: false }, callback);
  }
  download(url, destination, options) {
    return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      const requestOptions = { headers: options.headers || undefined };
      configureRequestUrl(url, requestOptions);
      configureRequestOptions(requestOptions);
      this.doDownload(requestOptions, {
        destination, options, onCancel, responseHandler: null,
        callback: (error) => error ? reject(error) : resolve(destination),
      }, 0);
    });
  }
}

async function fixture(t, { version = '1.0.0', offered = '1.1.0', corrupt = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flaghack-updater-test-'));
  const userDataPath = join(root, 'user');
  await mkdir(userDataPath);
  const appUpdateConfigPath = join(root, 'app-update.yml');
  await writeFile(appUpdateConfigPath, 'provider: generic\nurl: https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-stable/\nupdaterCacheDirName: fixture-cache\n');
  const requests = [];
  let status = 200;
  let offeredVersion = offered;
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://fixture.invalid').pathname;
    requests.push(path);
    if (status !== 200) { res.writeHead(status).end('Fixture is unavailable'); return; }
    if (/\/(latest|iteration)\.yml$/.test(path)) {
      // JSON is a YAML subset and is parsed by the real generic provider.
      res.setHeader('Content-Type', 'application/yaml');
      res.end(JSON.stringify({ version: offeredVersion, files: [{ url: `Flaghack-Setup-${offeredVersion}-x64.exe`, sha512: corrupt ? createHash('sha512').update('wrong').digest('base64') : CHECKSUM, size: PAYLOAD.length }], path: `Flaghack-Setup-${offeredVersion}-x64.exe`, sha512: CHECKSUM, releaseDate: '2026-10-11T00:00:00.000Z' }));
    } else if (path.endsWith('.exe')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': PAYLOAD.length });
      res.end(PAYLOAD);
    } else res.writeHead(404).end('Unknown fixture route');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const quitHandlers = [];
  const app = {
    version, name: 'flaghack-updater-fixture', isPackaged: true,
    appUpdateConfigPath, userDataPath, baseCachePath: root,
    whenReady: async () => {},
    quit: () => assert.fail('An update check/download must not quit the app'),
    relaunch: () => assert.fail('An update check/download must not relaunch the app'),
    onQuit: (callback) => quitHandlers.push(callback),
  };
  const autoUpdater = new NsisUpdater(null, app);
  autoUpdater.httpExecutor = new FixtureExecutor(server.address().port);
  autoUpdater._testOnlyOptions = { platform: 'win32', isUseDifferentialDownload: false };
  autoUpdater.logger = null;
  const states = [];
  const updater = createUpdater({ autoUpdater, isPackaged: true, version, onState: (state) => states.push(state) });
  return { updater, autoUpdater, requests, states, quitHandlers, setStatus: (value) => { status = value; }, setVersion: (value) => { offeredVersion = value; } };
}

test('real NSIS updater reads latest.yml and downloads/verifies a full package only on request', async (t) => {
  const context = await fixture(t);
  assert.deepEqual(context.requests, []);
  assert.equal((await context.updater.check()).status, 'available');
  assert.deepEqual(context.requests, [`${PREFIX}desktop-stable/latest.yml`]);
  assert.equal((await context.updater.download()).status, 'downloaded');
  assert.equal(context.updater.getState().canInstall, true);
  assert.ok(context.requests.includes(`${PREFIX}desktop-stable/Flaghack-Setup-1.1.0-x64.exe`));
  assert.deepEqual(await readFile(context.autoUpdater.installerPath), PAYLOAD);
  assert.deepEqual(context.quitHandlers, []);
  assert.equal(context.autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(context.autoUpdater.allowDowngrade, false);
});

test('real semantic-version checks reject downgrade even after channel switches', async (t) => {
  const context = await fixture(t, { version: '2.0.0-iteration.3', offered: '1.9.0' });
  assert.equal((await context.updater.check()).status, 'current');
  context.updater.setChannel('iteration');
  assert.equal((await context.updater.check()).status, 'current');
  assert.equal(context.requests.at(-1), `${PREFIX}desktop-iteration/iteration.yml`);
  context.setVersion('2.0.0-iteration.3');
  assert.equal((await context.updater.check()).status, 'current');
  context.setVersion('2.0.0-iteration.4');
  assert.equal((await context.updater.check()).status, 'available');
  assert.equal(context.updater.getState().availableVersion, '2.0.0-iteration.4');
  assert.equal(context.autoUpdater.allowDowngrade, false);
  assert.ok(context.requests.every((path) => path.endsWith('.yml')));
});

test('real updater rejects checksum-corrupt downloads and cannot install them', async (t) => {
  const context = await fixture(t, { corrupt: true });
  assert.equal((await context.updater.check()).status, 'available');
  assert.equal((await context.updater.download()).status, 'error');
  assert.equal(context.updater.getState().canInstall, false);
  assert.equal(context.updater.install(), false);
  assert.equal(context.autoUpdater.installerPath, null);
  assert.deepEqual(context.quitHandlers, []);
});

test('real provider handles unavailable/missing feeds and recovers on an explicit retry', async (t) => {
  const context = await fixture(t);
  context.setStatus(503);
  assert.equal((await context.updater.check()).status, 'error');
  context.setStatus(404);
  assert.equal((await context.updater.check()).status, 'error');
  assert.doesNotMatch(JSON.stringify(context.states), /github\.com|Fixture is unavailable|ERR_UPDATER/);
  context.setStatus(200);
  assert.equal((await context.updater.check()).status, 'available');
  assert.deepEqual(context.quitHandlers, []);
});
