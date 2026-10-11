/** Presentation-only proximity to intact Ley loops, reconstructed from each peer's world. */
import type { BossState } from '../../../../sim/boss';
import { clamp } from '../../../../sim/math';
import { bossLoopEdges } from '../../../../sim/systems/boss/barriers';
import type { FactionId } from '../../../../sim/types';
import type { World } from '../../../../sim/world';

// Distances are measured from the boss CENTER to the finite line segment (not from
// the footprint's rim). Spatial hysteresis absorbs interpolation jitter at 5 metres.
export const FORCEFIELD_ENTER_DISTANCE = 5;
export const FORCEFIELD_EXIT_DISTANCE = 5.3;
export interface BossForcefieldContact {
  bossId: number;
  edge: number;
  faction: FactionId;
  x: number;
  z: number;
  yaw: number;
}

/** Every adjacent closed-loop edge gets a field, including both sides of a corner.
 * There is no nearest-edge or per-loop cap; stable IDs deduplicate only the same edge. */
export function bossForcefieldContacts(
  world: World, boss: BossState | null | undefined, previous: readonly BossForcefieldContact[] = [],
): BossForcefieldContact[] {
  if (!boss || boss.hp <= 0 || boss.deathAt !== null || boss.action === 'death' || boss.action === 'dead') return [];
  const retained = new Set(previous.filter(c => c.bossId === boss.id).map(c => c.edge));
  const seen = new Set<number>(), contacts: BossForcefieldContact[] = [];
  for (const ei of bossLoopEdges(world)) {
    if (seen.has(ei)) continue;
    seen.add(ei);
    const edge = world.lattice.edges[ei], a = world.lattice.nodes[edge.a], b = world.lattice.nodes[edge.b];
    const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
    const along = clamp(length2 > 0 ? ((boss.pos.x - a.x) * dx + (boss.pos.z - a.z) * dz) / length2 : 0, 0, 1);
    const x = a.x + along * dx, z = a.z + along * dz;
    const distance = Math.hypot(boss.pos.x - x, boss.pos.z - z);
    if (distance > (retained.has(ei) ? FORCEFIELD_EXIT_DISTANCE : FORCEFIELD_ENTER_DISTANCE)) continue;
    contacts.push({ bossId: boss.id, edge: ei, faction: world.survey.edgeLey[ei] as FactionId, x, z,
      // Align each plane with its own line. At a shared endpoint, facing the boss
      // would collapse both corner fields onto the same plane and double brightness.
      yaw: Math.atan2(-dz, dx) });
  }
  return contacts.sort((a, b) => a.edge - b.edge);
}
