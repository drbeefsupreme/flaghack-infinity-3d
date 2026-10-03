import { describe, expect, it } from 'vitest';
import { IMPLIED_MAX_ORDER } from '../sim/constants';
import { spawnFlag } from '../sim/factory';
import { criticalNodes } from '../sim/lattice/geometry';
import { planEnclosure } from '../sim/lattice/planner';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { canPlantAt, depositToStock, plantFlag } from '../sim/systems/flags';
import { geometryOwners } from '../sim/systems/survey';
import type { EntityId, FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { createAi } from '.';
import { SKILLS } from './persona';

/** Enclose `victim`'s Hearth with a fresh loop of `attacker` Flags, its own home ring lifted. */
function stageContainment(world: World, victim: FactionId, attacker: FactionId): void {
  const hearth = world.hearthOf(victim);
  if (!hearth) throw new Error('no hearth');
  for (const fl of [...world.flags.values()]) {
    if (fl.state === 'planted' && fl.owner === victim) depositToStock(world, fl.id, hearth.id);
  }
  const lat = world.lattice;
  const loop = planEnclosure(lat, {
    x: hearth.pos.x,
    z: hearth.pos.z,
    minRadius: 24,
    cost: (n) => (canPlantAt(world, n, attacker) ? 1 : Infinity),
  });
  if (!loop) throw new Error('no loop');
  for (const n of loop) {
    const node = lat.nodes[n];
    const fl = spawnFlag(world, { state: 'carried', owner: attacker, holder: -1, pos: { x: node.x, y: 0, z: node.z } });
    plantFlag(world, fl.id, n, attacker, -1);
  }
}

/** Hippies of `f` ordered to pull one of the given Flags. */
function pullersOn(world: World, f: FactionId, flags: ReadonlySet<EntityId>): number {
  let n = 0;
  for (const h of world.hippies.values()) if (h.faction === f && h.order?.kind === 'pull' && flags.has(h.order.flagId)) n++;
  return n;
}

describe('NPC defence', () => {
  it('notices a closed loop after its reaction delay, then holds the Hearth and sends hands at the Flags the loop hangs on', () => {
    const world = createMatch({ seed: 'ai-defend', difficulty: 'normal', allAi: true });
    const victim: FactionId = 0;
    const attacker: FactionId = 1;
    stageContainment(world, victim, attacker);
    const sim = new Simulation(world);
    const ai = createAi(world, [victim]);
    const hearth = world.hearthOf(victim);
    if (!hearth) throw new Error('no hearth');
    const critical = new Set<EntityId>();
    for (const n of criticalNodes(world.lattice, geometryOwners(world), attacker, hearth.facet, IMPLIED_MAX_ORDER)) {
      critical.add(world.survey.nodeFlag[n]);
    }
    // Peak pullers on the loop's Flags, the defend posture and the vexillomancer's errand seen
    // while running.
    let pullers = 0;
    let defended = false;
    let held = false;
    const run = (seconds: number): void => {
      for (let i = 0; i < 60 * seconds; i++) {
        ai.update();
        sim.step();
        world.drainEvents();
        const brain = ai.inspect(victim);
        pullers = Math.max(pullers, pullersOn(world, victim, critical));
        if (brain?.posture === 'defend') defended = true;
        if (brain?.pilot.task.kind === 'hold') held = true;
      }
    };

    // Within normal difficulty's reaction delay nobody has been sent yet.
    run(SKILLS.normal.react - 1);
    expect(pullers).toBe(0);
    expect(defended).toBe(false);

    run(4);
    expect(defended).toBe(true);
    expect(pullers).toBeGreaterThanOrEqual(2);
    // The loop stands farther out than a quick dash: the vexillomancer holds the Hearth.
    expect(held).toBe(true);
  });

  it('breaks the loop and frees its Hearth', () => {
    const world = createMatch({ seed: 'ai-defend', difficulty: 'normal', allAi: true });
    stageContainment(world, 0, 1);
    const sim = new Simulation(world);
    const ai = createAi(world, [0]);
    let freed = false;
    for (let i = 0; i < 60 * 45 && !freed; i++) {
      ai.update();
      sim.step();
      for (const e of world.drainEvents()) if (e.t === 'hearthStage' && e.faction === 0 && (e.stage === 'safe' || e.stage === 'threatened')) freed = true;
    }
    expect(freed).toBe(true);
    expect(world.factions[0].alive).toBe(true);
  });
});
