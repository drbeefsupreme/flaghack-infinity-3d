/**
 * Chakra alignment (ritual economy, 4 s channel at own Hearth) and the five point-and-click
 * abilities: Priority Beacon, Forced March, Stabilize Zone, Phason Shift, Omega Pulse.
 * Zones live in world.zones; Phason Shift routes through tides.applyFlip(…, 'ability').
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import type { V2 } from '../math';
import type { AbilityId, FactionId, Flag } from '../types';
import type { World } from '../world';

export function cmdAlign(world: World, c: CommandOf<'align'>): void {}

export function cmdAbility(world: World, c: CommandOf<'ability'>): void {}

/** Is (x, z) inside an active Stabilize Zone (any faction)? Used by tides/flags. */
export function inStabilizeZone(world: World, at: V2): boolean {
  return false;
}

/**
 * Stabilize Zone L3 makes the caster's planted Flags inside it unpullable. Every pull path
 * (avatars, hippies, Omega Pulse) must check this before pulling.
 */
export function isFlagProtected(world: World, flag: Flag): boolean {
  return false;
}

/** Why an ability can't be cast right now ('' = castable). UI and AI use this. */
export function abilityBlocker(world: World, f: FactionId, a: AbilityId): string {
  return 'not implemented';
}

export function updateAbilities(world: World, dt: number): void {}
