/**
 * Hearth rail (left): all four camps, always visible. Colour, name, title, capture-stage
 * badge, per-attacker pressure bars, overwrite countdown, outposts, and a strike-through when
 * a camp is eliminated. Pillar 4: Hearth stage is legible at a glance.
 */
import { FACTION_IDS } from '../sim/types';
import type { Building, CaptureStage } from '../sim/types';
import type { World } from '../sim/world';
import { STAGE_INFO } from './catalog';
import type { UiHost, UiPart } from './core';
import { factionName } from './core';
import { el, setClass, setText, setVar, show } from './dom';

const STAGE_RANK: Record<CaptureStage, number> = {
  safe: 0,
  threatened: 1,
  contested: 2,
  contained: 3,
  overwritten: 4,
  captured: 5,
};

interface Card {
  root: HTMLElement;
  name: HTMLElement;
  badge: HTMLElement;
  stage: CaptureStage | null;
  outposts: HTMLElement;
  bars: HTMLElement[];
  fills: HTMLElement[];
  note: HTMLElement;
}

export class HearthRail implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private cards: Card[] = [];
  private builtFor: World | null = null;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'rail', parent);
    el('div', 'rail-title', this.root, 'Hearths');
  }

  reset(world: World): void {
    for (const c of this.cards) c.root.remove();
    this.cards = [];
    this.builtFor = world;
    const P = this.host.app.session.playerFaction;
    for (const f of world.factions) {
      const root = el('div', 'rail-card', this.root);
      root.style.setProperty('--fc', f.css);
      const top = el('div', 'rc-top', root);
      el('span', 'rc-sigil', top);
      const name = el('span', 'rc-name', top, f.name);
      if (f.id === P && !world.options.allAi) el('span', 'rc-you', top, 'You');
      const badge = el('span', 'badge', top, '');
      el('div', 'rc-title', root, f.title);
      const press = el('div', 'rc-press', root);
      const bars: HTMLElement[] = [];
      const fills: HTMLElement[] = [];
      for (const a of FACTION_IDS) {
        const bar = el('div', 'pbar is-off', press);
        bar.style.setProperty('--ac', world.factions[a]?.css ?? '#fff');
        bar.title = `${factionName(world, a)}'s containment pressure`;
        fills.push(el('i', '', bar));
        bars.push(bar);
      }
      const outposts = el('span', 'rc-out is-off', top, '');
      const note = el('div', 'rc-note is-off', root, '');
      this.cards.push({ root, name, badge, stage: null, outposts, bars, fills, note });
    }
  }

  update(world: World | null, _now: number): void {
    const s = this.host.app.session;
    const visible = s.screen !== 'title' && world !== null;
    show(this.root, visible);
    if (!visible || !world) return;
    if (this.builtFor !== world) this.reset(world);
    for (const f of world.factions) {
      const card = this.cards[f.id];
      if (!card) continue;
      setClass(card.root, 'dead', !f.alive);
      let worst: Building | null = null;
      for (const id of f.hearthIds) {
        const b = world.buildings.get(id);
        if (!b?.hearth) continue;
        if (!worst?.hearth || worstScore(b) > worstScore(worst)) worst = b;
      }
      const stage: CaptureStage = !f.alive ? 'captured' : (worst?.hearth?.stage ?? 'safe');
      if (stage !== card.stage) {
        if (card.stage) card.badge.classList.remove(`st-${card.stage}`);
        card.badge.classList.add(`st-${stage}`);
        card.stage = stage;
      }
      setText(card.badge, f.alive ? STAGE_INFO[stage].label : 'Eliminated');
      card.badge.title = f.alive ? STAGE_INFO[stage].desc : '';
      const outposts = f.hearthIds.length - 1;
      show(card.outposts, f.alive && outposts > 0);
      if (outposts > 0) setText(card.outposts, `+${outposts}`);

      const h = worst?.hearth;
      for (const a of FACTION_IDS) {
        const bar = card.bars[a];
        const p = f.alive && h && a !== f.id ? h.pressure[a] : 0;
        show(bar, p > 0.5);
        if (p > 0.5) setVar(card.fills[a], '--p', (p / 100).toFixed(3));
      }

      let note = '';
      if (!f.alive) {
        note = f.eliminatedBy !== null ? `Overwritten by ${factionName(world, f.eliminatedBy)}` : 'Survey lost';
      } else if (h && stage === 'overwritten' && h.overwriteAt > 0) {
        note = `Overwrite in ${Math.max(0, h.overwriteAt - world.time).toFixed(1)} s`;
      } else if (h && h.attacker !== null && (stage === 'contained' || stage === 'contested')) {
        note = stage === 'contested' ? `Held against ${factionName(world, h.attacker)}` : `Contained by ${factionName(world, h.attacker)}`;
      }
      setText(card.note, note);
      show(card.note, note !== '');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

function worstScore(b: Building): number {
  const h = b.hearth;
  if (!h) return -1;
  let maxP = 0;
  for (const a of FACTION_IDS) maxP = Math.max(maxP, h.pressure[a]);
  return STAGE_RANK[h.stage] * 1000 + maxP;
}
