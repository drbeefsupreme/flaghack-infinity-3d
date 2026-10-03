/**
 * Lesson highlights (TutorialState.highlights). The main UI tags its elements with
 * `data-tutorial="<id>"` (TUTORIAL_TARGETS). The overlay writes the active ids into a
 * `data-tut-hl` attribute on the UI root, and one generated rule per target pulses the matching
 * elements. Doing it in CSS keeps it robust: a hidden or absent element simply shows nothing,
 * and an element the UI rebuilds picks the pulse up at once. There is no per-tick DOM query.
 */
import { TUTORIAL_TARGETS, type TutorialTarget } from '../../tutorial/types';

const SELECTORS = TUTORIAL_TARGETS.map((t) => `.fh-root[data-tut-hl~="${t}"] [data-tutorial="${t}"]`).join(',\n');

/** The pulse itself (keyframes tb-hl live in tutorial.css). */
const RULE = `${SELECTORS} {
  outline: 2px solid rgba(255, 212, 0, 0.95);
  outline-offset: 3px;
  animation: tb-hl 1.25s ease-in-out infinite;
}`;

export class Highlights {
  private root: Element | null;
  private style: HTMLStyleElement;
  private key = '';

  /** `anchor`: any node inside the UI root. */
  constructor(anchor: Element) {
    this.root = anchor.closest('.fh-root');
    this.style = document.createElement('style');
    this.style.dataset.owner = 'training-highlights';
    this.style.textContent = RULE;
    document.head.appendChild(this.style);
  }

  set(ids: readonly TutorialTarget[]): void {
    const key = ids.join(' ');
    if (key === this.key || !this.root) return;
    this.key = key;
    if (key) this.root.setAttribute('data-tut-hl', key);
    else this.root.removeAttribute('data-tut-hl');
  }

  dispose(): void {
    this.set([]);
    this.style.remove();
  }
}
