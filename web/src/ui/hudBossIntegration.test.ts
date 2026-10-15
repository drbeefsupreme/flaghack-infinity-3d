import { afterEach, describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { Session } from '../game/session';
import { SnapshotEncoder } from '../net/codec';
import { NetMirror } from '../net/mirror';
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
  it('keeps the HUD night phase through a long fight and follows the shared death sunrise', () => {
    const { hud, world, timer } = setup(0);
    world.suddenDeath = true; world.effigyRevealedAt = 90; world.boss = bossFixture();
    for (const time of [90, 7200]) { world.time = time; hud.update(world, 0); expect(timer.find('tod-l')!.textContent).toBe('Night'); }
    world.boss.hp = 0; world.boss.deathAt = 7200; world.boss.action = 'death';
    hud.update(world, 0); expect(timer.find('tod-l')!.textContent).toBe('Night');
    world.time = 7208; hud.update(world, 0); expect(timer.find('tod-l')!.textContent).toBe('First light');
    world.time = 7212; world.boss.action = 'dead'; hud.update(world, 0);
    expect(timer.find('tod-l')!.textContent).toBe('Dawn');
    expect(timer.classList.contains('is-off')).toBe(false);
    world.boss = null; world.effigyRevealedAt = null; world.suddenDeath = false; world.time = 0;
    world.options.match!.days = 1; hud.update(world, 0); expect(timer.find('tod-l')!.textContent).toBe('Golden hour');
    hud.dispose();
  });

  it('mounts the awakening in the central HUD and derives late-join/pause/cleanup from replicated state', () => {
    const { hud, world, session, regions } = setup();
    const announcement = regions.center.find('boss-awakening')!;
    expect(announcement).toBeDefined();
    expect(regions.topCenter.find('boss-awakening')).toBeUndefined();
    world.boss = bossFixture(); world.time = 93.5; world.tick = 40; world.effigyRevealedAt = 90;
    const encoder = new SnapshotEncoder(world);
    const late = NetMirror.create(world.options, JSON.parse(JSON.stringify(encoder.full())));
    expect(late.world.drainEvents()).toEqual([]);
    hud.update(late.world, 0);
    expect(announcement.textContent).toBe('HE IS AWAKENED');
    session.screen = 'paused'; hud.update(late.world, 60_000);
    expect(announcement.textContent).toBe('HE IS AWAKENED');
    session.screen = 'playing'; late.world.time = 95; hud.update(late.world, 60_100);
    expect(announcement.textContent).toBe('');
    expect(announcement.classList.contains('is-off')).toBe(true);
    world.time = 180; world.tick++; encoder.delta([]);
    const after = NetMirror.create(world.options, JSON.parse(JSON.stringify(encoder.full())));
    hud.update(after.world, 60_200);
    expect(announcement.textContent).toBe('');
    late.world.time = 94; hud.update(late.world, 60_300);
    expect(announcement.textContent).toBe('HE IS AWAKENED');
    session.screen = 'title'; hud.update(late.world, 60_400);
    expect(announcement.textContent).toBe('');
    expect(announcement.getAttribute('aria-hidden')).toBe('true');
    hud.dispose();
    expect(regions.center.find('boss-awakening')).toBeUndefined();
  });

  it('reconstructs a halfway windup from an event-free snapshot without adding a HUD row', () => {
    const { hud, world, regions, session } = setup();
    world.boss = bossFixture(); world.boss.action = 'stomp'; world.time = world.boss.actionAt + .5;
    const late = NetMirror.create(world.options, JSON.parse(JSON.stringify(new SnapshotEncoder(world).full())));
    expect(late.world.drainEvents()).toEqual([]);
    const status = regions.topCenter.find('boss-hud-status')!;
    hud.update(late.world, 0);
    expect(status.textContent).toBe('STOMP · WINDUP');
    expect(status.classList.contains('boss-hud-warning')).toBe(true);
    session.screen = 'paused'; hud.update(late.world, 60_000);
    expect(status.textContent).toBe('STOMP · WINDUP');
    session.screen = 'playing'; late.world.time = late.world.boss!.actionAt + 1;
    hud.update(late.world, 60_100);
    expect(status.classList.contains('boss-hud-warning')).toBe(false);
    session.screen = 'title'; hud.update(late.world, 60_200);
    expect(status.textContent).toBe('');
    hud.dispose();
  });

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
