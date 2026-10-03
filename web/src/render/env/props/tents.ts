/**
 * Camp tents (obstacle kind 'tent', local +z = door, facing the camp's shade):
 *   0 dome tent  two crossing poles over a rainfly, open vestibule showing the dark doorway,
 *                guy lines (unit template scaled to radius × height),
 *   1 bell tent  canvas wall and cone roof on a centre pole, crown and scalloped trim in the
 *                tent colour, rolled-back door flaps, radiating guy ropes,
 *   2 cabin tent gable roof, mesh windows, door awning on two poles (box footprint).
 * Every tent gets seeded clutter (hook lanterns glowing at night, chairs, coolers, bikes,
 * pennant poles) and some string prayer flags / bunting to their camp's shade.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import type { Rng } from '../../../sim/rng';
import { GlowMode, PartsBuilder } from '../geom';
import { frameOf, GeoWriter, mergeTemplates, toWorld, within } from './batch';
import { flagString, pennant } from './cloth';
import type { ClutterKit, PropBatches } from './kit';
import { obstacleRng } from './kit';

const TAU = Math.PI * 2;
/** Dark open doorway / tent interior. */
const DOORWAY = 0x2a221c;
const CANVAS = 0xeee3c8;
const CANVAS_SHADE = 0xd9ccae;
const POLE = 0x2f3136;
const GUY = 0xd8d1bd;
const MESH = 0x2f3a44;
/** Folding chairs, coolers, bikes. */
const CLUTTER_COLORS = [0x2f5fa8, 0xc0392b, 0x2e8b57, 0x2b2b2b, 0xe08a1e, 0x7d3c98, 0x1f8a8a];

/** Rainfly looks: a darker shade of the tent colour, storm grey, or sand. */
const FLY_STYLES = [
  { color: 0xa9a9a9, tint: true },
  { color: 0x80868e, tint: false },
  { color: 0xd8ccb0, tint: false },
] as const;
type FlyStyle = (typeof FLY_STYLES)[number];

interface ShellSpec {
  radius: number;
  segs: number;
  rows: number;
  polarMax: number;
  sy: number;
  /** Bulge toward the diagonals: dome tents stand on square floors with corner poles. */
  warp: number;
}

function shellPoint(out: THREE.Vector3, s: ShellSpec, seg: number, polar: number): THREE.Vector3 {
  const a = ((seg - 0.5) / s.segs) * TAU;
  const r = s.radius * Math.sin(polar) * (1 + s.warp * Math.abs(Math.sin(2 * a)));
  return out.set(Math.sin(a) * r, s.radius * Math.cos(polar) * s.sy, Math.cos(a) * r);
}

const s00 = new THREE.Vector3();
const s10 = new THREE.Vector3();
const s01 = new THREE.Vector3();
const s11 = new THREE.Vector3();
const sDir = new THREE.Vector3();

/**
 * Latitude/longitude shell around +y; segment j is centred on angle j/segs·τ from +z.
 * `paint(j, row)` sets the writer paint for that face and returns false to leave a hole.
 */
function shell(w: GeoWriter, s: ShellSpec, paint: (seg: number, row: number) => boolean): void {
  for (let i = 0; i < s.rows; i++) {
    const p0 = (s.polarMax * i) / s.rows;
    const p1 = (s.polarMax * (i + 1)) / s.rows;
    for (let j = 0; j < s.segs; j++) {
      if (!paint(j, i)) continue;
      shellPoint(s00, s, j, p0);
      shellPoint(s10, s, j + 1, p0);
      shellPoint(s01, s, j, p1);
      shellPoint(s11, s, j + 1, p1);
      sDir.copy(s00).add(s11).add(s10).add(s01);
      if (i === 0) w.triFacing(s00, s01, s11, sDir);
      else w.quadFacing(s00, s01, s11, s10, sDir);
    }
  }
}

function paintFly(w: GeoWriter, fly: FlyStyle): void {
  w.paint(fly.color, 0, GlowMode.steady, fly.tint);
}

/** Unit dome tent (footprint radius 1, height 1). */
function domeTent(fly: FlyStyle): THREE.BufferGeometry {
  const w = new GeoWriter();
  const body: ShellSpec = { radius: 1, segs: 10, rows: 4, polarMax: Math.PI / 2, sy: 0.95, warp: 0.1 };
  shell(w, body, (j, i) => {
    if (j === 0 && i >= 2) w.paint(DOORWAY);
    else w.paint(0xffffff, 0, GlowMode.steady, true);
    return true;
  });
  const flySpec: ShellSpec = { radius: 1.05, segs: 10, rows: 3, polarMax: Math.PI * 0.37, sy: 0.95, warp: 0.1 };
  shell(w, flySpec, (j, i) => {
    // The front of the fly is pulled out into the vestibule.
    if (j === 0 && i >= 2) return false;
    paintFly(w, fly);
    return true;
  });
  // Vestibule: the left panel is staked out, the right one is rolled up over the doorway.
  const apex = shellPoint(new THREE.Vector3(), flySpec, 0.5, flySpec.polarMax * 0.5);
  const stake = new THREE.Vector3(0, 0.015, 1.42);
  const left = new THREE.Vector3(Math.sin(-0.7) * 1.06, 0.015, Math.cos(-0.7) * 1.06);
  const right = new THREE.Vector3(-left.x, left.y, left.z);
  paintFly(w, fly);
  w.triFacing(apex, left, stake, new THREE.Vector3(-1, 0.6, 0.6));

  w.paint(fly.color, 0, GlowMode.steady, fly.tint);
  w.tube(apex, right, 0.032, 0.032, 5);
  w.paint(POLE);
  const arc = new THREE.Vector3();
  const prev = new THREE.Vector3();
  for (const diag of [Math.PI / 4, -Math.PI / 4]) {
    for (let k = 0; k <= 6; k++) {
      const th = -Math.PI / 2 + (k / 6) * Math.PI;
      const reach = Math.sin(th) * 1.075 * 1.1;
      arc.set(Math.sin(diag) * reach, Math.cos(th) * 1.075 * 0.95, Math.cos(diag) * reach);
      if (k > 0) w.tube(prev, arc, 0.014, 0.014, 3);
      prev.copy(arc);
    }
  }
  w.paint(GUY);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const top = shellPoint(new THREE.Vector3(), flySpec, (a / TAU) * flySpec.segs + 0.5, 0.95);
    w.tube(top, new THREE.Vector3(Math.sin(a) * 1.6, 0, Math.cos(a) * 1.6), 0.005, 0.005, 3);
  }
  return w.build();
}

/** Unit bell tent (radius 1, height 1). */
function bellTent(): THREE.BufferGeometry {
  const segs = 12;
  const rings = [
    { y: 0, r: 1 },
    { y: 0.2, r: 1 },
    { y: 0.2, r: 1.07 },
    { y: 0.47, r: 0.66 },
    { y: 0.73, r: 0.3 },
    { y: 0.9, r: 0 },
  ];
  const at = (out: THREE.Vector3, ring: number, j: number): THREE.Vector3 => {
    const a = ((j - 0.5) / segs) * TAU;
    return out.set(Math.sin(a) * rings[ring].r, rings[ring].y, Math.cos(a) * rings[ring].r);
  };
  const w = new GeoWriter();
  const down = new THREE.Vector3(0, -1, 0);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < segs; j++) {
      at(s00, k, j);
      at(s10, k, j + 1);
      at(s01, k + 1, j);
      at(s11, k + 1, j + 1);
      const door = j === 0 && k <= 2;
      if (door) w.paint(DOORWAY);
      else if (k === 4) w.paint(0xffffff, 0, GlowMode.steady, true);
      else w.paint(k === 1 ? CANVAS_SHADE : CANVAS);
      sDir.copy(s00).add(s11);
      sDir.y = k === 1 ? 0 : sDir.y * 0.5;
      if (k === 4) w.triFacing(s00, s01, s10, sDir);
      else w.quadFacing(s00, s01, s11, s10, k === 1 ? down : sDir);
    }
  }
  // Scalloped trim hanging from the eave.
  w.paint(0xffffff, 0, GlowMode.steady, true);
  const tip = new THREE.Vector3();
  for (let j = 0; j < segs * 2; j++) {
    const a0 = ((j / 2 - 0.5) / segs) * TAU;
    const a1 = (((j + 1) / 2 - 0.5) / segs) * TAU;
    const am = (a0 + a1) / 2;
    s00.set(Math.sin(a0) * 1.075, 0.2, Math.cos(a0) * 1.075);
    s10.set(Math.sin(a1) * 1.075, 0.2, Math.cos(a1) * 1.075);
    tip.set(Math.sin(am) * 1.075, 0.13, Math.cos(am) * 1.075);
    sDir.set(Math.sin(am), 0, Math.cos(am));
    w.triFacing(s00, s10, tip, sDir);
  }
  const b = new PartsBuilder();
  b.cylinder(0.012, 0.014, 0.16, 0x5a4330, { y: 0.92 }, { segments: 5 });
  b.sphere(0.022, 0xd9a93a, { y: 1.0 }, { detail: 0 });
  for (const side of [-1, 1]) {
    const a = (side * Math.PI) / segs;
    b.cylinder(0.035, 0.03, 0.46, CANVAS_SHADE, { x: Math.sin(a) * 1.02, y: 0.23, z: Math.cos(a) * 1.02 }, { segments: 5 });
  }
  w.paint(GUY);
  for (let j = 0; j < segs; j += 2) {
    const a = ((j - 0.5) / segs) * TAU;
    const top = new THREE.Vector3(Math.sin(a) * 1.07, 0.2, Math.cos(a) * 1.07);
    w.tube(top, new THREE.Vector3(Math.sin(a) * 1.65, 0, Math.cos(a) * 1.65), 0.004, 0.004, 3);
  }
  return mergeTemplates([w.build(), b.build()]);
}

/** Unit cabin tent (half extents 1 × 1, height 1), ridge along x, door on +z. */
function cabinTent(fly: FlyStyle): THREE.BufferGeometry {
  const w = new GeoWriter();
  const wall = 0.6;
  const eaveY = 0.57;
  const eaveOut = 1.05;
  const P = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  w.paint(0xffffff, 0, GlowMode.steady, true);
  w.quadFacing(P(-1, 0, 1), P(1, 0, 1), P(1, wall, 1), P(-1, wall, 1), P(0, 0, 1));
  w.quadFacing(P(-1, 0, -1), P(1, 0, -1), P(1, wall, -1), P(-1, wall, -1), P(0, 0, -1));
  for (const sx of [-1, 1]) {
    const dir = P(sx, 0, 0);
    w.quadFacing(P(sx, 0, -1), P(sx, 0, 1), P(sx, wall, 1), P(sx, wall, -1), dir);
    w.triFacing(P(sx, wall, -1), P(sx, wall, 1), P(sx, 1, 0), dir);
  }
  paintFly(w, fly);
  for (const sz of [-1, 1]) {
    const dir = P(0, 1, sz);
    w.quadFacing(P(-1.03, 1, 0), P(1.03, 1, 0), P(1.03, eaveY, eaveOut * sz), P(-1.03, eaveY, eaveOut * sz), dir);
    // Underside of the overhang, seen from below at the eaves.
    w.quadFacing(P(-1.03, 1, 0), P(1.03, 1, 0), P(1.03, eaveY, eaveOut * sz), P(-1.03, eaveY, eaveOut * sz), P(0, -1, -sz));
  }
  // Door awning.
  const awnTop = eaveY - 0.01;
  w.quadFacing(P(-0.5, awnTop, eaveOut), P(0.5, awnTop, eaveOut), P(0.5, 0.5, 1.55), P(-0.5, 0.5, 1.55), P(0, 1, 0.3));
  w.quadFacing(P(-0.5, awnTop, eaveOut), P(0.5, awnTop, eaveOut), P(0.5, 0.5, 1.55), P(-0.5, 0.5, 1.55), P(0, -1, -0.3));
  // Bathtub floor trim, mesh windows, doorway (slightly proud of the walls).
  const o = 1.006;
  w.paint(0x44474c);
  w.quadFacing(P(-o, 0, o), P(o, 0, o), P(o, 0.06, o), P(-o, 0.06, o), P(0, 0, 1));
  w.quadFacing(P(-o, 0, -o), P(o, 0, -o), P(o, 0.06, -o), P(-o, 0.06, -o), P(0, 0, -1));
  w.quadFacing(P(-o, 0, -o), P(-o, 0, o), P(-o, 0.06, o), P(-o, 0.06, -o), P(-1, 0, 0));
  w.quadFacing(P(o, 0, -o), P(o, 0, o), P(o, 0.06, o), P(o, 0.06, -o), P(1, 0, 0));
  w.paint(MESH);
  for (const [x0, x1, z] of [
    [0.45, 0.85, o],
    [-0.85, -0.45, -o],
    [0.45, 0.85, -o],
  ]) {
    w.quadFacing(P(x0, 0.22, z), P(x1, 0.22, z), P(x1, 0.48, z), P(x0, 0.48, z), P(0, 0, z));
  }
  for (const sx of [-o, o]) {
    w.quadFacing(P(sx, 0.25, -0.3), P(sx, 0.25, 0.3), P(sx, 0.55, 0.3), P(sx, 0.55, -0.3), P(sx, 0, 0));
  }
  w.paint(DOORWAY);
  w.quadFacing(P(-0.3, 0, o), P(0.3, 0, o), P(0.3, 0.48, o), P(-0.3, 0.48, o), P(0, 0, 1));
  w.triFacing(P(-0.3, 0.48, o), P(0.3, 0.48, o), P(0, 0.56, o), P(0, 0, 1));

  w.paint(POLE);
  for (const sx of [-0.5, 0.5]) w.tube(P(sx, 0, 1.55), P(sx, 0.5, 1.55), 0.012, 0.012, 4);
  w.paint(GUY);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) w.tube(P(sx * 1.03, eaveY, sz * eaveOut), P(sx * 1.45, 0, sz * 1.5), 0.005, 0.005, 3);
  }
  return w.build();
}

interface TentTemplates {
  dome: THREE.BufferGeometry[];
  bell: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry[];
}

function createTemplates(): TentTemplates {
  return { dome: FLY_STYLES.map(domeTent), bell: bellTent(), cabin: FLY_STYLES.map(cabinTent) };
}

/** World positions of a shade structure's pole tops (where flag strings are tied). */
export function shadePoleTops(o: Obstacle): THREE.Vector3[] {
  const frame = frameOf(o.x, o.z, o.yaw);
  const px = o.hx - 0.15;
  const pz = o.hz - 0.15;
  return [
    toWorld(frame, -px, o.height + 0.08, -pz),
    toWorld(frame, px, o.height + 0.08, -pz),
    toWorld(frame, px, o.height + 0.08, pz),
    toWorld(frame, -px, o.height + 0.08, pz),
  ];
}

/** Local point where a tent ties its flag strings (its highest point). */
function tentTop(o: Obstacle): THREE.Vector3 {
  if (o.variant === 1) return new THREE.Vector3(0, o.height * 0.97, 0);
  if (o.variant === 2) return new THREE.Vector3(o.hx * 0.95, o.height * 0.98, 0);
  return new THREE.Vector3(0, o.height * 0.96, 0);
}

function addClutter(o: Obstacle, frame: THREE.Matrix4, rng: Rng, kit: ClutterKit, out: PropBatches): void {
  const reach = o.shape === 'box' ? o.hz : o.radius;
  const halfWidth = o.shape === 'box' ? o.hx : o.radius;
  const side = rng.chance(0.5) ? 1 : -1;
  if (rng.chance(0.5)) {
    // The hook leans over the doorway so the lantern lights the path in.
    out.solid.add(kit.hookLantern, within(frame, { x: side * (halfWidth * 0.7 + 0.15), z: reach + 0.35, ry: (-side * Math.PI) / 2 }));
  }
  if (rng.chance(0.4)) {
    const color = rng.pick(CLUTTER_COLORS);
    out.solid.add(kit.chair, within(frame, { x: -side * halfWidth * 0.5, z: reach + 0.9, ry: rng.range(-0.6, 0.6) }), color);
    if (rng.chance(0.5)) out.solid.add(kit.chair, within(frame, { x: -side * (halfWidth * 0.5 + 0.75), z: reach + 0.75, ry: rng.range(-0.8, 0.3) }), rng.pick(CLUTTER_COLORS));
  }
  if (rng.chance(0.25)) {
    out.solid.add(kit.cooler, within(frame, { x: -side * (halfWidth * 0.5 - 0.7), z: reach + 0.5, ry: rng.range(-0.4, 0.4) }), rng.pick(CLUTTER_COLORS));
  }
  if (rng.chance(0.14)) {
    out.solid.add(kit.bike, within(frame, { x: side * (halfWidth + 0.35), z: -reach * 0.15, ry: rng.range(-0.15, 0.15), rz: side * 0.1 }), rng.pick(CLUTTER_COLORS));
  }
  if (rng.chance(0.16)) {
    const x = -side * halfWidth * 0.85;
    const z = -reach * 0.75;
    out.solid.add(kit.pole, within(frame, { x, z }));
    const a = rng.range(0, TAU);
    pennant(out.strings, toWorld(frame, x, 2.5, z), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), rng.pick(CLUTTER_COLORS), 0.6);
  }
}

/**
 * Prayer-flag strings: tents to the nearest pole of their camp's shade (a few per shade) and
 * occasionally to a neighbouring tent.
 */
function addStrings(tents: Obstacle[], shades: Obstacle[], out: PropBatches): void {
  const poles = shades.map(shadePoleTops);
  const used = new Array<number>(shades.length).fill(0);
  const tops = tents.map((o) => tentTop(o).applyMatrix4(frameOf(o.x, o.z, o.yaw)));
  tents.forEach((o, i) => {
    const rng = obstacleRng(o, 'tent-strings');
    const style = rng.chance(0.7) ? 'prayer' : 'bunting';
    const phase = rng.int(0, 6);
    if (rng.chance(0.55)) {
      let best = -1;
      let bestD = 13;
      shades.forEach((s, k) => {
        const d = Math.hypot(s.x - o.x, s.z - o.z);
        if (d < bestD && used[k] < 5) {
          best = k;
          bestD = d;
        }
      });
      if (best >= 0) {
        used[best]++;
        const top = tops[i];
        let pole = poles[best][0];
        for (const p of poles[best]) if (p.distanceToSquared(top) < pole.distanceToSquared(top)) pole = p;
        flagString(out.strings, top, pole, style, phase);
        return;
      }
    }
    if (rng.chance(0.2)) {
      let best = -1;
      let bestD = 7.5;
      tents.forEach((t, k) => {
        const d = Math.hypot(t.x - o.x, t.z - o.z);
        if (k > i && d < bestD) {
          best = k;
          bestD = d;
        }
      });
      if (best >= 0) flagString(out.strings, tops[i], tops[best], style, phase);
    }
  });
}

export function buildTents(tents: Obstacle[], shades: Obstacle[], kit: ClutterKit, out: PropBatches): void {
  if (tents.length === 0) return;
  const t = createTemplates();
  for (const o of tents) {
    const rng = obstacleRng(o, 'tent');
    const frame = frameOf(o.x, o.z, o.yaw);
    if (o.variant === 1) {
      out.solid.add(t.bell, within(frame, { sx: o.radius, sy: o.height, sz: o.radius }), o.color);
    } else if (o.variant === 2) {
      out.solid.add(rng.pick(t.cabin), within(frame, { sx: o.hx, sy: o.height, sz: o.hz }), o.color);
    } else {
      out.solid.add(rng.pick(t.dome), within(frame, { sx: o.radius, sy: o.height, sz: o.radius }), o.color);
    }
    addClutter(o, frame, rng, kit, out);
  }
  addStrings(tents, shades, out);
  for (const g of [...t.dome, t.bell, ...t.cabin]) g.dispose();
}
