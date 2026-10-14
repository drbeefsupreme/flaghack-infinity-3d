import { afterEach, describe, expect, it, vi } from 'vitest';
import { BossAudio } from './boss';
import { AudioEngine } from './engine';
import { Session } from '../game/session';
import { TestAudioContext } from '../../tests/audioContext';

afterEach(() => vi.unstubAllGlobals());
describe('restrained melee windup audio routing', () => {
  it('fades only the active windup and releases its duck while preserving impact and vocal voices', () => {
    vi.stubGlobal('AudioContext', TestAudioContext);
    const engine = new AudioEngine(), voice = vi.spyOn(engine, 'voice');
    const audio = new BossAudio(engine, { ready: Promise.resolve(), get: () => ({ duration: 4 }) as AudioBuffer });
    audio.play('stompWindup', { x: 1, z: 2 }); audio.play('stomp', { x: 1, z: 2 }); audio.vocal('roar');
    const windup = voice.mock.results[0].value!, impact = voice.mock.results[1].value!, vocal = voice.mock.results[2].value!;
    const fade = vi.spyOn(windup.input.gain, 'setTargetAtTime');
    const impactFade = vi.spyOn(impact.input.gain, 'setTargetAtTime'), vocalFade = vi.spyOn(vocal.input.gain, 'setTargetAtTime');
    audio.stopWindup(); audio.stopWindup();
    expect(fade).toHaveBeenCalledExactlyOnceWith(0, engine.ctx.currentTime, .012);
    expect(impactFade).not.toHaveBeenCalled(); expect(vocalFade).not.toHaveBeenCalled();
    expect(voice.mock.calls[2][0]).toMatchObject({ bus: 'boss', gain: 1.3 });
    audio.cancel();
  });

  it('keeps all warnings under existing SFX/master controls and below the existing roar mix', () => {
    vi.stubGlobal('AudioContext', TestAudioContext);
    const engine = new AudioEngine(), settings = new Session().settings;
    const audio = new BossAudio(engine, { ready: Promise.resolve(), get: () => undefined });
    const voice = vi.spyOn(engine, 'voice');
    settings.sfxVolume = 0; engine.setVolumes(settings, false, 1);
    for (const cue of ['swipeWindup', 'stompWindup', 'grabWindup'] as const) audio.play(cue, { x: 1, z: 2 });
    expect(engine.buses.boss.gain.value).toBe(0);
    for (const [spec] of voice.mock.calls) {
      expect(spec.bus).toBe('boss'); expect(spec.gain).toBeLessThan(1.3); expect(spec.dur).toBeLessThanOrEqual(1.35);
    }
    expect(engine.worldDuck.gain.value).toBe(1);
    audio.cancel();
  });
});
