/**
 * Training Burn director: lesson state machine, world staging, scripted rivals, objective
 * detection, hints, world markers (Session.markers). Local matches only (mode 'tutorial').
 * Owner: Tutorial agent.
 */
import type { Session } from '../game/session';
import type { World } from '../sim/world';
import type { TutorialDriver } from './types';

export interface TutorialHooks {
  /** Leave the Training Burn for the title screen. */
  exitToTitle(): void;
}

export function createTutorial(world: World, session: Session, hooks: TutorialHooks): TutorialDriver {
  const lesson = { id: 'arrival', index: 1, title: 'Arrival', seal: 'arrival' };
  const state = {
    version: 0,
    phase: 'briefing' as const,
    lesson,
    lessons: [{ ...lesson, status: 'current' as const }],
    lines: [],
    objectives: [],
    hint: null,
    highlights: [],
    sealsEarned: [],
  };
  void world;
  void session;
  return {
    state,
    continue() {},
    requestHint() {},
    skipLesson() {},
    restartLesson() {},
    goToLesson() {},
    exit: () => hooks.exitToTitle(),
    tick() {},
    update() {},
    dispose() {},
  };
}
