import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../../../tests/bossFixture';
import type { EnvContext } from '../../envTypes';
import { BossCombatFx } from './combatFx';
import { BossCombatPose } from './combatPose';
import { disposeBossModel, prepareBossModel } from './bossModel';

async function rig() {
  const bytes = readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb', import.meta.url));
  const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const teeth: THREE.SkinnedMesh[] = [];
  source.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    let label = object.name;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.name) { label = parent.userData.name; break; }
    }
    if (/^(Upper|Lower) tooth 0[89]$/.test(label)) teeth.push(object);
  });
  expect(teeth).toHaveLength(4);
  const model = prepareBossModel(source), head = model.getObjectByName('head') as THREE.Bone;
  const headRest = head.getWorldQuaternion(new THREE.Quaternion());
  const pose = new BossCombatPose(model);
  const env = { noise: new THREE.DataTexture(new Uint8Array([127, 127, 127, 255]), 1, 1),
    ctx: { world: { lattice: { version: 0, nodes: [], edges: [] }, survey: { version: 0, edgeLey: new Int8Array() }, map: { effigy: { x: 0, z: 0 } }, factions: [{ color: 0xdddddd }] } },
  } as unknown as EnvContext;
  const fx = new BossCombatFx(env, model);
  return { model, head, headRest, teeth, pose, fx };
}

/** Measure the real skinned front-incisor opening rather than the jaw hinge. */
function mouthCenter(teeth: THREE.SkinnedMesh[]): THREE.Vector3 {
  teeth[0].skeleton.update();
  const center = new THREE.Vector3();
  for (const mesh of teeth) {
    const bounds = new THREE.Box3();
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++)
      bounds.expandByPoint(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    center.add(bounds.getCenter(new THREE.Vector3()));
  }
  return center.multiplyScalar(1 / teeth.length);
}

describe('crouched eating hand-to-mouth alignment', () => {
  it('puts the actual carried target between the original teeth through bite and chewing', async () => {
    const { model, teeth, pose, fx } = await rig();
    const boss = bossFixture(); boss.action = 'grab'; boss.crouched = true; boss.barrier = null; boss.actionAt = boss.spawnedAt = 0;
    boss.held = { kind: 'building', id: 2, faction: 0, x: 0, z: 0 };
    const held = model.getObjectByName('boss-held-target')!;
    expect(held.position.toArray()).toEqual([0, 1.7, 0]);
    for (let frame = 0; frame <= 36; frame++) {
      const time = 2.25 + frame * .025;
      pose.sample(boss, time); fx.update(boss, time); model.updateMatrixWorld(true);
      expect(held.getWorldPosition(new THREE.Vector3()).distanceTo(mouthCenter(teeth)), `${time.toFixed(3)}s`).toBeLessThan(.06);
    }
    fx.dispose(); disposeBossModel(model);
  });

  it('keeps every carried target at the mouth for either stance flag and rotated encounter headings', async () => {
    const { model, teeth, pose, fx } = await rig();
    const boss = bossFixture(); boss.action = 'grab'; boss.barrier = null; boss.actionAt = boss.spawnedAt = 0;
    const held = model.getObjectByName('boss-held-target')!;
    for (const crouched of [false, true]) for (const kind of ['flag', 'building', 'piece'] as const)
      for (const yaw of [0, .7, Math.PI, -2.1]) {
        boss.crouched = crouched; boss.yaw = yaw; boss.held = { kind, id: 2, faction: 0, x: 0, z: 0 };
        model.rotation.y = yaw;
        for (const time of [2.25, 2.55, 2.7]) {
          pose.sample(boss, time); fx.update(boss, time); model.updateMatrixWorld(true);
          const distance = held.getWorldPosition(new THREE.Vector3()).distanceTo(mouthCenter(teeth));
          expect(distance, `${kind}, crouched=${crouched}, yaw=${yaw}, time=${time}`).toBeLessThan(.06);
        }
      }
    fx.dispose(); disposeBossModel(model);
  });

  it('hides the carried-target cue immediately when a host meal interrupt begins recoil', async () => {
    const { model, pose, fx } = await rig();
    const boss = bossFixture(); boss.action = 'grab'; boss.crouched = true; boss.actionAt = 0;
    boss.held = { kind: 'building', id: 2, faction: 0, x: 0, z: 0 };
    pose.sample(boss, 2); fx.update(boss, 2);
    const held = model.getObjectByName('boss-held-target')!;
    expect(held.visible).toBe(true);
    boss.action = 'recoil'; boss.actionAt = 2; boss.held = null;
    for (const now of [2, 2.25, 2.9, 3]) {
      pose.sample(boss, now); fx.update(boss, now);
      expect(held.visible).toBe(false);
    }
    fx.dispose(); disposeBossModel(model);
  });

  it('enlarges the grip with the 32m hand while keeping carried world objects their existing size', async () => {
    const { model, pose, fx } = await rig();
    const boss = bossFixture(); boss.action = 'grab'; boss.crouched = true; boss.actionAt = boss.spawnedAt = 0;
    boss.held = { kind: 'building', id: 2, faction: 0, x: 0, z: 0 };
    pose.sample(boss, 2.25); fx.update(boss, 2.25); model.updateMatrixWorld(true);
    const held = model.getObjectByName('boss-held-target')!, hand = model.getObjectByName('handR')!;
    expect(held.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(1.7, 5);
    for (const name of ['boss-held-flag-pole', 'boss-held-building-body', 'boss-held-wall-planks']) {
      const size = model.getObjectByName(name)!.getWorldScale(new THREE.Vector3());
      size.toArray().forEach(value => expect(value).toBeCloseTo(20 / 32, 5));
    }
    fx.dispose(); disposeBossModel(model);
  });

  it('brings the grip up from below and points the fingers into the mouth instead of toward the hat', async () => {
    const { model, head, headRest, teeth, pose, fx } = await rig();
    const boss = bossFixture(); boss.action = 'grab'; boss.crouched = true; boss.barrier = null; boss.actionAt = boss.spawnedAt = 0;
    boss.held = { kind: 'building', id: 2, faction: 0, x: 0, z: 0 };
    const held = model.getObjectByName('boss-held-target')!;
    let distance = Infinity;
    for (const time of [1.35, 1.5, 1.7, 1.9, 2.05, 2.2, 2.25]) {
      pose.sample(boss, time); model.updateMatrixWorld(true);
      const next = held.getWorldPosition(new THREE.Vector3()).distanceTo(mouthCenter(teeth));
      expect(next).toBeLessThanOrEqual(distance + .01); distance = next;
    }
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(headRest.invert())
      .applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(model.getObjectByName('handR')!.getWorldQuaternion(new THREE.Quaternion()));
    expect(fingers.dot(front)).toBeLessThan(-.99);
    expect(distance).toBeLessThan(.01);
    fx.dispose(); disposeBossModel(model);
  });
});
