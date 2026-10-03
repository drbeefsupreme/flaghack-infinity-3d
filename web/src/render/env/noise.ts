/**
 * Tiling noise texture shared by every environment shader (ground detail, clouds, water
 * ripples, fire). Generated once per page on the CPU (it does not depend on the seed):
 * sampling a mipmapped texture is far cheaper per pixel than evaluating fBm octaves in GLSL.
 *   R: fBm value noise, base period 4 (broad patches)
 *   G: fBm value noise, base period 16 (clumps)
 *   B: cellular Worley F1, 12 cells per side (pebbles, cracks, foam)
 *   A: white noise (sparkle, dithering)
 */
import * as THREE from 'three';
import { hash01 } from '../../sim/rng';

const SIZE = 256;

/** Hash of an integer lattice point wrapped to `period` (tiling). */
function lattice(ix: number, iy: number, period: number, salt: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  return hash01(x * 7919 + y * 104729 + salt * 1299709);
}

function valueNoise(u: number, v: number, period: number, salt: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, period, salt);
  const b = lattice(ix + 1, iy, period, salt);
  const c = lattice(ix, iy + 1, period, salt);
  const d = lattice(ix + 1, iy + 1, period, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, basePeriod: number, octaves: number, salt: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u, v, period, salt + o) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function worley(u: number, v: number, cells: number, salt: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const px = cx + lattice(cx, cy, cells, salt);
      const py = cy + lattice(cx, cy, cells, salt + 17);
      const ddx = px - x;
      const ddy = py - y;
      best = Math.min(best, ddx * ddx + ddy * ddy);
    }
  }
  return Math.min(1, Math.sqrt(best));
}

/** Contrast-stretch a channel to the full 0..255 range (fBm clusters around 0.5). */
function stretch(src: Float32Array): Uint8Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of src) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const out = new Uint8Array(src.length);
  const k = hi > lo ? 255 / (hi - lo) : 0;
  for (let i = 0; i < src.length; i++) out[i] = Math.round((src[i] - lo) * k);
  return out;
}

/** The noise is seed-independent: generated once per page and shared by every match. */
let noiseData: Uint8Array | null = null;

function generateNoise(): Uint8Array {
  const n = SIZE * SIZE;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const i = y * SIZE + x;
      r[i] = fbm(u, v, 4, 5, 11);
      g[i] = fbm(u, v, 16, 4, 23);
      b[i] = worley(u, v, 12, 37);
    }
  }
  const rs = stretch(r);
  const gs = stretch(g);
  const bs = stretch(b);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = rs[i];
    data[i * 4 + 1] = gs[i];
    data[i * 4 + 2] = bs[i];
    data[i * 4 + 3] = Math.floor(hash01(i * 2654435761 + 99) * 256);
  }
  return data;
}

/** `anisotropy` trades grazing-angle sharpness of the ground detail for texture bandwidth. */
export function createNoiseTexture(renderer: THREE.WebGLRenderer, anisotropy: number): THREE.DataTexture {
  noiseData ??= generateNoise();
  const tex = new THREE.DataTexture(noiseData, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
