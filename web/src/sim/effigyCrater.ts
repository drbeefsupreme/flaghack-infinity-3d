import { BOSS_GAMEPLAY_SCALE } from './bossDimensions';
import { bossRevealEnabled } from './effigyBurn';
import type { V2 } from './math';
import { Rng } from './rng';
import type { World } from './world';

/** Shared with the rendered crater: its ragged outer skirt is the precise boundary. */
export const CRATER_SEGMENTS = 80;
export const CRATER_OUTER_RADIUS = 10.7;
export function craterRimVariation(rng: Rng): number[] {
  return Array.from({ length: CRATER_SEGMENTS }, () => rng.range(0.93, 1.07));
}
const rims = new WeakMap<World, V2[]>();

/** Only the original Effigy reveal creates this footprint; the roaming boss's death does not. */
export function insideEffigyCrater(world: World, pos: V2): boolean {
  if (!bossRevealEnabled(world.options) || world.effigyRevealedAt === null || world.time < world.effigyRevealedAt) return false;
  const x = (pos.x - world.map.effigy.x) / BOSS_GAMEPLAY_SCALE;
  const z = (pos.z - world.map.effigy.z) / BOSS_GAMEPLAY_SCALE;
  if (x * x + z * z > (CRATER_OUTER_RADIUS * 1.07) ** 2) return false;
  let rim = rims.get(world);
  if (!rim) {
    rim = craterRimVariation(new Rng(`boss-reveal:${world.map.seed}`)).map((v, i) => {
      const a = i / CRATER_SEGMENTS * Math.PI * 2;
      return { x: Math.cos(a) * v * CRATER_OUTER_RADIUS, z: Math.sin(a) * v * CRATER_OUTER_RADIUS };
    });
    rims.set(world, rim);
  }
  // Include the rim itself. Ray crossing also handles the irregular, non-convex skirt.
  let inside = false;
  for (let i = 0, j = rim.length - 1; i < rim.length; j = i++) {
    const a = rim[j], b = rim[i];
    const cross = (x - a.x) * (b.z - a.z) - (z - a.z) * (b.x - a.x);
    if (Math.abs(cross) < 1e-9 && (x - a.x) * (x - b.x) + (z - a.z) * (z - b.z) <= 1e-9) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
