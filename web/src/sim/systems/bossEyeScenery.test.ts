import { describe, expect, it, vi } from 'vitest';
import { SIM_DT } from '../constants';
import { spawnBuilding } from '../factory';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { spawnBoss } from './boss';
import { bossEyeRay, updateBossEye } from './boss/eye';
import { recordBossFlagThreat } from './boss/eyeThreats';

function encounter() {
  const world = createMatch({ seed: 'boss-eye-scenery', difficulty: 'normal', humans: [0], mode: 'standard' });
  world.time = 100; world.effigyRevealedAt = 100; world.suddenDeath = true;
  const boss = spawnBoss(world)!;
  boss.action = 'idle'; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
  world.collision = new CollisionWorld();
  world.buildings.clear(); world.pieces.clear(); world.flags.clear(); world.hippies.clear(); world.crystals.clear();
  for (const f of world.factions) { f.hearthIds = []; f.gccId = null; }
  for (const avatar of world.avatars.values()) avatar.pos = { x: 100, y: 0, z: 50 + avatar.faction * 20 };
  world.avatarOf(0).pos = { x: 0, y: 0, z: 40 };
  boss.target = { kind: 'avatar', id: world.avatarOf(0).id };
  world.survey.edgeLey.fill(-1); world.survey.version++;
  world.time = 127; recordBossFlagThreat(world, world.avatarOf(0).id); updateBossEye(world, boss, SIM_DT);
  const ray = bossEyeRay(world, boss);
  const distance = Math.hypot(boss.eye.target!.x - ray.origin.x, boss.eye.target!.y - ray.origin.y, boss.eye.target!.z - ray.origin.z) - 5;
  const first = { x: ray.origin.x + ray.direction.x * distance, z: ray.origin.z + ray.direction.z * distance };
  const template = world.map.obstacles.find(o => o.kind === 'car')!;
  world.map.obstacles = [
    { ...template, id: 10000, ...first, shape: 'box' as const, hx: .5, hz: .5, height: 8, yaw: 0 },
    { ...template, id: 10001, x: first.x + 3, z: first.z, shape: 'box' as const, hx: .5, hz: .5, height: 8, yaw: 0 },
    { ...template, id: 10002, x: first.x, z: first.z + 2, shape: 'box' as const, hx: .5, hz: .5, height: 8, yaw: 0 },
  ];
  world.collision = CollisionWorld.fromMap(world.map);
  return { world, boss, ray, first };
}

describe('actual eye first-hit scenery integration', () => {
  it('explodes only the directly occluding prop, preserves adjacent and farther scenery and never removes a nearby altar', () => {
    const { world, boss, ray, first } = encounter();
    const expected = { ...world.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z,
      ray.direction.x, ray.direction.y, ray.direction.z, 240, boss.id)! };
    expect(expected.tag).toBe(-10001);
    const altar = spawnBuilding(world, 'hearth', 0, 0, 1);
    altar.pos = { x: first.x + 2, z: first.z };
    altar.hp = 10;
    const cast = vi.spyOn(world.collision, 'raycast');
    world.time = 130; updateBossEye(world, boss, SIM_DT);
    expect(boss.eye.impact).toEqual({ x: expected.x, y: expected.y, z: expected.z });
    expect([...world.destroyedScenery]).toEqual([10000]);
    expect(world.buildings.get(altar.id)).toBe(altar); expect(altar.hp).toBe(1);
    const navVersion = world.nav.version;
    for (const time of [130, 130.1, 130.49]) { world.time = time; updateBossEye(world, boss, SIM_DT); }
    expect(cast).toHaveBeenCalledTimes(1);
    expect([...world.destroyedScenery]).toEqual([10000]);
    expect(world.nav.version).toBe(navVersion);
    for (const obstacle of world.map.obstacles.slice(1)) {
      expect(world.collision.raycast(obstacle.x, 60, obstacle.z, 0, -1, 0, 70)?.tag).toBe(-1 - obstacle.id);
    }
  });

  it.each(['terrain', 'entity'] as const)('does not delete nearby scenery when the direct hit is %s', (kind) => {
    const { world, boss, ray, first } = encounter();
    // Keep nearby props but move the occluder out of the ray.
    world.map.obstacles[0].x += 3;
    world.map.obstacles[2].x += 3;
    world.collision = CollisionWorld.fromMap(world.map);
    if (kind === 'entity') world.collision.addBox(first.x, first.z, .5, .5, 0, 0, 8, 999999);
    const expected = world.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z,
      ray.direction.x, ray.direction.y, ray.direction.z, 240, boss.id)!;
    expect(expected.tag).toBe(kind === 'terrain' ? 0 : 999999);
    world.time = 130; updateBossEye(world, boss, SIM_DT);
    expect(world.destroyedScenery.size).toBe(0);
  });
});
