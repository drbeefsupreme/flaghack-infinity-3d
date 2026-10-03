/**
 * Character medallions for the four camps (lobby seat cards, scoreboard). Inline SVG built from
 * trusted static markup; the faction colour arrives through the `--fc` custom property of an
 * ancestor, and Flags stay yellow on every portrait (no non-yellow Flag has authority).
 *
 *   0 Dr. Beef Supreme     balaclava, Mega Harvard mortarboard with a pennant tassel
 *   1 Dr. Beelzebub Crow   crow in a talk-show top hat and bow tie
 *   2 DJ Scarecrow         burlap face, stitched eyes, straw hat under studio headphones
 *   3 President Jaguar     jaguar in the crown of the forever-re-elected, royal purple robe
 */
import type { FactionId } from '../sim/types';

const INK = '#120d08';
const FLAG = '#ffd400';

const FIGURES: Record<FactionId, string> = {
  0:
    // Shoulders, balaclava, glowing eye slit, mortarboard with a yellow pennant for a tassel.
    `<path d="M-23 31c1-10 7-14 15-15h16c8 1 14 5 15 15z" fill="#241d18" stroke="currentColor" stroke-width="1.3"/>` +
    `<path d="M-4 16l4 7 4-7" fill="none" stroke="${FLAG}" stroke-width="1.6"/>` +
    `<ellipse cx="0" cy="3" rx="14" ry="16" fill="#191512" stroke="currentColor" stroke-width="1.4"/>` +
    `<rect x="-11" y="-2" width="22" height="7.5" rx="3.7" fill="#c98e62"/>` +
    `<circle cx="-5" cy="1.8" r="2" fill="var(--fc)"/><circle cx="5" cy="1.8" r="2" fill="var(--fc)"/>` +
    `<path d="M-6 11q6 3 12 0" fill="none" stroke="#3a2f27" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M-19-12L0-20l19 8-19 7z" fill="${INK}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M-10-8v5q10 4 20 0v-5" fill="${INK}" stroke="currentColor" stroke-width="1.2"/>` +
    `<path d="M11-11.5l3 9" stroke="${FLAG}" stroke-width="1.2"/>` +
    `<path d="M14-2.5l6 2-6 2.4z" fill="${FLAG}"/>`,
  1:
    // Feathered shoulders, crow head in profile, ivory beak, crimson eye, top hat, bow tie.
    `<path d="M-23 31c2-9 6-13 12-14l3 4 3-4 4 4 3-4 3 4 3-4c7 1 13 6 15 14z" fill="#16131b" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M-6 17l5 4-5 4zM6 17l-5 4 5 4z" fill="var(--fc)" stroke="${INK}" stroke-width=".8"/>` +
    `<circle cx="0" cy="21" r="1.6" fill="var(--fc)"/>` +
    `<path d="M-13 2c0-9 6-14 13-14 6 0 10 4 11 9l14 6-14 4c-2 6-6 9-12 9-7 0-12-6-12-14z" fill="#18151d" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M11-3l14 6-14 4z" fill="#e8cf9a" stroke="${INK}" stroke-width="1"/>` +
    `<circle cx="3" cy="-2" r="3.3" fill="var(--fc)"/><circle cx="3.6" cy="-2.4" r="1.2" fill="${INK}"/>` +
    `<rect x="-14" y="-31" width="21" height="16" rx="1.5" fill="${INK}" stroke="currentColor" stroke-width="1.2"/>` +
    `<rect x="-14" y="-20" width="21" height="3.5" fill="var(--fc)"/>` +
    `<rect x="-20" y="-16" width="33" height="3.4" rx="1.7" fill="${INK}" stroke="currentColor" stroke-width="1.2"/>`,
  2:
    // Hoodie shoulders, burlap face with stitches, straw hat, headphones over everything.
    `<path d="M-23 31c1-9 7-13 14-14h18c7 1 13 5 14 14z" fill="#2b3320" stroke="currentColor" stroke-width="1.3"/>` +
    `<path d="M-15 24l3-4M-9 25l2-5M9 25l-2-5M15 24l-3-4" stroke="#d8b25a" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="0" cy="5" r="14" fill="#b88b52" stroke="currentColor" stroke-width="1.4"/>` +
    `<path d="M-8-1l4 4M-4-1l-4 4M4-1l4 4M8-1l-4 4" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>` +
    `<path d="M-8 11q8 6 16 0" fill="none" stroke="${INK}" stroke-width="1.4"/>` +
    `<path d="M-6 10.6v2.6M-2 12.3v2.6M2 12.3v2.6M6 10.6v2.6" stroke="${INK}" stroke-width="1.1"/>` +
    `<path d="M-25-6q25-8 50 0-25 6-50 0z" fill="#d6ad57" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M-10-8c1-10 6-18 11-19 5 1 9 9 10 19z" fill="#c99d48" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M-7-10l3-8M0-11V-23M6-10l-2-9" stroke="#f0d07a" stroke-width=".9"/>` +
    `<path d="M-17 4a17 17 0 0 1 34 0" fill="none" stroke="var(--fc)" stroke-width="3"/>` +
    `<rect x="-21" y="0" width="7" height="13" rx="3.4" fill="var(--fc)" stroke="${INK}" stroke-width="1"/>` +
    `<rect x="14" y="0" width="7" height="13" rx="3.4" fill="var(--fc)" stroke="${INK}" stroke-width="1"/>`,
  3:
    // Royal purple robe with ermine, jaguar head with rosettes, golden crown.
    `<path d="M-24 31c1-10 8-15 16-15h16c8 0 15 5 16 15z" fill="var(--fc)" stroke="currentColor" stroke-width="1.3"/>` +
    `<path d="M-10 16h20l-4 6h-12z" fill="#f2ead8" stroke="${INK}" stroke-width=".8"/>` +
    `<circle cx="-4" cy="18.5" r=".9" fill="${INK}"/><circle cx="3" cy="19" r=".9" fill="${INK}"/>` +
    `<path d="M-14-9l-3-9 9 4zM14-9l3-9-9 4z" fill="#d9a441" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<ellipse cx="0" cy="2" rx="15" ry="14" fill="#dfa645" stroke="currentColor" stroke-width="1.4"/>` +
    `<g fill="none" stroke="#5a3712" stroke-width="1.3"><circle cx="-9" cy="-4" r="2.2"/><circle cx="8" cy="-5" r="2"/>` +
    `<circle cx="-11" cy="6" r="1.8"/><circle cx="11" cy="5" r="2.1"/><circle cx="0" cy="-8" r="1.7"/></g>` +
    `<ellipse cx="0" cy="8.5" rx="7.5" ry="5.5" fill="#f4e4c2"/>` +
    `<path d="M-2.6 5h5.2L0 8z" fill="#5a2a1a"/><path d="M0 8v2.5M-3 11q3 2 6 0" fill="none" stroke="#5a2a1a" stroke-width="1"/>` +
    `<path d="M-8 0q3-3 6 0-3 2-6 0zM2 0q3-3 6 0-3 2-6 0z" fill="${FLAG}" stroke="${INK}" stroke-width=".7"/>` +
    `<path d="M-10-12v-8l5 4 5-7 5 7 5-4v8z" fill="${FLAG}" stroke="#7a5a10" stroke-width="1" stroke-linejoin="round"/>` +
    `<circle cx="0" cy="-16" r="1.4" fill="var(--fc)"/>`,
};

/** Each inserted medallion needs its own clipPath id (ids are document-global). */
let clipSeq = 0;

/** A character medallion: dark disc in the camp's colour ring, the figure clipped inside it. */
export function portraitSvg(f: FactionId, cls = 'portrait'): string {
  const id = `fh-portrait-${++clipSeq}`;
  return (
    `<svg class="${cls}" viewBox="-32 -32 64 64" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><circle r="29.5"/></clipPath></defs>` +
    `<circle r="30.5" fill="#0d0905"/>` +
    `<g clip-path="url(#${id})">${FIGURES[f]}</g>` +
    `<circle r="30.5" fill="none" stroke="var(--fc)" stroke-width="2"/>` +
    `<circle r="27" fill="none" stroke="var(--fc)" stroke-opacity=".3" stroke-width=".8"/></svg>`
  );
}
