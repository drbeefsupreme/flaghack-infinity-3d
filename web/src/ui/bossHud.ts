/** Large, authoritative encounter health. This never estimates damage locally. */
import type { World } from '../sim/world';
import { el, setAttr, setText, setVar, show } from './dom';
import './bossHud.css';

export class BossHud {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el('section', 'boss-hud is-off', parent);
    this.element.setAttribute('aria-label', 'Effigy boss');
    const title = el('div', 'boss-hud-title', this.element);
    el('span', 'boss-hud-name', title, 'THE EFFIGY');
    this.value = el('span', 'boss-hud-value num', title);
    const bar = el('div', 'boss-hud-bar', this.element);
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Effigy health');
    bar.setAttribute('aria-valuemin', '0');
    this.fill = el('i', 'boss-hud-fill', bar);
    this.status = el('div', 'boss-hud-status', this.element);
  }

  update(world: World | null, visible: boolean): void {
    const boss = world?.boss;
    show(this.element, visible && !!boss && boss.action !== 'dead');
    if (!visible || !world || !boss) return;
    const hp = Math.max(0, Math.ceil(boss.hp));
    setVar(this.fill, '--boss-health', String(Math.max(0, Math.min(1, boss.hp / boss.maxHp))));
    setText(this.value, `${hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`);
    setAttr(this.fill.parentElement!, 'aria-valuemax', String(boss.maxHp));
    setAttr(this.fill.parentElement!, 'aria-valuenow', String(hp));
    setText(this.status, boss.deathAt !== null ? 'THE EFFIGY FALLS' : boss.action === 'grab' ? 'IT FEEDS ON FLAGS AND ALTARS' : 'PROTECT YOUR ALTARS · BREAK THE EFFIGY');
    this.element.classList.toggle('boss-hud-dying', boss.deathAt !== null);
  }

  dispose(): void { this.element.remove(); }
}
