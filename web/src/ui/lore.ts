/**
 * Player-facing lore text: title quotes, rival bios, the LIBER HH codex, end-screen
 * lines and tips. Pure data so screens stay layout-only. Tuning numbers that playtests
 * move (capture pressure, Ritual income) are interpolated from sim/constants so the manual
 * never contradicts the rules; the rest mirror docs/design/2026-10-02-flaghack-infinity-3d.md.
 */
import {
  CAPTURE,
  CRYSTAL_RITUAL_PER_SEC,
  DRUG,
  DRUM_RITUAL_PER_SEC,
  OUTPOST_PRESSURE_MULT,
  SUDDEN_DEATH_ESCALATE_EVERY,
  SUDDEN_DEATH_PRESSURE_MULT,
} from '../sim/constants';
import type { FactionId } from '../sim/types';

/** Pressure build rate while the owner holds a contained Hearth in person, as a percentage. */
const HOLD_PCT = Math.round(CAPTURE.contestedMult * 100);

export interface Quote {
  text: string;
  by?: string;
}

/** Title-screen rotation + codex Quotes tab. Bank lines are verbatim from the lore digest. */
export const QUOTES: readonly Quote[] = [
  { text: 'Flags are the end of Flags / And the beginning of 10 thousand Flags', by: 'the Vexillian Scriptures' },
  { text: 'One Flag is the same as two / And all our Flags are One', by: 'the Vexillian Scriptures' },
  { text: 'the man burns away but flag remains' },
  { text: 'I moved a Flag and found myself moved' },
  { text: 'I made a Flag and found that I had been made a Flag' },
  { text: "The Survey will be completed. Survey Flags must be surveyed, it's in their nature." },
  { text: 'Losing the flags is the first step to finding them.' },
  { text: 'I do not want this Flag… It is sticky.' },
  { text: 'A Flag upon a mountain top, higher than the peak.' },
  { text: 'Every statement about Flags is true if you think about it hard enough' },
  { text: "It's not about holding the Flag, it's about using the Flag to hold space" },
  { text: 'Flags are a gateless gate, the invitation to all Madness' },
  { text: 'The Flag Has a Pole, The Pole is a Line, The Line Has a Point' },
  { text: 'Here we see the tools of the Vexillomancer: the Flag and another Flag.' },
  { text: 'Flags appear to be the same size at any distance.', by: 'Canon IV' },
  { text: 'Yellow means there is no master left for you in this world.' },
  { text: 'In truth all Flags are perfectly square. The skew is in their eyes' },
  { text: 'Grasping the sun tightly makes it slip though your fingers' },
  { text: "They get the yellow fabric from a freakin' other dimension!" },
  { text: 'Numbers were just made up by guys who were angry at poets.', by: 'Canon V' },
  { text: 'A Flag arrives long after it was here, and departs long before it arrives.' },
  { text: 'Flags is the herpes of objects', by: 'Dr. Beelzebub Crow' },
  {
    text: 'By finding a Flag, you move from false to true. By moving a Flag, you find the truth in the false.',
  },
  { text: "Who's ready to ASCEND up in this bitch?… Excelsior!" },
  { text: 'The first step to learning advanced knowledge is to forget how to read.', by: 'Mega Harvard' },
  { text: "That's why it's advanced.", by: 'Mega Harvard' },
  { text: 'we cannot yet risk the instability of a fully enlightened society.', by: 'President Jaguar' },
  { text: 'there ought to be flags', by: 'the first vexillomancer' },
  { text: 'Under no conditions should you attempt to play a game that claims to be Flaghack.' },
  { text: "The Acid Cops have an open file on him. It's mostly question marks." },
  // Short direct lines from the digest's page notes.
  { text: 'every Flag had to be within line of sight of two other Flags', by: 'Canon III' },
  { text: 'Five Flags the minimum number.', by: 'Canon III' },
  { text: "The focus is on 'moving' Flags on their map, not 'collecting' them.", by: 'Canon III' },
  { text: "if you do nothing, you're on whichever side is the bad guys.", by: 'Canon II.7' },
  { text: 'the country created in the semiotic blast radius of the perfect configuration of Flags', by: 'on Flagistan' },
  { text: "Use the SOS responsibly! If you want to spam 'TAKE A SHOT', use the retransmit feature.", by: 'D.E.G.E.N. manual' },
  { text: "LoRa antenna unscrews easily. Don't MOOP it!", by: 'D.E.G.E.N. manual' },
  { text: 'A shot does not partly hit a target, it hits or it misses.', by: 'on Retrocausality' },
  { text: 'Proper casting involves placing the flags far enough apart that they cannot all be seen at once.' },
  { text: 'the cold is the lack of activity', by: 'on the fall of Tartaria' },
];

export interface RivalBio {
  /** Short epithet line, e.g. 'Abstractor of the Quintessence · Psywar Correspondent'. */
  epithet: string;
  /** 2-3 short paragraphs (each <= 320 chars) of bio from the digest, lore voice, wry. */
  bio: string[];
  /** One paragraph: how this rival plays in the game. */
  playstyle: string;
  quote: Quote;
}

export const RIVAL_BIOS: Record<FactionId, RivalBio> = {
  0: {
    epithet: 'Abstractor of the Quintessence · Psywar Correspondent',
    bio: [
      'Abstractor of the Quintessence at Mega Harvard. His face has never been seen: the signature balaclava stays on. He founded the Institute for Advanced Levels in 2014, Mega Harvard in 2016 and, with Crow, Mega Harvard LLC in 2034. His Nobels include a Nobel Prize in Nobel Prizes.',
      'He secretly controlled the Too Late Show and later TLN, one of the first hyperconspiracies: too complex ever to be proved or disproved. An enemy of the state and a top target of the Acid Police. Every investigator sent after him has gone insane, missing, or defected.',
      'He is suspected of being able to advance out of control. In 2017 he built the Geomantic Command Center to illustrate Flagistan to hopelessly lost and confused hippies. Tonight the hippies are yours.',
    ],
    playstyle:
      'You. Three quarters of the work is command: set Camp Priorities, plan the Survey from the Command Table, rally hippies with G and send them with H. The last quarter is your own staff and quiver: throw Flags into the hard nodes, pull the critical Flag of a closing enemy loop, plant on their implied nodes. All five chakras, all three drugs and every GCC action are yours, and the rivals answer to exactly the same rules.',
    quote: { text: "It's not about holding the Flag, it's about using the Flag to hold space" },
  },
  1: {
    epithet: 'Host of the Too Late Show · Mogul of TLN',
    bio: [
      'Host of the Too Late Show and mogul of TLN. His Psywar Research Corporation built the memetic weapons that prompted the Noospheric Munitions Act of 2042. Most of his file reads [Redacted].',
      'He has disappeared, and is wanted for high crimes against transhumanity over the GA-FL-AL Tri-State Water Wars. He is suspected to be hiding among the Vexillians, which would explain the crimson ribbons on so many yellow Flags.',
    ],
    playstyle:
      'The Surveyor. Crow expands early and keeps expanding, hunts Crystal Focus points for pentacles and leans hard on Phason Shift: expect your loop nodes to hop out from under your Flags at 60 m range. Canon III will not save you from a Shift; only a Stabilize Zone will. Break his pentacles by pulling one of the five, and watch his C.M.I. climb if you do not.',
    quote: { text: 'Flags is the herpes of objects', by: 'Dr. Beelzebub Crow' },
  },
  2: {
    epithet: 'Sonic Weaponeer · Class III Memetic Event',
    bio: [
      'A sonic weaponeer. The Acid Cops classify his sets as Class III Memetic Events, capable of altering beliefs within a 40-meter radius. Nobody within 40 meters has ever filed a complaint, which the Acid Cops find suspicious.',
      'He worked his way bottom up, in the dirt, in the crowd, and still runs rogue sets at unlicensed burns. The Acid Cops have an open file on him. It is mostly question marks.',
    ],
    playstyle:
      'The Raider. Scarecrow comes early and comes fast: Saffron-dosed hippies under Forced March sprint for the critical Flags of your loops, pull them and steal them home. Wall off your loop Flags, keep some hippies on Defend so SOS pings get answered, and let a Hearth Ward vibe-check his raiders. Survive the rush and his Saffron crash leaves his camp at −30% speed for 20 s.',
    quote: { text: "The Acid Cops have an open file on him. It's mostly question marks." },
  },
  3: {
    epithet: 'Re-elected Forever · Avatar of Lord Egregore',
    bio: [
      'A former Too Late Show contributor who became its arch nemesis and an informant for the PPF, fortified with Mega Harvard intelligence-enhancing drugs. Elected in 2040, he will continue to be elected every 4 years until the heat death of the universe. He wears a robe of royal purple.',
      'Thought to be the avatar of Lord Egregore, he banned enlightening memes under the Noospheric Munitions Act, then exempted the Flags, allegedly for a bribe in pricecoin. Not even the President can untangle a hyperconspiracy.',
      'From 2760 he and his schismmancers hoard Flags until, in 3296, they reach the inflagtion point and fracture the Time Crystal: the Great Chronoschism. Tonight he is merely practising.',
    ],
    playstyle:
      'The Warden. Jaguar builds Tarp Walls and Hearth Wards, hoards Flags in his Hearth, and doses Acid Cop Vision to read your planned nodes through walls. He is slow to start and then closes a huge enclosure late, often as The Burn approaches. Strike before the Wards go up; a Phason Shift does not care how many walls surround a loop node, and his hoard costs his hippies attention.',
    quote: { text: 'we cannot yet risk the instability of a fully enlightened society.', by: 'President Jaguar' },
  },
};

export type CodexBlock =
  | { kind: 'h'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string; by?: string }
  | { kind: 'canon'; title: string; text: string };

/** LIBER HH, tab 'How to Survey'. */
export const CODEX_SURVEY: readonly CodexBlock[] = [
  { kind: 'quote', text: 'Here we see the tools of the Vexillomancer: the Flag and another Flag.' },
  {
    kind: 'p',
    text: 'Every territory on this burn is made of Flags standing on Ley Nodes. Walls protect Flags, hippies carry them, buildings feed them, but nothing else encloses a single facet. Flags are always yellow; only the ribbon at the finial and the colour of the ley light say whose they are.',
  },
  { kind: 'h', text: 'The Quiver' },
  {
    kind: 'list',
    items: [
      '**Quiver**: you carry 10 Flags. Stand within 6 m of your Hearth and the quiver refills from camp stock.',
      '**Plant** (E, or LMB with the flag tool): a 0.2 s tap on a free node within 3.5 m.',
      '**Throw** (Q): a flick at 26 m/s, 0.3 s cooldown. The Flag auto-plants on the nearest free node within 3 m of impact; otherwise it lies loose. A direct hit stuns a hippie for 1 s.',
      '**Pull** (hold E): your own Flag in 0.35 s, an enemy or neutral Flag in a 1.0 s channel. Pulled Flags go to your quiver if there is room, else they drop loose.',
      '**Flagless**: at 0 HP you drop every carried Flag loose and return to your Hearth after 6 s.',
    ],
  },
  { kind: 'h', text: 'Ley Nodes and Ley Lines' },
  {
    kind: 'p',
    text: 'Beneath the grass lies the Ley Lattice: **Ley Nodes** joined by edges 8 m long. One Flag per node; nodes inside tents, domes and trees are blocked. An edge becomes a **Ley Line** only when both of its nodes are held by the same camp, and then it glows in that camp\'s colour.',
  },
  { kind: 'h', text: 'Implied Flags' },
  {
    kind: 'p',
    text: 'When two of your nodes have a free node at their **exact** midpoint, that node holds an **implied Flag** of yours. Implied Flags imply further Flags, up to order 3. They count for Ley Lines, facets, pentacles and enclosure, they cannot be pulled, and they vanish the moment a parent goes.',
  },
  {
    kind: 'p',
    text: 'A real Flag of any camp planted on the node overrides the implication. Planting your own Flag on a rival\'s implied node is the politest way to delete it.',
  },
  {
    kind: 'canon',
    title: 'Flagistan',
    text: 'The midpoint between two Flags is an implied Flag. Midpoints between implied Flags give second-order implied Flags, and so on. At the center is an infinite-order implied Flag, also known as a crystal.',
  },
  { kind: 'h', text: 'The Survey' },
  {
    kind: 'p',
    text: 'A facet whose four nodes are all yours is **crystallized**. Your **Survey** is every facet that cannot reach the edge of the map without crossing one of your Ley Lines. Close a loop and everything inside it is surveyed. Crystallized facets always are.',
  },
  {
    kind: 'p',
    text: 'Where two Surveys overlap, the facet gathers **instability**: shimmer, Flag Psychosis, Crystal discharges and finally phason storms (see The Crystal). The camp with more Flags in the overlap works 20% faster there.',
  },
  { kind: 'h', text: 'Overwriting a Hearth' },
  {
    kind: 'table',
    head: ['Stage', 'Condition'],
    rows: [
      ['**Safe**', 'No enemy Survey facet or enemy Ley Line within 30 m.'],
      ['**Threatened**', 'An enemy Survey facet or enemy Ley Line within 30 m.'],
      ['**Contained**', 'An enemy Survey encloses the Hearth. Pressure builds toward the overwrite.'],
      ['**Contested**', `Contained, but the owner's vexillomancer stands within ${CAPTURE.holdRadius} m (not Flagless) to **Hold the Hearth** in person: pressure builds at ${HOLD_PCT}%.`],
      ['**Overwritten**', 'Pressure reached 100. A 3 s overwrite begins and cannot be stopped.'],
      ['**Captured**', 'The Hearth belongs to the captor.'],
    ],
  },
  {
    kind: 'p',
    text: `Each attacker builds **pressure** from 0 to 100 at a base ${CAPTURE.baseRate} per second, about ${Math.round(100 / CAPTURE.baseRate)} s. When the Hearth is no longer contained, pressure decays ${CAPTURE.decay} per second. With several attackers, the highest pressure leads the overwrite.`,
  },
  {
    kind: 'table',
    head: ['Modifier', 'Pressure'],
    rows: [
      ['Held in person (Contested)', `×${CAPTURE.contestedMult}`],
      ['Each defending hippie within 12 m', '×0.93 (floor 0.5)'],
      ['Hearth Ward within 30 m', '×0.6'],
      ['Each attacker Crystal within 45 m', '×1.15'],
      ['A captured outpost (held by anyone but its founder)', `×${OUTPOST_PRESSURE_MULT}`],
      ['The Burn', `×${SUDDEN_DEATH_PRESSURE_MULT}, then +1 every ${SUDDEN_DEATH_ESCALATE_EVERY / 60} minutes`],
    ],
  },
  {
    kind: 'list',
    items: [
      'On capture the Hearth becomes the captor\'s **outpost Hearth**.',
      'The loser\'s buildings become the captor\'s, disabled until repaired.',
      'Their planted Flags turn neutral, pullable by anyone.',
      'Their hippies turn neutral. Their GCC is destroyed.',
    ],
  },
  {
    kind: 'p',
    text: 'A camp with no Hearth is eliminated. The last vexillomancer with a Hearth wins.',
  },
  { kind: 'h', text: 'The Burn' },
  {
    kind: 'p',
    text: `At **14:00** the Flag effigy on the Omega Node burns. Sudden death: containment pressure ×${SUDDEN_DEATH_PRESSURE_MULT}, rising by one every ${SUDDEN_DEATH_ESCALATE_EVERY / 60} minutes the Burn rages (the clock shows the current ×N), Phason Tides every 40 s, and the pressure bonus of a Crystal on the Omega Node doubled.`,
  },
  { kind: 'h', text: 'Counterplay' },
  {
    kind: 'list',
    items: [
      '**Pull a loop Flag**: any one breaks the enclosure. The HUD marks the loop\'s **critical Flags**.',
      '**Phason Shift** a loop node out from under its Flag.',
      '**Plant on their implied node**: a real Flag overrides the implication.',
      '**Wall off** your own loop Flags with Tarp Walls.',
      `**Hold the Hearth**: stand within ${CAPTURE.holdRadius} m of your contained Hearth and pressure builds at ${HOLD_PCT}% while you are there.`,
      '**Ward**, **Stabilize**, and **Dialectics** their defenders into your camp.',
    ],
  },
  {
    kind: 'canon',
    title: 'Canon II.7',
    text: "Expand the Flag radius or contract it, fighting the obvious moop invasion. If you do nothing, you're on whichever side is the bad guys.",
  },
];

/** LIBER HH, tab 'The Crystal'. */
export const CODEX_CRYSTAL: readonly CodexBlock[] = [
  {
    kind: 'p',
    text: 'The Ley Lattice is no metaphor. It is a genuine **Penrose rhombus tiling**, cast by de Bruijn\'s pentagrid: five families of parallel lines, one per Flag chakra, and every crossing of two lines becomes one rhombus. Its quasicrystal behaviour is the whole of vexillomancy.',
  },
  { kind: 'h', text: 'Sun and Moon Facets' },
  {
    kind: 'list',
    items: [
      '**Sun facets**: thick rhombi, 72° and 108°.',
      '**Moon facets**: thin rhombi, 36° and 144°.',
      'Across the burn, Sun facets outnumber Moon facets by a ratio that tends to **φ**, the golden ratio.',
      'Every node carries an integer **5D Ley coordinate** k ∈ Z⁵, a position on the ground and a hidden position in **perpendicular space**.',
    ],
  },
  {
    kind: 'p',
    text: 'The lattice is centred on the **Omega Node**, a 5-fold star where five Sun facets meet at their points. The Flag effigy stands on it, 26 m of wood waiting for The Burn.',
  },
  { kind: 'h', text: 'Phason Flips' },
  {
    kind: 'p',
    text: 'The Crystal turns. In a **phason flip** a node with three neighbours hops across its hexagon, from v to v + e1 + e2 + e3, and the three facets around it re-tile. Any Flag on that node **decoheres**: it falls loose at its old spot and its Ley Lines snap.',
  },
  {
    kind: 'p',
    text: 'Every 75 s a **Phason Tide** flips about 5% of the flippable nodes, after a 10 s warning: "The Crystal is turning…". Tides favour nodes under high **perpendicular strain**, so the lattice heals itself back toward perfect Penrose order. After The Burn the tides come every 40 s.',
  },
  { kind: 'h', text: 'Observation Freezes the Crystal' },
  {
    kind: 'canon',
    title: 'Canon III',
    text: 'every Flag had to be within line of sight of two other Flags… Five Flags the minimum number.',
  },
  {
    kind: 'p',
    text: 'A watched Crystal never turns. Tides skip any node whose Flag is **observed** by its owner. A node is observed by your camp when it is:',
  },
  {
    kind: 'list',
    items: [
      'held by a Flag with Ley Lines to **two or more** other Flags (Canon III: the Flag observes itself);',
      'within 12 m of you, the vexillomancer;',
      'within 30 m of your Geomantic Command Center;',
      'within 22 m of your Hearth;',
      'within 26 m of one of your Hearth Wards;',
      'inside one of your Stabilize Zones.',
    ],
  },
  {
    kind: 'p',
    text: 'Empty nodes flip freely. A completed loop is tide-proof; a dangling, half-built pattern is not. **Finish your casting.**',
  },
  {
    kind: 'p',
    text: '**Phason Shift**, the Field chakra, flips a node on purpose at up to 60 m. It ignores Canon III. Only a Stabilize Zone blocks it, which makes it the precision answer to a finished loop.',
  },
  { kind: 'h', text: 'Focus Points and Pentacles' },
  {
    kind: 'p',
    text: 'Every 5-fold star vertex is a **Crystal Focus**. Focus points are invisible, and they appear and vanish as phasons flip. Geomantic Advice reveals them within 30 m of your GCC; Luminous Dust reveals them all.',
  },
  {
    kind: 'p',
    text: 'Hold all five neighbours of a focus, the canonical five Flags, and you have a **pentacle**. Within 3 s a **Crystal** manifests on the focus:',
  },
  {
    kind: 'list',
    items: [
      `+${CRYSTAL_RITUAL_PER_SEC} Ritual per second for its owner;`,
      '+15% containment pressure on enemy Hearths within 45 m;',
      'observes every node within 10 m;',
      'adds to your **C.M.I.**',
    ],
  },
  {
    kind: 'p',
    text: 'A Crystal shatters when its pentacle breaks or its focus node flips. Pull one of the five and it is gone.',
  },
  { kind: 'h', text: 'Flag Simulacra' },
  {
    kind: 'p',
    text: 'The GCC can plant one Flag on **two nodes at once**. The superposed Flag counts as real on both, until an enemy unit comes within 10 m of either: then it collapses, 50/50, onto one node and the other vanishes with a glitch.',
  },
  {
    kind: 'quote',
    text: 'Proper casting involves placing the flags far enough apart that they cannot all be seen at once.',
  },
  { kind: 'h', text: 'Interference' },
  {
    kind: 'p',
    text: 'A facet inside two or more Surveys gathers instability from 0 to 1 at +0.08 per second, and sheds it at 0.15 per second once the overlap ends.',
  },
  {
    kind: 'table',
    head: ['Instability', 'Effect'],
    rows: [
      ['≥ 0.35', 'Shimmer and moiré. **Flag Psychosis**: hippies inside lose attention twice as fast.'],
      ['≥ 0.65', '**Crystal discharge**: lightning every few seconds, stunning units 1.2 s and dealing 25 damage to pieces and buildings.'],
      ['≥ 0.9', '**Phason storms**: unobserved nodes flip on their own.'],
    ],
  },
  {
    kind: 'p',
    text: 'In any overlap, the camp holding more Flags **resonates**: its hippies work 20% faster there.',
  },
  { kind: 'h', text: 'C.M.I.' },
  {
    kind: 'p',
    text: 'The **Crystal Manifestation Index** is the old 2017 score, kept on the brass counter at bottom right. For each Crystal you own it adds 100 plus 10 for every 10 seconds the Crystal has lived, and 1 more for every facet of your Survey. It is a measure, not a currency: nothing is bought with it, and it never wins a game by itself.',
  },
  { kind: 'quote', text: 'One Flag is the same as two / And all our Flags are One', by: 'the Vexillian Scriptures' },
];

/** LIBER HH, tab 'Camp'. */
export const CODEX_CAMP: readonly CodexBlock[] = [
  { kind: 'h', text: 'Signifiers' },
  {
    kind: 'p',
    text: 'Your hippies, the **Signifiers**, do most of the work of the Survey. Each runs at 5.5 m/s, has 100 vibes, carries one Flag or 10 lumber, and has **attention** from 0 to 100.',
  },
  {
    kind: 'p',
    text: 'Attention drains 1 per second while working, 2 per second inside instability. At 0 a hippie is distracted and wanders to the nearest sound camp for 10 s, returning at 60. Idle hippies recover 4 per second near your Hearth or a Drum Circle. A hippie knocked to 0 vibes drops what it carries and returns to your Hearth after 14 s.',
  },
  { kind: 'h', text: 'Jobs and Orders' },
  {
    kind: 'list',
    items: [
      '**Survey**: fetch a Flag and plant it on the nearest planned node.',
      '**Gather**: chop a lumber pile, haul it home.',
      '**Defend**: guard the Hearth, answer SOS, shove intruders, pull enemy Flags inside your Survey.',
      '**Raid**: pull the enemy Flags that threaten your Hearth first, else those on the nearest enemy Survey boundary, and steal them home.',
      '**Ritual**: drum at a Drum Circle.',
    ],
  },
  {
    kind: 'p',
    text: 'Set each job from 0 to 4 in **Camp Priorities**; idle hippies divide themselves by those weights. From the Command View, select hippies and right click to give direct orders. On foot, **G** rallies every hippie within 25 m to follow you and **H** sends your followers at the crosshair.',
  },
  {
    kind: 'canon',
    title: 'Hoarding Is Villainy',
    text: 'Hoarding Flags caused the fall of Tartaria. Keep more than 24 Flags in your Hearth stock and your hippies\' attention drains 50% faster, for the cold is the lack of activity.',
  },
  { kind: 'h', text: 'Buildings' },
  {
    kind: 'p',
    text: 'Camp buildings snap to the centre of a Sun facet **inside your own Survey** and complete in 8 s, faster with a hippie helping. At 0 HP they are disabled until hippies repair them.',
  },
  {
    kind: 'table',
    head: ['Building', 'Lumber', 'Effect'],
    rows: [
      ['**Flag Hearth**', '—', '1500 HP. Crafts 1 Flag every 8 s for 4 lumber and keeps your stock. Cannot be destroyed, only overwritten.'],
      ['**Flag Workshop**', '80', '+1 Flag every 5 s for 3 lumber.'],
      ['**Drum Circle**', '80', `Recruits 1 hippie every 14 s for 1 Flag + 10 lumber. +6 pop cap. Up to 4 drummers, +${DRUM_RITUAL_PER_SEC} Ritual/s each.`],
      ['**Hearth Ward**', '120', '−40% enemy pressure on your Hearths within 30 m. Observes 26 m. Vibe-check pulse every 4 s: enemy hippies within 14 m stunned 1 s, 10 damage.'],
      ['**Drug Lab**', '100', 'Brews one dose every 22 s for 25 lumber, up to 3 of each drug.'],
    ],
  },
  { kind: 'h', text: 'Pieces' },
  {
    kind: 'p',
    text: 'Pieces cost 10 lumber, pop in instantly and have 150 HP: **Z** Tarp Wall on a Ley edge, **X** Deck on a facet, **C** Ramp up one level, **V** Demolish your own piece for a 5 lumber refund. Levels run 0 to 3; anything above ground needs support from the level below.',
  },
  { kind: 'h', text: 'The Geomantic Command Center' },
  {
    kind: 'p',
    text: 'A black pentagonal cart with Flag-spoked wheels and a tabletop map of the burn. Use the **Command Table** to dive into the Command View. Push the cart with E at 4 m/s. If it collapses it is rebuilt at your Hearth after 45 s.',
  },
  {
    kind: 'list',
    items: [
      '**Geomantic Advice**: reveals the lattice and focus points within 30 m and observes those nodes.',
      '**Flag Repair**: every 3 s re-plants one loose Flag of yours within 20 m and mends your pieces and buildings there.',
      '**Flag Gifts** (3 s cooldown): spend 1 Flag to recruit a neutral hippie within 15 m.',
      '**Flagellian Dialectics** (40 s cooldown, 3 s channel at the cart): converts up to 3 enemy hippies within 14 m.',
      '**Flag Simulacra** (20 s cooldown): one Flag on two nodes at once.',
    ],
  },
  { kind: 'h', text: 'Drugs' },
  {
    kind: 'table',
    head: ['Drug', 'Effect', 'Risk'],
    rows: [
      ['**Saffron** (Vexillicrocus tea)', `40 s: every hippie +50% work and move speed; +${DRUG.saffronRitualPerSec} Ritual/s.`, '20 s crash at −30% speed; each hippie has a 25% chance to wander off overstimulated.'],
      ['**Luminous Dust**', '30 s: the whole lattice, focus points, strain and enemy simulacra revealed; your throws snap within 5 m.', 'Screen distortion, minimap noise, and 3–5 hallucinated False Flags.'],
      ['**Acid Cop Vision**', '30 s: every rival\'s hippies, tasks, planned nodes and avatar, through walls.', 'Paranoia: attention drains ×2; phantom pursuers on your minimap.'],
    ],
  },
  { kind: 'h', text: 'The D.E.G.E.N. Mesh' },
  {
    kind: 'p',
    text: 'Every hippie carries a **D.E.G.E.N. Beacon**, the Distributed Entity Geolocation and Entity Navigator. Your mesh shows each hippie\'s position and status on the minimap, the Command View and the roster. Rival meshes stay dark.',
  },
  {
    kind: 'list',
    items: [
      '**Pings**: Rally, Attack, Flag-here and SOS (P or middle mouse).',
      '**SOS**: a hurt hippie pings on its own; Defend hippies within 60 m respond.',
      '**Retransmit: TAKE A SHOT** (60 s cooldown): every hippie on your mesh gains 35 attention and wobbles for 2 s.',
      '**MOOP**: a knocked-out enemy may drop its beacon. Pick it up to tap that camp\'s mesh for 30 s.',
    ],
  },
  {
    kind: 'quote',
    text: "Use the SOS responsibly! If you want to spam 'TAKE A SHOT', use the retransmit feature.",
    by: 'D.E.G.E.N. manual',
  },
  { kind: 'h', text: 'Chakras' },
  {
    kind: 'p',
    text: 'Five **Flag chakras**, one per Ley direction, named for the anatomy of a Flag: **Hoist** (Priority Beacon), **Fly** (Forced March), **Canton** (Stabilize Zone), **Field** (Phason Shift) and **Finial** (Omega Pulse). Align them with Ritual at your Hearth in a 4 s channel: 30, 70 and 130 Ritual for levels 1, 2 and 3. Ritual comes from drumming, Crystals and Saffron, never from the size of your Survey.',
  },
];

/** End-screen flavour lines; screen title is 'FLAGISTAN APPROACHES'. */
export const VICTORY_LINES: readonly string[] = [
  'The last Hearth on the burn crafts Flags in your colour.',
  'Every Ley Line hums one chord. Beyond the perceptual horizon, Flagistan draws one facet nearer.',
  'Losing the flags was the first step to finding them. You found all of them.',
  'The Survey will be completed. Tonight it was completed by you.',
];

/** End-screen flavour lines; screen title is 'YOUR SURVEY HAS BEEN OVERWRITTEN'. */
export const DEFEAT_LINES: readonly string[] = [
  'Your Hearth now crafts Flags for someone else.',
  'Your hippies wander the burn, neutral and unbeaconed, in search of a sound camp.',
  'The man burns away but flag remains. The Flags were never yours; they were only resting.',
];

/** One-sentence gameplay tips in lore voice. */
export const TIPS: readonly string[] = [
  'Pull any one Flag of a closing loop and the whole enclosure falls; the HUD marks the critical ones.',
  'A Flag with Ley Lines to two others observes itself, so a finished loop shrugs off the Phason Tide.',
  'Phason Shift ignores Canon III; only a Stabilize Zone keeps a node from hopping.',
  'Plant a real Flag on a rival\'s implied node and the implication evaporates.',
  'Your quiver refills from Hearth stock whenever you stand within 6 m of the Hearth.',
  'A thrown Flag plants itself on the nearest free node within 3 m of where it lands.',
  'Keep more than 24 Flags in your Hearth and your hippies\' attention drains 50% faster: hoarding is villainy.',
  `Break the loop and the siege unwinds: pressure on a Hearth that is no longer contained decays ${CAPTURE.decay} per second.`,
  'Every defending hippie within 12 m of a Hearth slows the overwrite, down to half speed.',
  'A Crystal adds 15% containment pressure to every enemy Hearth within 45 m.',
  'Five Flags around a hidden Crystal Focus make a pentacle; Geomantic Advice and Luminous Dust show where.',
  `Stand within ${CAPTURE.holdRadius} m of your contained Hearth to Hold it in person: pressure builds at ${HOLD_PCT}% while you are there.`,
  `At 14:00 the Flag burns: pressure doubles, then burns hotter every ${SUDDEN_DEATH_ESCALATE_EVERY / 60} minutes, and the Crystal turns every 40 s.`,
  'Saffron is fast and the crash is faster; dose before the push, not during the defence.',
  'Answer SOS pings: Defend hippies within 60 m come running, and so should you.',
  'Retransmit TAKE A SHOT when attention runs low; it gives every hippie 35 more.',
  'An enemy beacon dropped in the dirt taps their mesh for 30 s. MOOP responsibly.',
  'Overlapping Surveys grow unstable; above 0.65 the Crystal discharges lightning on everyone inside.',
];
