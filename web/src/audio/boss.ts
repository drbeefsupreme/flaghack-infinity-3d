/** Boss audio from durable eye/lifecycle state and authoritative impact events. Never mutates the sim. */
import { BOSS_EYE_TIMING, type BossState } from '../sim/boss';
import { bossAttackPhase } from '../sim/bossAttackPresentation';
import type { GameEvent } from '../sim/events';
import type { V2 } from '../sim/math';
import type { AudioEngine, VoiceHandle } from './engine';
import { BossSamples, type BossVocal } from './bossSamples';
import { BOSS_VOICE_MIX } from './bossMix';
import { BOSS_CUE_DURATION, synthBoss, isBossWindupCue, type BossCue, type BossWindupCue } from './bossSynth';
export interface BossAudioSink { play(cue: BossCue, at: V2, age?: number): void; cancel(chargeOnly?: boolean): void; vocal?(cue: BossVocal): void; stopVocals?(): void; stopBeam?(): void; stopWindup?(): void; updateBeam?(at: V2, age: number): void; }
type Seen = { id: number; deathAt: number | null; chargeAt: number | null; firedAt: number | null;
  now: number; hasImpact: boolean; actionSeq: number; actionAt: number; windup: BossWindupCue | null };
const FRESH = .35;
export class BossAudioTracker {
  private seen: Seen | null = null;
  private initialized = false;
  private lastImpactAt = -Infinity;
  private impactX = 0;
  private impactZ = 0;
  constructor(private readonly sink: BossAudioSink) {}
  reset(): void { this.sink.cancel(); this.seen = null; this.initialized = false; this.lastImpactAt = -Infinity; }
  private recordImpact(at: V2, now: number): void { this.lastImpactAt = now; this.impactX = at.x; this.impactZ = at.z; }
  update(b: BossState | null, now: number, allowAttacks = true): void {
    const prev = this.seen;
    const first = !this.initialized;
    this.initialized = true;
    if (!b) { if (prev) this.sink.cancel(); this.seen = null; return; }
    const phase = bossAttackPhase(b, now);
    const windup = phase && isBossWindupCue(phase.kind) ? phase.kind : null;
    const snapshot = (): Seen => ({ id: b.id, deathAt: b.deathAt, chargeAt: b.eye.chargeAt, firedAt: b.eye.firedAt,
      now, hasImpact: b.eye.impact !== null, actionSeq: b.actionSeq, actionAt: b.actionAt, windup });
    // An initial/full snapshot or clock jump only seeds the watcher. No historical roars,
    // impacts, footsteps or shots on late join, tab resumption, reconnect or replay seek.
    if (first || prev && (prev.id !== b.id || now < prev.now || now - prev.now > .75)) {
      if (!first) this.sink.cancel();
      // Resume only the active sustained beam; never replay old impact explosions.
      if (allowAttacks && b.hp > 0 && b.deathAt === null && b.eye.firedAt !== null && now >= b.eye.firedAt && now - b.eye.firedAt < BOSS_EYE_TIMING.beam)
        this.sink.play('beam', b.eye.origin ?? b.pos, now - b.eye.firedAt);
      if (b.eye.impact) this.recordImpact(b.eye.impact, now);
      this.seen = snapshot(); return;
    }
    const fresh = (at: number): boolean => now >= at && now - at <= FRESH;
    if (allowAttacks && !prev && b.action === 'emerge' && fresh(b.spawnedAt)) this.sink.play('emerge', b.pos);
    if (b.hp <= 0 || b.deathAt !== null || b.action === 'dead') {
      this.sink.stopBeam?.(); this.sink.stopWindup?.(); this.sink.stopVocals?.();
      if (prev && prev.deathAt === null && b.deathAt !== null) {
        this.sink.cancel(); if (fresh(b.deathAt)) this.sink.play('death', b.pos);
      } else if (b.eye.chargeAt !== prev?.chargeAt || b.eye.firedAt !== prev?.firedAt) this.sink.cancel(true);
      this.seen = snapshot(); return;
    }
    if (!allowAttacks) {
      this.sink.cancel(true); this.sink.stopBeam?.(); this.sink.stopWindup?.(); this.sink.stopVocals?.(); this.seen = snapshot(); return;
    }
    const newAction = !prev || prev.actionSeq !== b.actionSeq || prev.actionAt !== b.actionAt;
    if (prev?.windup && (newAction || prev.windup !== windup)) this.sink.stopWindup?.();
    // Only a freshly observed action starts a warning. Late joins/seek seed above;
    // repeated frames and full-snapshot object replacement cannot replay a one-shot.
    if (windup && fresh(b.actionAt) && (newAction || prev?.windup !== windup))
      this.sink.play(windup, b.pos, now - b.actionAt);
    // Shared simulation clock and boss ID produce identical sparse vocal slots for
    // every client. Crossing a slot is required: late joins never replay it.
    const start = b.spawnedAt + 24 + b.id % 9;
    const slot = Math.floor((now - start) / 32);
    const oldSlot = prev ? Math.floor((prev.now - start) / 32) : slot;
    if (slot >= 0 && slot > oldSlot && fresh(start + slot * 32) && b.action !== 'emerge' &&
      b.eye.chargeAt === null && b.eye.firedAt === null) this.sink.vocal?.(slot % 2 ? 'growl' : 'roar');
    if (b.eye.chargeAt !== prev?.chargeAt || b.eye.firedAt !== prev?.firedAt) this.sink.cancel(true);
    if (prev && prev.firedAt !== null && b.eye.firedAt !== prev.firedAt) this.sink.stopBeam?.();
    if (b.eye.firedAt !== null && b.eye.firedAt !== prev?.firedAt && now >= b.eye.firedAt && now - b.eye.firedAt < BOSS_EYE_TIMING.beam) {
      this.sink.play('beam', b.eye.origin ?? b.pos, now - b.eye.firedAt);
      if (b.eye.impact && fresh(b.eye.firedAt)) { this.sink.play('impact', b.eye.impact); this.recordImpact(b.eye.impact, now); }
    } else if (b.eye.chargeAt !== null && b.eye.chargeAt !== prev?.chargeAt && b.eye.firedAt === null && fresh(b.eye.chargeAt)) {
      this.sink.play('charge', b.pos, now - b.eye.chargeAt);
    }
    if (b.eye.firedAt !== null && now >= b.eye.firedAt && now - b.eye.firedAt < BOSS_EYE_TIMING.beam) {
      this.sink.updateBeam?.(b.eye.origin ?? b.pos, now - b.eye.firedAt);
      const impact = b.eye.impact;
      // A moving collision point enters a new patch of ground/target, not an explosion
      // on every fixed tick. At most one new impact voice per .6s during the sweep.
      if (impact && prev?.firedAt === b.eye.firedAt && now - this.lastImpactAt >= .6 &&
        (!prev.hasImpact || Math.hypot(impact.x - this.impactX, impact.z - this.impactZ) >= 6)) {
        this.sink.play('impact', impact); this.recordImpact(impact, now);
      }
    }
    else this.sink.stopBeam?.();
    this.seen = snapshot();
  }
}

/** Arena-wide directional boss bus; still obeys SFX/master controls, limiter and voice budget. */
export class BossAudio implements BossAudioSink {
  readonly tracker = new BossAudioTracker(this);
  private voices: { cue: BossCue; voice: VoiceHandle; end: number; releaseDuck: () => void }[] = [];
  private lastCrushAt = -Infinity;
  private readonly samples: Pick<BossSamples, 'get' | 'ready'>;
  private vocalVoice: { source: AudioBufferSourceNode; voice: VoiceHandle; end: number; releaseDuck: () => void } | null = null;
  private generation = 0;
  constructor(private readonly engine: AudioEngine, samples?: Pick<BossSamples, 'get' | 'ready'>) {
    this.samples = samples ?? new BossSamples(engine.ctx);
  }
  vocal(cue: BossVocal): void {
    const e = this.engine;
    if (this.vocalVoice && this.vocalVoice.end > e.ctx.currentTime) return;
    const buffer = this.samples.get(cue);
    if (!buffer) return;
    // No position or panner: equal signal level for everyone anywhere in the arena.
    // The foreground boss bus retains SFX/master, pause filtering and final limiter.
    const voice = e.voice({ key: `boss-${cue}`, bus: 'boss', gain: 1.3,
      dur: buffer.duration, wet: cue === 'emerge' ? .4 : .3, priority: 3 });
    if (!voice) return;
    const source = e.ctx.createBufferSource(); source.buffer = buffer;
    source.connect(voice.input); source.start(voice.t); source.stop(voice.t + buffer.duration);
    source.onended = () => { source.disconnect(); };
    this.vocalVoice = { source, voice, end: voice.t + buffer.duration,
      releaseDuck: e.duckForBoss(.25, Math.min(3, buffer.duration)) };
  }
  stopVocals(): void {
    this.generation++;
    const v = this.vocalVoice;
    if (!v) return;
    const t = this.engine.ctx.currentTime;
    v.releaseDuck(); v.voice.input.gain.cancelScheduledValues(t);
    v.voice.input.gain.setTargetAtTime(0, t, .012);
    v.source.stop(t + .06); this.vocalVoice = null;
  }
  /** Only fresh host events reach this path; full snapshots never replay footfalls or rubble. */
  onEvents(events: readonly GameEvent[]): void {
    let crushed: { pos: V2; count: number }[] | null = null;
    for (const event of events) {
      if (event.t === 'bossFootfall') this.play(event.heavy ? 'stomp' : 'step', event.pos);
      else if (event.t === 'sceneryCrushed') (crushed ??= []).push(event);
    }
    if (crushed) this.sceneryCrushed(crushed);
  }
  /** Coalesce a host destruction batch, plus adjacent-frame bursts, into one rubble voice. */
  sceneryCrushed(events: readonly { pos: V2; count: number }[]): void {
    const now = this.engine.ctx.currentTime;
    // A sustained sweep can erase props every host tick; represent that rubble as
    // one continuing texture burst, not dozens of overlapping synthesis graphs.
    const interval = this.voices.some(v => v.cue === 'beam' && v.end > now) ? .4 : .2;
    if (now - this.lastCrushAt < interval) return;
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
    if (cue === 'emerge') {
      if (this.samples.get('emerge')) this.vocal('emerge');
      else {
        const generation = this.generation, atTime = this.engine.ctx.currentTime;
        void this.samples.ready.then(() => {
          if (this.generation === generation && this.engine.ctx.currentTime - atTime < .35) this.vocal('emerge');
        });
      }
      return;
    }
    const e = this.engine, dur = Math.max(.02, BOSS_CUE_DURATION[cue] - age);
    this.voices = this.voices.filter(v => v.end > e.ctx.currentTime);
    const mix = BOSS_VOICE_MIX[cue];
    const voice = e.voice({ key: `boss-${cue}`, bus: 'boss', at, directionalOnly: true,
      gain: mix.gain, dur, wet: mix.wet, priority: 3 });
    if (!voice) return;
    synthBoss(e.ctx, voice.input, e.pink, e.white, cue, voice.t, age);
    // Support the impact/body rather than emptying the mix during a quiet tail.
    const releaseDuck = e.duckForBoss(mix.duckAmount, Math.min(mix.duckHold, dur));
    this.voices.push({ cue, voice, end: voice.t + dur + .1, releaseDuck });
  }
  updateBeam(at: V2, age: number): void {
    const active = this.voices.find(v => v.cue === 'beam' && v.end - .1 > this.engine.ctx.currentTime);
    if (active) active.voice.setPosition?.(at);
    else if (age < BOSS_EYE_TIMING.beam) this.play('beam', at, age);
  }
  stopBeam(): void {
    if (!this.voices.some(v => v.cue === 'beam')) return;
    const t = this.engine.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (v.cue !== 'beam') return true;
      v.releaseDuck(); v.voice.input.gain.cancelScheduledValues(t); v.voice.input.gain.setTargetAtTime(0, t, .012);
      return false;
    });
  }
  stopWindup(): void {
    if (!this.voices.some(v => isBossWindupCue(v.cue))) return;
    const t = this.engine.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (!isBossWindupCue(v.cue)) return true;
      v.releaseDuck(); v.voice.input.gain.cancelScheduledValues(t); v.voice.input.gain.setTargetAtTime(0, t, .012);
      return false;
    });
  }
  cancel(chargeOnly = false): void {
    if (!chargeOnly) { this.lastCrushAt = -Infinity; this.stopVocals(); }
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
