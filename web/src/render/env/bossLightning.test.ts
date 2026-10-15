import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_LIGHTNING_DURATION, bossLightningLevel } from './bossLightning';

function sampleWindows(boss = bossFixture(), duration = 150) {
  const windows: { start: number; end: number; levels: number[] }[] = [];
  let lit = false;
  for (let i = 0; i <= duration * 100; i++) {
    const t = i / 100, level = bossLightningLevel(boss, boss.spawnedAt + t);
    if (level > 0) {
      if (!lit) windows.push({ start: t, end: t, levels: [] });
      const window = windows[windows.length - 1]; window.end = t; window.levels.push(level);
    }
    lit = level > 0;
  }
  // A pulse that straddles the end of this observation window is not a full pulse sample.
  return lit ? windows.slice(0, -1) : windows;
}

describe('boss storm pulse timing', () => {
  it('has sparse single pulses with a gentle rise, bounded level, and no rapid strobe', () => {
    const windows = sampleWindows();
    expect(windows.length).toBeGreaterThan(10);
    expect(windows[0].start).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i], peak = Math.max(...window.levels), at = window.levels.indexOf(peak);
      expect(window.end - window.start).toBeLessThanOrEqual(BOSS_LIGHTNING_DURATION);
      expect(window.end - window.start).toBeGreaterThan(0.85);
      expect(peak).toBeGreaterThan(.995); expect(peak).toBeLessThanOrEqual(1);
      expect(at).toBeGreaterThanOrEqual(10);
      for (let j = 1; j < window.levels.length; j++) {
        expect(Math.abs(window.levels[j] - window.levels[j - 1])).toBeLessThan(.13);
        if (j <= at) expect(window.levels[j]).toBeGreaterThanOrEqual(window.levels[j - 1]);
        else expect(window.levels[j]).toBeLessThanOrEqual(window.levels[j - 1]);
      }
      if (i > 0) {
        expect(window.start - windows[i - 1].start).toBeGreaterThanOrEqual(8);
        expect(window.start - windows[i - 1].start).toBeLessThanOrEqual(14);
      }
    }
  });

  it('is deterministic on late join, seeks, repeated sampling, and different frame rates', () => {
    const boss = bossFixture(), peer = JSON.parse(JSON.stringify(boss));
    const times = [99.28, 6.73, 42.11, 18.68, 4.03, 99.28];
    const expected = times.map(t => bossLightningLevel(boss, boss.spawnedAt + t));
    // Unrelated render samples cannot consume RNG or alter future pulse state.
    for (let t = 0; t < 130; t += 1 / 144) bossLightningLevel(boss, boss.spawnedAt + t);
    expect(times.map(t => bossLightningLevel(peer, peer.spawnedAt + t))).toEqual(expected);
    expect(sampleWindows(peer)).toEqual(sampleWindows(boss));
  });

  it('stops during reveal and death, and has no residual flash after reset', () => {
    const boss = bossFixture(), window = sampleWindows(boss)[0], time = boss.spawnedAt + window.start + .12;
    expect(bossLightningLevel(boss, time)).toBeGreaterThan(.99);
    expect(bossLightningLevel(null, time)).toBe(0);
    expect(bossLightningLevel(boss, boss.spawnedAt - 1)).toBe(0);
    expect(bossLightningLevel(boss, Infinity)).toBe(0);
    for (const action of ['emerge', 'death', 'dead'] as const) expect(bossLightningLevel({ ...boss, action }, time)).toBe(0);
    expect(bossLightningLevel({ ...boss, deathAt: time }, time)).toBe(0);
    expect(bossLightningLevel({ ...boss, spawnedAt: time }, time)).toBe(0);
    expect(sampleWindows({ ...boss, id: boss.id + 1 })).not.toEqual(sampleWindows(boss));
  });
});
