import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BossAudio, BossAudioTracker } from './boss';
import type { AudioEngine } from './engine';
function harness() {
  const sink = { play: vi.fn(), cancel: vi.fn() }, tracker = new BossAudioTracker(sink), b = bossFixture();
  b.spawnedAt = 100; b.actionAt = 100; b.action = 'idle'; b.stride = 0;
  return { sink, tracker, b };
}
describe('boss shared-view audio lifecycle', () => {
  it('bellows once on observed emergence, never on a late-join snapshot', () => {
    const { sink, tracker, b } = harness(); b.action = 'emerge';
    tracker.update(null, 99.9); tracker.update(b, 100); tracker.update(b, 100.1);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['emerge']);
    tracker.reset(); sink.play.mockClear(); tracker.update(b, 100.15);
    expect(sink.play).not.toHaveBeenCalled();
  });
  it('charges once, fires once for remaining beam duration, and cancels charge at fire', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.chargeAt = 100.1; tracker.update(b, 100.2); tracker.update(b, 100.3);
    expect(sink.play).toHaveBeenCalledWith('charge', b.pos, expect.closeTo(.1));
    for (let t = 100.5; t < 103.1; t += .25) tracker.update(b, t);
    b.eye.firedAt = 103.1; b.eye.origin = { x: 7, y: 20, z: 9 }; tracker.update(b, 103.2); tracker.update(b, 103.3);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['charge', 'beam']);
    expect(sink.play).toHaveBeenLastCalledWith('beam', b.eye.origin, expect.closeTo(.1));
    expect(sink.cancel).toHaveBeenCalledWith(true);
  });
  it('adds one explosion at the beam collision point, separate from the eye source', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.firedAt = 100.1; b.eye.origin = { x: 1, y: 30, z: 2 }; b.eye.impact = { x: 80, y: 0, z: 20 };
    tracker.update(b, 100.1); tracker.update(b, 100.2);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['beam', 'impact']);
    expect(sink.play).toHaveBeenNthCalledWith(1, 'beam', b.eye.origin, 0);
    expect(sink.play).toHaveBeenNthCalledWith(2, 'impact', b.eye.impact);
  });
  it('does not explode on a miss, late join or historical collision', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.firedAt = 100.1; tracker.update(b, 100.1);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['beam']);
    sink.play.mockClear(); tracker.reset(); b.eye.impact = { x: 40, y: 0, z: 1 };
    tracker.update(b, 100.2); tracker.update(b, 100.3); expect(sink.play).not.toHaveBeenCalled();
    b.eye.firedAt = 101; tracker.update(b, 110); expect(sink.play).not.toHaveBeenCalled();
  });
  it('cancels every active voice on death and emits a distinct death bellow once', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.chargeAt = 100.1; tracker.update(b, 100.1);
    b.hp = 0; b.deathAt = 100.2; tracker.update(b, 100.2); tracker.update(b, 100.3);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['charge', 'death']);
    expect(sink.cancel).toHaveBeenCalledWith();
    tracker.reset(); expect(sink.cancel).toHaveBeenLastCalledWith();
  });
  it('does not replay historical fire/death/footfalls on seek or snapshot replacement', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.firedAt = 101; b.stride = 60; b.action = 'walk'; tracker.update(b, 109);
    b.hp = 0; b.deathAt = 104; tracker.update(b, 109.1);
    expect(sink.play).not.toHaveBeenCalled();
    b.id++; tracker.update(b, 109.2); tracker.update(b, 90);
    expect(sink.play).not.toHaveBeenCalled();
  });
  it('cancels an interrupted charge without scheduling a speculative beam', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.chargeAt = 100.1; tracker.update(b, 100.1);
    b.eye.chargeAt = null; tracker.update(b, 100.2);
    expect(sink.cancel).toHaveBeenLastCalledWith(true);
    for (let t = 100.3; t < 104; t += .25) tracker.update(b, t);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['charge']);
  });
  it('does not infer footfalls from snapshots, stance changes or clock jumps', () => {
    const { sink, tracker, b } = harness(); b.action = 'walk'; b.stride = 20; tracker.update(b, 100);
    b.action = 'crouchWalk'; tracker.update(b, 100.1); b.stride = 90; tracker.update(b, 110);
    expect(sink.play).not.toHaveBeenCalled();
  });
  it('routes every recipe through the capped arena-wide boss bus under the existing volume controls', () => {
    const voice = vi.fn(() => null);
    const audio = new BossAudio({ voice, ctx: { currentTime: 0 } } as unknown as AudioEngine);
    for (const cue of ['emerge', 'death', 'step', 'stomp', 'charge', 'beam', 'impact', 'crush'] as const) audio.play(cue, { x: 1, z: 2 });
    expect(voice).toHaveBeenCalledTimes(8);
    for (const [spec] of voice.mock.calls as unknown as [{ bus: string; at: unknown; gain: number; directionalOnly: boolean }][]) {
      expect(spec.bus).toBe('boss'); expect(spec.at).toEqual({ x: 1, z: 2 }); expect(spec.gain).toBeLessThanOrEqual(1); expect(spec.directionalOnly).toBe(true);
    }
  });
});
