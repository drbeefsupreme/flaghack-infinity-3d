/**
 * Day–night palette of the burn, keyed on the match clock: golden afternoon at 0:00, sunset
 * around 6:00, blue-hour dusk around 8:00, night from 10:00, deep night at The Burn (14:00).
 * Keys are authored in sRGB hex and interpolated in linear space with smoothstep easing.
 */
import * as THREE from 'three';
import type { DayState } from './envTypes';

interface DayKey {
  t: number;
  /** Sun elevation / azimuth in degrees (azimuth from +z toward +x). */
  sunEl: number;
  sunAz: number;
  zenith: number;
  horizon: number;
  sunGlow: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  daylight: number;
  night: number;
  dusk: number;
  stars: number;
}

const KEYS: DayKey[] = [
  {
    t: 0, sunEl: 22, sunAz: 200, zenith: 0x3b72bd, horizon: 0xf0d6ae, sunGlow: 0xffd590, sunColor: 0xffe0b2, sunIntensity: 3.6,
    hemiSky: 0xa9c2e2, hemiGround: 0x6a5334, hemiIntensity: 0.95, fogNear: 75, fogFar: 760, exposure: 1.0,
    daylight: 1, night: 0, dusk: 0.12, stars: 0,
  },
  {
    t: 200, sunEl: 13, sunAz: 190, zenith: 0x3a67a8, horizon: 0xffca8c, sunGlow: 0xffb05a, sunColor: 0xffcd92, sunIntensity: 3.9,
    hemiSky: 0x9eb0d0, hemiGround: 0x6a482b, hemiIntensity: 0.85, fogNear: 70, fogFar: 700, exposure: 1.05,
    daylight: 0.95, night: 0, dusk: 0.38, stars: 0,
  },
  {
    t: 330, sunEl: 4, sunAz: 180, zenith: 0x33538c, horizon: 0xffa25e, sunGlow: 0xff8a3a, sunColor: 0xffaa66, sunIntensity: 3.0,
    hemiSky: 0x8c95bc, hemiGround: 0x5a3a27, hemiIntensity: 0.8, fogNear: 62, fogFar: 640, exposure: 1.1,
    daylight: 0.75, night: 0.06, dusk: 0.8, stars: 0,
  },
  {
    t: 380, sunEl: -0.6, sunAz: 176, zenith: 0x283a73, horizon: 0xf07c5c, sunGlow: 0xff5f3c, sunColor: 0xff7a4c, sunIntensity: 0.9,
    hemiSky: 0x7272a4, hemiGround: 0x3c2a2c, hemiIntensity: 0.78, fogNear: 58, fogFar: 600, exposure: 1.16,
    daylight: 0.5, night: 0.28, dusk: 1, stars: 0.02,
  },
  {
    t: 470, sunEl: -7, sunAz: 170, zenith: 0x18214d, horizon: 0x7d587c, sunGlow: 0xb84e78, sunColor: 0xff7a4c, sunIntensity: 0,
    hemiSky: 0x4a5490, hemiGround: 0x201b2c, hemiIntensity: 0.75, fogNear: 52, fogFar: 540, exposure: 1.26,
    daylight: 0.2, night: 0.68, dusk: 0.75, stars: 0.35,
  },
  {
    t: 600, sunEl: -18, sunAz: 165, zenith: 0x070b20, horizon: 0x1c2442, sunGlow: 0x2c2a55, sunColor: 0xff7a4c, sunIntensity: 0,
    hemiSky: 0x31437a, hemiGround: 0x0e101c, hemiIntensity: 0.72, fogNear: 48, fogFar: 500, exposure: 1.36,
    daylight: 0.03, night: 1, dusk: 0.08, stars: 1,
  },
  {
    t: 840, sunEl: -30, sunAz: 160, zenith: 0x050817, horizon: 0x151c35, sunGlow: 0x1c1c3a, sunColor: 0xff7a4c, sunIntensity: 0,
    hemiSky: 0x2b3b6a, hemiGround: 0x0b0d16, hemiIntensity: 0.68, fogNear: 46, fogFar: 480, exposure: 1.42,
    daylight: 0, night: 1, dusk: 0, stars: 1,
  },
];

/** Linearized colours per key (authoring is sRGB hex). */
const LINEAR = KEYS.map((k) => ({
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  sunGlow: new THREE.Color(k.sunGlow),
  sunColor: new THREE.Color(k.sunColor),
  hemiSky: new THREE.Color(k.hemiSky),
  hemiGround: new THREE.Color(k.hemiGround),
}));

const MOON_COLOR = new THREE.Color(0xb4c6ff);
const MOON_AZ = 64;
/** Minimum light elevation used for shadows: a grazing sun would smear the shadow map. */
const MIN_LIGHT_EL = 10;
const DEG = Math.PI / 180;

/**
 * The palette clock used on the title screen: warm golden light with the sun still ~17° up,
 * so 16 m trees at the map edge (50 m from the camps) cannot throw a camp into shadow.
 */
export const ATTRACT_CLOCK = 110;

export function createDayState(): DayState {
  return {
    clock: 0,
    sunDir: new THREE.Vector3(0, 1, 0),
    moonDir: new THREE.Vector3(0, 1, 0),
    lightDir: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(),
    lightIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunGlow: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogNear: 100,
    fogFar: 600,
    exposure: 1,
    daylight: 1,
    night: 0,
    dusk: 0,
    stars: 0,
  };
}

function dirFromAngles(out: THREE.Vector3, elDeg: number, azDeg: number): THREE.Vector3 {
  const el = elDeg * DEG;
  const az = azDeg * DEG;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** Fill `out` for match clock `clock` (seconds). Allocation-free. */
export function computeDayState(clock: number, out: DayState): DayState {
  out.clock = clock;
  let i = 0;
  while (i < KEYS.length - 2 && clock > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const la = LINEAR[i];
  const lb = LINEAR[i + 1];
  const raw = Math.min(1, Math.max(0, (clock - a.t) / (b.t - a.t)));
  const s = raw * raw * (3 - 2 * raw);
  const mix = (x: number, y: number) => x + (y - x) * s;

  const sunEl = mix(a.sunEl, b.sunEl);
  const sunAz = mix(a.sunAz, b.sunAz);
  dirFromAngles(out.sunDir, sunEl, sunAz);

  // The moon climbs from the east as the evening deepens.
  const moonEl = 8 + Math.min(1, Math.max(0, (clock - 380) / 520)) * 42;
  dirFromAngles(out.moonDir, moonEl, MOON_AZ - Math.max(0, clock - 380) * 0.02);

  out.zenith.lerpColors(la.zenith, lb.zenith, s);
  out.horizon.lerpColors(la.horizon, lb.horizon, s);
  out.sunGlow.lerpColors(la.sunGlow, lb.sunGlow, s);
  out.hemiSky.lerpColors(la.hemiSky, lb.hemiSky, s);
  out.hemiGround.lerpColors(la.hemiGround, lb.hemiGround, s);
  out.hemiIntensity = mix(a.hemiIntensity, b.hemiIntensity);
  out.fogColor.copy(out.horizon);
  out.fogNear = mix(a.fogNear, b.fogNear);
  out.fogFar = mix(a.fogFar, b.fogFar);
  out.exposure = mix(a.exposure, b.exposure);
  out.daylight = mix(a.daylight, b.daylight);
  out.night = mix(a.night, b.night);
  out.dusk = mix(a.dusk, b.dusk);
  out.stars = mix(a.stars, b.stars);

  // Direct light: the sun fades out as it touches the horizon, then the moon takes over.
  const sunI = mix(a.sunIntensity, b.sunIntensity);
  const moonI = 0.85 * Math.min(1, Math.max(0, (clock - 430) / 190));
  if (sunI >= moonI) {
    out.lightColor.lerpColors(la.sunColor, lb.sunColor, s);
    out.lightIntensity = sunI;
    dirFromAngles(out.lightDir, Math.max(sunEl, MIN_LIGHT_EL), sunAz);
  } else {
    out.lightColor.copy(MOON_COLOR);
    out.lightIntensity = moonI;
    dirFromAngles(out.lightDir, Math.max(moonEl, MIN_LIGHT_EL + 8), MOON_AZ);
  }
  return out;
}
