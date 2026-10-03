/** Avatar action helpers shared by the avatar and combat paths. */
import type { Avatar, AvatarAction } from '../../types';
import type { World } from '../../world';

/** The shared idle action (it has no fields, so one immutable instance serves every avatar). */
export const IDLE: AvatarAction = { kind: 'idle' };

/**
 * Cancel an interruptible action (align, channel, pull) and go idle. Units owns interruption,
 * Economy owns completion, so breaking an align emits alignInterrupted here.
 */
export function breakChannel(world: World, av: Avatar): void {
  const a = av.action;
  if (a.kind === 'align') world.emit({ t: 'alignInterrupted', faction: av.faction, chakra: a.chakra });
  if (a.kind === 'align' || a.kind === 'channel' || a.kind === 'pull') av.action = IDLE;
}

/** Aligning a chakra and channelling (Flagellian Dialectics) root the vexillomancer in place. */
export function isRooted(av: Pick<Avatar, 'action'>): boolean {
  return av.action.kind === 'align' || av.action.kind === 'channel';
}
