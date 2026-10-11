import { makeIsBlockedAt } from '../map/mapgen';
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
  return true;
}
