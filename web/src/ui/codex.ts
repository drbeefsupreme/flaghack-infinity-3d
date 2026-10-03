/**
 * LIBER HH (session.panels.codex, J; also from title and pause): the in-world manual. Tabs:
 * How to Survey, The Crystal, Camp, Rivals, Controls, Quotes. Pages are rendered lazily from
 * the lore/catalog data the first time a tab opens; text is escaped and only **bold** markers
 * become markup.
 */
import { FACTION_DEFS } from '../sim/constants';
import { FACTION_IDS } from '../sim/types';
import type { World } from '../sim/world';
import { KEYMAP } from './catalog';
import type { UiHost, UiPart } from './core';
import { button, el, escapeHtml, html, kbd, richText, setClass, show } from './dom';
import { iconSvg } from './icons';
import { CODEX_CAMP, CODEX_CRYSTAL, CODEX_SURVEY, QUOTES, RIVAL_BIOS } from './lore';
import type { CodexBlock } from './lore';

type TabId = 'survey' | 'crystal' | 'camp' | 'rivals' | 'controls' | 'quotes';

interface TabDef {
  id: TabId;
  title: string;
  numeral: string;
  build: () => string;
}

export function renderBlocks(blocks: readonly CodexBlock[]): string {
  let out = '';
  for (const b of blocks) {
    switch (b.kind) {
      case 'h':
        out += `<h3>${richText(b.text)}</h3>`;
        break;
      case 'p':
        out += `<p>${richText(b.text)}</p>`;
        break;
      case 'list':
        out += `<ul>${b.items.map((i) => `<li>${richText(i)}</li>`).join('')}</ul>`;
        break;
      case 'table':
        out +=
          `<table><thead><tr>${b.head.map((h) => `<th>${richText(h)}</th>`).join('')}</tr></thead>` +
          `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${richText(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        break;
      case 'quote':
        out += `<blockquote><p>“${richText(b.text)}”</p>${b.by ? `<cite>— ${escapeHtml(b.by)}</cite>` : ''}</blockquote>`;
        break;
      case 'canon':
        out += `<aside class="canon"><h4>${richText(b.title)}</h4><p>${richText(b.text)}</p></aside>`;
        break;
    }
  }
  return out;
}

function rivalsPage(): string {
  let out = '<p class="lede">Four vexillomancers, four Hearths, one Survey. Know who you are dealing with.</p>';
  for (const f of FACTION_IDS) {
    const def = FACTION_DEFS[f];
    const bio = RIVAL_BIOS[f];
    out +=
      `<section class="rival" style="--fc:${def.css}">` +
      `<header><span class="rival-sigil"></span><div><h3>${escapeHtml(def.name)}</h3>` +
      `<div class="rival-title">${escapeHtml(bio.epithet)}</div></div>${f === 0 ? '<span class="rival-you">You</span>' : ''}</header>` +
      bio.bio.map((p) => `<p>${richText(p)}</p>`).join('') +
      `<p class="rival-play"><strong>On the burn:</strong> ${richText(bio.playstyle)}</p>` +
      `<blockquote><p>“${richText(bio.quote.text)}”</p>${bio.quote.by ? `<cite>— ${escapeHtml(bio.quote.by)}</cite>` : ''}</blockquote>` +
      `</section>`;
  }
  return out;
}

function controlsPage(): string {
  let out = '<p class="lede">The vexillomancer moves like a raver and builds like a carpenter on a deadline.</p>';
  for (const g of KEYMAP) {
    out += `<h3>${escapeHtml(g.title)}</h3><table class="keys"><tbody>`;
    for (const [k, v] of g.keys) out += `<tr><td>${keycaps(k)}</td><td>${escapeHtml(v)}</td></tr>`;
    out += '</tbody></table>';
  }
  return out;
}

function quotesPage(): string {
  return (
    '<p class="lede">From the Vexillian Scriptures, continuously updated to never be wrong.</p>' +
    QUOTES.map((q) => `<blockquote><p>“${escapeHtml(q.text)}”</p>${q.by ? `<cite>— ${escapeHtml(q.by)}</cite>` : ''}</blockquote>`).join('')
  );
}

/** "W A S D" → four caps; "1 – 5" and "Ctrl+RMB" stay readable. */
export function keycaps(keys: string): string {
  return keys
    .split(' · ')
    .map((part) => (/^[A-Z0-9](?: [A-Z0-9])+$/.test(part) ? part.split(' ').map(kbd).join('') : kbd(part)))
    .join('<span class="kc-or">or</span>');
}

const TABS: readonly TabDef[] = [
  { id: 'survey', title: 'How to Survey', numeral: 'I', build: () => renderBlocks(CODEX_SURVEY) },
  { id: 'crystal', title: 'The Crystal', numeral: 'II', build: () => renderBlocks(CODEX_CRYSTAL) },
  { id: 'camp', title: 'Camp', numeral: 'III', build: () => renderBlocks(CODEX_CAMP) },
  { id: 'rivals', title: 'Rivals', numeral: 'IV', build: rivalsPage },
  { id: 'controls', title: 'Controls', numeral: 'V', build: controlsPage },
  { id: 'quotes', title: 'Quotes', numeral: 'VI', build: quotesPage },
];

export class Codex implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private page: HTMLElement;
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private pages = new Map<TabId, HTMLElement>();
  private tab: TabId = 'survey';
  private shownTab: TabId | null = null;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'modal codex ix is-off', parent);
    const book = el('div', 'modal-box codex-book', this.root);
    const spine = el('nav', 'codex-tabs', book);
    html('div', 'codex-mark', `${iconSvg('book')}<span>LIBER HH</span>`, spine);
    el('div', 'codex-markSub', spine, 'the vexillomantic field manual');
    for (const t of TABS) {
      const b = button(
        'codex-tab',
        spine,
        `<span class="ct-num">${t.numeral}</span><span>${t.title}</span>`,
        () => {
          this.tab = t.id;
        },
        'pick',
      );
      this.tabButtons.set(t.id, b);
    }
    el('div', 'codex-foot', spine, 'Liber HH is continuously updated to never be wrong.');
    const sheet = el('div', 'codex-sheet', book);
    button(
      'panel-x codex-x',
      sheet,
      iconSvg('close'),
      () => {
        this.host.app.session.panels.codex = false;
      },
      'back',
    );
    this.page = el('div', 'codex-page', sheet);
  }

  update(_world: World | null, _now: number): void {
    const open = this.host.app.session.panels.codex;
    show(this.root, open);
    if (!open || this.shownTab === this.tab) return;
    let page = this.pages.get(this.tab);
    if (!page) {
      const def = TABS.find((t) => t.id === this.tab);
      if (!def) return;
      page = el('article', 'codex-article', this.page);
      page.innerHTML = `<h2><span class="ct-num">${def.numeral}</span> ${def.title}</h2>${def.build()}`;
      this.pages.set(this.tab, page);
    }
    for (const [id, p] of this.pages) show(p, id === this.tab);
    for (const [id, b] of this.tabButtons) setClass(b, 'on', id === this.tab);
    this.page.scrollTop = 0;
    this.shownTab = this.tab;
  }

  dispose(): void {
    this.root.remove();
  }
}
