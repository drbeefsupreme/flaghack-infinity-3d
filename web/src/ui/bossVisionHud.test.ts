import { afterEach, expect, it, vi } from 'vitest';
import { Session } from '../game/session';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { spawnBoss } from '../sim/systems/boss';
import { BossVisionHud } from './bossVisionHud';

class Node {
  className = ''; textContent = ''; children: Node[] = []; parentElement: Node | null = null;
  attributes = new Map<string, string>();
  classList = {
    contains: (key: string) => this.className.split(' ').includes(key),
    toggle: (key: string, on: boolean) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (on) classes.add(key); else classes.delete(key); this.className = [...classes].join(' '); },
  };
  appendChild(node: Node) { node.parentElement = this; this.children.push(node); return node; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); }
}
function setup() {
  vi.stubGlobal('document', { createElement: () => new Node() });
  const root = new Node(), hud = new BossVisionHud(root as unknown as HTMLElement), session = new Session();
  const world = createMatch({ seed: 'acid-hud', mode: 'standard', difficulty: 'normal', humans: [0, 1], match: normalizeMatch({ maxSignifiers: 0 }) });
  world.time = 1000; world.effigyRevealedAt = 990; world.factions[0].drugActive.acidcop = 1030;
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.objectiveAltarId = world.hearthOf(3)!.id; boss.target = { kind: 'avatar', id: world.avatarOf(1).id };
  const node = hud.element as unknown as Node, content = (): string => [node.textContent, ...node.attributes.values(), ...node.children.map(n => n.textContent)].join(' ');
  return { world, session, boss, root, hud, node, content };
}
afterEach(() => { vi.unstubAllGlobals(); });

it('creates no spoiler text and clears all visible/accessibility content outside active local intel', () => {
  const e = setup();
  const hidden = () => { expect(e.node.getAttribute('aria-hidden')).toBe('true'); expect(e.node.classList.contains('is-off')).toBe(true); expect(e.content()).not.toMatch(/acid|altar|eye|effigy|tactical|sweep/i); };
  hidden(); e.hud.update(e.world, e.session); hidden();
  e.session.screen = 'playing'; e.hud.update(e.world, e.session);
  expect(e.content()).toContain('ACID COP VISION · 30s'); expect(e.content()).toContain('Chosen altar: President Jaguar');
  expect(e.content()).toContain('Tactical target: Dr. Beelzebub Crow'); expect(e.content()).toContain('Eye: no committed sweep');
  e.world.time = 1030; e.hud.update(e.world, e.session); hidden();
  e.world.time = 1000; e.session.playerFaction = 1; e.hud.update(e.world, e.session); hidden();
  e.session.playerFaction = 0; e.session.spectator = true; e.hud.update(e.world, e.session); hidden();
  e.session.spectator = false; e.boss.hp = 0; e.hud.update(e.world, e.session); hidden();
  e.boss.hp = 50000; e.hud.update(e.world, e.session); expect(e.node.getAttribute('aria-hidden')).toBe('false');
  e.hud.update(null, e.session); hidden(); e.hud.dispose(); expect(e.root.children).toEqual([]);
});

it('explains the committed aim plan separately from actual impacts and clears stale eye text', () => {
  const e = setup(); e.session.screen = 'playing'; e.boss.eye.chargeAt = 1000;
  e.hud.update(e.world, e.session); expect(e.content()).toContain('Eye charging'); expect(e.content()).toContain('committed aim plan');
  e.boss.eye.firedAt = 1003; e.world.time = 1004; e.hud.update(e.world, e.session);
  expect(e.content()).toContain('Eye firing'); expect(e.content()).toContain('White: actual ray / impact');
  e.world.time = 1008; e.hud.update(e.world, e.session); expect(e.content()).toContain('Eye: no committed sweep');
  e.session.screen = 'paused'; e.hud.update(e.world, e.session); expect(e.content()).not.toMatch(/acid|altar|eye|tactical|sweep/i);
  e.hud.dispose();
});
