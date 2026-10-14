/** Stateless boss-emergence weather; reconstructed from replicated state after pause/reset/join. */
import { DAWN_TIME } from '../../sim/constants';
import { worldDayClock } from '../../sim/dayCycle';
import { bossRevealEnabled, bossRevealTime, EFFIGY_BOSS_RISE_SECONDS } from '../../sim/effigyBurn';
import type { World } from '../../sim/world';
export const STORM_ONSET_SECONDS = EFFIGY_BOSS_RISE_SECONDS;
export const STORM_CLEAR_CLOCK = DAWN_TIME - 300;
const smooth = (v: number): number => { const p = Math.max(0, Math.min(1, v)); return p * p * (3 - 2 * p); };
export function burnStormLevel(world: World, screen: string): number {
  if (screen === 'title' || !world.suddenDeath || !bossRevealEnabled(world.options)) return 0;
  const start = (world.effigyRevealedAt ?? bossRevealTime(world.options)) - EFFIGY_BOSS_RISE_SECONDS;
  if (!Number.isFinite(start) || world.time < start) return 0;
  const onset = smooth((world.time - start) / STORM_ONSET_SECONDS);
  // Boss nightlock holds this indefinitely; the existing death sunrise clears it.
  return onset * (1 - smooth((worldDayClock(world) - STORM_CLEAR_CLOCK) / (DAWN_TIME - STORM_CLEAR_CLOCK)));
}
