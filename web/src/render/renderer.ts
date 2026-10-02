/**
 * Render orchestrator: owns the WebGLRenderer, scene and camera, constructs every render
 * module for a World, fans out GameEvents, derives post-processing drive values, renders.
 * Camera placement is owned by game/controls (it writes ctx.camera each frame).
 */
import * as THREE from 'three';
import type { Session } from '../game/session';
import type { GameEvent } from '../sim/events';
import type { World } from '../sim/world';
import { ActorsRenderer } from './actors/actorsRenderer';
import type { PostFxState, RenderContext, RenderModule } from './context';
import { EnvRenderer } from './env/envRenderer';
import { PostFx } from './post/postfx';
import { StructuresRenderer } from './structures/structuresRenderer';
import { SurveyRenderer } from './survey/surveyRenderer';
import { VfxRenderer } from './vfx/vfxRenderer';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  ctx: RenderContext | null = null;
  private modules: RenderModule[] = [];
  private post: PostFx | null = null;
  private canvas: HTMLCanvasElement;
  private fx: PostFxState = { dust: 0, acid: 0, saffron: 0, crash: 0, damage: 0, command: 0, instability: 0, flash: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Build all modules for a world (call again for a new match; previous modules are disposed). */
  attach(world: World, session: Session): void {
    this.detach();
    const scene = new THREE.Scene();
    const ctx: RenderContext = {
      renderer: this.renderer,
      scene,
      camera: this.camera,
      world,
      session,
      quality: session.settings.quality,
      time: 0,
      sunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
      daylight: 1,
      shared: { fx: this.fx },
    };
    this.ctx = ctx;
    this.modules = [
      new EnvRenderer(ctx),
      new SurveyRenderer(ctx),
      new StructuresRenderer(ctx),
      new ActorsRenderer(ctx),
      new VfxRenderer(ctx),
    ];
    this.post = new PostFx(ctx);
    this.resize();
  }

  detach(): void {
    for (const m of this.modules) m.dispose();
    this.modules = [];
    this.post?.dispose();
    this.post = null;
    this.ctx = null;
  }

  onEvents(events: GameEvent[]): void {
    for (const e of events) {
      for (const m of this.modules) m.onEvent?.(e);
      if (this.ctx && (e.t === 'captured' || e.t === 'burn')) this.fx.flash = 1;
      if (this.ctx && e.t === 'hit') {
        const av = this.ctx.world.avatarOf(this.ctx.session.playerFaction);
        if (e.target === av.id) this.fx.damage = Math.min(1, this.fx.damage + e.amount / 60);
      }
    }
  }

  render(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.time += dt;
    this.updateFx(dt);
    for (const m of this.modules) m.update(dt);
    this.post?.render(dt);
  }

  private updateFx(dt: number): void {
    const ctx = this.ctx!;
    const w = ctx.world;
    const f = w.factions[ctx.session.playerFaction];
    const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * Math.min(1, dt * rate);
    this.fx.dust = ease(this.fx.dust, f.drugActive.dust > w.time ? 1 : 0, 2);
    this.fx.acid = ease(this.fx.acid, f.drugActive.acidcop > w.time ? 1 : 0, 2);
    this.fx.saffron = ease(this.fx.saffron, f.drugActive.saffron > w.time ? 1 : 0, 2);
    this.fx.crash = ease(this.fx.crash, f.saffronCrashUntil > w.time ? 1 : 0, 2);
    this.fx.command = ctx.session.viewBlend;
    this.fx.damage = Math.max(0, this.fx.damage - dt * 1.5);
    this.fx.flash = Math.max(0, this.fx.flash - dt * 0.8);
    const av = w.avatarOf(ctx.session.playerFaction);
    const facet = w.lattice.facetAt(av.pos.x, av.pos.z);
    this.fx.instability = ease(this.fx.instability, facet >= 0 ? w.survey.facetInstability[facet] : 0, 3);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
  }
}
