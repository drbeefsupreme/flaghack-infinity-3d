# Fork iteration: configurable matches and controls

## Match setup

Begin the Survey opens the lobby for local games; joining a host opens the multiplayer lobby. Each of the four player seats has an On/Off toggle, and the number of days is selected in the lobby. At least one seat remains on. Offline, choose any enabled character with Play this character; other enabled seats use AI. Turning off the selected local seat moves you to another enabled seat. Disabled seats show a neutral numbered placeholder and have no avatar, Hearth, GCC, starting stock or Signifiers in the match. They also stay out of the Hearth rail, standings and end-of-match statistics. Their camp scenery remains part of the map.

In multiplayer, the leader controls match setup. A human must leave a seat before its camp can be disabled. New arrivals take only enabled seats; other arrivals spectate. Match settings travel with the authoritative world options so clients generate the same lattice. The network protocol is version 6; all players must use the same build.

Choose 1–5 days or Unlimited. A day means one complete daylight/night cycle. Default: 1 day at 1,800 seconds, preserving the original 14:00 Burn and 30:00 Dawn deadline. With multiple days, the Burn occurs at the same point in the **last** cycle. The sky repeats each cycle. Conquest can finish a competitive match earlier; a single-camp creative/solo match finishes only at its time limit. Unlimited has no time limit or scheduled Burn; competitive conquest still works.

Advanced Game Settings opens a separate window with a scrolling body, a fixed header and footer, and Done, close, Escape and backdrop dismissal. It contains the number of days, rival difficulty, random or fixed world seed, and all configurable match parameters below. Reset defaults preserves the lobby's player-seat selection. Online guests can inspect the settings; only the leader can edit them before the match. Advanced settings are bounded and applied at match creation:

| Setting | Range | Default |
| --- | --- | --- |
| Full day length | 300–7,200 seconds | 1,800 |
| Lattice edge spacing | 6–12 metres | 8 |
| Starting lumber | 0–1,000 | 150 |
| Stock Flags per Hearth | 0–100 | 14 |
| Starting Signifiers per camp | 0–12, limited to an equal share of the world population | 6 |
| Jump height multiplier | 0.1–5.0 | 1.0 (original height) |
| Maximum Signifiers (whole world) | 0–200 | 40 |
| Structures block flag placement | Off / On | Off |

Home-loop Flags and the avatar's six carried Flags are unchanged by stock tuning. Lore/help text that describes the original rules retains the original default values; the live clock uses the chosen match settings.

Jump height scales the jump apex (2.0 is twice the original height) for both authoritative movement and client prediction. Structure blocking reserves the corner nodes of standing camp buildings when enabled. Terrain, occupied nodes and crystals always prevent placement.

## Original scaffold burn with an exposed burning Flag and pole

The original scaffold fire, 55-second timber charring, crown-first 85–140-second nominal
lattice dissolve and lasting smoulder are preserved. The scaffold does not scale down,
and this variant adds no crater. Match scheduling and victory rules remain unchanged.

- At 20 seconds after ignition, the five guy/support wires and their pennants break loose
  and fall from rest with the game's existing gravity of 24 world-units/s². Their displacement
  follows ½gt², landing within about 1.24 seconds on the meadow or original plinth. Only then
  do the grounded remnants burn away; all are gone by 30 seconds. Ground anchors remain.
- Until 90 seconds, the top Flag and pole retain their original appearance and heat glow.
- At 90 seconds, the Flag, mast, straps and gold finial turn white-hot together. One group
  scales them equally in X, Y and Z about the plinth top, keeping the cloth attached to the
  pole. The rest of the scaffold and the plinth remain at their original size.
- Shrink starts gently, then accelerates, with a clearance guard against the original
  scaffold's remaining burning-height envelope. That envelope includes the original shader's
  maximum +17-second texture jitter and +11-second cell jitter, so burning fragments can
  persist until 168 seconds. The cloth's hoist stays above that conservative envelope rather
  than being pulled inside the scaffold; original permanent low stumps are excluded.
- Flag and pole share one set of colour/emission uniforms: white at 90 seconds, yellow at
  116, red at 142, black with no emission at 168, and fully consumed at 176. The longer visible
  descent does not alter the scaffold's original 150-second main burn or lasting smoulder.
- At 176 seconds, only the obsolete mast collision shapes retire on the host and mirrored
  clients. The original plinth, low charred remnants, map blocking and navigation remain.
- Tutorial keeps its original flag/pole appearance and collision because its lesson-owned
  ignition clock is separate from the replicated scheduled match clock.

The added curves in `render/env/burn/burnTimeline.ts` sample simulation time directly. Skipped
frames and late joins therefore show the correct stage without event history or frame counters.
The colour and depth materials use the same guy-line fall deformation and discard mask. The pole completion time
is shared with simulation through `sim/effigyBurn.ts`.

## Shared population and recruitment

Maximum Signifiers is the fixed population for the whole map, including all camps, neutrals and knocked-out hippies. Starting workers come from this pool; the remainder starts neutral. A knockout drops carried items, clears orders and returns the same hippie to a neutral spawn after 14 seconds. Recruitment changes allegiance without creating new hippies.

Working Drum Circles and Geomantic Command Centers each recruit one nearby neutral within 15 metres every 14 seconds, without a Flag or lumber cost. Neutrals within 60 metres drift toward the nearest working recruiter. A recruiter with nobody nearby waits until a neutral arrives. The GCC's former Gift action is removed; its other powers remain available.

Aim at an awake, empty-handed neutral within 3 metres and press Interact (E by default) to hand them a carried Flag. Command View also offers **Hand Flag** for a selected neutral within reach. Throwing a Flag directly into a neutral recruits them immediately without damage. Both transfers give them the actual Flag. Rival hippies still take damage from thrown Flags; a knockout makes them neutral when they respawn.

Camp capacity is a soft attention limit: 12 plus 6 per working Drum Circle, with no fixed ceiling. Flags, buildings and Dialectics can recruit beyond it, including beyond 40 in a camp. The newest recruits above capacity lose an additional 2 attention per second, including while idle, and cannot recover by resting at home. At zero they take the normal distraction break. Increasing capacity or losing members removes the excess penalty from hippies who now fit within capacity. The HUD shows recruited population / attention capacity, with excess count in its tooltip. The separate Maximum Signifiers setting controls the whole world's population and must be raised above its default of 40 for a match with more than 40 hippies total.

## Controls

Settings → **Customize controls — keyboard, mouse & gamepad** contains action rows with separate keyboard, mouse and controller bindings. Click a keyboard field and press a key; Delete unbinds it. Escape remains available to close menus. Settings persist in this browser. Reset controls restores defaults.

Standard-mapped controllers use left stick movement, right stick camera look, A/Cross jump, X/Square interact, Y/Triangle quick throw, RT/R2 attack/build, LT/L2 aim, left stick click sprint, View/Select command view, and Menu/Start pause. The other default mappings appear in the settings table. Deadzone, controller look sensitivity and swapping sticks are configurable. The main Settings panel has separate **Invert mouse** and **Invert gamepad** toggles. Each applies only to that device, even when both devices move in the same frame; neither reverses the Command View cursor. Both preferences persist independently. Keyboard and mouse remain active alongside the controller.

Sprinting uses a forward-leaning, arms-back Naruto run pose and prevents throwing Flags. Entering throw mode (RMB or LT/L2 by default) ends sprinting and automatically collects nearby loose ground Flags into the quiver, including when the quiver is empty. It respects quiver capacity and leaves planted Flags alone.

In Command View, the movement stick pans the camera and the look stick moves the cursor; the attack and aim bindings select/order. In menus, D-pad up/down moves focus, left/right changes a focused dropdown, A/Cross activates a control, and B/Circle or Menu/Start closes a panel or resumes. A keyboard remains necessary for text fields such as multiplayer passwords and names.

Controller movement/buttons are cleared on blur, disconnect and screen changes. A physical-controller smoke test remains necessary on the user's hardware.

## Boss reveal

- Advanced Game Settings has `bossMode`, default on. Tutorial and the title/lobby
  attract world opt out; disabling it preserves the approved non-boss sequence.
- The simulation stores and replicates `effigyRevealedAt` exactly 90 seconds after
  the scheduled Burn. A skipped step or late join reconstructs the same state.
  Protocol version 6 includes this field and the full encounter state.
- Reveal clears both original pedestal and mast collision, rebuilding static
  navigation and lattice plantability without discarding dynamic blockers.
- The last five seconds charge the original structure white. At 90 seconds it
  disappears into a white burst, shock ring, charred timber, embers and ash smoke.
  The actual rig rises through the ground during the 85–90 s white phase, glowing
  white with its arms crossed. In the final 0.55 s it opens its arms and tilts its
  head back, reaching the full gesture at 90 s. The same authoritative frame
  restores every original material instantly; no rise or glow fade follows the
  explosion. A short back-shell burst leaves the colored boss visible in front
  of it, and a persistent black crater remains.
- Boss source geometry is unchanged; a uniform 0.625 scale makes the complete
  boss 20 m tall including its hat. Per-material runtime consolidation reduces
  594 draws to 31 while preserving all 401,386 triangles and 109 bones.
- The reveal starts the cooperative encounter below. Ordinary Dawn and conquest
  endings stop during the fight. With a 300-second day the Burn is at 140 s and
  reveal at 230 s; the former 300-second Dawn deadline no longer ends the fight.

### Cooperative giant encounter

When the default-on boss option reaches its reveal, the giant becomes an authoritative
encounter. The approved 85–90 second effigy reveal is unchanged. Before that moment camps
remain rivals; afterward player-controlled and NPC camps are allies. Rival damage,
knockback, flag theft, Dialectics conversion and altar overwrites stop. NPC vexillomancers
and their Signifiers attack the giant. Priority Beacons can direct your Signifiers at it.

- For testing, the giant starts with 5,000 HP: about 137 seconds of one player's actual
  held, unbuffed staff attacks in continuous contact. Staff timing and damage are unchanged.
  The earlier four-minute calibration was 8,800 HP; the lower value is a deliberate testing
  override. Cooperation, Signifiers and thrown Flags shorten the encounter.
- A thrown Flag deals 50 damage to the body or 100 to the head/hat, destroys the Flag, and
  bursts into a colored firework at the exact impact point. Swept collision regions follow
  the approved animated rig, including crouching, arms, skull and hat; walls still stop a
  throw before it reaches the giant.
- The giant prioritizes the living faction with the highest CMI, briefly retaliates against
  attacking vexillomancers, walks standing over distance, and crouches for hand attacks.
  Sweeps launch units through real ballistic flight. Stomps and steps crush units and built
  structures. Grabs consume Flags, walls and buildings, including altars.
- Every intact Flag cycle, including nested loops and implied-Flag loops, blocks the whole
  giant footprint. Contact flashes the owner's color. The giant must consume real supporting
  boundary Flags, rather than teleporting through a defense. A small loop also prevents a
  hand from reaching across it to consume an altar.
- Losing an original altar does not eliminate a camp with another owned altar. Losing the
  final owned altar does. This rule applies in ordinary conquest and in the encounter.
- At zero HP the giant catches fire, falls to its knees and burns away for 12 seconds. Only
  then do the surviving camps win together. If every human camp is eliminated first, the
  result is an explicit loss; an AI-only game instead waits for every active camp to fall.
  Dawn and conquest do not end an active giant encounter.

Combat decisions, hits and outcomes run on the host's fixed simulation clock. Snapshots and
state frames include movement, HP, action times, stance, held targets, barriers, airborne
Signifiers and the shared result. Late joins reconstruct the current state without replaying
old fireworks. Clients animate the approved 20 m, 109-bone model in place; its 594 source
primitives remain consolidated into 31 equal-material skinned draws without geometry or
color changes. Boss-off mode and the Training Burn keep their original behavior.

Verification includes simulation/action-window tests, full encounter runs, animated-region
projectile tests, real host/two-client/late-join tests, and production-shader visual proofs.
The current cloud executor cannot launch Chromium's socket service; the shader proofs are
not a browser gameplay certification. A final interactive browser playtest is still useful
before release. Publishing this branch does not deploy the game.
