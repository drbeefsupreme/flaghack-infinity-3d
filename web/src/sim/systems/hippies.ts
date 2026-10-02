/**
 * Hippies (Signifiers): job assignment from faction job weights, direct orders, nav-grid
 * movement with separation steering, Survey/Gather/Defend/Raid/Ritual behaviours, attention
 * and distraction, shoving and tearing down pieces, KO/respawn, neutral wandering,
 * following the avatar, SOS response. Status/statusTarget always reflect what they do
 * (shared on the D.E.G.E.N. mesh).
 * Owner: Units agent.
 */
import type { CommandOf } from '../commands';
import type { World } from '../world';

export function cmdOrder(world: World, c: CommandOf<'order'>): void {}

export function cmdRally(world: World, c: CommandOf<'rally'>): void {}

export function cmdSendFollowers(world: World, c: CommandOf<'sendFollowers'>): void {}

export function updateHippies(world: World, dt: number): void {}
