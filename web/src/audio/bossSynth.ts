/** Original procedural boss voices; no downloaded samples or third-party audio assets. */
import { noise, tone } from './synth';
export type BossCue = 'emerge' | 'death' | 'step' | 'stomp' | 'charge' | 'beam';
export const BOSS_CUE_DURATION: Record<BossCue, number> = { emerge: 4.3, death: 6.2, step: 1.25, stomp: 1.8, charge: 3, beam: .5 };

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
        env: { a: dying ? .08 : .22, h: dying ? .3 : .65, d: duration - (dying ? .38 : .87), peak: .095 } });
    }
    tone(ctx, out, t, { f: dying ? 62 : 38, f2: dying ? 24 : 31, glide: duration - .1,
      env: { a: .12, h: .15, d: duration - .27, peak: .24 } });
    for (const [f, q, peak] of [[360, 3, .13], [790, 4, .08]]) {
      noise(ctx, out, t, { buf: pink, filter: 'bandpass', f, f2: dying ? f * .4 : f * 1.3, q,
        sweep: duration - .2, env: { a: .18, h: .3, d: duration - .48, peak } });
    }
    noise(ctx, out, t, { buf: white, filter: 'lowpass', f: dying ? 1800 : 950, f2: 120,
      sweep: duration, env: { a: .06, d: duration - .06, peak: .10 } });
  } else if (cue === 'step' || cue === 'stomp') {
    const heavy = cue === 'stomp', dur = BOSS_CUE_DURATION[cue];
    tone(ctx, out, t, { f: heavy ? 78 : 64, f2: 27, glide: .32, env: { a: .006, d: dur, peak: .38 } });
    tone(ctx, out, t + .018, { f: 115, f2: 42, glide: .12, env: { a: .002, d: .24, peak: .12 } });
    noise(ctx, out, t, { buf: pink, filter: 'lowpass', f: 480, f2: 65, sweep: dur,
      env: { a: .009, d: dur - .04, peak: heavy ? .5 : .34 } });
    noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 1100, q: .5,
      env: { a: .002, d: .11, peak: .11 } });
  } else if (cue === 'charge') {
    const remaining = Math.max(.02, 3 - age), progress = Math.min(1, age / 3);
    // Rising electrical whine and dark rumble; stop at the host's firing edge, never
    // pre-schedule a shot (the target may die or the attack may be cancelled).
    for (const [start, end, detune] of [[95, 610, -5], [142, 920, 6]]) {
      tone(ctx, out, t, { type: 'triangle', f: start * (end / start) ** progress, f2: end,
        glide: remaining, detune, vib: 15, vibRate: 18,
        env: { a: Math.max(.002, remaining - .025), d: Math.min(.025, remaining - .002), peak: .15 } });
    }
    noise(ctx, out, t, { buf: pink, filter: 'bandpass', f: 160 * 8 ** progress, f2: 1280,
      sweep: remaining, q: 2, env: { a: Math.max(.002, remaining - .025), d: Math.min(.025, remaining - .002), peak: .2 } });
  } else {
    const remaining = Math.max(.02, .5 - age);
    tone(ctx, out, t, { type: 'sawtooth', f: 1150, f2: 85, glide: remaining,
      env: { a: .003, d: remaining - .003, peak: .13 } });
    tone(ctx, out, t, { f: 105, f2: 32, glide: remaining, env: { a: .005, d: remaining - .005, peak: .34 } });
    noise(ctx, out, t, { buf: white, filter: 'bandpass', f: 2400, f2: 220, sweep: remaining, q: .65,
      env: { a: .003, h: remaining * .35, d: remaining * .65 - .003, peak: .26 } });
  }
}
