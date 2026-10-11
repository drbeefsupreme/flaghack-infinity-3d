/** Minimal observable WebAudio graph for routing/scheduling tests; no audible-render claim. */
import { vi } from 'vitest';
export class TestParam {
  value = 1;
  events: { method: string; value: number; time: number; constant?: number }[] = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.events.push({ method: 'set', value, time }); }
  setTargetAtTime(value: number, time: number, constant: number) { this.value = value; this.events.push({ method: 'target', value, time, constant }); }
  linearRampToValueAtTime(value: number, time: number) { this.setValueAtTime(value, time); }
  exponentialRampToValueAtTime(value: number, time: number) { this.setValueAtTime(value, time); }
  cancelScheduledValues(_time: number) {}
}
export class TestNode {
  connections: TestNode[] = [];
  gain = new TestParam(); frequency = new TestParam(); Q = new TestParam(); detune = new TestParam();
  threshold = new TestParam(); knee = new TestParam(); ratio = new TestParam(); attack = new TestParam(); release = new TestParam();
  pan = new TestParam(); playbackRate = new TestParam(); positionX = new TestParam(); positionY = new TestParam(); positionZ = new TestParam();
  constructor(readonly kind: string) {}
  connect(node: TestNode) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start(_time: number) {} stop(_time: number) {}
}
export class TestAudioContext {
  static last: TestAudioContext;
  currentTime = 0; sampleRate = 8000; state = 'running'; destination = new TestNode('destination');
  listener = Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k => [k, new TestParam()]));
  nodes: TestNode[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  constructor() { TestAudioContext.last = this; }
  private node(kind: string) { const n = new TestNode(kind); this.nodes.push(n); return n; }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createBiquadFilter() { return this.node('filter'); }
  createConvolver() { return this.node('convolver'); }
  createStereoPanner() { return this.node('stereo'); }
  createPanner() { return this.node('panner'); }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('source'); }
  createWaveShaper() { return this.node('shaper'); }
  createBuffer(channels: number, length: number, rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel: number) => data[channel], duration: length / rate };
  }
}
