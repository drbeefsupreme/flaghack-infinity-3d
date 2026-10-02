/**
 * Hearth capture state machine (safe → threatened → contained → contested → overwritten →
 * captured), per-attacker pressure with modifiers, and ownership conversion on capture.
 * Owner: SurveyRules agent.
 */
import type { Building, FactionId } from '../types';
import type { World } from '../world';

export function updateCapture(world: World, dt: number): void {}

/**
 * Convert a Hearth to `to`: outpost Hearth for the captor, loser's buildings become the
 * captor's (disabled), loser's planted Flags neutral, hippies neutral, GCC destroyed, and
 * the loser eliminated if it has no Hearths left. Emits captured (+ eliminated).
 */
export function captureHearth(world: World, hearth: Building, to: FactionId): void {}
