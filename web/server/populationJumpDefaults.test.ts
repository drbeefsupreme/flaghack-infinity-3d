import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMatch } from '../src/sim/matchSettings';
import { cleanup, host, join } from './testkit';

afterEach(cleanup);

describe('host population and jump defaults', () => {
  it.each([null, { maxSignifiers: 40, jumpHeight: 1 }])('replicates defaults or explicit settings through match start: %j', async (override) => {
    const h = await host();
    const leader = await join(h, 'leader'), guest = await join(h, 'guest');
    leader.c.mirrored = guest.c.mirrored = true;
    const defaults = { maxSignifiers: 200, jumpHeight: 3 };
    for (const client of [leader, guest]) expect(client.me.lobby.settings.match).toMatchObject(defaults);
    if (override) {
      leader.c.send({ t: 'settings', settings: { match: normalizeMatch(override) } });
      for (const c of [leader.c, guest.c]) await c.next('lobby', m => m.lobby.settings.match?.maxSignifiers === override.maxSignifiers);
    }
    leader.c.send({ t: 'start' });
    const expected = override ?? defaults;
    for (const c of [leader.c, guest.c]) {
      const start = await c.next('matchStart', undefined, 15000);
      expect(start.options.match).toMatchObject(expected);
      expect(c.mirror!.world.hippies.size).toBe(expected.maxSignifiers);
      expect(c.mirror!.world.options.match).toMatchObject(expected);
    }
  });
});
