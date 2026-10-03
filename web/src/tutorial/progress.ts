/**
 * Training Burn progress saved across sessions (localStorage `fh.training.v1`): the lesson ids
 * whose Seal of Flagistan fragment was earned, and whether the trainee has graduated (walked the
 * whole course; skipped lessons leave gaps in the Seal). Every access is
 * guarded, so Node tests and locked-down browsers simply see a fresh course.
 */
import { COURSE } from './course';

export const TRAINING_KEY = 'fh.training.v1';

/** The stored shape: JSON `{ "seals": string[], "graduated": boolean }`. */
export interface TrainingRecord {
  seals: string[];
  /** Reached Graduation, skipped lessons or not; the Seal is whole only when every lesson is sealed. */
  graduated: boolean;
}

/** Summary for the title screen ("Seals 5/12", the first-timer nudge). */
export interface TrainingProgress {
  graduated: boolean;
  seals: number;
  total: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some privacy modes throw on the mere access.
    return null;
  }
}

/** The saved record, keeping only known lesson ids in course order; a fresh one when absent or corrupt. */
export function loadTraining(): TrainingRecord {
  const fresh: TrainingRecord = { seals: [], graduated: false };
  const raw = storage()?.getItem(TRAINING_KEY);
  if (!raw) return fresh;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (typeof parsed !== 'object' || parsed === null) return fresh;
  const seals = 'seals' in parsed && Array.isArray(parsed.seals) ? parsed.seals : [];
  const known = new Set(seals.filter((s): s is string => typeof s === 'string'));
  return {
    seals: COURSE.filter((l) => known.has(l.id)).map((l) => l.id),
    graduated: 'graduated' in parsed && parsed.graduated === true,
  };
}

export function saveTraining(record: TrainingRecord): void {
  try {
    storage()?.setItem(TRAINING_KEY, JSON.stringify({ seals: record.seals, graduated: record.graduated }));
  } catch {
    // Quota or privacy mode: progress simply is not remembered.
  }
}

export function readTrainingProgress(): TrainingProgress {
  const record = loadTraining();
  return { graduated: record.graduated, seals: record.seals.length, total: COURSE.length };
}
