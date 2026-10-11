/** Authored emissive content, not an inference from a random tint or current quality.
 * Mirrors render these same variants in render/env/props/{art,cars,stages,domes}. */
import type { Obstacle } from '../../map/mapgen';
export function bossSceneryBrightness(obstacle: Obstacle): number {
  if (obstacle.kind === 'art') {
    // Seven-band LED rainbow arch and animated rainbow LED totem.
    if (obstacle.variant === 1 || obstacle.variant === 4) return 3;
    // Bioluminescent mushrooms, LED-edged spiral and neon pyramid. Flag pinwheels are unlit.
    if (obstacle.variant === 0 || obstacle.variant === 2 || obstacle.variant === 5) return 2;
  }
  // Camper bus has a cycling rainbow stripe, rooftop glow, and fairy lights.
  if (obstacle.kind === 'car' && obstacle.variant === 2) return 3;
  // Lit stage signs/truss fixtures and geodesic dome node lights.
  if (obstacle.kind === 'stage') return 2;
  if (obstacle.kind === 'dome') return 1;
  return 0;
}
