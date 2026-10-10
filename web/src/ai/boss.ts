/** Rival vexillomancers become ordinary command-driven allies once the giant appears. */
import { BOSS_RADIUS } from '../sim/boss';
import { AVATAR } from '../sim/constants';
import type { V2 } from '../sim/math';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
interface Route { at: number; to: V2; path: V2[]; next: number; lastSwing: number; }
const routes = new WeakMap<World, Map<FactionId, Route>>();
export function pilotBoss(world: World, faction: FactionId): boolean {
  const boss = world.boss;
  if (!boss) return false;
  const av = world.avatarOf(faction);
  if (!av || av.koUntil || !world.factions[faction].alive) return true;
  let byFaction = routes.get(world);
  if (!byFaction) { byFaction = new Map(); routes.set(world, byFaction); }
  let route = byFaction.get(faction);
  if (!route) { route = { at: -Infinity, to: { x: 0, z: 0 }, path: [], next: 0, lastSwing: -Infinity }; byFaction.set(faction, route); }
  const dx = boss.pos.x - av.pos.x, dz = boss.pos.z - av.pos.z, d = Math.hypot(dx, dz);
  const reach = BOSS_RADIUS + AVATAR.swingReach - 0.35;
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
  world.submit({ t: 'avatarInput', faction, input: { moveX, moveZ, jump: false, sprint: d > 14, yaw: Math.atan2(dx, dz), pitch: 0 } });
  // Same held-button cadence as the human controls: never grant NPCs a faster attack clock.
  if (boss.hp > 0 && d <= reach + 0.1 && world.time - route.lastSwing >= AVATAR.swingTime) {
    world.submit({ t: 'swing', faction }); route.lastSwing = world.time;
  }
  return true;
}
