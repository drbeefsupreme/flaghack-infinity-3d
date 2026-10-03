/**
 * End screens. Victory (world.winner is the player): FLAGISTAN APPROACHES. Defeat: YOUR SURVEY
 * HAS BEEN OVERWRITTEN, shown the moment the player's camp is eliminated with Spectate / Play
 * again / Title, and again (final) when the match ends. Both list every faction's stats and
 * the match time.
 */
import type { GameEvent } from '../sim/events';
import type { FactionId, FactionStats } from '../sim/types';
import type { World } from '../sim/world';
import type { UiHost, UiPart } from './core';
import { factionName } from './core';
import { button, el, escapeHtml, fmtClock, html, setClass, show } from './dom';
import { iconSvg } from './icons';
import { DEFEAT_LINES, VICTORY_LINES } from './lore';
import { sigilSvg } from './title';

type Mode = 'hidden' | 'eliminated' | 'victory' | 'defeat' | 'draw';

const STAT_ROWS: readonly (readonly [keyof FactionStats, string])[] = [
  ['flagsPlanted', 'Flags planted'],
  ['flagsPulled', 'Flags pulled'],
  ['flagsStolen', 'Flags stolen'],
  ['facetsPeak', 'Peak Survey (facets)'],
  ['crystalsManifested', 'Crystals manifested'],
  ['captures', 'Hearths captured'],
  ['hippiesRecruited', 'Signifiers recruited'],
  ['cmi', 'C.M.I.'],
];

export class EndScreen implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private box: HTMLElement;
  private mode: Mode = 'hidden';
  private eliminatedBy: FactionId | null = null;
  private eliminated = false;
  private spectating = false;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'modal endscreen ix is-off', parent);
    this.box = el('div', 'modal-box end-box', this.root);
  }

  reset(_world: World): void {
    this.mode = 'hidden';
    this.eliminated = false;
    this.eliminatedBy = null;
    this.spectating = false;
  }

  onEvent(e: GameEvent, _w: World): void {
    const s = this.host.app.session;
    if (e.t === 'eliminated' && e.faction === s.playerFaction && s.screen !== 'title') {
      this.eliminated = true;
      this.eliminatedBy = e.by;
    }
  }

  update(world: World | null, _now: number): void {
    const s = this.host.app.session;
    let mode: Mode = 'hidden';
    if (world && s.screen === 'ended') {
      mode = world.winner === s.playerFaction ? 'victory' : world.winner === null ? 'draw' : 'defeat';
    } else if (world && s.screen === 'playing' && this.eliminated && !this.spectating) {
      mode = 'eliminated';
    }
    show(this.root, mode !== 'hidden' && !s.panels.codex && !s.panels.settings);
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'hidden' || !world) return;
    this.render(world, mode);
  }

  private render(world: World, mode: Exclude<Mode, 'hidden'>): void {
    const s = this.host.app.session;
    const P = s.playerFaction;
    const win = mode === 'victory';
    for (const m of ['victory', 'defeat', 'eliminated', 'draw']) setClass(this.root, `m-${m}`, m === mode);
    const pick = (lines: readonly string[]): string => lines[Math.floor(Math.random() * lines.length)] ?? '';
    let title: string;
    let sub: string;
    if (win) {
      title = 'FLAGISTAN APPROACHES';
      sub = pick(VICTORY_LINES);
    } else if (mode === 'draw') {
      title = 'THE SURVEY IS UNFINISHED';
      sub = 'No Hearth stands. The Crystal keeps its own counsel.';
    } else {
      title = 'YOUR SURVEY HAS BEEN OVERWRITTEN';
      const by = mode === 'eliminated' ? this.eliminatedBy : world.winner;
      sub =
        mode === 'eliminated'
          ? `${by !== null ? `Overwritten by ${factionName(world, by)}. ` : ''}${pick(DEFEAT_LINES)}`
          : `${world.winner !== null ? `${factionName(world, world.winner)} holds the last Hearth. ` : ''}${pick(DEFEAT_LINES)}`;
    }

    const order: FactionId[] = [P, ...world.factions.map((f) => f.id).filter((id) => id !== P)];
    const best = new Map<keyof FactionStats, number>();
    for (const [key] of STAT_ROWS) best.set(key, Math.max(...order.map((f) => world.factions[f]?.stats[key] ?? 0)));
    let table = '<table class="stats"><thead><tr><th></th>';
    for (const f of order) {
      const fac = world.factions[f];
      if (!fac) continue;
      const crown = world.winner === f ? iconSvg('star', 'crown') : '';
      const fate = fac.alive ? '' : `<span class="fate">out ${fac.eliminatedAt !== null ? fmtClock(fac.eliminatedAt) : ''}</span>`;
      table += `<th style="--fc:${fac.css}" class="${fac.alive ? '' : 'dead'} ${f === P ? 'you' : ''}">${crown}<span class="who">${escapeHtml(fac.name)}</span>${fate}</th>`;
    }
    table += '</tr></thead><tbody>';
    for (const [key, label] of STAT_ROWS) {
      table += `<tr><td class="stat-l">${label}</td>`;
      for (const f of order) {
        const v = Math.round(world.factions[f]?.stats[key] ?? 0);
        table += `<td class="num${v > 0 && v === best.get(key) ? ' best' : ''}">${v}</td>`;
      }
      table += '</tr>';
    }
    table += '</tbody></table>';

    this.box.innerHTML = '';
    html('div', 'end-sigil', sigilSvg(win ? 'sigil spin' : 'sigil'), this.box);
    el('h1', 'end-title', this.box, title);
    el('p', 'end-sub', this.box, sub);
    el('div', 'end-time', this.box, `Match time ${fmtClock(world.time)}`);
    html('div', 'end-stats', table, this.box);
    const row = el('div', 'end-buttons', this.box);
    if (mode === 'eliminated') {
      button('btn', row, 'Spectate', () => {
        this.spectating = true;
      });
    }
    button('btn btn-primary', row, 'Play again', () => this.host.veiledLoad(() => this.host.app.startMatch()));
    button('btn', row, 'Title', () => this.host.app.quitToTitle());
  }

  dispose(): void {
    this.root.remove();
  }
}
