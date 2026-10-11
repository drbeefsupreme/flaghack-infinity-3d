'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createStorageWriter } = require('./storage.cjs');
test('preference writes serialize and flush the final complete record', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'flaghack-storage-'));
  try {
    const storage = createStorageWriter(), file = join(folder, 'prefs.json');
    const writes = Array.from({ length: 30 }, (_, n) => storage.write(file, { n, text: 'x'.repeat(1024) }));
    await storage.flush(); await Promise.all(writes);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).n, 29);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
