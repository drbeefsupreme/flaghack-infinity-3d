import { describe, expect, it } from 'vitest';
import { bossAwakeningAge, bossAwakeningExposure, bossAwakeningLevel } from './bossPresentation';
import { normalizeMatch } from './matchSettings';
import type { World } from './world';

const fixture = () => ({ time: 90, effigyRevealedAt: 90, options: { mode: 'standard', match: normalizeMatch({ bossMode: true }) }, phase: 'playing' } as unknown as World);

describe('authoritative awakening presentation', () => {
  it('begins only at the replicated reveal and ends at exactly five seconds', () => {
    const world = fixture();
    world.time = 89.999; expect(bossAwakeningAge(world)).toBeNull();
    world.time = 90; expect(bossAwakeningAge(world)).toBe(0); expect(bossAwakeningLevel(world)).toBe(1);
    world.time = 94.4; expect(bossAwakeningLevel(world)).toBeCloseTo(1);
    world.time = 94.7; expect(bossAwakeningLevel(world)).toBeCloseTo(.5);
    world.time = 94.999; expect(bossAwakeningLevel(world)).toBeGreaterThan(0);
    world.time = 95; expect(bossAwakeningAge(world)).toBeNull(); expect(bossAwakeningLevel(world)).toBe(0);
    world.effigyRevealedAt = null; world.time = 200; expect(bossAwakeningLevel(world)).toBe(0);
  });

  it('is one sustained burst with monotonic recovery, independent of frame rate, repeats and late joins', () => {
    const world = fixture(), peer = JSON.parse(JSON.stringify(world));
    let previous = 1;
    for (let i = 0; i <= 600; i++) {
      world.time = 90 + i / 120;
      const level = bossAwakeningLevel(world);
      expect(level).toBeGreaterThanOrEqual(0); expect(level).toBeLessThanOrEqual(previous + 1e-10);
      if (i / 120 <= 4.4) expect(level).toBe(1);
      expect(bossAwakeningExposure(level)).toBeGreaterThanOrEqual(1);
      previous = level;
    }
    for (const time of [94.7, 90, 95, 92, 89.9, 94.7]) {
      world.time = peer.time = time;
      expect(bossAwakeningLevel(world)).toBe(bossAwakeningLevel(peer));
    }
    expect(bossAwakeningExposure(0)).toBe(1); expect(bossAwakeningExposure(1)).toBe(4);
  });

  it('clears on reset, end, disabled encounter, tutorial, and invalid clocks', () => {
    const world = fixture();
    for (const time of [NaN, Infinity, -Infinity]) { world.time = time; expect(bossAwakeningAge(world)).toBeNull(); }
    world.time = 90; world.phase = 'ended'; expect(bossAwakeningLevel(world)).toBe(0);
    world.phase = fixture().phase; world.options.match!.bossMode = false; expect(bossAwakeningLevel(world)).toBe(0);
    world.options.match!.bossMode = true; world.options.mode = 'tutorial'; expect(bossAwakeningLevel(world)).toBe(0);
    expect(bossAwakeningLevel(null)).toBe(0);
    const next = fixture(); next.effigyRevealedAt = 180; next.time = 181;
    expect(bossAwakeningLevel(next)).toBe(1);
  });
});
