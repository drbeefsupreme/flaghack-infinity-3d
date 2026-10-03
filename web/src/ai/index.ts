/**
 * NPC vexillomancers. createAi returns a controller the app calls once per sim tick (before
 * Simulation.step). AI may only read World state its faction could know and act through
 * world.submit(Command). Owner: AI agent.
 *
 * Each faction runs a Brain through layered passes at their own cadence: perception (≤ 2 Hz,
 * staggered between factions), the director (decision interval by difficulty) followed by the
 * Survey planner, labour and builder, powers (abilities, drugs, Command Center), and the
 * avatar pilot every tick. Enclosure planning, the one heavy computation, is rationed to one
 * plan per tick across all brains (Scheduler).
 */
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { Brain } from './brain';
import { manageBuilds } from './builder';
import { direct } from './director';
import { manageLabour, releaseGuards } from './labour';
import { perceive, Scheduler } from './perception';
import { pilotTick } from './pilot';
import { adoptHomeRing, updatePlan } from './plans';
import { usePowers } from './powers';

export interface AiController {
  /** Called once per simulation tick before step(). */
  update(): void;
  /** Read-only state of one faction's brain (debug overlays, tests), or undefined if not AI. */
  inspect(f: FactionId): Readonly<Brain> | undefined;
}

/** Perception cadence (s). */
const PERCEIVE_EVERY = 0.5;
/** Builder and powers cadence (s). */
const BUILD_EVERY = 2;
const POWERS_EVERY = 1;

export function createAi(world: World, factions: FactionId[]): AiController {
  const brains = factions.map((f, slot) => new Brain(world, f, slot));
  const sched = new Scheduler();
  return {
    update() {
      if (world.phase !== 'playing') return;
      for (const b of brains) think(b, sched);
    },
    inspect(f) {
      return brains.find((b) => b.f === f);
    },
  };
}

function think(b: Brain, sched: Scheduler): void {
  const world = b.world;
  if (!world.factions[b.f].alive) return;
  const now = world.time;
  if (now >= b.nextPerceiveAt) {
    b.nextPerceiveAt = now + PERCEIVE_EVERY;
    perceive(b, sched);
    if (b.homeNodes.length === 0 && b.view.hearthId >= 0) adoptHomeRing(b);
  }
  if (now >= b.nextDecideAt && b.view.hearthId >= 0) {
    b.nextDecideAt = now + b.skill.decide;
    const before = b.posture;
    direct(b);
    if (before !== b.posture && (before === 'attack' || before === 'opportunist')) releaseGuards(b);
    updatePlan(b, sched);
    manageLabour(b);
  }
  if (now >= b.nextBuildAt) {
    b.nextBuildAt = now + BUILD_EVERY;
    manageBuilds(b);
  }
  if (now >= b.nextPowersAt) {
    b.nextPowersAt = now + POWERS_EVERY;
    usePowers(b);
  }
  pilotTick(b);
}
