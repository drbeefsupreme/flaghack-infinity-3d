import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../boss';
import { normalizeMatch } from '../matchSettings';
import { createMatch } from '../setup';
import type { FactionId } from '../types';
import { captureHearth, updateCapture } from './capture';
import { consumeBuilding, updateBoss } from './boss';
import { eliminateByBoss, updateVictory } from './victory';

function setup(humans: FactionId[] = [0, 1]) {
  const world = createMatch({ seed: 'boss-outcome', difficulty: 'normal', mode: 'standard', humans,
    match: normalizeMatch({ maxSignifiers: 0 }) });
  world.effigyRevealedAt = 230;
  world.boss = bossFixture();
  world.time = 250;
  return world;
}

function consumeLastAltar(w: ReturnType<typeof setup>, faction: FactionId) {
  for (const id of w.factions[faction].hearthIds) w.buildings.delete(id);
  w.factions[faction].hearthIds = [];
  eliminateByBoss(w, faction);
}

describe('boss outcome rules', () => {
  it('waits the full death animation, then awards every surviving camp together only once', () => {
    const w = setup();
    consumeLastAltar(w, 2);
    w.boss!.hp = 0;
    w.boss!.action = 'death';
    w.boss!.deathAt = w.time;
    w.time += BOSS_DEATH_DURATION - 0.01;
    updateVictory(w, 0);
    expect(w.phase).toBe('playing');
    expect(w.bossOutcome).toBeNull();
    w.boss!.action = 'dead';
    updateVictory(w, 0);
    expect(w.phase).toBe('playing');
    w.time += 0.01;
    updateVictory(w, 0);
    expect(w.phase).toBe('ended');
    expect(w.winner).toBeNull();
    expect(w.bossOutcome).toEqual({ kind: 'victory', winners: [0, 1, 3], at: w.time });
    expect(w.drainEvents().filter((e) => e.t === 'bossEnded')).toHaveLength(1);
    updateVictory(w, 0);
    expect(w.drainEvents()).toEqual([]);
  });

  it('accepts the real boss death transition only after its complete host-owned timeline', () => {
    const w = setup();
    w.boss!.hp = 0;
    updateBoss(w, 1 / 60);
    expect(w.boss!.action).toBe('death');
    expect(w.boss!.deathAt).toBe(w.time);
    w.time += BOSS_DEATH_DURATION - 0.01;
    updateBoss(w, 1 / 60);
    updateVictory(w, 1 / 60);
    expect(w.phase).toBe('playing');
    w.time += 0.02;
    updateBoss(w, 1 / 60);
    updateVictory(w, 1 / 60);
    expect(w.boss!.action).toBe('dead');
    expect(w.bossOutcome?.winners).toEqual([0, 1, 2, 3]);
  });

  it('explicitly loses when all human camps fall even if NPC allies survive', () => {
    const w = setup();
    consumeLastAltar(w, 0);
    updateVictory(w, 0);
    expect(w.bossOutcome).toBeNull();
    consumeLastAltar(w, 1);
    updateVictory(w, 0);
    expect(w.bossOutcome).toEqual({ kind: 'defeat', winners: [], at: w.time });
    expect(w.phase).toBe('ended');
    expect(w.factions[3].alive).toBe(true);
  });

  it('uses all active factions for an AI-only match and suppresses conquest and Dawn', () => {
    const w = setup([]);
    for (const id of [0, 1, 2] as const) consumeLastAltar(w, id);
    w.time = 10000;
    updateVictory(w, 0);
    expect(w.phase).toBe('playing');
    expect(w.winner).toBeNull();
    expect(w.drainEvents().some((e) => e.t === 'victory')).toBe(false);
    consumeLastAltar(w, 3);
    updateVictory(w, 0);
    expect(w.bossOutcome?.kind).toBe('defeat');
  });
});

describe('all owned altars define survival', () => {
  it('losing the original altar preserves a captured outpost as home; only the last altar loss eliminates', () => {
    const w = setup();
    w.effigyRevealedAt = null;
    w.boss = null;
    const original = w.hearthOf(0)!;
    const outpost = w.hearthOf(1)!;
    captureHearth(w, outpost, 0);
    captureHearth(w, original, 2);
    expect(w.factions[0].alive).toBe(true);
    expect(w.hearthOf(0)?.id).toBe(outpost.id);
    expect(w.factions[0].hearthIds).toEqual([outpost.id]);
    captureHearth(w, outpost, 2);
    expect(w.factions[0].alive).toBe(false);
    expect(w.factions[0].hearthIds).toEqual([]);
  });

  it('consuming the original altar preserves a captured one; consuming the final altar eliminates', () => {
    const w = setup();
    w.effigyRevealedAt = null;
    const original = w.hearthOf(0)!;
    const outpost = w.hearthOf(1)!;
    captureHearth(w, outpost, 0);
    w.effigyRevealedAt = 230;
    consumeBuilding(w, original);
    expect(w.factions[0].alive).toBe(true);
    expect(w.hearthOf(0)?.id).toBe(outpost.id);
    consumeBuilding(w, outpost);
    expect(w.factions[0].alive).toBe(false);
    expect(w.factions[0].hearthIds).toEqual([]);
    expect(w.drainEvents().filter((e) => e.t === 'eliminated' && e.faction === 0)).toEqual([
      { t: 'eliminated', faction: 0, by: null, cause: 'boss' },
    ]);
  });

  it('boss elimination refuses while any owned altar remains', () => {
    const w = setup();
    eliminateByBoss(w, 0);
    expect(w.factions[0].alive).toBe(true);
    consumeLastAltar(w, 0);
    expect(w.factions[0].alive).toBe(false);
  });

  it('clears pending rival overwrites at reveal and blocks direct PvP altar capture', () => {
    const w = setup();
    const h = w.hearthOf(0)!;
    h.hearth!.stage = 'overwritten';
    h.hearth!.attacker = 1;
    h.hearth!.pressure[1] = 100;
    h.hearth!.overwriteAt = w.time - 1;
    updateCapture(w, 1);
    captureHearth(w, h, 1);
    expect(h.faction).toBe(0);
    expect(h.hearth!.stage).toBe('safe');
    expect(h.hearth!.attacker).toBeNull();
    expect(h.hearth!.pressure[1]).toBe(0);
    expect(w.factions[0].alive).toBe(true);
  });
});
