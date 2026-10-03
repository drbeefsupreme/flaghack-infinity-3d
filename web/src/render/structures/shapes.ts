/**
 * Geometry primitives shared by several structure models: pentagons (the GCC body, Hearth
 * pit, Ward plinth), extruded slabs, Flag cloth, faction pennants and festival bunting.
 */
import * as THREE from 'three';
import type { ModelBuilder, Vec3Tuple } from './kit';

const TAU = Math.PI * 2;

/**
 * Regular pentagon vertices in the ground plane (x, z), circumradius r, first vertex at
 * yaw `rot` (0 = +z, i.e. pointing forward in model space).
 */
export function pentagon(r: number, rot = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const a = rot + (k * TAU) / 5;
    out.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  return out;
}

/**
 * A ground-plane polygon extruded upward: bottom at y = 0, top at y = depth (+ bevel), with
 * bevelled edges. Points are (x, z) in model space.
 */
export function extrudeUp(points: readonly [number, number][], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // ExtrudeGeometry works in the shape's xy-plane; after rotating -90° about X, shape y = -z.
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** Flat-shaded copy of a primitive (crisp pentagonal prisms instead of smoothed ones). */
export function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** Flag cloth: 1 × 0.66, hoist edge on x = 0 (u = 0), flying toward +x; subdivided for the wave. */
export function flagCloth(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 0.66, 12, 6).translate(0.5, 0, 0);
}

/** Tapered pennant (triangle), hoist on x = 0, tip at x = 1, height 0.3. */
export function pennantCloth(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 0.3, 10, 2).translate(0.5, 0, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * (1 - pos.getX(i) * 0.92));
  g.computeVertexNormals();
  return g;
}

/**
 * Festival bunting between two points: a sagging rope with small pennants hanging tip-down,
 * alternating the owner's colour (trimCloth) and Flag yellow.
 */
export function buildBunting(mb: ModelBuilder, a: Vec3Tuple, b: Vec3Tuple, count: number, sag: number): void {
  const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  let prev: Vec3Tuple = a;
  for (let i = 1; i <= count + 1; i++) {
    const t = i / (count + 1);
    const p: Vec3Tuple = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
    mb.rod('rope', prev, p, 0.006, 3);
    prev = p;
  }
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const step = len / (count + 1);
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag;
    const z = a[2] + (b[2] - a[2]) * t;
    // Pennant hoist along the rope, tip hanging down.
    const g = pennantCloth().rotateZ(-Math.PI / 2).scale(step * 2.2, 0.32, 1);
    mb.add(i % 2 === 0 ? 'clothStill' : 'trimCloth', g, x, y, z, 0, yaw, 0);
  }
}
