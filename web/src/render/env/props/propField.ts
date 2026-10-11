/**
 * Map props: every world.map obstacle except the effigy (tents, domes, shade, porta rows,
 * art, trees, cars, rocks, sound-camp stages + their light show) and the forest ring that
 * frames the burn beyond the map border.
 *
 * Rigid props are merged per material into static world-space batches (rough, gloss, the
 * receive-only low props and the unshadowed fairy-light bulbs), each split into 8 × 8 map
 * tiles and drawn through one BatchedMesh: every obstacle keeps its exact size, colour and
 * seeded accessories, the camera and the shadow camera cull tile by tile, and each pass costs
 * one multi-draw call per material. Cloth is emitted two-sided into the rough batch, whose
 * material sways the vertices that carry sway weights. Map tree canopies are one BatchedMesh
 * culled per tree; the forest ring is instanced per angular sector and never casts shadows;
 * the turning art pieces are instanced rotors spun here; stage signs share one canvas atlas;
 * the light show is two additive shader meshes, hidden by day. Three env materials.
 * Main-pass draw calls: 4 batches + 1 canopy batch + ≤ 16 forest sectors + ≤ 2 rotors +
 * 1 signs (+ 2 show at night); the shadow pass repeats rough, gloss, canopies and rotors.
 */
import * as THREE from 'three';
import type { Obstacle, ObstacleKind } from '../../../sim/map/mapgen';
import { createEnvMaterial, disposeEnvMaterial, swayDepthOf } from '../envMaterial';
import type { EnvMaterialOptions } from '../envMaterial';
import type { EnvContext, EnvPart } from '../envTypes';
import { buildArt, createRotorTemplates } from './art';
import type { Rotor, RotorTemplates } from './art';
import { buildCars } from './cars';
import { buildDomes } from './domes';
import { createBatches, createClutterKit, disposeClutterKit, ownProp } from './kit';
import { buildPortas } from './portas';
import { buildRocks } from './rocks';
import { buildShades } from './shades';
import { StageShow } from './stageShow';
import { buildStages, StageSigns } from './stages';
import { buildTents } from './tents';
import type { CanopyInstance } from './trees';
import { buildForest, buildTrees } from './trees';

/** Static batches are split into TILES × TILES map tiles (≈ 37 m): the cull granularity. */
const TILES = 8;
const IDENTITY = new THREE.Matrix4();

/** Rough parts carry sway weights only on cloth, so one swaying material serves both. */
const ROUGH: EnvMaterialOptions = { roughness: 0.84, sway: 0.3 };
const GLOSS: EnvMaterialOptions = { roughness: 0.34, metalness: 0.45 };
const FOLIAGE: EnvMaterialOptions = { roughness: 0.9, sway: 0.45 };

/**
 * Rotor templates are seed-independent: built once per page. Each match's dispose() only
 * frees their GPU buffers, which the next match re-uploads.
 */
let rotorTemplates: RotorTemplates | null = null;

/** One placement in a BatchedMesh: which template, where, and an optional aTint colour. */
interface Placed {
  obstacleId?: number;
  geometry: number;
  matrix: THREE.Matrix4;
  color: THREE.Color | null;
}

/** Art that turns in place: instanced, re-posed every frame about one template axis. */
interface Spinner {
  mesh: THREE.InstancedMesh;
  rotors: Rotor[];
  axis: 'y' | 'z';
}

interface SceneryRange { geometry: THREE.BufferGeometry; start: number; count: number; }
interface SceneryInstance { mesh: THREE.BatchedMesh; id: number; }

export class PropField implements EnvPart {
  private env: EnvContext;
  private group = new THREE.Group();
  private materials: THREE.Material[] = [];
  /** Every geometry this part created (templates are shared by several meshes). */
  private geometries = new Set<THREE.BufferGeometry>();
  private instanced: THREE.InstancedMesh[] = [];
  private batched: THREE.BatchedMesh[] = [];
  private spinners: Spinner[] = [];
  private show: StageShow | null = null;
  private signs: StageSigns | null = null;
  private sceneryCount = 0;
  private readonly removed = new Set<number>();
  private readonly sceneryRanges = new Map<number, SceneryRange[]>();
  private readonly sceneryInstances = new Map<number, SceneryInstance[]>();
  private spin = new THREE.Matrix4();
  private posed = new THREE.Matrix4();

  constructor(env: EnvContext) {
    this.env = env;
    this.build();
  }

  /** Build once. CPU-only owner ranges let destruction edit existing buffers in place. */
  private build(): void {
    const env = this.env;
    this.sceneryCount = 0;
    this.group.name = 'props';
    const ctx = env.ctx;
    const map = ctx.world.map;
    const byKind: Record<ObstacleKind, Obstacle[]> = { tent: [], dome: [], art: [], porta: [], tree: [], rock: [], stage: [], shade: [], car: [], effigy: [] };
    // Always use the original obstacle layout, including on late joins. Shared strings and
    // row accessories must not relocate when a neighbouring prop has already been destroyed.
    for (const o of map.obstacles) byKind[o.kind].push(o);

    const out = createBatches(ctx.quality);
    const kit = createClutterKit();
    buildTents(byKind.tent, byKind.shade, kit, out);
    buildShades(byKind.shade, kit, out);
    buildDomes(byKind.dome, kit, out);
    buildPortas(byKind.porta, out);
    buildCars(byKind.car, kit, out);
    buildRocks(byKind.rock, out);
    const rotors = buildArt(byKind.art, out);
    const trees = buildTrees(byKind.tree, out);
    const stages = buildStages(byKind.stage, map.soundCamps, kit, out);
    disposeClutterKit(kit);

    const u = env.uniforms;
    // Batched and instanced draws get separate material objects (same program): three keys
    // the program on batched / instanced, so a shared material would re-derive it on every
    // switch between the two, in the main pass and through the shared sway depth twin.
    const rough = this.track(createEnvMaterial(u, ROUGH));
    const gloss = this.track(createEnvMaterial(u, GLOSS));
    const foliage = this.track(createEnvMaterial(u, FOLIAGE));
    const roughInstanced = this.track(createEnvMaterial(u, ROUGH));
    const glossInstanced = this.track(createEnvMaterial(u, GLOSS));
    const foliageInstanced = this.track(createEnvMaterial(u, FOLIAGE));

    ownProp(out, -1);
    const strings = out.strings.build();
    out.cloth.add(strings, new THREE.Matrix4());
    const cloth = out.cloth.build();
    if (cloth) out.solid.add(cloth, new THREE.Matrix4());
    this.addTiles(out.solid.buildTiles(map.half, TILES), rough, 'props-rough', true, true);
    this.addTiles(out.gloss.buildTiles(map.half, TILES), gloss, 'props-gloss', true, true);
    this.addTiles(out.low.buildTiles(map.half, TILES), rough, 'props-low', false, true);
    this.addTiles(out.lights.buildTiles(map.half, TILES), rough, 'props-lights', false, false);
    for (const geo of [strings, cloth]) geo?.dispose();

    const canopies: Placed[] = [];
    for (const it of trees.pines) canopies.push({ geometry: 0, matrix: it.matrix, color: it.color, obstacleId: it.obstacleId });
    for (const it of trees.oaks) canopies.push({ geometry: 1, matrix: it.matrix, color: it.color, obstacleId: it.obstacleId });
    this.addBatched([trees.pine, trees.oak], canopies, foliage, 'tree-canopies', true, true);
    trees.pine.dispose();
    trees.oak.dispose();
    const forest = buildForest(map.half, map.seed, ctx.quality);
    for (const sector of forest.sectors) {
      this.addInstanced(forest.pine, foliageInstanced, sector.pines, false, 'forest-pines');
      this.addInstanced(forest.broadleaf, foliageInstanced, sector.broadleaves, false, 'forest-broadleaves');
    }

    rotorTemplates ??= createRotorTemplates();
    const rotorGeo = rotorTemplates;
    this.addSpinner(rotorGeo.spiral, glossInstanced, rotors.spiral, 'y', 'art-spirals');
    this.addSpinner(rotorGeo.pinwheel, roughInstanced, rotors.pinwheel, 'z', 'art-pinwheels');
    for (const g of [forest.pine, forest.broadleaf, rotorGeo.spiral, rotorGeo.pinwheel]) this.geometries.add(g);

    if (stages.rigs.length > 0) {
      this.show = new StageShow(env, stages.rigs);
      this.signs = new StageSigns(stages.signs);
      this.group.add(this.signs.mesh);
    }
    this.group.matrixAutoUpdate = false;
    env.root.add(this.group);
    this.removeDestroyedScenery();
  }

  update(_dt: number): void {
    if (this.sceneryCount !== this.env.ctx.world.destroyedScenery.size) this.removeDestroyedScenery();
    const t = this.env.uniforms.uTime.value;
    for (let s = 0; s < this.spinners.length; s++) {
      const { mesh, rotors, axis } = this.spinners[s];
      for (let i = 0; i < rotors.length; i++) {
        const r = rotors[i];
        if (this.removed.has(r.obstacleId)) continue;
        const angle = r.phase + r.speed * t;
        if (axis === 'y') this.spin.makeRotationY(angle);
        else this.spin.makeRotationZ(angle);
        mesh.setMatrixAt(i, this.posed.multiplyMatrices(r.matrix, this.spin));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.show?.update();
    this.signs?.update(this.env.day.night);
  }

  /** Collapse only removed triangles, preserving tile batching, materials and other props.
   * Both position and sway collapse, so cloth cannot grow a triangle again in the shader.
   * Original bounds remain conservative: every removed triangle stays at its first vertex. */
  private removeDestroyedScenery(): void {
    const destroyed = this.env.ctx.world.destroyedScenery;
    // A reset is exceptional; normal authoritative scenery state only grows.
    if ([...this.removed].some(id => !destroyed.has(id))) {
      this.dispose(); this.group = new THREE.Group(); this.build(); return;
    }
    for (const id of destroyed) {
      if (this.removed.has(id)) continue;
      this.removed.add(id);
      for (const range of this.sceneryRanges.get(id) ?? []) {
        const position = range.geometry.getAttribute('position') as THREE.BufferAttribute;
        const sway = range.geometry.getAttribute('aSway') as THREE.BufferAttribute;
        for (let v = range.start; v < range.start + range.count; v += 3) {
          const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
          for (let k = 0; k < 3; k++) { position.setXYZ(v + k, x, y, z); sway.setX(v + k, 0); }
        }
        position.addUpdateRange(range.start * 3, range.count * 3); position.needsUpdate = true;
        sway.addUpdateRange(range.start, range.count); sway.needsUpdate = true;
      }
      for (const it of this.sceneryInstances.get(id) ?? []) it.mesh.setVisibleAt(it.id, false);
      for (const { mesh, rotors } of this.spinners) for (let i = 0; i < rotors.length; i++) {
        if (rotors[i].obstacleId !== id) continue;
        mesh.setMatrixAt(i, this.posed.makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
      }
      this.show?.removeScenery(id); this.signs?.removeScenery(id);
    }
    this.sceneryCount = destroyed.size;
  }

  dispose(): void {
    this.env.root.remove(this.group);
    for (const g of this.geometries) g.dispose();
    for (const m of this.instanced) m.dispose();
    for (const m of this.batched) m.dispose();
    for (const m of this.materials) disposeEnvMaterial(m);
    this.show?.dispose();
    this.signs?.dispose();
    this.show = null;
    this.signs = null;
    this.geometries.clear();
    this.instanced = [];
    this.batched = [];
    this.spinners = [];
    this.materials = [];
    this.removed.clear(); this.sceneryRanges.clear(); this.sceneryInstances.clear();
  }

  private track(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.materials.push(mat);
    return mat;
  }

  private place(mesh: THREE.Mesh, name: string, cast: boolean, receive: boolean): void {
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (cast && !Array.isArray(mesh.material)) {
      // Every caster gets a depth material of its own draw path (batched / instanced): three's
      // shared default would switch program variants between them on every shadow pass.
      let depth = swayDepthOf(mesh.material);
      if (!depth) {
        depth = new THREE.MeshDepthMaterial();
        this.materials.push(depth);
      }
      mesh.customDepthMaterial = depth;
    }
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
  }

  /** World-space tile geometries (disposed here once copied) placed as-is in one BatchedMesh. */
  private addTiles(tiles: THREE.BufferGeometry[], mat: THREE.Material, name: string, cast: boolean, receive: boolean): void {
    const items = tiles.map((_, i): Placed => ({ geometry: i, matrix: IDENTITY, color: null }));
    this.addBatched(tiles, items, mat, name, cast, receive);
    for (const g of tiles) g.dispose();
  }

  /**
   * One BatchedMesh drawing `templates` (copied in; the caller keeps ownership) at `items`:
   * each placement is culled on its own bounds against the camera and the shadow camera,
   * and every pass is a single multi-draw call.
   */
  private addBatched(templates: THREE.BufferGeometry[], items: Placed[], mat: THREE.Material, name: string, cast: boolean, receive: boolean): void {
    if (items.length === 0) return;
    // A BatchedMesh needs all of its geometries indexed or none: draw these non-indexed.
    const plain = templates.map((g) => (g.index ? g.toNonIndexed() : g));
    let vertices = 0;
    for (const g of plain) vertices += g.getAttribute('position').count;
    const mesh = new THREE.BatchedMesh(items.length, vertices, vertices * 2, mat);
    const ids = plain.map((g) => {
      const id = mesh.addGeometry(g);
      const owners = g.userData.sceneryOwners as Int32Array | undefined;
      if (owners) {
        const base = mesh.getGeometryRangeAt(id)!.vertexStart;
        for (let t = 0; t < owners.length / 2;) {
          const first = t++, a = owners[first * 2], b = owners[first * 2 + 1];
          while (t < owners.length / 2 && owners[t * 2] === a && owners[t * 2 + 1] === b) t++;
          const range = { geometry: mesh.geometry, start: base + first * 3, count: (t - first) * 3 };
          for (const owner of a === b ? [a] : [a, b]) if (owner >= 0) {
            const ranges = this.sceneryRanges.get(owner) ?? [];
            ranges.push(range); this.sceneryRanges.set(owner, ranges);
          }
        }
      }
      return id;
    });
    for (const it of items) {
      const id = mesh.addInstance(ids[it.geometry]);
      mesh.setMatrixAt(id, it.matrix);
      if (it.color) mesh.setColorAt(id, it.color);
      if (it.obstacleId !== undefined) {
        const instances = this.sceneryInstances.get(it.obstacleId) ?? [];
        instances.push({ mesh, id }); this.sceneryInstances.set(it.obstacleId, instances);
      }
    }
    plain.forEach((g, i) => {
      if (g !== templates[i]) g.dispose();
    });
    mesh.computeBoundingSphere();
    this.batched.push(mesh);
    this.place(mesh, name, cast, receive);
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: CanopyInstance[], shadows: boolean, name: string): void {
    if (items.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      mesh.setColorAt(i, it.color);
    });
    // Bounds of these instances only, so distant groups and forest sectors cull.
    mesh.computeBoundingSphere();
    this.instanced.push(mesh);
    this.place(mesh, name, shadows, shadows);
  }

  private addSpinner(geo: THREE.BufferGeometry, mat: THREE.Material, rotors: Rotor[], axis: 'y' | 'z', name: string): void {
    if (rotors.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, rotors.length);
    rotors.forEach((r, i) => {
      mesh.setMatrixAt(i, r.matrix);
      mesh.setColorAt(i, r.color);
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Turning in place never leaves the bounds computed from the rest poses.
    mesh.computeBoundingSphere();
    this.instanced.push(mesh);
    this.place(mesh, name, true, true);
    this.spinners.push({ mesh, rotors, axis });
  }
}
