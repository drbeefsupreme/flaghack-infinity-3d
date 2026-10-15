'use strict';
const { join } = require('node:path');
const { readFile } = require('node:fs/promises');
const { createStorageWriter } = require('./storage.cjs');
const { installBundle, inspectBundle } = require('./game-bundle.cjs');
const REPO = 'elmorei/flaghack-infinity-3d';
const SHA = /^[a-f0-9]{40}$/;
const BRANCHES = ['main', 'iteration'];
const feedRoot = branch => `https://github.com/${REPO}/releases/download/game-${branch}/`;
const tipUrl = branch => `https://api.github.com/repos/${REPO}/commits/${branch}`;
const TRUSTED_HOSTS = new Set(['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

async function requestBytes(url, { fetchImpl = globalThis.fetch, maxBytes = 64 * 1024 * 1024, timeoutMs = 60000, onProgress } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    for (let n = 0; n < 6; n++) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !TRUSTED_HOSTS.has(target.hostname)) throw new Error('Untrusted update URL');
      if ((target.hostname === 'github.com' && !target.pathname.startsWith('/' + REPO + '/')) || (target.hostname === 'api.github.com' && !target.pathname.startsWith('/repos/' + REPO + '/')) || (n === 0 && !['github.com', 'api.github.com'].includes(target.hostname))) throw new Error('Untrusted update URL');
      response = await fetchImpl(target.href, { redirect: 'manual', signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { 'User-Agent': 'FlaghackLauncher', Accept: 'application/vnd.github+json, application/octet-stream;q=0.9' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        if (!next) throw new Error('Invalid redirect');
        await response.body?.cancel();
        url = new URL(next, target).href;
        response = null;
        continue;
      }
      break;
    }
    if (!response || !response.ok) throw new Error(`Update HTTP ${response?.status || 'redirect'}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) throw new Error('Update too large');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Update too large'); }
      chunks.push(Buffer.from(value));
      if (onProgress) onProgress(declared > 0 ? Math.min(100, size / declared * 100) : 0);
    }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}
function validateManifest(value, branch) {
  if (!value || value.schema !== 1 || value.runtimeApi !== 1 || value.branch !== branch || !SHA.test(value.commit || '') || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 64 * 1024 * 1024 || value.bundle !== `game-${branch}-${value.commit}.json.gz`) throw new Error('Invalid game manifest');
  return { schema: 1, runtimeApi: 1, branch, commit: value.commit, sha256: value.sha256, size: value.size, bundle: value.bundle };
}
function createGameUpdater({ cacheRoot, bundledDir, bundledBranch = 'iteration', bundledCommit = null, initialBranch = bundledBranch, onState, fetchImpl = globalThis.fetch }) {
  const writer = createStorageWriter(), pointerPath = join(cacheRoot, 'active.json');
  let pointers = {}, busy = false, candidate = null;
  let state = { branch: BRANCHES.includes(initialBranch) ? initialBranch : 'iteration', status: 'idle', currentCommit: bundledCommit, currentBranch: bundledBranch, source: 'bundled', tipCommit: null, availableCommit: null, progress: 0, canDownload: false, canRollback: false, message: 'Bundled game is available offline. Check the selected branch for newer game content.' };
  const getState = () => ({ ...state });
  function emit(patch) { state = { ...state, ...patch }; try { onState?.(getState()); } catch {} return getState(); }
  const directory = (branch, commit) => join(cacheRoot, `${branch}-${commit}`);
  async function savePointers(next) { await writer.write(pointerPath, next); pointers = next; }
  async function valid(branch, commit) {
    if (!SHA.test(commit || '')) return null;
    try { return await inspectBundle(directory(branch, commit), { branch, commit }); } catch { return null; }
  }
  async function choose() {
    const entry = pointers[state.branch] || {};
    const active = await valid(state.branch, entry.active);
    if (active) return { ...active, source: 'cached' };
    const previous = await valid(state.branch, entry.previous);
    if (previous) return { ...previous, source: 'previous' };
    return { dir: bundledDir, branch: bundledBranch, commit: bundledCommit, source: 'bundled' };
  }
  async function refreshSelection(extra = {}) {
    const selection = await choose();
    const previous = await valid(state.branch, pointers[state.branch]?.previous);
    return emit({ currentCommit: selection.commit, currentBranch: selection.branch, source: selection.source, canRollback: (!!previous && previous.commit !== selection.commit) || (selection.source !== 'bundled' && (selection.branch !== bundledBranch || selection.commit !== bundledCommit)), ...extra });
  }
  async function initialize() {
    try {
      const raw = JSON.parse(await readFile(pointerPath, 'utf8'));
      for (const branch of BRANCHES) if (raw[branch] && typeof raw[branch] === 'object') pointers[branch] = { active: SHA.test(raw[branch].active || '') ? raw[branch].active : null, previous: SHA.test(raw[branch].previous || '') ? raw[branch].previous : null };
    } catch { /* First run or interrupted/corrupt pointer file falls back to shipped game. */ }
    return refreshSelection();
  }
  async function setBranch(branch) {
    if (!BRANCHES.includes(branch)) throw new Error('Choose main or iteration.');
    if (busy) throw new Error('Wait for the game update operation to finish.');
    busy = true;
    candidate = null;
    emit({ branch, status: 'idle', tipCommit: null, availableCommit: null, canDownload: false, progress: 0 });
    try { return await refreshSelection({ message: 'Branch selected. Check for its latest commit. Cached or bundled play remains available offline.' }); } finally { busy = false; }
  }
  async function latest(branch) {
    const raw = JSON.parse((await requestBytes(tipUrl(branch), { fetchImpl, maxBytes: 1024 * 1024, timeoutMs: 20000 })).toString('utf8'));
    if (!SHA.test(raw.sha || '')) throw new Error('Invalid branch tip');
    return raw.sha;
  }
  async function check() {
    if (busy) return getState();
    busy = true; candidate = null;
    const branch = state.branch;
    emit({ status: 'checking', canDownload: false, availableCommit: null, message: `Checking the latest ${branch} commit…` });
    try {
      const tip = await latest(branch);
      await refreshSelection({ tipCommit: tip });
      if (state.currentBranch === branch && state.currentCommit === tip) return emit({ status: 'current', message: `${branch} is current at ${tip.slice(0, 8)}.` });
      let manifest;
      try { manifest = validateManifest(JSON.parse((await requestBytes(feedRoot(branch) + 'latest.json', { fetchImpl, maxBytes: 65536, timeoutMs: 20000 })).toString('utf8')), branch); }
      catch { return emit({ status: 'pending', message: `${branch} is at ${tip.slice(0, 8)}. Its verified game build is not available yet. Keep playing the installed game and check again later.` }); }
      if (manifest.commit !== tip) return emit({ status: 'pending', message: `${branch} is at ${tip.slice(0, 8)}; the published build is older. Waiting for the matching build.` });
      candidate = manifest;
      return emit({ status: 'available', availableCommit: tip, canDownload: true, message: `${branch} ${tip.slice(0, 8)} is ready. Download the game update without replacing Electron.` });
    } catch { return emit({ status: 'offline', message: 'Could not verify the branch tip. Cached or bundled Play is still available; try checking again later.' }); }
    finally { busy = false; }
  }
  async function download() {
    if (busy || !candidate || !state.canDownload) return getState();
    busy = true;
    const manifest = candidate;
    emit({ status: 'downloading', canDownload: false, progress: 0, message: 'Downloading and verifying game content…' });
    try {
      const bytes = await requestBytes(feedRoot(manifest.branch) + manifest.bundle, { fetchImpl, maxBytes: manifest.size, onProgress: progress => emit({ progress }) });
      const installed = await installBundle({ bytes, expected: manifest, cacheRoot });
      if (await latest(manifest.branch) !== manifest.commit) { candidate = null; return emit({ status: 'pending', availableCommit: null, message: 'The branch changed during download. The previous game is unchanged; check again for the new tip.' }); }
      const old = await choose();
      const previous = old.branch === manifest.branch && old.source !== 'bundled' && old.commit !== installed.commit ? old.commit : pointers[manifest.branch]?.previous || null;
      await savePointers({ ...pointers, [manifest.branch]: { active: installed.commit, previous } });
      candidate = null;
      return refreshSelection({ status: 'ready', tipCommit: installed.commit, availableCommit: null, progress: 100, message: `Game updated to ${manifest.branch} ${installed.commit.slice(0, 8)}. Play uses this build. The previous build is retained.` });
    } catch { return emit({ status: 'error', canDownload: false, message: 'Game update failed validation or could not finish. Your previous game and saved preferences are unchanged. Check again to retry.' }); }
    finally { busy = false; }
  }
  async function rollback() {
    if (busy) throw new Error('Wait for the game update operation to finish.');
    busy = true;
    const branch = state.branch;
    try {
      const entry = pointers[branch] || {};
      let previous = await valid(branch, entry.previous);
      const current = await choose();
      if (previous?.commit === current.commit) previous = null;
      if (!previous && current.source === 'bundled') throw new Error('No verified previous build is available.');
      await savePointers({ ...pointers, [branch]: { active: previous?.commit || null, previous: null } });
      candidate = null;
      return await refreshSelection({ status: 'rolled-back', canDownload: false, message: previous ? 'Restored the previous verified game build. Your preferences were kept.' : `Restored the bundled ${bundledBranch} game. Your preferences were kept.` });
    } finally { busy = false; }
  }
  async function reportLaunchFailure(selection) {
    if (selection.source === 'bundled') return getState();
    const entry = pointers[selection.branch] || {};
    if (entry.active !== selection.commit && entry.previous !== selection.commit) return getState();
    const previous = entry.previous !== selection.commit ? await valid(selection.branch, entry.previous) : null;
    await savePointers({ ...pointers, [selection.branch]: { active: previous?.commit || null, previous: null } });
    return refreshSelection({ status: 'rolled-back', message: 'The updated game did not finish starting. Play now uses the previous verified build or the bundled fallback. Preferences were kept.' });
  }
  async function getPlayable() { const selection = await choose(); await refreshSelection(); return selection; }
  return Object.freeze({ initialize, getState, setBranch, check, download, rollback, reportLaunchFailure, getPlayable });
}
module.exports = { createGameUpdater, validateManifest, requestBytes };
