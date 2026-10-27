import * as THREE from 'three'
import { realmUniforms, SUN_DIRECTION } from './atmosphere'
import { CASCADE, cascadePoint } from './layout'
import { NOISE_GLSL, type Pond } from './pond'
import { dressFor } from './season'
import type { Frame, RealmPart, Tier } from './types'

// The cascade: a spring runs over a stone lip, falls onto a ledge, runs over
// its edge and falls again into the plunge pool (layout.CASCADE, stones in
// rocks.ts). Each fall is two curtains on the path a thrown sheet of water
// takes: a glassy one behind, an aerated one in front that turns white as it
// falls. The curtains carry each parcel's travel time, so their streaks move
// with the water and stretch as it speeds up. Foam spreads where each fall
// lands, spray hangs over the pool, and the plunge stirs the pond's ripples.

const G = 9.8

// the colours a season may change; shared by every material here
export interface CascadeUniforms {
  uSunColor: THREE.IUniform<THREE.Vector3>
  uSkyColor: THREE.IUniform<THREE.Vector3>
  uBody: THREE.IUniform<THREE.Vector3>
  uFoam: THREE.IUniform<THREE.Vector3>
  // the pace of the surface's texture, 1 for water
  uPace: THREE.IUniform<number>
}

export interface CascadeDress {
  uniforms(u: CascadeUniforms): void
}

interface Fall {
  runFrom: number // f where the sheet starts on its stone
  lip: number // f where it leaves the stone
  top: number // h at the lip
  bottom: number // h where it ends, under the surface it lands on
  speed: number // m/s over the lip
  half0: number // half width at the lip
  half1: number // and where it lands
}

// where a fall lands, in the cascade's frame
function landing(fall: Fall, h: number): number {
  const t = Math.sqrt((2 * (fall.top - h)) / G)
  return fall.lip + fall.speed * t
}

const FALL_VERT = /* glsl */ `
attribute vec4 aFlow;
uniform float uTime;
uniform float uLayer;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vFlow;
void main() {
  vec3 p = position;
  // the falling sheet quivers a little, more as it breaks up
  float q = sin(uTime * 9.0 - aFlow.y * 23.0 + aFlow.x * 4.0 + uLayer * 2.0) * 0.008 * max(aFlow.z, 0.0);
  p += normal * q;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const FALL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLayer;
uniform float uPace;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uBody;
uniform vec3 uFoam;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vFlow;
${NOISE_GLSL}
void main() {
  float s = vFlow.x;
  float prog = vFlow.z;
  float e = abs(vFlow.w);
  float fall = clamp(prog, 0.0, 1.0);
  // the time this parcel of water left the spring: a pattern keyed to it
  // rides down with the water and stretches as the water speeds up
  float age = (uTime - vFlow.y) * uPace;
  float seed = uLayer * 17.3;
  // The sheet's grain: broad ropes of water a hand wide that sway, a finer
  // grain over them, all keyed to the water's age so it rides down. Value
  // noise sits near its middle, so the sum is stretched before use.
  float sway = pNoise(vec2(s * 2.5 + seed, age * 0.6)) * 0.6;
  float rope = pNoise(vec2(s * 9.0 + sway * 2.0 + seed, age * 0.9));
  float a1 = pNoise(vec2(s * 22.0 + sway * 3.0 + seed, age * 1.4));
  float a2 = pNoise(vec2(s * 60.0 - seed, age * 2.6 + a1));
  float streak = clamp((rope * 0.55 + a1 * 0.3 + a2 * 0.15 - 0.5) * 1.9 + 0.5, 0.0, 1.0);
  // clumps of white water riding down the ropes, quicker than the sheet
  float clump = clamp((pNoise(vec2(s * 12.0 - seed, age * 7.0)) - 0.5) * 2.0 + 0.5, 0.0, 1.0);

  // Air is drawn in as it falls: a few white ropes at the lip, most of the
  // front sheet near the bottom, with a white haze between the ropes so the
  // fall has body; the curtain behind stays mostly glassy.
  float aerate = fall * mix(0.45, 1.0, uLayer);
  float th = mix(0.8, 0.38, aerate) + mix(0.12, 0.0, uLayer);
  float v = streak + (clump - 0.5) * 0.3 * fall;
  float foam = max(smoothstep(th - 0.2, th + 0.12, v), aerate * uLayer * 0.4);
  // the white is never one flat tone; the sheet is thickest down its middle
  float tone = (0.66 + 0.34 * a2 + 0.18 * (clump - 0.5)) * (0.82 + 0.18 * (1.0 - e * e));

  // ragged edges, and near the bottom the sides part into strands
  float rag = pNoise(vec2(s * 6.0 + 3.1, age * 2.7));
  float edge = 1.0 - smoothstep(0.62 - 0.3 * rag * fall, 1.0, e);
  float part = fall * fall * e * 0.6;
  float strands = smoothstep(part, part + 0.2, streak);
  // the sheet thickens out of the run on the stone
  float start = smoothstep(-1.0, -0.6, prog);

  // the side of the sheet that faces the eye, whichever way it is wound
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  N *= dot(N, V) < 0.0 ? -1.0 : 1.0;
  float cosV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  float ndl = dot(N, uSunDir);
  // foam scatters light all ways: wrapped, and lit through from behind
  float wrap = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
  vec3 foamCol = uFoam * (uSkyColor * 1.5 + uSunColor * (0.12 + 0.5 * wrap));
  // clear water: the body's colour, the sky in its face, glints of the sun
  vec3 R = reflect(-V, N);
  float glint = pow(max(dot(R, uSunDir), 0.0), 180.0) * 3.0;
  vec3 glassCol = (uBody * (uSkyColor + uSunColor * 0.25) * (1.0 - F) + uSkyColor * 2.2 * F + uSunColor * glint * F) * (0.7 + 0.6 * rope);
  float glassA = (0.4 + 0.5 * F) * mix(1.0, 0.25, uLayer);

  vec3 col = mix(glassCol, foamCol * tone, foam);
  float alpha = mix(glassA, 0.94, foam) * edge * strands * start;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`

// foam that spreads on the surface where a fall lands, carried off
// downstream; vLocal is (across, along the flow) in metres from the landing.
// The water heaves up in a low boil where the fall drives in.
const FOAM_VERT = /* glsl */ `
attribute vec2 aLocal;
uniform float uTime;
uniform float uPace;
uniform float uSize;
varying vec2 vLocal;
void main() {
  vLocal = aLocal;
  vec2 q = aLocal - vec2(0.0, uSize * 0.25);
  float r = length(q / vec2(1.0, 1.35)) / uSize;
  float t = uTime * uPace;
  float heave = 0.75 + 0.25 * sin(t * 5.0 + aLocal.x * 9.0 / uSize) * sin(t * 3.7 - aLocal.y * 7.0 / uSize);
  float boil = max(1.0 - r, 0.0);
  vec3 p = position + vec3(0.0, uSize * 0.14 * boil * boil * heave, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const FOAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPace;
uniform float uSize;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFoam;
uniform vec3 uSunLocal;
varying vec2 vLocal;
${NOISE_GLSL}
void main() {
  // the boil is centred a little downstream of the landing
  vec2 q = vLocal - vec2(0.0, uSize * 0.25);
  float r = length(q / vec2(1.0, 1.35)) / uSize;
  // carried off downstream
  float t = uTime * uPace;
  vec3 o1 = pNoised(q * 7.0 / uSize - vec2(0.0, t * 1.2));
  vec3 o2 = pNoised(q * 15.0 / uSize + vec2(4.0 - t * 0.2, 1.0 - t * 2.0));
  vec3 o3 = pNoised(q * 34.0 / uSize + vec2(t * 0.7, -t * 3.1));
  float n = o1.x * 0.6 + o2.x * 0.4;
  // dense at the boil, lacy further out, gone at the rim
  float cover = smoothstep(1.0, 0.15, r);
  float foam = smoothstep(1.0 - cover * 0.9, 1.08 - cover * 0.75, n + cover * 0.35);
  // nothing behind the falling sheet, where the bank is
  foam *= smoothstep(-0.25, 0.0, vLocal.y / uSize);
  // Foam is a heap of bubbles, not a sheet: its lumps catch the light on
  // one side and shade on the other, and the hollows between them sit in
  // shadow. The slope comes from the same noise that places the foam.
  vec2 slope = (o1.yz * 7.0 * 0.6 + o2.yz * 15.0 * 0.4 + o3.yz * 34.0 * 0.12) / uSize * 0.06;
  vec3 n3 = normalize(vec3(-slope.x, 1.0, -slope.y));
  float lit = clamp((dot(n3, uSunLocal) + 0.5) / 1.5, 0.0, 1.0);
  float hollow = mix(0.45, 1.0, smoothstep(0.35, 0.75, n + o3.x * 0.25));
  // lit as the falling foam is, so the boil is as white as the water feeding it
  vec3 col = uFoam * (uSkyColor * 1.5 + uSunColor * (0.12 + 0.5 * lit)) * hollow * (0.75 + 0.35 * o2.x) * (0.9 + 0.2 * cover);
  float alpha = foam * mix(0.55, 0.92, cover);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`

// spray: soft puffs that rise and spread from the landings
const MIST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uFrom[2];
uniform vec3 uFlowDir;
varying vec2 vCorner;
varying float vLife;
void main() {
  float life = fract(uTime * (0.22 + aSeed.z * 0.1) + aSeed.y);
  vec3 side = normalize(cross(uFlowDir, vec3(0.0, 1.0, 0.0)));
  vec3 from = aSeed.w > 0.5 ? uFrom[1] : uFrom[0];
  float reach = aSeed.w > 0.5 ? 0.45 : 1.0;
  vec3 c = from + side * aSeed.x * 0.45 * reach + uFlowDir * life * 0.45 * reach + vec3(0.0, life * 0.55 * reach, 0.0);
  float size = (0.15 + life * 0.35) * reach;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  vCorner = position.xy;
  vLife = life;
  gl_Position = projectionMatrix * mv;
}
`

const MIST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFoam;
varying vec2 vCorner;
varying float vLife;
void main() {
  float r = length(vCorner);
  float puff = smoothstep(1.0, 0.0, r);
  puff *= puff;
  float alpha = puff * sin(3.14159 * vLife) * 0.08;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uFoam * (uSkyColor * 1.6 + uSunColor * 0.4), alpha);
}
`

export class Cascade implements RealmPart {
  readonly kind = 'Cascade'
  readonly object = new THREE.Group()
  // the surface foam and the spray: left out of the pond's reflection
  readonly unreflected: THREE.Object3D[] = []

  private readonly pond: Pond
  private readonly falls: Fall[]
  private readonly stirs: { x: number; z: number; spread: number }[] = []
  private readonly stirRadius: number
  private readonly disposables: { dispose(): void }[] = []
  private readonly uniforms: CascadeUniforms
  private stirClock = 0
  private seed = 1

  constructor(opts: { tier: Tier; pond: Pond }) {
    this.pond = opts.pond
    const phone = opts.tier === 'phone'
    const { upper, ledge, lip1, lip2 } = CASCADE
    const upperFall: Fall = { runFrom: lip1 - 0.22, lip: lip1, top: upper, bottom: ledge - 0.06, speed: 0.75, half0: 0.3, half1: 0.38 }
    const ledgeAt = landing(upperFall, ledge)
    const lowerFall: Fall = { runFrom: ledgeAt, lip: lip2, top: ledge + 0.01, bottom: -0.12, speed: 1.0, half0: 0.4, half1: 0.54 }
    this.falls = [upperFall, lowerFall]
    const poolAt = landing(lowerFall, 0)

    this.uniforms = {
      uSunColor: { value: new THREE.Vector3(1.0, 0.82, 0.62).multiplyScalar(3.0) },
      uSkyColor: { value: new THREE.Vector3(0.42, 0.52, 0.68).multiplyScalar(0.55) },
      uBody: { value: new THREE.Vector3(0.05, 0.08, 0.032) },
      uFoam: { value: new THREE.Vector3(0.8, 0.83, 0.84) },
      uPace: { value: 1 },
    }
    dressFor<CascadeDress>('Cascade')?.uniforms(this.uniforms)
    const shared = { ...this.uniforms, uTime: realmUniforms.uTime, uSunDir: { value: SUN_DIRECTION } }

    // the curtains: glassy behind, aerated in front
    const rows = phone ? 22 : 40
    const cols = phone ? 8 : 14
    for (const [layer, offset] of [[0, -0.03], [1, 0.0]] as const) {
      const material = new THREE.ShaderMaterial({
        vertexShader: FALL_VERT,
        fragmentShader: FALL_FRAG,
        uniforms: { ...shared, uLayer: { value: layer } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      this.disposables.push(material)
      for (const fall of this.falls) {
        const geometry = sheet(fall, rows, cols, offset)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'cascade-fall'
        mesh.renderOrder = 2 + layer
        mesh.frustumCulled = false
        this.object.add(mesh)
        this.disposables.push(geometry)
      }
    }

    // foam where each fall lands
    const at = { x: 0, y: 0, z: 0 }
    const flow = new THREE.Vector3(CASCADE.dirX, 0, CASCADE.dirZ)
    // the sun in the foam's own frame (across, up, along the flow)
    const sunLocal = new THREE.Vector3(-CASCADE.dirZ * SUN_DIRECTION.x + CASCADE.dirX * SUN_DIRECTION.z, SUN_DIRECTION.y, flow.dot(SUN_DIRECTION))
    for (const [f, h, size] of [[ledgeAt, ledge + 0.015, 0.32], [poolAt, 0.006, 0.75]] as const) {
      const material = new THREE.ShaderMaterial({
        vertexShader: FOAM_VERT,
        fragmentShader: FOAM_FRAG,
        uniforms: { ...shared, uSize: { value: size }, uSunLocal: { value: sunLocal } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      })
      cascadePoint(f, 0, h, at)
      const geometry = foamDisc(at, size * 1.4, phone ? 24 : 40, phone ? 4 : 7)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = 'cascade-foam'
      mesh.renderOrder = 2
      this.object.add(mesh)
      this.unreflected.push(mesh)
      this.disposables.push(geometry, material)
    }

    // spray over the pool, and a little at the ledge
    const puffs = phone ? 6 : 12
    const corners = new THREE.PlaneGeometry(2, 2)
    const mistGeometry = new THREE.InstancedBufferGeometry()
    mistGeometry.index = corners.index
    mistGeometry.setAttribute('position', corners.getAttribute('position'))
    const seeds = new Float32Array(puffs * 4)
    for (let i = 0; i < puffs; i++) {
      seeds[i * 4] = this.random() * 2 - 1
      seeds[i * 4 + 1] = i / puffs
      seeds[i * 4 + 2] = this.random()
      seeds[i * 4 + 3] = i % 3 === 2 ? 1 : 0
    }
    mistGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    mistGeometry.instanceCount = puffs
    const pool = new THREE.Vector3()
    cascadePoint(poolAt, 0, 0.05, at)
    pool.set(at.x, at.y, at.z)
    cascadePoint(ledgeAt, 0, ledge + 0.05, at)
    const ledgeFoot = new THREE.Vector3(at.x, at.y, at.z)
    const mistMaterial = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: { ...shared, uFrom: { value: [pool, ledgeFoot] }, uFlowDir: { value: flow } },
      transparent: true,
      depthWrite: false,
    })
    const mist = new THREE.Mesh(mistGeometry, mistMaterial)
    mist.name = 'cascade-mist'
    mist.renderOrder = 4
    mist.frustumCulled = false
    this.object.add(mist)
    this.unreflected.push(mist)
    this.disposables.push(corners, mistGeometry, mistMaterial)

    // where the plunge stirs the pond: across the landing, and a little
    // downstream where the boil spreads
    for (const [df, spread] of [[0, lowerFall.half1 * 0.8], [0.3, lowerFall.half1]] as const) {
      cascadePoint(poolAt + df, 0, 0, at)
      this.stirs.push({ x: at.x, z: at.z, spread })
    }
    // the chop spreads from just downstream of the landing
    cascadePoint(poolAt + 0.2, 0, 0, at)
    this.pond.churn(at.x, at.z, 1.6, 5.5)
    // the phone's coarser ripple grid needs a wider stir to ring cleanly
    this.stirRadius = phone ? 0.16 : 0.1
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  update(frame: Frame): void {
    if (frame.motion === 0) return
    // a few drops a frame's worth of time, so the rings never pulse in a beat
    this.stirClock += frame.dt
    let n = 0
    while (this.stirClock > 0.05 && n < 2) {
      this.stirClock -= 0.05
      n++
      const s = this.stirs[Math.floor(this.random() * this.stirs.length)]!
      const across = (this.random() * 2 - 1) * s.spread
      const x = s.x - CASCADE.dirZ * across
      const z = s.z + CASCADE.dirX * across
      this.pond.stir(x, z, this.stirRadius, 0.004 + this.random() * 0.004)
    }
    if (this.stirClock > 0.05) this.stirClock = 0
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}

// One fall's curtain: rows along the water's path from its stone to where it
// lands, columns across. aFlow: s across (m), travel time from the sheet's
// start (s), progress through the fall (below 0 on the stone, 0 at the lip,
// 1 at the bottom), and the edge coordinate (-1..1).
function sheet(fall: Fall, rows: number, cols: number, offset: number): THREE.BufferGeometry {
  const runTime = (fall.lip - fall.runFrom) / fall.speed
  const dropTime = Math.sqrt((2 * (fall.top - fall.bottom)) / G)
  const total = runTime + dropTime
  const positions: number[] = []
  const normals: number[] = []
  const flows: number[] = []
  const at = { x: 0, y: 0, z: 0 }
  for (let j = 0; j <= rows; j++) {
    // rows bunch up at the lip, where the sheet bends over
    const k = j / rows
    const tau = total * k
    let f: number
    let h: number
    let nf: number
    let nh: number
    let prog: number
    if (tau < runTime) {
      f = fall.runFrom + fall.speed * tau
      h = fall.top
      nf = 0
      nh = 1
      prog = runTime > 0 ? tau / runTime - 1 : 0
    } else {
      const t = tau - runTime
      f = fall.lip + fall.speed * t
      h = fall.top - 0.5 * G * t * t
      const len = Math.hypot(G * t, fall.speed)
      nf = (G * t) / len
      nh = fall.speed / len
      prog = t / dropTime
    }
    const half = fall.half0 + (fall.half1 - fall.half0) * Math.max(0, prog)
    for (let i = 0; i <= cols; i++) {
      const e = (i / cols) * 2 - 1
      const s = e * half
      // the middle of the sheet runs a little ahead of its edges
      const bow = 0.05 * (1 - e * e) * Math.max(0, prog)
      cascadePoint(f + bow + nf * offset, s, h + nh * offset, at)
      positions.push(at.x, at.y, at.z)
      normals.push(CASCADE.dirX * nf, nh, CASCADE.dirZ * nf)
      flows.push(s, tau, prog, e)
    }
  }
  const index: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      const b = a + cols + 1
      index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 4))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

// a disc on the surface at `centre`, in rings so the boil can rise in its
// middle; aLocal is (across, along the flow)
function foamDisc(centre: { x: number; y: number; z: number }, radius: number, segments: number, rings: number): THREE.BufferGeometry {
  const positions: number[] = [centre.x, centre.y, centre.z]
  const locals: number[] = [0, 0]
  for (let k = 1; k <= rings; k++) {
    const reach = (k / rings) * radius
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const s = Math.cos(a) * reach
      const f = Math.sin(a) * reach
      positions.push(centre.x + CASCADE.dirX * f - CASCADE.dirZ * s, centre.y, centre.z + CASCADE.dirZ * f + CASCADE.dirX * s)
      locals.push(s, f)
    }
  }
  const index: number[] = []
  for (let i = 0; i < segments; i++) index.push(0, 1 + ((i + 1) % segments), 1 + i)
  for (let k = 1; k < rings; k++) {
    const inner = 1 + (k - 1) * segments
    const outer = inner + segments
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      index.push(inner + i, inner + j, outer + i, inner + j, outer + j, outer + i)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(locals, 2))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}
