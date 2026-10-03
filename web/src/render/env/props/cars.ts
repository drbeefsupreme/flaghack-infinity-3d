/**
 * Parked cars (kind 'car', box: hx half width, hz half length, local +z = nose): 0 sedan,
 * 1 van, 2 camper bus (a converted skoolie). Bodies are extruded side profiles painted with
 * the obstacle colour, with glass greenhouses, pillars, wheels, lights and bumpers. Burner
 * touches: LED underglow and roof boxes on some cars; the bus gets a psychedelic stripe that
 * cycles the rainbow at night, fairy lights along the roof, a roof deck with chairs and a
 * string of prayer flags between two masts.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { GlowMode, PartsBuilder } from '../geom';
import { frameOf, GeoWriter, mergeTemplates, toWorld, within } from './batch';
import { flagString } from './cloth';
import type { ClutterKit, PropBatches } from './kit';
import { obstacleRng } from './kit';

const GLASS = 0x26303a;
const RUBBER = 0x1b1b1d;
const HUB = 0xb8bcc2;
const TRIM = 0x2b2d31;
const HEADLIGHT = 0xf4f1dc;
const TAILLIGHT = 0xb0201a;
const RAINBOW = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa];

/** Nominal footprints the templates are modelled at (mapgen's car sizes). */
const NOMINAL = [
  { hx: 0.95, hz: 2.25, h: 1.45 },
  { hx: 1.0, hz: 2.55, h: 2.1 },
  { hx: 1.25, hz: 4.3, h: 3.0 },
];

/**
 * Side profile (z, y) extruded across the car (x ∈ [-width/2, width/2]): ExtrudeGeometry
 * extrudes along +z, so the result is turned to run the profile along the car's length.
 */
function profile(points: [number, number][], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

function wheels(b: PartsBuilder, x: number, r: number, zs: number[], width = 0.24): void {
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      b.cylinder(r, r, width, RUBBER, { x: sx * x, y: r, z, rz: Math.PI / 2 }, { segments: 10 });
      b.cylinder(r * 0.58, r * 0.58, width + 0.02, HUB, { x: sx * x, y: r, z, rz: Math.PI / 2 }, { segments: 8 });
    }
  }
}

function sedan(roofBox: boolean): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const body: [number, number][] = [
    [-2.22, 0.3],
    [2.18, 0.3],
    [2.25, 0.52],
    [2.18, 0.74],
    [1.0, 0.87],
    [-1.62, 0.9],
    [-2.16, 0.86],
    [-2.25, 0.58],
  ];
  b.add(profile(body, 1.86), 0xffffff, undefined, { tint: true });
  const cabin: [number, number][] = [
    [1.02, 0.86],
    [0.24, 1.38],
    [-0.96, 1.42],
    [-1.64, 0.89],
  ];
  b.add(profile(cabin, 1.6), GLASS);
  b.box(1.5, 0.05, 1.22, 0xffffff, { y: 1.42, z: -0.35 }, { tint: true });
  b.box(1.64, 0.5, 0.12, 0xffffff, { y: 1.14, z: -0.33 }, { tint: true });
  for (const sx of [-1, 1]) {
    b.beam(new THREE.Vector3(sx * 0.79, 0.87, 1.0), new THREE.Vector3(sx * 0.77, 1.4, 0.22), 0.07, 0xffffff, { tint: true });
    b.beam(new THREE.Vector3(sx * 0.79, 0.9, -1.6), new THREE.Vector3(sx * 0.77, 1.41, -0.95), 0.09, 0xffffff, { tint: true });
    b.box(0.16, 0.1, 0.07, 0xffffff, { x: sx * 0.99, y: 1.0, z: 0.95 }, { tint: true });
    b.box(0.34, 0.12, 0.04, HEADLIGHT, { x: sx * 0.6, y: 0.66, z: 2.21 });
    b.box(0.3, 0.1, 0.04, TAILLIGHT, { x: sx * 0.65, y: 0.76, z: -2.23 });
  }
  b.box(1.9, 0.14, 0.12, TRIM, { y: 0.36, z: 2.22 });
  b.box(1.9, 0.14, 0.12, TRIM, { y: 0.38, z: -2.22 });
  b.box(0.7, 0.12, 0.03, 0x1d1f22, { y: 0.56, z: 2.25 });
  b.box(0.36, 0.1, 0.01, 0xf2f2ef, { y: 0.55, z: -2.256 });
  wheels(b, 0.82, 0.34, [1.38, -1.42]);
  if (roofBox) {
    b.box(1.2, 0.04, 0.04, 0x222222, { y: 1.47, z: 0.1 });
    b.box(1.2, 0.04, 0.04, 0x222222, { y: 1.47, z: -0.8 });
    b.box(0.85, 0.32, 1.45, 0x2a2c30, { y: 1.65, z: -0.35 });
  }
  return b.build();
}

function van(rack: boolean): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const body: [number, number][] = [
    [-2.52, 0.34],
    [2.4, 0.34],
    [2.55, 0.62],
    [2.48, 0.95],
    [1.85, 1.12],
    [1.25, 2.0],
    [-2.48, 2.07],
    [-2.55, 1.86],
  ];
  b.add(profile(body, 1.96), 0xffffff, undefined, { tint: true });
  const windows: [number, number][] = [
    [1.62, 1.3],
    [1.3, 1.86],
    [-2.2, 1.88],
    [-2.2, 1.34],
  ];
  b.add(profile(windows, 1.985), GLASS);
  // Sliding-door seam: a dark band wider than the body shows on both flanks.
  b.box(1.99, 1.25, 0.025, 0x222222, { y: 1.12, z: -0.3 });
  for (const sx of [-1, 1]) {
    b.box(0.36, 0.14, 0.04, HEADLIGHT, { x: sx * 0.62, y: 0.82, z: 2.5 });
    b.box(0.12, 0.3, 0.04, TAILLIGHT, { x: sx * 0.86, y: 1.2, z: -2.555 });
  }
  b.box(2.0, 0.16, 0.14, TRIM, { y: 0.4, z: 2.48 });
  b.box(2.0, 0.16, 0.14, TRIM, { y: 0.4, z: -2.53 });
  b.box(1.5, 0.55, 0.02, GLASS, { y: 1.65, z: -2.56 });
  const shield = new GeoWriter().paint(GLASS);
  const n = new THREE.Vector3(0, 0.56, 0.83).multiplyScalar(0.012);
  shield.quadFacing(
    new THREE.Vector3(-0.86, 1.16, 1.82).add(n),
    new THREE.Vector3(0.86, 1.16, 1.82).add(n),
    new THREE.Vector3(0.84, 1.96, 1.28).add(n),
    new THREE.Vector3(-0.84, 1.96, 1.28).add(n),
    new THREE.Vector3(0, 0.56, 0.83),
  );
  wheels(b, 0.86, 0.36, [1.65, -1.7], 0.26);
  if (rack) {
    for (const sx of [-1, 1]) b.box(0.05, 0.05, 3.2, 0x222222, { x: sx * 0.72, y: 2.14, z: -0.6 });
    b.box(1.0, 0.36, 1.1, 0x2f5fa8, { y: 2.33, z: 0.2 });
    b.box(0.7, 0.3, 0.8, 0xe08a1e, { x: -0.2, y: 2.3, z: -1.2 });
  }
  return mergeTemplates([b.build(), shield.build()]);
}

function bus(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const box: [number, number][] = [
    [-4.3, 0.55],
    [3.3, 0.55],
    [3.3, 2.65],
    [3.15, 2.86],
    [-4.12, 2.9],
    [-4.3, 2.7],
  ];
  b.add(profile(box, 2.46), 0xffffff, undefined, { tint: true });
  const hood: [number, number][] = [
    [3.25, 0.55],
    [4.3, 0.55],
    [4.3, 1.25],
    [4.05, 1.45],
    [3.25, 1.52],
  ];
  b.add(profile(hood, 2.2), 0xffffff, undefined, { tint: true });
  b.box(2.3, 0.55, 0.06, 0x3a3d42, { y: 0.95, z: 4.31 });
  // The stripe glows through the rainbow at night (rainbow mode re-hues by height).
  RAINBOW.forEach((c, i) => {
    b.box(2.48, 0.1, 7.3, c, { y: 1.02 + i * 0.1, z: -0.45 }, { glow: 0.9, glowMode: GlowMode.rainbow });
  });
  for (let k = 0; k < 7; k++) b.box(2.48, 0.62, 0.78, GLASS, { y: 2.08, z: -3.4 + k * 0.97 });
  const glass = new GeoWriter().paint(GLASS);
  glass.quadFacing(
    new THREE.Vector3(-1.1, 1.65, 3.31),
    new THREE.Vector3(1.1, 1.65, 3.31),
    new THREE.Vector3(1.05, 2.5, 3.31),
    new THREE.Vector3(-1.05, 2.5, 3.31),
    new THREE.Vector3(0, 0, 1),
  );
  glass.quadFacing(
    new THREE.Vector3(-0.9, 1.8, -4.31),
    new THREE.Vector3(0.9, 1.8, -4.31),
    new THREE.Vector3(0.9, 2.5, -4.31),
    new THREE.Vector3(-0.9, 2.5, -4.31),
    new THREE.Vector3(0, 0, -1),
  );
  for (const sx of [-1, 1]) {
    b.cylinder(0.13, 0.13, 0.05, HEADLIGHT, { x: sx * 0.8, y: 1.05, z: 4.31, rx: Math.PI / 2 }, { segments: 8 });
    b.box(0.16, 0.24, 0.04, TAILLIGHT, { x: sx * 1.0, y: 1.0, z: -4.32 });
    // Roof deck railing.
    b.box(0.04, 0.04, 5.6, 0x2b2b2b, { x: sx * 1.12, y: 3.32, z: -0.9 });
    for (let k = 0; k < 6; k++) b.box(0.04, 0.42, 0.04, 0x2b2b2b, { x: sx * 1.12, y: 3.1, z: -3.7 + k * 1.12 });
    b.box(0.05, 2.0, 0.05, 0x2b2b2b, { x: sx * 0.3, y: 1.9, z: -4.36 });
  }
  for (let k = 0; k < 6; k++) b.box(0.6, 0.04, 0.04, 0x2b2b2b, { y: 1.1 + k * 0.32, z: -4.36 });
  b.box(2.5, 0.22, 0.18, TRIM, { y: 0.55, z: 4.35 });
  b.box(2.5, 0.22, 0.18, TRIM, { y: 0.6, z: -4.35 });
  b.box(2.3, 0.04, 5.4, 0x6b4a32, { y: 2.92, z: -0.9 });
  wheels(b, 1.08, 0.5, [3.0, -2.55, -3.25], 0.3);
  // Masts for the prayer-flag string over the roof deck.
  b.cylinder(0.03, 0.03, 1.4, 0x2b2b2b, { y: 3.6, z: 2.9 }, { segments: 4 });
  b.cylinder(0.03, 0.03, 1.3, 0x2b2b2b, { y: 3.55, z: -4.1 }, { segments: 4 });
  return mergeTemplates([b.build(), glass.build()]);
}

export function buildCars(cars: Obstacle[], kit: ClutterKit, out: PropBatches): void {
  if (cars.length === 0) return;
  const sedans = [sedan(false), sedan(true)];
  const vans = [van(false), van(true)];
  const skoolie = bus();
  const glow = new PartsBuilder()
    .box(1.7, 0.03, 3.9, 0xffffff, { y: 0.2 }, { glow: 2.2, glowMode: GlowMode.rainbow })
    .build();
  for (const o of cars) {
    const rng = obstacleRng(o, 'car');
    const variant = Math.max(0, Math.min(2, o.variant));
    const nom = NOMINAL[variant];
    // Length runs along the longer half extent (mapgen puts it on local z).
    const alongX = o.hx > o.hz;
    const len = alongX ? o.hx : o.hz;
    const wid = alongX ? o.hz : o.hx;
    const frame = within(frameOf(o.x, o.z, o.yaw), { ry: alongX ? Math.PI / 2 : 0 });
    const fit = within(frame, { sx: wid / nom.hx, sy: o.height / nom.h, sz: len / nom.hz });
    if (variant === 0) {
      out.gloss.add(rng.chance(0.25) ? sedans[1] : sedans[0], fit, o.color);
      if (rng.chance(0.22)) out.solid.add(glow, fit);
    } else if (variant === 1) {
      out.gloss.add(rng.chance(0.4) ? vans[1] : vans[0], fit, o.color);
      if (rng.chance(0.25)) out.solid.add(glow, within(fit, { sz: 1.15 }));
    } else {
      out.gloss.add(skoolie, fit, o.color);
      // Fairy lights along both roof edges.
      for (const sx of [-1.16, 1.16]) {
        for (let z = -4.0; z <= 3.0; z += out.quality === 'low' ? 0.8 : 0.4) {
          out.lights.add(kit.bulb, within(fit, { x: sx, y: 2.82, z }), rng.chance(0.5) ? 0xffcf87 : 0xff7ad9);
        }
      }
      out.solid.add(kit.chair, within(fit, { x: -0.5, y: 2.94, z: -1.0, ry: 0.4 }), 0xc0392b);
      out.solid.add(kit.chair, within(fit, { x: 0.5, y: 2.94, z: -1.8, ry: -0.3 }), 0x2f5fa8);
      flagString(out.strings, toWorld(fit, 0, 4.3, 2.9), toWorld(fit, 0, 4.2, -4.1), 'prayer', rng.int(0, 4));
    }
  }
  for (const g of [...sedans, ...vans, skoolie, glow]) g.dispose();
}
