import { describe, expect, it } from 'vitest';
import { BURN_TIME } from '../../sim/constants';
import type { GroundType, MapLayout } from '../../sim/map/mapgen';
import { bakeGroundTypes } from './ground';
import { terrainHeight } from './terrain';
import { ATTRACT_CLOCK, computeDayState, createDayState } from './timeOfDay';

describe('time of day', () => {
  it('runs golden afternoon → night, darkening monotonically, deep night at The Burn', () => {
    const day = createDayState();
    let last = Infinity;
    for (let t = 0; t <= BURN_TIME + 120; t += 10) {
      computeDayState(t, day);
      expect(day.daylight).toBeLessThanOrEqual(last + 1e-9);
      last = day.daylight;
    }
    computeDayState(0, day);
    expect(day.daylight).toBe(1);
    expect(day.sunDir.y).toBeGreaterThan(0.3);
    computeDayState(BURN_TIME, day);
    expect(day.daylight).toBe(0);
    expect(day.night).toBe(1);
    expect(day.sunDir.y).toBeLessThan(0);
  });

  it('keeps the shadow light above the horizon and a lit, sunny title screen', () => {
    const day = createDayState();
    for (let t = 0; t <= BURN_TIME + 120; t += 5) {
      computeDayState(t, day);
      expect(day.lightDir.y).toBeGreaterThan(0.15);
      expect(Math.abs(day.lightDir.length() - 1)).toBeLessThan(1e-9);
    }
    computeDayState(ATTRACT_CLOCK, day);
    expect(day.sunDir.y).toBeGreaterThan(0.1);
    expect(day.lightIntensity).toBeGreaterThan(2);
    expect(day.night).toBeLessThan(0.01);
  });
});

describe('terrain relief', () => {
  it('is exactly flat across the playable map (edges included), rising only beyond', () => {
    const half = 150;
    for (let x = -half - 4; x <= half + 4; x += 2) {
      for (let z = -half - 4; z <= half + 4; z += 2) expect(terrainHeight(x, z, half)).toBe(0);
    }
    expect(terrainHeight(half + 12, 0, half)).toBe(0);
    expect(terrainHeight(half + 120, 0, half)).toBeGreaterThan(5);
    expect(terrainHeight(-(half + 120), half + 120, half)).toBeGreaterThan(5);
  });
});

describe('ground type bake', () => {
  /** Quadrant map: road for x > 0, water for z > 0 (water wins), grass elsewhere. */
  function quadrantMap(): MapLayout {
    const groundAt = (x: number, z: number): GroundType => (z > 0 ? 'water' : x > 0 ? 'road' : 'grass');
    return {
      seed: 't',
      half: 100,
      camps: [],
      obstacles: [],
      roads: [],
      water: [],
      mud: [],
      soundCamps: [],
      pileSpots: [],
      neutralSpawns: [],
      effigy: { x: 0, z: 0 },
      isBlockedAt: () => false,
      groundAt,
    };
  }

  it('maps texel columns to world x and rows to world z, one channel per surface type', () => {
    const n = 64;
    const data = bakeGroundTypes(quadrantMap(), n);
    const texel = (col: number, row: number) => data.subarray((row * n + col) * 4, (row * n + col) * 4 + 4);
    // Row 8 is at negative z (land), column 56 at positive x → road (G).
    expect(Array.from(texel(56, 8))).toEqual([0, 255, 0, 0]);
    // Column 8 at negative x, row 8 → plain grass: all channels empty.
    expect(Array.from(texel(8, 8))).toEqual([0, 0, 0, 0]);
    // Row 56 at positive z → water (A) on both sides.
    expect(texel(8, 56)[3]).toBe(255);
    expect(texel(56, 56)[3]).toBe(255);
    // Boundaries are blurred, never exceeding a full weight in total.
    for (let i = 0; i < n * n; i++) {
      const sum = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + data[i * 4 + 3];
      expect(sum).toBeLessThanOrEqual(256);
    }
    expect(texel(32, 8)[1]).toBeGreaterThan(0);
    expect(texel(32, 8)[1]).toBeLessThan(255);
  });
});
