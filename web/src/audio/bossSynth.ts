/** Original procedural boss voices; no downloaded samples or third-party audio assets. */
import { noise, tone } from './synth';
import { BOSS_EYE_TIMING, BOSS_TIMING } from '../sim/boss';
export type BossWindupCue = 'swipeWindup' | 'stompWindup' | 'grabWindup';
export const isBossWindupCue = (cue: string | undefined): cue is BossWindupCue => cue === 'swipeWindup' || cue === 'stompWindup' || cue === 'grabWindup';
export type BossCue = BossWindupCue | 'emerge' | 'death' | 'step' | 'stomp' | 'charge' | 'beam' | 'impact' | 'crush';
export const BOSS_CUE_DURATION: Record<BossCue, number> = { swipeWindup: BOSS_TIMING.swipeHit, stompWindup: BOSS_TIMING.stompHit, grabWindup: BOSS_TIMING.grasp, emerge: 4.3, death: 6.2, step: 1.25, stomp: 1.8, charge: BOSS_EYE_TIMING.charge, beam: BOSS_EYE_TIMING.beam, impact: 1.8, crush: 1.3 };

/** Schedule into a caller-owned, cancellable SFX voice. Supports OfflineAudioContext for QA. */
export function synthBoss(ctx: BaseAudioContext, out: AudioNode, pink: AudioBuffer, white: AudioBuffer,
  cue: BossCue, t: number, age = 0): void {
  if (isBossWindupCue(cue)) {
    const duration = BOSS_CUE_DURATION[cue], remaining = Math.max(.02, duration - age);
    const progress = Math.min(1, age / duration), attack = Math.min(.035, remaining * .2);
    const release = Math.min(.045, remaining * .2), hold = Math.max(0, remaining - attack - release);
    const env = { a: attack, h: hold, d: release, peak: .11, curve: 'linear' as const };
    // A light hand rush, low planted-foot rumble, and descending wooden creak.
    // Each is one bounded warning graph, ending at the existing contact edge.
    if (cue === 'swipeWindup') {
      noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 420 * (1600 / 420) ** progress,
        f2: 1600, sweep: remaining, q: .7, env });
      tone(ctx, out, t, { type: 'triangle', f: 190 * (330 / 190) ** progress, f2: 330,
        glide: remaining, env: { ...env, peak: .06 } });
    } else if (cue === 'stompWindup') {
      tone(ctx, out, t, { f: 58 * (94 / 58) ** progress, f2: 94, glide: remaining, env: { ...env, peak: .16 } });
      tone(ctx, out, t, { type: 'triangle', f: 116 * (188 / 116) ** progress, f2: 188, glide: remaining, env: { ...env, peak: .07 } });
      noise(ctx, out, t, { buf: pink, filter: 'lowpass', f: 160 * (380 / 160) ** progress,
        f2: 380, sweep: remaining, env });
    } else {
      tone(ctx, out, t, { type: 'triangle', f: 210 * (95 / 210) ** progress, f2: 95,
        glide: remaining, vib: 11, vibRate: 9, env: { ...env, peak: .09 } });
      noise(ctx, out, t, { buf: pink, filter: 'bandpass', f: 720 * (220 / 720) ** progress,
        f2: 220, sweep: remaining, q: 2, env: { ...env, peak: .12 } });
    }
  } else if (cue === 'emerge' || cue === 'death') {
    const dying = cue === 'death', duration = BOSS_CUE_DURATION[cue];
    // A rough subharmonic throat, two resonant vowel bands and breath. Low-pass keeps
    // the saws' edge monstrous rather than buzzy; vibrato supplies a strained animal growl.
    const throat = ctx.createBiquadFilter(); throat.type = 'lowpass'; throat.Q.value = .7;
    throat.frequency.setValueAtTime(dying ? 1100 : 320, t);
    throat.frequency.exponentialRampToValueAtTime(dying ? 150 : 850, t + (dying ? 4.8 : .65));
    throat.connect(out);
    for (const [f, detune] of [[53, -11], [55, 9], [81, 4]]) {
      tone(ctx, throat, t, { type: 'sawtooth', f: dying ? f * 1.6 : f, f2: dying ? f * .43 : f * .82,
        glide: duration - .4, detune, vib: dying ? 90 : 52, vibRate: dying ? 7.2 : 4.3,
        env: { a: dying ? .08 : .22, h: dying ? .8 : 1.3, d: duration - (dying ? .88 : 1.52), peak: .10, curve: 'linear' } });
    }
    tone(ctx, out, t, { f: dying ? 80 : 54, f2: dying ? 40 : 42, glide: duration - .1,
      env: { a: .12, h: .35, d: duration - .47, peak: .18, curve: 'linear' } });
    // Audible bass body complements the deep sub, with harmonics that survive
    // smaller speakers. A real sustained body prevents long, mostly-silent ducked tails.
    tone(ctx, throat, t, { type: 'triangle', f: dying ? 120 : 94, f2: dying ? 62 : 72,
      glide: duration - .2, vib: 38, vibRate: 5.1, env: { a: .1, h: .8, d: duration - .9, peak: .19, curve: 'linear' } });
    for (const [f, q, peak] of [[360, 3, .13], [790, 4, .08]]) {
      noise(ctx, out, t, { buf: pink, filter: 'bandpass', f, f2: dying ? f * .4 : f * 1.3, q,
        sweep: duration - .2, env: { a: .18, h: .3, d: duration - .48, peak } });
    }
    noise(ctx, out, t, { buf: white, filter: 'lowpass', f: dying ? 1800 : 950, f2: 120,
      sweep: duration, env: { a: .06, d: duration - .06, peak: .10 } });
  } else if (cue === 'step' || cue === 'stomp') {
    const heavy = cue === 'stomp', dur = BOSS_CUE_DURATION[cue];
    tone(ctx, out, t, { f: heavy ? 96 : 90, f2: heavy ? 44 : 52, glide: .38, env: { a: .006, d: dur - .15, peak: .34, curve: 'linear' } });
    tone(ctx, out, t + .018, { type: 'triangle', f: 145, f2: 78, glide: .3, env: { a: .002, d: .50, peak: .18, curve: 'linear' } });
    noise(ctx, out, t, { buf: pink, filter: 'lowpass', f: 480, f2: 65, sweep: dur,
      env: { a: .009, d: dur - .04, peak: heavy ? .5 : .34 } });
    noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 1100, q: .5,
      env: { a: .002, d: .11, peak: .11 } });
  } else if (cue === 'impact') {
    // The electrical beam lives at the eye; this is a separate concussive explosion
    // at its actual collision point, with a chest hit and a rolling debris tail.
    tone(ctx, out, t, { f: 96, f2: 47, glide: .4, env: { a: .003, d: 1.45, peak: .32, curve: 'linear' } });
    tone(ctx, out, t, { type: 'triangle', f: 160, f2: 75, glide: .3,
      env: { a: .002, d: .65, peak: .20, curve: 'linear' } });
    noise(ctx, out, t, { buf: white, filter: 'lowpass', f: 3600, f2: 170, sweep: .8,
      env: { a: .002, d: 1.25, peak: .34 } });
    noise(ctx, out, t + .06, { buf: pink, filter: 'lowpass', f: 650, f2: 70, sweep: 1.5,
      env: { a: .015, d: 1.65, peak: .30 } });
  } else if (cue === 'crush') {
    // Staggered timber/mineral cracks over a crumbling mass. This is one bounded
    // group per destruction burst, never one full explosion per removed prop.
    tone(ctx, out, t, { type: 'triangle', f: 118, f2: 58, glide: .3,
      env: { a: .004, d: .7, peak: .27, curve: 'linear' } });
    tone(ctx, out, t, { f: 68, f2: 43, glide: .45, env: { a: .007, d: 1.05, peak: .18, curve: 'linear' } });
    noise(ctx, out, t, { buf: pink, filter: 'lowpass', f: 950, f2: 130, sweep: 1.1,
      env: { a: .009, d: 1.22, peak: .23 } });
    for (const [offset, f, peak] of [[0, 2400, .14], [.065, 1700, .11], [.17, 2900, .09], [.31, 1100, .08], [.53, 900, .05]]) {
      noise(ctx, out, t + offset, { buf: white, filter: 'bandpass', f, f2: f * .45,
        sweep: .13, q: .8, env: { a: .001, d: .16, peak } });
    }
  } else if (cue === 'charge') {
    const remaining = Math.max(.02, 3 - age), progress = Math.min(1, age / 3);
    // Rising electrical whine and dark rumble; stop at the host's firing edge, never
    // pre-schedule a shot (the target may die or the attack may be cancelled).
    for (const [start, end, detune] of [[95, 610, -5], [142, 920, 6]]) {
      tone(ctx, out, t, { type: 'triangle', f: start * (end / start) ** progress, f2: end,
        glide: remaining, detune, vib: 15, vibRate: 18,
        env: { a: Math.max(.002, remaining - .025), d: Math.min(.025, remaining - .002), peak: .10 } });
    }
    tone(ctx, out, t, { f: 65 * (125 / 65) ** progress, f2: 125, glide: remaining,
      env: { a: remaining * .12, h: remaining * .8, d: remaining * .08, peak: .23, curve: 'linear' } });
    noise(ctx, out, t, { buf: pink, filter: 'bandpass', f: 160 * 8 ** progress, f2: 1280,
      sweep: remaining, q: 2, env: { a: Math.max(.002, remaining - .025), d: Math.min(.025, remaining - .002), peak: .2 } });
  } else {
    const duration = BOSS_EYE_TIMING.beam, remaining = Math.max(.02, duration - age);
    const progress = Math.min(1, age / duration), attack = Math.min(.015, remaining * .2);
    const release = Math.min(.12, remaining * .2), hold = Math.max(0, remaining - attack - release);
    // One sustained beam graph for the entire sweep, not one blast per sim tick.
    // A bass engine and restrained electrical rasp hold their body until switch-off.
    tone(ctx, out, t, { type: 'sawtooth', f: 330 * (230 / 330) ** progress, f2: 230,
      glide: remaining, vib: 12, vibRate: 16,
      env: { a: attack, h: hold, d: release, peak: .10, curve: 'linear' } });
    tone(ctx, out, t, { f: 94 * (70 / 94) ** progress, f2: 70, glide: remaining,
      env: { a: attack, h: hold, d: release, peak: .30, curve: 'linear' } });
    noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 1500, f2: 700,
      sweep: remaining, q: .65, env: { a: attack, h: hold, d: release, peak: .10, curve: 'linear' } });
    // Startup crack is omitted when joining/resuming a beam that is already firing.
    if (age < .15) noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 2400, f2: 220,
      sweep: .25, q: .65, env: { a: .003, d: Math.min(.25, remaining - .003), peak: .20 } });
  }
}
