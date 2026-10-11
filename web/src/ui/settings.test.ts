import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../game/session';
import { loadSettings, saveSettings } from './settings';
import { DEFAULT_MATCH, UNLIMITED_DAYS, normalizeMatch } from '../sim/matchSettings';

afterEach(() => vi.unstubAllGlobals());

function storage(initial: object) {
  let value = JSON.stringify(initial);
  vi.stubGlobal('localStorage', {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  });
}

describe('independent look inversion preferences', () => {
  it('migrates the old invert Y setting to the mouse while preserving the gamepad preference', () => {
    storage({ invertY: true, controls: { invertPadY: false } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.invertMouseY).toBe(true);
    expect(settings.controls.invertPadY).toBe(false);
  });

  it('prefers the explicit mouse setting over a legacy value', () => {
    storage({ invertY: true, invertMouseY: false, controls: { invertPadY: true } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.invertMouseY).toBe(false);
    expect(settings.controls.invertPadY).toBe(true);
  });

  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])('persists mouse %s and gamepad %s independently', (mouse, gamepad) => {
    storage({});
    const settings = new Session().settings;
    settings.invertMouseY = mouse;
    settings.controls.invertPadY = gamepad;
    saveSettings(settings);
    const restored = new Session().settings;
    loadSettings(restored);
    expect(restored.invertMouseY).toBe(mouse);
    expect(restored.controls.invertPadY).toBe(gamepad);
  });
});

describe('persisted match duration', () => {
  it('migrates the former zero-days Unlimited setting without changing other settings', () => {
    storage({ match: { ...DEFAULT_MATCH, days: 0, bossMode: false, dayLength: 600 }, masterVolume: 0.4 });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.match).toEqual({ ...DEFAULT_MATCH, days: UNLIMITED_DAYS, bossMode: false, dayLength: 600 });
    expect(settings.masterVolume).toBe(0.4);
    saveSettings(settings);
    const restored = new Session().settings;
    loadSettings(restored);
    expect(restored.match).toEqual(settings.match);
  });

  it.each([UNLIMITED_DAYS, 0, 1, 5])('round-trips explicit day setting %s without reapplying the legacy migration', (days) => {
    storage({});
    const settings = new Session().settings;
    settings.match = normalizeMatch({ days, dayLength: 600 });
    saveSettings(settings);
    const restored = new Session().settings;
    loadSettings(restored);
    expect(restored.match).toEqual(settings.match);
    saveSettings(restored);
    const again = new Session().settings;
    loadSettings(again);
    expect(again.match.days).toBe(days);
  });

  it('keeps finite legacy day settings and falls back safely for malformed saved matches', () => {
    storage({ match: { ...DEFAULT_MATCH, days: 3 } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.match.days).toBe(3);
    storage({ match: null });
    loadSettings(settings);
    expect(settings.match).toEqual(DEFAULT_MATCH);
  });
});

describe('persisted boss health', () => {
  it('uses 50,000 HP for old settings while preserving the existing Unlimited migration', () => {
    storage({ match: { days: 0, bossMode: true, dayLength: 600 } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.match).toMatchObject({ days: UNLIMITED_DAYS, bossHp: 50000, dayLength: 600 });
  });

  it.each([100, 12345, 50000, 1000000])('round-trips boss HP %s and the explicit zero-day start', (bossHp) => {
    storage({});
    const settings = new Session().settings;
    settings.match = normalizeMatch({ days: 0, bossHp });
    saveSettings(settings);
    const restored = new Session().settings;
    loadSettings(restored);
    expect(restored.match).toEqual(settings.match);
  });

  it.each([[0, 100], [1000001, 1000000], [55000.9, 55000], [null, 50000]])('normalizes invalid persisted boss HP %s to %s', (bossHp, expected) => {
    storage({ match: { bossHp } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.match.bossHp).toBe(expected);
  });
});


describe('persisted Flag hoarding threshold', () => {
  it('defaults old saves and round-trips the configured base', () => {
    storage({ version: 2, match: { days: 1 } });
    const settings = new Session().settings;
    loadSettings(settings);
    expect(settings.match.hoardThreshold).toBe(24);
    settings.match.hoardThreshold = 75;
    saveSettings(settings);
    const restored = new Session().settings;
    loadSettings(restored);
    expect(restored.match.hoardThreshold).toBe(75);
  });
  it.each([[NaN, 24], [Infinity, 24], [-1, 0], [1001, 1000], [17.8, 17]])('normalizes base %s to %s', (input, expected) => {
    expect(normalizeMatch({ hoardThreshold: input }).hoardThreshold).toBe(expected);
  });
});
