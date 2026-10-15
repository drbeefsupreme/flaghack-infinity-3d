/** CPU-only deterministic eye decision benchmark. No browser, GPU, or FPS measurement.
 * From web:
 * node_modules/.bin/rolldown bench/boss-eye-targeting-eval.ts --platform node --format esm --file /tmp/boss-eye-eval.mjs
 * node /tmp/boss-eye-eval.mjs [--count 40|200] [--seed boss-live] [--iterations 60] [--trials 11] [--warmup 150]
 * Run the same compiled workload on immutable before/after sources; avoid concurrent builds/tests.
 */
import { cpus } from 'node:os';
import { createMatch } from '../src/sim/setup';
import { normalizeMatch } from '../src/sim/matchSettings';
import { spawnBoss } from '../src/sim/systems/boss';
import { chooseBossEyeTarget, planBossEyeSweep } from '../src/sim/systems/boss/eyeTargeting';

const args = process.argv.slice(2);
const option = (key: string, fallback: string): string => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const integer = (key: string, fallback: number): number => {
  const value = Number(option(key, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
};
const iterations = integer('--iterations', 60), trials = integer('--trials', 11), warmup = integer('--warmup', 150);
const counts = args.includes('--count') ? [integer('--count', 40)] : [40, 200];
if (counts.some(n => n > 200)) throw new Error('--count must not exceed the supported 200 Signifiers');
const seeds = args.includes('--seed') ? [option('--seed', 'boss-live')] : ['boss-live', 'boss-combat', 'altar-route-1'];
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] };
};
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
  scope: 'Warmed Node CPU-only eye selection plus five-point route; no whole-frame, browser, GPU, audio, or FPS result', iterations, trials, warmup }));
for (const count of counts) for (const seed of seeds) {
  const world = createMatch({ seed, difficulty: 'normal', humans: [0], mode: 'standard', match: normalizeMatch({ maxSignifiers: count }) });
  world.time = 1000; world.effigyRevealedAt = 990;
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.actionAt = world.time;
  const decision = () => { const target = chooseBossEyeTarget(world, boss); return target ? planBossEyeSweep(world, boss, target) : null; };
  const initialRng = JSON.stringify(world.rng), expected = JSON.stringify(decision());
  for (let i = 0; i < warmup; i++) decision();
  const samples: number[] = [], cpuSamples: number[] = [];
  for (let trial = 0; trial < trials; trial++) {
    const cpu = process.cpuUsage(), start = performance.now();
    for (let i = 0; i < iterations; i++) decision();
    samples.push((performance.now() - start) / iterations);
    const used = process.cpuUsage(cpu); cpuSamples.push((used.user + used.system) / 1000 / iterations);
  }
  let hypotCalls = 0;
  const hypot = Math.hypot;
  let route: ReturnType<typeof decision>;
  try { Math.hypot = (...values: number[]) => { hypotCalls++; return hypot(...values); }; route = decision(); }
  finally { Math.hypot = hypot; }
  if (JSON.stringify(route) !== expected || JSON.stringify(world.rng) !== initialRng) throw new Error('Decision or RNG changed during repeat sampling');
  console.log(JSON.stringify({ seed, count, wall: summary(samples), processCpu: summary(cpuSamples), samples, cpuSamples, hypotCalls, route }));
}
