/** Original guy-line appearance until the ballistic release, landing and burn-through. */
import * as THREE from 'three';
import { createEnvMaterial, swayDepthOf } from '../envMaterial';
import type { EnvUniforms } from '../envTypes';
import { GUY_GROUND_CLEARANCE, GUY_HEIGHT, PLINTH_HEIGHT, PLINTH_RADIUS } from './burnTimeline';

const VERT_PARS = /* glsl */ `
varying vec3 vGuyPos;
uniform float uGuyFall;
`;
const FALL = /* glsl */ `
vGuyPos = transformed;
float floorY = (length(transformed.xz) < ${PLINTH_RADIUS.toFixed(3)} ? ${PLINTH_HEIGHT.toFixed(3)} : 0.0) + ${GUY_GROUND_CLEARANCE.toFixed(3)};
transformed.y = max(floorY, transformed.y - uGuyFall);
#include <project_vertex>
`;

const PARS = /* glsl */ `
varying vec3 vGuyPos;
uniform float uGuyBurn;
float guyBurnFront() {
  return clamp(1.0 - vGuyPos.y / ${GUY_HEIGHT.toFixed(1)}, 0.0, 0.9999);
}
`;
const MASK = /* glsl */ `
if (uGuyBurn > guyBurnFront()) discard;
`;

export function createGuyLineMaterial(uniforms: EnvUniforms, burn: { value: number }, fall: { value: number }): THREE.MeshStandardMaterial {
  const mat = createEnvMaterial(uniforms, { roughness: 0.7, sway: 0.08 });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.uGuyBurn = burn;
    shader.uniforms.uGuyFall = fall;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', FALL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${MASK}`)
      .replace('#include <lights_physical_fragment>', /* glsl */ `
        if (uGuyBurn > 0.0 && uGuyBurn < 1.0) {
          float edge = 1.0 - smoothstep(0.0, 0.065, guyBurnFront() - uGuyBurn);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025), edge);
          totalEmissiveRadiance += vec3(1.0, 0.22, 0.025) * edge * 3.0;
        }
        #include <lights_physical_fragment>
      `);
  };
  mat.customProgramCacheKey = () => 'effigy-guylines-fall-v2';

  const depth = swayDepthOf(mat)!;
  const depthBase = depth.onBeforeCompile;
  depth.onBeforeCompile = (shader, renderer) => {
    depthBase(shader, renderer);
    shader.uniforms.uGuyBurn = burn;
    shader.uniforms.uGuyFall = fall;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', FALL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${MASK}`);
  };
  depth.customProgramCacheKey = () => 'effigy-guylines-fall-depth-v2';
  return mat;
}
