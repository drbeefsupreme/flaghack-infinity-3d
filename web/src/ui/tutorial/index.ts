/**
 * The Training Burn's teacher UI. It renders `app.tutorial` (TutorialRun, tutorial/types.ts)
 * and drives its controls:
 * - the mentor panel under the clock (panel.ts),
 * - lesson highlights on the HUD elements tagged `data-tutorial` (highlights.ts),
 * - edge arrows for off-screen objective markers (pointers.ts),
 * - the graduation screen (graduation.ts).
 * Audio: the UI is the only caller of the mentor voice and the seal and graduation fanfares.
 * Keys: Enter advances the mentor. Never Space: Space jumps.
 * Owner: TutorialUI agent. ui.ts registers it and must call `frame()` every frame (typewriter,
 * pointers). State is synced at the UI tick, and at once after this part calls a control.
 */
import type { World } from '../../sim/world';
import type { TutorialPhase, TutorialRun, TutorialTarget } from '../../tutorial/types';
import type { UiHost, UiLayout, UiPart } from '../core';
import { GraduationScreen } from './graduation';
import { Highlights } from './highlights';
import { MentorPanel, type MentorActions, type PanelMode } from './panel';
import { OffscreenPointers } from './pointers';
import './tutorial.css';

const NO_HIGHLIGHTS: readonly TutorialTarget[] = [];

export class TutorialOverlay implements UiPart {
  private host: UiHost;
  private panel: MentorPanel;
  private pointers: OffscreenPointers;
  private highlights: Highlights;
  private grad: GraduationScreen;
  /** The zoomed HUD layer: its inline zoom maps window px to HUD design px. */
  private zoomed: HTMLElement | null;
  private run: TutorialRun | null = null;
  private version = -1;
  private phase: TutorialPhase | null = null;
  /** The burn is playing with the mentor in charge: pointers and Enter are live. */
  private live = false;

  constructor(host: UiHost, layout: UiLayout) {
    this.host = host;
    const actions: MentorActions = {
      advance: () => this.advance(),
      hint: () => this.control((r) => r.requestHint()),
      restart: () => this.control((r) => r.restartLesson()),
      skip: () => this.control((r) => r.skipLesson()),
      goTo: (id) => this.control((r) => r.goToLesson(id)),
      leave: () => this.leave(),
    };
    this.panel = new MentorPanel(host, layout.topCenter, actions);
    this.pointers = new OffscreenPointers(layout.center);
    this.highlights = new Highlights(layout.overlay);
    this.grad = new GraduationScreen(host, layout.overlay, () => this.leave());
    this.zoomed = layout.overlay.parentElement;
    window.addEventListener('keydown', this.onKey);
  }

  update(_world: World | null, now: number): void {
    const app = this.host.app;
    const s = app.session;
    if (app.tutorial !== this.run) {
      this.run = app.tutorial;
      this.version = -1;
      this.phase = null;
    }
    if (this.zoomed) this.pointers.measure(Number.parseFloat(this.zoomed.style.zoom) || 1);
    const st = this.run ? this.run.state : null;
    const inBurn = st !== null && (s.screen === 'playing' || s.screen === 'paused');
    const graduated = st !== null && st.phase === 'graduated';
    const p = s.panels;
    const modal = p.chakras || p.codex || p.help || p.settings;
    this.panel.setVisible(inBurn && !graduated);
    this.grad.update(st, inBurn && !p.codex && !p.settings, app.world ? app.world.time : 0, now);
    this.live = inBurn && s.screen === 'playing' && !modal && !graduated;
    this.highlights.set(this.live && st ? st.highlights : NO_HIGHLIGHTS);
    if (!st || !inBurn) return;
    this.refresh(now);
    const mode: PanelMode =
      st.phase === 'briefing' || st.phase === 'complete' ? 'dialog' : s.view === 'command' ? 'dock' : 'tracker';
    this.panel.view(mode, s.view === 'command' || !s.pointerLocked, st.phase, now);
  }

  /** Every frame: typewriter, portrait and off-screen pointers. */
  frame(now: number): void {
    this.panel.frame(now);
    this.grad.frame(now);
    this.pointers.frame(this.host.app, this.live);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.panel.dispose();
    this.pointers.dispose();
    this.highlights.dispose();
    this.grad.dispose();
  }

  /** Apply a new state snapshot: phase changes award seals and sound the fanfares. */
  private refresh(now: number): void {
    const st = this.run ? this.run.state : null;
    if (!st || st.version === this.version) return;
    this.version = st.version;
    let award = -1;
    if (st.phase !== this.phase) {
      const audio = this.host.app.audio;
      if (st.phase === 'complete') {
        award = st.lessons.findIndex((l) => l.id === st.lesson.id);
        audio.sealAwarded(st.lesson.index - 1);
      } else if (st.phase === 'graduated') audio.graduation();
      this.phase = st.phase;
    }
    this.panel.sync(st, now, award);
  }

  /** Call a run control, then show its result without waiting for the next UI tick. */
  private control(fn: (run: TutorialRun) => void): void {
    const run = this.run;
    if (!run) return;
    fn(run);
    this.refresh(performance.now());
  }

  /** Enter or Continue: finish the line, show the next one, else continue (a hint while the lesson runs). */
  private advance(): void {
    const run = this.run;
    if (!run || this.panel.advanceDialog(performance.now())) return;
    const phase = run.state.phase;
    if (phase === 'briefing' || phase === 'complete') this.control((r) => r.continue());
    else if (phase === 'active') this.control((r) => r.requestHint());
  }

  private leave(): void {
    const run = this.run;
    if (run) this.host.veiledLoad(() => run.exit());
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const t = ev.target;
    // Fields and focused buttons handle their own Enter.
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLButtonElement || (t instanceof HTMLElement && t.isContentEditable)) return;
    const st = this.run ? this.run.state : null;
    if (!st) return;
    let used = false;
    if (st.phase === 'graduated') used = this.grad.enter(performance.now());
    else if (this.live) {
      this.advance();
      used = true;
    }
    if (used) ev.preventDefault();
  };
}
