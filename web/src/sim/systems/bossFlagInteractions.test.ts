import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { AVATAR, SIM_DT } from '../constants';
import { spawnBuilding, spawnCrystal, spawnFlag, spawnZone } from '../factory';
import { createMatch } from '../setup';
import type { World } from '../world';
import { cmdPull, updateAvatars } from './avatars';
import { damageEntity } from './combat';
import { dropLoose, pullFlag } from './flags';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function encounter() {
  const world = createMatch({ seed: 'boss-flag-sharing', difficulty: 'normal', humans: [0, 1], mode: 'standard' });
  world.time = 1000; world.effigyRevealedAt = 1000; world.boss = bossFixture();
  const avatar = world.avatarOf(0);
  for (const id of [...avatar.carried]) dropLoose(world, id, { x: -130, y: 0, z: 130 });
  const flag = [...world.flags.values()].find(f => f.owner === 1 && f.state === 'planted')!;
  avatar.pos = { ...flag.pos }; avatar.vel = { x: 0, y: 0, z: 0 };
  return { world, avatar, flag };
}
function step(world: World, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds / SIM_DT); i++) {
    world.time += SIM_DT; world.tick++; updateAvatars(world, SIM_DT);
  }
}

describe('player Flag interactions remain available during the boss encounter', () => {
  it.each(['throw-mode', 'pull-command'] as const)('picks up an allied loose Flag via %s and replicates it without enabling PvP', method => {
    const { world, avatar } = encounter();
    const flag = spawnFlag(world, { state: 'loose', owner: 1, pos: { ...avatar.pos } });
    const enc = new SnapshotEncoder(world);
    const peers = [NetMirror.create(world.options, wire(enc.full())), NetMirror.create(world.options, wire(enc.full()))];
    if (method === 'throw-mode') avatar.input.throwMode = true;
    else cmdPull(world, { t: 'pull', faction: 0, flagId: flag.id });
    step(world, AVATAR.pullLooseTime + SIM_DT);
    expect(flag.state).toBe('carried'); expect(flag.owner).toBe(0); expect(flag.holder).toBe(avatar.id);
    expect(avatar.carried).toContain(flag.id);
    const ally = world.avatarOf(1), hp = ally.hp;
    expect(damageEntity(world, ally.id, 100, avatar.id)).toBe(false); expect(ally.hp).toBe(hp);
    const events = world.drainEvents();
    const frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: enc.delta(events), events });
    for (const peer of peers) { peer.push(frame); peer.catchUp(); }
    const late = NetMirror.create(world.options, wire(enc.full()));
    for (const peer of [...peers, late]) {
      expect(peer.world.flags.get(flag.id)).toMatchObject({ state: 'carried', owner: 0, holder: avatar.id });
      expect(peer.world.avatarOf(0).carried).toContain(flag.id);
      expect(peer.world.avatarOf(1).hp).toBe(hp);
    }
  });

  it.each([true, false])('pulls another faction’s planted Flag using the ordinary channel (boss=%s)', active => {
    const { world, avatar, flag } = encounter();
    if (!active) { world.effigyRevealedAt = null; world.boss = null; }
    const node = flag.node;
    cmdPull(world, { t: 'pull', faction: 0, flagId: flag.id });
    expect(avatar.action.kind).toBe('pull');
    step(world, AVATAR.pullEnemyTime - .1); expect(flag.state).toBe('planted');
    step(world, .15); expect(flag.state).toBe('carried');
    expect(flag.owner).toBe(0); expect(flag.holder).toBe(avatar.id);
    expect(world.survey.nodeFlag[node]).toBe(-1); expect(world.survey.nodeFlagOwner[node]).toBe(-1);
    expect(world.factions[0].stats.flagsStolen).toBe(1);
    expect(world.drainEvents().filter(e => e.t === 'flagPulled' && e.flagId === flag.id)).toHaveLength(1);
  });

  it.each(['ward', 'crystal'] as const)('retains %s slow-pull protection without causing allied damage', defense => {
    const { world, avatar, flag } = encounter();
    if (defense === 'ward') {
      const ward = spawnBuilding(world, 'ward', 1, world.hearthOf(1)!.facet, 1);
      ward.pos = { x: flag.pos.x + 5, z: flag.pos.z };
    } else {
      const crystal = spawnCrystal(world, flag.node, 1, [flag.node]); crystal.growth = 1;
    }
    const hp = avatar.hp;
    cmdPull(world, { t: 'pull', faction: 0, flagId: flag.id });
    step(world, AVATAR.pullEnemyTime * 1.5); expect(flag.state).toBe('planted');
    step(world, AVATAR.pullEnemyTime * .5 + SIM_DT * 2); expect(flag.state).toBe('carried');
    expect(avatar.hp).toBe(hp);
    expect(world.drainEvents().some(e => e.t === (defense === 'ward' ? 'wardLightning' : 'crystalLightning'))).toBe(true);
  });

  it('retains Stabilize L3 immunity, then permits the pull when that protection expires', () => {
    const { world, avatar, flag } = encounter();
    const zone = spawnZone(world, 'stabilize', 1, flag.pos, 8, 10, 3);
    cmdPull(world, { t: 'pull', faction: 0, flagId: flag.id });
    expect(avatar.action.kind).toBe('idle'); expect(pullFlag(world, flag.id, avatar.id)).toBe(false);
    expect(flag.state).toBe('planted');
    world.time = zone.until + SIM_DT;
    cmdPull(world, { t: 'pull', faction: 0, flagId: flag.id }); step(world, AVATAR.pullEnemyTime + SIM_DT);
    expect(flag.state).toBe('carried'); expect(flag.owner).toBe(0);
  });
});
