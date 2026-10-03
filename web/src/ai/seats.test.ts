import { describe, expect, it } from 'vitest';
import type { Command } from '../sim/commands';
import { spawnFlag } from '../sim/factory';
import { planEnclosure } from '../sim/lattice/planner';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { canPlantAt, plantFlag } from '../sim/systems/flags';
import { FACTION_IDS } from '../sim/types';
import type { BuildingKind, FactionId, MatchOptions } from '../sim/types';
import type { World } from '../sim/world';
import { createAi } from '.';
import type { AiController } from '.';

/** Every command submitted to the world from now on, in order: what the seats actually did. */
function recordCommands(world: World): Command[] {
  const log: Command[] = [];
  const submit = world.submit.bind(world);
  world.submit = (c: Command) => {
    log.push(c);
    submit(c);
  };
  return log;
}

interface Table {
  world: World;
  sim: Simulation;
  /** Buildings each faction placed, in order. */
  built: Record<FactionId, BuildingKind[]>;
}

function table(options: MatchOptions): Table {
  const world = createMatch(options);
  return { world, sim: new Simulation(world), built: { 0: [], 1: [], 2: [], 3: [] } };
}

/** Play `seconds` with the given controllers, each updated in seat order before every step. */
function play(t: Table, seconds: number, seats: readonly AiController[]): void {
  const end = t.world.time + seconds;
  while (t.world.time < end && t.world.phase === 'playing') {
    for (const ai of seats) ai.update();
    t.sim.step();
    for (const e of t.world.drainEvents()) if (e.t === 'buildingPlaced' && e.faction !== -1) t.built[e.faction].push(e.kind);
  }
}

describe('NPC seats', () => {
  it('one controller per seat plays exactly like one controller for every seat, within the AI budget', () => {
    const options: MatchOptions = { seed: 'seats-split', difficulty: 'normal', humans: [], mode: 'standard' };
    const together = table(options);
    play(together, 300, [createAi(together.world, [...FACTION_IDS])]);

    const apart = table(options);
    const seats = FACTION_IDS.map((f) => createAi(apart.world, [f]));
    let aiMs = 0;
    const end = 300;
    while (apart.world.time < end) {
      const t0 = performance.now();
      for (const ai of seats) ai.update();
      aiMs += performance.now() - t0;
      apart.sim.step();
      for (const e of apart.world.drainEvents()) if (e.t === 'buildingPlaced' && e.faction !== -1) apart.built[e.faction].push(e.kind);
    }

    expect(apart.world.tick).toBe(together.world.tick);
    expect(apart.built).toEqual(together.built);
    for (const f of FACTION_IDS) {
      expect(apart.world.factions[f].stats, `faction ${f}`).toEqual(together.world.factions[f].stats);
      expect(apart.world.survey.surveySize[f], `faction ${f} Survey`).toBe(together.world.survey.surveySize[f]);
    }
    expect(aiMs / apart.world.tick).toBeLessThan(0.6);
  }, 120_000);

  it('an idle human seat handed to an NPC builds and expands in its temperament, and falls silent when handed back', () => {
    // Seats 0 (Dr. Beef, the balanced player temperament) and 3 (Jaguar, the Warden) are human
    // and idle; the NPCs hold 1 and 2 from the start.
    const t = table({ seed: 'seats-takeover', difficulty: 'normal', humans: [0, 3], mode: 'standard' });
    const commands = recordCommands(t.world);
    const rivals = createAi(t.world, [1, 2]);
    play(t, 55, [rivals]);
    // Dr. Beef's last act before dropping out: rallying the hippies round the vexillomancer.
    t.world.submit({ t: 'rally', faction: 0 });
    play(t, 5, [rivals]);
    const following = (): number => {
      let n = 0;
      for (const h of t.world.hippies.values()) if (h.faction === 0 && h.order?.kind === 'follow') n++;
      return n;
    };
    expect(following()).toBeGreaterThan(0);

    const surveyAtTakeover = [...t.world.survey.surveySize];
    const seat0 = createAi(t.world, [0]);
    const seat3 = createAi(t.world, [3]);
    play(t, 180, [seat0, rivals, seat3]);

    // Nobody is left trailing the NPC's vexillomancer.
    expect(following()).toBe(0);
    for (const f of [0, 3] as const) {
      expect(t.built[f].length, `faction ${f} buildings`).toBeGreaterThan(0);
      expect(t.world.survey.surveySize[f], `faction ${f} Survey`).toBeGreaterThan(surveyAtTakeover[f]);
    }
    // Each seat follows its faction's build order: the Warden's Workshop first, the player
    // temperament's Drum Circle first (a human seat's own personality field says 'player').
    expect(t.built[3][0]).toBe('workshop');
    expect(t.built[0][0]).toBe('drumcircle');

    // Handed back: the controllers are dropped, the humans stay idle.
    const handback = commands.length;
    play(t, 30, [rivals]);
    expect(commands.slice(handback).filter((c) => c.faction === 0 || c.faction === 3)).toEqual([]);
  }, 120_000);

  it('a seat taken over mid-siege presses the siege on, before its temperament would start one', () => {
    const t = table({ seed: 'seats-siege', difficulty: 'normal', humans: [0], mode: 'standard' });
    const rivals = createAi(t.world, [1, 2, 3]);
    play(t, 30, [rivals]);

    // The human closed a loop round Scarecrow's Hearth just before dropping out.
    const world = t.world;
    const hearth = world.hearthOf(2);
    if (!hearth) throw new Error('no hearth');
    const loop = planEnclosure(world.lattice, {
      x: hearth.pos.x,
      z: hearth.pos.z,
      minRadius: 20,
      cost: (n) => (world.survey.nodeFlagOwner[n] === 0 ? 0 : canPlantAt(world, n, 0) ? 1 : Infinity),
    });
    if (!loop) throw new Error('no loop');
    for (const n of loop) {
      if (world.survey.nodeFlagOwner[n] === 0) continue;
      const node = world.lattice.nodes[n];
      const fl = spawnFlag(world, { state: 'carried', owner: 0, holder: -1, pos: { x: node.x, y: 0, z: node.z } });
      plantFlag(world, fl.id, n, 0, -1);
    }

    const seat0 = createAi(world, [0]);
    let pressed = false;
    const end = world.time + 15;
    while (world.time < end && !pressed) {
      play(t, 0.5, [seat0, rivals]);
      const b = seat0.inspect(0);
      pressed = b?.posture === 'attack' && b.target === 2;
    }
    expect(pressed).toBe(true);
  }, 120_000);
});
