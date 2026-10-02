/**
 * Flag lifecycle: stock → carried → planted/loose/flying → … Conservation: Flags are never
 * destroyed except by explicit design (none in v1). Every state change appends history,
 * updates SurveyState node arrays and marks the survey dirty.
 * Owner: SurveyRules agent.
 */
import type { V2, V3 } from '../math';
import type { EntityId, FactionId, Flag, Owner } from '../types';
import type { World } from '../world';

/** Can `faction` plant on this node right now? (unblocked, free, not under a building/crystal). */
export function canPlantAt(world: World, node: number, faction: FactionId): boolean {
  return false;
}

/**
 * Plant a held Flag (carried by `by`, or flying) on `node` for `owner`. Removes it from the
 * carrier's inventory, sets state 'planted', emits flagPlanted, marks survey dirty.
 * Returns false (and changes nothing) if invalid.
 */
export function plantFlag(world: World, flagId: EntityId, node: number, owner: FactionId, by: EntityId | -1): boolean {
  return false;
}

/**
 * Pull a planted or loose Flag. If `carrier` (avatar or hippie id) can hold it, it becomes
 * carried by them (owner = carrier faction); otherwise it drops loose at its position.
 * Emits flagPulled. Counts flagsStolen when prev owner differs.
 */
export function pullFlag(world: World, flagId: EntityId, carrier: EntityId | -1): boolean {
  return false;
}

/** Drop a carried Flag loose at a world position (KO, overflow, decoherence). */
export function dropLoose(world: World, flagId: EntityId, at: V3): void {}

/** Move one Flag from a Hearth's stock into a carrier's hands. Returns the Flag or null. */
export function takeFromStock(world: World, hearthId: EntityId, carrier: EntityId): Flag | null {
  return null;
}

/** Put a carried/loose Flag into a Hearth's stock (owner becomes the Hearth's faction). */
export function depositToStock(world: World, flagId: EntityId, hearthId: EntityId): void {}

/** Create a brand-new Flag in a Hearth's stock (crafting). Emits flagCrafted. */
export function craftFlag(world: World, hearthId: EntityId): Flag | null {
  return null;
}

/** Nearest node within radius where `faction` could plant, or -1. */
export function nearestPlantableNode(world: World, at: V2, radius: number, faction: FactionId): number {
  return -1;
}

/** Re-own every planted Flag of `from` as `to` (capture/elimination). */
export function transferFlags(world: World, from: FactionId, to: Owner): void {}
