import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { groundHeight } from '../../sim/terrain';
import { rayCrystal } from '../../sim/crystalGeometry';
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
    expect(s.prism.material.vertexShader).toContain('vec3(iA.x, fhGround(iA.xy), iA.y) + p');
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


describe('authoritative prism ray geometry', () => {
  it.each([1, 10])('matches displayed scale-%s prism triangles across growth, rotation and grazing rays', scale => {
    const s = setup(); s.c.scale = scale; s.c.pos = { x: 3, z: -8 };
    for (const growth of [0, .3, 1]) for (const time of [0, 137.55]) {
      s.c.growth = growth; s.world.time = time; s.layer.update(time + 999, s.decals, s.beams);
      expect(s.prism.material.uniforms.uCrystalTime.value).toBe(time);
      const a = s.prism.geometry.getAttribute('iA'), b = s.prism.geometry.getAttribute('iB');
      const height = a.getZ(0) * (.12 + .88 * b.getY(0)), radius = a.getW(0) * (.55 + .45 * b.getY(0));
      const ground = groundHeight(s.c.pos.x, s.c.pos.z, s.world.map.half);
      const rotation = b.getX(0) + time * .12, cs = Math.cos(rotation), sn = Math.sin(rotation);
      const pos = s.prism.geometry.getAttribute('position'), vertices: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * radius, z = pos.getZ(i) * radius;
        vertices.push(a.getX(0) + x * cs - z * sn, ground + pos.getY(i) * height, a.getY(0) + x * sn + z * cs);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geo, material); mesh.updateMatrixWorld(true);
      for (const y of [.05, .79, .95, 1.001]) for (const x of [0, .5, .99, 1.01]) {
        const origin = new THREE.Vector3(s.c.pos.x + x * radius, ground + y * height, s.c.pos.z - radius * 3), direction = new THREE.Vector3(0, 0, 1);
        const shown = new THREE.Raycaster(origin, direction, 0, 1000).intersectObject(mesh)[0]?.distance ?? null;
        const authoritative = rayCrystal(s.c, time, origin, direction, 1000, s.world.map.half);
        if (shown === null) expect(authoritative).toBeNull();
        else expect(authoritative).toBeCloseTo(shown, 4);
      }
      geo.dispose(); material.dispose();
    }
    s.layer.dispose(); s.texture.dispose();
  });
});
