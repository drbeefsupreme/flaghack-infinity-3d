/**
 * Survey system: keeps SurveyState in sync with planted Flags. When dirty, recomputes
 * implied Flags → holders → Ley Lines → crystallized facets → enclosure per faction →
 * focus nodes, and emits leyLine / facetCrystallized / surveyChanged deltas.
 * Every tick: recompute Zeno observation (nodeObserved) and collapse observed simulacra.
 * Owner: SurveyRules agent (geometry math lives in lattice/survey.ts).
 */
import type { CommandOf } from '../commands';
import type { FactionId } from '../types';
import type { World } from '../world';

export function markSurveyDirty(world: World): void {
  world.survey.dirty = true;
}

export function updateSurvey(world: World, dt: number): void {}

/** Plan edit command (the faction's personal Survey Pattern). */
export function cmdPlan(world: World, c: CommandOf<'plan'>): void {
  const plan = world.factions[c.faction].plan;
  if (c.op === 'clear') plan.clear();
  else if (c.op === 'set') {
    plan.clear();
    for (const n of c.nodes) plan.add(n);
  } else if (c.op === 'add') for (const n of c.nodes) plan.add(n);
  else for (const n of c.nodes) plan.delete(n);
}

/** Is `node` observed (Zeno-frozen) for faction f this tick? */
export function isObserved(world: World, node: number, f: FactionId): boolean {
  return (world.survey.nodeObserved[node] & (1 << f)) !== 0;
}
