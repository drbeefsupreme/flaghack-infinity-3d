/**
 * Procedural prop modelling: PartsBuilder merges coloured primitives into one non-indexed
 * BufferGeometry carrying the attributes every env material understands:
 *   color  (vec3, linear)       base albedo
 *   aGlow  (vec2)               x = emissive strength (× colour), y = GlowMode
 *   aSway  (float)              wind sway weight (0 = rigid, 1 = full canopy/cloth sway)
 *   aTint  (float)              1 = multiply by the per-instance colour (InstancedMesh.setColorAt)
 * Build-time only: allocation here is fine, nothing in this file runs per frame.
 */
import * as THREE from 'three';

/** How a glowing part animates (see envMaterial.ts). */
export const GlowMode = {
  steady: 0,
  /** Per-vertex random twinkle (fairy lights). */
  twinkle: 1,
  /** Pulses on the festival beat (ctx.beat, locked to the music's kick). */
  beat: 2,
  /** Hue cycles through the rainbow (LED art). */
  rainbow: 3,
  /** Irregular firelight flicker. */
  flicker: 4,
} as const;
export type GlowMode = (typeof GlowMode)[keyof typeof GlowMode];

export interface PartOptions {
  /** Emissive strength (linear HDR multiplier of the part colour at full night). */
  glow?: number;
  glowMode?: GlowMode;
  sway?: number;
  /** Take the per-instance colour (default false). */
  tint?: boolean;
}

/** Position/rotation/scale shorthand for placing a primitive. */
export interface Place {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();

/** Matrix from a Place (rotation order XYZ, applied after scale, before translation). */
export function placeMatrix(p: Place, out = new THREE.Matrix4()): THREE.Matrix4 {
  tmpPos.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  tmpEuler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
  tmpQuat.setFromEuler(tmpEuler);
  tmpScale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  glow: number;
  glowMode: number;
  sway: number;
  tint: number;
}

export class PartsBuilder {
  private parts: Part[] = [];

  /**
   * Append a geometry (the builder takes ownership and disposes it on build), transformed by
   * `place` (a Place or a ready Matrix4), with a flat colour (sRGB hex or Color).
   */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, place?: Place | THREE.Matrix4, opts: PartOptions = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (place) g.applyMatrix4(place instanceof THREE.Matrix4 ? place : placeMatrix(place));
    this.parts.push({
      geo: g,
      color: new THREE.Color(color),
      glow: opts.glow ?? 0,
      glowMode: opts.glowMode ?? GlowMode.steady,
      sway: opts.sway ?? 0,
      tint: opts.tint ? 1 : 0,
    });
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, place?: Place, opts?: PartOptions): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, place, opts);
  }

  /** Cylinder standing on y (radiusTop, radiusBottom, height), centred at place. */
  cylinder(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, place?: Place, opts?: PartOptions & { segments?: number; open?: boolean }): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, opts?.segments ?? 8, 1, opts?.open ?? false), color, place, opts);
  }

  cone(r: number, h: number, color: THREE.ColorRepresentation, place?: Place, opts?: PartOptions & { segments?: number }): this {
    return this.add(new THREE.ConeGeometry(r, h, opts?.segments ?? 8), color, place, opts);
  }

  sphere(r: number, color: THREE.ColorRepresentation, place?: Place, opts?: PartOptions & { detail?: number }): this {
    return this.add(new THREE.IcosahedronGeometry(r, opts?.detail ?? 1), color, place, opts);
  }

  /** A straight beam between two points (square cross-section `t`). */
  beam(a: THREE.Vector3, b: THREE.Vector3, t: number, color: THREE.ColorRepresentation, opts?: PartOptions): this {
    const len = a.distanceTo(b);
    const geo = new THREE.BoxGeometry(t, len, t);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return this.add(geo, color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), opts);
  }

  /** A round strut between two points (radius r). */
  strut(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.ColorRepresentation, opts?: PartOptions & { segments?: number }): this {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, opts?.segments ?? 5, 1, true);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return this.add(geo, color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), opts);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Merge every part into one geometry with color/aGlow/aSway/aTint attributes. */
  build(): THREE.BufferGeometry {
    let total = 0;
    for (const p of this.parts) total += p.geo.getAttribute('position').count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const glow = new Float32Array(total * 2);
    const sway = new Float32Array(total);
    const tint = new Float32Array(total);
    let o = 0;
    for (const p of this.parts) {
      const pa = p.geo.getAttribute('position');
      const na = p.geo.getAttribute('normal');
      for (let i = 0; i < pa.count; i++, o++) {
        pos[o * 3] = pa.getX(i);
        pos[o * 3 + 1] = pa.getY(i);
        pos[o * 3 + 2] = pa.getZ(i);
        nor[o * 3] = na.getX(i);
        nor[o * 3 + 1] = na.getY(i);
        nor[o * 3 + 2] = na.getZ(i);
        col[o * 3] = p.color.r;
        col[o * 3 + 1] = p.color.g;
        col[o * 3 + 2] = p.color.b;
        glow[o * 2] = p.glow;
        glow[o * 2 + 1] = p.glowMode;
        sway[o] = p.sway;
        tint[o] = p.tint;
      }
      p.geo.dispose();
    }
    this.parts = [];
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 2));
    out.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    out.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}
