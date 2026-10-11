import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { createMatch } from '../../sim/setup';
import { BossLightningFx } from './bossLightningFx';
const flat = () => 0;
function fixture() {
  const world = createMatch({ seed: 'boss-lightning-fx', difficulty: 'normal', humans: [0], mode: 'standard' });
  world.boss = bossFixture(); world.boss.lightning = [
    { kind: 'crystal', id: 91, faction: 0, from: { x: -50, y: 7.5, z: 0 }, to: { x: 1, y: 25, z: 2 } },
    { kind: 'crystal', id: 92, faction: 1, from: { x: 300, y: 75, z: -200 }, to: { x: 1, y: 25, z: 2 } },
    { kind: 'ward', id: 93, faction: 0, from: { x: 15, y: 4.5, z: 10 }, to: { x: 1, y: 25, z: 2 } },
  ];
  const fx = new BossLightningFx(); return { world, fx, boss: world.boss };
}
describe('persistent boss defensive lightning presentation', () => {
  it('reconstructs every source on a late join with precise full-height endpoints, including the 75 m crystal', () => {
    const e = fixture(); e.fx.update(e.world, 100, flat); expect(e.fx.group.children).toHaveLength(3);
    for (const link of e.boss.lightning) {
      const mesh = e.fx.group.getObjectByName(`boss-defensive-lightning-${link.id}`) as THREE.Mesh;
      const positions = mesh.geometry.getAttribute('position');
      expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([link.from.x, link.from.y, link.from.z]);
      expect([positions.getX(48), positions.getY(48), positions.getZ(48)]).toEqual([link.to.x, link.to.y, link.to.z]);
    }
    e.fx.dispose();
  });
  it('reuses each mesh and buffer for repeated frames, preserves exact moving endpoints, and never mutates world state', () => {
    const e = fixture(); e.fx.update(e.world, 100, flat);
    const meshes = [...e.fx.group.children] as THREE.Mesh[], buffers = meshes.map(m => m.geometry.getAttribute('position').array);
    e.boss.lightning[0].to = { x: 10, y: 20, z: 30 }; const before = JSON.stringify(e.boss), hp = e.boss.hp;
    for (let frame = 1; frame <= 100; frame++) e.fx.update(e.world, 100 + frame / 144, flat);
    expect(e.fx.group.children).toEqual(meshes);
    meshes.forEach((m, i) => expect(m.geometry.getAttribute('position').array).toBe(buffers[i]));
    expect(JSON.stringify(e.boss)).toBe(before); expect(e.boss.hp).toBe(hp); expect(e.world.drainEvents()).toEqual([]);
    e.fx.dispose();
  });
  it('adds the same visual ground offsets as the existing Ward/Crystal lightning style', () => {
    const e = fixture(); e.fx.update(e.world, 100, (x,z) => x * .1 + z * .01);
    const mesh = e.fx.group.children[1] as THREE.Mesh, p = mesh.geometry.getAttribute('position');
    expect(p.getY(0)).toBe(103); expect(p.getY(48)).toBeCloseTo(25.12, 5); e.fx.dispose();
  });
  it('disposes ended links immediately and cancels all arcs on death, match end and absent boss', () => {
    const e = fixture(); e.fx.update(e.world, 100, flat);
    const mesh = e.fx.group.children[0] as THREE.Mesh, dispose = vi.spyOn(mesh.geometry, 'dispose');
    e.boss.lightning.shift(); e.fx.update(e.world, 101, flat); expect(dispose).toHaveBeenCalledOnce(); expect(e.fx.group.children).toHaveLength(2);
    e.boss.hp = 0; e.fx.update(e.world, 102, flat); expect(e.fx.group.children).toHaveLength(0); expect(e.fx.group.visible).toBe(false);
    e.boss.hp = 100; e.fx.update(e.world, 103, flat); expect(e.fx.group.children).toHaveLength(2);
    e.world.phase = 'ended'; e.fx.update(e.world, 104, flat); expect(e.fx.group.children).toHaveLength(0);
    e.world.phase = 'playing'; e.fx.update(e.world, 105, flat); e.world.boss = null; e.fx.update(e.world, 106, flat); expect(e.fx.group.visible).toBe(false);
    e.fx.dispose();
  });
});
