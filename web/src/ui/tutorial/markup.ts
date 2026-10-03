/**
 * Mentor text markup (tutorial/types.ts): `**bold**` and `{key:E}` (a keycap) are the only
 * forms. One parser feeds the HTML renderer (objectives, hints, lesson list), the typewriter
 * and the plain text the mentor voice speaks.
 */
import { escapeHtml, kbd } from '../dom';

/** A run of mentor text. A keycap types as a single character. */
export interface MarkupToken {
  text: string;
  bold: boolean;
  key: boolean;
}

const BOLD_RE = /\*\*(.+?)\*\*/g;
const KEY_RE = /\{key:([^}]+)\}/g;

function pushRuns(out: MarkupToken[], s: string, bold: boolean): void {
  KEY_RE.lastIndex = 0;
  let last = 0;
  for (let m = KEY_RE.exec(s); m !== null; m = KEY_RE.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold, key: false });
    out.push({ text: m[1].trim(), bold, key: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold, key: false });
}

export function parseMarkup(s: string): MarkupToken[] {
  const out: MarkupToken[] = [];
  BOLD_RE.lastIndex = 0;
  let last = 0;
  for (let m = BOLD_RE.exec(s); m !== null; m = BOLD_RE.exec(s)) {
    pushRuns(out, s.slice(last, m.index), false);
    pushRuns(out, m[1], true);
    last = m.index + m[0].length;
  }
  pushRuns(out, s.slice(last), false);
  return out;
}

/** Escaped HTML for mentor text: keycaps through the UI's keycap helper. */
export function markupHtml(s: string): string {
  let out = '';
  for (const t of parseMarkup(s)) {
    const inner = t.key ? kbd(t.text) : escapeHtml(t.text);
    out += t.bold ? `<strong>${inner}</strong>` : inner;
  }
  return out;
}

/** What the reader sees, as plain text (the mentor voice speaks this). */
export function plainText(tokens: readonly MarkupToken[]): string {
  let out = '';
  for (const t of tokens) out += t.text;
  return out;
}
