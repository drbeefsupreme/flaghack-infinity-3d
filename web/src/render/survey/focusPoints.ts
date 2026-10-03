/**
 * Crystal focus points (5-fold star vertices), drawn only where revealed to the player:
 * Geomantic Advice around the player's active GCC (30 m), anywhere under Luminous Dust, and
 * in Command View within 60 m of the GCC. Each revealed focus is a pentacle glyph pointing at
 * its five neighbours whose points light in the colour of whoever holds them (pentacle
 * progress at a glance). Hovering a focus draws the pentacle itself: rays to the five
 * neighbours, the pentagram through them and rings on the nodes to claim.
 */
import * as THREE from 'three';
import type { Session } from '../../game/session';
import { GCC } from '../../sim/constants';
import { gccActive } from '../../sim/systems/gcc';
import type { World } from '../../sim/world';
import { BEAM } from './beams';
import type { BeamLayer } from './beams';
import { DECAL } from './decals';
import type { DecalLayer } from './decals';
import { BEAM_Y } from './glsl';
import type { SurveyData } from './surveyData';

const COMMAND_REVEAL = 60;
const MAX_TRACKED = 256;
const GLYPH_R = 2.9;

export class FocusFeature {
  private readonly world: World;
  private readonly session: Session;
  private readonly data: SurveyData;
  private readonly alpha: Float32Array;
  private readonly isFocus: Uint8Array;
  private readonly isTracked: Uint8Array;
  private readonly tracked = new Int32Array(MAX_TRACKED);
  private trackedCount = 0;
  private builtStamp = -1;
  private builtTopology = -1;
  private readonly gold = new THREE.Color(1.0, 0.84, 0.42);
  private readonly ring = new THREE.Color();
  private readonly nbr = new Int32Array(8);

  constructor(world: World, session: Session, data: SurveyData) {
    this.world = world;
    this.session = session;
    this.data = data;
    this.alpha = new Float32Array(data.nodeCount);
    this.isFocus = new Uint8Array(data.nodeCount);
    this.isTracked = new Uint8Array(data.nodeCount);
  }

  update(dt: number, decals: DecalLayer, beams: BeamLayer): void {
    const w = this.world;
    const lat = this.data.lat;
    const focus = w.survey.focusNodes;
    if (this.builtStamp !== this.data.surveyStamp || this.builtTopology !== this.data.topology) {
      this.builtStamp = this.data.surveyStamp;
      this.builtTopology = this.data.topology;
      this.isFocus.fill(0);
      for (let i = 0; i < focus.length; i++) {
        const n = focus[i];
        if (n < 0 || n >= this.data.nodeCount) continue;
        this.isFocus[n] = 1;
        if (this.isTracked[n] === 0 && this.trackedCount < MAX_TRACKED) {
          this.isTracked[n] = 1;
          this.tracked[this.trackedCount++] = n;
        }
      }
    }

    const pf = w.factions[this.session.playerFaction];
    const dust = pf.drugActive.dust > w.time;
    const gcc = gccActive(w, this.session.playerFaction) ? w.gccOf(this.session.playerFaction) : undefined;
    const command = this.session.viewBlend > 0.5;
    const hover = this.session.hover.node;
    const k = Math.min(1, dt * 5);
    const dispX = this.data.dispX;
    const dispZ = this.data.dispZ;
    const holder = w.survey.holder;

    for (let i = this.trackedCount - 1; i >= 0; i--) {
      const n = this.tracked[i];
      let revealed = false;
      if (this.isFocus[n] === 1) {
        if (dust) revealed = true;
        else if (gcc) {
          const d = Math.hypot(dispX[n] - gcc.pos.x, dispZ[n] - gcc.pos.z);
          revealed = d <= GCC.adviceRadius || (command && d <= COMMAND_REVEAL);
        }
      }
      this.alpha[n] += ((revealed ? 1 : 0) - this.alpha[n]) * k;
      const a = this.alpha[n];
      if (a < 0.004 && this.isFocus[n] === 0) {
        this.alpha[n] = 0;
        this.isTracked[n] = 0;
        this.tracked[i] = this.tracked[--this.trackedCount];
        continue;
      }
      if (a < 0.01) continue;

      // Neighbours in angular order (edges are sorted CCW by atan2(dz, dx)).
      const edges = lat.nodes[n].edges;
      const count = Math.min(edges.length, this.nbr.length);
      let packed = 0;
      for (let j = 0; j < count; j++) {
        const m = lat.other(edges[j], n);
        this.nbr[j] = m;
        if (j < 5) packed |= (holder[m] + 1) << (3 * j);
      }
      const rot = count > 0 ? Math.atan2(dispZ[this.nbr[0]] - dispZ[n], dispX[this.nbr[0]] - dispX[n]) : 0;
      const hovered = hover === n;
      decals.push(DECAL.star, 0, 0, GLYPH_R * (hovered ? 1.12 : 1), rot, this.gold, a * (hovered ? 1 : 0.85), 0.75, 0, packed, n * 0.37, n);

      if (!hovered || a < 0.2) continue;
      for (let j = 0; j < count; j++) {
        const m = this.nbr[j];
        const h = holder[m];
        if (h >= 0) this.ring.setHex(w.factions[h].color);
        else this.ring.copy(this.gold);
        decals.push(DECAL.node, 0, 0, 1.5, 0, this.ring, a, 0.7, 0, 0, 0, m);
        beams.push(BEAM.dash, 0, 0.15, 0, 0, 0.15, 0, 0.12, this.gold, a * 0.8, 1.2, 0, n, m);
        if (count === 5) {
          const o = this.nbr[(j + 2) % 5];
          beams.push(BEAM.flow, 0, BEAM_Y * 0.5, 0, 0, BEAM_Y * 0.5, 0, 0.1, this.gold, a * 0.6, 4, j, m, o);
        }
      }
    }
  }
}
