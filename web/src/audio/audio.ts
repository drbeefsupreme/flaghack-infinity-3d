/**
 * Procedural WebAudio (no asset files): festival soundscape, generative pentatonic music with
 * tension layers, positional event SFX (plant chimes, pulls, throws, swings, ley hums,
 * crystal choir, phason glass glitches, discharges, capture alarms, Burn fireworks, UI blips).
 * Owner: Audio agent.
 */
import type { AppApi } from '../game/app';
import type { GameEvent } from '../sim/events';

export class GameAudio {
  private app: AppApi;
  private ctx: AudioContext | null = null;

  constructor(app: AppApi) {
    this.app = app;
  }

  /** Create/resume the AudioContext (must follow a user gesture). */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    void this.ctx.resume();
  }

  onEvents(events: GameEvent[]): void {}

  update(dt: number): void {}
}
