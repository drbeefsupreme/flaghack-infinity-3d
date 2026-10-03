/**
 * Job allocator. Every HIPPIE_AI.jobInterval per faction, the camp's available hippies (no
 * order, not KO / distracted / overstimulated) are distributed across Survey / Gather / Defend /
 * Raid / Ritual in proportion to the Camp Priorities (jobWeights) over the work that actually
 * exists. A hippie keeps a job at least HIPPIE_AI.jobHysteresis seconds unless the job runs dry.
 */
import { BUILDINGS, DRUMMERS_PER_CIRCLE, HIPPIE_AI } from '../../constants';
import { FACTION_IDS, JOBS, NEUTRAL } from '../../types';
import type { FactionId, Hippie, JobKind } from '../../types';
import type { World } from '../../world';
import { hasEffect } from '../effects';
import { canPlantAt } from '../flags';
import { brainOf, releaseTask } from './brain';
import type { Brain } from './brain';
import type { UnitsState } from './state';
import { boundaryFlags, criticalFlags, planBlockers, threatFlags } from './targets';

const JOB_INDEX: Record<JobKind, number> = { survey: 0, gather: 1, defend: 2, raid: 3, ritual: 4 };
/** Gatherers a single pile keeps busy. */
const GATHERERS_PER_PILE = 3;
/** Raiders an Attack ping can use. */
const RAIDERS_PER_PING = 3;
/** Loose Flags this far from a Hearth's edge count toward Survey work. */
const LOOSE_FLAG_RANGE = HIPPIE_AI.fetchRadius + 20;

/** Mid-task hippies are not reshuffled (they would drop what they are doing). */
function busy(h: Hippie, b: Brain): boolean {
  if (h.carryingFlag !== -1 || h.carryingLumber > 0 || b.work > 0) return true;
  return b.task === 'pull' || b.task === 'tear' || b.task === 'engage' || b.task === 'respond';
}

export function allocateJobs(world: World, sys: UnitsState, f: FactionId): void {
  const fac = world.factions[f];
  if (!fac.alive) return;
  const pool = sys.pool;
  pool.length = 0;
  for (const h of sys.active) {
    if (h.faction !== f || h.order) continue;
    if (brainOf(h).task === 'distracted' || hasEffect(world, h, 'overstimulated')) continue;
    pool.push(h);
  }
  if (pool.length === 0) return;
  const weights = fac.jobWeights;
  const cap = sys.jobCap;
  measureWork(world, sys, f, cap);
  const target = sys.jobTarget;
  distribute(pool.length, weights, cap, target, sys.jobFrac);

  // Hippies whose job ran dry (or was zeroed) are free at once; the rest count toward targets.
  const count = sys.jobCount;
  count.fill(0);
  const free = sys.free;
  free.length = 0;
  for (const h of pool) {
    const j = h.job === null ? -1 : JOB_INDEX[h.job];
    if (j < 0 || cap[j] <= 0 || weights[JOBS[j]] <= 0) free.push(h);
    else count[j]++;
  }
  // Over-subscribed jobs release hippies that served their stint and are between tasks.
  for (let j = 0; j < JOBS.length; j++) {
    let excess = count[j] - target[j];
    for (let i = 0; i < pool.length && excess > 0; i++) {
      const h = pool[i];
      if (h.job !== JOBS[j]) continue;
      const b = brainOf(h);
      if (world.time - b.jobSince < HIPPIE_AI.jobHysteresis || busy(h, b)) continue;
      free.push(h);
      count[j]--;
      excess--;
    }
  }
  // Free hippies fill the largest deficits (ties go to the heavier weight).
  for (const h of free) {
    let best = -1;
    let bestDef = 0;
    for (let j = 0; j < JOBS.length; j++) {
      const def = target[j] - count[j];
      if (def <= 0) continue;
      if (def > bestDef || (def === bestDef && weights[JOBS[j]] > weights[JOBS[best]])) {
        best = j;
        bestDef = def;
      }
    }
    const job = best >= 0 ? JOBS[best] : null;
    if (best >= 0) count[best]++;
    if (h.job === job) continue;
    h.job = job;
    const b = brainOf(h);
    b.jobSince = world.time;
    releaseTask(world, h, b);
  }
}

/** How many hippies each job could usefully employ right now (Infinity = always). */
function measureWork(world: World, sys: UnitsState, f: FactionId, cap: Float64Array): void {
  const fac = world.factions[f];
  const lat = world.lattice;
  const nodeFlag = world.survey.nodeFlag;

  // Survey: unfilled plantable plan nodes, limited by the Flags the camp can lay hands on.
  let nodes = 0;
  for (const n of fac.plan) if (n >= 0 && n < lat.nodes.length && nodeFlag[n] < 0 && canPlantAt(world, n, f)) nodes++;
  let flags = sys.stockByFaction[f];
  if (nodes > flags) {
    const range = BUILDINGS.hearth.radius + LOOSE_FLAG_RANGE;
    for (const fl of sys.looseFlags) {
      if (fl.owner !== f && fl.owner !== NEUTRAL) continue;
      for (const hid of fac.hearthIds) {
        const hb = world.buildings.get(hid);
        if (!hb || (hb.pos.x - fl.pos.x) ** 2 + (hb.pos.z - fl.pos.z) ** 2 > range * range) continue;
        flags++;
        break;
      }
    }
    for (const h of sys.active) if (h.faction === f && h.job === 'survey' && h.carryingFlag !== -1) flags++;
  }
  // A camp without raiders keeps one Survey hand to pull Flags squatting on the plan.
  const blockers = planBlockers(world, sys, f).length;
  cap[JOB_INDEX.survey] = Math.min(nodes, flags) + (blockers > 0 && sys.raiders[f] === 0 ? 1 : 0);

  let piles = 0;
  for (const p of world.piles.values()) if (p.lumber > 0) piles++;
  cap[JOB_INDEX.gather] = piles * GATHERERS_PER_PILE;

  cap[JOB_INDEX.defend] = Infinity;

  let raid = criticalFlags(world, sys, f).length + blockers + threatFlags(world, sys, f).length;
  for (const p of world.pings.values()) if (p.faction === f && p.kind === 'attack') raid += RAIDERS_PER_PING;
  for (const e of FACTION_IDS) if (e !== f && world.factions[e].alive) raid += boundaryFlags(world, sys, e).length;
  cap[JOB_INDEX.raid] = raid;

  cap[JOB_INDEX.ritual] = sys.drumCircles[f].length * DRUMMERS_PER_CIRCLE;
}

/**
 * Proportional shares of `n` hippies over jobs with weight and work, water-filled against the
 * capacities (a saturated job is capped and the rest re-shared), rounded by largest remainder.
 */
function distribute(n: number, weights: Record<JobKind, number>, cap: Float64Array, out: Int32Array, frac: Float64Array): void {
  out.fill(0);
  let open = 0;
  for (let j = 0; j < JOBS.length; j++) if (weights[JOBS[j]] > 0 && cap[j] > 0) open |= 1 << j;
  let remaining = n;
  while (remaining > 0 && open !== 0) {
    let w = 0;
    for (let j = 0; j < JOBS.length; j++) if (open & (1 << j)) w += weights[JOBS[j]];
    let worst = -1;
    let worstRatio = 1;
    for (let j = 0; j < JOBS.length; j++) {
      if (!(open & (1 << j))) continue;
      const ratio = (remaining * weights[JOBS[j]]) / w / cap[j];
      if (ratio >= worstRatio) {
        worstRatio = ratio;
        worst = j;
      }
    }
    if (worst >= 0) {
      out[worst] = cap[worst];
      remaining -= cap[worst];
      open &= ~(1 << worst);
      continue;
    }
    let given = 0;
    for (let j = 0; j < JOBS.length; j++) {
      frac[j] = -1;
      if (!(open & (1 << j))) continue;
      const share = (remaining * weights[JOBS[j]]) / w;
      out[j] = Math.floor(share);
      given += out[j];
      frac[j] = share - out[j];
    }
    for (let left = remaining - given; left > 0; left--) {
      let pick = -1;
      for (let j = 0; j < JOBS.length; j++) {
        if (frac[j] < 0) continue;
        if (pick < 0 || frac[j] > frac[pick] || (frac[j] === frac[pick] && weights[JOBS[j]] > weights[JOBS[pick]])) pick = j;
      }
      out[pick]++;
      frac[pick] = -1;
    }
    remaining = 0;
  }
}
