import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { clearBossEyeCharge } from '../sim/boss';
import { AVATAR, SIM_DT } from '../sim/constants';
import { spawnFlag } from '../sim/factory';
import { normalizeMatch } from '../sim/matchSettings';
import { CollisionWorld } from '../sim/physics/collision';
import { createMatch } from '../sim/setup';
import { spawnBoss } from '../sim/systems/boss';
import { updateBossEye } from '../sim/systems/boss/eye';
import * as combat from '../sim/systems/combat';
import { giveFlag } from '../sim/systems/flags';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { encodeRow, WORLD_FIELDS } from './schema';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const setup = () => createMatch({ seed: 'boss-eye-net', difficulty: 'normal', humans: [0, 1], mode: 'standard',
  match: normalizeMatch({ maxSignifiers: 0 }) });

describe('durable boss eye replication', () => {
  it('replicates charge, frozen shot, cooldown and cancellation to two peers and late joins without events', () => {
    const host = setup(); host.time = 245; host.boss = bossFixture();
    const encoder = new SnapshotEncoder(host);
    const peers = [NetMirror.create(host.options, wire(encoder.full())), NetMirror.create(host.options, wire(encoder.full()))];
    const flush = () => {
      host.tick++;
      const delta = wire(encoder.delta([]));
      for (const peer of peers) { peer.push({ tick: host.tick, time: host.time, acks: {}, delta, events: [] }); peer.catchUp(); }
      const late = NetMirror.create(host.options, wire(encoder.full()));
      for (const peer of [...peers, late]) {
        expect(encodeRow(WORLD_FIELDS, peer.world, peer.world)).toEqual(encodeRow(WORLD_FIELDS, host, host));
        expect(peer.world.drainEvents()).toEqual([]);
      }
      return late;
    };
    flush();
    host.time = 257.123; host.boss.eye.chargeAt = host.time; host.boss.eye.nextFireAt = host.time + 3;
    host.boss.eye.target = { x: 24.123456, y: 0, z: -30.234567 };
    flush();
    host.time = 260.123; host.boss.eye.firedAt = host.time; host.boss.eye.nextFireAt = host.time + 30;
    host.boss.eye.origin = { x: 1.234567, y: 18.987654, z: 3.345678 };
    host.boss.eye.direction = { x: .234567, y: -.456789, z: -.857891 };
    host.boss.eye.impact = { ...host.boss.eye.target };
    const late = flush();
    expect(late.world.boss!.eye).toEqual(host.boss.eye);
    // A missed skyward shot also replicates null impact rather than inventing an explosion.
    host.boss.eye.impact = null; flush();
    clearBossEyeCharge(host.boss); host.time += .5; flush();
    host.boss.eye.chargeAt = host.time; host.boss.eye.target = { x: -2, y: 3, z: 4 }; flush();
    host.boss.hp = 0; host.boss.deathAt = host.time; host.boss.action = 'death';
    clearBossEyeCharge(host.boss); flush();
    for (const peer of peers) expect(peer.world.boss!.eye).toMatchObject({ chargeAt: null, firedAt: null, target: null, origin: null, direction: null, impact: null });
  });

  it('delivers authoritative damage once and never executes it on replay, rendering clocks or a mid-beam late join', () => {
    const host = setup(); host.effigyRevealedAt = 100; host.time = 127; host.suddenDeath = true;
    host.collision = new CollisionWorld();
    const boss = spawnBoss(host)!; boss.action = 'idle'; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
    const target = host.avatarOf(0); target.pos = { x: 0, y: 0, z: 40 }; target.carried = [];
    const flag = spawnFlag(host, { state: 'loose', owner: 0, pos: { ...target.pos } });
    expect(giveFlag(host, flag.id, target.id)).toBe(true);
    const strong = host.avatarOf(2); strong.pos = { x: 1, y: 0, z: 40 }; strong.hp = 1600;
    boss.target = { kind: 'avatar', id: target.id };
    host.drainEvents();
    const encoder = new SnapshotEncoder(host);
    const peers = [NetMirror.create(host.options, wire(encoder.full())), NetMirror.create(host.options, wire(encoder.full()))];
    updateBossEye(host, boss, SIM_DT); host.tick++;
    const charge = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
    for (const peer of peers) { peer.push(charge); peer.catchUp(); expect(peer.world.boss!.eye.chargeAt).toBe(127); }
    host.time = 130; host.tick++; updateBossEye(host, boss, SIM_DT);
    expect(target.hp).toBe(0);
    expect(strong.hp).toBe(600); expect(strong.koUntil).toBe(0);
    expect(host.flags.get(flag.id)).toMatchObject({ state: 'loose', holder: -1, node: -1, altNode: -1 });
    const events = host.drainEvents(), frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta(events), events });
    expect(events.filter(e => e.t === 'ko' && e.id === target.id)).toHaveLength(1);
    expect(events.filter(e => e.t === 'hit' && e.target === target.id)).toMatchObject([{ amount: 1000 }]);
    const damage = vi.spyOn(combat, 'damageEntity');
    for (const peer of peers) {
      const raycast = vi.spyOn(peer.world.collision, 'raycast');
      peer.push(frame); peer.catchUp();
      expect(peer.world.avatarOf(0).hp).toBe(0);
      expect(peer.world.avatarOf(2).hp).toBe(600);
      expect(peer.world.flags.get(flag.id)).toMatchObject({ state: 'loose', holder: -1, owner: 0 });
      expect(peer.world.avatarOf(0).carried).not.toContain(flag.id);
      expect(peer.world.drainEvents().filter(e => e.t === 'ko' && e.id === target.id)).toHaveLength(1);
      peer.push(frame); peer.catchUp();
      for (let i = 0; i < 30; i++) peer.advance(performance.now() + i * 16);
      expect(peer.world.drainEvents()).toEqual([]); expect(raycast).not.toHaveBeenCalled();
    }
    // A fresh survivor is inside the old blast sphere when a late peer materializes.
    host.avatarOf(1).pos = { ...boss.eye.impact! }; host.avatarOf(1).hp = AVATAR.maxHp;
    const late = NetMirror.create(host.options, wire(encoder.full()));
    expect(late.world.boss!.eye.firedAt).toBe(130); expect(late.world.boss!.eye.impact).not.toBeNull();
    expect(late.world.flags.get(flag.id)).toMatchObject({ state: 'loose', holder: -1, owner: 0 });
    expect(late.world.avatarOf(2).hp).toBe(600);
    expect(late.world.avatarOf(1).hp).toBe(AVATAR.maxHp); expect(late.world.drainEvents()).toEqual([]);
    for (let i = 0; i < 30; i++) late.advance(performance.now() + i * 16);
    expect(late.world.avatarOf(1).hp).toBe(AVATAR.maxHp); expect(damage).not.toHaveBeenCalled();
    damage.mockRestore();
  });
});
