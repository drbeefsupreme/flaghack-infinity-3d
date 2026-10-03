/**
 * Shared prop templates and batch plumbing used by every prop builder: the batches they write
 * into, seeded per-obstacle randomness, and the small camp clutter kit (lanterns, chairs,
 * coolers, cushions, tables, bikes, fairy-light bulbs, paper lanterns). Templates are in
 * metres with the front toward local +z; parts flagged `tint` take the placement colour.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { Rng } from '../../../sim/rng';
import { GlowMode, PartsBuilder } from '../geom';
import { flat, GeoWriter, StaticBatch } from './batch';

/** Every static prop builder writes into these (see propField.ts for the materials). */
export interface PropBatches {
  /** Rough, rigid (fabric, wood, plastic, stone). */
  solid: StaticBatch;
  /** Glossy, rigid (paint, metal, glass). */
  gloss: StaticBatch;
  /** Rough props too low or small to cast a useful shadow (rocks, pebbles): receive only. */
  low: StaticBatch;
  /** Swaying cloth (tarps, banners, flags), emitted two-sided and merged into `solid`. */
  cloth: StaticBatch;
  /** Tiny emissive bits (fairy-light bulbs): rough material, no shadow pass. */
  lights: StaticBatch;
  /** World-space cloth written directly (flag strings, pennants); merged into `cloth`. */
  strings: GeoWriter;
  quality: 'low' | 'medium' | 'high';
}

export function createBatches(quality: PropBatches['quality']): PropBatches {
  return {
    solid: new StaticBatch(),
    gloss: new StaticBatch(),
    low: new StaticBatch(),
    cloth: new StaticBatch({ twoSided: true }),
    lights: new StaticBatch(),
    strings: new GeoWriter(),
    quality,
  };
}

/** Presentation randomness for one obstacle (stable per map seed, independent per purpose). */
export function obstacleRng(o: Obstacle, salt: string): Rng {
  return new Rng(`${salt}:${o.seed}`);
}

/** Warm incandescent tone used by lanterns, candles and fairy lights. */
export const WARM_LIGHT = 0xffb45a;

export interface ClutterKit {
  /** Shepherd's-hook stake with a hanging camping lantern (glows at night). */
  hookLantern: THREE.BufferGeometry;
  /** Camping lantern standing on the ground. */
  lantern: THREE.BufferGeometry;
  /** Folding camp chair (tinted fabric), facing +z. */
  chair: THREE.BufferGeometry;
  /** Cooler (tinted body, white lid). */
  cooler: THREE.BufferGeometry;
  /** Floor cushion / beanbag (tinted). */
  cushion: THREE.BufferGeometry;
  /** Low wooden table with a candle. */
  table: THREE.BufferGeometry;
  /** Bicycle along z (tinted frame). */
  bike: THREE.BufferGeometry;
  /** Fairy-light bulb (tinted, twinkles at night). */
  bulb: THREE.BufferGeometry;
  /** Paper lantern (tinted, glows at night), hanging point at its top (y = 0). */
  paperLantern: THREE.BufferGeometry;
  /** Wooden garden pole, 2.5 m (pennants). */
  pole: THREE.BufferGeometry;
}

function lanternParts(b: PartsBuilder, y: number, z: number): void {
  b.cylinder(0.065, 0.07, 0.035, 0x2d3b2e, { y: y + 0.018, z }, { segments: 6 });
  b.cylinder(0.055, 0.055, 0.13, WARM_LIGHT, { y: y + 0.1, z }, { segments: 6, glow: 2.8, glowMode: GlowMode.flicker });
  b.cone(0.07, 0.06, 0x2d3b2e, { y: y + 0.195, z }, { segments: 6 });
  b.box(0.012, 0.05, 0.012, 0x222222, { y: y + 0.245, z });
}

export function createClutterKit(): ClutterKit {
  const hook = new PartsBuilder();
  hook.cylinder(0.012, 0.012, 1.42, 0x2a2a2a, { y: 0.71 }, { segments: 4 });
  hook.beam(new THREE.Vector3(0, 1.42, 0), new THREE.Vector3(0, 1.46, 0.12), 0.022, 0x2a2a2a);
  hook.beam(new THREE.Vector3(0, 1.46, 0.12), new THREE.Vector3(0, 1.38, 0.22), 0.022, 0x2a2a2a);
  hook.box(0.006, 0.12, 0.006, 0x333333, { y: 1.31, z: 0.22 });
  // The lantern hangs under the hook tip.
  lanternParts(hook, 1.0, 0.22);

  const lantern = new PartsBuilder();
  lanternParts(lantern, 0, 0);

  const chair = new PartsBuilder();
  chair.box(0.5, 0.04, 0.44, 0xffffff, { y: 0.42 }, { tint: true });
  chair.box(0.5, 0.52, 0.035, 0xffffff, { y: 0.7, z: -0.23, rx: -0.22 }, { tint: true });
  const legs: [number, number, number, number][] = [
    [-0.24, 0.2, -0.24, -0.2],
    [0.24, 0.2, 0.24, -0.2],
  ];
  for (const [x0, z0, x1, z1] of legs) {
    chair.strut(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0.42, z1), 0.012, 0x2b2b2b, { segments: 3 });
    chair.strut(new THREE.Vector3(x0, 0, z1), new THREE.Vector3(x1, 0.42, z0), 0.012, 0x2b2b2b, { segments: 3 });
  }
  chair.box(0.04, 0.03, 0.42, 0x2b2b2b, { x: -0.27, y: 0.62 });
  chair.box(0.04, 0.03, 0.42, 0x2b2b2b, { x: 0.27, y: 0.62 });

  const cooler = new PartsBuilder();
  cooler.box(0.62, 0.34, 0.38, 0xffffff, { y: 0.19 }, { tint: true });
  cooler.box(0.64, 0.07, 0.4, 0xf2f2ee, { y: 0.39 });
  cooler.box(0.05, 0.04, 0.16, 0x9a9a9a, { x: -0.33, y: 0.3 });
  cooler.box(0.05, 0.04, 0.16, 0x9a9a9a, { x: 0.33, y: 0.3 });

  const cushion = new PartsBuilder();
  cushion.add(flat(new THREE.DodecahedronGeometry(0.34, 0)), 0xffffff, { y: 0.13, sx: 1.15, sy: 0.42, sz: 1.15 }, { tint: true });

  const table = new PartsBuilder();
  table.box(1.1, 0.05, 0.62, 0x8a5f3c, { y: 0.38 });
  for (const [x, z] of [
    [-0.5, -0.26],
    [0.5, -0.26],
    [-0.5, 0.26],
    [0.5, 0.26],
  ]) {
    table.box(0.05, 0.36, 0.05, 0x6e4a2e, { x, y: 0.18, z });
  }
  table.cylinder(0.03, 0.03, 0.08, 0xf2e8d0, { x: 0.18, y: 0.445 }, { segments: 6 });
  table.cone(0.014, 0.04, WARM_LIGHT, { x: 0.18, y: 0.505 }, { segments: 4, glow: 3.2, glowMode: GlowMode.flicker });
  table.cylinder(0.07, 0.06, 0.1, 0x3d6e8c, { x: -0.25, y: 0.45, z: 0.05 }, { segments: 7 });

  const bike = new PartsBuilder();
  for (const z of [-0.52, 0.52]) {
    bike.add(new THREE.TorusGeometry(0.33, 0.022, 3, 12), 0x1c1c1c, { y: 0.35, z, ry: Math.PI / 2 });
    bike.cylinder(0.03, 0.03, 0.08, 0x9a9a9a, { y: 0.35, z, rz: Math.PI / 2 }, { segments: 5 });
  }
  const hubR = new THREE.Vector3(0, 0.35, -0.52);
  const hubF = new THREE.Vector3(0, 0.35, 0.52);
  const seat = new THREE.Vector3(0, 0.84, -0.16);
  const head = new THREE.Vector3(0, 0.86, 0.36);
  const crank = new THREE.Vector3(0, 0.33, -0.04);
  for (const [a, c] of [
    [hubR, seat],
    [seat, head],
    [head, hubF],
    [crank, seat],
    [crank, head],
    [hubR, crank],
  ]) {
    bike.strut(a, c, 0.018, 0xffffff, { segments: 4, tint: true });
  }
  bike.box(0.11, 0.04, 0.24, 0x1d1d1d, { y: 0.88, z: -0.18 });
  bike.box(0.5, 0.025, 0.025, 0x2a2a2a, { y: 0.98, z: 0.4 });

  const bulb = new PartsBuilder();
  // Four faces are plenty for a few-pixel point that bloom turns into a soft glow.
  bulb.add(new THREE.TetrahedronGeometry(0.05), 0xffffff, undefined, { glow: 3.2, glowMode: GlowMode.twinkle, tint: true });

  const paper = new PartsBuilder();
  paper.add(flat(new THREE.IcosahedronGeometry(0.2, 1)), 0xffffff, { y: -0.3, sy: 1.18 }, { glow: 1.7, tint: true });
  paper.cylinder(0.075, 0.075, 0.03, 0x2a2a2a, { y: -0.07 }, { segments: 6 });
  paper.cylinder(0.075, 0.075, 0.03, 0x2a2a2a, { y: -0.53 }, { segments: 6 });
  paper.box(0.006, 0.08, 0.006, 0x2a2a2a, { y: -0.03 });

  return {
    hookLantern: hook.build(),
    lantern: lantern.build(),
    chair: chair.build(),
    cooler: cooler.build(),
    cushion: cushion.build(),
    table: table.build(),
    bike: bike.build(),
    bulb: bulb.build(),
    paperLantern: paper.build(),
    pole: new PartsBuilder().cylinder(0.014, 0.02, 2.5, 0x5a4330, { y: 1.25 }, { segments: 4 }).build(),
  };
}

export function disposeClutterKit(kit: ClutterKit): void {
  for (const g of Object.values(kit)) g.dispose();
}
