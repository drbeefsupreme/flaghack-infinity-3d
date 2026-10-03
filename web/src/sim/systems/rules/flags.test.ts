import { describe, expect, it } from 'vitest';
import { AVATAR, GCC } from '../../constants';
import { spawnProjectile } from '../../factory';
import {
  canPlantAt,
  craftFlag,
  depositToStock,
  dropLoose,
  giveFlag,
  nearestPlantableNode,
  plantFlag,
  plantSimulacrum,
  pullFlag,
  takeFromStock,
} from '../flags';
import { eventsOf, flagProblems, must, newMatch, runRules } from './testWorld';

describe('Flag lifecycle bookkeeping', () => {
  it('conserves every Flag through plant, pull, steal, throw-land, stock and drop', () => {
    const world = newMatch('flags-a');
    const total = world.flags.size;
    const s = world.survey;
    const av0 = world.avatarOf(0);
    const av1 = world.avatarOf(1);
    const hearth0 = must(world.hearthOf(0), 'hearth 0');
    const checkpoint = (): void => {
      expect(flagProblems(world)).toEqual([]);
      expect(world.flags.size).toBe(total);
    };

    // Plant from the quiver.
    const node = nearestPlantableNode(world, av0.pos, 30, 0);
    expect(node).toBeGreaterThanOrEqual(0);
    const a = av0.carried[0];
    expect(plantFlag(world, a, node, 0, av0.id)).toBe(true);
    expect(av0.carried).not.toContain(a);
    expect(s.nodeFlag[node]).toBe(a);
    expect(s.nodeFlagOwner[node]).toBe(0);
    expect(s.dirty).toBe(true);
    expect(canPlantAt(world, node, 1)).toBe(false);
    expect(plantFlag(world, av0.carried[0], node, 0, av0.id)).toBe(false);
    expect(world.factions[0].stats.flagsPlanted).toBe(1);
    checkpoint();

    // Pull it back (own Flag) into the quiver.
    expect(pullFlag(world, a, av0.id)).toBe(true);
    expect(av0.carried).toContain(a);
    expect(s.nodeFlag[node]).toBe(-1);
    expect(world.factions[0].stats.flagsPulled).toBe(1);
    expect(world.factions[0].stats.flagsStolen).toBe(0);
    checkpoint();

    // An enemy Flag planted near faction 0's hippie is stolen by it.
    const hippie = world.hippiesOf(0)[0];
    const enemyNode = nearestPlantableNode(world, hippie.pos, 30, 1);
    const b = av1.carried[0];
    expect(plantFlag(world, b, enemyNode, 1, av1.id)).toBe(true);
    expect(pullFlag(world, b, hippie.id)).toBe(true);
    expect(hippie.carryingFlag).toBe(b);
    expect(must(world.flags.get(b), 'flag b').owner).toBe(0);
    expect(world.factions[0].stats.flagsStolen).toBe(1);
    checkpoint();

    // Full hands: a second pull knocks the Flag loose where it stood.
    const c = av1.carried[0];
    const cNode = nearestPlantableNode(world, hippie.pos, 30, 1);
    expect(plantFlag(world, c, cNode, 1, av1.id)).toBe(true);
    expect(pullFlag(world, c, hippie.id)).toBe(true);
    const loose = must(world.flags.get(c), 'flag c');
    expect(loose.state).toBe('loose');
    expect(loose.owner).toBe(1);
    expect(hippie.carryingFlag).toBe(b);
    // ...and a loose Flag nobody can hold stays put.
    expect(pullFlag(world, c, hippie.id)).toBe(false);
    checkpoint();

    // The hippie hauls its stolen Flag home.
    depositToStock(world, b, hearth0.id);
    expect(hippie.carryingFlag).toBe(-1);
    expect(must(world.flags.get(b), 'flag b').state).toBe('stock');
    expect(world.stockOf(hearth0.id).map((f) => f.id)).toContain(b);
    checkpoint();

    // Throw → land: Units hand the Flag to a projectile; landing plants it or drops it loose.
    const t = av0.carried[0];
    const proj = spawnProjectile(world, t, av0.id, 0, av0.pos, { x: 0, y: 5, z: 10 });
    av0.carried.splice(av0.carried.indexOf(t), 1);
    const thrown = must(world.flags.get(t), 'thrown flag');
    thrown.state = 'flying';
    thrown.holder = proj.id;
    const landing = nearestPlantableNode(world, { x: av0.pos.x + 9, z: av0.pos.z }, AVATAR.throwSnapRadius + 8, 0);
    expect(plantFlag(world, t, landing, 0, av0.id)).toBe(true);
    world.projectiles.delete(proj.id);
    checkpoint();
    const t2 = av0.carried[0];
    av0.carried.splice(av0.carried.indexOf(t2), 1);
    const thrown2 = must(world.flags.get(t2), 'thrown flag 2');
    thrown2.state = 'flying';
    thrown2.holder = proj.id;
    dropLoose(world, t2, { x: 3, y: 0, z: 4 });
    expect(thrown2.state).toBe('loose');
    expect(thrown2.pos.x).toBe(3);
    checkpoint();

    // Restock from the Hearth, hand-over to a hippie, crafting adds exactly one Flag.
    const before = av0.carried.length;
    const fromStock = must(takeFromStock(world, hearth0.id, av0.id), 'stock flag');
    expect(av0.carried.length).toBe(before + 1);
    expect(fromStock.owner).toBe(0);
    expect(takeFromStock(world, hearth0.id, av1.id)).toBeNull();
    expect(giveFlag(world, fromStock.id, hippie.id)).toBe(true);
    expect(hippie.carryingFlag).toBe(fromStock.id);
    expect(av0.carried).not.toContain(fromStock.id);
    checkpoint();
    const crafted = must(craftFlag(world, hearth0.id), 'crafted');
    expect(crafted.state).toBe('stock');
    expect(world.flags.size).toBe(total + 1);
    expect(eventsOf(world.drainEvents(), 'flagCrafted').map((e) => e.flagId)).toEqual([crafted.id]);
    expect(flagProblems(world)).toEqual([]);
  });

  it('caps the quiver and drops a KO quiver loose', () => {
    const world = newMatch('flags-b');
    const av = world.avatarOf(2);
    const hearth = must(world.hearthOf(2), 'hearth');
    while (av.carried.length < AVATAR.quiver) must(takeFromStock(world, hearth.id, av.id), 'stock');
    expect(takeFromStock(world, hearth.id, av.id)).toBeNull();
    const quiver = av.carried.slice();
    for (const id of quiver) dropLoose(world, id, { x: av.pos.x, y: 0, z: av.pos.z });
    expect(av.carried).toEqual([]);
    for (const id of quiver) expect(must(world.flags.get(id), 'flag').state).toBe('loose');
    expect(flagProblems(world)).toEqual([]);
  });

  it('collapses a simulacrum when an enemy comes near one of its nodes', () => {
    const world = newMatch('flags-c');
    const s = world.survey;
    const av = world.avatarOf(0);
    // Two free nodes far apart in neutral ground.
    const a = nearestPlantableNode(world, { x: -100, z: 0 }, 20, 0);
    const b = nearestPlantableNode(world, { x: 0, z: 100 }, 20, 0);
    const id = av.carried[0];
    expect(plantSimulacrum(world, id, a, b, 0, av.id)).toBe(true);
    expect(s.nodeFlag[a]).toBe(id);
    expect(s.nodeFlag[b]).toBe(id);
    expect(av.carried).not.toContain(id);
    expect(flagProblems(world)).toEqual([]);
    runRules(world, 0.1);
    expect(s.holder[a]).toBe(0);
    expect(s.holder[b]).toBe(0);

    // An enemy hippie walks up to node b.
    const enemy = world.hippiesOf(1)[0];
    const nb = world.lattice.nodes[b];
    enemy.pos.x = nb.x + GCC.simulacraObserveRadius - 1;
    enemy.pos.z = nb.z;
    const events = runRules(world, 0.1);
    const collapse = eventsOf(events, 'simulacrumCollapsed');
    expect(collapse).toHaveLength(1);
    const kept = collapse[0].kept;
    const fl = must(world.flags.get(id), 'simulacrum');
    expect(fl.altNode).toBe(-1);
    expect(fl.node).toBe(kept);
    expect(s.nodeFlag[collapse[0].vanished]).toBe(-1);
    expect(s.nodeFlag[kept]).toBe(id);
    expect(flagProblems(world)).toEqual([]);
  });

  it('never lets an eliminated faction plant', () => {
    const world = newMatch('flags-d');
    const av = world.avatarOf(3);
    const node = nearestPlantableNode(world, av.pos, 30, 3);
    expect(canPlantAt(world, node, 3)).toBe(true);
    world.factions[3].alive = false;
    expect(canPlantAt(world, node, 3)).toBe(false);
    expect(plantFlag(world, av.carried[0], node, 3, av.id)).toBe(false);
  });
});
