/**
 * Phason Tides and flip application. `applyFlip` is the ONLY way a lattice flip may happen
 * in a running match (abilities, tides, instability storms all route through it): it
 * respects Zeno observation rules, decoheres Flags on the moved node, shatters affected
 * Crystals, emits phasonFlip and marks the survey dirty.
 * Owner: SurveyRules agent.
 */
import type { World } from '../world';

export type FlipCause = 'tide' | 'ability' | 'storm';

/**
 * Attempt a flip of `node`. Tides/storms skip nodes whose Flag is observed by its owner;
 * 'ability' flips ignore Canon III self-observation but never pass Stabilize Zones.
 * Returns true if the lattice changed.
 */
export function applyFlip(world: World, node: number, cause: FlipCause): boolean {
  return false;
}

/** Schedules tides (TIDE_INTERVAL, warning TIDE_WARNING before) and executes them. */
export function updateTides(world: World, dt: number): void {}
