/**
 * Effigy timber: the shared env prop material (vertex colours, festival glow parts) extended
 * with The Burn. As the flames pass each height the wood scorches brown, then turns to
 * alligatored charcoal with breathing ember cracks; timber inside the flames glows with
 * their light; the lattice variant finally burns away with white-hot edges (a matching depth
 * material keeps its shadow in step). Before the fire, warm uplights wash the timber from
 * below at night.
 */
import * as THREE from 'three';
import { createEnvMaterial } from '../envMaterial';
import type { EnvUniforms } from '../envTypes';
import { BURN_GLSL } from './burnTimeline';

/** Uniforms shared by the effigy's shaders (written once per frame by Effigy). */
export interface BurnUniforms {
  /** Sim seconds since ignition (0 before The Burn). */
  uBurnTime: { value: number };
  /** 0..1 fire strength. */
  uFire: { value: number };
  /** Flame front and flame ceiling heights (m). */
  uFireFront: { value: number };
  uFireCeil: { value: number };
  /** 0..1 festival uplights (on at night until the fire takes over). */
  uUplight: { value: number };
  uNoise: { value: THREE.Texture };
  /** Scene fog range, for the additive/particle shaders that fog themselves. */
  uFogNear: { value: number };
  uFogFar: { value: number };
}

const VERT_PARS = /* glsl */ `
varying vec3 vEffPos;
varying vec3 vEffNormal;
`;

const VERT_MAIN = /* glsl */ `
vEffPos = transformed;
vEffNormal = objectNormal;
#include <project_vertex>
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vEffPos;
varying vec3 vEffNormal;
uniform float uTime;
uniform float uFire;
uniform float uFireFront;
uniform float uFireCeil;
uniform float uUplight;
${BURN_GLSL}
`;

/** Runs right after the vertex colours are applied: burn-away, char colour, ember glow. */
const FRAG_BURN = /* glsl */ `
#include <color_fragment>
float effChar = 0.0;
{
  vec3 P = vEffPos;
  float n = burnNoise(P);
#ifdef EFFIGY_DISSOLVE
  float awayIn = burnAwayIn(P, n);
  if (awayIn < 0.0) discard;
  // The last seconds before a piece falls away: white-hot rim.
  float rim = 1.0 - smoothstep(0.0, 3.5, awayIn);
#else
  float rim = 0.0;
#endif
  // Surface texture lookups on the dominant face plane.
  vec3 an = abs(vEffNormal);
  vec2 tuv = an.y > max(an.x, an.z) ? P.xz : (an.x > an.z ? P.zy : P.xy);
  vec4 fine = texture2D(uNoise, tuv * 0.21 + 0.37);
  vec4 grain = texture2D(uNoise, tuv * vec2(0.9, 0.12) + 0.11);
  diffuseColor.rgb *= 0.86 + 0.28 * grain.g;

  effChar = burnChar(P.y, (n - 0.5) * 12.0);
  vec3 toasted = diffuseColor.rgb * vec3(0.42, 0.26, 0.15);
  vec3 coal = vec3(0.022, 0.019, 0.017) * (0.7 + 0.6 * fine.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, toasted, smoothstep(0.0, 0.3, effChar));
  diffuseColor.rgb = mix(diffuseColor.rgb, coal, smoothstep(0.22, 0.75, effChar));
  // Pale ash dusts the char blocks once the flames have passed.
  float cracks = smoothstep(0.6, 0.85, fine.b);
  float ash = smoothstep(0.75, 1.0, effChar) * (1.0 - cracks) * (1.0 - smoothstep(0.1, 0.45, fine.b)) * (1.0 - uFire * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.155, 0.15), ash * 0.6);

  // Flames at this height light the timber and feed the ember cracks.
  float inFire = uFire * smoothstep(P.y - 1.0, P.y + 1.5, uFireFront) * (1.0 - smoothstep(uFireCeil - 1.0, uFireCeil + 3.0, P.y));
  float pulse = 0.55 + 0.45 * sin(uTime * 1.4 + n * 23.0 + P.y * 0.7);
  float heat = smoothstep(0.15, 0.6, effChar) * (inFire * 1.5 + 0.3 * (1.0 - smoothstep(4.0, 16.0, P.y)));
  vec3 emberCol = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.5, 0.12), pulse);
  totalEmissiveRadiance += emberCol * cracks * heat * pulse * 3.2;
  totalEmissiveRadiance += vec3(1.0, 0.32, 0.07) * inFire * (0.25 + 0.35 * (1.0 - effChar)) * diffuseColor.rgb * 3.0;
  totalEmissiveRadiance += vec3(1.0, 0.5, 0.16) * rim * 4.0;

  // Festival uplights from the ground: strongest low down and on outward-facing timber.
  vec2 nxz = vEffNormal.xz;
  float nl = length(nxz);
  float outward = nl > 1e-3 ? clamp(dot(nxz / nl, P.xz / max(length(P.xz), 1e-3)) * 0.5 + 0.5, 0.0, 1.0) : 0.5;
  float lift = 0.35 * exp(-P.y / 11.0) + 0.9 * exp(-P.y / 1.6);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.68, 0.38) * uNight * uUplight * lift * (0.25 + 0.75 * outward);
}
`;

const FRAG_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 1.0, effChar);
`;

/**
 * Timber material bound to the env and burn uniforms. `dissolve` selects the lattice variant
 * that burns away; pair it with createCharDepthMaterial for its shadow.
 */
export function createCharMaterial(uniforms: EnvUniforms, burn: BurnUniforms, dissolve: boolean): THREE.MeshStandardMaterial {
  const mat = createEnvMaterial(uniforms, { roughness: 0.8 });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.uBurnTime = burn.uBurnTime;
    shader.uniforms.uFire = burn.uFire;
    shader.uniforms.uFireFront = burn.uFireFront;
    shader.uniforms.uFireCeil = burn.uFireCeil;
    shader.uniforms.uUplight = burn.uUplight;
    shader.uniforms.uNoise = burn.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${dissolve ? '#define EFFIGY_DISSOLVE\n' : ''}#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_BURN)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGHNESS);
  };
  mat.customProgramCacheKey = () => (dissolve ? 'effigy-char-dissolve-v1' : 'effigy-char-v1');
  return mat;
}

/** Shadow depth material for the lattice: drops the same burnt-away fragments. */
export function createCharDepthMaterial(burn: BurnUniforms): THREE.MeshDepthMaterial {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uBurnTime = burn.uBurnTime;
    shader.uniforms.uNoise = burn.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEffPos;')
      .replace('#include <project_vertex>', 'vEffPos = transformed;\n#include <project_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vEffPos;\n${BURN_GLSL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (burnAwayIn(vEffPos, burnNoise(vEffPos)) < 0.0) discard;');
  };
  depth.customProgramCacheKey = () => 'effigy-char-depth-v1';
  return depth;
}
