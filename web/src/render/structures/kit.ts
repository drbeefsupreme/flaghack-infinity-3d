/**
 * StructureKit: the shared resources of the structures layer for one match.
 *
 * - Canvas textures (lazily painted, shared by every building).
 * - The structure material family: MeshStandardMaterial patched once (onBeforeCompile with
 *   identical source, so every clone shares one compiled program) with per-building
 *   uniforms: procedural cracks + scorch for damage, the rising construction reveal with a
 *   glowing seam, emissive flicker for disabled buildings, night glow for yellow cloth, and
 *   an optional cloth wave (Flags, pennants, the GCC banner, which also gets a separate
 *   back-face texture).
 * - ModelBuilder: assembles a building from primitives and merges them per material, so a
 *   building costs one draw call per material; finished models are cached per kind.
 * - Holographic material for construction blueprints and placement ghosts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLAG_YELLOW, NEUTRAL_COLOR } from '../../sim/constants';
import {
  paintBannerBack,
  paintBannerFront,
  paintBark,
  paintBricks,
  paintBusSide,
  paintEmbers,
  paintEye,
  paintPuff,
  paintRadialGlow,
  paintRunes,
  paintScroll,
  paintSigil,
  paintStoneBlocks,
  paintStringArt,
  paintTarp,
  paintWoodGrain,
} from './canvasArt';

export type Quality = 'low' | 'medium' | 'high';

// ── Textures ─────────────────────────────────────────────────────────────────

export type TexKey =
  | 'wood'
  | 'bark'
  | 'stone'
  | 'brick'
  | 'tarp'
  | 'sigil'
  | 'bannerFront'
  | 'bannerBack'
  | 'stringArtA'
  | 'stringArtB'
  | 'scroll'
  | 'embers'
  | 'puff'
  | 'glow'
  | 'eye'
  | 'runes'
  | 'bus';

interface TexSpec {
  paint: (scale: number) => HTMLCanvasElement;
  /** Tiles across surfaces (RepeatWrapping). */
  tile: boolean;
}

const TEXTURES: Record<TexKey, TexSpec> = {
  wood: { paint: (s) => paintWoodGrain(256 * s, 11), tile: true },
  bark: { paint: (s) => paintBark(256 * s, 12), tile: true },
  stone: { paint: (s) => paintStoneBlocks(256 * s, 13), tile: true },
  brick: { paint: (s) => paintBricks(256 * s, 14), tile: true },
  tarp: { paint: (s) => paintTarp(512 * s, 256 * s, 15), tile: false },
  sigil: { paint: (s) => paintSigil(576 * s, 320 * s, 5), tile: false },
  bannerFront: { paint: (s) => paintBannerFront(1024 * s, 512 * s), tile: false },
  bannerBack: { paint: (s) => paintBannerBack(1024 * s, 512 * s), tile: false },
  stringArtA: { paint: (s) => paintStringArt(512 * s, 3), tile: false },
  stringArtB: { paint: (s) => paintStringArt(512 * s, 8), tile: false },
  scroll: { paint: (s) => paintScroll(256 * s, 512 * s, 21), tile: false },
  embers: { paint: (s) => paintEmbers(256 * s, 22), tile: true },
  puff: { paint: () => paintPuff(128, 23), tile: false },
  glow: { paint: () => paintRadialGlow(128), tile: false },
  eye: { paint: (s) => paintEye(256 * s), tile: false },
  runes: { paint: (s) => paintRunes(320 * s, 512 * s, 24), tile: false },
  bus: { paint: (s) => paintBusSide(1024 * s, 512 * s, 25), tile: false },
};

// ── Materials ────────────────────────────────────────────────────────────────

export type MatKey =
  | 'wood'
  | 'woodDark'
  | 'woodPale'
  | 'woodPaint'
  | 'bark'
  | 'black'
  | 'sigil'
  | 'iron'
  | 'brass'
  | 'copper'
  | 'glass'
  | 'window'
  | 'rubber'
  | 'stone'
  | 'brick'
  | 'ember'
  | 'cloth'
  | 'clothStill'
  | 'clothPale'
  | 'trim'
  | 'trimCloth'
  | 'runes'
  | 'canopy'
  | 'tarp'
  | 'parchment'
  | 'rope'
  | 'paint'
  | 'plain'
  | 'lamp'
  | 'banner'
  | 'table'
  | 'drumTopA'
  | 'drumTopB'
  | 'eye'
  | 'bus';

interface WaveSpec {
  /** Displacement amplitude along the surface normal (local units). */
  amp: number;
  /** Radians of wave phase across u = 0..1. */
  freq: number;
  speed: number;
  /** 0 = Flag (hoist pinned at u = 0), 1 = banner (lashed at both ends). */
  pin: number;
  /** Local width of the cloth along u (scales the ripple shading slope). */
  width: number;
}

interface MatSpec {
  color: number;
  roughness: number;
  metalness?: number;
  map?: TexKey;
  /** Repeat of the map across the surface's UV range (texture clone sharing the image). */
  mapRepeat?: readonly [number, number];
  emissive?: number;
  emissiveIntensity?: number;
  emissiveMap?: TexKey;
  /** Self-illumination at night as a fraction of the albedo (Flags glow after dusk). */
  nightGlow?: number;
  /** Fixed colour emitted at night (lit windows), scaled by the night factor. */
  nightColor?: number;
  /** Exempt from the near-camera dither fade (the GCC table must stay solid for the dive). */
  solidNearCamera?: boolean;
  wave?: WaveSpec;
  doubleSide?: boolean;
  vertexColors?: boolean;
  /** How the owner's faction colour applies: trim (albedo + emissive), tint (albedo mix), glow (emissive only). */
  faction?: 'trim' | 'tint' | 'glow';
}

const FLAG_WAVE: WaveSpec = { amp: 0.07, freq: 7, speed: 6.5, pin: 0, width: 1 };

const MATERIALS: Record<MatKey, MatSpec> = {
  wood: { color: 0xa87a4f, roughness: 0.85, map: 'wood' },
  woodDark: { color: 0x5e4330, roughness: 0.9, map: 'wood' },
  woodPale: { color: 0xe0c08e, roughness: 0.8, map: 'wood' },
  /** Grain texture × per-part vertex colour: one draw call for mixed timbers (pieces). */
  woodPaint: { color: 0xffffff, roughness: 0.82, map: 'wood', vertexColors: true },
  bark: { color: 0xffffff, roughness: 0.95, map: 'bark' },
  black: { color: 0x101012, roughness: 0.5, metalness: 0.15 },
  sigil: { color: 0xffffff, roughness: 0.5, metalness: 0.1, map: 'sigil' },
  iron: { color: 0x3c3e42, roughness: 0.55, metalness: 0.75 },
  brass: { color: 0xd9a63a, roughness: 0.3, metalness: 0.9 },
  copper: { color: 0xd07a4a, roughness: 0.28, metalness: 0.95 },
  glass: { color: 0x14202c, roughness: 0.12, metalness: 0.4 },
  window: { color: 0x1c2836, roughness: 0.1, metalness: 0.3, nightColor: 0xd08040 },
  rubber: { color: 0x161616, roughness: 0.9 },
  stone: { color: 0xc4bdb2, roughness: 0.95, map: 'stone' },
  brick: { color: 0xffffff, roughness: 0.9, map: 'brick' },
  ember: { color: 0x1c1410, roughness: 1, emissive: 0xff6a1a, emissiveIntensity: 1.8, emissiveMap: 'embers' },
  cloth: { color: FLAG_YELLOW, roughness: 0.7, nightGlow: 0.35, wave: FLAG_WAVE, doubleSide: true },
  clothStill: { color: FLAG_YELLOW, roughness: 0.7, nightGlow: 0.35, doubleSide: true },
  clothPale: {
    color: 0xf4e4a2,
    roughness: 0.8,
    nightGlow: 0.12,
    wave: { amp: 0.035, freq: 5, speed: 2.6, pin: 0, width: 0.6 },
    doubleSide: true,
  },
  trim: { color: NEUTRAL_COLOR, roughness: 0.4, emissive: NEUTRAL_COLOR, emissiveIntensity: 0.9, faction: 'trim' },
  trimCloth: {
    color: NEUTRAL_COLOR,
    roughness: 0.7,
    emissive: NEUTRAL_COLOR,
    emissiveIntensity: 0.25,
    wave: { amp: 0.06, freq: 8, speed: 8, pin: 0, width: 1 },
    doubleSide: true,
    faction: 'trim',
  },
  runes: {
    color: 0xf2eadf,
    roughness: 0.9,
    map: 'stone',
    mapRepeat: [5, 3],
    emissive: NEUTRAL_COLOR,
    emissiveIntensity: 1.4,
    emissiveMap: 'runes',
    faction: 'glow',
  },
  canopy: { color: 0xe8e2d2, roughness: 0.85, map: 'tarp', doubleSide: true, faction: 'tint' },
  tarp: { color: 0xffffff, roughness: 0.85, map: 'tarp', doubleSide: true },
  parchment: { color: 0xffffff, roughness: 0.9, map: 'scroll', doubleSide: true },
  rope: { color: 0xb59a6a, roughness: 1 },
  paint: { color: 0xffffff, roughness: 0.6, vertexColors: true },
  /** White base for instanced parts coloured per instance (drums, skins). */
  plain: { color: 0xffffff, roughness: 0.6 },
  lamp: { color: 0xffe2a8, roughness: 0.4, emissive: 0xffb04a, emissiveIntensity: 0.25, nightGlow: 2.2 },
  banner: {
    color: 0xffffff,
    roughness: 0.75,
    map: 'bannerFront',
    nightGlow: 0.22,
    wave: { amp: 0.05, freq: 9, speed: 2.4, pin: 1, width: 2 },
    doubleSide: true,
  },
  table: { color: 0xffffff, roughness: 0.42, metalness: 0.05, solidNearCamera: true },
  drumTopA: { color: 0xffffff, roughness: 0.6, map: 'stringArtA', nightGlow: 0.25 },
  drumTopB: { color: 0xffffff, roughness: 0.6, map: 'stringArtB', nightGlow: 0.25 },
  eye: { color: 0xffffff, roughness: 0.35, metalness: 0.2, map: 'eye', emissiveMap: 'eye', emissive: 0xffffff, emissiveIntensity: 0.35 },
  bus: { color: 0xffffff, roughness: 0.55, map: 'bus' },
};

/** Uniform slot shared by reference between the materials of one building. */
export interface Slot {
  value: number;
}

/** Per-building shader state (all materials of a building share these objects). */
export interface BuildingUniforms {
  /** 0..1 cracks + scorch. */
  uDamage: Slot;
  /** World y above which fragments are discarded (construction reveal); 1e5 = whole. */
  uReveal: Slot;
  /** Emissive multiplier (disabled flicker, destroyed = dark). */
  uFlicker: Slot;
  /** 0..1 albedo darkening (disabled, wrecked). */
  uDarken: Slot;
}

export const NO_REVEAL = 1e5;

/** A patched material and its own uniforms (wave, night glow, banner back face). */
export interface StructureMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

export function createBuildingUniforms(): BuildingUniforms {
  return { uDamage: { value: 0 }, uReveal: { value: NO_REVEAL }, uFlicker: { value: 1 }, uDarken: { value: 0 } };
}

const VERT_PARS = /* glsl */ `
uniform float uTime;
varying vec3 vStructWorld;
#ifdef STRUCT_WAVE
uniform float uWindPhase;
uniform float uWind;
uniform float uWaveAmp;
uniform float uWaveFreq;
uniform float uWaveSpeed;
uniform float uWavePin;
uniform float uClothWidth;
varying float vStructRipple;
// Travelling cloth wave: x = displacement along the normal, y = ripple slope (for shading).
// Phase advances with the integrated wind (no jumps when gusts change), amplitude with its strength.
vec2 structWave(vec2 st) {
  vec3 o = modelMatrix[3].xyz;
  #ifdef USE_INSTANCING
  o += instanceMatrix[3].xyz;
  #endif
  float ph = dot(o.xz, vec2(0.71, 1.37));
  float env = mix(st.x, sin(3.14159265 * st.x), uWavePin);
  float amp = uWaveAmp * (0.45 + 0.55 * uWind);
  float arg = st.x * uWaveFreq - uWindPhase * uWaveSpeed + ph;
  float arg2 = arg * 0.57 + st.y * 2.3 + ph * 1.3;
  float dz = (sin(arg) + 0.35 * sin(arg2)) * amp * env;
  float slope = (cos(arg) + 0.2 * cos(arg2)) * uWaveFreq * amp * env / uClothWidth;
  return vec2(dz, slope);
}
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uDamage;
uniform float uReveal;
uniform float uFlicker;
uniform float uDarken;
uniform float uNightGlow;
uniform vec3 uNightColor;
uniform float uNearFade;
varying vec3 vStructWorld;
#ifdef STRUCT_WAVE
varying float vStructRipple;
#endif
#ifdef STRUCT_BANNER
uniform sampler2D uMapBack;
#endif
float structHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float structNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(structHash(i), structHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(structHash(i + vec3(0.0, 1.0, 0.0)), structHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(structHash(i + vec3(0.0, 0.0, 1.0)), structHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(structHash(i + vec3(0.0, 1.0, 1.0)), structHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
vec3 structHash3(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
// Crack lines = Voronoi cell borders (F2 - F1 small), evaluated in world space so they
// run continuously across every face without UVs.
float structCracks(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = g + structHash3(i + g) - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
  }
  return 1.0 - smoothstep(0.0, 0.05, sqrt(d2) - sqrt(d1));
}
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
`;

const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
#ifdef STRUCT_WAVE
{
  vec2 structW = structWave(uv);
  transformed += normalize(objectNormal) * structW.x;
  vStructRipple = structW.y;
}
#endif
`;

const VERT_PROJECT = /* glsl */ `
#include <project_vertex>
{
  vec4 structWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  structWp = instanceMatrix * structWp;
  #endif
  vStructWorld = (modelMatrix * structWp).xyz;
}
`;

const FRAG_MAP = /* glsl */ `
#ifdef STRUCT_BANNER
  vec4 sampledDiffuseColor = gl_FrontFacing ? texture2D(map, vMapUv) : texture2D(uMapBack, vec2(1.0 - vMapUv.x, vMapUv.y));
  diffuseColor *= sampledDiffuseColor;
#else
  #include <map_fragment>
#endif
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
if (vStructWorld.y > uReveal) discard;
// Third-person occluder fade: screen-door dither as the camera boom pushes into a structure.
if (uNearFade > 0.5) {
  float structKeep = smoothstep(0.55, 1.7, distance(vStructWorld, cameraPosition));
  if (structKeep < 0.999 && structKeep < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
}
#ifdef STRUCT_WAVE
diffuseColor.rgb *= clamp(1.0 + vStructRipple * 0.45, 0.55, 1.35);
#endif
if (uDamage > 0.001) {
  float structMask = smoothstep(0.9 - uDamage * 0.7, 1.0 - uDamage * 0.7, structNoise(vStructWorld * 0.9 + 3.1));
  float structCrack = structCracks(vStructWorld * 2.6) * structMask;
  float structScorch = structNoise(vStructWorld * 1.9);
  diffuseColor.rgb *= (1.0 - 0.5 * uDamage * structScorch) * (1.0 - 0.85 * structCrack);
}
diffuseColor.rgb *= 1.0 - uDarken;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uNightGlow * uNight + uNightColor * uNight;
totalEmissiveRadiance *= uFlicker;
totalEmissiveRadiance += vec3(0.25, 0.85, 1.0) * (1.0 - smoothstep(0.0, 0.16, uReveal - vStructWorld.y)) * 1.5;
`;

/** Inject the structure features into a MeshStandardMaterial program. */
function applyStructurePatch(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = VERT_PARS + shader.vertexShader
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <begin_vertex>', VERT_BEGIN)
    .replace('#include <project_vertex>', VERT_PROJECT);
  shader.fragmentShader = FRAG_PARS + shader.fragmentShader
    .replace('#include <map_fragment>', FRAG_MAP)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
}

/** Shared per-frame uniforms (presentation clock, night factor, wind). */
export interface GlobalUniforms {
  uTime: Slot;
  uNight: Slot;
  /** Integrated wind phase (s·gust): drives every cloth wave without phase jumps. */
  uWindPhase: Slot;
  /** Wind strength 0..1.5. */
  uWind: Slot;
}

// ── Model building ───────────────────────────────────────────────────────────

export type Vec3Tuple = readonly [number, number, number];
export type ModelGeometry = ReadonlyMap<MatKey, THREE.BufferGeometry>;
/** A named, cacheable model: views and placement ghosts share the same merged geometry. */
export interface ModelRecipe {
  name: string;
  build: (mb: ModelBuilder) => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Assembles a model from primitives in a transform stack, then merges per material.
 * Geometries handed to `add` are consumed (transformed in place, disposed after merging).
 */
export class ModelBuilder {
  private readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly color = new THREE.Color();

  /** Place subsequent parts inside a local frame (position, Euler XYZ, uniform scale). */
  push(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, scale = 1): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(scale, scale, scale));
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(this.m));
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  /** Add a geometry placed by position / Euler XYZ rotation / scale in the current frame. */
  add(
    key: MatKey,
    geom: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    color = 0xffffff,
  ): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.m.premultiply(this.stack[this.stack.length - 1]);
    geom.applyMatrix4(this.m);
    this.collect(key, geom, color);
  }

  /** Add a geometry placed by an arbitrary matrix in the current frame. */
  addMatrix(key: MatKey, geom: THREE.BufferGeometry, m: THREE.Matrix4, color = 0xffffff): void {
    this.m.copy(m).premultiply(this.stack[this.stack.length - 1]);
    geom.applyMatrix4(this.m);
    this.collect(key, geom, color);
  }

  box(key: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, color = 0xffffff): void {
    this.add(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz, 1, 1, 1, color);
  }

  cyl(
    key: MatKey,
    rTop: number,
    rBottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    segs = 12,
    rx = 0,
    ry = 0,
    rz = 0,
    color = 0xffffff,
  ): void {
    this.add(key, new THREE.CylinderGeometry(rTop, rBottom, h, segs), x, y, z, rx, ry, rz, 1, 1, 1, color);
  }

  /** Round rod (pole, spoke, leg) from a to b. */
  rod(key: MatKey, a: Vec3Tuple, b: Vec3Tuple, r: number, segs = 8, color = 0xffffff): void {
    this.d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = this.d.length();
    if (len < 1e-5) return;
    const g = new THREE.CylinderGeometry(r, r, len, segs);
    this.q.setFromUnitVectors(UP, this.d.multiplyScalar(1 / len));
    this.m.compose(this.p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), this.q, this.s.set(1, 1, 1));
    this.m.premultiply(this.stack[this.stack.length - 1]);
    g.applyMatrix4(this.m);
    this.collect(key, g, color);
  }

  /** Rectangular beam (plank, rail, brace) from a to b; w = width, h = height of the section. */
  beam(key: MatKey, a: Vec3Tuple, b: Vec3Tuple, w: number, h: number, color = 0xffffff): void {
    this.d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = this.d.length();
    if (len < 1e-5) return;
    const g = new THREE.BoxGeometry(len, h, w);
    this.q.setFromUnitVectors(X_AXIS, this.d.multiplyScalar(1 / len));
    this.m.compose(this.p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), this.q, this.s.set(1, 1, 1));
    this.m.premultiply(this.stack[this.stack.length - 1]);
    g.applyMatrix4(this.m);
    this.collect(key, g, color);
  }

  private collect(key: MatKey, geom: THREE.BufferGeometry, color: number): void {
    for (const name of Object.keys(geom.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geom.deleteAttribute(name);
    }
    if (MATERIALS[key].vertexColors) {
      this.color.setHex(color);
      const n = geom.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = this.color.r;
        arr[i * 3 + 1] = this.color.g;
        arr[i * 3 + 2] = this.color.b;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    let list = this.parts.get(key);
    if (!list) {
      list = [];
      this.parts.set(key, list);
    }
    list.push(geom);
  }

  /** Merge collected parts into one geometry per material. */
  build(): ModelGeometry {
    const out = new Map<MatKey, THREE.BufferGeometry>();
    for (const [key, list] of this.parts) {
      const mixed = list.some((g) => g.index === null);
      const ready = mixed ? list.map((g) => (g.index === null ? g : g.toNonIndexed())) : list;
      const merged = mergeGeometries(ready, false);
      merged.computeBoundingSphere();
      out.set(key, merged);
      for (const g of list) g.dispose();
      if (mixed) for (const g of ready) g.dispose();
    }
    this.parts.clear();
    return out;
  }
}

// ── Holographic material (blueprints, placement ghosts) ──────────────────────

const HOLO_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 wp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  n = mat3(instanceMatrix) * n;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uReveal;
uniform float uPulse;
uniform float uOpacity;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  if (vWorld.y < uReveal) discard;
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(normalize(vNormalW), v)), 2.0);
  float scan = smoothstep(0.65, 1.0, sin(vWorld.y * 14.0 - uTime * 5.0));
  float pulse = 1.0 + uPulse * 0.35 * sin(uTime * 6.0);
  float a = (0.12 + 0.6 * fres + 0.18 * scan) * pulse * uOpacity;
  gl_FragColor = vec4(uColor * (0.7 + 0.8 * fres + 0.4 * scan), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export interface HoloUniforms {
  uColor: THREE.IUniform<THREE.Color>;
  uTime: Slot;
  /** Fragments below this world y are discarded (blueprint above the construction seam). */
  uReveal: Slot;
  /** 0..1 pulse strength (invalid placement throbs). */
  uPulse: Slot;
  uOpacity: Slot;
}

// ── The kit ──────────────────────────────────────────────────────────────────

export class StructureKit {
  readonly global: GlobalUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uWindPhase: { value: 0 }, uWind: { value: 0.6 } };
  /**
   * Shadow-depth material for every structure InstancedMesh (all of them carry instance
   * colours). Without it three.js's single default depth material would be drawn by both
   * instanced and plain casters and re-derive its program on every alternation.
   */
  readonly instancedDepth = new THREE.MeshDepthMaterial();
  readonly quality: Quality;
  private readonly textures = new Map<TexKey, THREE.CanvasTexture>();
  private readonly repeats = new Map<string, THREE.Texture>();
  private readonly models = new Map<string, ModelGeometry>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly anisotropy: number;
  private readonly texScale: number;
  /** Live GCC table map (owned by TableMap; the kit only hands it to 'table' materials). */
  tableTexture: THREE.Texture | null = null;

  constructor(renderer: THREE.WebGLRenderer, quality: Quality) {
    this.quality = quality;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.texScale = quality === 'low' ? 0.5 : 1;
  }

  texture(key: TexKey): THREE.CanvasTexture {
    let t = this.textures.get(key);
    if (!t) {
      const spec = TEXTURES[key];
      t = new THREE.CanvasTexture(spec.paint(this.texScale));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.anisotropy;
      if (spec.tile) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
      }
      this.textures.set(key, t);
    }
    return t;
  }

  /** A repeat variant of a tiling texture; shares the source image (uploaded once). */
  private tiled(key: TexKey, repeat: readonly [number, number]): THREE.Texture {
    const name = `${key}@${repeat[0]}x${repeat[1]}`;
    let t = this.repeats.get(name);
    if (!t) {
      t = this.texture(key).clone();
      t.repeat.set(repeat[0], repeat[1]);
      this.repeats.set(name, t);
    }
    return t;
  }

  /** Cached merged model (per building kind / prop), built on first use. */
  model(name: string, build: (mb: ModelBuilder) => void): ModelGeometry {
    let m = this.models.get(name);
    if (!m) {
      const mb = new ModelBuilder();
      build(mb);
      m = mb.build();
      this.models.set(name, m);
    }
    return m;
  }

  /** Cached single geometry shared by many meshes (cloth planes, wheels, flames). */
  geometry(name: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(name);
    if (!g) {
      g = make();
      this.geometries.set(name, g);
    }
    return g;
  }

  /** A fresh structure material for `key`, bound to a building's uniforms (plus its own wave/glow uniforms). */
  createMaterial(key: MatKey, u: BuildingUniforms): StructureMaterial {
    const spec = MATERIALS[key];
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0,
      side: spec.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: spec.vertexColors ?? false,
    });
    if (spec.map) mat.map = spec.mapRepeat ? this.tiled(spec.map, spec.mapRepeat) : this.texture(spec.map);
    if (key === 'table' && this.tableTexture) mat.map = this.tableTexture;
    if (spec.emissive !== undefined) {
      mat.emissive.setHex(spec.emissive);
      mat.emissiveIntensity = spec.emissiveIntensity ?? 1;
    }
    if (spec.emissiveMap) mat.emissiveMap = this.texture(spec.emissiveMap);
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: this.global.uTime,
      uNight: this.global.uNight,
      uWindPhase: this.global.uWindPhase,
      uWind: this.global.uWind,
      uDamage: u.uDamage,
      uReveal: u.uReveal,
      uFlicker: u.uFlicker,
      uDarken: u.uDarken,
      uNightGlow: { value: spec.nightGlow ?? 0 },
      uNightColor: { value: new THREE.Color(spec.nightColor ?? 0) },
      uNearFade: { value: spec.solidNearCamera ? 0 : 1 },
    };
    const defines: Record<string, string> = {};
    if (spec.wave) {
      defines.STRUCT_WAVE = '';
      uniforms.uWaveAmp = { value: spec.wave.amp };
      uniforms.uWaveFreq = { value: spec.wave.freq };
      uniforms.uWaveSpeed = { value: spec.wave.speed };
      uniforms.uWavePin = { value: spec.wave.pin };
      uniforms.uClothWidth = { value: spec.wave.width };
    }
    if (key === 'banner') {
      defines.STRUCT_BANNER = '';
      uniforms.uMapBack = { value: this.texture('bannerBack') };
    }
    mat.defines = defines;
    mat.onBeforeCompile = (shader) => applyStructurePatch(shader, uniforms);
    return { material: mat, uniforms };
  }

  createHoloMaterial(color: number, reveal: Slot): { material: THREE.ShaderMaterial; uniforms: HoloUniforms } {
    const uniforms: HoloUniforms = {
      uColor: { value: new THREE.Color(color) },
      uTime: this.global.uTime,
      uReveal: reveal,
      uPulse: { value: 0 },
      uOpacity: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return { material, uniforms };
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    for (const t of this.repeats.values()) t.dispose();
    this.repeats.clear();
    for (const m of this.models.values()) for (const g of m.values()) g.dispose();
    for (const g of this.geometries.values()) g.dispose();
    this.textures.clear();
    this.models.clear();
    this.geometries.clear();
    this.instancedDepth.dispose();
  }
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * The materials of one building (or a ghost): lazily created per key, sharing the
 * building's uniforms, recoloured on capture. A ghost set returns one override material.
 *
 * InstancedMesh users get their own copy of each material: three.js keys programs on
 * instancing, so a material drawn by both plain and instanced meshes would re-derive its
 * program (getParameters + cache key) every time the draw order alternates between them.
 */
export class MaterialSet {
  readonly u: BuildingUniforms;
  private readonly kit: StructureKit;
  private readonly mats = new Map<MatKey, StructureMaterial>();
  private readonly instancedMats = new Map<MatKey, StructureMaterial>();
  private readonly override: THREE.Material | null;
  private readonly factionColor = new THREE.Color(NEUTRAL_COLOR);
  private readonly tmp = new THREE.Color();

  constructor(kit: StructureKit, override: THREE.Material | null = null) {
    this.kit = kit;
    this.override = override;
    this.u = createBuildingUniforms();
  }

  /** Material for plain meshes. Never hand it to an InstancedMesh (use instancedMesh). */
  get(key: MatKey): THREE.Material {
    if (this.override) return this.override;
    return this.entry(key, false).material;
  }

  /**
   * A material's own uniform (e.g. 'uWaveAmp' to make the banner sway harder); `instanced`
   * selects the copy used by this set's InstancedMeshes.
   */
  uniform(key: MatKey, name: string, instanced = false): Slot | undefined {
    if (this.override) return undefined;
    return this.entry(key, instanced).uniforms[name];
  }

  /**
   * Every structure InstancedMesh is made here, so all of them agree on what three.js keys
   * programs on: the instanced copy of `key`, an instance colour buffer (white until set)
   * and the kit's shared instanced shadow-depth material.
   */
  instancedMesh(geom: THREE.BufferGeometry, key: MatKey, capacity: number, castShadow: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geom, this.override ?? this.entry(key, true).material, capacity);
    mesh.setColorAt(0, WHITE);
    mesh.castShadow = castShadow && !this.override;
    mesh.receiveShadow = !this.override;
    mesh.customDepthMaterial = this.kit.instancedDepth;
    return mesh;
  }

  private entry(key: MatKey, instanced: boolean): StructureMaterial {
    const cache = instanced ? this.instancedMats : this.mats;
    let m = cache.get(key);
    if (!m) {
      m = this.kit.createMaterial(key, this.u);
      this.recolor(key, m.material);
      cache.set(key, m);
    }
    return m;
  }

  /** Add one mesh per material of a cached model under `parent`. */
  addModel(parent: THREE.Object3D, model: ModelGeometry, shadows = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, geom] of model) {
      const mesh = new THREE.Mesh(geom, this.get(key));
      mesh.castShadow = shadows && !this.override;
      mesh.receiveShadow = !this.override;
      parent.add(mesh);
      out.push(mesh);
    }
    return out;
  }

  setFaction(color: number): void {
    this.factionColor.setHex(color);
    for (const [key, m] of this.mats) this.recolor(key, m.material);
    for (const [key, m] of this.instancedMats) this.recolor(key, m.material);
  }

  private recolor(key: MatKey, m: THREE.MeshStandardMaterial): void {
    const mode = MATERIALS[key].faction;
    if (mode === 'trim') {
      m.color.copy(this.factionColor);
      m.emissive.copy(this.factionColor);
    } else if (mode === 'glow') {
      m.emissive.copy(this.factionColor);
    } else if (mode === 'tint') {
      m.color.setHex(MATERIALS[key].color).lerp(this.tmp.copy(this.factionColor), 0.35);
    }
  }

  dispose(): void {
    for (const m of this.mats.values()) m.material.dispose();
    for (const m of this.instancedMats.values()) m.material.dispose();
    this.mats.clear();
    this.instancedMats.clear();
  }
}
