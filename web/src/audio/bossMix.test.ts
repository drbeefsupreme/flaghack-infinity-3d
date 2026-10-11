import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestAudioContext, TestNode, TestParam } from '../../tests/audioContext';
import { AudioEngine } from './engine';
import { BossAudio } from './boss';
import { BOSS_VOICE_MIX } from './bossMix';
import type { BossCue } from './bossSynth';
import { Session } from '../game/session';
vi.mock('./bossSamples', () => ({ BossSamples: class { ready = Promise.resolve(); get() { return { duration: 4 }; } } }));
function param(p: AudioParam): TestParam { return p as unknown as TestParam; }
function node(n: AudioNode): TestNode { return n as unknown as TestNode; }
beforeEach(() => vi.stubGlobal('AudioContext', TestAudioContext));
afterEach(() => vi.unstubAllGlobals());
describe('arena-wide boss mix in the actual audio engine', () => {
  it.each(['high','medium','low'] as const)('keeps boss audible across arena corners and command/table cameras on %s', quality => {
    const e = new AudioEngine(); e.quality = quality;
    for (const [x, y, z] of [[-150, 2, -150], [150, 260, 150], [1000, 1000, 1000]]) {
      e.setListener(x, y, z, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
      const v = e.voice({ key: 'boss-test', bus: 'boss', at: { x: 150, z: -150 }, directionalOnly: true, priority: 3, gain: .85, dur: 1 });
      expect(v).not.toBeNull();
      const out = node(v!.input).connections[0]; expect(out.gain.value).toBe(1);
      const stereo = out.connections[0].connections[0];
      expect(stereo.kind).toBe('stereo'); expect(Math.abs(stereo.pan.value)).toBeLessThanOrEqual(1);
      expect(stereo.connections).toContain(node(e.buses.boss));
    }
    expect(e.stats.inaudible).toBe(0);
  });
  it('reproduces the old attenuation and verifies it is bypassed only for arena-wide cues', () => {
    const e = new AudioEngine(); e.lx = e.ly = e.lz = 0;
    expect(e.distanceGain(300, 0, 3)).toBeCloseTo(.09174, 4);
    expect(e.distanceGain(300, 0, 6)).toBeCloseTo(.18519, 4);
    expect(e.voice({ key: 'far', at: { x: 1e6, z: 0 }, dur: 1 })).toBeNull();
    expect(e.voice({ key: 'far-boss', bus: 'boss', at: { x: 1e6, z: 0 }, directionalOnly: true, dur: 1 })).not.toBeNull();
  });
  it('ducks all other world buses, preserves boss/UI routing and shares the final limiter', () => {
    const e = new AudioEngine();
    expect(node(e.buses.sfx).connections).toContain(node(e.worldDuck));
    expect(node(e.buses.ambience).connections).toContain(node(e.worldDuck));
    expect(node(e.musicDuck).connections).toContain(node(e.worldDuck));
    expect(node(e.buses.ui).connections).toContain(node(e.master));
    expect(node(e.buses.boss).connections).toContain(node(e.bossMaster));
    expect(node(e.bossMaster).connections[0].connections[0]).toBe(node(e.bossCompressor));
    expect(node(e.bossCompressor).connections).toContain(node(e.limiter));
    expect(e.bossCompressor.ratio.value).toBe(2); expect(e.bossCompressor.threshold.value).toBe(-8);
    for (const bus of ['sfx', 'ambience', 'music'] as const) expect(node(e.wet[bus]).connections).toContain(node(e.worldWetDuck));
    expect(node(e.master).connections[0].connections[0].connections[0]).toBe(node(e.limiter));
  });
  it('keeps boss dry and wet gain under SFX/master mute and restores exact chosen levels', () => {
    const e = new AudioEngine(), settings = new Session().settings;
    settings.sfxVolume = 0; settings.masterVolume = .23; e.setVolumes(settings, false, 1);
    expect(e.buses.boss.gain.value).toBe(0); expect(e.wet.boss.gain.value).toBe(0); expect(e.master.gain.value).toBe(.23); expect(e.bossMaster.gain.value).toBe(.23);
    settings.sfxVolume = .41; settings.masterVolume = 0; e.setVolumes(settings, false, 1);
    expect(e.buses.boss.gain.value).toBe(.41); expect(e.wet.boss.gain.value).toBe(.41); expect(e.master.gain.value).toBe(0); expect(e.bossMaster.gain.value).toBe(0);
  });
  it('does not duck music for muted boss SFX, including muting during a bellow', () => {
    const e = new AudioEngine(), settings = new Session().settings;
    e.setVolumes(settings, false, 1); e.duckForBoss(.93, 4);
    settings.sfxVolume = 0; e.setVolumes(settings, false, 1); expect(e.worldDuck.gain.value).toBe(1);
    e.duckForBoss(.65, .7); expect(e.worldDuck.gain.value).toBe(1);
    settings.sfxVolume = .5; e.setVolumes(settings, false, 1); expect(e.worldDuck.gain.value).toBeCloseTo(.07);
  });
  it('overlaps smooth duck leases without footfalls indefinitely extending a bellow', () => {
    const e = new AudioEngine(), ctx = TestAudioContext.last;
    e.duckForBoss(.93, 4); e.duckForBoss(.65, .7);
    expect(e.worldDuck.gain.value).toBeCloseTo(.07);
    ctx.currentTime = 3.8; e.duckForBoss(.65, .7);
    ctx.currentTime = 4.1; e.prune(); expect(e.worldDuck.gain.value).toBeCloseTo(.35);
    ctx.currentTime = 4.6; e.prune(); expect(e.worldDuck.gain.value).toBe(1);
    expect(param(e.worldDuck.gain).events.at(-1)?.constant).toBe(.4);
    expect(param(e.worldWetDuck.gain).events).toEqual(param(e.worldDuck.gain).events);
  });
  it.each(['impact', 'crush'] as const)('%s retains arena-wide boss routing and muted controls', cue => {
    const e = new AudioEngine(), b = new BossAudio(e), settings = new Session().settings;
    const voice = vi.spyOn(e, 'voice'); settings.sfxVolume = 0; e.setVolumes(settings, false, 1);
    b.play(cue, { x: 500, z: -500 });
    expect(voice).toHaveBeenCalledWith(expect.objectContaining({ bus: 'boss', directionalOnly: true, at: { x: 500, z: -500 } }));
    expect(e.buses.boss.gain.value).toBe(0); expect(e.wet.boss.gain.value).toBe(0);
    expect(e.worldDuck.gain.value).toBe(1); expect(e.master.gain.value).toBe(settings.masterVolume);
    b.cancel();
  });
  it('coalesces mass scenery destruction and adjacent-frame bursts into bounded crushing voices', () => {
    const e = new AudioEngine(), audio = new BossAudio(e), play = vi.spyOn(audio, 'play');
    audio.sceneryCrushed(Array.from({ length: 100 }, () => ({ pos: { x: 10, z: 20 }, count: 1 })));
    expect(play).toHaveBeenCalledTimes(1); expect(play).toHaveBeenLastCalledWith('crush', { x: 10, z: 20 });
    TestAudioContext.last.currentTime = .19; audio.sceneryCrushed([{ pos: { x: 10, z: 20 }, count: 40 }]);
    expect(play).toHaveBeenCalledTimes(1);
    TestAudioContext.last.currentTime = .21; audio.sceneryCrushed([{ pos: { x: -20, z: -10 }, count: 1 }]);
    expect(play).toHaveBeenCalledTimes(2);
    audio.cancel(); audio.sceneryCrushed([{ pos: { x: 0, z: 0 }, count: 0 }]); expect(play).toHaveBeenCalledTimes(2);
  });
  it('schedules unchanged bus volumes only once, while applying every real setting change', () => {
    const e = new AudioEngine(), settings = new Session().settings, ctx = TestAudioContext.last;
    const count = () => ctx.nodes.reduce((n, node) => n + node.gain.events.length + node.frequency.events.length, 0);
    e.setVolumes(settings, false, 1); const initial = count(); expect(initial).toBe(14);
    for (let frame = 0; frame < 600; frame++) { ctx.currentTime = frame / 60; e.setVolumes(settings, false, 1); e.prune(); }
    expect(count()).toBe(initial);
    settings.sfxVolume = .33; e.setVolumes(settings, false, 1); expect(count()).toBe(initial * 2); expect(e.buses.boss.gain.value).toBe(.33);
    settings.quality = 'low'; e.setVolumes(settings, false, 1); expect(e.quality).toBe('low'); expect(count()).toBe(initial * 2);
    e.setVolumes(settings, true, 1); expect(e.muffle.frequency.value).toBe(700); expect(e.bossMuffle.frequency.value).toBe(700);
  });
  it('does not token-duck consecutive boss contacts and does not empty the mix after a footfall', () => {
    const e = new AudioEngine(), b = new BossAudio(e);
    for (let i = 0; i < 8; i++) {
      const v = e.voice({ key: 'boss-step', bus: 'boss', gain: 1, priority: 3, dur: 1 });
      expect(v?.input.gain.value).toBe(1);
    }
    b.play('step', { x: 0, z: 0 }); expect(e.worldDuck.gain.value).toBeCloseTo(.88);
    TestAudioContext.last.currentTime = .19; e.prune(); expect(e.worldDuck.gain.value).toBe(1);
  });
  it('boosts reverberation through one shared cached impulse without per-cue convolution allocation', () => {
    const e = new AudioEngine(), b = new BossAudio(e), ctx = TestAudioContext.last;
    const impulse = e.reverb.buffer, voice = vi.spyOn(e, 'voice');
    for (const cue of Object.keys(BOSS_VOICE_MIX) as BossCue[]) {
      b.play(cue, { x: 0, z: 0 });
      expect(voice).toHaveBeenLastCalledWith(expect.objectContaining({ wet: cue === 'emerge' ? .4 : BOSS_VOICE_MIX[cue].wet, gain: BOSS_VOICE_MIX[cue].gain }));
      expect(BOSS_VOICE_MIX[cue].wet).toBeGreaterThan(.2);
    }
    expect(ctx.nodes.filter(n => n.kind === 'convolver')).toHaveLength(1);
    expect(e.reverb.buffer).toBe(impulse);
  });
  it('keeps sustained beam updates allocation-bounded and cancels its route on command', () => {
    const e = new AudioEngine(), audio = new BossAudio(e), ctx = TestAudioContext.last;
    audio.play('beam', { x: 10, z: 0 }); const count = ctx.nodes.length;
    for (let i = 0; i < 120; i++) audio.updateBeam({ x: 10, z: i / 10 }, .1);
    expect(ctx.nodes.length).toBe(count);
    const voice = vi.spyOn(e, 'voice'); audio.stopBeam(); audio.updateBeam({ x: 0, z: 10 }, .1);
    expect(voice).toHaveBeenCalledTimes(1); audio.cancel();
    expect(e.worldDuck.gain.value).toBe(1);
  });
  it('bounds continuous beam rubble to at most three crush groups per second', () => {
    const e = new AudioEngine(), audio = new BossAudio(e), ctx = TestAudioContext.last;
    const play = vi.spyOn(audio, 'play'); audio.play('beam', { x: 0, z: 0 });
    for (let frame = 0; frame < 60; frame++) {
      ctx.currentTime = frame / 60;
      audio.sceneryCrushed([{ pos: { x: frame, z: 0 }, count: 100 }]);
    }
    expect(play.mock.calls.filter(c => c[0] === 'crush')).toHaveLength(3);
  });
  it('boss recipes activate the mix and reset releases it without altering user gains', () => {
    const e = new AudioEngine(), b = new BossAudio(e), settings = new Session().settings;
    e.setVolumes(settings, false, 1); b.play('emerge', { x: 300, z: 300 });
    expect(e.worldDuck.gain.value).toBeCloseTo(.75);
    b.cancel(); expect(e.worldDuck.gain.value).toBe(1); expect(e.buses.boss.gain.value).toBe(settings.sfxVolume);
  });
});
