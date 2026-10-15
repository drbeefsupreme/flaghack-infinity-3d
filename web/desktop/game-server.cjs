'use strict';
// Deliberately serves browser assets only. Downloaded bundles never run in Node.
const { createServer } = require('node:http');
const { readFile, lstat } = require('node:fs/promises');
const { join, extname } = require('node:path');
const { once } = require('node:events');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
async function startGameServer({ staticDir }) {
  const server = createServer((req, res) => {
    (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const raw = decodeURIComponent((req.url || '/').split('?')[0]);
      if (raw === '/api/info') { res.writeHead(404).end(); return; }
      const relative = raw === '/' ? 'index.html' : raw.slice(1);
      if (!raw.startsWith('/') || !/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(p => !p || p.startsWith('.')) || (relative !== 'index.html' && relative !== 'LICENSES.txt' && !['assets/', 'audio/', 'models/'].some(root => relative.startsWith(root)))) { res.writeHead(404).end(); return; }
      let parent = staticDir;
      for (const part of relative.split('/').slice(0, -1)) {
        parent = join(parent, part);
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) { res.writeHead(404).end(); return; }
      }
      const file = join(staticDir, relative);
      const stat = await lstat(file).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) { res.writeHead(404).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    })().catch(() => { if (!res.headersSent) res.writeHead(404); res.end(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, close: async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; } };
}
module.exports = { startGameServer };
