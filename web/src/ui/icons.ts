/**
 * Hand-made inline-SVG icon set for the HUD (24x24 viewBox, line art on `currentColor`).
 * Flag cloth is always filled with `--ic-flag` so Flags read yellow in every context, like
 * the Flags on the playa. Markup carries no ids, gradients or text so any icon can be
 * inlined many times on one page without collisions.
 */

export type IconName =
  // chakras / abilities
  | 'hoist'
  | 'fly'
  | 'canton'
  | 'field'
  | 'finial'
  // drugs
  | 'saffron'
  | 'dust'
  | 'acidcop'
  // action tools
  | 'flag'
  | 'wall'
  | 'floor'
  | 'ramp'
  | 'demolish'
  // camp buildings
  | 'hearth'
  | 'workshop'
  | 'drumcircle'
  | 'ward'
  | 'druglab'
  | 'gcc'
  // resources / HUD
  | 'lumber'
  | 'ritual'
  | 'hippie'
  | 'attention'
  | 'stock'
  | 'cmi'
  | 'crystal'
  | 'popcap'
  // GCC actions
  | 'gift'
  | 'dialectics'
  | 'simulacra'
  // Command View plan tools
  | 'select'
  | 'node'
  | 'enclose'
  | 'pentacle'
  | 'ring'
  | 'clear'
  // jobs
  | 'survey'
  | 'gather'
  | 'defend'
  | 'raid'
  | 'drum'
  // hippie statuses
  | 'idle'
  | 'walk'
  | 'carry'
  | 'plant'
  | 'pull'
  | 'steal'
  | 'chop'
  | 'build'
  | 'repair'
  | 'fight'
  | 'tear'
  | 'follow'
  | 'respond'
  | 'distracted'
  | 'flee'
  | 'ko'
  // clock / events
  | 'sun'
  | 'dusk'
  | 'moon'
  | 'dawn' // sun rising over the horizon with an up arrow (Dawn countdown, dawn crowning)
  | 'tide'
  | 'burn'
  | 'clock'
  | 'eye'
  | 'shot'
  | 'ping'
  | 'sos'
  | 'rally'
  | 'attack'
  // UI chrome
  | 'close'
  | 'settings'
  | 'book'
  | 'help'
  | 'play'
  | 'lock'
  | 'skull'
  | 'star'
  | 'warning';

/** Flag cloth: always yellow; a thinner outline keeps the fill dominant at 14px. */
const cloth = (d: string): string =>
  `<path d="${d}" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>`;
/** Translucent secondary fill plus the usual outline, for bodies (buildings, crystals). */
const soft = (d: string, op = '.25'): string =>
  `<path d="${d}" fill="currentColor" fill-opacity="${op}"/>`;
/** Fill-only tint, for areas whose outline is drawn differently (dashed, partial). */
const tint = (d: string, op = '.25'): string =>
  `<path d="${d}" fill="currentColor" fill-opacity="${op}" stroke="none"/>`;
const dot = (cx: number, cy: number, r = 1.1): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
const line = (d: string): string => `<path d="${d}"/>`;

/** Inner SVG markup (child elements only) for a 24x24 viewBox. */
export const ICONS: Record<IconName, string> = {
  // ── chakras / abilities ────────────────────────────────────────────────────
  hoist:
    line('M7 21V9') +
    cloth('M7 9h9.5v5.5H7z') +
    line('M11.8 6.2V3M16.8 7l2-2M6.8 7l-2-2M20 11.5h1.8M3.8 11.5H2'),
  fly:
    line('M9 21V4') +
    cloth('M9 4c3-1.3 5.5 1.3 8.5 0c1 0 2 .2 3 .8v6c-3.5 1.5-7.5-1.4-11.5.2z') +
    line('M2.5 6.5h4M3.5 10h3M2.5 13.5h4'),
  canton:
    line('M3 20h18') +
    soft('M5 20v-8a7 7 0 0 1 14 0v8', '.15') +
    line('M12 3.6v1.4') +
    `<circle cx="12" cy="3" r=".9"/>` +
    line('M11 20v-6.5') +
    cloth('M11 13.5h4.5v3H11z'),
  field:
    soft('M12 10.9 17.7 9 12 7.1 6.3 9z', '.35') +
    line('M12 16.9 17.7 15V9L12 7.1 6.3 9v6zM12 10.9v6M12 10.9 17.7 9M12 10.9 6.3 9') +
    line('M3.6 8.1A9.3 9.3 0 0 1 19.6 6.7M19.7 4.5 19.6 6.7 17.5 6') +
    line('M20.4 15.9A9.3 9.3 0 0 1 4.4 17.3M4.3 19.5 4.4 17.3 6.5 18'),
  finial:
    line('M12 21v-9') +
    `<path d="M12 4l2.4 4-2.4 3.4L9.6 8z" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>` +
    line('M6.8 4.5a6 6 0 0 0 0 7M17.2 4.5a6 6 0 0 1 0 7M3.8 2.8a9.5 9.5 0 0 0 0 10.4M20.2 2.8a9.5 9.5 0 0 1 0 10.4'),
  // ── drugs ──────────────────────────────────────────────────────────────────
  saffron:
    soft('M5 11h12v2.5a6 6 0 0 1-12 0z') +
    line('M17 12h1.3a2.2 2.2 0 0 1 0 4.4h-1.9M3.5 21h15') +
    `<path d="M8.5 8.5c-1-1.5 1-2.5 0-4.5M11.5 8.5c-1-1.5 1-2.5 0-4.5M14.5 8.5c-1-1.5 1-2.5 0-4.5" stroke="var(--ic-flag, #ffd400)"/>`,
  dust:
    line('M2.5 14c3-4.8 16-4.8 19 0c-3 4.8-16 4.8-19 0z') +
    `<circle cx="12" cy="14" r="2.6" fill="currentColor"/>` +
    `<path d="M17.5 2.5v5M15 5h5M6 4v3M4.5 5.5h3" stroke="var(--ic-flag, #ffd400)"/>` +
    dot(11.5, 4.5, 0.9),
  acidcop:
    soft('M5 7.5C5.5 4.3 8.6 2.6 12 2.6s6.5 1.7 7 4.9z') +
    line('M4.5 7.5h15l-1.8 2.2H6.3z') +
    `<path d="M12 3.6l.4 1.1h1.2l-.9.7.3 1.1-1-.7-1 .7.3-1.1-.9-.7h1.2z" fill="var(--ic-flag, #ffd400)" stroke="none"/>` +
    line('M2.5 16c3-6 16-6 19 0c-3 6-16 6-19 0z') +
    `<path d="M12 16a1.1 1.1 0 0 1 2.2 0a2.2 2.2 0 0 1-4.4 0a3.3 3.3 0 0 1 6.6 0" stroke-width="1.3"/>`,
  // ── action tools ───────────────────────────────────────────────────────────
  flag: line('M8 21.5V3.5M5 21.5h6') + cloth('M8 3.5h10.5v7H8z'),
  wall:
    soft('M4 6h16v13H4z', '.18') +
    line('M8 6v13M12 6v13M16 6v13M3 9.5h18M3 15.5h18'),
  floor:
    soft('M3 16l5-7h13l-5 7z', '.18') +
    line('M6.3 11.4h13M4.6 13.7h13M3 16v2.2h13V16M16 18.2l5-7V9'),
  ramp:
    soft('M3 19h18V6z', '.18') + line('M3 19h18V6zM9 19v-4.4M13 19v-7.3M17 19V9.8'),
  demolish:
    line('M4 21l8.5-8.5') +
    soft('M10.2 7.8l5-5 6 6-5 5z', '.3') +
    line('M3 12.5l2.5.5M5.5 8.5l1.5 2M8.5 17.8l.8 2.6'),
  // ── camp buildings ─────────────────────────────────────────────────────────
  hearth:
    `<path d="M12 16.5c-3 0-4.6-2-4-4.8c.4 1 1.2 1.6 2 1.6c-.6-3 1-5.6 3-8.3c.3 3 3.8 4.4 3.8 8c0 2-1.8 3.5-4.8 3.5z" fill="var(--ic-flag, #ffd400)" stroke-width="1.3"/>` +
    soft('M4 16.5h16l-2.2 4.5H6.2z', '.3'),
  workshop:
    soft('M3 21v-9l4.5-3.5V12l4.5-3.5V12l4.5-3.5V21z', '.18') +
    line('M2 21h19M8 21v-4.5h4V21') +
    line('M16.5 8.5V2.8') +
    cloth('M16.5 2.8h4.5v3.4h-4.5z'),
  drumcircle:
    soft('M5 10v6.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V10') +
    `<ellipse cx="12" cy="10" rx="7" ry="2.5"/>` +
    line('M7.5 12.3l2.2 6.3M16.5 12.3l-2.2 6.3') +
    line('M7.5 2.5l3.5 5.5M16.5 2.5 13 8'),
  ward:
    soft('M12 6 15.9 17.9 5.7 10.6 18.3 10.6 8.1 17.9z', '.2') +
    `<circle cx="12" cy="12.6" r="8.8"/>`,
  druglab:
    tint('M7.4 14h9.2l2.6 4.7a1.4 1.4 0 0 1-1.2 2.1H6a1.4 1.4 0 0 1-1.2-2.1z', '.35') +
    line('M9 3h6M10 3v6.5L4.8 18.7A1.4 1.4 0 0 0 6 20.8h12a1.4 1.4 0 0 0 1.2-2.1L14 9.5V3') +
    `<circle cx="11" cy="17.3" r=".9"/><circle cx="13.6" cy="15.6" r=".6"/>`,
  gcc:
    soft('M3 13l4-2.5h10l4 2.5-9 4z', '.3') +
    line('M7 10.5v-8M17 10.5v-8') +
    cloth('M4.5 3.8h15v3.8h-15z') +
    `<circle cx="6.5" cy="19.5" r="1.8"/><circle cx="17.5" cy="19.5" r="1.8"/>`,
  // ── resources / HUD ────────────────────────────────────────────────────────
  lumber:
    `<circle cx="7.6" cy="16" r="3.6" fill="currentColor" fill-opacity=".2"/><circle cx="16.4" cy="16" r="3.6" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="8.6" r="3.6" fill="currentColor" fill-opacity=".2"/>` +
    dot(7.6, 16, 1) +
    dot(16.4, 16, 1) +
    dot(12, 8.6, 1),
  ritual:
    `<path d="M12 3.5c2.6 3 2.6 8.4 0 11.5c-2.6-3.1-2.6-8.5 0-11.5z" fill="var(--ic-flag, #ffd400)" stroke-width="1.3"/>` +
    soft('M12 15c-3.8 0-7.4-2.2-8.6-6.2c3.8 0 7.2 2.2 8.6 6.2zM12 15c3.8 0 7.4-2.2 8.6-6.2c-3.8 0-7.2 2.2-8.6 6.2z') +
    line('M5 18.5c4.2 2.2 9.8 2.2 14 0'),
  hippie:
    `<circle cx="9" cy="5.5" r="2.6" fill="currentColor" fill-opacity=".3"/>` +
    line('M9 9v6.2M9 15.2l-3 5.8M9 15.2l3 5.8M5 13l4-3.2 7-.3') +
    line('M16 4v9') +
    cloth('M16 4h4.5v3.4H16z'),
  attention:
    line('M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16') +
    `<circle cx="12" cy="12" r="3.6" fill="currentColor" fill-opacity=".25"/>` +
    dot(12, 12, 1.2),
  stock:
    soft('M5 13.5h14l-1.5 7.5h-11z') +
    line('M8.5 13.5V5M12 13.5V3M15.5 13.5V5') +
    cloth('M8.5 5H5.2v2.6h3.3z') +
    cloth('M12 3h3.3v2.6H12z') +
    cloth('M15.5 5h3.3v2.6h-3.3z'),
  cmi:
    soft('M4 20v-5h4v5zM10 20v-8.5h4V20zM16 20V8h4v12z', '.3') +
    line('M2.5 20.5h19') +
    `<path d="M7 2.5l2.2 2.8L7 9.5 4.8 5.3z" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>`,
  crystal:
    soft('M12 2.5l4 4.5v9l-4 5.5-4-5.5V7z', '.3') +
    line('M12 2.5v19M8 7l4 2.5L16 7') +
    line('M8 12.5l-3.4-2.2-1.4 6.4L8 19M16 12.5l3.4-2.2 1.4 6.4L16 19'),
  popcap:
    soft('M3 20.5 12 4l9 16.5z', '.15') +
    line('M2 20.5h20') +
    `<circle cx="12" cy="13" r="1.9" fill="currentColor"/>` +
    line('M8.6 20.5c0-2.5 1.5-4 3.4-4s3.4 1.5 3.4 4'),
  // ── GCC actions ────────────────────────────────────────────────────────────
  gift:
    soft('M4.5 11.5h15V21h-15z', '.2') +
    line('M3.5 8.5h17v3h-17zM12 8.5V21') +
    line('M12 8.5V2.8') +
    cloth('M12 2.8h5v3.4h-5z'),
  dialectics:
    line('M4.5 21V3M19.5 21V3') +
    cloth('M4.5 3h5.5v4h-5.5z') +
    `<path d="M19.5 3H14v4h5.5z" fill="var(--ic-flag, #ffd400)" fill-opacity=".35" stroke-width="1.2"/>` +
    line('M8 13c2.5-2 5.5-2 8 0M15.6 10.6 16 13l-2.4.4') +
    line('M16 17c-2.5 2-5.5 2-8 0M8.4 19.4 8 17l2.4-.4'),
  simulacra:
    line('M6 18V4.5') +
    cloth('M6 4.5h5.5v4H6z') +
    `<path d="M17 18V4.5" stroke-dasharray="2 2.2"/>` +
    `<path d="M17 4.5h5v4h-5z" fill="var(--ic-flag, #ffd400)" fill-opacity=".4" stroke-width="1.2" stroke-opacity=".6"/>` +
    `<circle cx="6" cy="20" r="1.6" fill="currentColor"/><circle cx="17" cy="20" r="1.6" fill="currentColor" fill-opacity=".35"/>` +
    line('M8.5 20c1.4-1.6 2.6-1.6 3 0s1.6 1.6 3 0'),
  // ── Command View plan tools ────────────────────────────────────────────────
  select:
    soft('M5 3v15l3.8-3.4 2.7 6 2.6-1.2-2.7-5.9 5.1-.3z', '.3'),
  node:
    line('M12 12.5V4.5M12 12.5 19.6 10M12 12.5 16.7 19M12 12.5 7.3 19M12 12.5 4.4 10') +
    `<circle cx="12" cy="12.5" r="2.6" fill="var(--ic-flag, #ffd400)" stroke-width="1.3"/>` +
    dot(12, 4.5) +
    dot(19.6, 10) +
    dot(16.7, 19) +
    dot(7.3, 19) +
    dot(4.4, 10),
  enclose:
    tint('M12 4.3 20.1 10.2 17 19.7H7L3.9 10.2z', '.15') +
    `<path d="M12 4.3 20.1 10.2 17 19.7H7L3.9 10.2z" stroke-dasharray="2.4 2.2"/>` +
    `<path d="M12 4.3h0M20.1 10.2h0M17 19.7h0M7 19.7h0M3.9 10.2h0" stroke="var(--ic-flag, #ffd400)" stroke-width="3.6"/>` +
    line('M10 11.5l4 4M14 11.5l-4 4'),
  pentacle:
    soft('M12 4.8 16.7 19.3 4.4 10.3h15.2L7.3 19.3z', '.15') +
    `<path d="M12 4.8h0M19.6 10.3h0M16.7 19.3h0M7.3 19.3h0M4.4 10.3h0" stroke="var(--ic-flag, #ffd400)" stroke-width="3.6"/>`,
  ring:
    `<circle cx="12" cy="12" r="8" stroke-dasharray="2.2 2.4"/>` +
    `<path d="M12 4h0M18.9 8h0M18.9 16h0M12 20h0M5.1 16h0M5.1 8h0" stroke="var(--ic-flag, #ffd400)" stroke-width="3.4"/>` +
    soft('M8.5 15.5V12L12 9l3.5 3v3.5z', '.3'),
  clear:
    tint('M13 4 20 11 14.5 16.5 7.5 9.5z', '.3') +
    line('M8.6 20.5 3.8 15.7a1.5 1.5 0 0 1 0-2.1L13 4.4a1.5 1.5 0 0 1 2.1 0l4.6 4.6a1.5 1.5 0 0 1 0 2.1L10.9 20M7.5 9.5l7 7M8.5 20.5H20'),
  // ── jobs ───────────────────────────────────────────────────────────────────
  survey:
    `<path d="M5 20.5 16 14.5" stroke-dasharray="1.8 2.2"/>` +
    line('M5 20.5V9.5') +
    cloth('M5 9.5h5v3.4H5z') +
    line('M16 14.5V3') +
    cloth('M16 3h5v3.4h-5z') +
    line('M3 20.5h4M14 14.5h4'),
  gather:
    tint('M5.5 15H18v6H5.5a3 3 0 0 1 0-6zM6.5 9H14v6H6.5a3 3 0 0 1 0-6z', '.2') +
    line('M18 15H5.5a3 3 0 0 0 0 6H18M14 9H6.5a3 3 0 0 0 0 6') +
    `<ellipse cx="18" cy="18" rx="2" ry="3"/><ellipse cx="14" cy="12" rx="2" ry="3"/>` +
    line('M21 3l-4.5 4.5M16.5 7.5h3.2M16.5 7.5V4.3'),
  defend:
    soft('M12 2.8l7.5 3V11c0 4.6-3.2 8.3-7.5 10.2C7.7 19.3 4.5 15.6 4.5 11V5.8z', '.15') +
    line('M10 17V8') +
    cloth('M10 8h5v3.6h-5z'),
  raid:
    line('M11.5 21 6.8 6.5') +
    `<path d="M6.8 6.5l5.6-1.8 1.3 4-5.6 1.8z" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>` +
    line('M14 13c3 0 5.5 1.8 6.5 5M20.5 18l-.3-3.2M20.5 18l-3-.9') +
    line('M15 3l2.2 2.2M18.5 2.8v2.8M20.5 6.4h-2.8'),
  drum:
    soft('M6 10.5v6c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3v-6') +
    `<ellipse cx="12" cy="10.5" rx="6" ry="2.2"/>` +
    line('M8.5 3.5l2.5 5M15.5 3.5 13 8.5') +
    line('M3 5.5a8 8 0 0 0-.5 5M21 5.5a8 8 0 0 1 .5 5'),
  // ── hippie statuses (simple shapes: these must read at 14px) ──────────────
  idle: line('M4 9h6l-6 7h6M13 4h7l-7 8h7'),
  walk:
    `<path d="M7.5 3c2 0 3 1.7 3 4.2S9.4 12 7.5 12 4.5 9.7 4.5 7.2 5.5 3 7.5 3zM16.5 11c2 0 3 1.7 3 4.2S18.4 20 16.5 20s-3-2.3-3-4.8 1-4.2 3-4.2z" fill="currentColor" fill-opacity=".35"/>` +
    line('M5.5 14.5h4M14.5 22h4'),
  carry:
    soft('M9.5 7.5c-3.5 2-5.5 5.5-5.2 9 .3 3 3 4 7.7 4s7.4-1 7.7-4c.3-3.5-1.7-7-5.2-9z', '.35') +
    line('M9.5 7.5 8.5 4h7l-1 3.5'),
  plant:
    line('M9 19V3') +
    cloth('M9 3h8v5.5H9z') +
    line('M3 21h12M19 12v8M16.5 17.5 19 20l2.5-2.5'),
  pull:
    line('M9 15V3') +
    cloth('M9 3h8v5.5H9z') +
    line('M3 21h12M19 20v-8M16.5 14.5 19 12l2.5 2.5'),
  steal:
    line('M6 21V5') +
    cloth('M6 5h7v5H6z') +
    line('M10 15.5c3.5 0 7-1.8 9.5-5M19.5 10.5v3.6M19.5 10.5l-3.4.9'),
  chop:
    line('M5 21 15 11') +
    soft('M12 8l3.5-4.5 5 5L16 12c-1.6-.5-3.5-2.4-4-4z', '.4') +
    line('M3 10.5a8 8 0 0 1 4.5-6'),
  build:
    line('M4 20l9.2-9.2') +
    soft('M9.7 7.2 16.8 14.3 19.5 11.6 12.4 4.5z', '.4'),
  repair:
    soft('M14.5 3.5a5 5 0 0 0-4.6 6.9L3.6 16.7a2 2 0 0 0 2.8 2.8l6.3-6.3A5 5 0 0 0 19.6 8.6l-3 3-2.7-.6-.6-2.7 3-3a5 5 0 0 0-1.8-.4z'),
  fight:
    `<path d="M4.5 4.5l15 15M19.5 4.5l-15 15" stroke-width="2.4"/>` +
    dot(4.5, 4.5, 2) +
    dot(19.5, 4.5, 2) +
    dot(4.5, 19.5, 2) +
    dot(19.5, 19.5, 2),
  tear:
    soft('M3 8h7.5l1.5 2.5-1.5 2-1 3.5H3zM21 8h-7l1 2.5-1.5 2 1.5 3.5h6z', '.3') +
    line('M12 4v1.5M12 18.5V20M8 3.5l.8 1.5M16 3.5l-.8 1.5'),
  follow:
    `<circle cx="17.5" cy="12" r="3.6" fill="currentColor" fill-opacity=".35"/>` +
    line('M2.5 12h9M8 8.5l3.5 3.5L8 15.5'),
  respond:
    line('M3 21l8.2-8.2M5.8 13.5l5.4-.7-.7 5.4') +
    `<circle cx="16" cy="8" r="2" fill="currentColor"/>` +
    line('M12 4a5.7 5.7 0 0 1 8 0M20 12a5.7 5.7 0 0 0 0-8'),
  distracted:
    line('M9 18V5.5l11-2.5v12.5') +
    `<ellipse cx="6.5" cy="18" rx="2.8" ry="2.2" fill="currentColor"/><ellipse cx="17.5" cy="15.5" rx="2.8" ry="2.2" fill="currentColor"/>` +
    line('M9 9.5l11-2.5'),
  flee:
    line('M12 5 5 12l7 7M19 5l-7 7 7 7'),
  ko:
    `<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".2"/>` +
    line('M7 8.5l3 3M10 8.5l-3 3M14 8.5l3 3M17 8.5l-3 3M8.5 16.5h7'),
  // ── clock / events ─────────────────────────────────────────────────────────
  sun:
    `<circle cx="12" cy="12" r="4.2" fill="var(--ic-flag, #ffd400)" stroke-width="1.3"/>` +
    line('M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6'),
  dusk:
    `<path d="M6.5 16a5.5 5.5 0 0 1 11 0z" fill="var(--ic-flag, #ffd400)" fill-opacity=".7" stroke-width="1.3"/>` +
    line('M2.5 16h19M12 5.5v2.5M4.6 9.1l1.8 1.8M19.4 9.1l-1.8 1.8M6 20h12'),
  moon: soft('M19.5 14.8A8 8 0 1 1 9.2 4.5a6.4 6.4 0 0 0 10.3 10.3z', '.3'),
  // Unlike dusk: a full-bright half sun, rays fanning upward and an arrow climbing out of it.
  dawn:
    `<path d="M6.5 17a5.5 5.5 0 0 1 11 0z" fill="var(--ic-flag, #ffd400)" stroke-width="1.3"/>` +
    line('M2.5 17h19M12 9V2.8M9.8 5 12 2.8 14.2 5M4.4 10.4l1.8 1.6M19.6 10.4l-1.8 1.6M2.8 14h1.9M19.3 14h1.9'),
  tide:
    soft('M12 3l3 4.5-3 4.5-3-4.5z', '.35') +
    line('M2.5 15.5c2.4-2 4.7-2 7.1 0s4.7 2 7.1 0 3.6-1.5 4.8-.6M2.5 20c2.4-2 4.7-2 7.1 0s4.7 2 7.1 0 3.6-1.5 4.8-.6'),
  burn:
    soft('M12 21.5c-4.4 0-7-2.8-7-6.4c0-3 1.8-4.6 3-6.3c.4 1.8 1.4 2.8 2.4 3.1c-.6-3.7 1.4-6.8 4.2-9.4c0 4.2 5.4 6.4 5.4 12.6c0 3.6-3.4 6.4-8 6.4z', '.2') +
    `<path d="M12 21.5c-1.8 0-3-1.2-3-2.8c0-1.9 1.7-3 3-5c1.3 2 3 3.1 3 5c0 1.6-1.2 2.8-3 2.8z" fill="var(--ic-flag, #ffd400)" stroke="none"/>`,
  clock: soft('M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', '.15') + line('M12 6.5V12l3.8 2.4'),
  eye:
    soft('M2.5 12c3-5 16-5 19 0c-3 5-16 5-19 0z', '.15') +
    `<circle cx="12" cy="12" r="3"/>` +
    dot(12, 12, 1.2),
  shot:
    `<path d="M7.3 10.5h9.4l-.8 9.5H8.1z" fill="var(--ic-flag, #ffd400)" fill-opacity=".8" stroke="none"/>` +
    line('M6 4h12l-1.4 16.5H7.4zM6.6 10.5h10.8'),
  ping:
    soft('M12 21.5s-6.5-6.3-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11.5-6.5 11.5z', '.2') +
    `<circle cx="12" cy="10" r="2.4" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>`,
  sos:
    soft('M6.5 17v-4.5a5.5 5.5 0 0 1 11 0V17z', '.35') +
    line('M4.5 17h15v3.5h-15zM12 2.5V4.5M4.4 5.4l1.4 1.4M19.6 5.4l-1.4 1.4M2.5 11.5h1.8M19.7 11.5h1.8M12 9.5a3 3 0 0 0-3 3'),
  rally:
    line('M12 21V3') +
    cloth('M12 3h8l-2.2 3 2.2 3h-8z') +
    line('M3.5 13.5 9 19M9 19v-3.6M9 19H5.4M20.5 13.5 15 19M15 19v-3.6M15 19h3.6'),
  attack:
    `<circle cx="12" cy="12" r="6.5"/>` +
    line('M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5') +
    dot(12, 12, 1.4),
  // ── UI chrome ──────────────────────────────────────────────────────────────
  close: line('M6 6l12 12M18 6 6 18'),
  settings:
    soft('M10.6 4.9 10.8 2.6h2.4l.2 2.3L16 6l1.8-1.5 1.7 1.7L18 8l1.1 2.6 2.3.2v2.4l-2.3.2L18 16l1.5 1.8-1.7 1.7L16 18l-2.6 1.1-.2 2.3h-2.4l-.2-2.3L8 18l-1.8 1.5-1.7-1.7L6 16l-1.1-2.6-2.3-.2v-2.4l2.3-.2L6 8 4.5 6.2l1.7-1.7L8 6z', '.2') +
    `<circle cx="12" cy="12" r="3.2"/>`,
  book:
    soft('M12 6.5C10 5 7 4.5 3 4.8v13.7c4-.3 7 .2 9 1.7zM12 6.5c2-1.5 5-2 9-1.7v13.7c-4-.3-7 .2-9 1.7z', '.15') +
    line('M12 6.5v13.7') +
    `<path d="M16.5 3v6.5l1.5-1.3 1.5 1.3V4.5" fill="var(--ic-flag, #ffd400)" stroke-width="1.2"/>`,
  help:
    `<circle cx="12" cy="12" r="9"/>` +
    line('M9.3 9.3a2.8 2.8 0 1 1 3.8 2.6c-.7.3-1.1 1-1.1 1.7v.6') +
    dot(12, 17, 1.2),
  play: `<path d="M7 4.5v15l12-7.5z" fill="currentColor" fill-opacity=".85"/>`,
  lock:
    soft('M5 11h14v10H5z') +
    line('M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2.5'),
  skull:
    soft('M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.4 3 5.5V20h10v-3.5c1.7-1.1 3-2.9 3-5.5a8 8 0 0 0-8-8z', '.2') +
    line('M10 20v-2M14 20v-2') +
    `<circle cx="8.8" cy="11.5" r="2" fill="currentColor"/><circle cx="15.2" cy="11.5" r="2" fill="currentColor"/>` +
    line('M12 14.5l-.8 1.6h1.6z'),
  star:
    soft('M12 3.1 14.3 9.4 21 9.7 15.7 13.8 17.6 20.3 12 16.5 6.4 20.3 8.3 13.8 3 9.7 9.7 9.4z', '.3'),
  warning:
    soft('M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z', '.2') +
    line('M12 9v5') +
    dot(12, 17.2, 1.2),
};

/** Full inline SVG string, e.g. for innerHTML at construction time. */
export function iconSvg(name: IconName, cls?: string): string {
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
