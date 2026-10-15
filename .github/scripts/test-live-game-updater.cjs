'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { verifyLiveGameUpdater, MAX_WAIT_MS, POLL_MS } = require('./verify-live-game-updater.cjs');
const REPO = 'elmorei/flaghack-infinity-3d';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tips = { main: 'a'.repeat(40), iteration: 'b'.repeat(40) };
function bundle(branch, commit) {
  const files = Object.entries({ 'index.html': '<!doctype html><script type="module" src="./assets/game.js"></script>',
    'assets/game.js': `globalThis.game = ${JSON.stringify(`${branch}-${commit}`)};` }).map(([path, content]) => {
    const bytes = Buffer.from(content);
    return { path, size: bytes.length, sha256: sha256(bytes), data: bytes.toString('base64') };
  });
  const bytes = gzipSync(Buffer.from(JSON.stringify({ schema: 1, runtimeApi: 1, branch, commit, files })));
  return { bytes, manifest: { schema: 1, runtimeApi: 1, branch, commit, size: bytes.length,
    sha256: sha256(bytes), bundle: `game-${branch}-${commit}.json.gz` } };
}
function routes() {
  const map = new Map(), requests = [];
  for (const [branch, commit] of Object.entries(tips)) {
    const item = bundle(branch, commit);
    map.set(`https://api.github.com/repos/${REPO}/commits/${branch}`, { sha: commit });
    map.set(`https://github.com/${REPO}/releases/download/game-${branch}/latest.json`, item.manifest);
    map.set(`https://github.com/${REPO}/releases/download/game-${branch}/${item.manifest.bundle}`, item.bytes);
  }
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.ok(options.signal instanceof AbortSignal);
    const value = map.get(url);
    if (typeof value === 'function') return value();
    if (value === undefined) return new Response('Not found', { status: 404 });
    return new Response(Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  return { map, fetchImpl, requests };
}
async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'game-acceptance-tests-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('production acceptance checks and downloads both branches, inspects cached bytes, restarts offline, rolls back, and cleans up', async t => {
  const ctx = routes(), messages = [], temporaryRoot = await workspace(t);
  const result = await verifyLiveGameUpdater({ fetchImpl: ctx.fetchImpl, temporaryRoot, log: value => messages.push(value),
    timeoutMs: 5000, pollMs: 1 });
  assert.deepEqual(result.branches, tips);
  assert.equal(result.publicHTTP, true);
  assert.equal(result.downloadedAndInspected, true);
  assert.equal(result.cachedOfflinePlay, true);
  assert.equal(result.offlineRollbackSelection, true);
  assert.equal(result.installedWindowsGameplayTested, false);
  assert.equal(ctx.requests.filter(request => request.url.endsWith('.json.gz')).length, 2);
  assert.ok(messages.some(message => message.includes('main: offline rollback')));
  assert.ok(messages.some(message => message.includes('iteration: restart and failed offline')));
  assert.deepEqual(await readdir(temporaryRoot), []);
});

test('missing feed is visibly pending and retried until its matching build appears', async t => {
  const ctx = routes(), messages = [], temporaryRoot = await workspace(t);
  const url = `https://github.com/${REPO}/releases/download/game-main/latest.json`;
  const manifest = ctx.map.get(url);
  let reads = 0;
  ctx.map.set(url, () => ++reads === 1 ? new Response('Pending build', { status: 404 }) : new Response(JSON.stringify(manifest)));
  const result = await verifyLiveGameUpdater({ fetchImpl: ctx.fetchImpl, temporaryRoot, log: value => messages.push(value),
    timeoutMs: 5000, pollMs: 1 });
  assert.deepEqual(result.branches, tips);
  assert.ok(reads >= 2);
  assert.ok(messages.some(message => message.includes('main: pending')));
});

test('stale or corrupt game payload never passes the bounded acceptance gate', async t => {
  const ctx = routes(), temporaryRoot = await workspace(t);
  const url = `https://github.com/${REPO}/releases/download/game-main/game-main-${tips.main}.json.gz`;
  ctx.map.set(url, Buffer.from('corrupt compressed bundle'));
  const messages = [];
  await assert.rejects(verifyLiveGameUpdater({ fetchImpl: ctx.fetchImpl, temporaryRoot,
    log: value => messages.push(value), timeoutMs: 500, pollMs: 1 }), /within 10 minutes/);
  assert.ok(messages.some(message => message.includes('main: error')));
  assert.deepEqual(await readdir(temporaryRoot), []);
});

test('a moved tip is redownloaded and its previous verified cache can be rolled back offline', async t => {
  const ctx = routes(), messages = [], temporaryRoot = await workspace(t);
  const newCommit = 'c'.repeat(40), replacement = bundle('main', newCommit);
  const tipUrl = `https://api.github.com/repos/${REPO}/commits/main`;
  let checks = 0;
  ctx.map.set(tipUrl, () => {
    checks++;
    if (checks >= 3) {
      ctx.map.set(`https://github.com/${REPO}/releases/download/game-main/latest.json`, replacement.manifest);
      ctx.map.set(`https://github.com/${REPO}/releases/download/game-main/${replacement.manifest.bundle}`, replacement.bytes);
      return new Response(JSON.stringify({ sha: newCommit }));
    }
    return new Response(JSON.stringify({ sha: tips.main }));
  });
  const result = await verifyLiveGameUpdater({ fetchImpl: ctx.fetchImpl, temporaryRoot, log: value => messages.push(value),
    timeoutMs: 5000, pollMs: 1 });
  assert.deepEqual(result.branches, { ...tips, main: newCommit });
  assert.ok(messages.some(message => message.includes('tip moved')));
  assert.ok(messages.some(message => message.includes('restores a verified previous cached commit')));
});

test('acceptance budget is bounded at ten minutes and polling is gentle for public API limits', async () => {
  assert.equal(MAX_WAIT_MS, 600000);
  assert.equal(POLL_MS, 30000);
  await assert.rejects(verifyLiveGameUpdater({ timeoutMs: 600001 }), /assertion|expression/i);
});
