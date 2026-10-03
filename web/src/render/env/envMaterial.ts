/**
 * The shared prop material: MeshStandardMaterial + vertex colours, extended (onBeforeCompile)
 * with the PartsBuilder attributes:
 *   aTint  selects which parts take the per-instance colour,
 *   aGlow  emissive festival lights that wake up at night (steady / twinkle / beat / rainbow /
 *          flicker) and stay faint by day,
 *   aSway  wind sway (world-space wind direction, per-instance phase), shadows included.
 * Works for Mesh, InstancedMesh and BatchedMesh (the placement frame comes from the instance
 * or batch matrix, per-placement colours from instance or batch colours). All placements of
 * a variant share one program.
 */
import * as THREE from 'three';
import type { EnvUniforms } from './envTypes';

export interface EnvMaterialOptions {
  roughness?: number;
  metalness?: number;
  /** Emissive multiplier applied by day (night = 1). Default 0.06. */
  glowDay?: number;
  /** Sway amplitude in metres at aSway = 1 (0 disables the sway code). Default 0. */
  sway?: number;
  flatShading?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
}

const VERT_PARS = /* glsl */ `
attribute vec2 aGlow;
attribute float aSway;
attribute float aTint;
varying vec3 vGlow;
uniform float uTime;
uniform float uBeat;
uniform vec2 uWind;
uniform float uSwayAmp;

vec3 envHue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

float envHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// The placement frame of this vertex: batch matrix, instance matrix, or identity.
mat4 envFrame() {
#if defined( USE_BATCHING )
  return getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#elif defined( USE_INSTANCING )
  return instanceMatrix;
#else
  return mat4( 1.0 );
#endif
}

// Wind displacement in object space: the world-space wind is rotated into the placement
// frame so every tree/cloth leans the same way regardless of its random yaw; the frame's
// origin sets the gust phase.
vec3 envSway(vec3 p, float w, mat4 frame) {
  if (w <= 0.0 || uSwayAmp <= 0.0) return p;
  vec3 origin = frame[3].xyz;
  float ph = dot(origin.xz, vec2(0.071, 0.113));
  float gust = 0.65 + 0.35 * sin(uTime * 0.7 + ph * 0.5);
  vec2 wind = uWind * gust * (0.75 + 0.25 * sin(uTime * 1.9 + ph + p.y * 0.4));
  vec2 flutter = 0.18 * length(uWind) * vec2(sin(uTime * 3.1 + ph * 1.7 + p.y), cos(uTime * 2.7 + ph));
  vec2 dw = (wind + flutter) * uSwayAmp * w;
  vec3 ax = frame[0].xyz;
  vec3 az = frame[2].xyz;
  float s = max(length(ax), 1e-4);
  dw = vec2(dot(dw, ax.xz), dot(dw, az.xz)) / (s * s);
  p.xz += dw;
  p.y -= dot(dw, dw) * 0.15;
  return p;
}
`;

const VERT_COLOR = /* glsl */ `
// Placement frame, fetched once here and reused by the sway after begin_vertex.
mat4 envF = envFrame();
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4(1.0);
#endif
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
#endif
#ifdef USE_BATCHING_COLOR
  vColor.rgb *= mix(vec3(1.0), getBatchingColor(getIndirectIndex(gl_DrawID)).rgb, aTint);
#endif
  {
    vec3 origin = envF[3].xyz;
    float mode = aGlow.y;
    float g = aGlow.x;
    vec3 gc = vColor.rgb;
    if (g > 0.0) {
      float seed = envHash(position * 7.31 + origin);
      if (mode > 0.5 && mode < 1.5) {
        g *= 0.45 + 0.55 * smoothstep(-0.3, 1.0, sin(uTime * (1.3 + seed * 2.2) + seed * 40.0));
      } else if (mode > 1.5 && mode < 2.5) {
        g *= 0.35 + 0.65 * exp(-fract(uBeat) * 5.0);
      } else if (mode > 2.5 && mode < 3.5) {
        gc = envHue(fract(uTime * 0.08 + position.y * 0.07 + dot(origin.xz, vec2(0.01)))) * 0.9 + 0.1;
        g *= 0.8 + 0.2 * exp(-fract(uBeat) * 4.0);
      } else if (mode > 3.5) {
        float f = sin(uTime * 13.0 + seed * 31.0) * 0.5 + sin(uTime * 7.3 + seed * 11.0) * 0.5;
        g *= 0.7 + 0.3 * f;
      }
    }
    vGlow = gc * g;
  }
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vGlow;
uniform float uNight;
uniform float uGlowDay;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += vGlow * mix(uGlowDay, 1.0, uNight);
`;

/**
 * Create a prop material bound to the shared env uniforms. Each call returns a new material
 * (dispose it with your part); compiled programs are shared by three via the cache key.
 */
export function createEnvMaterial(uniforms: EnvUniforms, opts: EnvMaterialOptions = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0,
    flatShading: opts.flatShading ?? false,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  const swayAmp = { value: opts.sway ?? 0 };
  const glowDay = { value: opts.glowDay ?? 0.06 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uBeat = uniforms.uBeat;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uSwayAmp = swayAmp;
    shader.uniforms.uGlowDay = glowDay;
    // After batching_pars_vertex: envFrame() reads the batch matrix.
    shader.vertexShader = shader.vertexShader
      .replace('#include <batching_pars_vertex>', `#include <batching_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <color_vertex>', VERT_COLOR)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = envSway(transformed, aSway, envF);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'env-prop-v1';
  if ((opts.sway ?? 0) > 0) mat.userData.swayDepth = createSwayDepthMaterial(uniforms, swayAmp);
  return mat;
}

/**
 * Depth material for shadow casting that applies the same wind sway (assign to
 * mesh.customDepthMaterial). createEnvMaterial stores one in `material.userData.swayDepth`
 * when sway > 0; the owner disposes it with the material via disposeEnvMaterial.
 */
function createSwayDepthMaterial(uniforms: EnvUniforms, swayAmp: { value: number }): THREE.MeshDepthMaterial {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uBeat = uniforms.uBeat;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uSwayAmp = swayAmp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <batching_pars_vertex>', `#include <batching_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed = envSway(transformed, aSway, envFrame());`);
  };
  depth.customProgramCacheKey = () => 'env-prop-depth-v1';
  return depth;
}

/** Sway-aware shadow depth material created alongside an env material (if any). */
export function swayDepthOf(mat: THREE.Material): THREE.MeshDepthMaterial | undefined {
  const d: unknown = mat.userData.swayDepth;
  return d instanceof THREE.MeshDepthMaterial ? d : undefined;
}

/** Dispose an env material and its sway depth companion. */
export function disposeEnvMaterial(mat: THREE.Material): void {
  swayDepthOf(mat)?.dispose();
  mat.dispose();
}
