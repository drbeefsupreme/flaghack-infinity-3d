/**
 * Chat at the burn (online only). `ChatLog` renders net.chat incrementally (lobby panel and
 * in-match overlay share it); `ChatOverlay` is the in-match chat: Enter opens the input, Enter
 * sends, Escape closes, and lines fade after a while unless the input is open. Every
 * player-provided string (handles, messages) is written as text, never parsed as HTML.
 */
import type { NetSession } from '../net/session';
import { MAX_CHAT_LENGTH } from '../net/protocol';
import type { ChatLine } from '../net/protocol';
import { FACTION_DEFS } from '../sim/constants';
import type { World } from '../sim/world';
import { matchScreen } from './core';
import type { UiHost, UiPart } from './core';
import { el, setClass, show } from './dom';

/** In-match lines stay readable this long after they arrive, then fade out. */
const LINE_TTL_MS = 12_000;
/** Lines over the burn at once: a few while playing, more while the input is open. */
const LINES_SHOWN = 5;
const LINES_SHOWN_OPEN = 9;

interface ChatRow {
  row: HTMLElement;
  /** performance.now() when this client first rendered the line (host clocks are not ours). */
  seenAt: number;
}

/** Identity of a chat line: the host stamps `at`, so sender + time + text never repeats. */
function lineKey(line: ChatLine): string {
  return `${line.at}|${line.playerId ?? '~'}|${line.text}`;
}

export class ChatLog {
  readonly el: HTMLElement;
  private rows = new Map<string, ChatRow>();
  private cap: number;

  constructor(parent: HTMLElement, cls: string, cap: number) {
    this.el = el('div', cls, parent);
    this.cap = cap;
  }

  /** Append the lines not shown yet (only the tail of the log can be new). */
  sync(lines: readonly ChatLine[], now: number): void {
    let start = lines.length;
    while (start > 0 && !this.rows.has(lineKey(lines[start - 1]))) start--;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      this.rows.set(lineKey(line), { row: this.render(line), seenAt: now });
    }
    while (this.rows.size > this.cap) {
      const oldest = this.rows.keys().next();
      if (oldest.done) break;
      this.rows.get(oldest.value)?.row.remove();
      this.rows.delete(oldest.value);
    }
    if (lines.length > start) this.el.scrollTop = this.el.scrollHeight;
  }

  /**
   * Show at most the newest `maxShown` lines, and only those younger than `ttlMs` unless
   * `keepAll` (the input is open). Fresh lines are always the newest, so one pass suffices.
   */
  fade(now: number, ttlMs: number, keepAll: boolean, maxShown: number): void {
    const firstShown = this.rows.size - maxShown;
    let i = 0;
    for (const r of this.rows.values()) {
      setClass(r.row, 'gone', i < firstShown || (!keepAll && now - r.seenAt > ttlMs));
      i++;
    }
  }

  clear(): void {
    for (const r of this.rows.values()) r.row.remove();
    this.rows.clear();
  }

  private render(line: ChatLine): HTMLElement {
    const row = el('div', line.from === null ? 'chat-line sys' : 'chat-line', this.el);
    if (line.from !== null) {
      const from = el('span', 'chat-from', row, line.from);
      // Seated players speak in their camp's colour; spectators in plain parchment.
      if (line.seat !== null) from.style.color = FACTION_DEFS[line.seat].css;
    }
    el('span', 'chat-text', row, line.text);
    return row;
  }
}

/**
 * The text field shared by the lobby and the in-match chat: Enter sends (and reports it),
 * Escape cancels. Both keys stop here so they never reach the game or the pause menu.
 */
export function chatInput(parent: HTMLElement, placeholder: string, onSend: (text: string) => void, onCancel: () => void): HTMLInputElement {
  const input = el('input', 'chat-input', parent);
  input.type = 'text';
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      const text = input.value.trim();
      input.value = '';
      if (text) onSend(text);
      else onCancel();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      input.value = '';
      onCancel();
    }
  });
  return input;
}

export class ChatOverlay implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private log: ChatLog;
  private bar: HTMLElement;
  private input: HTMLInputElement;
  private open = false;
  private net: NetSession | null = null;
  private version = -1;
  /** Set while hidden: on coming up, lines said before (the lobby's talk) are history, not news. */
  private backlog = true;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'chat is-off', parent);
    this.log = new ChatLog(this.root, 'chat-log', 40);
    this.bar = el('div', 'chat-bar ix is-off', this.root);
    el('span', 'chat-to', this.bar, 'To the burn');
    this.input = chatInput(
      this.bar,
      'Say something to every Signifier',
      (text) => {
        this.host.app.net?.sendChat(text);
        this.close();
      },
      () => this.close(),
    );
    // Clicking back into the burn (or alt-tabbing) puts the chat away; the draft is dropped.
    this.input.addEventListener('blur', () => this.close());
  }

  /** Enter outside any text field. Returns false when there is nothing to chat with. */
  openInput(): boolean {
    // Only over the live burn: pause and end cards are modal and would sit on top of the field.
    if (!this.host.app.net || this.host.app.session.screen !== 'playing') return false;
    this.open = true;
    show(this.bar, true);
    setClass(this.root, 'open', true);
    this.log.fade(performance.now(), LINE_TTL_MS, true, LINES_SHOWN_OPEN);
    this.input.focus();
    return true;
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    show(this.bar, false);
    setClass(this.root, 'open', false);
    // Blur hands the keyboard back to the game (Controls ignores keys while a field has focus).
    if (document.activeElement === this.input) this.input.blur();
  }

  update(_world: World | null, now: number): void {
    const net = this.host.app.net;
    const visible = !!net && matchScreen(this.host.app.session.screen);
    show(this.root, visible);
    if (!visible || !net) {
      this.close();
      this.backlog = true;
      return;
    }
    if (net !== this.net) {
      this.net = net;
      this.version = -1;
      this.log.clear();
    }
    if (net.version !== this.version || this.backlog) {
      this.version = net.version;
      // History waits in the log for Enter instead of popping over the burn.
      this.log.sync(net.chat, this.backlog ? -Infinity : now);
      this.backlog = false;
    }
    this.log.fade(now, LINE_TTL_MS, this.open, this.open ? LINES_SHOWN_OPEN : LINES_SHOWN);
  }

  dispose(): void {
    this.root.remove();
  }
}
