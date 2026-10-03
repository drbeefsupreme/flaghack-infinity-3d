/**
 * Shader fire: a few camera-facing (cylindrical billboard, built in the vertex shader)
 * quads with procedural fbm flame tongues, a hot core, optional streaks of a second
 * colour, flicker and a white-hot column mode. Additive, fog-aware, one draw call.
 * The Hearth drives it from its capture stage; the Drum Circle and the still use it plain.
 */
import * as THREE from 'three';
import type { StructureKit } from './kit';
import { damp } from './util';

const FIRE_VERT = /* glsl */ `
attribute vec3 aFlame; // lateral offset (in widths), seed, scale
uniform vec2 uSize;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = aFlame.y;
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-4, 0.0, 0.0));
  vec3 toCam = normalize(vec3(cameraPosition.x - center.x, 0.0, cameraPosition.z - center.z) + vec3(0.0, 0.0, 1e-4));
  float s = aFlame.z;
  vec3 wp = center
    + right * (position.x * uSize.x * s + aFlame.x * uSize.x)
    + vec3(0.0, position.y * uSize.y * s, 0.0)
    + toCam * (aFlame.y - 0.5) * 0.15 * uSize.x;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uBody;
uniform vec3 uStreak;
uniform float uSplit;
uniform float uTurb;
uniform float uFlicker;
uniform float uIntensity;
uniform float uWhite;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_fragment>
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), u.x), mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ffbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * fnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
void main() {
  float t = uTime * (1.0 + uTurb * 0.9) + vSeed * 13.0;
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float n1 = ffbm(vec2(x * 1.5 + vSeed * 7.0, y * 2.0 - t * 1.7));
  float n2 = ffbm(vec2(x * 3.0 - vSeed * 3.0, y * 3.6 - t * 2.9));
  float xs = x + (n1 - 0.5) * (0.6 + uTurb * 0.8) * y;
  // Flame distance field: wide at the base, licking up into tongues; the white column is a
  // narrow, nearly straight shaft.
  float w = mix(0.85, 0.12, pow(y, 0.9));
  w = mix(w, 0.3 * (1.0 - 0.2 * y), uWhite);
  float d = abs(xs) / w + y * mix(0.6, 0.15, uWhite) - (n2 - 0.35) * mix(0.9, 0.3, uWhite);
  float flame = (1.0 - smoothstep(0.55, 0.95, d)) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.8, 1.0, y));
  float core = 1.0 - smoothstep(0.1, 0.6, d + y * 0.45);
  float sn = ffbm(vec2(xs * 4.0 + 3.0 + vSeed, y * 3.0 - t * 2.6));
  float streak = smoothstep(0.62 - uSplit * 0.42, 0.7 - uSplit * 0.38, sn) * step(0.01, uSplit);
  // Deep colour at the rim, the owner's colour in the body, a hot core.
  vec3 col = mix(uBody * 0.5, uBody, smoothstep(0.0, 0.7, flame));
  col = mix(col, uStreak, streak);
  col = mix(col, uCore, core * 0.9);
  col = mix(col, vec3(1.0, 0.98, 0.95), uWhite * (0.55 + 0.45 * core));
  float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 23.0 + vSeed * 31.0) * sin(uTime * 7.3 + vSeed * 5.0));
  float a = clamp(flame * uIntensity * flick, 0.0, 1.0);
  // Premultiplied: the body occludes like real flame in daylight, the core still adds glow.
  vec3 outc = col * a * (1.0 + core * 0.7);
  float outa = a * 0.82;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    outc = mix(outc, fogColor * outa, fogFactor);
  #endif
  gl_FragColor = vec4(outc, outa);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Every visual parameter of a flame; owners damp the live style toward a target. */
export interface FireStyle {
  core: THREE.Color;
  body: THREE.Color;
  streak: THREE.Color;
  /** 0..1 amount of the streak colour. */
  split: number;
  turb: number;
  /** 0..1 brightness flicker depth. */
  flicker: number;
  intensity: number;
  /** 0..1 white-hot column. */
  white: number;
  width: number;
  height: number;
}

export function createFireStyle(): FireStyle {
  return {
    core: new THREE.Color(1, 0.9, 0.6),
    body: new THREE.Color(1, 0.45, 0.1),
    streak: new THREE.Color(1, 0.45, 0.1),
    split: 0,
    turb: 0.4,
    flicker: 0.1,
    intensity: 1,
    white: 0,
    width: 1,
    height: 1.5,
  };
}

/** Move `cur` toward `target` (colours and scalars) at `rate` per second. */
export function dampFireStyle(cur: FireStyle, target: FireStyle, rate: number, dt: number): void {
  const k = 1 - Math.exp(-rate * dt);
  cur.core.lerp(target.core, k);
  cur.body.lerp(target.body, k);
  cur.streak.lerp(target.streak, k);
  cur.split = damp(cur.split, target.split, rate, dt);
  cur.turb = damp(cur.turb, target.turb, rate, dt);
  cur.flicker = damp(cur.flicker, target.flicker, rate, dt);
  cur.intensity = damp(cur.intensity, target.intensity, rate, dt);
  cur.white = damp(cur.white, target.white, rate, dt);
  cur.width = damp(cur.width, target.width, rate, dt);
  cur.height = damp(cur.height, target.height, rate, dt);
}

/** Merged billboard quads: lateral offset (in widths), seed, scale per flame tongue. */
function fireGeometry(tongues: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const flame: number[] = [];
  const idx: number[] = [];
  for (let q = 0; q < tongues; q++) {
    const off = tongues === 1 ? 0 : (q / (tongues - 1) - 0.5) * 0.45;
    const seed = (q * 0.618 + 0.17) % 1;
    const scale = q === Math.floor(tongues / 2) ? 1 : 0.72;
    const b = q * 4;
    pos.push(-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) flame.push(off, seed, scale);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlame', new THREE.Float32BufferAttribute(flame, 3));
  g.setIndex(idx);
  // Billboarding happens in the shader; give culling a generous sphere.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 8);
  return g;
}

export class Fire {
  readonly mesh: THREE.Mesh;
  readonly style: FireStyle = createFireStyle();
  private readonly material: THREE.ShaderMaterial;
  private readonly u: {
    uTime: THREE.IUniform<number>;
    uSize: THREE.IUniform<THREE.Vector2>;
    uCore: THREE.IUniform<THREE.Color>;
    uBody: THREE.IUniform<THREE.Color>;
    uStreak: THREE.IUniform<THREE.Color>;
    uSplit: THREE.IUniform<number>;
    uTurb: THREE.IUniform<number>;
    uFlicker: THREE.IUniform<number>;
    uIntensity: THREE.IUniform<number>;
    uWhite: THREE.IUniform<number>;
  };

  constructor(kit: StructureKit, tongues = 3) {
    this.u = {
      uTime: kit.global.uTime,
      uSize: { value: new THREE.Vector2(1, 1.5) },
      uCore: { value: this.style.core },
      uBody: { value: this.style.body },
      uStreak: { value: this.style.streak },
      uSplit: { value: 0 },
      uTurb: { value: 0.4 },
      uFlicker: { value: 0.1 },
      uIntensity: { value: 1 },
      uWhite: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...this.u },
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(
      kit.geometry(`fire:${tongues}`, () => fireGeometry(tongues)),
      this.material,
    );
    this.mesh.renderOrder = 4;
  }

  /** Push the live style into the shader. */
  apply(): void {
    const s = this.style;
    this.u.uSize.value.set(s.width, s.height);
    this.u.uSplit.value = s.split;
    this.u.uTurb.value = s.turb;
    this.u.uFlicker.value = s.flicker;
    this.u.uIntensity.value = s.intensity;
    this.u.uWhite.value = s.white;
  }

  dispose(): void {
    this.material.dispose();
  }
}
