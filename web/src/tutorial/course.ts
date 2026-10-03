/**
 * The Training Burn's course: every lesson in order with the Seal of Flagistan fragment it
 * awards. Pure data (the title screen reads it through progress.ts without the director).
 */
import type { TutorialLessonInfo } from './types';

export const COURSE: readonly TutorialLessonInfo[] = [
  { id: 'arrival', index: 1, title: 'Arrival', seal: 'The Dust' },
  { id: 'flag', index: 2, title: 'The Flag', seal: 'The Pole' },
  { id: 'ley', index: 3, title: 'Ley Lines', seal: 'The Line' },
  { id: 'survey', index: 4, title: 'The Survey', seal: 'The Facet' },
  { id: 'implied', index: 5, title: 'The Implied Flag', seal: 'The Midpoint' },
  { id: 'phason', index: 6, title: 'The Crystal Turns', seal: 'The Turning' },
  { id: 'command', index: 7, title: 'The Command Table', seal: 'The Table' },
  { id: 'build', index: 8, title: 'Tarp and Timber', seal: 'The Tarp' },
  { id: 'crystal', index: 9, title: 'Crystals and Chakras', seal: 'The Pentacle' },
  { id: 'defense', index: 10, title: 'Hold the Hearth', seal: 'The Hearth' },
  { id: 'conquest', index: 11, title: 'The Overwrite', seal: 'The Overwrite' },
  { id: 'graduation', index: 12, title: 'Graduation', seal: 'The Omega' },
];
