# Boss player-collision CPU profile

## Result

The new player hull has measurable overhead, but its absolute CPU cost is too small in this headless benchmark to explain visible lag. **No production collision optimization was made.**

Normal 60 Hz movement of all four avatars costs about **0.0022–0.0025 ms** at boss contact. A normal boss shove into all four with 90 defended-loop edges adds **0.0052–0.0053 ms**. A client reconciling 12 unacknowledged inputs at contact takes **0.0057–0.0063 ms**. These are CPU microbenchmarks, not browser/GPU frame times or evidence about every client device.

## Scope and method

- Published code: `e51935ad6f9abb7bca3e6e76000705bfbaa2acf7`.
- Previous-solver comparison: `collision.ts` from `1c3de77b38df7a62681e35f33883a2508652466d`, paired with current avatar/setup code. This isolates the solver; it is **not** a whole-release benchmark.
- Node v24.19.0 / V8 13.6.233.17-node.51, Linux x64, exposed AMD EPYC 9V74 CPU, 9 available virtual CPUs. Shared/container hardware, not the user's computer.
- Deterministic seed; four avatars; empty and generated-map collision; hull on/off; far, contact and spawn-overlap positions. Starts and velocity reset every iteration. Generated-map scenarios retain initial obstacles. No AI, whole-simulation, rendering or audio work is timed.
- Normal dt is 1/60; high dt is .25 s. Eleven timed batches after warm-up, usually 3,000 iterations/batch. Tables report medians of batch means. Fresh-process repeats reproduce the scale. Probes run separately from timing.
- Prediction uses the real `AvatarPredictor` and fixed dt, replaying 0/12/60/255 unacknowledged inputs. Boss shoves cover four live players, no loops versus 90 loop edges, and .07/1/20 m requests. The 20 m shove and 255-input replay are intentionally pathological.
- Browser measurement was not attempted; no browser/socket restriction was bypassed.

## Four-avatar movement

Microseconds per movement of **all four avatars**, initial run; divide by 1,000 for milliseconds.

| Generated-map scenario | Previous solver | Current, hull off | Current, hull on |
| --- | ---: | ---: | ---: |
| Normal dt, far | 0.81 | 0.88 | 1.81 |
| Normal dt, contact | 0.91 | 1.07 | 2.45 |
| Normal dt, spawn overlap | 1.10 | 1.57 | 3.79 |
| High dt, far | 1.60 | 1.66 | 3.08 |
| High dt, contact | 2.61 | 3.11 | 6.66 |
| High dt, spawn overlap | 3.73 | 4.12 | 7.79 |

Fresh-process hull-on contact repeats: 2.21–2.45 µs normal / 6.25–6.66 µs high dt. Initial empty-world contact: 1.95 / 5.15 µs; empty-world deep overlap: 2.50 / 9.84 µs.

Each movement registers and removes a pooled cylinder even when far away. At origin, four avatars cause 36 hash-cell insert and 36 removal visits; the cylinder spans 9–16 cells per call depending on position. After warm-up the probe records **zero new Shape allocations**. This is avoidable bookkeeping, but not a measured material hitch.

Empty-world normal far/contact/overlap frames make 4/16/20 body-depth checks; high dt makes 48/104/240. Sweeping scales with the intended 25 cm spatial substeps.

## Single-player prediction reconciliation

Microseconds per reconciliation, initial run:

| Pending inputs | Far off | Far on | Contact off | Contact on |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.11 | 0.07 | 0.07 | 0.07 |
| 12 (200 ms) | 1.92 | 4.39 | 1.96 | 6.28 |
| 60 (1 s) | 9.34 | 23.09 | 9.62 | 31.98 |
| 255 (near history limit) | 39.10 | 86.92 | 40.42 | 127.76 |

N replayed inputs make N movement/hull registrations. The maximum contact result is .128 ms, repeating at .123 ms. Host and client costs occur in different processes in network play; do not add them as one browser frame.

## Boss-driven player shoves

Microseconds per requested boss move into four players, initial run:

| Requested distance | No loop edges | 90 loop edges |
| --- | ---: | ---: |
| .07 m | 1.86 | 5.16 |
| 1 m | 6.87 | 23.12 |
| 20 m | 128.67 | 462.11 |

Far-away players cost approximately .4 µs and skip the push loop. Contact at .07/1/20 m makes 4/20/400 static character moves and the same number of blocked-circle checks, matching 20 cm boss-push substeps. With 90 loop edges, 20 m contact scans 36,000 edge AABBs. The extreme .462 ms result reproduced at .466 ms; ordinary movement is two orders of magnitude smaller.

## Allocations

Node's in-process allocation sampler ran after warm-up with a 1,024-byte interval, including objects subsequently collected by minor/major GC. Instrumentation adds substantial overhead and may change optimization. These are approximate diagnostic totals, **not retained-memory or browser-GC measurements**.

- Four-avatar movement: hull off about .56 KB/frame; hull on about 1.28 KB far / 1.92 KB contact.
- Four-player boss shove: far about .49–.57 KB/call; contact about 4.33 KB at .07 m / 18.88 KB at 1 m.
- Contact movement plus a normal four-player shove: roughly 6.25 KB/frame, or .375 MB/s at 60 Hz continuous contact.

Sources include the hull object, candidate/filter arrays, tentative movement arrays and position/velocity records. These results describe churn, not a leak. The separate probe establishes stable pooled Shape allocation after warm-up; a complete retained-heap audit was not performed.

## Reproduction and verification

From `web/`, using already-installed tooling:

```sh
./node_modules/.bin/rolldown bench/boss-collision-eval.ts --platform node --format esm --file /tmp/boss-collision-eval.mjs
node /tmp/boss-collision-eval.mjs > /tmp/boss-collision-timings.jsonl
MODE=allocations node --expose-gc /tmp/boss-collision-eval.mjs > /tmp/boss-collision-allocations.jsonl
```

The benchmark emits JSONL timing and separate probe records. MODE=motion/prediction/shove narrows the run; TRIALS and ITERATIONS adjust sampling. Default on/off comparisons are portable within the current checkout. Historical comparison used a temporary parent collision module with relative imports redirected to current dependencies, intentionally outside production sources.

```sh
npm run test -- src/sim/systems/boss/playerCollision.test.ts src/net/bossPlayerCollision.test.ts src/sim/physics/collision.test.ts
```

**3 files / 28 tests passed.** Coverage includes all directions, crouch transitions, walking/sprinting/jumping, high impulses/dt, overlap recovery, wall/ramp/ceiling behavior, boss shoves, defended loops, prediction and boss death/removal.
