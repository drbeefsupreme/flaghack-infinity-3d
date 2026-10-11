/** Approximate offline QA, NOT browser WebAudio DSP or a listening/latency test.
 * node bench/boss-audio-offline.mjs [git revision|working] [/tmp/report-prefix]
 * Captures actual synthBoss graph/automation. Python companion renders the graph.
 */
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const revision = process.argv[2] || 'working';
const prefix = process.argv[3] || '/tmp/boss-audio-' + revision.slice(0, 8);
const source = name => revision === 'working' ? readFileSync(resolve(root, 'web/src/audio/' + name + '.ts'), 'utf8') : execFileSync('git', ['show', revision + ':web/src/audio/' + name + '.ts'], { cwd: root, encoding: 'utf8' });
const url = s => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(s)).toString('base64');
const recipeSource = source('bossSynth'), synthSource = source('synth');
const sourceHash = createHash('sha256').update(recipeSource + synthSource).digest('hex');
const synthURL = url(synthSource);
const { synthBoss, BOSS_CUE_DURATION } = await import(url(recipeSource.replace("'./synth'", JSON.stringify(synthURL))));
class Param {
  constructor(value) { this.value = value; this.events = []; this.inputs = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); return this; }
}
class Context {
  constructor() { this.nodes = []; this.currentTime = 0; this.sampleRate = 44100; }
  node(kind) {
    const n = { id: this.nodes.length, kind, inputs: [], type: kind === 'osc' ? 'sine' : 'lowpass',
      gain: new Param(1), frequency: new Param(kind === 'osc' ? 440 : 350), Q: new Param(1), detune: new Param(0), playbackRate: new Param(1),
      connect(target) { target.inputs.push(this.id); return target; }, disconnect() {},
      start(t, offset = 0) { this.startTime = t; this.offset = offset; }, stop(t) { this.stopTime = t; } };
    this.nodes.push(n); return n;
  }
  createGain() { return this.node('gain'); }
  createOscillator() { return this.node('osc'); }
  createBiquadFilter() { return this.node('filter'); }
  createBufferSource() { return this.node('noise'); }
}
const graph = cue => { const ctx = new Context(), out = ctx.createGain(); synthBoss(ctx, out, 'pink', 'white', cue, 0); return ctx; };
// Deterministic offsets across revisions; waveform itself is seeded by the renderer.
Math.random = () => .375;
const reports = [];
for (const cue of Object.keys(BOSS_CUE_DURATION)) {
  const ctx = graph(cue), nodes = ctx.nodes;
  // Measure only JS graph construction. Discard each graph immediately; no history retention.
  for (let i = 0; i < 100; i++) graph(cue);
  const timings = [];
  for (let block = 0; block < 20; block++) { const start = performance.now(); for (let i = 0; i < 100; i++) graph(cue); timings.push((performance.now() - start) / 100); }
  timings.sort((a, b) => a - b);
  reports.push({ cue, duration: BOSS_CUE_DURATION[cue], nodes: nodes.length - 1,
    automationEvents: nodes.reduce((count, node) => count + Object.values(node).filter(v => v instanceof Param).reduce((sum, p) => sum + p.events.length, 0), 0),
    sources: nodes.filter(n => n.kind === 'osc' || n.kind === 'noise').length,
    allSourcesStopped: nodes.filter(n => n.kind === 'osc' || n.kind === 'noise').every(n => Number.isFinite(n.stopTime)),
    scheduleShimMedianMs: timings[10], scheduleShimP95Ms: timings[18], graph: nodes });
}
let reverb;
if (revision === 'working') {
  const engineSource = source('engine');
  const impulseMethod = engineSource.match(/  private makeImpulse\(seconds: number\): AudioBuffer \{[\s\S]*?\n    return buf;\n  \}/)?.[0];
  if (!impulseMethod) throw Error('Cannot capture production makeImpulse');
  const { ImpulseFactory } = await import(url('export class ImpulseFactory { ctx; ' + impulseMethod + ' }'));
  const factory = new ImpulseFactory();
  factory.ctx = { sampleRate: 44100, createBuffer(channels, length, rate) { const data = Array.from({length: channels}, () => new Float32Array(length)); return { data, getChannelData(c) { return data[c]; } }; } };
  let seed = 1091; Math.random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
  const impulse = factory.makeImpulse(2.8);
  const impulsePath = prefix + '-impulse.f32';
  writeFileSync(impulsePath, Buffer.concat(impulse.data.map(d => Buffer.from(d.buffer))));
  const { BOSS_VOICE_MIX } = await import(url(source('bossMix')));
  if (!BOSS_VOICE_MIX) throw Error('Production BOSS_VOICE_MIX export required for preview');
  reverb = { impulsePath, channels: 2, seconds: 2.8, sampleRate: 44100, returnGain: .55, voiceMix: BOSS_VOICE_MIX,
    voiceMixSourceHash: createHash('sha256').update(source('bossMix')).digest('hex'),
    engineSourceHash: createHash('sha256').update(engineSource).digest('hex'), normalizationSource: 'https://www.w3.org/TR/webaudio/#dom-convolvernode-normalize' };
}
writeFileSync(prefix + '.graphs.json', JSON.stringify({ revision, sourceHash, reports, reverb }));
execFileSync('python', [resolve(import.meta.dirname, 'boss-audio-offline.py'), prefix + '.graphs.json', prefix + '.json', ...(revision === 'working' ? [prefix + '-offline-diagnostic-preview.wav'] : [])], { stdio: 'inherit' });
