'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { createGameUpdater, validateManifest, requestBytes } = require('./game-updater.cjs');

const REPO = 'elmorei/flaghack-infinity-3d';
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);
const BUNDLED_COMMIT = 'd'.repeat(40);
const tipUrl = branch => `https://api.github.com/repos/${REPO}/commits/${branch}`;
const feedUrl = branch => `https://github.com/${REPO}/releases/download/game-${branch}/`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(branch = 'iteration', commit = COMMIT_A, { omitScript = false } = {}) {
  const contents = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./assets/main.js"></script></body></html>',
    'assets/main.js': `globalThis.fixtureGame = ${JSON.stringify(`${branch}-${commit}`)};`,
  };
  if (omitScript) delete contents['assets/main.js'];
  const files = Object.entries(contents).map(([path, content]) => {
    const data = Buffer.from(content);
    return { path, size: data.length, sha256: sha256(data), data: data.toString('base64') };
  });
  const bytes = gzipSync(Buffer.from(JSON.stringify({ schema: 1, runtimeApi: 1, branch, commit, files })));
  const manifest = { schema: 1, runtimeApi: 1, branch, commit, sha256: sha256(bytes), size: bytes.length, bundle: `game-${branch}-${commit}.json.gz` };
  return { bytes, manifest };
}

async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flaghack-game-updater-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheRoot = join(root, 'cache');
  const bundledDir = join(root, 'bundled');
  await mkdir(join(bundledDir, 'assets'), { recursive: true });
  await writeFile(join(bundledDir, 'index.html'), '<!doctype html><script src="./assets/main.js"></script>');
  await writeFile(join(bundledDir, 'assets/main.js'), 'globalThis.bundledFixture = true;');
  const routes = new Map();
  const calls = [];
  const states = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    const route = routes.get(url);
    if (route instanceof Error) throw route;
    if (typeof route === 'function') return route(url, options);
    if (route === undefined) return new Response('Not found', { status: 404 });
    if (route instanceof Response) return route.clone();
    return new Response(Buffer.isBuffer(route) ? route : JSON.stringify(route));
  };
  const options = { cacheRoot, bundledDir, bundledBranch: 'iteration', bundledCommit: BUNDLED_COMMIT, onState: state => states.push(state), fetchImpl, ...overrides };
  const updater = createGameUpdater(options);
  await updater.initialize();
  function publish(bundle) {
    const { branch, commit, bundle: filename } = bundle.manifest;
    routes.set(tipUrl(branch), { sha: commit });
    routes.set(feedUrl(branch) + 'latest.json', bundle.manifest);
    routes.set(feedUrl(branch) + filename, bundle.bytes);
  }
  async function install(bundle) {
    publish(bundle);
    assert.equal((await updater.check()).status, 'available');
    const result = await updater.download();
    assert.equal(result.status, 'ready');
    return result;
  }
  return { root, cacheRoot, bundledDir, routes, calls, states, options, updater, publish, install };
}

test('requestBytes follows only trusted HTTPS redirects and reports bounded progress', async () => {
  const calls = [];
  const progress = [];
  const bytes = await requestBytes(feedUrl('main') + 'start', {
    maxBytes: 5,
    onProgress: value => progress.push(value),
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/build.json.gz' } });
      return new Response('hello', { headers: { 'content-length': '5' } });
    },
  });
  assert.equal(bytes.toString(), 'hello');
  assert.equal(calls.length, 2);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every(value => value >= 0 && value <= 100));
});

test('requestBytes rejects untrusted destinations before requesting them', async t => {
  for (const url of ['http://github.com/file', 'https://attacker.example/file', 'https://github.com.attacker.example/file', 'https://user:secret@github.com/file', 'https://github.com:444/file', 'https://github.com/attacker/repository/file', 'https://api.github.com/repos/attacker/repository/commits/main', 'https://github.com/' + REPO + '-other/file', 'https://release-assets.githubusercontent.com/file', 'https://objects.githubusercontent.com/file']) {
    await t.test(url.replace('user:secret@', ''), async () => {
      let requested = false;
      await assert.rejects(requestBytes(url, { fetchImpl: async () => { requested = true; return new Response('unsafe'); } }), /Untrusted update URL/);
      assert.equal(requested, false);
    });
  }
  let requests = 0;
  await assert.rejects(requestBytes(feedUrl('main') + 'start', {
    fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: 'https://attacker.example/payload' } }); },
  }), /Untrusted update URL/);
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(requestBytes(feedUrl('main') + 'start', {
    fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: 'https://github.com/attacker/repository/file' } }); },
  }), /Untrusted update URL/);
  assert.equal(requests, 1);
});

test('requestBytes bounds declared and streamed sizes, redirects, and HTTP failures', async t => {
  await t.test('declared size', () => assert.rejects(requestBytes(feedUrl('main') + 'file', {
    maxBytes: 3, fetchImpl: async () => new Response('x', { headers: { 'content-length': '4' } }),
  }), /too large/));
  await t.test('streamed size without a declaration', () => assert.rejects(requestBytes(feedUrl('main') + 'file', {
    maxBytes: 3, fetchImpl: async () => new Response('four'),
  }), /too large/));
  await t.test('streamed size exceeds false declaration', () => assert.rejects(requestBytes(feedUrl('main') + 'file', {
    maxBytes: 3, fetchImpl: async () => new Response('four', { headers: { 'content-length': '1' } }),
  }), /too large/));
  await t.test('redirect loop', async () => {
    let requests = 0;
    await assert.rejects(requestBytes(feedUrl('main') + 'file', {
      fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: feedUrl('main') + 'file' } }); },
    }), /redirect/);
    assert.equal(requests, 6);
  });
  await t.test('missing redirect target', () => assert.rejects(requestBytes(feedUrl('main') + 'file', {
    fetchImpl: async () => new Response(null, { status: 302 }),
  }), /Invalid redirect/));
  await t.test('HTTP failure', () => assert.rejects(requestBytes(feedUrl('main') + 'file', {
    fetchImpl: async () => new Response('missing', { status: 404 }),
  }), /HTTP 404/));
});

test('manifest validation binds schema, runtime, branch, SHA, size, and exact asset name', () => {
  const { manifest } = fixture('main');
  assert.deepEqual(validateManifest(manifest, 'main'), manifest);
  for (const patch of [{ schema: 2 }, { runtimeApi: 2 }, { branch: 'iteration' }, { commit: 'abc' }, { sha256: 'g'.repeat(64) }, { size: 0 }, { size: 1.5 }, { size: 64 * 1024 * 1024 + 1 }, { bundle: 'https://attacker.example/game.json.gz' }, { bundle: '../game.json.gz' }]) {
    assert.throws(() => validateManifest({ ...manifest, ...patch }, 'main'), /Invalid game manifest/);
  }
});

test('initialize and play work offline with an explicitly identified bundled branch', async t => {
  const ctx = await setup(t, { initialBranch: 'main' });
  const state = ctx.updater.getState();
  assert.equal(state.branch, 'main');
  assert.equal(state.currentBranch, 'iteration');
  assert.equal(state.source, 'bundled');
  assert.equal(state.currentCommit, BUNDLED_COMMIT);
  assert.equal(state.canDownload, false);
  const playable = await ctx.updater.getPlayable();
  assert.equal(playable.dir, ctx.bundledDir);
  assert.equal(playable.branch, 'iteration');
  assert.equal(playable.source, 'bundled');
  assert.equal(ctx.calls.length, 0);
});

test('current requires the exact selected branch and head, even when fallback has the same SHA', async t => {
  const ctx = await setup(t);
  ctx.routes.set(tipUrl('iteration'), { sha: BUNDLED_COMMIT });
  assert.equal((await ctx.updater.check()).status, 'current');
  assert.equal(ctx.calls.length, 1);
  await ctx.updater.setBranch('main');
  ctx.routes.set(tipUrl('main'), { sha: BUNDLED_COMMIT });
  const state = await ctx.updater.check();
  assert.equal(state.status, 'pending');
  assert.equal(state.currentBranch, 'iteration');
  assert.equal(state.canDownload, false);
  assert.equal(state.tipCommit, BUNDLED_COMMIT);
});

test('older or missing published builds are pending and never falsely current', async t => {
  const ctx = await setup(t);
  ctx.publish(fixture('iteration', COMMIT_A));
  ctx.routes.set(tipUrl('iteration'), { sha: COMMIT_B });
  let state = await ctx.updater.check();
  assert.equal(state.status, 'pending');
  assert.equal(state.tipCommit, COMMIT_B);
  assert.equal(state.availableCommit, null);
  assert.equal(state.canDownload, false);
  ctx.routes.delete(feedUrl('iteration') + 'latest.json');
  state = await ctx.updater.check();
  assert.equal(state.status, 'pending');
  assert.equal(state.canDownload, false);
  assert.equal((await ctx.updater.download()).status, 'pending');
  assert.ok(!ctx.calls.some(call => call.url.endsWith('.json.gz')));
});

test('invalid manifests and malformed branch tips remain non-downloadable', async t => {
  const ctx = await setup(t);
  const bundle = fixture();
  ctx.publish(bundle);
  ctx.routes.set(feedUrl('iteration') + 'latest.json', { ...bundle.manifest, branch: 'main' });
  assert.equal((await ctx.updater.check()).status, 'pending');
  ctx.routes.set(tipUrl('iteration'), { sha: 'not-a-full-commit' });
  assert.equal((await ctx.updater.check()).status, 'offline');
  assert.equal(ctx.updater.getState().canDownload, false);
  assert.equal((await ctx.updater.getPlayable()).source, 'bundled');
});

test('successful downloads atomically activate content, persist it, and support rollback', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture('iteration', COMMIT_A));
  assert.equal(ctx.updater.getState().currentCommit, COMMIT_A);
  assert.equal(ctx.updater.getState().source, 'cached');
  assert.equal(ctx.updater.getState().canRollback, true);
  await ctx.install(fixture('iteration', COMMIT_B));
  assert.equal(ctx.updater.getState().currentCommit, COMMIT_B);
  assert.equal(ctx.updater.getState().canRollback, true);
  assert.deepEqual(JSON.parse(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8')), { iteration: { active: COMMIT_B, previous: COMMIT_A } });
  assert.match(await readFile(join((await ctx.updater.getPlayable()).dir, 'assets/main.js'), 'utf8'), new RegExp(COMMIT_B));
  const restarted = createGameUpdater(ctx.options);
  assert.equal((await restarted.initialize()).currentCommit, COMMIT_B);
  const rolledBack = await restarted.rollback();
  assert.equal(rolledBack.status, 'rolled-back');
  assert.equal(rolledBack.currentCommit, COMMIT_A);
  assert.equal(rolledBack.canRollback, true);
  const bundledFallback = await restarted.rollback();
  assert.equal(bundledFallback.source, 'bundled');
  assert.equal(bundledFallback.currentCommit, BUNDLED_COMMIT);
  assert.equal(bundledFallback.canRollback, false);
  await assert.rejects(restarted.rollback(), /previous|bundled/i);
  assert.ok(ctx.states.some(state => state.status === 'downloading'));
  assert.equal(ctx.states.findLast(state => state.status === 'ready').progress, 100);
});

test('the first content update can be rolled back offline to the explicitly labeled bundled branch', async t => {
  for (const branch of ['iteration', 'main']) {
    await t.test(branch, async t => {
      const ctx = await setup(t, { initialBranch: branch });
      // Matching SHAs across different branches still require truthful branch labeling.
      const updatedCommit = branch === 'main' ? BUNDLED_COMMIT : COMMIT_A;
      await ctx.install(fixture(branch, updatedCommit));
      assert.equal(ctx.updater.getState().canRollback, true);
      assert.deepEqual(JSON.parse(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8'))[branch], { active: updatedCommit, previous: null });
      const requestCount = ctx.calls.length;
      ctx.routes.clear();
      const restored = await ctx.updater.rollback();
      assert.equal(restored.status, 'rolled-back');
      assert.equal(restored.branch, branch);
      assert.equal(restored.currentBranch, 'iteration');
      assert.equal(restored.currentCommit, BUNDLED_COMMIT);
      assert.equal(restored.source, 'bundled');
      assert.equal(restored.canDownload, false);
      assert.equal(restored.canRollback, false);
      assert.match(restored.message, /bundled/i);
      assert.match(restored.message, /iteration/);
      const playable = await ctx.updater.getPlayable();
      assert.equal(playable.dir, ctx.bundledDir);
      assert.equal(playable.branch, 'iteration');
      assert.equal(playable.source, 'bundled');
      assert.equal(ctx.calls.length, requestCount);
      const restarted = createGameUpdater(ctx.options);
      assert.equal((await restarted.initialize()).source, 'bundled');
      await assert.rejects(restarted.rollback(), /previous|bundled/i);
    });
  }
});

test('offline checks preserve a cached playable build and never expose transport secrets', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture());
  ctx.routes.set(tipUrl('iteration'), new Error('https://user:secret@internal.example/private ENOTFOUND'));
  const state = await ctx.updater.check();
  assert.equal(state.status, 'offline');
  assert.equal(state.currentCommit, COMMIT_A);
  assert.equal(state.canDownload, false);
  assert.equal((await ctx.updater.getPlayable()).commit, COMMIT_A);
  assert.doesNotMatch(JSON.stringify(ctx.states), /secret|internal\.example|ENOTFOUND/);
});

test('tampered and incomplete downloads leave the active build and pointer unchanged', async t => {
  for (const mode of ['tampered', 'truncated', 'missing-entry-script']) {
    await t.test(mode, async t => {
      const ctx = await setup(t);
      await ctx.install(fixture());
      const before = await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8');
      const next = fixture('iteration', COMMIT_B, { omitScript: mode === 'missing-entry-script' });
      ctx.publish(next);
      if (mode === 'tampered') {
        const tampered = Buffer.from(next.bytes);
        tampered[Math.floor(tampered.length / 2)] ^= 1;
        ctx.routes.set(feedUrl('iteration') + next.manifest.bundle, tampered);
      }
      if (mode === 'truncated') ctx.routes.set(feedUrl('iteration') + next.manifest.bundle, next.bytes.subarray(0, next.bytes.length - 5));
      assert.equal((await ctx.updater.check()).status, 'available');
      const state = await ctx.updater.download();
      assert.equal(state.status, 'error');
      assert.equal(state.currentCommit, COMMIT_A);
      assert.equal((await ctx.updater.getPlayable()).commit, COMMIT_A);
      assert.equal(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8'), before);
    });
  }
});

test('a branch moving during download cannot activate a stale artifact', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture());
  const before = await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8');
  const next = fixture('iteration', COMMIT_B);
  ctx.publish(next);
  assert.equal((await ctx.updater.check()).status, 'available');
  ctx.routes.set(feedUrl('iteration') + next.manifest.bundle, () => {
    ctx.routes.set(tipUrl('iteration'), { sha: COMMIT_C });
    return new Response(next.bytes);
  });
  const state = await ctx.updater.download();
  assert.equal(state.status, 'pending');
  assert.equal(state.canDownload, false);
  assert.equal(state.availableCommit, null);
  assert.equal((await ctx.updater.getPlayable()).commit, COMMIT_A);
  assert.equal(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8'), before);
  assert.equal((await ctx.updater.check()).tipCommit, COMMIT_C);
});

test('branch switching keeps separate caches and labels the bundled fallback honestly', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture('iteration', COMMIT_A));
  const selectedMain = await ctx.updater.setBranch('main');
  assert.equal(selectedMain.branch, 'main');
  assert.equal(selectedMain.currentBranch, 'iteration');
  assert.equal(selectedMain.source, 'bundled');
  assert.equal(selectedMain.tipCommit, null);
  assert.equal(selectedMain.availableCommit, null);
  assert.equal(selectedMain.canDownload, false);
  assert.equal((await ctx.updater.getPlayable()).dir, ctx.bundledDir);
  await ctx.install(fixture('main', COMMIT_B));
  assert.equal((await ctx.updater.getPlayable()).branch, 'main');
  assert.equal((await ctx.updater.setBranch('iteration')).currentCommit, COMMIT_A);
  assert.equal((await ctx.updater.setBranch('main')).currentCommit, COMMIT_B);
  const beforeCalls = ctx.calls.length;
  const restarted = createGameUpdater({ ...ctx.options, initialBranch: 'main' });
  assert.equal((await restarted.initialize()).currentCommit, COMMIT_B);
  assert.equal((await restarted.setBranch('iteration')).currentCommit, COMMIT_A);
  assert.equal(ctx.calls.length, beforeCalls);
  await assert.rejects(ctx.updater.setBranch('feature/untrusted'), /Choose main or iteration/);
});

test('branch switching invalidates the previously offered candidate', async t => {
  const ctx = await setup(t);
  ctx.publish(fixture());
  assert.equal((await ctx.updater.check()).canDownload, true);
  await ctx.updater.setBranch('main');
  const requestCount = ctx.calls.length;
  assert.equal((await ctx.updater.download()).status, 'idle');
  assert.equal(ctx.calls.length, requestCount);
  assert.equal((await ctx.updater.getPlayable()).source, 'bundled');
});

test('corrupt cached active content falls back to previous, then bundled content', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture('iteration', COMMIT_A));
  const first = await ctx.updater.getPlayable();
  await ctx.install(fixture('iteration', COMMIT_B));
  const second = await ctx.updater.getPlayable();
  await writeFile(join(second.dir, 'assets/main.js'), 'tampered cached content');
  let playable = await ctx.updater.getPlayable();
  assert.equal(playable.commit, COMMIT_A);
  assert.equal(playable.source, 'previous');
  assert.equal(ctx.updater.getState().canRollback, true);
  await rm(join(first.dir, 'index.html'));
  playable = await ctx.updater.getPlayable();
  assert.equal(playable.source, 'bundled');
  assert.equal(playable.dir, ctx.bundledDir);
  assert.equal(playable.commit, BUNDLED_COMMIT);
});

test('corrupt persisted pointers safely select the bundled fallback', async t => {
  const ctx = await setup(t);
  await mkdir(ctx.cacheRoot, { recursive: true });
  await writeFile(join(ctx.cacheRoot, 'active.json'), '{interrupted');
  let restarted = createGameUpdater(ctx.options);
  assert.equal((await restarted.initialize()).source, 'bundled');
  await writeFile(join(ctx.cacheRoot, 'active.json'), JSON.stringify({ iteration: { active: '../../escape', previous: 'not-a-sha' } }));
  restarted = createGameUpdater(ctx.options);
  assert.equal((await restarted.initialize()).source, 'bundled');
  assert.equal((await restarted.getPlayable()).dir, ctx.bundledDir);
});

test('manual rollback from an automatically selected previous cache reaches the bundled game', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture('iteration', COMMIT_A));
  await ctx.install(fixture('iteration', COMMIT_B));
  const active = await ctx.updater.getPlayable();
  await writeFile(join(active.dir, 'assets/main.js'), 'corrupt active content');
  const previous = await ctx.updater.getPlayable();
  assert.equal(previous.source, 'previous');
  assert.equal(previous.commit, COMMIT_A);
  assert.equal(ctx.updater.getState().canRollback, true);
  const restored = await ctx.updater.rollback();
  assert.equal(restored.source, 'bundled');
  assert.equal(restored.currentCommit, BUNDLED_COMMIT);
  assert.equal(restored.canRollback, false);
  assert.deepEqual(JSON.parse(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8')).iteration, { active: null, previous: null });
});

test('launch failures restore the previous verified build, then the bundled fallback', async t => {
  const ctx = await setup(t);
  await ctx.install(fixture('iteration', COMMIT_A));
  await ctx.install(fixture('iteration', COMMIT_B));
  const failed = await ctx.updater.getPlayable();
  const restored = await ctx.updater.reportLaunchFailure(failed);
  assert.equal(restored.status, 'rolled-back');
  assert.equal(restored.currentCommit, COMMIT_A);
  assert.equal(restored.canRollback, true);
  const previous = await ctx.updater.getPlayable();
  const fallback = await ctx.updater.reportLaunchFailure(previous);
  assert.equal(fallback.source, 'bundled');
  assert.equal(fallback.currentCommit, BUNDLED_COMMIT);
  const pointer = await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8');
  await ctx.updater.reportLaunchFailure(await ctx.updater.getPlayable());
  await ctx.updater.reportLaunchFailure(failed);
  assert.equal(await readFile(join(ctx.cacheRoot, 'active.json'), 'utf8'), pointer);
});

test('concurrent checks and branch changes cannot race an in-progress operation', async t => {
  const ctx = await setup(t);
  let release;
  const response = new Promise(resolve => { release = resolve; });
  ctx.routes.set(tipUrl('iteration'), () => response);
  const checking = ctx.updater.check();
  assert.equal((await ctx.updater.check()).status, 'checking');
  await assert.rejects(ctx.updater.setBranch('main'), /Wait for the game update/);
  assert.equal(ctx.calls.length, 1);
  release(new Response(JSON.stringify({ sha: BUNDLED_COMMIT })));
  assert.equal((await checking).status, 'current');
});
