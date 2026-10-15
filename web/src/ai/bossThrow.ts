/** Read-only fire control. All actual throws, damage and Flag consumption stay in the sim. */
import type { BossState } from '../sim/boss';
import { BOSS_HEAD_REGION_COUNT, BOSS_HIT_REGION_NAMES, BOSS_HIT_REGION_STRIDE } from '../sim/bossHitPoseData';
import { AVATAR, MAP_HALF, PROJECTILE, SIM_DT } from '../sim/constants';
import { groundHeight } from '../sim/terrain';
import { clamp } from '../sim/math';
import type { V2, V3 } from '../sim/math';
import { throwOrigin, throwVelocity } from '../sim/systems/avatars';
import { intersectBossRegions, sampleBossHitRegions } from '../sim/systems/boss/hitRegions';
import type { Avatar } from '../sim/types';
import type { World } from '../sim/world';
import { solveThrowAtPoint } from './ballistics';
import type { ThrowAim } from './ballistics';

const TARGETS = ['head', 'hat', 'hatRearflap', 'hatCordL', 'hatCordR',
  'chest', 'pelvis', 'coatFrontL', 'coatFrontR', 'coatBackL', 'coatBackR', 'shinL', 'shinR'] as const;
const REGIONS = TARGETS.map(name => BOSS_HIT_REGION_NAMES.indexOf(name));

/** Prefer a reachable head/hat; a standing giant's lower coat/legs are valid body targets. */
export function aimBossThrow(world: World, av: Avatar, velocity: Readonly<V2>): ThrowAim | null {
  const boss = world.boss;
  if (!boss || boss.hp <= 0) return null;
  const maxRange = AVATAR.throwSpeed / AVATAR.gravity *
    Math.sqrt(AVATAR.throwSpeed ** 2 + 2 * AVATAR.gravity * Math.max(0, av.pos.y + AVATAR.throwHandHeight));
  if (Math.hypot(boss.pos.x - av.pos.x, boss.pos.z - av.pos.z) > maxRange + 15) return null;
  const aim: ThrowAim = { yaw: 0, pitch: 0, flight: 0 };
  const predicted = { ...boss, pos: { ...boss.pos } }, speed = Math.hypot(velocity.x, velocity.z);
  let bodyFallback: ThrowAim | null = null;
  for (const region of REGIONS) {
    if (region >= BOSS_HEAD_REGION_COUNT && bodyFallback) return bodyFallback;
    for (const high of [false, true]) {
      let flight = 0, solved = true;
      // Lead only observed motion. Refinement accounts for both travel time and animated pose.
      for (let pass = 0; pass < 3; pass++) {
        predicted.pos.x = boss.pos.x + velocity.x * flight; predicted.pos.z = boss.pos.z + velocity.z * flight;
        predicted.stride = boss.stride + speed * flight;
        const shape = sampleBossHitRegions(predicted, world.time + flight, world.map.half), i = region * BOSS_HIT_REGION_STRIDE;
        const c = Math.cos(boss.yaw), s = Math.sin(boss.yaw);
        const target = { x: boss.pos.x + c * shape[i] + s * shape[i + 2] + velocity.x * flight,
          y: groundHeight(boss.pos.x + velocity.x * flight, boss.pos.z + velocity.z * flight, world.map.half) + shape[i + 1], z: boss.pos.z - s * shape[i] + c * shape[i + 2] + velocity.z * flight };
        if (!solveThrowAtPoint(av.pos, target, high, aim)) { solved = false; break; }
        flight = aim.flight;
      }
      if (!solved) continue;
      const hit = clearBossFlight(world, av, boss, velocity, aim);
      if (!hit) continue;
      if (hit.headshot || region >= BOSS_HEAD_REGION_COUNT) return { ...aim };
      bodyFallback ??= { ...aim };
    }
  }
  return bodyFallback;
}

/** Mirror each projectile step, including scenery/storage and neutral-catcher precedence. */
function clearBossFlight(world: World, av: Avatar, boss: BossState, velocity: Readonly<V2>, aim: ThrowAim) {
  const from = throwOrigin(av.pos, aim.yaw, { x: 0, y: 0, z: 0 });
  const vel = throwVelocity(aim.yaw, aim.pitch, { x: 0, y: 0, z: 0 });
  const future: BossState = { ...boss, pos: { ...boss.pos } };
  const speed = Math.hypot(velocity.x, velocity.z);
  const neutrals = [...world.hippies.values()].filter(h => h.faction < 0 && h.status !== 'ko');
  for (let i = 0; i * SIM_DT <= Math.min(PROJECTILE.lifetime, aim.flight + .3); i++) {
    vel.y -= AVATAR.gravity * SIM_DT;
    const to: V3 = { x: from.x + vel.x * SIM_DT, y: from.y + vel.y * SIM_DT, z: from.z + vel.z * SIM_DT };
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    const wall = world.collision.raycast(from.x, from.y, from.z, dx, dy, dz, length);
    const limit = wall ? wall.dist / length : 1;
    // Projectiles advance before the boss in each sim step.
    future.pos.x = boss.pos.x + velocity.x * i * SIM_DT;
    future.pos.z = boss.pos.z + velocity.z * i * SIM_DT;
    future.stride = boss.stride + speed * i * SIM_DT;
    const impact = intersectBossRegions(future, world.time + (i + 1) * SIM_DT, from, to, limit, world.map.half);
    const tMax = impact?.t ?? limit, l2 = dx * dx + dz * dz;
    for (const h of neutrals) {
      const t = clamp(l2 > 0 ? ((h.pos.x - from.x) * dx + (h.pos.z - from.z) * dz) / l2 : 0, 0, tMax);
      const y = from.y + dy * t;
      const base = groundHeight(h.pos.x, h.pos.z, world.map.half) + (h.airborne?.y ?? 0);
      if (y >= base && y <= base + PROJECTILE.hippieHitHeight &&
          (from.x + dx * t - h.pos.x) ** 2 + (from.z + dz * t - h.pos.z) ** 2 <= PROJECTILE.hippieHitRadius ** 2) return null;
    }
    if (impact) return impact;
    if (wall || to.y <= groundHeight(to.x, to.z, world.map.half) || Math.abs(to.x) > MAP_HALF - .5 || Math.abs(to.z) > MAP_HALF - .5) return null;
    Object.assign(from, to);
  }
  return null;
}
