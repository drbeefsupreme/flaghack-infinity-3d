/** Retaliate against the planted pattern sustaining a Crystal, never its visual prism. */
import { BOSS_EYE_BLAST_RADIUS } from '../../boss';
import type { BossState } from '../../boss';
import { groundHeight } from '../../terrain';
import type { V3 } from '../../math';
import type { World } from '../../world';
import { nodeSupportingFlags } from './barriers';
import { activeBossCrystals } from './lightning';

export interface CrystalFlagTarget { at: V3; supports: number[]; }
export function crystalFlagTargets(world: World, boss: BossState): CrystalFlagTarget[] {
  const points: (V3 & { id: number })[] = [], seen = new Set<number>();
  for (const crystal of activeBossCrystals(world, boss)) {
    for (const flag of nodeSupportingFlags(world, crystal.pentacle, crystal.faction)) {
      if (seen.has(flag.id)) continue;
      seen.add(flag.id); points.push({ ...flag.pos, id: flag.id });
      if (flag.altNode >= 0) {
        const n = world.lattice.nodes[flag.altNode];
        if (n) points.push({ x: n.x, y: groundHeight(n.x, n.z, world.map.half), z: n.z, id: flag.id });
      }
    }
  }
  const radius = BOSS_EYE_BLAST_RADIUS, radius2 = radius ** 2;
  const centers = new Map<string, V3>();
  const add = (x: number, z: number, height: number) => {
    const y = world.collision.supportHeight(x, z, height + .1);
    const at = { x, y, z }, key = `${x.toFixed(6)}:${y.toFixed(6)}:${z.toFixed(6)}`;
    if (!centers.has(key)) centers.set(key, at);
  };
  for (const p of points) add(p.x, p.z, p.y);
  // A maximum-coverage equal-radius ground disk can be placed on a point or on
  // a pair of boundary points. Include both disk centers, with exact 3D scoring
  // afterward for Flags on decks. Real Flag positions remain fallback targets.
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i], b = points[j], dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 < 1e-12 || d2 > 4 * radius2) continue;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, height = Math.max(a.y, b.y);
    const k = Math.sqrt(Math.max(0, radius2 / d2 - .25));
    add(mx, mz, height); add(mx - dz * k, mz + dx * k, height); add(mx + dz * k, mz - dx * k, height);
  }
  const targets: CrystalFlagTarget[] = [];
  for (const at of centers.values()) {
    const supports = [...new Set(points.filter(p =>
      (p.x - at.x) ** 2 + (p.y - at.y) ** 2 + (p.z - at.z) ** 2 <= radius2 + 1e-8).map(p => p.id))];
    if (supports.length) targets.push({ at, supports });
  }
  return targets;
}
