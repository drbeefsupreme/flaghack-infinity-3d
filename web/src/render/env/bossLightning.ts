/** Sparse storm-light pulses, sampled from replicated encounter state, never local RNG. */
import type { BossState } from '../../sim/boss';

const FIRST_FLASH = 4;
const FLASH_PERIOD = 11;
const FLASH_JITTER = 3;
export const BOSS_LIGHTNING_DURATION = 0.9;
export const BOSS_LIGHTNING_RISE = 0.12;
export const BOSS_LIGHTNING_INTENSITY = 1400;

type LightningBoss = Pick<BossState, 'id' | 'spawnedAt' | 'action' | 'deathAt'>;

/** One varying offset per slot: flashes stay 8–14 seconds apart, with no double strobe. */
function flashOffset(boss: LightningBoss, slot: number): number {
  let seed = Math.imul(boss.id ^ Math.round(boss.spawnedAt * 1000), 0x45d9f3b) ^ Math.imul(slot + 1, 0x27d4eb2d);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  return ((seed ^ (seed >>> 16)) >>> 0) / 0x100000000 * FLASH_JITTER;
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

/** A gentle, single rise and longer fade. Seeking/late join/replay yields the same light. */
export function bossLightningLevel(boss: LightningBoss | null | undefined, time: number): number {
  if (!boss || boss.deathAt !== null || boss.action === 'emerge' || boss.action === 'death' || boss.action === 'dead') return 0;
  const age = time - boss.spawnedAt - FIRST_FLASH;
  if (!Number.isFinite(age) || age < 0) return 0;
  const slot = Math.floor(age / FLASH_PERIOD);
  const pulseAge = age - slot * FLASH_PERIOD - flashOffset(boss, slot);
  if (pulseAge <= 0 || pulseAge >= BOSS_LIGHTNING_DURATION) return 0;
  return pulseAge < BOSS_LIGHTNING_RISE
    ? smooth(pulseAge / BOSS_LIGHTNING_RISE)
    : 1 - smooth((pulseAge - BOSS_LIGHTNING_RISE) / (BOSS_LIGHTNING_DURATION - BOSS_LIGHTNING_RISE));
}
