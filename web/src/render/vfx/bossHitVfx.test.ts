import { describe, expect, it, vi } from 'vitest';
import { VfxRenderer } from './vfxRenderer';
import type { GameEvent } from '../../sim/events';
import { createMatch } from '../../sim/setup';
import { normalizeMatch } from '../../sim/matchSettings';
import { bossFixture } from '../../../tests/bossFixture';
import { damageMelee } from '../../sim/systems/meleeImpact';
import { damageEntity } from '../../sim/systems/combat';
import { spawnHippie } from '../../sim/factory';

function renderer(bossId: number) {
  const hit = vi.fn(), melee = vi.fn(), shake = vi.fn();
  const stub = { ctx: { world: { boss: { id: bossId } } }, fx: { hit }, meleeImpacts: { onEvent: melee },
    syncClock: vi.fn(), isPlayerAvatar: (id: number) => id === 12, spend: () => true, groundY: () => 0, shake };
  const send = (event: GameEvent) => VfxRenderer.prototype.onEvent.call(stub as unknown as VfxRenderer, event);
  return { hit, melee, shake, send };
}

describe('boss contact VFX without center-of-body sparks', () => {
  it('removes only generic boss-center sparks and keeps normal target hits and player feedback', () => {
    const fx = renderer(99);
    fx.send({ t: 'hit', target: 99, by: 12, amount: 25, pos: { x: 10, y: 4, z: 20 } });
    expect(fx.hit).not.toHaveBeenCalled(); expect(fx.shake).toHaveBeenCalledTimes(1);
    fx.send({ t: 'hit', target: 17, by: 12, amount: 25, pos: { x: 10, y: 1, z: 20 } });
    expect(fx.hit).toHaveBeenCalledExactlyOnceWith(10, 2, 20, false);
  });

  it('a mob of melee hits plus other damage never emits the duplicate between-leg spark burst', () => {
    const world = createMatch({ seed: 'boss-hit-vfx', difficulty: 'normal', mode: 'standard', humans: [0], match: normalizeMatch({ maxSignifiers: 0 }) });
    world.boss = bossFixture(); world.boss.pos = { x: 0, z: 0 }; world.drainEvents();
    const fx = renderer(world.boss.id), initialHp = world.boss.hp;
    for (let i = 0; i < 24; i++) {
      const h = spawnHippie(world, 0, { x: Math.sin(i) * 5, z: Math.cos(i) * 5 });
      damageMelee(world, world.boss.id, 5, h.id);
    }
    damageEntity(world, world.boss.id, 10, -1); // Other damage (e.g. crystal lightning).
    const events = world.drainEvents();
    expect(events.filter(e => e.t === 'hit')).toHaveLength(25);
    for (const event of events) fx.send(event);
    expect(fx.hit).not.toHaveBeenCalled();
    expect(fx.melee).toHaveBeenCalledTimes(24);
    expect(world.boss.hp).toBe(initialHp - 130);
  });
});
