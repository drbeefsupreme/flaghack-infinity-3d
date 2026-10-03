/** Faction helpers shared by the Survey & conquest systems (flags, survey, capture, …). */
import type { FactionId } from '../../types';

/** Narrow a raw survey-array value or an Owner to a faction id (rejects NEUTRAL / -1). */
export function isFactionId(v: number): v is FactionId {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** Short names for lore-voice narration ("Dr. Crow's Hearth is contained. Hold the loop!"). */
export const FACTION_SHORT: Record<FactionId, string> = {
  0: 'Dr. Beef',
  1: 'Dr. Crow',
  2: 'DJ Scarecrow',
  3: 'President Jaguar',
};
