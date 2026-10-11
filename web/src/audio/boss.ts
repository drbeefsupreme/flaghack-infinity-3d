/** Boss audio from durable eye/lifecycle state and authoritative impact events. Never mutates the sim. */
import type { BossState } from '../sim/boss';
import type { GameEvent } from '../sim/events';
import type { V2 } from '../sim/math';
import type { AudioEngine, VoiceHandle } from './engine';
import { BOSS_CUE_DURATION, synthBoss, type BossCue } from './bossSynth';
export interface BossAudioSink { play(cue: BossCue, at: V2, age?: number): void; cancel(chargeOnly?: boolean): void; }
type Seen = { id: number; deathAt: number | null; chargeAt: number | null; firedAt: number | null;
  now: number };
const FRESH = .35;
export class BossAudioTracker {
  private seen: Seen | null = null;
  private initialized = false;
  constructor(private readonly sink: BossAudioSink) {}
  reset(): void { this.sink.cancel(); this.seen = null; this.initialized = false; }
  update(b: BossState | null, now: number): void {
    const prev = this.seen;
    const first = !this.initialized;
    this.initialized = true;
    if (!b) { if (prev) this.sink.cancel(); this.seen = null; return; }
    const snapshot = (): Seen => ({ id: b.id, deathAt: b.deathAt, chargeAt: b.eye.chargeAt, firedAt: b.eye.firedAt,
      now });
    // An initial/full snapshot or clock jump only seeds the watcher. No historical roars,
    // impacts, footsteps or shots on late join, tab resumption, reconnect or replay seek.
    if (first || prev && (prev.id !== b.id || now < prev.now || now - prev.now > .75)) {
      if (!first) this.sink.cancel(); this.seen = snapshot(); return;
    }
    const fresh = (at: number): boolean => now >= at && now - at <= FRESH;
    if (!prev && b.action === 'emerge' && fresh(b.spawnedAt)) this.sink.play('emerge', b.pos);
    if (b.hp <= 0 || b.deathAt !== null || b.action === 'dead') {
      if (prev && prev.deathAt === null && b.deathAt !== null) {
        this.sink.cancel(); if (fresh(b.deathAt)) this.sink.play('death', b.pos);
      } else this.sink.cancel(true);
      this.seen = snapshot(); return;
    }
    if (b.eye.chargeAt !== prev?.chargeAt || b.eye.firedAt !== null) this.sink.cancel(true);
    if (b.eye.firedAt !== null && b.eye.firedAt !== prev?.firedAt && fresh(b.eye.firedAt)) {
      this.sink.play('beam', b.eye.origin ?? b.pos, now - b.eye.firedAt);
      if (b.eye.impact) this.sink.play('impact', b.eye.impact);
    } else if (b.eye.chargeAt !== null && b.eye.chargeAt !== prev?.chargeAt && b.eye.firedAt === null && fresh(b.eye.chargeAt)) {
      this.sink.play('charge', b.pos, now - b.eye.chargeAt);
    }
    this.seen = snapshot();
  }
}

/** Arena-wide directional boss bus; still obeys SFX/master controls, limiter and voice budget. */
export class BossAudio implements BossAudioSink {
  readonly tracker = new BossAudioTracker(this);
  private voices: { cue: BossCue; voice: VoiceHandle; end: number; releaseDuck: () => void }[] = [];
  private lastCrushAt = -Infinity;
  constructor(private readonly engine: AudioEngine) {}
  /** Only fresh host events reach this path; full snapshots never replay footfalls or rubble. */
  onEvents(events: readonly GameEvent[]): void {
    const crushed: { pos: V2; count: number }[] = [];
    for (const event of events) {
      if (event.t === 'bossFootfall') this.play(event.heavy ? 'stomp' : 'step', event.pos);
      else if (event.t === 'sceneryCrushed') crushed.push(event);
    }
    if (crushed.length) this.sceneryCrushed(crushed);
  }
  /** Coalesce a host destruction batch, plus adjacent-frame bursts, into one rubble voice. */
  sceneryCrushed(events: readonly { pos: V2; count: number }[]): void {
    const now = this.engine.ctx.currentTime;
    if (now - this.lastCrushAt < .2) return;
    let x = 0, z = 0, count = 0;
    for (const event of events) if (event.count > 0 && Number.isFinite(event.count) &&
      Number.isFinite(event.pos.x) && Number.isFinite(event.pos.z)) {
      count += event.count; x += event.pos.x * event.count; z += event.pos.z * event.count;
    }
    if (!count) return;
    this.lastCrushAt = now;
    this.play('crush', { x: x / count, z: z / count });
  }
  play(cue: BossCue, at: V2, age = 0): void {
    const e = this.engine, dur = Math.max(.02, BOSS_CUE_DURATION[cue] - age);
    this.voices = this.voices.filter(v => v.end > e.ctx.currentTime);
    const voice = e.voice({ key: `boss-${cue}`, bus: 'boss', at, directionalOnly: true,
      gain: cue === 'charge' ? .65 : cue === 'crush' ? .7 : .85, dur, wet: cue === 'beam' ? .09 : .2, priority: 3 });
    if (!voice) return;
    synthBoss(e.ctx, voice.input, e.pink, e.white, cue, voice.t, age);
    const amount = cue === 'step' ? .65 : cue === 'charge' ? .78 : .93;
    const hold = cue === 'step' ? .7 : cue === 'stomp' ? 1.3 : dur;
    const releaseDuck = e.duckForBoss(amount, hold);
    this.voices.push({ cue, voice, end: voice.t + dur + .1, releaseDuck });
  }
  cancel(chargeOnly = false): void {
    if (!chargeOnly) this.lastCrushAt = -Infinity;
    const t = this.engine.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (v.end <= t) return false;
      if (chargeOnly && v.cue !== 'charge') return true;
      // Fading the voice input cancels dry and reverb send together, without clicks.
      v.releaseDuck();
      v.voice.input.gain.cancelScheduledValues(t);
      v.voice.input.gain.setTargetAtTime(0, t, .012);
      return false;
    });
  }
}
