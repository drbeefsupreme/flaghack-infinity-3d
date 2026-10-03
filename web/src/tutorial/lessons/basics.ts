/**
 * Lessons 1–6: the body, the Flag, Ley Lines, the Survey, implied Flags and phasons. The drills
 * happen on open ground between the camp and the centre of the burn (campPoint), each staged
 * fresh when the trainee continues past its briefing, so any lesson can be replayed.
 */
import type { ObjectiveMarker } from '../../game/session';
import { AVATAR, BUILDINGS, GCC, GCC_REACH, HEARTH_OBSERVE_RADIUS, LEY_EDGE, MAP_HALF, SIM_DT } from '../../sim/constants';
import { planEnclosure } from '../../sim/lattice/planner';
import { latticeTopology } from '../../sim/lattice/topology';
import { PHI, wrapAngle } from '../../sim/math';
import { canPlantAt } from '../../sim/systems/flags';
import { isObserved } from '../../sim/systems/survey';
import { applyFlip } from '../../sim/systems/tides';
import type { EntityId, FactionId } from '../../sim/types';
import type { World } from '../../sim/world';
import { saint } from '../lesson';
import type { LessonScript } from '../lesson';
import { avatarDistance, campSpots, EnclosureProbe, nodeDistance, plantFresh, quietNode, spotNode, topUpQuiver } from '../staging';

/** Arrival thresholds: metres walked, radians looked round, seconds sprinted. */
const WALK_DISTANCE = 5;
const LOOK_TURN = 2;
const SPRINT_TIME = 0.6;
const SPRINT_SPEED = AVATAR.runSpeed + 1.5;
/** A thrown Flag counts when it plants this close to the throw marker. */
const THROW_SLACK = 4.5;
/** The phason drill: the trainee steps this far from the lone Flag (beyond its 12 m gaze). */
const AWAY_DISTANCE = AVATAR.observeRadius + 2;
/** Phason drill Flags stand beyond the gaze of the Command Center and every Hearth. */
const GCC_GAZE_CLEAR = GCC.adviceRadius + 4;
const HEARTH_GAZE_CLEAR = HEARTH_OBSERVE_RADIUS + 4;
/** Seconds between the forced tide's warning and its wave. */
const TIDE_LEAD = 5;
/** Straight-run lengths of the two implied-Flag scales. */
const SHORT_RUN = 2 * LEY_EDGE;
const LONG_RUN = 2 * PHI * LEY_EDGE;
const RUN_TOLERANCE = 0.25;

export const arrival: LessonScript = {
  id: 'arrival',
  briefing: [
    saint(
      'Welcome to the Training Burn, Dr. Beef Supreme. I am the Vexillosaint, transmitting from the Geomantic Command Center. ' +
        'My robe will not let me speak a falsehood, so you may believe every word.',
    ),
    saint('This is Survey 101: twelve lessons, and for each one a fragment of the **Seal of Flagistan**. Earn them all and the Seal is whole.'),
    saint('We begin with your body. Walk with me.'),
  ],
  objectives: [
    { id: 'walk', text: 'Walk: {key:W} {key:A} {key:S} {key:D}', hint: 'Hold W to walk where the camera faces; A and D step sideways, S backs up.' },
    { id: 'look', text: 'Look around: move the mouse', hint: 'Click the burn to capture the mouse, then move it to turn. Esc lets it go.' },
    { id: 'sprint', text: 'Sprint: hold {key:Shift} while you walk', hint: 'Keep W held and press Shift: you run at 11.5 m/s instead of 8.' },
    { id: 'jump', text: 'Jump: {key:Space}', hint: 'Tap Space. You will want it for ramps and decks.' },
    {
      id: 'gcc',
      text: 'Walk to your **Geomantic Command Center**, the black cart with the yellow banner',
      hint: 'It is parked beside your Hearth; follow the yellow marker.',
      highlights: ['minimap'],
    },
  ],
  debrief: [
    saint(
      'That cart is your Geomantic Command Center. Dr. Beef Supreme built the first one in 2017 to explain Flagistan to hopelessly lost and confused hippies. It still works.',
    ),
    saint('Its table is a living map of the burn, and its Geomantic Advice holds the Crystal still for 30 m around it. We will be back.'),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    const av = world.avatarOf(f);
    let current = 0;
    let startX = av.pos.x;
    let startZ = av.pos.z;
    let lastYaw = av.yaw;
    let turned = 0;
    let sprinted = 0;
    let jumped = false;
    return {
      activate(i) {
        current = i;
        startX = av.pos.x;
        startZ = av.pos.z;
        lastYaw = av.yaw;
        const gcc = world.gccOf(f);
        if (i === 4 && gcc) ctx.mark([{ id: 'gcc', kind: 'entity', entity: gcc.id, label: 'Your Command Center' }]);
      },
      tick() {
        // Only the current skill counts: doing it early does not tick it off.
        if (current === 1) {
          turned += Math.abs(wrapAngle(av.yaw - lastYaw));
          lastYaw = av.yaw;
        } else if (current === 2 && av.input.sprint && Math.hypot(av.vel.x, av.vel.z) >= SPRINT_SPEED) {
          sprinted += SIM_DT;
        } else if (current === 3 && !av.onGround && av.vel.y > 1) {
          jumped = true;
        }
      },
      progress(i) {
        switch (i) {
          case 0:
            return Math.hypot(av.pos.x - startX, av.pos.z - startZ) >= WALK_DISTANCE ? 1 : 0;
          case 1:
            return turned >= LOOK_TURN ? 1 : 0;
          case 2:
            return sprinted >= SPRINT_TIME ? 1 : 0;
          case 3:
            return jumped ? 1 : 0;
          default: {
            const gcc = world.gccOf(f);
            return gcc && avatarDistance(world, f, gcc.pos.x, gcc.pos.z) <= GCC_REACH + BUILDINGS.gcc.radius ? 1 : 0;
          }
        }
      },
    };
  },
};

export const flag: LessonScript = {
  id: 'flag',
  briefing: [
    saint('"Here we see the tools of the Vexillomancer: the Flag and another Flag."'),
    saint('Every Flag is yellow; only the ribbon at the finial shows whose it is. Your quiver is top left, and your Hearth refills it whenever you stand close.'),
    saint('Flags stand on **Ley Nodes**, the corners of the invisible lattice under the burn. {key:L} shows or hides it.'),
  ],
  briefingHighlights: ['hud-flags'],
  objectives: [
    {
      id: 'plant',
      text: 'Walk to the marked Ley Node and plant a Flag: {key:E}',
      hint: 'Stand within a few steps of the marker; the prompt by the crosshair tells you when E will plant.',
      highlights: ['hud-flags', 'prompt'],
    },
    {
      id: 'throw',
      text: 'Throw a Flag onto the far marker: crosshair on it, tap {key:Q}',
      hint: 'Hold RMB to see the arc, then LMB or Q to throw. A thrown Flag plants itself on the nearest free node within 3 m of where it lands.',
      highlights: ['hud-flags'],
    },
  ],
  debrief: [
    saint('A Flag in the ground is a claim on reality; a Flag in the air is a claim on the future.'),
    saint('"Survey Flags must be surveyed, it\'s in their nature." They want to be moved, not kept.'),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    const lat = world.lattice;
    topUpQuiver(world, f, 4);
    const plantNode = spotNode(world, f, 20, 0, (n) => quietNode(world, n, f));
    const throwNode = spotNode(world, f, 36, 0, (n) => {
      if (!quietNode(world, n, f)) return false;
      return plantNode < 0 || nodeDistance(world, n, lat.nodes[plantNode].x, lat.nodes[plantNode].z) >= 12;
    });
    const thrown = new Set<EntityId>();
    let current = 0;
    let landed = false;
    return {
      activate(i) {
        current = i;
        if (i === 0 && plantNode >= 0) ctx.mark([{ id: 'plant', kind: 'node', node: plantNode, label: 'Plant here' }]);
        if (i === 1 && throwNode >= 0) {
          const n = lat.nodes[throwNode];
          ctx.mark([{ id: 'throw', kind: 'area', at: { x: n.x, z: n.z }, radius: AVATAR.throwSnapRadius, label: 'Throw here' }]);
        }
      },
      event(e) {
        if (current !== 1 || throwNode < 0) return;
        if (e.t === 'flagThrown' && e.faction === f) thrown.add(e.flagId);
        else if (e.t === 'flagLanded' && e.node >= 0 && thrown.has(e.flagId)) {
          const n = lat.nodes[throwNode];
          if (nodeDistance(world, e.node, n.x, n.z) <= THROW_SLACK) landed = true;
        }
      },
      progress(i) {
        if (i === 0) return plantNode < 0 || world.survey.nodeFlagOwner[plantNode] === f ? 1 : 0;
        return throwNode < 0 || landed ? 1 : 0;
      },
    };
  },
};

export const ley: LessonScript = {
  id: 'ley',
  briefing: [
    saint('One Flag is a point. Two Flags on neighbouring nodes make a **Ley Line**: the lattice edge between them lights up in your colour.'),
    saint('"The Flag Has a Pole, The Pole is a Line, The Line Has a Point."'),
  ],
  objectives: [
    { id: 'line', text: 'Plant Flags on the marked nodes until a Ley Line joins them', hint: 'The marked nodes share one lattice edge. Plant on each with E.' },
    {
      id: 'pull',
      text: 'Pull one of them back up: crosshair on the Flag, hold {key:E}',
      hint: "With Flags in your quiver, E plants on a free node unless your crosshair is on a Flag: look at it until the prompt says Pull. Your own Flag comes up in a third of a second; a rival's takes a full second.",
      highlights: ['hud-flags'],
    },
    { id: 'replant', text: 'Plant it again and watch the line come back', hint: 'E on the empty marker.' },
  ],
  debrief: [
    saint('Lines live and die with their Flags. Canon III: every Flag should see two others. A Flag with two Ley Lines watches itself, and that will matter soon.'),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    const lat = world.lattice;
    const s = world.survey;
    topUpQuiver(world, f, 4);
    const lone = (n: number): boolean => {
      if (s.nodeFlagOwner[n] !== f) return false;
      for (const e of lat.nodes[n].edges) if (s.edgeLey[e] >= 0) return false;
      return true;
    };
    /** The lowest-id neighbour of `a` that can join it in a fresh Ley Line, or -1. */
    const partner = (a: number): number => {
      let b = -1;
      for (const e of lat.nodes[a].edges) {
        const m = lat.other(e, a);
        if (joinable(world, m, a, f) && (b < 0 || m < b)) b = m;
      }
      return b;
    };
    // Extend a lone Flag of yours on the drill ground (The Flag's) if it has a free neighbour, else two fresh nodes.
    let a = spotNode(world, f, 22, 0, (n) => lone(n) && partner(n) >= 0);
    if (a < 0) a = spotNode(world, f, 22, 0, (n) => quietNode(world, n, f) && partner(n) >= 0);
    const b = a >= 0 ? partner(a) : -1;
    const edge = b >= 0 ? lat.edgeBetween(a, b) : -1;
    const av = world.avatarOf(f);
    let current = 0;
    let pulled = false;
    const markPair = (empty: string, held: string): void => {
      if (edge < 0) return;
      ctx.mark([a, b].map((n): ObjectiveMarker => ({ id: `n${n}`, kind: 'node', node: n, label: s.nodeFlagOwner[n] === f ? held : empty })));
    };
    return {
      activate(i) {
        current = i;
        if (i === 0) markPair('Plant here', 'Your Flag');
        else if (i === 1) markPair('Plant here', 'Pull this');
      },
      event(e) {
        if (current !== 1 || pulled || e.t !== 'flagPulled' || e.by !== av.id || e.prevOwner !== f) return;
        if (e.node !== a && e.node !== b) return;
        pulled = true;
        ctx.mark([{ id: 'empty', kind: 'node', node: e.node, label: 'Plant it again' }]);
      },
      progress(i) {
        if (edge < 0) return 1;
        if (i === 1) return pulled ? 1 : 0;
        return s.edgeLey[edge] === f ? 1 : 0;
      },
    };
  },
};

/** Node `m` can join `a` in a fresh Ley Line: plantable, and no planted neighbour other than `a`. */
function joinable(world: World, m: number, a: number, f: FactionId): boolean {
  if (!canPlantAt(world, m, f)) return false;
  const lat = world.lattice;
  for (const e of lat.nodes[m].edges) {
    const o = lat.other(e, m);
    if (o !== a && world.survey.nodeFlag[o] >= 0) return false;
  }
  return true;
}

/** Survey drill spots are tried this many at a time from the wish outward. */
const SURVEY_TRIES = 60;

export const survey: LessonScript = {
  id: 'survey',
  briefing: [
    saint(
      'Close a ring of Ley Lines and everything inside joins your **Survey**: the ground your Flags hold. A facet whose four corners are yours crystallizes.',
    ),
    saint('I have planted most of a small loop out past your camp. One node is missing.'),
  ],
  objectives: [
    {
      id: 'close',
      text: 'Plant the missing Flag and close the loop',
      hint: 'The marker shows the gap. When the ring closes, the facets inside fill with your colour.',
    },
  ],
  debrief: [
    saint('Your Survey grew. Camp buildings rise only inside it, and a rival Hearth inside it is under siege. That is the whole game: enclose.'),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    const lat = world.lattice;
    topUpQuiver(world, f, 3);
    const probe = new EnclosureProbe(world);
    const av = world.avatarOf(f);
    const fromAvatar = (n: number): number => nodeDistance(world, n, av.pos.x, av.pos.z);
    let facet = -1;
    let gap = -1;
    // A small loop on quiet open ground, outside the Survey, that closes only once the gap is planted.
    for (const p of campSpots(world, f, 34, 0.35).slice(0, SURVEY_TRIES)) {
      const target = lat.facetAt(p.x, p.z);
      if (target < 0 || world.inSurvey(target, f)) continue;
      const loop = planEnclosure(lat, { x: p.x, z: p.z, minRadius: 3, maxRadius: 16, cost: (n) => (quietNode(world, n, f) ? 1 : Infinity) });
      if (!loop || loop.length < 4 || loop.length > 10 || !probe.encloses(world, f, loop, target)) continue;
      const nearestFirst = loop.slice().sort((x, y) => fromAvatar(x) - fromAvatar(y) || x - y);
      gap = nearestFirst.find((g) => !probe.encloses(world, f, loop.filter((n) => n !== g), target)) ?? -1;
      if (gap < 0) continue;
      facet = target;
      for (const n of loop) if (n !== gap) plantFresh(world, f, n);
      break;
    }
    return {
      activate() {
        if (gap >= 0) ctx.mark([{ id: 'gap', kind: 'node', node: gap, label: 'Close the loop' }]);
      },
      progress() {
        return facet < 0 || world.inSurvey(facet, f) ? 1 : 0;
      },
    };
  },
};

export const implied: LessonScript = {
  id: 'implied',
  briefing: [
    saint(
      '"One Flag is the same as two." When two of your nodes stand in a straight line with a free node exactly between them, that middle node holds an **implied Flag**.',
    ),
    saint('Implied Flags count for Ley Lines, facets and enclosure, and nobody can pull them. They vanish only when a parent goes.'),
    saint('The lattice has two scales: two edges in a row, and the long diagonals of the fat rhombi, φ times longer. Implied Flags of implied Flags make the fractal.'),
  ],
  objectives: [
    {
      id: 'short',
      text: 'Plant both ends of the short run: an implied Flag appears between them',
      hint: 'The middle marker is the implied node. Plant only on the two ends.',
    },
    {
      id: 'long',
      text: 'Now the long run, φ times wider: plant both far markers',
      hint: 'Same trick at the larger scale: the ends lie along the long diagonals of fat rhombi.',
    },
  ],
  debrief: [
    saint(
      '"Flags are the end of Flags, and the beginning of 10 thousand Flags." At the centre of an infinite cascade sits an infinite-order implied Flag: a Crystal. You will grow one soon.',
    ),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    topUpQuiver(world, f, 5);
    let short: number[] = [];
    let long: number[] = [];
    for (const p of campSpots(world, f, 30, 0.55)) {
      short = straightRun(world, f, p.x, p.z, SHORT_RUN, []);
      long = short.length > 0 ? straightRun(world, f, p.x, p.z, LONG_RUN, short) : [];
      if (long.length > 0) break;
    }
    return {
      activate(i) {
        const run = i === 0 ? short : long;
        if (run.length < 3) return;
        ctx.mark([
          { id: 'a', kind: 'node', node: run[0], label: 'Plant here' },
          { id: 'b', kind: 'node', node: run[1], label: 'Plant here' },
          { id: 'mid', kind: 'node', node: run[2], label: 'Implied Flag', color: world.factions[f].color },
        ]);
      },
      progress(i) {
        const run = i === 0 ? short : long;
        return run.length < 3 || world.survey.impliedOwner[run[2]] === f ? 1 : 0;
      },
    };
  },
};

/**
 * A straight run [a, b, mid] near (x, z): ends `length` apart with `mid` their exact midpoint,
 * all three quiet (free, nothing planted beside them) and clear of the nodes in `avoid` and
 * their neighbours. [] if none.
 */
function straightRun(world: World, f: FactionId, x: number, z: number, length: number, avoid: readonly number[]): number[] {
  const lat = world.lattice;
  const { midStart, midA, midB } = latticeTopology(lat);
  const clear = (n: number): boolean => quietNode(world, n, f) && avoid.every((v) => n !== v && lat.edgeBetween(n, v) < 0);
  let best: number[] = [];
  let bestD = Infinity;
  for (const m of lat.nodesInRadius(x, z, 20)) {
    const d = nodeDistance(world, m, x, z);
    if (d >= bestD || !clear(m)) continue;
    for (let j = midStart[m]; j < midStart[m + 1]; j++) {
      const a = midA[j];
      const b = midB[j];
      const span = Math.hypot(lat.nodes[a].x - lat.nodes[b].x, lat.nodes[a].z - lat.nodes[b].z);
      if (Math.abs(span - length) > RUN_TOLERANCE || !clear(a) || !clear(b)) continue;
      bestD = d;
      best = [a, b, m];
      break;
    }
  }
  return best;
}

export const phason: LessonScript = {
  id: 'phason',
  briefing: [
    saint(
      'The Ley Lattice is a quasicrystal, and it moves. A **Phason Tide** flips nodes across the burn, and a Flag on a flipped node **decoheres**: it falls over, loose.',
    ),
    saint(
      'What is watched does not move. You watch 12 m around you, your Command Center 30 m, your Hearth 22 m, and a Flag with two Ley Lines watches itself.',
    ),
    saint("I have planted a closed loop and a lone Flag out past your camp's gaze. Step away from them and I will turn the Crystal."),
  ],
  objectives: [
    {
      id: 'away',
      text: 'Step outside the marked ring so you are not watching the lone Flag',
      hint: 'Your gaze reaches 12 m. Walk out of the ring around the lone Flag.',
    },
    {
      id: 'watch',
      text: 'Watch the Phason Tide: the lone Flag decoheres, the loop holds',
      hint: 'Stay outside the ring until the wave has passed.',
      highlights: ['feed'],
    },
    {
      id: 'replant',
      text: 'Pick up the fallen Flag (crosshair on it, {key:E}) and plant it again ({key:E})',
      hint: 'The loose Flag lies tilted where it fell. Look at it until the prompt says Pull, press E, then press E again by a free node to plant it.',
      highlights: ['hud-flags'],
    },
  ],
  debrief: [
    saint('Finish your casting: closed loops hold, loose ends fall. In a real burn the Crystal turns every 75 seconds, and every 40 after The Burn.'),
  ],
  begin(ctx) {
    const { world, f } = ctx;
    const lat = world.lattice;
    topUpQuiver(world, f, 2);
    let lone = spotNode(world, f, 44, 0.1, (n) => loneNode(world, f, n));
    // The closed loop: one Sun facet's four corners, a short walk from the lone Flag.
    const loopFacet = closedLoopFacet(world, f, lone);
    if (loopFacet >= 0) for (const n of lat.facets[loopFacet].nodes) plantFresh(world, f, n);
    let loneFlag: EntityId | -1 = lone >= 0 ? plantFresh(world, f, lone) : -1;
    let current = 0;
    /** world.tide.count when this lesson forced a tide; -1 = none pending. */
    let forcedAt = -1;
    /** When the wave front reaches the lone node (NaN until the wave breaks). */
    let flipAt = NaN;
    let decohered = false;

    const markDrill = (): void => {
      if (lone < 0) return;
      const n = lat.nodes[lone];
      const markers: ObjectiveMarker[] = [{ id: 'lone', kind: 'area', at: { x: n.x, z: n.z }, radius: AWAY_DISTANCE, label: 'Lone Flag' }];
      if (loopFacet >= 0) {
        const fc = lat.facets[loopFacet];
        markers.push({ id: 'loop', kind: 'area', at: { x: fc.cx, z: fc.cz }, radius: 6, label: 'Closed loop' });
      }
      ctx.mark(markers);
    };
    return {
      activate(i) {
        current = i;
        if (i < 2) {
          markDrill();
          return;
        }
        const fl = world.flags.get(loneFlag);
        if (fl) ctx.mark([{ id: 'fallen', kind: 'point', at: { x: fl.pos.x, z: fl.pos.z }, label: 'Fallen Flag' }]);
      },
      tick() {
        if (current !== 1 || decohered || loneFlag < 0) return;
        // The forced wave has broken: the Crystal goes quiet again after it.
        if (forcedAt >= 0 && world.tide.count > forcedAt) world.tide.nextAt = Infinity;
        const n = lat.nodes[lone];
        if (forcedAt < 0) {
          if (avatarDistance(world, f, n.x, n.z) < AWAY_DISTANCE) return;
          world.tide.nextAt = world.time + TIDE_LEAD;
          world.tide.warned = false;
          forcedAt = world.tide.count;
          flipAt = NaN;
          ctx.say('The Crystal is turning. Watch the lone Flag.');
          return;
        }
        if (!(world.time >= flipAt)) return;
        const fl = world.flags.get(loneFlag);
        if (!fl || fl.state !== 'planted') return;
        // The wave front reaches the lone Flag: the Crystal turns under it unless it is watched.
        if (applyFlip(world, lone, 'tide')) return;
        forcedAt = -1;
        flipAt = NaN;
        if (avatarDistance(world, f, n.x, n.z) <= AVATAR.observeRadius) {
          ctx.say('You were watching it, so it held. Step back out of the ring and I will turn the Crystal again.');
          return;
        }
        // The wave re-tiled the ground around it and its node can no longer turn: start over nearby.
        const next = spotNode(world, f, 44, 0.1, (m) => loneNode(world, f, m));
        const moved = next >= 0 ? plantFresh(world, f, next) : -1;
        if (moved < 0) return;
        lone = next;
        loneFlag = moved;
        markDrill();
        ctx.say('The Crystal could not turn under it. I have planted another lone Flag; step away from it again.');
      },
      event(e) {
        if (e.t === 'tide' && forcedAt >= 0 && Number.isNaN(flipAt) && lone >= 0) {
          const dir = e.dir ?? { x: 1, z: 0 };
          const n = lat.nodes[lone];
          const reach = MAP_HALF * (Math.abs(dir.x) + Math.abs(dir.z));
          flipAt = world.time + ((n.x * dir.x + n.z * dir.z + reach) / (2 * reach)) * (e.duration ?? 0);
        } else if (e.t === 'flagDecohered' && e.flagId === loneFlag && !decohered) {
          decohered = true;
          world.tide.nextAt = Infinity;
          ctx.say('It fell. The loop held: every Flag on it saw two others.');
        }
      },
      progress(i) {
        if (loneFlag < 0) return 1;
        if (i === 0) return avatarDistance(world, f, lat.nodes[lone].x, lat.nodes[lone].z) >= AWAY_DISTANCE ? 1 : 0;
        if (i === 1) return decohered ? 1 : 0;
        const fl = world.flags.get(loneFlag);
        return fl && fl.state === 'planted' && fl.owner === f ? 1 : 0;
      },
      end() {
        // Never leave a forced tide behind.
        world.tide.nextAt = Infinity;
        world.tide.warned = false;
      },
    };
  },
};

/** Beyond the gaze of the faction's Command Center and Hearths, and not watched by anything else of its. */
function beyondGaze(world: World, f: FactionId, n: number): boolean {
  if (isObserved(world, n, f)) return false;
  const gcc = world.gccOf(f);
  if (gcc && nodeDistance(world, n, gcc.pos.x, gcc.pos.z) < GCC_GAZE_CLEAR) return false;
  for (const id of world.factions[f].hearthIds) {
    const h = world.buildings.get(id);
    if (h && nodeDistance(world, n, h.pos.x, h.pos.z) < HEARTH_GAZE_CLEAR) return false;
  }
  return true;
}

/** A flippable quiet node beyond the camp's gaze: the phason drill's lone Flag. */
function loneNode(world: World, f: FactionId, n: number): boolean {
  return world.lattice.flippable(n) && quietNode(world, n, f) && beyondGaze(world, f, n);
}

/** Where the phason drill's closed loop may stand, tried in order (nearest the wish first). */
const LOOP_SEARCH: readonly { minR: number; maxR: number; gaze: boolean }[] = [
  { minR: 10, maxR: 18, gaze: true },
  { minR: 8, maxR: 30, gaze: true },
  { minR: 6, maxR: 40, gaze: false },
];

/**
 * A Sun facet near the lone node whose four quiet corners stay clear of it: beyond the camp's
 * gaze if possible (so it plainly holds by Canon III alone), else wherever one fits.
 */
function closedLoopFacet(world: World, f: FactionId, lone: number): number {
  if (lone < 0) return -1;
  const lat = world.lattice;
  const ln = lat.nodes[lone];
  for (const tier of LOOP_SEARCH) {
    let best = -1;
    let bestD = Infinity;
    for (const id of lat.facetsInRadius(ln.x, ln.z, tier.maxR)) {
      const fc = lat.facets[id];
      const d = Math.hypot(fc.cx - ln.x, fc.cz - ln.z);
      if (!fc.thick || fc.boundary || d < tier.minR || d > bestD || (d === bestD && id > best)) continue;
      const ok = (n: number): boolean => n !== lone && lat.edgeBetween(n, lone) < 0 && quietNode(world, n, f) && (!tier.gaze || beyondGaze(world, f, n));
      if (!fc.nodes.every(ok)) continue;
      best = id;
      bestD = d;
    }
    if (best >= 0) return best;
  }
  return -1;
}
