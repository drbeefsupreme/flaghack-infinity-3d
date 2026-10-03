/**
 * Director: every decision interval, scores the postures (DEFEND, ECONOMY, EXPAND,
 * ATTACK(target), OPPORTUNIST(target)) with the faction's temperament and commits with
 * hysteresis, so a rival that starts an assault sees it through instead of dithering.
 * Owner: AI agent.
 */
import { BUILDINGS, BURN_TIME, HOARD_THRESHOLD } from '../sim/constants';
import type { FactionId } from '../sim/types';
import type { Brain, Posture, RivalIntel } from './brain';

/** Bonus the current posture enjoys, and how long a non-urgent posture is kept at least. */
const COMMIT_BONUS = 0.25;
const MIN_DWELL = 8;
/** An assault with no pressure to show after this long loses heart (and its target). */
const ASSAULT_PATIENCE = 170;
/** Game time after which every temperament leans harder into assaults (the match must end). */
const LATE_GAME = 600;
/** Attack score lost per NEIGHBOUR_RANGE beyond the first (m), and for a fully crowded target
 * (CROWD_FULL Flags of another besieger around it). */
const DISTANCE_PENALTY = 0.3;
const NEIGHBOUR_RANGE = 190;
const CROWD_PENALTY = 0.4;
const CROWD_FULL = 12;
/** Our overwrite must lead theirs by this much before we race instead of turning home. */
const RACE_MARGIN = 15;

export interface Choice {
  posture: Posture;
  target: FactionId | null;
  score: number;
}

export function direct(b: Brain): void {
  const world = b.world;
  const v = b.view;
  const now = world.time;
  if (v.hearthId < 0) return;

  const besieged = v.stage === 'contained' || v.stage === 'contested' || v.stage === 'overwritten';
  if (besieged && !b.wasContained) b.timesContained++;
  b.wasContained = besieged;

  const best = choose(b);
  const current = b.posture;
  const urgent = best.posture === 'defend' && besieged;
  const dwellOver = now - b.postureSince >= MIN_DWELL;
  const keep = !urgent && !dwellOver && current !== 'defend';
  if (keep) return;
  if (best.posture === current && best.target === b.target) return;
  const retarget = best.target !== b.target;
  b.posture = best.posture;
  b.target = best.target;
  b.postureSince = now;
  if (best.posture === 'attack' || best.posture === 'opportunist') {
    if (b.assaultAt === 0 || retarget) {
      b.assaultAt = now;
      const r = best.target === null ? undefined : b.intel(best.target);
      if (r) r.closedOnce = false;
    }
  } else if (best.posture !== 'defend') {
    b.assaultAt = 0;
  }
}

/** Highest-utility posture right now (the current one gets a commitment bonus). */
export function choose(b: Brain): Choice {
  const world = b.world;
  const v = b.view;
  const P = b.persona;
  const now = world.time;
  const flags = b.flagsInHand();
  const besieged = v.stage === 'contained' || v.stage === 'contested' || v.stage === 'overwritten';
  const late = now >= LATE_GAME ? 1.3 : 1;
  const burning = world.suddenDeath || now >= BURN_TIME;

  const options: Choice[] = [];

  // DEFEND: dominant once a loop holds our Hearth (after the reaction delay), mild when
  // threatened. Unless we are racing: our own loop holds round the target with more pressure
  // than theirs on us, and finishing the overwrite beats running home.
  const r = b.target === null ? undefined : b.intel(b.target);
  b.racing =
    besieged &&
    r !== undefined &&
    (b.posture === 'attack' || b.posture === 'opportunist') &&
    r.attacker === b.f &&
    r.ourPressure >= v.pressure + RACE_MARGIN;
  let defend = 0;
  if (besieged && now >= b.noticeAt && !b.racing) defend = 2 + v.pressure / 100;
  else if (v.stage === 'threatened' || b.racing) defend = 0.35 * P.defend;
  if (!v.homeIntact && v.enclosers.length > 0) defend += 0.3;
  options.push({ posture: 'defend', target: null, score: defend });

  // ECONOMY: lumber and Flags first; a camp without a Workshop is not ready for war.
  const hasWorkshop = world.buildingsOf(b.f, 'workshop').length > 0;
  let economy = P.economy * 0.45;
  if (v.lumber < BUILDINGS.workshop.cost) economy += 0.3 * P.economy;
  if (flags < 12) economy += 0.25;
  if (!hasWorkshop && !b.needsRoom && now > 30) economy += 0.2;
  options.push({ posture: 'economy', target: null, score: economy });

  // EXPAND: grow lobes of territory towards the temperament's goal (or to make room to build),
  // and hunt cheap pentacles.
  let expand = P.expand * 0.5;
  if (world.survey.surveySize[b.f] < P.territory) expand += 0.2 * P.expand;
  else expand -= 0.2;
  if (b.needsRoom) expand += 0.45;
  if (flags < 8) expand -= 0.3;
  // Every direction came up empty lately: nowhere to grow for now.
  if (!b.expansion && now < b.lobeRetryAt) expand -= 0.3;
  options.push({ posture: 'expand', target: null, score: expand });

  // ATTACK / OPPORTUNIST per rival. A chest at the hoarding line goes to war rather than rot:
  // the Workshop keeps up while the wall rises.
  for (const r of v.rivals) {
    if (!r.alive || !r.loop || !Number.isFinite(r.loopCost)) continue;
    const softened = r.attacker !== null && r.attacker !== b.f && (r.stage === 'contained' || r.stage === 'contested');
    const need = r.loopCost * P.attackMargin;
    const affordable = flags >= need || flags >= HOARD_THRESHOLD || (b.target === r.id && flags >= r.loopCost * 0.6);
    if (!affordable) continue;
    if (softened) {
      options.push({ posture: 'opportunist', target: r.id, score: P.opportunism * (0.95 + r.ourPressure / 200) * late });
    }
    if (now < P.attackFrom && !burning) continue;
    let score = P.attack * (0.75 + 0.35 * Math.max(0, 1 - r.loopCost / 45));
    if (!r.homeIntact) score += 0.2;
    if (attackedUsRecently(b, r)) score += 0.15;
    score += Math.min(0.2, r.ourPressure / 300);
    // Neighbours before the far corner (every Flag walks there), and leave a camp another
    // besieger is already walling in: two walls on one ring only pull each other down.
    score -= DISTANCE_PENALTY * Math.max(0, Math.hypot(r.hx - v.hx, r.hz - v.hz) - NEIGHBOUR_RANGE) / NEIGHBOUR_RANGE;
    score -= CROWD_PENALTY * Math.min(1, r.crowd / CROWD_FULL) * (b.target === r.id ? 0.5 : 1);
    if (b.target === r.id && b.assaultAt > 0 && now - b.assaultAt > ASSAULT_PATIENCE && r.ourPressure < 20) score -= 0.6;
    options.push({ posture: 'attack', target: r.id, score: score * late * (burning ? 1.3 : 1) });
  }

  let best = options[0];
  let bestScore = -Infinity;
  for (const o of options) {
    const bonus = o.posture === b.posture && o.target === b.target ? COMMIT_BONUS : 0;
    if (o.score + bonus > bestScore) {
      best = o;
      bestScore = o.score + bonus;
    }
  }
  // Under siege the assault waits (Survey and avatar turn home), unless the camp is still safe.
  if (besieged && now >= b.noticeAt && best.posture !== 'defend' && defend >= 2) best = options[0];
  return best;
}

/** Did this rival lead pressure on our Hearth at any point we remember? */
function attackedUsRecently(b: Brain, r: RivalIntel): boolean {
  const world = b.world;
  const h = world.buildings.get(b.view.hearthId);
  return !!h && !!h.hearth && h.hearth.pressure[r.id] > 0;
}
