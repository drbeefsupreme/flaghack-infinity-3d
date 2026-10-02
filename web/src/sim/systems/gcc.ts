/**
 * Geomantic Command Center: passives (Geomantic Advice reveal/observe radius, Flag Repair),
 * actives (Flag Gifts, Flagellian Dialectics, Flag Simulacra), being pushed, destruction and
 * rebuild at the Hearth.
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import type { FactionId } from '../types';
import type { World } from '../world';

export function cmdGcc(world: World, c: CommandOf<'gcc'>): void {}

/** Is the faction's GCC currently standing (not collapsed)? */
export function gccActive(world: World, f: FactionId): boolean {
  const g = world.gccOf(f);
  return !!g && g.gcc !== null && g.gcc.destroyedUntil <= world.time;
}

export function updateGcc(world: World, dt: number): void {}
