/**
 * DOM UI root: title screen, HUD (Flags/stock frame, lumber, ritual, hippies, attention,
 * clock, tide/Burn timers, ability bar, drug slots, build keys, C.M.I.), D.E.G.E.N. minimap +
 * roster, Hearth rail, event feed, crosshair/prompt/channel ring, Command View panels (plan
 * tools, priorities, selection orders, build menu), chakra ritual screen, codex (Liber HH),
 * pause/settings, end screen, contextual tutorial hints.
 * Owner: UI agent.
 */
import type { AppApi } from '../game/app';
import type { GameEvent } from '../sim/events';

export class GameUI {
  private root: HTMLElement;
  private app: AppApi;
  private title: HTMLElement;

  constructor(root: HTMLElement, app: AppApi) {
    this.root = root;
    this.app = app;
    this.title = document.createElement('div');
    this.title.className = 'title-screen';
    this.title.innerHTML = '<h1>FLAGHACK ∞</h1><button>Begin the Survey</button>';
    this.title.querySelector('button')!.addEventListener('click', () => app.startMatch());
    root.appendChild(this.title);
  }

  onEvents(events: GameEvent[]): void {}

  update(dt: number): void {
    this.title.style.display = this.app.session.screen === 'title' ? '' : 'none';
  }

  dispose(): void {
    this.root.innerHTML = '';
  }
}
