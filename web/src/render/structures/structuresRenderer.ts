/**
 * Structures: the Geomantic Command Center (pentagonal black cart, five-Flag pinwheel
 * sigils, Flag-spoke wheels, scroll, banner poles with the canvas-lettered yellow banner,
 * live miniature-map tabletop), Flag Hearths (stock visibly racked, stage-coloured flame),
 * Workshop, Drum Circle, Hearth Ward, Drug Lab, construction/damaged/disabled states,
 * Fortnite pieces (tarp walls, decks, ramps) with pop-in, building placement ghosts.
 * Owner: RenderStructures agent.
 *
 * Publishes ctx.shared.gccTableTexture (the live table map; frame constants in tableMap.ts).
 */
import * as THREE from 'three';
import type { GameEvent } from '../../sim/events';
import type { Building, EntityId } from '../../sim/types';
import type { RenderContext, RenderModule } from '../context';
import { DUST_TAN, type BuildingView, type FrameInfo } from './buildingView';
import { DrugLabView } from './drugLabView';
import { DrumCircleView } from './drumCircleView';
import { GccView } from './gccView';
import { GhostRenderer } from './ghosts';
import { HearthView } from './hearthView';
import { StructureKit } from './kit';
import { PieceRenderer } from './pieces';
import { PuffField } from './puffs';
import { TableMap } from './tableMap';
import { WardView } from './wardView';
import { WorkshopView } from './workshopView';

/** Hearths are the only lit structures; the count is fixed so materials never recompile. */
const HEARTH_LIGHTS = 4;

export class StructuresRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly kit: StructureKit;
  private readonly table: TableMap;
  private readonly smoke: PuffField;
  private readonly sparks: PuffField;
  private readonly lights: THREE.PointLight[] = [];
  private readonly lightOwner = new Map<EntityId, THREE.PointLight>();
  private readonly views = new Map<EntityId, BuildingView>();
  private readonly stock = new Map<EntityId, number>();
  private readonly frame: FrameInfo;
  private readonly pieces: PieceRenderer;
  private readonly ghosts: GhostRenderer;
  private windPhase = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.kit = new StructureKit(ctx.renderer, ctx.quality);
    const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    this.table = new TableMap(ctx.world, ctx.quality, aniso);
    this.kit.tableTexture = this.table.texture;
    ctx.shared.gccTableTexture = this.table.texture;
    const cap = ctx.quality === 'low' ? 384 : 1024;
    this.smoke = new PuffField(cap, false, this.kit.texture('puff'));
    this.sparks = new PuffField(cap, true, this.kit.texture('glow'));
    ctx.scene.add(this.smoke.mesh, this.sparks.mesh);
    for (let i = 0; i < HEARTH_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffa050, 0, 34, 2);
      light.position.set(0, -50, 0);
      ctx.scene.add(light);
      this.lights.push(light);
    }
    this.frame = {
      ctx,
      world: ctx.world,
      dt: 0,
      t: 0,
      night: 0,
      windYaw: 0,
      wind: 0.6,
      stock: this.stock,
      smoke: this.smoke,
      sparks: this.sparks,
    };
    this.pieces = new PieceRenderer(this.kit, ctx.scene, ctx.world.lattice);
    this.ghosts = new GhostRenderer(this.kit, ctx.scene, ctx.world.lattice.edge);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const w = ctx.world;
    const f = this.frame;
    f.dt = dt;
    f.t = ctx.time;
    f.night = Math.min(1, Math.max(0, 1 - ctx.daylight));
    const wind = ctx.shared.wind;
    const wx = wind ? wind.x : 0.8;
    const wz = wind ? wind.z : 0.6;
    f.wind = wind ? wind.strength : 0.6;
    f.windYaw = Math.atan2(-wz, wx);
    this.windPhase += dt * (0.55 + 0.6 * f.wind);
    const g = this.kit.global;
    g.uTime.value = ctx.time;
    g.uNight.value = f.night;
    g.uWindPhase.value = this.windPhase;
    g.uWind.value = f.wind;

    this.stock.clear();
    for (const fl of w.flags.values()) {
      if (fl.state === 'stock') this.stock.set(fl.holder, (this.stock.get(fl.holder) ?? 0) + 1);
    }

    for (const b of w.buildings.values()) {
      let v = this.views.get(b.id);
      if (!v) {
        v = this.createView(b);
        ctx.scene.add(v.root);
        this.views.set(b.id, v);
      }
      v.update(b, f);
    }
    if (this.views.size > 0) {
      for (const [id, v] of this.views) {
        if (w.buildings.has(id)) continue;
        this.releaseLight(id);
        v.dispose();
        this.views.delete(id);
      }
    }

    this.pieces.update(f);
    this.ghosts.update(f);
    this.table.update(dt, w, ctx.time);
    this.smoke.update(dt, ctx.time, 0.3 + 0.7 * ctx.daylight);
    this.sparks.update(dt, ctx.time, 1);
  }

  onEvent(e: GameEvent): void {
    for (const v of this.views.values()) v.onEvent(e, this.frame);
    if (e.t === 'pieceBuilt') {
      // Construction dust kicked up as the piece snaps into place.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.smoke.emit(e.pos.x, e.pos.y, e.pos.z, Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5, 0.5, 1.6, 0.9, DUST_TAN, 0.5, 0.1);
      }
    }
  }

  private createView(b: Building): BuildingView {
    switch (b.kind) {
      case 'gcc':
        return new GccView(this.kit, b);
      case 'hearth':
        return new HearthView(this.kit, b, this.acquireLight(b.id));
      case 'workshop':
        return new WorkshopView(this.kit, b);
      case 'drumcircle':
        return new DrumCircleView(this.kit, b);
      case 'ward':
        return new WardView(this.kit, b);
      case 'druglab':
        return new DrugLabView(this.kit, b);
    }
  }

  private acquireLight(id: EntityId): THREE.PointLight | null {
    for (const l of this.lights) {
      let used = false;
      for (const owned of this.lightOwner.values()) if (owned === l) used = true;
      if (used) continue;
      this.lightOwner.set(id, l);
      return l;
    }
    return null;
  }

  private releaseLight(id: EntityId): void {
    const l = this.lightOwner.get(id);
    if (!l) return;
    l.intensity = 0;
    l.position.set(0, -50, 0);
    this.lightOwner.delete(id);
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.pieces.dispose();
    this.ghosts.dispose();
    for (const l of this.lights) this.ctx.scene.remove(l);
    this.ctx.scene.remove(this.smoke.mesh, this.sparks.mesh);
    this.smoke.dispose();
    this.sparks.dispose();
    this.table.dispose();
    this.kit.dispose();
    if (this.ctx.shared.gccTableTexture === this.table.texture) this.ctx.shared.gccTableTexture = undefined;
  }
}
