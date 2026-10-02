/**
 * NPC vexillomancers. createAi returns a controller the app calls once per sim tick (before
 * Simulation.step). AI may only read World state its faction could know and act through
 * world.submit(Command). Owner: AI agent.
 */
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';

export interface AiController {
  /** Called once per simulation tick before step(). */
  update(): void;
}

export function createAi(world: World, factions: FactionId[]): AiController {
  return { update() {} };
}
