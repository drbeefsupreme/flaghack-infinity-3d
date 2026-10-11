import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatch } from '../../../sim/setup';
import { normalizeMatch } from '../../../sim/matchSettings';
import { destroySceneryHit } from '../../../sim/systems/scenery';
import { createDayState } from '../timeOfDay';
import type { EnvContext } from '../envTypes';
import { PropField } from './propField';

type Range = { geometry: THREE.BufferGeometry; start: number; count: number };
type FieldInternals = { sceneryRanges: Map<number, Range[]>;
  sceneryInstances: Map<number, { mesh: THREE.BatchedMesh; id: number }[]>;
  spinners: { mesh: THREE.InstancedMesh; rotors: { obstacleId: number }[] }[] };
const internals = (field: PropField) => field as unknown as FieldInternals;

function environment(full = false): EnvContext {
  const world = createMatch({ seed: 'scenery-render', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  if (!full) world.map.obstacles = ['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car']
    .map(kind => world.map.obstacles.find(o => o.kind === kind)!);
  return {
    ctx: { world, quality: 'low', beat: 0, time: 0 } as EnvContext['ctx'],
    root: new THREE.Group(), day: { ...createDayState(), night: 1 },
    uniforms: { uTime: { value: 0 }, uNight: { value: 1 }, uBeat: { value: 0 }, uWind: { value: new THREE.Vector2() },
      uBurn: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() } },
  } as EnvContext;
}

beforeEach(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
  vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) });
});
afterEach(() => vi.unstubAllGlobals());

function snapshot(root: THREE.Object3D) {
  const meshes: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[];
    attributes: Map<string, Float32Array>; index: number[] | null }[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh) meshes.push({ mesh: o, geometry: o.geometry, material: o.material,
    attributes: new Map(Object.entries(o.geometry.attributes).map(([name, attr]) => [name, Float32Array.from((attr as THREE.BufferAttribute).array)])),
    index: o.geometry.index ? Array.from(o.geometry.index.array) : null }); });
  return meshes;
}

function expectCollapsed(range: Range) {
  const p = range.geometry.getAttribute('position'), sway = range.geometry.getAttribute('aSway');
  for (let v = range.start; v < range.start + range.count; v += 3) {
    for (let k = 0; k < 3; k++) {
      expect([p.getX(v + k), p.getY(v + k), p.getZ(v + k)]).toEqual([p.getX(v), p.getY(v), p.getZ(v)]);
      expect(sway.getX(v + k)).toBe(0);
    }
  }
}

describe('incremental destroyed scenery rendering', () => {
  it('removes every prop part, signs and show, preserves forest and batching, and cleans up', () => {
    const env = environment(), world = env.ctx.world, field = new PropField(env);
    field.update(0);
    const before = snapshot(env.root), root = env.root.getObjectByName('props');
    const materialsDisposed = before.map(({ material }) => vi.spyOn(material as THREE.Material, 'dispose'));
    for (const o of world.map.obstacles) {
      expect(internals(field).sceneryRanges.get(o.id)?.length).toBeGreaterThan(0);
      destroySceneryHit(world, -1 - o.id);
    }
    field.update(0);
    expect(env.root.getObjectByName('props')).toBe(root);
    const after = snapshot(env.root); expect(after).toHaveLength(before.length);
    for (const [i, old] of before.entries()) {
      expect(after[i].mesh).toBe(old.mesh); expect(after[i].geometry).toBe(old.geometry); expect(after[i].material).toBe(old.material);
      if (old.mesh.name.startsWith('forest-')) for (const [name, values] of old.attributes)
        expect(old.geometry.getAttribute(name).array).toEqual(values);
    }
    for (const ranges of internals(field).sceneryRanges.values()) for (const r of ranges) expectCollapsed(r);
    for (const instances of internals(field).sceneryInstances.values()) for (const it of instances) expect(it.mesh.getVisibleAt(it.id)).toBe(false);
    expect(env.root.getObjectByName('stage-beams')!.visible).toBe(false);
    expect(env.root.getObjectByName('stage-pools')!.visible).toBe(false);
    const sign = env.root.getObjectByName('stage-signs') as THREE.Mesh;
    expect(Array.from(sign.geometry.index!.array).every(v => v === 0)).toBe(true);
    for (const spy of materialsDisposed) expect(spy).not.toHaveBeenCalled();
    field.update(0); expect(env.root.getObjectByName('props')).toBe(root);
    field.dispose(); expect(env.root.children).toHaveLength(0);
    for (const spy of materialsDisposed) expect(spy).toHaveBeenCalled();
  });

  it('changes only owned triangle positions/sway and attached instances on the complete seeded map', () => {
    const env = environment(true), world = env.ctx.world, field = new PropField(env);
    field.update(0);
    const before = snapshot(env.root), info = internals(field);
    // Every destructible obstacle, not just a hand-picked sample, must have an owner range.
    for (const o of world.map.obstacles.filter(o => o.kind !== 'effigy')) expect(info.sceneryRanges.get(o.id)?.length).toBeGreaterThan(0);
    const selected = ['tent', 'shade', 'dome', 'porta', 'rock', 'stage', 'car'].map(kind => world.map.obstacles.find(o => o.kind === kind)!);
    selected.push(...world.map.obstacles.filter(o => o.kind === 'art' && (o.variant === 2 || o.variant === 3)).slice(0, 3));
    selected.push(...world.map.obstacles.filter(o => o.kind === 'tree').slice(0, 2));
    const changed = new Map<THREE.BufferGeometry, Set<number>>();
    for (const o of selected) {
      for (const range of info.sceneryRanges.get(o.id)!) {
        const ids = changed.get(range.geometry) ?? new Set<number>();
        for (let v = range.start; v < range.start + range.count; v++) ids.add(v);
        changed.set(range.geometry, ids);
      }
      destroySceneryHit(world, -1 - o.id);
    }
    // Simulate uploads completed before this frame; only dirty subranges should be sent next.
    for (const old of before) for (const attr of Object.values(old.geometry.attributes)) (attr as THREE.BufferAttribute).clearUpdateRanges();
    field.update(0);
    const after = snapshot(env.root); expect(after.length).toBe(before.length);
    for (const old of before) {
      expect(old.mesh.geometry).toBe(old.geometry); expect(old.mesh.material).toBe(old.material);
      for (const [name, original] of old.attributes) {
        const attr = old.geometry.getAttribute(name) as THREE.BufferAttribute, actual = attr.array;
        const vertices = changed.get(old.geometry);
        // Stage signs use an index-only edit; rotors/canopies use instance-only edits.
        const expected = original.slice();
        if (vertices && (name === 'position' || name === 'aSway')) for (const v of vertices) {
          if (name === 'aSway') expected[v] = 0;
          else for (let c = 0; c < 3; c++) expected[v * 3 + c] = original[Math.floor(v / 3) * 9 + c];
        }
        expect(actual).toEqual(expected);
        if (vertices && (name === 'position' || name === 'aSway')) {
          expect(attr.updateRanges.length).toBeGreaterThan(0);
          expect(attr.updateRanges.reduce((n, range) => n + range.count, 0)).toBeLessThan(attr.array.length);
        }
      }
    }
    for (const o of selected) for (const r of info.sceneryRanges.get(o.id)!) expectCollapsed(r);
    for (const [id, instances] of info.sceneryInstances) for (const it of instances) expect(it.mesh.getVisibleAt(it.id)).toBe(!world.destroyedScenery.has(id));
    for (const { mesh, rotors } of info.spinners) rotors.forEach((rotor, i) => {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      expect(matrix.determinant() === 0).toBe(world.destroyedScenery.has(rotor.obstacleId));
    });
    // Different frame times cannot resurrect zeroed animated pieces.
    env.uniforms.uTime.value = 200; field.update(1 / 60);
    for (const { mesh, rotors } of info.spinners) rotors.forEach((rotor, i) => {
      if (world.destroyedScenery.has(rotor.obstacleId)) { const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix); expect(matrix.determinant()).toBe(0); }
    });
    field.dispose();
  });

  it('removes a shared string from either endpoint and only silences the destroyed stage', () => {
    const env = environment(true), field = new PropField(env), world = env.ctx.world, info = internals(field);
    field.update(0);
    const owners = new Map<Range, number[]>();
    for (const [id, ranges] of info.sceneryRanges) for (const range of ranges) {
      const ids = owners.get(range) ?? []; ids.push(id); owners.set(range, ids);
    }
    const shared = [...owners].find(([, ids]) => ids.length === 2)!;
    expect(shared).toBeDefined();
    // The range actually spans distinct source props; either endpoint owns its removal.
    const [range, ids] = shared;
    world.destroyedScenery.add(ids[1]); field.update(0); expectCollapsed(range);
    expect(world.destroyedScenery.has(ids[0])).toBe(false);
    const stage = world.map.obstacles.find(o => o.kind === 'stage')!;
    const beams = env.root.getObjectByName('stage-beams') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const pools = env.root.getObjectByName('stage-pools') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const before = Float32Array.from(beams.material.uniforms.uBeamDir.value as Float32Array);
    const stageInfo = pools.material.uniforms.uStageInfo.value as Float32Array;
    const first = stageInfo[0], count = stageInfo[1];
    expect(count).toBeGreaterThan(0);
    world.destroyedScenery.add(stage.id); field.update(0);
    const after = beams.material.uniforms.uBeamDir.value as Float32Array;
    for (let i = 0; i < after.length; i++) expect(after[i]).toBe(i >= first * 4 && i < (first + count) * 4 && i % 4 === 3 ? 0 : before[i]);
    expect(Array.from(stageInfo.slice(1, 4))).toEqual([0, 0, 0]);
    expect(beams.visible).toBe(true); expect(pools.visible).toBe(true); // Other stages continue.
    field.dispose();
  });

  it('reconstructs the same removals on late joins and restores geometry on a reset', () => {
    const env = environment(), world = env.ctx.world, field = new PropField(env);
    for (const o of world.map.obstacles) destroySceneryHit(world, -1 - o.id);
    field.update(0);
    const removed = snapshot(env.root).filter(o => o.mesh.name.startsWith('props-')).map(o => o.attributes);
    field.dispose();
    const late = new PropField(env); late.update(0);
    const reconstructed = snapshot(env.root).filter(o => o.mesh.name.startsWith('props-')).map(o => o.attributes);
    expect(reconstructed).toEqual(removed);
    const old = env.root.getObjectByName('props');
    world.destroyedScenery.clear(); late.update(0);
    expect(env.root.getObjectByName('props')).not.toBe(old);
    expect(env.root.getObjectByName('stage-beams')!.visible).toBe(true);
    for (const instances of internals(late).sceneryInstances.values()) for (const it of instances) expect(it.mesh.getVisibleAt(it.id)).toBe(true);
    late.dispose(); expect(env.root.children).toHaveLength(0);
  });
});
