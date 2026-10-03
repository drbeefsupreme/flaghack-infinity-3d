/**
 * Boulders (kind 'rock': footprint radius r, height h): faceted, jittered icosahedra sunk a
 * little into the ground, stone tinted with the obstacle colour, moss on the faces that look
 * up, and a few pebbles scattered around.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Obstacle } from '../../../sim/map/mapgen';
import { hash01, Rng } from '../../../sim/rng';
import { PartsBuilder } from '../geom';
import { frameOf, paintFaces, within } from './batch';
import type { PropBatches } from './kit';
import { obstacleRng } from './kit';

const MOSS = new THREE.Color(0x5d7a3a);
const MOSS_DRY = new THREE.Color(0x7d8a4a);
/** Template top / bottom (unit radius) after flattening. */
const TOP = 0.82;
const BOTTOM = -0.35;

function rockTemplate(seed: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  // Shared vertices so the jitter keeps the surface closed.
  const shape = mergeVertices(ico);
  ico.dispose();
  const p = shape.getAttribute('position');
  const rng = new Rng(`rock-shape:${seed}`);
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rng.next() * 0.36;
    const y = Math.min(TOP, Math.max(BOTTOM, p.getY(i) * k));
    p.setXYZ(i, p.getX(i) * k * (1 + 0.15 * Math.sin(seed * 2.3)), y, p.getZ(i) * k);
  }
  // No normals: PartsBuilder computes flat ones on the de-indexed copy (faceted stone).
  const rock = new PartsBuilder().add(shape, 0xffffff, undefined, { tint: true }).build();
  paintFaces(rock, (f) => {
    const n = hash01(f.index * 7919 + seed * 104729);
    const moss = f.ny > 0.62 && n > 0.25 ? Math.min(1, (f.ny - 0.62) / 0.25) : 0;
    if (moss > 0.35) {
      f.color.copy(n > 0.6 ? MOSS : MOSS_DRY).multiplyScalar(0.85 + 0.3 * n);
      f.tint = 0;
    } else {
      // Stone: tinted later; vary the facets and darken the undersides.
      f.color.setScalar((0.8 + 0.28 * n) * (0.75 + 0.25 * Math.max(0, f.ny + 0.3)));
    }
  });
  return rock;
}

export function buildRocks(rocks: Obstacle[], out: PropBatches): void {
  if (rocks.length === 0) return;
  const templates = [0, 1, 2, 3].map(rockTemplate);
  for (const o of rocks) {
    const rng = obstacleRng(o, 'rock');
    const frame = frameOf(o.x, o.z, o.yaw);
    const sy = o.height / TOP;
    out.low.add(rng.pick(templates), within(frame, { sx: o.radius * rng.range(0.92, 1.08), sy, sz: o.radius * rng.range(0.92, 1.08) }), o.color);
    const pebbles = rng.int(1, 4);
    for (let i = 0; i < pebbles; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = o.radius * rng.range(1.1, 1.6);
      const s = rng.range(0.12, 0.28);
      out.low.add(rng.pick(templates), within(frame, { x: Math.cos(a) * d, z: Math.sin(a) * d, ry: rng.range(0, 6.28), sx: s, sy: s * 0.8, sz: s }), o.color);
    }
  }
  for (const t of templates) t.dispose();
}
