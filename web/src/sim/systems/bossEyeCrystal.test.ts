import { describe, expect, it } from 'vitest';
import { BOSS_EYE_MAX_RANGE } from '../boss';
import { crystalDimensions, rayCrystal } from '../crystalGeometry';
import { spawnCrystal, spawnFlag } from '../factory';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { spawnBoss } from './boss';
import { bossEyeRay, updateBossEye } from './boss/eye';
import { chooseBossEyeTarget } from './boss/eyeTargeting';
import { activeBossCrystals } from './boss/lightning';
import { freeFocus, newMatch, plantFresh, runRules } from './rules/testWorld';

function fixture() {
  const world = createMatch({ seed: 'beam-crystal', mode: 'standard', difficulty: 'normal', humans: [0] });
  const rainbow = world.map.obstacles.find(o => o.kind === 'art')!;
  world.time = 100; world.effigyRevealedAt = 100; world.map.obstacles = []; world.collision = new CollisionWorld();
  world.buildings.clear(); world.pieces.clear(); world.hippies.clear(); world.flags.clear(); world.crystals.clear();
  for (const a of world.avatars.values()) a.pos = { x: 140, y: 0, z: 80 + a.faction * 20 };
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
  const crystal = (x: number, z: number, scale = 1) => {
    const c = spawnCrystal(world, 0, 0, []); Object.assign(c, { pos: { x, z }, scale, growth: 1 }); return c;
  };
  const fire = () => { world.time = 127; updateBossEye(world, boss, 1 / 60); world.time = 130; updateBossEye(world, boss, 3); };
  world.drainEvents(); return { world, boss, crystal, fire, rainbow };
}

describe('crystal retaliation and exact beam intersections', () => {
  it('prioritizes actively shocking crystals above rainbow scenery, excludes growing/out-of-range normal crystals', () => {
    const e = fixture(); e.world.map.obstacles = [{ ...e.rainbow, kind: 'art', variant: 1, x: 0, z: 40, height: 10 }];
    const normal = e.crystal(25, 20), far = e.crystal(0, 60), growing = e.crystal(0, 10); growing.growth = .99;
    expect(chooseBossEyeTarget(e.world, e.boss)).toEqual({ ...normal.pos, y: 4.5 });
    e.world.crystals.delete(normal.id); expect(chooseBossEyeTarget(e.world, e.boss)).toEqual({ x: 0, y: 5, z: 40 });
    expect(activeBossCrystals(e.world, e.boss)).not.toContain(far);
  });
  it.each([1, 10])('hits the exact displayed scale-%s prism, shatters it once, and drops nearby flags only inside the impact radius', scale => {
    const e = fixture(), c = e.crystal(0, 35, scale), h = crystalDimensions(c).height;
    const flag = spawnFlag(e.world, { owner: 0, state: 'loose', pos: { x: 0, y: 1, z: 35 } });
    e.fire(); expect(e.boss.eye.firedAt).toBe(130); expect(e.boss.eye.impactTag).toBe(c.id);
    expect(e.world.crystals.has(c.id)).toBe(false); expect(e.boss.eye.impact!.y).toBeGreaterThan(0);
    expect(e.boss.eye.impact!.y).toBeLessThan(h);
    expect(e.boss.eye.knockedFlags.includes(flag.id)).toBe(scale === 1);
    expect(e.world.flags.has(flag.id)).toBe(true);
    e.world.time += .2; updateBossEye(e.world, e.boss, .2);
    expect(e.world.drainEvents().filter(v => v.t === 'crystalShatter')).toHaveLength(1);
  });
  it('respects foreground occlusion instead of shattering the crystal through scenery', () => {
    const e = fixture(), c = e.crystal(0, 40); e.world.time = 127; updateBossEye(e.world, e.boss, 3);
    const ray = bossEyeRay(e.world, e.boss), d = 12;
    e.world.collision.addBox(ray.origin.x + ray.direction.x * d, ray.origin.z + ray.direction.z * d, 2, 2, 0, 0, 40, 9999);
    e.world.time = 130; updateBossEye(e.world, e.boss, 3);
    expect(e.boss.eye.impactTag).toBe(9999); expect(e.world.crystals.has(c.id)).toBe(true);
  });
  it('allows the giant crystal to retaliate across the arena but defers impossible beyond-ray-range targets', () => {
    const e = fixture(), c = e.crystal(0, 200, 10);
    expect(chooseBossEyeTarget(e.world, e.boss)).toEqual({ x: 0, y: 45, z: 200 });
    e.fire(); expect(e.world.crystals.has(c.id)).toBe(false);
    const far = e.crystal(1000, 1000, 10); e.boss.eye.chargeAt = null; e.boss.eye.firedAt = null;
    e.world.time = 160; expect(activeBossCrystals(e.world, e.boss)).toContain(far);
    expect(chooseBossEyeTarget(e.world, e.boss)).toBeNull();
  });
  it('can reform normally when a directly struck high prism leaves the sustaining pentacle intact', () => {
    const world = newMatch('beam-crystal-reforms'); runRules(world, 1 / 30);
    const node = freeFocus(world, 0); plantFresh(world, 0, world.lattice.neighbors(node));
    runRules(world, 1 / 30); const c = [...world.crystals.values()].find(c => c.node === node)!;
    expect(c).toBeDefined(); c.scale = 10; c.growth = 1;
    world.time = 100; world.effigyRevealedAt = 100; const boss = spawnBoss(world)!; boss.action = 'idle';
    boss.pos = { x: c.pos.x, z: c.pos.z - 40 }; boss.yaw = 0; world.collision = new CollisionWorld();
    const target = { ...c.pos, y: 45 };
    Object.assign(boss.eye, { chargeAt: 97, firedAt: 100, nextFireAt: 130, target, route: [target], sample: -1 });
    updateBossEye(world, boss, 1 / 30); expect(world.crystals.has(c.id)).toBe(false);
    runRules(world, 1 / 30); const replacement = [...world.crystals.values()].find(other => other.node === node);
    expect(replacement).toBeDefined(); expect(replacement!.id).not.toBe(c.id); expect(replacement!.growth).toBeLessThan(1);
  });
  it('does not treat the prism as a filled broad cylinder or exceed the finite ray', () => {
    const e = fixture(), c = e.crystal(0, 0, 10);
    expect(rayCrystal(c, 130, { x: 10, y: 74, z: -30 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    expect(rayCrystal(c, 130, { x: 0, y: 74, z: -30 }, { x: 0, y: 0, z: 1 }, 100)).not.toBeNull();
    expect(rayCrystal(c, 130, { x: 0, y: 40, z: -300 }, { x: 0, y: 0, z: 1 }, BOSS_EYE_MAX_RANGE)).toBeNull();
  });
});
