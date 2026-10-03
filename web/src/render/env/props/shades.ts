/**
 * Shade structures (kind 'shade', box): a tarp in the obstacle colour (striped, bordered or
 * plain) sagging between four galvanised poles at the collision corners (±(hx−0.15),
 * ±(hz−0.15)), pinned at the poles and billowing in between, a scalloped fringe, warm string
 * lights along its edges and paper lanterns swaying beneath; guy lines out to stakes; a rug
 * underneath with a low table and cushions or a ring of camp chairs.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { PartsBuilder } from '../geom';
import { frameOf, GeoWriter, paintFaces, shapeSway, toWorld, within } from './batch';
import type { ClutterKit, PropBatches } from './kit';
import { obstacleRng, WARM_LIGHT } from './kit';

/** Vivid stripe / fringe accents against the (often muted) tarp colour. */
const ACCENTS = [0xe2487f, 0xf0a020, 0x1f9e95, 0x8a53c1, 0xe0662e, 0x2f7fd8];
const CREAM = 0xf1ead8;
const POLE = 0x9aa0a6;
const GUY = 0xe6dfcc;
const RUGS = [0x8c2f39, 0x2f4f6b, 0x6b4a2f, 0x3f6b4f, 0x5b3f6b];
const RUG_TRIM = [0xd9b26a, 0xe8dcc4, 0x2b2b2b];
const LANTERNS = [0xff7a3c, 0xff4f8a, 0x3fd0c8, 0xffc04a, 0xb06aff];
const CHAIRS = [0x2f5fa8, 0xc0392b, 0x2e8b57, 0xe08a1e, 0x2b2b2b];

/** Sag of the tarp below its corners at normalised position (u, v) ∈ [-1, 1]². */
function sag(u: number, v: number, edge: number, centre: number): number {
  const a = 1 - u * u;
  const b = 1 - v * v;
  return edge * (a + b) + (centre - 2 * edge) * a * b;
}

function buildTarp(o: Obstacle, px: number, pz: number, edge: number, centre: number, accent: number, style: number): THREE.BufferGeometry {
  const cols = 8;
  const rows = 6;
  const plane = new THREE.PlaneGeometry(px * 2, pz * 2, cols, rows);
  plane.rotateX(-Math.PI / 2);
  const p = plane.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, o.height - sag(p.getX(i) / px, p.getZ(i) / pz, edge, centre));
  // Smooth normals on the shared grid read as soft billowing cloth.
  plane.computeVertexNormals();
  const tarp = new PartsBuilder().add(plane, 0xffffff).build();
  const main = new THREE.Color(o.color);
  const stripe = new THREE.Color(style === 0 ? accent : CREAM);
  paintFaces(tarp, (f) => {
    const col = Math.min(cols - 1, Math.floor(((f.cx + px) / (2 * px)) * cols));
    const row = Math.min(rows - 1, Math.floor(((f.cz + pz) / (2 * pz)) * rows));
    const border = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
    const useStripe = style === 0 ? col % 2 === 1 : style === 1 ? border : false;
    f.color.copy(useStripe ? stripe : main);
  });
  shapeSway(tarp, (x, _y, z) => (1 - (x / px) ** 2) * (1 - (z / pz) ** 2));
  return tarp;
}

export function buildShades(shades: Obstacle[], kit: ClutterKit, out: PropBatches): void {
  for (const o of shades) {
    const rng = obstacleRng(o, 'shade');
    const frame = frameOf(o.x, o.z, o.yaw);
    const px = o.hx - 0.15;
    const pz = o.hz - 0.15;
    const H = o.height;
    const edge = 0.1;
    const centre = 0.26 + 0.03 * Math.min(px, pz);
    const accent = rng.pick(ACCENTS);
    out.cloth.add(buildTarp(o, px, pz, edge, centre, accent, rng.int(0, 2)), frame);

    // Fringe hanging from every edge (pinned at the top, loose at the tips).
    const fringe = new GeoWriter().paint(accent);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const edges: [number, number, number, number][] = [
      [-px, -pz, px, -pz],
      [px, -pz, px, pz],
      [px, pz, -px, pz],
      [-px, pz, -px, -pz],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(len / 0.28));
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        a.set(x0 + (x1 - x0) * t0, 0, z0 + (z1 - z0) * t0);
        b.set(x0 + (x1 - x0) * t1, 0, z0 + (z1 - z0) * t1);
        a.y = H - sag(a.x / px, a.z / pz, edge, centre) - 0.01;
        b.y = H - sag(b.x / px, b.z / pz, edge, centre) - 0.01;
        tip.lerpVectors(a, b, 0.5).y -= 0.17;
        fringe.tri(a, b, tip, 0, 0, 0.35);
      }
    }
    out.cloth.add(fringe.build(), frame);

    // Poles, base plates, guy lines and stakes.
    const metal = new PartsBuilder();
    const ropes = new PartsBuilder();
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      metal.cylinder(0.045, 0.045, H + 0.12, POLE, { x: sx * px, y: (H + 0.12) / 2, z: sz * pz }, { segments: 6 });
      metal.cylinder(0.06, 0.06, 0.05, 0xe2e6ea, { x: sx * px, y: H + 0.145, z: sz * pz }, { segments: 6 });
      ropes.box(0.24, 0.04, 0.24, 0x3a3d42, { x: sx * px, y: 0.02, z: sz * pz });
      const stake = new THREE.Vector3(sx * (px + 1.05), 0, sz * (pz + 1.05));
      ropes.beam(new THREE.Vector3(sx * px, H + 0.04, sz * pz), stake, 0.012, GUY);
      ropes.box(0.025, 0.12, 0.025, 0x777777, { x: stake.x, y: 0.03, z: stake.z });
    }
    out.gloss.add(metal.build(), frame);

    // Rug with a trim border, table and seating.
    const rugW = px * 2 * 0.8;
    const rugD = pz * 2 * 0.72;
    ropes.box(rugW, 0.02, rugD, rng.pick(RUG_TRIM), { y: 0.012 });
    ropes.box(rugW - 0.24, 0.022, rugD - 0.24, rng.pick(RUGS), { y: 0.016 });
    ropes.box(rugW * 0.45, 0.024, rugD * 0.4, rng.pick(RUG_TRIM), { y: 0.02 });
    out.solid.add(ropes.build(), frame);
    out.solid.add(kit.table, within(frame, { ry: rng.range(-0.3, 0.3) }));
    if (rng.chance(0.55)) {
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
        out.solid.add(kit.cushion, within(frame, { x: Math.cos(ang) * px * 0.55, z: Math.sin(ang) * pz * 0.55, ry: ang }), rng.pick(LANTERNS));
      }
    } else {
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
        // Chairs face the table (their front is local +z).
        out.solid.add(kit.chair, within(frame, { x: Math.sin(ang) * 1.2, z: Math.cos(ang) * 1.2, ry: ang + Math.PI }), rng.pick(CHAIRS));
      }
    }

    // String lights along the tarp edges (the edges never sway, so the bulbs stay put).
    for (const [x0, z0, x1, z1] of edges) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(3, Math.round(len / (out.quality === 'low' ? 0.9 : 0.45)));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const y = H - sag(x / px, z / pz, edge, centre) - 0.2;
        out.lights.add(kit.bulb, within(frame, { x: x * 0.985, y, z: z * 0.985 }), WARM_LIGHT);
      }
    }

    // Paper lanterns hung from the tarp move with the cloth point they hang from.
    const lanterns = rng.int(1, 3);
    for (let i = 0; i < lanterns; i++) {
      const u = rng.range(-0.55, 0.55);
      const v = rng.range(-0.5, 0.5);
      const top = toWorld(frame, u * px, H - sag(u, v, edge, centre) - 0.02, v * pz);
      const weight = (1 - u * u) * (1 - v * v);
      const m = new THREE.Matrix4().makeRotationY(o.yaw).setPosition(top);
      out.solid.add(kit.paperLantern, m, rng.pick(LANTERNS), weight);
    }
  }
}
