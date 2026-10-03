/**
 * Lumber piles from world.piles: stacked pallets, sticker-stacked plank layers and MOOP heaps
 * that shrink as hippies cart them away (see pileLayout.ts). Every piece of every pile is one
 * placement in a single BatchedMesh holding one template per piece model, so the camera culls
 * piece by piece and the whole field is one multi-draw call. Piles are low clutter: they
 * receive shadows but never render into the shadow map. Each frame only hashes the piles' ids
 * and quantized lumber levels; placements are rewritten only when that signature changes (a
 * pile spawns, steps down a stage, or disappears at lumber ≤ 0), reusing placement slots.
 */
import * as THREE from 'three';
import type { Pile } from '../../../sim/types';
import { createEnvMaterial, disposeEnvMaterial } from '../envMaterial';
import type { EnvContext, EnvPart } from '../envTypes';
import { buildPileLayout, moundHeight } from './pileLayout';
import type { PileItem, PileLayout } from './pileLayout';
import { buildPieceGeometry, PIECES } from './pileModels';

/** Lumber fraction is quantized to this many visual stages (signature and layout agree). */
const STAGES = 24;
/** Initial placement slots; doubled when a rebuild needs more. */
const START_CAPACITY = 1024;
const WHITE = new THREE.Color(1, 1, 1);

/** Piece models are seed-independent: built once per page (each BatchedMesh copies them). */
let pieceModels: THREE.BufferGeometry[] | null = null;

export class LumberPiles implements EnvPart {
  private env: EnvContext;
  private mat: THREE.MeshStandardMaterial;
  private mesh: THREE.BatchedMesh;
  /** BatchedMesh geometry id of each piece model, in PIECES order. */
  private geometryIds: number[];
  /** Placement slots owned so far: the first `used` show pieces, the rest are hidden. */
  private slots: number[] = [];
  private used = 0;
  private layouts = new Map<number, PileLayout>();
  private signature = 0;
  private sigAcc = 0;
  // Rebuild scratch.
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private yawQ = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private scl = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(env: EnvContext) {
    this.env = env;
    this.mat = createEnvMaterial(env.uniforms, { roughness: 0.82 });
    pieceModels ??= PIECES.map((piece) => buildPieceGeometry(piece));
    const models = pieceModels;
    let vertices = 0;
    for (const g of models) vertices += g.getAttribute('position').count;
    this.mesh = new THREE.BatchedMesh(START_CAPACITY, vertices, vertices * 2, this.mat);
    this.geometryIds = models.map((g) => this.mesh.addGeometry(g));
    // Placement colours exist from the start so the program never recompiles mid-match.
    const first = this.mesh.addInstance(this.geometryIds[0]);
    this.mesh.setColorAt(first, WHITE);
    this.mesh.setVisibleAt(first, false);
    this.slots.push(first);
    // A few hundred small pieces: drawing them unsorted saves a per-frame sort for nothing.
    this.mesh.sortObjects = false;
    this.mesh.name = 'lumber-piles';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    env.root.add(this.mesh);
  }

  /** Order-sensitive hash of every live pile's id and visual stage. */
  private readonly hashPile = (p: Pile): void => {
    const stage = p.lumber > 0 ? Math.ceil(Math.min(1, p.lumber / p.max) * STAGES) : 0;
    this.sigAcc = (Math.imul(this.sigAcc ^ p.id, 0x01000193) + stage * 0x9e3779b1) | 0;
  };

  update(_dt: number): void {
    const piles = this.env.ctx.world.piles;
    this.sigAcc = 0x811c9dc5 ^ piles.size;
    piles.forEach(this.hashPile);
    if (this.sigAcc === this.signature) return;
    this.signature = this.sigAcc;
    this.rebuild(piles);
  }

  private rebuild(piles: Map<number, Pile>): void {
    for (const id of this.layouts.keys()) if (!piles.has(id)) this.layouts.delete(id);
    this.used = 0;
    for (const p of piles.values()) {
      if (p.lumber <= 0) continue;
      let layout = this.layouts.get(p.id);
      if (!layout) {
        layout = buildPileLayout(p);
        this.layouts.set(p.id, layout);
      }
      const q = Math.ceil(Math.min(1, p.lumber / p.max) * STAGES) / STAGES;
      const visible = Math.max(1, Math.ceil(q * layout.items.length));
      const sink = moundHeight(q);
      this.yawQ.setFromAxisAngle(this.up, layout.yaw);
      const c = Math.cos(layout.yaw);
      const s = Math.sin(layout.yaw);
      for (let i = 0; i < visible; i++) this.place(layout.items[i], p.pos.x, p.pos.z, c, s, sink);
    }
    for (let i = this.used; i < this.slots.length; i++) this.mesh.setVisibleAt(this.slots[i], false);
    this.mesh.computeBoundingSphere();
  }

  private place(it: PileItem, px: number, pz: number, c: number, s: number, sink: number): void {
    const geometry = this.geometryIds[PIECES.indexOf(it.piece)];
    let slot: number;
    if (this.used < this.slots.length) {
      slot = this.slots[this.used];
      this.mesh.setGeometryIdAt(slot, geometry);
      this.mesh.setVisibleAt(slot, true);
    } else {
      if (this.slots.length >= this.mesh.maxInstanceCount) this.mesh.setInstanceCount(this.mesh.maxInstanceCount * 2);
      slot = this.mesh.addInstance(geometry);
      this.slots.push(slot);
    }
    this.used++;
    // Pile yaw rotates local (x, z) like Object3D.rotation.y.
    this.pos.set(px + it.x * c + it.z * s, it.onMound ? it.y * sink : it.y, pz - it.x * s + it.z * c);
    this.quat.setFromEuler(this.euler.set(it.rx, it.ry, it.rz)).premultiply(this.yawQ);
    if (it.piece === 'mound') this.scl.set(it.scale, it.scale * sink, it.scale);
    else this.scl.setScalar(it.scale);
    this.mesh.setMatrixAt(slot, this.m.compose(this.pos, this.quat, this.scl));
    this.mesh.setColorAt(slot, it.color);
  }

  dispose(): void {
    this.env.root.remove(this.mesh);
    this.mesh.dispose();
    disposeEnvMaterial(this.mat);
  }
}
