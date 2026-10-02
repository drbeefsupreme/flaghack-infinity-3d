/**
 * All gameplay tuning lives here. Values mirror docs/design/2026-10-02-flaghack-infinity-3d.md.
 * Change numbers here, not inline in systems.
 */
import type { FactionId, Personality } from './types';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// ── World ─────────────────────────────────────────────────────────────────────
export const MAP_HALF = 150; // world x/z in [-MAP_HALF, MAP_HALF]
export const MAP_SIZE = MAP_HALF * 2;
export const LEY_EDGE = 8; // lattice edge length (m)
export const LATTICE_MARGIN = 3; // nodes closer than this to the map border are dropped
export const CAMP_CENTERS: Record<FactionId, { x: number; z: number }> = {
  0: { x: -100, z: 100 },
  1: { x: 100, z: 100 },
  2: { x: 100, z: -100 },
  3: { x: -100, z: -100 },
};
export const LEVEL_HEIGHT = 3.2; // build level height (m)
export const MAX_BUILD_LEVEL = 3;

// ── Factions ──────────────────────────────────────────────────────────────────
export interface FactionDef {
  name: string;
  title: string;
  color: number;
  css: string;
  personality: Personality;
  /** Short lore flavour shown on Hearth rail / defeat cards. */
  motto: string;
}
export const FACTION_DEFS: Record<FactionId, FactionDef> = {
  0: {
    name: 'Dr. Beef Supreme',
    title: 'Abstractor of the Quintessence',
    color: 0x29e3ff,
    css: '#29e3ff',
    personality: 'player',
    motto: 'It is not you who moves the Flag, it is the Flag who moves you.',
  },
  1: {
    name: 'Dr. Beelzebub Crow',
    title: 'Host of the Too Late Show',
    color: 0xff4058,
    css: '#ff4058',
    personality: 'surveyor',
    motto: 'Flags is the herpes of objects.',
  },
  2: {
    name: 'DJ Scarecrow',
    title: 'Sonic Weaponeer',
    color: 0x86ff4a,
    css: '#86ff4a',
    personality: 'raider',
    motto: 'The Acid Cops have an open file on him. It is mostly question marks.',
  },
  3: {
    name: 'President Jaguar',
    title: 'Re-elected Forever',
    color: 0xa45cff,
    css: '#a45cff',
    personality: 'warden',
    motto: 'We cannot yet risk the instability of a fully enlightened society.',
  },
};
export const FLAG_YELLOW = 0xffd400;
export const NEUTRAL_COLOR = 0xd8d2c0;

// ── Starting camp ─────────────────────────────────────────────────────────────
export const START_LUMBER = 150;
export const START_STOCK_FLAGS = 14;
export const START_CARRIED_FLAGS = 6;
export const START_HIPPIES = 6;
export const START_HOME_RING_RADIUS = 13; // home loop planted around the Hearth at t=0
export const NEUTRAL_HIPPIES = 18;

// ── Avatar ────────────────────────────────────────────────────────────────────
export const AVATAR = {
  runSpeed: 8,
  sprintSpeed: 11.5,
  accel: 60,
  airControl: 0.35,
  jumpSpeed: 7.5,
  gravity: 24,
  radius: 0.45,
  height: 1.85,
  stepHeight: 0.55,
  maxHp: 200,
  regenDelay: 4,
  regenPerSec: 6,
  quiver: 10,
  restockRadius: 6,
  plantReach: 3.5,
  plantTime: 0.2,
  throwCooldown: 0.3,
  throwSpeed: 26,
  throwSnapRadius: 3,
  pullOwnTime: 0.35,
  pullEnemyTime: 1.0,
  pullReach: 3,
  swingTime: 0.45,
  swingReach: 2.6,
  swingDamage: 34,
  swingPieceDamage: 40,
  swingLumber: 14,
  respawnTime: 6,
  observeRadius: 12,
} as const;

// ── Hippies ───────────────────────────────────────────────────────────────────
export const HIPPIE = {
  speed: 5.5,
  radius: 0.4,
  maxHp: 100,
  plantTime: 0.9,
  pullOwnTime: 0.8,
  pullEnemyTime: 2.4,
  shoveDamage: 12,
  shoveInterval: 0.8,
  wallDps: 15,
  gatherTime: 3,
  gatherAmount: 10,
  respawnTime: 14,
  attentionDrain: 1,
  attentionRecover: 4,
  distractedTime: 10,
  distractedRecoverTo: 60,
  sightRadius: 18,
  sosRespondRadius: 60,
  popCapBase: 12,
  popCapPerDrumCircle: 6,
  popCapMax: 40,
} as const;

// ── Building ──────────────────────────────────────────────────────────────────
export const PIECE = {
  cost: 10,
  hp: 150,
  refund: 5,
  wallHeight: 3.2,
  wallThickness: 0.35,
  wallInset: 0.5,
  popIn: 0.4,
} as const;

export const BUILDINGS = {
  hearth: { cost: 0, hp: 1500, radius: 3.2 },
  workshop: { cost: 80, hp: 500, radius: 2.8 },
  drumcircle: { cost: 80, hp: 500, radius: 3.0 },
  ward: { cost: 120, hp: 700, radius: 2.2 },
  druglab: { cost: 100, hp: 500, radius: 2.8 },
  gcc: { cost: 0, hp: 600, radius: 1.6 },
} as const;
export const BUILD_TIME = 8;
export const HEARTH_FLAG_INTERVAL = 8;
export const HEARTH_FLAG_COST = 4;
export const WORKSHOP_FLAG_INTERVAL = 5;
export const WORKSHOP_FLAG_COST = 3;
export const RECRUIT_INTERVAL = 14;
export const RECRUIT_LUMBER = 10;
export const HOARD_THRESHOLD = 24;
export const WARD_RADIUS = 30;
export const WARD_OBSERVE_RADIUS = 26;
export const WARD_PULSE_INTERVAL = 4;
export const WARD_PULSE_RADIUS = 14;
export const HEARTH_OBSERVE_RADIUS = 22;
export const DRUM_RITUAL_PER_SEC = 1;
export const DRUMMERS_PER_CIRCLE = 4;

// ── GCC ───────────────────────────────────────────────────────────────────────
export const GCC = {
  pushSpeed: 4,
  adviceRadius: 30,
  repairRadius: 20,
  repairInterval: 3,
  repairHps: 15,
  giftRadius: 15,
  giftCooldown: 3,
  dialecticsRadius: 14,
  dialecticsCooldown: 40,
  dialecticsChannel: 3,
  dialecticsMax: 3,
  simulacraCooldown: 20,
  simulacraObserveRadius: 10,
  rebuildTime: 45,
} as const;

// ── Survey / Crystal ──────────────────────────────────────────────────────────
export const IMPLIED_MAX_ORDER = 3;
export const INSTABILITY_RISE = 0.08;
export const INSTABILITY_DECAY = 0.15;
export const INSTABILITY_SHIMMER = 0.35;
export const INSTABILITY_DISCHARGE = 0.65;
export const INSTABILITY_STORM = 0.9;
export const DISCHARGE_STUN = 1.2;
export const DISCHARGE_DAMAGE = 25;
export const TIDE_INTERVAL = 75;
export const TIDE_INTERVAL_SUDDEN_DEATH = 40;
export const TIDE_WARNING = 10;
export const TIDE_FRACTION = 0.05;
export const CRYSTAL_GROW_TIME = 3;
export const CRYSTAL_RITUAL_PER_SEC = 0.6;
export const CRYSTAL_PRESSURE_RADIUS = 45;
export const CRYSTAL_PRESSURE_BONUS = 1.15;
export const CRYSTAL_OBSERVE_RADIUS = 10;

// ── Capture ───────────────────────────────────────────────────────────────────
export const CAPTURE = {
  threatRadius: 30,
  baseRate: 2.8,
  decay: 6,
  contestedMult: 0.4,
  defenderMult: 0.93,
  defenderFloor: 0.5,
  defenderRadius: 12,
  wardMult: 0.6,
  overwriteTime: 3,
  holdRadius: 8,
} as const;
export const BURN_TIME = 14 * 60;
export const SUDDEN_DEATH_PRESSURE_MULT = 2;

// ── Chakras / abilities ──────────────────────────────────────────────────────
export const ALIGN_COST = [30, 70, 130] as const; // cost to reach level 1, 2, 3
export const ALIGN_TIME = 4;

// ── Drugs ─────────────────────────────────────────────────────────────────────
export const BREW_TIME = 22;
export const BREW_COST = 25;
export const DRUG_MAX = 3;

// ── DEGEN mesh ────────────────────────────────────────────────────────────────
export const PING_DURATION = 12;
export const SOS_COOLDOWN = 6;
export const RETRANSMIT_COOLDOWN = 60;
export const RETRANSMIT_ATTENTION = 35;
export const MESH_TAP_DURATION = 30;
export const BEACON_DROP_CHANCE = 0.35;

// ── Lumber piles ──────────────────────────────────────────────────────────────
export const PILE_COUNT = 44;
export const PILE_MIN = 80;
export const PILE_MAX = 200;
export const PILE_RESPAWN_INTERVAL = 25;
