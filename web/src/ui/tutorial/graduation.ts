/**
 * Graduation (phase 'graduated'): over a slow sunburst, the whole Seal of Flagistan assembles
 * fragment by fragment inside a turning halo of Flags. The Vexillosaint says farewell, and the
 * player chooses a real burn or the title. Enter finishes or advances the farewell, then starts
 * the burn.
 */
import type { TutorialState } from '../../tutorial/types';
import type { UiHost } from '../core';
import { button, el, fmtClock, html, kbd, setClass, setText, show } from '../dom';
import { Dialog } from './dialog';
import { vexillosaintSvg } from './portrait';
import { SealView } from './seal';

const LORE =
  'Swag of the Survey, earned through the tasks that create Flagistan. United, the Seals of Flagistan form one Seal: a feat only ever accomplished by a single Signifier. Make that two.';

const HALO_FLAGS = 18;

/** A ring of small yellow Flags around the Seal (turned by CSS). */
function haloSvg(): string {
  let flags = '';
  for (let i = 0; i < HALO_FLAGS; i++) {
    flags +=
      `<g transform="rotate(${(i * 360) / HALO_FLAGS})">` +
      '<path class="tb-gh-pole" d="M0 -112V-126"/>' +
      '<path class="tb-gh-cloth" d="M.6 -125.6c2.6-1.4 5 1.3 8.2 0v5c-3.2 1.3-5.6-1.4-8.2 0z"/></g>';
  }
  return `<svg class="tb-gh" viewBox="-132 -132 264 264" aria-hidden="true"><circle class="tb-gh-ring" r="110"/>${flags}</svg>`;
}

export class GraduationScreen {
  private host: UiHost;
  private root: HTMLElement;
  private seal: SealView;
  private dialog: Dialog;
  private portrait: HTMLElement;
  private stats: HTMLElement;
  private play: HTMLButtonElement;
  private open = false;

  constructor(host: UiHost, parent: HTMLElement, onTitle: () => void) {
    this.host = host;
    this.root = el('div', 'modal tb-grad ix is-off', parent);
    const box = el('div', 'modal-box tb-grad-box', this.root);
    el('div', 'tb-grad-kicker', box, 'Training Burn complete');
    const sealWrap = el('div', 'tb-grad-sealwrap', box);
    el('div', 'tb-grad-rays', sealWrap);
    html('div', 'tb-grad-halo', haloSvg(), sealWrap);
    this.seal = new SealView(sealWrap, 'tb-grad-seal');
    el('h1', 'tb-grad-title', box, 'The Seal of Flagistan');
    el('p', 'tb-grad-lore', box, LORE);
    const mentor = el('div', 'tb-grad-mentor', box);
    this.portrait = html('div', 'tb-portrait', vexillosaintSvg('vx'), mentor);
    const say = el('div', 'tb-grad-say', mentor);
    el('div', 'tb-grad-name', say, 'The Vexillosaint');
    this.dialog = new Dialog(say, 'tb-line', host.app);
    this.dialog.tw.node.dataset.sfx = 'click';
    this.dialog.tw.node.addEventListener('click', () => this.dialog.advance(performance.now()));
    this.stats = el('div', 'tb-grad-stats', box, '');
    const row = el('div', 'end-buttons tb-grad-buttons', box);
    this.play = button('btn btn-primary', row, `Play a burn ${kbd('Enter')}`, () => this.playBurn(), 'confirm');
    button('btn', row, 'Title', onTitle, 'back');
  }

  /** Shown from the first tick of graduation; the Seal assembles once per opening. */
  update(st: TutorialState | null, visible: boolean, courseTime: number, now: number): void {
    const on = visible && st !== null && st.phase === 'graduated';
    show(this.root, on);
    if (!on || !st) {
      if (this.open) this.dialog.stop();
      this.open = false;
      return;
    }
    if (!this.open) {
      this.open = true;
      const earned = st.lessons.map((l) => st.sealsEarned.includes(l.id));
      const count = earned.filter(Boolean).length;
      this.seal.assemble(earned);
      const seals = count === earned.length ? `${count}` : `${count} of ${earned.length}`;
      setText(this.stats, `${seals} Seals of Flagistan · Course time ${fmtClock(courseTime)}`);
    }
    this.dialog.play(st.lines, now);
    setClass(this.play, 'ready', this.dialog.finished);
  }

  frame(now: number): void {
    if (!this.open) return;
    this.dialog.frame(now);
    setClass(this.portrait, 'speaking', this.dialog.speaking);
  }

  /** Enter: finish or advance the farewell, then start a real burn. */
  enter(now: number): boolean {
    if (!this.open) return false;
    if (!this.dialog.advance(now)) this.playBurn();
    return true;
  }

  dispose(): void {
    this.dialog.stop();
    this.root.remove();
  }

  private playBurn(): void {
    this.host.veiledLoad(() => this.host.app.startMatch());
  }
}
