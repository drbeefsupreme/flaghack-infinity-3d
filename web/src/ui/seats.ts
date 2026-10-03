/**
 * Taking over a camp mid-burn (online). A watcher, seatless or with a fallen camp, may take any
 * living camp the rivals' AI is steering: an empty seat, or one whose Signifier is away. The
 * chooser lists those camps (portrait, Hearth stage, Survey, who steers it). Picking one asks to
 * confirm, then net.setSeat(f); the host answers with a fresh match start for the new seat. It
 * refuses silently (the Signifier came back, the camp fell), so a pick that does not land within
 * a few seconds says so and returns to the list.
 */
import { FACTION_DEFS } from '../sim/constants';
import { FACTION_IDS } from '../sim/types';
import type { CaptureStage, FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { STAGE_INFO } from './catalog';
import type { UiHost, UiPart } from './core';
import { button, el, html, setClass, setDisabled, setText, show } from './dom';
import { iconSvg } from './icons';
import { seatPlayer, takeableSeat, watchingOnline } from './online';
import { portraitSvg } from './portraits';
import { worstHearth } from './rail';

/** The host either hands the seat over within a round trip or not at all. */
const PENDING_MS = 4000;

interface SeatRow {
  root: HTMLElement;
  steer: HTMLElement;
  stats: HTMLElement;
  stage: HTMLElement;
  stageKey: CaptureStage | null;
}

export class SeatChooser implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private lede: HTMLElement;
  private list: HTMLElement;
  private rows: SeatRow[] = [];
  private empty: HTMLElement;
  private confirm: HTMLElement;
  private confirmFace: HTMLElement;
  private confirmTitle: HTMLElement;
  private confirmBtn: HTMLButtonElement;
  private note: HTMLElement;
  private active = false;
  /** Camp awaiting confirmation (null: browsing the list). */
  private picked: FactionId | null = null;
  private pickedShown: FactionId | null = null;
  /** Camp asked of the host, and when. */
  private pending: FactionId | null = null;
  private pendingSince = 0;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'modal seats ix is-off', parent);
    const box = el('div', 'modal-box frame seats-box', this.root);
    const head = el('div', 'modal-head', box);
    el('h2', '', head, 'Play a camp');
    button('panel-x', head, iconSvg('close'), () => this.close(), 'back');
    this.lede = el(
      'p',
      'seats-lede',
      box,
      'The rivals\u2019 AI steers these camps. Take one over where it stands: its Hearths, Flags and Signifiers answer to you.',
    );
    this.list = el('div', 'seats-list', box);
    for (const f of FACTION_IDS) this.rows.push(this.row(f));
    this.empty = el('div', 'seats-empty is-off', box, 'Every camp has its Signifier or has fallen. Watch on: a seat may yet free up.');

    this.confirm = el('div', 'seats-confirm is-off', box);
    this.confirmFace = el('div', 'sc-face', this.confirm);
    const text = el('div', 'sc-text', this.confirm);
    this.confirmTitle = el('div', 'sc-title', text, '');
    el('div', 'sc-sub', text, 'You play it from where the AI left it. Its Signifiers keep their orders until you give new ones.');
    const buttons = el('div', 'sc-buttons', this.confirm);
    this.confirmBtn = button('btn btn-primary', buttons, 'Take over', () => this.take(), 'confirm');
    button('btn', buttons, 'Back', () => this.unpick(), 'back');
    this.note = el('div', 'panel-hint seats-note', box, '');
    // Capture phase: Escape closes the chooser before the game hears it (it would open the pause menu).
    window.addEventListener('keydown', this.onKey, true);
  }

  private row(f: FactionId): SeatRow {
    const def = FACTION_DEFS[f];
    const root = el('div', 'seat-row is-off', this.list);
    root.style.setProperty('--fc', def.css);
    html('div', 'sr-face', portraitSvg(f), root);
    const main = el('div', 'sr-main', root);
    el('div', 'sr-name', main, def.name);
    const steer = el('div', 'sr-steer', main, '');
    const stats = el('div', 'sr-stats', main, '');
    const stage = el('span', 'badge sr-stage', root, '');
    button('btn btn-small btn-gold sr-take', root, 'Take over', () => this.pick(f), 'pick');
    return { root, steer, stats, stage, stageKey: null };
  }

  /** Open the list, or with a camp go straight to confirming it. Leaves the pause menu for the burn. */
  open(f: FactionId | null): void {
    const app = this.host.app;
    if (app.session.screen === 'paused') app.setPaused(false);
    this.active = true;
    this.picked = f;
    this.pending = null;
    setText(this.note, '');
    this.update(app.world, performance.now());
  }

  private close(): void {
    this.active = false;
    this.picked = null;
    this.pending = null;
    show(this.root, false);
  }

  private pick(f: FactionId): void {
    this.picked = f;
    setText(this.note, '');
    this.update(this.host.app.world, performance.now());
  }

  private unpick(): void {
    this.picked = null;
    this.pending = null;
    this.update(this.host.app.world, performance.now());
  }

  private take(): void {
    const net = this.host.app.net;
    const f = this.picked;
    if (!net || f === null || this.pending !== null) return;
    this.pending = f;
    this.pendingSince = performance.now();
    net.setSeat(f);
    this.update(this.host.app.world, this.pendingSince);
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (!this.active || ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    if (this.picked !== null && this.pending === null) this.unpick();
    else this.close();
  };

  update(world: World | null, now: number): void {
    const app = this.host.app;
    const net = app.net;
    // Taking a seat ends the watch (the new match start makes this camp ours), and so does any
    // way out of the burn: either way the chooser is done.
    if (!this.active || !world || !net || app.session.screen !== 'playing' || !watchingOnline(app, world)) {
      if (this.active) this.close();
      return;
    }
    show(this.root, true);
    const lobby = net.lobby;
    if (this.pending !== null && now - this.pendingSince > PENDING_MS) {
      const name = FACTION_DEFS[this.pending].name;
      this.pending = null;
      this.picked = null;
      setText(this.note, `The host kept ${name}: its Signifier may be back, or the camp just fell.`);
    }
    if (this.picked !== null && this.pending === null && !takeableSeat(world, lobby, this.picked)) {
      setText(this.note, `${FACTION_DEFS[this.picked].name} is no longer free.`);
      this.picked = null;
    }

    const confirming = this.picked !== null;
    show(this.confirm, confirming);
    show(this.lede, !confirming);
    show(this.list, !confirming);
    if (this.picked !== null) {
      const f = this.picked;
      if (this.pickedShown !== f) {
        this.pickedShown = f;
        this.confirm.style.setProperty('--fc', FACTION_DEFS[f].css);
        this.confirmFace.innerHTML = portraitSvg(f);
      }
      const pending = this.pending !== null;
      setText(this.confirmTitle, pending ? `Taking over ${FACTION_DEFS[f].name}\u2026` : `Take over ${FACTION_DEFS[f].name}'s camp?`);
      setText(this.confirmBtn, pending ? 'Asking the host\u2026' : 'Take over');
      setDisabled(this.confirmBtn, pending);
      setClass(this.confirm, 'pending', pending);
      show(this.empty, false);
      return;
    }

    let free = 0;
    for (const f of FACTION_IDS) {
      const row = this.rows[f];
      const fac = world.factions[f];
      const ok = !!fac && takeableSeat(world, lobby, f);
      show(row.root, ok);
      if (!ok || !fac) continue;
      free++;
      const away = seatPlayer(lobby, f);
      setText(row.steer, away ? `${away.name} is away · the rivals\u2019 AI holds the camp` : 'The rivals\u2019 AI holds it');
      const hearths = fac.hearthIds.length;
      setText(row.stats, `${hearths} ${hearths === 1 ? 'Hearth' : 'Hearths'} · Survey ${world.survey.surveySize[f]} facets`);
      const stage: CaptureStage = worstHearth(world, fac)?.hearth?.stage ?? 'safe';
      if (stage !== row.stageKey) {
        if (row.stageKey) row.stage.classList.remove(`st-${row.stageKey}`);
        row.stage.classList.add(`st-${stage}`);
        row.stageKey = stage;
        setText(row.stage, STAGE_INFO[stage].label);
        row.stage.title = STAGE_INFO[stage].desc;
      }
    }
    show(this.empty, free === 0);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }
}
