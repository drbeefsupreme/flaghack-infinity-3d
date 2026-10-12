/** Shared presentation geometry for intact forcefields and their one-shot fragments. */
import { BOSS_GAMEPLAY_SCALE } from './bossDimensions';
import { clamp } from './math';
import type { V2 } from './math';

export const BOSS_FORCEFIELD_WIDTH = 10 * BOSS_GAMEPLAY_SCALE;
export const BOSS_FORCEFIELD_HEIGHT = 20 * BOSS_GAMEPLAY_SCALE;
export const BOSS_FORCEFIELD_CENTER_HEIGHT = 7.5 * BOSS_GAMEPLAY_SCALE;
export const FORCEFIELD_ENTER_DISTANCE = 5;
export const FORCEFIELD_EXIT_DISTANCE = 5.3;

/** Closest point on the finite edge; planes follow its tangent even at corners. */
export function projectBossForcefield(point: V2, a: V2, b: V2): { x: number; z: number; yaw: number; distance: number } {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const along = clamp(length2 > 0 ? ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2 : 0, 0, 1);
  const x = a.x + along * dx, z = a.z + along * dz;
  return { x, z, yaw: Math.atan2(-dz, dx), distance: Math.hypot(point.x - x, point.z - z) };
}
