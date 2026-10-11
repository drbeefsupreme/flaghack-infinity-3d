'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('./updater.cjs');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = [];
    this.autoInstallEvent = 'onQuit';
    this.checkAction = async () => this.emit('update-not-available', { version: '1.0.0' });
    this.downloadAction = async () => this.emit('update-downloaded', { version: '1.1.0' });
  }
  set channel(value) { this.selectedChannel = value; this.allowDowngrade = true; }
  get channel() { return this.selectedChannel; }
  setFeedURL(value) { this.feed = value; }
  async checkForUpdates() { this.checkCalls += 1; return this.checkAction(); }
  async downloadUpdate() { this.downloadCalls += 1; return this.downloadAction(); }
  quitAndInstall(...args) { this.installCalls.push(args); }
}

function setup(overrides = {}) {
  const autoUpdater = new FakeUpdater();
  const states = [];
  const channels = [];
  const updater = createUpdater({
    autoUpdater, isPackaged: true, version: '1.0.0',
    onState: (state) => states.push(state),
    onChannelChange: (channel) => channels.push(channel),
    ...overrides,
  });
  return { autoUpdater, updater, states, channels };
}

async function offerUpdate(context, version = '1.1.0') {
  context.autoUpdater.checkAction = async () => context.autoUpdater.emit('update-available', { version });
  await context.updater.check();
}

test('creation is offline and disables automatic download, install and downgrade', () => {
  const { autoUpdater, updater } = setup();
  assert.equal(updater.getState().status, 'idle');
  assert.equal(autoUpdater.checkCalls, 0);
  assert.equal(autoUpdater.downloadCalls, 0);
  assert.deepEqual(autoUpdater.installCalls, []);
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(autoUpdater.disableWebInstaller, true);
  assert.equal(autoUpdater.autoInstallEvent, 'manual');
  assert.equal(autoUpdater.allowDowngrade, false);
  assert.equal(autoUpdater.allowPrerelease, false);
  assert.equal(autoUpdater.channel, 'latest');
  assert.deepEqual(autoUpdater.feed, {
    provider: 'generic',
    url: 'https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-stable/',
    channel: 'latest',
  });
});

test('development builds stay playable without invoking updater operations', async () => {
  const { autoUpdater, updater } = setup({ isPackaged: false });
  assert.equal(updater.getState().status, 'unavailable');
  await updater.check();
  await updater.download();
  assert.equal(updater.install(), false);
  assert.equal(autoUpdater.checkCalls, 0);
  assert.equal(autoUpdater.downloadCalls, 0);
  assert.equal(updater.setChannel('iteration').status, 'unavailable');
});

test('missing updater dependency is nonfatal', async () => {
  const { updater } = setup({ autoUpdater: null });
  assert.equal((await updater.check()).status, 'unavailable');
  assert.equal(updater.install(), false);
});

test('offline checks redact raw errors and can be retried explicitly', async () => {
  const context = setup();
  context.autoUpdater.checkAction = async () => {
    const error = new Error('https://user:secret@example.com C:\\Users\\Private ENOTFOUND');
    context.autoUpdater.emit('error', error);
    throw error;
  };
  const failed = await context.updater.check();
  assert.equal(failed.status, 'error');
  assert.match(failed.message, /keep playing/);
  assert.doesNotMatch(JSON.stringify(context.states), /secret|example\.com|Private|ENOTFOUND/);
  assert.equal(failed.canInstall, false);
  context.autoUpdater.checkAction = async () => context.autoUpdater.emit('update-not-available');
  assert.equal((await context.updater.check()).status, 'current');
});

test('checking exposes a current result without downloading', async () => {
  const { updater, autoUpdater, states } = setup();
  assert.equal((await updater.check()).status, 'current');
  assert.equal(autoUpdater.checkCalls, 1);
  assert.equal(autoUpdater.downloadCalls, 0);
  assert.ok(states.some((state) => state.status === 'checking'));
});

test('update requires explicit download and explicit install after completion', async () => {
  const context = setup();
  assert.equal(context.updater.install(), false);
  await offerUpdate(context);
  assert.equal(context.updater.getState().status, 'available');
  assert.equal(context.autoUpdater.downloadCalls, 0);
  assert.equal(context.updater.install(), false);
  assert.equal((await context.updater.download()).status, 'downloaded');
  assert.equal(context.updater.getState().canInstall, true);
  assert.deepEqual(context.autoUpdater.installCalls, []);
  assert.equal(context.updater.install(), true);
  assert.deepEqual(context.autoUpdater.installCalls, [[false, true]]);
  assert.equal(context.updater.getState().status, 'installing');
  assert.equal(context.updater.getState().canInstall, false);
  assert.equal(context.updater.install(), false);
});

test('progress is finite, clamped, serializable and ignored outside downloads', async () => {
  const context = setup();
  context.autoUpdater.emit('download-progress', { percent: 90 });
  assert.equal(context.updater.getState().progress, 0);
  await offerUpdate(context);
  context.autoUpdater.downloadAction = async () => {
    for (const percent of [12.5, NaN, Infinity, -7, 112]) {
      context.autoUpdater.emit('download-progress', { percent, transferred: 'private' });
    }
    context.autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  };
  await context.updater.download();
  const downloading = context.states.filter((state) => state.status === 'downloading');
  assert.deepEqual(downloading.map((state) => state.progress), [0, 12.5, 12.5, 12.5, 0, 100]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.updater.getState())), context.updater.getState());
});

test('channels use fixed feeds and restore the no-downgrade policy after the setter', async () => {
  const { updater, autoUpdater, channels } = setup();
  assert.equal(updater.setChannel('iteration').channel, 'iteration');
  assert.equal(autoUpdater.channel, 'iteration');
  assert.equal(autoUpdater.allowPrerelease, true);
  assert.equal(autoUpdater.allowDowngrade, false);
  assert.equal(autoUpdater.feed.url, 'https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-iteration/');
  assert.equal(autoUpdater.feed.channel, 'iteration');
  await updater.check();
  assert.equal(autoUpdater.allowDowngrade, false);
  updater.setChannel('stable');
  assert.equal(autoUpdater.channel, 'latest');
  assert.equal(autoUpdater.allowPrerelease, false);
  assert.equal(autoUpdater.allowDowngrade, false);
  assert.deepEqual(channels, ['iteration', 'stable']);
  assert.throws(() => updater.setChannel('https://attacker.invalid/'), /stable or iteration/);
});

test('an offered update is invalidated when switching channels', async () => {
  const context = setup();
  await offerUpdate(context);
  context.updater.setChannel('iteration');
  assert.equal(context.updater.getState().status, 'idle');
  assert.equal(context.updater.getState().availableVersion, null);
  await context.updater.download();
  assert.equal(context.autoUpdater.downloadCalls, 0);
});

test('a partial feed-configuration failure cannot enable downgrades', async () => {
  const context = setup();
  const setFeedURL = context.autoUpdater.setFeedURL;
  context.autoUpdater.setFeedURL = () => { throw new Error('private feed failure'); };
  assert.throws(() => context.updater.setChannel('iteration'), /could not be changed/);
  assert.equal(context.autoUpdater.allowDowngrade, false);
  assert.equal(context.updater.getState().channel, 'stable');
  assert.equal(context.updater.getState().status, 'error');
  assert.doesNotMatch(JSON.stringify(context.states), /private feed failure/);
  context.autoUpdater.setFeedURL = setFeedURL;
  assert.equal((await context.updater.check()).status, 'current');
  assert.equal(context.autoUpdater.channel, 'latest');
  assert.equal(context.autoUpdater.allowDowngrade, false);
});

test('channel changes and repeated actions are blocked during checking and downloading', async () => {
  const context = setup();
  let resolveCheck;
  context.autoUpdater.checkAction = () => new Promise((resolve) => { resolveCheck = resolve; });
  const checking = context.updater.check();
  assert.throws(() => context.updater.setChannel('iteration'), /before changing channels/);
  await context.updater.check();
  assert.equal(context.autoUpdater.checkCalls, 1);
  context.autoUpdater.emit('update-available', { version: '1.1.0' });
  assert.throws(() => context.updater.setChannel('iteration'), /before changing channels/);
  resolveCheck();
  await checking;
  let resolveDownload;
  context.autoUpdater.downloadAction = () => new Promise((resolve) => { resolveDownload = resolve; });
  const downloading = context.updater.download();
  assert.throws(() => context.updater.setChannel('iteration'), /before changing channels/);
  await context.updater.download();
  await context.updater.check();
  assert.equal(context.autoUpdater.downloadCalls, 1);
  assert.equal(context.autoUpdater.checkCalls, 1);
  context.autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(context.updater.install(), false);
  resolveDownload();
  await downloading;
  assert.throws(() => context.updater.setChannel('iteration'), /before changing channels/);
  await context.updater.check();
  assert.equal(context.autoUpdater.checkCalls, 1);
});

test('failed downloads cannot install and do not expose credentials', async () => {
  const context = setup();
  await offerUpdate(context);
  context.autoUpdater.downloadAction = async () => { throw new Error('secret download token'); };
  assert.equal((await context.updater.download()).status, 'error');
  assert.equal(context.updater.install(), false);
  assert.doesNotMatch(JSON.stringify(context.states), /secret/);
  assert.equal(context.updater.setChannel('iteration').status, 'idle');
});

test('mismatched or unsolicited download completion never enables install', async () => {
  const context = setup();
  context.autoUpdater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(context.updater.install(), false);
  await offerUpdate(context);
  context.autoUpdater.downloadAction = async () => context.autoUpdater.emit('update-downloaded', { version: '2.0.0' });
  assert.equal((await context.updater.download()).status, 'error');
  assert.equal(context.updater.install(), false);
});

test('install startup failures are reported without claiming rollback', async () => {
  const context = setup();
  await offerUpdate(context);
  await context.updater.download();
  context.autoUpdater.quitAndInstall = () => { throw new Error('C:\\Users\\Private'); };
  assert.equal(context.updater.install(), false);
  assert.equal(context.updater.getState().status, 'error');
  assert.match(context.updater.getState().message, /installer could not be started/);
  assert.doesNotMatch(context.updater.getState().message, /Private|rollback|restored/);
});

test('invalid release metadata and silent checks fail safely', async () => {
  const context = setup({ initialChannel: '__proto__' });
  assert.equal(context.updater.getState().channel, 'stable');
  await offerUpdate(context, 'https://user:secret@example.com');
  assert.equal(context.updater.getState().status, 'error');
  assert.doesNotMatch(JSON.stringify(context.states), /secret/);
  context.autoUpdater.checkAction = async () => null;
  assert.equal((await context.updater.check()).status, 'error');
});

test('returned snapshots cannot mutate internal state and subscriber failures stay isolated', async () => {
  const { updater } = setup({ onState: () => { throw new Error('window closed'); } });
  const snapshot = updater.getState();
  snapshot.status = 'downloaded';
  snapshot.canInstall = true;
  assert.equal(updater.install(), false);
  assert.equal((await updater.check()).status, 'current');
});

test('async channel-preference persistence failures are caught and safe to show', async () => {
  const { updater } = setup({ onChannelChange: async () => { throw new Error('private user path'); } });
  updater.setChannel('iteration');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.getState().channel, 'iteration');
  assert.match(updater.getState().message, /preference could not be saved/);
  assert.doesNotMatch(updater.getState().message, /private user path/);
  assert.equal((await updater.check()).status, 'current');
});
