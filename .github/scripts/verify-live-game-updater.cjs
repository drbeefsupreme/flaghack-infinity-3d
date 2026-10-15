'use strict';
// Read-only public HTTP acceptance. All cache/pointer writes stay in a disposable
// runner directory. Downloaded game code is inspected as data, never executed.
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { createGameUpdater, requestBytes } = require('../../web/desktop/game-updater.cjs');
const { inspectBundle } = require('../../web/desktop/game-bundle.cjs');

const REPOSITORY = 'elmorei/flaghack-infinity-3d';
const BRANCHES = ['main', 'iteration'];
const MAX_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 30000;
const SHA = /^[a-f0-9]{40}$/;

async function verifyLiveGameUpdater({ fetchImpl = globalThis.fetch, timeoutMs = MAX_WAIT_MS,
  pollMs = POLL_MS, log = console.log, temporaryRoot = process.env.RUNNER_TEMP || tmpdir() } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_WAIT_MS);
  assert.ok(Number.isSafeInteger(pollMs) && pollMs > 0 && pollMs <= POLL_MS);
  const started = Date.now(), deadline = started + timeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Live updater acceptance deadline reached')), timeoutMs);
  const root = await mkdtemp(join(temporaryRoot, 'flaghack-live-updater-'));
  const cacheRoot = join(root, 'cache'), initialFallback = join(root, 'unused-bootstrap-fallback');
  await mkdir(initialFallback);
  const publicFetch = (url, options = {}) => {
    assert.equal(options.method || 'GET', 'GET', 'Acceptance may only read public HTTP');
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).has('authorization'), false, 'Public checks must not use tokens');
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    return fetchImpl(url, { ...options, signal });
  };
  const tip = async branch => {
    const value = JSON.parse((await requestBytes(`https://api.github.com/repos/${REPOSITORY}/commits/${branch}`,
      { fetchImpl: publicFetch, maxBytes: 1024 * 1024, timeoutMs: Math.max(1, Math.min(20000, deadline - Date.now())) })).toString('utf8'));
    assert.match(value.sha, SHA);
    return value.sha;
  };
  const checked = {};
  try {
    const updater = createGameUpdater({ cacheRoot, bundledDir: initialFallback,
      bundledBranch: 'iteration', bundledCommit: null, initialBranch: 'main', fetchImpl: publicFetch });
    await updater.initialize();
    for (;;) {
      if (Date.now() >= deadline) throw new Error('No verified current-tip game feed for both branches within 10 minutes');
      for (const branch of BRANCHES) {
        if (Date.now() >= deadline) break;
        await updater.setBranch(branch);
        let state = await updater.check();
        assert.equal(state.branch, branch);
        if (state.status === 'available') {
          log(`[game acceptance] ${branch}: downloading ${state.availableCommit}`);
          state = await updater.download();
        }
        if (['ready', 'current'].includes(state.status)) {
          const playable = await updater.getPlayable();
          assert.equal(playable.source, 'cached');
          assert.equal(playable.branch, branch);
          assert.equal(playable.commit, state.tipCommit);
          const inspected = await inspectBundle(playable.dir, { branch, commit: playable.commit });
          assert.equal(inspected.branch, branch);
          assert.equal(inspected.commit, playable.commit);
          checked[branch] = { branch, commit: playable.commit, dir: playable.dir };
          log(`[game acceptance] ${branch}: checked downloaded bytes and playable cache at ${playable.commit}`);
        } else {
          delete checked[branch];
          log(`[game acceptance] ${branch}: ${state.status}; ${state.message} (${Math.ceil((deadline - Date.now()) / 1000)}s remaining)`);
        }
      }
      if (BRANCHES.every(branch => checked[branch])) {
        const liveTips = Object.fromEntries(await Promise.all(BRANCHES.map(async branch => [branch, await tip(branch)])));
        if (BRANCHES.every(branch => liveTips[branch] === checked[branch].commit)) break;
        for (const branch of BRANCHES) if (liveTips[branch] !== checked[branch].commit) {
          log(`[game acceptance] ${branch}: tip moved to ${liveTips[branch]}; waiting for the matching public build`);
          delete checked[branch];
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('No verified current-tip game feed for both branches within 10 minutes');
      await sleep(Math.min(pollMs, remaining));
    }

    // Use the downloaded/inspected iteration bundle as a genuine local fallback.
    // This tests selection/persistence and rollback; it does not launch a Windows
    // installation or claim to test its packaged fallback content.
    const fallback = checked.iteration;
    let offlineCalls = 0;
    const offlineFetch = async () => { offlineCalls++; throw new Error('Deliberately offline for acceptance'); };
    const offline = createGameUpdater({ cacheRoot, bundledDir: fallback.dir, bundledBranch: 'iteration',
      bundledCommit: fallback.commit, initialBranch: 'main', fetchImpl: offlineFetch });
    await offline.initialize();
    for (const branch of BRANCHES) {
      await offline.setBranch(branch);
      const beforeCheck = offlineCalls;
      let playable = await offline.getPlayable();
      assert.equal(offlineCalls, beforeCheck, 'Cached Play must not make a network request');
      assert.equal(playable.source, 'cached');
      assert.equal(playable.branch, branch);
      assert.equal(playable.commit, checked[branch].commit);
      const state = await offline.check();
      assert.equal(state.status, 'offline');
      playable = await offline.getPlayable();
      assert.equal(playable.source, 'cached');
      assert.equal(playable.commit, checked[branch].commit);
      await inspectBundle(playable.dir, { branch, commit: playable.commit });
      log(`[game acceptance] ${branch}: restart and failed offline check preserve verified cached Play`);
    }
    for (const branch of BRANCHES) {
      await offline.setBranch(branch);
      const beforeRollback = offlineCalls;
      let playable;
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal((await offline.rollback()).status, 'rolled-back');
        playable = await offline.getPlayable();
        assert.equal(offlineCalls, beforeRollback, 'Rollback must not use the network');
        if (playable.source === 'bundled') break;
        assert.equal(playable.source, 'cached');
        assert.equal(playable.branch, branch);
        assert.notEqual(playable.commit, checked[branch].commit);
        await inspectBundle(playable.dir, { branch, commit: playable.commit });
        log(`[game acceptance] ${branch}: offline rollback restores a verified previous cached commit`);
      }
      assert.equal(playable.source, 'bundled');
      assert.equal(playable.branch, 'iteration');
      assert.equal(playable.commit, fallback.commit);
      assert.equal(playable.dir, fallback.dir);
      await inspectBundle(playable.dir, { branch: 'iteration', commit: fallback.commit });
      log(`[game acceptance] ${branch}: offline rollback selects the verified local iteration fallback`);
    }
    // Both tips must still match after offline checks before enabling the publisher.
    for (const branch of BRANCHES) assert.equal(await tip(branch), checked[branch].commit,
      `${branch} moved during offline verification; rerun acceptance before publication`);
    const result = { repository: REPOSITORY,
      branches: Object.fromEntries(BRANCHES.map(branch => [branch, checked[branch].commit])),
      publicHTTP: true, downloadedAndInspected: true, cachedOfflinePlay: true,
      offlineRollbackSelection: true, installedWindowsGameplayTested: false };
    log(JSON.stringify(result));
    return result;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await rm(root, { recursive: true, force: true });
  }
}

if (require.main === module) verifyLiveGameUpdater().catch(error => {
  console.error(`Game updater acceptance failed: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { verifyLiveGameUpdater, MAX_WAIT_MS, POLL_MS };
