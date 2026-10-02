/**
 * D.E.G.E.N. mesh: pings (rally/attack/flag/sos/shot), SOS auto-pings from hurt hippies,
 * Retransmit "TAKE A SHOT", dropped beacon pickup (mesh tap on a rival), expiry.
 * Owner: Units agent.
 */
import type { CommandOf } from '../commands';
import type { Hippie } from '../types';
import type { World } from '../world';

export function cmdPing(world: World, c: CommandOf<'ping'>): void {}

export function cmdRetransmit(world: World, c: CommandOf<'retransmit'>): void {}

export function cmdTapBeacon(world: World, c: CommandOf<'tapBeacon'>): void {}

/** Auto SOS from a hurt hippie (rate-limited by SOS_COOLDOWN). */
export function sosFrom(world: World, h: Hippie): void {}

export function updatePings(world: World, dt: number): void {}
