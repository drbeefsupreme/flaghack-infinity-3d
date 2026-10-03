/**
 * Build-time geometry plumbing for the map props.
 *
 * StaticBatch merges every rigid prop that shares a material into world-space geometry,
 * split into map tiles that propField draws through one BatchedMesh per material: one
 * draw call per material and pass, while the camera and the shadow camera cull every tile
 * they don't touch. Each obstacle keeps its exact size, colour and seeded accessories
 * (instancing would force one shape per draw call). Templates come from PartsBuilder or
 * GeoWriter and carry the env attributes (color / aGlow / aSway / aTint); a placement bakes
 * its tint into the colours of the aTint parts.
 *
 * Nothing here runs per frame, so allocation is fine.
 */
import * as THREE from 'three';
import { GlowMode, placeMatrix } from '../geom';
import type { PartOptions, PartsBuilder, Place } from '../geom';

interface Placement {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  tint: THREE.Color | null;
  /** Uniform sway weight replacing the template's (rigid things hung from moving cloth). */
  sway: number | null;
}

/** Plain (non-interleaved) float attribute data of a template. */
function attrArray(geo: THREE.BufferGeometry, name: string, itemSize: number): THREE.TypedArray {
  const attr = geo.getAttribute(name);
  if (!(attr instanceof THREE.BufferAttribute) || attr.itemSize !== itemSize) {
    throw new Error(`prop geometry lacks a plain '${name}' attribute`);
  }
  return attr.array;
}

export class StaticBatch {
  private placements: Placement[] = [];
  private vertices = 0;

  private readonly keepTint: boolean;
  private readonly twoSided: boolean;

  /**
   * @param opts.keepTint keep the aTint flags instead of baking tints (used to merge templates
   *   that are later placed with their own tint).
   * @param opts.twoSided emit every triangle a second time facing the other way, so thin
   *   cloth renders from both sides with the shared front-side material (no extra program).
   */
  constructor(opts: { keepTint?: boolean; twoSided?: boolean } = {}) {
    this.keepTint = opts.keepTint ?? false;
    this.twoSided = opts.twoSided ?? false;
  }

  /**
   * Place a non-indexed env-attribute geometry; aTint parts are multiplied by `tint`. A
   * `sway` weight moves the whole placement with the cloth point it hangs from.
   */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, tint?: THREE.ColorRepresentation, sway?: number): void {
    if (geo.index) throw new Error('StaticBatch needs non-indexed geometry');
    this.placements.push({
      geo,
      matrix: matrix.clone(),
      tint: tint === undefined ? null : new THREE.Color(tint),
      sway: sway ?? null,
    });
    this.vertices += geo.getAttribute('position').count;
  }

  /** Merge every placement (null when empty). The placed templates stay owned by the caller. */
  build(): THREE.BufferGeometry | null {
    const arrays = this.merge();
    return arrays ? toGeometry(arrays) : null;
  }

  /**
   * Merge and split into an n × n grid of tiles over [-half, half]² (by triangle centroid;
   * the border tiles also take anything beyond the edge): one geometry per non-empty tile.
   */
  buildTiles(half: number, n: number): THREE.BufferGeometry[] {
    const all = this.merge();
    if (!all) return [];
    const tris = all.sway.length / 3;
    const tileOf = new Uint16Array(tris);
    const counts = new Uint32Array(n * n);
    const perMetre = n / (6 * half);
    for (let t = 0; t < tris; t++) {
      const a = t * 9;
      // Centroid × 3: the 1/3 is folded into perMetre.
      const cx = all.pos[a] + all.pos[a + 3] + all.pos[a + 6];
      const cz = all.pos[a + 2] + all.pos[a + 5] + all.pos[a + 8];
      const ix = Math.min(n - 1, Math.max(0, Math.floor((cx + 3 * half) * perMetre)));
      const iz = Math.min(n - 1, Math.max(0, Math.floor((cz + 3 * half) * perMetre)));
      tileOf[t] = iz * n + ix;
      counts[tileOf[t]]++;
    }
    const parts = Array.from(counts, (c) => allocate(c * 3));
    const fill = new Uint32Array(n * n);
    // Plain index copies: subarray views would allocate six objects per triangle.
    for (let t = 0; t < tris; t++) {
      const q = tileOf[t];
      const dst = parts[q];
      const o = fill[q];
      for (let k = 0; k < 9; k++) {
        dst.pos[o * 3 + k] = all.pos[t * 9 + k];
        dst.nor[o * 3 + k] = all.nor[t * 9 + k];
        dst.col[o * 3 + k] = all.col[t * 9 + k];
      }
      for (let k = 0; k < 6; k++) dst.glow[o * 2 + k] = all.glow[t * 6 + k];
      for (let k = 0; k < 3; k++) {
        dst.sway[o + k] = all.sway[t * 3 + k];
        dst.tint[o + k] = all.tint[t * 3 + k];
      }
      fill[q] = o + 3;
    }
    return parts.filter((p) => p.sway.length > 0).map(toGeometry);
  }

  private merge(): VertexArrays | null {
    const n = this.vertices;
    if (n === 0) return null;
    const { pos, nor, col, glow, sway, tint } = allocate(n);
    const nm = new THREE.Matrix3();
    let o = 0;
    for (const p of this.placements) {
      const sp = attrArray(p.geo, 'position', 3);
      const sn = attrArray(p.geo, 'normal', 3);
      const sc = attrArray(p.geo, 'color', 3);
      const sg = attrArray(p.geo, 'aGlow', 2);
      const ss = attrArray(p.geo, 'aSway', 1);
      const st = attrArray(p.geo, 'aTint', 1);
      const e = p.matrix.elements;
      const m = nm.getNormalMatrix(p.matrix).elements;
      // A mirrored placement flips triangle winding; swap two corners to keep faces outward.
      const mirrored = p.matrix.determinant() < 0;
      const count = sp.length / 3;
      for (let i = 0; i < count; i++, o++) {
        const k = i % 3;
        const r = mirrored && k === 1 ? i + 1 : mirrored && k === 2 ? i - 1 : i;
        const x = sp[r * 3];
        const y = sp[r * 3 + 1];
        const z = sp[r * 3 + 2];
        pos[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = sn[r * 3];
        const b = sn[r * 3 + 1];
        const c = sn[r * 3 + 2];
        const nx = m[0] * a + m[3] * b + m[6] * c;
        const ny = m[1] * a + m[4] * b + m[7] * c;
        const nz = m[2] * a + m[5] * b + m[8] * c;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nor[o * 3] = nx / len;
        nor[o * 3 + 1] = ny / len;
        nor[o * 3 + 2] = nz / len;
        const t = p.tint !== null && !this.keepTint && st[r] > 0.5 ? p.tint : null;
        col[o * 3] = sc[r * 3] * (t ? t.r : 1);
        col[o * 3 + 1] = sc[r * 3 + 1] * (t ? t.g : 1);
        col[o * 3 + 2] = sc[r * 3 + 2] * (t ? t.b : 1);
        glow[o * 2] = sg[r * 2];
        glow[o * 2 + 1] = sg[r * 2 + 1];
        sway[o] = p.sway ?? ss[r];
        tint[o] = this.keepTint ? st[r] : 0;
      }
    }
    this.placements = [];
    this.vertices = 0;
    const merged = { pos, nor, col, glow, sway, tint };
    return this.twoSided ? backFaces(merged) : merged;
  }
}

interface VertexArrays {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  glow: Float32Array;
  sway: Float32Array;
  tint: Float32Array;
}

function allocate(vertices: number): VertexArrays {
  return {
    pos: new Float32Array(vertices * 3),
    nor: new Float32Array(vertices * 3),
    col: new Float32Array(vertices * 3),
    glow: new Float32Array(vertices * 2),
    sway: new Float32Array(vertices),
    tint: new Float32Array(vertices),
  };
}

function toGeometry(a: VertexArrays): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
  out.setAttribute('aGlow', new THREE.BufferAttribute(a.glow, 2));
  out.setAttribute('aSway', new THREE.BufferAttribute(a.sway, 1));
  out.setAttribute('aTint', new THREE.BufferAttribute(a.tint, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** The arrays followed by a reversed copy of every triangle (corners 0, 2, 1; normals negated). */
function backFaces(src: VertexArrays): VertexArrays {
  const n = src.sway.length;
  const out = allocate(n * 2);
  out.pos.set(src.pos);
  out.nor.set(src.nor);
  out.col.set(src.col);
  out.glow.set(src.glow);
  out.sway.set(src.sway);
  out.tint.set(src.tint);
  for (let v = 0; v < n; v++) {
    const k = v % 3;
    const s = k === 1 ? v + 1 : k === 2 ? v - 1 : v;
    const o = n + v;
    for (let c = 0; c < 3; c++) {
      out.pos[o * 3 + c] = src.pos[s * 3 + c];
      out.nor[o * 3 + c] = -src.nor[s * 3 + c];
      out.col[o * 3 + c] = src.col[s * 3 + c];
    }
    out.glow[o * 2] = src.glow[s * 2];
    out.glow[o * 2 + 1] = src.glow[s * 2 + 1];
    out.sway[o] = src.sway[s];
    out.tint[o] = src.tint[s];
  }
  return out;
}

const IDENTITY = new THREE.Matrix4();

/** Concatenate template pieces into one template, keeping their aTint flags. */
export function mergeTemplates(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const batch = new StaticBatch({ keepTint: true });
  for (const g of pieces) if (g.getAttribute('position').count > 0) batch.add(g, IDENTITY);
  const out = batch.build() ?? new GeoWriter().build();
  for (const g of pieces) g.dispose();
  return out;
}

/** Drop the smooth normals so PartsBuilder computes flat (faceted) ones. */
export function flat<T extends THREE.BufferGeometry>(geo: T): T {
  geo.deleteAttribute('normal');
  return geo;
}

/** Obstacle frame: on the ground at (x, z), turned by yaw (local +z faces (sin yaw, cos yaw)). */
export function frameOf(x: number, z: number, yaw: number, y = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
}

/** `frame` × a local placement. */
export function within(frame: THREE.Matrix4, place: Place): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(frame, placeMatrix(place));
}

/** World position of a point given in an obstacle frame. */
export function toWorld(frame: THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(frame);
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Tapered open tube from a (radius r0) to c (radius r1), flat shaded: limbs, stems, posts. */
export function taper(
  b: PartsBuilder,
  a: THREE.Vector3,
  c: THREE.Vector3,
  r0: number,
  r1: number,
  color: THREE.ColorRepresentation,
  opts: PartOptions & { segments?: number } = {},
): void {
  const geo = flat(new THREE.CylinderGeometry(r1, r0, a.distanceTo(c), opts.segments ?? 5, 1, true));
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, c.clone().sub(a).normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  b.add(geo, color, m, opts);
}

/** Per-triangle view handed to paintFaces (one reused object). */
export interface Face {
  index: number;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  /** Current colour (linear, first corner); write the new colour here. */
  color: THREE.Color;
  /** aTint flag (0/1); writable. */
  tint: number;
  /** Emissive strength; writable. */
  glow: number;
}

const face: Face = { index: 0, cx: 0, cy: 0, cz: 0, nx: 0, ny: 1, nz: 0, color: new THREE.Color(), tint: 0, glow: 0 };

/** Recolour a built template triangle by triangle (centroid + face normal driven). */
export function paintFaces(geo: THREE.BufferGeometry, fn: (f: Face) => void): void {
  const p = attrArray(geo, 'position', 3);
  const n = attrArray(geo, 'normal', 3);
  const c = attrArray(geo, 'color', 3);
  const t = attrArray(geo, 'aTint', 1);
  const g = attrArray(geo, 'aGlow', 2);
  const tris = p.length / 9;
  for (let i = 0; i < tris; i++) {
    const a = i * 9;
    face.index = i;
    face.cx = (p[a] + p[a + 3] + p[a + 6]) / 3;
    face.cy = (p[a + 1] + p[a + 4] + p[a + 7]) / 3;
    face.cz = (p[a + 2] + p[a + 5] + p[a + 8]) / 3;
    const nx = n[a] + n[a + 3] + n[a + 6];
    const ny = n[a + 1] + n[a + 4] + n[a + 7];
    const nz = n[a + 2] + n[a + 5] + n[a + 8];
    const len = Math.hypot(nx, ny, nz) || 1;
    face.nx = nx / len;
    face.ny = ny / len;
    face.nz = nz / len;
    face.color.setRGB(c[a], c[a + 1], c[a + 2]);
    face.tint = t[i * 3];
    face.glow = g[i * 6];
    fn(face);
    for (let k = 0; k < 3; k++) {
      const v = i * 3 + k;
      c[v * 3] = face.color.r;
      c[v * 3 + 1] = face.color.g;
      c[v * 3 + 2] = face.color.b;
      t[v] = face.tint;
      g[v * 2] = face.glow;
    }
  }
}

/** Reshape the per-vertex sway weights of a built template. */
export function shapeSway(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, w: number) => number): void {
  const p = attrArray(geo, 'position', 3);
  const s = attrArray(geo, 'aSway', 1);
  for (let i = 0; i < s.length; i++) s[i] = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], s[i]);
}

const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const nrm = new THREE.Vector3();
const tAxis = new THREE.Vector3();
const tRef = new THREE.Vector3();
const tU = new THREE.Vector3();
const tV = new THREE.Vector3();
const tR0 = new THREE.Vector3();
const tR1 = new THREE.Vector3();
const tP0 = new THREE.Vector3();
const tP1 = new THREE.Vector3();
const tP2 = new THREE.Vector3();
const tP3 = new THREE.Vector3();

/**
 * Hand-built triangles (flat shaded) with per-vertex sway weights and a current paint state:
 * set colour / glow / tint with paint(), then emit tri()/quad(). Used for meshes whose
 * colour varies per face (canvas doors, stripes, rainbow bands) or whose sway varies per
 * vertex (cloth pinned at its edges).
 */
export class GeoWriter {
  private pos: number[] = [];
  private col: number[] = [];
  private glw: number[] = [];
  private swy: number[] = [];
  private tnt: number[] = [];
  private color = new THREE.Color(1, 1, 1);
  private glow = 0;
  private mode: number = GlowMode.steady;
  private tint = 0;

  /** Colour (sRGB hex or linear Color) and glow for the following triangles. */
  paint(color: THREE.ColorRepresentation, glow = 0, mode: GlowMode = GlowMode.steady, tint = false): this {
    this.color.set(color);
    this.glow = glow;
    this.mode = mode;
    this.tint = tint ? 1 : 0;
    return this;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, wa = 0, wb = wa, wc = wa): this {
    this.vertex(a, wa);
    this.vertex(b, wb);
    this.vertex(c, wc);
    return this;
  }

  /** Triangle whose front faces `dir` (winding fixed automatically). */
  triFacing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, dir: THREE.Vector3, wa = 0, wb = wa, wc = wa): this {
    nrm.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    return nrm.dot(dir) >= 0 ? this.tri(a, b, c, wa, wb, wc) : this.tri(a, c, b, wa, wc, wb);
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, wa = 0, wb = wa, wc = wa, wd = wa): this {
    this.tri(a, b, c, wa, wb, wc);
    return this.tri(a, c, d, wa, wc, wd);
  }

  /** Quad whose front faces `dir`. */
  quadFacing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, dir: THREE.Vector3, wa = 0, wb = wa, wc = wa, wd = wa): this {
    this.triFacing(a, b, c, dir, wa, wb, wc);
    return this.triFacing(a, c, d, dir, wa, wc, wd);
  }

  /**
   * Open faceted tube from a (radius r0) to c (radius r1) with `segs` sides: struts, truss
   * chords, ropes. Written directly (no temporary geometry), so thousands stay cheap.
   */
  tube(a: THREE.Vector3, c: THREE.Vector3, r0: number, r1 = r0, segs = 4, wa = 0, wc = wa): this {
    tAxis.subVectors(c, a);
    if (tAxis.lengthSq() < 1e-12) return this;
    tAxis.normalize();
    tRef.set(0, 1, 0);
    if (Math.abs(tAxis.y) > 0.9) tRef.set(1, 0, 0);
    tU.crossVectors(tAxis, tRef).normalize();
    tV.crossVectors(tAxis, tU);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      tR0.copy(tU).multiplyScalar(Math.cos(a0)).addScaledVector(tV, Math.sin(a0));
      tR1.copy(tU).multiplyScalar(Math.cos(a1)).addScaledVector(tV, Math.sin(a1));
      tP0.copy(a).addScaledVector(tR0, r0);
      tP1.copy(a).addScaledVector(tR1, r0);
      tP2.copy(c).addScaledVector(tR1, r1);
      tP3.copy(c).addScaledVector(tR0, r1);
      tR0.add(tR1);
      this.quadFacing(tP0, tP1, tP2, tP3, tR0, wa, wa, wc, wc);
    }
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Non-indexed geometry with flat normals and the env attributes. */
  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glw, 2));
    geo.setAttribute('aSway', new THREE.Float32BufferAttribute(this.swy, 1));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tnt, 1));
    geo.computeVertexNormals();
    this.pos = [];
    this.col = [];
    this.glw = [];
    this.swy = [];
    this.tnt = [];
    return geo;
  }

  private vertex(p: THREE.Vector3, w: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(this.color.r, this.color.g, this.color.b);
    this.glw.push(this.glow, this.mode);
    this.swy.push(w);
    this.tnt.push(this.tint);
  }
}
