/**
 * Pause menu (session.screen 'paused'): Resume, Settings, Liber HH, Quit to title (two-step
 * confirm so a stray click never abandons a Survey), plus a rotating tip.
 */
import type { World } from '../sim/world';
import type { UiHost, UiPart } from './core';
import { button, el, html, setText, show } from './dom';
import { TIPS } from './lore';
import { sigilSvg } from './title';

export class PauseMenu implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private quit: HTMLButtonElement;
  private quitArmed = false;
  private tip: HTMLElement;
  private wasOpen = false;
  private tipIdx = Math.floor(Math.random() * TIPS.length);

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'modal pause ix is-off', parent);
    const box = el('div', 'modal-box frame pause-box', this.root);
    html('div', 'pause-sigil', sigilSvg('sigil'), box);
    el('h2', 'pause-title', box, 'Paused');
    el('div', 'pause-sub', box, 'The Crystal holds its breath.');
    const menu = el('div', 'pause-menu', box);
    button('btn btn-primary', menu, 'Resume', () => this.host.app.setPaused(false));
    button('btn', menu, 'Settings', () => {
      this.host.app.session.panels.settings = true;
    });
    button('btn', menu, 'Liber HH', () => {
      this.host.app.session.panels.codex = true;
    });
    this.quit = button('btn btn-danger', menu, 'Quit to title', () => {
      if (!this.quitArmed) {
        this.quitArmed = true;
        setText(this.quit, 'Abandon this Survey?');
        return;
      }
      this.host.veiledLoad(() => this.host.app.quitToTitle());
    });
    this.tip = el('p', 'pause-tip', box, '');
  }

  update(_world: World | null, _now: number): void {
    const s = this.host.app.session;
    const open = s.screen === 'paused';
    // Settings / codex opened from here cover the menu; it comes back when they close.
    show(this.root, open && !s.panels.settings && !s.panels.codex);
    if (open && !this.wasOpen) {
      this.tipIdx = (this.tipIdx + 1) % TIPS.length;
      setText(this.tip, TIPS[this.tipIdx] ?? '');
      this.quitArmed = false;
      setText(this.quit, 'Quit to title');
    }
    this.wasOpen = open;
  }

  dispose(): void {
    this.root.remove();
  }
}
