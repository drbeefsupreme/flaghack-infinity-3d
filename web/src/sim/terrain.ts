/** Gameplay terrain shared by authority, mirrors and rendering (metres).
 * The arena is square: all four edges, including corners, remain at zero.
 * A quartic falloff on each axis makes a gentle dome with a horizontal tangent
 * at its summit and border, without diagonal seams or changing the XZ layout.
 */
export const TERRAIN_DOME_HEIGHT = 2;
export function groundHeight(x: number, z: number, half: number): number {
  if (half <= 0 || Math.abs(x) >= half || Math.abs(z) >= half) return 0;
  const a = 1 - (x / half) ** 2;
  const b = 1 - (z / half) ** 2;
  return TERRAIN_DOME_HEIGHT * a * a * b * b;
}

/** Shader equivalent; caller supplies the map half extent (no hidden uniform). */
export const TERRAIN_GLSL = `
float groundHeight(vec2 p, float halfExtent) {
  vec2 q = max(vec2(0.0), vec2(1.0) - (p / halfExtent) * (p / halfExtent));
  return 2.0 * q.x * q.x * q.y * q.y;
}
`;
