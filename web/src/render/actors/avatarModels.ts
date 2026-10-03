/**
 * The four vexillomancers as procedural low-poly SkinnedMeshes (one draw call each): a
 * shared 24-bone rig and per-character costume sculpted into a single geometry with vertex
 * colours and per-vertex surface params (roughness, metalness, glow; glow > 1 pulses to the
 * beat). Robes and coat tails are soft-skinned to front/back skirt bones so they swing.
 * - Dr. Beef Supreme: black balaclava, very tall Moebius hat wrapped by a turning Möbius band,
 *   golden vexillosaint robe with cyan trim and a Flag-yellow pentagram, flagpole staff.
 * - Dr. Beelzebub Crow: black feather-fringed tailcoat, crow mask with beak and crimson eyes.
 * - DJ Scarecrow: stitched burlap sack mask, straw hat, lime-glowing headphones, patchwork
 *   overalls over flannel, straw tufts.
 * - President Jaguar: royal purple robe with ermine and cape, rosette-spotted jaguar head,
 *   presidential sash and medallion, golden crown, sceptre staff.
 */
import * as THREE from 'three';
import { FLAG_YELLOW } from '../../sim/constants';
import { smoothstep } from '../../sim/math';
import type { FactionId } from '../../sim/types';
import { MeshBuilder, mobiusGeometry, starGeometry, type Tags, type Vec3, type VertexHook } from './meshBuilder';
import { GLSL_COMMON, METAL_CAP, clamp01, hash01 } from './util';

export const BONE_NAMES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'hat',
  'band',
  'armL',
  'foreL',
  'handL',
  'armR',
  'foreR',
  'handR',
  'staff',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
  'skirtF',
  'skirtB',
  'quiver',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  hat: 'head',
  band: 'hat',
  armL: 'chest',
  foreL: 'armL',
  handL: 'foreL',
  armR: 'chest',
  foreR: 'armR',
  handR: 'foreR',
  staff: 'handR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
  skirtF: 'hips',
  skirtB: 'hips',
  quiver: 'chest',
};

/** Bind-pose joint positions in character space (faces +z, feet at y = 0, left = +x). */
const BIND: Record<BoneName, Vec3> = {
  root: [0, 0, 0],
  hips: [0, 0.98, 0],
  spine: [0, 1.1, 0],
  chest: [0, 1.3, 0],
  neck: [0, 1.53, 0],
  head: [0, 1.6, 0],
  hat: [0, 1.8, 0],
  band: [0, 2.25, -0.005],
  armL: [0.23, 1.47, 0],
  foreL: [0.25, 1.19, 0],
  handL: [0.26, 0.95, 0.01],
  armR: [-0.23, 1.47, 0],
  foreR: [-0.25, 1.19, 0],
  handR: [-0.26, 0.95, 0.01],
  staff: [-0.26, 0.9, 0.03],
  thighL: [0.1, 0.95, 0],
  shinL: [0.1, 0.52, 0],
  footL: [0.1, 0.09, 0],
  thighR: [-0.1, 0.95, 0],
  shinR: [-0.1, 0.52, 0],
  footR: [-0.1, 0.09, 0],
  skirtF: [0, 0.98, 0.03],
  skirtB: [0, 0.98, -0.03],
  quiver: [0.1, 1.5, -0.21],
};

const IDX_HIPS = BONE_NAMES.indexOf('hips');
const IDX_CHEST = BONE_NAMES.indexOf('chest');
const IDX_SKIRT_F = BONE_NAMES.indexOf('skirtF');
const IDX_SKIRT_B = BONE_NAMES.indexOf('skirtB');

/** Quiver bind tilt: mouth behind the left shoulder, tube slanting to the right hip. */
const QUIVER_TILT = { x: -0.25, z: -0.35 } as const;
/** Staff extents along the staff bone's local +y (hand grip at 0). */
export const STAFF_TOP = 1.1;
const STAFF_BOTTOM = -0.86;

export type IdleStyle = 'mystic' | 'bird' | 'groove' | 'stately';

export interface AvatarStyle {
  idle: IdleStyle;
  /** Forward hunch of the chest at rest (rad). */
  hunch: number;
  /** Möbius band spin (rad/s); 0 for characters without one. */
  bandSpin: number;
  /** Top of the head or headgear in the bind pose (m): nameplates float above it. */
  crown: number;
}

export interface AvatarRig {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  geometry: THREE.BufferGeometry;
  style: AvatarStyle;
}

const ATTRS = [
  { name: 'color', size: 3 },
  { name: 'skinIndex', size: 4 },
  { name: 'skinWeight', size: 4 },
  { name: 'aSurf', size: 3 },
] as const;

/** Tags binding a primitive rigidly to one bone with a colour and surface params. */
function part(bone: BoneName, hex: number, rough = 0.8, metal = 0, glow = 0): Tags {
  const c = new THREE.Color(hex);
  return { color: [c.r, c.g, c.b], skinIndex: [BONE_NAMES.indexOf(bone), 0, 0, 0], skinWeight: [1, 0, 0, 0], aSurf: [rough, metal, glow] };
}

/** Glow values above 1 pulse with the beat in the avatar shader; `k` is the peak strength. */
function beatGlow(k: number): number {
  return 1 + k;
}

/** Soft skin for robes/tails: weight shifts from the hips to the front/back skirt bones downward. */
const skirtSkin: VertexHook = (p, _c, out) => {
  const down = clamp01((0.98 - p.y) / 0.9);
  const front = smoothstep(-0.1, 0.1, p.z);
  const wF = down * front * 0.95;
  const wB = down * (1 - front) * 0.95;
  out.skinIndex[0] = IDX_HIPS;
  out.skinIndex[1] = IDX_SKIRT_F;
  out.skinIndex[2] = IDX_SKIRT_B;
  out.skinWeight[0] = 1 - wF - wB;
  out.skinWeight[1] = wF;
  out.skinWeight[2] = wB;
};

/** Combine a colour hook with skirt skinning. */
function skirtWith(color: VertexHook): VertexHook {
  return (p, c, out) => {
    color(p, c, out);
    skirtSkin(p, c, out);
  };
}

function hashGrid(c: THREE.Vector3, scale: number, salt: number): number {
  return hash01(
    Math.floor(c.x * scale) * 73856093 ^ Math.floor(c.y * scale) * 19349663 ^ Math.floor(c.z * scale) * 83492791 ^ salt,
  );
}

function setColor(out: Record<string, number[]>, hex: number): void {
  const col = new THREE.Color(hex);
  out.color[0] = col.r;
  out.color[1] = col.g;
  out.color[2] = col.b;
}

/** Rosette spots on fur (per triangle). */
const jaguarSpots: VertexHook = (_p, c, out) => {
  if (hashGrid(c, 22, 11) > 0.7) setColor(out, 0x2a180a);
};

/** Ermine: white fur with black tail tips. */
const ermine: VertexHook = (_p, c, out) => {
  if (hashGrid(c, 18, 5) > 0.82) setColor(out, 0x101010);
};

/** Red/black flannel check. */
const flannel: VertexHook = (_p, c, out) => {
  const k = (Math.floor(c.x * 16) + Math.floor(c.y * 16)) & 1;
  setColor(out, k ? 0xa3262a : 0x22161a);
  if ((Math.floor(c.y * 32) & 3) === 0) setColor(out, 0xd9b45a);
};

/** Denim with sewn-on patches. */
const patchwork: VertexHook = (_p, c, out) => {
  const h = hashGrid(c, 9, 3);
  if (h > 0.9) setColor(out, 0xd9822b);
  else if (h > 0.82) setColor(out, 0x5a8a3a);
  else if (h > 0.76) setColor(out, 0x8a2a2a);
};

interface BodySpec {
  hands: number;
  trousers: number;
  boots: number;
  bootsRough: number;
  torso: number;
  torsoRough: number;
  torsoMetal: number;
  sleeves: number;
  head: number;
  headRough: number;
  chestWidth: number;
  torsoHook?: VertexHook;
  legHook?: VertexHook;
  headHook?: VertexHook;
  headJitter?: number;
}

/** The shared anatomy every vexillomancer is sculpted around. */
function body(b: MeshBuilder, s: BodySpec): void {
  for (const side of [1, -1]) {
    const L = side > 0;
    const x = 0.1 * side;
    b.with(part(L ? 'thighL' : 'thighR', s.trousers, 0.7), s.legHook ?? null).seg([x, 0.97, 0], [x, 0.51, 0], 0.082, 0.064, 7);
    b.with(part(L ? 'shinL' : 'shinR', s.trousers, 0.7), s.legHook ?? null).seg([x, 0.53, 0], [x, 0.11, 0], 0.063, 0.052, 7);
    b.with(part(L ? 'footL' : 'footR', s.boots, s.bootsRough)).box([x, 0.05, 0.05], [0.115, 0.1, 0.27]);
    const ax = 0.23 * side;
    b.with(part(L ? 'armL' : 'armR', s.sleeves, s.torsoRough, s.torsoMetal)).seg([ax, 1.49, 0], [ax * 1.08, 1.18, 0], 0.065, 0.055, 7);
    b.with(part(L ? 'foreL' : 'foreR', s.sleeves, s.torsoRough, s.torsoMetal)).seg([ax * 1.08, 1.2, 0], [ax * 1.13, 0.97, 0.01], 0.053, 0.045, 7);
    b.with(part(L ? 'handL' : 'handR', s.hands, 0.6)).ball([ax * 1.13, 0.905, 0.015], 0.05, 1, [0.8, 1.12, 1]);
  }
  b.with(part('hips', s.trousers, 0.7), s.legHook ?? null).box([0, 0.97, 0], [0.33, 0.17, 0.21]);
  const w = s.chestWidth;
  b.with(part('spine', s.torso, s.torsoRough, s.torsoMetal), s.torsoHook ?? null).seg([0, 0.96, 0], [0, 1.26, 0], 0.16 * w, 0.17 * w, 8, 0.72);
  b.with(part('chest', s.torso, s.torsoRough, s.torsoMetal), s.torsoHook ?? null)
    .seg([0, 1.22, 0], [0, 1.5, 0], 0.18 * w, 0.21 * w, 8, 0.68)
    .ball([0.215 * w, 1.46, 0], 0.08, 1)
    .ball([-0.215 * w, 1.46, 0], 0.08, 1);
  b.with(part('neck', s.hands, 0.7)).seg([0, 1.48, 0], [0, 1.62, 0], 0.056, 0.052, 7);
  b.with(part('head', s.head, s.headRough), s.headHook ?? null).ball([0, 1.7, 0.01], 0.13, 1, [0.94, 1.06, 1], s.headJitter ?? 0);
}

/** Quiver tube and chest strap; flags fan out of the mouth at the quiver bone origin. */
function quiver(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>, leather: number): void {
  const m = bones.quiver.matrixWorld;
  const tube = new THREE.CylinderGeometry(0.075, 0.062, 0.58, 9, 1, true).translate(0, -0.27, 0);
  b.with(part('quiver', leather, 0.65)).add(tube, m);
  b.with(part('quiver', 0x2a1a0e, 0.6)).add(new THREE.CircleGeometry(0.062, 9).rotateX(Math.PI / 2).translate(0, -0.56, 0), m);
  b.with(part('quiver', 0xc9a050, 0.35, 0.7)).add(new THREE.TorusGeometry(0.075, 0.012, 4, 12).rotateX(Math.PI / 2), m);
  b.with(part('chest', leather, 0.65)).box([0.0, 1.27, 0.138], [0.05, 0.66, 0.022], [0, 0, -0.62]);
}

/** The staff: a flagpole with a finial (variants tint the pole and finial). */
function staff(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>, pole: number, poleRough: number, poleMetal: number, finial: number, finialGlow: number): void {
  const m = bones.staff.matrixWorld;
  b.with(part('staff', pole, poleRough, poleMetal)).add(new THREE.CylinderGeometry(0.023, 0.026, STAFF_TOP - STAFF_BOTTOM, 7).translate(0, (STAFF_TOP + STAFF_BOTTOM) / 2, 0), m);
  b.with(part('staff', 0xc9a050, 0.3, 0.85)).add(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 8).translate(0, STAFF_TOP - 0.02, 0), m);
  b.with(part('staff', finial, 0.28, finialGlow > 0 ? 0.2 : 0.85, finialGlow)).add(new THREE.IcosahedronGeometry(0.058, 1).translate(0, STAFF_TOP + 0.06, 0), m);
}

function robeSkirt(b: MeshBuilder, color: number, rough: number, metal: number, hemColor: number, hemGlow: number, hook?: VertexHook): void {
  const pts = [new THREE.Vector2(0.205, 1.0), new THREE.Vector2(0.27, 0.72), new THREE.Vector2(0.36, 0.36), new THREE.Vector2(0.43, 0.08)];
  const skirt = new THREE.LatheGeometry(pts, 16);
  b.with(part('hips', color, rough, metal), hook ? skirtWith(hook) : skirtSkin).add(skirt);
  b.with(part('hips', hemColor, 0.4, 0.2, hemGlow), skirtSkin).torus([0, 0.09, 0], [0, 1, 0], 0.43, 0.022, 4, 24);
}

function makeBones(): Record<BoneName, THREE.Bone> {
  const bone = (name: BoneName) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  };
  const bones: Record<BoneName, THREE.Bone> = {
    root: bone('root'),
    hips: bone('hips'),
    spine: bone('spine'),
    chest: bone('chest'),
    neck: bone('neck'),
    head: bone('head'),
    hat: bone('hat'),
    band: bone('band'),
    armL: bone('armL'),
    foreL: bone('foreL'),
    handL: bone('handL'),
    armR: bone('armR'),
    foreR: bone('foreR'),
    handR: bone('handR'),
    staff: bone('staff'),
    thighL: bone('thighL'),
    shinL: bone('shinL'),
    footL: bone('footL'),
    thighR: bone('thighR'),
    shinR: bone('shinR'),
    footR: bone('footR'),
    skirtF: bone('skirtF'),
    skirtB: bone('skirtB'),
    quiver: bone('quiver'),
  };
  for (const n of BONE_NAMES) {
    const parent = PARENT[n];
    const p = BIND[n];
    if (parent) {
      const q = BIND[parent];
      bones[n].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      bones[parent].add(bones[n]);
    } else {
      bones[n].position.set(p[0], p[1], p[2]);
    }
  }
  bones.quiver.rotation.set(QUIVER_TILT.x, 0, QUIVER_TILT.z);
  bones.root.updateMatrixWorld(true);
  return bones;
}

function buildBeef(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>): AvatarStyle {
  const gold = 0xc9a23a;
  const cyan = 0x29e3ff;
  body(b, {
    hands: 0x0d0d10,
    trousers: 0x1d1d22,
    boots: 0x111111,
    bootsRough: 0.5,
    torso: gold,
    torsoRough: 0.38,
    torsoMetal: 0.55,
    sleeves: gold,
    head: 0x0b0b0e,
    headRough: 0.85,
    chestWidth: 1.02,
  });
  robeSkirt(b, gold, 0.38, 0.55, cyan, 0.8);
  // Stole down the front, following the skirt flare.
  b.with(part('chest', 0x13586e, 0.5, 0.1, 0.12)).box([0, 1.3, 0.152], [0.1, 0.38, 0.02]);
  b.with(part('hips', 0x13586e, 0.5, 0.1, 0.12), skirtSkin).box([0, 0.54, 0.322], [0.1, 0.93, 0.016], [-0.24, 0, 0]);
  // Bell sleeves with glowing cuffs, collar, pentagram emblem.
  for (const side of [1, -1]) {
    const L = side > 0;
    b.with(part(L ? 'foreL' : 'foreR', gold, 0.38, 0.55)).seg([0.25 * side, 1.18, 0], [0.275 * side, 0.94, 0.01], 0.064, 0.108, 9, 1, true);
    b.with(part(L ? 'foreL' : 'foreR', cyan, 0.4, 0.2, 0.9)).torus([0.276 * side, 0.94, 0.01], [0, 1, 0], 0.106, 0.012, 4, 14);
  }
  b.with(part('chest', gold, 0.35, 0.6)).torus([0, 1.5, 0], [0, 1, 0], 0.1, 0.038, 5, 14);
  b.with(part('chest', FLAG_YELLOW, 0.4, 0.1, 0.65)).add(starGeometry(0.058, 0.023, 0.012), new THREE.Matrix4().makeTranslation(0.095, 1.38, 0.148));
  // Balaclava eye slit: glossy void with a faint cyan glint — the face is never seen.
  b.with(part('head', 0x020203, 0.15, 0.3)).box([0, 1.715, 0.118], [0.15, 0.03, 0.03]);
  b.with(part('head', cyan, 0.3, 0, 0.5)).box([0, 1.715, 0.133], [0.11, 0.005, 0.004]);
  // The Moebius hat: a very tall black cylinder; the band lives on its own bone so it turns.
  b.with(part('hat', 0x101014, 0.5, 0.1)).seg([0, 1.79, -0.005], [0, 2.72, -0.005], 0.113, 0.119, 16);
  b.with(part('hat', cyan, 0.4, 0.1, 0.7)).seg([0, 1.785, -0.005], [0, 1.83, -0.005], 0.122, 0.122, 16);
  b.with(part('hat', gold, 0.3, 0.8)).torus([0, 2.72, -0.005], [0, 1, 0], 0.116, 0.013, 4, 18);
  b.with(part('band', 0xf0c850, 0.3, 0.45, 0.75)).add(mobiusGeometry(0.158, 0.075, 0.1, 120), bones.band.matrixWorld);
  quiver(b, bones, 0x6b4424);
  staff(b, bones, 0x9a6a3c, 0.7, 0, 0xe8c050, 0);
  // A cyan tassel under the finial.
  b.with(part('staff', cyan, 0.5, 0, 0.6)).add(
    new THREE.BoxGeometry(0.012, 0.16, 0.012).translate(0.03, STAFF_TOP - 0.1, 0),
    bones.staff.matrixWorld,
  );
  return { idle: 'mystic', hunch: 0, bandSpin: 0.9, crown: 2.74 };
}

function buildCrow(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>): AvatarStyle {
  const coat = 0x121216;
  const crimson = 0x9a1028;
  const feather = 0x101828;
  body(b, {
    hands: 0x2a2a2e,
    trousers: 0x0d0d10,
    boots: 0x050505,
    bootsRough: 0.22,
    torso: coat,
    torsoRough: 0.55,
    torsoMetal: 0.05,
    sleeves: coat,
    head: 0x0f0f11,
    headRough: 0.6,
    chestWidth: 0.94,
  });
  // Tuxedo front: satin lapels, shirt, crimson waistcoat, bow tie and pocket square.
  b.with(part('chest', 0xeeeeee, 0.5)).box([0, 1.37, 0.128], [0.08, 0.24, 0.02]);
  b.with(part('chest', 0x050507, 0.2, 0.1)).box([0.068, 1.36, 0.133], [0.06, 0.27, 0.02], [0, 0, 0.35]);
  b.with(part('chest', 0x050507, 0.2, 0.1)).box([-0.068, 1.36, 0.133], [0.06, 0.27, 0.02], [0, 0, -0.35]);
  b.with(part('spine', crimson, 0.4, 0.1)).box([0, 1.16, 0.122], [0.2, 0.22, 0.03]);
  b.with(part('chest', crimson, 0.35, 0.1, 0.35))
    .cone([0.008, 1.47, 0.145], [0.06, 1.47, 0.145], 0.026, 3)
    .cone([-0.008, 1.47, 0.145], [-0.06, 1.47, 0.145], 0.026, 3)
    .box([0.12, 1.39, 0.142], [0.045, 0.03, 0.012]);
  // Tails with feather fringe; soft-skinned to the back skirt bone.
  for (const side of [1, -1]) {
    b.with(part('hips', coat, 0.55), skirtSkin).box([0.075 * side, 0.73, -0.135], [0.13, 0.56, 0.03], [0.08, 0, 0.05 * side]);
    b.with(part('hips', crimson, 0.4), skirtSkin).box([0.075 * side, 0.73, -0.118], [0.115, 0.52, 0.006], [0.08, 0, 0.05 * side]);
    for (let i = 0; i < 3; i++) {
      const x = 0.075 * side + (i - 1) * 0.038;
      b.with(part('hips', feather, 0.35, 0.4, 0.05), skirtSkin).cone([x, 0.47, -0.155], [x * 1.15, 0.31 - i * 0.02, -0.17], 0.022, 3);
    }
  }
  // Fringe around the coat hem and cuffs, feather epaulettes.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.cos(a) < -0.4) continue;
    b.with(part('spine', feather, 0.35, 0.4, 0.05)).cone(
      [Math.sin(a) * 0.17, 0.99, Math.cos(a) * 0.125],
      [Math.sin(a) * 0.22, 0.86, Math.cos(a) * 0.16],
      0.022,
      3,
    );
  }
  for (const side of [1, -1]) {
    const L = side > 0;
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      b.with(part('chest', feather, 0.35, 0.4, 0.05)).cone(
        [0.21 * side, 1.5, Math.sin(a) * 0.06],
        [0.33 * side, 1.38 - Math.abs(a) * 0.05, Math.sin(a) * 0.12],
        0.03,
        3,
      );
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.with(part(L ? 'foreL' : 'foreR', feather, 0.35, 0.4, 0.05)).cone(
        [0.29 * side + Math.cos(a) * 0.04, 0.99, Math.sin(a) * 0.04],
        [0.3 * side + Math.cos(a) * 0.06, 0.89, Math.sin(a) * 0.06],
        0.018,
        3,
      );
    }
  }
  // Crow mask: beak, crimson eyes, swept feather crest.
  b.with(part('head', 0x2a2a2e, 0.25, 0.3))
    .cone([0, 1.715, 0.1], [0, 1.635, 0.39], 0.056, 6)
    .cone([0, 1.665, 0.095], [0, 1.625, 0.28], 0.036, 5);
  b.with(part('head', 0xff2040, 0.3, 0, 1.4)).ball([0.058, 1.735, 0.1], 0.023, 1).ball([-0.058, 1.735, 0.1], 0.023, 1);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.035;
    b.with(part('head', feather, 0.35, 0.4, 0.05)).cone([x, 1.79, -0.03], [x * 1.4, 1.93 - Math.abs(x), -0.2], 0.03, 3);
  }
  quiver(b, bones, 0x2a1a14);
  staff(b, bones, 0x1a1a1f, 0.3, 0.2, 0xff2040, 1.0);
  return { idle: 'bird', hunch: 0.14, bandSpin: 0, crown: 1.93 };
}

function buildScarecrow(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>): AvatarStyle {
  const denim = 0x355d8c;
  const straw = 0xe2c15a;
  const lime = 0x86ff4a;
  body(b, {
    hands: 0x6b4a2a,
    trousers: denim,
    boots: 0x4a2e1a,
    bootsRough: 0.8,
    torso: 0xa3262a,
    torsoRough: 0.9,
    torsoMetal: 0,
    sleeves: 0xa3262a,
    head: 0xb38f55,
    headRough: 1,
    chestWidth: 1.0,
    torsoHook: flannel,
    legHook: patchwork,
    headJitter: 0.09,
  });
  // Arms get the flannel too (re-sculpted sleeves over the defaults).
  for (const side of [1, -1]) {
    const L = side > 0;
    const ax = 0.23 * side;
    b.with(part(L ? 'armL' : 'armR', 0xa3262a, 0.9), flannel).seg([ax, 1.495, 0], [ax * 1.08, 1.18, 0], 0.068, 0.058, 7);
    b.with(part(L ? 'foreL' : 'foreR', 0xa3262a, 0.9), flannel).seg([ax * 1.08, 1.2, 0], [ax * 1.13, 0.98, 0.01], 0.056, 0.05, 7);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.with(part(L ? 'foreL' : 'foreR', straw, 0.9)).cone(
        [ax * 1.13 + Math.cos(a) * 0.03, 0.98, Math.sin(a) * 0.03],
        [ax * 1.2 + Math.cos(a) * 0.07, 0.86, Math.sin(a) * 0.07],
        0.016,
        3,
      );
      b.with(part(L ? 'shinL' : 'shinR', straw, 0.9)).cone(
        [0.1 * side + Math.cos(a) * 0.04, 0.16, Math.sin(a) * 0.04],
        [0.1 * side + Math.cos(a) * 0.09, 0.1, Math.sin(a) * 0.09],
        0.016,
        3,
      );
    }
  }
  // Overall bib, straps, buttons, and the lime EQ bars pumping to the set.
  b.with(part('chest', denim, 0.85), patchwork).box([0, 1.3, 0.13], [0.26, 0.3, 0.04]);
  for (const side of [1, -1]) {
    b.with(part('chest', denim, 0.85)).box([0.09 * side, 1.42, 0.0], [0.05, 0.03, 0.3], [0, 0, 0]);
    b.with(part('chest', 0xc0c0c8, 0.3, 0.8)).ball([0.09 * side, 1.43, 0.152], 0.016, 0);
  }
  for (let i = 0; i < 5; i++) {
    const h = 0.04 + ((i * 37) % 5) * 0.018;
    b.with(part('chest', lime, 0.3, 0, beatGlow(1.6 + i * 0.1))).box([(i - 2) * 0.042, 1.24 + h / 2, 0.152], [0.026, h, 0.006]);
  }
  // Rope at the neck with straw sprouting out.
  b.with(part('neck', 0xc8a86a, 0.9)).torus([0, 1.575, 0], [0, 1, 0], 0.064, 0.018, 4, 12);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.with(part('chest', straw, 0.9)).cone([Math.sin(a) * 0.07, 1.53, Math.cos(a) * 0.06], [Math.sin(a) * 0.16, 1.47, Math.cos(a) * 0.13], 0.018, 3);
  }
  // Stitched face: X eyes and a sewn grin.
  const thread = 0x24160c;
  for (const side of [1, -1]) {
    b.with(part('head', thread, 0.9))
      .box([0.05 * side, 1.73, 0.122], [0.055, 0.012, 0.012], [0, 0, 0.785])
      .box([0.05 * side, 1.73, 0.122], [0.055, 0.012, 0.012], [0, 0, -0.785]);
  }
  b.with(part('head', thread, 0.9)).box([0, 1.645, 0.118], [0.12, 0.008, 0.012]);
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.022;
    b.with(part('head', thread, 0.9)).box([x, 1.645 + x * x * 2.5, 0.12], [0.006, 0.032, 0.012]);
  }
  // Headphones under the straw hat.
  for (const side of [1, -1]) {
    b.with(part('head', 0x222226, 0.4, 0.3)).seg([0.118 * side, 1.71, 0], [0.165 * side, 1.71, 0], 0.062, 0.058, 10);
    b.with(part('head', lime, 0.3, 0, beatGlow(1.9))).torus([0.167 * side, 1.71, 0], [1, 0, 0], 0.05, 0.012, 4, 14);
  }
  b.with(part('head', 0x222226, 0.4, 0.3)).torus([0, 1.71, 0], [0, 0, 1], 0.158, 0.014, 4, 12, Math.PI);
  b.with(part('hat', straw, 0.9))
    .seg([0, 1.8, 0], [0, 1.815, 0], 0.31, 0.3, 18)
    .seg([0, 1.8, 0], [0, 1.94, 0], 0.152, 0.136, 12);
  b.with(part('hat', lime, 0.4, 0, beatGlow(1.5))).seg([0, 1.815, 0], [0, 1.855, 0], 0.155, 0.153, 12);
  quiver(b, bones, 0x5a3a1e);
  staff(b, bones, 0x7a5a32, 0.85, 0, lime, 1.2);
  b.with(part('staff', 0x1a1a1a, 0.4, 0.5)).add(
    new THREE.TorusGeometry(0.06, 0.008, 4, 14).rotateX(Math.PI / 2).translate(0, STAFF_TOP + 0.06, 0),
    bones.staff.matrixWorld,
  );
  return { idle: 'groove', hunch: 0.05, bandSpin: 0, crown: 1.94 };
}

function buildJaguar(b: MeshBuilder, bones: Record<BoneName, THREE.Bone>): AvatarStyle {
  const purple = 0x4a1f78;
  const gold = 0xe0b84a;
  const fur = 0xe0a238;
  body(b, {
    hands: 0xf4f4f0,
    trousers: 0x24122f,
    boots: 0x1a0f22,
    bootsRough: 0.35,
    torso: purple,
    torsoRough: 0.35,
    torsoMetal: 0.15,
    sleeves: purple,
    head: fur,
    headRough: 0.7,
    chestWidth: 1.1,
    headHook: jaguarSpots,
  });
  robeSkirt(b, purple, 0.35, 0.15, 0xf2efe6, 0, ermine);
  for (const side of [1, -1]) {
    const L = side > 0;
    b.with(part(L ? 'foreL' : 'foreR', purple, 0.35, 0.15)).seg([0.25 * side, 1.18, 0], [0.275 * side, 0.95, 0.01], 0.064, 0.1, 9, 1, true);
    b.with(part(L ? 'foreL' : 'foreR', 0xf2efe6, 0.9), ermine).torus([0.276 * side, 0.95, 0.01], [0, 1, 0], 0.1, 0.022, 4, 12);
  }
  // Ermine collar and the royal cape.
  b.with(part('chest', 0xf2efe6, 0.9), ermine).torus([0, 1.5, -0.01], [0, 1, 0], 0.15, 0.055, 5, 16);
  const cape: VertexHook = (p, _c, out) => {
    const down = clamp01((1.3 - p.y) / 1.0);
    out.skinIndex[0] = IDX_CHEST;
    out.skinIndex[1] = IDX_SKIRT_B;
    out.skinWeight[0] = 1 - down;
    out.skinWeight[1] = down;
  };
  b.with(part('chest', 0x3a1660, 0.4, 0.1), cape).box([0, 0.92, -0.215], [0.5, 1.12, 0.03], [0.1, 0, 0]);
  b.with(part('chest', 0xf2efe6, 0.9), (p, c, out) => {
    ermine(p, c, out);
    cape(p, c, out);
  }).box([0, 0.38, -0.27], [0.52, 0.06, 0.05], [0.1, 0, 0]);
  // Presidential sash with medallion.
  b.with(part('chest', gold, 0.35, 0.6)).box([0, 1.27, 0.168], [0.075, 0.62, 0.02], [0, 0, 0.62]);
  b.with(part('chest', 0x7a1f3a, 0.4, 0.2)).box([0, 1.27, 0.18], [0.022, 0.6, 0.006], [0, 0, 0.62]);
  b.with(part('chest', gold, 0.25, 0.85, 0.25)).seg([-0.04, 1.2, 0.17], [-0.04, 1.2, 0.19], 0.048, 0.048, 12);
  b.with(part('chest', 0xa45cff, 0.2, 0.1, 0.9)).ball([-0.04, 1.2, 0.195], 0.02, 1);
  // Jaguar face: muzzle, nose, glowing eyes, ears.
  b.with(part('head', 0xf3e2c2, 0.8)).ball([0, 1.66, 0.1], 0.066, 1, [1.1, 0.75, 0.9]);
  b.with(part('head', 0x3a2020, 0.5)).cone([0, 1.695, 0.155], [0, 1.678, 0.172], 0.022, 3);
  b.with(part('head', 0xc8ff3a, 0.3, 0, 0.9)).ball([0.055, 1.735, 0.108], 0.021, 1).ball([-0.055, 1.735, 0.108], 0.021, 1);
  for (const side of [1, -1]) {
    b.with(part('head', fur, 0.7), jaguarSpots).cone([0.085 * side, 1.79, -0.01], [0.105 * side, 1.875, -0.02], 0.048, 5);
  }
  // Golden crown with amethyst points.
  b.with(part('hat', gold, 0.25, 0.85)).seg([0, 1.8, 0], [0, 1.865, 0], 0.104, 0.116, 10, 1, true);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.sin(a) * 0.112;
    const z = Math.cos(a) * 0.112;
    b.with(part('hat', gold, 0.25, 0.85)).cone([x, 1.86, z], [x * 1.05, 1.96, z * 1.05], 0.026, 4);
    b.with(part('hat', 0xa45cff, 0.2, 0.1, 0.9)).ball([x * 1.04, 1.835, z * 1.04], 0.018, 0);
  }
  quiver(b, bones, 0x3a1a2a);
  staff(b, bones, gold, 0.3, 0.85, 0xa45cff, 0.9);
  return { idle: 'stately', hunch: -0.06, bandSpin: 0, crown: 1.97 };
}

const BUILDERS: Record<FactionId, (b: MeshBuilder, bones: Record<BoneName, THREE.Bone>) => AvatarStyle> = {
  0: buildBeef,
  1: buildCrow,
  2: buildScarecrow,
  3: buildJaguar,
};

export interface AvatarUniforms {
  uTime: THREE.IUniform<number>;
  uBeat: THREE.IUniform<number>;
  uDissolve: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
  uGlowBoost: THREE.IUniform<number>;
  uEdge: THREE.IUniform<THREE.Color>;
}

/** Standard material + per-vertex surface params, beat-pulsed glow, dissolve and hit flash. */
export function createAvatarMaterial(u: AvatarUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSurf;\nvarying vec3 vSurf;\nvarying vec3 vBind;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSurf = aSurf;\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uBeat;
        uniform float uDissolve;
        uniform float uFlash;
        uniform float uGlowBoost;
        uniform vec3 uEdge;
        varying vec3 vSurf;
        varying vec3 vBind;
        ${GLSL_COMMON}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float fhNoise = fhHash13(floor(vBind * 26.0));
        if (uDissolve > 0.0 && fhNoise < uDissolve) discard;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = min(vSurf.y, ${METAL_CAP.toFixed(2)});`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fhGlow = vSurf.z > 1.0 ? (vSurf.z - 1.0) * (0.3 + 0.7 * uBeat) : vSurf.z;
        totalEmissiveRadiance += diffuseColor.rgb * fhGlow * (1.0 + uGlowBoost);
        float fhEdge = (1.0 - smoothstep(uDissolve, uDissolve + 0.09, fhNoise)) * step(0.001, uDissolve);
        totalEmissiveRadiance += uEdge * fhEdge * 4.0 + vec3(uFlash);`,
      );
  };
  mat.customProgramCacheKey = () => 'fh-avatar';
  return mat;
}

/** Build the rig for one faction's vexillomancer (bind pose at the origin). */
export function buildAvatarRig(faction: FactionId, material: THREE.Material): AvatarRig {
  const bones = makeBones();
  const b = new MeshBuilder(ATTRS);
  const style = BUILDERS[faction](b, bones);
  const geometry = b.build();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  return { mesh, bones, geometry, style };
}
