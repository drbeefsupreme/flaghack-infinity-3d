import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_RADIUS } from '../boss';
import { HIPPIE, SIM_DT } from '../constants';
import { spawnFlag, spawnHippie } from '../factory';
import { normalizeMatch } from '../matchSettings';
import { createMatch } from '../setup';
import type { EffectKind, HippieOrder } from '../types';
import { applyEffect, speedMultiplier } from './effects';
import { cmdOrder, updateHippies } from './hippies';
import { brainOf } from './units/brain';
import { unitsState } from './units/state';

function setup() {
  const world = createMatch({ seed: 'allied-boss-orders', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  world.time = 245;
  world.effigyRevealedAt = 230;
  world.boss = bossFixture();
  world.boss.pos = { x: 0, z: 60 };
  const h = spawnHippie(world, 0, { x: 20, z: 60 });
  h.job = 'defend';
  unitsState(world).nextAllocAt.fill(Infinity);
  world.drainEvents();
  return { world, h, b: brainOf(h), boss: world.boss };
}

describe('allied boss combat', () => {
  it.each(['move', 'defend'] as const)('respects an explicit %s order away from the boss', kind => {
    const { world, h, b } = setup();
    const order: HippieOrder = kind === 'move'
      ? { kind, to: { x: 40, z: 60 } } : { kind, at: { x: 40, z: 60 } };
    cmdOrder(world, { t: 'order', faction: 0, hippies: [h.id], order });
    updateHippies(world, SIM_DT);
    expect(h.order).toEqual(order);
    expect(b.task).not.toBe('engage');
    expect(h.status).not.toBe('fighting');
  });

  it('keeps a follower with its leader when the leader has left boss range', () => {
    const { world, h, b } = setup();
    const av = world.avatarOf(0);
    av.pos = { x: 60, y: 0, z: 60 };
    cmdOrder(world, { t: 'order', faction: 0, hippies: [h.id], order: { kind: 'follow', avatarId: av.id } });
    updateHippies(world, SIM_DT);
    expect(b.task).toBe('follow');
    expect(h.status).toBe('following');
  });

  it('lets an autonomous defender return a retrieved flag instead of abandoning delivery', () => {
    const { world, h, b } = setup();
    const fl = spawnFlag(world, { state: 'carried', owner: 0, holder: h.id, pos: { ...h.pos, y: 0 } });
    h.carryingFlag = fl.id;
    updateHippies(world, SIM_DT);
    expect(b.task).toBe('stow');
    expect(h.carryingFlag).toBe(fl.id);
  });

  it('still supports direct boss attacks and local follower defense', () => {
    for (const follow of [false, true]) {
      const { world, h, b, boss } = setup();
      const av = world.avatarOf(0);
      av.pos = { x: 10, y: 0, z: 60 };
      h.order = follow ? { kind: 'follow', avatarId: av.id } : { kind: 'attack', target: boss.id };
      updateHippies(world, SIM_DT);
      expect(b.task).toBe('engage');
      expect(b.target).toBe(boss.id);
    }
  });

  it('resumes following immediately after the leader leaves an ongoing fight', () => {
    const { world, h, b, boss } = setup();
    const av = world.avatarOf(0);
    av.pos = { x: 10, y: 0, z: 60 };
    h.order = { kind: 'follow', avatarId: av.id };
    updateHippies(world, SIM_DT);
    expect(b.target).toBe(boss.id);
    av.pos.x = 60;
    world.time += SIM_DT;
    updateHippies(world, SIM_DT);
    expect(b.task).toBe('follow');
    expect(h.status).toBe('following');
    expect(h.order).toEqual({ kind: 'follow', avatarId: av.id });
  });

  it.each([null, 'march', 'saffron', 'exhausted'] as (EffectKind | null)[])(
    'uses the existing melee speed multiplier against the boss: %s', effect => {
      const { world, h, b, boss } = setup();
      h.pos = { x: BOSS_RADIUS + 0.5, z: 60 };
      h.order = { kind: 'attack', target: boss.id };
      if (effect) applyEffect(world, h, effect, 10, 0.5);
      const hp = boss.hp;
      updateHippies(world, SIM_DT);
      expect(boss.hp).toBe(hp - HIPPIE.shoveDamage);
      expect(b.nextShoveAt - world.time).toBeCloseTo(HIPPIE.shoveInterval / Math.max(0.25, speedMultiplier(world, h)));
    },
  );
});
