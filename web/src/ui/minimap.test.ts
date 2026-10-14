import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../game/session';
import { MAP_HALF } from '../sim/constants';
import { spawnHippie, spawnPing } from '../sim/factory';
import { createMatch } from '../sim/setup';
import type { V2 } from '../sim/math';
import { STATUS_INFO, TONE_COLOR } from './catalog';
import type { UiHost } from './core';
import { Minimap } from './minimap';

type Path = { kind: string; args: number[] }[];
interface DrawCall {
  kind: string;
  args?: number[];
  path?: Path;
  color?: unknown;
  alpha?: number;
  width?: number;
  dash?: number[];
}

/** Record the actual canvas paint commands, including the style and path at paint time. */
class RecordingContext {
  calls: DrawCall[] = [];
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  private path: Path = [];
  private dash: number[] = [];
  private stack: ReturnType<RecordingContext['state']>[] = [];

  private state() {
    return {
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha,
      lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, dash: [...this.dash],
    };
  }
  save() { this.stack.push(this.state()); }
  restore() { Object.assign(this, this.stack.pop()); }
  beginPath() { this.path = []; }
  closePath() { this.path.push({ kind: 'closePath', args: [] }); }
  moveTo(...args: number[]) { this.path.push({ kind: 'moveTo', args }); }
  lineTo(...args: number[]) { this.path.push({ kind: 'lineTo', args }); }
  arc(...args: number[]) { this.path.push({ kind: 'arc', args }); }
  ellipse(...args: number[]) { this.path.push({ kind: 'ellipse', args }); }
  clip() { this.calls.push({ kind: 'clip', path: [...this.path] }); }
  setLineDash(dash: number[]) { this.dash = [...dash]; }
  clearRect(...args: number[]) { this.calls.push({ kind: 'clearRect', args }); }
  fill() {
    this.calls.push({ kind: 'fill', path: [...this.path], color: this.fillStyle, alpha: this.globalAlpha });
  }
  stroke() {
    this.calls.push({
      kind: 'stroke', path: [...this.path], color: this.strokeStyle,
      alpha: this.globalAlpha, width: this.lineWidth, dash: [...this.dash],
    });
  }
  fillRect(...args: number[]) {
    this.calls.push({ kind: 'fillRect', args, color: this.fillStyle, alpha: this.globalAlpha });
  }
  strokeRect(...args: number[]) {
    this.calls.push({
      kind: 'strokeRect', args, color: this.strokeStyle,
      alpha: this.globalAlpha, width: this.lineWidth, dash: [...this.dash],
    });
  }
  drawImage(canvas: Node, ...args: number[]) {
    this.calls.push({ kind: 'drawImage', args: [canvas.canvasId, ...args] });
  }
  createRadialGradient(...args: number[]) {
    const stops: [number, string][] = [];
    return { args, stops, addColorStop: (offset: number, color: string) => { stops.push([offset, color]); } };
  }
}

/** Minimal DOM contract for the real Minimap constructor; no renderer methods are mocked. */
class Node {
  className = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: Node[] = [];
  parentElement: Node | null = null;
  width = 0;
  height = 0;
  readonly context = new RecordingContext();
  constructor(readonly canvasId = -1) {}
  appendChild(node: Node) { node.parentElement = this; this.children.push(node); return node; }
  insertAdjacentHTML() {}
  addEventListener() {}
  getContext() { return this.context; }
  getBoundingClientRect() { return { width: 248, height: 248, left: 0, top: 0 }; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
  }
}

function setup() {
  const canvases: Node[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const node = new Node(tag === 'canvas' ? canvases.length : -1);
      if (tag === 'canvas') canvases.push(node);
      return node;
    },
  });
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} });
  const session = new Session();
  session.screen = 'playing';
  const world = createMatch({ seed: 'minimap-marked-nodes', mode: 'standard', difficulty: 'normal', humans: [0] });
  world.time = 100;
  for (const faction of world.factions) faction.plan.clear();
  const root = new Node();
  const host = { app: { session, world } } as unknown as UiHost;
  const minimap = new Minimap(host, root as unknown as HTMLElement);
  const render = () => {
    // Force every real layer to redraw, so the comparison catches marks in cached layers too.
    minimap.reset(world);
    for (const canvas of canvases) canvas.context.calls.length = 0;
    minimap.draw(world, 1000);
    // Gradients carry a method, which is irrelevant to the recorded paint result.
    return JSON.parse(JSON.stringify(canvases.map(canvas => canvas.context.calls))) as DrawCall[][];
  };
  return { session, world, minimap, render, survey: canvases[1].context, live: canvases[2].context };
}

function paintsArc(calls: DrawCall[], kind: 'fill' | 'stroke', at: V2, radius: number, color: string): boolean {
  const r = 248 / (2 * Math.sin(72 * Math.PI / 180));
  const cy = (248 - r * (1 + Math.cos(Math.PI / 5))) / 2 + r;
  const x = 124 + at.x / MAP_HALF * r * 0.8;
  const y = cy + at.z / MAP_HALF * r * 0.8;
  return calls.some(call => call.kind === kind && call.color === color && call.path?.some(command =>
    command.kind === 'arc' && Math.abs(command.args[0] - x) < 1e-8 &&
    Math.abs(command.args[1] - y) < 1e-8 && Math.abs(command.args[2] - radius) < 1e-8));
}

afterEach(() => vi.unstubAllGlobals());

describe.each(['action', 'command'] as const)('minimap marked nodes in %s view', view => {
  it.each(['own', 'rival', 'tapped rival', 'Acid Cop Vision rival'] as const)(
    'does not change any painted layer for %s plan additions, replacements, or removal', intel => {
      const { session, world, minimap, render } = setup();
      session.view = view;
      const owner = intel === 'own' ? world.factions[0] : world.factions[1];
      if (intel === 'tapped rival') world.factions[0].meshTap[1] = world.time + 30;
      if (intel === 'Acid Cop Vision rival') world.factions[0].drugActive.acidcop = world.time + 30;
      const free = world.lattice.nodes.filter(node => world.survey.nodeFlagOwner[node.id] < 0).slice(0, 3);
      expect(free).toHaveLength(3);
      const baseline = render();
      expect(baseline[2].some(call => call.kind === 'drawImage')).toBe(true);
      owner.plan.add(free[0].id);
      owner.plan.add(free[1].id);
      expect(render()).toEqual(baseline);
      owner.plan.clear();
      owner.plan.add(free[2].id);
      expect(render()).toEqual(baseline);
      owner.plan.clear();
      expect(render()).toEqual(baseline);
      minimap.dispose();
    },
  );
});

describe('minimap layers retained without plan marks', () => {
  it('still paints own and rival planted Flags and implied Flags, even when those nodes are marked', () => {
    const { world, minimap, render, survey } = setup();
    const planted = [0, 1].map(faction => world.lattice.nodes.find(node => world.survey.nodeFlagOwner[node.id] === faction)!);
    const implied = world.lattice.nodes.find(node => world.survey.nodeFlag[node.id] < 0)!;
    world.survey.impliedOwner[implied.id] = 0;
    world.factions[0].plan.add(implied.id);
    planted.forEach((node, faction) => world.factions[faction].plan.add(node.id));
    render();
    planted.forEach((node, faction) => {
      expect(paintsArc(survey.calls, 'fill', node, 2.4, world.factions[faction].css)).toBe(true);
      expect(paintsArc(survey.calls, 'fill', node, 1.5, '#ffd400')).toBe(true);
    });
    expect(paintsArc(survey.calls, 'stroke', implied, 1.6, 'rgba(255, 212, 0, 0.7)')).toBe(true);
    minimap.dispose();
  });

  it('still paints active own pings while excluding rival and expired pings', () => {
    const { world, minimap, render, live } = setup();
    const own = spawnPing(world, 'flag', 0, { x: 10, z: 20 }, -1);
    const rival = spawnPing(world, 'attack', 1, { x: 30, z: 40 }, -1);
    const expired = spawnPing(world, 'sos', 0, { x: 50, z: 60 }, -1);
    expired.until = world.time;
    render();
    expect(paintsArc(live.calls, 'fill', own.pos, 2.2, '#ffd400')).toBe(true);
    expect(paintsArc(live.calls, 'stroke', own.pos, 3, '#ffd400')).toBe(true);
    expect(paintsArc(live.calls, 'fill', rival.pos, 2.2, '#ff4058')).toBe(false);
    expect(paintsArc(live.calls, 'fill', expired.pos, 2.2, '#ff2b2b')).toBe(false);
    own.until = world.time;
    render();
    expect(paintsArc(live.calls, 'fill', own.pos, 2.2, '#ffd400')).toBe(false);
    minimap.dispose();
  });

  it('preserves own beacon visibility and reveals rival Signifiers only while tapped or on Acid', () => {
    const { world, minimap, render, live } = setup();
    world.hippies.clear();
    const own = spawnHippie(world, 0, { x: 10, z: 20 });
    const unlinked = spawnHippie(world, 0, { x: 30, z: 40 });
    unlinked.beacon = false;
    const rival = spawnHippie(world, 1, { x: 50, z: 60 });
    const ownColor = TONE_COLOR[STATUS_INFO[own.status].tone];
    const rivalVisible = () => paintsArc(live.calls, 'fill', rival.pos, 1.8, world.factions[1].css);
    render();
    expect(paintsArc(live.calls, 'fill', own.pos, 2.1, ownColor)).toBe(true);
    expect(paintsArc(live.calls, 'fill', unlinked.pos, 2.1, ownColor)).toBe(false);
    expect(rivalVisible()).toBe(false);
    world.factions[0].meshTap[1] = world.time + 30;
    render(); expect(rivalVisible()).toBe(true);
    world.factions[0].meshTap[1] = world.time;
    render(); expect(rivalVisible()).toBe(false);
    world.factions[0].drugActive.acidcop = world.time + 30;
    render(); expect(rivalVisible()).toBe(true);
    world.factions[0].drugActive.acidcop = world.time;
    render(); expect(rivalVisible()).toBe(false);
    minimap.dispose();
  });
});
