/**
 * Shared contracts between the UI orchestrator (ui.ts) and its parts. Parts never touch the
 * DOM from onEvent: events only update part state; the DOM is written in update(), which
 * the orchestrator calls at ~10 Hz.
 */
import type { AppApi } from '../game/app';
import type { GameEvent, Severity } from '../sim/events';
import type { V2 } from '../sim/math';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';

export type BannerTone = 'epic' | 'good' | 'danger' | 'tide' | 'burn' | 'chakra';

export interface BannerSpec {
  title: string;
  sub?: string;
  tone: BannerTone;
  /** Accent colour (faction css); defaults to Flag yellow. */
  color?: string;
  /** Seconds on screen (default 3). */
  dur?: number;
}

export interface UiHost {
  readonly app: AppApi;
  /** Queue a big centre banner (shown one at a time). */
  banner(b: BannerSpec): void;
  /** Post to the shared event feed (session.feed). */
  post(text: string, severity: Severity, pos?: V2): void;
  /** Flash a world position on the minimap (feed items with a location). */
  flash(pos: V2, color: string): void;
  /** Run a frame-freezing world load (app.startMatch) behind the loading veil. */
  veiledLoad(action: () => void): void;
}

export interface UiPart {
  /** ~10 Hz DOM refresh. `now` is performance.now(). */
  update(world: World | null, now: number): void;
  /** Consume a GameEvent (state only, no DOM). */
  onEvent?(e: GameEvent, world: World): void;
  /** A new World was loaded (player match or title attract). */
  reset?(world: World): void;
  dispose?(): void;
}

/**
 * Screen regions built by the orchestrator. Columns are flex stacks, so panels that appear
 * only in some modes (Command View, roster) push their neighbours instead of overlapping.
 */
export interface UiLayout {
  /** Unzoomed layer in canvas CSS pixels (select box). */
  raw: HTMLElement;
  colLeft: HTMLElement;
  colRight: HTMLElement;
  topCenter: HTMLElement;
  center: HTMLElement;
  bottomCenter: HTMLElement;
  bottomLeft: HTMLElement;
  bottomRight: HTMLElement;
  /** Full-screen modal layer above the HUD (title, chakras, codex, pause, end…). */
  overlay: HTMLElement;
}

/** Faction display name, tolerant of out-of-range ids from partially built worlds. */
export function factionName(world: World, f: FactionId | null): string {
  if (f === null) return 'the Crystal';
  return world.factions[f]?.name ?? 'a rival';
}
