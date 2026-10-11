import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from './boss';
import { BURN_TIME, DAWN_TIME } from './constants';
import { bossDayClock, BOSS_NIGHT_CLOCK, worldDayClock } from './dayCycle';
import { bossRevealTime } from './effigyBurn';
import { dayClock, normalizeMatch, UNLIMITED_DAYS } from './matchSettings';
import { createMatch } from './setup';
import { updateVictory } from './systems/victory';
import type { MatchOptions } from './types';

const setup = (days = 1, dayLength = 1800, bossMode = true) => {
  const options: MatchOptions = { seed: 'encounter-clock', mode: 'standard', difficulty: 'normal', humans: [0, 1],
    match: normalizeMatch({ days, dayLength, bossMode, maxSignifiers: 0 }) };
  return { options, time: 0, suddenDeath: true, effigyRevealedAt: null as number | null, boss: null as ReturnType<typeof bossFixture> | null };
};
describe('shared encounter day phase', () => {
  it.each([0, 1, 3, 5])('settles continuously into night and holds indefinitely with %s scheduled days', days => {
    for (const length of [300, 1800, 7200]) {
      const w = setup(days, length); const reveal = bossRevealTime(w.options);
      const expected = Math.max(BOSS_NIGHT_CLOCK, dayClock(w.options, reveal));
      w.time = reveal - 5; expect(worldDayClock(w)).toBeCloseTo(dayClock(w.options, w.time));
      const start = worldDayClock(w); w.time += 1e-5; expect(Math.abs(worldDayClock(w) - start)).toBeLessThan(.001);
      w.time = reveal - 1e-5; expect(worldDayClock(w)).toBeCloseTo(expected, 7);
      w.time = reveal; w.effigyRevealedAt = reveal; w.boss = bossFixture(); expect(worldDayClock(w)).toBe(expected);
      for (const elapsed of [1, 600, 7200, 1000000]) { w.time = reveal + elapsed; expect(worldDayClock(w)).toBe(expected); }
      expect(w.time).toBe(reveal + 1000000); // The actual simulation clock was never frozen.
    }
  });
  it('starts dawn from exactly the held night and reaches it only over the death animation', () => {
    const w = setup(0); w.time = 90; w.effigyRevealedAt = 90; w.boss = bossFixture();
    const held = worldDayClock(w); w.time = 9000; w.boss.hp = 0; w.boss.deathAt = w.time; w.boss.action = 'death';
    expect(worldDayClock(w)).toBe(held);
    w.time += .001; expect(worldDayClock(w) - held).toBeLessThan(.001);
    w.time = 9006; expect(worldDayClock(w)).toBe((held + DAWN_TIME) / 2);
    w.time = 9012; expect(worldDayClock(w)).toBe(DAWN_TIME);
    w.boss.action = 'dead'; w.time = 9020; expect(worldDayClock(w)).toBe(DAWN_TIME);
    // Replays and backwards seeks derive the same result without a renderer clock.
    w.time = 9006; expect(worldDayClock(w)).toBe((held + DAWN_TIME) / 2);
  });
  it('preserves the ordinary calendar for disabled, tutorial, unlimited and reset worlds', () => {
    for (const days of [UNLIMITED_DAYS, 0, 1, 5]) for (const length of [300, 7200]) {
      const w = setup(days, length, false);
      for (const t of [0, 85, 90, 500, 99999]) { w.time = t; expect(worldDayClock(w)).toBe(dayClock(w.options, t)); }
    }
    const unlimited = setup(UNLIMITED_DAYS); unlimited.time = 99999; expect(bossDayClock(unlimited)).toBeNull();
    const tutorial = setup(); tutorial.options.mode = 'tutorial'; tutorial.time = 99999; expect(bossDayClock(tutorial)).toBeNull();
    const reset = setup(0); reset.time = 90; reset.effigyRevealedAt = 90; reset.boss = bossFixture();
    expect(worldDayClock(reset)).toBe(BOSS_NIGHT_CLOCK);
    reset.time = 0; reset.effigyRevealedAt = null; reset.boss = null; expect(worldDayClock(reset)).toBe(BURN_TIME);
    reset.time = 90; reset.suddenDeath = false; expect(bossDayClock(reset)).toBeNull();
  });
  it('holds night past scheduled Dawn without ending gameplay, then wins only after twelve seconds', () => {
    const w = createMatch(setup(0, 300).options); w.suddenDeath = true; w.effigyRevealedAt = 90; w.boss = bossFixture(); w.time = 4000;
    updateVictory(w, 1/60); expect(w.phase).toBe('playing'); expect(worldDayClock(w)).toBeLessThan(DAWN_TIME - 360);
    w.boss.hp = 0; w.boss.deathAt = w.time; w.boss.action = 'death'; const death = w.time;
    w.time = death + BOSS_DEATH_DURATION - .001; updateVictory(w, 1/60); expect(w.phase).toBe('playing');
    expect(worldDayClock(w)).toBeLessThan(DAWN_TIME);
    w.boss.action = 'dead'; w.time = death + BOSS_DEATH_DURATION; updateVictory(w, 1/60);
    expect(w.bossOutcome?.kind).toBe('victory'); expect(worldDayClock(w)).toBe(DAWN_TIME);
  });
});
