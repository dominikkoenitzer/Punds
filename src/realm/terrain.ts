import * as THREE from 'three'
import {
  ISLAND_RX,
  ISLAND_RZ,
  rimScale,
  groundHeight,
  gravelWeight,
  pondSdf,
  fbm2,
  noise2,
  lawnWeight,
  TERRACE_FRONT_Z,
} from './layout'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { LAWN_FLOOR_TINT } from './grass'
import type { RealmPart, Tier } from './types'

// The island itself: a ground surface that follows layout.groundHeight out to
// the rim, a rounded lip, and the rock it stands on, tapering down into the
// clouds. The ground blends four scanned materials (soil, gravel, moss and the
// pond's pebbles) per pixel, weighted by the layout and sharpened by height so
// the borders read as material meeting material, not as a cross-fade.

const RIM_DROP = 0.55 // how far the lip rounds down before the cliff starts
const UNDERSIDE_DEPTH = 34

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// moss gathers where the ground stays damp and shaded: around the pond, at
// the foot of the terrace wall, near the rim and in patches between
function mossWeight(x: number, z: number): number {
  const pond = 1 - smooth(0.2, 2.6, pondSdf(x, z))
  const wall = (1 - smooth(0, 1.4, Math.abs(z - (TERRACE_FRONT_Z + 0.6)))) * (z > TERRACE_FRONT_Z ? 1 : 0)
  const patches = smooth(0.52, 0.72, fbm2(x * 0.18 + 3.3, z * 0.18 - 7.1, 4))
  return Math.max(pond * 0.85, wall * 0.9, patches * 0.75)
}

const SPLAT_VERT_PARS = /* glsl */ `
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vWorld;
varying vec3 vWorldNormal;
`

const SPLAT_FRAG_PARS = /* glsl */ `
uniform sampler2D tSoilD, tSoilN, tSoilA;
uniform sampler2D tGravelD, tGravelN, tGravelA;
uniform sampler2D tMossD, tMossN, tMossA;
uniform sampler2D tPebD, tPebN, tPebA;
uniform vec3 uLawnFloor;
varying vec4 vSplat;
varying vec3 vWorld;
varying vec3 vWorldNormal;
vec3 splatNormal;
vec3 splatArm;

float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
// two lookups at unrelated scales and angles hide the repeat of a 2 m scan
void sampleSet(sampler2D d, sampler2D n, sampler2D a, vec2 uv, out vec3 cd, out vec3 cn, out vec3 ca) {
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + 0.31;
  float m = smoothstep(0.35, 0.65, tNoise(uv * 0.21));
  cd = mix(texture2D(d, uv).rgb, texture2D(d, uv2).rgb, m);
  cn = mix(texture2D(n, uv).rgb, texture2D(n, uv2).rgb, m) * 2.0 - 1.0;
  ca = mix(texture2D(a, uv).rgb, texture2D(a, uv2).rgb, m);
}
`

const SPLAT_MAP = /* glsl */ `
{
  vec2 xz = vWorld.xz;
  vec3 d0, n0, a0, d1, n1, a1, d2, n2, a2, d3, n3, a3;
  sampleSet(tSoilD, tSoilN, tSoilA, xz / 2.6, d0, n0, a0);
  sampleSet(tGravelD, tGravelN, tGravelA, xz / 1.6, d1, n1, a1);
  sampleSet(tMossD, tMossN, tMossA, xz / 2.2, d2, n2, a2);
  sampleSet(tPebD, tPebN, tPebA, xz / 1.4, d3, n3, a3);
  vec4 w = vSplat;
  float soil = max(1.0 - w.x - w.y - w.z, 0.0);
  // height-sharpened blend: crevices (dark ambient occlusion) lose first
  vec4 h = vec4(soil * (0.4 + a0.r), w.x * (0.4 + a1.r), w.y * (0.4 + a2.r), w.z * (0.4 + a3.r));
  float hm = max(max(h.x, h.y), max(h.z, h.w));
  h = max(h - hm + 0.18, 0.0);
  h /= max(h.x + h.y + h.z + h.w, 1e-4);
  vec3 dif = d0 * h.x + d1 * h.y + d2 * h.z + d3 * h.w;
  splatNormal = normalize(n0 * h.x + n1 * h.y + n2 * h.z + n3 * h.w + vec3(0.0, 0.0, 1e-3));
  splatArm = a0 * h.x + a1 * h.y + a2 * h.z + a3 * h.w;
  // a broad tonal variation so the lawn floor never reads as one tile
  float macro = tNoise(xz * 0.07) * 0.6 + tNoise(xz * 0.23) * 0.4;
  dif *= mix(0.82, 1.12, macro);
  // the floor under the lawn: green-brown, so gaps between blades never read as bare dirt
  dif *= mix(vec3(1.0), uLawnFloor, w.w);
  diffuseColor.rgb *= dif;
}
`

const SPLAT_NORMAL = /* glsl */ `
{
  vec3 N = normalize(vWorldNormal);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);
  vec3 wn = normalize(T * splatNormal.x - B * splatNormal.y + N * splatNormal.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`

function patchSplat(mat: THREE.MeshStandardMaterial, sets: PbrSet[]): void {
  const names = ['Soil', 'Gravel', 'Moss', 'Peb']
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLawnFloor = { value: LAWN_FLOOR_TINT }
    sets.forEach((s, i) => {
      shader.uniforms[`t${names[i]}D`] = { value: s.map }
      shader.uniforms[`t${names[i]}N`] = { value: s.normalMap }
      shader.uniforms[`t${names[i]}A`] = { value: s.arm }
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SPLAT_VERT_PARS}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vSplat = splat;
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SPLAT_FRAG_PARS}`)
      .replace('#include <map_fragment>', SPLAT_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * splatArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', SPLAT_NORMAL)
      .replace(
        '#include <aomap_fragment>',
        `float ambientOcclusion = mix(1.0, splatArm.r, 0.9);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.indirectSpecular *= ambientOcclusion;`,
      )
  }
  mat.customProgramCacheKey = () => 'realm-terrain-splat'
}

function buildTop(tier: Tier): THREE.BufferGeometry {
  const rings = tier === 'phone' ? 70 : 120
  const segs = tier === 'phone' ? 180 : 300
  const pos: number[] = []
  const uv: number[] = []
  const splat: number[] = []
  const index: number[] = []
  for (let i = 0; i <= rings; i++) {
    // denser towards the rim, where the lip curves
    const r = 1 - Math.pow(1 - i / rings, 1.35)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      const k = rimScale(a)
      const x = Math.cos(a) * ISLAND_RX * k * r
      const z = Math.sin(a) * ISLAND_RZ * k * r
      let y = groundHeight(x, z)
      const lip = smooth(0.93, 1, r)
      y -= lip * lip * RIM_DROP
      pos.push(x, y, z)
      uv.push(x, z)
      const g = gravelWeight(x, z)
      const p = smooth(0.1, -0.3, pondSdf(x, z))
      const m = mossWeight(x, z) * (1 - g) * (1 - p)
      // the lip itself is bare soil and roots, never gravel
      splat.push(g * (1 - lip), m, p, lawnWeight(x, z))
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// The rock under the island: rings that start at the lip and narrow towards
// a ragged point far below, pushed in and out by noise in strata so it reads
// as layered stone that broke away from a mountain.
// A point on the rock under the island at bearing `a` (radians, as in
// layout.rimScale) and depth fraction `f` (0 at the lip, 1 at the bottom).
// Shared with the rocks that are set into the cliff.
export function undersidePoint(a: number, f: number, out: THREE.Vector3): THREE.Vector3 {
  const k = rimScale(a)
  const rx = Math.cos(a) * ISLAND_RX * k
  const rz = Math.sin(a) * ISLAND_RZ * k
  const yRim = groundHeight(rx, rz) - RIM_DROP
  // a short, almost vertical cliff band below the lip, then the long taper
  const taper = Math.pow(1 - smooth(0.04, 1, f), 1.15) * (1 - f * 0.08)
  const strata = Math.sin(f * 41 + noise2(a * 3, f * 6) * 2.4) * 0.5 + 0.5
  const n = fbm2(a * 4.2 + 11, f * 9.5, 4)
  const bulge = 1 + (n - 0.5) * 0.32 * smooth(0.02, 0.2, f) + strata * 0.035 * smooth(0.02, 0.1, f)
  const sc = Math.max(taper * bulge, 0.004)
  const depth = UNDERSIDE_DEPTH * (0.8 + fbm2(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 2) * 0.45)
  return out.set(rx * sc, yRim - f * depth - (f > 0 ? 0.15 : 0), rz * sc)
}

function buildUnderside(tier: Tier): THREE.BufferGeometry {
  const rings = tier === 'phone' ? 48 : 90
  const segs = tier === 'phone' ? 180 : 300
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i <= rings; i++) {
    const f = i / rings
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      undersidePoint(a, f, p)
      pos.push(p.x, p.y, p.z)
      const circ = a * (ISLAND_RX + ISLAND_RZ) * 0.5
      uv.push(circ / 6, p.y / 6)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

export class Terrain implements RealmPart {
  readonly object = new THREE.Group()
  private materials: THREE.Material[] = []
  private geometries: THREE.BufferGeometry[] = []

  static async create(tier: Tier): Promise<Terrain> {
    const [soil, gravel, moss, pebbles, cliff] = await Promise.all([
      loadPbr('soil', tier),
      loadPbr('gravel', tier),
      loadPbr('moss', tier),
      loadPbr('pebbles', tier),
      loadPbr('cliff', tier),
    ])
    return new Terrain(tier, [soil, gravel, moss, pebbles], cliff)
  }

  private constructor(tier: Tier, ground: PbrSet[], cliff: PbrSet) {
    const topGeo = buildTop(tier)
    const topMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    patchSplat(topMat, ground)
    const top = new THREE.Mesh(topGeo, topMat)
    top.receiveShadow = true
    top.castShadow = true
    top.name = 'ground'

    const underGeo = buildUnderside(tier)
    const underMat = pbrMaterial(cliff, { color: new THREE.Color(0.92, 0.88, 0.84) })
    const under = new THREE.Mesh(underGeo, underMat)
    under.receiveShadow = true
    under.castShadow = true

    this.object.add(top, under)
    this.geometries.push(topGeo, underGeo)
    this.materials.push(topMat, underMat)
  }

  update(): void {}

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
  }
}
