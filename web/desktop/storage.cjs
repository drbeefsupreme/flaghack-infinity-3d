'use strict';
const { mkdir, writeFile, rename } = require('node:fs/promises');
const { dirname } = require('node:path');
function createStorageWriter() {
  let pending = Promise.resolve();
  return {
    write(file, value) {
      const next = pending.catch(() => {}).then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file + '.tmp', JSON.stringify(value), 'utf8');
        await rename(file + '.tmp', file);
      });
      pending = next;
      return next;
    },
    flush() { return pending; },
  };
}
module.exports = { createStorageWriter };
