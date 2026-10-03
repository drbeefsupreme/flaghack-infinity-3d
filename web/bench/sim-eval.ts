/**
 * Headless simulation eval: the sim half of the perf harness (pair with render-eval.js).
 *
 *   bun web/bench/sim-eval.ts [--seconds 300] [--seed bench-1] [--json]
 *                             [--hippies N] [--flags N] [--top N] [--probes]   (repo root)
 *   npm run eval:sim -- --seconds 120                                       (web/)
 *
 * Builds an all-AI match, then runs exactly what the app's fixed-step loop runs per tick:
 * AI update, Simulation.step, one drain of the event queue. Reports wall time per tick
 * (mean / p50 / p95 / max), per-system means from Simulation.timings plus the AI, entity
 * counts at the end, and the --top slowest ticks after the first second with their
 * per-system split (spikes are frame hitches). Stops early if the match ends.
 *
 * --hippies / --flags top the match up at t = 0 to at least that many Signifiers (spread over
 * the camps) and planted Flags (free nodes, owned by the nearest camp), from a seeded stream
 * separate from world.rng: a stress load that does not depend on how far the AI has got.
 *
 * --probes wraps the costly NavGrid / CollisionWorld queries of this match's instances and
 * reports calls and ms per tick (and inside the slowest ticks). It adds timer overhead, so
 * leave it off when comparing scores.
 *
 * SCORE = p95 tick ms (lower is better). Game state is deterministic per seed and options
 * (all sim randomness is world.rng); only the timings vary between runs.
 * --json prints one JSON line (for ratchet), otherwise a compact table.
 */
import { createAi } from '../src/ai';
import { SIM_HZ } from '../src/sim/constants';
import { spawnFlag, spawnHippie } from '../src/sim/factory';
import { Rng } from '../src/sim/rng';
import { createMatch } from '../src/sim/setup';
import { Simulation } from '../src/sim/simulation';
import { canPlantAt, plantFlag } from '../src/sim/systems/flags';
import { FACTION_IDS } from '../src/sim/types';
import type { FlagState } from '../src/sim/types';
import type { World } from '../src/sim/world';

interface Args {
  seconds: number;
  seed: string;
  json: boolean;
  hippies: number;
  flags: number;
  top: number;
  probes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seconds: 300, seed: 'bench-1', json: false, hippies: 0, flags: 0, top: 3, probes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--probes') args.probes = true;
    else if (a === '--seconds') args.seconds = Number(argv[++i]);
    else if (a === '--seed') args.seed = String(argv[++i]);
    else if (a === '--hippies') args.hippies = Number(argv[++i]);
    else if (a === '--flags') args.flags = Number(argv[++i]);
    else if (a === '--top') args.top = Number(argv[++i]);
    else throw new Error(`unknown argument ${a} (expected --seconds N, --seed S, --hippies N, --flags N, --top N, --probes, --json)`);
  }
  if (!Number.isFinite(args.seconds) || args.seconds <= 0) throw new Error('--seconds must be a positive number');
  if (!(args.hippies >= 0) || !(args.flags >= 0)) throw new Error('--hippies / --flags must be ≥ 0');
  if (!Number.isInteger(args.top) || args.top < 0) throw new Error('--top must be a whole number ≥ 0');
  return args;
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Seeded stress top-up (see header). */
function topUp(world: World, args: Args): void {
  const rng = new Rng(`sim-eval:${args.seed}`);
  const camps = world.map.camps;
  for (let n = world.hippies.size; n < args.hippies; n++) {
    const c = camps[n % camps.length];
    spawnHippie(world, c.faction, world.nav.nearestWalkable(c.x + rng.range(-25, 25), c.z + rng.range(-25, 25)));
  }
  let planted = 0;
  for (const f of world.flags.values()) if (f.state === 'planted') planted++;
  const order = rng.shuffle(world.lattice.nodes.map((n) => n.id));
  for (const id of order) {
    if (planted >= args.flags) break;
    const node = world.lattice.nodes[id];
    let owner = camps[0];
    for (const c of camps) {
      if ((c.x - node.x) ** 2 + (c.z - node.z) ** 2 < (owner.x - node.x) ** 2 + (owner.z - node.z) ** 2) owner = c;
    }
    if (!canPlantAt(world, id, owner.faction)) continue;
    const fl = spawnFlag(world, { state: 'loose', owner: owner.faction, holder: -1, pos: { x: node.x, y: 0, z: node.z } });
    if (plantFlag(world, fl.id, id, owner.faction, -1)) planted++;
  }
  world.drainEvents();
}

/** Call accounting for one wrapped query. */
interface Probe {
  calls: number;
  ms: number;
  maxMs: number;
  tickCalls: number;
  tickMs: number;
}

/** Wrap a function so every call is counted and timed into `probe`. */
function timed<A extends unknown[], R>(probe: Probe, fn: (...a: A) => R): (...a: A) => R {
  return (...a: A): R => {
    const t = performance.now();
    const out = fn(...a);
    const ms = performance.now() - t;
    probe.calls++;
    probe.ms += ms;
    probe.tickCalls++;
    probe.tickMs += ms;
    if (ms > probe.maxMs) probe.maxMs = ms;
    return out;
  };
}

/** Instance-level wraps of this match's nav and collision queries (prototypes untouched). */
function installProbes(world: World): Map<string, Probe> {
  const probes = new Map<string, Probe>();
  const make = (name: string): Probe => {
    const p = { calls: 0, ms: 0, maxMs: 0, tickCalls: 0, tickMs: 0 };
    probes.set(name, p);
    return p;
  };
  const nav = world.nav;
  const col = world.collision;
  nav.findPath = timed(make('nav.findPath'), nav.findPath.bind(nav));
  nav.lineOfSight = timed(make('nav.lineOfSight'), nav.lineOfSight.bind(nav));
  nav.nearestWalkable = timed(make('nav.nearestWalkable'), nav.nearestWalkable.bind(nav));
  nav.blockerOnSegment = timed(make('nav.blockerOnSegment'), nav.blockerOnSegment.bind(nav));
  col.moveCharacter = timed(make('col.moveCharacter'), col.moveCharacter.bind(col));
  col.raycast = timed(make('col.raycast'), col.raycast.bind(col));
  col.blockedCircle = timed(make('col.blockedCircle'), col.blockedCircle.bind(col));
  return probes;
}

/** One of the slowest ticks, with its per-system split and (with --probes) its query costs. */
interface SlowTick {
  tick: number;
  gameTime: number;
  ms: number;
  systems: Record<string, number>;
  probes: Record<string, { calls: number; ms: number }>;
}

const args = parseArgs(process.argv.slice(2));

const setupStart = performance.now();
const world = createMatch({ seed: args.seed, difficulty: 'normal', allAi: true });
const sim = new Simulation(world);
const ai = createAi(world, [...FACTION_IDS]);
if (args.hippies > 0 || args.flags > 0) topUp(world, args);
const setupMs = performance.now() - setupStart;
const probes = args.probes ? installProbes(world) : new Map<string, Probe>();

const maxTicks = Math.round(args.seconds * SIM_HZ);
const tickMs = new Float64Array(maxTicks);
const systemMs = new Map<string, number>();
const WARMUP_TICKS = SIM_HZ;
/** Slowest ticks after warm-up, slowest first. */
const slowest: SlowTick[] = [];
let aiMs = 0;
let events = 0;
let ticks = 0;
let endedAt = -1;

const runStart = performance.now();
for (; ticks < maxTicks; ticks++) {
  // Timings are per step and stale when the step bails out early (match over), so only
  // count them for steps that ran the systems.
  const playing = world.phase === 'playing';
  for (const p of probes.values()) {
    p.tickCalls = 0;
    p.tickMs = 0;
  }
  const t0 = performance.now();
  ai.update();
  const t1 = performance.now();
  sim.step();
  events += world.drainEvents().length;
  const t2 = performance.now();
  aiMs += t1 - t0;
  const ms = t2 - t0;
  tickMs[ticks] = ms;
  if (playing) for (const name in sim.timings) systemMs.set(name, (systemMs.get(name) ?? 0) + sim.timings[name]);
  if (ticks >= WARMUP_TICKS && args.top > 0 && (slowest.length < args.top || ms > slowest[slowest.length - 1].ms)) {
    const split: Record<string, number> = { ai: t1 - t0 };
    if (playing) for (const name in sim.timings) split[name] = sim.timings[name];
    const calls: Record<string, { calls: number; ms: number }> = {};
    for (const [name, p] of probes) if (p.tickCalls > 0) calls[name] = { calls: p.tickCalls, ms: p.tickMs };
    slowest.push({ tick: ticks, gameTime: world.time, ms, systems: split, probes: calls });
    slowest.sort((a, b) => b.ms - a.ms);
    if (slowest.length > args.top) slowest.pop();
  }
  if (world.phase === 'ended') {
    endedAt = world.time;
    ticks++;
    break;
  }
}
const totalMs = performance.now() - runStart;

const sorted = tickMs.slice(0, ticks).sort();
let sum = 0;
for (let i = 0; i < ticks; i++) sum += tickMs[i];
const systems: Record<string, number> = { ai: aiMs / ticks };
for (const [name, ms] of systemMs) systems[name] = ms / ticks;
const queries: Record<string, { callsPerTick: number; msPerTick: number; maxCallMs: number }> = {};
for (const [name, p] of probes) queries[name] = { callsPerTick: p.calls / ticks, msPerTick: p.ms / ticks, maxCallMs: p.maxMs };

const flags: Record<FlagState, number> = { stock: 0, carried: 0, planted: 0, loose: 0, flying: 0 };
for (const f of world.flags.values()) flags[f.state]++;
let neutralHippies = 0;
for (const h of world.hippies.values()) if (h.faction === -1) neutralHippies++;

const result = {
  score: percentile(sorted, 0.95),
  seed: args.seed,
  stress: { hippies: args.hippies, flags: args.flags },
  gameSeconds: ticks / SIM_HZ,
  ticks,
  setupMs,
  totalMs,
  meanMs: sum / ticks,
  p50Ms: percentile(sorted, 0.5),
  p95Ms: percentile(sorted, 0.95),
  maxMs: sorted[ticks - 1] ?? 0,
  systems,
  queries,
  entities: {
    hippies: world.hippies.size,
    neutralHippies,
    flags: world.flags.size,
    flagsByState: flags,
    pieces: world.pieces.size,
    buildings: world.buildings.size,
    crystals: world.crystals.size,
    projectiles: world.projectiles.size,
    piles: world.piles.size,
  },
  events,
  slowest,
  endedAt,
  winner: world.winner,
};

if (args.json) {
  console.log(JSON.stringify(result));
} else {
  const f = (n: number): string => n.toFixed(3).padStart(8);
  const split = (rec: Record<string, number>): string =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, ms]) => `${name} ${ms.toFixed(3)}`)
      .join(', ');
  const lines = [
    `FLAGHACK sim eval: seed ${result.seed}${args.hippies || args.flags ? ` (stress: ≥${args.hippies} hippies, ≥${args.flags} planted Flags)` : ''}, ` +
      `${result.gameSeconds.toFixed(0)} game-s (${ticks} ticks), setup ${setupMs.toFixed(0)} ms, run ${totalMs.toFixed(0)} ms`,
    `tick ms   mean ${f(result.meanMs)}  p50 ${f(result.p50Ms)}  p95 ${f(result.p95Ms)}  max ${f(result.maxMs)}`,
    'system means (ms/tick):',
    ...Object.entries(systems)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `  ${name.padEnd(12)} ${f(ms)}`),
    ...(probes.size > 0
      ? [
          'queries (calls/tick, ms/tick, slowest call ms):',
          ...Object.entries(queries)
            .sort((a, b) => b[1].msPerTick - a[1].msPerTick)
            .map(([name, q]) => `  ${name.padEnd(22)} ${f(q.callsPerTick)} ${f(q.msPerTick)} ${f(q.maxCallMs)}`),
        ]
      : []),
    `entities: hippies ${result.entities.hippies} (neutral ${neutralHippies}), flags ${world.flags.size} ` +
      `[${Object.entries(flags)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}], pieces ${world.pieces.size}, buildings ${world.buildings.size}, crystals ${world.crystals.size}, ` +
      `projectiles ${world.projectiles.size}, piles ${world.piles.size}; events ${events}`,
    ...slowest.map(
      (s) =>
        `slow tick ${s.ms.toFixed(3)} ms at ${s.gameTime.toFixed(2)} s (${split(s.systems)})` +
        (Object.keys(s.probes).length > 0
          ? ` [${Object.entries(s.probes)
              .sort((a, b) => b[1].ms - a[1].ms)
              .slice(0, 3)
              .map(([name, q]) => `${name} ×${q.calls} ${q.ms.toFixed(3)}`)
              .join(', ')}]`
          : ''),
    ),
    endedAt >= 0 ? `match ended at ${endedAt.toFixed(1)} s, winner ${String(result.winner)}` : 'match still running at the end',
    `SCORE (p95 tick ms, lower is better): ${result.score.toFixed(3)}`,
  ];
  console.log(lines.join('\n'));
}
