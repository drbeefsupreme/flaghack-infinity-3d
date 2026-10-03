/**
 * How a Training Burn lesson is written. A script is static text (briefing, objectives,
 * debrief) plus `begin`, which stages the world when the trainee continues past the briefing
 * and returns the live run the director polls: objective progress every sim tick, the
 * frame's events, and cleanup when the lesson ends either way.
 */
import type { ObjectiveMarker, Session } from '../game/session';
import type { GameEvent } from '../sim/events';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import type { TutorialLine, TutorialTarget } from './types';

export interface ObjectiveSpec {
  readonly id: string;
  /** Markup: `**bold**` and `{key:E}`. */
  readonly text: string;
  /** Shown on request or after the trainee idles on this objective. */
  readonly hint: string;
  readonly highlights?: readonly TutorialTarget[];
  /** Progress shown as value/target when above 1 (default 1: plain done/not done). */
  readonly target?: number;
}

/** What a lesson's run may do to the director's presentation. */
export interface LessonContext {
  readonly world: World;
  readonly session: Session;
  /** The trainee's faction. */
  readonly f: FactionId;
  /** Replace the lesson's world markers ([] clears them). */
  mark(markers: ObjectiveMarker[]): void;
  /** A mid-lesson remark from the Vexillosaint. */
  say(text: string): void;
}

export interface LessonRun {
  /** Objective `i` just became current: stage what it needs (markers, grants, arrivals). */
  activate?(i: number): void;
  /**
   * Progress of the current objective `i`, 0..target; reaching its target completes it.
   * Called every sim tick: no allocation.
   */
  progress(i: number): number;
  /** Every sim tick while the lesson is live, before the objective check (scripted rivals). */
  tick?(): void;
  /** Each event of the frame while the lesson is live. */
  event?(e: GameEvent): void;
  /** The lesson is over (completed, skipped or restarted): undo staging that must not outlive it. */
  end?(completed: boolean): void;
}

export interface LessonScript {
  /** Matches the course entry (course.ts). */
  readonly id: string;
  readonly briefing: readonly TutorialLine[];
  readonly objectives: readonly ObjectiveSpec[];
  readonly debrief: readonly TutorialLine[];
  /** UI elements pulsed while the briefing plays. */
  readonly briefingHighlights?: readonly TutorialTarget[];
  begin(ctx: LessonContext): LessonRun;
}

/** A Vexillosaint line. */
export function saint(text: string): TutorialLine {
  return { speaker: 'vexillosaint', text };
}

/** A narrator line (italic, unvoiced). */
export function narrate(text: string): TutorialLine {
  return { speaker: 'narrator', text };
}
