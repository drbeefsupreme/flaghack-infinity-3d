/**
 * Ground: one large terrain mesh (flat inside the map, rolling hills beyond) with a
 * MeshStandardMaterial extended in-shader:
 *   - surface types baked from map.groundAt into a blurred RGBA texture (dirt, road, mud,
 *     water weights; grass = the rest), edges frayed by noise so nothing looks gridded,
 *   - meadow grass with clumps, straw patches, clover specks and travelling wind sheen;
 *     Georgia red-clay dirt with pebbles; packed tan roads; dark wet mud with puddles; all
 *     noise layers rotated/scaled incommensurately so no lattice or tiling shows,
 *   - the pond from map.water (analytic ellipses): depth tint, animated ripple normals,
 *     fresnel sky reflection, shoreline foam and a wet bank,
 *   - shadows/fog/lights from the standard pipeline.
 */
import * as THREE from 'three';
import type { GroundType, MapLayout } from '../../sim/map/mapgen';
import type { EnvContext, EnvPart } from './envTypes';
import { terrainHeight } from './terrain';

/** Ground mesh half extent (m): reaches the fogged horizon in every direction. */
const EXTENT = 900;
/** Grid resolution: ~14 m quads, enough for the rolling hills (the map itself is flat). */
const SEGMENTS = 128;
/** Max water bodies passed to the shader. */
const MAX_WATER = 4;

const TYPE_CHANNEL: Record<GroundType, number> = { grass: -1, dirt: 0, road: 1, mud: 2, water: 3 };

/**
 * Bake map.groundAt into an n×n RGBA8 texture covering [-half, half]² (R dirt, G road,
 * B mud, A water) with a two-pass box blur for soft transitions.
 */
export function bakeGroundTypes(map: MapLayout, n: number): Uint8Array {
  const half = map.half;
  const cell = (2 * half) / n;
  const chans = [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)];
  for (let y = 0; y < n; y++) {
    const wz = -half + (y + 0.5) * cell;
    for (let x = 0; x < n; x++) {
      const ch = TYPE_CHANNEL[map.groundAt(-half + (x + 0.5) * cell, wz)];
      if (ch >= 0) chans[ch][y * n + x] = 1;
    }
  }
  const tmp = new Float32Array(n * n);
  for (const c of chans) {
    for (let pass = 0; pass < 2; pass++) {
      boxBlur(c, tmp, n, 2, 1, n);
      boxBlur(tmp, c, n, 2, n, 1);
    }
  }
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    out[i * 4] = Math.round(chans[0][i] * 255);
    out[i * 4 + 1] = Math.round(chans[1][i] * 255);
    out[i * 4 + 2] = Math.round(chans[2][i] * 255);
    out[i * 4 + 3] = Math.round(chans[3][i] * 255);
  }
  return out;
}

/**
 * One separable box-blur pass with radius r along a line direction: `step` is the index
 * stride between neighbours on a line, `lineStride` the stride between lines. Edges clamp.
 */
function boxBlur(src: Float32Array, dst: Float32Array, n: number, r: number, step: number, lineStride: number): void {
  const w = 1 / (2 * r + 1);
  for (let line = 0; line < n; line++) {
    const base = line * lineStride;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[base + Math.min(n - 1, Math.max(0, k)) * step];
    for (let i = 0; i < n; i++) {
      dst[base + i * step] = acc * w;
      const out = Math.max(0, i - r);
      const inn = Math.min(n - 1, i + r + 1);
      acc += src[base + inn * step] - src[base + out * step];
    }
  }
}

const VERT_PARS = /* glsl */ `
varying vec3 vGround;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
vGround = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vGround;
uniform sampler2D uType;
uniform sampler2D uNoise;
uniform float uHalf;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec4 uWater[${MAX_WATER}];
uniform int uWaterCount;

// Shared between the colour, roughness, normal and reflection stages.
float gWater;
float gShore;
float gMud;
float gPuddle;
float gDirt;
float gRoad;
vec3 gWaterN;

// Analytic pond: x = weight inside, y = normalized radius (0 centre .. 1 shore).
vec2 waterAt(vec2 p, float wobble) {
  vec2 best = vec2(0.0, 9.0);
  for (int i = 0; i < ${MAX_WATER}; i++) {
    if (i >= uWaterCount) break;
    vec4 w = uWater[i];
    float d = length((p - w.xy) / w.zw) + wobble;
    if (d < best.y) best = vec2(1.0 - smoothstep(0.975, 1.0, d), d);
  }
  return best;
}
`;

const FRAG_COLOR = /* glsl */ `
vec2 wp = vGround.xz;
// Explicit gradients so samples inside divergent branches keep correct mip selection.
vec2 dwx = dFdx(wp);
vec2 dwy = dFdy(wp);
// Every layer is rotated and scaled incommensurately: value noise has an axis-aligned
// lattice, and aligned octaves would read as a tiled carpet at grazing angles.
const mat2 ROT_B = mat2(0.799, 0.602, -0.602, 0.799);
const mat2 ROT_C = mat2(0.326, 0.946, -0.946, 0.326);
const mat2 ROT_D = mat2(-0.454, 0.891, -0.891, -0.454);
vec4 nA = texture2D(uNoise, wp * 0.0113);
vec4 nB = texture2D(uNoise, ROT_B * wp * 0.0617);
vec4 nC = texture2D(uNoise, ROT_C * wp * 0.2391);
// Fine grain only near the camera: far away its mips average to grey anyway.
float nearF = 1.0 - smoothstep(25.0, 60.0, length(vViewPosition));
vec4 nD = vec4(0.5);
if (nearF > 0.0) {
  vec2 duv = ROT_D * wp * 1.37;
  nD = mix(nD, textureGrad(uNoise, duv, ROT_D * dwx * 1.37, ROT_D * dwy * 1.37), nearF);
}

float edge = max(abs(wp.x), abs(wp.y));
float inMap = 1.0 - smoothstep(uHalf - 1.0, uHalf + 4.0, edge);
vec2 warp = (vec2(nB.r, nB.g) - 0.5) * (2.6 / (2.0 * uHalf));
vec4 ty = texture2D(uType, (wp + uHalf) / (2.0 * uHalf) + warp) * inMap;

gDirt = smoothstep(0.25, 0.68, ty.r + (nC.g - 0.5) * 0.25);
gRoad = smoothstep(0.3, 0.64, ty.g + (nC.r - 0.5) * 0.2);
gMud = smoothstep(0.3, 0.68, ty.b + (nB.g - 0.5) * 0.45);
gPuddle = gMud * smoothstep(0.58, 0.7, nB.r * 0.6 + nC.b * 0.4);
vec2 pond = waterAt(wp, (nB.r - 0.5) * 0.05);
gWater = pond.x;
gShore = (1.0 - smoothstep(1.0, 1.22, pond.y)) * (1.0 - gWater);
gWaterN = vec3(0.0, 1.0, 0.0);

// Grass: summer meadow — olive-green base, sunlit yellow-green swaths, deep clumps, straw
// patches. Saturation stays moderate so the yellow Flags remain the most saturated thing.
vec3 grass = mix(vec3(0.075, 0.15, 0.03), vec3(0.17, 0.235, 0.055), smoothstep(0.2, 0.85, nA.r * 0.7 + nB.r * 0.3));
grass = mix(grass, vec3(0.04, 0.09, 0.026), smoothstep(0.5, 0.9, nB.g) * 0.45);
grass = mix(grass, vec3(0.3, 0.255, 0.12), smoothstep(0.62, 0.92, nA.g * 0.8 + nC.b * 0.2) * 0.5);
grass *= 0.92 + 0.16 * nC.g;
grass *= 1.0 + (nD.r - 0.5) * 0.22 * nearF;
float clover = step(0.994, nD.a) * smoothstep(0.4, 0.7, nB.r) * nearF;
grass = mix(grass, mix(vec3(0.9, 0.78, 0.2), vec3(0.8, 0.8, 0.86), step(0.5, nC.a)), clover * 0.7);
// Wind sheen: bands of bent blades rolling downwind.
vec2 wdir = normalize(uWind + vec2(1e-4));
float wave = sin(dot(wp, wdir) * 0.21 - uTime * 1.7 + nA.r * 7.0 + nB.g * 2.0);
float sheen = smoothstep(0.35, 1.0, wave) * clamp(length(uWind), 0.0, 1.0) * (0.4 + 0.6 * nB.r);
grass = mix(grass, grass * 1.4 + vec3(0.025, 0.035, 0.0), sheen * 0.45);
// Forest floor beyond the border: needles and shade.
float forest = smoothstep(uHalf + 10.0, uHalf + 40.0, edge);
grass = mix(grass, vec3(0.075, 0.068, 0.032) * (0.8 + 0.4 * nC.r), forest * 0.8);

// Georgia red clay, dusted lighter where feet pass, pebbles up close.
vec3 dirt = mix(vec3(0.29, 0.12, 0.055), vec3(0.4, 0.255, 0.155), smoothstep(0.3, 0.85, nB.r * 0.6 + nA.g * 0.4));
dirt *= 0.94 + 0.12 * nC.g;
dirt *= 1.0 + (nD.g - 0.5) * 0.16 * nearF;
float pebble = (1.0 - smoothstep(0.05, 0.12, nD.b)) * step(0.5, nC.a) * nearF;
dirt = mix(dirt, vec3(0.4, 0.36, 0.31), pebble * 0.4);

// Packed road: warm tan with darker wheel-worn streaks.
vec3 road = mix(vec3(0.3, 0.2, 0.125), vec3(0.39, 0.285, 0.18), nB.r);
road *= 0.93 + 0.1 * nC.r;
road *= 1.0 + (nD.a - 0.5) * 0.12 * nearF;
road = mix(road, road * 0.8, smoothstep(0.55, 0.8, nB.b) * 0.4);

vec3 mud = mix(vec3(0.11, 0.07, 0.038), vec3(0.18, 0.12, 0.065), nC.g);
mud = mix(mud, vec3(0.045, 0.035, 0.028), gPuddle);

vec3 col = grass;
col = mix(col, dirt, gDirt);
col = mix(col, road, gRoad);
col = mix(col, mud, gMud);
col = mix(col, col * vec3(0.55, 0.5, 0.45), gShore);

// Pond body: brown shallows to deep teal, foam lace at the shoreline, travelling ripples.
if (gWater > 0.001) {
  float depth = 1.0 - smoothstep(0.35, 1.0, pond.y);
  vec3 waterCol = mix(vec3(0.07, 0.07, 0.04), vec3(0.008, 0.035, 0.04), depth);
  vec2 fuv = wp * 0.5 + uTime * 0.02;
  float foam = smoothstep(0.93, 0.985, pond.y) * smoothstep(0.45, 0.8, textureGrad(uNoise, fuv, dwx * 0.5, dwy * 0.5).b + nC.a * 0.3);
  waterCol = mix(waterCol, vec3(0.75, 0.78, 0.75), foam * 0.6);
  col = mix(col, waterCol, gWater);
  vec2 r1 = ROT_B * wp * 0.21 + uTime * vec2(0.021, 0.013);
  vec2 r2 = ROT_C * wp * 0.33 - uTime * vec2(0.017, -0.024);
  vec2 slope = (textureGrad(uNoise, r1, ROT_B * dwx * 0.21, ROT_B * dwy * 0.21).rg + textureGrad(uNoise, r2, ROT_C * dwx * 0.33, ROT_C * dwy * 0.33).gr - 1.0) * 0.32;
  gWaterN = normalize(vec3(slope.x, 1.0, slope.y));
}

diffuseColor.rgb = col;
`;

const FRAG_ROUGHNESS = /* glsl */ `
float roughnessFactor = 0.93;
roughnessFactor = mix(roughnessFactor, 0.97, gDirt);
roughnessFactor = mix(roughnessFactor, 0.9, gRoad);
roughnessFactor = mix(roughnessFactor, mix(0.5, 0.1, gPuddle), gMud);
roughnessFactor = mix(roughnessFactor, 0.55, gShore);
roughnessFactor = mix(roughnessFactor, 0.06, gWater);
`;

// Only the pond perturbs the normal (world-space ripples → view space); land relief comes
// from colour, shadows and the grass tufts.
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
if (gWater > 0.001) {
  vec3 waterN = normalize((viewMatrix * vec4(gWaterN, 0.0)).xyz);
  normal = normalize(mix(normal, waterN, gWater));
}
`;

const FRAG_REFLECT = /* glsl */ `
if (gWater > 0.001) {
  vec3 V = normalize(cameraPosition - vGround);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(gWaterN, V), 0.0), 5.0);
  vec3 R = reflect(-V, gWaterN);
  // The far bank and trees hide the low horizon, so the pond mirrors the sky a little higher up.
  vec3 skyR = mix(uHorizon, uZenith, pow(clamp(R.y + 0.18, 0.0, 1.0), 0.5));
  outgoingLight = mix(outgoingLight, skyR, fres * gWater * 0.75);
}
#include <opaque_fragment>
`;

export class Ground implements EnvPart {
  /** Baked surface types (R dirt, G road, B mud, A water over [-half, half]²); grass reads it. */
  readonly typeTexture: THREE.DataTexture;
  private mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;

  constructor(env: EnvContext) {
    const map = env.ctx.world.map;
    const n = env.ctx.quality === 'low' ? 256 : 512;
    const typeTex = new THREE.DataTexture(bakeGroundTypes(map, n), n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    typeTex.magFilter = THREE.LinearFilter;
    typeTex.minFilter = THREE.LinearMipmapLinearFilter;
    typeTex.generateMipmaps = true;
    typeTex.wrapS = THREE.ClampToEdgeWrapping;
    typeTex.wrapT = THREE.ClampToEdgeWrapping;
    typeTex.colorSpace = THREE.NoColorSpace;
    typeTex.needsUpdate = true;
    this.typeTexture = typeTex;

    const water: THREE.Vector4[] = [];
    for (let i = 0; i < MAX_WATER; i++) {
      const w = map.water[i];
      water.push(w ? new THREE.Vector4(w.x, w.z, w.rx, w.rz) : new THREE.Vector4(0, 0, 1, 1));
    }

    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    const day = env.day;
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uType = { value: typeTex };
      shader.uniforms.uNoise = { value: env.noise };
      shader.uniforms.uHalf = { value: map.half };
      shader.uniforms.uTime = env.uniforms.uTime;
      shader.uniforms.uWind = env.uniforms.uWind;
      shader.uniforms.uZenith = { value: day.zenith };
      shader.uniforms.uHorizon = { value: day.horizon };
      shader.uniforms.uWater = { value: water };
      shader.uniforms.uWaterCount = { value: Math.min(MAX_WATER, map.water.length) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <begin_vertex>', VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', FRAG_ROUGHNESS)
        .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
        .replace('#include <opaque_fragment>', FRAG_REFLECT);
    };
    this.mat.customProgramCacheKey = () => 'env-ground-v1';

    const geo = new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i), map.half));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'ground';
    this.mesh.receiveShadow = true;
    // The terrain never moves: skip the per-frame matrix recompose.
    this.mesh.matrixAutoUpdate = false;
    env.root.add(this.mesh);
  }

  /** Static: all animation (wind sheen, ripples) runs in the shader on shared uniforms. */
  update(_dt: number): void {}

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.typeTexture.dispose();
  }
}
