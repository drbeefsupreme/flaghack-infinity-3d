/**
 * Procedural WebAudio (no asset files): festival soundscape, generative pentatonic music with
 * tension layers, positional event SFX (plant chimes, pulls, throws, swings, ley hums,
 * crystal choir, phason glass glitches, discharges, capture alarms, Burn fireworks, UI blips).
 * Owner: Audio agent.
 *
 * The AudioContext is created on the first user gesture (pointer/key) or by App.startMatch.
 * Per frame: listener = camera, bus volumes from Session settings, the Soundscape is measured
 * around the listener (5 Hz) and smoothed, music + ambience follow it, finished voices free.
 */
import type { AppApi } from '../game/app';
import type { GameEvent } from '../sim/events';
import type { World } from '../sim/world';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import { Music } from './music';
import { Sfx, type Perspective } from './sfx';
import { approach, createSoundscape, measure, type Soundscape } from './soundscape';

const MEASURE_INTERVAL = 0.2;
const ALARM_INTERVAL = 4;

export interface AudioStats {
  state: AudioContextState | 'locked';
  sampleRate: number;
  baseLatency: number;
  outputLatency: number;
  activeVoices: number;
  maxVoices: number;
  trackedGroups: number;
  started: number;
  rateDropped: number;
  stolen: number;
  capDropped: number;
  inaudible: number;
  /** Main-thread cost of audio per frame (ms, smoothed). */
  jsMs: number;
  soundscape: Soundscape;
}

interface Parts {
  engine: AudioEngine;
  sfx: Sfx;
  music: Music;
  ambience: Ambience;
}

export class GameAudio {
  private app: AppApi;
  private parts: Parts | null = null;
  private target = createSoundscape();
  private live = createSoundscape();
  private measureTimer = 0;
  private world: World | null = null;
  private perspective: Perspective = { me: -1, myAvatar: -1 };
  private alarmTimer = 0;
  private fireworkTimer = 0;
  /** Audio main-thread time accumulated this frame, and its smoothed average. */
  private jsMs = 0;
  private jsMsAvg = 0;

  constructor(app: AppApi) {
    this.app = app;
    const onGesture = (): void => {
      this.unlock();
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  /** Create/resume the AudioContext (must follow a user gesture). */
  unlock(): void {
    if (!this.parts) {
      const engine = new AudioEngine();
      this.parts = { engine, sfx: new Sfx(engine), music: new Music(engine), ambience: new Ambience(engine) };
    }
    const ctx = this.parts.engine.ctx;
    if (ctx.state !== 'running') void ctx.resume();
  }

  onEvents(events: GameEvent[]): void {
    const parts = this.parts;
    const w = this.app.world;
    if (!parts || !w || parts.engine.ctx.state !== 'running' || events.length === 0) return;
    const t0 = performance.now();
    this.syncWorld(w, parts);
    for (const e of events) parts.sfx.play(e, w, this.perspective);
    this.jsMs += performance.now() - t0;
  }

  update(dt: number): void {
    const parts = this.parts;
    if (!parts || parts.engine.ctx.state !== 'running') return;
    const t0 = performance.now();
    const { engine, music, ambience, sfx } = parts;
    const session = this.app.session;
    const title = session.screen === 'title';
    engine.setVolumes(session.settings, session.screen === 'paused', title ? 0.55 : 1);
    const cam = this.app.renderer.camera;
    engine.setListener(cam.position.x, cam.position.y, cam.position.z, cam.matrixWorld.elements);

    const w = this.app.world;
    if (w) {
      this.syncWorld(w, parts);
      this.measureTimer -= dt;
      if (this.measureTimer <= 0) {
        this.measureTimer = MEASURE_INTERVAL;
        const rctx = this.app.renderer.ctx;
        measure(w, session, engine, rctx ? rctx.daylight : null, this.target);
      }
      this.smooth(dt);
      music.update(this.live, dt);
      ambience.update(this.live, dt);

      const running = session.screen === 'playing';
      if (running && this.live.alarm) {
        this.alarmTimer -= dt;
        if (this.alarmTimer <= 0) {
          this.alarmTimer = ALARM_INTERVAL;
          sfx.alarm(0.4);
        }
      } else this.alarmTimer = ALARM_INTERVAL;

      if (w.suddenDeath && (running || title)) {
        this.fireworkTimer -= dt;
        if (this.fireworkTimer <= 0) {
          this.fireworkTimer = 0.5 + Math.random() * 1.6;
          const eff = w.map.effigy;
          const a = Math.random() * Math.PI * 2;
          const r = 10 + Math.random() * 45;
          sfx.firework({ x: eff.x + Math.cos(a) * r, z: eff.z + Math.sin(a) * r }, 0);
        }
      }
    }
    engine.prune();
    this.jsMs += performance.now() - t0;
    // Smoothed per-frame cost (events + update) for stats().
    this.jsMsAvg = this.jsMsAvg * 0.95 + this.jsMs * 0.05;
    this.jsMs = 0;
  }

  /** New match or back to title: per-match musical state resets, perspective follows the player. */
  private syncWorld(w: World, parts: Parts): void {
    const title = this.app.session.screen === 'title';
    if (w !== this.world) {
      this.world = w;
      parts.music.reset();
      this.measureTimer = 0;
      this.fireworkTimer = 2;
    }
    const me = this.app.session.playerFaction;
    const fs = w.factions[me];
    this.perspective.me = title ? -1 : me;
    this.perspective.myAvatar = title || !fs ? -1 : fs.avatarId;
  }

  private smooth(dt: number): void {
    const s = this.live;
    const g = this.target;
    s.mode = g.mode;
    s.alarm = g.alarm;
    s.tension = approach(s.tension, g.tension, 0.6, dt);
    s.night = approach(s.night, g.night, 0.4, dt);
    s.burn = approach(s.burn, g.burn, 0.5, dt);
    s.fest = approach(s.fest, g.fest, 2, dt);
    s.festPan = approach(s.festPan, g.festPan, 3, dt);
    s.drum = approach(s.drum, g.drum, 2, dt);
    s.drumPan = approach(s.drumPan, g.drumPan, 3, dt);
    s.flags = approach(s.flags, g.flags, 2, dt);
    s.crowd = approach(s.crowd, g.crowd, 1, dt);
    s.fire = approach(s.fire, g.fire, 0.5, dt);
    s.firePan = approach(s.firePan, g.firePan, 3, dt);
  }

  /** Engine diagnostics for the debug overlay / perf evals. */
  stats(): AudioStats {
    const p = this.parts;
    const ctx = p?.engine.ctx;
    return {
      state: ctx ? ctx.state : 'locked',
      sampleRate: ctx ? ctx.sampleRate : 0,
      baseLatency: ctx ? ctx.baseLatency : 0,
      outputLatency: ctx ? ctx.outputLatency : 0,
      activeVoices: p ? p.engine.activeVoices : 0,
      maxVoices: p ? p.engine.maxVoices : 0,
      trackedGroups: p ? p.engine.trackedCount : 0,
      started: p ? p.engine.stats.started : 0,
      rateDropped: p ? p.engine.stats.rateDropped : 0,
      stolen: p ? p.engine.stats.stolen : 0,
      capDropped: p ? p.engine.stats.capDropped : 0,
      inaudible: p ? p.engine.stats.inaudible : 0,
      jsMs: this.jsMsAvg,
      soundscape: { ...this.live },
    };
  }

  // ── UI blips (for ui/*) ────────────────────────────────────────────────────
  uiHover(): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiHover();
  }

  uiClick(): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiClick();
  }

  uiConfirm(): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiConfirm();
  }

  uiBack(): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiBack();
  }

  uiToggle(on: boolean): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiToggle(on);
  }

  uiError(): void {
    if (this.parts?.engine.ctx.state === 'running') this.parts.sfx.uiError();
  }
}
