/** Licensed, same-origin boss vocals. See public/audio/boss/CREDITS.md. */
export type BossVocal = 'emerge' | 'roar' | 'growl';
const FILES: Record<BossVocal, string> = {
  emerge: 'cgeffex-trex-roar.mp3', roar: 'ecfike-monster-low-roar.mp3', growl: '123agumon-dinosaur-growl.mp3',
};
/** One fetch/decode per AudioContext; decoding never occurs in the frame loop. */
export class BossSamples {
  private readonly buffers = new Map<BossVocal, AudioBuffer>();
  readonly ready: Promise<void>;
  constructor(ctx: BaseAudioContext) {
    this.ready = Promise.all((Object.keys(FILES) as BossVocal[]).map(async cue => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/boss/${FILES[cue]}`);
        if (!response.ok) return;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        // Peak-normalize once, preserving the chosen performance and its dynamics.
        let peak = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch);
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        }
        if (peak > 0) for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch), gain = .85 / peak;
          for (let i = 0; i < data.length; i++) data[i] *= gain;
        }
        this.buffers.set(cue, buffer);
      } catch { /* Offline/missing asset: skip, never replay a stale cue after loading. */ }
    })).then(() => {});
  }
  get(cue: BossVocal): AudioBuffer | undefined { return this.buffers.get(cue); }
}
