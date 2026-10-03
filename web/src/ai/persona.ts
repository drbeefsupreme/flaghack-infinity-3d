/**
 * NPC rival temperaments (design §4, §13): when each personality strikes, what it builds,
 * which chakras it opens, and how difficulty sharpens reflexes and aim.
 * Owner: AI agent.
 */
import type { BuildingKind, ChakraId, Difficulty, DrugId, Personality } from '../sim/types';

export interface Persona {
  /** Earliest game time (s) this temperament considers an assault on a rival Hearth. */
  attackFrom: number;
  /** Flags in hand needed per new loop Flag before committing to an assault. */
  attackMargin: number;
  /** Posture utility weights. */
  attack: number;
  expand: number;
  economy: number;
  defend: number;
  opportunism: number;
  /** Survey size (facets) the camp grows lobes towards before it stops expanding for its own sake. */
  territory: number;
  buildOrder: readonly BuildingKind[];
  chakraOrder: readonly ChakraId[];
  /** Drug taken when an assault begins (if any is on the shelf). */
  assaultDrug: DrugId | null;
  /** Pentacle hunting appetite (focus nodes) 0..1. */
  crystals: number;
  /** Hearth stock the camp is comfortable sitting on (wardens keep a deeper chest). */
  hoard: number;
}

export const PERSONAS: Record<Personality, Persona> = {
  // Dr. Beelzebub Crow: expands, hunts focus points, Phason Shift heavy, strikes mid-game.
  surveyor: {
    attackFrom: 270,
    attackMargin: 1.15,
    attack: 0.9,
    expand: 1.0,
    economy: 0.8,
    defend: 1.0,
    opportunism: 0.8,
    territory: 48,
    buildOrder: ['drumcircle', 'workshop', 'druglab', 'ward'],
    chakraOrder: ['field', 'hoist', 'canton', 'fly', 'finial'],
    assaultDrug: 'dust',
    crystals: 1,
    hoard: 12,
  },
  // DJ Scarecrow: early aggression, Flag theft, Forced March, Saffron.
  raider: {
    attackFrom: 170,
    attackMargin: 1.05,
    attack: 1.25,
    expand: 0.55,
    economy: 0.7,
    defend: 0.9,
    opportunism: 1.2,
    territory: 30,
    buildOrder: ['drumcircle', 'workshop', 'druglab', 'ward'],
    chakraOrder: ['fly', 'hoist', 'finial', 'field', 'canton'],
    assaultDrug: 'saffron',
    crystals: 0.4,
    hoard: 8,
  },
  // President Jaguar: walls and wards, hoards Flags, one huge late enclosure.
  warden: {
    attackFrom: 400,
    attackMargin: 1.35,
    attack: 0.95,
    expand: 0.85,
    economy: 1.0,
    defend: 1.3,
    opportunism: 0.6,
    territory: 40,
    buildOrder: ['workshop', 'ward', 'drumcircle', 'ward', 'druglab'],
    chakraOrder: ['canton', 'finial', 'hoist', 'field', 'fly'],
    assaultDrug: 'acidcop',
    crystals: 0.6,
    hoard: 18,
  },
  // Faction 0 when the whole match is AI (attract mode / headless): a balanced surveyor.
  player: {
    attackFrom: 240,
    attackMargin: 1.15,
    attack: 1.0,
    expand: 0.9,
    economy: 0.9,
    defend: 1.0,
    opportunism: 0.9,
    territory: 40,
    buildOrder: ['drumcircle', 'workshop', 'ward', 'druglab'],
    chakraOrder: ['hoist', 'field', 'fly', 'canton', 'finial'],
    assaultDrug: 'saffron',
    crystals: 0.7,
    hoard: 12,
  },
};

export interface Skill {
  /** Director decision interval (s). */
  decide: number;
  /** Reaction delay before a loop closed around our Hearth is acted on (s). */
  react: number;
  /** Throw aim error radius (m). */
  aim: number;
  /** Chance per decision to use an available ability when it would help. */
  powers: number;
  /** Pull squads against a loop around our Hearth: Flags attacked at once, hands per Flag. */
  squads: number;
  pullers: number;
}

export const SKILLS: Record<Difficulty, Skill> = {
  chill: { decide: 2.5, react: 7, aim: 4, powers: 0.3, squads: 1, pullers: 1 },
  normal: { decide: 1.2, react: 4, aim: 2, powers: 0.6, squads: 2, pullers: 2 },
  hard: { decide: 0.8, react: 2, aim: 1, powers: 0.85, squads: 3, pullers: 2 },
  vexillosaint: { decide: 0.5, react: 0.8, aim: 0.4, powers: 1, squads: 4, pullers: 3 },
};
