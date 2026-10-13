'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('node:http');
const { Server } = require('node:net');
const { mkdtemp, mkdir, writeFile, symlink, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { startGameServer } = require('./game-server.cjs');

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'flaghack-game-server-test-'));
  const staticDir = join(root, 'game');
  await mkdir(join(staticDir, 'assets'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><script src="/assets/main.js"></script>');
  await writeFile(join(staticDir, 'assets/main.js'), 'globalThis.fixtureGame = true;');
  await writeFile(join(staticDir, 'assets/main.css'), 'body { color: white; }');
  await writeFile(join(staticDir, 'LICENSES.txt'), 'Fixture licenses');
  await writeFile(join(root, 'private.txt'), 'PRIVATE_OUTSIDE_STATIC_ROOT');
  await writeFile(join(staticDir, 'secrets.txt'), 'PRIVATE_INSIDE_STATIC_ROOT');
  const server = await startGameServer({ staticDir });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await server.close(); } };
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  return { root, staticDir, port: server.port, close };
}

function rawRequest(port, path = '/', method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), remoteAddress: res.socket?.remoteAddress }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('static server exposes browser assets on loopback with safe content headers', async t => {
  const listen = Server.prototype.listen;
  const listenCalls = [];
  t.mock.method(Server.prototype, 'listen', function (...args) {
    listenCalls.push(args);
    return Reflect.apply(listen, this, args);
  });
  const ctx = await setup(t);
  assert.ok(Number.isInteger(ctx.port) && ctx.port > 0);
  assert.equal(listenCalls.length, 1);
  assert.equal(listenCalls[0][0], 0);
  assert.equal(listenCalls[0][1], '127.0.0.1');
  const index = await rawRequest(ctx.port);
  assert.equal(index.status, 200);
  assert.match(index.body, /doctype html/);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.equal(index.headers['cache-control'], 'no-store');
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  assert.equal(Number(index.headers['content-length']), Buffer.byteLength(index.body));
  const script = await rawRequest(ctx.port, '/assets/main.js?cache=1');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /^text\/javascript/);
  assert.equal(script.body, 'globalThis.fixtureGame = true;');
  assert.equal((await rawRequest(ctx.port, '/assets/main.css')).status, 200);
  assert.equal((await rawRequest(ctx.port, '/LICENSES.txt')).body, 'Fixture licenses');
  const head = await rawRequest(ctx.port, '/assets/main.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], script.headers['content-length']);
});

test('static server is read-only and does not expose backend APIs or arbitrary files', async t => {
  const ctx = await setup(t);
  for (const path of ['/api/info', '/api/game', '/server/main.js', '/secrets.txt', '/assets/missing.js', '/assets/', '/favicon.ico']) {
    const result = await rawRequest(ctx.port, path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /PRIVATE/);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await rawRequest(ctx.port, '/assets/main.js', method)).status, 405, method);
  }
});

test('static server rejects raw, encoded, malformed and dotfile traversal paths', async t => {
  const ctx = await setup(t);
  await writeFile(join(ctx.staticDir, 'assets/.secret'), 'PRIVATE_DOTFILE');
  for (const path of ['/../private.txt', '/assets/../../private.txt', '/assets/%2e%2e/%2e%2e/private.txt', '/assets%2f..%2f..%2fprivate.txt', '/assets/..%5c..%5cprivate.txt', '/assets//main.js', '/assets/./main.js', '/assets/.secret', '/%00index.html', '/assets/%ZZ', '/assets/%252e%252e/private.txt', '//assets/main.js']) {
    const result = await rawRequest(ctx.port, path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /PRIVATE/);
  }
});

test('static server rejects file and parent-directory symlink escapes', async t => {
  const ctx = await setup(t);
  await symlink(join(ctx.root, 'private.txt'), join(ctx.staticDir, 'assets/file-link.txt'));
  await symlink(ctx.root, join(ctx.staticDir, 'assets/directory-link'), 'dir');
  for (const path of ['/assets/file-link.txt', '/assets/directory-link/private.txt']) {
    const result = await rawRequest(ctx.port, path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /PRIVATE/);
  }
});

test('closing the static server releases its listening socket', async t => {
  const ctx = await setup(t);
  assert.equal((await rawRequest(ctx.port)).status, 200);
  await ctx.close();
  await assert.rejects(rawRequest(ctx.port), error => error.code === 'ECONNREFUSED');
});
