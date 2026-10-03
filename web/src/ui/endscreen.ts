/**
 * End screens. Victory (world.winner is the player): FLAGISTAN APPROACHES. Defeat: YOUR SURVEY
 * HAS BEEN OVERWRITTEN, shown the moment the player's camp is eliminated with Spectate / Play
 * again / Title, and again (final) when the match ends. A dawn crowning (victory event reason
 * 'dawn') reads DAWN OVER THE BURN instead, names the dominant Survey and the measure that
 * decided it, and waits for its banner first. All of them list every faction's stats and
 * the match time.
 */
import type { GameEvent } from '../sim/events';
import { dominanceOrder } from '../sim/systems/victory';
import type { FactionId, FactionStats } from '../sim/types';
import type { World } from '../sim/world';
import type { UiHost, UiPart } from './core';
import { DAWN_BANNER_S, factionName } from './core';
import { dawnLead } from './dawn';
import { button, el, escapeHtml, fmtClock, html, setClass, show } from './dom';
import { iconSvg } from './icons';
import { DEFEAT_LINES, VICTORY_LINES } from './lore';
import { sigilSvg } from './title';

type Mode = 'hidden' | 'eliminated' | 'victory' | 'defeat' | 'draw';
/** How the match was won; the victory event's reason, absent meaning conquest. */
type EndReason = 'conquest' | 'dawn';

const ORDINAL: Record<number, string> = { 2: '2nd', 3: '3rd', 4: '4th' };

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
  private reason: EndReason = 'conquest';
  /** performance.now() of the first tick that read screen 'ended' (a dawn crowning holds the cards back). */
  private endedAt = 0;

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
    this.reason = 'conquest';
    this.endedAt = 0;
  }

  onEvent(e: GameEvent, _w: World): void {
    const s = this.host.app.session;
    if (e.t === 'eliminated' && e.faction === s.playerFaction && s.screen !== 'title') {
      this.eliminated = true;
      this.eliminatedBy = e.by;
    }
    if (e.t === 'victory') this.reason = e.reason ?? 'conquest';
  }

  update(world: World | null, now: number): void {
    const s = this.host.app.session;
    let mode: Mode = 'hidden';
    if (world && s.screen === 'ended') {
      if (this.endedAt === 0) this.endedAt = now;
      // A dawn crowning lets its banner play over the live burn before the cards come up.
      const held = this.reason === 'dawn' && now - this.endedAt < DAWN_BANNER_S * 1000;
      if (!held) mode = world.winner === s.playerFaction ? 'victory' : world.winner === null ? 'draw' : 'defeat';
    } else {
      this.endedAt = 0;
      if (world && s.screen === 'playing' && this.eliminated && !this.spectating) mode = 'eliminated';
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
    const dawn = this.reason === 'dawn' && (mode === 'victory' || mode === 'defeat');
    setClass(this.root, 'm-dawn', dawn);
    const pick = (lines: readonly string[]): string => lines[Math.floor(Math.random() * lines.length)] ?? '';
    let title: string;
    let sub: string;
    let verdict = '';
    if (dawn) {
      title = 'DAWN OVER THE BURN';
      sub = win ? 'The Survey is completed. Your Survey stands dominant.' : `${factionName(world, world.winner)}'s Survey stands dominant.`;
      verdict = dawnVerdict(world, P);
    } else if (win) {
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
    if (verdict) el('p', 'end-verdict', this.box, verdict);
    el('div', 'end-time', this.box, `Match time ${fmtClock(world.time)}`);
    html('div', 'end-stats', table, this.box);
    const row = el('div', 'end-buttons', this.box);
    if (mode === 'eliminated') {
      button('btn', row, 'Spectate', () => {
        this.spectating = true;
      });
    }
    button('btn btn-primary', row, 'Play again', () => this.host.veiledLoad(() => this.host.app.startMatch()), 'confirm');
    button('btn', row, 'Title', () => this.host.veiledLoad(() => this.host.app.quitToTitle()), 'back');
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * The line under a dawn crowning: the measure that put the winner above the runner-up (the
 * same wording the Hearth rail's dawn marker used all night), plus the player's placing when
 * the player still stands but lost. dominanceOrder is the rule's own, so this can never
 * disagree with who was crowned.
 */
function dawnVerdict(world: World, player: FactionId): string {
  const order = dominanceOrder(world);
  const line = dawnLead(world, order, player);
  const rank = order.indexOf(player);
  if (!line || rank <= 0) return line;
  return `${line} Your camp still stands, ${ORDINAL[rank + 1] ?? `#${rank + 1}`} of ${order.length}.`;
}
