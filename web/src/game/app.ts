/**
 * App: owns the lifecycle (title attract match → player match → end), the fixed-step loop,
 * and fans GameEvents out to render, ui and audio.
 */
import { createAi, type AiController } from '../ai';
import { GameAudio } from '../audio/audio';
import { GameRenderer } from '../render/renderer';
import type { Command } from '../sim/commands';
import { SIM_DT } from '../sim/constants';
import type { GameEvent } from '../sim/events';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { FACTION_IDS } from '../sim/types';
import type { FactionId, MatchOptions } from '../sim/types';
import type { World } from '../sim/world';
import { GameUI } from '../ui/ui';
import { Controls } from './controls';
import { Session } from './session';

/** The surface UI, controls and audio use to drive the app. */
export interface AppApi {
  readonly session: Session;
  readonly world: World | null;
  readonly sim: Simulation | null;
  readonly fps: number;
  startMatch(opts?: Partial<MatchOptions>): void;
  readonly renderer: GameRenderer;
  /** Procedural audio; the UI calls its blips (uiClick, uiHover, uiConfirm, uiBack, uiToggle). */
  readonly audio: GameAudio;
  quitToTitle(): void;
  setPaused(paused: boolean): void;
  submit(cmd: Command): void;
}

const MAX_STEPS_PER_FRAME = 6;

export class App implements AppApi {
  readonly session = new Session();
  world: World | null = null;
  sim: Simulation | null = null;
  fps = 60;
  readonly renderer: GameRenderer;
  readonly controls: Controls;
  readonly ui: GameUI;
  readonly audio: GameAudio;
  private ai: AiController | null = null;
  private acc = 0;
  private last = performance.now();
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(root: HTMLElement) {
    const canvas = root.querySelector('canvas#game') as HTMLCanvasElement;
    const uiRoot = root.querySelector('#ui') as HTMLElement;
    this.renderer = new GameRenderer(canvas);
    this.controls = new Controls(this, canvas);
    this.ui = new GameUI(uiRoot, this);
    this.audio = new GameAudio(this);
    // Stage lights, dancers and DJ Scarecrow's headphones pulse on the music's audible kick.
    this.renderer.beatSource = () => this.audio.beat();
    this.startAttract();
    requestAnimationFrame(this.frame);
  }

  /** Title screen: an all-AI burn plays out behind the menu. */
  private startAttract(): void {
    this.load({ seed: `attract-${Math.floor(Math.random() * 1e6)}`, difficulty: 'normal', allAi: true });
    this.session.screen = 'title';
  }

  startMatch(opts: Partial<MatchOptions> = {}): void {
    const seed = opts.seed ?? `burn-${Date.now().toString(36)}`;
    this.load({ seed, difficulty: opts.difficulty ?? this.session.settings.difficulty, allAi: false });
    this.session.screen = 'playing';
    this.session.view = 'action';
    this.session.viewBlend = 0;
    this.session.selection.clear();
    this.session.feed = [];
    this.audio.unlock();
  }

  quitToTitle(): void {
    this.startAttract();
  }

  setPaused(paused: boolean): void {
    if (this.session.screen === 'playing' && paused) this.session.screen = 'paused';
    else if (this.session.screen === 'paused' && !paused) this.session.screen = 'playing';
  }

  submit(cmd: Command): void {
    this.world?.submit(cmd);
  }

  /**
   * Debug/eval fast-forward: run AI + simulation for `seconds` of game time synchronously.
   * Events produced meanwhile are discarded (presentation would otherwise replay minutes of
   * one-shot effects at once).
   */
  fastForward(seconds: number): void {
    if (!this.sim || !this.world) return;
    const steps = Math.round(seconds / SIM_DT);
    for (let i = 0; i < steps && this.world.phase === 'playing'; i++) {
      this.ai?.update();
      this.sim.step();
      if ((i & 255) === 255) this.world.drainEvents();
    }
    this.world.drainEvents();
  }

  private load(options: MatchOptions): void {
    const world = createMatch(options);
    this.world = world;
    this.sim = new Simulation(world);
    const aiFactions: FactionId[] = FACTION_IDS.filter((f) => options.allAi || f !== this.session.playerFaction);
    this.ai = createAi(world, aiFactions);
    this.renderer.attach(world, this.session);
    this.acc = 0;
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.controls.update(dt);
    const running = this.session.screen === 'playing' || this.session.screen === 'title';
    if (running && this.sim && this.world) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.controls.tick();
        this.ai?.update();
        this.sim.step();
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    }
    let events: GameEvent[] = [];
    if (this.world) events = this.world.drainEvents();
    if (this.world && this.world.phase === 'ended' && this.session.screen === 'playing') this.session.screen = 'ended';
    this.renderer.onEvents(events);
    this.ui.onEvents(events);
    this.audio.onEvents(events);
    this.renderer.render(dt);
    this.ui.update(dt);
    this.audio.update(dt);
  };
}
