/**
 * Core HUD: the ornate "N FLAGS" resource frame (top-left), the clock plaque with time of
 * day, Phason Tide, Burn and (after The Burn) Dawn countdowns (top-centre), the C.M.I. frame
 * (bottom-right), the tool-dependent crosshair with prompt and channel ring, the Command View
 * hint bar, the select box, the spectator pill and the FPS / sim timing overlay.
 */
import {
  AVATAR,
  BURN_TIME,
  DAWN_TIME,
  DAWN_WARNING,
  HIPPIE_AI,
  HOARD_THRESHOLD,
  SUDDEN_DEATH_ESCALATE_EVERY,
  TIDE_INTERVAL,
  TIDE_WARNING,
} from '../sim/constants';
import { isHoarding, popCap } from '../sim/systems/economy';
import { suddenDeathMult } from '../sim/systems/victory';
import type { World } from '../sim/world';
import type { UiHost, UiLayout, UiPart } from './core';
import { button, el, escapeHtml, fmtClock, html, kbd, setAttr, setClass, setText, setVar, show } from './dom';
import { iconSvg } from './icons';
import type { IconName } from './icons';

/** Dusk falls at 6:00 and night at 10:00 (design §14). */
const DUSK_AT = 6 * 60;
const NIGHT_AT = 10 * 60;
/**
 * The night ends on the sky's schedule (render/env/timeOfDay.ts keys): first light, a violet
 * glow, 4 minutes before Dawn; then the sun glows on the horizon through the last minute,
 * the same minute the sim warns "One minute to dawn".
 */
const FIRST_LIGHT_AT = DAWN_TIME - 240;
const SUNRISE_AT = DAWN_TIME - DAWN_WARNING;

type TimeOfDay = 'day' | 'dusk' | 'night' | 'first' | 'dawn';

const TIME_OF_DAY: Record<TimeOfDay, { icon: IconName; label: string }> = {
  day: { icon: 'sun', label: 'Golden hour' },
  dusk: { icon: 'dusk', label: 'Dusk' },
  night: { icon: 'moon', label: 'Night' },
  first: { icon: 'dusk', label: 'First light' },
  dawn: { icon: 'dawn', label: 'Dawn' },
};
const RING_LEN = 2 * Math.PI * 21;

interface ResRow {
  row: HTMLElement;
  val: HTMLElement;
}

export class HudPart implements UiPart {
  private host: UiHost;
  /** Top-level nodes this part added to the shared layout regions (removed on dispose). */
  private nodes: HTMLElement[] = [];
  private flagsN: HTMLElement;
  private quiver: HTMLElement[] = [];
  private stock: ResRow;
  private lumber: ResRow;
  private ritual: ResRow;
  private hippies: ResRow;
  private hoard: HTMLElement;
  private attnBar: HTMLElement;
  private attnVal: HTMLElement;
  private clockT: HTMLElement;
  private todIc: HTMLElement;
  private todPhase: TimeOfDay | null = null;
  private todLabel: HTMLElement;
  private tide: HTMLElement;
  private tideT: HTMLElement;
  private burn: HTMLElement;
  private burnL: HTMLElement;
  private burnT: HTMLElement;
  private dawn: HTMLElement;
  private dawnT: HTMLElement;
  private cmiN: HTMLElement;
  private cross: HTMLElement;
  private prompt: HTMLElement;
  private promptText = '';
  private ring: HTMLElement;
  private hint: HTMLElement;
  private hintText = '';
  private spectate: HTMLElement;
  private selectBox: HTMLElement;

  constructor(host: UiHost, layout: UiLayout) {
    this.host = host;

    // ── Resource frame (homage to the 2017 "20 FLAGS" frame) ──
    const frame = el('div', 'res frame', layout.colLeft);
    const big = el('div', 'res-flags', frame);
    html('span', 'res-flag-ic', iconSvg('flag'), big);
    this.flagsN = el('span', 'res-flags-n num', big, '0');
    el('span', 'res-flags-l', big, 'FLAGS');
    const quiver = el('div', 'quiver', frame);
    for (let i = 0; i < AVATAR.quiver; i++) this.quiver.push(el('i', '', quiver));
    const rows = el('div', 'res-rows', frame);
    const mk = (icon: IconName, label: string): ResRow => {
      const row = el('div', 'res-row', rows);
      html('span', 'res-ic', iconSvg(icon), row);
      el('span', 'res-lbl', row, label);
      const val = el('span', 'res-val num', row, '0');
      return { row, val };
    };
    this.stock = mk('stock', 'Hearth stock');
    this.hoard = el('span', 'res-tag is-off', this.stock.row, 'HOARDING');
    this.hoard.title = `Hoarding is villainy: above ${HOARD_THRESHOLD} Flags in stock your Signifiers lose attention ${Math.round((HIPPIE_AI.hoardDrainMult - 1) * 100)}% faster.`;
    this.lumber = mk('lumber', 'Lumber');
    this.ritual = mk('ritual', 'Ritual');
    this.hippies = mk('hippie', 'Signifiers');
    const attn = el('div', 'attn', frame);
    html('span', 'res-ic', iconSvg('attention'), attn);
    el('span', 'res-lbl', attn, 'Attention');
    const bar = el('div', 'bar', attn);
    this.attnBar = el('i', '', bar);
    this.attnVal = el('span', 'res-val num', attn, '0');

    // ── Clock plaque ──
    const plaque = el('div', 'clock plaque', layout.topCenter);
    const main = el('div', 'clock-main', plaque);
    this.todIc = el('span', 'tod-ic', main);
    this.clockT = el('span', 'clock-t num', main, '0:00');
    this.todLabel = el('span', 'tod-l', main, '');
    const sub = el('div', 'clock-sub', plaque);
    this.tide = el('span', 'chip tide', sub);
    html('span', 'chip-ic', iconSvg('tide'), this.tide);
    el('span', 'chip-l', this.tide, 'Tide');
    this.tideT = el('b', 'num', this.tide, fmtClock(TIDE_INTERVAL));
    this.burn = el('span', 'chip burn', sub);
    html('span', 'chip-ic', iconSvg('burn'), this.burn);
    this.burnL = el('span', 'chip-l', this.burn, 'Burn');
    this.burnT = el('b', 'num', this.burn, fmtClock(BURN_TIME));
    // After The Burn the night runs until Dawn, when the dominant camp is crowned.
    this.dawn = el('span', 'chip dawn is-off', sub);
    html('span', 'chip-ic', iconSvg('dawn'), this.dawn);
    el('span', 'chip-l', this.dawn, 'Dawn');
    this.dawnT = el('b', 'num', this.dawn, fmtClock(DAWN_TIME - BURN_TIME));

    // ── C.M.I. ──
    const cmi = el('div', 'cmi frame', layout.bottomRight);
    el('span', 'cmi-l', cmi, 'C.M.I.');
    this.cmiN = el('span', 'cmi-n num', cmi, '0');
    cmi.title = 'Crystal Manifestation Index: 100 + 10 per 10 s alive for each Crystal you hold, +1 per Survey facet.';

    // ── Crosshair, prompt, channel ring ──
    this.cross = html(
      'div',
      'xh',
      `<svg viewBox="-24 -24 48 48" aria-hidden="true">
        <g class="xh-flag"><path d="M0 -9 L8.56 -2.78 L5.29 7.28 L-5.29 7.28 L-8.56 -2.78 Z"/><circle r="1.6" class="xh-dot"/></g>
        <g class="xh-build"><path d="M-11 -6 V-11 H-6 M6 -11 H11 V-6 M11 6 V11 H6 M-6 11 H-11 V6"/><circle r="1.4" class="xh-dot"/></g>
        <g class="xh-demolish"><path d="M-7 -7 L7 7 M7 -7 L-7 7"/></g>
        <g class="xh-building"><path d="M0 -10 L10 -2 L10 9 L-10 9 L-10 -2 Z"/><circle r="1.4" class="xh-dot"/></g>
        <g class="xh-aim"><circle r="5"/><path d="M0 -12 V-8 M0 8 V12 M-12 0 H-8 M8 0 H12"/></g>
      </svg>`,
      layout.center,
    );
    this.ring = html(
      'div',
      'chan is-off',
      `<svg viewBox="-24 -24 48 48" aria-hidden="true"><circle class="chan-bg" r="21"/><circle class="chan-fg" r="21" stroke-dasharray="${RING_LEN.toFixed(1)}"/></svg>`,
      layout.center,
    );
    this.prompt = el('div', 'prompt is-off', layout.center);
    this.hint = el('div', 'hintbar is-off', layout.bottomCenter);

    // ── Spectator pill (after elimination) ──
    this.spectate = el('div', 'spectate ix is-off', layout.topCenter);
    el('span', 'spectate-l', this.spectate, 'Spectating · your Survey has been overwritten');
    button('btn btn-small', this.spectate, 'Title', () => this.host.veiledLoad(() => this.host.app.quitToTitle()));

    this.selectBox = el('div', 'selbox is-off', layout.raw);
    this.nodes.push(frame, plaque, cmi, this.cross, this.ring, this.prompt, this.hint, this.spectate, this.selectBox);
  }

  update(world: World | null, now: number): void {
    const s = this.host.app.session;
    if (s.screen === 'title' || !world) return;
    const P = s.playerFaction;
    const fac = world.factions[P];
    if (!fac) return;
    const av = world.avatars.get(fac.avatarId);

    setText(this.flagsN, String(av ? av.carried.length : 0));
    const carried = av ? av.carried.length : 0;
    for (let i = 0; i < this.quiver.length; i++) setClass(this.quiver[i], 'on', i < carried);

    const stock = world.stockCount(P);
    setText(this.stock.val, String(stock));
    const hoarding = isHoarding(world, P);
    show(this.hoard, hoarding);
    setClass(this.stock.row, 'warn', hoarding);
    setText(this.lumber.val, String(Math.floor(fac.lumber)));
    setText(this.ritual.val, String(Math.floor(fac.ritual)));

    let n = 0;
    let attnSum = 0;
    let attnN = 0;
    for (const h of world.hippies.values()) {
      if (h.faction !== P) continue;
      n++;
      if (h.status === 'ko') continue;
      attnSum += h.attention;
      attnN++;
    }
    const cap = popCap(world, P);
    setText(this.hippies.val, `${n}/${cap}`);
    setClass(this.hippies.row, 'full', n >= cap);
    const attn = attnN > 0 ? attnSum / attnN : 0;
    setVar(this.attnBar, '--p', (attn / 100).toFixed(3));
    setText(this.attnVal, String(Math.round(attn)));
    setClass(this.attnBar, 'low', attn < 30);

    // Clock, time of day, tide, Burn.
    const t = world.time;
    setText(this.clockT, fmtClock(t));
    const phase: TimeOfDay =
      t >= SUNRISE_AT ? 'dawn' : t >= FIRST_LIGHT_AT ? 'first' : t >= NIGHT_AT ? 'night' : t >= DUSK_AT ? 'dusk' : 'day';
    if (phase !== this.todPhase) {
      this.todPhase = phase;
      const tod = TIME_OF_DAY[phase];
      this.todIc.className = `tod-ic ${phase}`;
      this.todIc.innerHTML = iconSvg(tod.icon);
      setText(this.todLabel, tod.label);
    }
    const toTide = world.tide.nextAt - t;
    setText(this.tideT, fmtClock(Math.ceil(toTide)));
    setClass(this.tide, 'pulse', toTide <= TIDE_WARNING);
    if (world.suddenDeath) {
      // The fire burns hotter every SUDDEN_DEATH_ESCALATE_EVERY s: show the multiplier and the next step.
      setText(this.burnL, `THE BURN ×${suddenDeathMult(world)}`);
      const into = Math.max(0, t - BURN_TIME) % SUDDEN_DEATH_ESCALATE_EVERY;
      setText(this.burnT, fmtClock(Math.ceil(SUDDEN_DEATH_ESCALATE_EVERY - into)));
    } else {
      setText(this.burnL, 'Burn');
      setText(this.burnT, fmtClock(Math.ceil(BURN_TIME - t)));
    }
    setClass(this.burn, 'lit', world.suddenDeath);
    setClass(this.burn, 'soon', !world.suddenDeath && BURN_TIME - t <= 60);
    show(this.dawn, world.suddenDeath);
    if (world.suddenDeath) {
      const toDawn = DAWN_TIME - t;
      setText(this.dawnT, fmtClock(Math.ceil(toDawn)));
      // Pulses through the same last minute the sim announces ("One minute to dawn").
      setClass(this.dawn, 'soon', toDawn <= DAWN_WARNING);
    }

    setText(this.cmiN, String(Math.round(fac.stats.cmi)));

    // Crosshair / prompt / channel ring (action view only; the cursor is the reticle in Command View).
    const alive = !!av && av.koUntil <= t && fac.alive;
    const action = s.screen === 'playing' && s.view === 'action' && s.viewBlend < 0.5;
    show(this.cross, action && alive);
    setAttr(this.cross, 'data-tool', s.aim.active ? 'aim' : s.tool);
    const promptText = action && alive ? (s.prompt ?? '') : '';
    if (promptText !== this.promptText) {
      this.promptText = promptText;
      this.prompt.innerHTML = renderPrompt(promptText);
    }
    show(this.prompt, promptText !== '');
    const chan = s.channel;
    show(this.ring, action && chan >= 0);
    if (chan >= 0) setVar(this.ring, '--p', Math.min(1, chan).toFixed(3));

    const hint = s.screen === 'playing' && s.view === 'command' ? (s.prompt ?? '') : '';
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hint.innerHTML = renderPrompt(hint);
    }
    show(this.hint, hint !== '');

    show(this.spectate, s.screen === 'playing' && !fac.alive);
  }

  /** The drag-select rectangle must track the mouse every frame, so it bypasses the 10 Hz tick. */
  frame(): void {
    const box = this.host.app.session.selectBox;
    show(this.selectBox, box !== null);
    if (!box) return;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    const st = this.selectBox.style;
    st.transform = `translate(${x}px, ${y}px)`;
    st.width = `${Math.abs(box.x1 - box.x0)}px`;
    st.height = `${Math.abs(box.y1 - box.y0)}px`;
  }

  dispose(): void {
    for (const n of this.nodes) n.remove();
  }
}

/**
 * Prompt strings from controls look like "E  Plant Flag" or "E  Command Table   Hold E  Push":
 * runs of 2+ spaces separate key / label pairs. Keys become keycaps; a leading "Hold" stays text.
 */
export function renderPrompt(text: string): string {
  if (!text) return '';
  const parts = text.split(/\s{2,}/);
  if (parts.length < 2) return `<span class="pl">${escapeHtml(text)}</span>`;
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i];
    const label = parts[i + 1] ?? '';
    const hold = /^Hold\s+/i.test(key);
    const cap = hold ? key.replace(/^Hold\s+/i, '') : key;
    out += `<span class="pk">${hold ? '<span class="ph">Hold</span>' : ''}${kbd(cap)}<span class="pl">${escapeHtml(label)}</span></span>`;
  }
  return out;
}

/** Small FPS / sim timing overlay (settings.showFps). */
export class PerfOverlay implements UiPart {
  private host: UiHost;
  private node: HTMLElement;
  private uiMs: () => number;

  constructor(host: UiHost, parent: HTMLElement, uiMs: () => number) {
    this.host = host;
    this.uiMs = uiMs;
    this.node = el('div', 'perf is-off', parent);
  }

  update(_world: World | null, _now: number): void {
    const app = this.host.app;
    const on = app.session.settings.showFps;
    show(this.node, on);
    if (!on) return;
    let simMs = 0;
    let worst = '';
    let worstMs = 0;
    const timings = app.sim?.timings;
    if (timings) {
      for (const key in timings) {
        const ms = timings[key];
        simMs += ms;
        if (ms > worstMs) {
          worstMs = ms;
          worst = key;
        }
      }
    }
    setText(
      this.node,
      `${Math.round(app.fps)} fps · sim ${simMs.toFixed(2)} ms${worst ? ` (${worst} ${worstMs.toFixed(2)})` : ''} · ui ${this.uiMs().toFixed(2)} ms`,
    );
  }

  dispose(): void {
    this.node.remove();
  }
}
