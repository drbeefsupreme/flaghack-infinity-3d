/** Status-effect helpers shared by every system. */
import type { EffectKind, EntityId, StatusEffect } from '../types';
import type { World } from '../world';

export function applyEffect(
  world: World,
  target: { effects: StatusEffect[] },
  kind: EffectKind,
  duration: number,
  mag = 1,
  source: EntityId | -1 = -1,
): void {
  const until = world.time + duration;
  const existing = target.effects.find((e) => e.kind === kind);
  if (existing) {
    existing.until = Math.max(existing.until, until);
    existing.mag = Math.max(existing.mag, mag);
    existing.source = source;
  } else {
    target.effects.push({ kind, until, mag, source });
  }
}

export function hasEffect(world: World, target: { effects: StatusEffect[] }, kind: EffectKind): boolean {
  for (const e of target.effects) if (e.kind === kind && e.until > world.time) return true;
  return false;
}

/** Drop expired effects; call once per tick per unit. */
export function pruneEffects(world: World, target: { effects: StatusEffect[] }): void {
  if (target.effects.length === 0) return;
  target.effects = target.effects.filter((e) => e.until > world.time);
}

/**
 * Combined movement/work speed multiplier from active effects.
 * march ×(1+mag), saffron ×(1+mag), beacon ×1.25, resonance ×1.2, exhausted/crash ×(1-mag).
 */
export function speedMultiplier(world: World, target: { effects: StatusEffect[] }): number {
  let m = 1;
  for (const e of target.effects) {
    if (e.until <= world.time) continue;
    switch (e.kind) {
      case 'march':
      case 'saffron':
        m *= 1 + e.mag;
        break;
      case 'beacon':
        m *= 1.25;
        break;
      case 'resonance':
        m *= 1.2;
        break;
      case 'exhausted':
      case 'crash':
        m *= 1 - e.mag;
        break;
      case 'stun':
        return 0;
      default:
        break;
    }
  }
  return m;
}
