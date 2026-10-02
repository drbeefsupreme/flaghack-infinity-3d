/**
 * Fortnite-speed build pieces snapped to the Ley Lattice: walls on edges, decks (floors) and
 * ramps on facets, levels 0..MAX_BUILD_LEVEL, support rules, lumber costs, collision + nav
 * registration, damage/destruction, demolish refunds. Also used by UI ghosts (canBuildPiece).
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import type { EntityId, FactionId, Piece, PieceKind } from '../types';
import type { World } from '../world';
import type { PlacementCheck } from './buildings';

export function canBuildPiece(
  world: World,
  f: FactionId,
  kind: PieceKind,
  edge: number,
  facet: number,
  level: number,
  rampEdge: number,
): PlacementCheck {
  return { ok: false, reason: 'not implemented' };
}

export function cmdBuild(world: World, c: CommandOf<'build'>): void {}

export function cmdDemolish(world: World, c: CommandOf<'demolish'>): void {}

export function damagePiece(world: World, p: Piece, amount: number, by: EntityId | -1): boolean {
  return false;
}

/** Existing piece occupying a slot, or undefined. */
export function pieceAt(world: World, kind: PieceKind, edge: number, facet: number, level: number): Piece | undefined {
  return undefined;
}

export function updatePieces(world: World, dt: number): void {}
