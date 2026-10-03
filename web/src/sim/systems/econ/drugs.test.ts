import { describe, expect, it } from 'vitest';
import { BREW_COST, BREW_TIME, DRUG } from '../../constants';
import { spawnBuilding } from '../../factory';
import { registerBuildingShape } from '../buildings';
import { brewBlocker, falseFlags, isDrugActive } from '../drugs';
import { hasEffect } from '../effects';
import { eventsOf, freeThickFacet, newMatch, run } from './testkit';

describe('drugs', () => {
  it('Saffron speeds the whole camp and pours Ritual, then crashes it', () => {
    const h = newMatch();
    const { world } = h;
    const fac = world.factions[0];
    fac.drugs.saffron = 1;
    const own = world.hippiesOf(0);
    expect(own.length).toBeGreaterThan(0);

    world.submit({ t: 'drug', faction: 0, drug: 'saffron' });
    run(h, 1 / 60);
    expect(eventsOf(h, 'drugUsed')).toEqual([{ t: 'drugUsed', faction: 0, drug: 'saffron' }]);
    expect(fac.drugs.saffron).toBe(0);
    expect(isDrugActive(world, 0, 'saffron')).toBe(true);
    for (const hp of own) expect(hasEffect(world, hp, 'saffron')).toBe(true);
    const ritual0 = fac.ritual;
    run(h, 1);
    expect(fac.ritual - ritual0).toBeGreaterThanOrEqual(DRUG.saffronRitualPerSec * 0.99);

    // Taking it again while active is refused.
    fac.drugs.saffron = 1;
    world.submit({ t: 'drug', faction: 0, drug: 'saffron' });
    run(h, DRUG.duration.saffron - 1 + 0.1);
    expect(eventsOf(h, 'rejected').some((e) => e.faction === 0)).toBe(true);
    expect(eventsOf(h, 'drugExpired')).toEqual([{ t: 'drugExpired', faction: 0, drug: 'saffron' }]);
    expect(fac.saffronCrashUntil).toBeGreaterThan(world.time + DRUG.crashTime - 1);
    for (const hp of world.hippiesOf(0)) {
      expect(hasEffect(world, hp, 'saffron')).toBe(false);
      expect(hasEffect(world, hp, 'crash')).toBe(true);
    }
    run(h, DRUG.crashTime);
    for (const hp of world.hippiesOf(0)) expect(hasEffect(world, hp, 'crash')).toBe(false);
  });

  it('a Drug Lab brews a queued dose for BREW_COST lumber in BREW_TIME', () => {
    const h = newMatch();
    const { world } = h;
    const hearth = world.hearthOf(0)!;
    const lab = spawnBuilding(world, 'druglab', 0, freeThickFacet(world, hearth.pos.x, hearth.pos.z, 12, 'druglab'), 1);
    registerBuildingShape(world, lab);
    const fac = world.factions[0];
    fac.lumber = BREW_COST;
    world.submit({ t: 'brew', faction: 0, labId: lab.id, drug: 'dust' });
    run(h, 1 / 60);
    expect(lab.lab!.brewing).toBe('dust');
    expect(fac.lumber).toBeLessThan(BREW_COST);
    run(h, BREW_TIME);
    expect(fac.drugs.dust).toBe(1);
    expect(eventsOf(h, 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug: 'dust' }]);
    expect(brewBlocker(world, 1, lab.id, 'dust')).toBe('That Drug Lab is not yours.');
  });

  it('Luminous Dust conjures a few False Flags on empty nodes; Acid Cop Vision taps every rival mesh', () => {
    const h = newMatch();
    const { world } = h;
    const fac = world.factions[0];
    fac.drugs.dust = 1;
    fac.drugs.acidcop = 1;
    world.submit({ t: 'drug', faction: 0, drug: 'dust' });
    world.submit({ t: 'drug', faction: 0, drug: 'acidcop' });
    run(h, 1 / 60);
    const fakes = falseFlags(world, 0);
    expect(fakes.length).toBeGreaterThanOrEqual(DRUG.falseFlagsMin);
    expect(fakes.length).toBeLessThanOrEqual(DRUG.falseFlagsMax);
    for (const n of fakes) expect(world.survey.nodeFlag[n]).toBe(-1);
    for (const r of [1, 2, 3] as const) expect(fac.meshTap[r]).toBeCloseTo(world.time + DRUG.duration.acidcop, 5);
    run(h, DRUG.duration.dust + 0.1);
    expect(falseFlags(world, 0)).toHaveLength(0);
  });
});
