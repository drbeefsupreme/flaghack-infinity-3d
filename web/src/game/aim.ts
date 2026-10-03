/**
 * Throw aiming. The player's aim is "where the crosshair is": the launch pitch is solved so the
 * Flag lands on the crosshair point, and the RMB preview replays the sim's exact flight
 * (avatars.throwOrigin/throwVelocity, semi-implicit Euler at SIM_DT, segment raycasts, walkable
 * landings snap via flags.nearestPlantableNode within projectiles.throwSnapRadius, steep faces
 * and the perimeter fence drop the Flag loose).
 */
import { AVATAR, MAP_HALF, PROJECTILE, SIM_DT } from '../sim/constants';
import type { V3 } from '../sim/math';
import { throwOrigin, throwVelocity } from '../sim/systems/avatars';
import { nearestPlantableNode } from '../sim/systems/flags';
import { throwSnapRadius } from '../sim/systems/projectiles';
import type { Avatar, FactionId } from '../sim/types';
import type { World } from '../sim/world';
import type { AimInfo } from './session';

/** One arc point per this many sim ticks (render smooths the polyline). */
const ARC_STRIDE = 2;
const MAX_STEPS = Math.ceil(PROJECTILE.lifetime / SIM_DT);
const ARC_POINTS = Math.ceil(MAX_STEPS / ARC_STRIDE) + 2;
/** Surfaces at least this flat catch a Flag (projectiles.ts); steeper faces knock it down. */
const WALKABLE_NY = 0.7;
const WALL_STANDOFF = 0.3;
const FENCE = MAP_HALF - 0.5;
/** Launch pitch used when the crosshair is beyond reach: the longest throw. */
export const MAX_RANGE_PITCH = Math.PI / 4;

/**
 * Low-arc launch pitch (radians, + up, before the sim's throwPitchBias) that carries a Flag
 * `dist` metres horizontally and `rise` metres up from the hand, or null when out of range. The
 * sim integrates with semi-implicit Euler (vel.y -= g·dt before each move), which flies like a
 * continuous parabola launched g·dt/2 slower vertically; a few fixed-point passes fold that in.
 */
export function solveThrowPitch(dist: number, rise: number): number | null {
  const v = AVATAR.throwSpeed;
  const g = AVATAR.gravity;
  const droop = (g * SIM_DT) / 2;
  let y = rise;
  let pitch = 0;
  for (let i = 0; i < 4; i++) {
    const disc = v * v * v * v - g * (g * dist * dist + 2 * y * v * v);
    if (disc < 0) return null;
    pitch = Math.atan((v * v - Math.sqrt(disc)) / (g * dist));
    y = rise + droop * (dist / (v * Math.cos(pitch)));
  }
  return pitch;
}

export class ThrowPredictor {
  private pool: V3[] = [];
  private pos: V3 = { x: 0, y: 0, z: 0 };
  private vel: V3 = { x: 0, y: 0, z: 0 };
  private landing: V3 = { x: 0, y: 0, z: 0 };
  private at = { x: 0, z: 0 };

  constructor() {
    for (let i = 0; i < ARC_POINTS; i++) this.pool.push({ x: 0, y: 0, z: 0 });
  }

  /**
   * Fill `aim` with the predicted flight of a throw at (yaw, pitch), pitch as submitted in
   * AvatarInput (throwVelocity clamps it and adds the bias, exactly as cmdThrow does).
   */
  predict(world: World, av: Avatar, faction: FactionId, yaw: number, pitch: number, aim: AimInfo): void {
    const col = world.collision;
    const g = AVATAR.gravity;
    const pos = throwOrigin(av.pos, yaw, this.pos);
    const vel = throwVelocity(yaw, pitch, this.vel);
    const arc = aim.arc;
    arc.length = 0;
    this.push(arc, pos);
    let snaps = false;
    let landed = false;
    for (let i = 1; i <= MAX_STEPS && !landed; i++) {
      vel.y -= g * SIM_DT;
      const dx = vel.x * SIM_DT;
      const dy = vel.y * SIM_DT;
      const dz = vel.z * SIM_DT;
      const len = Math.hypot(dx, dy, dz);
      const hit = len > 1e-9 ? col.raycast(pos.x, pos.y, pos.z, dx, dy, dz, len) : null;
      if (hit) {
        landed = true;
        snaps = hit.ny >= WALKABLE_NY;
        pos.x = snaps ? hit.x : hit.x + hit.nx * WALL_STANDOFF;
        pos.y = Math.max(0, hit.y);
        pos.z = snaps ? hit.z : hit.z + hit.nz * WALL_STANDOFF;
      } else if (pos.y + dy <= 0) {
        const t = dy < 0 ? Math.min(1, pos.y / -dy) : 1;
        pos.x += dx * t;
        pos.y = 0;
        pos.z += dz * t;
        landed = true;
        snaps = true;
      } else {
        pos.x += dx;
        pos.y += dy;
        pos.z += dz;
        if (Math.abs(pos.x) > FENCE || Math.abs(pos.z) > FENCE) landed = true;
      }
      if (landed || i % ARC_STRIDE === 0) this.push(arc, pos);
    }
    this.landing.x = pos.x;
    this.landing.y = pos.y;
    this.landing.z = pos.z;
    aim.landing = this.landing;
    this.at.x = pos.x;
    this.at.z = pos.z;
    aim.node = snaps ? nearestPlantableNode(world, this.at, throwSnapRadius(world, faction), faction) : -1;
  }

  private push(arc: V3[], p: V3): void {
    const slot = this.pool[arc.length];
    if (!slot) return;
    slot.x = p.x;
    slot.y = p.y;
    slot.z = p.z;
    arc.push(slot);
  }
}
