# Effigy crater crystal Easter egg

A Crystal manifested at a focus inside the revealed Effigy crater now has a permanent 10× uniform linear scale. The regular 7.5 m prism becomes 75 m tall. The trigger uses the same seeded 80-segment irregular outer skirt as the rendered crater, transformed by its real center and gameplay scale. Boundary points count as inside.

- Eligibility is evaluated only when the Crystal is created. Existing Crystals do not suddenly grow when the crater appears. A focus already present before the reveal qualifies when subsequently manifested.
- Scale is authoritative entity state, carried by both deltas and full snapshots. Protocol version is 9 because the entity field layout changed.
- Breaking the pentacle shatters it normally; remanifestation reevaluates eligibility without multiplying an old scale.
- The original Effigy crater remains eligible after the boss dies or is removed. A boss-death crater elsewhere is irrelevant. Tutorial and non-boss worlds do not get an invented crater.
- Prism, shard geometry/orbits/motion, halo and pillar dimensions scale together. Shader instances remain uncullable as before; they are anchored at ground level. Shattering retains scale, pooled views reset it, objective marker bounds and defensive lightning tip match the larger crystal.
- Crystals intentionally have no physical body collider, attack hitbox, HP or attachable flag socket. The existing placement rule blocks the exact focus node, not a physical radius. Those rules, ritual income, growth duration, observation radius, pentacle membership and defensive/capture strength are unchanged.
- No tutorial, lore or notification text reveals the secret.

## Verification

Focused check: 18 tests passed across craterCrystal.test.ts, render/survey/crystals.test.ts and wardPull.test.ts, including 11 new regressions. The full combined batch passed 934 tests across 103 files, typecheck, and both client and server builds.

The boundary test compares the trigger's rim against actual rendered geometry at all 80 radial vertices, then verifies points immediately inside, on and outside the rim. Other tests cover growth/income, repeated updates, break/remanifest, pre-reveal/absent/non-boss/outside cases, a fresh match, delta/full-snapshot/event-free late joins and lightning origin. Render tests verify 10× GPU instance dimensions at 0%, 30% and 100% growth, glow/pillar dimensions, shatter persistence and pooled-view reset.

An isolated Three/Mesa proof rendered the production CrystalLayer prism and shard shaders beside the actual generated crater, with a naturally generated focus at the center and an ordinary crystal outside. All four shader programs compiled and linked, and OpenGL returned no errors. This is a real shader render, not full-game browser QA: the proof omits the pillar/halo for an unobstructed size comparison and does not include the full-game postprocessing pipeline. Proof assets live outside the repository in the task's crater-crystal-proof directory.

## Center-focus question

Grid generation explicitly finds a five-thick-rhombus star and translates it to (0,0), assigning it as omegaNode. The Effigy is also at (0,0). Read-only validation across 30 seeds and all 13 supported grid scales (6 through 12 in 0.5 steps) found a central five-neighbor focus in all 390 cases. This is an initial-grid invariant; nearby phason flips can subsequently change the focus topology. No change to the grid generator was made.
