/**
 * Porta-potty banks (kind 'porta': one 1.24 m box obstacle per unit, local +z = door). Units
 * are ribbed plastic cabins in the row colour (the odd mismatched rental), with a translucent
 * roof cap, vent pipe, door with the crescent moon, handle and an occupied/vacant tab. Units
 * that line up form a row: a hand-wash station stands past one end and an LED light tower,
 * glowing at night, past the other.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { PartsBuilder } from '../geom';
import { flat, frameOf, GeoWriter, mergeTemplates, within } from './batch';
import type { PropBatches } from './kit';
import { obstacleRng } from './kit';

const SKID = 0x3a3d42;
const ROOF = 0xe6ebe8;
const DARK = 0x1a1d22;
const OCCUPIED = 0xd0352b;
const VACANT = 0x2e9e48;
/** Rentals from another company show up in most rows. */
const ODD_COLORS = [0x2f6fd6, 0x2e9e5b, 0x7b8088, 0xb8a27c];

function unitTemplate(indicator: number): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(1.18, 0.1, 1.2, SKID, { y: 0.05 });
  b.box(1.1, 2.0, 1.12, 0xffffff, { y: 1.1 }, { tint: true });
  for (const sx of [-1, 1]) {
    for (const z of [-0.25, 0.25]) b.box(0.03, 1.8, 0.06, 0xcccccc, { x: sx * 0.565, y: 1.1, z }, { tint: true });
  }
  b.box(1.16, 0.08, 1.18, ROOF, { y: 2.14 });
  b.add(flat(new THREE.ConeGeometry(0.82, 0.14, 4)), 0xf2f5f3, { y: 2.25, ry: Math.PI / 4 });
  b.cylinder(0.045, 0.045, 0.42, 0x222222, { x: 0.36, y: 2.35, z: -0.38 }, { segments: 5, open: true });
  b.cylinder(0.07, 0.07, 0.04, 0x222222, { x: 0.36, y: 2.58, z: -0.38 }, { segments: 5 });
  b.box(0.86, 1.86, 0.03, 0xbbbbbb, { y: 1.06, z: 0.575 }, { tint: true });
  b.box(0.95, 0.06, 0.04, 0xbbbbbb, { y: 2.02, z: 0.58 }, { tint: true });
  b.box(0.05, 0.14, 0.05, 0xc0c0c0, { x: 0.33, y: 1.05, z: 0.61 });
  // Flat front details: hinge strip, occupied/vacant tab, brand label.
  const w = new GeoWriter();
  const fwd = new THREE.Vector3(0, 0, 1);
  const decal = (x0: number, y0: number, x1: number, y1: number, z: number, color: number): void => {
    w.paint(color);
    w.quadFacing(new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y0, z), new THREE.Vector3(x1, y1, z), new THREE.Vector3(x0, y1, z), fwd);
  };
  decal(-0.45, 0.16, -0.41, 1.96, 0.592, 0x2b2b2b);
  decal(0.24, 1.22, 0.36, 1.27, 0.592, indicator);
  decal(-0.2, 2.03, 0.2, 2.09, 0.562, 0xf4f4f0);
  // Crescent moon vent cut into the door (☾: thickest at the middle, pointed tips).
  w.paint(DARK);
  const cx = 0;
  const cy = 1.74;
  const r = 0.1;
  const steps = 8;
  const o0 = new THREE.Vector3();
  const o1 = new THREE.Vector3();
  const i0 = new THREE.Vector3();
  const i1 = new THREE.Vector3();
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    const a0 = Math.PI / 2 + Math.PI * t0;
    const a1 = Math.PI / 2 + Math.PI * t1;
    o0.set(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0.593);
    o1.set(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.593);
    i0.copy(o0).x += Math.sin(Math.PI * t0) * r * 0.6;
    i1.copy(o1).x += Math.sin(Math.PI * t1) * r * 0.6;
    w.quadFacing(o0, o1, i1, i0, fwd);
  }
  return mergeTemplates([b.build(), w.build()]);
}

function washStation(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(0.7, 1.0, 0.55, 0xcfd8df, { y: 0.6 });
  for (const x of [-0.3, 0.3]) for (const z of [-0.22, 0.22]) b.box(0.05, 0.1, 0.05, 0x777777, { x, y: 0.05, z });
  b.box(0.62, 0.06, 0.47, 0x8fa3b0, { y: 1.13 });
  b.box(0.7, 0.45, 0.05, 0xcfd8df, { y: 1.38, z: -0.25 });
  for (const x of [-0.17, 0.17]) {
    b.cylinder(0.04, 0.04, 0.18, 0xf4f4f0, { x, y: 1.28, z: -0.12 }, { segments: 6 });
    b.box(0.12, 0.03, 0.14, 0x222222, { x, y: 0.03, z: 0.34 });
  }
  b.box(0.22, 0.26, 0.12, 0xf4f4f0, { x: 0.22, y: 1.45, z: -0.19 });
  return b.build();
}

function lightTower(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(1.0, 0.5, 0.7, 0xe3e6e8, { y: 0.45 });
  b.box(0.95, 0.06, 0.65, 0x2b2b2b, { y: 0.72 });
  for (const z of [-0.4, 0.4]) b.cylinder(0.2, 0.2, 0.12, 0x1b1b1d, { y: 0.2, z, rx: Math.PI / 2 }, { segments: 8 });
  b.cylinder(0.05, 0.065, 4.0, 0x9aa0a6, { y: 2.7, z: -0.15 }, { segments: 6 });
  b.box(1.1, 0.1, 0.1, 0x3a3d42, { y: 4.7, z: -0.15 });
  for (const x of [-0.36, 0.36]) {
    b.box(0.34, 0.24, 0.12, 0x2b2d31, { x, y: 4.55, z: -0.08, rx: 0.45 });
    // Lamp faces aim down at the doors (+z).
    b.box(0.3, 0.2, 0.02, 0xeaf2ff, { x, y: 4.53, z: -0.01, rx: 0.45 }, { glow: 3.4 });
  }
  return b.build();
}

/** Units side by side with (almost) the same facing form one row. */
function rowsOf(units: Obstacle[]): Obstacle[][] {
  const parent = units.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const dyaw = Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)));
      if (dyaw < 0.05 && Math.hypot(a.x - b.x, a.z - b.z) < (a.hx + b.hx) * 1.3) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Obstacle[]>();
  units.forEach((u, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(u);
    else groups.set(root, [u]);
  });
  return [...groups.values()];
}

export function buildPortas(units: Obstacle[], out: PropBatches): void {
  if (units.length === 0) return;
  const templates = [unitTemplate(OCCUPIED), unitTemplate(VACANT)];
  const wash = washStation();
  const tower = lightTower();
  for (const o of units) {
    const rng = obstacleRng(o, 'porta');
    const color = rng.chance(0.1) ? rng.pick(ODD_COLORS) : o.color;
    // Units are modelled at the standard 1.24 m footprint; scale to the obstacle's.
    const s = o.hx / 0.62;
    out.solid.add(rng.chance(0.35) ? templates[0] : templates[1], within(frameOf(o.x, o.z, o.yaw), { sx: s, sz: o.hz / 0.62, sy: o.height / 2.3 }), color);
  }
  for (const row of rowsOf(units)) {
    const first = row[0];
    // Row axis: the units' local x.
    const ax = Math.cos(first.yaw);
    const az = -Math.sin(first.yaw);
    let lo = row[0];
    let hi = row[0];
    for (const u of row) {
      if (u.x * ax + u.z * az < lo.x * ax + lo.z * az) lo = u;
      if (u.x * ax + u.z * az > hi.x * ax + hi.z * az) hi = u;
    }
    out.solid.add(wash, within(frameOf(hi.x, hi.z, hi.yaw), { x: hi.hx + 0.6, z: 0.15 }));
    out.solid.add(tower, within(frameOf(lo.x, lo.z, lo.yaw), { x: -(lo.hx + 0.75), z: -0.1, ry: 0.35 }));
  }
  for (const g of [...templates, wash, tower]) g.dispose();
}
