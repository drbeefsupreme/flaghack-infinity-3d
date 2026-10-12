/** Single mix contract for the in-game voices and reproducible offline preview. */
import type { BossCue } from './bossSynth';
export const BOSS_VOICE_MIX: Record<BossCue, { gain: number; wet: number; duckAmount: number; duckHold: number }> = {
  swipeWindup: { gain: .85, wet: .16, duckAmount: .04, duckHold: .3 },
  stompWindup: { gain: .9, wet: .2, duckAmount: .05, duckHold: .5 },
  grabWindup: { gain: .85, wet: .18, duckAmount: .04, duckHold: .5 },
  emerge: { gain: 1.3, wet: .65, duckAmount: .25, duckHold: 1.5 },
  death: { gain: 1.3, wet: .7, duckAmount: .25, duckHold: 2 },
  step: { gain: 1.3, wet: .35, duckAmount: .12, duckHold: .18 },
  stomp: { gain: 1.3, wet: .5, duckAmount: .22, duckHold: .45 },
  charge: { gain: 1.17, wet: .28, duckAmount: .18, duckHold: 3 },
  beam: { gain: 1.3, wet: .4, duckAmount: .25, duckHold: 5 },
  impact: { gain: 1.3, wet: .65, duckAmount: .3, duckHold: .65 },
  crush: { gain: 1.3, wet: .45, duckAmount: .18, duckHold: .35 },
};
