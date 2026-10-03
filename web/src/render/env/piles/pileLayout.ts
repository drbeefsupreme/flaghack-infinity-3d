/**
 * Deterministic composition of a lumber pile from its id and kind: which pieces, where, in
 * which colours, and in which order they get carted away. Items are listed base-first, so a
 * pile at lumber fraction f shows the first ceil(f × n) items: stacks lose pallets and plank
 * layers from the top, loose pieces go first, and a MOOP heap loses its top junk while its
 * tarp mound sinks.
 */
import * as THREE from 'three';
import { Rng } from '../../../sim/rng';
import type { Pile } from '../../../sim/types';
import type { Piece } from './pileModels';
import { PALLET, PLANK, PLANK_LAYER, SHEET } from './pileModels';

export interface PileItem {
  piece: Piece;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
  color: THREE.Color;
  /** Resting on the tarp mound: y scales with the mound as the heap shrinks. */
  onMound: boolean;
}

export interface PileLayout {
  /** Whole-pile yaw (radians). */
  yaw: number;
  items: PileItem[];
}

/** Mound height factor at lumber fraction q (the tarp sags as the junk under it goes). */
export function moundHeight(q: number): number {
  return 0.35 + 0.65 * q;
}

type Palette = readonly (readonly [number, number])[];

const PALLET_WOOD: Palette = [[0xc9a46e, 4], [0xd8b884, 3], [0x9b948a, 2], [0x2f6db5, 1], [0xa64a3a, 0.6]];
const LUMBER_WOOD: Palette = [[0xdcb57e, 4], [0xc89a62, 2], [0xb5713f, 1.5], [0x9aa070, 1], [0xa8a090, 1]];
const SHEET_WOOD: Palette = [[0xd8b98a, 2], [0xc4a06a, 1]];
const TARP: Palette = [[0x2f62b8, 4], [0xb4b9bf, 2], [0x7a5a36, 1], [0x4c6a3a, 1], [0xd9682b, 1]];
const CRATE: Palette = [[0xb88a55, 3], [0xc8302c, 1], [0x2c5ec8, 1], [0xe8c13a, 1], [0x3a8a4a, 1]];
const COOLER: Palette = [[0xc8302c, 2], [0x2c62c8, 2], [0x2ca8a0, 1], [0xe9e9e4, 1]];
const FABRIC: Palette = [[0x2f6db5, 2], [0x3a8a4a, 1], [0xc8302c, 1], [0x333333, 1], [0x7a4fa0, 1]];
const CARPET: Palette = [[0x8e2a2a, 2], [0x2a3f8e, 1], [0x2e6b4a, 1], [0xd8c9a0, 1], [0x6a3a7a, 1]];
const BAG: Palette = [[0x1c1c1c, 4], [0xe6e6e6, 1], [0x3a5f3a, 1]];
const PLAIN: Palette = [[0xffffff, 1]];

function pick(rng: Rng, palette: Palette, jitter = 0.08): THREE.Color {
  let total = 0;
  for (const [, w] of palette) total += w;
  let r = rng.next() * total;
  let hex = palette[0][0];
  for (const [c, w] of palette) {
    r -= w;
    if (r <= 0) {
      hex = c;
      break;
    }
  }
  return new THREE.Color(hex).multiplyScalar(1 + (rng.next() - 0.5) * 2 * jitter);
}

function item(piece: Piece, color: THREE.Color, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, scale = 1, onMound = false): PileItem {
  return { piece, x, y, z, rx, ry, rz, scale, color, onMound };
}

function palletPile(rng: Rng): PileItem[] {
  const stacks = [{ x: 0, z: 0, yaw: rng.range(-0.15, 0.15), n: rng.int(6, 11) }];
  const side = rng.chance(0.5) ? 1 : -1;
  if (rng.chance(0.7)) stacks.push({ x: side * rng.range(1.25, 1.45), z: rng.range(-0.35, 0.35), yaw: Math.PI / 2 + rng.range(-0.2, 0.2), n: rng.int(3, 7) });
  if (rng.chance(0.3)) stacks.push({ x: -side * rng.range(1.2, 1.4), z: rng.range(-0.5, 0.5), yaw: rng.range(-0.4, 0.4), n: rng.int(1, 4) });
  const items: PileItem[] = [];
  const top = Math.max(...stacks.map((s) => s.n));
  for (let level = 0; level < top; level++) {
    for (const s of stacks) {
      if (level >= s.n) continue;
      items.push(item('pallet', pick(rng, PALLET_WOOD), s.x + rng.range(-0.05, 0.05), level * PALLET.y, s.z + rng.range(-0.05, 0.05), s.yaw + rng.range(-0.08, 0.08)));
    }
  }
  // Loose pallets: leaning on the main stack or dropped flat nearby (carried off first).
  const loose = rng.int(0, 3);
  for (let i = 0; i < loose; i++) {
    const ang = rng.next() * Math.PI * 2;
    if (rng.chance(0.55)) {
      const tilt = rng.range(1.1, 1.3);
      const d = 0.95;
      items.push(item('pallet', pick(rng, PALLET_WOOD), Math.cos(ang) * d, Math.sin(tilt) * PALLET.x * 0.5, Math.sin(ang) * d, -ang, 0, Math.PI - tilt));
    } else {
      const d = rng.range(1.6, 2.1);
      items.push(item('pallet', pick(rng, PALLET_WOOD), Math.cos(ang) * d, 0, Math.sin(ang) * d, rng.next() * Math.PI, rng.range(-0.06, 0.06), rng.range(-0.05, 0.05)));
    }
  }
  return items;
}

function lumberPile(rng: Rng): PileItem[] {
  const items: PileItem[] = [];
  const wood = pick(rng, LUMBER_WOOD, 0);
  const layers = rng.int(4, 7);
  const yaw = rng.range(-0.1, 0.1);
  for (let i = 0; i < layers; i++) {
    items.push(item('plankLayer', wood.clone().multiplyScalar(rng.range(0.92, 1.08)), rng.range(-0.06, 0.06), i * PLANK_LAYER.y, rng.range(-0.04, 0.04), yaw + rng.range(-0.03, 0.03)));
  }
  const sheets = rng.int(0, 3);
  for (let i = 0; i < sheets; i++) {
    items.push(item('sheet', pick(rng, SHEET_WOOD), rng.range(-0.2, 0.2), layers * PLANK_LAYER.y + i * SHEET.y, rng.range(-0.15, 0.15), yaw + rng.range(-0.25, 0.25)));
  }
  const loose = rng.int(2, 5);
  for (let i = 0; i < loose; i++) {
    const c = wood.clone().multiplyScalar(rng.range(0.85, 1.1));
    if (rng.chance(0.4)) {
      // Leaning on the stack's long side.
      const s = rng.chance(0.5) ? 1 : -1;
      const tilt = rng.range(0.9, 1.2);
      items.push(item('plank', c, rng.range(-1.0, 1.0), Math.sin(tilt) * PLANK.x * 0.5, s * (PLANK_LAYER.z * 0.5 + 0.35), yaw + Math.PI / 2, 0, tilt));
    } else {
      const ang = rng.next() * Math.PI * 2;
      const d = rng.range(1.0, 1.8);
      items.push(item('plank', c, Math.cos(ang) * d, 0, Math.sin(ang) * d, rng.next() * Math.PI));
    }
  }
  return items;
}

function moopPile(rng: Rng): PileItem[] {
  const s = rng.range(0.9, 1.35);
  const items: PileItem[] = [item('mound', pick(rng, TARP), 0, 0, 0, rng.next() * Math.PI * 2, 0, 0, s)];
  const choices: readonly (readonly [Piece, Palette, number])[] = [
    ['crate', CRATE, 3],
    ['cooler', COOLER, 1.5],
    ['wheel', PLAIN, 1.5],
    ['chair', FABRIC, 1.5],
    ['carpet', CARPET, 1.2],
    ['smalls', PLAIN, 2],
    ['cone', PLAIN, 1],
    ['bag', BAG, 2.5],
  ];
  let total = 0;
  for (const [, , w] of choices) total += w;
  const ground: PileItem[] = [];
  const top: PileItem[] = [];
  const n = rng.int(7, 12);
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let choice = choices[0];
    for (const c of choices) {
      r -= c[2];
      if (r <= 0) {
        choice = c;
        break;
      }
    }
    const [piece, palette] = choice;
    const ang = rng.next() * Math.PI * 2;
    const color = pick(rng, palette);
    const yaw = rng.next() * Math.PI * 2;
    // Knock things over: chairs on their side, wheels and crates tilted.
    const rx = piece === 'chair' ? Math.PI / 2 : piece === 'cone' && rng.chance(0.5) ? Math.PI / 2 : rng.range(-0.25, 0.25);
    const lift = piece === 'chair' ? 0.22 : piece === 'cone' && rx > 1 ? 0.17 : 0;
    if (rng.chance(0.45) && piece !== 'carpet') {
      // On the heap: rest on the mound's ellipsoid surface.
      const rr = rng.range(0, 0.6) * s;
      const h = 0.62 * s * Math.sqrt(Math.max(0, 1 - (rr / s) * (rr / s)));
      top.push(item(piece, color, Math.cos(ang) * rr, h - 0.05 + lift, Math.sin(ang) * rr, yaw, rx, rng.range(-0.3, 0.3), 1, true));
    } else {
      const rr = s * rng.range(0.85, 1.55);
      ground.push(item(piece, color, Math.cos(ang) * rr, lift, Math.sin(ang) * rr, yaw, rx, 0));
    }
  }
  return items.concat(ground, top);
}

export function buildPileLayout(pile: Pile): PileLayout {
  const rng = new Rng(`pile:${pile.id}:${pile.kind}`);
  const yaw = rng.next() * Math.PI * 2;
  const items = pile.kind === 'pallets' ? palletPile(rng) : pile.kind === 'lumber' ? lumberPile(rng) : moopPile(rng);
  return { yaw, items };
}
