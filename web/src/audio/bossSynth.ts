/** Original procedural boss voices; no downloaded samples or third-party audio assets. */
import { noise, tone } from './synth';
export type BossCue = 'emerge' | 'death' | 'step' | 'stomp' | 'charge' | 'beam' | 'impact' | 'crush';
export const BOSS_CUE_DURATION: Record<BossCue, number> = { emerge: 4.3, death: 6.2, step: 1.25, stomp: 1.8, charge: 3, beam: .5, impact: 1.8, crush: 1.3 };

/** Schedule into a caller-owned, cancellable SFX voice. Supports OfflineAudioContext for QA. */
export function synthBoss(ctx: BaseAudioContext, out: AudioNode, pink: AudioBuffer, white: AudioBuffer,
  cue: BossCue, t: number, age = 0): void {
  if (cue === 'emerge' || cue === 'death') {
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
    const remaining = Math.max(.02, .5 - age);
    tone(ctx, out, t, { type: 'sawtooth', f: 1150, f2: 85, glide: remaining,
      env: { a: .003, d: remaining - .003, peak: .13 } });
    tone(ctx, out, t, { f: 120, f2: 58, glide: remaining, env: { a: .005, d: remaining - .005, peak: .40, curve: 'linear' } });
    noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 2400, f2: 220, sweep: remaining, q: .65,
      env: { a: .003, h: remaining * .35, d: remaining * .65 - .003, peak: .26 } });
  }
}
