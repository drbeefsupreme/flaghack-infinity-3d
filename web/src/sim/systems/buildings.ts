/**
 * Camp buildings: placement validation (thick facet inside own Survey, no overlap, nodes
 * stay free), construction progress, collision + nav registration, damage/disable/repair,
 * Hearth Ward pulses, Drug Lab brewing queue.
 * Owner: Economy agent.
 */
import type { CommandOf } from '../commands';
import type { Building, BuildingKind, EntityId, FactionId } from '../types';
import type { World } from '../world';

export interface PlacementCheck {
  ok: boolean;
  reason: string;
}

export function canPlaceBuilding(world: World, f: FactionId, kind: BuildingKind, facet: number): PlacementCheck {
  return { ok: false, reason: 'not implemented' };
}

export function cmdPlaceBuilding(world: World, c: CommandOf<'placeBuilding'>): void {}

/** Damage a building (Hearth: only cosmetic HP, never disabled). Returns true if damaged. */
export function damageBuilding(world: World, b: Building, amount: number, by: EntityId | -1): boolean {
  return false;
}

/** Register collision + nav blocking for a building (also used by setup for Hearth/GCC). */
export function registerBuildingShape(world: World, b: Building): void {}

/**
 * Move a (mobile) building, i.e. the GCC being pushed: updates pos/facet and re-registers its
 * collision shape and nav blocking. Units' avatar/hippie push logic calls this.
 */
export function moveBuilding(world: World, b: Building, x: number, z: number): void {
  b.pos.x = x;
  b.pos.z = z;
}

export function updateBuildings(world: World, dt: number): void {}
