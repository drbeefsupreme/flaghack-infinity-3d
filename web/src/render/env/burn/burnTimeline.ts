/**
 * The Burn as a pure function of sim seconds since ignition: how fast the flames climb the
 * tower, how hard they burn, when the lattice burns away and when the Flag turns
 * incandescent. One source of truth: the CPU reads these curves for the fire light and the
 * shader uniforms, and the GLSL below derives per-fragment charring from the same constants.
 */
import { AVATAR, BURN_TIME } from '../../../sim/constants';
import { EFFIGY_POLE_CONSUMED_AT } from '../../../sim/effigyBurn';
import { EFFIGY_HEIGHT, EFFIGY_RADIUS } from '../../../sim/map/mapgen';
import { BURN_CHAR_SECONDS } from '../envTypes';

/**
 * When The Burn began, given the match clock at which presentation first saw world.suddenDeath.
 * By rule it begins at BURN_TIME, so after a fast-forward or a skipped frame the fire has still
 * been burning since then (Dawn shows charred remains, not a fresh blaze); a debug toggle
 * before BURN_TIME lights it on the spot.
 */
export function burnStartFor(firstSeen: number): number {
  return Math.min(firstSeen, BURN_TIME);
}

/** Plinth (pedestal) radius and height, matching the effigy obstacle. */
export const PLINTH_RADIUS = EFFIGY_RADIUS;
export const PLINTH_HEIGHT = 3;
/** The timber lattice stands on the plinth up to here (its railing ~1 m higher); above it only the mast continues. */
export const LATTICE_TOP = 18.6;
/** Lattice leg radius at the plinth and at the crown (pentagonal tower, tapering). */
export const LATTICE_R0 = 2.0;
export const LATTICE_R1 = 1.0;
/** Mast radius at the plinth and at the top; the mast rises just past the Flag's head. */
export const MAST_R0 = 0.6;
export const MAST_R1 = 0.38;
/** The giant Flag: hoist bottom height and cloth size (m); it flies at the effigy's full height. */
export const FLAG_BOTTOM = 20.2;
export const FLAG_WIDTH = 10;
export const FLAG_HEIGHT = 6.5;
export const MAST_TOP = Math.max(EFFIGY_HEIGHT, FLAG_BOTTOM + FLAG_HEIGHT) + 0.2;

/** Highest point the flames reach (licking the Flag's lower edge). */
export const FIRE_TOP = LATTICE_TOP + 2;
/** Seconds for the flames to race from the ground to FIRE_TOP. */
export const CLIMB_SECONDS = 12;
/** Seconds a timber takes to go from first scorch to full charcoal. */
export const CHAR_SECONDS = 55;
/** The lattice burns away between these times: the crown first, the plinth-level members last. */
export const DISSOLVE_TOP_AT = 85;
export const DISSOLVE_BOTTOM_AT = 140;
/** Guy/support lines burn separately from the original scaffold. */
export const GUY_BURN_START = 20;
export const GUY_BURN_END = 30;
export const GUY_HEIGHT = 18.4;
export const GUY_GRAVITY = AVATAR.gravity;
export const GUY_GROUND_CLEARANCE = 0.03;
/** Conservative latest landing time, including the wire thickness. */
export const GUY_LANDED_AT = GUY_BURN_START + Math.sqrt(2 * GUY_HEIGHT / GUY_GRAVITY);
/** The Flag's late heat-and-shrink sequence, in sim seconds since ignition. */
export const FLAG_WHITE_AT = 90;
export const FLAG_YELLOW_AT = 116;
export const FLAG_RED_AT = 142;
export const FLAG_BLACK_AT = 168;
export const FLAG_CONSUMED_AT = EFFIGY_POLE_CONSUMED_AT;
/** These are the ORIGINAL shader noise spans, not a new scaffold burn schedule. */
const DISSOLVE_TEXTURE_SPREAD = 34;
const DISSOLVE_CELL_SPREAD = 22;
export const DISSOLVE_MAX_DELAY = (DISSOLVE_TEXTURE_SPREAD + DISSOLVE_CELL_SPREAD) / 2;
export const LAST_SCAFFOLD_BURN_AT = DISSOLVE_BOTTOM_AT + DISSOLVE_MAX_DELAY;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Height (m above ground) the flames have climbed to. */
export function fireFront(t: number): number {
  return 0.5 + (FIRE_TOP - 0.5) * Math.min(1, Math.max(0, (t - 0.5) / CLIMB_SECONDS));
}

/** Upper limit of live flames: falls as the lattice burns away, leaving a fire at the base. */
export function fireCeiling(t: number): number {
  return FIRE_TOP - (FIRE_TOP - 7) * smoothstep(DISSOLVE_TOP_AT - 10, BURN_CHAR_SECONDS + 10, t);
}

/** 0..1 overall fire strength: a fast ramp, a long blaze, then a lasting smoulder. */
export function fireIntensity(t: number): number {
  return smoothstep(0, 7, t) * (1 - 0.62 * smoothstep(70, BURN_CHAR_SECONDS + 10, t));
}

/** 0..1 extra punch of the ignition fireball in the first seconds. */
export function ignitionFlare(t: number): number {
  return smoothstep(0, 1.2, t) * (1 - smoothstep(2.5, 7, t));
}

/** Original 0..1 gold incandescence, overridden by the Flag heat sequence from 90 s. */
export function flagIncandescence(t: number): number {
  return smoothstep(25, 125, t);
}

/** Distance fallen from rest after release; same gravity as avatars and thrown Flags. */
export function guyLineFall(t: number): number {
  const dt = Math.max(0, Math.min(GUY_BURN_END, t) - GUY_BURN_START);
  return 0.5 * GUY_GRAVITY * dt * dt;
}

/** Landing on the original plinth top or meadow, without penetrating either. */
export function guyLineRestHeight(x: number, z: number): number {
  return (Math.hypot(x, z) < PLINTH_RADIUS ? PLINTH_HEIGHT : 0) + GUY_GROUND_CLEARANCE;
}

export function guyLineHeight(y: number, t: number, x = PLINTH_RADIUS + 1, z = 0): number {
  return Math.max(guyLineRestHeight(x, z), y - guyLineFall(t));
}

/** Grounded remnants burn away only after the short free fall; complete at 30 seconds. */
export function guyLineBurn(t: number): number {
  return Math.min(1, Math.max(0, (t - GUY_LANDED_AT) / (GUY_BURN_END - GUY_LANDED_AT)));
}

export interface FlagHeat {
  active: boolean;
  color: [number, number, number];
  emissive: number;
}

/** Original gold until 90 s; then white → yellow → red → black with fading glow. */
export function sampleFlagHeat(t: number, out: FlagHeat = { active: false, color: [0, 0, 0], emissive: 0 }): FlagHeat {
  out.active = t >= FLAG_WHITE_AT;
  const c = out.color;
  if (!out.active) {
    c[0] = c[1] = c[2] = out.emissive = 0;
  } else if (t < FLAG_YELLOW_AT) {
    const k = smoothstep(FLAG_WHITE_AT + 5, FLAG_YELLOW_AT, t);
    c[0] = c[1] = 1;
    c[2] = 1 - k;
    out.emissive = 4 - k;
  } else if (t < FLAG_RED_AT) {
    const k = smoothstep(FLAG_YELLOW_AT + 5, FLAG_RED_AT, t);
    c[0] = 1;
    c[1] = 1 - k;
    c[2] = 0;
    out.emissive = 3 - 2 * k;
  } else if (t < FLAG_BLACK_AT) {
    const k = smoothstep(FLAG_RED_AT + 5, FLAG_BLACK_AT, t);
    c[0] = 1 - k;
    c[1] = c[2] = 0;
    out.emissive = 1 - k;
  } else {
    c[0] = c[1] = c[2] = out.emissive = 0;
  }
  return out;
}

/** The original scaffold's nominal surviving-height fraction (its noise leaves irregular remnants). */
export function scaffoldRemaining(t: number): number {
  return Math.min(1, Math.max(0, (DISSOLVE_BOTTOM_AT - t) / (DISSOLVE_BOTTOM_AT - DISSOLVE_TOP_AT)));
}

/** Conservative top of still-burning timber, including both original dissolve jitters.
 * Permanent low stumps are intentionally excluded: they do not burn away in the original.
 * Crown railing height comes from the actual lattice bounds; stretching the envelope by
 * that crown height avoids a discontinuity when the last railing fragments disappear.
 */
export function burningScaffoldEnvelope(t: number, crownTop = LATTICE_TOP + 1.1): number {
  const remaining = Math.min(1, Math.max(0, (LAST_SCAFFOLD_BURN_AT - t) / (DISSOLVE_BOTTOM_AT - DISSOLVE_TOP_AT)));
  return PLINTH_HEIGHT + (crownTop - PLINTH_HEIGHT) * remaining;
}

/** Uniform pole+Flag shrink, kept exposed above the remaining burning scaffold. */
export function flagBurnScale(t: number, crownTop = LATTICE_TOP + 1.1): number {
  if (t < FLAG_WHITE_AT) return 1;
  if (t >= FLAG_CONSUMED_AT) return 0;
  const p = Math.min(1, Math.max(0, (t - FLAG_WHITE_AT) / (FLAG_CONSUMED_AT - FLAG_WHITE_AT)));
  // Gentle early shrink preserves exposure while the original noisy crown burns away.
  const shrink = 1 - p * p * p;
  const remaining = (burningScaffoldEnvelope(t, crownTop) - PLINTH_HEIGHT) / (crownTop - PLINTH_HEIGHT);
  const clearanceScale = (burningScaffoldEnvelope(t, crownTop) - PLINTH_HEIGHT + 0.15 * remaining) / (FLAG_BOTTOM - PLINTH_HEIGHT);
  return Math.min(1, Math.max(shrink, clearanceScale));
}

/** World-space height of the cloth's hoist bottom under the shared plinth-level pivot. */
export function flagBurnBottom(t: number, crownTop = LATTICE_TOP + 1.1): number {
  return PLINTH_HEIGHT + (FLAG_BOTTOM - PLINTH_HEIGHT) * flagBurnScale(t, crownTop);
}

/** 0..1 smoke column density. */
export function smokeAmount(t: number): number {
  return smoothstep(1, 14, t) * (1 - 0.5 * smoothstep(95, BURN_CHAR_SECONDS + 40, t));
}

/** 0..1 fraction of ember particles alive (a burst at ignition, then tracks the fire). */
export function emberRate(t: number): number {
  return Math.min(1, 0.15 + 0.85 * fireIntensity(t) + 0.6 * ignitionFlare(t));
}

/** 0..1 glowing ember bed spreading around the plinth. */
export function emberBed(t: number): number {
  return smoothstep(6, 70, t);
}

/**
 * GLSL twin of the timeline for per-fragment charring and burn-away (constants injected from
 * the TypeScript above). Declares uBurnTime and uNoise. Positions are effigy-local, y up.
 */
export const BURN_GLSL = /* glsl */ `
uniform float uBurnTime;
uniform sampler2D uNoise;
float burnIgnitionTime(float y) {
  return 0.5 + ${CLIMB_SECONDS.toFixed(1)} * clamp((y - 0.5) / ${(FIRE_TOP - 0.5).toFixed(2)}, 0.0, 1.0);
}
// 0 = fresh timber, 1 = charcoal.
float burnChar(float y, float jitter) {
  return clamp((uBurnTime - burnIgnitionTime(y) - 1.5 + jitter) / ${CHAR_SECONDS.toFixed(1)}, 0.0, 1.0);
}
// Low-frequency noise of the position alone, so every face of a beam agrees.
float burnNoise(vec3 p) {
  return texture2D(uNoise, vec2(p.x * 0.11 + p.y * 0.045, p.z * 0.11 - p.y * 0.06)).r;
}
// Seconds left before this lattice fragment burns away (negative = gone). Chunks of about a
// metre share a hash so members break into pieces; a few low members survive as stumps.
float burnAwayIn(vec3 p, float n) {
  vec3 cellId = floor(p * vec3(0.62, 0.8, 0.62));
  float cell = fract(sin(dot(cellId, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  if (cell < 0.4 * (1.0 - smoothstep(5.0, 10.0, p.y))) return 1e6;
  float k = clamp((p.y - ${PLINTH_HEIGHT.toFixed(1)}) / ${(LATTICE_TOP - PLINTH_HEIGHT).toFixed(1)}, 0.0, 1.0);
  return mix(${DISSOLVE_BOTTOM_AT.toFixed(1)}, ${DISSOLVE_TOP_AT.toFixed(1)}, k) + (n - 0.5) * ${DISSOLVE_TEXTURE_SPREAD.toFixed(1)} + (cell - 0.5) * ${DISSOLVE_CELL_SPREAD.toFixed(1)} - uBurnTime;
}
`;
