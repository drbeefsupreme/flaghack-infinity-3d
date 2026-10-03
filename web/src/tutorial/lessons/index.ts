/** The Training Burn's lesson scripts, in course order (course.ts lists the same ids). */
import type { LessonScript } from '../lesson';
import { arrival, flag, implied, ley, phason, survey } from './basics';
import { build, command, crystal } from './camp';
import { conquest, defense, graduation } from './siege';

export const LESSONS: readonly LessonScript[] = [arrival, flag, ley, survey, implied, phason, command, build, crystal, defense, conquest, graduation];
