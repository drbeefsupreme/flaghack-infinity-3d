/**
 * Player-provided text (handles, chat, seeds, the server name). Whitespace runs collapse to one
 * space, control and format characters and lone surrogates are removed, and the result is cut
 * to a code-point budget. It stays plain text: clients render it with textContent, never as HTML.
 */

/** Cc controls, Cf format characters (bidi overrides, zero-width joiners), Cs lone surrogates. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

export function cleanText(raw: string, maxCodePoints: number): string {
  // Whitespace first: tabs and newlines are Cc too, and must turn into spaces, not vanish.
  const flat = raw.replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  const points = Array.from(flat);
  return points.length <= maxCodePoints ? flat : points.slice(0, maxCodePoints).join('').trimEnd();
}

/**
 * `name`, or `name 2`, `name 3`, … (the base cut so the suffix still fits) when `taken` (other
 * players' names, lower-cased) already holds it. Names compare case-insensitively.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>, maxCodePoints: number): string {
  if (!taken.has(name.toLowerCase())) return name;
  const points = Array.from(name);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = points.slice(0, maxCodePoints - suffix.length).join('').trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
