import { describe, expect, it, vi } from 'vitest';
import { spawnCrystal } from '../sim/factory';
import { createMatch } from '../sim/setup';
import { spawnBoss } from '../sim/systems/boss';
import * as combat from '../sim/systems/combat';
import { updateBossLightning } from '../sim/systems/boss/lightning';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { WORLD_FIELDS, encodeRow } from './schema';
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
it('replicates active Ward/Crystal arcs and host-only DPS to two mirrors and mid-lightning late joins', () => {
  const host = createMatch({ seed: 'boss-lightning-net', difficulty: 'normal', humans: [0], mode: 'standard' });
  host.time = 100; host.effigyRevealedAt = 100; const boss = spawnBoss(host)!; boss.pos = { x: 0, z: 0 }; boss.action = 'idle';
  host.crystals.clear(); const c = spawnCrystal(host, 0, 0, []); c.growth = 1; c.scale = 10; c.pos = { x: 500, z: -500 };
  const ordinary = spawnCrystal(host, 1, 1, []); ordinary.growth = 1; ordinary.scale = 1; ordinary.pos = { x: 50, z: 0 };
  host.drainEvents(); const encoder = new SnapshotEncoder(host), peers = [0,1].map(() => NetMirror.create(host.options, wire(encoder.full())));
  const hp = boss.hp; host.time++; host.tick++; updateBossLightning(host, boss, 1);
  boss.lightning.push({ kind: 'ward', id: 888888, faction: 0, from: { x: 2.123456, y: 4.5, z: 4 }, to: { ...boss.lightning[0].to } });
  const events = host.drainEvents(), frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta(events), events });
  expect(boss.hp).toBe(hp - 60);
  const damage = vi.spyOn(combat, 'damageEntity');
  for (const peer of peers) {
    peer.push(frame); peer.catchUp(); expect(peer.world.boss!.hp).toBe(hp - 60); expect(peer.world.boss!.lightning).toHaveLength(3);
    expect(peer.world.boss!.lightning.find(a => a.id === c.id)?.from.y).toBe(75);
    expect(encodeRow(WORLD_FIELDS, peer.world, peer.world)).toEqual(encodeRow(WORLD_FIELDS, host, host));
    expect(peer.world.drainEvents().filter(e => e.t === 'hit')).toHaveLength(2);
    peer.push(frame); peer.catchUp(); for (let i = 0; i < 60; i++) peer.advance(performance.now() + i * 16);
    expect(peer.world.boss!.hp).toBe(hp - 60); expect(peer.world.drainEvents()).toEqual([]);
  }
  const late = NetMirror.create(host.options, wire(encoder.full())); expect(late.world.boss!.lightning).toHaveLength(3);
  expect(late.world.boss!.hp).toBe(hp - 60); expect(late.world.drainEvents()).toEqual([]);
  for (let i = 0; i < 60; i++) late.advance(performance.now() + i * 16);
  expect(damage).not.toHaveBeenCalled(); damage.mockRestore();
  host.phase = 'ended'; updateBossLightning(host, boss, 1); host.tick++;
  const stopped = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
  for (const peer of peers) { peer.push(stopped); peer.catchUp(); expect(peer.world.boss!.lightning).toEqual([]); }
  expect(NetMirror.create(host.options, wire(encoder.full())).world.boss!.lightning).toEqual([]);
});
