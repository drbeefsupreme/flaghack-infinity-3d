import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { BossCombatPose, BOSS_COMBAT_TIMING } from './combatPose';
import { prepareBossModel, disposeBossModel } from './bossModel';
import { CROUCH_WALK_DATA } from './crouchWalkData';
import { BossReveal } from './bossReveal';
import { createDayState } from '../../timeOfDay';
import type { EnvContext } from '../../envTypes';
import type { BossState } from '../../../../sim/boss';

async function model() {
  const b = fs.readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb', import.meta.url));
  return prepareBossModel((await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene);
}
function boss(action: BossState['action'] = 'idle', crouched = false): BossState {
  return { id: 88, pos: { x: 12, z: -7 }, yaw: .7, hp: 5000, maxHp: 5000, spawnedAt: 100, action, actionAt: 110,
    actionSeq: 3, hitSeq: -1, target: null, focusFaction: null, retaliateId: null, retaliateUntil: 0,
    nextAttackAt: 0, deathAt: null, barrier: null, stride: 0, held: null, crouched };
}
function signature(m: THREE.Group): number[] {
  const values: number[] = [];
  m.traverse((o) => { if (o instanceof THREE.Bone) values.push(...o.position.toArray(), ...o.quaternion.toArray()); });
  return values;
}
function point(m: THREE.Group, name: string): THREE.Vector3 { return m.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()); }
function matrices(m: THREE.Group): number[] { const a: number[] = []; m.updateMatrixWorld(true); m.traverse((o) => { if (o instanceof THREE.Bone) a.push(...o.matrix.elements); }); return a; }

describe('approved-rig combat presentation', () => {
  it('uses the authentic complete native in-place crouch cycle with a closed seam', () => {
    expect(CROUCH_WALK_DATA.duration).toBe(2.4); expect(CROUCH_WALK_DATA.stride).toBe(6);
    expect(CROUCH_WALK_DATA.bones).toHaveLength(109);
    expect(CROUCH_WALK_DATA.frames).toHaveLength(61);
    expect(CROUCH_WALK_DATA.frames[0].positions).toEqual(CROUCH_WALK_DATA.frames[60].positions);
    expect(CROUCH_WALK_DATA.frames[0].quaternions).toEqual(CROUCH_WALK_DATA.frames[60].quaternions);
    const i = CROUCH_WALK_DATA.bones.indexOf('root');
    for (const frame of CROUCH_WALK_DATA.frames) expect(frame.positions[i * 3 + 2]).toBeCloseTo(-3.55, 5);
  });
  it('samples every action reversibly without consuming host state or changing the 20m scale', async () => {
    const m = await model(), p = new BossCombatPose(m);
    for (const action of ['idle', 'walk', 'crouch', 'crouchWalk', 'rise', 'swipe', 'stomp', 'grab', 'death', 'dead'] as const) {
      const b = boss(action, true); b.stride = 1.4; if (action === 'death' || action === 'dead') b.deathAt = 110;
      const before = JSON.stringify(b);
      p.sample(b, 111.1); const first = signature(m);
      p.sample(boss('walk'), 140); p.sample(b, 111.1);
      expect(signature(m)).toEqual(first); expect(JSON.stringify(b)).toBe(before);
      expect(signature(m).every(Number.isFinite)).toBe(true);
      expect(m.scale.toArray()).toEqual([.625, .625, .625]);
    }
    disposeBossModel(m);
  });
  it('loops by actual distance with no accumulated root translation', async () => {
    const m = await model(), p = new BossCombatPose(m);
    for (const action of ['walk', 'crouchWalk'] as const) {
      const b = boss(action); b.stride = 0; p.sample(b, 110); const first = matrices(m);
      b.stride = 6 * .625 * 20; p.sample(b, 110);
      matrices(m).forEach((v, i) => expect(v).toBeCloseTo(first[i], 6));
      expect(Math.abs((m.getObjectByName('root') as THREE.Bone).position.z)).toBeLessThan(4);
    }
    disposeBossModel(m);
  });
  it('finishes stand/crouch transitions at the authoritative .65s boundary', async () => {
    const m = await model(), p = new BossCombatPose(m);
    p.restoreRest(); const rest = matrices(m);
    p.sample(boss('crouch'), 110.65); const low = matrices(m);
    p.sample(boss('crouchWalk'), 110); matrices(m).forEach((v, i) => expect(v).toBeCloseTo(low[i], 5));
    p.sample(boss('rise', true), 110.65);
    const standing = matrices(m);
    standing.forEach((v, i) => expect(v).toBeCloseTo(rest[i], 6));
    disposeBossModel(m);
  });
  it('plants the support foot through stomp and both knees during the crumple', async () => {
    const m = await model(), p = new BossCombatPose(m);
    for (const crouched of [false, true]) for (const t of [.68, 1]) {
      p.sample(boss('stomp', crouched), 110 + t);
      expect(point(m, 'footR').y).toBeCloseTo(1.17286 * .625, 3);
    }
    const b = boss('death'); b.deathAt = 110;
    for (const t of [4, 5.8]) {
      p.sample(b, 110 + t);
      for (const side of ['L', 'R']) {
        expect(point(m, 'shin' + side).y).toBeCloseTo(.95 * .625, 4);
        expect(point(m, 'foot' + side).y).toBeCloseTo(1.17286 * .625, 4);
      }
    }
    expect(BOSS_COMBAT_TIMING.swipeHit).toBe(1.1); expect(BOSS_COMBAT_TIMING.stompHit).toBe(1);
    expect(BOSS_COMBAT_TIMING.attach).toBe(1.35); expect(BOSS_COMBAT_TIMING.consume).toBe(2.8);
    disposeBossModel(m);
  });
  it('starts a crouched death from the crouched stance without a standing pop', async () => {
    const m = await model(), p = new BossCombatPose(m);
    p.sample(boss('crouchWalk', true), 110); const before = matrices(m);
    const b = boss('death', true); b.deathAt = 110; p.sample(b, 110);
    matrices(m).forEach((v, i) => expect(v).toBeCloseTo(before[i], 5));
    disposeBossModel(m);
  });
  it('follows authoritative position/facing, shows faction barrier, then disappears at12s leaving the crater', async () => {
    const b = boss();
    const e = { root: new THREE.Group(), day: createDayState(), fireLight: new THREE.PointLight(), noise: new THREE.DataTexture(new Uint8Array([127,127,127,255]),1,1),
      ctx: { world: { map: { effigy: { x: 0, z: 0 }, seed: 'combat-test' }, time: 112, boss: b, effigyRevealedAt: 100, factions: [{ color: 0x12bd45 }] },
        quality: 'low', renderer: { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280,720) }, camera: { fov: 60 } }, uniforms: { uFogColor: { value: new THREE.Color() } } } as unknown as EnvContext;
    const r = new BossReveal(e, model); await r.ready; expect(r.loadError).toBeNull(); r.update(102);
    const body = e.root.getObjectByName('boss-model-20m')!;
    expect(body.position.toArray()).toEqual([12,0,-7]); expect(body.rotation.y).toBe(.7);
    b.barrier = { edge: 0, faction: 0, x: 15, z: -7, at: 112 }; r.update(102);
    const shield = e.root.getObjectByName('boss-faction-forcefield') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(shield.visible).toBe(true); expect(shield.material.uniforms.uColor.value.getHex()).toBe(0x12bd45);
    b.action = 'death'; b.deathAt = 112; e.ctx.world.time = 123.99; r.update(113.99); expect(body.visible).toBe(true);
    e.ctx.world.time = 124; r.update(114); expect(body.visible).toBe(false);
    expect(e.root.getObjectByName('boss-death-crater')!.visible).toBe(true);
    expect(e.root.getObjectByName('boss-death-fire-head')!.visible).toBe(false);
    const before = JSON.stringify(b); r.update(114); expect(JSON.stringify(b)).toBe(before);
    r.dispose();
  });
});
