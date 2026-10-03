/**
 * Help overlay (F1 / session.panels.help): a compact keymap card. The full keymap and rules
 * live in Liber HH (J).
 */
import type { World } from '../sim/world';
import { KEYMAP } from './catalog';
import { matchScreen } from './core';
import type { UiHost, UiPart } from './core';
import { button, el, escapeHtml, html, show } from './dom';
import { keycaps } from './codex';
import { iconSvg } from './icons';

export class HelpOverlay implements UiPart {
  private host: UiHost;
  private root: HTMLElement;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'help ix is-off', parent);
    const box = el('div', 'help-box frame', this.root);
    const head = el('div', 'modal-head', box);
    el('h2', '', head, 'Field Keys');
    button(
      'panel-x',
      head,
      iconSvg('close'),
      () => {
        this.host.app.session.panels.help = false;
      },
      'back',
    );
    let markup = '';
    for (const g of KEYMAP) {
      markup += `<section><h4>${escapeHtml(g.title)}</h4><dl>`;
      for (const [k, v] of g.keys) markup += `<dt>${keycaps(k)}</dt><dd>${escapeHtml(v)}</dd>`;
      markup += '</dl></section>';
    }
    html('div', 'help-grid', markup, box);
    el('div', 'help-foot', box, 'F1 closes this card · J opens Liber HH for the full rules of the Survey');
  }

  update(_world: World | null, _now: number): void {
    const s = this.host.app.session;
    show(this.root, s.panels.help && matchScreen(s.screen));
  }

  dispose(): void {
    this.root.remove();
  }
}
