---
title: Survey Flags Game Requirements
date: 2026-06-21
topic: survey-flags-game
type: brainstorm
---

# Survey Flags Game Requirements

## Summary

Build a Godot-first, single-player 1v1v1v1 command-heavy action strategy roguelike where each vexillomancer grows a personal Survey Pattern from a Flag Hearth. Camps are conquered by enclosing rival Hearths inside your Survey Pattern, while overlapping rival patterns create Crystal instability, hazards, buffs, and noisy Flag-field chaos.

---

## Problem Frame

Survey Flags has a long-running shared universe with strong lore, images, jokes, and prior game sketches, but the game shape needs to turn that universe into a playable 10-30 minute match. The core risk is making Flags into ordinary collectibles, generic territory markers, or decorative lore instead of treating them as movable reality operators.

The first playable version should prove the whole fantasy in shallow form: command hippies, build and move Flags, grow a personal Survey Pattern, defend a Flag Hearth, use drugs and rituals, fight three rival vexillomancers, and win by conquering camps. Later versions can deepen multiplayer, classes, art, and lore breadth after that loop works.

---

## Lore Guardrails

- Flags are not trophies. They are movable yellow reality-operators whose position, movement history, visibility, and interpretation matter.
- The core verb is moving Flags through a burn-like field so people, hippies, buildings, and rival vexillomancers react to them.
- Survey Patterns are player-facing Crystal geometry. They may be designed from aperiodic quasicrystal-like ideas, but player text should describe Survey, Crystal, Flagistan, Omega, interference, resonance, or instability.
- Vexillomancy should feel sincere inside the world. Characters should treat Flag logic as obvious, even when the result is absurd.
- The burn is the initial arena. Roads, camps, central burn landmarks, field conditions, mud, darkness, pings, bad logistics, and social chaos should shape play.
- Rules can be unstable, local, and contradictory, but the first playable version still needs clear tactical feedback.
- The Crystal, The Flag, Omega configuration, Flagistan, and Flagartha should remain larger than the first match objective.
- Avoid making non-yellow Flags equal to yellow Flags in authority. False Flags, Anti-Flags, purple Flags, and other variants can exist as special cases or hazards.
- Do not make hiding Flags or privately owning Flags the default healthy behavior. Static hoarding should read as suspicious, unstable, or villainous.

---

## Canon Notes To Preserve

| Concept | Game Note |
|---|---|
| Survey Flags | Yellow Flags should read instantly on screen and remain the main objects that make reality change. |
| Vexillomancy | Magic comes from casting, reading, moving, and interpreting Flags in relation to people and space. |
| Signifiers / Ensigns | Hippies and other carriers can knowingly or unknowingly channel Flag work by intending to move or carry Flags. |
| Casting | A meaningful casting spreads Flags across an area, recruits movement, and becomes less trivial than a pattern visible all at once. |
| The Crystal | The Crystal is the emergent structure of Flag relationships, including implied positions, time, weather, color, and instability. |
| The Survey | The Survey is both mapping and world-changing; it can plausibly affect weather, channels, matrices, and local reality. |
| Flag Hearth | This is a game term for the camp core, but it should feel like a local ritual-industrial anchor for Flag creation and command. |
| Flagistan | Treat as an ideal or leaking end-state of perfected Flag arrangement, not as a normal early-game objective. |
| Flagartha / Time Crystal | Keep as deeper escalation material for later stages, false wins, or containment-break content. |
| False Flags / Anti-Flags | Use as special hazards, decoys, cursed states, or transitions, not as ordinary reskins. |
| Vexillians | Use as the broader religious and memetic movement around Flags, with sincere absurdity and advanced knowledge. |
| Geomantic Survey groups | Camps, committees, and rival survey authorities can justify buildings, rituals, bureaucracy, and bad instructions. |
| Acid Cops | Use for hidden-information pressure, psychedelic decoding, enforcement, and noospheric threat material. |
| D.E.G.E.N. Beacon | Good fit for pings, decoys, saved locations, diagnostics, SOS events, and diegetic UI. |
| Field conditions | Mud, rain, sandstorms, darkness, roads, camp clutter, and MOOP should matter to movement, visibility, and Flag work. |
| Golf carts | Include as a high-priority vehicle or event concept because the flag-loaded golf cart image is core table-lore. |

---

## Key Decisions

- **Godot-first engine direction.** Use Godot as the default development environment for editor workflow, 2D scenes, UI, asset iteration, and fast gameplay tuning. Rust can enter later through GDExtension when a stable performance-sensitive boundary appears.
- **Single-player free-for-all first.** The default mode is one human vexillomancer and three independent NPC vexillomancers, each starting from a corner camp.
- **Hearth containment win condition.** A rival camp falls when your Survey Pattern encloses its Flag Hearth and holds through enough counterplay.
- **Command-heavy action split.** The target feel is roughly 75% base building, ordering hippies, and expansion, with 25% direct vexillomancer intervention.
- **Thin full loop prototype.** The first playable version should include every core system in shallow form rather than deeply polishing one isolated subsystem.
- **Separate territory from leveling.** Survey geometry controls expansion and conquest, while flag-chakra alignment is ritual/economy progression that improves but does not directly derive from territory.
- **NPCs obey visible systems.** Rival vexillomancers should build, recruit, place Flags, align chakras, and conquer through mostly the same systems as the player, with simpler decision-making.
- **Prior prototype as inspiration only.** Preserve the finite Flag economy, spatial graph feedback, camp regions, and immediate visual response from `flaghack2`, but do not inherit its Macroquad architecture or incomplete game loop.

---

## Actors

- A1. **Player vexillomancer.** Starts with one Flag Hearth, a small camp, a few hippies, and the ability to pick up and place Flags.
- A2. **NPC vexillomancers.** Three rival camp leaders pursue the same conquest loop under simplified AI.
- A3. **Hippies.** Recruitable workers/minions who find Flags, build Flags, place Flags into Survey Pattern assignments, defend, raid, gather drugs, and carry attention.
- A4. **Flag Hearth.** The camp core that stores or creates Flags, anchors command, and serves as the camp conquest target.
- A5. **Buildings.** Camp structures that accelerate Flag production, recruitment, Hearth defense, and drug brewing.
- A6. **Flags.** Physical, movable map objects that define Survey Patterns, power geometry, and drive conflict.
- A7. **The Crystal.** The emergent field created by Survey Pattern structure and overlap, expressed through instability, resonance, hazards, and buffs.

---

## Requirements

**Match Structure**

- R1. The default match shall be a single-player 1v1v1v1 free-for-all against three NPC vexillomancers.
- R2. Each vexillomancer shall begin in a distinct corner camp with a Flag Hearth, a small hippie group, and access to the same core verbs.
- R3. The map shall be randomly generated while guaranteeing four-corner balance, a central burn landmark, contested neutral space, and meaningful expansion paths.
- R4. A match shall target a 10-30 minute duration once tuned.
- R5. A match shall end through camp conquest, with the final surviving or dominant Flag Hearth winning.

**Flags and Survey Patterns**

- R6. The player shall be able to pick up and place Flags directly.
- R7. Flags shall remain physical game pieces with map positions, ownership/control context, and movement history rather than abstract score tokens.
- R8. Each vexillomancer shall have a personal Survey Pattern that defines preferred Flag placements and expansion geometry.
- R9. Hippies shall be commandable to find Flags and place them into assigned Survey Pattern positions.
- R10. Survey Pattern growth shall expand camp influence, unlock contested space, and create the geometry used for Hearth containment.
- R11. Survey Pattern overlap shall create Crystal instability that can produce hazards, buffs, interference, particle noise, and tactical opportunities.
- R12. Survey Pattern effects shall be mechanically meaningful while using Flag-universe language in all player-facing text.

**Camp Conquest**

- R13. A camp shall be captured when an enemy Survey Pattern contains its Flag Hearth and survives enough resistance to complete the overwrite.
- R14. Rival Flags, buildings, hippies, and defensive abilities shall create counterplay against Hearth containment.
- R15. Destroying or disabling infrastructure may weaken a camp, but infrastructure collapse shall not replace Survey Pattern containment as the conquest rule.
- R16. Conquest feedback shall clearly show when a Hearth is outside danger, being contained, contested, overwritten, or captured.

**Hippies and Command**

- R17. Hippies shall act as the primary labor and minion layer for Flag work, building, recruitment, defense, and raids.
- R18. The player shall spend most of the match issuing orders, assigning priorities, and managing camp expansion.
- R19. Hippies shall be recruitable during the match through a dedicated building or camp function.
- R20. Hippies shall carry attention as the main labor/control resource.
- R21. Hippies shall be able to make mistakes, become distracted, receive buffs/debuffs, or be disrupted by rival effects.

**Buildings**

- R22. The first building roster shall include a Flag-building structure.
- R23. The first building roster shall include a hippie recruitment structure.
- R24. The first building roster shall include a Hearth defense structure.
- R25. The first building roster shall include a drug brewing structure.
- R26. Buildings shall support the command-heavy loop without making direct Flag movement irrelevant.
- R27. Buildings shall be placeable by the player and meaningfully attackable or disruptable by rivals.

**Drugs**

- R28. The first version shall include a small drug roster with distinct buffs, debuffs, and risks.
- R29. Drugs shall be able to affect tactical action, camp attention, hidden information, and chaos risk.
- R30. Drug effects shall be strong enough to change decisions but risky enough to avoid becoming routine upgrades.
- R31. Drug presentation shall fit the lore's noospheric, psychedelic, and Acid Cop-adjacent material without turning drugs into a consequence-free power fantasy.

**Progression and Abilities**

- R32. The only playable class in the first version shall be Vexillomancer.
- R33. The player shall unlock point-and-click abilities by aligning flag chakras.
- R34. Chakra alignment shall be powered by ritual economy rather than direct Survey Pattern area or conquest score.
- R35. Early point-and-click abilities shall primarily command the field by redirecting hippies, forcing priorities, marking targets, or stabilizing chaotic zones.
- R36. Chakra progression shall improve the player's ability to expand and defend Survey geometry without making territory itself the leveling currency.

**Combat and Moment-to-Moment Play**

- R37. Combat shall emphasize minions, buildings, Flag-field effects, and point-click intervention over constant direct player attacks.
- R38. The player shall be able to intervene personally during urgent fights, raids, and containment attempts.
- R39. The game shall use noisy particles and clear effects to make Survey Pattern conflict feel action-packed without hiding essential state.
- R40. Rival attacks shall include Flag theft/movement, building disruption, hippie disruption, Hearth defense pressure, and Survey Pattern interference.

---

## Key Flows

- F1. **Opening camp growth**
  - **Trigger:** A match starts.
  - **Actors:** A1, A3, A4, A5, A6
  - **Steps:** The player surveys nearby space, places initial Flags, assigns hippies to Flag work, builds one or more early structures, and begins extending the Survey Pattern.
  - **Outcome:** The player has a readable camp radius, active hippie jobs, and a first expansion direction.

- F2. **Automated Survey Pattern expansion**
  - **Trigger:** The player assigns hippies to fill Survey Pattern positions.
  - **Actors:** A1, A3, A6, A7
  - **Steps:** Hippies find or build Flags, carry them to target positions, react to field conditions, and update the pattern as vertices are filled.
  - **Outcome:** The pattern grows without requiring the player to hand-place every Flag.

- F3. **Rival pattern collision**
  - **Trigger:** Two Survey Patterns overlap or approach contested geometry.
  - **Actors:** A1, A2, A3, A6, A7
  - **Steps:** Overlap creates Crystal instability, local buffs/hazards appear, hippies and buildings are affected, and both sides decide whether to stabilize, raid, retreat, or push.
  - **Outcome:** The conflict zone becomes the main tactical focus until one pattern stabilizes or loses ground.

- F4. **Flag Hearth conquest**
  - **Trigger:** A Survey Pattern encloses a rival Flag Hearth.
  - **Actors:** A1, A2, A3, A4, A5, A6, A7
  - **Steps:** The attacking pattern starts containment, the defender uses Flags, buildings, hippies, and abilities to break or contest it, and instability escalates around the Hearth.
  - **Outcome:** The Hearth is captured if containment holds; otherwise the camp survives and the attacker loses tempo.

- F5. **Chakra ritual progression**
  - **Trigger:** The player has enough ritual resources, attention, drugs, or building output to attempt alignment.
  - **Actors:** A1, A3, A5
  - **Steps:** The player commits resources to a ritual, accepts risk or opportunity cost, and unlocks or improves a point-click command ability.
  - **Outcome:** The player's command toolkit improves independently of territory size.

---

## Acceptance Examples

- AE1. **Covers R6, R8, R10.** Given the player has a carried Flag, when they place it near a valid Survey Pattern position, then the pattern updates visibly and the Flag becomes part of the local geometry.
- AE2. **Covers R9, R17, R20.** Given hippies are assigned to Survey work, when a target pattern position lacks a Flag, then hippies can seek, build, or transport a Flag according to camp priorities and available attention.
- AE3. **Covers R13, R14, R16.** Given the player's Survey Pattern encloses a rival Flag Hearth, when the defender disrupts enough vertices before containment completes, then the capture state returns to contested or safe rather than completing.
- AE4. **Covers R22-R27.** Given the player has a functioning camp, when they build the first four building types, then each building contributes to Flag production, recruitment, Hearth defense, or drug brewing in a distinct way.
- AE5. **Covers R28-R31.** Given a drug is used, when its buff is active, then at least one meaningful downside, risk, hidden-information distortion, or chaos effect can change the player's decision.
- AE6. **Covers R32-R36.** Given the player performs a chakra ritual, when alignment succeeds, then a point-click command ability unlocks or improves without requiring the player to own more territory.
- AE7. **Covers R1, R2, R5.** Given a default match starts, when the player does nothing, then the three NPC vexillomancers still expand, build, recruit, and eventually pressure camps through visible systems.
- AE8. **Covers R11, R39, R40.** Given rival Survey Patterns overlap, when Crystal instability rises, then the game shows both spectacle and readable tactical consequences.

---

## Success Criteria

- The first playable version can run a complete 1v1v1v1 match from start to camp-conquest end state.
- A player can understand why a Hearth is being captured without reading external lore.
- Survey Pattern placement feels like the central power system, not a decorative territory overlay.
- Hippie automation reduces hand-placement workload while still leaving the player with meaningful commands.
- The direct-action layer matters during crises without dominating base building and command.
- Drugs, buildings, and chakra abilities each change decisions in the match.
- Lore insiders recognize the Survey Flags universe in the verbs, terms, jokes, and constraints.

---

## Scope Boundaries

### Deferred For Later

- Online multiplayer.
- Additional playable classes beyond Vexillomancer.
- Large authored campaign structure.
- Deep roster balance for many drugs, buildings, abilities, and rival archetypes.
- Full final pixel art pipeline and title-screen collage work.
- Advanced containment-break stages outside the burn.
- Exact scientific simulation of the underlying aperiodic field behavior.

### Outside This Product's Identity

- A pure action roguelike where the player personally does most combat.
- A pure RTS where the vexillomancer is only a cursor.
- A generic territory-control game with Flags as ordinary capture points.
- A game that presents itself as the true recovered original Flaghack without diegetic doubt.

---

## Dependencies And Assumptions

- The first implementation will use placeholder graphics before final pixel art assets are generated.
- Godot is the default engine target for the first playable version.
- Rust integration remains optional until a simulation or performance boundary proves it is worth the added workflow cost.
- NPC rival behavior can be simplified as long as the visible verbs match the player-facing systems.
- The first drug roster, building roster, and ability roster should stay small to keep the full loop readable.
- The burn setting can be fictionalized while preserving the lore's camp, field-condition, and Flag ritual logic.

---

## Outstanding Questions

### Deferred To Planning

- What are the first specific drugs and their buff/debuff profiles?
- What are the first point-click command abilities unlocked by chakra alignment?
- What are the exact stages of Hearth containment feedback?
- How many hippies and Flags should each starting camp have?
- What map size and match clock best support the 10-30 minute target?
- How should Survey Pattern vertices be generated, stored, visualized, and selected for hippie jobs?
- Which Godot systems should own map generation, unit commands, combat effects, and UI?
- Which parts of the simulation need deterministic behavior for future multiplayer?
- Where should Rust/GDExtension become a candidate, if anywhere, after the prototype loop exists?

---

## Sources And Research

- Alch3my wiki Survey Flags source: [Survey Flags](https://alch3my.wiki/index.php/Survey_Flags), [Flaghack](https://alch3my.wiki/index.php/Flaghack), [Vexillomancy](https://alch3my.wiki/index.php/Vexillomancy), [The Crystal](https://alch3my.wiki/index.php/The_Crystal), [The Survey](https://alch3my.wiki/index.php/The_Survey), [Vexillomantic holy texts](https://alch3my.wiki/index.php/Vexillomantic_holy_texts), [Flagistan](https://alch3my.wiki/index.php/Flagistan), [Flagartha](https://alch3my.wiki/index.php/Flagartha), [D.E.G.E.N. Beacon](https://alch3my.wiki/index.php/D.E.G.E.N._Beacon), and [Psychedelic Police Force](https://alch3my.wiki/index.php/Psychedelic_Police_Force).
- Prior game attempt: [drbeefsupreme/flaghack2](https://github.com/drbeefsupreme/flaghack2). Useful ideas are finite Flag conservation, visible spatial geometry, camp regions, and immediate feedback; multiplayer and a complete objective loop are not present there.
- Godot technical context: [GDExtension overview](https://docs.godotengine.org/en/stable/tutorials/scripting/gdextension/what_is_gdextension.html), [godot-rust book](https://godot-rust.github.io/), and [Godot high-level multiplayer docs](https://docs.godotengine.org/en/stable/tutorials/networking/high_level_multiplayer.html).
- Physics inspiration should remain design-side: aperiodic order, local vertex structure, interference, and resonance translate into Survey Pattern behavior, Crystal instability, and Flag-universe terms.
