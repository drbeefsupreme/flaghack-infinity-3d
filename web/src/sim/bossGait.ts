/** Host contact clock and measured sole centres from the actual, in-place rig. */
import { BOSS_MODEL_SCALE } from './bossDimensions';
import type { V2 } from './math';

export const BOSS_GAIT = {
  walk: { stride: 7.8 * BOSS_MODEL_SCALE, phases: [0, .5], feet: [{ x: 1.987612, z: 3.391756 }, { x: -1.989228, z: 3.386263 }] },
  crouchWalk: { stride: 6 * BOSS_MODEL_SCALE, phases: [0, 31 / 60], feet: [{ x: 2.907582, z: 2.810562 }, { x: -2.906222, z: 2.711522 }] },
} as const;
export type BossGait = keyof typeof BOSS_GAIT;
export interface BossFootContact { side: 0 | 1; fraction: number; local: V2; }

/** All contacts in (from,to], not one boolean per frame; a pause/restart cannot replay one. */
export function bossFootContacts(gait: BossGait, from: number, to: number): BossFootContact[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const spec = BOSS_GAIT[gait], result: BossFootContact[] = [];
  for (const side of [0, 1] as const) {
    const phase = spec.phases[side], first = Math.floor((from + 1e-8) / spec.stride - phase) + 1;
    const last = Math.floor((to + 1e-8) / spec.stride - phase);
    for (let cycle = first; cycle <= last; cycle++) {
      const at = (cycle + phase) * spec.stride;
      result.push({ side, fraction: Math.max(0, Math.min(1, (at - from) / (to - from))),
        local: { x: spec.feet[side].x * BOSS_MODEL_SCALE, z: spec.feet[side].z * BOSS_MODEL_SCALE } });
    }
  }
  return result.sort((a, b) => a.fraction - b.fraction);
}
