import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyBossAwakeningMaterial } from './awakeningMaterial';
import { createGradeMaterial } from '../../../post/grade';

describe('awakening silhouette and HDR grade contract', () => {
  it('keeps source materials and opaque depth, chaining earlier hooks and using a uniform-only mask', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x416582, roughness: .72, metalness: .3 });
    const before = { color: material.color.toArray(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
    material.onBeforeCompile = shader => { shader.uniforms.priorHook = { value: 1 }; };
    const level = { value: 1 }; applyBossAwakeningMaterial(material, level);
    const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: THREE.ShaderLib.standard.vertexShader } as Parameters<THREE.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.priorHook.value).toBe(1); expect(shader.uniforms.uBossAwakening).toBe(level);
    expect(shader.fragmentShader).toContain('if (uBossAwakening > 0.0) directLight.color = vec3(0.0)');
    expect(shader.fragmentShader).toContain('if (uBossAwakening > 0.0) gl_FragColor.a = 0.0');
    expect(shader.fragmentShader.indexOf('gl_FragColor.a = 0.0')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
    level.value = 0; expect(shader.uniforms.uBossAwakening.value).toBe(0);
    expect({ color: material.color.toArray(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite }).toEqual(before);
    material.dispose();
  });

  it('preserves the silhouette against bloom and clips illuminated pixels after display grading in the existing pass', () => {
    const { material, uniforms } = createGradeMaterial();
    expect(uniforms.uAwakening.value).toBe(0);
    expect(material.fragmentShader).toContain('uAwakening > 0.0 ? scene.a : 1.0');
    expect(material.fragmentShader).toContain('awakeningWhite = uAwakening * texture2D(tDiffuse, uv).a');
    expect(material.fragmentShader.indexOf('sc = mix(sc, vec3(1.0), awakeningWhite)')).toBeGreaterThan(material.fragmentShader.indexOf('parchment(sc, vUv'));
    expect(material.depthWrite).toBe(false); expect(material.depthTest).toBe(false);
    material.dispose();
  });
});
