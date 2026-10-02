/**
 * Vexillomancer avatars: movement through CollisionWorld (run/sprint/jump/gravity/step),
 * actions (plant, throw, pull channel, staff swing, align/dialectics channels), quiver
 * restock at own Hearth, GCC pushing, KO (Flagless) and respawn, HP regen.
 * Player and AI avatars are identical; both are driven only by these commands.
 * Owner: Units agent.
 */
import type { CommandOf } from '../commands';
import type { Avatar } from '../types';
import type { World } from '../world';

export function cmdAvatarInput(world: World, c: CommandOf<'avatarInput'>): void {
  world.avatarOf(c.faction).input = { ...c.input };
}

export function cmdPlant(world: World, c: CommandOf<'plant'>): void {}

export function cmdThrow(world: World, c: CommandOf<'throw'>): void {}

export function cmdPull(world: World, c: CommandOf<'pull'>): void {}

export function cmdSwing(world: World, c: CommandOf<'swing'>): void {}

export function cmdPushGcc(world: World, c: CommandOf<'pushGcc'>): void {}

export function updateAvatars(world: World, dt: number): void {}

/** True while the avatar is KO'd (Flagless) awaiting respawn. */
export function isAvatarDown(world: World, av: Avatar): boolean {
  return av.koUntil > world.time;
}
