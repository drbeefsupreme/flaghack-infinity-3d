# Flaghack Infinity

**FLAGHACK ∞ — Survey Flags** is a fast 3D 1v1v1v1 vexillomantic action-strategy game
that runs in the browser (three.js + TypeScript). You are a vexillomancer at a burn. You
throw, plant, pull and steal yellow Survey Flags on an invisible aperiodic **Ley Lattice**,
build Fortnite-speed structures, and command hippies from the **Geomantic Command Center**.
You conquer rival camps by enclosing their Flag Hearth inside your Survey until it is
**overwritten**. The last vexillomancer with a Hearth wins.

> Under no conditions should you attempt to play a game that claims to be Flaghack.

## Play

```sh
cd web
npm install
npm run dev        # http://127.0.0.1:5173
```

`npm run build` produces a static `web/dist/` (serve it with `npm run preview`).

At the title, pick a rival difficulty (Chill / Normal / Hard / Vexillosaint) and choose
**Begin the Survey**. Your camp is at the north-west corner. Its rivals are:

- **Dr. Beelzebub Crow**: a surveyor who hunts Crystals and uses Phason Shift.
- **DJ Scarecrow**: a raider who steals Flags early.
- **President Jaguar**: a warden who hoards Flags and builds one huge enclosure.

A first-match tutorial walks through the loop. **Liber HH** (J) explains every rule in lore
voice.

### Controls

| | |
|---|---|
| WASD / Space / Shift / Mouse | Move, jump, sprint, look (click to lock the pointer) |
| Q · RMB hold + LMB | Quick-throw a Flag · aimed throw (it plants on the node it lands near) |
| E | Plant · hold to pull · at your GCC: Command Table (hold: push the cart) |
| LMB | Swing your staff (harvest lumber, bonk rivals) or place the selected piece |
| Z / X / C / V / B | Tarp Wall / Deck / Ramp / Demolish / camp building |
| 1–5 | Chakra abilities: Priority Beacon, Forced March, Stabilize Zone, Phason Shift, Omega Pulse |
| 6 / 7 / 8 | Saffron, Luminous Dust, Acid Cop Vision |
| G / H / P / T | Rally Signifiers, send followers, D.E.G.E.N. ping, Retransmit "TAKE A SHOT" |
| Tab | Command View: select and order Signifiers, plan Surveys (N/E/P/R = Node/Enclose/Pentacle/Ring), set camp priorities |
| K / J / F1 / L / Esc | Chakras, Liber HH, help, lattice overlay, pause |

## How it plays

- **Flags move reality.** A Flag occupies a Ley Node. When two adjacent nodes hold your
  Flags, a **Ley Line** joins them. Every facet your Ley Lines cut off from the edge of the
  burn joins your **Survey**.
- **Conquest.** Enclose a rival Hearth: Safe → Threatened → Contained → Contested (the
  owner stands at its Hearth) → Overwritten → Captured. Defenders break a loop by pulling
  any one Flag in it; the HUD marks the critical ones.
- **Signifiers** (hippies) do most of the work. They fetch, plant, chop, defend, raid and
  drum according to your Camp Priorities, and report what they're up to over their
  **D.E.G.E.N. Beacon** mesh.
- **The Geomantic Command Center** is a pentagonal push-cart. Its live map tabletop is
  your Command View. It also does Flag Repair, Flag Gifts (recruit neutrals),
  Flagellian Dialectics (convert rivals) and Flag Simulacra.
- **The Burn** comes at 14:00. The effigy burns and capture pressure escalates every two
  minutes. If more than one camp still stands at **Dawn** (30:00), the camp holding the most
  Hearths completes the Survey and wins.

### The Crystal is real quasicrystal physics

- The Ley Lattice is a genuine **Penrose rhombus tiling**, made with de Bruijn's pentagrid
  (cut-and-project from the 5-dimensional lattice Z⁵). Every node carries its 5D Ley
  coordinate, and every planted Flag chimes a note derived from it.
- **Phasons.** Every 75 s a **Phason Tide** sweeps the burn and flips hexagons of the
  tiling. Flags on flipped nodes decohere. Tides favour nodes near the edge of the
  perpendicular-space acceptance window, so the lattice heals toward perfect Penrose
  order. **Phason Shift** flips nodes on purpose.
- **Observation freezes the Crystal** (a quantum Zeno effect). Observed Flags survive
  tides. A Flag counts as observed when your vexillomancer, GCC, Hearth or Wards are
  near it, or when it has Ley Lines to two other Flags (Canon III). Finished loops are
  therefore tide-proof and half-built ones are not.
- **Superposition.** A Flag Simulacrum stands on two nodes at once until a rival comes
  close and collapses it to one.
- **The implied Flag fractal.** A free node at the exact midpoint of two of your Flags
  holds an implied Flag. This holds at edge scale and at the φ-inflated scale, so
  implications cascade to third order.
- **Crystal focus points** are the 5-fold star vertices. Holding all five neighbours (a
  **pentacle**) manifests a Crystal: Ritual income, capture pressure, and C.M.I.
- **Interference.** Overlapping Surveys build instability: moiré shimmer, Flag Psychosis,
  lightning discharges, and phason storms.

## Development

```sh
cd web
npm test               # vitest: lattice/planner/survey/capture/units/economy/map + 3 headless all-AI matches
npm run typecheck
npm run eval:sim -- --seconds 300   # sim perf eval: p95 tick ms, all-AI match (--seed, --top N, --probes, --json)
bun bench/nav-eval.ts  # replayed nav workload benchmark
```

`web/bench/render-eval.js` is the browser render eval: p95 frame ms, JS split, draw calls,
triangles and program-variant switches. Run it from an omp JS eval cell against a hardware
GPU Chrome; see the file header. Each eval reports one score, so they plug into the
harness `/ratchet` hill-climb. In the browser console, `window.fh` stages scenarios:
`fh.advance(seconds)`, `fh.give({lumber, flags})` and `fh.encircle(faction, x, z, r)`.

### Layout (`web/src/`)

- `sim/`: pure, deterministic simulation (no DOM, no three.js). It contains `lattice/`
  (pentagrid, flips, survey geometry, loop planners), `map/`, `physics/` (2.5D
  collision), `nav/`, and `systems/` (rules called in fixed order).
- `ai/`: NPC vexillomancers. They read only what their faction could know and act only
  through `Command`s.
- `render/`: three.js presentation. It covers environment and post FX, actors
  (Flags, avatars, hippies), structures (GCC, Hearths, pieces), and the Survey layer
  plus VFX.
- `game/`: app loop, input, cameras, Command View, build mode.
- `ui/`: DOM HUD and screens.
- `audio/`: procedural WebAudio with no audio files.

## Docs

- `docs/design/2026-10-02-flaghack-infinity-3d.md`: the game design and build contract
  for this version. It covers every rule, number and architecture decision.
- `docs/brainstorms/2026-06-21-survey-flags-game-requirements.md`: product requirements.
- `docs/plans/2026-06-21-001-feat-survey-flags-prototype-plan.md`: the original Godot plan.
- Lore: [the Alch3my wiki](https://wiki.vexillomancy.org/index.php/Main_Page), especially
  [Geomantic Command Center](https://wiki.vexillomancy.org/wiki/Geomantic_Command_Center).

## Legacy Godot prototype

The repository root still holds the first Godot 4.6 scaffold (`project.godot`, `scripts/`,
`scenes/`, `tests/`, run with `./scripts/tools/run_gut.sh`). It is superseded by `web/`
and kept for reference; `web/.gdignore` keeps Godot from scanning the web project.
