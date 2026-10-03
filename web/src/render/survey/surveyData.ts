/**
 * GPU mirror of the Ley Lattice and SurveyState for the Survey layer. Every survey shader
 * reads node display positions and per-node/edge/facet state from these data textures, so
 * topology changes rewrite a few id attributes, survey recomputes rewrite texels, and the
 * per-frame cost is limited to flip tweens and the instability channel.
 *
 * Display positions differ from lattice positions only while a phason flip tween runs: the
 * flipped node glides from its old spot to its new one and everything anchored to it
 * (lines, facets, ghosts, decals) follows.
 */
import * as THREE from 'three';
import { susceptibility } from '../../sim/lattice/geometry';
import type { Lattice } from '../../sim/lattice/lattice';
import type { World } from '../../sim/world';
import { FLIP_TWEEN, TEX_W, texRows } from './glsl';

const MAX_TWEENS = 256;
/** Fill sweep speed (m/s) across a newly enclosed region. */
const SWEEP_SPEED = 42;
const LOSS_SWEEP_SPEED = 70;
const MAX_SWEEP_DELAY = 2.4;
/** Facet anim start for "no animation" (long ago). */
const NEVER = -1e4;

function dataTexture(count: number): { tex: THREE.DataTexture; data: Float32Array } {
  const data = new Float32Array(TEX_W * texRows(count) * 4);
  const tex = new THREE.DataTexture(data, TEX_W, texRows(count), THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, data };
}

/** Glassy ease with a slight overshoot (a crystal snapping into its new cell). */
function easeFlip(t: number): number {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export class SurveyData {
  readonly world: World;
  readonly lat: Lattice;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly facetCount: number;

  readonly nodeTex: THREE.DataTexture;
  readonly auxTex: THREE.DataTexture;
  readonly edgeTex: THREE.DataTexture;
  readonly facetTex: THREE.DataTexture;
  private readonly nodeData: Float32Array;
  private readonly auxData: Float32Array;
  private readonly edgeData: Float32Array;
  private readonly facetData: Float32Array;

  /** Display positions (lattice position unless a flip tween is running). */
  readonly dispX: Float32Array;
  readonly dispZ: Float32Array;
  /** Bumped whenever lattice topology changed: layers rewrite their node-id attributes. */
  topology = 0;
  /** Bumped whenever survey-derived data changed (holders, ley lines, facets). */
  surveyStamp = 0;

  private latticeVersion: number;
  private surveyVersion = -1;
  private readonly facetMask: Uint8Array;
  private readonly facetCrystalOwner: Int8Array;
  private readonly pendingStart: Float32Array;
  private readonly pendingList: Int32Array;
  private pendingCount = 0;
  private readonly edgeOwner: Int8Array;
  /** Presentation time of the last flagPlanted per node (ley zips flow toward the newer Flag). */
  private readonly plantedAt: Float32Array;
  private readonly instab: Float32Array;

  private readonly tweenNode = new Int32Array(MAX_TWEENS);
  private readonly tweenFromX = new Float32Array(MAX_TWEENS);
  private readonly tweenFromZ = new Float32Array(MAX_TWEENS);
  private readonly tweenStart = new Float32Array(MAX_TWEENS);
  private tweenCount = 0;
  private readonly tweening: Uint8Array;

  constructor(world: World) {
    this.world = world;
    this.lat = world.lattice;
    const lat = this.lat;
    this.nodeCount = lat.nodes.length;
    this.edgeCount = lat.edges.length;
    this.facetCount = lat.facets.length;

    const node = dataTexture(this.nodeCount);
    const aux = dataTexture(this.nodeCount);
    const edge = dataTexture(this.edgeCount);
    const facet = dataTexture(this.facetCount);
    this.nodeTex = node.tex;
    this.nodeData = node.data;
    this.auxTex = aux.tex;
    this.auxData = aux.data;
    this.edgeTex = edge.tex;
    this.edgeData = edge.data;
    this.facetTex = facet.tex;
    this.facetData = facet.data;

    this.dispX = new Float32Array(this.nodeCount);
    this.dispZ = new Float32Array(this.nodeCount);
    this.tweening = new Uint8Array(this.nodeCount);
    this.plantedAt = new Float32Array(this.nodeCount).fill(NEVER);
    this.facetMask = new Uint8Array(this.facetCount);
    this.facetCrystalOwner = new Int8Array(this.facetCount).fill(-1);
    this.pendingStart = new Float32Array(this.facetCount).fill(NaN);
    this.pendingList = new Int32Array(this.facetCount);
    this.edgeOwner = new Int8Array(this.edgeCount).fill(-1);
    this.instab = new Float32Array(this.facetCount);

    this.latticeVersion = lat.version;
    this.syncPositions();
    this.syncAux();
    // Baseline: whatever already exists at match start appears without animation.
    const s = world.survey;
    this.facetMask.set(s.facetSurvey);
    this.facetCrystalOwner.set(s.facetCrystal);
    this.edgeOwner.set(s.edgeLey);
    for (let e = 0; e < this.edgeCount; e++) {
      const o = this.edgeOwner[e];
      const i = e * 4;
      this.edgeData[i] = o;
      this.edgeData[i + 1] = NEVER;
      this.edgeData[i + 2] = o;
      this.edgeData[i + 3] = 0;
    }
    this.surveyVersion = s.version;
    this.writeNodeState();
    this.writeAllFacets(true);
    this.edgeTex.needsUpdate = true;
  }

  // ── Event hooks (called before update in the same frame) ────────────────────

  notePlanted(node: number, now: number): void {
    if (node >= 0 && node < this.nodeCount) this.plantedAt[node] = now;
  }

  /** Order a fill (gain) or dissolve (loss) sweep outward from the region's first facet. */
  noteSurveyChanged(gained: readonly number[], lost: readonly number[], now: number): void {
    this.queueSweep(gained, now, SWEEP_SPEED);
    this.queueSweep(lost, now, LOSS_SWEEP_SPEED);
  }

  private queueSweep(facets: readonly number[], now: number, speed: number): void {
    if (facets.length === 0) return;
    const fs = this.lat.facets;
    const seed = fs[facets[0]];
    if (!seed) return;
    for (let i = 0; i < facets.length; i++) {
      const f = facets[i];
      const fc = fs[f];
      if (!fc) continue;
      const d = Math.hypot(fc.cx - seed.cx, fc.cz - seed.cz);
      const t = now + Math.min(MAX_SWEEP_DELAY, d / speed);
      const cur = this.pendingStart[f];
      if (Number.isNaN(cur)) {
        this.pendingStart[f] = t;
        this.pendingList[this.pendingCount++] = f;
      } else if (t < cur) this.pendingStart[f] = t;
    }
  }

  /** Begin gliding `node` from its current display position to its lattice position. */
  startFlipTween(node: number, now: number): void {
    if (node < 0 || node >= this.nodeCount) return;
    let slot = -1;
    for (let i = 0; i < this.tweenCount; i++) {
      if (this.tweenNode[i] === node) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      if (this.tweenCount >= MAX_TWEENS) return;
      slot = this.tweenCount++;
    }
    this.tweenNode[slot] = node;
    this.tweenFromX[slot] = this.dispX[node];
    this.tweenFromZ[slot] = this.dispZ[node];
    this.tweenStart[slot] = now;
    this.tweening[node] = 1;
  }

  /** 0..1 progress of a node's flip glide (1 = settled). */
  settle(node: number, now: number): number {
    if (this.tweening[node] === 0) return 1;
    for (let i = 0; i < this.tweenCount; i++) {
      if (this.tweenNode[i] === node) return Math.min(1, (now - this.tweenStart[i]) / FLIP_TWEEN);
    }
    return 1;
  }

  // ── Per frame ───────────────────────────────────────────────────────────────

  update(now: number): void {
    const lat = this.lat;
    let boundaryDirty = false;
    if (lat.version !== this.latticeVersion) {
      this.latticeVersion = lat.version;
      this.topology++;
      this.syncPositions();
      this.syncAux();
      boundaryDirty = true;
    }
    if (this.tweenCount > 0) this.stepTweens(now);

    const s = this.world.survey;
    if (s.version !== this.surveyVersion) {
      this.surveyVersion = s.version;
      this.surveyStamp++;
      this.writeNodeState();
      this.diffEdges(now);
      if (this.diffFacets(now)) boundaryDirty = true;
    }
    if (boundaryDirty) this.writeAllFacets(false);
    for (let i = 0; i < this.pendingCount; i++) this.pendingStart[this.pendingList[i]] = NaN;
    this.pendingCount = 0;

    // Instability changes every tick; mirror it only when it moved.
    const src = s.facetInstability;
    let moved = false;
    for (let f = 0; f < this.facetCount; f++) {
      const v = src[f];
      if (Math.abs(v - this.instab[f]) > 0.004 || (v === 0 && this.instab[f] !== 0)) {
        this.instab[f] = v;
        this.facetData[f * 4 + 2] = v;
        moved = true;
      }
    }
    if (moved) this.facetTex.needsUpdate = true;
  }

  private syncPositions(): void {
    const nodes = this.lat.nodes;
    for (let n = 0; n < this.nodeCount; n++) {
      if (this.tweening[n] === 1) continue;
      this.dispX[n] = nodes[n].x;
      this.dispZ[n] = nodes[n].z;
      this.nodeData[n * 4] = nodes[n].x;
      this.nodeData[n * 4 + 1] = nodes[n].z;
    }
    this.nodeTex.needsUpdate = true;
  }

  private syncAux(): void {
    const lat = this.lat;
    for (let n = 0; n < this.nodeCount; n++) {
      const i = n * 4;
      this.auxData[i] = this.tweening[n] === 1 ? this.auxData[i] : 1;
      this.auxData[i + 1] = susceptibility(lat, n);
    }
    this.auxTex.needsUpdate = true;
  }

  private stepTweens(now: number): void {
    const nodes = this.lat.nodes;
    for (let i = this.tweenCount - 1; i >= 0; i--) {
      const n = this.tweenNode[i];
      const t = Math.min(1, (now - this.tweenStart[i]) / FLIP_TWEEN);
      const e = easeFlip(t);
      const x = this.tweenFromX[i] + (nodes[n].x - this.tweenFromX[i]) * e;
      const z = this.tweenFromZ[i] + (nodes[n].z - this.tweenFromZ[i]) * e;
      this.dispX[n] = x;
      this.dispZ[n] = z;
      this.nodeData[n * 4] = x;
      this.nodeData[n * 4 + 1] = z;
      this.auxData[n * 4] = t;
      if (t >= 1) {
        this.tweening[n] = 0;
        const last = --this.tweenCount;
        this.tweenNode[i] = this.tweenNode[last];
        this.tweenFromX[i] = this.tweenFromX[last];
        this.tweenFromZ[i] = this.tweenFromZ[last];
        this.tweenStart[i] = this.tweenStart[last];
      }
    }
    this.nodeTex.needsUpdate = true;
    this.auxTex.needsUpdate = true;
  }

  private writeNodeState(): void {
    const s = this.world.survey;
    const nodes = this.lat.nodes;
    for (let n = 0; n < this.nodeCount; n++) {
      const i = n * 4;
      this.nodeData[i + 2] = s.holder[n];
      const order = Math.min(3, s.impliedOrder[n]);
      this.nodeData[i + 3] = (nodes[n].blocked ? 1 : 0) | (s.nodeFlagOwner[n] >= 0 ? 2 : 0) | (order << 2);
    }
    this.nodeTex.needsUpdate = true;
  }

  private diffEdges(now: number): void {
    const ley = this.world.survey.edgeLey;
    const edges = this.lat.edges;
    let changed = false;
    for (let e = 0; e < this.edgeCount; e++) {
      const o = ley[e];
      const prev = this.edgeOwner[e];
      if (o === prev) continue;
      this.edgeOwner[e] = o;
      changed = true;
      const i = e * 4;
      this.edgeData[i] = o;
      this.edgeData[i + 1] = now;
      this.edgeData[i + 2] = prev;
      if (o >= 0) {
        const ed = edges[e];
        // Energy flows from the established Flag toward the newly planted one.
        this.edgeData[i + 3] = this.plantedAt[ed.a] > this.plantedAt[ed.b] ? 2 : 1;
      } else this.edgeData[i + 3] = -1;
    }
    if (changed) this.edgeTex.needsUpdate = true;
  }

  /** Returns true when any facet's survey mask or crystal owner changed. */
  private diffFacets(now: number): boolean {
    const s = this.world.survey;
    let changed = false;
    for (let f = 0; f < this.facetCount; f++) {
      const m = s.facetSurvey[f];
      const c = s.facetCrystal[f];
      const pm = this.facetMask[f];
      const pc = this.facetCrystalOwner[f];
      if (m === pm && c === pc) continue;
      changed = true;
      this.facetMask[f] = m;
      this.facetCrystalOwner[f] = c;
      const pending = this.pendingStart[f];
      const i = f * 4;
      this.facetData[i + 1] = c + 1 + (pc + 1) * 8;
      this.facetData[i + 3] = Number.isNaN(pending) ? now : pending;
      // The previous mask rides in bits 4..7 until the next change.
      this.facetData[i] = m | (pm << 4);
    }
    return changed;
  }

  /** Recompute the territory-boundary bits (edges where the survey composition changes). */
  private writeAllFacets(initial: boolean): void {
    const fs = this.lat.facets;
    for (let f = 0; f < this.facetCount; f++) {
      const i = f * 4;
      const m = this.facetMask[f];
      let boundary = 0;
      if (m !== 0) {
        const nb = fs[f].neighbors;
        for (let k = 0; k < 4; k++) {
          const g = nb[k];
          if (g < 0 || this.facetMask[g] !== m) boundary |= 1 << k;
        }
      }
      const prev = initial ? m : (this.facetData[i] >> 4) & 15;
      this.facetData[i] = m | (prev << 4) | (boundary << 8);
      if (initial) {
        const c = this.facetCrystalOwner[f];
        this.facetData[i + 1] = c + 1 + (c + 1) * 8;
        this.facetData[i + 3] = NEVER;
      }
    }
    this.facetTex.needsUpdate = true;
  }

  dispose(): void {
    this.nodeTex.dispose();
    this.auxTex.dispose();
    this.edgeTex.dispose();
    this.facetTex.dispose();
  }
}
