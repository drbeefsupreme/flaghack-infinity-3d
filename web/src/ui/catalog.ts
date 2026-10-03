/**
 * Player-facing names, short rule summaries and icon choices for every game noun the UI
 * shows (chakras, drugs, tools, buildings, GCC actions, plan tools, jobs, hippie statuses,
 * Hearth stages, difficulty, keymap). Numbers come from sim/constants so tooltips never
 * drift from the rules; prose lives here so panels stay layout-only.
 */
import type { PlanTool, ToolKind } from '../game/session';
import {
  ABILITY,
  ALIGN_RADIUS,
  ALIGN_TIME,
  BREW_COST,
  BREW_TIME,
  BUILDINGS,
  CAPTURE,
  DRUG,
  DRUM_RITUAL_PER_SEC,
  GCC,
  PIECE,
  RETRANSMIT_ATTENTION,
  RETRANSMIT_COOLDOWN,
} from '../sim/constants';
import { ABILITY_NAMES, CHAKRA_NAMES } from '../sim/systems/abilities';
import { BUILDING_NAMES } from '../sim/systems/buildings';
import { DRUG_NAMES } from '../sim/systems/drugs';
import { GCC_ACTION_NAMES } from '../sim/systems/gcc';
import type {
  AbilityId,
  CaptureStage,
  ChakraId,
  Difficulty,
  DrugId,
  GccAction,
  HippieStatus,
  JobKind,
} from '../sim/types';
import type { IconName } from './icons';

export interface ChakraInfo {
  key: string;
  /** Chakra name (Flag anatomy). */
  name: string;
  /** Where on a Flag this chakra lives (shown on the chakra diagram). */
  anatomy: string;
  ability: AbilityId;
  abilityName: string;
  cooldown: number;
  /** One-line effect shared by all levels. */
  summary: string;
  /** What changes per level (L1, L2, L3). */
  levels: readonly [string, string, string];
  icon: IconName;
}

export const CHAKRA_INFO: Record<ChakraId, ChakraInfo> = {
  hoist: {
    key: '1',
    name: CHAKRA_NAMES.hoist,
    anatomy: 'where the cloth meets the pole',
    ability: 'beacon',
    abilityName: ABILITY_NAMES.beacon,
    cooldown: ABILITY.beacon.cooldown,
    summary: `Signifiers in range drop their work, rush the target and do the job it calls for (pull, plant, attack, defend) at +25% speed for ${ABILITY.beacon.duration} s.`,
    levels: [`${ABILITY.beacon.radius[0]} m radius`, `${ABILITY.beacon.radius[1]} m radius`, 'Every Signifier on the burn'],
    icon: 'hoist',
  },
  fly: {
    key: '2',
    name: CHAKRA_NAMES.fly,
    anatomy: 'the free edge that streams in the wind',
    ability: 'march',
    abilityName: ABILITY_NAMES.march,
    cooldown: ABILITY.march.cooldown,
    summary: `Signifiers within ${ABILITY.march.radius} m gain +${Math.round(ABILITY.march.mag * 100)}% move and work speed. Afterwards they lose ${ABILITY.march.attentionCost} attention.`,
    levels: [`${ABILITY.march.duration[0]} s march`, `${ABILITY.march.duration[1]} s march`, `${ABILITY.march.duration[2]} s march`],
    icon: 'fly',
  },
  canton: {
    key: '3',
    name: CHAKRA_NAMES.canton,
    anatomy: 'the upper corner nearest the pole',
    ability: 'stabilize',
    abilityName: ABILITY_NAMES.stabilize,
    cooldown: ABILITY.stabilize.cooldown,
    summary: `A Zeno dome for ${ABILITY.stabilize.duration} s: no phason flips and no Phason Shift inside, and instability drops to zero.`,
    levels: [
      `${ABILITY.stabilize.radius[0]} m dome`,
      `${ABILITY.stabilize.radius[1]} m dome`,
      `${ABILITY.stabilize.radius[2]} m dome, and your Flags inside cannot be pulled`,
    ],
    icon: 'canton',
  },
  field: {
    key: '4',
    name: CHAKRA_NAMES.field,
    anatomy: 'the body of the cloth',
    ability: 'phason',
    abilityName: ABILITY_NAMES.phason,
    cooldown: ABILITY.phason.cooldown,
    summary: `Flip the Crystal at a target up to ${ABILITY.phason.range} m away. Flags on flipped nodes decohere. Canon III self-observation does not protect against it; only Stabilize Zones do.`,
    levels: [
      'One node',
      `Every flippable node within ${ABILITY.phason.radius[1]} m`,
      `Every flippable node within ${ABILITY.phason.radius[2]} m`,
    ],
    icon: 'field',
  },
  finial: {
    key: '5',
    name: CHAKRA_NAMES.finial,
    anatomy: 'the ornament crowning the pole',
    ability: 'omega',
    abilityName: ABILITY_NAMES.omega,
    cooldown: ABILITY.omega.cooldown,
    summary: `A shockwave around you: enemy Signifiers take ${ABILITY.omega.damage} damage and are knocked back, and enemy Flags in the radius are knocked loose.`,
    levels: [
      `${ABILITY.omega.radius[0]} m wave`,
      `${ABILITY.omega.radius[1]} m wave`,
      `${ABILITY.omega.radius[2]} m wave, and your quiver plants itself on free nodes`,
    ],
    icon: 'finial',
  },
};

export const ALIGN_NOTE = `Channel ${ALIGN_TIME} s within ${ALIGN_RADIUS} m of your Hearth. The channel can be interrupted.`;

export interface DrugInfo {
  key: string;
  name: string;
  duration: number;
  effect: string;
  risk: string;
  icon: IconName;
}

export const DRUG_INFO: Record<DrugId, DrugInfo> = {
  saffron: {
    key: '6',
    name: DRUG_NAMES.saffron,
    duration: DRUG.duration.saffron,
    effect: `Vexillicrocus tea. For ${DRUG.duration.saffron} s every Signifier you have gains +${Math.round(DRUG.saffronMag * 100)}% work and move speed, and you gain +${DRUG.saffronRitualPerSec} Ritual/s.`,
    risk: `Then a ${DRUG.crashTime} s crash (−${Math.round(DRUG.crashMag * 100)}% speed). Each Signifier has a ${Math.round(DRUG.overstimChance * 100)}% chance to wander off overstimulated.`,
    icon: 'saffron',
  },
  dust: {
    key: '7',
    name: DRUG_NAMES.dust,
    duration: DRUG.duration.dust,
    effect: `For ${DRUG.duration.dust} s the whole lattice shows: focus points, strain and enemy Simulacra. Your throws snap to nodes up to 5 m away.`,
    risk: `The screen distorts, the minimap fills with noise, and ${DRUG.falseFlagsMin}–${DRUG.falseFlagsMax} False Flags appear that are not there.`,
    icon: 'dust',
  },
  acidcop: {
    key: '8',
    name: DRUG_NAMES.acidcop,
    duration: DRUG.duration.acidcop,
    effect: `For ${DRUG.duration.acidcop} s you see every rival's Signifiers, what they are doing, their planned nodes, and their vexillomancer through walls.`,
    risk: 'Paranoia: your Signifiers lose attention twice as fast, and phantom pursuers show up on your minimap.',
    icon: 'acidcop',
  },
};

export type CampBuildingKind = 'workshop' | 'drumcircle' | 'ward' | 'druglab';
export const CAMP_BUILDINGS: readonly CampBuildingKind[] = ['workshop', 'drumcircle', 'ward', 'druglab'];

export interface BuildInfo {
  name: string;
  cost: number;
  effect: string;
  icon: IconName;
}

export const BUILD_INFO: Record<CampBuildingKind, BuildInfo> = {
  workshop: { name: BUILDING_NAMES.workshop, cost: BUILDINGS.workshop.cost, effect: 'Crafts +1 Flag every 5 s for 3 lumber each.', icon: 'workshop' },
  drumcircle: {
    name: BUILDING_NAMES.drumcircle,
    cost: BUILDINGS.drumcircle.cost,
    effect: `Recruits a Signifier every 14 s (1 Flag + 10 lumber) and raises the pop cap by 6. Up to 4 drummers make +${DRUM_RITUAL_PER_SEC} Ritual/s each.`,
    icon: 'drumcircle',
  },
  ward: {
    name: BUILDING_NAMES.ward,
    cost: BUILDINGS.ward.cost,
    effect: 'Enemy pressure on Hearths within 30 m drops by 40%. Observes 26 m. Every 4 s a vibe check stuns enemy Signifiers within 14 m.',
    icon: 'ward',
  },
  druglab: {
    name: BUILDING_NAMES.druglab,
    cost: BUILDINGS.druglab.cost,
    effect: `Brews one dose every ${BREW_TIME} s (${BREW_COST} lumber). Holds up to 3 doses of each drug.`,
    icon: 'druglab',
  },
};

export interface ToolInfo {
  tool: ToolKind;
  key: string;
  name: string;
  /** Lumber per use (0 = free). */
  cost: number;
  icon: IconName;
}

export const TOOL_INFO: readonly ToolInfo[] = [
  { tool: 'flag', key: 'F', name: 'Flag', cost: 0, icon: 'flag' },
  { tool: 'wall', key: 'Z', name: 'Tarp Wall', cost: PIECE.cost, icon: 'wall' },
  { tool: 'floor', key: 'X', name: 'Deck', cost: PIECE.cost, icon: 'floor' },
  { tool: 'ramp', key: 'C', name: 'Ramp', cost: PIECE.cost, icon: 'ramp' },
  { tool: 'demolish', key: 'V', name: 'Demolish', cost: -PIECE.refund, icon: 'demolish' },
  { tool: 'building', key: 'B', name: 'Camp building', cost: 0, icon: 'workshop' },
];

export interface GccInfo {
  name: string;
  cooldown: number;
  effect: string;
  icon: IconName;
}

export const GCC_INFO: Record<GccAction, GccInfo> = {
  gift: {
    name: GCC_ACTION_NAMES.gift,
    cooldown: GCC.giftCooldown,
    effect: `At your cart: spend 1 Flag to recruit the selected neutral Signifier within ${GCC.giftRadius} m.`,
    icon: 'gift',
  },
  dialectics: {
    name: GCC_ACTION_NAMES.dialectics,
    cooldown: GCC.dialecticsCooldown,
    effect: `At your cart: a ${GCC.dialecticsChannel} s debate converts up to ${GCC.dialecticsMax} enemy Signifiers within ${GCC.dialecticsRadius} m.`,
    icon: 'dialectics',
  },
  simulacra: {
    name: GCC_ACTION_NAMES.simulacra,
    cooldown: GCC.simulacraCooldown,
    effect: `At your cart: spend 1 Flag to plant it on two nodes at once. When an enemy comes within ${GCC.simulacraObserveRadius} m of either, it collapses onto one.`,
    icon: 'simulacra',
  },
};

export const RETRANSMIT_INFO = {
  name: 'TAKE A SHOT',
  cooldown: RETRANSMIT_COOLDOWN,
  effect: `Retransmit over the D.E.G.E.N. mesh: every Signifier gains +${RETRANSMIT_ATTENTION} attention and wobbles for 2 s.`,
} as const;

export interface PlanToolInfo {
  tool: PlanTool | 'clear';
  key: string;
  name: string;
  hint: string;
  icon: IconName;
}

export const PLAN_TOOLS: readonly PlanToolInfo[] = [
  { tool: 'select', key: 'Esc', name: 'Select', hint: 'Drag to select Signifiers. Right-click to give orders.', icon: 'select' },
  { tool: 'node', key: 'N', name: 'Node', hint: 'Click nodes to add them to the plan or remove them.', icon: 'node' },
  { tool: 'enclose', key: 'E', name: 'Enclose', hint: 'Click a point, such as an enemy Hearth, to plan the cheapest loop around it.', icon: 'enclose' },
  { tool: 'pentacle', key: 'P', name: 'Pentacle', hint: 'Click a revealed Crystal focus to plan its five neighbours.', icon: 'pentacle' },
  { tool: 'ring', key: 'R', name: 'Ring', hint: 'Plan a wider ring around your home Survey.', icon: 'ring' },
  { tool: 'clear', key: '⌫', name: 'Clear', hint: 'Erase your whole Survey plan.', icon: 'clear' },
];

export interface JobInfo {
  name: string;
  desc: string;
  icon: IconName;
}

export const JOB_INFO: Record<JobKind, JobInfo> = {
  survey: { name: 'Survey', desc: 'Fetch Flags and plant your planned nodes.', icon: 'survey' },
  gather: { name: 'Gather', desc: 'Chop piles and haul lumber to the Hearth.', icon: 'gather' },
  defend: { name: 'Defend', desc: 'Guard the Hearth, answer SOS calls and pull enemy Flags out of your Survey.', icon: 'defend' },
  raid: { name: 'Raid', desc: 'Steal the enemy Flags that threaten your Hearth, then enemy boundary Flags.', icon: 'raid' },
  ritual: { name: 'Ritual', desc: `Drum at a Drum Circle for +${DRUM_RITUAL_PER_SEC} Ritual/s per drummer.`, icon: 'drum' },
};

export type StatusTone = 'survey' | 'labour' | 'guard' | 'raid' | 'idle' | 'lost' | 'down';

/** Minimap + roster colour per status family (CSS mirrors these as .tone-*). */
export const TONE_COLOR: Record<StatusTone, string> = {
  survey: '#ffe27a',
  labour: '#7ee08a',
  guard: '#ff9a4a',
  raid: '#ff5fae',
  idle: '#eaf4ff',
  lost: '#b991ff',
  down: '#6d6a66',
};

export interface StatusInfo {
  label: string;
  icon: IconName;
  tone: StatusTone;
  /** Roster group order (busy first, broken last). */
  order: number;
}

export const STATUS_INFO: Record<HippieStatus, StatusInfo> = {
  planting: { label: 'Planting', icon: 'plant', tone: 'survey', order: 0 },
  carrying: { label: 'Carrying a Flag', icon: 'carry', tone: 'survey', order: 1 },
  fetching: { label: 'Fetching Flags', icon: 'flag', tone: 'survey', order: 2 },
  pulling: { label: 'Pulling Flags', icon: 'pull', tone: 'raid', order: 3 },
  stealing: { label: 'Stealing Flags', icon: 'steal', tone: 'raid', order: 4 },
  tearing: { label: 'Tearing down', icon: 'tear', tone: 'raid', order: 5 },
  fighting: { label: 'Shoving', icon: 'fight', tone: 'guard', order: 6 },
  responding: { label: 'Answering SOS', icon: 'respond', tone: 'guard', order: 7 },
  defending: { label: 'Defending', icon: 'defend', tone: 'guard', order: 8 },
  building: { label: 'Building', icon: 'build', tone: 'labour', order: 9 },
  repairing: { label: 'Repairing', icon: 'repair', tone: 'labour', order: 10 },
  chopping: { label: 'Chopping lumber', icon: 'chop', tone: 'labour', order: 11 },
  hauling: { label: 'Hauling lumber', icon: 'lumber', tone: 'labour', order: 12 },
  drumming: { label: 'Drumming', icon: 'drum', tone: 'labour', order: 13 },
  following: { label: 'Following you', icon: 'follow', tone: 'idle', order: 14 },
  walking: { label: 'On the move', icon: 'walk', tone: 'idle', order: 15 },
  idle: { label: 'Vibing', icon: 'idle', tone: 'idle', order: 16 },
  distracted: { label: 'Distracted', icon: 'distracted', tone: 'lost', order: 17 },
  fleeing: { label: 'Fleeing', icon: 'flee', tone: 'lost', order: 18 },
  ko: { label: 'Knocked out', icon: 'ko', tone: 'down', order: 19 },
};

export interface StageInfo {
  label: string;
  desc: string;
}

export const STAGE_INFO: Record<CaptureStage, StageInfo> = {
  safe: { label: 'Safe', desc: 'No enemy Survey nearby.' },
  threatened: { label: 'Threatened', desc: `An enemy Survey or Ley Line is within ${CAPTURE.threatRadius} m.` },
  contained: { label: 'Contained', desc: 'An enemy Survey encloses the Hearth. Pressure builds toward the overwrite.' },
  contested: {
    label: 'Contested',
    desc: `Contained, but its vexillomancer holds the Hearth in person (within ${CAPTURE.holdRadius} m). Pressure builds at ${Math.round(CAPTURE.contestedMult * 100)}%.`,
  },
  overwritten: { label: 'Overwritten', desc: 'The overwrite cannot be stopped.' },
  captured: { label: 'Captured', desc: 'The camp has fallen.' },
};

export interface DifficultyInfo {
  name: string;
  desc: string;
}

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  chill: { name: 'Chill', desc: 'The rivals drum more than they Survey.' },
  normal: { name: 'Normal', desc: 'A fair burn.' },
  hard: { name: 'Hard', desc: 'Accurate throws, fast reactions, abilities on cooldown.' },
  vexillosaint: { name: 'Vexillosaint', desc: 'A title bestowed at the Congress of the Flags. They punish every loose loop.' },
};
export const DIFFICULTIES: readonly Difficulty[] = ['chill', 'normal', 'hard', 'vexillosaint'];

export interface KeyGroup {
  title: string;
  keys: readonly (readonly [string, string])[];
}

/** Full keymap (help overlay shows the first two groups compactly; the codex shows all). */
export const KEYMAP: readonly KeyGroup[] = [
  {
    title: 'Vexillomancer',
    keys: [
      ['W A S D', 'Move'],
      ['Space', 'Jump'],
      ['Shift', 'Sprint'],
      ['Mouse', 'Look'],
      ['LMB', 'Swing staff · place piece · demolish'],
      ['Q', 'Throw a Flag'],
      ['RMB hold', 'Aim a throw (LMB throws)'],
      ['E', 'Plant · hold to pull · tap a Beacon'],
      ['E at GCC', 'Command Table (hold to push the cart)'],
    ],
  },
  {
    title: 'Building',
    keys: [
      ['F', 'Flag tool'],
      ['Z', `Tarp Wall (${PIECE.cost} lumber)`],
      ['X', `Deck (${PIECE.cost} lumber)`],
      ['C', `Ramp (${PIECE.cost} lumber)`],
      ['V', `Demolish (+${PIECE.refund} lumber)`],
      ['B', 'Camp building (cycle)'],
    ],
  },
  {
    title: 'Powers & camp',
    keys: [
      ['1 – 5', 'Chakra abilities at the crosshair'],
      ['6 7 8', 'Saffron · Luminous Dust · Acid Cop Vision'],
      ['G', 'Rally Signifiers within 25 m'],
      ['H', 'Send followers at the crosshair'],
      ['P', 'Ping (attack, Flag here or rally, by context)'],
      ['T', 'Retransmit: TAKE A SHOT'],
    ],
  },
  {
    title: 'Command View',
    keys: [
      ['Tab', 'Toggle Command View'],
      ['W A S D · edge', 'Pan the table'],
      ['Wheel', 'Zoom'],
      ['LMB drag', 'Box-select Signifiers (Shift adds)'],
      ['RMB', 'Context order · Ctrl+RMB defend here'],
      ['N E P R', 'Node · Enclose · Pentacle · Ring'],
      ['Backspace', 'Clear the Survey plan'],
      ['Esc', 'Select tool · back to action'],
    ],
  },
  {
    title: 'Screens',
    keys: [
      ['K', 'Chakras'],
      ['J', 'Liber HH'],
      ['F1', 'This help'],
      ['L', 'Lattice overlay'],
      ['Esc', 'Pause'],
    ],
  },
];
