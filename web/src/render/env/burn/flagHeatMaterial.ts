/** One heat drive shared by the cloth, mast, straps and gold finial. */
import * as THREE from 'three';

export function createFlagHeatUniforms() {
  return {
    uFlagHeatActive: { value: 0 },
    uFlagHeatColor: { value: new THREE.Color(0, 0, 0) },
    uFlagHeatEmissive: { value: 0 },
  };
}

/** Runs after the original material's char/festival glow, so black cannot be re-lit. */
export function applyFlagHeatMaterial(mat: THREE.MeshStandardMaterial, heat: ReturnType<typeof createFlagHeatUniforms>): void {
  const base = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    Object.assign(shader.uniforms, heat);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlagHeatActive;
        uniform vec3 uFlagHeatColor;
        uniform float uFlagHeatEmissive;
      `)
      .replace('#include <lights_physical_fragment>', `
        if (uFlagHeatActive > 0.5) {
          diffuseColor.rgb = uFlagHeatColor;
          totalEmissiveRadiance = uFlagHeatColor * uFlagHeatEmissive;
        }
        #include <lights_physical_fragment>
      `);
  };
  mat.customProgramCacheKey = () => key + '-shared-flag-heat-v1';
}
