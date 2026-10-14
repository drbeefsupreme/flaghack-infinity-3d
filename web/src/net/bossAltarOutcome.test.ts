import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../sim/boss';
import { createMatch } from '../sim/setup';
import { consumeBuilding } from '../sim/systems/boss';
import { updateBossOutcome } from '../sim/systems/victory';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('all-altar boss outcomes on live peers and late joins', () => {
  it.each(['victory', 'defeat'] as const)('keeps the NPC-only remainder running before its final %s', result => {
    const host = createMatch({ seed: 'takeover-outcome-net', mode: 'standard', difficulty: 'normal', humans: [0, 1] });
    host.time = 250; host.effigyRevealedAt = 230; host.boss = bossFixture(); host.drainEvents();
    const encoder = new SnapshotEncoder(host);
    const peers = [NetMirror.create(host.options, wire(encoder.full())), NetMirror.create(host.options, wire(encoder.full()))];
    const flush = () => {
      host.tick++; host.time += 1 / 30;
      const events = host.drainEvents();
      const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta(events), events });
      const expectedOutcome = host.bossOutcome && { ...host.bossOutcome, at: Math.round(host.bossOutcome.at * 1000) / 1000 };
      for (const peer of peers) {
        peer.push(frame); peer.catchUp();
        expect(peer.world.phase).toBe(host.phase);
        expect(peer.world.bossOutcome).toEqual(expectedOutcome);
        expect(peer.world.factions.map(f => [f.alive, f.hearthIds])).toEqual(host.factions.map(f => [f.alive, f.hearthIds]));
        peer.world.drainEvents();
        peer.push(frame); peer.catchUp();
        expect(peer.world.drainEvents()).toEqual([]);
      }
      const late = NetMirror.create(host.options, wire(encoder.full()));
      expect(late.world.phase).toBe(host.phase);
      expect(late.world.bossOutcome).toEqual(expectedOutcome);
      expect(late.world.drainEvents()).toEqual([]);
    };
    for (const f of [0, 1] as const) consumeBuilding(host, host.hearthOf(f)!);
    updateBossOutcome(host);
    expect(host.phase).toBe('playing'); expect(host.bossOutcome).toBeNull(); flush();
    if (result === 'victory') {
      host.boss.hp = 0; host.boss.deathAt = host.time; host.boss.action = 'death';
      host.time += BOSS_DEATH_DURATION - 0.1;
      updateBossOutcome(host); expect(host.phase).toBe('playing'); flush();
      host.time += 0.1; host.boss.action = 'dead';
    } else {
      consumeBuilding(host, host.hearthOf(2)!); updateBossOutcome(host);
      expect(host.phase).toBe('playing'); flush();
      consumeBuilding(host, host.hearthOf(3)!);
    }
    updateBossOutcome(host);
    expect(host.bossOutcome).toMatchObject({ kind: result, winners: result === 'victory' ? [2, 3] : [] });
    flush();
  });
});
