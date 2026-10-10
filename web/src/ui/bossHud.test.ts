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
  const root = new Node(), hud = new BossHud(root as unknown as HTMLElement);
  const world = { boss: { hp: 4300, maxHp: 5000, action: 'idle', deathAt: null } } as unknown as World;
  return { root, hud, world, node: hud.element as unknown as Node };
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
  it('shows authoritative health and exposes accessible progress values', () => {
    const { hud, world, node } = setup(); hud.update(world, true);
    const bar = node.children[1], fill = bar.children[0];
    expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.getAttribute('aria-valuenow')).toBe('4300');
    expect(bar.getAttribute('aria-valuemax')).toBe('5000'); expect(fill.properties.get('--boss-health')).toBe(String(4300 / 5000));
    expect(node.children[0].children[1].textContent).toBe('4,300 / 5,000');
  });
  it('keeps the zero-health death state visible until the authoritative dead action', () => {
    const { hud, world, node, root } = setup(); world.boss!.hp = 0; world.boss!.deathAt = 200; world.boss!.action = 'death';
    hud.update(world, true); expect(node.classList.contains('is-off')).toBe(false); expect(node.classList.contains('boss-hud-dying')).toBe(true);
    expect(node.children[2].textContent).toBe('THE EFFIGY FALLS');
    hud.dispose(); expect(root.children).toHaveLength(0);
  });
});
