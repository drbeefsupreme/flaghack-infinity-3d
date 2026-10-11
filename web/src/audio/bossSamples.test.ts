import { afterEach, expect, it, vi } from 'vitest';
import { BossSamples } from './bossSamples';
import { BossAudio } from './boss';
import { AudioEngine } from './engine';
import { Session } from '../game/session';
import { TestAudioContext } from '../../tests/audioContext';
afterEach(() => vi.unstubAllGlobals());
it('fetches and decodes each sample once, peak-normalizes once and caches the buffers', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  vi.stubGlobal('fetch', fetcher);
  const decodeAudioData = vi.fn(async () => { const data = new Float32Array([-.5, .25]); return { numberOfChannels: 1, getChannelData: () => data }; });
  const samples = new BossSamples({ decodeAudioData } as unknown as BaseAudioContext);
  await samples.ready;
  for (let i = 0; i < 1000; i++) expect(samples.get('emerge')).toBe(samples.get('emerge'));
  expect(fetcher).toHaveBeenCalledTimes(3); expect(decodeAudioData).toHaveBeenCalledTimes(3);
  expect(samples.get('emerge')!.getChannelData(0)[0]).toBeCloseTo(-.85);
});
it('contains network/decode errors without queuing stale voices', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const samples = new BossSamples({} as BaseAudioContext); await samples.ready;
  expect(samples.get('emerge')).toBeUndefined();
});
it('uses one nonpositional foreground voice, preserves volume controls and cancels the source', () => {
  vi.stubGlobal('AudioContext', TestAudioContext);
  const e = new AudioEngine(), settings = new Session().settings;
  e.setVolumes(settings, false, 1);
  const audio = new BossAudio(e, { ready: Promise.resolve(), get: () => ({ duration: 4 }) as AudioBuffer });
  const voice = vi.spyOn(e, 'voice');
  audio.play('emerge', { x: 10000, z: -10000 }); audio.vocal('growl');
  expect(voice).toHaveBeenCalledTimes(1);
  expect(voice.mock.calls[0][0]).toMatchObject({ bus: 'boss', gain: 1.3, priority: 3 });
  expect(voice.mock.calls[0][0].at).toBeUndefined();
  const source = TestAudioContext.last.nodes.find(n => n.kind === 'source')!;
  const stop = vi.spyOn(source, 'stop'); audio.cancel(); expect(stop).toHaveBeenCalled();
  settings.sfxVolume = 0; e.setVolumes(settings, false, 1); audio.vocal('roar');
  expect(e.buses.boss.gain.value).toBe(0); expect(e.worldDuck.gain.value).toBe(1);
});
it('does not play a pending emergence after reset while loading', async () => {
  vi.stubGlobal('AudioContext', TestAudioContext);
  const e = new AudioEngine(); let resolve!: () => void;
  const ready = new Promise<void>(r => { resolve = r; }); let loaded = false;
  const audio = new BossAudio(e, { ready, get: () => loaded ? ({ duration: 4 }) as AudioBuffer : undefined });
  const voice = vi.spyOn(e, 'voice'); audio.play('emerge', { x: 0, z: 0 }); audio.cancel();
  loaded = true; resolve(); await ready; await Promise.resolve(); expect(voice).not.toHaveBeenCalled();
});
