/** Rival vexillomancers become ordinary command-driven allies once the giant appears. */
import { BOSS_RADIUS } from '../sim/boss';
import { AVATAR, SIM_DT } from '../sim/constants';
import type { V2 } from '../sim/math';
import { hasEffect } from '../sim/systems/effects';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { aimBossThrow } from './bossThrow';
interface Route {
  at: number; to: V2; path: V2[]; next: number; lastSwing: number;
  nextAimAt: number; lastShot: number; seenAt: number; seen: V2; velocity: V2;
}
const routes = new WeakMap<World, Map<FactionId, Route>>();
export function pilotBoss(world: World, faction: FactionId): boolean {
  const boss = world.boss;
  if (!boss) return false;
  const av = world.avatarOf(faction);
  if (!av || av.koUntil || !world.factions[faction].alive) return true;
  let byFaction = routes.get(world);
  if (!byFaction) { byFaction = new Map(); routes.set(world, byFaction); }
  let route = byFaction.get(faction);
  if (!route) {
    route = { at: -Infinity, to: { x: 0, z: 0 }, path: [], next: 0, lastSwing: -Infinity,
      nextAimAt: 0, lastShot: -Infinity, seenAt: world.time, seen: { ...boss.pos }, velocity: { x: 0, z: 0 } };
    byFaction.set(faction, route);
  }
  const elapsed = world.time - route.seenAt;
  const moving = boss.action === 'walk' || boss.action === 'crouchWalk';
  if (elapsed > 0) {
    route.velocity.x = moving && elapsed < .3 ? (boss.pos.x - route.seen.x) / elapsed : 0;
    route.velocity.z = moving && elapsed < .3 ? (boss.pos.z - route.seen.z) / elapsed : 0;
    route.seenAt = world.time; Object.assign(route.seen, boss.pos);
  }
  const dx = boss.pos.x - av.pos.x, dz = boss.pos.z - av.pos.z, d = Math.hypot(dx, dz);
  const reach = BOSS_RADIUS + AVATAR.swingReach - 0.35;
  if (boss.hp > 0 && av.carried.length > 0 && av.onGround && !hasEffect(world, av, 'stun') &&
      world.time >= av.throwReadyAt && world.time >= route.nextAimAt) {
    // Failed sight lines are rechecked at 5 Hz while navigating, rather than solving dozens
    // of blocked arcs every tick. A successful release uses the ordinary human throw clock.
    route.nextAimAt = world.time + .2;
    const aim = aimBossThrow(world, av, route.velocity);
    if (aim) {
      world.submit({ t: 'avatarInput', faction, input: { moveX: 0, moveZ: 0, jump: false,
        sprint: false, throwMode: true, yaw: aim.yaw, pitch: aim.pitch } });
      world.submit({ t: 'throw', faction });
      route.lastShot = world.time;
      return true;
    }
  }
  // Keep a useful firing position between throws. An empty quiver, blocked flight or close
  // target falls back to the existing navigation/melee behavior instead of stalling.
  if (boss.hp > 0 && d > reach + .1 && av.carried.length > 0 && world.time < av.throwReadyAt &&
      world.time - route.lastShot < AVATAR.throwCooldown + SIM_DT * 2) {
    world.submit({ t: 'avatarInput', faction, input: { moveX: 0, moveZ: 0, jump: false,
      sprint: false, throwMode: true, yaw: av.input.yaw, pitch: av.input.pitch } });
    return true;
  }
  let moveX = 0, moveZ = 0;
  if (boss.hp > 0 && d > reach) {
    // Navigate to the reachable near side of the feet. Nav handles scenery and player walls;
    // boss-only forcefields do not obstruct players on their way to help.
    const near = { x: boss.pos.x - dx / d * reach * 0.85, z: boss.pos.z - dz / d * reach * 0.85 };
    if (world.time - route.at > 0.7 || Math.hypot(near.x - route.to.x, near.z - route.to.z) > 3) {
      route.to = near; route.at = world.time; route.next = 0;
      route.path = world.nav.lineOfSight(av.pos.x, av.pos.z, near.x, near.z) ? [near] :
        world.nav.findPath(av.pos.x, av.pos.z, near.x, near.z, { maxIter: 2500, partial: true }) ?? [];
    }
    while (route.next < route.path.length - 1 && Math.hypot(route.path[route.next].x - av.pos.x, route.path[route.next].z - av.pos.z) < 0.9) route.next++;
    const at = route.path[route.next] ?? near;
    const ex = at.x - av.pos.x, ez = at.z - av.pos.z, length = Math.hypot(ex, ez);
    if (length > 0.1) { moveX = ex / length; moveZ = ez / length; }
  }
  world.submit({ t: 'avatarInput', faction, input: { moveX, moveZ, jump: false,
    sprint: boss.hp > 0 && d > 14, throwMode: false, yaw: Math.atan2(dx, dz), pitch: 0 } });
  // Same held-button cadence as the human controls: never grant NPCs a faster attack clock.
  if (boss.hp > 0 && d <= reach + 0.1 && world.time - route.lastSwing >= AVATAR.swingTime) {
    world.submit({ t: 'swing', faction }); route.lastSwing = world.time;
  }
  return true;
}
