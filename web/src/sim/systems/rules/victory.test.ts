import { describe, expect, it } from 'vitest';
import {
  BURN_TIME,
  DAWN_TIME,
  DAWN_WARNING,
  SUDDEN_DEATH_ESCALATE_EVERY,
  SUDDEN_DEATH_PRESSURE_MULT,
  TIDE_INTERVAL_SUDDEN_DEATH,
} from '../../constants';
import type { GameEvent } from '../../events';
import type { World } from '../../world';
import { captureHearth } from '../capture';
import { depositToStock } from '../flags';
import { dominanceOrder, suddenDeathMult } from '../victory';
import { isFactionId } from './factions';
import { eventsOf, flagProblems, freeFocus, loopAround, must, newMatch, plantFresh, runRules } from './testWorld';

/** Jump the clock to `t` (skipping the match in between) and run one second of rules there. */
function runAt(world: World, t: number): GameEvent[] {
  world.time = t;
  const events = runRules(world, 1);
  // Jumping past BURN_TIME starts The Burn, which schedules a tide: keep the Crystal still.
  world.tide.nextAt = Infinity;
  return events;
}

function dawnWarnings(events: GameEvent[]): string[] {
  return eventsOf(events, 'notify')
    .filter((n) => n.faction === 'all' && n.text.startsWith('One minute to dawn'))
    .map((n) => n.text);
}

/** Strip every camp's planted Flags into its stock: every Survey (and so every C.M.I.) is empty. */
function stripRings(world: World): void {
  for (const fl of [...world.flags.values()]) {
    if (fl.state !== 'planted' || !isFactionId(fl.owner)) continue;
    depositToStock(world, fl.id, must(world.hearthOf(fl.owner), 'hearth').id);
  }
}

describe('The Burn', () => {
  it('starts sudden death at BURN_TIME, quickens the tides and escalates on a clock', () => {
    const world = newMatch('burn-a');
    world.time = BURN_TIME - 0.5;
    world.tide.nextAt = world.time + 70;
    expect(suddenDeathMult(world)).toBe(1);
    let events = runRules(world, 1);
    expect(eventsOf(events, 'burn')).toHaveLength(1);
    expect(world.suddenDeath).toBe(true);
    expect(world.tide.nextAt).toBeLessThanOrEqual(world.time + TIDE_INTERVAL_SUDDEN_DEATH);
    expect(suddenDeathMult(world)).toBe(SUDDEN_DEATH_PRESSURE_MULT);
    const rages = (evs: GameEvent[]): string[] =>
      eventsOf(evs, 'notify')
        .filter((n) => n.faction === 'all' && n.severity === 'epic' && n.text.startsWith('The Burn rages'))
        .map((n) => n.text);
    expect(rages(events)).toEqual([]);
    world.tide.nextAt = Infinity;
    events = runRules(world, 1);
    expect(eventsOf(events, 'burn')).toHaveLength(0);

    // Each SUDDEN_DEATH_ESCALATE_EVERY seconds the multiplier steps up by one, announced once.
    for (let step = 1; step <= 2; step++) {
      world.time = BURN_TIME + step * SUDDEN_DEATH_ESCALATE_EVERY - 0.5;
      expect(suddenDeathMult(world)).toBe(SUDDEN_DEATH_PRESSURE_MULT + step - 1);
      events = runRules(world, 1);
      expect(suddenDeathMult(world)).toBe(SUDDEN_DEATH_PRESSURE_MULT + step);
      expect(rages(events)).toEqual([`The Burn rages: Surveys overwrite ×${SUDDEN_DEATH_PRESSURE_MULT + step}.`]);
      expect(rages(runRules(world, 1))).toEqual([]);
    }
  });
});

describe('Victory', () => {
  it('the last faction holding a Hearth wins by conquest', () => {
    const world = newMatch('victory-a');
    world.tide.nextAt = Infinity;
    captureHearth(world, must(world.hearthOf(1), 'hearth 1'), 2);
    captureHearth(world, must(world.hearthOf(3), 'hearth 3'), 2);
    runRules(world, 0.05);
    expect(world.phase).toBe('playing');
    captureHearth(world, must(world.hearthOf(0), 'hearth 0'), 2);
    const events = runRules(world, 0.05);
    expect(world.time).toBeLessThan(DAWN_TIME);
    expect(world.phase).toBe('ended');
    expect(world.winner).toBe(2);
    expect(eventsOf(events, 'victory')).toEqual([{ t: 'victory', faction: 2, reason: 'conquest' }]);
    expect(world.factions[2].hearthIds).toHaveLength(4);
    expect(flagProblems(world)).toEqual([]);
  });

  it('Dawn crowns the camp holding the most Hearths, warned a minute ahead, eliminating nobody', () => {
    const world = newMatch('dawn-a');
    world.tide.nextAt = Infinity;
    // Dr. Crow overwrites President Jaguar before dawn: two Hearths to everyone else's one.
    captureHearth(world, must(world.hearthOf(3), 'hearth 3'), 1);
    // DJ Scarecrow holds by far the largest Survey, but Hearths are counted first.
    loopAround(world, 2, 0, 70, 20);
    runRules(world, 0.1);
    const size = world.survey.surveySize;
    expect(size[2]).toBeGreaterThan(Math.max(size[0], size[1]));
    expect(dominanceOrder(world)).toEqual([1, 2, 0]);

    let events = runAt(world, DAWN_TIME - DAWN_WARNING - 0.5);
    expect(dawnWarnings(events)).toHaveLength(1);
    expect(dawnWarnings(runRules(world, 1))).toEqual([]);
    expect(world.phase).toBe('playing');

    events = runAt(world, DAWN_TIME - 0.5);
    expect(world.phase).toBe('ended');
    expect(world.winner).toBe(1);
    expect(eventsOf(events, 'victory')).toEqual([{ t: 'victory', faction: 1, reason: 'dawn' }]);
    expect(eventsOf(events, 'eliminated')).toEqual([]);
    expect(world.factions.filter((f) => f.alive).map((f) => f.id)).toEqual([0, 1, 2]);
    const crowning = eventsOf(events, 'notify').filter((n) => n.faction === 'all' && n.text.startsWith('Dawn breaks'));
    expect(crowning).toHaveLength(1);
    expect(crowning[0].severity).toBe('epic');
    expect(crowning[0].text).toContain(world.factions[1].name);
    expect(dawnWarnings(events)).toEqual([]);
    expect(flagProblems(world)).toEqual([]);
  });

  it('Dawn breaks a tie on Hearths by Survey size, then C.M.I., then the lowest faction id', () => {
    const world = newMatch('dawn-b');
    world.tide.nextAt = Infinity;
    stripRings(world);
    runRules(world, 0.1);
    // One Hearth each, no Survey, no C.M.I.: everything ties and the lowest id leads.
    expect([...world.survey.surveySize]).toEqual([0, 0, 0, 0]);
    expect(world.factions.map((f) => f.stats.cmi)).toEqual([0, 0, 0, 0]);
    expect(dominanceOrder(world)).toEqual([0, 1, 2, 3]);

    // A Crystal for President Jaguar: the Surveys still tie, so C.M.I. decides.
    plantFresh(world, 3, world.lattice.neighbors(freeFocus(world, 3)));
    runRules(world, 0.1);
    expect(world.crystals.size).toBe(1);
    expect([...world.survey.surveySize]).toEqual([0, 0, 0, 0]);
    expect(world.factions[3].stats.cmi).toBeGreaterThan(0);
    expect(dominanceOrder(world)).toEqual([3, 0, 1, 2]);

    // Any Survey at all outranks a C.M.I. lead: DJ Scarecrow encloses a little ground.
    loopAround(world, 2, 0, 70, 8);
    runRules(world, 0.1);
    expect(world.survey.surveySize[2]).toBeGreaterThan(0);
    expect(world.factions[2].stats.cmi).toBeLessThan(world.factions[3].stats.cmi);
    expect(dominanceOrder(world)).toEqual([2, 3, 0, 1]);

    const events = runAt(world, DAWN_TIME - 0.5);
    expect(world.winner).toBe(2);
    expect(eventsOf(events, 'victory')).toEqual([{ t: 'victory', faction: 2, reason: 'dawn' }]);
    expect(eventsOf(events, 'eliminated')).toEqual([]);
    expect(world.factions.every((f) => f.alive)).toBe(true);
  });
});
