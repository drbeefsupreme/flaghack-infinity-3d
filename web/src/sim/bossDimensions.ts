/** One scale source for the authored rig and all proportional gameplay dimensions. */
export const BOSS_HEIGHT = 32;
export const BOSS_SOURCE_HEIGHT = 32;
/** The original rig is authored at32m; no geometry or proportions need changing. */
export const BOSS_MODEL_SCALE = BOSS_HEIGHT / BOSS_SOURCE_HEIGHT;
/** Converts gameplay distances originally tuned at20m. Explicit blast/detection ranges do not use it. */
export const BOSS_GAMEPLAY_SCALE = BOSS_HEIGHT / 20;
