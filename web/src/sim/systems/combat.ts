/**
 * Damage and knockback for units, plus a dispatcher that routes structure damage to the
 * Economy systems. Every damage source in the game calls `damageEntity`.
 * Owner: Units agent.
 */
import type { V2 } from '../math';
import type { EntityId } from '../types';
import type { World } from '../world';
import { damageBuilding } from './buildings';
import { damagePiece } from './pieces';

/**
 * Apply damage to any damageable entity (avatar, hippie, piece, building). Emits hit and,
 * for units at 0 HP, ko (dropping carried Flags loose). Returns true if the target took damage.
 */
export function damageEntity(world: World, target: EntityId, amount: number, by: EntityId | -1): boolean {
  const piece = world.pieces.get(target);
  if (piece) return damagePiece(world, piece, amount, by);
  const b = world.buildings.get(target);
  if (b) return damageBuilding(world, b, amount, by);
  return damageUnit(world, target, amount, by);
}

/** Avatar/hippie damage, KO handling, SOS auto-ping for hippies. */
export function damageUnit(world: World, target: EntityId, amount: number, by: EntityId | -1): boolean {
  return false;
}

/** Push a unit away from a point (adds 'knockback' effect and velocity). */
export function knockback(world: World, target: EntityId, from: V2, strength: number): void {}
