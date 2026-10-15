/** One deterministic sky/calendar phase for the encounter, UI and audio fallback.
 * Simulation time keeps advancing: attacks, tides and the Burn never pause here. */
import { BOSS_DEATH_DURATION } from './boss';
import { BURN_TIME, DAWN_TIME } from './constants';
import { bossRevealEnabled, bossRevealTime } from './effigyBurn';
import { dayClock } from './matchSettings';
import type { World } from './world';

type DayWorld = Pick<World, 'options' | 'time' | 'suddenDeath' | 'effigyRevealedAt' | 'boss'>;
/** Same darkest-night key used by the sky. Dawn must not initially lower the sun. */
export const BOSS_NIGHT_CLOCK = BURN_TIME + .375 * (DAWN_TIME - BURN_TIME);
export const BOSS_NIGHT_SETTLE_SECONDS = 5;
const smooth = (v: number): number => { const p = Math.max(0, Math.min(1, v)); return p * p * (3 - 2 * p); };

/** Null outside the encounter's emergence/night/dawn override. No mutable client state. */
export function bossDayClock(world: DayWorld): number | null {
  if (!world.suddenDeath || !bossRevealEnabled(world.options)) return null;
  const reveal = world.effigyRevealedAt ?? bossRevealTime(world.options);
  if (!Number.isFinite(reveal) || world.time < reveal - BOSS_NIGHT_SETTLE_SECONDS) return null;
  // All supported day lengths reveal in full night. The bounds also keep restored
  // or scenario-authored reveal timestamps from accidentally holding daylight.
  const held = Math.max(BOSS_NIGHT_CLOCK, Math.min(DAWN_TIME - 360, dayClock(world.options, reveal)));
  if (world.time < reveal) {
    const ordinary = dayClock(world.options, world.time);
    return ordinary + (held - ordinary) * smooth((world.time - reveal + BOSS_NIGHT_SETTLE_SECONDS) / BOSS_NIGHT_SETTLE_SECONDS);
  }
  const death = world.boss?.deathAt;
  if (death === null || death === undefined || !Number.isFinite(death)) return held;
  return held + (DAWN_TIME - held) * smooth((world.time - death) / BOSS_DEATH_DURATION);
}

export function worldDayClock(world: DayWorld): number {
  return bossDayClock(world) ?? dayClock(world.options, world.time);
}
