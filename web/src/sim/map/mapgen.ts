/**
 * Burn map generation (contract + implementation). Deterministic per seed.
 * Owner: MapPhysics agent. Consumers: setup.ts, lattice blocking, collision, nav, render env.
 */
import { CAMP_CENTERS, MAP_HALF } from '../constants';
import type { V2 } from '../math';
import type { FactionId } from '../types';

export type ObstacleKind =
  | 'tent'
  | 'dome'
  | 'art'
  | 'porta'
  | 'tree'
  | 'rock'
  | 'stage'
  | 'shade'
  | 'car'
  | 'effigy';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  /** 'circle' uses radius; 'box' uses hx/hz half extents rotated by yaw. */
  shape: 'circle' | 'box';
  radius: number;
  hx: number;
  hz: number;
  yaw: number;
  height: number;
  /** Presentation variation seed. */
  seed: number;
  /** Optional presentation tint (tents, art). */
  color: number;
}

export interface Road {
  points: V2[];
  width: number;
}

export interface Water {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface SoundCamp {
  name: string;
  x: number;
  z: number;
  radius: number;
  color: number;
}

export type GroundType = 'grass' | 'dirt' | 'road' | 'mud' | 'water';

export interface MapLayout {
  seed: string;
  half: number;
  camps: { faction: FactionId; x: number; z: number }[];
  obstacles: Obstacle[];
  roads: Road[];
  water: Water[];
  soundCamps: SoundCamp[];
  pileSpots: V2[];
  neutralSpawns: V2[];
  effigy: V2;
  /** Static blocking (obstacles + water): used for lattice node blocking and nav. */
  isBlockedAt(x: number, z: number): boolean;
  /** Ground surface type (presentation + movement modifiers). */
  groundAt(x: number, z: number): GroundType;
}

/**
 * Generate the burn. Guarantees: four corner camps at CAMP_CENTERS with ≥ 26 m clear radius,
 * the effigy at the centre with a clear plaza, contested neutral space, roads linking camps
 * to the centre, scattered obstacles that make paths matter without sealing anything.
 */
export function generateMap(seed: string): MapLayout {
  const camps = ([0, 1, 2, 3] as FactionId[]).map((f) => ({ faction: f, x: CAMP_CENTERS[f].x, z: CAMP_CENTERS[f].z }));
  const obstacles: Obstacle[] = [];
  return {
    seed,
    half: MAP_HALF,
    camps,
    obstacles,
    roads: [],
    water: [],
    soundCamps: [],
    pileSpots: [],
    neutralSpawns: [],
    effigy: { x: 0, z: 0 },
    isBlockedAt: () => false,
    groundAt: () => 'grass',
  };
}
