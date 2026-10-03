import { describe, expect, it } from 'vitest';
import { AVATAR, SIM_DT } from '../sim/constants';
import type { V3 } from '../sim/math';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { throwOrigin, throwVelocity } from '../sim/systems/avatars';
import { solveThrowPitch, ThrowPredictor } from './aim';
import type { AimInfo } from './session';

/** Height of a semi-implicit Euler flight (the sim's integrator) when it has travelled `dist`. */
function heightAt(pitch: number, dist: number): number {
  const v: V3 = { x: 0, y: 0, z: 0 };
  throwVelocity(0, pitch - AVATAR.throwPitchBias, v);
  let x = 0;
  let y = 0;
  for (let i = 0; i < 600; i++) {
    v.y -= AVATAR.gravity * SIM_DT;
    const nx = x + v.z * SIM_DT;
    const ny = y + v.y * SIM_DT;
    if (nx >= dist) return y + (ny - y) * ((dist - x) / (nx - x));
    x = nx;
    y = ny;
  }
  return -Infinity;
}

describe('throw aim', () => {
  it('solves a launch pitch whose flight passes through the aimed point', () => {
    for (const rise of [-AVATAR.throwHandHeight, 0, 2.5]) {
      for (const dist of [4, 10, 18, 25]) {
        const pitch = solveThrowPitch(dist, rise);
        expect(pitch, `dist ${dist} rise ${rise}`).not.toBeNull();
        expect(Math.abs(heightAt(pitch ?? 0, dist) - rise), `dist ${dist} rise ${rise}`).toBeLessThan(0.05);
      }
    }
    expect(solveThrowPitch(80, 0)).toBeNull();
  });

  it('previews exactly where the simulation lands the thrown Flag', () => {
    const world = createMatch({ seed: 'aim-preview', difficulty: 'normal', allAi: false });
    const sim = new Simulation(world);
    const av = world.avatarOf(0);
    const yaw = av.yaw;
    const hand = throwOrigin(av.pos, yaw, { x: 0, y: 0, z: 0 });
    const pitch = (solveThrowPitch(14, -hand.y) ?? 0) - AVATAR.throwPitchBias;
    const aim: AimInfo = { active: true, arc: [], landing: null, node: -1 };
    new ThrowPredictor().predict(world, av, 0, yaw, pitch, aim);
    expect(aim.landing).not.toBeNull();
    expect(aim.arc.length).toBeGreaterThan(5);

    const flagId = av.carried[av.carried.length - 1];
    world.submit({ t: 'avatarInput', faction: 0, input: { moveX: 0, moveZ: 0, jump: false, sprint: false, yaw, pitch } });
    world.submit({ t: 'throw', faction: 0 });
    let landed: { node: number; pos: V3 } | null = null;
    for (let i = 0; i < 400 && !landed; i++) {
      sim.step();
      for (const e of world.drainEvents()) if (e.t === 'flagLanded' && e.flagId === flagId) landed = e;
    }
    expect(landed).not.toBeNull();
    expect(landed?.node).toBe(aim.node);
    if (aim.node < 0 && landed && aim.landing) {
      expect(Math.hypot(landed.pos.x - aim.landing.x, landed.pos.z - aim.landing.z)).toBeLessThan(0.05);
    }
  });
});
