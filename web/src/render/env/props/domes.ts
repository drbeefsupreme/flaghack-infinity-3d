/**
 * Geodesic domes (kind 'dome': footprint radius r, height ≈ 0.85 r): an icosahedral
 * hemisphere (frequency 4; 2 for small domes) with white fabric panels inset between
 * galvanised struts, an open door on the front (+z) showing a warm-lit interior (rug, lamps,
 * cushions), an optional coloured crown, and fairy-light strings along the upper struts that
 * twinkle at night.
 */
import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { PartsBuilder } from '../geom';
import { frameOf, GeoWriter, within } from './batch';
import type { ClutterKit, PropBatches } from './kit';
import { obstacleRng } from './kit';

interface Geodesic {
  /** Unit sphere points (y ≥ 0). */
  verts: THREE.Vector3[];
  /** Outward-wound triangles. */
  faces: [number, number, number][];
  edges: [number, number][];
}

/**
 * Icosahedron with a vertex on top, faces split `freq`² times and projected to the sphere.
 * With an even frequency the equator runs through grid vertices, so keeping the faces above
 * it gives a hemisphere with a flat, closed base ring.
 */
function geodesicHemisphere(freq: number): Geodesic {
  const s5 = 1 / Math.sqrt(5);
  const top = new THREE.Vector3(0, 1, 0);
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    upper.push(new THREE.Vector3(2 * s5 * Math.cos(a), s5, 2 * s5 * Math.sin(a)));
    lower.push(new THREE.Vector3(2 * s5 * Math.cos(a + Math.PI / 5), -s5, 2 * s5 * Math.sin(a + Math.PI / 5)));
  }
  const ico: THREE.Vector3[][] = [];
  for (let k = 0; k < 5; k++) {
    const k1 = (k + 1) % 5;
    ico.push([top, upper[k], upper[k1]], [upper[k], lower[k], upper[k1]], [upper[k1], lower[k], lower[k1]]);
  }
  const verts: THREE.Vector3[] = [];
  const ids = new Map<string, number>();
  const vid = (p: THREE.Vector3): number => {
    const n = p.clone().normalize();
    const key = `${Math.round(n.x * 1e4)},${Math.round(n.y * 1e4)},${Math.round(n.z * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length;
      verts.push(n);
      ids.set(key, id);
    }
    return id;
  };
  const raw: [number, number, number][] = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const [a, b, c] of ico) {
    const grid: number[][] = [];
    for (let i = 0; i <= freq; i++) {
      grid.push([]);
      for (let j = 0; j <= freq - i; j++) {
        ab.subVectors(b, a).multiplyScalar(i / freq);
        ac.subVectors(c, a).multiplyScalar(j / freq);
        grid[i].push(vid(a.clone().add(ab).add(ac)));
      }
    }
    for (let i = 0; i < freq; i++) {
      for (let j = 0; j < freq - i; j++) {
        raw.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
        if (i + j < freq - 1) raw.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
      }
    }
  }
  const faces: [number, number, number][] = [];
  const edgeKeys = new Set<string>();
  const edges: [number, number][] = [];
  const n = new THREE.Vector3();
  for (const f of raw) {
    const [a, b, c] = f.map((i) => verts[i]);
    if (Math.min(a.y, b.y, c.y) < -1e-4 || a.y + b.y + c.y < 1e-3) continue;
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const face: [number, number, number] = n.dot(a) >= 0 ? [f[0], f[1], f[2]] : [f[0], f[2], f[1]];
    faces.push(face);
    for (let e = 0; e < 3; e++) {
      const i = face[e];
      const j = face[(e + 1) % 3];
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(i < j ? [i, j] : [j, i]);
      }
    }
  }
  return { verts, faces, edges };
}

const PANEL = [0xf3f1ea, 0xe8e4d8];
const INTERIOR = 0x8a5a34;
const STRUT = 0xc4c8cc;
const CROWNS = [0xf28c8c, 0x8cd3f2, 0xf2c38c, 0xb48cf2, 0x8cf2b4];
const WARM_STRING = 0xffcf87;
const PARTY_STRING = [0xff5a5a, 0xffd25a, 0x5aff8a, 0x5ac8ff, 0xc05aff];
const RUGS = [0x7b3f2b, 0x2f4f6b, 0x6b2f55, 0x4f5b2a];
/** Fairy-light bulb spacing (m) and cap per dome by quality. */
const LIGHTS = { low: { spacing: 1.1, cap: 90 }, medium: { spacing: 0.8, cap: 180 }, high: { spacing: 0.55, cap: 300 } };

const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const pc = new THREE.Vector3();
const cen = new THREE.Vector3();
const nrm = new THREE.Vector3();

export function buildDomes(domes: Obstacle[], kit: ClutterKit, out: PropBatches): void {
  if (domes.length === 0) return;
  const shapes = new Map<number, Geodesic>();
  const lights = LIGHTS[out.quality];
  for (const o of domes) {
    const freq = o.radius < 3.5 ? 2 : 4;
    let geo = shapes.get(freq);
    if (!geo) {
      geo = geodesicHemisphere(freq);
      shapes.set(freq, geo);
    }
    const rng = obstacleRng(o, 'dome');
    const R = o.radius;
    const H = o.height > 0 ? o.height : R * 0.85;
    const frame = frameOf(o.x, o.z, o.yaw);
    const pts = geo.verts.map((v) => new THREE.Vector3(v.x * R, v.y * H, v.z * R));
    const crown = rng.chance(0.4) ? rng.pick(CROWNS) : -1;

    // Fabric: outer panels inset from the struts, inner shell lit warm at night.
    const w = new GeoWriter();
    for (const f of geo.faces) {
      const u0 = geo.verts[f[0]];
      const u1 = geo.verts[f[1]];
      const u2 = geo.verts[f[2]];
      const uy = (u0.y + u1.y + u2.y) / 3;
      const ua = Math.atan2(u0.x + u1.x + u2.x, u0.z + u1.z + u2.z);
      if (Math.abs(ua) < 0.27 && uy < 0.34) continue;
      cen.copy(pts[f[0]]).add(pts[f[1]]).add(pts[f[2]]).divideScalar(3);
      pa.lerpVectors(cen, pts[f[0]], 0.95);
      pb.lerpVectors(cen, pts[f[1]], 0.95);
      pc.lerpVectors(cen, pts[f[2]], 0.95);
      const top = uy > 0.93;
      w.paint(top && crown >= 0 ? crown : PANEL[(f[0] + f[1] + f[2]) % 2], 0.1);
      w.tri(pa, pb, pc);
      nrm.crossVectors(pb.clone().sub(pa), pc.clone().sub(pa)).normalize().multiplyScalar(-0.05);
      w.paint(INTERIOR, 1.6);
      w.tri(pa.add(nrm), pc.add(nrm), pb.add(nrm));
    }
    out.solid.add(w.build(), frame);

    const struts = new GeoWriter().paint(STRUT);
    for (const [i, j] of geo.edges) struts.tube(pts[i], pts[j], 0.035, 0.035, 3);
    out.gloss.add(struts.build(), frame);

    // Fairy lights along the upper struts, just outside the fabric.
    const party = rng.chance(0.3);
    const upperEdges = geo.edges.filter(([i, j]) => geo.verts[i].y > 0.12 && geo.verts[j].y > 0.12);
    let total = 0;
    for (const [i, j] of upperEdges) total += pts[i].distanceTo(pts[j]);
    const spacing = Math.max(lights.spacing, total / lights.cap);
    // Bulbs keep an even pitch across edge joints: `next` carries the leftover distance.
    let next = 0;
    let bulbIndex = 0;
    for (const [i, j] of upperEdges) {
      const len = pts[i].distanceTo(pts[j]);
      let d = next;
      for (; d < len; d += spacing) {
        pa.lerpVectors(pts[i], pts[j], d / len);
        nrm.set(pa.x / (R * R), pa.y / (H * H), pa.z / (R * R)).normalize();
        pa.addScaledVector(nrm, 0.07);
        const color = party ? PARTY_STRING[bulbIndex % PARTY_STRING.length] : WARM_STRING;
        out.lights.add(kit.bulb, within(frame, { x: pa.x, y: pa.y, z: pa.z }), color);
        bulbIndex++;
      }
      next = d - len;
    }

    // Interior seen through the door: rug, lamps, cushions.
    const floor = new PartsBuilder();
    floor.cylinder(R * 0.93, R * 0.93, 0.025, rng.pick(RUGS), { y: 0.013 }, { segments: 18 });
    floor.cylinder(R * 0.5, R * 0.5, 0.025, 0xc9a25a, { y: 0.02 }, { segments: 14 });
    out.solid.add(floor.build(), frame);
    out.solid.add(kit.lantern, within(frame, { x: -R * 0.3, z: -R * 0.45 }));
    out.solid.add(kit.lantern, within(frame, { x: R * 0.4, z: -R * 0.2 }));
    out.solid.add(kit.table, within(frame, { z: -R * 0.1, ry: rng.range(-0.4, 0.4) }));
    for (let k = 0; k < 4; k++) {
      const a = rng.range(-2.6, 0.4) + k * 0.9;
      out.solid.add(kit.cushion, within(frame, { x: Math.sin(a) * R * 0.55, z: Math.cos(a) * R * 0.55 - R * 0.1 }), rng.pick(CROWNS));
    }
  }
}
