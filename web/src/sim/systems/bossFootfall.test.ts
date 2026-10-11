import { describe, expect, it } from 'vitest';
import { BOSS_TIMING } from '../boss';
import { BOSS_GAIT, bossFootContacts } from '../bossGait';
import { SIM_DT } from '../constants';
import { spawnHippie } from '../factory';
import { normalizeMatch } from '../matchSettings';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { moveBuilding } from './buildings';
import { BOSS_FOOTFALL_RADIUS, spawnBoss, updateBoss } from './boss';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function encounter(crouched = false) {
  const w = createMatch({ seed: 'boss-feet', difficulty: 'normal', humans: [0, 1], mode: 'standard', match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 1000; w.effigyRevealedAt = 990; w.suddenDeath = true;
  w.map.obstacles = []; w.collision = new CollisionWorld();
  w.survey.edgeLey.fill(-1); w.survey.version++;
  for (const h of w.hippies.values()) h.pos = { x: -100, z: -100 };
  for (const a of w.avatars.values()) a.pos = { x: -100, y: 0, z: -100 };
  for (const s of w.buildings.values()) moveBuilding(w, s, -100, -100);
  const altar = w.hearthOf(3)!; moveBuilding(w, altar, 0, crouched ? 20 : 35); w.factions[3].stats.cmi = 100000;
  const b = spawnBoss(w)!; Object.assign(b, { pos: { x: 0, z: 0 }, yaw: 0, action: 'idle', crouched,
    objectiveAltarId: altar.id, nextAttackAt: 0, opportunisticAfter: 10000, nextSceneryStompStride: 10000 });
  b.eye.nextFireAt = Infinity;
  const gait: 'crouchWalk' | 'walk' = crouched ? 'crouchWalk' : 'walk';
  b.stride = BOSS_GAIT[gait].stride * BOSS_GAIT[gait].phases[1] - .01;
  w.drainEvents();
  return { w, b, gait, altar };
}

it('enumerates every real landing once across large steps, pauses and split ticks', () => {
  for (const gait of ['walk', 'crouchWalk'] as const) {
    const cycle = BOSS_GAIT[gait].stride;
    const all = bossFootContacts(gait, 0, cycle * 4);
    expect(all).toHaveLength(8);
    expect(all.map(c => c.side)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(bossFootContacts(gait, cycle, cycle)).toEqual([]);
    expect(bossFootContacts(gait, 0, cycle).length + bossFootContacts(gait, cycle, cycle * 4).length).toBe(8);
    expect(bossFootContacts(gait, cycle * 4, cycle * 4 + .001)).toEqual([]);
  }
});

describe.each([false, true])('authoritative walking stomp, crouched=%s', crouched => {
  it('hits a player at the enlarged hull edge and a hippie for exactly140 on the actual contact', () => {
    const { w, b, gait } = encounter(crouched), foot = BOSS_GAIT[gait].feet[1];
    const av = w.avatarOf(0), length = Math.hypot(foot.x, foot.z);
    av.pos = { x: foot.x / length * 5.66, y: 0, z: foot.z / length * 5.66 }; av.hp = 1000;
    const h = spawnHippie(w, 0, { x: foot.x, z: foot.z + .02 }); h.hp = 1000;
    const miss = spawnHippie(w, 0, { x: foot.x - BOSS_FOOTFALL_RADIUS - .1, z: foot.z }); miss.hp = 1000;
    const airborne = spawnHippie(w, 0, { x: foot.x, z: foot.z }); airborne.airborne = { y: 6, vy: 0 }; airborne.hp = 1000;
    const startStride = b.stride;
    w.time += .001; updateBoss(w, .001); expect(b.stride).toBeGreaterThan(startStride);
    expect(av.hp).toBe(1000); expect(h.hp).toBe(1000); expect(w.drainEvents().filter(e => e.t === 'bossFootfall')).toEqual([]);
    w.time += SIM_DT; updateBoss(w, SIM_DT);
    expect(av.hp).toBe(860); expect(h.hp).toBe(860); expect(miss.hp).toBe(1000); expect(airborne.hp).toBe(1000);
    const events = w.drainEvents().filter(e => e.t === 'bossFootfall');
    expect(events).toHaveLength(1); expect(events[0].heavy).toBe(false);
    expect(events[0].pos.x).toBeCloseTo(foot.x, 4); expect(events[0].pos.z).toBeCloseTo(foot.z + .01, 4);
    for (let i = 0; i < 10; i++) { w.time += SIM_DT; updateBoss(w, SIM_DT); }
    expect(av.hp).toBe(860); expect(h.hp).toBe(860); expect(w.drainEvents().filter(e => e.t === 'bossFootfall')).toEqual([]);
  });

  it('replicates each contact once to two peers while late joins inherit damage without replay', () => {
    const { w, b, gait } = encounter(crouched), foot = BOSS_GAIT[gait].feet[1];
    const h = spawnHippie(w, 0, { ...foot }); h.hp = 1000;
    const enc = new SnapshotEncoder(w), peers = [0, 1].map(() => NetMirror.create(w.options, wire(enc.full())));
    w.time += SIM_DT; w.tick++; updateBoss(w, SIM_DT);
    const events = w.drainEvents(), frame = wire({ tick: w.tick, time: w.time, acks: {}, delta: enc.delta(events), events });
    expect(events.filter(e => e.t === 'bossFootfall')).toHaveLength(1);
    for (const peer of peers) {
      peer.push(frame); peer.catchUp(); expect(peer.world.drainEvents()).toEqual(events);
      expect(peer.world.hippies.get(h.id)?.hp).toBe(860); expect(peer.world.boss?.stride).toBeCloseTo(b.stride, 2);
      peer.push(frame); peer.catchUp(); expect(peer.world.drainEvents()).toEqual([]);
    }
    const late = NetMirror.create(w.options, wire(enc.full()));
    expect(late.world.hippies.get(h.id)?.hp).toBe(860); expect(late.world.drainEvents()).toEqual([]);
  });
});

it('emits all contacts crossed by a long host tick and a single larger deliberate impact', () => {
  const { w, b } = encounter(); b.stride = 0;
  w.time += 2; updateBoss(w, 2);
  expect(w.drainEvents().filter(e => e.t === 'bossFootfall')).toHaveLength(2);
  b.action = 'stomp'; b.actionAt = w.time; b.actionSeq++; b.hitSeq = -1;
  w.time += BOSS_TIMING.stompHit; updateBoss(w, SIM_DT);
  const events = w.drainEvents().filter(e => e.t === 'bossFootfall');
  expect(events).toEqual([{ t: 'bossFootfall', bossId: b.id, pos: { ...b.pos }, heavy: true }]);
  updateBoss(w, SIM_DT); expect(w.drainEvents().filter(e => e.t === 'bossFootfall')).toEqual([]);
});
