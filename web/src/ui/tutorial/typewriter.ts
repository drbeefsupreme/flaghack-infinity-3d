/**
 * Typewriter for mentor lines. The whole line is laid out up front, with the unrevealed
 * remainder kept invisible but still taking up space, so words never jump to the next row
 * while it types. Each reveal only rewrites the run that crossed the cursor.
 */
import { el, html, kbd, setClass } from '../dom';
import type { MarkupToken } from './markup';

/** Typewriter rate in visible characters per second. The mentor voice is timed to the same rate. */
export const TYPE_CPS = 36;

interface Run {
  /** Index of the run's first character in the line. */
  start: number;
  len: number;
  text: string;
  /** Text runs: the revealed text, then the invisible remainder. Keycaps use `cap` instead. */
  shown: Text | null;
  ghost: HTMLElement | null;
  cap: HTMLElement | null;
}

export class Typewriter {
  readonly node: HTMLElement;
  private runs: Run[] = [];
  private total = 0;
  private revealed = 0;
  private startedAt = 0;

  constructor(parent: HTMLElement, cls: string) {
    this.node = el('div', cls, parent);
  }

  get done(): boolean {
    return this.revealed >= this.total;
  }

  /** Lay out a new line, fully hidden; it starts typing at `now` (performance.now()). */
  start(tokens: readonly MarkupToken[], now: number): void {
    this.node.textContent = '';
    this.runs.length = 0;
    let at = 0;
    for (const t of tokens) {
      const host = t.bold ? el('strong', '', this.node) : this.node;
      if (t.key) {
        const cap = html('span', 'tw-cap tw-off', kbd(t.text), host);
        this.runs.push({ start: at, len: 1, text: t.text, shown: null, ghost: null, cap });
        at += 1;
      } else {
        const shown = document.createTextNode('');
        host.appendChild(shown);
        const ghost = el('span', 'tw-ghost', host, t.text);
        this.runs.push({ start: at, len: t.text.length, text: t.text, shown, ghost, cap: null });
        at += t.text.length;
      }
    }
    this.total = at;
    this.revealed = 0;
    this.startedAt = now;
  }

  /** Per frame: reveal what the clock allows. */
  frame(now: number): void {
    if (this.revealed >= this.total) return;
    const n = Math.min(this.total, Math.floor(((now - this.startedAt) / 1000) * TYPE_CPS));
    if (n > this.revealed) this.reveal(n);
  }

  finish(): void {
    this.reveal(this.total);
  }

  clear(): void {
    this.node.textContent = '';
    this.runs.length = 0;
    this.total = 0;
    this.revealed = 0;
  }

  private reveal(n: number): void {
    const from = this.revealed;
    for (const r of this.runs) {
      if (r.start + r.len <= from) continue;
      if (r.start >= n) break;
      if (r.cap) {
        setClass(r.cap, 'tw-off', false);
      } else if (r.shown && r.ghost) {
        const k = Math.min(r.len, n - r.start);
        r.shown.data = r.text.slice(0, k);
        r.ghost.textContent = r.text.slice(k);
      }
    }
    this.revealed = n;
  }
}
