/** Shared spatial grade mapping: post-grade map symbols must follow the displayed world. */
export const SCENE_UV_GLSL = /* glsl */ `
vec2 fhSceneUv(vec2 uv, float aspect, float time, float acid, float instability) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  if (instability > 0.002) {
    uv += instability * 0.0025 * vec2(sin(p.y * 15.0 + time * 2.1), sin(p.x * 12.0 - time * 1.7));
  }
  if (acid > 0.002) {
    uv = 0.5 + (uv - 0.5) * (1.0 - 0.016 * acid * sin(time * 0.85));
    uv += acid * 0.004 * vec2(sin(uv.y * 11.0 + time * 1.3), sin(uv.x * 9.0 - time * 1.1));
  }
  return uv;
}
`;

/** Same normalization for the world grade and the post-grade marker anchors. */
export function postInstability(raw: number): number {
  const k = Math.max(0, Math.min(1, (raw - 0.25) / (0.7 - 0.25)));
  return k * k * (3 - 2 * k);
}
