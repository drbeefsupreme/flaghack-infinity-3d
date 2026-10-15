'use strict';
// A source-generated flag mark: no third-party artwork or native conversion tools.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { deflateSync } = require('node:zlib');
const size = 256, rows = Buffer.alloc((size * 4 + 1) * size);
const polygon = [[81, 61], [208, 61], [177, 96], [208, 131], [81, 131]];
function inside(x, y) { let hit = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [a,b] = polygon[i], [c,d] = polygon[j]; if ((b > y) !== (d > y) && x < (c-a)*(y-b)/(d-b)+a) hit = !hit; } return hit; }
for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
  const inTile = Math.hypot(Math.max(28-x, 0, x-227), Math.max(28-y, 0, y-227)) <= 22;
  const flag = (x >= 65 && x < 81 && y >= 48 && y < 210) || inside(x,y);
  const offset = y * (size*4+1) + 1 + x*4;
  rows.set(flag ? [240,198,91,255] : [24,16,35,inTile?255:0], offset);
}
function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let k=0;k<8;k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(data.length+12); out.writeUInt32BE(data.length); body.copy(out,4); out.writeUInt32BE(crc32(body), out.length-4); return out; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',deflateSync(rows)), chunk('IEND',Buffer.alloc(0))]);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4); ico.writeUInt16LE(1,10); ico.writeUInt16LE(32,12); ico.writeUInt32LE(png.length,14); ico.writeUInt32LE(22,18);
writeFileSync(join(__dirname,'icon.png'),png); writeFileSync(join(__dirname,'icon.ico'),Buffer.concat([ico,png]));
