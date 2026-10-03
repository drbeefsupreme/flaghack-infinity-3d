/**
 * Raw browser input for the game canvas: held/pressed keys (KeyboardEvent.code), mouse buttons
 * with press positions, pointer-lock movement, wheel and cursor position. Edge flags (pressed /
 * released) accumulate between frames and are consumed by `endFrame()`, so a tap shorter than a
 * frame is never lost. Keys typed into form fields never reach the game, and only presses that
 * start on the canvas count (UI widgets keep their own clicks).
 */

export const LMB = 0;
export const MMB = 1;
export const RMB = 2;

/** Pointer-lock movement spikes larger than this are browser glitches (lock engage), not input. */
const MAX_MOVE_EVENT = 300;

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

export class Input {
  readonly canvas: HTMLCanvasElement;
  /** Physical keys currently held. */
  private held = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Mouse buttons held (only presses that began on the canvas). */
  readonly buttons = [false, false, false];
  private btnPressed = [false, false, false];
  private btnReleased = [false, false, false];
  /** Cursor position (canvas CSS px) at the latest press of each button. */
  readonly downX = [0, 0, 0];
  readonly downY = [0, 0, 0];
  /** Look movement accumulated since the last frame (CSS px). */
  dx = 0;
  dy = 0;
  /** Wheel accumulated since the last frame (pixels; + = away from the screen top / zoom out). */
  wheel = 0;
  /** Cursor position in canvas CSS px. */
  mx = 0;
  my = 0;
  /** The cursor is over the page (edge-pan only while true). */
  hasCursor = false;
  locked = false;
  /** Pointer lock failed without ever succeeding (headless / sandboxed frame): mouse-look follows the cursor. */
  lockUnavailable = false;
  /**
   * Canvas CSS box (px), refreshed only by a ResizeObserver and window resize: reading layout
   * every frame while the HUD rewrites the DOM would force a synchronous reflow.
   */
  width = 1;
  height = 1;
  private left = 0;
  private top = 0;
  private cursorStyle = '';
  private resizer: ResizeObserver;
  /** Decides whether a key belongs to the game right now (preventDefault + recorded). */
  capturesKey: (code: string) => boolean = () => false;
  /** Pointer lock lost by the user (Esc, alt-tab), not by `exitLock()`. */
  onLockLost: (() => void) | null = null;
  /** Mousedown on the canvas; return true to consume it (e.g. the click that grabs the pointer). */
  onCanvasDown: ((button: number) => boolean) | null = null;
  /** Keydown hook that runs inside the user gesture (pointer lock can only be requested there). */
  onKeyGesture: ((code: string) => void) | null = null;

  private lockEverWorked = false;
  private expectUnlock = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.resizer = new ResizeObserver(this.measure);
    this.resizer.observe(canvas);
    window.addEventListener('resize', this.measure);
    this.measure();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('mouseleave', this.onMouseLeave);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** Mark a press as handled so later handlers this frame ignore it. */
  consume(code: string): void {
    this.pressed.delete(code);
  }

  get shift(): boolean {
    return this.held.has('ShiftLeft') || this.held.has('ShiftRight');
  }

  get ctrl(): boolean {
    return this.held.has('ControlLeft') || this.held.has('ControlRight');
  }

  buttonPressed(b: number): boolean {
    return this.btnPressed[b];
  }

  buttonReleased(b: number): boolean {
    return this.btnReleased[b];
  }

  /** Squared cursor travel since the latest press of button b. */
  dragDist2(b: number): number {
    const dx = this.mx - this.downX[b];
    const dy = this.my - this.downY[b];
    return dx * dx + dy * dy;
  }

  requestLock(): void {
    if (this.locked || this.disposed || document.pointerLockElement === this.canvas) return;
    try {
      const result: unknown = this.canvas.requestPointerLock();
      if (result instanceof Promise) result.catch(() => this.lockFailed());
    } catch {
      this.lockFailed();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement !== this.canvas) return;
    this.expectUnlock = true;
    document.exitPointerLock();
  }

  /** Forget every held key/button (focus loss, pause, view switch). */
  clear(): void {
    for (const code of this.held) this.released.add(code);
    this.held.clear();
    for (let b = 0; b < 3; b++) {
      if (this.buttons[b]) this.btnReleased[b] = true;
      this.buttons[b] = false;
    }
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  /** Consume this frame's edges and deltas. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    for (let b = 0; b < 3; b++) {
      this.btnPressed[b] = false;
      this.btnReleased[b] = false;
    }
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.exitLock();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('mouseleave', this.onMouseLeave);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.resizer.disconnect();
    window.removeEventListener('resize', this.measure);
    this.setCursor('');
  }

  /** Set the canvas cursor, touching the DOM only when it changes. */
  setCursor(cursor: string): void {
    if (cursor === this.cursorStyle) return;
    this.cursorStyle = cursor;
    this.canvas.style.cursor = cursor;
  }

  /** ResizeObserver callbacks run after layout, so this read never forces a reflow there. */
  private measure = (): void => {
    const r = this.canvas.getBoundingClientRect();
    this.left = r.left;
    this.top = r.top;
    this.width = r.width || 1;
    this.height = r.height || 1;
  };

  private lockFailed(): void {
    if (!this.lockEverWorked) this.lockUnavailable = true;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    // Browser/OS chords (reload, devtools, copy) are never game input.
    if (e.altKey || ((e.ctrlKey || e.metaKey) && !e.code.startsWith('Control') && !e.code.startsWith('Meta'))) return;
    if (!this.capturesKey(e.code)) return;
    if (e.code !== 'Escape') e.preventDefault();
    if (e.repeat) return;
    this.held.add(e.code);
    this.pressed.add(e.code);
    this.onKeyGesture?.(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.held.has(e.code)) return;
    this.held.delete(e.code);
    this.released.add(e.code);
  };

  private onBlur = (): void => {
    this.clear();
  };

  private updateCursor(e: MouseEvent): void {
    this.mx = e.clientX - this.left;
    this.my = e.clientY - this.top;
    this.hasCursor = true;
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked || this.lockUnavailable) {
      if (Math.abs(e.movementX) < MAX_MOVE_EVENT && Math.abs(e.movementY) < MAX_MOVE_EVENT) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    }
    if (!this.locked) this.updateCursor(e);
  };

  private onMouseLeave = (): void => {
    this.hasCursor = false;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button > 2) return;
    if (!this.locked) this.updateCursor(e);
    if (e.button === MMB) e.preventDefault(); // no autoscroll
    if (this.onCanvasDown?.(e.button)) return;
    this.buttons[e.button] = true;
    this.btnPressed[e.button] = true;
    this.downX[e.button] = this.mx;
    this.downY[e.button] = this.my;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button > 2 || !this.buttons[e.button]) return;
    this.buttons[e.button] = false;
    this.btnReleased[e.button] = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.wheel += e.deltaY * scale;
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.locked = locked;
    if (locked) {
      this.lockEverWorked = true;
      this.lockUnavailable = false;
      return;
    }
    if (this.expectUnlock) {
      this.expectUnlock = false;
      return;
    }
    this.clear();
    this.onLockLost?.();
  };

  private onLockError = (): void => {
    this.lockFailed();
  };
}
