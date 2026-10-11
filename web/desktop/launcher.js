'use strict';
const $ = id => document.getElementById(id);
function render(state) {
  $('version').textContent = `Installed version ${state.version}`;
  $('channel').value = state.channel;
  const busy = ['checking', 'downloading', 'downloaded', 'installing'].includes(state.status);
  $('channel').disabled = busy;
  $('check').disabled = busy;
  $('status').textContent = state.message || state.status;
  $('download').hidden = state.status !== 'available';
  $('install').hidden = !state.canInstall;
  $('progress').hidden = state.status !== 'downloading';
  $('progress').value = state.progress || 0;
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
$('play').addEventListener('click', async () => { $('play').disabled = true; await invoke(() => window.launcher.play()); $('play').disabled = false; });
window.launcher.onState(render);
invoke(() => window.launcher.get());
