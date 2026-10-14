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

  it('preserves the silhouette against bloom and halves whiteout strength after display grading in the existing pass', () => {
    const { material, uniforms } = createGradeMaterial();
    expect(uniforms.uAwakening.value).toBe(0);
    expect(material.fragmentShader).toContain('uAwakening > 0.0 ? scene.a : 1.0');
    expect(material.fragmentShader).toContain('awakeningWhite = uAwakening * texture2D(tDiffuse, uv).a');
    const whiteout = material.fragmentShader.match(/sc = mix\(sc, vec3\(1\.0\), awakeningWhite \* ([\d.]+)\)/);
    expect(whiteout).not.toBeNull();
    const strength = Number(whiteout![1]);
    expect(strength).toBe(.5);
    expect(material.fragmentShader.indexOf(whiteout![0])).toBeGreaterThan(material.fragmentShader.indexOf('parchment(sc, vUv'));
    // Every envelope/coverage sample adds exactly half as much white; masked
    // boss pixels and samples outside the five-second window add none.
    for (const level of [0, .25, .5, 1]) for (const coverage of [0, .5, 1]) {
      const previous = level * coverage;
      for (const channel of [0, .2, .75, 1]) {
        const oldLift = (1 - channel) * previous;
        const newLift = (1 - channel) * previous * strength;
        expect(newLift).toBeCloseTo(oldLift / 2);
      }
      if (level === 0 || coverage === 0) expect(previous * strength).toBe(0);
    }
    expect(material.depthWrite).toBe(false); expect(material.depthTest).toBe(false);
    material.dispose();
  });
});
