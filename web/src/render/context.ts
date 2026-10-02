/**
 * Shared render context handed to every render module. Modules read World/Session and
 * own their three.js objects; they never mutate simulation state.
 */
import type * as THREE from 'three';
import type { Session } from '../game/session';
import type { GameEvent } from '../sim/events';
import type { World } from '../sim/world';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  session: Session;
  quality: 'low' | 'medium' | 'high';
  /** Presentation clock (s), advances with frames (not sim time). */
  time: number;
  /** Normalized direction toward the sun/moon (set by the env module each frame). */
  sunDir: THREE.Vector3;
  /** 1 = full day, 0 = deep night (set by the env module each frame). */
  daylight: number;
  /** Cross-module registry for presentation-only data (documented keys only). */
  shared: SharedRender;
}

/** Documented cross-module presentation hooks. */
export interface SharedRender {
  /** Set by actors: world-space head positions of units by entity id (for VFX/labels). */
  unitAnchors?: Map<number, THREE.Vector3>;
  /** Set by structures: the GCC tabletop map texture size/updates use this canvas/texture. */
  gccTableTexture?: THREE.Texture;
  /** Set by env: sample terrain decoration height (visual only; gameplay ground is y = 0). */
  groundOffset?: (x: number, z: number) => number;
  /** Post-processing drive values, written by the orchestrator, read by post. */
  fx?: PostFxState;
  /** Camera trauma 0..1: VFX adds on impacts/captures; controls applies and decays it. */
  shake?: number;
}

export interface PostFxState {
  /** 0..1 Luminous Dust intensity. */
  dust: number;
  /** 0..1 Acid Cop Vision intensity. */
  acid: number;
  /** 0..1 Saffron glow; crash < 0 desaturates. */
  saffron: number;
  crash: number;
  /** 0..1 recent damage flash. */
  damage: number;
  /** 0..1 Command View blend (parchment/ink grading). */
  command: number;
  /** 0..1 local instability around the camera target. */
  instability: number;
  /** 0..1 white flash (capture, burn). */
  flash: number;
}

export interface RenderModule {
  update(dt: number): void;
  onEvent?(e: GameEvent): void;
  dispose(): void;
}
