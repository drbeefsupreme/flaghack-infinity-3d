/**
 * Piece models for lumber piles, each drawn as one InstancedMesh: stringer pallets, sticker-
 * stacked plank layers, loose planks, plywood sheets, and the MOOP heap's tarp mound and
 * junk (crates, coolers, bike wheels, camp chairs, carpet rolls, cans with a forgotten
 * glowstick, traffic cones, trash bags). Parts marked tint take the per-instance colour.
 * Origins sit at the piece's footprint centre on the ground. Build-time only.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GlowMode, PartsBuilder } from '../geom';

export const PIECES = ['pallet', 'plankLayer', 'plank', 'sheet', 'mound', 'crate', 'cooler', 'wheel', 'chair', 'carpet', 'smalls', 'cone', 'bag'] as const;
export type Piece = (typeof PIECES)[number];

/** Pallet footprint (m): stringer pallet, 1.2 long (x) × 1.0 deep (z) × 0.14 high. */
export const PALLET = { x: 1.2, y: 0.14, z: 1.0 };
/** Plank layer: eight 3 m planks side by side on three stickers. */
export const PLANK_LAYER = { x: 3.0, y: 0.09, z: 1.6 };
export const PLANK = { x: 3.0, y: 0.05, z: 0.19 };
export const SHEET = { x: 2.44, y: 0.018, z: 1.22 };

const TINT = { tint: true };

function pallet(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  // Bottom boards, three stringers, seven deck boards (tinted wood; stringers a shade darker).
  for (const z of [-0.42, 0, 0.42]) b.box(PALLET.x, 0.02, 0.12, 0xe6e6e6, { y: 0.01, z }, TINT);
  for (const z of [-0.44, 0, 0.44]) b.box(PALLET.x, 0.09, 0.07, 0xc8c8c8, { y: 0.065, z }, TINT);
  for (let i = 0; i < 7; i++) b.box(0.13, 0.02, PALLET.z, 0xffffff, { x: -0.535 + i * 0.178, y: 0.12, z: 0 }, TINT);
  return b.build();
}

function plankLayer(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  for (let i = 0; i < 8; i++) {
    const shade = i % 3 === 0 ? 0xf2f2f2 : i % 3 === 1 ? 0xffffff : 0xe2e2e2;
    b.box(PLANK.x - (i % 2) * 0.12, PLANK.y, PLANK.z, shade, { x: (i % 2) * 0.06, y: PLANK.y / 2, z: -0.7 + i * 0.2 }, TINT);
  }
  for (const x of [-1.25, 0, 1.25]) b.box(0.045, 0.04, PLANK_LAYER.z, 0x8a8a8a, { x, y: PLANK.y + 0.02 }, TINT);
  return b.build();
}

function plank(): THREE.BufferGeometry {
  return new PartsBuilder().box(PLANK.x, PLANK.y, PLANK.z, 0xffffff, { y: PLANK.y / 2 }, TINT).build();
}

function sheet(): THREE.BufferGeometry {
  return new PartsBuilder().box(SHEET.x, SHEET.y, SHEET.z, 0xffffff, { y: SHEET.y / 2 }, TINT).build();
}

/** A lumpy tarp-covered heap, radius 1, height ~0.6. */
function mound(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lump = 1 + 0.17 * Math.sin(v.x * 5.1 + v.z * 3.3) * Math.cos(v.z * 4.7 - v.y * 2.1) + 0.07 * Math.sin(v.x * 11 + v.y * 9 + v.z * 7);
    v.multiplyScalar(lump);
    v.y = v.y > 0 ? v.y * 0.62 : v.y * 0.04;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Weld the duplicated corners so the folds shade smoothly.
  const welded = mergeVertices(geo);
  geo.dispose();
  welded.computeVertexNormals();
  return new PartsBuilder().add(welded, 0xffffff, undefined, TINT).build();
}

function crate(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(0.56, 0.4, 0.42, 0xffffff, { y: 0.2 }, TINT);
  for (const y of [0.05, 0.35]) b.box(0.6, 0.07, 0.46, 0xbdbdbd, { y }, TINT);
  for (const x of [-0.27, 0.27]) b.box(0.05, 0.42, 0.46, 0xbdbdbd, { x, y: 0.21 }, TINT);
  return b.build();
}

function cooler(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(0.62, 0.34, 0.38, 0xffffff, { y: 0.17 }, TINT);
  b.box(0.64, 0.08, 0.4, 0xf1f1ee, { y: 0.38 });
  for (const x of [-0.33, 0.33]) b.box(0.04, 0.05, 0.16, 0x2a2a2a, { x, y: 0.3 });
  return b.build();
}

/** Bicycle wheel lying flat. */
function wheel(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  const flat = { y: 0.025, rx: Math.PI / 2 };
  b.add(new THREE.TorusGeometry(0.33, 0.024, 6, 26), 0x1c1c1c, flat);
  b.add(new THREE.TorusGeometry(0.305, 0.011, 4, 26), 0xb9bec4, flat);
  for (let i = 0; i < 9; i++) b.box(0.6, 0.005, 0.005, 0xc9cdd2, { y: 0.025, ry: (i / 9) * Math.PI });
  b.cylinder(0.03, 0.03, 0.09, 0x6d7177, { y: 0.03 }, { segments: 8 });
  return b.build();
}

/** Folding camp chair (upright; the layout knocks it over). */
function chair(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(0.5, 0.025, 0.44, 0xffffff, { y: 0.42 }, TINT);
  b.box(0.5, 0.42, 0.025, 0xffffff, { y: 0.66, z: -0.23, rx: -0.12 }, TINT);
  const frame = 0x55595e;
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const s of [-0.25, 0.25]) {
    b.strut(a.set(s, 0, -0.22), c.set(s, 0.44, 0.22), 0.012, frame, { segments: 5 });
    b.strut(a.set(s, 0, 0.22), c.set(s, 0.44, -0.22), 0.012, frame, { segments: 5 });
    b.strut(a.set(s, 0.44, -0.24), c.set(s, 0.9, -0.3), 0.012, frame, { segments: 5 });
    b.strut(a.set(s, 0.58, -0.2), c.set(s, 0.58, 0.18), 0.014, frame, { segments: 5 });
  }
  return b.build();
}

/** Rolled carpet lying along x. */
function carpet(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.cylinder(0.16, 0.16, 1.9, 0xffffff, { y: 0.16, rz: Math.PI / 2 }, { segments: 12, tint: true });
  for (const x of [-0.95, 0.95]) b.cylinder(0.1, 0.1, 0.02, 0x9a9a9a, { x, y: 0.16, rz: Math.PI / 2 }, { segments: 12, tint: true });
  return b.build();
}

/** Scatter of cans around a 5-gallon bucket, plus two glowsticks that light up at night. */
function smalls(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.cylinder(0.15, 0.13, 0.36, 0xe8742a, { x: 0.05, y: 0.18, z: 0.02 }, { segments: 12 });
  b.cylinder(0.157, 0.157, 0.025, 0xd0651f, { x: 0.05, y: 0.355, z: 0.02 }, { segments: 12 });
  const cans: [number, number, number, number, number][] = [
    [0.32, 0.05, 0xc8202a, 1, 0.3],
    [0.24, -0.26, 0xb8bcc2, 0, 0],
    [-0.28, 0.2, 0x2a64c8, 1, 1.9],
    [-0.2, -0.3, 0x2e8b3a, 1, 0.8],
    [0.42, -0.2, 0xd8b53a, 0, 0],
    [-0.38, -0.05, 0xf2f2f2, 1, 2.6],
  ];
  for (const [x, z, col, lying, yaw] of cans) {
    if (lying) b.cylinder(0.033, 0.033, 0.12, col, { x, y: 0.033, z, rz: Math.PI / 2, ry: yaw }, { segments: 8 });
    else b.cylinder(0.033, 0.033, 0.12, col, { x, y: 0.06, z }, { segments: 8 });
  }
  b.cylinder(0.008, 0.008, 0.16, 0xff4fd8, { x: 0.18, y: 0.01, z: 0.3, rz: Math.PI / 2, ry: 0.7 }, { segments: 5, glow: 2.6, glowMode: GlowMode.twinkle });
  b.cylinder(0.008, 0.008, 0.16, 0x62ff6a, { x: -0.1, y: 0.01, z: 0.36, rz: Math.PI / 2, ry: -0.4 }, { segments: 5, glow: 2.2 });
  return b.build();
}

function cone(): THREE.BufferGeometry {
  const b = new PartsBuilder();
  b.box(0.38, 0.03, 0.38, 0x1d1d1d, { y: 0.015 });
  b.cone(0.17, 0.5, 0xff6a1a, { y: 0.28 }, { segments: 12 });
  b.cylinder(0.098, 0.118, 0.07, 0xf4f4f4, { y: 0.25 }, { segments: 12 });
  return b.build();
}

/** Knotted trash bag. */
function bag(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.3, 1);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 17 + v.y * 11) * Math.cos(v.z * 13));
    v.y = (v.y + 0.3) * 0.78;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const welded = mergeVertices(geo);
  geo.dispose();
  welded.computeVertexNormals();
  return new PartsBuilder()
    .add(welded, 0xffffff, undefined, TINT)
    .cone(0.05, 0.12, 0xffffff, { y: 0.5 }, { segments: 6, tint: true })
    .build();
}

const BUILDERS: Record<Piece, () => THREE.BufferGeometry> = {
  pallet,
  plankLayer,
  plank,
  sheet,
  mound,
  crate,
  cooler,
  wheel,
  chair,
  carpet,
  smalls,
  cone,
  bag,
};

export function buildPieceGeometry(piece: Piece): THREE.BufferGeometry {
  return BUILDERS[piece]();
}
