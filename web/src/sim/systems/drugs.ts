/**
 * Drugs: brewing commands for Drug Labs, use (faction-wide timers in FactionState.drugActive),
 * per-tick effects and risks (Saffron crash/overstimulation, Luminous Dust hallucination
 * flags for the UI, Acid Cop Vision mesh tap + paranoia).
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import type { DrugId, FactionId } from '../types';
import type { World } from '../world';

export function cmdBrew(world: World, c: CommandOf<'brew'>): void {}

export function cmdDrug(world: World, c: CommandOf<'drug'>): void {}

export function isDrugActive(world: World, f: FactionId, d: DrugId): boolean {
  return world.factions[f].drugActive[d] > world.time;
}

export function updateDrugs(world: World, dt: number): void {}
