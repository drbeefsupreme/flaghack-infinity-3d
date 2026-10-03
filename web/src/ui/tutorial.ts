/**
 * Contextual tutorial for a first match: short hint cards that advance when the player does
 * the thing (plant → Ley Line → enclose → Command View → plan → priorities → wall → building →
 * chakra). Lessons are recorded whenever they happen, in any order; the card always shows
 * the first unlearned one. Progress and dismissal persist in localStorage ('fh.tutorial.v1').
 */
import { AVATAR, PIECE } from '../sim/constants';
import type { GameEvent } from '../sim/events';
import { JOBS } from '../sim/types';
import type { World } from '../sim/world';
import type { UiHost, UiPart } from './core';
import { button, el, kbd, setClass, setText, show } from './dom';

const STORAGE_KEY = 'fh.tutorial.v1';
/** Ignore the setup burst (home ring planted at t = 0). */
const SETTLE_TIME = 1;
const DONE_FLASH_MS = 1400;

type StepId = 'plant' | 'ley' | 'enclose' | 'command' | 'plan' | 'priorities' | 'wall' | 'building' | 'align';

interface Step {
  id: StepId;
  title: string;
  /** Trusted markup (keycaps only). */
  text: string;
}

const STEPS: readonly Step[] = [
  {
    id: 'plant',
    title: 'Plant your first Flag',
    text: `Walk onto a Ley Node and press ${kbd('E')} to plant, or ${kbd('Q')} to throw. A thrown Flag plants itself on a node where it lands. You carry ${AVATAR.quiver}.`,
  },
  {
    id: 'ley',
    title: 'Draw a Ley Line',
    text: 'Plant a second Flag on a neighbouring node. Two of your Flags joined by a lattice edge form a Ley Line.',
  },
  {
    id: 'enclose',
    title: 'Enclose the Crystal',
    text: 'Close a loop of Ley Lines. Every facet inside becomes your Survey. Completed loops also hold steady when the Crystal turns.',
  },
  {
    id: 'command',
    title: 'Open the Command Table',
    text: `Press ${kbd('Tab')}, or ${kbd('E')} at your Geomantic Command Center, to look down on the whole burn.`,
  },
  {
    id: 'plan',
    title: 'Plan a Survey',
    text: `Choose Enclose (${kbd('E')}) and click near a target. Your Signifiers fetch Flags and plant the loop for you.`,
  },
  {
    id: 'priorities',
    title: 'Steer the camp',
    text: 'Set Camp Priorities: Survey to expand, Gather for lumber, Defend under threat, Raid to steal Flags, Ritual to drum.',
  },
  {
    id: 'wall',
    title: 'Raise a wall',
    text: `In action view press ${kbd('Z')} and click to raise a Tarp Wall for ${PIECE.cost} lumber. Walls shield your loop Flags.`,
  },
  {
    id: 'building',
    title: 'Grow the camp',
    text: `Place a Workshop, Drum Circle, Ward or Drug Lab inside your Survey. Use ${kbd('B')}, or the build menu in Command View.`,
  },
  {
    id: 'align',
    title: 'Align a chakra',
    text: `Earn Ritual by drumming, holding Crystals or brewing Saffron. Then stand at your Hearth and press ${kbd('K')}. Abilities go on ${kbd('1')}–${kbd('5')}.`,
  },
];

interface Progress {
  done: boolean;
  learned: StepId[];
}

function loadProgress(): Progress {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof raw === 'object' && raw !== null && 'done' in raw && 'learned' in raw) {
      const learned: unknown[] = Array.isArray(raw.learned) ? raw.learned : [];
      return {
        done: raw.done === true,
        learned: STEPS.map((s) => s.id).filter((id) => learned.includes(id)),
      };
    }
  } catch {
    // Corrupt storage: start the lessons over.
  }
  return { done: false, learned: [] };
}

export class Tutorial implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private stepLabel: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private pips: HTMLElement[] = [];
  private progress: Progress;
  private learned = new Set<StepId>();
  private shown: StepId | null = null;
  private doneFlashUntil = 0;
  private planBaseline = -1;
  private weightsBaseline = '';
  private live = false;

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.progress = loadProgress();
    for (const id of this.progress.learned) this.learned.add(id);
    this.root = el('div', 'tut is-off', parent);
    const head = el('div', 'tut-head', this.root);
    this.stepLabel = el('span', 'tut-step', head, '');
    button('tut-x', head, 'Dismiss lessons', () => {
      this.progress.done = true;
      this.save();
    });
    this.title = el('div', 'tut-title', this.root, '');
    this.text = el('div', 'tut-text', this.root, '');
    const pipBox = el('div', 'tut-pips', this.root);
    for (let i = 0; i < STEPS.length; i++) this.pips.push(el('i', '', pipBox));
  }

  private save(): void {
    this.progress.learned = STEPS.map((s) => s.id).filter((id) => this.learned.has(id));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
    } catch {
      // Storage unavailable: lessons simply restart next session.
    }
  }

  private learn(id: StepId): void {
    if (this.learned.has(id) || this.progress.done) return;
    this.learned.add(id);
    if (this.shown === id) this.doneFlashUntil = performance.now() + DONE_FLASH_MS;
    if (this.learned.size === STEPS.length) this.progress.done = true;
    this.save();
  }

  reset(world: World): void {
    // Only a real player match teaches; the title attract match is all AI.
    this.live = !world.options.allAi;
    this.planBaseline = -1;
    this.weightsBaseline = '';
  }

  onEvent(e: GameEvent, w: World): void {
    if (!this.live || this.progress.done || w.time < SETTLE_TIME) return;
    const P = this.host.app.session.playerFaction;
    const avatarId = w.factions[P]?.avatarId;
    switch (e.t) {
      case 'flagPlanted':
        if (e.faction === P && e.by === avatarId) this.learn('plant');
        break;
      case 'flagThrown':
        if (e.faction === P) this.learn('plant');
        break;
      case 'leyLine':
        if (e.faction === P && e.on) this.learn('ley');
        break;
      case 'surveyChanged':
        if (e.faction === P && e.gained.length > 0) this.learn('enclose');
        break;
      case 'pieceBuilt':
        if (e.faction === P) this.learn('wall');
        break;
      case 'buildingPlaced':
        if (e.faction === P && e.kind !== 'hearth' && e.kind !== 'gcc') this.learn('building');
        break;
      case 'aligned':
        if (e.faction === P) this.learn('align');
        break;
      default:
        break;
    }
  }

  update(world: World | null, now: number): void {
    const s = this.host.app.session;
    const fac = world?.factions[s.playerFaction];
    const visible = this.live && !this.progress.done && s.screen === 'playing' && !!world && !!fac && fac.alive;
    show(this.root, visible);
    if (!visible || !world || !fac) return;
    setClass(this.root, 'ix', s.view === 'command' || !s.pointerLocked);

    // Polled lessons: things the player does through session/commands rather than events.
    if (s.view === 'command') this.learn('command');
    if (this.planBaseline < 0) this.planBaseline = fac.plan.size;
    else if (fac.plan.size > this.planBaseline) this.learn('plan');
    let weights = '';
    for (const j of JOBS) weights += fac.jobWeights[j];
    if (!this.weightsBaseline) this.weightsBaseline = weights;
    else if (weights !== this.weightsBaseline) this.learn('priorities');

    const flashing = now < this.doneFlashUntil;
    setClass(this.root, 'learned', flashing);
    if (flashing) return;
    const idx = STEPS.findIndex((st) => !this.learned.has(st.id));
    const step = STEPS[idx];
    if (!step) return;
    for (let i = 0; i < this.pips.length; i++) setClass(this.pips[i], 'on', this.learned.has(STEPS[i].id));
    if (this.shown === step.id) return;
    this.shown = step.id;
    setText(this.stepLabel, `Survey lesson ${idx + 1} of ${STEPS.length}`);
    setText(this.title, step.title);
    this.text.innerHTML = step.text;
  }

  dispose(): void {
    this.root.remove();
  }
}
