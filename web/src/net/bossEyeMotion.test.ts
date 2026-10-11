import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BossCombatPose } from '../render/env/burn/boss/combatPose';
import { disposeBossModel, prepareBossModel } from '../render/env/burn/boss/bossModel';
import { BossEyeBeamFx, readBossEyeGaze } from '../render/env/burn/boss/eyeBeamFx';
import { BOSS_EYE_TIMING, clearBossEyeCharge } from '../sim/boss';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { bossEyeRay } from '../sim/systems/boss/eye';
import { SnapshotEncoder } from './codec';
import { Motion } from './interp';
import { NetMirror } from './mirror';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
function setup() {
  const host = createMatch({ seed: 'boss-eye-motion', difficulty: 'normal', humans: [0, 1], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  host.boss = bossFixture();
  Object.assign(host.boss, { pos: { x: 12.34, z: -7.35 }, yaw: .7, action: 'idle', actionAt: 127,
    spawnedAt: 100, crouched: false, barrier: null, held: null });
  Object.assign(host.boss.eye, { chargeAt: 127, firedAt: 130, nextFireAt: 160, target: { x: 28, y: 0, z: 40 } });
  Object.assign(host.boss.eye, bossEyeRay(host, host.boss), { impact: { ...host.boss.eye.target! } });
  host.time = 130 + 14 / 30;
  return host;
}

describe('boss eye motion playback', () => {
  it('pins the last beam frame to its authoritative pose and resumes after the expiry snapshot', () => {
    const host = setup(), encoder = new SnapshotEncoder(host), peer = NetMirror.create(host.options, wire(encoder.full()));
    const motion = new Motion(); motion.capture(peer.world, null, host.time);
    const before = structuredClone(peer.world.boss!), avatarX = peer.world.avatarOf(0).pos.x;
    host.time = 130.5; host.tick++;
    host.boss!.pos.x += .07; host.boss!.pos.z += .06; host.boss!.yaw += .04; host.boss!.stride += .09;
    host.boss!.action = 'walk'; clearBossEyeCharge(host.boss!);
    host.avatarOf(0).pos.x += 1;
    const expiry = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
    motion.aim(expiry.delta);
    for (const now of [130.47, 130.49, 130.499999]) {
      peer.world.time = motion.blend(peer.world, now);
      expect(peer.world.boss).toEqual(before);
      // Other actors still interpolate while the boss alone is locked.
      expect(peer.world.avatarOf(0).pos.x).toBeGreaterThan(avatarX);
    }
    // The lock follows authoritative shot state, so it cannot release early when
    // a delayed expiry snapshot has not applied yet.
    motion.blend(peer.world, 130.7); expect(peer.world.boss).toEqual(before);
    motion.restore(peer.world);
    peer.push(expiry); peer.catchUp();
    expect(peer.world.boss!.eye.firedAt).toBeNull();
    const start = structuredClone(peer.world.boss!);
    motion.capture(peer.world, null, host.time);
    host.time += 1 / 30; host.tick++;
    host.boss!.pos.x += .14; host.boss!.pos.z += .08; host.boss!.yaw += .08; host.boss!.stride += .16;
    motion.aim(wire(encoder.delta([])));
    motion.blend(peer.world, 130.5 + 1 / 60);
    expect(peer.world.boss!.pos.x).toBeCloseTo(start.pos.x + .07, 10);
    expect(peer.world.boss!.pos.z).toBeCloseTo(start.pos.z + .04, 10);
    expect(peer.world.boss!.yaw).toBeCloseTo(start.yaw + .04, 10);
    expect(peer.world.boss!.stride).toBeCloseTo(start.stride + .08, 10);
  });

  it.each(['walking', 'charging'] as const)('preserves normal %s interpolation before a shot', state => {
    const host = setup(); clearBossEyeCharge(host.boss!);
    host.time = 129;
    host.boss!.action = state === 'walking' ? 'walk' : 'idle';
    if (state === 'charging') { host.boss!.eye.chargeAt = 127; host.boss!.eye.target = { x: 28, y: 0, z: 40 }; }
    const encoder = new SnapshotEncoder(host), peer = NetMirror.create(host.options, wire(encoder.full()));
    const start = structuredClone(peer.world.boss!), motion = new Motion(); motion.capture(peer.world, null, host.time);
    host.time += 1 / 30; host.tick++;
    if (state === 'walking') { host.boss!.pos.x += .14; host.boss!.stride += .14; }
    host.boss!.yaw += .08;
    motion.aim(wire(encoder.delta([]))); motion.blend(peer.world, 129 + 1 / 60);
    expect(peer.world.boss!.yaw).toBeCloseTo(start.yaw + .04, 10);
    expect(peer.world.boss!.pos.x).toBeCloseTo(start.pos.x + (state === 'walking' ? .07 : 0), 10);
    expect(peer.world.boss!.stride).toBeCloseTo(start.stride + (state === 'walking' ? .07 : 0), 10);
    expect(peer.world.boss!.eye.firedAt).toBeNull();
  });

  it('keeps stalled shot playback frozen even if a stale walking action would otherwise extrapolate', () => {
    const host = setup(), motion = new Motion(); host.boss!.action = 'walk';
    motion.capture(host, null, host.time - 1 / 30);
    host.boss!.pos.x += .1; motion.capture(host, null, host.time);
    const before = structuredClone(host.boss!);
    motion.aim(null); motion.blend(host, host.time + .1);
    expect(host.boss).toEqual(before);
  });

  it.each([false, true])('keeps the encoded host beam on the real rendered pupil through its final frame (crouched=%s)', async crouched => {
    const bytes = fs.readFileSync(new URL('../../public/models/boss/skeletal-boss.glb', import.meta.url));
    const model = prepareBossModel((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene);
    const combat = new BossCombatPose(model), fx = new BossEyeBeamFx(model, () => combat.stabilizeRearFlap());
    const root = new THREE.Group(); root.position.set(-9, 0, 13); root.add(model, fx.group);
    try {
      const host = setup(); host.boss!.crouched = crouched;
      // Exercise opposite rounding edges and several yaw/target configurations,
      // rather than using a pose that happens to survive wire quantization exactly.
      for (const [x, z, yaw, distance] of [
        [12.34499, -7.34501, .700499, 40], [-23.34501, 34.34499, -1.400499, 120],
        [46.34499, -19.34501, 2.400499, 8],
      ]) {
        const b = host.boss!;
        Object.assign(b, { pos: { x, z }, yaw, action: 'idle' });
        Object.assign(b.eye, { chargeAt: 127, firedAt: 130,
          target: { x: x + Math.sin(yaw) * distance, y: 0, z: z + Math.cos(yaw) * distance } });
        Object.assign(b.eye, bossEyeRay(host, b), { impact: { ...b.eye.target! } });
        host.time = 130 + 14 / 30;
        const encoder = new SnapshotEncoder(host), peer = NetMirror.create(host.options, wire(encoder.full()));
        const motion = new Motion(); motion.capture(peer.world, null, host.time);
        host.time = 130 + BOSS_EYE_TIMING.beam; host.tick++;
        b.pos.x += .07; b.pos.z += .06; b.yaw += .04; b.stride += .09; b.action = 'walk'; clearBossEyeCharge(b);
        motion.aim(wire(encoder.delta([])));
        let firstOrigin: THREE.Vector3 | null = null, firstDirection: THREE.Vector3 | null = null;
        for (const now of [130.47, 130.49, 130.499999]) {
          peer.world.time = motion.blend(peer.world, now);
          const shown = peer.world.boss!;
          combat.sample(shown, shown.spawnedAt);
          model.position.set(shown.pos.x - root.position.x, 0, shown.pos.z - root.position.z); model.rotation.y = shown.yaw;
          root.updateMatrixWorld(true); fx.aim(shown, now); fx.update(shown, now); root.updateMatrixWorld(true);
          const gaze = readBossEyeGaze(model.getObjectByName('head') as THREE.Bone);
          const beam = fx.group.getObjectByName('boss-eye-beam')!, start = beam.localToWorld(new THREE.Vector3()), end = beam.localToWorld(new THREE.Vector3(0, 0, 1));
          expect(beam.visible).toBe(true);
          expect(start.distanceTo(vec(shown.eye.origin!))).toBeLessThan(1e-8);
          expect(end.distanceTo(vec(shown.eye.impact!))).toBeLessThan(1e-8);
          // Existing centimeter/milliradian boss-pose encoding is the only
          // remaining socket discrepancy; it stays inside one centimeter.
          expect(gaze.origin.distanceTo(start)).toBeLessThan(.01);
          expect(gaze.direction.angleTo(vec(shown.eye.direction!))).toBeLessThan(.001);
          expect(new THREE.Ray(gaze.origin, gaze.direction).distanceToPoint(end)).toBeLessThan(.00001);
          if (firstOrigin) {
            expect(gaze.origin.distanceTo(firstOrigin)).toBeLessThan(1e-10);
            expect(gaze.direction.distanceTo(firstDirection!)).toBeLessThan(1e-10);
          } else { firstOrigin = gaze.origin.clone(); firstDirection = gaze.direction.clone(); }
        }
      }
    } finally { fx.dispose(); disposeBossModel(model); }
  });
});
