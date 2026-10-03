/**
 * Shared contracts between the UI orchestrator (ui.ts) and its parts. Parts never touch the
 * DOM from onEvent: events only update part state; the DOM is written in update(), which
 * the orchestrator calls at ~10 Hz.
 */
import type { AppApi } from '../game/app';
import type { Screen } from '../game/session';
import type { GameEvent, Severity } from '../sim/events';
import type { V2 } from '../sim/math';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import type { TutorialTarget } from '../tutorial/types';

export type BannerTone = 'epic' | 'good' | 'danger' | 'tide' | 'burn' | 'chakra' | 'dawn';

export interface BannerSpec {
  title: string;
  sub?: string;
  tone: BannerTone;
  /** Accent colour (faction css); defaults to Flag yellow. */
  color?: string;
  /** Seconds on screen (default 3). */
  dur?: number;
  /** Match-ending moments: replace whatever is showing and drop the queue. */
  urgent?: boolean;
}

/**
 * Seconds the dawn crowning banner plays over the live burn; the end screen holds back for
 * exactly this long so the banner is seen before the cards come up.
 */
export const DAWN_BANNER_S = 3.6;

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
  /**
   * A blocked action's reason, shown in the feed (repeats of the same reason are throttled).
   * The control must also be marked aria-disabled so it sounds the error blip, not its action.
   */
  blocked(reason: string): void;
  /** Online watchers: open the camp chooser; with a camp, straight to taking it over. */
  chooseSeat(f: FactionId | null): void;
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

/** A match is on screen (HUD, rail, minimap, chat): playing, its pause menu or its end cards. */
export function matchScreen(screen: Screen): boolean {
  return screen === 'playing' || screen === 'paused' || screen === 'ended';
}

/**
 * Display name of a camp: online, the handle of the human holding the seat (`names` =
 * session.playerNames); otherwise the character's name. Tolerant of out-of-range ids from
 * partially built worlds.
 */
export function factionName(world: World, f: FactionId | null, names?: Partial<Record<FactionId, string>>): string {
  if (f === null) return 'the Crystal';
  return names?.[f] ?? world.factions[f]?.name ?? 'a rival';
}

/**
 * Tag an element the Training Burn mentor can point at (`data-tutorial`); the tutorial UI pulses
 * the ids its lesson highlights. Typed against TUTORIAL_TARGETS so the two lists cannot drift.
 */
export function tutorialTarget(node: HTMLElement, id: TutorialTarget): void {
  node.dataset.tutorial = id;
}
