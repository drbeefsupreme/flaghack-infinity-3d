import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disposeBossModel, prepareBossModel } from './bossModel';
import { BOSS_OPEN_ARMS_AT, BossRevealPose } from './revealPose';

async function loadModel() {
  const bytes = fs.readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return prepareBossModel(gltf.scene);
}
function point(model: THREE.Group, name: string): THREE.Vector3 {
  return model.worldToLocal(model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()));
}
function rotations(model: THREE.Object3D): number[][] {
  const result: number[][] = [];
  model.traverse((o) => { if (o instanceof THREE.Bone) result.push(o.quaternion.toArray()); });
  return result;
}
function expectPoint(actual: THREE.Vector3, expected: number[]): void {
  expect(actual.distanceTo(new THREE.Vector3(...expected))).toBeLessThan(2e-4);
}

describe('actual boss reveal bone gesture', () => {
  let model: THREE.Group, pose: BossRevealPose;
  let restHead: THREE.Quaternion;
  beforeAll(async () => {
    model = await loadModel();
    restHead = model.getObjectByName('head')!.getWorldQuaternion(new THREE.Quaternion());
    pose = new BossRevealPose(model);
  });
  afterAll(() => disposeBossModel(model));

  it('holds crossed wrists ahead of the coat through the opening cue', () => {
    pose.sample(85);
    const crossed = rotations(model);
    expectPoint(point(model, 'handL'), [-1.3, 20.2, 3.5]);
    expectPoint(point(model, 'handR'), [1.3, 19.8, 2.2]);
    // The two forearms overlap in front view but occupy separate depth planes.
    expect(point(model, 'handL').z - point(model, 'handR').z).toBeCloseTo(1.3, 4);
    expect(point(model, 'forearmL').z).toBeGreaterThan(2.5);
    expect(point(model, 'forearmR').z).toBeGreaterThan(1.8);
    pose.sample(BOSS_OPEN_ARMS_AT);
    expect(rotations(model)).toEqual(crossed);
  });

  it('hits the wide spread and thirty-degree head-back exactly at the explosion', () => {
    pose.sample(90);
    expectPoint(point(model, 'handL'), [9.6, 23, .6]);
    expectPoint(point(model, 'handR'), [-9.6, 23, .6]);
    const tilt = model.getObjectByName('head')!.getWorldQuaternion(new THREE.Quaternion()).multiply(restHead.clone().invert());
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 6);
    expect(tilt.angleTo(expected)).toBeLessThan(2e-5);
    const spread = rotations(model);
    pose.sample(9000);
    expect(rotations(model)).toEqual(spread);
  });

  it('seeks and restarts without drift or changes to geometry, weights, materials, or root scale', () => {
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => { if (o instanceof THREE.SkinnedMesh) meshes.push(o); });
    const sourceData = meshes.map((m) => ({ geometry: m.geometry, position: m.geometry.getAttribute('position'),
      weights: m.geometry.getAttribute('skinWeight'), joints: m.geometry.getAttribute('skinIndex'), material: m.material, skeleton: m.skeleton }));
    pose.sample(89.725);
    const halfway = rotations(model);
    const wristAtHalf = point(model, 'handL');
    expect(wristAtHalf.x).toBeGreaterThan(-1.3);
    expect(wristAtHalf.x).toBeLessThan(9.6);
    for (let i = 0; i < 200; i++) pose.sample(i % 2 ? 85 : 93);
    pose.sample(89.725);
    expect(rotations(model)).toEqual(halfway);
    pose.sample(85);
    expectPoint(point(model, 'handL'), [-1.3, 20.2, 3.5]);
    for (const [i, m] of meshes.entries()) {
      expect(m.geometry).toBe(sourceData[i].geometry);
      expect(m.geometry.getAttribute('position')).toBe(sourceData[i].position);
      expect(m.geometry.getAttribute('skinWeight')).toBe(sourceData[i].weights);
      expect(m.geometry.getAttribute('skinIndex')).toBe(sourceData[i].joints);
      expect(m.material).toBe(sourceData[i].material);
      expect(m.skeleton).toBe(sourceData[i].skeleton);
    }
    expect(meshes).toHaveLength(31);
    expect(meshes[0].skeleton.bones).toHaveLength(109);
    expect(model.scale.toArray()).toEqual([1, 1, 1]);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
  });

  it('solves identical source-frame targets under scene translation and facing transforms', async () => {
    const transformed = await loadModel();
    const sceneRoot = new THREE.Group();
    sceneRoot.position.set(41, 7, -20);
    sceneRoot.rotation.set(.1, 1.2, -.04);
    sceneRoot.scale.setScalar(1.7);
    transformed.position.set(-6, -14, 8);
    transformed.rotation.y = -.4;
    sceneRoot.add(transformed);
    const gesture = new BossRevealPose(transformed);
    expectPoint(point(transformed, 'handL'), [-1.3, 20.2, 3.5]);
    expectPoint(point(transformed, 'handR'), [1.3, 19.8, 2.2]);
    gesture.sample(90);
    expectPoint(point(transformed, 'handL'), [9.6, 23, .6]);
    expectPoint(point(transformed, 'handR'), [-9.6, 23, .6]);
    expect(transformed.position.toArray()).toEqual([-6, -14, 8]);
    expect(transformed.scale.toArray()).toEqual([1, 1, 1]);
    disposeBossModel(transformed);
  });
});
