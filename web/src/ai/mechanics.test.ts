import { describe, expect, it } from 'vitest';
import { AVATAR, SIM_DT } from '../sim/constants';
import { spawnBuilding, spawnCrystal, spawnFlag, spawnHippie } from '../sim/factory';
import { createMatch } from '../sim/setup';
import { normalizeMatch } from '../sim/matchSettings';
import { Simulation } from '../sim/simulation';
import { cmdPull, updateAvatars } from '../sim/systems/avatars';
import { canPlantAt, dropLoose, plantFlag } from '../sim/systems/flags';
import { NEUTRAL } from '../sim/types';
import { manageBuilds } from './builder';
import { Brain } from './brain';
import { manageLabour } from './labour';
import { assaultCost, claimable, perceive, Scheduler } from './perception';
import { pilotTick } from './pilot';
import { usePowers } from './powers';

function fixture() {
  const world = createMatch({ seed: 'ai-mechanics', difficulty: 'normal', humans: [0], mode: 'standard', match: normalizeMatch() });
  world.tide.nextAt = Infinity;
  const b = new Brain(world, 0, 0);
  perceive(b, new Scheduler());
  b.pilot.taskAt = -Infinity;
  return { world, b, sim: new Simulation(world), av: world.avatarOf(0) };
}

function enemyFlag(world: ReturnType<typeof createMatch>) {
  return [...world.flags.values()].find(f => f.owner === 1 && f.state === 'planted')!;
}

describe('AI adapts to shared recruitment and lightning defenses', () => {
  it('never requests retired GCC abilities even with rivals and open plan nodes nearby', () => {
    const { world, b, av } = fixture();
    const cart = world.gccOf(0)!;
    av.pos = { ...cart.pos, y: 0 };
    spawnHippie(world, 1, { x: cart.pos.x + 3, z: cart.pos.z });
    spawnHippie(world, 2, { x: cart.pos.x - 3, z: cart.pos.z });
    for (const n of world.lattice.nodes.filter((n) => canPlantAt(world, n.id, 0)).slice(0, 2)) {
      world.factions[0].plan.add(n.id);
    }
    perceive(b, new Scheduler());
    usePowers(b);
    pilotTick(b);
    expect(world.takeCommands().some((c) => c.t === 'gcc')).toBe(false);
    expect(b.pilot.task.kind).not.toBe('gcc');
  });

  it('actively hands a Flag to a visible neutral instead of waiting for camp respawns', () => {
    const { world, b, sim, av } = fixture();
    for (const h of [...world.hippies.values()]) if (h.faction === 0) world.hippies.delete(h.id);
    const spot = world.nav.nearestWalkable(b.view.hx + 35, b.view.hz);
    av.pos = { ...spot, y: 0 };
    const h = spawnHippie(world, NEUTRAL, { x: spot.x + 1, z: spot.z });
    perceive(b, new Scheduler());
    expect(b.view.visibleNeutrals).toContain(h.id);
    pilotTick(b);
    sim.step();
    expect(h.faction).toBe(0);
    expect(h.carryingFlag).not.toBe(-1);
    expect(world.drainEvents().some(e => e.t === 'recruited' && e.hippieId === h.id && e.via === 'hand')).toBe(true);
  });

  it('does not actively recruit beyond attention capacity', () => {
    const { world, b, av } = fixture();
    for (let i = 0; i < b.view.popCap; i++) spawnHippie(world, 0, av.pos);
    const h = spawnHippie(world, NEUTRAL, { x: av.pos.x + 1, z: av.pos.z });
    perceive(b, new Scheduler());
    pilotTick(b);
    expect(b.pilot.task.kind).not.toBe('recruit');
    expect(h.faction).toBe(NEUTRAL);
  });

  it('collects grounded Flags in throw mode and stops sprinting', () => {
    const { world, b, sim, av } = fixture();
    const flag = av.carried[0];
    dropLoose(world, flag, { ...av.pos, x: av.pos.x + 1 });
    b.view.visibleNeutrals.length = 0;
    pilotTick(b);
    expect(b.pilot.task.kind).toBe('pickup');
    sim.step();
    expect(av.input.throwMode).toBe(true);
    expect(av.input.sprint).toBe(false);
    expect(av.carried).toContain(flag);
  });

  it('finishes a doubled pull despite the normal task rethink cadence', () => {
    const { world, b, sim, av } = fixture();
    const fl = enemyFlag(world);
    av.pos = { ...fl.pos };
    const c = spawnCrystal(world, fl.node, 1, [fl.node]);
    c.growth = 1;
    // Isolate the pilot/channel from Crystal geometry maintenance and other actors.
    cmdPull(world, { t: 'pull', faction: 0, flagId: fl.id });
    b.pilot.task = { kind: 'pull', flagId: fl.id };
    b.pilot.taskAt = -Infinity;
    for (let i = 0; i < Math.round(AVATAR.pullEnemyTime * 1.5 / SIM_DT); i++) {
      pilotTick(b);
      expect(b.pilot.task).toEqual({ kind: 'pull', flagId: fl.id });
      world.time += SIM_DT;
      world.tick++;
      updateAvatars(world, SIM_DT);
    }
    expect(fl.state).toBe('planted');
    for (let i = 0; i < Math.round(AVATAR.pullEnemyTime * 0.5 / SIM_DT) + 1; i++) {
      pilotTick(b);
      world.time += SIM_DT;
      world.tick++;
      updateAvatars(world, SIM_DT);
    }
    expect(fl.state).toBe('carried');
  });

  it('sends a demolition squad against a Ward disrupting its breach, then releases it', () => {
    const { world, b, sim } = fixture();
    const fl = enemyFlag(world);
    const ward = spawnBuilding(world, 'ward', 1, world.hearthOf(1)!.facet, 1);
    ward.pos = { x: fl.pos.x + 5, z: fl.pos.z };
    b.view.critical = [fl.id];
    manageLabour(b);
    sim.step();
    const squad = b.wardOrders.get(ward.id)!;
    expect(squad).toHaveLength(2);
    for (const id of squad) expect(world.hippies.get(id)?.order).toEqual({ kind: 'attack', target: ward.id });
    ward.disabled = true;
    manageLabour(b);
    sim.step();
    expect(b.wardOrders.has(ward.id)).toBe(false);
    for (const id of squad) expect(world.hippies.get(id)?.order).not.toEqual({ kind: 'attack', target: ward.id });
  });

  it('prices Crystal-protected Flags without firing lightning while planning', () => {
    const { world, b } = fixture();
    const fl = enemyFlag(world);
    const r = b.view.rivals.find(r => r.id === 1)!;
    const before = assaultCost(world, 0, r)(fl.node);
    const crystal = spawnCrystal(world, fl.node, 1, [fl.node]);
    crystal.growth = 1;
    // The focus itself cannot be planted; move the fixture focus off the target Flag.
    crystal.node = world.lattice.nodes.find(n => n.id !== fl.node)!.id;
    world.drainEvents();
    expect(assaultCost(world, 0, r)(fl.node)).toBeGreaterThan(before);
    expect(world.drainEvents()).toEqual([]);
  });

  it('expands attention capacity beyond the former three-circle limit without duplicating pending circles', () => {
    const { world, b, sim, av } = fixture();
    for (let i = 0; i < 3; i++) {
      const circle = spawnBuilding(world, 'drumcircle', 0, world.hearthOf(0)!.facet, 1);
      circle.pos = { x: b.view.hx + 80 + i * 10, z: b.view.hz };
    }
    for (const h of [...world.hippies.values()]) if (h.faction === 0) world.hippies.delete(h.id);
    for (let i = 0; i < 32; i++) spawnHippie(world, 0, av.pos);
    world.factions[0].lumber = 1000;
    perceive(b, new Scheduler());
    manageBuilds(b);
    sim.step();
    expect(world.buildingsOf(0, 'drumcircle')).toHaveLength(4);
    // Reserve the capacity of that circle while construction finishes.
    perceive(b, new Scheduler());
    manageBuilds(b);
    sim.step();
    expect(world.buildingsOf(0, 'drumcircle')).toHaveLength(4);
  });

  it('can reclaim building-corner Flags when structure blocking is off', () => {
    const { world } = fixture();
    const node = world.lattice.facets[world.hearthOf(1)!.facet].nodes.find(n => canPlantAt(world, n, 1))!;
    const pos = world.lattice.nodes[node];
    const fl = spawnFlag(world, { state: 'carried', owner: 1, holder: -1, pos: { x: pos.x, y: 0, z: pos.z } });
    expect(plantFlag(world, fl.id, node, 1, -1)).toBe(true);
    expect(claimable(world, 0, node)).toBe(true);
    world.options.match!.structuresBlockFlagPlacement = true;
    expect(claimable(world, 0, node)).toBe(false);
  });
});



describe('AI pilot on domed ground', () => {
  it('plants a nearby planned node on the elevated interior instead of treating ground as airborne', () => {
    const { world, b, av, sim } = fixture();
    const node = world.lattice.nodes.find(n => Math.hypot(n.x, n.z) < 50 && canPlantAt(world, n.id, 0))!;
    expect(node).toBeDefined();
    av.pos = { x: node.x + .5, y: world.collision.groundHeight(node.x + .5, node.z), z: node.z };
    expect(av.pos.y).toBeGreaterThan(1);
    b.pilot.task = { kind: 'plant', node: node.id };
    b.pilot.taskAt = world.time;
    pilotTick(b);
    const commands = world.takeCommands();
    expect(commands.some(c => c.t === 'plant' && c.node === node.id)).toBe(true);
    for (const c of commands) world.submit(c);
    sim.step();
    const planted = [...world.flags.values()].find(f => f.state === 'planted' && f.node === node.id)!;
    expect(planted).toBeDefined();
    expect(planted.pos.y).toBeCloseTo(world.collision.groundHeight(node.x, node.z), 8);
  });
});
