/**
 * Canvas-drawn sprite atlas (1024²) for VFX billboards: the D.E.G.E.N. ping icons and the
 * lettered banners ("OVERWRITTEN", "TAKE A SHOT"). Glyphs are white with a soft white glow
 * and a dark outline: the billboard shader tints the white per use (ping kind, captor
 * colour) while the outline keeps them legible over sky, grass or bloom.
 */
import type { PingKind } from '../../sim/types';

export const ATLAS_SIZE = 1024;

export type AtlasKey = PingKind | 'overwritten' | 'takeShot';

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Width / height. */
  aspect: number;
}

const ICON = 256;

/** Pixel rects (x, y, w, h) in canvas space (y down). */
const PIXELS: Record<AtlasKey, readonly [number, number, number, number]> = {
  rally: [0, 0, ICON, ICON],
  attack: [ICON, 0, ICON, ICON],
  flag: [ICON * 2, 0, ICON, ICON],
  sos: [ICON * 3, 0, ICON, ICON],
  shot: [0, ICON, ICON, ICON],
  overwritten: [0, 512, 1024, 256],
  takeShot: [0, 768, 1024, 256],
};

function toUv(p: readonly [number, number, number, number]): AtlasRect {
  const [x, y, w, h] = p;
  // CanvasTexture flips Y on upload: canvas row 0 is v = 1.
  return { u0: x / ATLAS_SIZE, v0: 1 - (y + h) / ATLAS_SIZE, u1: (x + w) / ATLAS_SIZE, v1: 1 - y / ATLAS_SIZE, aspect: w / h };
}

export const ATLAS_RECTS: Record<AtlasKey, AtlasRect> = {
  rally: toUv(PIXELS.rally),
  attack: toUv(PIXELS.attack),
  flag: toUv(PIXELS.flag),
  sos: toUv(PIXELS.sos),
  shot: toUv(PIXELS.shot),
  overwritten: toUv(PIXELS.overwritten),
  takeShot: toUv(PIXELS.takeShot),
};

const OUTLINE = 'rgba(8, 6, 14, 0.92)';
const GLOW = 'rgba(255, 255, 255, 0.85)';

/**
 * Ink a glyph: glow pass, dark outline, white body. `lines` are stroked, `fills` filled;
 * coordinates are in a 256-unit icon cell centred on (0, 0).
 */
function ink(g: CanvasRenderingContext2D, lines: Path2D, fills: Path2D, lineWidth: number): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.shadowColor = GLOW;
  g.shadowBlur = 18;
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = lineWidth;
  g.stroke(lines);
  g.fill(fills);
  g.shadowBlur = 0;
  g.strokeStyle = OUTLINE;
  g.lineWidth = lineWidth + 14;
  g.stroke(lines);
  g.lineWidth = 14;
  g.stroke(fills);
  g.strokeStyle = '#ffffff';
  g.lineWidth = lineWidth;
  g.stroke(lines);
  g.fill(fills);
}

function drawRally(g: CanvasRenderingContext2D): void {
  const lines = new Path2D();
  const fills = new Path2D();
  lines.arc(0, 0, 84, 0, Math.PI * 2);
  // Four chevrons converging on the rally point.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tip = 26;
    const back = 58;
    const wing = 20;
    lines.moveTo(c * back - s * wing, s * back + c * wing);
    lines.lineTo(c * tip, s * tip);
    lines.lineTo(c * back + s * wing, s * back - c * wing);
  }
  fills.arc(0, 0, 12, 0, Math.PI * 2);
  ink(g, lines, fills, 13);
}

function drawAttack(g: CanvasRenderingContext2D): void {
  const lines = new Path2D();
  const fills = new Path2D();
  lines.arc(0, 0, 62, 0, Math.PI * 2);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    lines.moveTo(Math.cos(a) * 36, Math.sin(a) * 36);
    lines.lineTo(Math.cos(a) * 104, Math.sin(a) * 104);
  }
  fills.moveTo(0, -22);
  fills.lineTo(18, 0);
  fills.lineTo(0, 22);
  fills.lineTo(-18, 0);
  fills.closePath();
  ink(g, lines, fills, 14);
}

function drawFlag(g: CanvasRenderingContext2D): void {
  const lines = new Path2D();
  const fills = new Path2D();
  lines.moveTo(-58, 100);
  lines.lineTo(-58, -100);
  lines.moveTo(-86, 100);
  lines.lineTo(-30, 100);
  // Waving cloth.
  fills.moveTo(-58, -98);
  fills.bezierCurveTo(-10, -126, 30, -70, 84, -96);
  fills.lineTo(84, -12);
  fills.bezierCurveTo(30, 14, -10, -42, -58, -14);
  fills.closePath();
  ink(g, lines, fills, 14);
}

function drawSos(g: CanvasRenderingContext2D): void {
  const lines = new Path2D();
  const fills = new Path2D();
  lines.moveTo(0, -104);
  lines.lineTo(106, 80);
  lines.lineTo(-106, 80);
  lines.closePath();
  ink(g, lines, fills, 13);
  g.font = '400 64px "Bungee", "Rubik", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = OUTLINE;
  g.lineWidth = 12;
  g.strokeText('SOS', 0, 30);
  g.fillStyle = '#ffffff';
  g.fillText('SOS', 0, 30);
}

function drawShot(g: CanvasRenderingContext2D): void {
  const lines = new Path2D();
  const fills = new Path2D();
  // Shot glass (wider rim), liquid inside, three sparkles.
  lines.moveTo(-62, -70);
  lines.lineTo(-44, 92);
  lines.lineTo(44, 92);
  lines.lineTo(62, -70);
  fills.moveTo(-53, 8);
  fills.lineTo(-44, 84);
  fills.lineTo(44, 84);
  fills.lineTo(53, 8);
  fills.closePath();
  const sparkle = (x: number, y: number, r: number): void => {
    lines.moveTo(x - r, y);
    lines.lineTo(x + r, y);
    lines.moveTo(x, y - r);
    lines.lineTo(x, y + r);
  };
  sparkle(-88, -96, 16);
  sparkle(84, -104, 20);
  sparkle(0, -112, 12);
  ink(g, lines, fills, 12);
}

/** Lettered banner fitted into a 1024×256 cell. */
function drawBanner(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, cy: number): void {
  let px = 168;
  g.font = font(px);
  const width = g.measureText(text).width;
  if (width > 960) {
    px = Math.floor((px * 960) / width);
    g.font = font(px);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.shadowColor = GLOW;
  g.shadowBlur = 28;
  g.fillStyle = '#ffffff';
  g.fillText(text, 512, cy);
  g.shadowBlur = 0;
  g.strokeStyle = OUTLINE;
  g.lineWidth = Math.max(8, px * 0.07);
  g.strokeText(text, 512, cy);
  g.fillText(text, 512, cy);
}

const DRAW_ICON: Record<PingKind, (g: CanvasRenderingContext2D) => void> = {
  rally: drawRally,
  attack: drawAttack,
  flag: drawFlag,
  sos: drawSos,
  shot: drawShot,
};
const PING_KINDS: readonly PingKind[] = ['rally', 'attack', 'flag', 'sos', 'shot'];

/** Paint the whole atlas (call again once late-loading fonts arrive). */
export function paintAtlas(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const kind of PING_KINDS) {
    const [x, y, w, h] = PIXELS[kind];
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(0.84, 0.84);
    DRAW_ICON[kind](g);
    g.restore();
  }
  g.save();
  drawBanner(g, 'OVERWRITTEN', (px) => `700 ${px}px "Cinzel Decorative", "Cinzel", serif`, 512 + 128);
  drawBanner(g, 'TAKE A SHOT', (px) => `400 ${px}px "Bungee", "Rubik", sans-serif`, 768 + 128);
  g.restore();
}

/** Fonts the atlas letters with; awaited before repainting. */
export const ATLAS_FONTS = ['700 96px "Cinzel Decorative"', '400 64px "Bungee"'];
