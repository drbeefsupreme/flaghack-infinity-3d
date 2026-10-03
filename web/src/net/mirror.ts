/**
 * Client-side replicated World. Built from createMatch(options) (static map, lattice, collision,
 * nav) plus the host's full snapshot; then advanced by state frames on a playback clock a little
 * behind the host so remote movement interpolates smoothly. Applying a frame keeps client-side
 * structures in sync (collision/nav for pieces and buildings, lattice flips, survey arrays) and
 * re-emits the frame's GameEvents through world.emit so render/ui/audio consume them unchanged.
 * The client never steps a Simulation on a mirror.
 * Owner: NetCore agent.
 */
import { createMatch } from '../sim/setup';
import type { Avatar, EntityId, MatchOptions } from '../sim/types';
import type { World } from '../sim/world';
import type { FullSnapshot } from './codec';
import type { StateFrame } from './protocol';

/** What client-side prediction needs from the host's latest word on an avatar. */
export type AvatarKinematics = Pick<
  Avatar,
  'pos' | 'vel' | 'yaw' | 'pitch' | 'onGround' | 'koUntil' | 'action' | 'effects' | 'pushing'
>;

export class NetMirror {
  readonly world: World;

  private constructor(world: World) {
    this.world = world;
  }

  static create(options: MatchOptions, snapshot: FullSnapshot): NetMirror {
    const mirror = new NetMirror(createMatch(options));
    void snapshot;
    return mirror;
  }

  /** Queue a received frame (decoded immediately for latestAvatar/latestAck; applied on the playback clock). */
  push(frame: StateFrame): void {}

  /** Once per render frame: apply frames due on the playback clock, then interpolate remote positions. */
  advance(nowMs: number): void {}

  /** The locally predicted avatar (skipped by interpolation; its transform is the predictor's), or null. */
  setPredicted(avatarId: EntityId | null): void {}

  /** Authoritative kinematics of an avatar as of the newest pushed frame, or null if never seen. */
  latestAvatar(id: EntityId): AvatarKinematics | null {
    return null;
  }

  /** Last input seq the host consumed for a player as of the newest pushed frame (0 if none). */
  latestAck(playerId: string): number {
    return 0;
  }
}
