/**
 * Art installations (kind 'art': circle radius r, height h, accent colour, variant 0–5), all
 * lit at night:
 *   0 mushroom grove   giant spotted cap in the accent colour over bioluminescent gills, with
 *                      a few small companions
 *   1 rainbow arch     seven LED bands on an elliptical arch
 *   2 metal spiral     a tapering copper ribbon helix with an LED edge, slowly turning
 *   3 Flag pinwheel    five Survey Flags (gold front, saffron back) spinning on a tall pole
 *   4 LED totem        stacked panels cycling the rainbow, a pulsing star, glowing bollards
 *   5 pyramid          dark glossy faces, neon edges, a floating golden capstone and an eye
 * Turning parts are instanced rotors: buildArt returns their base transforms, PropField spins
 * them (spiral about its template y axis, pinwheel about its template z axis).
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import type { Rng } from '../../../sim/rng';
import { GlowMode, PartsBuilder } from '../geom';
import { flat, frameOf, GeoWriter, mergeTemplates, taper, within } from './batch';
import type { PropBatches } from './kit';
import { obstacleRng } from './kit';

const TAU = Math.PI * 2;
const RAINBOW = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x3949ab, 0x8e24aa];
const STEM = 0xefe6d2;
const MUSHROOM_CAPS = [0xd8342c, 0x8a53c1, 0x1f9e95, 0xe2487f, 0xf08c2a];
const GILL_GLOW = [0x7ff6ff, 0xff8af0, 0xb6ff7a];
const COPPER = 0xb5683a;
const GOLD = 0xffd400;
const SAFFRON = 0xf4a300;
const DARK = 0x1b1b24;
const PANEL = 0x3a3f4a;
const STONE = 0x6b6a66;

export interface Rotor {
  /** Placement before the spin (the spin turns the template about its own axis). */
  matrix: THREE.Matrix4;
  color: THREE.Color;
  /** rad/s */
  speed: number;
  phase: number;
}

export interface ArtRotors {
  spiral: Rotor[];
  pinwheel: Rotor[];
}

const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const pc = new THREE.Vector3();
const pd = new THREE.Vector3();
const dir = new THREE.Vector3();

// ── 0 Mushroom ────────────────────────────────────────────────────────────────

function mushroom(b: PartsBuilder, w: GeoWriter, x: number, z: number, h: number, capR: number, cap: number, gill: number, rng: Rng): void {
  const capH = capR * 0.58;
  const stemTop = h - capH * 0.92;
  const rs = Math.max(0.1, capR * 0.2);
  const bend = rng.range(-0.08, 0.08) * h;
  const ys = [0, stemTop * 0.4, stemTop * 0.75, stemTop];
  const rr = [rs * 1.45, rs, rs * 0.92, rs * 0.85];
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3(x + bend * (ys[i] / stemTop) ** 2, ys[i], z);
    const c = new THREE.Vector3(x + bend * (ys[i + 1] / stemTop) ** 2, ys[i + 1], z);
    taper(b, a, c, rr[i], rr[i + 1], STEM, { segments: 10 });
  }
  const cx = x + bend;
  b.add(flat(new THREE.CylinderGeometry(rs * 1.7, rs * 1.0, stemTop * 0.08, 10, 1, true)), STEM, { x: x + bend * 0.5, y: stemTop * 0.74, z });
  b.add(flat(new THREE.SphereGeometry(capR, 16, 5, 0, TAU, 0, Math.PI / 2)), cap, { x: cx, y: stemTop, z, sy: 0.58 });
  // Gills: radial lamellae glowing at night on the cap's underside.
  const down = new THREE.Vector3(0, -1, 0);
  const segs = 20;
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * TAU;
    const a1 = ((s + 1) / segs) * TAU;
    pa.set(cx + Math.cos(a0) * rs * 1.05, stemTop + 0.01, z + Math.sin(a0) * rs * 1.05);
    pb.set(cx + Math.cos(a1) * rs * 1.05, stemTop + 0.01, z + Math.sin(a1) * rs * 1.05);
    pc.set(cx + Math.cos(a1) * capR * 0.98, stemTop + 0.01, z + Math.sin(a1) * capR * 0.98);
    pd.set(cx + Math.cos(a0) * capR * 0.98, stemTop + 0.01, z + Math.sin(a0) * capR * 0.98);
    w.paint(gill, s % 2 === 0 ? 2.2 : 1.2);
    w.quadFacing(pa, pb, pc, pd, down);
  }
  // Spots embedded in the cap, glowing faintly at night.
  const spots = Math.round(5 + capR * 2.5);
  for (let i = 0; i < spots; i++) {
    const polar = rng.range(0.15, 1.2);
    const az = rng.range(0, TAU);
    const p = new THREE.Vector3(Math.sin(polar) * Math.cos(az) * capR, stemTop + Math.cos(polar) * capH, Math.sin(polar) * Math.sin(az) * capR);
    const n = new THREE.Vector3(p.x / capR, (p.y - stemTop) / capH, p.z / capR).normalize();
    const size = capR * rng.range(0.09, 0.16);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const m = new THREE.Matrix4().compose(p.addScaledVector(n, -size * 0.12).add(new THREE.Vector3(cx, 0, z)), q, new THREE.Vector3(size, size * 0.3, size));
    b.add(flat(new THREE.DodecahedronGeometry(1, 0)), 0xf6f2e8, m, { glow: 0.7 });
  }
}

function mushroomGrove(o: Obstacle, rng: Rng, out: PropBatches, frame: THREE.Matrix4): void {
  const b = new PartsBuilder();
  const w = new GeoWriter();
  const gill = rng.pick(GILL_GLOW);
  mushroom(b, w, 0, 0, o.height, o.radius * 0.95, o.color, gill, rng);
  const companions = rng.int(2, 3);
  for (let i = 0; i < companions; i++) {
    const a = rng.range(0, TAU);
    const d = o.radius * rng.range(0.6, 0.85);
    const h = o.height * rng.range(0.16, 0.3);
    mushroom(b, w, Math.cos(a) * d, Math.sin(a) * d, h, Math.min(o.radius * 0.3, h * 0.55), rng.pick(MUSHROOM_CAPS), gill, rng);
  }
  out.solid.add(mergeTemplates([b.build(), w.build()]), frame);
}

// ── 1 Rainbow arch ────────────────────────────────────────────────────────────

function rainbowArch(o: Obstacle, out: PropBatches, frame: THREE.Matrix4): void {
  const w = new GeoWriter();
  const r = o.radius;
  const bw = Math.min(0.36, r * 0.1);
  const half = (0.28 + r * 0.04) / 2;
  const segs = 28;
  const front = new THREE.Vector3(0, 0, 1);
  const back = new THREE.Vector3(0, 0, -1);
  RAINBOW.forEach((color, i) => {
    const ao = r * 0.95 - i * bw;
    const bo = o.height * 0.97 - i * bw;
    const ai = ao - bw;
    const bi = bo - bw;
    w.paint(color, 1.6);
    for (let s = 0; s < segs; s++) {
      const t0 = (s / segs) * Math.PI;
      const t1 = ((s + 1) / segs) * Math.PI;
      const o0 = new THREE.Vector3(ao * Math.cos(t0), bo * Math.sin(t0), 0);
      const o1 = new THREE.Vector3(ao * Math.cos(t1), bo * Math.sin(t1), 0);
      const i0 = new THREE.Vector3(ai * Math.cos(t0), bi * Math.sin(t0), 0);
      const i1 = new THREE.Vector3(ai * Math.cos(t1), bi * Math.sin(t1), 0);
      for (const [z, n] of [
        [half, front],
        [-half, back],
      ] as const) {
        w.quadFacing(o0.clone().setZ(z), o1.clone().setZ(z), i1.clone().setZ(z), i0.clone().setZ(z), n);
      }
      dir.addVectors(o0, o1);
      if (i === 0) w.quadFacing(o0.clone().setZ(half), o1.clone().setZ(half), o1.clone().setZ(-half), o0.clone().setZ(-half), dir);
      if (i === RAINBOW.length - 1) {
        w.quadFacing(i0.clone().setZ(half), i1.clone().setZ(half), i1.clone().setZ(-half), i0.clone().setZ(-half), dir.clone().negate());
      }
    }
  });
  const b = new PartsBuilder();
  const foot = r * 0.95 - bw * 3.5;
  for (const sx of [-1, 1]) b.box(bw * 7 + 0.25, 0.14, half * 2 + 0.25, STONE, { x: sx * foot, y: 0.07 });
  out.solid.add(mergeTemplates([w.build(), b.build()]), frame);
}

// ── 2 Metal spiral (rotor about y) ────────────────────────────────────────────

/** Unit spiral: radius 1 at the base, height 1. */
function spiralTemplate(): THREE.BufferGeometry {
  const w = new GeoWriter();
  const turns = 2.3;
  const segs = 84;
  const band = 0.11;
  const thick = 0.045;
  const ring = (out: THREE.Vector3, t: number, radius: number, y: number): THREE.Vector3 => {
    const a = t * turns * TAU;
    return out.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
  };
  const ob0 = new THREE.Vector3();
  const ob1 = new THREE.Vector3();
  const ot0 = new THREE.Vector3();
  const ot1 = new THREE.Vector3();
  const ib0 = new THREE.Vector3();
  const ib1 = new THREE.Vector3();
  const it0 = new THREE.Vector3();
  const it1 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const y0 = t0 * (1 - band);
    const y1 = t1 * (1 - band);
    const r0 = 0.95 - 0.62 * t0;
    const r1 = 0.95 - 0.62 * t1;
    ring(ob0, t0, r0, y0);
    ring(ob1, t1, r1, y1);
    ring(ot0, t0, r0, y0 + band);
    ring(ot1, t1, r1, y1 + band);
    ring(ib0, t0, r0 - thick, y0);
    ring(ib1, t1, r1 - thick, y1);
    ring(it0, t0, r0 - thick, y0 + band);
    ring(it1, t1, r1 - thick, y1 + band);
    dir.set(ob0.x + ob1.x, 0, ob0.z + ob1.z);
    w.paint(COPPER);
    w.quadFacing(ob0, ob1, ot1, ot0, dir);
    w.quadFacing(ib0, ib1, it1, it0, dir.clone().negate());
    w.quadFacing(ot0, ot1, it1, it0, up);
    w.quadFacing(ob0, ob1, ib1, ib0, down);
    // LED strip along the upper outer edge (takes the instance colour).
    w.paint(0xffffff, 2.4, GlowMode.steady, true);
    const k0 = 1 + 0.004 / r0;
    const k1 = 1 + 0.004 / r1;
    w.quadFacing(
      ot0.clone().multiply(new THREE.Vector3(k0, 1, k0)).setY(ot0.y - 0.022),
      ot1.clone().multiply(new THREE.Vector3(k1, 1, k1)).setY(ot1.y - 0.022),
      ot1.clone().multiply(new THREE.Vector3(k1, 1, k1)),
      ot0.clone().multiply(new THREE.Vector3(k0, 1, k0)),
      dir,
    );
  }
  const b = new PartsBuilder();
  b.cylinder(0.025, 0.035, 1.0, 0x5a5f66, { y: 0.5 }, { segments: 6 });
  return mergeTemplates([w.build(), b.build()]);
}

// ── 3 Flag pinwheel (rotor about z) ───────────────────────────────────────────

/** Unit pinwheel: five Flags out to radius 1 in the xy plane, facing +z. */
function pinwheelTemplate(): THREE.BufferGeometry {
  const w = new GeoWriter();
  const b = new PartsBuilder();
  b.cylinder(0.12, 0.12, 0.14, 0xd9a93a, { rx: Math.PI / 2 }, { segments: 10 });
  const twist = 0.45;
  for (let k = 0; k < 5; k++) {
    const phi = (k / 5) * TAU + Math.PI / 2;
    const axis = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
    b.strut(new THREE.Vector3(), axis.clone(), 0.018, 0xe8d9a8, { segments: 4 });
    b.sphere(0.03, 0xd9a93a, { x: axis.x, y: axis.y }, { detail: 0 });
    // Cloth hangs off the trailing side of its pole, pitched like a pinwheel blade.
    const side = new THREE.Vector3(-axis.y, axis.x, 0).multiplyScalar(-Math.cos(twist)).add(new THREE.Vector3(0, 0, Math.sin(twist)));
    const p0 = axis.clone().multiplyScalar(0.3);
    const p1 = axis.clone().multiplyScalar(0.96);
    const p2 = p1.clone().addScaledVector(side, 0.38);
    const p3 = p0.clone().addScaledVector(side, 0.38);
    const n = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p3.clone().sub(p0)).normalize();
    const facing = n.z >= 0 ? n : n.clone().negate();
    const off = facing.clone().multiplyScalar(0.004);
    // Gold on one side, saffron on the other.
    w.paint(GOLD, 0.9);
    w.quadFacing(p0.clone().add(off), p1.clone().add(off), p2.clone().add(off), p3.clone().add(off), facing);
    w.paint(SAFFRON, 0.6);
    w.quadFacing(p0.clone().sub(off), p1.clone().sub(off), p2.clone().sub(off), p3.clone().sub(off), facing.clone().negate());
  }
  // Pentagram on the hub, pulsing on the beat.
  w.paint(GOLD, 2.4, GlowMode.beat);
  const fwd = new THREE.Vector3(0, 0, 1);
  const centre = new THREE.Vector3(0, 0, 0.075);
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * TAU + Math.PI / 2;
    const a1 = a0 + TAU / 10;
    const a2 = a0 - TAU / 10;
    const tip = new THREE.Vector3(Math.cos(a0) * 0.26, Math.sin(a0) * 0.26, 0.075);
    const l = new THREE.Vector3(Math.cos(a1) * 0.1, Math.sin(a1) * 0.1, 0.075);
    const r = new THREE.Vector3(Math.cos(a2) * 0.1, Math.sin(a2) * 0.1, 0.075);
    w.triFacing(tip, l, r, fwd);
    w.triFacing(centre, l, r, fwd);
  }
  return mergeTemplates([w.build(), b.build()]);
}

// ── 4 LED totem ───────────────────────────────────────────────────────────────

function starShape(outer: number, inner: number): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + Math.PI / 2;
    const rad = k % 2 === 0 ? outer : inner;
    pts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
  }
  return new THREE.Shape(pts);
}

function ledTotem(o: Obstacle, rng: Rng, out: PropBatches, frame: THREE.Matrix4): void {
  const b = new PartsBuilder();
  const n = Math.max(3, Math.min(7, Math.round(o.height / 1.7)));
  const top = o.height * 0.84;
  const w0 = Math.max(0.6, Math.min(1.5, o.radius * 0.55));
  for (let k = 0; k < n; k++) {
    const y0 = (top * k) / n;
    const sh = top / n;
    const w = w0 * (1 - (0.38 * k) / Math.max(1, n - 1));
    const turn = k % 4 === 0 ? 0 : Math.PI / 4;
    b.box(w * 1.12, 0.08, w * 1.12, DARK, { y: y0 + 0.04, ry: turn });
    // Panels cycle the rainbow (hue follows height, so the stack shows a moving gradient).
    if (k % 2 === 0) b.box(w, sh - 0.1, w, PANEL, { y: y0 + 0.05 + (sh - 0.1) / 2, ry: turn }, { glow: 2.2, glowMode: GlowMode.rainbow });
    else b.cylinder(w / 2, w / 2, sh - 0.1, PANEL, { y: y0 + 0.05 + (sh - 0.1) / 2 }, { segments: 8, glow: 2.2, glowMode: GlowMode.rainbow });
  }
  b.box(w0 * 0.7, 0.1, w0 * 0.7, DARK, { y: top + 0.05 });
  const star = new THREE.ExtrudeGeometry(starShape(w0 * 0.55, w0 * 0.23), { depth: 0.12, bevelEnabled: false });
  star.translate(0, 0, -0.06);
  b.add(star, GOLD, { y: top + 0.1 + w0 * 0.55, ry: rng.range(-0.4, 0.4) }, { glow: 2.6, glowMode: GlowMode.beat });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + rng.range(-0.1, 0.1);
    const x = Math.cos(a) * o.radius * 0.88;
    const z = Math.sin(a) * o.radius * 0.88;
    b.cylinder(0.1, 0.12, 0.5, DARK, { x, y: 0.25, z }, { segments: 6 });
    b.cylinder(0.11, 0.11, 0.07, o.color, { x, y: 0.53, z }, { segments: 6, glow: 2.2 });
  }
  out.solid.add(b.build(), frame);
}

// ── 5 Pyramid ─────────────────────────────────────────────────────────────────

function pyramid(o: Obstacle, rng: Rng, out: PropBatches, frame: THREE.Matrix4): void {
  const sides = rng.chance(0.5) ? 4 : 5;
  const R = o.radius * 0.92;
  const H = o.height * 0.86;
  const cut = 0.9;
  // Corners placed so one face looks straight down local +z.
  const corners: THREE.Vector3[] = [];
  for (let k = 0; k < sides; k++) {
    const a = Math.PI / sides + (k * TAU) / sides;
    corners.push(new THREE.Vector3(Math.sin(a) * R, 0.15, Math.cos(a) * R));
  }
  const apex = new THREE.Vector3(0, H, 0);
  const faces = new GeoWriter().paint(0x23232f);
  const glow = new PartsBuilder();
  const edge = 0.05 + 0.012 * o.radius;
  for (let k = 0; k < sides; k++) {
    const a = corners[k];
    const c = corners[(k + 1) % sides];
    // Truncated just under the apex; the capstone floats above.
    const ta = a.clone().lerp(apex, cut);
    const tc = c.clone().lerp(apex, cut);
    dir.addVectors(a, c).setY(R * 0.6);
    faces.quadFacing(a, c, tc, ta, dir);
    // Flat top of the truncated body (seen from Command View).
    faces.triFacing(new THREE.Vector3(0, H * cut + 0.15 * (1 - cut), 0), ta, tc, new THREE.Vector3(0, 1, 0));
    glow.strut(a, c, edge, o.color, { segments: 4, glow: 2.6 });
    glow.strut(a, ta, edge, o.color, { segments: 4, glow: 2.6 });
  }
  const capBase = H * cut + o.height * 0.05;
  const capR = R * (1 - cut) * 1.05;
  glow.add(flat(new THREE.ConeGeometry(capR, o.height - capBase, sides)), 0xffcf5a, { y: capBase + (o.height - capBase) / 2, ry: Math.PI / sides }, { glow: 3, glowMode: GlowMode.beat });
  // The eye on the front face.
  const fa = corners[sides - 1];
  const fc = corners[0];
  const mid = fa.clone().add(fc).multiplyScalar(0.5);
  const eyeAt = mid.clone().lerp(apex, 0.45);
  const normal = new THREE.Vector3().crossVectors(fc.clone().sub(fa), apex.clone().sub(fa)).normalize();
  if (normal.z < 0) normal.negate();
  eyeAt.addScaledVector(normal, 0.03);
  const ew = R * 0.28;
  const eh = ew * 0.42;
  const right = new THREE.Vector3(1, 0, 0);
  // In-plane direction up the face toward the apex.
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  const eye = new GeoWriter().paint(0x7ff6ff, 2.2);
  const l = eyeAt.clone().addScaledVector(right, -ew);
  const r = eyeAt.clone().addScaledVector(right, ew);
  const t = eyeAt.clone().addScaledVector(up, eh);
  const btm = eyeAt.clone().addScaledVector(up, -eh);
  eye.triFacing(l, t, r, normal).triFacing(l, r, btm, normal);
  eye.paint(0x111118);
  const pupil = eyeAt.clone().addScaledVector(normal, 0.01);
  const pr = eh * 0.6;
  eye.quadFacing(
    pupil.clone().addScaledVector(right, -pr),
    pupil.clone().addScaledVector(up, pr),
    pupil.clone().addScaledVector(right, pr),
    pupil.clone().addScaledVector(up, -pr),
    normal,
  );
  glow.cylinder(R * 1.1, R * 1.14, 0.15, 0x4a4a52, { y: 0.075, ry: Math.PI / sides }, { segments: sides });
  out.gloss.add(faces.build(), frame);
  out.solid.add(mergeTemplates([glow.build(), eye.build()]), frame);
}

/** The two turning art templates (each spun about its own axis by propField). */
export interface RotorTemplates {
  spiral: THREE.BufferGeometry;
  pinwheel: THREE.BufferGeometry;
}

export function createRotorTemplates(): RotorTemplates {
  return { spiral: spiralTemplate(), pinwheel: pinwheelTemplate() };
}

export function buildArt(art: Obstacle[], out: PropBatches): ArtRotors {
  const rotors: ArtRotors = { spiral: [], pinwheel: [] };
  for (const o of art) {
    const rng = obstacleRng(o, 'art');
    const frame = frameOf(o.x, o.z, o.yaw);
    switch (o.variant) {
      case 1:
        rainbowArch(o, out, frame);
        break;
      case 2: {
        const plinth = new PartsBuilder().cylinder(o.radius * 1.0, o.radius * 1.05, 0.25, STONE, { y: 0.125 }, { segments: 12 }).build();
        out.solid.add(plinth, frame);
        rotors.spiral.push({
          matrix: within(frame, { y: 0.25, sx: o.radius, sy: o.height - 0.25, sz: o.radius }),
          color: new THREE.Color(o.color),
          speed: rng.range(0.12, 0.22) * (rng.chance(0.5) ? 1 : -1),
          phase: rng.range(0, TAU),
        });
        break;
      }
      case 3: {
        const R = Math.min(o.radius * 0.95, o.height * 0.42);
        const hub = o.height - R;
        const pole = new PartsBuilder();
        pole.cylinder(0.08, 0.11, hub + 0.05, 0x5a5f66, { y: (hub + 0.05) / 2 }, { segments: 8 });
        pole.cylinder(0.38, 0.42, 0.3, STONE, { y: 0.15 }, { segments: 10 });
        pole.box(0.2, 0.2, 0.3, 0x3a3d42, { y: hub, z: -0.12 });
        out.solid.add(pole.build(), frame);
        rotors.pinwheel.push({
          matrix: within(frame, { y: hub, z: 0.1, sx: R, sy: R, sz: R }),
          color: new THREE.Color(0xffffff),
          speed: rng.range(0.7, 1.2),
          phase: rng.range(0, TAU),
        });
        break;
      }
      case 4:
        ledTotem(o, rng, out, frame);
        break;
      case 5:
        pyramid(o, rng, out, frame);
        break;
      default:
        mushroomGrove(o, rng, out, frame);
    }
  }
  return rotors;
}
