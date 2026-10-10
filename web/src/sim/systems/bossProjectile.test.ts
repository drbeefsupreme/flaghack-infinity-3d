import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import type { BossAction } from '../boss';
import { BOSS_HEAD_REGION_COUNT, BOSS_HIT_REGION_STRIDE } from '../bossHitPoseData';
import { AVATAR, SIM_DT } from '../constants';
import { spawnFlag, spawnProjectile } from '../factory';
import { normalizeMatch } from '../matchSettings';
import type { V3 } from '../math';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { intersectBossRegions, sampleBossHitRegions } from './boss/hitRegions';
import { updateProjectiles } from './projectiles';
import { cmdThrow } from './avatars';

function setup(action: BossAction = 'idle', crouched = false, age = 0.3) {
  const w = createMatch({ seed: 'boss-projectile', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 245; w.effigyRevealedAt = 230; w.boss = bossFixture();
  w.boss.pos = { x: 5, z: 7 }; w.boss.yaw = 0;
  w.boss.action = action; w.boss.crouched = crouched; w.boss.actionAt = w.time - age;
  // Isolate the production projectile solver and authoritative boss rig from map scenery.
  // Occlusion is exercised below using a real collision shape in this same world.
  w.collision = new CollisionWorld();
  return w;
}

function shoot(w: ReturnType<typeof setup>, from: V3, to: V3) {
  const flag = spawnFlag(w, { owner: 0, state: 'flying', pos: from });
  const projectile = spawnProjectile(w, flag.id, w.avatarOf(0).id, 0, from, {
    x: (to.x - from.x) / SIM_DT,
    y: (to.y - from.y) / SIM_DT + AVATAR.gravity * SIM_DT,
    z: (to.z - from.z) / SIM_DT,
  });
  flag.holder = projectile.id;
  return { flag, projectile };
}

/** An exposed ray to a sampled head/hat/body shape; checks rays from several sides because
 * a raised arm may genuinely occlude a head in an attack pose. */
function aim(w: ReturnType<typeof setup>, headshot: boolean, startRegion: number, endRegion: number) {
  const b = w.boss!, shapes = sampleBossHitRegions(b, w.time);
  for (let region = startRegion; region < endRegion; region++) {
    const i = region * BOSS_HIT_REGION_STRIDE;
    const c = Math.cos(b.yaw), sin = Math.sin(b.yaw);
    const center = { x: b.pos.x + c * shapes[i] + sin * shapes[i + 2], y: shapes[i + 1],
      z: b.pos.z - sin * shapes[i] + c * shapes[i + 2] };
    for (const d of [{ x: 0, y: 0, z: 25 }, { x: 25, y: 0, z: 0 }, { x: -25, y: 0, z: 0 }, { x: 0, y: 0, z: -25 }, { x: 0, y: 25, z: 0 }]) {
      const from = { x: center.x + d.x, y: center.y + d.y, z: center.z + d.z };
      const to = { x: center.x - d.x, y: center.y - d.y, z: center.z - d.z };
      const hit = intersectBossRegions(b, w.time, from, to);
      if (hit && hit.headshot === headshot && hit.region >= startRegion && hit.region < endRegion) return { from, to, hit };
    }
  }
  throw new Error(`No exposed ${headshot ? 'head/hat' : 'body'} ray in ${b.action}:${b.crouched}`);
}

describe('real boss projectile impacts', () => {
  for (const [action, crouched, age] of [
    ['idle', false, .3], ['idle', true, .3], ['walk', false, .3],
    ['crouchWalk', true, .3], ['rise', true, .3], ['swipe', true, 1.1],
  ] as const) {
    it(`destroys thrown Flags once and emits 50/100 fireworks at the swept impact in ${action}:${crouched}`, () => {
      for (const headshot of [false, true]) {
        const w = setup(action, crouched, age);
        const shapes = sampleBossHitRegions(w.boss!, w.time);
        const ray = headshot ? aim(w, true, 0, BOSS_HEAD_REGION_COUNT)
          : aim(w, false, BOSS_HEAD_REGION_COUNT, shapes.length / BOSS_HIT_REGION_STRIDE);
        const { flag, projectile } = shoot(w, ray.from, ray.to);
        const before = w.boss!.hp;
        w.drainEvents();
        updateProjectiles(w, SIM_DT);
        const events = w.drainEvents().filter((e) => e.t === 'bossImpact');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ t: 'bossImpact', bossId: w.boss!.id, by: w.avatarOf(0).id,
          flagId: flag.id, faction: 0, headshot, amount: headshot ? 100 : 50 });
        expect(events[0].pos.x).toBeCloseTo(ray.hit.pos.x);
        expect(events[0].pos.y).toBeCloseTo(ray.hit.pos.y);
        expect(events[0].pos.z).toBeCloseTo(ray.hit.pos.z);
        expect(w.boss!.hp).toBe(before - (headshot ? 100 : 50));
        expect(w.flags.has(flag.id)).toBe(false);
        expect(w.projectiles.has(projectile.id)).toBe(false);
        updateProjectiles(w, SIM_DT);
        expect(w.boss!.hp).toBe(before - (headshot ? 100 : 50));
        expect(w.drainEvents().some((e) => e.t === 'bossImpact')).toBe(false);
      }
    });
  }

  it('head and hat are separately hittable for 100 damage', () => {
    for (const [start, end] of [[0, 1], [1, BOSS_HEAD_REGION_COUNT]]) {
      const w = setup();
      const ray = aim(w, true, start, end);
      shoot(w, ray.from, ray.to);
      const before = w.boss!.hp;
      updateProjectiles(w, SIM_DT);
      expect(w.boss!.hp).toBe(before - 100);
    }
  });

  it('tracks translated and rotated head/body geometry through the real projectile solver', () => {
    for (const yaw of [.9, 2.7, -1.4]) for (const headshot of [false, true]) {
      const w = setup();
      w.boss!.yaw = yaw;
      const shapes = sampleBossHitRegions(w.boss!, w.time);
      const ray = headshot ? aim(w, true, 0, BOSS_HEAD_REGION_COUNT)
        : aim(w, false, BOSS_HEAD_REGION_COUNT, shapes.length / BOSS_HIT_REGION_STRIDE);
      const before = w.boss!.hp;
      shoot(w, ray.from, ray.to);
      updateProjectiles(w, SIM_DT);
      expect(w.boss!.hp).toBe(before - (headshot ? 100 : 50));
    }
  });

  it('a normal-speed avatar throw leaves the quiver, flies ballistically, and is consumed on a head hit', () => {
    const w = setup(), b = w.boss!, av = w.avatarOf(0);
    const shapes = sampleBossHitRegions(b, w.time);
    const target = { x: b.pos.x + shapes[0], y: shapes[1], z: b.pos.z + shapes[2] };
    // An elevated firing position isolates the real throw command/cadence from jumping and construction.
    const distance = 6;
    av.pos = { x: target.x + .25, y: target.y - AVATAR.throwHandHeight, z: target.z - distance - .35 };
    av.input.yaw = 0;
    av.input.pitch = .5 * Math.asin(AVATAR.gravity * distance / (AVATAR.throwSpeed ** 2)) - AVATAR.throwPitchBias;
    const flagId = av.carried.at(-1)!;
    const count = av.carried.length;
    const before = b.hp;
    w.drainEvents();
    cmdThrow(w, { t: 'throw', faction: 0 });
    expect(av.carried).not.toContain(flagId);
    expect(av.carried.length).toBe(count - 1);
    expect(w.flags.get(flagId)?.state).toBe('flying');
    const p = [...w.projectiles.values()][0];
    expect(Math.hypot(p.vel.x, p.vel.y, p.vel.z)).toBeCloseTo(AVATAR.throwSpeed);
    for (let i = 0; i < 120 && w.projectiles.has(p.id); i++) {
      w.time += SIM_DT;
      updateProjectiles(w, SIM_DT);
    }
    expect(b.hp).toBe(before - 100);
    expect(w.flags.has(flagId)).toBe(false);
    expect(w.drainEvents().filter((e) => e.t === 'bossImpact')).toHaveLength(1);
  });

  it('a nearer wall occludes the boss and an off-body miss does not consume a Flag', () => {
    const w = setup(), ray = aim(w, true, 0, BOSS_HEAD_REGION_COUNT);
    const mid = { x: ray.from.x + (ray.hit.pos.x - ray.from.x) * .5,
      y: ray.from.y + (ray.hit.pos.y - ray.from.y) * .5, z: ray.from.z + (ray.hit.pos.z - ray.from.z) * .5 };
    w.collision.addBox(mid.x, mid.z, .3, .3, 0, mid.y - .3, mid.y + .3, 90001);
    const before = w.boss!.hp;
    const blocked = shoot(w, ray.from, ray.to);
    updateProjectiles(w, SIM_DT);
    expect(w.boss!.hp).toBe(before);
    expect(w.flags.has(blocked.flag.id)).toBe(true);
    expect(w.drainEvents().some((e) => e.t === 'bossImpact')).toBe(false);
    const missed = shoot(w, { x: 70, y: 50, z: 60 }, { x: 72, y: 50, z: 61 });
    updateProjectiles(w, SIM_DT);
    expect(w.boss!.hp).toBe(before);
    expect(w.flags.has(missed.flag.id)).toBe(true);
    expect(w.projectiles.has(missed.projectile.id)).toBe(true);
  });
});
