# Boss presentation CPU profile and incremental scenery removal

Baseline: published `e51935ad6f9abb7bca3e6e76000705bfbaa2acf7`.
Runtime: Node 24.19.0, AMD EPYC 9V74; production TypeScript loaded through Vite SSR.

## Finding

A destruction frame synchronously disposed and rebuilt the complete `PropField`: every static
batch, canopy, forest sector, art rotor, stage sign atlas and stage light show. On the seeded
432-obstacle map, one removed prop cost approximately **118–134 ms of render-update CPU**.
Ordinary prop updates cost approximately **0.001–0.003 ms**. Several removals received in the
same frame triggered one rebuild, not a separate rebuild per prop.

This is a reproducible hitch source when boss feet or its beam destroy scenery. It does not
establish the cause of a persistent browser framerate reduction.

## Fix

- Preserve the original four tile/material batches and their buffers and materials.
- Carry canonical obstacle IDs through the existing batch/cloth builders as CPU-only metadata.
- On removal, collapse only owned triangles to their first vertex, and set their sway weights
  to zero. Color and shadow shaders therefore both keep those triangles degenerate.
- Hide destroyed canopy instances using `BatchedMesh.setVisibleAt`. Zero destroyed rotor
  instance matrices and keep subsequent animation updates from restoring them.
- Degenerate only the affected stage sign indices; silence only that stage's beam and floor
  uniforms. Other stages retain their positions in the choreography and their materials.
- Give inter-prop tent strings both endpoint IDs, so losing either endpoint removes the string.
  Porta row-end accessories retain their original owning end unit.
- Reconstruct original layout then apply the durable removed IDs on late joins. This avoids
  previously possible relocation of surviving strings or shared row accessories.
- A cleared/reset destruction set still rebuilds the field. Ordinary destruction never rebuilds.

No new shader, per-vertex visibility attribute/texture, per-prop draw calls, or simulation
behavior was introduced. No animation, model, eye or forcefield code was changed.

## Measurements

Three alternating before/after runs, same seed, same first six obstacle IDs, ordinary nightly
stage animation enabled. These measurements time only `PropField.update`, excluding simulation
collision/navigation rebuilding.

| Quality | Before removal mean | After removal mean | After max |
| --- | ---: | ---: | ---: |
| Low | 118.48 ms | 0.0715 ms | 0.547 ms |
| High | 123.52 ms | 0.0166 ms | 0.039 ms |

The new path also removed all 431 destructible obstacles one at a time, three times per quality:
1,293 removals per quality; p95 at most 0.073 ms, maximum 0.681 ms. A later independent run of
the portable benchmark measured 118.94 → 0.0708 ms low and 121.66 → 0.0142 ms high for the
same first-six sequence (largest after outlier 0.727 ms). CPU timing varies with JIT/GC and
concurrent workload. These large differences are not browser FPS measurements.

Initial constructor means in the alternating run were 135.54 → 142.20 ms low and
130.57 → 140.73 ms high: approximately 7–10 ms extra at field creation. A separate repeat
varied between about −10 and +21 ms, so small startup differences are not tightly isolated.
Ordinary per-frame updates stayed in the same approximately 0.001–0.003 ms range.

### Other measured boss CPU work

6,000 warmed calls per case unless noted. The same approved asset contains 109 bones, 151
objects, 31 consolidated skinned meshes, and 401,386 triangles.

| Component | Mean CPU time |
| --- | ---: |
| Ordinary idle/walk/attack pose sampling | 0.029–0.034 ms |
| Crouch/rise transition, including live IK | 0.077–0.079 ms |
| One full model matrix update | 0.0066–0.0080 ms |
| Rear-flap stabilization alone | 0.0104 ms |
| Inactive eye aim/update | 0.0016 ms |
| Active eye aim/update | 0.0321 ms |
| Pose + final placement matrix + active eye | 0.1016 ms |
| Cached forcefield scan, 400 synthetic closed-loop edges | 0.0258 ms |
| Cached forcefield scan, 4,000 synthetic edges | 0.2897 ms |
| Stable contact FX, 4–31 shields | 0.0050–0.0148 ms |

The sample map has 3,140 total lattice edges and 84 initial closed-loop edges. The 4,000 and
12,000-edge synthetic tests deliberately exceed this map's initial workload; 12,000 scanned
edges cost 1.11 ms. An invalidated cycle-graph cache costs more than a cached scan and is not
an every-frame rebuild. Shield meshes/materials are reused while contacts remain active;
alternating enter/exit cases cost roughly 0.016–0.099 ms for 4–31 shields, excluding GPU work.

Disabled-component diagnostics reduced walk sampling from about 0.034 to 0.019 ms when full
model matrix calls were suppressed. These diagnostics are not valid visual implementations
and were not retained. There was no evidence to justify changing the approved pose/eye layers.

## Memory and GPU tradeoffs

- Low quality retains 742 unique ownership ranges and 816 owner-to-range references; high
  retains 743 and 817. Both cover all 431 destructible props. Shared references are strings
  attached to two obstacles.
- A compact V8 serialization of ownership IDs, range starts/counts, geometry references,
  canopy-instance IDs and rotor-owner IDs is **21,385 bytes low / 21,415 bytes high**. This is
  an exact representation size, not a resident-JS-heap measurement; Maps, arrays, objects,
  sets and retained stage specs add engine-dependent overhead. Transient construction owner
  arrays are not uploaded as GPU attributes.
- Unique geometry/index/instance attribute backing-store payload is **20,992,904 bytes low /
  22,536,616 bytes high** and remains exactly the initial size after all 431 removals. This
  counts intended GPU buffer payload, not measured GPU allocation, and excludes textures,
  renderer state and driver overhead.
- Destroyed static triangles remain as degenerate vertices in the original buffers until
  reset/disposal. Their vertex workload is retained; buffers no longer shrink during gameplay.
  This deliberately trades runtime compaction for immediate removal without replacement geometry allocation.
  Canopy instances are hidden; static draw structure is unchanged. No compaction is added.

The 20 m → 32 m boss scale does not increase vertex count or the number of material meshes.
At an unchanged camera distance, a similarly projected 1.6× linear scale can cover roughly
2.56× the screen area before clipping/occlusion. Larger forcefield planes and simultaneous
additive contacts can also increase fragment overdraw. These are plausible GPU-cost changes,
not measurements. Actual GPU timings, shadow-pass cost, WebGL upload stalls, shader compile
cost, browser FPS and audio were not measured by this Node harness. The known browser socket
restriction was not bypassed.

## Verification

- Initial low/high geometry signatures match the published baseline exactly: every vertex
  attribute, index array, instance matrix/color and key material settings. Same mesh count.
- Six focused prop/batch tests pass, including ownership through cloth merging and tile splitting,
  each prop kind, unchanged non-owned attributes/materials/meshes, dirty subranges, retained
  forest, canopy and rotor removal, repeated updates, shared strings, partial-stage lighting,
  full stage removal, late join reconstruction, reset and disposal.
- Full seeded-map ownership covers every destructible obstacle. Removing all of them leaves
  zero non-degenerate triangles in all four static prop batches.
- Final combined checks: 934 tests across 103 files, typecheck, client
  build and server build all pass.

## Reproduction

From `web/`, run the checked-in portable benchmark:

```sh
node bench/prop-removal-eval.mjs --runs 3 --output /tmp/prop-removal-after.json
```

For a before/after comparison, from the repository root first prepare an immutable baseline
source directory (the benchmark reads it; it does not edit it):

```sh
baseline=$(mktemp -d)
git archive e51935ad6f9abb7bca3e6e76000705bfbaa2acf7 \
  web/src web/package.json web/vite.config.ts web/tsconfig.json | tar -x -C "$baseline"
ln -s "$PWD/web/node_modules" "$baseline/web/node_modules"
node web/bench/prop-removal-eval.mjs --baseline "$baseline/web" --runs 3 \
  --output /tmp/prop-removal-comparison.json
cd web
npx vitest run src/render/env/props
```

The benchmark uses the actual builders and seeded world; only Canvas2D sign painting is
stubbed, matching the test harness. It performs no browser or GPU work. A Vite HMR socket
warning from concurrent SSR servers does not affect these in-process module measurements.
