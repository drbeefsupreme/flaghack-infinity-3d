import { describe, expect, it } from 'vitest';
import { AVATAR, BUILDINGS, SIM_DT } from '../../constants';
import { spawnBuilding } from '../../factory';
import { CollisionWorld } from '../../physics/collision';
import { createMatch } from '../../setup';
import { registerBuildingShape } from '../buildings';
import { cmdThrow } from '../avatars';
import { craftFlag } from '../flags';
import { updateProjectiles } from '../projectiles';
import { stockAt } from '../economy';
import { SnapshotEncoder } from '../../../net/codec';
import { NetMirror } from '../../../net/mirror';

function arena(kind: 'hearth' | 'workshop', full = false) {
  const world = createMatch({ seed: 'station-throws', humans: [0], mode: 'standard', difficulty: 'normal' });
  world.collision = new CollisionWorld();
  world.hippies.clear();
  const altar = world.hearthOf(0)!;
  const station = kind === 'hearth' ? altar : spawnBuilding(world, 'workshop', 0, 0, 1);
  station.pos = { x: 0, z: 0 };
  registerBuildingShape(world, station);
  if (full) for (let i = 0; i < 10; i++) craftFlag(world, station.id);
  const av = world.avatarOf(0);
  av.pos = { x: .25, y: 0, z: -BUILDINGS[kind].radius - 5 };
  av.input.yaw = 0;
  av.input.pitch = -AVATAR.throwPitchBias;
  const flagId = av.carried.at(-1)!;
  const before = world.flags.size;
  world.drainEvents();
  cmdThrow(world, { t: 'throw', faction: 0 });
  return { world, station, altar, av, flagId, before };
}
function fly(world: ReturnType<typeof arena>['world']) {
  for (let i = 0; i < 120 && world.projectiles.size; i++) {
    world.time += SIM_DT; world.tick++;
    updateProjectiles(world, SIM_DT);
  }
}

describe('throwing Flags into camp storage', () => {
  it.each(['hearth', 'workshop'] as const)('deposits a real throw at own %s and replicates the same Flag', kind => {
    const { world, station, av, flagId, before } = arena(kind);
    expect(world.flags.get(flagId)?.state).toBe('flying');
    const encoder = new SnapshotEncoder(world);
    const live = NetMirror.create(world.options, encoder.full());
    fly(world);
    const events = world.drainEvents();
    live.push({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta(events), events });
    live.catchUp();
    expect(live.world.flags.get(flagId)).toMatchObject({ state: 'stock', holder: station.id });
    expect(live.world.projectiles.size).toBe(0);
    expect(world.flags.get(flagId)).toMatchObject({ state: 'stock', holder: station.id, owner: 0 });
    expect(world.flags.size).toBe(before);
    expect(world.projectiles.size).toBe(0);
    expect(av.carried).not.toContain(flagId);
    expect(events.filter(e => e.t === 'flagLanded')).toHaveLength(1);
    updateProjectiles(world, SIM_DT);
    expect(world.flags.size).toBe(before);
    const mirror = NetMirror.create(world.options, new SnapshotEncoder(world).full());
    expect(mirror.world.flags.get(flagId)).toMatchObject({ state: 'stock', holder: station.id, owner: 0 });
    expect(mirror.world.projectiles.size).toBe(0);
  });
  it('sends a throw hitting a full Workshop to its altar without exceeding 10', () => {
    const { world, station, altar, flagId, before } = arena('workshop', true);
    fly(world);
    expect(stockAt(world, station.id)).toBe(10);
    expect(world.flags.get(flagId)).toMatchObject({ state: 'stock', holder: altar.id });
    expect(world.flags.size).toBe(before);
  });
  it('catches a fast swept throw instead of tunnelling through the Workshop', () => {
    const { world, station, flagId } = arena('workshop');
    const projectile = [...world.projectiles.values()][0];
    projectile.vel.z = 2000;
    updateProjectiles(world, SIM_DT);
    expect(world.flags.get(flagId)).toMatchObject({ state: 'stock', holder: station.id });
    expect(world.projectiles.size).toBe(0);
  });
  it('keeps the first obstruction ahead of the Workshop', () => {
    const { world, flagId } = arena('workshop');
    world.collision.addCylinder(0, -4.5, .7, 0, 5, -999);
    fly(world);
    expect(world.flags.get(flagId)?.state).toBe('loose');
    expect(world.flags.get(flagId)?.holder).toBe(-1);
  });

  it('does not use an unfinished rack, but preserves access to completed disabled storage', () => {
    for (const unfinished of [false, true]) {
      const { world, station, flagId } = arena('workshop');
      if (unfinished) station.built = .5;
      else { station.disabled = true; station.hp = 0; }
      fly(world);
      expect(world.flags.get(flagId)?.state).toBe(unfinished ? 'loose' : 'stock');
      expect(world.projectiles.size).toBe(0);
    }
  });

  it('does not deposit in an enemy Workshop or overfill one after losing the altar', () => {
    for (const enemy of [false, true]) {
      const { world, station, altar, flagId, before } = arena('workshop', !enemy);
      if (enemy) station.faction = 1;
      else { world.buildings.delete(altar.id); world.factions[0].hearthIds = []; }
      fly(world);
      expect(world.flags.get(flagId)?.state).toBe('loose');
      expect(world.projectiles.size).toBe(0);
      expect(world.flags.size).toBe(before);
      expect(stockAt(world, station.id)).toBe(enemy ? 0 : 10);
    }
  });
});
