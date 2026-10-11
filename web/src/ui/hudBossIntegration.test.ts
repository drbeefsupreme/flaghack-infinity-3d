import { afterEach, describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { Session } from '../game/session';
import { normalizeMatch, UNLIMITED_DAYS } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import type { UiHost, UiLayout } from './core';
import { HudPart } from './hud';

/** DOM wiring only: the browser remains responsible for CSS/layout. */
class Node {
  className = ''; textContent = ''; innerHTML = ''; children: Node[] = []; parentElement: Node | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { setProperty() {} };
  classList = {
    contains: (key: string) => this.className.split(' ').includes(key),
    toggle: (key: string, on: boolean) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (on) classes.add(key); else classes.delete(key); this.className = [...classes].join(' '); },
  };
  appendChild(node: Node) { node.parentElement = this; this.children.push(node); return node; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  addEventListener() {}
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); }
  find(cls: string): Node | undefined { return this.classList.contains(cls) ? this : this.children.map(n => n.find(cls)).find(Boolean); }
}

function setup(days = 1) {
  vi.stubGlobal('document', { createElement: () => new Node() });
  const session = new Session(); session.screen = 'playing';
  const regions = Object.fromEntries(['raw', 'colLeft', 'colRight', 'topCenter', 'center', 'bottomCenter', 'bottomLeft', 'bottomRight', 'overlay'].map(key => [key, new Node()]));
  const hud = new HudPart({ app: { session } } as UiHost, regions as unknown as UiLayout);
  const world = createMatch({ seed: 'boss-hud-integration', mode: 'standard', difficulty: 'normal', humans: [0], match: normalizeMatch({ days, maxSignifiers: 0 }) });
  const timer = regions.topCenter.find('clock')!, bossBar = regions.topCenter.find('boss-hud')!;
  return { hud, world, session, regions, timer, bossBar };
}
afterEach(() => vi.unstubAllGlobals());

describe('top-center encounter HUD integration', () => {
  it('switches the actual HudPart timer and restores it across death, quit, and consecutive matches', () => {
    const { hud, world, session, timer, bossBar } = setup();
    const check = (boss: boolean) => {
      expect(timer.classList.contains('is-off')).toBe(boss);
      expect(bossBar.classList.contains('is-off')).toBe(!boss);
      expect(timer.classList.contains('plaque')).toBe(true);
      expect(bossBar.classList.contains('plaque')).toBe(true);
    };
    hud.update(world, 0); check(false);
    for (let match = 0; match < 2; match++) {
      world.boss = bossFixture(); hud.update(world, 0); check(true);
      session.screen = 'paused'; hud.update(world, 0); check(true);
      session.screen = 'playing'; world.boss.hp = 0; world.boss.deathAt = world.time; world.boss.action = 'death';
      hud.update(world, 0); check(true);
      world.boss.action = 'dead'; hud.update(world, 0); check(false);
      world.boss = bossFixture(); hud.update(world, 0); check(true);
      session.screen = 'title'; hud.update(world, 0); check(false);
      world.boss = null; session.screen = 'playing'; hud.update(world, 0); check(false);
    }
    hud.dispose();
  });

  it.each([[0, 'Burn · 0:00'], [1, 'Day 1 · 0:00'], [UNLIMITED_DAYS, 'Day 1 · 0:00']] as const)('labels the pre-encounter clock for %s days', (days, label) => {
    const { hud, world, timer } = setup(days);
    hud.update(world, 0); expect(timer.find('clock-t')!.textContent).toBe(label);
    if (days === UNLIMITED_DAYS) {
      world.time = 3 * world.options.match!.dayLength; hud.update(world, 0);
      expect(timer.find('clock-t')!.textContent).toContain('Day 4');
    }
    hud.dispose();
  });
});
