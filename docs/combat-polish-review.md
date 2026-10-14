# Combat polish review

This work is isolated on `work/combat-polish-20261012`. The first checkpoint preserves
the previously tested cooperative camp takeover changes. The branch does not match
the installer or game-feed workflow push filters.

## What to look for

- After losing the last altar during the encounter, choose a surviving AI camp.
  Its existing avatar, flags, units, orders and altars should remain intact. Dismiss
  and reopen the chooser, and try another takeover after a second elimination.
- With two human clients, try claiming the same camp. Only one should receive it;
  old queued inputs must not control the newly adopted avatar. A disconnected
  human's reserved camp is not available for takeover.
- Losing every human camp should leave the battle running while an AI altar
  survives. Losing the final altar ends the battle; defeating the giant still
  waits for the existing death sequence.
- Watch the health plaque before a swipe, stomp or grab. The existing status row
  identifies the action and fills once toward its actual contact time. These are
  descriptions of the giant's action, not a claim that the viewer is in range.
- Listen for a short hand rush, lower foot rumble and descending grab creak.
  Interrupting an unconsumed grab should stop its warning. The existing roars,
  beam, impacts and player volume controls remain in place.
- Join during an attack: the plaque should show the current phase without
  replaying an old warning sound. Pause, resume, end and restart a match to check
  cleanup.

## Performance scope

The optimization concerns CPU work when selecting an eye-beam target and route.
Conservative broad-phase rejects skip clearly distant candidates; the existing
exact distance tests, scores and deterministic ordering remain authoritative.
See [the profiling report](combat-performance-20261012.md) for reproducible samples.

These cloud checks do not establish Windows frame rates, GPU performance, or the
subjective mix on real speakers. Actual Windows gameplay and listening remain
part of the review checklist; the cloud browser's WebGL restriction is unchanged.
