import { afterEach, describe, expect, it, vi } from 'vitest';
import { BossHud } from './bossHud';
import type { World } from '../sim/world';

/** Minimal DOM contract test; actual browser layout is a separate integration check. */
class Node {
  className = ''; textContent = ''; children: Node[] = []; parentElement: Node | null = null;
  attributes = new Map<string, string>(); properties = new Map<string, string>();
  style = { setProperty: (key: string, value: string) => this.properties.set(key, value) };
  classList = {
    contains: (key: string) => this.className.split(' ').includes(key),
    toggle: (key: string, on: boolean) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (on) classes.add(key); else classes.delete(key); this.className = [...classes].join(' '); },
  };
  appendChild(node: Node) { node.parentElement = this; this.children.push(node); return node; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this); }
}
function setup() {
  vi.stubGlobal('document', { createElement: () => new Node() });
  const root = new Node(), timer = new Node(); timer.className = 'clock plaque'; root.appendChild(timer);
  const hud = new BossHud(root as unknown as HTMLElement, timer as unknown as HTMLElement);
  const world = { boss: { hp: 4300, maxHp: 5000, action: 'idle', deathAt: null } } as unknown as World;
  return { root, timer, hud, world, node: hud.element as unknown as Node };
}
afterEach(() => vi.unstubAllGlobals());
describe('boss health HUD state', () => {
  it('is hidden before an encounter, on the title, and after the boss is dead', () => {
    const { hud, world, node } = setup(); expect(node.classList.contains('is-off')).toBe(true);
    hud.update(world, true); expect(node.classList.contains('is-off')).toBe(false);
    hud.update(world, false); expect(node.classList.contains('is-off')).toBe(true);
    hud.update(null, true); expect(node.classList.contains('is-off')).toBe(true);
    world.boss!.action = 'dead'; hud.update(world, true); expect(node.classList.contains('is-off')).toBe(true);
  });
  it('has no creature text or accessible label before reveal or after returning to menus', () => {
    const { hud, world, node } = setup();
    const content = (n: Node): string => [n.textContent, ...n.attributes.values(), ...n.children.map(content)].join(' ');
    const hidden = () => {
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(content(node)).not.toMatch(/boss|effigy|feeds on|protect your altars/i);
    };
    hidden();
    hud.update({ boss: null } as World, true); hidden();
    for (let match = 0; match < 2; match++) {
      hud.update(world, true);
      expect(node.getAttribute('aria-hidden')).toBe('false');
      expect(node.getAttribute('aria-label')).toBe('Effigy boss');
      expect(node.children[1].getAttribute('aria-label')).toBe('Effigy health');
      expect(content(node)).toContain('THE EFFIGY');
      hud.update(world, false); hidden();
      hud.update(null, true); hidden();
    }
  });
  it('shows authoritative health and exposes accessible progress values', () => {
    const { hud, world, node } = setup(); hud.update(world, true);
    const bar = node.children[1], fill = bar.children[0];
    expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.getAttribute('aria-valuenow')).toBe('4300');
    expect(bar.getAttribute('aria-valuemax')).toBe('5000'); expect(fill.properties.get('--boss-health')).toBe(String(4300 / 5000));
    expect(node.children[0].children[1].textContent).toBe('4,300 / 5,000');
    expect(node.classList.contains('plaque')).toBe(true);
  });
  it('keeps the zero-health death state visible until the authoritative dead action', () => {
    const { hud, world, node, root, timer } = setup(); world.boss!.hp = 0; world.boss!.deathAt = 200; world.boss!.action = 'death';
    hud.update(world, true); expect(node.classList.contains('is-off')).toBe(false); expect(node.classList.contains('boss-hud-dying')).toBe(true);
    expect(timer.classList.contains('is-off')).toBe(true);
    expect(node.children[2].textContent).toBe('THE EFFIGY FALLS');
    hud.dispose(); expect(root.children).toEqual([timer]); expect(timer.classList.contains('is-off')).toBe(false);
  });
  it.each([50000, 72500, 1000000])('uses configured maximum %s for the label and fill ratio', maxHp => {
    const { hud, world, node } = setup();
    world.boss!.maxHp = maxHp; world.boss!.hp = maxHp * .75;
    hud.update(world, true);
    const bar = node.children[1];
    expect(bar.getAttribute('aria-valuemax')).toBe(String(maxHp));
    expect(bar.getAttribute('aria-valuenow')).toBe(String(maxHp * .75));
    expect(bar.children[0].properties.get('--boss-health')).toBe('0.75');
    expect(node.children[0].children[1].textContent).toBe(`${(maxHp * .75).toLocaleString()} / ${maxHp.toLocaleString()}`);
  });
  it('replaces the timer only for the encounter and restores it after death, title, or reset', () => {
    const { hud, world, node, timer } = setup();
    const check = (active: boolean) => {
      expect(node.classList.contains('is-off')).toBe(!active);
      expect(timer.classList.contains('is-off')).toBe(active);
    };
    hud.update(null, true); check(false);
    for (let round = 0; round < 3; round++) {
      world.boss!.action = 'emerge'; hud.update(world, true); check(true);
      world.boss!.action = 'idle'; hud.update(world, true); check(true);
      hud.update(world, false); check(false);
      hud.update(world, true); check(true);
      world.boss!.action = 'death'; hud.update(world, true); check(true);
      world.boss!.action = 'dead'; hud.update(world, true); check(false);
      hud.update({ boss: null } as World, true); check(false);
    }
  });
  it('restores the clock when disposed during a live encounter', () => {
    const { hud, world, timer } = setup();
    hud.update(world, true); expect(timer.classList.contains('is-off')).toBe(true);
    hud.dispose(); expect(timer.classList.contains('is-off')).toBe(false);
  });
});
