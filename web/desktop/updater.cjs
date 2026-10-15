'use strict';

// These are public release-asset feeds, never renderer-provided URLs. The release
// process must publish the matching manifest alongside its full NSIS installer.
const CHANNELS = Object.freeze({
  stable: Object.freeze({
    url: 'https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-stable/',
    manifest: 'latest',
  }),
  iteration: Object.freeze({
    url: 'https://github.com/elmorei/flaghack-infinity-3d/releases/download/desktop-iteration/',
    manifest: 'iteration',
  }),
});

function publicVersion(value) {
  // Do not expose arbitrary release metadata, paths, URLs or credentials in IPC.
  return typeof value === 'string' && value.length <= 128
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    ? value : null;
}

/**
 * A deliberately manual electron-updater adapter. Creating it performs no
 * network requests. The caller owns the final, explicit install confirmation.
 * Dependencies are injected so state transitions can be tested without Electron.
 */
function createUpdater({ autoUpdater, isPackaged, version, initialChannel = 'stable', onState, onChannelChange }) {
  const enabled = Boolean(isPackaged && autoUpdater);
  let operation = null;
  let state = {
    channel: Object.hasOwn(CHANNELS, initialChannel) ? initialChannel : 'stable',
    status: enabled ? 'idle' : 'unavailable',
    version: publicVersion(version) || 'unknown',
    availableVersion: null,
    progress: 0,
    message: enabled
      ? 'Check for updates when you are ready. You can play without checking.'
      : 'Updates are available in the installed Windows app. You can still play this build.',
    canInstall: false,
  };

  const getState = () => ({ ...state });
  function publish(patch) {
    state = { ...state, ...patch };
    state.canInstall = state.status === 'downloaded';
    // A closed window or a failed UI subscriber must not break Play or shutdown.
    if (typeof onState === 'function') {
      try { onState(getState()); } catch { /* The caller can obtain a fresh snapshot. */ }
    }
    return getState();
  }

  function configure(channel) {
    const feed = CHANNELS[channel];
    try {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.disableWebInstaller = true;
      // electron-updater 7+ uses this setting; older releases ignore the property.
      if ('autoInstallEvent' in autoUpdater) autoUpdater.autoInstallEvent = 'manual';
      autoUpdater.allowPrerelease = channel === 'iteration';
      autoUpdater.channel = feed.manifest;
      autoUpdater.setFeedURL({ provider: 'generic', url: feed.url, channel: feed.manifest });
    } finally {
      // The channel setter implicitly permits downgrades. Restore the policy even
      // if configuring a provider throws partway through changing the channel.
      autoUpdater.allowDowngrade = false;
    }
  }

  function fail(kind) {
    const messages = {
      check: 'Could not check for updates. You can keep playing and try again later.',
      download: 'The update could not be downloaded. You can keep playing and check again later.',
      install: 'The installer could not be started. Check for updates and try again, or reinstall the app manually.',
      setup: 'Updates are temporarily unavailable. You can keep playing and try checking again later.',
    };
    return publish({ status: 'error', availableVersion: null, progress: 0, message: messages[kind] || messages.setup });
  }

  if (enabled) {
    // Never forward raw errors: updater errors can contain URLs and local paths.
    autoUpdater.on('error', () => {
      if (operation || state.status === 'installing') fail(operation || 'install');
    });
    autoUpdater.on('checking-for-update', () => {
      if (operation === 'check' && state.status === 'checking') {
        publish({ message: 'Checking for updates…' });
      }
    });
    autoUpdater.on('update-not-available', () => {
      if (operation !== 'check' || state.status !== 'checking') return;
      publish({ status: 'current', availableVersion: null, progress: 0, message: 'This version is up to date for the selected channel.' });
    });
    autoUpdater.on('update-available', (info) => {
      if (operation !== 'check' || state.status !== 'checking') return;
      const nextVersion = publicVersion(info?.version);
      if (!nextVersion) { fail('check'); return; }
      publish({ status: 'available', availableVersion: nextVersion, progress: 0, message: `Version ${nextVersion} is available. Download it when you are ready.` });
    });
    autoUpdater.on('download-progress', (info) => {
      if (operation !== 'download' || state.status !== 'downloading') return;
      const percent = typeof info?.percent === 'number' && Number.isFinite(info.percent)
        ? Math.min(100, Math.max(0, info.percent)) : state.progress;
      publish({ progress: percent, message: `Downloading update: ${Math.floor(percent)}%. You can keep playing.` });
    });
    autoUpdater.on('update-downloaded', (info) => {
      if (operation !== 'download' || state.status !== 'downloading') return;
      if (publicVersion(info?.version) !== state.availableVersion) { fail('download'); return; }
      publish({ status: 'downloaded', progress: 100, message: 'Update downloaded. Install and restart when you are ready; any active game will close.' });
    });
    try { configure(state.channel); } catch { fail('setup'); }
  }

  function setChannel(channel) {
    if (typeof channel !== 'string' || !Object.hasOwn(CHANNELS, channel)) {
      throw new Error('Choose either the stable or iteration update channel.');
    }
    if (channel === state.channel) return getState();
    if (operation || ['checking', 'downloading', 'downloaded', 'installing'].includes(state.status)) {
      throw new Error('Finish the current update, or restart the launcher, before changing channels.');
    }
    if (enabled) {
      try { configure(channel); } catch {
        fail('setup');
        throw new Error('The update channel could not be changed. Try again later.');
      }
    }
    publish({
      channel,
      status: enabled ? 'idle' : 'unavailable',
      availableVersion: null,
      progress: 0,
      message: enabled ? 'Channel changed. Check for updates when you are ready.' : 'Updates are available in the installed Windows app. You can still play this build.',
    });
    if (typeof onChannelChange === 'function') {
      const warn = () => {
        if (state.channel === channel && ['idle', 'unavailable'].includes(state.status)) {
          publish({ message: 'Update channel changed for this session, but the preference could not be saved.' });
        }
      };
      try { Promise.resolve(onChannelChange(channel)).catch(warn); } catch { warn(); }
    }
    return getState();
  }

  async function check() {
    if (!enabled || operation || ['downloaded', 'installing'].includes(state.status)) return getState();
    operation = 'check';
    publish({ status: 'checking', availableVersion: null, progress: 0, message: 'Checking for updates…' });
    try {
      configure(state.channel);
      await autoUpdater.checkForUpdates();
      // A disabled/misconfigured updater may return without emitting a result.
      if (state.status === 'checking') fail('check');
    } catch { fail('check'); }
    finally { operation = null; }
    return getState();
  }

  async function download() {
    if (!enabled || operation || state.status !== 'available') return getState();
    operation = 'download';
    publish({ status: 'downloading', progress: 0, message: 'Downloading update… You can keep playing.' });
    try {
      autoUpdater.allowDowngrade = false;
      await autoUpdater.downloadUpdate();
      if (state.status === 'downloading') fail('download');
    } catch { fail('download'); }
    finally { operation = null; }
    return getState();
  }

  function install() {
    if (!enabled || operation || state.status !== 'downloaded') return false;
    publish({ status: 'installing', message: 'Starting the installer. The app will close and restart after installation.' });
    try {
      autoUpdater.allowDowngrade = false;
      autoUpdater.quitAndInstall(false, true);
      return state.status === 'installing';
    } catch {
      fail('install');
      return false;
    }
  }

  return Object.freeze({ getState, setChannel, check, download, install });
}

module.exports = { createUpdater };
