/**
 * Title screen (session.screen 'title'): the attract match plays behind a left-hand column
 * with the five-Flag pinwheel sigil, the FLAGHACK ∞ logo, rotating scripture, the menu (Begin
 * the Survey, difficulty, Liber HH, Settings) and the diegetic footer.
 */
import type { World } from '../sim/world';
import { DIFFICULTIES, DIFFICULTY_INFO } from './catalog';
import type { UiHost, UiPart } from './core';
import { button, el, html, setClass, setText, show } from './dom';
import { QUOTES } from './lore';

const QUOTE_MS = 8000;
const FADE_MS = 650;

/** The GCC side-panel sigil: five yellow Flags pinwheeling around a red ley pentagram. */
export function sigilSvg(cls: string): string {
  let flags = '';
  for (let i = 0; i < 5; i++) {
    flags +=
      `<g transform="rotate(${i * 72})">` +
      `<path class="sg-pole" d="M0 -16 V-54"/>` +
      `<path class="sg-cloth" d="M1 -54 C9 -57 15 -49 26 -52 V-39 C15 -36 9 -44 1 -41 Z"/>` +
      `<circle class="sg-finial" cy="-55.5" r="2.2"/></g>`;
  }
  const star: string[] = [];
  for (const i of [0, 2, 4, 1, 3]) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    star.push(`${(Math.cos(a) * 15).toFixed(2)} ${(Math.sin(a) * 15).toFixed(2)}`);
  }
  return (
    `<svg class="${cls}" viewBox="-64 -64 128 128" aria-hidden="true">` +
    `<circle class="sg-ring" r="18.5"/><path class="sg-star" d="M${star.join(' L')} Z"/>${flags}</svg>`
  );
}

export class TitleScreen implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private quote: HTMLElement;
  private quoteText: HTMLElement;
  private quoteBy: HTMLElement;
  private quoteIdx = 0;
  private nextQuoteAt = 0;
  private fadingSince = 0;
  private diffButtons = new Map<string, HTMLButtonElement>();
  private diffDesc: HTMLElement;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'title ix', parent);
    el('div', 'title-shade', this.root);
    const col = el('div', 'title-col', this.root);
    html('div', 'title-sigil', sigilSvg('sigil spin'), col);
    html('h1', 'logo', 'FLAGHACK <span class="inf">∞</span>', col);
    el('div', 'subtitle', col, 'SURVEY FLAGS');

    this.quote = el('blockquote', 'quote', col);
    this.quoteText = el('p', 'quote-text', this.quote);
    this.quoteBy = el('cite', 'quote-by', this.quote);
    this.quoteIdx = Math.floor(Math.random() * QUOTES.length);
    this.showQuote();

    const menu = el('div', 'menu frame', col);
    const s = host.app.session;
    button('btn btn-primary btn-begin', menu, 'Begin the Survey', () => {
      this.host.veiledLoad(() => this.host.app.startMatch());
    });
    const diff = el('div', 'diff', menu);
    el('div', 'diff-label', diff, 'Rival difficulty');
    const seg = el('div', 'seg', diff);
    for (const d of DIFFICULTIES) {
      const b = button('seg-btn', seg, DIFFICULTY_INFO[d].name, () => {
        s.settings.difficulty = d;
      });
      this.diffButtons.set(d, b);
    }
    this.diffDesc = el('div', 'diff-desc', diff, '');
    const row = el('div', 'menu-row', menu);
    button('btn', row, 'Liber HH', () => {
      s.panels.codex = true;
    });
    button('btn', row, 'Settings', () => {
      s.panels.settings = true;
    });

    const foot = el('footer', 'title-foot', this.root);
    el('div', 'transmission', foot, 'A transmission from the Geomantic Command Center');
    el('div', 'warning-label', foot, 'Under no conditions should you attempt to play a game that claims to be Flaghack.');
  }

  private showQuote(): void {
    const q = QUOTES[this.quoteIdx % QUOTES.length];
    setText(this.quoteText, `“${q.text}”`);
    setText(this.quoteBy, q.by ? `— ${q.by}` : '');
  }

  update(_world: World | null, now: number): void {
    const s = this.host.app.session;
    const visible = s.screen === 'title';
    show(this.root, visible);
    if (!visible) return;
    // Panels opened from the title (codex/settings) sit above it; keep the menu out of the way.
    setClass(this.root, 'dimmed', s.panels.codex || s.panels.settings);
    for (const [d, b] of this.diffButtons) setClass(b, 'on', s.settings.difficulty === d);
    setText(this.diffDesc, DIFFICULTY_INFO[s.settings.difficulty].desc);

    if (this.nextQuoteAt === 0) this.nextQuoteAt = now + QUOTE_MS;
    if (this.fadingSince === 0 && now >= this.nextQuoteAt) {
      this.fadingSince = now;
      setClass(this.quote, 'fade', true);
    } else if (this.fadingSince > 0 && now - this.fadingSince >= FADE_MS) {
      this.quoteIdx++;
      this.showQuote();
      setClass(this.quote, 'fade', false);
      this.fadingSince = 0;
      this.nextQuoteAt = now + QUOTE_MS;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
