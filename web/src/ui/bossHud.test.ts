import { afterEach, describe, expect, it, vi } from 'vitest';
import { BossHud } from './bossHud';
import { BOSS_AWAKENING_SECONDS } from '../sim/bossPresentation';
import { bossFixture } from '../../tests/bossFixture';
import { BOSS_TIMING } from '../sim/boss';
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
  const world = { time: 0, phase: 'playing', effigyRevealedAt: null, options: { mode: 'standard' }, boss: { ...bossFixture(), hp: 4300, maxHp: 5000, action: 'idle', deathAt: null } } as unknown as World;
  return { root, timer, hud, world, node: hud.element as unknown as Node, announcement: hud.announcement as unknown as Node };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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

describe('authoritative awakening announcement', () => {
  it('shows the exact announcement only in the five-second reveal window', () => {
    const { hud, world, announcement } = setup();
    const check = (visible: boolean) => {
      expect(announcement.classList.contains('is-off')).toBe(!visible);
      expect(announcement.getAttribute('aria-hidden')).toBe(String(!visible));
      expect(announcement.textContent).toBe(visible ? 'HE IS AWAKENED' : '');
    };
    check(false);
    hud.update(world, true); check(false);
    world.effigyRevealedAt = 90;
    world.time = 89.999; hud.update(world, true); check(false);
    world.time = 90; hud.update(world, true); check(true);
    world.time = 90 + BOSS_AWAKENING_SECONDS - .001; hud.update(world, true); check(true);
    world.time = 90 + BOSS_AWAKENING_SECONDS; hud.update(world, true); check(false);
    world.time = 300; hud.update(world, true); check(false);
  });

  it('keeps a paused announcement stable without replaying DOM or accessible text writes', () => {
    vi.useFakeTimers();
    const { hud, world, root, announcement } = setup();
    world.effigyRevealedAt = 90; world.time = 92;
    hud.update(world, true);
    const setAttribute = vi.spyOn(announcement, 'setAttribute');
    let text = announcement.textContent;
    const writeText = vi.fn((value: string) => { text = value; });
    Object.defineProperty(announcement, 'textContent', { get: () => text, set: writeText });
    for (let frame = 0; frame < 10; frame++) {
      vi.advanceTimersByTime(10_000);
      hud.update(world, true);
    }
    expect(announcement.textContent).toBe('HE IS AWAKENED');
    expect(announcement.classList.contains('is-off')).toBe(false);
    expect(root.children.filter(node => node === announcement)).toHaveLength(1);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    world.time = 95; hud.update(world, true);
    expect(announcement.textContent).toBe('');
    expect(announcement.classList.contains('is-off')).toBe(true);
  });

  it('clears title/reset/dead state without spoilers and handles consecutive matches', () => {
    const { hud, world, announcement, root, timer } = setup();
    const hidden = () => {
      expect(announcement.classList.contains('is-off')).toBe(true);
      expect(announcement.getAttribute('aria-hidden')).toBe('true');
      expect(announcement.textContent).toBe('');
    };
    for (let match = 0; match < 2; match++) {
      world.effigyRevealedAt = 90; world.time = 91; world.boss!.action = 'emerge';
      hud.update(world, true); expect(announcement.textContent).toBe('HE IS AWAKENED');
      hud.update(world, false); hidden();
      hud.update(null, true); hidden();
      world.effigyRevealedAt = null; world.time = 0; hud.update(world, true); hidden();
      world.effigyRevealedAt = 90; world.time = 91; hud.update(world, true);
      world.boss!.action = 'dead'; hud.update(world, true); hidden();
    }
    hud.dispose();
    expect(root.children).toEqual([timer]);
  });
});


describe('compact authoritative attack warning row', () => {
  it.each([
    ['swipe', 'SWIPE · WINDUP', BOSS_TIMING.swipeHit],
    ['stomp', 'STOMP · WINDUP', BOSS_TIMING.stompHit],
    ['grab', 'GRAB · REACHING', BOSS_TIMING.grasp],
  ] as const)('describes %s within the existing status footprint and stops at contact', (action, label, duration) => {
    const { hud, world, node } = setup(), b = world.boss!, status = node.children[2];
    b.action = action; b.held = null; world.time = b.actionAt + duration / 2;
    hud.update(world, true);
    expect(node.children).toHaveLength(3);
    expect(status.textContent).toBe(label);
    expect(status.classList.contains('boss-hud-warning')).toBe(true);
    expect(Number(status.properties.get('--boss-attack-progress'))).toBeCloseTo(.5);
    expect(status.getAttribute('aria-live')).toBe('polite');
    world.time = b.actionAt + duration; hud.update(world, true);
    expect(status.classList.contains('boss-hud-warning')).toBe(false);
    expect(status.properties.get('--boss-attack-progress')).toBe('0');
  });

  it('does not repeat text or progress writes at a frozen simulation time', () => {
    const { hud, world, node } = setup(), status = node.children[2];
    world.boss!.action = 'stomp'; world.time = world.boss!.actionAt + .4; hud.update(world, true);
    const style = vi.spyOn(status.style, 'setProperty'); let text = status.textContent;
    const writeText = vi.fn((value: string) => { text = value; });
    Object.defineProperty(status, 'textContent', { get: () => text, set: writeText });
    for (let frame = 0; frame < 100; frame++) hud.update(world, true);
    expect(style).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
  });

  it('clears warning classes, progress, accessible text and dying styles on cancellation, menus, end or reset', () => {
    const { hud, world, node } = setup(), status = node.children[2];
    const start = () => { world.boss = bossFixture(); world.boss.action = 'stomp'; world.phase = 'playing'; world.time = world.boss.actionAt + .4; hud.update(world, true); };
    const clear = () => { expect(status.classList.contains('boss-hud-warning')).toBe(false); expect(status.properties.get('--boss-attack-progress')).toBe('0'); };
    start(); world.boss!.action = 'recoil'; hud.update(world, true); clear();
    start(); world.phase = 'ended'; hud.update(world, true); clear();
    start(); world.boss!.hp = 0; world.boss!.deathAt = world.time; hud.update(world, true); clear();
    expect(status.textContent).toBe('THE EFFIGY FALLS');
    hud.update(world, false); clear(); expect(status.textContent).toBe(''); expect(node.classList.contains('boss-hud-dying')).toBe(false);
    start(); hud.update(null, true); clear(); expect(status.textContent).toBe('');
    start(); world.boss = null; hud.update(world, true); clear(); expect(status.textContent).toBe('');
  });
});
