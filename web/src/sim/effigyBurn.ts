import { burnTime, matchSettings } from './matchSettings';
import type { MatchOptions } from './types';

/** Boss reveal begins exactly this many simulation seconds after The Burn. */
export const EFFIGY_BOSS_REVEAL_AT = 90;
/** Shared rise duration for the model and local camera focus. */
export const EFFIGY_BOSS_RISE_SECONDS = 5;

/** Title/attract worlds explicitly opt out with bossMode:false; AI-only matches still work. */
export function bossRevealEnabled(options: MatchOptions): boolean {
  return options.mode !== 'tutorial' && matchSettings(options).bossMode;
}

export function bossRevealTime(options: MatchOptions): number {
  return burnTime(options) + EFFIGY_BOSS_REVEAL_AT;
}

/** Shared end of the Flag/pole animation, in simulation seconds since The Burn. */
export const EFFIGY_POLE_CONSUMED_AT = 176;

/** Reproducible on the host and late-joining clients, without renderer-owned state. */
export function effigyPoleConsumed(world: { options: MatchOptions; time: number; suddenDeath: boolean }): boolean {
  if (!world.suddenDeath || world.options.mode === 'tutorial' || bossRevealEnabled(world.options)) return false;
  const at = burnTime(world.options) + EFFIGY_POLE_CONSUMED_AT;
  return Number.isFinite(at) && world.time >= at;
}
