import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREW_COST, BREW_TIME, BUILD_TIME, BUILDING_REPAIR_HPS, DRUG_MAX, SIM_DT } from '../../constants';
import { spawnBuilding } from '../../factory';
import { DRUGS } from '../../types';
import type { DrugId } from '../../types';
import { damageBuilding, registerBuildingShape, repairBuilding, updateBuildings } from '../buildings';
import { consumeBuilding } from '../boss';
import { cmdBrew, cmdDrug, dosesOwnedOrPending, pickAutoBrew } from '../drugs';
import { dismissHippies, freeThickFacet, newMatch, parkAvatarAway, run } from './testkit';

afterEach(() => vi.restoreAllMocks());

function scenario(seed = 'automatic-drug-labs') {
  const h = newMatch(seed);
  const { world } = h;
  dismissHippies(world, 0);
  parkAvatarAway(world, 0);
  const hearth = world.hearthOf(0)!;
  const addLab = (built = 1) => {
    const b = spawnBuilding(world, 'druglab', 0,
      freeThickFacet(world, hearth.pos.x, hearth.pos.z, 12, 'druglab'), built);
    registerBuildingShape(world, b);
    return b;
  };
  const building = addLab();
  const fac = world.factions[0];
  fac.lumber = BREW_COST * 20;
  world.drainEvents();
  return { ...h, building, lab: building.lab!, fac, addLab };
}

describe('automatic Drug Lab production', () => {
  it('starts without orders or workers in a real simulation and charges the normal cost once', () => {
    const h = scenario();
    h.fac.lumber = BREW_COST;
    run(h, SIM_DT);
    const drug = h.lab.brewing!;
    expect(DRUGS).toContain(drug);
    expect(h.lab.queue).toEqual([]);
    expect(h.fac.lumber).toBe(0);
    run(h, BREW_TIME - SIM_DT * 2);
    expect(h.fac.drugs[drug]).toBe(0);
    run(h, SIM_DT * 2);
    expect(h.fac.drugs[drug]).toBe(1);
    expect(h.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug }]);
    expect(h.fac.lumber).toBe(0);
    expect(h.lab.brewing).toBeNull();
  });

  it('uses exact inverse-stock weights while allowing every non-full drug', () => {
    const { world, fac } = scenario();
    fac.drugs = { saffron: 0, dust: 1, acidcop: 2 };
    // Weights 1, 1/2, 1/3 normalize to probabilities 6/11, 3/11, 2/11.
    const rng = vi.spyOn(world.rng, 'next');
    for (const [roll, expected] of [[0, 'saffron'], [6 / 11 - 1e-6, 'saffron'],
      [6 / 11 + 1e-6, 'dust'], [9 / 11 - 1e-6, 'dust'],
      [9 / 11 + 1e-6, 'acidcop'], [0.999999, 'acidcop']] as const) {
      rng.mockReturnValue(roll);
      expect(pickAutoBrew(world, 0)).toBe(expected);
    }
  });

  it('counts queued and brewing doses across the faction in its weights', () => {
    const { world, lab, addLab } = scenario();
    lab.queue.push('dust');
    const other = addLab().lab!;
    other.brewing = 'acidcop';
    other.queue.push('acidcop');
    // Same 0/1/2 holdings as above, despite empty shelves.
    vi.spyOn(world.rng, 'next').mockReturnValue(0.6);
    expect(pickAutoBrew(world, 0)).toBe('dust');
    const rival = addLab();
    rival.faction = 1;
    rival.lab!.queue.push('saffron', 'saffron', 'saffron');
    expect(dosesOwnedOrPending(world, 0, 'saffron')).toBe(0);
  });

  it('replays the same seeded choices in fresh matches and favors scarce stock statistically', () => {
    const sample = () => {
      const { world, fac } = scenario('weighted-brew-replay');
      fac.drugs = { saffron: 0, dust: 1, acidcop: 2 };
      return Array.from({ length: 3000 }, () => pickAutoBrew(world, 0)!);
    };
    const first = sample();
    expect(sample()).toEqual(first);
    const count = (d: DrugId) => first.filter(x => x === d).length;
    expect(count('saffron')).toBeGreaterThan(count('dust') * 1.7);
    expect(count('dust')).toBeGreaterThan(count('acidcop') * 1.2);
    expect(count('acidcop')).toBeGreaterThan(0);
  });

  it('waits without rerolling when lumber is missing, then starts as soon as it is affordable', () => {
    const { world, fac, lab } = scenario();
    fac.lumber = BREW_COST - 1;
    const rng = vi.spyOn(world.rng, 'next');
    updateBuildings(world, BREW_TIME);
    updateBuildings(world, BREW_TIME);
    expect(rng).not.toHaveBeenCalled();
    expect(lab.brewing).toBeNull();
    expect(fac.lumber).toBe(BREW_COST - 1);
    fac.lumber++;
    updateBuildings(world, SIM_DT);
    expect(rng).toHaveBeenCalledTimes(1);
    expect(lab.brewing).not.toBeNull();
    expect(fac.lumber).toBe(0);
    updateBuildings(world, SIM_DT);
    expect(rng).toHaveBeenCalledTimes(1);
  });

  it('full shelves spend nothing and consume no randomness, then restock a consumed dose', () => {
    const { world, fac, lab } = scenario();
    fac.drugs = { saffron: DRUG_MAX, dust: DRUG_MAX, acidcop: DRUG_MAX };
    const lumber = fac.lumber;
    const rng = vi.spyOn(world.rng, 'next');
    updateBuildings(world, BREW_TIME);
    expect(lab.brewing).toBeNull();
    expect(fac.lumber).toBe(lumber);
    expect(rng).not.toHaveBeenCalled();
    cmdDrug(world, { t: 'drug', faction: 0, drug: 'saffron' });
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('saffron');
    expect(fac.lumber).toBe(lumber - BREW_COST);
    expect(fac.drugActive.saffron).toBeGreaterThan(world.time);
  });

  it('reserves the last shelf space across simultaneous labs without wasting lumber', () => {
    const { world, fac, lab, addLab } = scenario();
    fac.drugs = { saffron: DRUG_MAX - 1, dust: DRUG_MAX, acidcop: DRUG_MAX };
    const other = addLab().lab!;
    const lumber = fac.lumber;
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('saffron');
    expect(other.brewing).toBeNull();
    expect(fac.lumber).toBe(lumber - BREW_COST);
    updateBuildings(world, BREW_TIME);
    expect(fac.drugs.saffron).toBe(DRUG_MAX);
    expect(other.brewing).toBeNull();
    expect(fac.lumber).toBe(lumber - BREW_COST);
  });

  it('does not take space reserved by an explicit queue, including a disabled lab', () => {
    const { world, fac, lab, addLab } = scenario();
    fac.drugs = { saffron: DRUG_MAX - 1, dust: DRUG_MAX, acidcop: DRUG_MAX };
    const other = addLab();
    other.lab!.queue.push('saffron');
    damageBuilding(world, other, other.maxHp, -1);
    const lumber = fac.lumber;
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBeNull();
    expect(fac.lumber).toBe(lumber);
    consumeBuilding(world, other, true);
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('saffron');
  });

  it('finishes its current batch, honors FIFO orders, then resumes automatic selection', () => {
    const { world, fac, building, lab } = scenario();
    const rng = vi.spyOn(world.rng, 'next').mockReturnValue(0);
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('saffron');
    const progress = lab.progress;
    for (const drug of ['dust', 'acidcop'] as const) cmdBrew(world, { t: 'brew', faction: 0, labId: building.id, drug });
    expect(lab.brewing).toBe('saffron');
    expect(lab.progress).toBe(progress);
    updateBuildings(world, BREW_TIME);
    expect(fac.drugs.saffron).toBe(1);
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('dust');
    expect(rng).toHaveBeenCalledTimes(1);
    updateBuildings(world, BREW_TIME);
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('acidcop');
    expect(rng).toHaveBeenCalledTimes(1);
    updateBuildings(world, BREW_TIME);
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBe('saffron');
    expect(lab.queue).toEqual([]);
    expect(rng).toHaveBeenCalledTimes(2);
  });

  it('gives a later lab explicit-order priority over the last affordable dose', () => {
    const { world, fac, lab, addLab } = scenario();
    const other = addLab();
    fac.lumber = BREW_COST;
    cmdBrew(world, { t: 'brew', faction: 0, labId: other.id, drug: 'acidcop' });
    const rng = vi.spyOn(world.rng, 'next');
    updateBuildings(world, SIM_DT);
    expect(lab.brewing).toBeNull();
    expect(other.lab!.brewing).toBe('acidcop');
    expect(fac.lumber).toBe(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it('drops now-full stale orders unpaid before automatic production selects another drug', () => {
    const { world, fac, lab } = scenario();
    lab.queue.push('dust');
    fac.drugs.dust = DRUG_MAX;
    vi.spyOn(world.rng, 'next').mockReturnValue(0);
    const lumber = fac.lumber;
    updateBuildings(world, SIM_DT);
    expect(lab.queue).toEqual([]);
    expect(lab.brewing).toBe('saffron');
    expect(fac.lumber).toBe(lumber - BREW_COST);
  });

  it('prioritizes an explicit order in a later lab that completes repair this tick', () => {
    const { world, fac, lab, addLab } = scenario();
    const ordered = addLab();
    cmdBrew(world, { t: 'brew', faction: 0, labId: ordered.id, drug: 'dust' });
    damageBuilding(world, ordered, ordered.maxHp, -1);
    ordered.hp = ordered.maxHp - BUILDING_REPAIR_HPS * SIM_DT / 2;
    world.avatarOf(0).pos = { ...ordered.pos, y: 0 };
    fac.lumber = BREW_COST;
    updateBuildings(world, SIM_DT);
    expect(ordered.disabled).toBe(false);
    expect(ordered.lab!.brewing).toBe('dust');
    expect(lab.brewing).toBeNull();
    expect(fac.lumber).toBe(0);
  });

  it('waits for construction, pauses while disabled, and resumes the paid batch after repair', () => {
    const { world, fac, building, lab } = scenario();
    building.built = 0;
    const lumber = fac.lumber;
    updateBuildings(world, BUILD_TIME / 2);
    expect(lab.brewing).toBeNull();
    expect(fac.lumber).toBe(lumber);
    updateBuildings(world, BUILD_TIME / 2);
    expect(building.built).toBe(1);
    expect(lab.brewing).not.toBeNull();
    const progress = lab.progress;
    damageBuilding(world, building, building.maxHp, -1);
    updateBuildings(world, BREW_TIME);
    expect(lab.progress).toBe(progress);
    expect(fac.lumber).toBe(lumber - BREW_COST);
    repairBuilding(world, building, building.maxHp);
    updateBuildings(world, BREW_TIME);
    expect(DRUGS.reduce((n, d) => n + fac.drugs[d], 0)).toBe(1);
    expect(fac.lumber).toBe(lumber - BREW_COST);
  });

  it('neutral, removed, and defeated labs never start or spend', () => {
    const { world, fac, building, lab } = scenario();
    const lumber = fac.lumber;
    const rng = vi.spyOn(world.rng, 'next');
    building.faction = -1;
    updateBuildings(world, BREW_TIME);
    expect(lab.brewing).toBeNull();
    building.faction = 0;
    fac.alive = false;
    updateBuildings(world, BREW_TIME);
    expect(lab.brewing).toBeNull();
    fac.alive = true;
    consumeBuilding(world, building, true);
    updateBuildings(world, BREW_TIME);
    expect(fac.lumber).toBe(lumber);
    expect(rng).not.toHaveBeenCalled();
  });

  it('fills all capped shelves and spends only nine dose costs across multiple labs', () => {
    const { world, fac, addLab } = scenario();
    addLab();
    addLab();
    const lumber = fac.lumber;
    for (let i = 0; i < 15; i++) updateBuildings(world, BREW_TIME);
    expect(fac.drugs).toEqual({ saffron: DRUG_MAX, dust: DRUG_MAX, acidcop: DRUG_MAX });
    expect(fac.lumber).toBe(lumber - DRUGS.length * DRUG_MAX * BREW_COST);
    for (const d of DRUGS) expect(dosesOwnedOrPending(world, 0, d)).toBe(DRUG_MAX);
  });
});
