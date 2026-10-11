/** Distance helpers for a moving spherical blast. Its center follows consecutive ray impacts. */
import type { V3 } from '../../math';

export function segmentPointDistanceSquared(from: V3 | null, to: V3, point: V3): number {
  if (!from) return (to.x - point.x) ** 2 + (to.y - point.y) ** 2 + (to.z - point.z) ** 2;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / length2)) : 0;
  return (from.x + dx * t - point.x) ** 2 + (from.y + dy * t - point.y) ** 2 + (from.z + dz * t - point.z) ** 2;
}

/** The squared distance to any convex upright body is convex along the segment.
 * A fixed 36-step minimization resolves even a thin grazing target, without frame-rate samples.
 * Endpoint tests retain exact inclusive radius boundaries. */
export function sweptBodyDistanceSquared(from: V3 | null, to: V3, distance: (x: number, y: number, z: number) => number): number {
  let best = distance(to.x, to.y, to.z);
  if (!from || from.x === to.x && from.y === to.y && from.z === to.z) return best;
  best = Math.min(best, distance(from.x, from.y, from.z));
  let lo = 0, hi = 1;
  const at = (t: number) => distance(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
  for (let i = 0; i < 36; i++) {
    const a = (2 * lo + hi) / 3, b = (lo + 2 * hi) / 3, da = at(a), db = at(b);
    best = Math.min(best, da, db);
    if (da < db) hi = b; else lo = a;
  }
  return Math.min(best, at((lo + hi) / 2));
}
