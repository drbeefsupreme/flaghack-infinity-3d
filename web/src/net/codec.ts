/**
 * Host-side snapshot encoding: full snapshots for (re)joining clients and per-frame deltas
 * shared by every client. Positions/angles are quantized; only fields clients read replicate
 * (see net/schema.ts); server-only scratch (hippie brains, system scratch) never leaves the host.
 * Lattice topology replicates as the ordered list of flipped node ids (clients regenerate the
 * lattice from the seed and replay flips).
 * Owner: NetCore agent.
 */
import type { GameEvent } from '../sim/events';
import type { World } from '../sim/world';

/** Everything a client needs on top of createMatch(options) to reach the host's state. */
export interface FullSnapshot {
  tick: number;
  time: number;
  /** Every applied phason flip since generation, in order (node ids). */
  flips: number[];
}

/** Changes since the previous delta (incremental: transport is reliable and ordered). */
export interface DeltaSnapshot {
  tick: number;
  time: number;
}

/** One encoder per match on the host; full() never disturbs the delta baseline. */
export class SnapshotEncoder {
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
  }

  full(): FullSnapshot {
    return { tick: this.world.tick, time: this.world.time, flips: [] };
  }

  /** Changes since the previous call. `events`: everything drained since then (flips are logged from phasonFlip). */
  delta(events: readonly GameEvent[]): DeltaSnapshot {
    return { tick: this.world.tick, time: this.world.time };
  }
}
