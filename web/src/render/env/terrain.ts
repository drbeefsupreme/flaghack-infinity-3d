import { groundHeight } from "../../sim/terrain";
/**
 * Decorative terrain relief. The playable square gently domes 2 m above its edges;
 * beyond the border the land rolls up into wooded Georgia hills that frame the burn.
 */

/** Flat margin (m) kept beyond the map edges before the hills start. */
const FLAT_MARGIN = 16;
/**
 * Corner rounding of the flat region (m). Must stay below FLAT_MARGIN·√2/(√2−1) ≈ 54 so the
 * map's own corners remain inside the flat region.
 */
const CORNER_RADIUS = 40;

/** Height of the decorative terrain at (x, z); shared gameplay dome inside the map, decorative hills beyond it. */
export function terrainHeight(x: number, z: number, half: number): number {
  // Signed distance beyond a rounded square (no creases along the diagonals).
  const inner = half + FLAT_MARGIN - CORNER_RADIUS;
  const dx = Math.max(Math.abs(x) - inner, 0);
  const dz = Math.max(Math.abs(z) - inner, 0);
  const e = Math.hypot(dx, dz) - CORNER_RADIUS;
  if (e <= 0) return groundHeight(x, z, half);
  const ramp = e < 110 ? (e / 110) * (e / 110) * (3 - (2 * e) / 110) : 1;
  const rolling =
    9 +
    6 * Math.sin(x * 0.012 + 1.3) * Math.sin(z * 0.0105 - 0.7) +
    4 * Math.sin((x + z) * 0.019 + 2.1) +
    2.5 * Math.sin((x - z) * 0.033 - 0.4);
  return ramp * rolling * 1.6 + e * 0.035;
}
