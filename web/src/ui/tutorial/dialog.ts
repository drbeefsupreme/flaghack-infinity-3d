/**
 * One beat of mentor lines, typed out one at a time. Enter or a click finishes the line that
 * is typing, then moves on to the next. The Vexillosaint's lines are voiced by
 * GameAudio.mentorSpeak, which is timed to the same typewriter rate. Narrator lines are silent
 * and drawn in another style.
 */
import type { AppApi } from '../../game/app';
import type { TutorialLine } from '../../tutorial/types';
import { setClass } from '../dom';
import { parseMarkup, plainText } from './markup';
import { TYPE_CPS, Typewriter } from './typewriter';

const NO_LINES: readonly TutorialLine[] = [];

export class Dialog {
  readonly tw: Typewriter;
  /** Audio is read through the app at call time: the UI is built before GameAudio exists. */
  private app: AppApi;
  private lines: readonly TutorialLine[] = NO_LINES;
  private idx = -1;

  constructor(parent: HTMLElement, cls: string, app: AppApi) {
    this.tw = new Typewriter(parent, cls);
    this.app = app;
  }

  /** Lines of the beat on display (identity marks the beat). */
  get beat(): readonly TutorialLine[] {
    return this.lines;
  }

  get count(): number {
    return this.lines.length;
  }

  /** 0-based index of the line on display, -1 before the first. */
  get index(): number {
    return this.idx;
  }

  /** Every line of the beat has been typed out in full (true for an empty beat). */
  get finished(): boolean {
    return this.idx >= this.lines.length - 1 && this.tw.done;
  }

  /** The Vexillosaint is mid-sentence (the portrait moves its mouth). */
  get speaking(): boolean {
    return !this.tw.done && this.lines[this.idx]?.speaker === 'vexillosaint';
  }

  /** Play a beat from its first line. Passing the beat already on display changes nothing. */
  play(lines: readonly TutorialLine[], now: number): void {
    if (lines === this.lines) return;
    if (!this.tw.done) this.app.audio.mentorStop();
    this.lines = lines;
    this.idx = -1;
    this.tw.clear();
    if (lines.length > 0) this.show(0, now);
  }

  frame(now: number): void {
    this.tw.frame(now);
  }

  /** Enter or click: finish the typing line, else show the next. False when the beat is done. */
  advance(now: number): boolean {
    if (!this.tw.done) {
      this.tw.finish();
      this.app.audio.mentorStop();
      return true;
    }
    if (this.idx < this.lines.length - 1) {
      this.show(this.idx + 1, now);
      return true;
    }
    return false;
  }

  /** Silence the voice and forget the beat (hidden, run over). */
  stop(): void {
    if (!this.tw.done) this.app.audio.mentorStop();
    this.lines = NO_LINES;
    this.idx = -1;
    this.tw.clear();
  }

  private show(i: number, now: number): void {
    const line = this.lines[i];
    this.idx = i;
    const tokens = parseMarkup(line.text);
    this.tw.start(tokens, now);
    setClass(this.tw.node, 'narrator', line.speaker === 'narrator');
    if (line.speaker === 'vexillosaint') this.app.audio.mentorSpeak(plainText(tokens), TYPE_CPS);
    else this.app.audio.mentorStop();
  }
}
