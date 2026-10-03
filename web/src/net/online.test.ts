/**
 * End-to-end over real sockets: a host from server/host.ts (its own 60 Hz sim on the platform
 * clock) and NetClients on Node's WebSocket, wired the way game/app.ts wires them (mirror +
 * prediction). Real time is the point here (the host ticks on wall time and frames cross a real
 * socket), so the waits are genuine; each waits on a condition, except the pacing of the 60 Hz
 * input stream itself.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHost } from '../../server/host';
import type { RunningHost } from '../../server/host';
import { SIM_DT } from '../sim/constants';
import type { AvatarInput, FactionId } from '../sim/types';
import { NetClient } from './client';
import type { NetClientHooks, TokenStore } from './client';
import { NetMirror } from './mirror';
import { AvatarPredictor } from './predict';

/** One online player: session + mirror + prediction. */
class Player {
  readonly client: NetClient;
  mirror: NetMirror | null = null;
  predictor: AvatarPredictor | null = null;
  seat: FactionId | null = null;
  seq = 0;

  constructor(url: string, name: string, password: string) {
    let token: string | null = null;
    const tokens: TokenStore = {
      load: () => token,
      save: (t) => {
        token = t;
      },
    };
    const hooks: NetClientHooks = {
      lobby: () => {},
      matchStart: (options, seat, snapshot) => {
        const mirror = NetMirror.create(options, snapshot);
        this.mirror = mirror;
        this.seat = seat;
        this.seq = 0;
        const playerId = this.client.playerId;
        this.predictor =
          seat !== null && playerId !== null ? new AvatarPredictor(mirror.world, mirror.world.factions[seat].avatarId, playerId) : null;
        mirror.setPredicted(this.predictor ? this.predictor.avatarId : null);
      },
      state: (frame) => this.mirror?.push(frame),
      closed: () => {},
    };
    this.client = new NetClient({ url, name, password, serverName: 'test host', hooks, tokens });
  }

  /** One local tick: send `input` and predict it (App.netTick). */
  tick(input: AvatarInput): void {
    this.seq++;
    this.client.sendInput(this.seq, input, []);
    this.predictor?.tick(this.seq, input);
  }

  frame(dt: number): void {
    if (!this.mirror) return;
    this.mirror.advance(performance.now());
    this.predictor?.frame(this.mirror, dt, 0);
  }
}

async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await delay(10);
  }
}

describe('online burn against a real host', () => {
  let host: RunningHost;
  let url: string;

  beforeAll(async () => {
    host = await startHost({ password: 'flags', port: 0, bind: '127.0.0.1', staticDir: null, serverName: 'Test Burn', log: () => {} });
    url = `ws://127.0.0.1:${host.port}/ws`;
  });
  afterAll(async () => {
    await host.close();
  });

  it('refuses a wrong password', async () => {
    const p = new Player(url, 'mallory', 'nope');
    await until('denial', () => p.client.status === 'closed');
    expect(p.client.error).toBeTruthy();
  });

  it("joins, starts, moves a predicted avatar and shows it moving in another player's mirror", async () => {
    const a = new Player(url, 'alice', 'flags');
    const b = new Player(url, 'bob', 'flags');
    await until('lobby', () => a.client.status === 'lobby' && b.client.status === 'lobby');
    a.client.setSeat(0);
    b.client.setSeat(1);
    await until('seats', () => a.client.seat === 0 && b.client.seat === 1);
    expect(a.client.isLeader).toBe(true);
    a.client.start();
    await until('match', () => a.mirror !== null && b.mirror !== null);
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    const am = a.mirror;
    const bm = b.mirror;
    if (!am || !bm) throw new Error('no mirrors');
    const avatarId = am.world.factions[0].avatarId;
    const startAv = am.world.avatars.get(avatarId);
    const startInB = bm.world.avatars.get(avatarId);
    if (!startAv || !startInB) throw new Error('no avatar');
    const start = { x: startAv.pos.x, z: startAv.pos.z };
    const seenFrom = { x: startInB.pos.x, z: startInB.pos.z };

    // Run toward the burn's centre for 1.5 s at 60 inputs per second.
    const dir = Math.atan2(-start.x, -start.z);
    const run: AvatarInput = { moveX: Math.sin(dir), moveZ: Math.cos(dir), jump: false, sprint: false, yaw: dir, pitch: 0 };
    const t0 = performance.now();
    let next = t0;
    while (performance.now() - t0 < 1500) {
      while (next <= performance.now()) {
        a.tick(run);
        next += SIM_DT * 1000;
      }
      a.frame(1 / 60);
      b.frame(1 / 60);
      await delay(4);
    }
    // Stand still until the host has consumed every input and both playback clocks caught up.
    const still: AvatarInput = { ...run, moveX: 0, moveZ: 0 };
    const playerId = a.client.playerId;
    if (!playerId) throw new Error('no player id');
    const sent = a.seq;
    await until('acks', () => {
      a.tick(still);
      a.frame(1 / 60);
      b.frame(1 / 60);
      return am.latestAck(playerId) >= sent;
    });
    for (let i = 0; i < 30; i++) {
      a.tick(still);
      a.frame(1 / 60);
      b.frame(1 / 60);
      await delay(16);
    }

    const word = am.latestAvatar(avatarId);
    if (!word) throw new Error('no host word on the avatar');
    const travelled = Math.hypot(word.pos.x - start.x, word.pos.z - start.z);
    // 1.5 s at 8 m/s, less what start-up and acceleration eat.
    expect(travelled).toBeGreaterThan(8);
    // Prediction settled on the host's word once the inputs stopped.
    const shown = am.world.avatars.get(avatarId);
    if (!shown) throw new Error('avatar gone');
    expect(Math.hypot(shown.pos.x - word.pos.x, shown.pos.z - word.pos.z)).toBeLessThan(0.1);
    // Bob's mirror shows alice's vexillomancer where the host put her.
    const inB = bm.world.avatars.get(avatarId);
    if (!inB) throw new Error('avatar gone in b');
    expect(Math.hypot(inB.pos.x - seenFrom.x, inB.pos.z - seenFrom.z)).toBeGreaterThan(8);
    expect(Math.hypot(inB.pos.x - word.pos.x, inB.pos.z - word.pos.z)).toBeLessThan(0.5);

    a.client.leave();
    b.client.leave();
  });
});
