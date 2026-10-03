/**
 * The Vexillosaint's voice: procedural babble transmitted from the Geomantic Command Center.
 * One utterance = one buzzing glottal source through two moving vowel formants, a warm body
 * path and a consonant noise path, all driven by automation (no per-syllable nodes). The text
 * shapes the sound: syllables follow the visible characters at the typewriter's rate, each
 * syllable's vowel and onset come from its letters, and pitch walks A minor pentatonic with a
 * sentence contour (declination, rise on '?', fall on '.', lift on '!' and capitalised lore
 * words). The same line always sounds the same: every variation is hashed from the text.
 */
import type { AudioEngine } from './engine';
import { degreeHz } from './scale';

/** Default typewriter rate the mentor UI reveals text at (visible characters per second). */
export const MENTOR_CHARS_PER_SEC = 36;

/** Average visible characters per syllable. */
const CHARS_PER_SYLLABLE = 2.5;
/** Centre pitch: pentatonic degree 6 = C3 (low and warm). */
const BASE_DEGREE = 6;

type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
/** First two formants (Hz) per vowel; F2 is mixed low so the voice stays soft. */
const FORMANTS: Record<Vowel, readonly [number, number]> = {
  a: [700, 1150],
  e: [480, 1900],
  i: [320, 2200],
  o: [480, 850],
  u: [340, 780],
};
const VOWEL_OF: Record<string, Vowel> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' };

/** Onset noise per consonant class: peak and length (s). */
const ONSET: Record<string, readonly [number, number]> = {
  s: [0.22, 0.05],
  z: [0.16, 0.045],
  c: [0.18, 0.04],
  x: [0.18, 0.045],
  f: [0.1, 0.035],
  h: [0.07, 0.035],
  v: [0.08, 0.03],
  t: [0.16, 0.012],
  k: [0.14, 0.014],
  p: [0.12, 0.01],
  d: [0.09, 0.01],
  b: [0.07, 0.01],
  g: [0.09, 0.012],
  q: [0.14, 0.014],
  j: [0.12, 0.03],
};

interface Syllable {
  /** Start (s) from the utterance start. */
  at: number;
  dur: number;
  vowel: Vowel;
  onset: string;
  /** Pentatonic degree at the start and the end of the syllable. */
  deg: number;
  deg2: number;
  accent: number;
}

/** Visible text: markup tags and emphasis marks removed, whitespace collapsed. */
export function visibleText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const WORD = /[\p{L}\p{N}']+/gu;

/** Lay the syllables of `vis` on the typewriter timeline and give each its pitch. */
function syllabify(vis: string, cps: number): Syllable[] {
  const out: Syllable[] = [];
  const charT = 1 / cps;
  // Sentences end at . ? ! (or the end of the text); each gets its own contour.
  const sentence = /[^.?!]+[.?!]*/g;
  for (let m = sentence.exec(vis); m; m = sentence.exec(vis)) {
    const body = m[0];
    const start = m.index;
    const end = body.trimEnd().slice(-1);
    const first = out.length;
    for (let w = WORD.exec(body); w; w = WORD.exec(body)) {
      const word = w[0];
      const n = Math.max(1, Math.round(word.length / CHARS_PER_SYLLABLE));
      const lore = word.length > 2 && word[0] !== word[0].toLowerCase();
      for (let k = 0; k < n; k++) {
        const a = Math.floor((k * word.length) / n);
        const b = Math.floor(((k + 1) * word.length) / n);
        const chunk = word.slice(a, b).toLowerCase();
        let vowel: Vowel = 'a';
        for (const ch of chunk) {
          const v = VOWEL_OF[ch];
          if (v) {
            vowel = v;
            break;
          }
        }
        const onset = ONSET[chunk[0]] ? chunk[0] : '';
        out.push({
          at: (start + w.index + a) * charT,
          dur: (b - a) * charT * 0.85,
          vowel,
          onset,
          deg: 0,
          deg2: 0,
          accent: k === 0 && (n > 1 || lore) ? (lore ? 1.25 : 1.1) : 1,
        });
      }
    }
    // Contour: gentle declination across the sentence, hashed jitter, stressed word starts.
    const count = out.length - first;
    for (let i = first; i < out.length; i++) {
      const s = out[i];
      const p = count > 1 ? (i - first) / (count - 1) : 0;
      const jitter = Math.floor(hash(body, i - first) * 3) - 1;
      s.deg = BASE_DEGREE + Math.round(1 - 2 * p) + jitter + (s.accent > 1.2 ? 1 : 0);
      s.deg2 = s.deg;
    }
    if (count > 0) {
      const last = out[out.length - 1];
      if (end === '?') {
        last.deg2 = last.deg + 3;
        last.dur *= 1.4;
      } else if (end === '!') {
        last.deg += 2;
        last.deg2 = last.deg - 1;
        last.accent = Math.max(last.accent, 1.25);
      } else {
        last.deg2 = last.deg - 2;
        last.dur *= 1.25;
      }
    }
  }
  return out;
}

interface Utterance {
  input: GainNode;
  sources: AudioScheduledSourceNode[];
}

export class MentorVoice {
  private e: AudioEngine;
  private current: Utterance | null = null;

  constructor(engine: AudioEngine) {
    this.e = engine;
  }

  /**
   * Speak `text` (markup ignored) in time with a typewriter revealing `cps` visible
   * characters per second. Replaces any line still being spoken. Returns the spoken length in
   * seconds (0 when the voice was rate-limited or the text has no words).
   */
  speak(text: string, cps: number): number {
    this.stop();
    const vis = visibleText(text);
    const syl = syllabify(vis, Math.max(1, cps));
    if (syl.length === 0) return 0;
    const last = syl[syl.length - 1];
    const len = last.at + last.dur;
    const v = this.e.voice({ key: 'mentor', dur: len + 0.4, gain: 0.85, wet: 0.22, priority: 2, bus: 'ui' });
    if (!v) return 0;
    const c = this.e.ctx;
    const t0 = v.t;
    const end = t0 + len + 0.3;

    // Transmission colour: a gentle highpass keeps the low voice clear of the festival bass.
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 95;
    hp.connect(v.input);

    const glottis = c.createOscillator();
    glottis.type = 'sawtooth';
    glottis.frequency.value = degreeHz(syl[0].deg);
    const vib = c.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = c.createGain();
    vibDepth.gain.value = 9;
    vib.connect(vibDepth).connect(glottis.detune);

    const vca = c.createGain();
    vca.gain.value = 0;
    vca.connect(hp);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 7;
    const f2Gain = c.createGain();
    f2Gain.gain.value = 0.35;
    const body = c.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 700;
    const bodyGain = c.createGain();
    bodyGain.gain.value = 0.25;
    glottis.connect(f1).connect(vca);
    glottis.connect(f2).connect(f2Gain).connect(vca);
    glottis.connect(body).connect(bodyGain).connect(vca);

    const hiss = c.createBufferSource();
    hiss.buffer = this.e.white;
    hiss.loop = true;
    const hissHP = c.createBiquadFilter();
    hissHP.type = 'highpass';
    hissHP.frequency.value = 3200;
    const hissGain = c.createGain();
    hissGain.gain.value = 0;
    hiss.connect(hissHP).connect(hissGain).connect(hp);

    const [a0f1, a0f2] = FORMANTS[syl[0].vowel];
    f1.frequency.value = a0f1;
    f2.frequency.value = a0f2;
    for (const s of syl) {
      const t = t0 + s.at;
      let voiced = t;
      const on = ONSET[s.onset];
      if (on) {
        hissGain.gain.setTargetAtTime(on[0], t, 0.003);
        hissGain.gain.setTargetAtTime(0, t + on[1], 0.008);
        voiced = t + Math.min(on[1], s.dur * 0.35);
      }
      const [ff1, ff2] = FORMANTS[s.vowel];
      f1.frequency.setTargetAtTime(ff1, voiced, 0.02);
      f2.frequency.setTargetAtTime(ff2, voiced, 0.025);
      const fA = degreeHz(s.deg);
      glottis.frequency.setTargetAtTime(fA, voiced, 0.018);
      if (s.deg2 !== s.deg) glottis.frequency.setTargetAtTime(degreeHz(s.deg2), voiced + s.dur * 0.3, s.dur * 0.3);
      vca.gain.setTargetAtTime(0.42 * s.accent, voiced, 0.012);
      vca.gain.setTargetAtTime(0, t + s.dur * 0.8, 0.02);
    }

    for (const src of [glottis, vib, hiss]) {
      src.start(t0);
      src.stop(end);
    }
    this.e.duck(0.18, len);
    this.current = { input: v.input, sources: [glottis, vib, hiss] };
    return len;
  }

  /** Cut the line short with a quick fade (skipped dialogue, lesson change). */
  stop(): void {
    const u = this.current;
    if (!u) return;
    this.current = null;
    const t = this.e.ctx.currentTime;
    u.input.gain.cancelScheduledValues(t);
    u.input.gain.setTargetAtTime(0, t, 0.03);
    // Re-calling stop() on a started source just moves its stop time (it never throws).
    for (const s of u.sources) s.stop(t + 0.15);
    this.e.duck(0, 0);
  }
}
