/**
 * Tiny DOM helpers for the UI. Every per-tick write goes through a compare-before-write
 * helper so a 10 Hz refresh only touches nodes whose value actually changed (no layout reads,
 * no redundant style invalidation).
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: Element | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

/** Element built from trusted, static markup (icons, keycaps). Never pass player text here. */
export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  markup: string,
  parent?: Element | null,
): HTMLElementTagNameMap[K] {
  const node = el(tag, cls, parent);
  node.innerHTML = markup;
  return node;
}

export function button(cls: string, parent: Element | null, markup: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = html('button', cls, markup, parent);
  b.type = 'button';
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // Keys belong to the game: a mouse-clicked button must not keep focus, or Space (jump) would
    // press it again once it is hidden (e.g. Begin the Survey). Keyboard activation keeps focus.
    if (ev.detail > 0) b.blur();
    onClick(ev);
  });
  return b;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setClass(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

/** Hide/show via the shared `.is-off` utility (display: none !important). */
export function show(node: Element, on: boolean): void {
  setClass(node, 'is-off', !on);
}

const styleCache = new WeakMap<HTMLElement, Map<string, string>>();

/** Set a CSS custom property (or any style property) only when its value changed. */
export function setVar(node: HTMLElement, name: string, value: string): void {
  let cache = styleCache.get(node);
  if (!cache) {
    cache = new Map();
    styleCache.set(node, cache);
  }
  if (cache.get(name) === value) return;
  cache.set(name, value);
  node.style.setProperty(name, value);
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape, then turn the lore files' **bold** markers into <strong>. */
export function richText(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** m:ss (or h:mm:ss past an hour), clamped at zero. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  const body = `${mm}:${sec < 10 ? '0' : ''}${sec}`;
  return h > 0 ? `${h}:${body}` : body;
}

/** Short countdown label: "12s" under a minute, "1:05" above. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 60 ? `${s}s` : fmtClock(s);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Keycap markup for prompts and hints (trusted key labels only). */
export function kbd(key: string): string {
  return `<kbd>${escapeHtml(key)}</kbd>`;
}
