/**
 * Instanced grass tufts around the camera (high quality only). A fixed 80×80 grid of tuft
 * instances wraps toroidally around the camera focus inside the vertex shader, so each tuft
 * keeps its world position until it recycles at the far edge (where it is already faded out).
 * Everything per tuft (jitter, rotation, height, colour, wind bend) comes from hashes of its
 * world cell, sampled ground types (no grass on dirt/roads/mud/water) and the shared noise,
 * so the CPU only updates one uniform per frame. Lambert lighting with shadows and fog, plus
 * a backlit translucency glow that makes golden hour sing.
 */
import * as THREE from 'three';
import type { EnvContext, EnvPart } from './envTypes';

const GRID = 80;
const CELL = 0.5;
const BLADES = 7;
const SEGMENTS = 2;
/** Tufts fade out between these camera distances (m). */
const FADE_NEAR = 10;
const FADE_FAR = 16;
/** How far ahead of the camera (m) the tuft grid is centred. */
const LEAD = 7;

/** One tuft: BLADES tapered, slightly curved blades leaning outward. `aT` = height 0..1. */
function buildTuft(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const ts: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const ang = (b / BLADES) * Math.PI * 2 + b * 1.7;
    const r = 0.03 + ((b * 37) % 11) * 0.009;
    const bx = Math.cos(ang) * r;
    const bz = Math.sin(ang) * r;
    // Blade faces sideways to its lean direction; lean outward with a gentle curve.
    const lean = 0.12 + ((b * 53) % 7) * 0.025;
    const fx = -Math.sin(ang);
    const fz = Math.cos(ang);
    const width = 0.032;
    const h = 0.7 + ((b * 29) % 5) * 0.09;
    const nx = Math.cos(ang) * 0.5;
    const nz = Math.sin(ang) * 0.5;
    const base = pos.length / 3;
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = s / SEGMENTS;
      const cx = bx + Math.cos(ang) * lean * t * t;
      const cz = bz + Math.sin(ang) * lean * t * t;
      const y = h * t;
      if (s < SEGMENTS) {
        const w = width * (1 - t * 0.85);
        pos.push(cx - fx * w, y, cz - fz * w, cx + fx * w, y, cz + fz * w);
        nor.push(nx, 1, nz, nx, 1, nz);
        ts.push(t, t);
      } else {
        pos.push(cx, y, cz);
        nor.push(nx, 1, nz);
        ts.push(1);
      }
    }
    for (let s = 0; s < SEGMENTS - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const lastPair = base + (SEGMENTS - 1) * 2;
    idx.push(lastPair, lastPair + 1, lastPair + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  g.setIndex(idx);
  return g;
}

const VERT_PARS = /* glsl */ `
attribute vec2 aCell;
attribute float aT;
uniform vec2 uFocus;
uniform float uHalf;
uniform float uTime;
uniform vec2 uWind;
uniform sampler2D uType;
uniform sampler2D uNoise;
varying float vT;
varying vec3 vBase;

float grassHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

// Runs before begin_vertex: places the tuft, so the normal can be rotated with it.
const VERT_NORMAL = /* glsl */ `
const float CELL = ${CELL.toFixed(3)};
const float GRID_W = ${(GRID * CELL).toFixed(3)};
vec2 anchor = aCell * CELL;
vec2 cellW = uFocus + mod(anchor - uFocus + 0.5 * GRID_W, GRID_W) - 0.5 * GRID_W;
vec2 ci = floor(cellW / CELL + 0.5);
float h1 = grassHash(ci);
float h2 = grassHash(ci + 17.3);
float h3 = grassHash(ci + 41.9);
vec2 world = cellW + (vec2(h1, h2) - 0.5) * CELL * 0.95;

vec4 ty = textureLod(uType, (world + uHalf) / (2.0 * uHalf), 0.0);
float inMap = step(abs(world.x), uHalf) * step(abs(world.y), uHalf);
float bare = clamp(ty.r + ty.g + ty.b + ty.a, 0.0, 1.0) * inMap + (1.0 - inMap) * 0.35;
float camDist = length(vec3(world.x, 0.0, world.y) - cameraPosition);
float fade = 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, camDist);
// Presence shrinks a tuft as a whole (footprint too): a tuft only flattened vertically would
// leave star-shaped slivers z-fighting with roads and camp dirt.
float presence = (1.0 - smoothstep(0.2, 0.55, bare)) * fade;
float hScale = (0.2 + 0.2 * h3) * presence;

float ang = h1 * 6.2831853;
float ca = cos(ang);
float sa = sin(ang);
vec3 objectNormal = vec3(normal);
objectNormal.xz = vec2(ca * objectNormal.x - sa * objectNormal.z, sa * objectNormal.x + ca * objectNormal.z);

// Same broad-swath lookup and palette as the ground shader so tufts melt into the meadow.
float nA = textureLod(uNoise, world * 0.0113, 0.0).r;
vBase = mix(vec3(0.075, 0.15, 0.03), vec3(0.17, 0.235, 0.055), smoothstep(0.2, 0.85, nA)) * (0.88 + 0.24 * h2);
vT = aT;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
transformed.xz *= (0.8 + 0.5 * h2) * smoothstep(0.0, 0.35, presence);
transformed.xz = vec2(ca * transformed.x - sa * transformed.z, sa * transformed.x + ca * transformed.z);
transformed.y *= hScale;
if (presence < 0.01) transformed.y = -1.0;
float wlen = length(uWind);
vec2 wdir = uWind / max(wlen, 1e-4);
float wave = 0.5 + 0.5 * sin(dot(world, wdir) * 0.21 - uTime * 1.7 + h1 * 2.0);
vec2 bend = uWind * (0.3 + 0.7 * wave) * 0.32 + 0.05 * wlen * vec2(sin(uTime * 3.1 + h2 * 20.0), cos(uTime * 2.7 + h1 * 20.0));
transformed.xz += bend * aT * aT * hScale * 3.0;
transformed.y -= dot(bend, bend) * aT * aT * hScale * 1.5;
transformed.xz += world;
`;

const FRAG_PARS = /* glsl */ `
varying float vT;
varying vec3 vBase;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
`;

const FRAG_COLOR = /* glsl */ `
vec3 tip = vBase * 1.15 + vec3(0.025, 0.025, 0.0);
diffuseColor.rgb = mix(vBase * 0.6, tip, vT);
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // Light through the blades when looking toward the sun (golden-hour rim glow).
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vec3 toCam = normalize(vViewPosition);
  float back = pow(max(dot(-toCam, sunV), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * vT * 0.22;
}
`;

// Blade normals lean up; keep them on both faces so the backs of blades light like the fronts.
const FRAG_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;
`;

export class GrassField implements EnvPart {
  private env: EnvContext;
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.MeshLambertMaterial;
  private focus = { value: new THREE.Vector2() };
  private fwd = new THREE.Vector3();

  constructor(env: EnvContext, typeTexture: THREE.Texture) {
    this.env = env;
    const tuft = buildTuft();
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = tuft.index;
    this.geo.setAttribute('position', tuft.getAttribute('position'));
    this.geo.setAttribute('normal', tuft.getAttribute('normal'));
    this.geo.setAttribute('aT', tuft.getAttribute('aT'));
    const cells = new Float32Array(GRID * GRID * 2);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        cells[(j * GRID + i) * 2] = i;
        cells[(j * GRID + i) * 2 + 1] = j;
      }
    }
    this.geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    this.geo.instanceCount = GRID * GRID;

    this.mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const half = env.ctx.world.map.half;
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFocus = this.focus;
      shader.uniforms.uHalf = { value: half };
      shader.uniforms.uTime = env.uniforms.uTime;
      shader.uniforms.uWind = env.uniforms.uWind;
      shader.uniforms.uType = { value: typeTexture };
      shader.uniforms.uNoise = { value: env.noise };
      shader.uniforms.uSunDir = env.uniforms.uSunDir;
      shader.uniforms.uSunColor = env.uniforms.uSunColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_COLOR}`)
        .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
    };
    this.mat.customProgramCacheKey = () => 'env-grass-v1';

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'grass';
    // Instances are placed in the shader; the tuft-sized bounds would cull them wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    env.root.add(this.mesh);
  }

  update(_dt: number): void {
    const cam = this.env.ctx.camera;
    cam.getWorldDirection(this.fwd);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    this.focus.value.set(cam.position.x + (this.fwd.x / fl) * LEAD, cam.position.z + (this.fwd.z / fl) * LEAD);
    // Skip the draw entirely when the camera is too high for any tuft to survive the fade.
    this.mesh.visible = cam.position.y < FADE_FAR;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
