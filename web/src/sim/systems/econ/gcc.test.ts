import { describe, expect, it } from 'vitest';
import { GCC } from '../../constants';
import { spawnHippie } from '../../factory';
import { cmdGcc, updateGcc } from '../gcc';
import { canPlantAt, dropLoose, nearestPlantableNode } from '../flags';
import { eventsOf, newMatch, placeAvatar, run } from './testkit';
import type { Harness } from './testkit';

/** Stand the vexillomancer beside its GCC. */
function atTheCart(h: Harness): void {
  const g = h.world.gccOf(0)!;
  placeAvatar(h.world, 0, g.pos.x + 3, g.pos.z);
}

describe('gcc', () => {
  it.each(['dialectics', 'simulacra'] as const)('rejects retired %s commands without changing units, flags or resources', (action) => {
    const h = newMatch();
    const { world } = h;
    atTheCart(h);
    const g = world.gccOf(0)!;
    const enemy = spawnHippie(world, 1, { x: g.pos.x + 5, z: g.pos.z });
    const nodes = world.lattice.nodes.filter((n) => canPlantAt(world, n.id, 0)).slice(0, 2).map((n) => n.id);
    const flags = [...world.flags.values()].map((flag) => ({ ...flag }));
    const quiver = [...world.avatarOf(0).carried];
    const cooldowns = { ...world.factions[0].cooldowns };
    cmdGcc(world, { t: 'gcc', faction: 0, action, target: -1, nodes });
    expect(enemy.faction).toBe(1);
    expect([...world.flags.values()]).toEqual(flags);
    expect(world.avatarOf(0).carried).toEqual(quiver);
    expect(world.avatarOf(0).action.kind).toBe('idle');
    expect(world.factions[0].cooldowns).toEqual(cooldowns);
    const events = world.drainEvents();
    expect(events.some((e) => e.t === 'gccAction')).toBe(false);
    expect(events.some((e) => e.t === 'rejected' && e.reason.includes('no longer has active abilities'))).toBe(true);
  });

  it('rejects removed powers through the command queue too', () => {
    const h = newMatch();
    for (const action of ['dialectics', 'simulacra'] as const) {
      h.world.submit({ t: 'gcc', faction: 0, action, target: -1, nodes: [] });
    }
    run(h, 1 / 60);
    expect(eventsOf(h, 'rejected').filter((e) => e.reason.includes('no longer has active abilities'))).toHaveLength(2);
    expect(eventsOf(h, 'gccAction')).toHaveLength(0);
  });

  it('cancels an old in-flight Dialectics channel without converting its targets', () => {
    const h = newMatch();
    const { world } = h;
    const g = world.gccOf(0)!;
    const av = world.avatarOf(0);
    const enemy = spawnHippie(world, 1, { x: g.pos.x + 5, z: g.pos.z });
    av.action = { kind: 'channel', what: 'dialectics', t: 0, dur: 3 };
    g.gcc!.channelUntil = world.time + 3;
    updateGcc(world, 1 / 60);
    expect(av.action.kind).toBe('idle');
    expect(g.gcc!.channelUntil).toBe(0);
    expect(enemy.faction).toBe(1);
    expect(world.drainEvents().some((e) => e.t === 'gccAction')).toBe(false);
  });

  it('Flag Repair re-plants a loose own Flag near the cart', () => {
    const h = newMatch();
    const { world } = h;
    const g = world.gccOf(0)!;
    const av = world.avatarOf(0);
    const flagId = av.carried[0];
    // A metre from the free node nearest a spot 9 m from the cart: the home ring and the
    // buildings' corners take the nodes right around it.
    const node = world.lattice.nodes[nearestPlantableNode(world, { x: g.pos.x + 8, z: g.pos.z + 4 }, 20, 0)];
    dropLoose(world, flagId, { x: node.x + 1, y: 0, z: node.z });
    expect(world.flags.get(flagId)!.state).toBe('loose');
    run(h, GCC.repairInterval + 0.1);
    const flag = world.flags.get(flagId)!;
    expect(flag.state).toBe('planted');
    expect(flag.owner).toBe(0);
  });
});
