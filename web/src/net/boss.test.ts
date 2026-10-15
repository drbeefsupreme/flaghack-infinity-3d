import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { spawnFlag, spawnHippie } from '../sim/factory';
import { SnapshotEncoder } from './codec';
import { Motion } from './interp';
import { NetMirror } from './mirror';
import { bossFromWire, encodeRow, WORLD_FIELDS } from './schema';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function setup() {
  return createMatch({ seed: 'boss-net', difficulty: 'normal', mode: 'standard', humans: [0, 1],
    match: normalizeMatch({ maxSignifiers: 0 }) });
}

describe('durable boss replication', () => {
  it('replicates every action/target/stance/health field, airborne units and shared outcomes through deltas and late joins', () => {
    const host = setup();
    const enc = new SnapshotEncoder(host);
    const a = NetMirror.create(host.options, wire(enc.full()));
    const b = NetMirror.create(host.options, wire(enc.full()));
    host.time = 245;
    host.tick++;
    host.effigyRevealedAt = 230;
    host.boss = bossFixture();
    const hippie = spawnHippie(host, 0, { x: 7, z: 9 });
    hippie.airborne = { y: 8.25, vy: -4.5 };
    const flush = () => {
      const delta = wire(enc.delta([]));
      for (const peer of [a, b]) {
        peer.push({ tick: host.tick, time: host.time, acks: {}, delta, events: [] });
        peer.catchUp();
      }
      const late = NetMirror.create(host.options, wire(enc.full()));
      for (const peer of [a, b, late]) {
        expect(encodeRow(WORLD_FIELDS, peer.world, peer.world)).toEqual(encodeRow(WORLD_FIELDS, host, host));
        expect(peer.world.hippies.get(hippie.id)?.airborne).toEqual(hippie.airborne);
        expect(peer.world.drainEvents()).toEqual([]);
      }
    };
    flush();
    for (const action of ['stomp', 'crouchWalk', 'rise', 'swipe', 'recoil', 'death', 'dead'] as const) {
      host.tick++; host.time += 1;
      host.boss.action = action;
      host.boss.actionAt = host.time;
      host.boss.actionSeq++;
      host.boss.hitSeq++;
      host.boss.crouched = false;
      host.boss.pos.x += 1;
      host.boss.target = null;
      host.boss.objectiveAltarId = action === 'dead' ? null : 100 + host.tick;
      host.boss.routeStartStride += .15; host.boss.nextSceneryStompStride += .25; host.boss.opportunisticAfter += 1.5;
      host.boss.interruptImmuneUntil = host.time + 20;
      host.boss.held = null;
      host.boss.barrier = null;
      host.boss.deathAt = action === 'death' || action === 'dead' ? 250 : null;
      host.boss.hp = host.boss.deathAt === null ? 2500 : 0;
      delete hippie.airborne;
      if (action === 'dead') {
        host.phase = 'ended';
        host.bossOutcome = { kind: 'victory', winners: [0, 1, 3], at: host.time };
      }
      flush();
    }
  });

  it('rejects missing or malformed shared immunity clocks and unknown recoil actions', () => {
    const host = setup(); host.boss = bossFixture();
    host.boss.action = 'recoil'; host.boss.interruptImmuneUntil = 267.125;
    const row = WORLD_FIELDS.find(f => f.key === 'boss')!.enc(host, host) as unknown[];
    expect(bossFromWire(row as never)?.interruptImmuneUntil).toBe(267.125);
    expect(bossFromWire(row.slice(0, 27) as never)).toBeNull();
    for (const invalid of [null, '267125', -1, Infinity, NaN]) {
      const invalidRow = [...row]; invalidRow[27] = invalid;
      expect(bossFromWire(invalidRow as never)).toBeNull();
    }
    const invalidAction = [...row]; invalidAction[7] = 'permanentStun';
    expect(bossFromWire(invalidAction as never)).toBeNull();
  });

  it('interpolates boss motion/stride and airborne height without advancing actions, damage or clocks', () => {
    const host = setup();
    host.boss = bossFixture();
    host.time = 245;
    const h = spawnHippie(host, 0, { x: 0, z: 0 });
    h.airborne = { y: 2, vy: 4 };
    const enc = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, wire(enc.full()));
    const motion = new Motion();
    motion.capture(mirror.world, null, host.time);
    host.time += 1;
    host.tick++;
    host.boss.pos = { x: 3, z: 4 };
    host.boss.yaw = 1.4;
    host.boss.stride += 2;
    h.airborne.y = 4;
    motion.aim(wire(enc.delta([])));
    motion.blend(mirror.world, 245.5);
    expect(mirror.world.boss?.pos).toEqual({ x: 2, z: 3 });
    expect(mirror.world.boss?.yaw).toBeCloseTo(0.9);
    expect(mirror.world.boss?.stride).toBeCloseTo(16.55);
    expect(mirror.world.hippies.get(h.id)?.airborne?.y).toBe(3);
    expect(mirror.world.boss?.actionSeq).toBe(8);
    expect(mirror.world.boss?.hitSeq).toBe(7);
    expect(mirror.world.boss?.actionAt).toBe(242.123);
    expect(mirror.world.boss?.hp).toBe(5123.4);
    motion.restore(mirror.world);
    expect(mirror.world.boss?.pos).toEqual({ x: 1, z: 2 });
    expect(mirror.world.hippies.get(h.id)?.airborne).toEqual({ y: 2, vy: 4 });
  });
  it('delivers each body/head firework impact once with the flag removal and never replays it on late join', () => {
    const host = setup();
    host.boss = bossFixture();
    const flags = [false, true].map(() => spawnFlag(host, { owner: 0, state: 'loose', pos: { x: 1, y: 2, z: 3 } }));
    const enc = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, wire(enc.full()));
    for (const headshot of [false, true]) {
      const flag = flags[headshot ? 1 : 0];
      expect(mirror.world.flags.has(flag.id)).toBe(true);
      host.flags.delete(flag.id);
      const impact = { t: 'bossImpact' as const, bossId: host.boss.id, by: host.avatarOf(0).id,
        flagId: flag.id, faction: 0 as const, pos: { x: 1.25, y: headshot ? 18.75 : 6.25, z: -2.5 },
        headshot, amount: headshot ? 300 : 100 };
      host.boss.hp -= impact.amount;
      host.time += 1; host.tick++;
      const events = [impact];
      const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: enc.delta(events), events });
      mirror.push(frame); mirror.catchUp();
      expect(mirror.world.drainEvents()).toEqual(events);
      expect(mirror.world.flags.has(flag.id)).toBe(false);
      expect(mirror.world.boss!.hp).toBe(host.boss.hp);
      mirror.push(frame); mirror.catchUp();
      expect(mirror.world.drainEvents()).toEqual([]);
      const late = NetMirror.create(host.options, wire(enc.full()));
      expect(late.world.boss!.hp).toBe(host.boss.hp);
      expect(late.world.flags.has(flag.id)).toBe(false);
      expect(late.world.drainEvents()).toEqual([]);
    }
  });

});
