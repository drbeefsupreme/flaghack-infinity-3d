/**
 * Camp economy: Hearth/Workshop Flag crafting, Drum Circle recruitment (pop cap), ritual
 * income from drummers, lumber pile respawn, hoarding penalty flag, C.M.I. stat upkeep.
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import { JOBS } from '../types';
import type { FactionId } from '../types';
import type { World } from '../world';

export function cmdJobWeights(world: World, c: CommandOf<'jobWeights'>): void {
  const w = world.factions[c.faction].jobWeights;
  for (const j of JOBS) {
    const v = c.weights[j];
    if (v !== undefined) w[j] = Math.max(0, Math.min(4, Math.round(v)));
  }
}

/** Current hippie population cap of a faction. */
export function popCap(world: World, f: FactionId): number {
  return 12;
}

export function updateEconomy(world: World, dt: number): void {}
