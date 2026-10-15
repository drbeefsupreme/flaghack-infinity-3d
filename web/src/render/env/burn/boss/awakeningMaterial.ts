/** Exclude the real opaque rig from the eruption without another draw or mask pass. */
import * as THREE from 'three';

export function applyBossAwakeningMaterial(material: THREE.MeshStandardMaterial, level: { value: number }): void {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uBossAwakening = level;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBossAwakening;')
      // The eruption reuses the fire point light. During these five seconds, exclude
      // point illumination from the rig, leaving only a dim ambient silhouette.
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getPointLightInfo( pointLight, geometryPosition, directLight );',
        'getPointLightInfo( pointLight, geometryPosition, directLight );\nif (uBossAwakening > 0.0) directLight.color = vec3(0.0);'))
      .replace('#include <opaque_fragment>', `
        outgoingLight *= mix(1.0, 0.025, uBossAwakening) / (1.0 + 3.0 * uBossAwakening);
        #include <opaque_fragment>
        // Scene HDR alpha is otherwise opaque. Preserve genuine depth/MSAA coverage
        // so the final grade cannot spread white bloom across the boss silhouette.
        if (uBossAwakening > 0.0) gl_FragColor.a = 0.0;`);
  };
  material.customProgramCacheKey = () => key + '-boss-awakening-v1';
}
