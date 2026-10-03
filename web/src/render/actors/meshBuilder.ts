/**
 * Build-time geometry sculpting: merges primitive geometries (cylinders between two points,
 * balls, boxes, cones, tori, custom strips) into one non-indexed BufferGeometry carrying
 * custom per-vertex attributes (part/slot tags, skin weights, surface params). Characters
 * and props are authored with this so each actor kind renders in a single draw call.
 * Allocation happens only while building (never per frame).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BuilderAttr {
  name: string;
  size: number;
}

/** Constant per-primitive attribute values, keyed by attribute name. */
export type Tags = Readonly<Record<string, readonly number[]>>;

/**
 * Optional per-vertex override: receives the transformed vertex, its triangle centroid and a
 * mutable copy of the primitive's tags (reset for every vertex).
 */
export type VertexHook = (p: THREE.Vector3, centroid: THREE.Vector3, out: Record<string, number[]>) => void;

export type Vec3 = readonly [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Drop attributes the material never reads (flat-shaded models need no normals or uvs) and
 * weld identical vertices into an indexed geometry: the same triangles with a fraction of the
 * vertex-shader runs (MeshBuilder emits three unique vertices per triangle).
 */
export function weld(geometry: THREE.BufferGeometry, drop: readonly string[] = []): THREE.BufferGeometry {
  for (const name of drop) geometry.deleteAttribute(name);
  const welded = mergeVertices(geometry);
  geometry.dispose();
  welded.computeBoundingSphere();
  return welded;
}

export class MeshBuilder {
  private readonly attrs: readonly BuilderAttr[];
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly data = new Map<string, number[]>();
  private tags: Tags = {};
  private hook: VertexHook | null = null;

  constructor(attrs: readonly BuilderAttr[]) {
    this.attrs = attrs;
    for (const a of attrs) this.data.set(a.name, []);
  }

  /** Set the tags (and optional vertex hook) applied to subsequently added primitives. */
  with(tags: Tags, hook: VertexHook | null = null): this {
    for (const a of this.attrs) {
      const v = tags[a.name];
      if (!v || v.length !== a.size) throw new Error(`MeshBuilder: tag ${a.name} needs ${a.size} values`);
    }
    this.tags = tags;
    this.hook = hook;
    return this;
  }

  /** Append a geometry transformed by `matrix` (consumes and disposes `source`). */
  add(source: THREE.BufferGeometry, matrix: THREE.Matrix4 | null = null): this {
    const geo = source.index ? source.toNonIndexed() : source;
    const p = geo.getAttribute('position');
    const n = geo.hasAttribute('normal') ? geo.getAttribute('normal') : null;
    const t = geo.hasAttribute('uv') ? geo.getAttribute('uv') : null;
    const nm = new THREE.Matrix3();
    if (matrix) nm.getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const scratch: Record<string, number[]> = {};
    for (const a of this.attrs) scratch[a.name] = [...(this.tags[a.name] ?? [])];

    for (let i = 0; i < p.count; i++) {
      if (i % 3 === 0) {
        for (let k = 0; k < 3 && i + k < p.count; k++) {
          tri[k].fromBufferAttribute(p, i + k);
          if (matrix) tri[k].applyMatrix4(matrix);
        }
        c.copy(tri[0]).add(tri[1]).add(tri[2]).multiplyScalar(1 / 3);
      }
      v.copy(tri[i % 3]);
      this.pos.push(v.x, v.y, v.z);
      if (n) {
        const nx = n.getX(i);
        const ny = n.getY(i);
        const nz = n.getZ(i);
        const w = new THREE.Vector3(nx, ny, nz).applyMatrix3(nm).normalize();
        this.nrm.push(w.x, w.y, w.z);
      } else {
        this.nrm.push(0, 1, 0);
      }
      if (t) this.uv.push(t.getX(i), t.getY(i));
      else this.uv.push(0, 0);
      if (this.hook) {
        for (const a of this.attrs) {
          const base = this.tags[a.name] ?? [];
          const dst = scratch[a.name];
          for (let k = 0; k < a.size; k++) dst[k] = base[k];
        }
        this.hook(v, c, scratch);
      }
      for (const a of this.attrs) {
        const src = this.hook ? scratch[a.name] : (this.tags[a.name] ?? []);
        const dst = this.data.get(a.name);
        if (!dst) continue;
        for (let k = 0; k < a.size; k++) dst.push(src[k]);
      }
    }
    if (geo !== source) geo.dispose();
    source.dispose();
    return this;
  }

  /** Cylinder (or frustum) from `a` (radius r0) to `b` (radius r1). `squash` scales its depth. */
  seg(a: Vec3, b: Vec3, r0: number, r1: number, sides = 6, squash = 1, open = false): this {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, sides, 1, open);
    geo.scale(1, 1, squash);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(geo, m);
  }

  /** Faceted ball (icosahedron) with optional per-axis scale and deterministic lumpiness. */
  ball(c: Vec3, r: number, detail = 1, scale: Vec3 = [1, 1, 1], jitter = 0): this {
    const geo = new THREE.IcosahedronGeometry(r, detail);
    if (jitter > 0) {
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        // Hash on the rounded position so shared corners of adjacent faces move together.
        const h = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 991) * 78.233 + Math.round(z * 983) * 37.719);
        const k = 1 + (h * 43758.5453 - Math.floor(h * 43758.5453) - 0.5) * jitter;
        p.setXYZ(i, x * k, y * k, z * k);
      }
    }
    const m = new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]).setPosition(c[0], c[1], c[2]);
    return this.add(geo, m);
  }

  /** Axis-aligned box rotated by Euler (x, y, z) about its centre. */
  box(c: Vec3, size: Vec3, rot: Vec3 = [0, 0, 0]): this {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])).setPosition(c[0], c[1], c[2]);
    return this.add(geo, m);
  }

  /** Cone from a circular base at `base` to a point at `tip`. */
  cone(base: Vec3, tip: Vec3, r: number, sides = 6): this {
    return this.seg(base, tip, r, 0.0001, sides);
  }

  /** Torus around `axis` through centre `c` (major radius R, tube radius r). */
  torus(c: Vec3, axis: Vec3, R: number, r: number, radial = 5, tubular = 14, arc = Math.PI * 2, squash: Vec3 = [1, 1, 1]): this {
    const geo = new THREE.TorusGeometry(R, r, radial, tubular, arc);
    geo.scale(squash[0], squash[1], squash[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...axis).normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...c), q, new THREE.Vector3(1, 1, 1));
    return this.add(geo, m);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const a of this.attrs) g.setAttribute(a.name, new THREE.Float32BufferAttribute(this.data.get(a.name) ?? [], a.size));
    g.computeBoundingSphere();
    return g;
  }
}

/** Flat five-pointed star (pentagram polygon) in the XY plane, facing +Z, unit outer radius. */
export function starGeometry(outer: number, inner: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

/**
 * Möbius band around the Y axis: centre circle of radius R tilted by `tilt` (height swing),
 * strip half-width `hw` whose width direction turns half a revolution per loop.
 */
export function mobiusGeometry(R: number, hw: number, tilt: number, segments = 72): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    const cx = Math.cos(th) * R;
    const cz = Math.sin(th) * R;
    const cy = Math.sin(th) * tilt;
    const half = th / 2;
    // Width direction blends radial-out and up; half-turn per loop gives the single-sided band.
    const wx = Math.cos(half) * Math.cos(th);
    const wz = Math.cos(half) * Math.sin(th);
    const wy = Math.sin(half);
    pos.push(cx - wx * hw, cy - wy * hw, cz - wz * hw, cx + wx * hw, cy + wy * hw, cz + wz * hw);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
