/**
 * Festival cloth written straight into the swaying cloth batch (world space): sagging
 * strings of prayer flags / bunting between tents and poles, pennants on garden poles and
 * feather banners. Sway weights are 0 where the cloth is tied (string ends, pole edges) and
 * grow toward free edges, so pinned points stay put while the rest flutters.
 */
import * as THREE from 'three';
import type { GeoWriter } from './batch';

/** Tibetan order (blue, white, red, green, saffron). */
const PRAYER = [0x2f6fd8, 0xf1efe8, 0xd8423a, 0x3aa564, 0xef8a2a];
const BUNTING = [0xe2487f, 0x2fb5d8, 0xf0a020, 0x8a53c1, 0x3aa564, 0xd8423a, 0xf1efe8];
const ROPE = 0xe6dfcc;

export type StringStyle = 'prayer' | 'bunting';

const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const pc = new THREE.Vector3();
const pd = new THREE.Vector3();

/** Point on a parabolic sag between a and b (t in 0..1). */
function sagPoint(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number, sag: number): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y -= sag * 4 * t * (1 - t);
  return out;
}

/**
 * A rope from a to b hung with pennants (prayer flags: squares; bunting: triangles). Colours
 * cycle from `phase` so neighbouring strings differ.
 */
export function flagString(w: GeoWriter, a: THREE.Vector3, b: THREE.Vector3, style: StringStyle, phase = 0): void {
  const len = a.distanceTo(b);
  if (len < 1) return;
  const sag = 0.05 * len + 0.06;
  // Rope: a thin vertical ribbon, swaying most at mid-span.
  const segs = Math.max(4, Math.ceil(len / 1.2));
  w.paint(ROPE);
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    sagPoint(pa, a, b, t0, sag);
    sagPoint(pb, a, b, t1, sag);
    pc.copy(pb).y -= 0.018;
    pd.copy(pa).y -= 0.018;
    const w0 = 0.35 * 4 * t0 * (1 - t0);
    const w1 = 0.35 * 4 * t1 * (1 - t1);
    w.quad(pa, pb, pc, pd, w0, w1, w1, w0);
  }
  const palette = style === 'prayer' ? PRAYER : BUNTING;
  const width = style === 'prayer' ? 0.24 : 0.26;
  const pitch = style === 'prayer' ? 0.31 : 0.36;
  const drop = style === 'prayer' ? 0.27 : 0.3;
  const n = Math.floor((len - 0.4) / pitch);
  const start = (len - (n - 1) * pitch - width) / 2;
  for (let i = 0; i < n; i++) {
    const t0 = (start + i * pitch) / len;
    const t1 = (start + i * pitch + width) / len;
    sagPoint(pa, a, b, t0, sag);
    sagPoint(pb, a, b, t1, sag);
    const w0 = 0.35 * 4 * t0 * (1 - t0);
    const w1 = 0.35 * 4 * t1 * (1 - t1);
    w.paint(palette[(i + phase) % palette.length]);
    if (style === 'prayer') {
      pc.copy(pb).y -= drop;
      pd.copy(pa).y -= drop;
      w.quad(pa, pb, pc, pd, w0, w1, w1 + 0.75, w0 + 0.75);
    } else {
      pc.lerpVectors(pa, pb, 0.5).y -= drop;
      w.tri(pa, pb, pc, w0, w1, (w0 + w1) / 2 + 0.85);
    }
  }
}

/** Small triangular pennant flying from the top of a pole at `top`, pointing along `dir`. */
export function pennant(w: GeoWriter, top: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, size = 0.55): void {
  w.paint(color);
  pa.copy(top);
  pb.copy(top).y -= size * 0.6;
  pc.copy(top).addScaledVector(dir, size).y -= size * 0.3;
  w.tri(pa, pb, pc, 0, 0, 1);
}

/**
 * Feather banner: a tall curved sail on a pole from `base` (ground) up `height`, flying
 * toward `dir` (horizontal unit vector). Body in `color` with a white stripe.
 */
export function featherBanner(w: GeoWriter, base: THREE.Vector3, dir: THREE.Vector3, height: number, color: THREE.ColorRepresentation): void {
  const rows = 8;
  const y0 = 0.5;
  const width = height * 0.24;
  for (let i = 0; i < rows; i++) {
    const v0 = i / rows;
    const v1 = (i + 1) / rows;
    // Teardrop profile: narrow at the bottom, full width high up, rounded top.
    const f0 = Math.sin(Math.min(1, v0 * 1.35) * Math.PI * 0.5) * (v0 > 0.82 ? Math.cos(((v0 - 0.82) / 0.18) * Math.PI * 0.5) : 1);
    const f1 = Math.sin(Math.min(1, v1 * 1.35) * Math.PI * 0.5) * (v1 > 0.82 ? Math.cos(((v1 - 0.82) / 0.18) * Math.PI * 0.5) : 1);
    const h0 = y0 + v0 * (height - y0);
    const h1 = y0 + v1 * (height - y0);
    pa.copy(base).y += h0;
    pb.copy(base).y += h1;
    pc.copy(base).addScaledVector(dir, width * f1).y += h1;
    pd.copy(base).addScaledVector(dir, width * f0).y += h0;
    w.paint(i === 5 ? 0xf4f1ea : color);
    const s0 = 0.25 + 0.75 * v0;
    const s1 = 0.25 + 0.75 * v1;
    w.quad(pa, pb, pc, pd, 0, 0, s1, s0);
  }
}
