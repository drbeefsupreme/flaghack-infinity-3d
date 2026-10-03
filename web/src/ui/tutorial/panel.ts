/**
 * The mentor panel under the clock. It carries the Vexillosaint's transmission (portrait, name
 * plate, typewriter dialog, Continue), the lesson's objectives with progress bars and ticks,
 * the hint, the lesson controls (hint, restart, skip, course, and leave with a confirm), the
 * course track (one pip per lesson, plus a lesson list), and the Seal of Flagistan.
 *
 * Modes:
 * - 'dialog': briefing and debrief. Big portrait; objectives hidden.
 * - 'tracker': lesson running in action view. Medallion, latest remark, objectives.
 * - 'dock': Command View. The same tracker, compact, so the planning panels keep the screen.
 * Controls take clicks only while the cursor is free (Command View, or no pointer lock). With
 * the pointer locked the panel stays readable and Enter drives it.
 */
import type { TutorialLessonInfo, TutorialObjective, TutorialPhase, TutorialState } from '../../tutorial/types';
import type { UiHost } from '../core';
import { button, el, html, kbd, setAttr, setClass, setDisabled, setText, setVar, show } from '../dom';
import { iconSvg } from '../icons';
import { Dialog } from './dialog';
import { markupHtml } from './markup';
import { vexillosaintSvg } from './portrait';
import { SealView } from './seal';

export type PanelMode = 'dialog' | 'tracker' | 'dock';

/** What the panel's controls ask of the overlay (which owns the TutorialRun). */
export interface MentorActions {
  /** Enter / Continue: finish the line, show the next, else continue (or hint while active). */
  advance(): void;
  hint(): void;
  restart(): void;
  skip(): void;
  goTo(id: string): void;
  leave(): void;
}

type LessonEntry = TutorialState['lessons'][number];

/** Restart and skip glyphs drawn like the HUD icon set (24x24, line art on currentColor). */
const RESTART_SVG =
  '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 13.5a7.6 7.6 0 1 0 2.5-7.2"/><path d="M6.8 2.8v3.8h3.8"/></svg>';
const SKIP_SVG =
  '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5 11 12l-7 6.5zM11 5.5 18 12l-7 6.5z" fill="currentColor" fill-opacity=".25"/><path d="M20.5 5v14"/></svg>';
/** Objective checkbox: the tick draws itself (stroke-dashoffset) when the row turns done. */
const CHECK_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><rect class="tb-cb" x="2" y="2" width="16" height="16" rx="3.5"/><path class="tb-ck" d="M5.6 10.4 8.8 13.6 14.8 6.6"/></svg>';

const PLATE_NAME = 'The Vexillosaint';
const PLATE_SUB = 'transmitting from the Geomantic Command Center';
const LEAVE_CONFIRM_MS = 6000;
const LOCKED_REASON = 'That lesson is still ahead of you. The robe will not let me pretend otherwise.';

interface ObjectiveRow {
  li: HTMLElement;
  check: HTMLElement;
  text: HTMLElement;
  prog: HTMLElement;
  fill: HTMLElement;
  val: HTMLElement;
  src: string;
  done: boolean;
}

export class MentorPanel {
  private host: UiHost;
  private actions: MentorActions;
  readonly root: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private tools: HTMLElement;
  private hintBtn: HTMLButtonElement;
  private courseBtn: HTMLButtonElement;
  private portrait: HTMLElement;
  private dialog: Dialog;
  private award: HTMLElement;
  private dfoot: HTMLElement;
  private count: HTMLElement;
  private next: HTMLButtonElement;
  private objList: HTMLElement;
  private rows = new Map<string, ObjectiveRow>();
  private hintBox: HTMLElement;
  private hintText: HTMLElement;
  private hintSrc = '';
  private keys: HTMLElement;
  private keysSrc = '';
  private confirm: HTMLElement;
  private track: HTMLElement;
  private pips: HTMLButtonElement[] = [];
  private seal: SealView;
  private lessonsBox: HTMLElement;
  private lessonList: HTMLElement;
  private lessonRows: HTMLButtonElement[] = [];
  private lessons: readonly LessonEntry[] = [];

  private visible = false;
  /** The dialog line is on screen this tick (Enter advances it rather than the run). */
  private lineShown = false;
  private lessonId = '';
  private lessonsOpen = false;
  private confirmUntil = 0;
  /** The phase the beat on display began in: briefing lines are not mid-lesson remarks. */
  private beatPhase: TutorialPhase = 'briefing';

  constructor(host: UiHost, parent: HTMLElement, actions: MentorActions) {
    this.host = host;
    this.actions = actions;
    this.root = el('div', 'tb-panel plaque is-off', parent);
    this.root.setAttribute('data-mode', 'dialog');

    const head = el('div', 'tb-head', this.root);
    // "Lesson" drops out in the dock, where the title needs the room.
    const kicker = el('span', 'tb-kicker', head);
    el('span', 'tb-kw', kicker, 'Lesson ');
    this.kicker = el('span', '', kicker, '');
    this.title = el('span', 'tb-title', head, '');
    this.tools = el('div', 'tb-tools', head);
    this.hintBtn = button('tb-tool', this.tools, iconSvg('help'), () => this.actions.hint());
    this.hintBtn.title = 'Ask for a hint (Enter)';
    button('tb-tool', this.tools, RESTART_SVG, () => this.actions.restart()).title = 'Restart this lesson';
    button('tb-tool', this.tools, SKIP_SVG, () => this.actions.skip()).title = 'Skip this lesson';
    this.courseBtn = button('tb-tool', this.tools, iconSvg('book'), () => this.toggleLessons(), 'toggle');
    this.courseBtn.title = 'The course: revisit a lesson';
    button('tb-tool tb-leave', this.tools, iconSvg('close'), () => this.askLeave(), 'back').title = 'Leave the Training Burn';

    const body = el('div', 'tb-body', this.root);
    this.portrait = html('div', 'tb-portrait', vexillosaintSvg('vx'), body);
    el('i', 'tb-onair', this.portrait).title = 'Transmitting';
    const main = el('div', 'tb-main', body);
    const plate = el('div', 'tb-plate', main);
    el('b', 'tb-name', plate, PLATE_NAME);
    el('span', 'tb-sub', plate, PLATE_SUB);
    this.dialog = new Dialog(main, 'tb-line', host.app);
    this.dialog.tw.node.dataset.sfx = 'click';
    this.dialog.tw.node.addEventListener('click', () => this.actions.advance());
    this.award = el('div', 'tb-award', main);
    // Footer: the course track, then the key legend (pointer locked) or the line count and
    // Continue (dialog). Outside the dialog CSS moves it under everything else.
    this.dfoot = el('div', 'tb-dfoot', main);
    this.track = el('div', 'tb-track', this.dfoot);
    this.keys = el('div', 'tb-keys', this.dfoot);
    this.count = el('span', 'tb-count num', this.dfoot, '');
    this.next = button('btn btn-small btn-gold tb-next', this.dfoot, `Continue ${kbd('Enter')}`, () => this.actions.advance(), 'confirm');
    this.objList = el('ul', 'tb-objs', main);
    this.hintBox = el('div', 'tb-hint', main);
    html('span', 'tb-hint-ic', iconSvg('eye'), this.hintBox);
    this.hintText = el('span', 'tb-hint-t', this.hintBox, '');
    this.confirm = el('div', 'tb-confirm is-off', main);
    el('span', 'tb-confirm-q', this.confirm, 'Leave the Training Burn for the title?');
    button('btn btn-tiny btn-danger', this.confirm, 'Leave', () => this.actions.leave(), 'back');
    button(
      'btn btn-tiny',
      this.confirm,
      'Stay',
      () => {
        this.confirmUntil = 0;
      },
      'click',
    );

    this.seal = new SealView(body, 'tb-seal');
    this.seal.node.dataset.sfx = 'toggle';
    this.seal.node.title = 'The Seal of Flagistan: one fragment per lesson';
    this.seal.node.addEventListener('click', () => this.toggleLessons());

    this.lessonsBox = el('div', 'tb-lessons is-off', this.root);
    const lh = el('div', 'tb-lessons-head', this.lessonsBox);
    el('span', 'panel-title', lh, 'The Course');
    el('span', 'panel-sub', lh, 'Revisit any lesson you have reached');
    this.lessonList = el('div', 'tb-lessons-list', this.lessonsBox);
  }

  /** Enter / click on the dialog: false when the shown beat has nothing left (or none is shown). */
  advanceDialog(now: number): boolean {
    return this.lineShown && this.dialog.advance(now);
  }

  /** Render a new state snapshot. `awardFragment` is the lesson index (0-based) whose seal flies in. */
  sync(st: TutorialState, now: number, awardFragment: number): void {
    const lesson = st.lesson;
    if (lesson.id !== this.lessonId) {
      this.lessonId = lesson.id;
      for (const row of this.rows.values()) row.li.remove();
      this.rows.clear();
    }
    setAttr(this.root, 'data-phase', st.phase);
    setText(this.kicker, `${lesson.index} of ${st.lessons.length}`);
    setText(this.title, lesson.title);

    if (st.lines !== this.dialog.beat) this.beatPhase = st.phase;
    this.dialog.play(st.lines, now);

    const complete = st.phase === 'complete';
    show(this.award, complete);
    if (complete) setText(this.award, `Seal fragment ${lesson.index} of ${st.lessons.length}: ${lesson.seal}`);

    const active = st.phase === 'active';
    show(this.objList, active);
    if (active) this.syncObjectives(st.objectives);
    show(this.hintBox, active && st.hint !== null);
    if (st.hint !== null && st.hint !== this.hintSrc) {
      this.hintSrc = st.hint;
      this.hintText.innerHTML = markupHtml(st.hint);
      this.hintBox.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' });
    }
    if (st.hint === null) this.hintSrc = '';
    show(this.hintBtn, active);

    this.syncCourse(st.lessons, lesson);
    const earned: boolean[] = [];
    for (const l of st.lessons) earned.push(st.sealsEarned.includes(l.id));
    this.seal.sync(earned, awardFragment);
  }

  /**
   * Layout and interaction for this tick: mode, whether the cursor is free (clickable), and the
   * key legend. `phase` decides what Enter does when the beat is done.
   */
  view(mode: PanelMode, cursorFree: boolean, phase: TutorialPhase, now: number): void {
    setAttr(this.root, 'data-mode', mode);
    setClass(this.root, 'ix', cursorFree);
    setClass(this.root, 'locked', !cursorFree);
    show(this.tools, cursorFree);
    if (!cursorFree && this.lessonsOpen) this.lessonsOpen = false;
    setClass(this.courseBtn, 'on', this.lessonsOpen);
    show(this.lessonsBox, this.lessonsOpen && cursorFree);
    show(this.confirm, cursorFree && now < this.confirmUntil);

    // A briefing beat that rolled over into the lesson is not a remark: the tracker shows a line
    // only when the lesson itself spoke, and the dock never does.
    const remark = this.beatPhase === phase && this.dialog.count > 0;
    this.lineShown = mode === 'dialog' || (mode === 'tracker' && remark);
    setClass(this.root, 'quiet', !remark);
    setClass(this.root, 'ready', mode === 'dialog' && this.dialog.finished);
    setText(this.count, this.dialog.count > 1 ? `${this.dialog.index + 1} / ${this.dialog.count}` : '');

    let keys = '';
    if (!cursorFree) {
      const enter = this.lineShown && !this.dialog.finished ? 'Next' : phase === 'active' ? 'Hint' : 'Continue';
      keys = `${kbd('Enter')} ${enter}`;
      if (phase === 'active') keys += `<span class="tb-keys-sep"></span>${kbd('Tab')} Free the cursor`;
    }
    if (keys !== this.keysSrc) {
      this.keysSrc = keys;
      this.keys.innerHTML = keys;
    }
    show(this.keys, keys !== '' && mode !== 'dialog');
  }

  /** Per frame: typewriter and the portrait's mouth. */
  frame(now: number): void {
    this.dialog.frame(now);
    setClass(this.portrait, 'speaking', this.dialog.speaking);
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    show(this.root, on);
    if (on) return;
    this.dialog.stop();
    this.lessonsOpen = false;
    this.confirmUntil = 0;
  }

  dispose(): void {
    this.dialog.stop();
    this.root.remove();
  }

  private askLeave(): void {
    this.confirmUntil = performance.now() + LEAVE_CONFIRM_MS;
    show(this.confirm, true);
  }

  private toggleLessons(): void {
    this.lessonsOpen = !this.lessonsOpen;
    setClass(this.courseBtn, 'on', this.lessonsOpen);
    show(this.lessonsBox, this.lessonsOpen);
  }

  private pickLesson(i: number): void {
    const l = this.lessons[i];
    if (!l) return;
    if (l.status === 'locked') {
      this.host.blocked(LOCKED_REASON);
      return;
    }
    this.lessonsOpen = false;
    show(this.lessonsBox, false);
    this.actions.goTo(l.id);
  }

  private syncObjectives(objs: readonly TutorialObjective[]): void {
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      let row = this.rows.get(o.id);
      if (!row) {
        row = this.makeRow(o);
        this.rows.set(o.id, row);
      }
      if (this.objList.children[i] !== row.li) this.objList.insertBefore(row.li, this.objList.children[i] ?? null);
      if (o.text !== row.src) {
        row.src = o.text;
        row.text.innerHTML = markupHtml(o.text);
      }
      const p = o.progress;
      show(row.prog, p !== undefined && !o.done);
      if (p) {
        setVar(row.fill, '--p', (p.target > 0 ? Math.min(1, p.value / p.target) : 0).toFixed(3));
        setText(row.val, `${Math.min(p.value, p.target)}/${p.target}`);
      }
      if (o.done !== row.done) {
        row.done = o.done;
        setClass(row.li, 'done', o.done);
        if (o.done) this.tick(row);
      }
    }
    if (this.rows.size === objs.length) return;
    for (const [id, row] of this.rows) {
      if (objs.some((o) => o.id === id)) continue;
      row.li.remove();
      this.rows.delete(id);
    }
  }

  private makeRow(o: TutorialObjective): ObjectiveRow {
    const li = el('li', `tb-obj${o.done ? ' done' : ''}`);
    const check = html('span', 'tb-check', CHECK_SVG, li);
    const mid = el('div', 'tb-obj-main', li);
    const text = el('span', 'tb-obj-t', mid);
    const prog = el('div', 'tb-obj-prog', mid);
    const bar = el('div', 'bar', prog);
    const fill = el('i', '', bar);
    const val = el('span', 'tb-obj-v num', prog, '');
    return { li, check, text, prog, fill, val, src: '', done: o.done };
  }

  /** The satisfying part: the tick draws itself (CSS), the box pops and the row flashes gold. */
  private tick(row: ObjectiveRow): void {
    row.check.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: 0.35 }, { transform: 'scale(1)' }], {
      duration: 520,
      easing: 'cubic-bezier(.3,1.5,.5,1)',
    });
    row.li.animate(
      [
        { backgroundPosition: '120% 0', opacity: 1 },
        { backgroundPosition: '-20% 0', opacity: 1 },
      ],
      { duration: 900, easing: 'ease-out' },
    );
    this.host.app.audio.uiToggle(true);
  }

  private syncCourse(lessons: readonly LessonEntry[], current: TutorialLessonInfo): void {
    this.lessons = lessons;
    if (this.pips.length !== lessons.length) {
      this.track.textContent = '';
      this.lessonList.textContent = '';
      // Two columns, filled top to bottom, keep the list short enough to clear the bottom panels.
      this.lessonList.style.setProperty('--rows', String(Math.ceil(lessons.length / 2)));
      this.pips = [];
      this.lessonRows = [];
      for (let i = 0; i < lessons.length; i++) {
        this.pips.push(button('tb-pip', this.track, '', () => this.pickLesson(i), 'pick'));
        const row = button('tb-lrow', this.lessonList, '', () => this.pickLesson(i), 'pick');
        el('span', 'tb-lrow-s', row);
        el('span', 'tb-lrow-n num', row, String(lessons[i].index));
        const name = el('span', 'tb-lrow-name', row);
        el('span', 'tb-lrow-t', name, lessons[i].title);
        el('span', 'tb-lrow-seal', name, lessons[i].seal);
        this.lessonRows.push(row);
      }
    }
    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      const status = l.status === 'done' ? 'sealed' : l.id === current.id ? 'now' : l.status === 'locked' ? 'ahead' : 'reached';
      const tip = `${l.index}. ${l.title}: ${status}`;
      for (const n of [this.pips[i], this.lessonRows[i]]) {
        setClass(n, 'done', l.status === 'done');
        setClass(n, 'cur', l.id === current.id);
        setClass(n, 'locked', l.status === 'locked');
        setDisabled(n, l.status === 'locked');
        setAttr(n, 'title', tip);
      }
    }
  }
}
