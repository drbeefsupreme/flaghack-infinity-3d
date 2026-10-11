import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestAudioContext } from '../../tests/audioContext';
import { bossFixture } from '../../tests/bossFixture';
import { GameAudio } from './audio';
import { AudioEngine } from './engine';
import { Session } from '../game/session';
import type { AppApi } from '../game/app';
import type { BossState } from '../sim/boss';
vi.mock('./music', () => ({ Music: class { reset() {} update() {} } }));
vi.mock('./ambience', () => ({ Ambience: class { update() {} } }));
vi.mock('./mentor', () => ({ MENTOR_CHARS_PER_SEC: 30, MentorVoice: class {} }));
vi.mock('./cues', () => ({ Cues: class {} }));
vi.mock('./soundscape', async importOriginal => ({ ...await importOriginal<object>(), measure() {} }));
beforeEach(() => { vi.stubGlobal('AudioContext', TestAudioContext); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function harness(initialBoss: BossState | null = null) {
  const session = new Session(); session.screen = 'playing';
  const world = { boss: initialBoss, phase: 'playing', time: 99.9, factions: [{ avatarId: 1 }], suddenDeath: false };
  const app = { session, world, net: null, renderer: { ctx: null, camera: { position: { x: -150, y: 260, z: -150 }, matrixWorld: { elements: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] } } } };
  const voice = vi.spyOn(AudioEngine.prototype, 'voice'), audio = new GameAudio(app as unknown as AppApi);
  audio.unlock(); return { audio, world, session, voice };
}
describe('boss audio through the production GameAudio frame hook', () => {
  it('plays reveal, charge, shot and death through normal event/update ordering', () => {
    const { audio, world, session, voice } = harness(); audio.update(.016);
    const b = bossFixture(); b.action = 'emerge'; b.spawnedAt = 100; world.boss = b; world.time = 100;
    const frame = () => { audio.onEvents([{ t: 'notify', faction: 'all', severity: 'info', text: 'test' }]); audio.update(.016); };
    frame(); frame(); b.action = 'idle'; b.eye.chargeAt = 100.1; world.time = 100.1; frame();
    for (let t = 100.3; t < 103; t += .2) { world.time = t; frame(); }
    b.eye.firedAt = 103.1; world.time = 103.1; frame(); frame();
    b.hp = 0; b.deathAt = 103.2; world.time = 103.2; session.screen = 'ended'; frame();
    expect(voice.mock.calls.map(([s]) => s.key)).toEqual(['boss-emerge', 'boss-charge', 'boss-beam', 'boss-death']);
    for (const [spec] of voice.mock.calls) { expect(spec.bus).toBe('boss'); expect(spec.directionalOnly).toBe(true); }
  });
  it('observes replicated snapshot replacement without re-playing historical cues', () => {
    const b = bossFixture(); b.action = 'walk'; b.stride = 0;
    const { audio, world, voice } = harness(b); audio.update(.016);
    world.boss = { ...b, stride: 100 }; world.time += .1; audio.update(.016); audio.update(.016);
    expect(voice).not.toHaveBeenCalled();
    audio.onEvents([{ t: 'bossFootfall', bossId: b.id, pos: { x: 1, z: 2 }, heavy: false }]);
    audio.update(.016); audio.update(.016);
    expect(voice.mock.calls.map(([s]) => s.key)).toEqual(['boss-step']);
  });
  it('cancels cues and ducking on menu/reset, then baselines resume without replay', () => {
    const { audio, world, session, voice } = harness(); audio.update(.016);
    const b = bossFixture(); b.spawnedAt = 100; b.action = 'emerge'; world.boss = b; world.time = 100; audio.update(.016);
    session.screen = 'paused'; audio.update(.016); session.screen = 'playing'; audio.update(.016);
    expect(voice.mock.calls.map(([s]) => s.key)).toEqual(['boss-emerge']);
    session.screen = 'title'; audio.update(.016); session.screen = 'playing'; audio.update(.016);
    expect(voice.mock.calls).toHaveLength(1);
  });
  it('plays each authoritative footfall and one crush per destruction burst without inferred doubles', () => {
    const { audio, world, voice } = harness(); audio.update(.016);
    const b = bossFixture(); world.boss = b; world.time = 100; audio.update(.016);
    audio.onEvents([
      { t: 'bossFootfall', bossId: b.id, pos: { x: 1, z: 2 }, heavy: false },
      { t: 'bossFootfall', bossId: b.id, pos: { x: 4, z: 2 }, heavy: false },
      { t: 'bossFootfall', bossId: b.id, pos: { x: 8, z: 2 }, heavy: true },
      { t: 'sceneryCrushed', pos: { x: 8, z: 2 }, count: 12 },
      { t: 'sceneryCrushed', pos: { x: 8, z: 2 }, count: 3 },
    ]);
    b.action = 'stomp'; b.actionAt = 99; b.stride = 20; audio.update(.016); audio.update(.016);
    expect(voice.mock.calls.map(([s]) => s.key)).toEqual(['boss-step', 'boss-step', 'boss-stomp', 'boss-crush']);
    expect(voice.mock.calls[0][0].at).toEqual({ x: 1, z: 2 });
    expect(voice.mock.calls[2][0].dur).toBeGreaterThan(voice.mock.calls[0][0].dur);
  });
  it('does not restart a beam against a frozen defeat-screen clock', () => {
    const b = bossFixture(); b.eye.firedAt = 99.8;
    const { audio, world, session, voice } = harness(b); audio.update(.016);
    expect(voice.mock.calls.map(([s]) => s.key)).toEqual(['boss-beam']);
    world.phase = 'ended'; session.screen = 'ended'; audio.update(.016);
    TestAudioContext.last.currentTime = 10; audio.update(.016); audio.update(.016);
    expect(voice.mock.calls).toHaveLength(1);
  });
  it('keeps user gestures available to retry a rejected resume or browser interruption', async () => {
    harness(); const ctx = TestAudioContext.last; ctx.state = 'suspended';
    ctx.resume.mockRejectedValueOnce(new Error('gesture required'));
    window.dispatchEvent(new Event('pointerdown')); await Promise.resolve(); await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalledTimes(1); expect(ctx.state).toBe('suspended');
    window.dispatchEvent(new Event('keydown')); await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalledTimes(2); expect(ctx.state).toBe('running');
    window.dispatchEvent(new Event('pointerdown')); expect(ctx.resume).toHaveBeenCalledTimes(2);
  });
});
