# Flaghack Infinity

Flaghack Infinity is a Godot prototype for a Survey Flags game: a solo
1v1v1v1 command-heavy action strategy roguelike where vexillomancers place
Flags, direct hippies, build camp infrastructure, brew drugs, align Flag
chakras, and conquer rival Flag Hearths by enclosing them in Survey Patterns.

## Tooling

- Godot: `4.6-stable`
- GUT: `9.6.0`, vendored under `addons/gut/`
- Primary implementation language: typed GDScript

The prototype keeps Rust/GDExtension out of the first implementation. That
path should only be reopened after profiling identifies a narrow, stable data
boundary that benefits from native code.

## Running

Open the repository root in Godot 4.6 and run `res://scenes/main/main.tscn`.
The main scene launches a placeholder match shell and hands off gameplay truth
to scripts under `scripts/sim/`.

## Tests

Use an installed Godot binary:

```sh
GODOT_BIN=/path/to/Godot_v4.6-stable_linux.x86_64 ./scripts/tools/run_gut.sh
```

If `GODOT_BIN` is not set, the script searches for `godot4.6`, `godot4`, and
`godot` on `PATH`. GUT discovers tests from both `tests/unit/` and
`tests/integration/` through `.gutconfig.json`.

## Project Layout

- `scripts/sim/`: fixed-tick match state, orders, content, and rules
- `scripts/map/`: seedable burn map generation and four-corner setup
- `scripts/ai/`: restricted NPC planner views and strategy profiles
- `scripts/ui/`: scene controllers, command model, overlays, and HUD glue
- `resources/`: data-driven buildings, drugs, abilities, factions, and text
- `scenes/`: Godot presentation scenes
- `tests/`: GUT unit and integration tests
- `docs/brainstorms/`: product requirements and lore notes
- `docs/plans/`: implementation planning artifacts

## Playable Seeds

The first fixture seed is `flaghack-opening-growth`. It is intended to show
four corner camps, a central burn landmark, early Survey Pattern growth, rival
pressure, and debug overlays before final pixel art exists.

## Debug Overlays

The debug overlay exposes Survey Pattern vertices, fulfilled vertices, closed
regions, Flag Hearth capture states, Crystal instability, attention, active
jobs, drug effects, chakra abilities, and NPC intent. These overlays are
presentation-only and must not change simulation state.

## Prototype Limits

This first playable uses placeholder art, shallow content rosters, coarse NPC
strategy, and graph-cell Survey geometry. It intentionally excludes online
multiplayer, save/load, full pixel art, additional player classes, and exact
simulation of underlying aperiodic field behavior.
