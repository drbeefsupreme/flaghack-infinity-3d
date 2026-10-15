/** Host-only, bounded memory of actual Flag aggression; ordinary staff hits never enter it. */
import { BOSS_RADIUS } from '../../boss';
import { BOSS_GAMEPLAY_SCALE, BOSS_HEIGHT } from '../../bossDimensions';
import { AVATAR, PROJECTILE } from '../../constants';
import type { EntityId, Projectile } from '../../types';
import type { World } from '../../world';

export const BOSS_FLAG_THREAT_SECONDS = 12;
interface ThreatMemory { bossId: EntityId; throws: Map<EntityId, number>; }
const KEY = 'bossEyeFlagThreats';

export function recentBossFlagThreats(world: World): ReadonlyMap<EntityId, number> {
  let memory = world.scratch[KEY] as ThreatMemory | undefined;
  if (!memory || memory.bossId !== world.boss?.id) {
    memory = { bossId: world.boss?.id ?? -1, throws: new Map() };
    world.scratch[KEY] = memory;
  }
  for (const [id, at] of memory.throws) {
    const avatar = world.avatars.get(id);
    if (world.time - at >= BOSS_FLAG_THREAT_SECONDS || at > world.time || !avatar || avatar.hp <= 0 ||
        avatar.koUntil || !world.factions[avatar.faction].alive) memory.throws.delete(id);
  }
  return memory.throws;
}

/** Call only for a successful threatening throw or a confirmed Flag hit, never generic damage. */
export function recordBossFlagThreat(world: World, thrower: EntityId): void {
  const boss = world.boss, avatar = world.avatars.get(thrower);
  if (!boss || boss.hp <= 0 || world.phase !== 'playing' || !avatar || avatar.hp <= 0 ||
      avatar.koUntil || !world.factions[avatar.faction].alive) return;
  const threats = recentBossFlagThreats(world) as Map<EntityId, number>;
  threats.delete(thrower); threats.set(thrower, world.time);
  // The match has four avatars. Keep an explicit bound even if an old avatar is replaced.
  while (threats.size > 4) threats.delete(threats.keys().next().value!);
  delete world.scratch.bossEyeRetry;
}

/** A launched Flag must travel toward the giant and plausibly cross its full body/hat height.
 * This is intention recognition only: the exact posed collision still decides all hits. */
export function observeBossFlagThrow(world: World, projectile: Projectile): void {
  const boss = world.boss;
  if (!boss || boss.hp <= 0) return;
  const { pos, vel } = projectile, dx = boss.pos.x - pos.x, dz = boss.pos.z - pos.z;
  const speed2 = vel.x ** 2 + vel.z ** 2, along = dx * vel.x + dz * vel.z;
  if (speed2 < 1e-9 || along <= 0) return;
  const near = along / speed2, miss2 = Math.max(0, dx ** 2 + dz ** 2 - along ** 2 / speed2);
  const radius = BOSS_RADIUS + 2 * BOSS_GAMEPLAY_SCALE;
  if (miss2 > radius ** 2) return;
  const half = Math.sqrt((radius ** 2 - miss2) / speed2);
  const enter = Math.max(0, near - half), leave = Math.min(PROJECTILE.lifetime, near + half);
  if (enter > leave) return;
  const y = (t: number) => pos.y + vel.y * t - AVATAR.gravity * t * t / 2;
  const apex = Math.max(enter, Math.min(leave, vel.y / AVATAR.gravity));
  if (Math.max(y(enter), y(leave), y(apex)) < 0 || Math.min(y(enter), y(leave)) > BOSS_HEIGHT) return;
  recordBossFlagThreat(world, projectile.thrower);
}
