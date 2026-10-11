import { bossRevealEnabled, bossRevealTime, effigyPoleConsumed } from '../effigyBurn';
import { rebuildSceneryBlocking } from './scenery';
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
    rebuildSceneryBlocking(world);
    cleared.add(world);
  } else if (effigyPoleConsumed(world)) {
    world.collision.removeEffigyMasts();
  }
}

/** Retained for consumers of the approved non-boss mast-only cleanup. */
export const syncEffigyPole = syncEffigy;
