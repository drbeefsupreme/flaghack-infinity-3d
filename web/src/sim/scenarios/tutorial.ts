/**
 * The Training Burn (MatchOptions.mode 'tutorial'): the standard four-camp burn re-dressed as
 * a calm training ground for the tutorial director (tutorial/director.ts). createMatch builds
 * the usual world and hands it here before its first Survey recompute.
 *
 * - No surprise timers: the Crystal never turns on its own (the director forces the one tide
 *   it teaches), and victory.ts skips The Burn, Dawn and crowning in this mode.
 * - Dr. Beelzebub Crow's camp becomes the training camp: his Hearth, cart and cardboard-still
 *   vexillomancer move to open ground a short walk from the player's camp, with no home ring,
 *   no Signifiers and a modest stock, so the conquest lesson can enclose it with the Enclose
 *   tool and overwrite it.
 * - DJ Scarecrow's camp lends its colours to the defense drill; it and President Jaguar's camp
 *   stay home and idle (Defend only, no lumber, so their Hearths craft nothing).
 *
 * Every choice is a function of the seeded world, so the scenario is deterministic.
 * Owner: Tutorial agent.
 */
import { AVATAR, BUILDING_HEIGHT, BUILDINGS, CAPTURE } from '../constants';
import { facetYaw } from '../factory';
import { planEnclosure } from '../lattice/planner';
import { dist2, wrapAngle } from '../math';
import { moveBuilding } from '../systems/buildings';
import { canPlantAt, depositToStock } from '../systems/flags';
import { updateSurvey } from '../systems/survey';
import { neutralizeHippie } from '../systems/victory';
import type { Building, FactionId, JobKind } from '../types';
import type { World } from '../world';

/** The trainee: Dr. Beef Supreme's camp. */
export const TRAINING_PLAYER: FactionId = 0;
/** The camp the conquest lesson overwrites. */
export const TRAINING_CAMP: FactionId = 1;
/** The camp whose colours the defense drill's loop wears. */
export const SPARRING_CAMP: FactionId = 2;
/** The camp that sits the Training Burn out. */
const ABSENT_CAMP: FactionId = 3;

/** Rival titles for the Training Burn. Names stay as they are: capture narration uses them. */
const TITLES: Partial<Record<FactionId, string>> = {
  [TRAINING_CAMP]: 'Missing, Presumed Vexillian',
  [SPARRING_CAMP]: 'Sparring Partner',
  [ABSENT_CAMP]: 'Re-elected in Absentia',
};

/** Home camps keep their Signifiers by the Hearth; the training camp has none to employ. */
const GUARD_ONLY: Record<JobKind, number> = { survey: 0, gather: 0, defend: 1, raid: 0, ritual: 0 };
const NO_WORK: Record<JobKind, number> = { survey: 0, gather: 0, defend: 0, raid: 0, ritual: 0 };

/** Flags left in the training camp's stock (the captor inherits them). */
const TRAINING_STOCK = 8;
/** The training Hearth stands between these distances (m) from the player's Hearth, as near as it may. */
const TRAINING_MIN_DISTANCE = 40;
const TRAINING_MAX_DISTANCE = 80;
/**
 * Nothing of the player's (Flag, implied Flag, Survey facet) starts this close to the training
 * Hearth, beyond Hearth threat range (CAPTURE.threatRadius), so its rail entry reads Safe until
 * the trainee goes after it.
 */
const TRAINING_CALM_RADIUS = CAPTURE.threatRadius + 6;
/**
 * Preferred bearing of the training camp: this far (radians) clockwise of the line from the
 * player's Hearth to the centre of the burn, and never more than TRAINING_CONE off it. The
 * ground ahead and to the left stays free for the early drills, and the defense drill's loop
 * keeps a clear corridor between the home ring and the training camp.
 */
const TRAINING_BEARING = Math.PI / 3;
const TRAINING_CONE = 0.9;
/** Blocked Ley Nodes within this radius of a candidate make its loops ugly. */
const CLEAR_RADIUS = 32;
/** The Enclose tool keeps a loop round an enemy Hearth at least this far out (commandView.ts). */
const ENCLOSE_MIN_RADIUS = 16;
const ENCLOSE_MAX_RADIUS = 80;
/** Qualifying candidates compared on their loops, out of at most LOOP_ATTEMPTS tried (nearest first). */
const LOOP_CANDIDATES = 8;
const LOOP_ATTEMPTS = 60;
/**
 * The defense drill's loop must exist for a candidate with this much room to spare beyond
 * DRILL_CALM_RADIUS: later lessons grow the home Survey, and the drill loop runs round it.
 */
const DRILL_MARGIN = 8;
/** The training cart parks between these distances (m) from its Hearth's centre. */
const GCC_MIN_DISTANCE = BUILDINGS.hearth.radius + BUILDINGS.gcc.radius + 1.5;
const GCC_MAX_DISTANCE = 11;
const GCC_PARK_DISTANCE = 8;
/** The training vexillomancer stands this far from its Hearth: never close enough to Hold it. */
const KEEPER_DISTANCE = CAPTURE.holdRadius + 3;

/** One way to plan the defense drill's loop (see DRILL_PLANS). */
export interface DrillPlan {
  /** Keep off nodes touching the victim's Survey or plan, so its Defend Signifiers leave the loop be. */
  strict: boolean;
  /** Loop nodes keep at least this far (m) from the victim's Hearth. */
  minRadius: number;
}

/**
 * The defense drill's loop plans, tried in order: clear of the victim's Survey outside its
 * home ring, then anywhere outside the ring, then tight inside it.
 */
export const DRILL_PLANS: readonly DrillPlan[] = [
  { strict: true, minRadius: 15 },
  { strict: false, minRadius: 15 },
  { strict: false, minRadius: 6 },
];
const DRILL_MAX_RADIUS = 90;
/**
 * Staged Flags keep this far from every Hearth outside the drill (just beyond threat range),
 * so no other camp's rail entry stirs.
 */
export const CALM_RADIUS = CAPTURE.threatRadius + 2;

/**
 * The defense drill: a loop of `raider` nodes round `victim`'s main Hearth (Flags it already
 * has there cost nothing). Each node within CALM_RADIUS + `margin` of another camp's Hearth,
 * or of a point in `clear`, costs `calmCost` extra (Infinity: never). Null when the plan finds
 * no loop.
 */
export function planDrillLoop(
  world: World,
  raider: FactionId,
  victim: FactionId,
  plan: DrillPlan,
  calmCost: number,
  margin = 0,
  clear: readonly { x: number; z: number }[] = [],
): number[] | null {
  const hearth = world.hearthOf(victim);
  if (!hearth) return null;
  const lat = world.lattice;
  const s = world.survey;
  const calm = (CALM_RADIUS + margin) ** 2;
  const outsiders: { x: number; z: number }[] = [...clear];
  for (const b of world.buildings.values()) if (b.kind === 'hearth' && b.faction !== raider && b.faction !== victim) outsiders.push(b.pos);
  const planned = world.factions[victim].plan;
  const cost = (n: number): number => {
    if (s.nodeFlagOwner[n] === raider) return 0;
    const node = lat.nodes[n];
    if (!canPlantAt(world, n, raider)) return Infinity;
    if (plan.strict) {
      if (planned.has(n)) return Infinity;
      for (const fc of node.facets) if (world.inSurvey(fc, victim)) return Infinity;
    }
    for (const p of outsiders) if (dist2(node.x, node.z, p.x, p.z) < calm) return 1 + calmCost;
    return 1;
  };
  return planEnclosure(lat, { x: hearth.pos.x, z: hearth.pos.z, minRadius: plan.minRadius, maxRadius: DRILL_MAX_RADIUS, cost });
}

export function setupTrainingBurn(world: World): void {
  world.tide.nextAt = Infinity;
  // The home rings are planted but not yet surveyed: the training camp keeps clear of their Surveys.
  updateSurvey(world, 0);
  for (const fac of world.factions) {
    const title = TITLES[fac.id];
    if (title !== undefined) fac.title = title;
    if (fac.id === TRAINING_PLAYER) continue;
    fac.lumber = 0;
    fac.jobWeights = { ...(fac.id === TRAINING_CAMP ? NO_WORK : GUARD_ONLY) };
  }
  relocateTrainingCamp(world);
}

/**
 * Move the training camp next to the player's: its Hearth to the best open Sun facet, its
 * cart beside it, its vexillomancer just out of Holding range; its home ring and quiver go
 * back into a trimmed stock and its Signifiers wander off neutral.
 */
function relocateTrainingCamp(world: World): void {
  const home = world.hearthOf(TRAINING_PLAYER);
  const hearth = world.hearthOf(TRAINING_CAMP);
  const gcc = world.gccOf(TRAINING_CAMP);
  const hs = hearth?.hearth;
  if (!home || !hearth || !hs || !gcc) return;
  const facet = trainingFacet(world, home);
  if (facet < 0) return;

  placeBuilding(world, hearth, facet);
  hs.facet = facet;
  const gccFacet = parkingFacet(world, hearth, home);
  if (gccFacet >= 0) placeBuilding(world, gcc, gccFacet);

  const keeper = world.avatarOf(TRAINING_CAMP);
  const spot = keeperSpot(world, hearth, home, gcc);
  keeper.pos.x = spot.x;
  keeper.pos.y = 0;
  keeper.pos.z = spot.z;
  keeper.vel.x = 0;
  keeper.vel.y = 0;
  keeper.vel.z = 0;
  keeper.onGround = true;
  keeper.yaw = Math.atan2(home.pos.x - spot.x, home.pos.z - spot.z);
  keeper.input.yaw = keeper.yaw;

  // Home ring and quiver into the stock (survey arrays vacate as they go), then trim it.
  for (const fl of world.flags.values()) {
    if (fl.owner === TRAINING_CAMP && fl.state !== 'stock') depositToStock(world, fl.id, hearth.id);
  }
  let kept = 0;
  for (const fl of world.flags.values()) {
    if (fl.state !== 'stock' || fl.holder !== hearth.id) continue;
    if (kept < TRAINING_STOCK) {
      fl.pos.x = hearth.pos.x;
      fl.pos.z = hearth.pos.z;
      kept++;
    } else world.flags.delete(fl.id);
  }
  for (const h of world.hippies.values()) if (h.faction === TRAINING_CAMP) neutralizeHippie(world, h);
}

/** Re-seat a building on a facet centre (collision and nav follow it). */
function placeBuilding(world: World, b: Building, facet: number): void {
  const fc = world.lattice.facets[facet];
  moveBuilding(world, b, fc.cx, fc.cz);
  b.facet = facet;
  b.yaw = facetYaw(world, facet);
}

/** A Sun facet whose corners are free, unblocked and not pinned by a building. */
function openSunFacet(world: World, facet: number): boolean {
  const lat = world.lattice;
  const fc = lat.facets[facet];
  if (!fc.thick || fc.boundary) return false;
  for (const n of fc.nodes) if (!canPlantAt(world, n, TRAINING_PLAYER)) return false;
  return true;
}

/**
 * The training Hearth's facet: open Sun facet as near the player's Hearth as the calm radius
 * allows (nothing of the player's within TRAINING_CALM_RADIUS), toward TRAINING_BEARING, away
 * from blocked ground, where the defense drill's loop round the player's Hearth still fits
 * without stirring it and whose Enclose-tool loop needs few new Flags. -1 if no facet
 * qualifies (the camp then stays in its corner).
 */
function trainingFacet(world: World, home: Building): number {
  const lat = world.lattice;
  const s = world.survey;
  const r = BUILDINGS.hearth.radius;
  const bearing = Math.atan2(-home.pos.z, -home.pos.x) - TRAINING_BEARING;
  // Everything of the player's a rival Hearth would feel threatened by: held nodes and Survey corners.
  const claimed: number[] = [];
  for (let n = 0; n < lat.nodes.length; n++) if (s.holder[n] === TRAINING_PLAYER) claimed.push(n);
  for (const fc of lat.facets) if (world.inSurvey(fc.id, TRAINING_PLAYER)) claimed.push(...fc.nodes);
  const scored: { facet: number; score: number }[] = [];
  const near: number[] = [];
  for (const fc of lat.facets) {
    const d = Math.sqrt(dist2(fc.cx, fc.cz, home.pos.x, home.pos.z));
    if (d < TRAINING_MIN_DISTANCE || d > TRAINING_MAX_DISTANCE || !openSunFacet(world, fc.id)) continue;
    if (claimed.some((n) => dist2(lat.nodes[n].x, lat.nodes[n].z, fc.cx, fc.cz) < TRAINING_CALM_RADIUS * TRAINING_CALM_RADIUS)) continue;
    if (world.map.isBlockedAt(fc.cx, fc.cz) || world.collision.blockedCircle(fc.cx, fc.cz, r + 0.5, 0.2, BUILDING_HEIGHT.hearth)) continue;
    near.length = 0;
    lat.nodesInRadius(fc.cx, fc.cz, CLEAR_RADIUS, near);
    let blocked = 0;
    for (const n of near) if (lat.nodes[n].blocked) blocked++;
    const off = Math.abs(wrapAngle(Math.atan2(fc.cz - home.pos.z, fc.cx - home.pos.x) - bearing));
    if (off > TRAINING_CONE) continue;
    scored.push({ facet: fc.id, score: d + 12 * off + 4 * blocked });
  }
  scored.sort((a, b) => a.score - b.score || a.facet - b.facet);

  let best = -1;
  let bestScore = Infinity;
  let kept = 0;
  for (const c of scored.slice(0, LOOP_ATTEMPTS)) {
    const fc = lat.facets[c.facet];
    const centre = { x: fc.cx, z: fc.cz };
    if (!planDrillLoop(world, SPARRING_CAMP, TRAINING_PLAYER, DRILL_PLANS[0], Infinity, DRILL_MARGIN, [centre])) continue;
    const corners = fc.nodes;
    const cost = (n: number): number => {
      if (corners.includes(n)) return Infinity;
      if (s.nodeFlagOwner[n] === TRAINING_PLAYER) return 0;
      return canPlantAt(world, n, TRAINING_PLAYER) ? 1 : Infinity;
    };
    const loop = planEnclosure(lat, { x: fc.cx, z: fc.cz, minRadius: ENCLOSE_MIN_RADIUS, maxRadius: ENCLOSE_MAX_RADIUS, cost });
    if (!loop) continue;
    let fresh = 0;
    for (const n of loop) if (cost(n) > 0) fresh++;
    const score = c.score + fresh / 2;
    if (score < bestScore) {
      bestScore = score;
      best = c.facet;
    }
    if (++kept >= LOOP_CANDIDATES) break;
  }
  return best;
}

/** A Sun facet for the training cart beside its Hearth, toward the player's camp; -1 if none. */
function parkingFacet(world: World, hearth: Building, home: Building): number {
  const lat = world.lattice;
  const toHome = Math.atan2(home.pos.z - hearth.pos.z, home.pos.x - hearth.pos.x);
  const px = hearth.pos.x + Math.cos(toHome) * GCC_PARK_DISTANCE;
  const pz = hearth.pos.z + Math.sin(toHome) * GCC_PARK_DISTANCE;
  let best = -1;
  let bestD = Infinity;
  for (const fc of lat.facets) {
    const d2 = dist2(fc.cx, fc.cz, hearth.pos.x, hearth.pos.z);
    if (d2 < GCC_MIN_DISTANCE * GCC_MIN_DISTANCE || d2 > GCC_MAX_DISTANCE * GCC_MAX_DISTANCE) continue;
    // Buildings may share corners; they only need unblocked corners with no Flag on them.
    if (!fc.thick || fc.boundary || fc.nodes.some((n) => lat.nodes[n].blocked || world.survey.nodeFlag[n] >= 0)) continue;
    if (world.collision.blockedCircle(fc.cx, fc.cz, BUILDINGS.gcc.radius + 0.3, 0.2, BUILDING_HEIGHT.gcc)) continue;
    const d = dist2(fc.cx, fc.cz, px, pz);
    if (d < bestD) {
      bestD = d;
      best = fc.id;
    }
  }
  return best;
}

/**
 * Where the training vexillomancer stands: KEEPER_DISTANCE from its Hearth on the far side
 * from the player's camp (sweeping round in 30° steps), on clear walkable ground.
 */
function keeperSpot(world: World, hearth: Building, home: Building, gcc: Building): { x: number; z: number } {
  const away = Math.atan2(hearth.pos.z - home.pos.z, hearth.pos.x - home.pos.x);
  const clearGcc = BUILDINGS.gcc.radius + AVATAR.radius + 1;
  for (let i = 0; i < 12; i++) {
    const a = away + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
    const x = hearth.pos.x + Math.cos(a) * KEEPER_DISTANCE;
    const z = hearth.pos.z + Math.sin(a) * KEEPER_DISTANCE;
    if (!world.nav.isWalkable(x, z) || dist2(x, z, gcc.pos.x, gcc.pos.z) < clearGcc * clearGcc) continue;
    if (world.collision.blockedCircle(x, z, AVATAR.radius, 0.1, AVATAR.height)) continue;
    return { x, z };
  }
  return world.nav.nearestWalkable(hearth.pos.x + Math.cos(away) * KEEPER_DISTANCE, hearth.pos.z + Math.sin(away) * KEEPER_DISTANCE);
}
