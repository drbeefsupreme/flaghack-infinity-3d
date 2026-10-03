/**
 * Dawn wording shared by the Hearth rail's live "Dominant at dawn" marker and the dawn end
 * screen, so the running call and the final verdict always read the same way. The order is
 * the rule's own (victory.dominanceOrder): most Hearths, then the Survey enclosed now, then
 * C.M.I., then the lowest faction id.
 */
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { factionName } from './core';

/** Dawn measures in the rule's order: Hearths held, then Survey (facets enclosed now), then C.M.I. */
function dawnMeasures(world: World, f: FactionId): [number, number, number] {
  const fac = world.factions[f];
  return [fac ? fac.hearthIds.length : 0, world.survey.surveySize[f] ?? 0, Math.round(fac?.stats.cmi ?? 0)];
}

/**
 * Why order[0] is ahead of order[1], naming the first measure that separates them, e.g.
 * "Hearths level at 1; dominant on Survey: 95 facets to DJ Scarecrow's 32." The viewer's own
 * camp reads as "your". Empty when fewer than two camps stand.
 */
export function dawnLead(world: World, order: readonly FactionId[], viewer: FactionId): string {
  const [first, second] = order;
  if (first === undefined || second === undefined) return '';
  const w = dawnMeasures(world, first);
  const r = dawnMeasures(world, second);
  const theirs = second === viewer ? 'your' : `${factionName(world, second)}'s`;
  if (w[0] !== r[0]) return `Dominant on Hearths: ${w[0]} to ${theirs} ${r[0]}.`;
  if (w[1] !== r[1]) return `Hearths level at ${w[0]}; dominant on Survey: ${w[1]} facets to ${theirs} ${r[1]}.`;
  if (w[2] !== r[2]) return `Hearths and Survey level; dominant on C.M.I.: ${w[2]} to ${theirs} ${r[2]}.`;
  return 'Level on every measure; the Crystal breaks the tie.';
}
