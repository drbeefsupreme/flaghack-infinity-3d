import { describe, expect, it } from 'vitest';
import { addressKey, FailureThrottle, originOf, PasswordGate } from './auth';
import { memorablePassword, PASSWORD_WORDS } from './cli';

describe('PasswordGate', () => {
  it('admits the password, forgiving surrounding whitespace only', () => {
    const gate = new PasswordGate('saffron-pentacle-42');
    expect(gate.admits('saffron-pentacle-42')).toBe(true);
    expect(gate.admits(' saffron-pentacle-42 ')).toBe(true);
    expect(gate.admits('saffron-pentacle-4')).toBe(false);
    expect(gate.admits('Saffron-pentacle-42')).toBe(false);
    expect(gate.admits('')).toBe(false);
  });
});

describe('FailureThrottle', () => {
  it('blocks a key at the limit until its oldest failure leaves the window', () => {
    const t = new FailureThrottle(3, 1000);
    t.fail('a', 0);
    t.fail('a', 100);
    expect(t.blocked('a', 200)).toBe(false);
    t.fail('a', 200);
    expect(t.blocked('a', 300)).toBe(true);
    expect(t.blocked('b', 300)).toBe(false);
    expect(t.blocked('a', 999)).toBe(true);
    expect(t.blocked('a', 1000)).toBe(false);
  });
});

describe('originOf', () => {
  it('believes CF-Connecting-IP only from this machine, and only when it is one address', () => {
    expect(originOf('127.0.0.1', '203.0.113.5')).toEqual({ address: '203.0.113.5', peer: '127.0.0.1' });
    expect(originOf('::1', '2001:db8::7')).toEqual({ address: '2001:db8::7', peer: '::1' });
    expect(originOf('::ffff:127.0.0.1', ' ::ffff:203.0.113.5 ')).toEqual({ address: '203.0.113.5', peer: '127.0.0.1' });
    expect(originOf('192.0.2.8', '203.0.113.5')).toEqual({ address: '192.0.2.8', peer: '192.0.2.8' });
    expect(originOf('127.0.0.2', '203.0.113.5')).toEqual({ address: '127.0.0.2', peer: '127.0.0.2' });
    for (const forged of ['203.0.113.5, 198.51.100.1', 'mallory', '', '203.0.113.5:443']) {
      expect(originOf('127.0.0.1', forged)).toEqual({ address: '127.0.0.1', peer: '127.0.0.1' });
    }
    expect(originOf('127.0.0.1', ['203.0.113.5'])).toEqual({ address: '127.0.0.1', peer: '127.0.0.1' });
    expect(originOf(undefined, undefined)).toEqual({ address: 'unknown', peer: 'unknown' });
  });
});

describe('addressKey', () => {
  it('keeps IPv4 (also IPv4-mapped) and reduces IPv6 to its /64', () => {
    expect(addressKey('192.0.2.8')).toBe('192.0.2.8');
    expect(addressKey('::ffff:192.0.2.8')).toBe('192.0.2.8');
    expect(addressKey('::FFFF:192.0.2.8')).toBe('192.0.2.8');
    for (const ip of ['2001:db8:1:2::1', '2001:0DB8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::', '2001:db8:1:2:3::4']) {
      expect(addressKey(ip)).toBe('2001:db8:1:2::/64');
    }
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(addressKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(addressKey('::')).toBe('0:0:0:0::/64');
    expect(addressKey('unknown')).toBe('unknown');
  });
});

describe('memorablePassword', () => {
  it('draws four distinct words from at least 128 and two digits (over 34 bits)', () => {
    expect(new Set(PASSWORD_WORDS).size).toBe(PASSWORD_WORDS.length);
    expect(PASSWORD_WORDS.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(128);
    for (let i = 0; i < 50; i++) {
      const parts = memorablePassword().split('-');
      expect(parts).toHaveLength(5);
      const words = parts.slice(0, 4);
      expect(new Set(words).size).toBe(4);
      expect(words.every((w) => PASSWORD_WORDS.includes(w))).toBe(true);
      expect(parts[4]).toMatch(/^[1-9]\d$/);
    }
  });
});
