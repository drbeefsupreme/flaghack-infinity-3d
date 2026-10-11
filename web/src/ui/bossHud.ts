/** Large, authoritative encounter health. This never estimates damage locally. */
import type { World } from '../sim/world';
import { bossAwakeningAge } from '../sim/bossPresentation';
import { el, setAttr, setText, setVar, show } from './dom';
import './bossHud.css';

export class BossHud {
  readonly element: HTMLElement;
  readonly announcement: HTMLElement;
  private readonly name: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement, private readonly timer: HTMLElement, announcementParent: HTMLElement = parent) {
    // Reuse the clock's actual plaque frame, rather than approximating its border.
    this.element = el('section', 'boss-hud plaque is-off', parent);
    this.element.setAttribute('aria-hidden', 'true');
    const title = el('div', 'boss-hud-title', this.element);
    this.name = el('span', 'boss-hud-name', title);
    this.value = el('span', 'boss-hud-value num', title);
    const bar = el('div', 'boss-hud-bar', this.element);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    this.fill = el('i', 'boss-hud-fill', bar);
    this.status = el('div', 'boss-hud-status', this.element);
    // Kept out of the queued, wall-clock banners: late joins and paused worlds must
    // see exactly the same remaining awakening window as the eruption renderer.
    this.announcement = el('div', 'boss-awakening plaque is-off', announcementParent);
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-live', 'assertive');
    this.announcement.setAttribute('aria-atomic', 'true');
    this.announcement.setAttribute('aria-hidden', 'true');
  }

  update(world: World | null, visible: boolean): void {
    const boss = world?.boss;
    const active = visible && !!boss && boss.action !== 'dead';
    const awakening = active && !!world && bossAwakeningAge(world) !== null;
    show(this.announcement, awakening);
    setAttr(this.announcement, 'aria-hidden', String(!awakening));
    setText(this.announcement, awakening ? 'HE IS AWAKENED' : '');
    show(this.element, active);
    setAttr(this.element, 'aria-hidden', String(!active));
    setAttr(this.element, 'aria-label', active ? 'Effigy boss' : '');
    setAttr(this.fill.parentElement!, 'aria-label', active ? 'Effigy health' : '');
    setText(this.name, active ? 'THE EFFIGY' : '');
    // Run before every early return so leaving/restarting a match cannot strand the clock.
    show(this.timer, !active);
    if (!active || !boss) {
      setText(this.value, '');
      setText(this.status, '');
      return;
    }
    const hp = Math.max(0, Math.ceil(boss.hp));
    setVar(this.fill, '--boss-health', String(Math.max(0, Math.min(1, boss.hp / boss.maxHp))));
    setText(this.value, `${hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`);
    setAttr(this.fill.parentElement!, 'aria-valuemax', String(boss.maxHp));
    setAttr(this.fill.parentElement!, 'aria-valuenow', String(hp));
    setText(this.status, boss.deathAt !== null ? 'THE EFFIGY FALLS' : boss.action === 'grab' ? 'IT FEEDS ON FLAGS AND ALTARS' : 'PROTECT YOUR ALTARS · BREAK THE EFFIGY');
    this.element.classList.toggle('boss-hud-dying', boss.deathAt !== null);
  }

  dispose(): void { show(this.timer, true); this.element.remove(); this.announcement.remove(); }
}
