/** Snapshot-driven boss audio shared by solo and network clients. Never mutates the sim. */
import { BOSS_TIMING, type BossState } from '../sim/boss';
import type { V2 } from '../sim/math';
import type { AudioEngine, VoiceHandle } from './engine';
import { BOSS_CUE_DURATION, synthBoss, type BossCue } from './bossSynth';
export interface BossAudioSink { play(cue: BossCue, at: V2, age?: number): void; cancel(chargeOnly?: boolean): void; }
type Seen = { id: number; deathAt: number | null; chargeAt: number | null; firedAt: number | null;
  action: BossState['action']; actionAt: number; stride: number; now: number };
const FRESH = .35;
/** World-space cycle lengths shared with the approved standing/native crouch animations. */
export const BOSS_AUDIO_STRIDE = { walk: 7.8 * .625, crouchWalk: 6 * .625 };
// Measured native crouch toe/heel landings: left at seam, right at source frame 31/60.
export const BOSS_AUDIO_CONTACTS = { walk: [0, .5], crouchWalk: [0, 31 / 60] } as const;
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
      action: b.action, actionAt: b.actionAt, stride: b.stride, now });
    // An initial/full snapshot or clock jump only seeds the watcher. No historical roars,
    // impacts, footsteps or shots on late join, tab resumption, reconnect or replay seek.
    if (first || prev && (prev.id !== b.id || now < prev.now || now - prev.now > .75)) {
      this.sink.cancel(); this.seen = snapshot(); return;
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
    } else if (b.eye.chargeAt !== null && b.eye.chargeAt !== prev?.chargeAt && b.eye.firedAt === null && fresh(b.eye.chargeAt)) {
      this.sink.play('charge', b.pos, now - b.eye.chargeAt);
    }
    if (prev && (b.action === 'walk' || b.action === 'crouchWalk') && prev.action === b.action && b.stride >= prev.stride) {
      const cycle = BOSS_AUDIO_STRIDE[b.action];
      if (BOSS_AUDIO_CONTACTS[b.action].some(phase => Math.floor((b.stride + 1e-7) / cycle - phase) >
        Math.floor((prev.stride + 1e-7) / cycle - phase))) this.sink.play('step', b.pos);
    }
    const stompAt = b.actionAt + BOSS_TIMING.stompHit;
    if (prev && b.action === 'stomp' && prev.now < stompAt && fresh(stompAt)) this.sink.play('stomp', b.pos);
    this.seen = snapshot();
  }
}

/** All voices use the engine's spatial SFX bus, master volume, limiter and voice budget. */
export class BossAudio implements BossAudioSink {
  readonly tracker = new BossAudioTracker(this);
  private voices: { cue: BossCue; voice: VoiceHandle; end: number }[] = [];
  constructor(private readonly engine: AudioEngine) {}
  play(cue: BossCue, at: V2, age = 0): void {
    const e = this.engine, dur = Math.max(.02, BOSS_CUE_DURATION[cue] - age);
    this.voices = this.voices.filter(v => v.end > e.ctx.currentTime);
    const voice = e.voice({ key: `boss-${cue}`, bus: 'sfx', at, range: cue === 'step' ? 3 : 6,
      gain: cue === 'charge' ? .65 : .85, dur, wet: cue === 'beam' ? .09 : .2, priority: cue === 'step' ? 2 : 3 });
    if (!voice) return;
    synthBoss(e.ctx, voice.input, e.pink, e.white, cue, voice.t, age);
    this.voices.push({ cue, voice, end: voice.t + dur + .1 });
  }
  cancel(chargeOnly = false): void {
    const t = this.engine.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (v.end <= t) return false;
      if (chargeOnly && v.cue !== 'charge') return true;
      // Fading the voice input cancels dry and reverb send together, without clicks.
      v.voice.input.gain.cancelScheduledValues(t);
      v.voice.input.gain.setTargetAtTime(0, t, .012);
      return false;
    });
  }
}
