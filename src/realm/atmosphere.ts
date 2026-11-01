import * as THREE from 'three'

// State every part's shaders read: the clock and the wind. Each part hands
// these exact uniform objects to its materials (never copies), so the host
// moves them once per frame and every shader follows.

export const SUN_DIRECTION = new THREE.Vector3(-0.62, 0.33, -0.71).normalize()

export const realmUniforms = {
  uTime: { value: 0 },
  // wind direction in the xz plane times its strength (0 calm .. 1 strong)
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  // gusts travel across the island; 0..1, eased by the host
  uGust: { value: 0.5 },
}

// GLSL shared by every swaying thing (grass, leaves, petals, ropes). Include it
// in a vertex shader after declaring `uniform float uTime; uniform vec2 uWind;
// uniform float uGust;`. windSway returns a world-space offset for a point at
// `world` that sways with amplitude `amount` (metres at full wind).
export const WIND_GLSL = /* glsl */ `
float realmHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float realmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(realmHash(i), realmHash(i + vec2(1.0, 0.0)), u.x),
             mix(realmHash(i + vec2(0.0, 1.0)), realmHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// slow travelling gust field, 0..1
float realmGust(vec2 xz) {
  vec2 dir = normalize(uWind + vec2(1e-4));
  vec2 p = xz * 0.045 - dir * uTime * 0.35;
  return smoothstep(0.25, 0.85, realmNoise(p) * 0.7 + realmNoise(p * 2.7 + 7.1) * 0.3);
}
vec3 windSway(vec3 world, float amount) {
  float strength = length(uWind);
  vec2 dir = uWind / max(strength, 1e-4);
  float gust = realmGust(world.xz) * (0.55 + 0.45 * uGust);
  float flutter = sin(uTime * 2.3 + world.x * 0.9 + world.z * 0.7) * 0.5
                + sin(uTime * 3.7 + world.x * 1.7 - world.z * 1.3) * 0.25;
  float push = strength * (0.35 + gust * 0.9) + flutter * strength * 0.25;
  return vec3(dir.x, 0.0, dir.y) * push * amount;
}
`

// the size the scene itself is drawn at, in pixels (set by the post chain):
// the canvas keeps the screen's own size and the last pass scales the scene
// up to it, so parts that size their targets by the drawn scene read this
export const sceneSize = new THREE.Vector2(1, 1)
