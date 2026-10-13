'use strict';
const $ = id => document.getElementById(id);
function render(state) {
  $('version').textContent = `Launcher ${state.version}`;
  $('channel').value = state.game?.branch === 'main' ? 'stable' : 'iteration';
  const busy = ['checking', 'downloading', 'downloaded', 'installing'].includes(state.status);
  const game = state.game;
  const gameBusy = game && ['checking', 'downloading'].includes(game.status);
  $('channel').disabled = busy || gameBusy;
  $('check').disabled = busy;
  $('status').textContent = state.message || state.status;
  $('download').hidden = state.status !== 'available';
  $('install').hidden = !state.canInstall;
  $('progress').hidden = state.status !== 'downloading';
  $('progress').value = state.progress || 0;
  if (game) {
    const commit = game.currentCommit ? game.currentCommit.slice(0, 8) : 'bundled';
    $('game-version').textContent = `Play: ${game.currentBranch} ${commit} (${game.source})`;
    $('game-status').textContent = game.message;
    $('game-check').disabled = gameBusy;
    $('game-download').hidden = !game.canDownload;
    $('game-rollback').hidden = !game.canRollback;
    $('game-rollback').disabled = gameBusy;
    $('game-progress').hidden = game.status !== 'downloading';
    $('game-progress').value = game.progress || 0;
  }
}
async function invoke(action) {
  $('notice').textContent = '';
  try { const result = await action(); if (result && result.status) render(result); else if (result && result.message) $('notice').textContent = result.message; }
  catch (error) { $('notice').textContent = error.message || 'That action could not finish. Try again.'; }
}
$('channel').addEventListener('change', () => invoke(() => window.launcher.channel($('channel').value)));
$('check').addEventListener('click', () => invoke(() => window.launcher.check()));
$('download').addEventListener('click', () => invoke(() => window.launcher.download()));
$('install').addEventListener('click', () => invoke(() => window.launcher.install()));
$('game-check').addEventListener('click', () => invoke(() => window.launcher.gameCheck()));
$('game-download').addEventListener('click', () => invoke(() => window.launcher.gameDownload()));
$('game-rollback').addEventListener('click', () => invoke(() => window.launcher.gameRollback()));
$('play').addEventListener('click', async () => { $('play').disabled = true; await invoke(() => window.launcher.play()); $('play').disabled = false; });
window.launcher.onState(render);
invoke(() => window.launcher.get());
