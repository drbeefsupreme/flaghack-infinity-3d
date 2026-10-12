# Combat CPU audit and eye-target broad phase

## Result

The largest reproducible isolated decision cost in this audit was eye target selection plus
its five-point sweep plan at the supported 200-Signifier setting. A conservative broad-phase
reject reduced its warmed median CPU elapsed time by **31–39%** across three fixed seeds.
The sole production change is nine added lines in `eyeTargeting.ts`. It avoids distant
cylinder and neighborhood distance calculations, then retains the original exact predicates,
`radius2 + 1e-9` tolerance, iteration order, arithmetic accumulation, ranking and tie order.
There is no spatial cache, target cap, model/hit-volume change, or RNG call.

This is an **attack-decision spike**, not a per-render-frame cost: ordinary successful eye
attacks select a new target/route around the 30-second attack cycle; failed selection can
retry after 0.5 seconds. These numbers do not measure or establish browser or Windows FPS.

## Method and before/after evidence

Node 24.19.0 on the shared Linux cloud CPU (Intel Xeon Platinum 8573C), bundled with the installed
Rolldown. Baseline was an immutable copy of the restored v18 source; baseline
`eyeTargeting.ts` SHA-256 was
`98dea25da5b7cf0086a712254a4806bf4a64ecb7fd0c5a13c2067767a4e42bae`.

For each seed and population, create the actual map and standard match with humans `[0]`,
set time to 1000 and reveal time to 990, spawn an idle boss at the effigy, and repeatedly
select a target and plan its sweep without advancing the world. Each variant receives
150 warmups followed by 11 alternating-order batches of 60 decisions. Values below are
medians of batch means, in milliseconds. All returned route coordinates matched exactly.
A batch overlapping an unrelated test run was discarded and rerun. Other shared-host
scheduling/GC noise remains; maxima are not presented as isolated game hitches.

| Seed | Signifiers | Before | After | Reduction |
| --- | ---: | ---: | ---: | ---: |
| boss-live | 40 | 3.037 | 2.098 | 30.9% |
| boss-combat | 40 | 4.020 | 2.686 | 33.2% |
| altar-route-1 | 40 | 4.678 | 3.185 | 31.9% |
| boss-live | 200 | 27.738 | 18.849 | 32.0% |
| boss-combat | 200 | 31.420 | 21.518 | 31.5% |
| altar-route-1 | 200 | 28.196 | 17.309 | 38.6% |

A separate untimed call-count probe on `boss-live` counted Math.hypot invocations:

- 40 Signifiers: **19,556 → 4,648** per complete decision
- 200 Signifiers: **296,552 → 61,530**, a 79.3% reduction
- Support-height calls remain 168 / 816 respectively; neighbor-filter visits remain
  3,872 / 83,232. The optimization preserves exhaustive candidate traversal and ranking.

## Other audited CPU work

These isolated current-source samples guided scope; they are not before/after improvements.
Render samples use the real approved GLB and Three.js objects, without a WebGL renderer.
Geometry and shader/driver submission costs are excluded. Medians are batch means.

- Poses: idle/walk/crouch-walk/grab **0.082–0.109 ms**; live crouch transition **0.194 ms**.
  Pose + placement + active eye layer: **0.147 ms**.
- Synthetic stable multi-contact fields: 32 closed edges/32 visible planes **0.035 ms**;
  400 closed edges/32 planes **0.117 ms**; 3,140 closed edges/32 planes **0.891 ms**.
  The last case makes every edge of a map-sized graph cyclic and is deliberately dense;
  the seeded initial map has only 84 closed-loop edges.
- Ordinary hit-region sampling: **0.002–0.010 ms**; a full projectile test
  **0.005–0.013 ms**. A changing aimed rear-drape fit costs **1.95 ms**, versus
  **0.011 ms** for repeated identical aimed state. The existing drape cache was retained.
- Generated-map grounded foot sweep with no prop contact: **0.055 ms**.
  Static scenery blocking reconstruction: **0.944 ms**. Repeated fresh-map direct
  removals (six runs, first 20 props each): median **1.868 ms**, p95 **4.700 ms**,
  including collision/nav/lattice synchronization. Each removal made one static-nav
  rebuild and one collision removal; render prop updates are excluded here. The existing
  incremental render removal implementation remains unchanged.

Separate diagnostic constructor counters over 1,000 warmed render updates found 8
Quaternion and 6 Vector3 constructions per idle pose, 7 and 6 per walk pose, and 15 and
12 per combined pose/active-eye update. Stable forcefields retained identical meshes and
created no counted Three.js Mesh, Material, BufferGeometry, Matrix4, Quaternion, Vector3
or Euler instances. This is selected class-instance accounting, **not** total JS allocations,
retained heap, a memory leak claim, or browser GC measurement. Plain object/array/Set
allocations are not covered. No pose/field allocation rewrite was justified by these costs.

## Reproduction

From `web/`, with dependencies installed:

```sh
node_modules/.bin/rolldown bench/boss-eye-targeting-eval.ts \
  --platform node --format esm --file /tmp/boss-eye-eval.mjs
node /tmp/boss-eye-eval.mjs --count 200 --seed boss-live \
  --warmup 150 --trials 11 --iterations 60
```

Omit `--count`/`--seed` to run all six cases. The script prints exact routes, wall and
process-CPU samples, and an untimed Math.hypot count. It checks repeated route/RNG stability.
For release comparisons, compile this same benchmark against immutable before/after source
trees using the same dependencies; alternate the two variants and avoid concurrent tests or
builds. Machine-specific raw logs and diagnostic bundles remain outside the checkout.

## Verification and limitations

Boundary/reference regressions compare complete target/routes with a frozen pre-change
evaluator, including 40/200 populations, displaced/rotated bosses, airborne bodies, terrain,
5m cylinder tangency and accepted tiny outward epsilon, 10m neighborhoods, wide building
cylinders, diagonal exact rejection and stable coordinate ties. The four focused files passed **57 tests**, followed by typecheck and `git diff --check`.
The checked-in benchmark compiled and passed a short smoke run, reproducing 4,648 hypot
calls for `boss-live`/40. The smoke run is a functional check, not another timing sample.

No browser DevTools, blocked WebGL bypass, GPU timing, Windows executable/gameplay validation,
network transport latency measurement, audio measurement, or FPS claim was performed.

### Whole-simulation deterministic comparison

Six independent before/after three-rival battles ran for **180 simulated seconds each**
(10,800 fixed ticks per variant per case; 64,800 paired ticks total), starting at the
configured boss reveal time with the human avatar at (-85, 0, 85). These bounded battle
slices were still playing at the end; terminal-match outcomes were not claimed.

Every tick compared exact serialized boss state, complete emitted events and all four RNG
words. Every simulated second and at the end, a second comparison included all avatars,
Signifiers, Flags, projectiles, buildings, pieces, factions, destruction IDs, phase and
outcome. All comparisons passed. This was concurrent correctness work; its timing outliers
are deliberately excluded from performance conclusions.

| Seed | Signifiers | Matching final-state SHA-256 |
| --- | ---: | --- |
| boss-live | 40 | `5e72e98891ceb164cce0a0fbb9191900885ac660d56dd59b6c5f32c78e4ab4ef` |
| boss-combat | 40 | `b068995fce258986ef5875f401a90478ba7f080a6fe661f5875946f285467f09` |
| altar-route-1 | 40 | `eae3f74dd491667d6f65bd6e8bb3fe206d8e196f46f46279dcbfd34799f6c70e` |
| boss-live | 200 | `97671fb58330df26afefafff2bdbbf491c5a474d7fa11cd4616ac2c682f01083` |
| boss-combat | 200 | `65cf726172633327ae63951a241fc74d08e0ab3b804b7d573adc487b6d363914` |
| altar-route-1 | 200 | `3b062df1a950baa7cbc9cff5aef5d22c0b387b8d81ad493b8e34ec527c2b5826` |

The paired scenarios included 427 authoritative footfall events, 654 scenery destructions
and 23 barrier shatters, plus attacks, projectile hits, knockouts, recruitment and tides.
