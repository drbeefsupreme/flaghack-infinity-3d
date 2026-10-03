/**
 * Loading veil. app.startMatch() builds a whole burn synchronously (map, lattice, render
 * modules: 300-900 ms), which would otherwise show as a frozen frame. The veil fades in, lets
 * the opaque frame paint, runs the load, waits until the new world has been drawn and fades
 * out. Phases advance from GameUI.update, which App calls right after the renderer draws, so
 * "drawn" really means drawn. The sigil spins on its own composited layer, so it keeps turning
 * while the main thread is busy building the burn.
 */
import { el, html, setClass, setText } from './dom';
import { QUOTES } from './lore';
import type { Quote } from './lore';
import { sigilSvg } from './title';

/** Fade lengths; the stylesheet reads them from custom properties so CSS and timing agree. */
const FADE_IN_MS = 180;
const FADE_OUT_MS = 500;
/** Frames of opaque veil painted before the freeze, and frames of the new world drawn after it. */
const PAINT_FRAMES = 2;
const SETTLE_FRAMES = 2;
/** The veil is up for about a second: only quotes that read at a glance. */
const VEIL_QUOTES: readonly Quote[] = QUOTES.filter((q) => q.text.length <= 90);

type Phase = 'idle' | 'in' | 'paint' | 'settle' | 'out';

export class LoadingVeil {
  private root: HTMLElement;
  private quote: HTMLElement;
  private by: HTMLElement;
  private phase: Phase = 'idle';
  private phaseAt = 0;
  private frames = 0;
  private action: (() => void) | null = null;
  private quoteIdx = Math.floor(Math.random() * VEIL_QUOTES.length);

  constructor(parent: HTMLElement) {
    this.root = el('div', 'veil', parent);
    this.root.style.setProperty('--veil-in', `${FADE_IN_MS}ms`);
    this.root.style.setProperty('--veil-out', `${FADE_OUT_MS}ms`);
    html('div', 'veil-sigil', sigilSvg('sigil'), this.root);
    el('div', 'veil-label', this.root, 'Surveying the burn');
    const q = el('blockquote', 'veil-quote', this.root);
    this.quote = el('p', '', q);
    this.by = el('cite', '', q);
  }

  /** Run a frame-freezing load behind the veil. Ignored while one is in flight (double clicks). */
  run(action: () => void): void {
    if (this.phase !== 'idle') return;
    this.quoteIdx = (this.quoteIdx + 1) % VEIL_QUOTES.length;
    const q = VEIL_QUOTES[this.quoteIdx];
    setText(this.quote, q ? `“${q.text}”` : '');
    setText(this.by, q?.by ? `— ${q.by}` : '');
    this.action = action;
    // The veil is always laid out (opacity 0, hidden), so adding `on` starts the fade at once.
    setClass(this.root, 'on', true);
    setClass(this.root, 'ix', true);
    this.phase = 'in';
    this.phaseAt = performance.now();
  }

  /** Every animation frame, right after the renderer drew it (called last in GameUI.update). */
  frame(now: number): void {
    switch (this.phase) {
      case 'idle':
        return;
      case 'in':
        if (now - this.phaseAt >= FADE_IN_MS) {
          this.phase = 'paint';
          this.frames = 0;
        }
        return;
      case 'paint': {
        if (++this.frames < PAINT_FRAMES) return;
        const action = this.action;
        this.action = null;
        // Advance first: if the load throws, the veil still lifts and the error stays visible.
        this.phase = 'settle';
        this.frames = 0;
        action?.();
        return;
      }
      case 'settle':
        if (++this.frames < SETTLE_FRAMES) return;
        setClass(this.root, 'on', false);
        // Clicks reach the new match while the veil is still fading.
        setClass(this.root, 'ix', false);
        this.phase = 'out';
        this.phaseAt = now;
        return;
      case 'out':
        if (now - this.phaseAt >= FADE_OUT_MS) this.phase = 'idle';
        return;
    }
  }
}
