/**
 * Linear-space colour constants for VFX recipes (THREE.Color converts the sRGB hex on
 * construction). Treat them as read-only: recipes only read r/g/b.
 */
import * as THREE from 'three';
import { FLAG_YELLOW } from '../../sim/constants';
import type { PingKind } from '../../sim/types';

export const YELLOW = new THREE.Color(FLAG_YELLOW);
export const GOLD = new THREE.Color(0xffb02e);
export const WHITE = new THREE.Color(0xffffff);
export const WARM_WHITE = new THREE.Color(0xfff0d4);
export const ORANGE = new THREE.Color(0xff7a1a);
export const EMBER = new THREE.Color(0xff4410);
export const RED = new THREE.Color(0xff2a3a);
export const DUST = new THREE.Color(0xc2a47a);
export const DUST_DARK = new THREE.Color(0x7d6a52);
export const WOOD = new THREE.Color(0x8a5a2b);
export const WOOD_LIGHT = new THREE.Color(0xc79055);
export const SMOKE = new THREE.Color(0xc4bfb8);
export const SMOKE_DARK = new THREE.Color(0x3b3735);
export const PINK = new THREE.Color(0xff5fd2);
export const GLASS_BLUE = new THREE.Color(0x59b8ff);
export const CYAN = new THREE.Color(0x29f0ff);
export const MAGENTA = new THREE.Color(0xff2bd6);
export const LILAC = new THREE.Color(0xc8b4ff);
export const ELECTRIC = new THREE.Color(0x8a7bff);

/** D.E.G.E.N. ping colours by kind (SOS additionally flashes). */
export const PING_COLORS: Record<PingKind, THREE.Color> = {
  rally: new THREE.Color(0x3dffb0),
  attack: new THREE.Color(0xff6a2a),
  flag: YELLOW,
  sos: RED,
  shot: new THREE.Color(0xff5ad1),
};

export const CONFETTI: readonly THREE.Color[] = [0xff3b6b, 0xffd400, 0x29e3ff, 0x86ff4a, 0xa45cff, 0xff8a1f, 0xffffff].map(
  (h) => new THREE.Color(h),
);

export const FIREWORK: readonly THREE.Color[] = [0xff2d55, 0xffd400, 0x29e3ff, 0x86ff4a, 0xb05cff, 0xff8a1f, 0xff5ad1, 0xeef0ff, 0x3dffb0].map(
  (h) => new THREE.Color(h),
);
