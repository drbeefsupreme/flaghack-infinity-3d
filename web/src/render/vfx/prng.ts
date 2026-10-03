/**
 * Tiny deterministic PRNG (mulberry32) for presentation-only randomness. Seeded from the
 * match seed so a replayed match produces the same firework show; never used by sim/.
 */

/** Anything with writable x/y/z (THREE.Vector3 qualifies). */
export interface MutableV3 {
  x: number;
  y: number;
  z: number;
}

export class Prng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniformly distributed unit vector written into `out`. */
  unit(out: MutableV3): MutableV3 {
    const z = this.signed();
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out.x = r * Math.cos(a);
    out.y = z;
    out.z = r * Math.sin(a);
    return out;
  }
}

/** FNV-1a 32-bit string hash (seeds the show from the match seed). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
