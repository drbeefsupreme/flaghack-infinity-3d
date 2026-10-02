/**
 * Elimination, match end, The Burn (sudden death) timing.
 * Owner: SurveyRules agent.
 */
import type { FactionId } from '../types';
import type { World } from '../world';

export function eliminate(world: World, faction: FactionId, by: FactionId | null): void {}

/** Burn/sudden-death trigger at BURN_TIME and winner detection (one faction with Hearths left). */
export function updateVictory(world: World, dt: number): void {}
