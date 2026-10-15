import { describe, expect, it } from 'vitest';
import { BUILDINGS, HIPPIE, HIPPIE_AI, SIM_DT } from '../../constants';
import { spawnBuilding, spawnFlag, spawnHippie, spawnPing } from '../../factory';
import { planEnclosure } from '../../lattice/planner';
import { createMatch } from '../../setup';
import type { Hippie } from '../../types';
import type { World } from '../../world';
import { canPlantAt, depositToStock, dropLoose, giveFlag, plantFlag } from '../flags';
import { updateHippies } from '../hippies';
import { updateSurvey } from '../survey';
import { act } from './act';
import { beginTask, brainOf } from './brain';
import { decide } from './decide';
import { allocateJobs } from './jobs';
import { unitsState } from './state';

function scenario() {
  const world = createMatch({ seed: 'allied-objectives', difficulty: 'normal', humans: [0], mode: 'standard' });
  world.tide.nextAt = Infinity;
  world.hippies.clear(); world.avatars.clear(); world.pings.clear();
  const home = world.hearthOf(0)!;
  const h = spawnHippie(world, 0, { x: home.pos.x + BUILDINGS.hearth.radius + 2, z: home.pos.z });
  h.attention = 100;
  const b = brainOf(h), sys = unitsState(world);
  world.factions[0].plan.clear();
  refresh(world);
  return { world, home, h, b, sys };
}
function refresh(world: World) {
  const sys = unitsState(world);
  sys.active.length = 0; sys.active.push(...world.hippies.values()); sys.hash.rebuild(sys.active);
  sys.looseFlags.length = 0; sys.stockByHearth.clear(); sys.stockByFaction.fill(0);
  for (const fl of world.flags.values()) {
    if (fl.state === 'loose') sys.looseFlags.push(fl);
    else if (fl.state === 'stock') {
      sys.stockByHearth.set(fl.holder, (sys.stockByHearth.get(fl.holder) ?? 0) + 1);
      if (fl.owner >= 0) sys.stockByFaction[fl.owner]++;
    }
  }
}
function loose(world: World, h: Hippie, owner: -1 | 0 | 1 = 0) {
  return spawnFlag(world, { owner, state: 'loose', pos: { x: h.pos.x + 0.2, y: world.collision.groundHeight(h.pos.x, h.pos.z), z: h.pos.z } });
}
function freeNode(world: World, h: Hippie) {
  const n = world.lattice.nodes.filter(n => canPlantAt(world, n.id, 0))
    .sort((a, b) => Math.hypot(a.x - h.pos.x, a.z - h.pos.z) - Math.hypot(b.x - h.pos.x, b.z - h.pos.z))[0];
  if (!n) throw new Error('no free node');
  return n.id;
}

describe('allied flag objectives', () => {
  it('allocates Survey hands to recover loose friendly flags even after the plan is complete', () => {
    const { world, h, sys } = scenario(); loose(world, h); refresh(world);
    world.factions[0].jobWeights = { survey: 4, gather: 0, defend: 0, raid: 0, ritual: 0 };
    allocateJobs(world, sys, 0);
    expect(h.job).toBe('survey');
  });
  it('assigns recovery-only work to a hand within retrieval range rather than the first distant hand', () => {
    const { world, home, h, sys } = scenario();
    h.pos.x -= HIPPIE_AI.fetchRadius + 20;
    const nearby = spawnHippie(world, 0, { x: home.pos.x + BUILDINGS.hearth.radius + 2, z: home.pos.z });
    loose(world, nearby); refresh(world);
    world.factions[0].jobWeights = { survey: 4, gather: 0, defend: 0, raid: 0, ritual: 0 };
    allocateJobs(world, sys, 0);
    expect(h.job).toBeNull(); expect(nearby.job).toBe('survey');
  });
  it.each([0, -1] as const)('recovers a nearby loose owner-%s flag into stock without needing a new plan', owner => {
    const { world, home, h } = scenario(); const fl = loose(world, h, owner);
    world.factions[0].jobWeights = { survey: 4, gather: 0, defend: 0, raid: 0, ritual: 0 };
    for (let i = 0; i < 12 / SIM_DT && fl.state !== 'stock'; i++) {
      world.time += SIM_DT; world.tick++; updateHippies(world, SIM_DT);
    }
    expect(fl).toMatchObject({ state: 'stock', owner: 0, holder: home.id }); expect(h.carryingFlag).toBe(-1);
  });
  it('leaves distant, elevated and rival loose flags alone during automatic recovery', () => {
    const { world, h, b, sys } = scenario(); h.job = 'survey'; loose(world, h, 1);
    const high = loose(world, h); high.pos.y += 3;
    const far = loose(world, h); far.pos.x += HIPPIE_AI.fetchRadius + 10;
    refresh(world); decide(world, sys, h, b, 0); expect(b.task).toBe('idle');
  });
  it('does not let a second ordered pull steal an active flag claim', () => {
    const { world, h, b, sys } = scenario(); const fl = loose(world, h);
    const other = spawnHippie(world, 0, h.pos), ob = brainOf(other);
    h.order = other.order = { kind: 'pull', flagId: fl.id };
    decide(world, sys, h, b, 0); decide(world, sys, other, ob, 0);
    expect(sys.flagClaims.get(fl.id)).toBe(h.id); expect(ob.flag).toBe(-1);
    expect(other.order).toEqual({ kind: 'pull', flagId: fl.id });
  });
  it('does not let a second ordered plant steal an active node reservation', () => {
    const { world, h, b, sys } = scenario(); const node = freeNode(world, h), other = spawnHippie(world, 0, h.pos);
    h.order = other.order = { kind: 'plant', node };
    decide(world, sys, h, b, 0); decide(world, sys, other, brainOf(other), 0);
    expect(sys.nodeReservations.get(node)).toBe(h.id); expect(brainOf(other).node).toBe(-1);
  });
  it('abandons a stock fetch as soon as its plan node is removed', () => {
    const { world, h, b, sys } = scenario(); h.job = 'survey'; const node = freeNode(world, h);
    world.factions[0].plan.add(node); decide(world, sys, h, b, 0); expect(b.task).toBe('fetchStock');
    world.factions[0].plan.clear(); act(world, sys, h, b, 0, SIM_DT);
    expect(b.task).toBe('none'); expect(h.carryingFlag).toBe(-1); expect(sys.nodeReservations.has(node)).toBe(false);
  });
  it('rejects an invalidated plant node without crashing or leaking its reservation', () => {
    const { world, h, b, sys } = scenario(); const fl = loose(world, h); expect(giveFlag(world, fl.id, h.id)).toBe(true);
    const node = world.lattice.nodes.length; h.order = { kind: 'plant', node };
    beginTask(world, h, b, 'plant'); b.node = node; sys.nodeReservations.set(node, h.id);
    expect(() => act(world, sys, h, b, 0, SIM_DT)).not.toThrow();
    expect(b.task).toBe('none'); expect(sys.nodeReservations.has(node)).toBe(false);
  });
  it.each(['cargo', 'reservation'] as const)('preserves an explicit plant order after transient loss of its %s', lost => {
    const { world, h, b, sys } = scenario(); const fl = loose(world, h);
    expect(giveFlag(world, fl.id, h.id)).toBe(true);
    const node = freeNode(world, h); h.order = { kind: 'plant', node }; decide(world, sys, h, b, 0);
    if (lost === 'cargo') dropLoose(world, fl.id, { x: h.pos.x, y: world.collision.groundHeight(h.pos.x, h.pos.z), z: h.pos.z });
    else sys.nodeReservations.set(node, spawnHippie(world, 0, h.pos).id);
    act(world, sys, h, b, 0, SIM_DT);
    expect(b.task).toBe('none'); expect(h.order).toEqual({ kind: 'plant', node });
    if (lost === 'cargo') {
      refresh(world); decide(world, sys, h, b, 0);
      expect(b.task).toBe('pickup'); expect(b.node).toBe(node);
    }
  });
  it('hauls lumber before an attack-flag order, then retrieves the flag without losing the order', () => {
    const { world, h, b, sys } = scenario(); const fl = loose(world, h, 1);
    h.carryingLumber = 5; h.order = { kind: 'attack', target: fl.id };
    decide(world, sys, h, b, 0); expect(b.task).toBe('haul'); expect(h.order).toEqual({ kind: 'attack', target: fl.id });
    act(world, sys, h, b, 0, SIM_DT); expect(h.carryingLumber).toBe(0);
    decide(world, sys, h, b, 0); expect(b.task).toBe('pull');
    act(world, sys, h, b, 0, HIPPIE.pickupTime + 1);
    expect(h.carryingFlag).toBe(fl.id); expect(h.order).toBeNull();
  });
  it('releases an unreachable stock fetch and tries a nearby loose flag instead', () => {
    const { world, home, h, b, sys } = scenario(); h.job = 'survey'; h.pos.x += 20;
    const node = freeNode(world, h); world.factions[0].plan.add(node); decide(world, sys, h, b, 0);
    expect(b.task).toBe('fetchStock');
    b.route = 'blocked'; b.routeX = b.px; b.routeZ = b.pz; b.routeAt = world.time; b.path = null;
    act(world, sys, h, b, 0, SIM_DT); expect(b.task).toBe('none');
    expect(b.avoidBuildings.get(home.id)).toBeGreaterThan(world.time);
    decide(world, sys, h, b, 0); expect(b.task).toBe('idle');
    const fl = loose(world, h); refresh(world); decide(world, sys, h, b, 0);
    expect(b.task).toBe('pickup'); expect(b.flag).toBe(fl.id); expect(sys.fetchers.get(home.id) ?? 0).toBe(0);
  });
  it('updates stock availability as soon as a fetch consumes its reserved flag', () => {
    const { world, home, h, b, sys } = scenario(); h.job = 'survey';
    const before = sys.stockByHearth.get(home.id)!;
    world.factions[0].plan.add(freeNode(world, h)); decide(world, sys, h, b, 0);
    act(world, sys, h, b, 0, SIM_DT);
    expect(b.task).toBe('plant'); expect(sys.stockByHearth.get(home.id)).toBe(before - 1);
    expect(sys.fetchers.get(home.id) ?? 0).toBe(0);
  });
  it('abandons a pickup whose reservation was lost without releasing the new owner’s claim', () => {
    const { world, h, b, sys } = scenario(); h.job = 'survey';
    const fl = loose(world, h); refresh(world); decide(world, sys, h, b, 0);
    expect(b.task).toBe('pickup');
    const other = spawnHippie(world, 0, h.pos); sys.flagClaims.set(fl.id, other.id);
    act(world, sys, h, b, 0, SIM_DT);
    expect(b.task).toBe('none'); expect(sys.flagClaims.get(fl.id)).toBe(other.id); expect(h.carryingFlag).toBe(-1);
  });
  it('stops automatic pickup when a loose target is displaced outside retrieval range', () => {
    const { world, h, b, sys } = scenario(); h.job = 'survey';
    const fl = loose(world, h); refresh(world); decide(world, sys, h, b, 0);
    expect(b.task).toBe('pickup'); fl.pos.x += HIPPIE_AI.fetchRadius + 10;
    fl.pos.y = world.collision.groundHeight(fl.pos.x, fl.pos.z);
    act(world, sys, h, b, 0, SIM_DT);
    expect(b.task).toBe('none'); expect(sys.flagClaims.has(fl.id)).toBe(false);
  });
  it('reroutes a carried flag to another completed home after its first route fails', () => {
    const { world, home, h, b, sys } = scenario();
    const otherHome = spawnBuilding(world, 'hearth', 0, home.facet, 1);
    otherHome.pos = { x: home.pos.x + 70, z: home.pos.z };
    const fl = loose(world, h); expect(giveFlag(world, fl.id, h.id)).toBe(true);
    h.pos.x += 20; h.job = 'defend'; decide(world, sys, h, b, 0); expect(b.target).toBe(home.id);
    b.route = 'blocked'; b.routeX = b.px; b.routeZ = b.pz; b.routeAt = world.time; b.path = null;
    act(world, sys, h, b, 0, SIM_DT); decide(world, sys, h, b, 0);
    expect(b.task).toBe('stow'); expect(b.target).toBe(otherHome.id);
    h.pos = { x: otherHome.pos.x - BUILDINGS.hearth.radius - 1, z: otherHome.pos.z };
    act(world, sys, h, b, 0, SIM_DT);
    expect(fl).toMatchObject({ state: 'stock', holder: otherHome.id });
  });
  it('prunes expired and removed building route failures before choosing a return home', () => {
    const { world, home, h, b, sys } = scenario();
    const fl = loose(world, h); expect(giveFlag(world, fl.id, h.id)).toBe(true);
    b.avoidBuildings.set(home.id, world.time - 1); b.avoidBuildings.set(-1234, world.time + 20);
    decide(world, sys, h, b, 0);
    expect(b.target).toBe(home.id); expect(b.avoidBuildings.size).toBe(0);
  });
  it('recovers from an exhausted return route without losing the carried flag', () => {
    const { world, home, h, b, sys } = scenario(); const fl = loose(world, h); expect(giveFlag(world, fl.id, h.id)).toBe(true);
    h.pos.x += 20; h.job = 'defend'; decide(world, sys, h, b, 0); expect(b.task).toBe('stow');
    b.route = 'blocked'; b.routeX = b.px; b.routeZ = b.pz; b.routeAt = world.time; b.path = null;
    act(world, sys, h, b, 0, SIM_DT); expect(b.task).not.toBe('stow');
    expect(h.carryingFlag).toBe(fl.id); expect(fl.state).toBe('carried');
    world.time += 13; h.pos = { x: home.pos.x + BUILDINGS.hearth.radius + 1, z: home.pos.z };
    decide(world, sys, h, b, 0); act(world, sys, h, b, 0, SIM_DT);
    expect(fl).toMatchObject({ state: 'stock', holder: home.id });
  });
});

describe('automatic altar defense', () => {
  it('engages a nearby altar intruder before answering a distant rally', () => {
    const { world, h, b, sys } = scenario(); h.job = 'defend';
    const enemy = spawnHippie(world, 1, { x: h.pos.x + 4, z: h.pos.z });
    spawnPing(world, 'rally', 0, { x: h.pos.x + 30, z: h.pos.z }, -1); refresh(world); decide(world, sys, h, b, 0);
    expect(b.task).toBe('engage'); expect(b.target).toBe(enemy.id);
  });
  it('breaks an enclosing enemy loop before answering a rally or repairing', () => {
    const { world, home, h, b, sys } = scenario();
    for (const fl of world.flags.values()) if (fl.owner === 0 && fl.state === 'planted') depositToStock(world, fl.id, home.id);
    updateSurvey(world, 0);
    const loop = planEnclosure(world.lattice, { x: home.pos.x, z: home.pos.z, minRadius: 14, cost: n => canPlantAt(world, n, 1) ? 1 : Infinity });
    expect(loop).not.toBeNull();
    for (const node of loop!) {
      const fl = spawnFlag(world, { owner: 1, state: 'loose', pos: { x: 0, y: 0, z: 0 } });
      expect(plantFlag(world, fl.id, node, 1, -1)).toBe(true);
    }
    updateSurvey(world, 0); home.hp = home.maxHp / 2; h.job = 'defend';
    spawnPing(world, 'rally', 0, { x: h.pos.x + 30, z: h.pos.z }, -1); refresh(world); decide(world, sys, h, b, 0);
    expect(b.task).toBe('pull'); expect(loop).toContain(world.flags.get(b.flag)?.node);
  });
  it.each(['repair', 'patrol', 'respond'] as const)('interrupts automatic %s through the live update when an altar intruder appears', task => {
    const { world, home, h, b } = scenario();
    world.factions[0].jobWeights = { survey: 0, gather: 0, defend: 4, raid: 0, ritual: 0 };
    h.job = 'defend';
    beginTask(world, h, b, task);
    home.hp = home.maxHp / 2;
    const ping = spawnPing(world, 'rally', 0, { x: h.pos.x + 30, z: h.pos.z }, -1);
    b.target = task === 'respond' ? ping.id : home.id;
    b.nextThinkAt = 0;
    const enemy = spawnHippie(world, 1, { x: h.pos.x + 4, z: h.pos.z });
    world.time += SIM_DT; world.tick++;
    updateHippies(world, SIM_DT);
    expect(b.task).toBe('engage'); expect(b.target).toBe(enemy.id);
  });
  it('keeps an explicit defend anchor instead of chasing a distant rally', () => {
    const { world, h, b, sys } = scenario();
    h.order = { kind: 'defend', at: { ...h.pos } };
    spawnPing(world, 'rally', 0, { x: h.pos.x + 30, z: h.pos.z }, -1);
    decide(world, sys, h, b, 0);
    expect(b.task).toBe('patrol'); expect(b.ax).toBe(h.order.at.x); expect(b.az).toBe(h.order.at.z);
  });
  it('keeps its existing rally route when no home threat has appeared', () => {
    const { world, h, b, sys } = scenario(); h.job = 'defend';
    const ping = spawnPing(world, 'rally', 0, { x: h.pos.x + 30, z: h.pos.z }, -1);
    decide(world, sys, h, b, 0); expect(b.task).toBe('respond');
    const path = [{ x: h.pos.x + 10, z: h.pos.z }]; b.path = path; b.route = 'path'; b.waitUntil = 7;
    world.time += 0.6; decide(world, sys, h, b, 0);
    expect(b.target).toBe(ping.id); expect(b.path).toBe(path); expect(b.route).toBe('path'); expect(b.waitUntil).toBe(7);
  });
  it('retains an active SOS response when its responder limit is full', () => {
    const { world, h, b, sys } = scenario(); h.job = 'defend';
    const ping = spawnPing(world, 'sos', 0, { x: h.pos.x + 30, z: h.pos.z }, -1);
    decide(world, sys, h, b, 0); expect(b.task).toBe('respond');
    sys.responders.set(ping.id, HIPPIE_AI.sosResponders);
    const path = [{ x: h.pos.x + 10, z: h.pos.z }]; b.path = path;
    world.time += 0.6; decide(world, sys, h, b, 0);
    expect(b.task).toBe('respond'); expect(b.target).toBe(ping.id); expect(b.path).toBe(path);
  });
  it('keeps an explicit move order even when the home is threatened', () => {
    const { world, h, b, sys } = scenario(); h.job = 'defend';
    spawnHippie(world, 1, { x: h.pos.x + 4, z: h.pos.z }); h.order = { kind: 'move', to: { x: 0, z: 40 } };
    refresh(world); decide(world, sys, h, b, 0); expect(b.task).toBe('goto'); expect(h.order.kind).toBe('move');
  });
});
