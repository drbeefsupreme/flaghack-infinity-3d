/**
 * Training Burn director: the lesson state machine behind TutorialDriver. Each lesson goes
 * briefing → active → complete; continuing from complete briefs the next, and after the last
 * the trainee graduates. A lesson's script (lessons/) stages the world when it goes live and
 * reports objective progress from world state and events (never from UI clicks); the director
 * walks the objectives in order, raises hints after HINT_IDLE seconds stuck (or on request),
 * owns the world markers (Session.markers) and UI highlights, awards Seal of Flagistan
 * fragments and remembers them (progress.ts).
 * Local matches only (mode 'tutorial'). Owner: Tutorial agent.
 */
import type { ObjectiveMarker, Session } from '../game/session';
import type { GameEvent } from '../sim/events';
import { TRAINING_PLAYER } from '../sim/scenarios/tutorial';
import type { World } from '../sim/world';
import { COURSE } from './course';
import { narrate, saint } from './lesson';
import type { LessonContext, LessonRun } from './lesson';
import { LESSONS } from './lessons';
import { loadTraining, saveTraining } from './progress';
import type {
  TutorialDriver,
  TutorialLessonInfo,
  TutorialLine,
  TutorialObjective,
  TutorialPhase,
  TutorialState,
  TutorialTarget,
} from './types';

export interface TutorialHooks {
  /** Leave the Training Burn for the title screen. */
  exitToTitle(): void;
}

/** Seconds (sim time) stuck on one objective before its hint shows by itself. */
const HINT_IDLE = 25;

const NO_LINES: readonly TutorialLine[] = Object.freeze([]);
const NO_TARGETS: readonly TutorialTarget[] = Object.freeze([]);
const NO_OBJECTIVES: readonly TutorialObjective[] = Object.freeze([]);

const WELCOME_BACK = saint('Welcome back to the Training Burn. We pick up where you left off; every lesson you have finished stays open on the course.');

const GRADUATED_WHOLE: readonly TutorialLine[] = [
  saint('The Seal of Flagistan is whole, and so, for now, are you. Go and complete the Survey.'),
  saint('Look to the centre of the burn: I have lit **The Burn** early, so you will know it when you see it. "The man burns away but flag remains."'),
  saint('Stay as long as you like. When you are ready, leave the Training Burn and start a real one.'),
];

const GRADUATED_PARTIAL: readonly TutorialLine[] = [
  saint('You have walked the whole course, but the Seal of Flagistan still has gaps. Every skipped lesson waits for you on the course.'),
  saint('Look to the centre of the burn: I have lit **The Burn** early, so you will know it when you see it. "The man burns away but flag remains."'),
];

export function createTutorial(world: World, session: Session, hooks: TutorialHooks): TutorialDriver {
  return new Director(world, session, hooks);
}

class Director implements TutorialDriver {
  private readonly world: World;
  private readonly session: Session;
  private readonly hooks: TutorialHooks;
  private readonly context: LessonContext;
  /** Lesson ids whose Seal fragment is earned (this burn or a saved earlier one). */
  private readonly sealed = new Set<string>();
  /** Lessons reached and left in this burn (skipped ones too): open on the course. */
  private readonly visited = new Set<number>();
  private graduated: boolean;

  private phase: TutorialPhase = 'briefing';
  private index = 0;
  private run: LessonRun | null = null;
  /** Current objective while active (all done while complete). */
  private objective = 0;
  /** Reported progress per objective of the live lesson. */
  private progressOf: number[] = [];
  private lines: readonly TutorialLine[] = NO_LINES;
  private hint: string | null = null;
  private highlights: readonly TutorialTarget[] = NO_TARGETS;
  /** world.time the current objective went live or last moved. */
  private stuckSince = 0;

  private dirty = true;
  private version = 0;
  private snapshot: TutorialState | null = null;
  private disposed = false;

  constructor(world: World, session: Session, hooks: TutorialHooks) {
    this.world = world;
    this.session = session;
    this.hooks = hooks;
    this.context = {
      world,
      session,
      f: TRAINING_PLAYER,
      mark: (markers: ObjectiveMarker[]) => {
        this.session.markers = markers;
      },
      say: (text: string) => {
        this.lines = [saint(text)];
        this.touch();
      },
    };
    const record = loadTraining();
    for (const id of record.seals) this.sealed.add(id);
    this.graduated = record.graduated;
    const first = COURSE.findIndex((l) => !this.sealed.has(l.id));
    this.brief(first >= 0 ? first : 0);
    if (this.sealed.size > 0 && first > 0) this.lines = [WELCOME_BACK, ...this.lines];
  }

  get state(): TutorialState {
    return this.dirty || !this.snapshot ? this.publish() : this.snapshot;
  }

  // ── TutorialRun ─────────────────────────────────────────────────────────────

  continue(): void {
    if (this.disposed) return;
    if (this.phase === 'briefing') this.activate();
    else if (this.phase === 'complete') this.advance();
  }

  requestHint(): void {
    if (this.disposed || this.phase !== 'active') return;
    const spec = LESSONS[this.index].objectives[this.objective];
    if (!spec || this.hint === spec.hint) return;
    this.hint = spec.hint;
    this.touch();
  }

  skipLesson(): void {
    if (this.disposed || this.phase === 'graduated') return;
    this.advance();
  }

  restartLesson(): void {
    if (this.disposed || this.phase === 'graduated') return;
    this.brief(this.index);
  }

  goToLesson(id: string): void {
    if (this.disposed) return;
    const i = COURSE.findIndex((l) => l.id === id);
    if (i < 0 || !this.reachable(i)) return;
    if (this.phase !== 'graduated') this.visited.add(this.index);
    this.brief(i);
  }

  exit(): void {
    this.hooks.exitToTitle();
  }

  // ── TutorialDriver ──────────────────────────────────────────────────────────

  tick(): void {
    const run = this.run;
    if (this.disposed || this.phase !== 'active' || !run) return;
    run.tick?.();
    if (this.run !== run || this.phase !== 'active') return;
    const spec = LESSONS[this.index].objectives[this.objective];
    const target = spec.target ?? 1;
    const value = Math.min(target, run.progress(this.objective));
    if (value !== this.progressOf[this.objective]) {
      this.progressOf[this.objective] = value;
      this.stuckSince = this.world.time;
      this.touch();
    }
    if (value >= target) {
      // One objective per tick: the next one is checked from the next tick on.
      if (this.objective + 1 < this.progressOf.length) this.enterObjective(this.objective + 1);
      else this.complete();
      return;
    }
    if (this.hint === null && this.world.time - this.stuckSince >= HINT_IDLE) {
      this.hint = spec.hint;
      this.touch();
    }
  }

  update(dt: number, events: readonly GameEvent[]): void {
    const run = this.run;
    if (this.disposed || this.phase !== 'active' || !run?.event) return;
    for (const e of events) {
      run.event(e);
      if (this.run !== run) return;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.endRun(false);
    this.disposed = true;
  }

  // ── Lesson flow ─────────────────────────────────────────────────────────────

  /** Open lesson `i` at its briefing, ending whatever lesson was live. */
  private brief(i: number): void {
    this.endRun(false);
    const script = LESSONS[i];
    this.index = i;
    this.phase = 'briefing';
    this.objective = 0;
    this.progressOf = [];
    this.lines = script.briefing.slice();
    this.hint = null;
    this.highlights = script.briefingHighlights ?? NO_TARGETS;
    this.touch();
  }

  /** Briefing → active: stage the lesson and put its first objective up. */
  private activate(): void {
    const script = LESSONS[this.index];
    this.phase = 'active';
    this.progressOf = script.objectives.map(() => 0);
    this.lines = [];
    this.run = script.begin(this.context);
    this.enterObjective(0);
  }

  private enterObjective(i: number): void {
    const spec = LESSONS[this.index].objectives[i];
    this.objective = i;
    this.stuckSince = this.world.time;
    this.hint = null;
    this.highlights = spec.highlights ?? NO_TARGETS;
    this.touch();
    this.run?.activate?.(i);
  }

  /** Every objective done: the Seal fragment is earned and remembered. */
  private complete(): void {
    const script = LESSONS[this.index];
    const info = COURSE[this.index];
    this.endRun(true);
    this.phase = 'complete';
    this.objective = script.objectives.length;
    this.sealed.add(info.id);
    this.visited.add(this.index);
    this.save();
    this.lines = [...script.debrief, narrate(`You earn **${info.seal}**, a fragment of the Seal of Flagistan.`)];
    this.hint = null;
    this.highlights = NO_TARGETS;
    this.touch();
  }

  /** On to the next lesson's briefing, or graduation after the last. */
  private advance(): void {
    this.visited.add(this.index);
    if (this.index + 1 < LESSONS.length) {
      this.brief(this.index + 1);
      return;
    }
    this.endRun(false);
    this.phase = 'graduated';
    this.graduated = true;
    this.save();
    this.lines = (this.sealed.size === COURSE.length ? GRADUATED_WHOLE : GRADUATED_PARTIAL).slice();
    this.hint = null;
    this.highlights = NO_TARGETS;
    this.lightTheBurn();
    this.touch();
  }

  /** The graduation spectacle: The Burn, early (the Training Burn has no clock of its own). */
  private lightTheBurn(): void {
    const world = this.world;
    if (world.suddenDeath) return;
    world.suddenDeath = true;
    world.emit({ t: 'burn' });
  }

  private endRun(completed: boolean): void {
    const run = this.run;
    this.run = null;
    run?.end?.(completed);
    this.session.markers = [];
  }

  private reachable(i: number): boolean {
    return (i === this.index && this.phase !== 'graduated') || this.visited.has(i) || this.sealed.has(COURSE[i].id);
  }

  private save(): void {
    saveTraining({ seals: COURSE.filter((l) => this.sealed.has(l.id)).map((l) => l.id), graduated: this.graduated });
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private touch(): void {
    this.dirty = true;
  }

  private publish(): TutorialState {
    this.dirty = false;
    this.version++;
    const script = LESSONS[this.index];
    const lessons = COURSE.map((l, i): TutorialLessonInfo & { status: 'locked' | 'current' | 'done' } => ({
      ...l,
      status: i === this.index && this.phase !== 'graduated' ? 'current' : this.reachable(i) ? 'done' : 'locked',
    }));
    const objectives: readonly TutorialObjective[] =
      this.phase === 'active' || this.phase === 'complete'
        ? script.objectives.map((spec, i): TutorialObjective => {
            const target = spec.target ?? 1;
            const done = i < this.objective;
            const value = done ? target : (this.progressOf[i] ?? 0);
            return target > 1 ? { id: spec.id, text: spec.text, done, progress: { value, target } } : { id: spec.id, text: spec.text, done };
          })
        : NO_OBJECTIVES;
    const snapshot: TutorialState = Object.freeze({
      version: this.version,
      phase: this.phase,
      lesson: COURSE[this.index],
      lessons,
      lines: this.lines,
      objectives,
      hint: this.hint,
      highlights: this.highlights,
      sealsEarned: COURSE.filter((l) => this.sealed.has(l.id)).map((l) => l.id),
    });
    this.snapshot = snapshot;
    return snapshot;
  }
}
