import * as THREE from 'three'
import { realmUniforms } from '../atmosphere'
import { EMA_RACK, LANTERNS, SHRINE, TERRACE_Y, groundHeight, rng } from '../layout'
import type { Frame, RealmPart, Tier } from '../types'
import { light } from './light'
import { hallow } from './state'

// The gentle red rain: thin streaks in a column that travels with the eyes.
// Every drop has a fixed place in a box of world space that wraps around the
// camera, so the rain stays put in the world while the view turns and walks,
// and one instanced draw covers it all. A drop is a streak as long as it falls
// in a frame's shutter, never thinner than a pixel and a half: past that it
// only grows fainter, so far streaks stay soft instead of aliasing. It shows
// what lights it: the moon behind it most (rain glows towards a low light),
// the lanterns it passes and the far lightning. Near the lens it thins out and
// fades, so it never runs down the face of the view.

const SPEED = 6.2 // metres a second
const SHUTTER = 1 / 14 // seconds of fall a streak spans
const BOX = { r: 13, h: 15 } // half width of the column, its height

const VERT = /* glsl */ `
uniform float uRainTime;
uniform float uRain;
uniform float uGain;
uniform float uStill;
uniform float uLive;
uniform float uPixel;
uniform vec2 uWind;
uniform vec3 uMoonDir;
uniform vec3 uKey;
uniform float uFlash;
uniform vec3 uFlashDir;
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
  // the rain's strength thins the drops rather than dimming them all
  float keep = step(rnd, uRain);
  float speed = ${SPEED.toFixed(2)} * (0.82 + 0.36 * fract(rnd * 7.31));
  vec3 vel = vec3(uWind.x * 1.3, -speed, uWind.y * 1.3);
  vec3 box = vec3(2.0 * R, H, 2.0 * R);
  vec3 origin = cameraPosition - vec3(R, H * 0.62, R);
  vec3 p = aSeed.xyz * box + vel * (uRainTime + rnd * 3.0);
  p = mod(p - origin, box) + origin;

  vec3 toDrop = p - cameraPosition;
  float d = length(toDrop);
  vec3 V = toDrop / max(d, 1e-3);
  // the column's walls and ends, and the space just in front of the lens:
  // each drop fades at its own distance there, so fewer come near
  float horiz = length(toDrop.xz);
  float fade = 1.0 - smoothstep(R * 0.68, R * 0.98, horiz);
  float hy = (p.y - origin.y) / H;
  fade *= smoothstep(0.0, 0.08, hy) * (1.0 - smoothstep(0.9, 1.0, hy));
  float near = 1.3 + 3.2 * fract(rnd * 13.7);
  fade *= smoothstep(near, near + 1.8, d);
  fade *= keep * uLive;
  if (underShrine(p) || underRack(p)) fade = 0.0;

  // the streak: from where the drop was a shutter ago to where it is now
  float len = speed * ${SHUTTER.toFixed(4)} * mix(1.0, 0.12, uStill);
  vec3 axis = normalize(vel);
  // the quad runs from the tail down to the head, so its side points to the
  // left of the view for the triangles to face the eyes
  vec3 side = cross(V, axis);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  float phys = 0.0022;
  float wide = max(phys, uPixel * d * 1.6);
  // energy kept as the streak widens to stay smooth
  float thin = phys / wide;
  vec3 tail = p - axis * len;
  vec3 world = mix(tail - axis * wide, p + axis * wide, position.y) + side * position.x * wide;
  vUv = vec2(position.x, position.y * (len + 2.0 * wide) / len - wide / len);

  // light: a drop is a small lens, brightest with the light behind it
  float moon = max(dot(V, uMoonDir), 0.0);
  float glow = 0.05 + 0.5 * pow(moon, 6.0) + 1.6 * pow(moon, 40.0);
  vec3 col = uKey * glow * 0.11;
  col += vec3(0.05, 0.035, 0.06);
  // the lanterns' warm light on the drops passing them
  vec3 warm = vec3(0.0);
  for (int i = 0; i < ${LANTERNS.length}; i++) {
    vec3 l = uLanterns[i] - p;
    float dl2 = dot(l, l);
    if (dl2 > 16.0) continue;
    float behind = max(dot(V, l * inversesqrt(dl2)), 0.0);
    warm += (0.35 + 1.4 * behind * behind) / (1.0 + dl2 * 2.2) * (1.0 - dl2 / 16.0);
  }
  col += vec3(1.0, 0.5, 0.18) * warm * 0.55;
  // a far flash lights the whole sky for a moment
  float toward = max(dot(V, uFlashDir), 0.0);
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.6 * toward * toward);
  // blood-red water: it passes red and swallows the rest
  col *= vec3(1.0, 0.36, 0.3);
  vColor = col * uGain * fade * thin * mix(1.0, 0.45, uStill);

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  if (fade <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;

void main() {
  // soft across, brightest at the head, thinning into the tail, with round
  // ends instead of cut ones
  float across = 1.0 - vUv.x * vUv.x;
  across *= across;
  float along = smoothstep(-0.05, 0.6, vUv.y) * (1.0 - smoothstep(0.92, 1.05, vUv.y));
  float a = across * along;
  gl_FragColor = vec4(vColor * a, 0.0);
}
`

class Rain implements RealmPart {
  readonly object: THREE.Mesh
  readonly kind = 'Rain'
  private geometry: THREE.InstancedBufferGeometry
  private material: THREE.ShaderMaterial
  private camera: THREE.Camera | null = null
  private size = new THREE.Vector2()
  private key = new THREE.Vector3()

  constructor(tier: Tier) {
    const count = tier === 'ultra' ? 5400 : tier === 'high' ? 4200 : 1800
    const rand = rng(41017)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3))
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
        uRainTime: { value: 0 },
        uRain: hallow.uRain,
        uGain: { value: 3 },
        uStill: { value: 0 },
        uLive: { value: 1 },
        uPixel: { value: 0.001 },
        uWind: realmUniforms.uWind,
        uMoonDir: hallow.uMoonDir,
        uKey: { value: this.key },
        uFlash: hallow.uFlash,
        uFlashDir: hallow.uFlashDir,
        uLanterns: { value: lanterns },
        uShrine: { value: new THREE.Vector4(SHRINE.x, SHRINE.z, TERRACE_Y, 0) },
        uRack: { value: new THREE.Vector4(EMA_RACK.x, EMA_RACK.z, groundHeight(EMA_RACK.x, EMA_RACK.z) + 2.15, EMA_RACK.rotation) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
      // light only adds; the target's alpha is left alone
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
      // only the eyes see the rain, not the pond's mirror or the clouds' depth
      const u = this.material.uniforms
      u.uLive!.value = camera === this.camera ? 1 : 0
      const target = renderer.getRenderTarget()
      const h = target ? target.height : renderer.getDrawingBufferSize(this.size).y
      const cam = camera as THREE.PerspectiveCamera
      u.uPixel!.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 50) / 2)) / Math.max(1, h)
      this.material.uniformsNeedUpdate = true
    }
    this.object = mesh
  }

  update(frame: Frame): void {
    this.camera = frame.camera
    const u = this.material.uniforms
    // under reduced motion the rain hangs where it is
    u.uRainTime!.value += frame.dt * frame.motion
    u.uStill!.value = frame.motion === 0 ? 1 : 0
    const c = light.keyColor
    this.key.set(c.r, c.g, c.b).multiplyScalar(light.keyIntensity)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export const rainParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = [(tier) => new Rain(tier)]
