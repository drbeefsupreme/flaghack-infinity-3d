/**
 * Soundscape state: what the music and ambience respond to, measured from World + Session
 * around the listener a few times per second and smoothed per frame. All fields are 0..1
 * levels or -1..1 pans unless stated.
 */
import type { Session } from '../game/session';
import { BURN_TIME, TIDE_WARNING } from '../sim/constants';
import type { CaptureStage } from '../sim/types';
import type { World } from '../sim/world';
import type { AudioEngine } from './engine';

export interface Soundscape {
  mode: 'title' | 'match';
  /** Threat: own Hearth stage, enemies near the player, Phason Tide warning, sudden death. */
  tension: number;
  /** 0 day … 1 deep night (mystical layers). */
  night: number;
  /** The Burn (sudden death) layer level. */
  burn: number;
  /** Proximity to the nearest sound camp and its pan. */
  fest: number;
  festPan: number;
  /** Proximity to the nearest own working Drum Circle and its pan. */
  drum: number;
  drumPan: number;
  /** Planted Flags near the listener (count). */
  flags: number;
  /** Crowd density near the listener. */
  crowd: number;
  /** Proximity to the burning effigy (during The Burn) and its pan. */
  fire: number;
  firePan: number;
  /** Own Hearth in danger (contained or worse): the soundscape re-arms the alarm. */
  alarm: boolean;
}

export function createSoundscape(): Soundscape {
  return {
    mode: 'title',
    tension: 0,
    night: 0,
    burn: 0,
    fest: 0,
    festPan: 0,
    drum: 0,
    drumPan: 0,
    flags: 0,
    crowd: 0,
    fire: 0,
    firePan: 0,
    alarm: false,
  };
}

const STAGE_TENSION: Record<CaptureStage, number> = {
  safe: 0,
  threatened: 0.35,
  contained: 0.7,
  contested: 0.8,
  overwritten: 1,
  captured: 1,
};

const FLAG_HEAR_RADIUS = 22;
const CROWD_RADIUS = 28;
const DRUM_RADIUS = 45;
const ENEMY_RADIUS = 30;
/** Night arrives with the clock when the env module does not report daylight (dusk ~6:00, night ~10:00). */
const DUSK = 6 * 60;
const NIGHT = 10 * 60;

/** Raw (unsmoothed) targets; GameAudio smooths them into the live Soundscape. */
export function measure(world: World, session: Session, e: AudioEngine, daylight: number | null, out: Soundscape): void {
  out.mode = session.screen === 'title' ? 'title' : 'match';
  const playing = out.mode === 'match';
  const me = session.playerFaction;
  const fs = world.factions[me];
  const av = playing && fs ? world.avatars.get(fs.avatarId) : undefined;
  // Proximity layers follow the vexillomancer in action view (the camera trails or orbits
  // them); otherwise (title orbit, Command View) they follow the listener's ground point.
  const focusAvatar = av !== undefined && session.view === 'action';
  const fx = focusAvatar ? av.pos.x : e.lx;
  const fz = focusAvatar ? av.pos.z : e.lz;

  const clockNight = Math.min(1, Math.max(0, (world.time - DUSK) / (NIGHT - DUSK)));
  out.night = daylight === null ? clockNight : 1 - daylight;
  out.burn = world.suddenDeath ? 1 : 0;

  // Sound camps: power-law falloff outside their radius; the whole burn hears a little.
  let fest = 0;
  let festPan = 0;
  for (const sc of world.map.soundCamps) {
    const d = Math.hypot(sc.x - fx, sc.z - fz);
    const p = d <= sc.radius ? 1 : Math.pow(sc.radius / d, 1.4);
    if (p > fest) {
      fest = p;
      festPan = e.panOf(sc.x, sc.z);
    }
  }
  out.fest = fest;
  out.festPan = festPan;

  let drum = 0;
  let drumPan = 0;
  let tension = 0;
  let alarm = false;
  for (const b of world.buildings.values()) {
    if (!playing || b.faction !== me) continue;
    if (b.kind === 'drumcircle' && b.built >= 1 && !b.disabled) {
      const p = Math.max(0, 1 - Math.hypot(b.pos.x - fx, b.pos.z - fz) / DRUM_RADIUS);
      if (p > drum) {
        drum = p;
        drumPan = e.panOf(b.pos.x, b.pos.z);
      }
    } else if (b.kind === 'hearth' && b.hearth) {
      const st = STAGE_TENSION[b.hearth.stage];
      tension = Math.max(tension, st);
      if (st >= 0.7) alarm = true;
    }
  }
  out.drum = drum;
  out.drumPan = drumPan;

  let threat = 0;
  let crowd = 0;
  if (av) {
    for (const a of world.avatars.values()) {
      if (a.faction !== me && a.koUntil === 0 && Math.hypot(a.pos.x - av.pos.x, a.pos.z - av.pos.z) < ENEMY_RADIUS) threat += 0.25;
    }
  }
  for (const h of world.hippies.values()) {
    const d = Math.hypot(h.pos.x - fx, h.pos.z - fz);
    if (d < CROWD_RADIUS) crowd += 1 - d / CROWD_RADIUS;
    if (av && h.faction !== me && h.faction !== -1 && h.koUntil === 0 && Math.hypot(h.pos.x - av.pos.x, h.pos.z - av.pos.z) < ENEMY_RADIUS * 0.7) threat += 0.05;
  }
  tension += Math.min(0.5, threat);
  if (playing) {
    if (world.tide.warned || (world.tide.nextAt > 0 && world.tide.nextAt - world.time < TIDE_WARNING)) tension += 0.3;
    if (world.suddenDeath) tension += 0.4;
    else if (world.time > BURN_TIME - 60) tension += 0.15;
  }
  out.tension = Math.min(1, tension);
  out.alarm = alarm;
  out.crowd = Math.min(1, crowd / 8 + fest * 0.6);

  let flags = 0;
  for (const f of world.flags.values()) {
    if (f.state === 'planted' && Math.abs(f.pos.x - fx) < FLAG_HEAR_RADIUS && Math.abs(f.pos.z - fz) < FLAG_HEAR_RADIUS) flags++;
  }
  out.flags = flags;

  const eff = world.map.effigy;
  const fd = Math.hypot(eff.x - fx, eff.z - fz);
  out.fire = world.suddenDeath ? Math.max(0.15, Math.min(1, 25 / Math.max(25, fd))) : 0;
  out.firePan = e.panOf(eff.x, eff.z);
}

/** Exponential approach of `cur` to `target` at `rate`/s, frame-rate independent. */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}
