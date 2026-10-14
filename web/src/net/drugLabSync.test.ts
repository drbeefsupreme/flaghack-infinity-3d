import { describe, expect, it, vi } from 'vitest';
import { BREW_COST, BREW_TIME, BUILD_TIME, DRUG_MAX } from '../sim/constants';
import { spawnBuilding } from '../sim/factory';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { registerBuildingShape, repairBuilding, updateBuildings } from '../sim/systems/buildings';
import { captureHearth } from '../sim/systems/capture';
import { cmdBrew } from '../sim/systems/drugs';
import { DRUGS } from '../sim/types';
import type { DrugId, FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { CODECS, encodeRow, FACTION_FIELDS } from './schema';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture() {
  const host = createMatch({ seed: 'idle-drug-lab-sync', difficulty: 'normal', mode: 'standard', humans: [0, 1],
    match: normalizeMatch({ maxSignifiers: 0 }) });
  // Keep construction and disabled-lab repair independent of nearby helpers.
  for (const av of host.avatars.values()) av.pos = { x: -1000, y: 0, z: -1000 };
  for (const h of host.hippies.values()) h.pos = { x: -1000, z: -1000 };
  for (const f of host.factions) {
    f.lumber = 10 * BREW_COST;
    f.drugs = { saffron: 0, dust: 0, acidcop: 0 };
  }
  const facets = host.lattice.facets.filter(f => !f.boundary &&
    !host.collision.blockedCircle(f.cx, f.cz, 3, .1, 10));
  expect(facets.length).toBeGreaterThan(4);
  let next = 0;
  const lab = (built = 1, faction: FactionId = 0) => {
    const b = spawnBuilding(host, 'druglab', faction, facets[next++].id, built);
    registerBuildingShape(host, b);
    return b;
  };
  return { host, lab };
}

function replicas(host: World) {
  host.drainEvents();
  const encoder = new SnapshotEncoder(host);
  const peer = () => {
    const mirror = NetMirror.create(host.options, wire(encoder.full()));
    // Map generation uses the seeded RNG; snapshot/frame playback must never roll a brew.
    const random = vi.spyOn(mirror.world.rng, 'next');
    expect(mirror.world.drainEvents()).toEqual([]);
    return { mirror, random };
  };
  const peers = [peer(), peer()];
  const assertState = (world: World) => {
    expect([...world.buildings.keys()]).toEqual([...host.buildings.keys()]);
    for (const b of host.buildings.values()) {
      expect(CODECS.buildings.row(world, b.id)).toEqual(CODECS.buildings.row(host, b.id));
    }
    for (const f of host.factions) {
      expect(encodeRow(FACTION_FIELDS, world.factions[f.id], world)).toEqual(encodeRow(FACTION_FIELDS, f, host));
    }
  };
  const lateJoin = () => {
    const joined = peer();
    assertState(joined.mirror.world);
    peers.push(joined);
    return joined.mirror.world;
  };
  const flush = () => {
    host.tick++;
    const events = host.drainEvents();
    const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta(events), events });
    for (const { mirror, random } of peers) {
      mirror.push(frame);
      mirror.catchUp();
      expect(mirror.world.drainEvents()).toEqual(frame.events);
      assertState(mirror.world);
      // Duplicate transport deliveries must neither spend lumber nor award another dose/event.
      mirror.push(frame);
      mirror.catchUp();
      expect(mirror.world.drainEvents()).toEqual([]);
      assertState(mirror.world);
      expect(random).not.toHaveBeenCalled();
    }
    return frame;
  };
  const step = (dt: number) => {
    host.time += dt;
    updateBuildings(host, dt);
    return flush();
  };
  return { step, flush, lateJoin };
}

describe('automatic Drug Lab replication', () => {
  it('replicates idle selection, paid progress and completion without client-side rerolls or duplicate doses', () => {
    const { host, lab } = fixture();
    const b = lab();
    const { step, lateJoin } = replicas(host);
    const lumber = host.factions[0].lumber;

    const started = step(BREW_TIME / 4);
    const selected = b.lab!.brewing!;
    expect(DRUGS).toContain(selected);
    expect(b.lab).toEqual({ brewing: selected, progress: .25, queue: [] });
    expect(host.factions[0].lumber).toBe(lumber - BREW_COST);
    expect(host.factions[0].drugs).toEqual({ saffron: 0, dust: 0, acidcop: 0 });
    expect(started.events.filter(e => e.t === 'brewed')).toEqual([]);
    expect(lateJoin().buildings.get(b.id)!.lab).toEqual(b.lab);

    step(BREW_TIME / 4);
    expect(b.lab!.progress).toBe(.5);
    expect(host.factions[0].lumber).toBe(lumber - BREW_COST);
    const completed = step(BREW_TIME / 2);
    expect(completed.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug: selected }]);
    expect(b.lab).toEqual({ brewing: null, progress: 0, queue: [] });
    expect(host.factions[0].drugs).toEqual({ saffron: 0, dust: 0, acidcop: 0, [selected]: 1 });
    expect(host.factions[0].lumber).toBe(lumber - BREW_COST);
    expect(lateJoin().factions[0].drugs[selected]).toBe(1);

    step(BREW_TIME / 4);
    expect(DRUGS).toContain(b.lab!.brewing);
    expect(host.factions[0].lumber).toBe(lumber - 2 * BREW_COST);
    expect(b.lab!.queue).toEqual([]);
  });

  it('finishes the current automatic batch, replicates manual FIFO orders, then resumes automatic production', () => {
    const { host, lab } = fixture();
    const b = lab();
    const { step, flush, lateJoin } = replicas(host);
    const lumber = host.factions[0].lumber;
    step(BREW_TIME / 4);
    const first = b.lab!.brewing!;
    cmdBrew(host, { t: 'brew', faction: 0, labId: b.id, drug: 'saffron' });
    cmdBrew(host, { t: 'brew', faction: 0, labId: b.id, drug: 'dust' });
    flush();
    expect(b.lab).toEqual({ brewing: first, progress: .25, queue: ['saffron', 'dust'] });
    expect(lateJoin().buildings.get(b.id)!.lab).toEqual(b.lab);
    expect(host.factions[0].lumber).toBe(lumber - BREW_COST);

    const automatic = step(3 * BREW_TIME / 4);
    expect(automatic.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug: first }]);
    const stocks = { saffron: 0, dust: 0, acidcop: 0 };
    stocks[first]++;
    for (const [index, ordered] of (['saffron', 'dust'] as const).entries()) {
      step(BREW_TIME / 4);
      expect(b.lab).toEqual({ brewing: ordered, progress: .25, queue: index === 0 ? ['dust'] : [] });
      expect(host.factions[0].lumber).toBe(lumber - (index + 2) * BREW_COST);
      const completed = step(3 * BREW_TIME / 4);
      expect(completed.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug: ordered }]);
      stocks[ordered]++;
      expect(host.factions[0].drugs).toEqual(stocks);
    }
    step(BREW_TIME / 4);
    expect(DRUGS).toContain(b.lab!.brewing);
    expect(b.lab!.queue).toEqual([]);
    expect(host.factions[0].lumber).toBe(lumber - 4 * BREW_COST);
    expect(lateJoin().buildings.get(b.id)!.lab).toEqual(b.lab);
  });

  it('replicates newly built labs and starts their first automatic batch only when construction finishes', () => {
    const { host, lab } = fixture();
    host.factions[0].drugs = { saffron: DRUG_MAX, dust: DRUG_MAX, acidcop: 0 };
    const { step, lateJoin } = replicas(host);
    const b = lab(.5);
    const lumber = host.factions[0].lumber;
    const added = step(BUILD_TIME / 4);
    expect(added.delta.ents?.buildings?.a?.some(row => row[0] === b.id)).toBe(true);
    expect(b.built).toBe(.75);
    expect(b.lab).toEqual({ brewing: null, progress: 0, queue: [] });
    expect(host.factions[0].lumber).toBe(lumber);
    expect(lateJoin().buildings.get(b.id)!.built).toBe(.75);

    const done = step(BUILD_TIME / 4);
    expect(done.events.filter(e => e.t === 'buildingDone' && e.buildingId === b.id)).toHaveLength(1);
    expect(b.built).toBe(1);
    expect(b.lab!.brewing).toBe('acidcop');
    expect(b.lab!.progress).toBeCloseTo(BUILD_TIME / 4 / BREW_TIME);
    expect(host.factions[0].lumber).toBe(lumber - BREW_COST);
    expect(lateJoin().buildings.get(b.id)!.lab!.brewing).toBe('acidcop');
  });

  it('replicates faction-wide reserve caps and waits for affordable restocking', () => {
    const { host, lab } = fixture();
    host.factions[0].drugs = { saffron: DRUG_MAX - 1, dust: DRUG_MAX - 1, acidcop: DRUG_MAX - 1 };
    host.factions[0].lumber = 4 * BREW_COST;
    const labs = [lab(), lab(), lab(), lab()];
    const { step, flush, lateJoin } = replicas(host);
    step(BREW_TIME / 4);
    const active = labs.map(b => b.lab!.brewing).filter((d): d is DrugId => d !== null);
    expect(active.slice().sort()).toEqual([...DRUGS].sort());
    expect(host.factions[0].lumber).toBe(BREW_COST);
    const completed = step(3 * BREW_TIME / 4);
    expect(completed.events.filter(e => e.t === 'brewed')).toHaveLength(3);
    expect(host.factions[0].drugs).toEqual({ saffron: DRUG_MAX, dust: DRUG_MAX, acidcop: DRUG_MAX });
    expect(lateJoin().factions[0].drugs).toEqual(host.factions[0].drugs);
    step(BREW_TIME / 4);
    expect(labs.every(b => b.lab!.brewing === null)).toBe(true);
    expect(host.factions[0].lumber).toBe(BREW_COST);

    // Empty stock alone is insufficient: an automatic start still needs its lumber payment.
    host.factions[0].drugs.dust--;
    host.factions[0].lumber = 0;
    flush();
    expect(step(BREW_TIME).events.filter(e => e.t === 'brewed')).toEqual([]);
    expect(labs.every(b => b.lab!.brewing === null)).toBe(true);
    host.factions[0].lumber = BREW_COST;
    step(BREW_TIME / 4);
    expect(labs.filter(b => b.lab!.brewing === 'dust')).toHaveLength(1);
    expect(labs.filter(b => b.lab!.brewing === null)).toHaveLength(3);
    expect(host.factions[0].lumber).toBe(0);
    lateJoin();
  });

  it('preserves explicit-order spending priority when an earlier idle lab shares the last batch of lumber', () => {
    const { host, lab } = fixture();
    const idle = lab();
    const ordered = lab();
    host.factions[0].lumber = BREW_COST;
    cmdBrew(host, { t: 'brew', faction: 0, labId: ordered.id, drug: 'acidcop' });
    const { step, lateJoin } = replicas(host);

    step(BREW_TIME / 4);
    expect(idle.lab).toEqual({ brewing: null, progress: 0, queue: [] });
    expect(ordered.lab).toEqual({ brewing: 'acidcop', progress: .25, queue: [] });
    expect(host.factions[0].lumber).toBe(0);
    expect(lateJoin().buildings.get(ordered.id)!.lab).toEqual(ordered.lab);
    const completed = step(3 * BREW_TIME / 4);
    expect(completed.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 0, drug: 'acidcop' }]);
    expect(host.factions[0].drugs.acidcop).toBe(1);
    expect(idle.lab!.brewing).toBe(null);

    host.factions[0].lumber = BREW_COST;
    step(BREW_TIME / 4);
    expect(DRUGS).toContain(idle.lab!.brewing);
    expect(ordered.lab!.brewing).toBe(null);
    expect(host.factions[0].lumber).toBe(0);
    lateJoin();
  });

  it('pauses captured labs until repair and credits the preserved paid batch to their new owner', () => {
    const { host, lab } = fixture();
    const b = lab();
    const { step, flush, lateJoin } = replicas(host);
    const oldLumber = host.factions[0].lumber;
    const newLumber = host.factions[1].lumber;
    step(BREW_TIME / 4);
    const selected = b.lab!.brewing!;
    captureHearth(host, host.hearthOf(0)!, 1);
    flush();
    expect(b.faction).toBe(1);
    expect(b.disabled).toBe(true);
    expect(b.lab).toEqual({ brewing: selected, progress: .25, queue: [] });
    expect(lateJoin().buildings.get(b.id)).toMatchObject({ faction: 1, disabled: true });

    const paused = step(BREW_TIME);
    expect(paused.events.filter(e => e.t === 'brewed')).toEqual([]);
    expect(b.lab!.progress).toBe(.25);
    expect(host.factions[0].lumber).toBe(oldLumber - BREW_COST);
    expect(host.factions[1].lumber).toBe(newLumber);
    repairBuilding(host, b, b.maxHp);
    const repaired = flush();
    expect(repaired.events.filter(e => e.t === 'buildingRepaired' && e.buildingId === b.id)).toHaveLength(1);
    const completed = step(3 * BREW_TIME / 4);
    expect(completed.events.filter(e => e.t === 'brewed')).toEqual([{ t: 'brewed', faction: 1, drug: selected }]);
    expect(host.factions[0].drugs[selected]).toBe(0);
    expect(host.factions[1].drugs[selected]).toBe(1);
    expect(host.factions[1].lumber).toBe(newLumber);
    step(BREW_TIME / 4);
    expect(DRUGS).toContain(b.lab!.brewing);
    expect(host.factions[1].lumber).toBe(newLumber - BREW_COST);
    expect(lateJoin().buildings.get(b.id)).toMatchObject({ faction: 1, disabled: false });
  });
});
