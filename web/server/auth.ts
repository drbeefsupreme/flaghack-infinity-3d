/**
 * Admission: the host password check, who a connection comes from, and the throttles keyed by it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Where a connection comes from. `address` names the client (logs, the pending-socket cap, the
 * password throttle); `peer` is the socket's other end, which differs only when cloudflared relays
 * the client from this machine.
 */
export interface Origin {
  address: string;
  peer: string;
}

/**
 * The socket peer, unless it is this machine relaying for cloudflared: then the client Cloudflare
 * names in CF-Connecting-IP. No other header is believed (X-Forwarded-For and friends carry
 * whatever the client sent through ssh/bore/playit/ngrok tunnels), and the peer is throttled on
 * its own too, so a forged header buys at most the peer's ceiling.
 */
export function originOf(remoteAddress: string | undefined, cfConnectingIp: string | string[] | undefined): Origin {
  const peer = plainIp(remoteAddress ?? 'unknown');
  const claimed = typeof cfConnectingIp === 'string' ? cfConnectingIp.trim() : '';
  const relayed = (peer === '127.0.0.1' || peer === '::1') && isIP(claimed) !== 0;
  return { address: relayed ? plainIp(claimed) : peer, peer };
}

/**
 * Throttle key of an address: IPv4 as is, IPv6 by its /64 prefix (a subscriber is handed a whole
 * /64, so per-address limits would otherwise hand out a fresh budget per source address).
 */
export function addressKey(ip: string): string {
  const plain = plainIp(ip);
  if (isIP(plain) !== 6) return plain;
  const [head, tail] = plain.split('%')[0].toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // A dotted IPv4 tail after '::' ('64:ff9b::192.0.2.1') fills the last two groups.
  const dotted = right.at(-1)?.includes('.') ? 1 : 0;
  const zeros = tail === undefined ? 0 : Math.max(0, 8 - left.length - right.length - dotted);
  const groups = [...left, ...Array<string>(zeros).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** IPv4-mapped IPv6 ('::ffff:192.0.2.1', how dual-stack sockets report IPv4 peers) as plain IPv4. */
function plainIp(ip: string): string {
  const v4 = ip.slice(7);
  return ip.toLowerCase().startsWith('::ffff:') && isIP(v4) === 4 ? v4 : ip;
}

/**
 * Compares SHA-256 digests of the trimmed passwords with timingSafeEqual: fixed-size digests hide
 * the password's length and the comparison takes the same time wherever the first mismatch is.
 * Trimming forgives the stray space a phone keyboard appends.
 */
export class PasswordGate {
  private readonly digest: Buffer;

  constructor(password: string) {
    this.digest = createHash('sha256').update(password.trim(), 'utf8').digest();
  }

  admits(attempt: string): boolean {
    return timingSafeEqual(this.digest, createHash('sha256').update(attempt.trim(), 'utf8').digest());
  }
}

/**
 * Sliding window of failed password attempts per key (an addressKey): `limit` failures within
 * `windowMs` block that key until the oldest of them ages out.
 */
export class FailureThrottle {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly failures = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  blocked(address: string, now: number): boolean {
    const times = this.failures.get(address);
    if (!times) return false;
    this.prune(times, now);
    return times.length >= this.limit;
  }

  fail(address: string, now: number): void {
    const times = this.failures.get(address);
    if (times) times.push(now);
    else this.failures.set(address, [now]);
  }

  /** Forget addresses whose failures have all aged out (keeps the table from growing). */
  sweep(now: number): void {
    for (const [address, times] of this.failures) {
      this.prune(times, now);
      if (times.length === 0) this.failures.delete(address);
    }
  }

  private prune(times: number[], now: number): void {
    let stale = 0;
    while (stale < times.length && now - times[stale] >= this.windowMs) stale++;
    if (stale > 0) times.splice(0, stale);
  }
}
