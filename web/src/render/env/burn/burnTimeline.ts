/**
 * The Burn as a pure function of sim seconds since ignition: how fast the flames climb the
 * tower, how hard they burn, when the lattice burns away and when the Flag turns
 * incandescent. One source of truth: the CPU reads these curves for the fire light and the
 * shader uniforms, and the GLSL below derives per-fragment charring from the same constants.
 */
import { BURN_TIME } from '../../../sim/constants';
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

/** 0..1 how incandescent the (unconsumed) Flag glows. */
export function flagIncandescence(t: number): number {
  return smoothstep(25, 125, t);
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
  return mix(${DISSOLVE_BOTTOM_AT.toFixed(1)}, ${DISSOLVE_TOP_AT.toFixed(1)}, k) + (n - 0.5) * 34.0 + (cell - 0.5) * 22.0 - uBurnTime;
}
`;
