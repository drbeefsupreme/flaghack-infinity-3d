import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BossAudio, BossAudioTracker } from './boss';
import { BOSS_EYE_TIMING, BOSS_TIMING } from '../sim/boss';
import type { AudioEngine } from './engine';
function harness() {
  const sink = { play: vi.fn(), cancel: vi.fn(), stopBeam: vi.fn(), stopWindup: vi.fn(), updateBeam: vi.fn(), vocal: vi.fn(), stopVocals: vi.fn() }, tracker = new BossAudioTracker(sink), b = bossFixture();
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
    tracker.update(b, 100.2); tracker.update(b, 100.3);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['beam']); // Continue active audio, no historical explosion.
    sink.play.mockClear();
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
  it('uses one sustained beam during live updates and coalesces sweeping impacts', () => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.eye.firedAt = 100.1; b.eye.impact = { x: 0, y: 0, z: 0 }; tracker.update(b, 100.1);
    for (let i = 1; i < BOSS_EYE_TIMING.beam * 60; i++) {
      b.eye.impact = { x: i * 2, y: 0, z: 0 }; tracker.update(b, 100.1 + i / 60);
    }
    expect(sink.play.mock.calls.filter(c => c[0] === 'beam')).toHaveLength(1);
    const impacts = sink.play.mock.calls.filter(c => c[0] === 'impact').length;
    expect(impacts).toBeGreaterThanOrEqual(Math.floor(BOSS_EYE_TIMING.beam / .6));
    expect(impacts).toBeLessThanOrEqual(Math.ceil(BOSS_EYE_TIMING.beam / .6));
    expect(sink.updateBeam).toHaveBeenCalled();
    b.eye.firedAt = null; tracker.update(b, 100.1 + BOSS_EYE_TIMING.beam);
    expect(sink.stopBeam).toHaveBeenCalled();
  });
  it('late join resumes the remaining beam only, then death stops it immediately', () => {
    const { sink, tracker, b } = harness(); b.eye.firedAt = 100;
    b.eye.impact = { x: 9, y: 0, z: 9 }; const age = BOSS_EYE_TIMING.beam / 2;
    tracker.update(b, 100 + age);
    expect(sink.play).toHaveBeenCalledExactlyOnceWith('beam', b.pos, age);
    b.hp = 0; tracker.update(b, 100 + age + .01); expect(sink.stopBeam).toHaveBeenCalled();
    expect(sink.play.mock.calls.some(c => c[0] === 'impact')).toBe(false);
  });
  it('routes every recipe through the capped arena-wide boss bus under the existing volume controls', () => {
    const voice = vi.fn(() => null);
    const audio = new BossAudio({ voice, ctx: { currentTime: 0 } } as unknown as AudioEngine, { get: () => ({ duration: 4 }) as AudioBuffer, ready: Promise.resolve() });
    for (const cue of ['swipeWindup', 'stompWindup', 'grabWindup', 'emerge', 'death', 'step', 'stomp', 'charge', 'beam', 'impact', 'crush'] as const) audio.play(cue, { x: 1, z: 2 });
    expect(voice).toHaveBeenCalledTimes(11);
    for (const [spec] of voice.mock.calls as unknown as [{ bus: string; at: unknown; gain: number; directionalOnly: boolean }][]) {
      expect(spec.bus).toBe('boss'); expect(spec.at === undefined || JSON.stringify(spec.at) === JSON.stringify({ x: 1, z: 2 })).toBe(true); expect(spec.gain).toBeLessThanOrEqual(1.3); expect(spec.directionalOnly).toBe(spec.at ? true : undefined);
    }
  });
});

describe('synchronized sampled vocal slots', () => {
  it('alternates sparsely, skips snapshots and suppresses noncombat vocalizations', () => {
    const { sink, tracker, b } = harness();
    const at = b.spawnedAt + 24 + b.id % 9;
    tracker.update(b, at - .1); tracker.update(b, at); tracker.update(b, at + .1);
    expect(sink.vocal).toHaveBeenCalledExactlyOnceWith('roar');
    tracker.reset(); sink.vocal.mockClear(); tracker.update(b, at); tracker.update(b, at + .1);
    expect(sink.vocal).not.toHaveBeenCalled();
    tracker.update(b, at + 31.9); tracker.update(b, at + 32);
    expect(sink.vocal).toHaveBeenCalledExactlyOnceWith('growl');
    tracker.update(b, at + 63.9); tracker.update(b, at + 64, false);
    expect(sink.vocal).toHaveBeenCalledTimes(1); expect(sink.stopVocals).toHaveBeenCalled();
    tracker.update(b, at + 95.9); b.hp = 0; tracker.update(b, at + 96);
    expect(sink.vocal).toHaveBeenCalledTimes(1);
  });
});


describe('one-shot melee windup warnings', () => {
  it.each([
    ['swipe', 'swipeWindup', BOSS_TIMING.swipeHit],
    ['stomp', 'stompWindup', BOSS_TIMING.stompHit],
    ['grab', 'grabWindup', BOSS_TIMING.grasp],
  ] as const)('plays %s once per fresh action, then stops at its exact contact edge', (action, cue, duration) => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.action = action; b.actionAt = 100.1; b.actionSeq++; b.held = null;
    tracker.update(b, 100.2);
    expect(sink.play).toHaveBeenCalledExactlyOnceWith(cue, b.pos, expect.closeTo(.1));
    for (let frame = 15; frame < duration * 144; frame++) tracker.update({ ...b }, 100.1 + frame / 144);
    expect(sink.play).toHaveBeenCalledTimes(1);
    sink.stopWindup.mockClear(); tracker.update(b, b.actionAt + duration);
    expect(sink.stopWindup).toHaveBeenCalledOnce();
    for (let t = b.actionAt + duration; t < 102; t += .1) tracker.update(b, t);
    b.actionAt = 102; b.actionSeq++; tracker.update(b, 102); tracker.update(b, 102.01);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual([cue, cue]);
  });

  it.each(['swipe', 'stomp', 'grab'] as const)('never replays a %s warning on late join, stale state, resume, or new boss ID', action => {
    const { sink, tracker, b } = harness(); b.action = action; b.actionAt = 100;
    tracker.update(b, 100.1); tracker.update({ ...b }, 100.2);
    expect(sink.play).not.toHaveBeenCalled();
    tracker.reset(); tracker.update(b, 100.3); expect(sink.play).not.toHaveBeenCalled();
    b.actionSeq++; b.actionAt = 101; tracker.update(b, 110);
    b.id++; b.actionAt = 110.1; tracker.update(b, 110.1); tracker.update(b, 110.2);
    expect(sink.play).not.toHaveBeenCalled();
  });

  it.each(['recoil', 'idle', 'eye', 'hit', 'death', 'ended', 'reset'] as const)('cancels the warning on %s without inventing an impact', reason => {
    const { sink, tracker, b } = harness(); tracker.update(b, 100);
    b.action = 'grab'; b.actionAt = 100.1; b.actionSeq++; tracker.update(b, 100.1);
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(['grabWindup']);
    if (reason === 'reset') { tracker.reset(); expect(sink.cancel).toHaveBeenLastCalledWith(); return; }
    if (reason === 'recoil' || reason === 'idle') b.action = reason;
    if (reason === 'eye') b.eye.chargeAt = 100.2;
    if (reason === 'hit') b.hitSeq = b.actionSeq;
    if (reason === 'death') b.hp = 0;
    tracker.update(b, 100.2, reason !== 'ended');
    expect(sink.stopWindup).toHaveBeenCalled();
    expect(sink.play.mock.calls.map(c => c[0])).toEqual(reason === 'eye' ? ['grabWindup', 'charge'] : ['grabWindup']);
  });
});
