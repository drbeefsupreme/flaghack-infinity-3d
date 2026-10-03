/**
 * The burn's tonality: A minor pentatonic (A C D E G). Every pitched sound in the game (music,
 * plant chimes, ley hums, crystal choirs) is drawn from it, so anything layered with anything
 * else stays consonant: fifty Flags planted in a second still sound like one instrument.
 */
import type { Lattice } from '../sim/lattice/lattice';

/** Semitone offsets of the five pentatonic degrees above A. */
export const PENTA: readonly number[] = [0, 3, 5, 7, 10];

/** MIDI note of A1 (55 Hz); scale-degree arithmetic starts here. */
export const A1 = 33;

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** MIDI note of pentatonic degree `deg` (any integer; 5 degrees per octave) above `base`. */
export function degreeMidi(deg: number, base = A1): number {
  const oct = Math.floor(deg / 5);
  const d = deg - oct * 5;
  return base + oct * 12 + PENTA[d];
}

export function degreeHz(deg: number, base = A1): number {
  return midiHz(degreeMidi(deg, base));
}

/**
 * Every Ley Node sings its own note. The 5D Ley coordinate k projects onto a pentatonic
 * degree via Σ j·k_j (mod 5): the five pentagrid families are the five notes, so stepping
 * across a Ley Line of family j always moves by j degrees and each family has its own
 * interval. The pentagrid index Σk picks the octave.
 */
export function nodeDegree(lat: Lattice, node: number): number {
  const n = lat.nodes[node];
  if (!n) return 0;
  const k = n.k;
  let s = 0;
  let idx = 0;
  for (let j = 0; j < 5; j++) {
    s += j * k[j];
    idx += k[j];
  }
  const deg = ((s % 5) + 5) % 5;
  const oct = ((idx % 3) + 3) % 3;
  return deg + oct * 5;
}

/** Chord voicings (MIDI) used by the pads; all notes inside A minor pentatonic. */
export type ChordName = 'Am' | 'C' | 'Dsus' | 'Em' | 'G' | 'Asus';

export const CHORDS: Record<ChordName, readonly number[]> = {
  Am: [45, 52, 55, 60, 64],
  C: [48, 55, 62, 64, 69],
  Dsus: [50, 57, 60, 64, 67],
  Em: [52, 57, 62, 67, 69],
  G: [43, 50, 57, 60, 64],
  Asus: [45, 52, 57, 62, 64],
};

/** Weighted Markov transitions; the match leans minor, the title screen leans to the relative major. */
export const MATCH_MOVES: Record<ChordName, readonly [ChordName, number][]> = {
  Am: [['C', 3], ['Dsus', 2], ['G', 2], ['Em', 2], ['Asus', 1]],
  C: [['G', 3], ['Am', 3], ['Dsus', 2]],
  Dsus: [['Am', 3], ['Em', 2], ['G', 1]],
  Em: [['Am', 3], ['C', 2], ['Dsus', 1]],
  G: [['Am', 3], ['C', 2], ['Em', 2]],
  Asus: [['Am', 4], ['Dsus', 1]],
};

export const TITLE_MOVES: Record<ChordName, readonly [ChordName, number][]> = {
  Am: [['C', 3], ['G', 2], ['Asus', 1]],
  C: [['G', 3], ['Asus', 2], ['Am', 1]],
  Dsus: [['C', 2], ['G', 2]],
  Em: [['C', 2], ['Asus', 2]],
  G: [['C', 3], ['Dsus', 2], ['Em', 1]],
  Asus: [['C', 2], ['G', 2], ['Am', 1]],
};

export function pickChord(from: ChordName, table: Record<ChordName, readonly [ChordName, number][]>): ChordName {
  const moves = table[from];
  let total = 0;
  for (const m of moves) total += m[1];
  let r = Math.random() * total;
  for (const m of moves) {
    r -= m[1];
    if (r <= 0) return m[0];
  }
  return moves[0][0];
}
