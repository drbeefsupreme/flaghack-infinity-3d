import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BOSS_EYE_TIMING, BOSS_TIMING } from './boss';
import { bossAttackPhase, bossAttackProgress } from './bossAttackPresentation';

describe('host-clock boss attack tells', () => {
  it.each([
    ['swipe', 'swipeWindup', BOSS_TIMING.swipeHit],
    ['stomp', 'stompWindup', BOSS_TIMING.stompHit],
    ['grab', 'grabWindup', BOSS_TIMING.grasp],
  ] as const)('shows %s only during the exact existing windup', (action, kind, duration) => {
    const b = bossFixture(); b.action = action; b.held = null;
    expect(bossAttackPhase(b, b.actionAt - .001)).toBeNull();
    const phase = bossAttackPhase(b, b.actionAt)!;
    expect(phase.kind).toBe(kind); expect(phase.duration).toBe(duration);
    expect(bossAttackProgress(b, phase, b.actionAt)).toBe(0);
    expect(bossAttackPhase(b, b.actionAt + duration / 2)).toBe(phase);
    expect(bossAttackProgress(b, phase, b.actionAt + duration / 2)).toBeCloseTo(.5);
    expect(bossAttackPhase(b, b.actionAt + duration - .001)).toBe(phase);
    expect(bossAttackPhase(b, b.actionAt + duration)).toBeNull();
    expect(bossAttackPhase(b, b.actionAt + 90)).toBeNull();
    b.hitSeq = b.actionSeq;
    expect(bossAttackPhase(b, b.actionAt + .1)).toBeNull();
  });

  it('describes consumption only when the authoritative held target exists, and clears at consumption', () => {
    const b = bossFixture(), original = JSON.stringify(b);
    const phase = bossAttackPhase(b, b.actionAt + BOSS_TIMING.grasp)!;
    expect(phase.kind).toBe('grabConsume'); expect(phase.active).toBe(true);
    expect(bossAttackProgress(b, phase, b.actionAt + BOSS_TIMING.grasp)).toBeCloseTo(0);
    expect(bossAttackPhase(b, b.actionAt + BOSS_TIMING.consume - .001)).toBe(phase);
    expect(bossAttackPhase(b, b.actionAt + BOSS_TIMING.consume)).toBeNull();
    expect(JSON.stringify(b)).toBe(original);
    b.held = null; expect(bossAttackPhase(b, b.actionAt + BOSS_TIMING.grasp)).toBeNull();
  });

  it('gives eye charge/fire priority and respects the actual firing timestamp and five-second window', () => {
    const b = bossFixture(); b.action = 'swipe'; b.eye.chargeAt = b.actionAt;
    expect(bossAttackPhase(b, b.actionAt - .001)).toBeNull();
    expect(bossAttackPhase(b, b.actionAt)?.kind).toBe('eyeCharge');
    expect(bossAttackPhase(b, b.actionAt + BOSS_EYE_TIMING.charge - .001)?.kind).toBe('eyeCharge');
    expect(bossAttackPhase(b, b.actionAt + BOSS_EYE_TIMING.charge)).toBeNull();
    // A delayed host edge cannot cause the UI to invent the firing state.
    b.eye.firedAt = b.actionAt + BOSS_EYE_TIMING.charge + .2;
    expect(bossAttackPhase(b, b.eye.firedAt - .001)).toBeNull();
    const beam = bossAttackPhase(b, b.eye.firedAt)!;
    expect(beam.kind).toBe('eyeBeam'); expect(beam.active).toBe(true);
    expect(bossAttackProgress(b, beam, b.eye.firedAt + 2.5)).toBe(.5);
    expect(bossAttackPhase(b, b.eye.firedAt + BOSS_EYE_TIMING.beam - .001)).toBe(beam);
    expect(bossAttackPhase(b, b.eye.firedAt + BOSS_EYE_TIMING.beam)).toBeNull();
  });

  it('reconstructs a late snapshot directly and clears on cancellation, death, reset and invalid time', () => {
    const b = bossFixture(); b.action = 'stomp'; const now = b.actionAt + .5;
    const phase = bossAttackPhase(b, now)!;
    expect(bossAttackProgress(b, phase, now)).toBe(.5);
    expect(bossAttackPhase({ ...b }, now)).toBe(phase);
    expect(bossAttackPhase({ ...b, action: 'recoil' }, now)).toBeNull();
    for (const patch of [{ hp: 0 }, { deathAt: now }, { action: 'death' as const }, { action: 'dead' as const }])
      expect(bossAttackPhase({ ...b, ...patch }, now)).toBeNull();
    for (const time of [NaN, Infinity, -Infinity]) expect(bossAttackPhase(b, time)).toBeNull();
    expect(bossAttackPhase(null, now)).toBeNull();
  });
});
