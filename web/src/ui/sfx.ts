/**
 * UI sounds. Wired once on the UI root with delegated listeners; no per-element listeners.
 * Each control declares its intent with `data-sfx` and its blocked state with `aria-disabled`:
 *
 *   data-sfx="confirm"   primary action (Begin the Survey, Play again, align, brew, GCC)  → uiConfirm
 *   data-sfx="back"      close, Cancel, Resume, back to the title                          → uiBack
 *   data-sfx="toggle"    flips its own `.on` state (build menu, settings toggles)          → uiToggle(!on)
 *   data-sfx="pick"      selects one of a set (tabs, plan tools, difficulty, notches)      → uiToggle(true)
 *   data-sfx="click"     a non-button control; a <button> without data-sfx is the same     → uiClick
 *   aria-disabled="true" a blocked action; its handler shows the reason instead           → uiError
 *
 * Range sliders tick (uiToggle, up or down) at most every RANGE_TICK_MS while dragged. Hovering
 * an enabled control blips uiHover at most every HOVER_GAP_MS, never twice in a row for the same
 * control. Nothing sounds while the pointer is locked (action view) or for synthetic clicks
 * (a control relaying `.click()` to another sounds once, as the control the player touched).
 */
import type { AppApi } from '../game/app';

export type SfxIntent = 'click' | 'confirm' | 'back' | 'toggle' | 'pick';

const INTENTS: Record<string, SfxIntent> = {
  click: 'click',
  confirm: 'confirm',
  back: 'back',
  toggle: 'toggle',
  pick: 'pick',
};

const HOVER_GAP_MS = 60;
const RANGE_TICK_MS = 90;

/** The control an event landed on: a button or any element that declares a data-sfx intent. */
function controlOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('button, [data-sfx]') : null;
}

export class UiSfx {
  private app: AppApi;
  private root: HTMLElement;
  private lastHover: Element | null = null;
  private lastHoverAt = -Infinity;
  private lastRangeAt = -Infinity;
  private rangeValues = new WeakMap<HTMLInputElement, number>();

  constructor(root: HTMLElement, app: AppApi) {
    this.root = root;
    this.app = app;
    // Capture phase: controls stop click propagation, and this must run before their handlers.
    root.addEventListener('click', this.onClick, true);
    root.addEventListener('pointerover', this.onOver, true);
    root.addEventListener('input', this.onInput, true);
  }

  /** Keyboard back (Escape closing a panel or resuming); the click path covers buttons. */
  back(): void {
    if (document.pointerLockElement === null) this.app.audio.uiBack();
  }

  private onClick = (ev: MouseEvent): void => {
    if (!ev.isTrusted || document.pointerLockElement !== null) return;
    const el = controlOf(ev.target);
    if (!el) return;
    const audio = this.app.audio;
    if (el.getAttribute('aria-disabled') === 'true') {
      audio.uiError();
      return;
    }
    switch (INTENTS[el.getAttribute('data-sfx') ?? 'click'] ?? 'click') {
      case 'confirm':
        audio.uiConfirm();
        break;
      case 'back':
        audio.uiBack();
        break;
      // Capture runs before the handler: `.on` still shows the state the click is about to flip.
      case 'toggle':
        audio.uiToggle(!el.classList.contains('on'));
        break;
      case 'pick':
        audio.uiToggle(true);
        break;
      case 'click':
        audio.uiClick();
        break;
    }
  };

  private onOver = (ev: PointerEvent): void => {
    if (ev.pointerType !== 'mouse' || document.pointerLockElement !== null) return;
    const el = controlOf(ev.target);
    // Moving between a control's own children re-enters the same control: one blip per control.
    if (!el || el === this.lastHover || el.getAttribute('aria-disabled') === 'true') return;
    const now = performance.now();
    if (now - this.lastHoverAt < HOVER_GAP_MS) return;
    this.lastHover = el;
    this.lastHoverAt = now;
    this.app.audio.uiHover();
  };

  private onInput = (ev: Event): void => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'range' || document.pointerLockElement !== null) return;
    const value = Number(el.value);
    const prev = this.rangeValues.get(el) ?? value;
    this.rangeValues.set(el, value);
    const now = performance.now();
    if (now - this.lastRangeAt < RANGE_TICK_MS) return;
    this.lastRangeAt = now;
    // A rising tick while the value climbs, a falling one while it drops.
    this.app.audio.uiToggle(value >= prev);
  };

  dispose(): void {
    this.root.removeEventListener('click', this.onClick, true);
    this.root.removeEventListener('pointerover', this.onOver, true);
    this.root.removeEventListener('input', this.onInput, true);
  }
}
