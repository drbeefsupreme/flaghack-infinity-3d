/**
 * NavGrid eval: replays one match's exact pathfinding workload against the current NavGrid.
 *
 *   bun web/bench/nav-eval.ts [--seconds 120] [--seed bench-1] [--hippies 150] [--flags 600]
 *                             [--reps 5] [--record] [--json]                    (repo root)
 *
 * Recording: plays an all-AI match (stress top-up as in sim-eval) with NavGrid's prototype
 * wrapped, logging every dynamic blocker change (blockCircle / blockSegment / unblock) from
 * setup on, and every findPath query with its options and the path length it returned. The
 * log is saved in the OS temp dir and reused, so later code versions replay the identical
 * workload even if their paths would steer the hippies differently (--record re-records).
 *
 * Replay: a fresh NavGrid.fromMap of the same map, the logged ops in order, every query
 * timed. Reports total and per-call ms (mean / p95 / max) of findPath over --reps replays,
 * and path quality against the recording: unreachable answers, mean and worst length ratio,
 * and any leg that is not a clear straight line on the grid (must be 0).
 *
 * SCORE = mean replay ms for the whole log (lower is better).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAi } from '../src/ai';
import { SIM_HZ } from '../src/sim/constants';
import { spawnFlag, spawnHippie } from '../src/sim/factory';
import { generateMap } from '../src/sim/map/mapgen';
import type { V2 } from '../src/sim/math';
import { NavGrid } from '../src/sim/nav/navgrid';
import type { PathOptions } from '../src/sim/nav/navgrid';
import { Rng } from '../src/sim/rng';
import { createMatch } from '../src/sim/setup';
import { Simulation } from '../src/sim/simulation';
import { canPlantAt, plantFlag } from '../src/sim/systems/flags';
import { FACTION_IDS } from '../src/sim/types';
import type { World } from '../src/sim/world';

interface Args {
  seconds: number;
  seed: string;
  hippies: number;
  flags: number;
  reps: number;
  record: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seconds: 120, seed: 'bench-1', hippies: 150, flags: 600, reps: 5, record: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--record') args.record = true;
    else if (a === '--seconds') args.seconds = Number(argv[++i]);
    else if (a === '--seed') args.seed = String(argv[++i]);
    else if (a === '--hippies') args.hippies = Number(argv[++i]);
    else if (a === '--flags') args.flags = Number(argv[++i]);
    else if (a === '--reps') args.reps = Number(argv[++i]);
    else throw new Error(`unknown argument ${a} (expected --seconds N, --seed S, --hippies N, --flags N, --reps N, --record, --json)`);
  }
  if (!(args.seconds > 0) || !(args.reps >= 1) || !(args.hippies >= 0) || !(args.flags >= 0)) throw new Error('bad numeric argument');
  return args;
}

/** One logged NavGrid call. Paths keep the length the recording run got (-1 = null). */
type Op =
  | { k: 'c'; x: number; z: number; r: number; id: number }
  | { k: 's'; ax: number; az: number; bx: number; bz: number; t: number; id: number }
  | { k: 'u'; id: number }
  | { k: 'p'; ax: number; az: number; bx: number; bz: number; o: PathOptions | undefined; len: number };

function pathLength(fromX: number, fromZ: number, path: V2[] | null): number {
  if (!path) return -1;
  let len = 0;
  let px = fromX;
  let pz = fromZ;
  for (const p of path) {
    len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len;
}

/** Same stress top-up as sim-eval (seeded, separate from world.rng). */
function topUp(world: World, args: Args): void {
  const rng = new Rng(`sim-eval:${args.seed}`);
  const camps = world.map.camps;
  for (let n = world.hippies.size; n < args.hippies; n++) {
    const c = camps[n % camps.length];
    spawnHippie(world, c.faction, world.nav.nearestWalkable(c.x + rng.range(-25, 25), c.z + rng.range(-25, 25)));
  }
  let planted = 0;
  for (const f of world.flags.values()) if (f.state === 'planted') planted++;
  for (const id of rng.shuffle(world.lattice.nodes.map((n) => n.id))) {
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

/** Play the match with NavGrid's prototype wrapped (setup's registrations included). */
function record(args: Args): Op[] {
  const ops: Op[] = [];
  const proto = NavGrid.prototype;
  const { blockCircle, blockSegment, unblock, findPath } = proto;
  proto.blockCircle = function (x, z, r, id) {
    ops.push({ k: 'c', x, z, r, id });
    blockCircle.call(this, x, z, r, id);
  };
  proto.blockSegment = function (ax, az, bx, bz, t, id) {
    ops.push({ k: 's', ax, az, bx, bz, t, id });
    blockSegment.call(this, ax, az, bx, bz, t, id);
  };
  proto.unblock = function (id) {
    ops.push({ k: 'u', id });
    unblock.call(this, id);
  };
  proto.findPath = function (ax, az, bx, bz, o) {
    const path = findPath.call(this, ax, az, bx, bz, o);
    ops.push({ k: 'p', ax, az, bx, bz, o: o ? { ...o } : undefined, len: pathLength(ax, az, path) });
    return path;
  };
  try {
    const world = createMatch({ seed: args.seed, difficulty: 'normal', humans: [], mode: 'standard' });
    const sim = new Simulation(world);
    const ai = createAi(world, [...FACTION_IDS]);
    topUp(world, args);
    const ticks = Math.round(args.seconds * SIM_HZ);
    for (let i = 0; i < ticks && world.phase === 'playing'; i++) {
      ai.update();
      sim.step();
      world.drainEvents();
    }
  } finally {
    proto.blockCircle = blockCircle;
    proto.blockSegment = blockSegment;
    proto.unblock = unblock;
    proto.findPath = findPath;
  }
  return ops;
}

const args = parseArgs(process.argv.slice(2));
const logPath = join(tmpdir(), `flaghack-nav-${args.seed}-${args.seconds}s-${args.hippies}h-${args.flags}f.json`);
let ops: Op[];
if (args.record || !existsSync(logPath)) {
  ops = record(args);
  writeFileSync(logPath, JSON.stringify(ops));
} else {
  ops = JSON.parse(readFileSync(logPath, 'utf8'));
}

const map = generateMap(args.seed);
const queries = ops.filter((o) => o.k === 'p').length;
const perCall: number[] = [];
const repMs: number[] = [];
let unreachable = 0;
let newlyUnreachable = 0;
let ratioSum = 0;
let ratioN = 0;
let worstRatio = 0;
let badLegs = 0;
for (let rep = 0; rep < args.reps; rep++) {
  const grid = NavGrid.fromMap(map);
  let total = 0;
  for (const op of ops) {
    if (op.k === 'c') grid.blockCircle(op.x, op.z, op.r, op.id);
    else if (op.k === 's') grid.blockSegment(op.ax, op.az, op.bx, op.bz, op.t, op.id);
    else if (op.k === 'u') grid.unblock(op.id);
    else {
      const t = performance.now();
      const path = grid.findPath(op.ax, op.az, op.bx, op.bz, op.o);
      const ms = performance.now() - t;
      total += ms;
      perCall.push(ms);
      if (rep > 0) continue;
      // Quality, once: against the recording, and every leg a clear line on the grid.
      if (!path) {
        unreachable++;
        if (op.len >= 0) newlyUnreachable++;
        continue;
      }
      const len = pathLength(op.ax, op.az, path);
      if (op.len > 0) {
        const ratio = len / op.len;
        ratioSum += ratio;
        ratioN++;
        worstRatio = Math.max(worstRatio, ratio);
      }
      // A leg leaves from the start only when the start cell is walkable (else from the snap).
      let px = op.ax;
      let pz = op.az;
      for (const [i, p] of path.entries()) {
        const fromSnap = i === 0 && !grid.isWalkable(op.ax, op.az);
        if (!fromSnap && !(op.o?.ignoreDynamic ?? false) && !grid.lineOfSight(px, pz, p.x, p.z)) badLegs++;
        px = p.x;
        pz = p.z;
      }
    }
  }
  repMs.push(total);
}
perCall.sort((a, b) => a - b);
const mean = repMs.reduce((a, b) => a + b, 0) / repMs.length;
const result = {
  score: mean,
  seed: args.seed,
  log: logPath,
  ops: ops.length,
  queries,
  reps: args.reps,
  replayMs: { mean, min: Math.min(...repMs), max: Math.max(...repMs) },
  perCallMs: {
    mean: perCall.reduce((a, b) => a + b, 0) / perCall.length,
    p95: perCall[Math.floor(0.95 * perCall.length)],
    max: perCall[perCall.length - 1],
  },
  quality: {
    unreachable,
    newlyUnreachable,
    meanLengthRatio: ratioN > 0 ? ratioSum / ratioN : 1,
    worstLengthRatio: worstRatio,
    badLegs,
  },
};
if (args.json) {
  console.log(JSON.stringify(result));
} else {
  console.log(
    [
      `FLAGHACK nav eval: ${queries} findPath queries (${ops.length} ops) from ${result.log}`,
      `replay ms  mean ${mean.toFixed(2)}  min ${result.replayMs.min.toFixed(2)}  max ${result.replayMs.max.toFixed(2)} over ${args.reps} reps`,
      `per call ms  mean ${result.perCallMs.mean.toFixed(4)}  p95 ${result.perCallMs.p95.toFixed(4)}  max ${result.perCallMs.max.toFixed(4)}`,
      `quality: unreachable ${unreachable} (newly ${newlyUnreachable}), length ratio vs recording mean ${result.quality.meanLengthRatio.toFixed(4)} worst ${worstRatio.toFixed(3)}, bad legs ${badLegs}`,
      `SCORE (mean replay ms, lower is better): ${mean.toFixed(2)}`,
    ].join('\n'),
  );
}
