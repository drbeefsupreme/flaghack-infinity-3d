import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../../../tests/bossFixture';
import { BurningCoatFx, applyBurningCoatMaterial } from './burningCoatFx';
import { prepareBossModel, disposeBossModel } from './bossModel';
import { BossCombatPose } from './combatPose';
import { applyBossDeathMaterial } from './combatFx';
import { applyBossAwakeningMaterial } from './awakeningMaterial';
import { applyBossChargeMaterial } from './revealTimeline';

async function fixture() {
  const b = fs.readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb', import.meta.url));
  const model = prepareBossModel((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene);
  const pose = new BossCombatPose(model), noise = new THREE.DataTexture(new Uint8Array([127,127,127,255]), 1, 1);
  const effect = new BurningCoatFx(model, noise), root = new THREE.Group(); root.add(model, effect.group);
  const boss = bossFixture(); boss.action = 'idle'; boss.actionAt = 0; boss.crouched = false;
  const sample = (now = 100, age = 10, awakening = 0, present = true) => {
    pose.sample(boss, now); root.updateMatrixWorld(true); effect.update(boss, now, age, awakening, present);
    return Array.from(effect.mesh.geometry.getAttribute('aCenter').array);
  };
  const dispose = () => { effect.dispose(); disposeBossModel(model); noise.dispose(); };
  return { model, pose, effect, root, boss, sample, dispose, noise };
}

describe('live burning coat', () => {
  it('bounds cost to one draw/76 triangles, samples real weighted surfaces and preserves all source meshes/material values', async () => {
    const f = await fixture(); const coords = f.sample();
    expect(f.effect.group.children).toHaveLength(1);
    expect(f.effect.mesh.geometry.instanceCount).toBe(38);
    expect(coords.every(Number.isFinite)).toBe(true);
    expect(Math.min(...coords.filter((_, i) => i % 3 === 1))).toBeGreaterThan(5);
    expect(Math.max(...coords.filter((_, i) => i % 3 === 1))).toBeLessThan(27);
    const skinned: THREE.SkinnedMesh[] = [];
    f.model.traverse(o => { if(o instanceof THREE.SkinnedMesh) skinned.push(o); });
    expect(skinned).toHaveLength(31);
    expect(skinned.reduce((n,m) => n + m.geometry.index!.count / 3, 0)).toBe(401386);
    expect(f.effect.mesh.material.depthWrite).toBe(false);
    expect(f.effect.mesh.material.depthTest).toBe(true);
    f.dispose();
  });

  it('follows walk, crouch and attacks deterministically without accumulating emitters or leaving replay residue', async () => {
    const f = await fixture(); const initial = f.sample();
    for (const action of ['walk', 'crouchWalk', 'swipe', 'stomp', 'grab'] as const) {
      f.boss.action = action; f.boss.actionAt = 99.3; f.boss.stride = 5;
      const at = f.sample(); expect(at.every(Number.isFinite)).toBe(true); expect(at).not.toEqual(initial);
      expect(f.sample()).toEqual(at); expect(f.effect.mesh.geometry.instanceCount).toBe(38);
    }
    f.boss.action = 'idle'; f.boss.actionAt = 0; expect(f.sample()).toEqual(initial);
    f.root.position.set(12,3,-8); expect(f.sample().map(v=>Math.round(v*1000))).toEqual(initial.map(v=>Math.round(v*1000)));
    f.dispose();
  });

  it('hides during emergence, silhouette, death, absent boss and end screens; restores on replay', async () => {
    const f = await fixture();
    f.sample(); expect(f.effect.level.value).toBe(1);
    for (const age of [-1,0,4.9,5]) { f.sample(100,age); expect(f.effect.group.visible).toBe(false); }
    f.sample(100,5.6); expect(f.effect.level.value).toBeCloseTo(.5);
    f.sample(100,10,1); expect(f.effect.group.visible).toBe(false);
    f.sample(100,10,0,false); expect(f.effect.level.value).toBe(0);
    f.boss.action='emerge'; f.sample(); expect(f.effect.level.value).toBe(0);
    f.boss.action='idle'; f.boss.deathAt=100; f.sample(); expect(f.effect.level.value).toBe(0);
    f.boss.deathAt=null; f.sample(); expect(f.effect.level.value).toBe(1);
    f.effect.update(null,100,10,0,true); expect(f.effect.group.visible).toBe(false);
    const gd=vi.spyOn(f.effect.mesh.geometry,'dispose'), md=vi.spyOn(f.effect.mesh.material,'dispose'), nd=vi.spyOn(f.noise,'dispose');
    f.effect.dispose(); f.effect.dispose(); f.sample();
    expect(f.effect.group.visible).toBe(false); expect(f.effect.level.value).toBe(0);
    expect(gd).toHaveBeenCalledTimes(1); expect(md).toHaveBeenCalledTimes(1); expect(nd).not.toHaveBeenCalled(); f.dispose();
  });

  it('adds restrained coat/cavity emission before protected emergence/death overrides and never modifies the hat', () => {
    for (const name of ['Coat | charcoal gray wool','Coat | inside facing','Skull • deep cavities']) {
      const m = new THREE.MeshStandardMaterial({color:0x30343a}); m.name=name;
      const before = m.color.clone(), level={value:0}, time={value:0};
      expect(applyBurningCoatMaterial(m,level,time)).toBe(true);
      applyBossDeathMaterial(m,{value:-1}); applyBossChargeMaterial(m,{value:0}); applyBossAwakeningMaterial(m,{value:0});
      const shader = { uniforms:{}, vertexShader:THREE.ShaderLib.standard.vertexShader, fragmentShader:THREE.ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(shader as never,{} as THREE.WebGLRenderer);
      expect(shader.uniforms).toMatchObject({uCoatFireLevel:level,uCoatFireTime:time});
      expect(shader.fragmentShader).toContain('coatEmber*uCoatFireLevel');
      expect(shader.fragmentShader).toContain('outgoingLight *= mix(1.0, 0.025, uBossAwakening)');
      expect(m.color.equals(before)).toBe(true); expect(m.emissive.getHex()).toBe(0); m.dispose();
    }
    const hat=new THREE.MeshStandardMaterial(); hat.name='HAT | Storm-blue fulled wool';
    const compile=hat.onBeforeCompile; expect(applyBurningCoatMaterial(hat,{value:1},{value:0})).toBe(false);
    expect(hat.onBeforeCompile).toBe(compile); hat.dispose();
  });
});
