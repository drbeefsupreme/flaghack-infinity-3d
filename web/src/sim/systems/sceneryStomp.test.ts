import { describe, expect, it } from 'vitest';
import { BOSS_TIMING } from '../boss';
import { BOSS_GAIT } from '../bossGait';
import { BOSS_GAMEPLAY_SCALE, BOSS_MODEL_SCALE } from '../bossDimensions';
import { SIM_DT } from '../constants';
import { normalizeMatch } from '../matchSettings';
import type { Obstacle } from '../map/mapgen';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { spawnBoss, updateBoss } from './boss';
import { crushScenery, destroySceneryHit, syncScenery } from './scenery';
import { syncEffigy } from './effigy';

const options = { seed: 'scenery-stomp', difficulty: 'normal' as const, mode: 'standard' as const, humans: [0 as const],
  match: normalizeMatch({ bossMode: true, maxSignifiers: 0 }) };
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const kinds = ['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car'] as const;
function encounter() {
  const world = createMatch(options);
  world.time = 300; world.effigyRevealedAt = 230; syncEffigy(world);
  const boss = spawnBoss(world)!;
  boss.action = 'idle'; boss.crouched = false; boss.eye.nextFireAt = Infinity;
  world.survey.edgeLey.fill(-1); world.survey.version++;
  return { world, boss };
}
function fixture(obstacles: Partial<Obstacle>[]) {
  const { world, boss } = encounter(), template = world.map.obstacles.find(o => o.kind === 'porta')!;
  world.map.obstacles = obstacles.map((o, id) => ({ ...template, id, x: 0, z: 0, hx: .5, hz: .5, radius: .5,
    yaw: 0, height: 3, shape: 'box', ...o }));
  world.collision = CollisionWorld.fromMap(world.map);
  return { world, boss };
}

describe('bounded stomp scenery footprint', () => {
  it('uses exact circle and rotated-box footprints, including edge contact and excluding nearby corners', () => {
    const { world } = fixture([
      { shape: 'circle', x: 2, radius: 1 },
      { shape: 'circle', x: -2.001, radius: 1 },
      { x: 1.501, z: 1.501 }, // inflated-box corners are not a circular foot contact
      { x: 0, z: 2, hx: 2, hz: .1, yaw: Math.PI / 2 },
      { kind: 'effigy' },
    ]);
    const version = world.nav.version;
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 1)).toBe(2);
    expect([...world.destroyedScenery]).toEqual([0, 3]);
    expect(world.nav.version).toBe(version + 1); // one rebuild for all contacts
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 1)).toBe(0);
    expect(world.nav.version).toBe(version + 1);
  });

  it('sweeps across thin and rotated props without widening the foot corridor or bypassing protected loops', () => {
    const { world } = fixture([
      { x: 0, z: 0, hx: .02, hz: .02, yaw: Math.PI / 4 },
      { x: 0, z: 1.61, shape: 'circle', radius: .05 },
      { x: 2, z: .3, yaw: Math.PI / 3 },
      { x: 1, z: 0 },
    ]);
    expect(crushScenery(world, { x: -5, z: 0 }, { x: 5, z: 0 }, 1.55, o => o.id !== 3)).toBe(2);
    expect([...world.destroyedScenery]).toEqual([0, 2]);
    for (const bad of [-1, NaN, Infinity]) expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, bad)).toBe(0);
    expect(crushScenery(world, { x: NaN, z: 0 }, { x: 0, z: 0 }, 1)).toBe(0);
  });

  it('ordinary contacts crush only props at most 5m wide, independent of all nine kinds; big stomps crush larger props', () => {
    const { world } = fixture(kinds.flatMap((kind, i) => [
      { kind, shape: i % 2 ? 'circle' as const : 'box' as const, hx: 2.5, hz: .5, radius: 2.5 },
      { kind, shape: i % 2 ? 'circle' as const : 'box' as const, hx: 2.501, hz: .5, radius: 2.501 },
    ]));
    world.drainEvents();
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 2.5, undefined, 5)).toBe(9);
    expect([...world.destroyedScenery]).toEqual(kinds.map((_, i) => i * 2));
    expect(world.drainEvents().filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: { x: 0, z: 0 }, count: 9 }]);
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 2.5, undefined, 5)).toBe(0);
    syncScenery(world);
    expect(world.drainEvents()).toEqual([]);
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 7.36)).toBe(9);
    expect(world.drainEvents().filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: { x: 0, z: 0 }, count: 9 }]);
  });

  it('emits one beam crush cue only on a new removal, replicates it live, and never replays it on late joins', () => {
    const { world } = encounter();
    world.drainEvents();
    const encoder = new SnapshotEncoder(world), peer = NetMirror.create(options, wire(encoder.full()));
    const prop = world.map.obstacles.find(o => o.kind === 'tent')!;
    expect(destroySceneryHit(world, -1 - prop.id)).toBe(true);
    expect(destroySceneryHit(world, -1 - prop.id)).toBe(false);
    expect(destroySceneryHit(world, 0)).toBe(false);
    syncScenery(world);
    const events = world.drainEvents();
    expect(events.filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: { x: prop.x, z: prop.z }, count: 1 }]);
    world.tick++;
    const frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta(events), events });
    peer.push(frame); peer.catchUp();
    expect(peer.world.drainEvents()).toEqual(events);
    peer.push(frame); peer.catchUp(); expect(peer.world.drainEvents()).toEqual([]);
    const late = NetMirror.create(options, wire(encoder.full()));
    expect(late.world.destroyedScenery.has(prop.id)).toBe(true);
    expect(late.world.drainEvents()).toEqual([]);
  });

  it('actual stomp removes all nine kinds at its hit window and replicates to live mirrors and late joins', () => {
    const { world, boss } = encounter();
    const canonical = JSON.stringify(world.map.obstacles);
    const encoder = new SnapshotEncoder(world), mirror = NetMirror.create(options, wire(encoder.full()));
    for (const kind of kinds) {
      const prop = world.map.obstacles.find(o => o.kind === kind && !world.destroyedScenery.has(o.id))!;
      expect(prop).toBeDefined();
      boss.pos = { x: prop.x, z: prop.z }; boss.action = 'stomp'; boss.crouched = false;
      boss.actionAt = world.time; boss.actionSeq++;
      world.time += BOSS_TIMING.stompHit - .01;
      updateBoss(world, SIM_DT);
      expect(world.destroyedScenery.has(prop.id)).toBe(false);
      world.time += .02; updateBoss(world, SIM_DT);
      expect(world.destroyedScenery.has(prop.id)).toBe(true);
      const version = world.nav.version;
      updateBoss(world, SIM_DT);
      expect(world.nav.version).toBe(version);
      world.tick++;
      const events = world.drainEvents();
      const frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta(events), events });
      mirror.push(frame); mirror.catchUp();
      const late = NetMirror.create(options, wire(encoder.full()));
      for (const peer of [mirror, late]) {
        expect([...peer.world.destroyedScenery]).toEqual([...world.destroyedScenery].sort((a, b) => a - b));
        expect(peer.world.collision.raycast(prop.x, 60, prop.z, 0, -1, 0, 70)?.tag).not.toBe(-1 - prop.id);
        expect(peer.world.map.isBlockedAt(prop.x, prop.z)).toBe(false);
        expect(peer.world.lattice.nodes.map(n => n.blocked)).toEqual(world.lattice.nodes.map(n => n.blocked));
      }
      const peerVersion = mirror.world.nav.version;
      mirror.push(frame); mirror.catchUp(); expect(mirror.world.nav.version).toBe(peerVersion);
    }
    expect(JSON.stringify(world.map.obstacles)).toBe(canonical);
    const fresh = createMatch(options);
    expect(fresh.destroyedScenery.size).toBe(0);
    for (const id of world.destroyedScenery) {
      const prop = fresh.map.obstacles.find(o => o.id === id)!;
      expect(fresh.collision.raycast(prop.x, 60, prop.z, 0, -1, 0, 70)?.tag).toBe(-1 - id);
    }
  });

  it.each(['walk', 'crouchWalk'] as const)('%s landing crushes small props at the actual sole, leaves larger/outside props and preserves altars', gait => {
    const spec = BOSS_GAIT[gait], local = spec.feet[1];
    const landing = { x: local.x * BOSS_MODEL_SCALE, z: local.z * BOSS_MODEL_SCALE + .01 };
    const { world, boss } = fixture([
      { ...landing },
      { ...landing, hx: 2.501 }, // larger than the 5 m ordinary-contact cap
      { x: landing.x - 3.001, z: landing.z }, // beyond the 2.5 m foot plus .5 m prop extent
    ]);
    const altar = world.hearthOf(0)!;
    altar.pos = { ...landing }; altar.hp = 1;
    const target = world.avatarOf(0); target.pos = { x: 0, y: 0, z: gait === 'walk' ? 40 : 20 };
    Object.assign(boss, { pos: { x: 0, z: 0 }, yaw: 0, crouched: gait === 'crouchWalk', stride: 0,
      retaliateId: target.id, retaliateUntil: world.time + 100 });
    world.drainEvents();
    updateBoss(world, SIM_DT);
    expect(boss.action).toBe(gait);
    expect(world.destroyedScenery.size).toBe(0); // no tick damage between actual contacts
    expect(world.drainEvents().filter(e => e.t === 'sceneryCrushed')).toEqual([]);
    boss.pos = { x: 0, z: 0 }; boss.stride = spec.stride * spec.phases[1] - .01;
    updateBoss(world, SIM_DT);
    expect(boss.action).toBe(gait);
    expect([...world.destroyedScenery]).toEqual([0]);
    expect(world.buildings.get(altar.id)).toBe(altar); expect(altar.hp).toBe(1);
    const events = world.drainEvents(), foot = events.find(e => e.t === 'bossFootfall')!;
    expect(foot).toMatchObject({ t: 'bossFootfall', heavy: false });
    if (foot.t !== 'bossFootfall') throw new Error('Expected sole contact');
    expect(foot.pos.x).toBeCloseTo(landing.x, 8); expect(foot.pos.z).toBeCloseTo(landing.z, 8);
    expect(events.filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: foot.pos, count: 1 }]);
    updateBoss(world, SIM_DT);
    expect(world.drainEvents().filter(e => e.t === 'sceneryCrushed')).toEqual([]);
    // A deliberate stomp can now crush the larger prop that the ordinary landing spared.
    boss.pos = { ...landing }; boss.action = 'stomp'; boss.crouched = false;
    boss.actionAt = world.time - BOSS_TIMING.stompHit; boss.actionSeq++;
    updateBoss(world, SIM_DT);
    expect(world.destroyedScenery.has(1)).toBe(true);
  });

  it('larger deliberate stomp contacts stop at the new footprint edge', () => {
    const radius = 4.6 * BOSS_GAMEPLAY_SCALE;
    const { world, boss } = fixture([{ x: 0, z: 0, hx: 4 }, { x: radius + .501, z: 0 }]);
    boss.pos = { x: 0, z: 0 }; boss.action = 'stomp'; boss.actionAt = world.time - BOSS_TIMING.stompHit; boss.actionSeq++;
    updateBoss(world, SIM_DT);
    expect([...world.destroyedScenery]).toEqual([0]);
    expect(world.drainEvents()).toContainEqual({ t: 'sceneryCrushed', pos: { x: 0, z: 0 }, count: 1 });
  });
});
