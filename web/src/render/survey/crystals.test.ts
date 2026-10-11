import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CRYSTAL_HEIGHT } from '../../sim/constants';
import { spawnCrystal } from '../../sim/factory';
import { createMatch } from '../../sim/setup';
import { CrystalLayer } from './crystals';
import { createSurveyUniforms } from './glsl';
import { DecalLayer } from './decals';
import { BeamLayer } from './beams';

function setup() {
  const world = createMatch({ seed: 'crystal-render', difficulty: 'normal', humans: [0], mode: 'standard' });
  const c = spawnCrystal(world, world.lattice.omegaNode, 0, []);
  const scene = new THREE.Scene();
  const texture = new THREE.DataTexture();
  const uniforms = createSurveyUniforms({ node: texture, aux: texture, edge: texture, facet: texture });
  const layer = new CrystalLayer(scene, world, uniforms);
  const decals = { push: vi.fn() } as unknown as DecalLayer;
  const beams = { push: vi.fn() } as unknown as BeamLayer;
  const prism = scene.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  const shard = scene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  return { world, c, scene, texture, layer, decals, beams, prism, shard };
}

describe('crystal scale rendering', () => {
  it.each([0, 0.3, 1])('scales the prism, orbiting shards, glow and pillar uniformly at growth %s', growth => {
    const s = setup(); s.c.growth = growth;
    s.layer.update(10, s.decals, s.beams);
    const read = (mesh: typeof s.prism, name: string) => Array.from(mesh.geometry.getAttribute(name).array).slice(0, 4);
    const normalPrism = read(s.prism, 'iA'), normalShard = read(s.shard, 'iA'), normalSize = read(s.shard, 'iB')[2];
    const beam = vi.mocked(s.beams.push).mock.calls[0], decal = vi.mocked(s.decals.push).mock.calls[0];
    s.c.scale = 10;
    s.layer.update(10, s.decals, s.beams);
    const bigPrism = read(s.prism, 'iA'), bigShard = read(s.shard, 'iA');
    for (const i of [0, 1]) { expect(bigPrism[i]).toBe(normalPrism[i]); expect(bigShard[i]).toBe(normalShard[i]); }
    for (const i of [2, 3]) { expect(bigPrism[i]).toBeCloseTo(normalPrism[i] * 10, 4); expect(bigShard[i]).toBeCloseTo(normalShard[i] * 10, 4); }
    expect(read(s.shard, 'iB')[2]).toBeCloseTo(normalSize * 10, 5);
    expect(s.shard.geometry.getAttribute('iScale').getX(0)).toBe(10);
    expect(bigPrism[2]).toBe(CRYSTAL_HEIGHT * 10);
    const bigBeam = vi.mocked(s.beams.push).mock.calls[1], bigDecal = vi.mocked(s.decals.push).mock.calls[1];
    expect(bigBeam[5]).toBeCloseTo(beam[5] * 10); expect(bigBeam[7]).toBeCloseTo(beam[7] * 10);
    expect(bigDecal[3]).toBeCloseTo(decal[3] * 10);
    expect(s.prism.frustumCulled).toBe(false); expect(s.shard.frustumCulled).toBe(false);
    // Both shaders anchor at world ground; no elevated group/pivot can float the larger crystal.
    expect(s.prism.material.vertexShader).toContain('vec3(iA.x, 0.0, iA.y) + p');
    s.layer.dispose(); s.texture.dispose();
  });

  it('retains giant scale while shattering, then reuses its view at normal scale without leakage', () => {
    const s = setup(); s.c.scale = 10; s.c.growth = 1;
    s.layer.update(0, s.decals, s.beams);
    s.world.crystals.delete(s.c.id);
    s.layer.update(0.1, s.decals, s.beams); s.layer.update(0.6, s.decals, s.beams);
    expect(s.prism.geometry.getAttribute('iA').getZ(0)).toBe(CRYSTAL_HEIGHT * 10);
    s.layer.update(2, s.decals, s.beams); expect(s.prism.geometry.instanceCount).toBe(0);
    const ordinary = spawnCrystal(s.world, s.world.lattice.omegaNode, 0, []); ordinary.growth = 1;
    s.layer.update(3, s.decals, s.beams);
    expect(s.prism.geometry.getAttribute('iA').getZ(0)).toBe(CRYSTAL_HEIGHT);
    expect(s.shard.geometry.getAttribute('iScale').getX(0)).toBe(1);
    s.layer.dispose(); s.texture.dispose();
  });
});
