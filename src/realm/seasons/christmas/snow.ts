import * as THREE from 'three'
import { realmUniforms } from '../../atmosphere'
import { EMA_RACK, LANTERNS, SHRINE, TERRACE_Y, groundHeight, rng } from '../../layout'
import type { Frame, RealmPart, Tier } from '../../types'
import { light } from './light'
import { evening } from './state'

// Light snow: soft round flakes in a column that travels with the eyes. Every
// flake has a fixed place in a box of world space that wraps around the
// camera, so the snow stays put in the world while the view turns and walks,
// and one instanced draw covers it all. A flake drifts down slowly on the
// wind and sways on its own small circle as it tumbles. It is never drawn
// smaller than about a pixel: past that it only grows fainter, so far flakes
// stay soft instead of sparkling. It shows the sky's cool light, a little
// more toward the last of the sun, and the lanterns it passes. Near the lens
// it thins out, so it never crowds the view.

const FALL = 0.85 // metres a second
const BOX = { r: 12, h: 12 } // half width of the column, its height

const VERT = /* glsl */ `
uniform float uSnowTime;
uniform float uSnow;
uniform float uGain;
uniform float uLive;
uniform float uPixel;
uniform vec2 uWind;
uniform vec3 uSunDir;
uniform vec3 uKey;
uniform vec3 uLanterns[${LANTERNS.length}];
uniform vec4 uShrine;
uniform vec4 uRack;

attribute vec4 aSeed;

varying vec2 vUv;
varying vec3 vColor;

const float R = ${BOX.r.toFixed(1)};
const float H = ${BOX.h.toFixed(1)};

// the shrine's roof as two planes from the ridge down to the eaves
bool underShrine(vec3 p) {
  vec2 q = p.xz - uShrine.xy;
  if (abs(q.x) > 4.75 || q.y > 4.5 || q.y < -3.05) return false;
  float roof = q.y >= -0.2 ? mix(6.05, 3.1, (q.y + 0.2) / 4.6) : mix(6.05, 3.8, (-0.2 - q.y) / 2.75);
  return p.y < uShrine.z + roof;
}

// the rack's little roof
bool underRack(vec3 p) {
  vec2 q = p.xz - uRack.xy;
  float c = cos(uRack.w);
  float s = sin(uRack.w);
  vec2 l = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  return abs(l.x) < 1.2 && abs(l.y) < 0.5 && p.y < uRack.z;
}

void main() {
  float rnd = aSeed.w;
  // the snow's strength thins the flakes rather than dimming them all
  float keep = step(rnd, uSnow);
  float speed = ${FALL.toFixed(2)} * (0.7 + 0.6 * fract(rnd * 7.31));
  float t = uSnowTime + rnd * 9.0;
  vec3 box = vec3(2.0 * R, H, 2.0 * R);
  vec3 origin = cameraPosition - vec3(R, H * 0.62, R);
  vec3 p = aSeed.xyz * box + vec3(uWind.x * 0.9, -speed, uWind.y * 0.9) * t;
  p = mod(p - origin, box) + origin;
  // each flake's own slow circle, a hand's width across
  float ph = fract(rnd * 3.17) * 6.2832;
  float rate = 0.6 + 0.8 * fract(rnd * 5.3);
  p += vec3(sin(t * rate + ph), 0.0, cos(t * rate * 0.83 + ph)) * 0.12;

  vec3 toFlake = p - cameraPosition;
  float d = length(toFlake);
  vec3 V = toFlake / max(d, 1e-3);
  // the column's walls and ends, and the space just in front of the lens:
  // each flake fades at its own distance there, so fewer come near
  float fade = 1.0 - smoothstep(R * 0.68, R * 0.98, length(toFlake.xz));
  float hy = (p.y - origin.y) / H;
  fade *= smoothstep(0.0, 0.08, hy) * (1.0 - smoothstep(0.9, 1.0, hy));
  float near = 0.9 + 2.4 * fract(rnd * 13.7);
  fade *= smoothstep(near, near + 1.5, d);
  fade *= keep * uLive;
  if (underShrine(p) || underRack(p)) fade = 0.0;

  // a flake faces the eyes; its size is real until it would fall under a
  // pixel, then it keeps its light and spreads it thinner
  vec3 right = cross(V, vec3(0.0, 1.0, 0.0));
  float rl = length(right);
  right = rl > 1e-3 ? right / rl : vec3(1.0, 0.0, 0.0);
  vec3 up = cross(right, V);
  float phys = 0.005 * (0.6 + 0.8 * fract(rnd * 11.3));
  float rad = max(phys, uPixel * d * 1.1);
  float thin = (phys * phys) / (rad * rad);
  vec3 world = p + (right * position.x + up * position.y) * rad;
  vUv = position.xy;

  // ice scatters every way, a little more forward toward the light
  float sun = max(dot(V, uSunDir), 0.0);
  vec3 col = uKey * (0.07 + 0.2 * sun * sun * sun * sun) * 0.1;
  col += vec3(0.045, 0.06, 0.095);
  // the lanterns' warm light on the flakes passing them
  float warm = 0.0;
  for (int i = 0; i < ${LANTERNS.length}; i++) {
    vec3 l = uLanterns[i] - p;
    float dl2 = dot(l, l);
    if (dl2 > 16.0) continue;
    warm += 0.6 / (1.0 + dl2 * 2.2) * (1.0 - dl2 / 16.0);
  }
  col += vec3(1.0, 0.6, 0.28) * warm * 0.5;
  vColor = col * uGain * fade * thin;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  if (fade <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;

void main() {
  float r2 = dot(vUv, vUv);
  // a soft round flake with no hard rim
  float a = exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, r2));
  gl_FragColor = vec4(vColor * a, 0.0);
}
`

class Snow implements RealmPart {
  readonly object = new THREE.Group()
  readonly kind = 'Snow'
  private geometry: THREE.InstancedBufferGeometry
  private material: THREE.ShaderMaterial
  private camera: THREE.Camera | null = null
  private size = new THREE.Vector2()
  private key = new THREE.Vector3()

  constructor(tier: Tier) {
    const count = tier === 'ultra' ? 4200 : tier === 'high' ? 3200 : 1400
    const rand = rng(61031)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3))
    g.setIndex([0, 1, 2, 2, 1, 3])
    const seeds = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) seeds[i] = rand()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = count
    this.geometry = g

    const lanterns = LANTERNS.map((l) => new THREE.Vector3(l.x, groundHeight(l.x, l.z) + 1.29, l.z))
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSnowTime: { value: 0 },
        uSnow: evening.uSnow,
        uGain: { value: 3 },
        uLive: { value: 1 },
        uPixel: { value: 0.001 },
        uWind: realmUniforms.uWind,
        uSunDir: evening.uSunDir,
        uKey: { value: this.key },
        uLanterns: { value: lanterns },
        uShrine: { value: new THREE.Vector4(SHRINE.x, SHRINE.z, TERRACE_Y, 0) },
        uRack: { value: new THREE.Vector4(EMA_RACK.x, EMA_RACK.z, groundHeight(EMA_RACK.x, EMA_RACK.z) + 2.15, EMA_RACK.rotation) },
      },
      // light only adds; the target's alpha is left alone
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    const mesh = new THREE.Mesh(g, this.material)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    // after the water and every other see-through layer, so none covers it
    mesh.renderOrder = 20
    mesh.onBeforeRender = (renderer, _scene, camera) => {
      // only the eyes see the snow, not the pond's mirror or the clouds' depth
      const u = this.material.uniforms
      u.uLive!.value = camera === this.camera ? 1 : 0
      const target = renderer.getRenderTarget()
      const h = target ? target.height : renderer.getDrawingBufferSize(this.size).y
      const cam = camera as THREE.PerspectiveCamera
      u.uPixel!.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 50) / 2)) / Math.max(1, h)
      this.material.uniformsNeedUpdate = true
    }
    this.object.add(mesh)
  }

  update(frame: Frame): void {
    this.camera = frame.camera
    // under reduced motion the snow hangs where it is
    this.material.uniforms.uSnowTime!.value += frame.dt * frame.motion
    const c = light.keyColor
    this.key.set(c.r, c.g, c.b).multiplyScalar(light.keyIntensity)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export const snowParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = [(tier) => new Snow(tier)]
