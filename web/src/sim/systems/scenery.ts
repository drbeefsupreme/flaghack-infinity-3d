import { groundHeight } from '../terrain';
import { footprintDistance, makeIsBlockedAt } from '../map/mapgen';
import type { Obstacle } from '../map/mapgen';
import { distToSegment } from '../math';
import type { V2, V3 } from '../math';
import { sweptBodyDistanceSquared } from './boss/blastGeometry';
import type { World } from '../world';

const applied = new WeakMap<World, Set<number>>();

/** Refresh only static blocking, retaining all building/piece registrations and map definitions. */
export function rebuildSceneryBlocking(world: World): void {
  const obstacles = world.map.obstacles.filter((o) => !world.destroyedScenery.has(o.id) &&
    (o.kind !== 'effigy' || world.effigyRevealedAt === null));
  world.map.isBlockedAt = makeIsBlockedAt(obstacles, world.map.water);
  world.nav.rebuildStatic({ obstacles, water: world.map.water });
  world.lattice.isBlockedAt = world.map.isBlockedAt;
  for (const node of world.lattice.nodes) node.blocked = world.map.isBlockedAt(node.x, node.z);
  world.survey.dirty = true;
}

/** Apply durable host state on both live mirrors and fresh late joins. */
export function syncScenery(world: World): void {
  let removed = applied.get(world);
  if (!removed) { removed = new Set(); applied.set(world, removed); }
  let changed = false;
  for (const id of world.destroyedScenery) {
    if (removed.has(id)) continue;
    const obstacle = world.map.obstacles.find((o) => o.id === id);
    if (!obstacle || obstacle.kind === 'effigy') continue;
    world.collision.removeObstacle(id);
    removed.add(id);
    changed = true;
  }
  if (changed) rebuildSceneryBlocking(world);
}

/** Direct ray hits only. Ground, entities, missing IDs and the reveal effigy are never scenery. */
export function destroySceneryHit(world: World, tag: number): boolean {
  if (!Number.isInteger(tag) || tag >= 0) return false;
  const id = -1 - tag;
  const obstacle = world.map.obstacles.find((o) => o.id === id);
  if (!obstacle || obstacle.kind === 'effigy' || world.destroyedScenery.has(id)) return false;
  world.destroyedScenery.add(id);
  syncScenery(world);
  world.emit({ t: 'sceneryCrushed', pos: { x: obstacle.x, z: obstacle.z }, count: 1 });
  return true;
}

/** Distance from a swept foot centre to the exact circular/oriented-box prop footprint. */
function sweptFootprintDistance(obstacle: Obstacle, from: V2, to: V2): number {
  if (obstacle.shape === 'circle') {
    return Math.max(0, distToSegment(obstacle.x, obstacle.z, from.x, from.z, to.x, to.z) - obstacle.radius);
  }
  const c = Math.cos(obstacle.yaw), s = Math.sin(obstacle.yaw);
  const ax = (from.x - obstacle.x) * c - (from.z - obstacle.z) * s;
  const az = (from.x - obstacle.x) * s + (from.z - obstacle.z) * c;
  const bx = (to.x - obstacle.x) * c - (to.z - obstacle.z) * s;
  const bz = (to.x - obstacle.x) * s + (to.z - obstacle.z) * c;
  // Segment/rectangle slab intersection catches a long step across a thin prop.
  let enter = 0, exit = 1;
  for (const [start, delta, half] of [[ax, bx - ax, obstacle.hx], [az, bz - az, obstacle.hz]]) {
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(start) > half) { enter = 1; exit = 0; break; }
    } else {
      const low = (-half - start) / delta, high = (half - start) / delta;
      enter = Math.max(enter, Math.min(low, high));
      exit = Math.min(exit, Math.max(low, high));
    }
  }
  if (enter <= exit) return 0;
  let distance = Math.min(footprintDistance(obstacle, from.x, from.z), footprintDistance(obstacle, to.x, to.z));
  for (const x of [-obstacle.hx, obstacle.hx]) for (const z of [-obstacle.hz, obstacle.hz]) {
    distance = Math.min(distance, distToSegment(x, z, ax, az, bx, bz));
  }
  return distance;
}

/**
 * Authoritative grounded foot contact only: a bounded swept footprint, not a remote blast.
 * Batch IDs before rebuilding blocking once; all peers reuse the beam's durable removal state.
 * Ordinary landings cap footprint span; deliberate stomps may crush any prop size.
 */
export function crushScenery(
  world: World, from: V2, to: V2, radius: number, canReach: (obstacle: Obstacle) => boolean = () => true,
  maxFootprintSpan = Infinity,
): number {
  if (![from.x, from.z, to.x, to.z, radius].every(Number.isFinite) || radius < 0 || Number.isNaN(maxFootprintSpan) || maxFootprintSpan < 0) return 0;
  let count = 0;
  for (const obstacle of world.map.obstacles) {
    if (obstacle.kind === 'effigy' || world.destroyedScenery.has(obstacle.id)) continue;
    const span = obstacle.shape === 'circle' ? obstacle.radius * 2 : Math.max(obstacle.hx, obstacle.hz) * 2;
    if (span > maxFootprintSpan) continue;
    if (sweptFootprintDistance(obstacle, from, to) > radius + 1e-9 || !canReach(obstacle)) continue;
    world.destroyedScenery.add(obstacle.id);
    count++;
  }
  if (count > 0) {
    syncScenery(world);
    world.emit({ t: 'sceneryCrushed', pos: { x: to.x, z: to.z }, count });
  }
  return count;
}

/** Beam impact sphere/capsule only: every static gameplay prop in the blast may shatter.
 * Ray-surface continuity is decided by the caller; never bridge an occlusion jump here. */
export function destroySceneryBlast(world: World, at: V3, radius: number, from: V3 | null = null): number {
  if (![at.x, at.y, at.z, radius, ...(from ? [from.x, from.y, from.z] : [])].every(Number.isFinite) || radius < 0) return 0;
  const first = from ?? at, radius2 = radius * radius;
  let count = 0;
  for (const obstacle of world.map.obstacles) {
    if (obstacle.kind === 'effigy' || world.destroyedScenery.has(obstacle.id)) continue;
    const base = groundHeight(obstacle.x, obstacle.z, world.map.half);
    const r = obstacle.shape === 'circle' ? obstacle.radius : Math.hypot(obstacle.hx, obstacle.hz);
    if (obstacle.x + r + radius < Math.min(first.x, at.x) || obstacle.x - r - radius > Math.max(first.x, at.x) ||
        obstacle.z + r + radius < Math.min(first.z, at.z) || obstacle.z - r - radius > Math.max(first.z, at.z) ||
        base + obstacle.height + radius < Math.min(first.y, at.y) || base - radius > Math.max(first.y, at.y)) continue;
    const distance = sweptBodyDistanceSquared(from, at, (x, y, z) => {
      const dxz = footprintDistance(obstacle, x, z), dy = Math.max(base - y, 0, y - base - obstacle.height);
      return dxz * dxz + dy * dy;
    });
    if (distance > radius2 + 1e-9) continue;
    world.destroyedScenery.add(obstacle.id); count++;
  }
  if (count > 0) {
    syncScenery(world);
    world.emit({ t: 'sceneryCrushed', pos: { x: at.x, z: at.z }, count });
  }
  return count;
}
