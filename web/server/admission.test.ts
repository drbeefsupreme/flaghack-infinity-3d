/**
 * Who gets in: the caps on sockets that have not said hello, how fast their slots come back, and
 * the keys of the password throttle (CF-Connecting-IP believed only from loopback, the ceiling on
 * one relaying peer, IPv6 counted by /64). Silent peers are raw TCP sockets from other loopback
 * addresses (Linux routes all of 127.0.0.0/8 to this machine).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningHost } from './host';
import { cleanup, connect, hello, host, join, PASSWORD, rawUpgrade, textFrame } from './testkit';

afterEach(cleanup);

describe('sockets that never say hello', () => {
  it('cannot fill the host from one address', async () => {
    const h = await host();
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) statuses.push((await rawUpgrade(h.port, '127.0.0.2')).status);
    expect(statuses).toEqual([...Array<number>(4).fill(101), ...Array<number>(12).fill(429)]);
    await join(h, 'alice');
    // Other addresses still fill the host's total, and then the door closes for everyone.
    for (const address of ['127.0.0.3', '127.0.0.4', '127.0.0.5']) {
      for (let i = 0; i < 4; i++) expect((await rawUpgrade(h.port, address)).status).toBe(101);
    }
    expect((await rawUpgrade(h.port, '127.0.0.6')).status).toBe(503);
  });

  it('free their slot the moment the host retires them, and are cut 2 s later if they ignore the close', async () => {
    const h = await host();
    const rude = [];
    for (let i = 0; i < 4; i++) rude.push(await rawUpgrade(h.port, '127.0.0.2'));
    expect((await rawUpgrade(h.port, '127.0.0.2')).status).toBe(429);
    // Anything but a hello first is retired with a close frame, which these sockets never answer.
    const sentAt = Date.now();
    for (const r of rude) r.socket.write(textFrame('{"t":"start"}'));
    await sleep(100);
    expect((await rawUpgrade(h.port, '127.0.0.2')).status).toBe(101);
    await Promise.all(rude.map((r) => r.closed));
    const waited = Date.now() - sentAt;
    expect(waited).toBeGreaterThan(1500);
    expect(waited).toBeLessThan(3500);
  });

  it('are cut at the hello timeout, which frees their address', async () => {
    const h = await host();
    const openedAt = Date.now();
    const quiet = [];
    for (let i = 0; i < 4; i++) quiet.push(await rawUpgrade(h.port, '127.0.0.2'));
    await Promise.all(quiet.map((r) => r.closed));
    const waited = Date.now() - openedAt;
    expect(waited).toBeGreaterThan(9500);
    expect(waited).toBeLessThan(11_500);
    expect((await rawUpgrade(h.port, '127.0.0.2')).status).toBe(101);
  });
});

/** One hello through a connection carrying `headers`; the reason it is denied. */
async function denial(h: RunningHost, headers: Record<string, string>, password = 'wrong-guess'): Promise<string> {
  const c = await connect(h, { headers });
  hello(c, 'guesser', null, password);
  return (await c.next('denied')).reason;
}

describe('password throttle keys', () => {
  it('tells clients behind cloudflared apart by CF-Connecting-IP', async () => {
    const h = await host();
    for (let i = 0; i < 5; i++) expect(await denial(h, { 'cf-connecting-ip': '203.0.113.9' })).toBe('password');
    expect(await denial(h, { 'cf-connecting-ip': '203.0.113.9' }, PASSWORD)).toBe('throttled');
    const friend = await connect(h, { headers: { 'cf-connecting-ip': '203.0.113.10' } });
    hello(friend, 'friend');
    await friend.next('welcome');
  });

  it('gives one relaying peer 30 wrong guesses a minute, however many clients it claims', async () => {
    const h = await host();
    for (let i = 1; i <= 30; i++) expect(await denial(h, { 'cf-connecting-ip': `203.0.113.${i}` })).toBe('password');
    expect(await denial(h, { 'cf-connecting-ip': '203.0.113.31' })).toBe('throttled');
    expect(await denial(h, { 'cf-connecting-ip': '198.51.100.7' }, PASSWORD)).toBe('throttled');
  });

  it('ignores X-Forwarded-For, so rotating it buys nothing', async () => {
    const h = await host();
    for (let i = 1; i <= 5; i++) expect(await denial(h, { 'x-forwarded-for': `203.0.113.${i}` })).toBe('password');
    expect(await denial(h, { 'x-forwarded-for': '203.0.113.6' })).toBe('throttled');
  });

  it('counts IPv6 clients by /64', async () => {
    const h = await host();
    for (let i = 1; i <= 5; i++) expect(await denial(h, { 'cf-connecting-ip': `2001:db8:1:2::${i}` })).toBe('password');
    expect(await denial(h, { 'cf-connecting-ip': '2001:db8:1:2:abcd:ef01:2345:6789' })).toBe('throttled');
    expect(await denial(h, { 'cf-connecting-ip': '2001:db8:1:3::1' })).toBe('password');
  });
});
