import { describe, expect, it } from 'vitest';
import { synthBoss, BOSS_CUE_DURATION, type BossCue } from './bossSynth';
/** Structural scheduling QA, independent of browser/autoplay or an audio device. */
function context() {
  const stops: number[] = [], scheduled: number[] = [];
  const param = () => ({ value: 0, setValueAtTime(v: number, t: number) { scheduled.push(v, t); },
    linearRampToValueAtTime(v: number, t: number) { scheduled.push(v, t); },
    exponentialRampToValueAtTime(v: number, t: number) { expect(v).toBeGreaterThan(0); scheduled.push(v, t); } });
  const node = () => ({ gain: param(), frequency: param(), detune: param(), Q: param(), playbackRate: param(),
    connect(target: unknown) { return target; }, start(t: number) { scheduled.push(t); }, stop(t: number) { stops.push(t); } });
  const ctx = { createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node };
  return { ctx: ctx as unknown as BaseAudioContext, out: node() as unknown as AudioNode, stops, scheduled };
}
describe('original boss synthesis recipes', () => {
  it.each(Object.keys(BOSS_CUE_DURATION) as BossCue[])('%s schedules finite, bounded voices that stop themselves', cue => {
    const { ctx, out, stops, scheduled } = context();
    synthBoss(ctx, out, {} as AudioBuffer, {} as AudioBuffer, cue, 10);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops.every(t => t > 10 && t <= 10 + BOSS_CUE_DURATION[cue] + .07)).toBe(true);
    expect(scheduled.every(Number.isFinite)).toBe(true);
  });
  it.each(['swipeWindup', 'stompWindup', 'grabWindup', 'charge', 'beam'] as const)('trims %s to its remaining authoritative window', cue => {
    const { ctx, out, stops } = context(), age = .25;
    synthBoss(ctx, out, {} as AudioBuffer, {} as AudioBuffer, cue, 10, age);
    expect(Math.max(...stops)).toBeCloseTo(10 + BOSS_CUE_DURATION[cue] - age + .05);
  });
});
