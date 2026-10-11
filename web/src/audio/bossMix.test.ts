import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestAudioContext, TestNode, TestParam } from '../../tests/audioContext';
import { AudioEngine } from './engine';
import { BossAudio } from './boss';
import { Session } from '../game/session';
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
    for (const bus of ['boss', 'ui'] as const) expect(node(e.buses[bus]).connections).toContain(node(e.master));
    for (const bus of ['sfx', 'ambience', 'music'] as const) expect(node(e.wet[bus]).connections).toContain(node(e.worldWetDuck));
    expect(node(e.master).connections[0].connections[0].connections[0]).toBe(node(e.limiter));
  });
  it('keeps boss dry and wet gain under SFX/master mute and restores exact chosen levels', () => {
    const e = new AudioEngine(), settings = new Session().settings;
    settings.sfxVolume = 0; settings.masterVolume = .23; e.setVolumes(settings, false, 1);
    expect(e.buses.boss.gain.value).toBe(0); expect(e.wet.boss.gain.value).toBe(0); expect(e.master.gain.value).toBe(.23);
    settings.sfxVolume = .41; settings.masterVolume = 0; e.setVolumes(settings, false, 1);
    expect(e.buses.boss.gain.value).toBe(.41); expect(e.wet.boss.gain.value).toBe(.41); expect(e.master.gain.value).toBe(0);
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
  it('boss recipes activate the mix and reset releases it without altering user gains', () => {
    const e = new AudioEngine(), b = new BossAudio(e), settings = new Session().settings;
    e.setVolumes(settings, false, 1); b.play('emerge', { x: 300, z: 300 });
    expect(e.worldDuck.gain.value).toBeCloseTo(.07);
    b.cancel(); expect(e.worldDuck.gain.value).toBe(1); expect(e.buses.boss.gain.value).toBe(settings.sfxVolume);
  });
});
