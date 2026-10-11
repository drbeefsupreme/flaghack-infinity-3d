import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCH, UNLIMITED_DAYS, normalizeMatch } from '../sim/matchSettings';
import type { LobbySettings } from '../net/protocol';
import { MatchSetup } from './matchSetup';

/** Small DOM contract: menu choices, mirrored controls, permissions and reset behavior. */
class Element extends EventTarget {
  className = ''; textContent = ''; innerHTML = ''; value = ''; disabled = false; checked = false;
  min = ''; max = ''; step = '';
  get valueAsNumber() { return this.value.trim() === '' ? NaN : Number(this.value); }
  dataset: Record<string, string> = {};
  children: Element[] = []; parentElement: Element | null = null;
  attributes = new Map<string, string>();
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    toggle: (name: string, on: boolean) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    },
  };
  constructor(readonly tagName: string) { super(); }
  appendChild(node: Element) { node.parentElement = this; this.children.push(node); return node; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  closest() { return null; }
  focus() {}
  blur() {}
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); }
}

function descendants(node: Element): Element[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function bossHpField(overlay: Element): Element {
  return descendants(overlay).find((node) => node.tagName === 'label' && node.children.some((child) => child.textContent === 'Boss HP'))!.children.find((child) => child.tagName === 'input')!;
}

function setup() {
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag), activeElement: null });
  vi.stubGlobal('window', new EventTarget());
  const root = new Element('div'), overlay = new Element('div');
  let settings: LobbySettings = { difficulty: 'hard', seed: 'fixed', match: normalizeMatch({ active: [0, 2] }) };
  const write = vi.fn((patch: Partial<LobbySettings>) => { settings = { ...settings, ...patch }; });
  const ui = new MatchSetup(root as unknown as HTMLElement, overlay as unknown as HTMLElement, () => settings, write);
  ui.update();
  const days = [...descendants(root), ...descendants(overlay)].filter((node) => node.tagName === 'select' && node.children.some((child) => child.value === String(UNLIMITED_DAYS)));
  return { ui, root, overlay, days, write, read: () => settings };
}

afterEach(() => vi.unstubAllGlobals());

describe('zero-day match setup', () => {
  it('edits bounded whole-number Boss HP for the next match and resets it to 50,000', () => {
    const { ui, overlay, read } = setup();
    const input = bossHpField(overlay);
    expect(input.value).toBe('50000');
    expect([input.min, input.max, input.step]).toEqual(['100', '1000000', '100']);
    input.value = '72500';
    input.dispatchEvent(new Event('change'));
    ui.update();
    expect(read().match?.bossHp).toBe(72500);
    expect(input.value).toBe('72500');
    input.value = '12345.9';
    input.dispatchEvent(new Event('change'));
    ui.update();
    expect(read().match?.bossHp).toBe(12345);
    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('12345');
    descendants(overlay).find((node) => node.innerHTML === 'Reset defaults')!.dispatchEvent(new Event('click'));
    ui.update();
    expect(read().match?.bossHp).toBe(50000);
    expect(input.value).toBe('50000');
    expect(read().match?.active).toEqual([0, 2]);
    ui.dispose();
  });
  it('offers distinct zero-day and Unlimited choices in the lobby and advanced settings', () => {
    const { ui, root, days, read } = setup();
    expect(days).toHaveLength(2);
    for (const field of days) {
      expect(field.children.map((option) => option.value)).toEqual(['0', '1', '2', '3', '4', '5', '-1']);
      expect(field.children[0].textContent).toBe('0 · Start at The Burn');
      expect(field.children[6].textContent).toBe('Unlimited');
    }
    days[0].value = '0';
    days[0].dispatchEvent(new Event('change'));
    ui.update();
    expect(read().match?.days).toBe(0);
    expect(days.map((field) => field.value)).toEqual(['0', '0']);
    expect(descendants(root).find((node) => node.className === 'panel-hint')?.textContent).toContain('Burn starts immediately. Boss reveal after 90 seconds.');
    days[1].value = String(UNLIMITED_DAYS);
    days[1].dispatchEvent(new Event('change'));
    ui.update();
    expect(read().match?.days).toBe(UNLIMITED_DAYS);
    expect(days.map((field) => field.value)).toEqual(['-1', '-1']);
    expect(descendants(root).find((node) => node.className === 'panel-hint')?.textContent).toContain('Unlimited · no scheduled Burn.');
    ui.dispose();
  });

  it('resets zero days to the default schedule while preserving enabled seats', () => {
    const { ui, overlay, days, read } = setup();
    days[0].value = '0';
    days[0].dispatchEvent(new Event('change'));
    const reset = descendants(overlay).find((node) => node.innerHTML === 'Reset defaults')!;
    reset.dispatchEvent(new Event('click'));
    ui.update();
    expect(read()).toEqual({ difficulty: 'normal', seed: null, match: { ...DEFAULT_MATCH, active: [0, 2] } });
    expect(days.map((field) => field.value)).toEqual(['1', '1']);
    ui.dispose();
  });

  it('keeps guest controls read-only even if a change event is dispatched', () => {
    const { ui, overlay, days, write } = setup();
    ui.update(false);
    for (const field of days) {
      expect(field.disabled).toBe(true);
      field.value = '0';
      field.dispatchEvent(new Event('change'));
    }
    const hp = bossHpField(overlay);
    expect(hp.disabled).toBe(true);
    hp.value = '100';
    hp.dispatchEvent(new Event('change'));
    descendants(overlay).find((node) => node.innerHTML === 'Reset defaults')!.dispatchEvent(new Event('click'));
    expect(write).not.toHaveBeenCalled();
    ui.dispose();
  });
});


describe('Flag hoarding setting', () => {
  it('edits, validates, locks for guests and resets the base threshold', () => {
    const { ui, overlay, read } = setup();
    const field = descendants(overlay).find(node => node.tagName === 'label' && node.children.some(c => c.textContent === 'Flag hoarding threshold'))!.children.find(c => c.tagName === 'input')!;
    expect(field.value).toBe('24');
    expect([field.min, field.max, field.step]).toEqual(['0', '1000', '1']);
    field.value = '42.9'; field.dispatchEvent(new Event('change')); ui.update();
    expect(read().match?.hoardThreshold).toBe(42);
    field.value = ''; field.dispatchEvent(new Event('change'));
    expect(field.value).toBe('42');
    ui.update(false);
    field.value = '50'; field.dispatchEvent(new Event('change'));
    expect(read().match?.hoardThreshold).toBe(42);
    ui.update(true);
    descendants(overlay).find(node => node.innerHTML === 'Reset defaults')!.dispatchEvent(new Event('click')); ui.update();
    expect(read().match?.hoardThreshold).toBe(24);
    ui.dispose();
  });
});
