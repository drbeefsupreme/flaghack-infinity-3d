/** Host-side neutral audience. Renderers and mirrors only consume the resulting poses. */
import { HIPPIE } from '../../constants';
import { EFFIGY_POLE_CONSUMED_AT } from '../../effigyBurn';
import { PLAZA_RADIUS } from '../../map/mapgen';
import { burnTime } from '../../matchSettings';
import type { V2 } from '../../math';
import { NEUTRAL, type Hippie } from '../../types';
import type { World } from '../../world';
import { beginTask, brainOf, setStatusAt, type Brain } from './brain';
import { moveTo } from './move';
import type { UnitsState } from './state';

/** At 5.5 m/s, two minutes leaves room for detours across the 300 m field. */
export const EFFIGY_GATHER_SECONDS = 120;
/** Outside the 14 m guy-line anchors, with body/arrival clearance. */
export const EFFIGY_AUDIENCE_RADIUS = PLAZA_RADIUS;
const TAU = Math.PI * 2;
const SPACING = 1.6;
const ARRIVE = .35;
interface Audience {
  angles: Map<number, number>;
  goals: Map<number, V2>;
  radius: number;
  navVersion: number;
}
const audiences = new WeakMap<World, Audience>();

export function effigyAudienceActive(world: World): boolean {
  if (world.phase !== 'playing' || world.options.mode === 'tutorial' || world.effigyRevealedAt !== null || world.boss) return false;
  const ignition = burnTime(world.options);
  return Number.isFinite(ignition) && world.time >= Math.max(0, ignition - EFFIGY_GATHER_SECONDS) &&
    world.time < ignition + EFFIGY_POLE_CONSUMED_AT;
}

function bearing(world: World, h: Hippie): number {
  return (Math.atan2(h.pos.z - world.map.effigy.z, h.pos.x - world.map.effigy.x) + TAU) % TAU;
}

/** Initial angular ordering limits cross-traffic; recruiting/KO never reshuffles survivors. */
function audience(world: World): Audience {
  let state = audiences.get(world);
  const neutrals = [...world.hippies.values()].filter(h => h.faction === NEUTRAL);
  if (!state) {
    state = { angles: new Map(), goals: new Map(), radius: 0, navVersion: -1 };
    neutrals.sort((a, b) => bearing(world, a) - bearing(world, b) || a.id - b.id);
    let sx = 0, sz = 0;
    for (let i = 0; i < neutrals.length; i++) {
      const offset = bearing(world, neutrals[i]) - i * TAU / neutrals.length;
      sx += Math.cos(offset); sz += Math.sin(offset);
    }
    const rotation = Math.atan2(sz, sx);
    for (let i = 0; i < neutrals.length; i++) state.angles.set(neutrals[i].id, (rotation + i * TAU / neutrals.length + TAU) % TAU);
    audiences.set(world, state);
  }
  for (const h of neutrals.sort((a, b) => a.id - b.id)) {
    if (state.angles.has(h.id)) continue;
    // New neutrals fill the largest gap; existing slots remain reserved through KO/recruitment.
    const angles = [...state.angles.values()].sort((a, b) => a - b);
    let angle = bearing(world, h), largest = -1;
    for (let i = 0; i < angles.length; i++) {
      const gap = (i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU) - angles[i];
      if (gap > largest) { largest = gap; angle = (angles[i] + gap / 2) % TAU; }
    }
    state.angles.set(h.id, angle);
    state.navVersion = -1;
  }
  // Use the actual obstacle footprint too, including translated/scenario-authored effigies.
  let perimeter = 0;
  for (const obstacle of world.map.obstacles) {
    if (obstacle.kind !== 'effigy') continue;
    perimeter = Math.max(perimeter, Math.hypot(obstacle.x - world.map.effigy.x, obstacle.z - world.map.effigy.z) +
      (obstacle.shape === 'circle' ? obstacle.radius : Math.hypot(obstacle.hx, obstacle.hz)));
  }
  const radius = Math.max(EFFIGY_AUDIENCE_RADIUS, perimeter + HIPPIE.radius + 2, state.angles.size * SPACING / TAU);
  if (state.navVersion !== world.nav.version || state.radius !== radius) {
    state.radius = radius;
    state.navVersion = world.nav.version;
    state.goals.clear();
    for (const [id, angle] of [...state.angles].sort((a, b) => a[0] - b[0])) {
      const goal = clearSlot(world, state, angle);
      if (goal) state.goals.set(id, goal);
    }
  }
  return state;
}

function clearSlot(world: World, state: Audience, angle: number): V2 | null {
  const angularStep = Math.min(.12, TAU / Math.max(8, state.angles.size * 3));
  for (let row = 0; row < 13; row++) {
    const radius = state.radius + row * SPACING;
    for (const offset of [0, 1, -1, 2, -2]) {
      const a = angle + offset * angularStep;
      const x = world.map.effigy.x + Math.cos(a) * radius;
      const z = world.map.effigy.z + Math.sin(a) * radius;
      if (!world.nav.isWalkable(x, z)) continue;
      const y = world.collision.groundHeight(x, z);
      if (world.collision.blockedCircle(x, z, HIPPIE.radius, y + .1, y + 1.8)) continue;
      if ([...state.goals.values()].some(p => Math.hypot(p.x - x, p.z - z) < SPACING - .01)) continue;
      return { x, z };
    }
  }
  return null;
}

/** Compute slots once before the unit loop; no RNG draws or new network state. */
export function prepareEffigyAudience(world: World): boolean {
  if (!effigyAudienceActive(world)) return false;
  audience(world);
  return true;
}

export function watchEffigy(world: World, sys: UnitsState, h: Hippie, b: Brain): boolean {
  const goal = audiences.get(world)?.goals.get(h.id);
  if (!goal) return false;
  if (b.task !== 'watchBurn') beginTask(world, h, b, 'watchBurn');
  b.px = goal.x; b.pz = goal.z;
  const arrived = moveTo(world, sys, h, b, goal.x, goal.z, ARRIVE);
  setStatusAt(h, b, arrived ? 'idle' : 'walking', world.map.effigy.x, world.map.effigy.z);
  return true;
}

/** Applied after locomotion, so residual velocity/separation cannot turn an observer away. */
export function faceEffigy(world: World, h: Hippie, b: Brain): void {
  if (b.task === 'watchBurn' && !b.moving) h.facing = Math.atan2(world.map.effigy.x - h.pos.x, world.map.effigy.z - h.pos.z);
}

/** Zero-day games have no approach time: arrange only starting neutrals during setup. */
export function initializeEffigyAudience(world: World): void {
  if (world.time !== 0 || burnTime(world.options) !== 0 || !prepareEffigyAudience(world)) return;
  for (const h of world.hippies.values()) {
    if (h.faction !== NEUTRAL || h.status === 'ko') continue;
    const goal = audiences.get(world)?.goals.get(h.id);
    if (!goal) continue;
    h.pos.x = goal.x; h.pos.z = goal.z;
    h.vel.x = 0; h.vel.z = 0;
    const b = brainOf(h);
    beginTask(world, h, b, 'watchBurn');
    b.px = goal.x; b.pz = goal.z;
    setStatusAt(h, b, 'idle', world.map.effigy.x, world.map.effigy.z);
    faceEffigy(world, h, b);
  }
}
