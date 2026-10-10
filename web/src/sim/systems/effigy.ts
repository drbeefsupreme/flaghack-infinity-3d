import { bossRevealEnabled, bossRevealTime, effigyPoleConsumed } from '../effigyBurn';
import { makeIsBlockedAt } from '../map/mapgen';
import type { World } from '../world';

/** Derived geometry is applied once per World, independently of replicated transition state. */
const cleared = new WeakSet<World>();

/** Host-only transition. Store the scheduled time, never the delayed tick or renderer clock. */
export function updateEffigy(world: World): void {
  if (world.phase === 'playing' && world.effigyRevealedAt === null && world.suddenDeath && bossRevealEnabled(world.options)) {
    const at = bossRevealTime(world.options);
    if (Number.isFinite(at) && world.time >= at) world.effigyRevealedAt = at;
  }
  syncEffigy(world);
}

/** Reconstruct collision, navigation and plantability from authoritative state on every peer. */
export function syncEffigy(world: World): void {
  if (world.effigyRevealedAt !== null && bossRevealEnabled(world.options)) {
    if (cleared.has(world)) return;
    world.collision.removeEffigy();
    // Keep canonical obstacle definitions for render setup, including fresh late-join renderers.
    const obstacles = world.map.obstacles.filter((o) => o.kind !== 'effigy');
    world.map.isBlockedAt = makeIsBlockedAt(obstacles, world.map.water);
    world.nav.rebuildStatic({ obstacles, water: world.map.water });
    world.lattice.isBlockedAt = world.map.isBlockedAt;
    for (const node of world.lattice.nodes) node.blocked = world.map.isBlockedAt(node.x, node.z);
    // lattice.version counts phason flips on the wire; clearing a prop is not a topology change.
    world.survey.dirty = true;
    cleared.add(world);
  } else if (effigyPoleConsumed(world)) {
    world.collision.removeEffigyMasts();
  }
}

/** Retained for consumers of the approved non-boss mast-only cleanup. */
export const syncEffigyPole = syncEffigy;
