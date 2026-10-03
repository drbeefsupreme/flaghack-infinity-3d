/**
 * Internal contract of the environment renderer: the per-frame day state, shared shader
 * uniforms and the context every environment part is built with. Parts are constructed by
 * EnvRenderer in a fixed order, add their objects under `env.root`, read `env.day` /
 * `env.uniforms` (already updated for the frame) in update(), and free GPU resources in
 * dispose() (EnvRenderer detaches `root` from the scene afterwards).
 */
import type * as THREE from 'three';
import type { GameEvent } from '../../sim/events';
import type { RenderContext } from '../context';

/** Lighting and sky palette for the current moment of the match (all colours linear). */
export interface DayState {
  /** Effective match clock (s) driving the palette (fixed golden hour on the title screen). */
  clock: number;
  /** Unit vector toward the sun (below the horizon at night). */
  sunDir: THREE.Vector3;
  /** Unit vector toward the moon. */
  moonDir: THREE.Vector3;
  /** Unit vector toward the dominant shadow-casting light (sun, or moon at night). */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  /** Sky gradient: straight up and at the horizon. The horizon colour equals the fog colour. */
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Warm glow around the sun (and the horizon band on its side in the twilights). */
  sunGlow: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** Tone-mapping exposure. */
  exposure: number;
  /** 1 = full day, 0 = deep night. */
  daylight: number;
  /** 0 = day, 1 = night: scales every emissive festival light. */
  night: number;
  /** 0..1, peaks in the twilights, sunset/dusk and pre-dawn/sunrise (pink and amber tones). */
  dusk: number;
  /** 0..1 star field visibility. */
  stars: number;
}

/**
 * Uniform objects shared by reference across every environment shader. EnvRenderer writes
 * them once per frame; materials list them in their `uniforms` (or onBeforeCompile) so a
 * single assignment drives all of them.
 */
export interface EnvUniforms {
  /** Presentation time (s). */
  uTime: { value: number };
  /** 0 = day, 1 = night (DayState.night). */
  uNight: { value: number };
  /** Sound-camp beat counter at 124 BPM: floor = beat index, fract = phase within the beat. */
  uBeat: { value: number };
  /** Wind on the ground plane: direction × strength (strength 0..1), x = world x, y = world z. */
  uWind: { value: THREE.Vector2 };
  /** Burn progress: 0 before The Burn, rises to 1 as the effigy is consumed. */
  uBurn: { value: number };
  /** Toward the dominant light (DayState.lightDir). */
  uSunDir: { value: THREE.Vector3 };
  /** Dominant light colour × intensity (DayState.lightColor × lightIntensity). */
  uSunColor: { value: THREE.Color };
  /** Fog colour (DayState.fogColor) for shaders that fog themselves. */
  uFogColor: { value: THREE.Color };
}

/** The Burn as seen by presentation: set from world.suddenDeath, timed in sim seconds. */
export interface BurnState {
  active: boolean;
  /** Match clock when The Burn began (Infinity before): BURN_TIME by rule, see burnStartFor. */
  startedAt: number;
  /** Seconds of sim time since The Burn started (0 before). */
  elapsed: number;
  /** 0..1 over BURN_CHAR_SECONDS: how far the effigy has been consumed (drives uBurn). */
  progress: number;
}

export interface EnvContext {
  ctx: RenderContext;
  /** Parent group for every environment object (removed from the scene by EnvRenderer). */
  root: THREE.Group;
  uniforms: EnvUniforms;
  /** Updated before every part's update(). */
  day: DayState;
  burn: BurnState;
  /**
   * 256² tiling RGBA8 noise (RepeatWrapping, mipmapped): R = low-frequency fBm, G = mid
   * fBm, B = cellular (Worley F1), A = white noise. Shared; parts must not dispose it.
   */
  noise: THREE.DataTexture;
  /** Point light at the effigy (intensity 0 until The Burn); owned by EnvLighting, driven by Effigy. */
  fireLight: THREE.PointLight;
}

/** One environment layer (sky, ground, props, effigy…). */
export interface EnvPart {
  update(dt: number): void;
  onEvent?(e: GameEvent): void;
  dispose(): void;
}

/** Sim seconds over which the effigy chars after The Burn starts. */
export const BURN_CHAR_SECONDS = 150;
/** Sound-camp tempo. */
export const STAGE_BPM = 124;
