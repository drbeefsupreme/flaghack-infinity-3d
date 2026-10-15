/** Player movement has a generous, continuous solid core independent of flag hit regions. */
import { BOSS_TIMING } from '../../boss';
import type { BossState } from '../../boss';
import { BOSS_GAMEPLAY_SCALE, BOSS_HEIGHT } from '../../bossDimensions';
import { AVATAR, MAP_HALF } from '../../constants';
import { groundHeight, TERRAIN_DOME_HEIGHT } from '../../terrain';
import { clamp } from '../../math';
import type { V2, V3 } from '../../math';
import type { MovementCylinder } from '../../physics/collision';
import type { Avatar } from '../../types';
import type { World } from '../../world';
import { sweepBossLoops } from './barriers';

/** Scales the generous body with the rig; 32 m contact preserves 71 cm of staff reach. */
export const BOSS_PLAYER_RADIUS = 3.25 * BOSS_GAMEPLAY_SCALE;
export const BOSS_PLAYER_STANDING_HEIGHT = BOSS_HEIGHT;
export const BOSS_PLAYER_CROUCHED_HEIGHT = 12 * BOSS_GAMEPLAY_SCALE;
const PUSH_STEP = .2;
const SKIN = 1e-5;

/** Constant ground footprint prevents feet/coat gaps and sideways stance-change shoves. */
export function bossPlayerHull(boss: BossState | null, now: number, mapHalf = MAP_HALF): MovementCylinder | null {
  if (!boss || boss.hp <= 0 || boss.action === 'death' || boss.action === 'dead') return null;
  let crouch = boss.crouched || boss.action === 'swipe' || boss.action === 'grab' ? 1 : 0;
  if (boss.action === 'crouch' || boss.action === 'rise') {
    const t = clamp((now - boss.actionAt) / BOSS_TIMING.transition, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    crouch = boss.action === 'crouch' ? smooth : 1 - smooth;
  }
  const ground = groundHeight(boss.pos.x, boss.pos.z, mapHalf);
  return { x: boss.pos.x, z: boss.pos.z, radius: BOSS_PLAYER_RADIUS, bottom: ground,
    top: ground + BOSS_PLAYER_STANDING_HEIGHT + (BOSS_PLAYER_CROUCHED_HEIGHT - BOSS_PLAYER_STANDING_HEIGHT) * crouch,
    tag: boss.id };
}

/**
 * Sweep the giant's requested ground movement, pushing live players through the SAME
 * static collision solver. Stops short when a player cannot move (wall/map edge/loop),
 * rather than crushing them into scenery or choosing the far side of the giant.
 * Does not inject knockback, advance gravity, move KO'd avatars or mutate boss.pos.
 */
export function moveBossWithPlayerCollision(world: World, boss: BossState, from: V2, to: V2): V2 {
  const hull = bossPlayerHull(boss, world.time, world.map.half);
  if (!hull) return { ...to };
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  if (length < 1e-9) return { ...from };
  const r = BOSS_PLAYER_RADIUS + AVATAR.radius;
  const minGround = Math.min(groundHeight(from.x, from.z, world.map.half), groundHeight(to.x, to.z, world.map.half));
  const height = hull.top - hull.bottom;
  const players = [...world.avatars.values()].filter(av => av.koUntil <= 0 && world.factions[av.faction].alive &&
    av.pos.y < TERRAIN_DOME_HEIGHT + height && av.pos.y + AVATAR.height > minGround &&
    av.pos.x >= Math.min(from.x, to.x) - r && av.pos.x <= Math.max(from.x, to.x) + r &&
    av.pos.z >= Math.min(from.z, to.z) - r && av.pos.z <= Math.max(from.z, to.z) + r);
  if (!players.length) return { ...to };
  const steps = Math.max(1, Math.ceil(length / PUSH_STEP));
  let at = { ...from };
  for (let i = 1; i <= steps; i++) {
    const next = { x: from.x + dx * i / steps, z: from.z + dz * i / steps };
    const moved: { av: Avatar; pos: V3; vx: number; vz: number }[] = [];
    let blocked = false;
    for (const av of players) {
      const ground = groundHeight(next.x, next.z, world.map.half);
      if (av.pos.y >= ground + height || av.pos.y + AVATAR.height <= ground) continue;
      const ax = av.pos.x - next.x, az = av.pos.z - next.z, gap = Math.hypot(ax, az);
      if (gap >= r - SKIN) continue;
      const oldGap = Math.hypot(av.pos.x - at.x, av.pos.z - at.z);
      // Spawns/corrections can begin overlapped. Never deepen that overlap or throw
      // the player out several metres; their own motion resolves it progressively.
      if (oldGap < r - .001) {
        if (gap < oldGap - SKIN) { blocked = true; break; }
        continue;
      }
      const nx = gap > 1e-9 ? ax / gap : dx / length;
      const nz = gap > 1e-9 ? az / gap : dz / length;
      const push = r - gap + SKIN;
      const pos = { ...av.pos }, velocity = { x: nx * push, y: 0, z: nz * push };
      const target = { x: pos.x + velocity.x, z: pos.z + velocity.z };
      // A defended boundary cannot be bypassed by a body shove even where the
      // generous player hull projects beyond the narrower strategic footprint.
      if (sweepBossLoops(world, pos, target, AVATAR.radius)) { blocked = true; break; }
      world.collision.moveCharacter(pos, velocity, 1, AVATAR.radius, AVATAR.height, AVATAR.stepHeight,
        av.pushing >= 0 ? av.pushing : undefined);
      const lim = MAP_HALF - AVATAR.radius;
      pos.x = clamp(pos.x, -lim, lim); pos.z = clamp(pos.z, -lim, lim);
      if (Math.hypot(pos.x - next.x, pos.z - next.z) < r - .0001 ||
          world.collision.blockedCircle(pos.x, pos.z, AVATAR.radius, pos.y + AVATAR.stepHeight,
            pos.y + AVATAR.height, av.pushing >= 0 ? av.pushing : undefined)) { blocked = true; break; }
      moved.push({ av, pos, vx: nx, vz: nz });
    }
    // Apply only after every player can move: no partial shove on a rejected step.
    if (blocked) return at;
    for (const { av, pos, vx, vz } of moved) {
      Object.assign(av.pos, pos);
      const inward = av.vel.x * vx + av.vel.z * vz;
      if (inward < 0) { av.vel.x -= inward * vx; av.vel.z -= inward * vz; }
    }
    at = next;
  }
  return at;
}
