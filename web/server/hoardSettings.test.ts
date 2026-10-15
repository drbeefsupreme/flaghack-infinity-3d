import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMatch } from '../src/sim/matchSettings';
import { hoardThreshold } from '../src/sim/systems/economy';
import { cleanup, connect, hello, host, join } from './testkit';

afterEach(cleanup);

describe('host-authoritative Flag hoarding settings', () => {
  it('replicates the leader choice and preserves it for a late join while rejecting guest and live edits', async () => {
    const h = await host();
    const leader = await join(h, 'leader'), guest = await join(h, 'guest');
    leader.c.mirrored = guest.c.mirrored = true;
    expect(leader.me.lobby.settings.match?.hoardThreshold).toBe(24);
    const match = normalizeMatch({ hoardThreshold: 65, maxSignifiers: 0 });
    leader.c.send({ t: 'settings', settings: { seed: 'hoard-settings', match } });
    for (const c of [leader.c, guest.c]) await c.next('lobby', m => m.lobby.settings.match?.hoardThreshold === 65);
    guest.c.send({ t: 'settings', settings: { match: { ...match, hoardThreshold: 0 } } });
    guest.c.send({ t: 'ping', id: 1, clientTime: 0 });
    await guest.c.next('pong', m => m.id === 1);
    leader.c.send({ t: 'start' });
    for (const c of [leader.c, guest.c]) {
      const start = await c.next('matchStart', undefined, 15000);
      expect(start.options.match?.hoardThreshold).toBe(65);
      expect(hoardThreshold(c.mirror!.world, 0)).toBe(65);
    }
    leader.c.send({ t: 'settings', settings: { match: { ...match, hoardThreshold: 100 } } });
    leader.c.send({ t: 'ping', id: 2, clientTime: 0 });
    await leader.c.next('pong', m => m.id === 2);
    const late = await connect(h);
    late.mirrored = true;
    hello(late, 'late watcher');
    await late.next('welcome');
    expect((await late.next('matchStart', undefined, 15000)).options.match?.hoardThreshold).toBe(65);
    expect(hoardThreshold(late.mirror!.world, 0)).toBe(65);
  });
});
