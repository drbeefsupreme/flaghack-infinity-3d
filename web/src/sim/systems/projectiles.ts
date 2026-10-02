/**
 * Thrown Flags: ballistic flight (gravity), collision via CollisionWorld.raycast against
 * walls/buildings/obstacles, stun on hippie hits, landing → plant on nearest plantable node
 * within AVATAR.throwSnapRadius (or loose). Emits flagLanded.
 * Owner: Units agent.
 */
import type { World } from '../world';

export function updateProjectiles(world: World, dt: number): void {}
