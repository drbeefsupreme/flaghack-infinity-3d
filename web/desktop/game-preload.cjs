'use strict';
// Copy only the game's three preference records across ephemeral localhost origins.
// Nothing is exposed to page JavaScript; the main process validates the sender and size.
const { ipcRenderer } = require('electron');
const keys = ['fh.training.v1', 'fh.settings.v1', 'fh.handle.v1'];
try {
  const saved = ipcRenderer.sendSync('game:restore');
  for (const key of keys) { if (typeof saved[key] === 'string') localStorage.setItem(key, saved[key]); }
} catch { /* Play remains available if preferences cannot be restored. */ }
function save() {
  try { const values = {}; for (const key of keys) values[key] = localStorage.getItem(key); ipcRenderer.send('game:save', values); } catch { /* Do not interrupt play. */ }
}
setInterval(save, 3000);
window.addEventListener('pagehide', save);
