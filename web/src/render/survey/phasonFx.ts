/**
 * The Crystal turning: phason flip glides (node display tween + fading old spokes + glassy
 * chromatic ripple + a brightening band through nearby lattice/facets), the tide warning
 * shiver that swells over the 10 s countdown ("The Crystal is turning…"), and the tide
 * itself as a straight wave front sweeping the burn in step with the sim's turning front
 * (each node it turns arrives as its own phasonFlip as the front passes).
 */
import * as THREE from 'three';
import { MAP_HALF } from '../../sim/constants';
import type { EventOf } from '../../sim/events';
import type { World } from '../../sim/world';
import { DECAL } from './decals';
import type { DecalLayer } from './decals';
import { FLIP_SLOTS } from './glsl';
import type { SurveyUniforms } from './glsl';
import type { LatticeLayer } from './latticeLayer';
import type { SurveyData } from './surveyData';

const MAX_RIPPLES = 96;
const RIPPLE_TIME = 1.4;
const RIPPLE_R = 9;
/** Wave decal radius: covers the whole map square in any sweep orientation. */
const WAVE_R = MAP_HALF * Math.SQRT2 + 4;
/** Sweep used when a tide event carries no duration (older emitters). */
const DEFAULT_SWEEP = 1.8;

export class PhasonFeature {
  private readonly world: World;
  private readonly data: SurveyData;
  private readonly lattice: LatticeLayer;
  private readonly u: SurveyUniforms;
  private readonly ripples = new Float32Array(MAX_RIPPLES * 3);
  private rippleCursor = 0;
  private flipCursor = 0;
  private warnStart = -1;
  private warnEnd = -1;
  private waveStart = -1e4;
  private waveDuration = DEFAULT_SWEEP;
  private waveReach = MAP_HALF;
  private waveRot = 0;
  private readonly glass = new THREE.Color(0.75, 0.92, 1.0);
  private readonly wave = new THREE.Color(0.55, 0.9, 1.0);

  constructor(world: World, data: SurveyData, lattice: LatticeLayer, u: SurveyUniforms) {
    this.world = world;
    this.data = data;
    this.lattice = lattice;
    this.u = u;
    this.ripples.fill(-1e4);
  }

  onFlip(e: EventOf<'phasonFlip'>, now: number): void {
    this.data.startFlipTween(e.node, now);
    this.lattice.addFlipSpokes(e.node, now);
    const r = this.rippleCursor;
    this.rippleCursor = (r + 1) % MAX_RIPPLES;
    this.ripples[r * 3] = e.to.x;
    this.ripples[r * 3 + 1] = e.to.z;
    this.ripples[r * 3 + 2] = now;
    const slot = this.u.uFlips.value[this.flipCursor];
    this.flipCursor = (this.flipCursor + 1) % FLIP_SLOTS;
    slot.set(e.to.x, e.to.z, now, e.cause === 'tide' ? 0.7 : 1);
  }

  onTideWarning(e: EventOf<'tideWarning'>, now: number): void {
    this.warnStart = now;
    this.warnEnd = now + Math.max(1, e.at - this.world.time);
  }

  /**
   * The sim's front runs along unit `dir` from projection -reach to +reach (reach = the map
   * square's extent along dir) over `duration` s, starting now.
   */
  onTide(e: EventOf<'tide'>, now: number): void {
    // Older emitters may omit the sweep: fall back to a west-to-east pass.
    const dx = e.dir ? e.dir.x : 1;
    const dz = e.dir ? e.dir.z : 0;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    this.waveStart = now;
    this.waveDuration = e.duration !== undefined && e.duration > 0 ? e.duration : DEFAULT_SWEEP;
    this.waveReach = MAP_HALF * (Math.abs(ux) + Math.abs(uz));
    this.waveRot = Math.atan2(uz, ux);
    this.warnEnd = -1;
    const tide = this.u.uTide.value;
    tide.set(tide.x, now, this.waveDuration, this.waveReach);
    this.u.uTideDir.value.set(ux, uz);
  }

  update(now: number, dt: number, decals: DecalLayer): void {
    let warn = 0;
    if (this.warnEnd > now) {
      const k = (now - this.warnStart) / Math.max(0.001, this.warnEnd - this.warnStart);
      warn = 0.12 + 0.88 * k * k;
    }
    // Ease the shiver out after the tide lands.
    const tide = this.u.uTide.value;
    tide.x = warn > tide.x ? warn : Math.max(warn, tide.x - dt * 1.2);

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const age = (now - this.ripples[i * 3 + 2]) / RIPPLE_TIME;
      if (age < 0 || age >= 1) continue;
      decals.push(DECAL.ripple, this.ripples[i * 3], this.ripples[i * 3 + 1], RIPPLE_R, 0, this.glass, 1, 0.85, age);
    }
    const wk = now - this.waveStart;
    if (wk >= 0 && wk < this.waveDuration) {
      const front = this.waveReach * ((2 * wk) / this.waveDuration - 1);
      decals.push(DECAL.wave, 0, 0, WAVE_R, this.waveRot, this.wave, 1, 0.9, front / WAVE_R);
    }
  }
}
