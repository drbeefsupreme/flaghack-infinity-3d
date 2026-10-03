/**
 * The Seal of Flagistan: a pentagonal seal assembled from one fragment per Training Burn
 * lesson, from the boundary inward, the way a Survey crystallizes. The outer band comes first
 * (its sides split evenly among the first lessons), then the five Flag-yellow points of the
 * pentagram, the saffron core, and last the Flag at its heart.
 *
 * Unearned fragments show as dashed engravings on the brass plate. Earned ones are filled.
 * A newly earned fragment flies in from outside, and the whole Seal assembles in sequence at
 * graduation (Web Animations, so restarting needs no reflow tricks).
 */
import { el } from '../dom';

type FragmentKind = 'band' | 'point' | 'core' | 'flag';
/** Gradient a fragment part is painted with: gold metal, Flag yellow, saffron. */
type Paint = 'gold' | 'yellow' | 'saffron';

interface Fragment {
  kind: FragmentKind;
  /** Outline of the whole fragment: the ghost engraving while unearned. */
  ghost: string;
  /** Filled shapes once earned. */
  parts: readonly { d: string; paint: Paint }[];
  /** Centroid: fragments fly in along it and the award burst rings from it. */
  cx: number;
  cy: number;
}

const R_OUT = 92;
const R_IN = 66;
const R_STAR = 60;
/** The pentagram's inner pentagon: R · cos 72° / cos 36°. */
const R_STAR_IN = R_STAR * 0.381966;
const STEP = (Math.PI * 2) / 5;
const FLY_DIST = 46;
const FLY_MS = 900;
/** Graduation assembly: first fragment's delay and the stagger between fragments. */
const ASSEMBLE_START_MS = 260;
const ASSEMBLE_STEP_MS = 140;

const POLY_PAINT: Record<Exclude<FragmentKind, 'flag'>, Paint> = { band: 'gold', point: 'yellow', core: 'saffron' };

/** The Flag at the heart, sized to the core: a gold pole with its finial, and the yellow cloth. */
const HEART_POLE = 'M-8.6 -12.6H-6V15H-8.6ZM-9.5 -14.4a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0Z';
const HEART_CLOTH = 'M-6 -12.4C-1.2 -15.6 3.6 -9 11 -12V-0.8C3.6 2.2 -1.2 -4.4 -6 -1.4Z';

/** Corner k (fractional k is allowed) of a pentagon of radius r with its first corner up. */
function corner(r: number, k: number): [number, number] {
  const a = -Math.PI / 2 + k * STEP;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Point at perimeter parameter t (side units: side k runs from corner k to corner k + 1). */
function perimeter(r: number, t: number): [number, number] {
  const k = Math.floor(t);
  const f = t - k;
  const [ax, ay] = corner(r, k);
  const [bx, by] = corner(r, k + 1);
  return [ax + (bx - ax) * f, ay + (by - ay) * f];
}

function polygon(kind: Exclude<FragmentKind, 'flag'>, pts: readonly (readonly [number, number])[]): Fragment {
  let d = '';
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    cx += x;
    cy += y;
  }
  d += 'Z';
  return { kind, ghost: d, parts: [{ d, paint: POLY_PAINT[kind] }], cx: cx / pts.length, cy: cy / pts.length };
}

/** The band between the outer and inner pentagons from perimeter t0 to t1. */
function bandPiece(t0: number, t1: number): Fragment {
  const pts: [number, number][] = [perimeter(R_OUT, t0)];
  for (let v = Math.floor(t0) + 1; v < t1; v++) pts.push(corner(R_OUT, v));
  pts.push(perimeter(R_OUT, t1), perimeter(R_IN, t1));
  for (let v = Math.ceil(t1) - 1; v > t0; v--) pts.push(corner(R_IN, v));
  pts.push(perimeter(R_IN, t0));
  return polygon('band', pts);
}

/** Fragments in award order for a course of `n` lessons. */
function sealFragments(n: number): Fragment[] {
  const out: Fragment[] = [];
  if (n <= 0) return out;
  const tail = n >= 2 ? 2 : 1;
  const points = n >= 8 ? 5 : 0;
  const band = n - tail - points;
  for (let i = 0; i < band; i++) out.push(bandPiece((i * 5) / band, ((i + 1) * 5) / band));
  for (let k = 0; k < points; k++) {
    out.push(polygon('point', [corner(R_STAR, k), corner(R_STAR_IN, k + 0.5), corner(R_STAR_IN, k - 0.5)]));
  }
  if (tail === 2) {
    const core: [number, number][] = [];
    for (let k = 0; k < 5; k++) core.push(corner(R_STAR_IN, k + 0.5));
    out.push(polygon('core', core));
  }
  out.push({
    kind: 'flag',
    ghost: HEART_POLE + HEART_CLOTH,
    parts: [
      { d: HEART_POLE, paint: 'gold' },
      { d: HEART_CLOTH, paint: 'yellow' },
    ],
    cx: 0,
    cy: 0,
  });
  return out;
}

let nextUid = 0;

function sealMarkup(frags: readonly Fragment[], u: string): string {
  let plate = '';
  for (let k = 0; k < 5; k++) {
    const [x, y] = corner(R_OUT + 7, k);
    plate += `${k === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  let star = '';
  for (let i = 0; i < 5; i++) {
    const [x, y] = corner(R_STAR, (i * 2) % 5);
    star += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  let body = '';
  for (const f of frags) {
    body += `<g class="sf sf-${f.kind}"><path class="sf-ghost" d="${f.ghost}"/>`;
    for (const p of f.parts) body += `<path class="sf-fill" d="${p.d}" fill="url(#${u}-${p.paint})"/>`;
    body += '</g>';
  }
  return (
    `<svg class="seal-svg" viewBox="-104 -104 208 208" aria-hidden="true">` +
    '<defs>' +
    `<linearGradient id="${u}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="#e3ae42"/><stop offset="1" stop-color="#9c6a1a"/></linearGradient>` +
    `<linearGradient id="${u}-yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset=".55" stop-color="#ffd400"/><stop offset="1" stop-color="#e09a00"/></linearGradient>` +
    `<radialGradient id="${u}-saffron" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#ffc56b"/><stop offset=".6" stop-color="#ff8c1a"/><stop offset="1" stop-color="#b85200"/></radialGradient>` +
    '</defs>' +
    `<path class="seal-plate" d="${plate}Z"/>` +
    `<path class="seal-engrave" d="${star}Z"/>` +
    body +
    '<circle class="seal-burst" r="18" cx="0" cy="0"/>' +
    '</svg>'
  );
}

export class SealView {
  readonly node: HTMLElement;
  private frags: SVGGElement[] = [];
  private geometry: Fragment[] = [];
  private burst: SVGCircleElement | null = null;
  private earned: boolean[] = [];

  constructor(parent: HTMLElement, cls: string) {
    this.node = el('div', `seal ${cls}`, parent);
  }

  /**
   * Show which fragments are earned (course order). With `award`, that fragment flies in even
   * if it was already shown as earned. Fragments earned without an award (restored progress,
   * a jump through the lesson list) appear in place.
   */
  sync(earned: readonly boolean[], award = -1): void {
    if (earned.length !== this.geometry.length) this.build(earned.length);
    for (let i = 0; i < earned.length; i++) {
      const on = earned[i];
      if (on === this.earned[i] && i !== award) continue;
      this.earned[i] = on;
      this.frags[i].classList.toggle('on', on);
    }
    if (award >= 0 && award < this.frags.length && earned[award]) {
      const g = this.geometry[award];
      this.flyIn(award, 0);
      this.ring(g.cx, g.cy, FLY_MS * 0.7, 2.6);
    }
  }

  /**
   * Graduation: the earned fragments assemble one by one; a whole Seal then sends a ring out
   * from its heart. Skipped lessons stay as gaps.
   */
  assemble(earned: readonly boolean[]): void {
    this.sync(earned);
    let step = 0;
    for (let i = 0; i < this.frags.length; i++) if (earned[i]) this.flyIn(i, ASSEMBLE_START_MS + step++ * ASSEMBLE_STEP_MS);
    if (step === this.frags.length) this.ring(0, 0, ASSEMBLE_START_MS + step * ASSEMBLE_STEP_MS + FLY_MS * 0.5, 6);
  }

  private build(n: number): void {
    this.geometry = sealFragments(n);
    this.node.innerHTML = sealMarkup(this.geometry, `seal${nextUid++}`);
    this.frags = Array.from(this.node.querySelectorAll<SVGGElement>('g.sf'));
    this.burst = this.node.querySelector<SVGCircleElement>('circle.seal-burst');
    this.earned = this.geometry.map(() => false);
  }

  private flyIn(i: number, delay: number): void {
    const g = this.geometry[i];
    const len = Math.hypot(g.cx, g.cy);
    // The core and the Flag sit at the centre: they drop in from above instead.
    const fx = len > 1 ? (g.cx / len) * FLY_DIST : 0;
    const fy = len > 1 ? (g.cy / len) * FLY_DIST : -FLY_DIST;
    this.frags[i].animate(
      [
        { transform: `translate(${fx}px, ${fy}px) scale(1.7) rotate(-28deg)`, opacity: 0 },
        { transform: 'translate(0px, 0px) scale(0.94) rotate(2deg)', opacity: 1, offset: 0.72 },
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1 },
      ],
      { duration: FLY_MS, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
    );
  }

  /** A bright ring expanding from (cx, cy) once the fragment lands (invisible while it waits). */
  private ring(cx: number, cy: number, delay: number, scale: number): void {
    const burst = this.burst;
    if (!burst) return;
    burst.setAttribute('cx', cx.toFixed(1));
    burst.setAttribute('cy', cy.toFixed(1));
    burst.animate(
      [
        { transform: 'scale(0.2)', opacity: 0 },
        { transform: `scale(${scale * 0.2})`, opacity: 0.95, offset: 0.12 },
        { transform: `scale(${scale})`, opacity: 0 },
      ],
      { duration: 820, delay, easing: 'ease-out', fill: 'backwards' },
    );
  }
}
