/**
 * Geometry of THE FLAG effigy (effigy-local space: origin at the Omega Node, y up): a
 * decagonal timber plinth, a pentagonal timber lattice tower (five-fold, like the Omega Node)
 * around a tall mast, ladders, decks, a guy-line ring hung with yellow pennants, and the
 * offerings left at its foot. Build-time only.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLAG_YELLOW } from '../../../sim/constants';
import type { Rng } from '../../../sim/rng';
import { GlowMode, PartsBuilder } from '../geom';
import {
  FLAG_BOTTOM,
  FLAG_HEIGHT,
  LATTICE_R0,
  LATTICE_R1,
  LATTICE_TOP,
  MAST_R0,
  MAST_R1,
  MAST_TOP,
  PLINTH_HEIGHT,
  PLINTH_RADIUS,
} from './burnTimeline';

export interface EffigyGeometry {
  /** Timber lattice, decks, ladders: chars, then burns away. */
  lattice: THREE.BufferGeometry;
  /** Plinth and mast: chars but stands to the end. */
  solid: THREE.BufferGeometry;
  /** Offerings, uplight cans, guy lines with pennants, the gilded finial: never burn. */
  offerings: THREE.BufferGeometry;
  /** Uplight beams (position/normal/uv; uv.y = 0 at the lamp). */
  shafts: THREE.BufferGeometry;
}

/** The tower has five legs (five-fold, like the Omega Node). */
export const LEGS = 5;
const LEVELS = 8;
/** Ground radius of the guy-line anchors (inside the plaza). */
const GUY_RADIUS = 14;
/** Height where the guy lines grip the mast (below the decks' railing and the Flag). */
const GUY_HEIGHT = 18.4;
/** Uplight cans stand on the ground between the legs at this radius. */
export const UPLIGHT_RADIUS = PLINTH_RADIUS + 0.75;

const TAU = Math.PI * 2;

/** Angle (radians, x = cos, z = sin) of lattice leg k. */
function legAngle(k: number): number {
  return (k / LEGS) * TAU + Math.PI / 2;
}

function latticeRadius(y: number): number {
  return LATTICE_R0 + ((LATTICE_R1 - LATTICE_R0) * (y - PLINTH_HEIGHT)) / (LATTICE_TOP - PLINTH_HEIGHT);
}

export function mastRadius(y: number): number {
  return MAST_R0 + ((MAST_R1 - MAST_R0) * (y - PLINTH_HEIGHT)) / (MAST_TOP - PLINTH_HEIGHT);
}

/** Point on the centre line of lattice leg k at height y. */
export function legPoint(k: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = legAngle(k);
  const r = latticeRadius(y);
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

function levelY(i: number): number {
  return PLINTH_HEIGHT + ((LATTICE_TOP - PLINTH_HEIGHT) * i) / (LEVELS - 1);
}

/** Fresh-lumber tone with per-member variation. */
function timber(rng: Rng, base: number, spread = 0.12): THREE.Color {
  const c = new THREE.Color(base);
  const k = 1 + (rng.next() - 0.5) * 2 * spread;
  return c.multiplyScalar(k);
}

export function buildEffigyGeometry(rng: Rng): EffigyGeometry {
  return {
    lattice: buildLattice(rng),
    solid: buildSolid(rng),
    offerings: buildOfferings(rng),
    shafts: buildShafts(),
  };
}

function buildLattice(rng: Rng): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const e = new THREE.Vector3();
  const out = new THREE.Vector3();

  // Legs: one straight tapering run each from the plinth to the crown, plus railing posts.
  for (let k = 0; k < LEGS; k++) {
    b.beam(legPoint(k, PLINTH_HEIGHT - 0.05, a), legPoint(k, LATTICE_TOP + 0.95, c), 0.26, timber(rng, 0xc89a62, 0.08));
  }

  for (let i = 0; i < LEVELS; i++) {
    const y = levelY(i);
    for (let k = 0; k < LEGS; k++) {
      const k1 = (k + 1) % LEGS;
      // Ring beam (sill plate at the bottom level).
      b.beam(legPoint(k, y, a), legPoint(k1, y, c), i === 0 ? 0.22 : 0.17, timber(rng, 0xd2a46c));
      if (i < LEVELS - 1) {
        // X bracing on each face; one diagonal sits proud so the pair never z-fights.
        const y1 = levelY(i + 1);
        const mid = legAngle(k) + Math.PI / LEGS;
        out.set(Math.cos(mid), 0, Math.sin(mid)).multiplyScalar(0.07);
        b.beam(legPoint(k, y, a), legPoint(k1, y1, c), 0.11, timber(rng, 0xd8ae78));
        legPoint(k1, y, d).add(out);
        legPoint(k, y1, e).add(out);
        b.beam(d, e, 0.11, timber(rng, 0xd8ae78));
      }
    }
    // Spokes tying the lattice to the mast every other level.
    if (i > 0 && i % 2 === 0) {
      for (let k = 0; k < LEGS; k++) {
        const ang = legAngle(k);
        const r = mastRadius(y) * 0.85;
        b.beam(legPoint(k, y, a), c.set(Math.cos(ang) * r, y, Math.sin(ang) * r), 0.15, timber(rng, 0xc69660));
      }
    }
  }

  // Decks: a mid-tower landing and the crown platform (pentagons with a hole for the mast).
  for (const i of [3, LEVELS - 1]) {
    const y = levelY(i);
    const shape = new THREE.Shape();
    const r = latticeRadius(y) + 0.22;
    for (let k = 0; k < LEGS; k++) {
      const ang = legAngle(k);
      if (k === 0) shape.moveTo(Math.cos(ang) * r, -Math.sin(ang) * r);
      else shape.lineTo(Math.cos(ang) * r, -Math.sin(ang) * r);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, mastRadius(y) + 0.06, 0, TAU, true);
    shape.holes.push(hole);
    const deck = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 12 });
    deck.rotateX(-Math.PI / 2);
    b.add(deck, timber(rng, 0xb98a58), { y: y + 0.09 });
  }

  // Crown railing between the post tops.
  for (let k = 0; k < LEGS; k++) {
    const k1 = (k + 1) % LEGS;
    for (const h of [0.42, 0.82]) {
      b.beam(legPoint(k, LATTICE_TOP + h, a), legPoint(k1, LATTICE_TOP + h, c), 0.08, timber(rng, 0xd8ae78));
    }
  }

  // Tower ladder up the outside of one face.
  {
    const k = 2;
    const k1 = 3;
    const mid = legAngle(k) + Math.PI / LEGS;
    const nrm = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid));
    const side = new THREE.Vector3(-nrm.z, 0, nrm.x);
    const centre = (y: number, o: THREE.Vector3) => legPoint(k, y, o).add(legPoint(k1, y, out)).multiplyScalar(0.5).addScaledVector(nrm, 0.24);
    const y0 = PLINTH_HEIGHT + 0.1;
    const y1 = LATTICE_TOP + 0.9;
    const col = timber(rng, 0xb3824e, 0.04);
    for (const s of [-0.26, 0.26]) {
      centre(y0, a).addScaledVector(side, s);
      centre(y1, c).addScaledVector(side, s);
      b.beam(a, c, 0.07, col);
    }
    for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.34) {
      centre(y, d);
      b.beam(a.copy(d).addScaledVector(side, -0.28), c.copy(d).addScaledVector(side, 0.28), 0.045, col);
    }
  }

  // A plain ladder leaning on the plinth.
  {
    const ang = legAngle(0) + Math.PI / LEGS;
    const nrm = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const side = new THREE.Vector3(-nrm.z, 0, nrm.x);
    const foot = nrm.clone().multiplyScalar(PLINTH_RADIUS + 1.15);
    const top = nrm.clone().multiplyScalar(PLINTH_RADIUS - 0.05).setY(PLINTH_HEIGHT + 0.45);
    const col = timber(rng, 0x9f7445, 0.04);
    for (const s of [-0.25, 0.25]) {
      b.beam(a.copy(foot).addScaledVector(side, s), c.copy(top).addScaledVector(side, s), 0.07, col);
    }
    for (let f = 0.1; f < 0.95; f += 0.1) {
      d.lerpVectors(foot, top, f);
      b.beam(a.copy(d).addScaledVector(side, -0.27), c.copy(d).addScaledVector(side, 0.27), 0.045, col);
    }
  }
  return b.build();
}

function buildSolid(rng: Rng): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const R = PLINTH_RADIUS;
  const H = PLINTH_HEIGHT;
  const SIDES = 10;

  // Decagonal plinth: dark footing, a core clad in vertical planks, corner battens, trim
  // bands and an overhanging cap.
  const bodyH = H - 0.68;
  const bodyY = 0.45 + bodyH / 2;
  b.cylinder(R - 0.02, R + 0.04, 0.45, 0x5e3b22, { y: 0.225 }, { segments: SIDES });
  b.cylinder(R - 0.3, R - 0.27, bodyH, 0x3a2414, { y: bodyY }, { segments: SIDES });
  const face = (R - 0.225) * Math.cos(Math.PI / SIDES);
  const plankW = (2 * face * Math.tan(Math.PI / SIDES)) / 4;
  for (let j = 0; j < SIDES; j++) {
    const th = ((j + 0.5) / SIDES) * TAU;
    const sx = Math.sin(th);
    const sz = Math.cos(th);
    for (let k = 0; k < 4; k++) {
      const along = (k - 1.5) * plankW;
      const tone = timber(rng, rng.chance(0.25) ? 0x9e6b3e : rng.chance(0.3) ? 0x7a4e2b : 0x8d5c34, 0.06);
      b.box(plankW - 0.014, bodyH, 0.05, tone, { x: sx * face + sz * along, y: bodyY, z: sz * face - sx * along, ry: th });
    }
  }
  b.cylinder(R - 0.02, R - 0.08, 0.24, 0xa77446, { y: H - 0.12 }, { segments: SIDES });
  for (const y of [1.05, 2.2]) b.cylinder(R - 0.17, R - 0.17, 0.09, 0x4f321d, { y }, { segments: SIDES });
  for (let j = 0; j < SIDES; j++) {
    const th = (j / SIDES) * TAU;
    b.box(0.13, bodyH, 0.13, 0x6b4426, { x: Math.sin(th) * (R - 0.19), y: bodyY, z: Math.cos(th) * (R - 0.19), ry: th });
  }

  // Face ornaments: painted Flag emblems on alternate faces, notes and photos on the rest.
  const apothem = face + 0.025;
  for (let j = 0; j < SIDES; j++) {
    const th = ((j + 0.5) / SIDES) * TAU;
    const sx = Math.sin(th);
    const sz = Math.cos(th);
    if (j % 2 === 0) {
      const r = apothem + 0.03;
      b.box(0.05, 1.15, 0.03, 0x2b1d14, { x: sx * r, y: 1.62, z: sz * r, ry: th });
      const off = 0.32;
      b.box(0.56, 0.38, 0.03, FLAG_YELLOW, { x: sx * r + sz * off, y: 1.98, z: sz * r - sx * off, ry: th });
    } else {
      const notes = 3 + rng.int(0, 3);
      for (let n = 0; n < notes; n++) {
        const along = (rng.next() - 0.5) * 1.0;
        const y = 0.75 + rng.next() * 1.75;
        const r = apothem + 0.02 + n * 0.002;
        const pick = rng.next();
        const col = pick < 0.45 ? 0xf3efe4 : pick < 0.65 ? 0xf6c6d8 : pick < 0.8 ? 0xbfe0f2 : pick < 0.92 ? 0xfff1a8 : 0xd8f2c4;
        const w = 0.13 + rng.next() * 0.1;
        b.box(w, w * (1.1 + rng.next() * 0.3), 0.012, col, { x: sx * r + sz * along, y, z: sz * r - sx * along, ry: th, rz: (rng.next() - 0.5) * 0.5 });
      }
    }
  }

  // The mast: one tapering timber column, iron straps, lashings where the Flag is hoisted.
  const mastH = MAST_TOP - H + 0.05;
  b.cylinder(MAST_R1, MAST_R0, mastH, 0x9a6a3e, { y: H - 0.05 + mastH / 2 }, { segments: 14 });
  const straps = [4.6, 7.6, 10.6, 13.6, 16.6, LATTICE_TOP + 1.2, FLAG_BOTTOM - 0.08, FLAG_BOTTOM + FLAG_HEIGHT * 0.5, FLAG_BOTTOM + FLAG_HEIGHT + 0.08];
  for (const y of straps) {
    const r = mastRadius(y) + 0.03;
    b.cylinder(r, r, 0.14, 0x2f2a26, { y }, { segments: 14 });
  }
  return b.build();
}

function buildOfferings(rng: Rng): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const R = PLINTH_RADIUS;
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();

  // Candles on the footing ledge and in the grass; their flames flicker at night.
  const candleCols = [0xf4ead2, 0xf4ead2, 0xefe2c0, 0xb8232f, 0x6a3fa0, 0xf2c94c];
  for (let i = 0; i < 46; i++) {
    const onLedge = i < 18;
    const th = rng.next() * TAU;
    const r = onLedge ? R - 0.02 + rng.next() * 0.04 : R + 0.15 + rng.next() * 0.9;
    const y0 = onLedge ? 0.45 : 0;
    const cr = 0.03 + rng.next() * 0.035;
    const ch = 0.07 + rng.next() * 0.22;
    const x = Math.sin(th) * r;
    const z = Math.cos(th) * r;
    b.cylinder(cr, cr * 1.05, ch, rng.pick(candleCols), { x, y: y0 + ch / 2, z }, { segments: 7 });
    b.cone(0.017, 0.065, 0xffa64a, { x, y: y0 + ch + 0.04, z }, { segments: 5, glow: 4, glowMode: GlowMode.flicker });
  }

  // Tiny Survey Flags pushed into the ground around the plinth.
  for (let i = 0; i < 44; i++) {
    const th = rng.next() * TAU;
    const r = R + 0.45 + rng.next() * 1.6;
    const x = Math.sin(th) * r;
    const z = Math.cos(th) * r;
    const h = 0.62 + rng.next() * 0.25;
    const lean = (rng.next() - 0.5) * 0.18;
    b.box(0.012, h, 0.012, 0x6d6f73, { x, y: h / 2, z, rx: lean, rz: lean * 0.6 });
    const yaw = rng.next() * TAU;
    b.box(0.13, 0.1, 0.005, FLAG_YELLOW, { x: x + Math.cos(yaw) * 0.065, y: h - 0.05, z: z - Math.sin(yaw) * 0.065, ry: yaw }, { glow: 0.35, sway: 0.6 });
  }

  // Bouquets.
  const bloom = [0xd7263d, 0xf46036, 0xf7b2d9, 0xffffff, 0xffd400, 0x9b5de5];
  for (let i = 0; i < 9; i++) {
    const th = rng.next() * TAU;
    const r = R + 0.25 + rng.next() * 0.5;
    const x = Math.sin(th) * r;
    const z = Math.cos(th) * r;
    for (let f = 0; f < 6; f++) {
      const fx = x + (rng.next() - 0.5) * 0.25;
      const fz = z + (rng.next() - 0.5) * 0.25;
      const fy = 0.18 + rng.next() * 0.2;
      b.box(0.012, fy, 0.012, 0x3f7a35, { x: fx, y: fy / 2, z: fz });
      b.sphere(0.045 + rng.next() * 0.03, rng.pick(bloom), { x: fx, y: fy, z: fz }, { detail: 0 });
    }
  }

  // Five crystals at the inner angles (pink and blue, after the 2017 game).
  for (let k = 0; k < 5; k++) {
    const th = legAngle(k);
    const r = R + 0.55;
    const pink = k % 2 === 0;
    const col = pink ? 0xff7ad9 : 0x7ad8ff;
    const geo = new THREE.OctahedronGeometry(0.16, 0);
    b.add(geo, col, { x: Math.cos(th) * r, y: 0.38, z: Math.sin(th) * r, sy: 2.6, ry: th }, { glow: 1.1 });
  }

  // Uplight cans between the legs, tilted toward the tower; the lens glows at night.
  for (let k = 0; k < LEGS; k++) {
    const th = legAngle(k) + Math.PI / LEGS;
    const x = Math.cos(th) * UPLIGHT_RADIUS;
    const z = Math.sin(th) * UPLIGHT_RADIUS;
    // Tip the can's top inward (toward the tower) by `tilt` radians.
    const tilt = 0.12;
    const rx = -Math.sin(th) * tilt;
    const rz = Math.cos(th) * tilt;
    b.box(0.5, 0.06, 0.12, 0x202022, { x, y: 0.03, z, ry: -th });
    b.cylinder(0.17, 0.15, 0.3, 0x18181a, { x, y: 0.2, z, rx, rz }, { segments: 10 });
    b.cylinder(0.14, 0.14, 0.02, 0xfff0d0, { x: x - Math.cos(th) * 0.04, y: 0.355, z: z - Math.sin(th) * 0.04, rx, rz }, { segments: 10, glow: 6 });
  }

  // Guy lines from the mast to five ground anchors, strung with yellow pennants.
  const pennant = [FLAG_YELLOW, 0xffb21f, 0xffe45a];
  for (let k = 0; k < LEGS; k++) {
    const th = legAngle(k) + Math.PI / LEGS;
    const top = a.set(Math.cos(th) * (mastRadius(GUY_HEIGHT) + 0.02), GUY_HEIGHT, Math.sin(th) * (mastRadius(GUY_HEIGHT) + 0.02));
    const anchor = c.set(Math.cos(th) * GUY_RADIUS, 0.18, Math.sin(th) * GUY_RADIUS);
    b.strut(top, anchor, 0.022, 0x3a3a3c, { segments: 4 });
    b.box(0.32, 0.36, 0.32, 0x6b6450, { x: anchor.x, y: 0.18, z: anchor.z, ry: th });
    const yaw = -th;
    const len = top.distanceTo(anchor);
    const n = Math.floor((len * 0.78) / 0.82);
    for (let i = 0; i < n; i++) {
      const f = 0.1 + (i / n) * 0.78;
      const px = top.x + (anchor.x - top.x) * f;
      const py = top.y + (anchor.y - top.y) * f;
      const pz = top.z + (anchor.z - top.z) * f;
      b.box(0.34, 0.26, 0.006, pennant[i % 3], { x: px, y: py - 0.15, z: pz, ry: yaw }, { glow: 0.3, sway: 1 });
    }
  }

  // Gilded finial atop the mast (Vexillaurum: the pole is gold).
  b.sphere(0.42, 0xffc93a, { y: MAST_TOP + 0.36 }, { detail: 2, glow: 0.25 });
  b.cone(0.16, 0.9, 0xffd65a, { y: MAST_TOP + 1.15 }, { segments: 8, glow: 0.25 });
  b.cylinder(MAST_R1 * 0.7, MAST_R1, 0.12, 0xd4a017, { y: MAST_TOP - 0.02 }, { segments: 14 });
  return b.build();
}

/** Five additive light shafts from the uplight cans up the tower toward the Flag. */
function buildShafts(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < LEGS; k++) {
    const th = legAngle(k) + Math.PI / LEGS;
    from.set(Math.cos(th) * UPLIGHT_RADIUS, 0.36, Math.sin(th) * UPLIGHT_RADIUS);
    to.set(Math.cos(th) * 1.4, FLAG_BOTTOM + 1.5, Math.sin(th) * 1.4);
    const len = from.distanceTo(to);
    const geo = new THREE.CylinderGeometry(1.5, 0.13, len, 14, 1, true);
    dir.subVectors(to, from).normalize();
    q.setFromUnitVectors(up, dir);
    mid.copy(from).addScaledVector(dir, len / 2);
    geo.applyMatrix4(m.compose(mid, q, one));
    parts.push(geo);
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}
