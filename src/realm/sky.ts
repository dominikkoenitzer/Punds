import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { SUN_DIRECTION } from './atmosphere'
import { BITMAP, SKY_RANK, bitmap, inTurn } from './assets'
import type { Tier } from './types'

// The sky is a photographed panorama. Two versions of it ship: a small HDR
// for image-based lighting, and a large 8-bit picture for the background,
// encoded as v = (L * k) ^ (1 / 2.2) so it decodes back to linear radiance.
// The panorama is turned so its sun stands where the composition wants it;
// SUN_DIRECTION is updated to the photographed sun's height.

const SKY = 'evening_road_01_puresky'

interface SkyInfo {
  k: number
  elevationTop: number
  elevationBottom: number
  // the sun in three's equirect convention (u = atan(z, x) / 2pi + 0.5)
  sunDirectionThreeEquirectUv: [number, number, number]
}

// where the composition wants the sun: low in the west, left of the path and
// a little ahead, so the walk is side-lit and long shadows cross the paving
const SUN_AZIMUTH = Math.atan2(-0.53, -0.85)

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

const SKY_FRAG = /* glsl */ `
uniform sampler2D tSky;
uniform float uK;
uniform float uTop;
uniform float uBottom;
uniform float uShift;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
varying vec3 vDir;
#define PI 3.141592653589793
void main() {
  vec3 dir = normalize(vDir);
  float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5 - uShift;
  float elev = asin(clamp(dir.y, -1.0, 1.0)) * 180.0 / PI;
  float v = clamp((elev - uBottom) / (uTop - uBottom), 0.002, 0.998);
  vec3 enc = texture2D(tSky, vec2(fract(u), v)).rgb;
  vec3 col = pow(enc, vec3(2.2)) / uK;
  // a richer gradient than the photograph: warmer along the horizon, a
  // deeper blue overhead
  float up = smoothstep(-0.02, 0.65, dir.y);
  col *= mix(vec3(1.12, 0.96, 0.8), vec3(0.72, 0.85, 1.08), up);
  col *= mix(1.0, 0.82, up * up);
  // the photographed disc is clipped in 8 bits; the real one is added here
  float c = dot(dir, uSunDir);
  float disc = smoothstep(cos(uSunSize * 1.25), cos(uSunSize * 0.85), c);
  col += uSunColor * disc * 40.0;
  gl_FragColor = vec4(col, 1.0);
}
`

export interface SkyResult {
  mesh: THREE.Mesh
  environment: THREE.Texture
  // the background panorama, its encoding constant and the turn applied to
  // it, for parts that sample the sky themselves
  panorama: THREE.Texture
  k: number
  shift: number
  dispose(): void
}

function azimuthOf(x: number, z: number): number {
  return Math.atan2(z, x)
}

// resolves once the sun's direction is set, before the sky's images arrive,
// so the island can be built while they load
let sunKnownResolve: () => void = () => {}
export const sunKnown = new Promise<void>((resolve) => (sunKnownResolve = resolve))

export async function buildSky(renderer: THREE.WebGLRenderer, tier: Tier, sunColor: THREE.Color, shown: Promise<void> = Promise.resolve()): Promise<SkyResult> {
  const base = `/realm/sky/${SKY}`
  const info: SkyInfo = await (await fetch(`${base}/bg.json`)).json()
  const [sx, sy, sz] = info.sunDirectionThreeEquirectUv
  const shift = (SUN_AZIMUTH - azimuthOf(sx, sz)) / (2 * Math.PI)

  // keep the photographed sun's height, turn its bearing
  const elevation = Math.asin(Math.max(-1, Math.min(1, sy)))
  SUN_DIRECTION.set(Math.cos(elevation) * Math.cos(SUN_AZIMUTH), Math.sin(elevation), Math.cos(elevation) * Math.sin(SUN_AZIMUTH)).normalize()
  sunKnownResolve()

  const bgUrl = `${base}/bg_${tier === 'phone' ? '4k' : '8k'}.webp`
  // image lighting needs little resolution: 1k lights the start view as 2k
  // does (measured) at a quarter of the download; phones take the smallest
  const hdrUrl = `${base}/env_${tier === 'phone' ? '512' : '1k'}.hdr`
  // the picture is decoded off the main thread and goes to the GPU at once,
  // not on the first frame
  const loading = Promise.all([
    bitmap(bgUrl, 'auto', SKY_RANK),
    inTurn(SKY_RANK, () => new HDRLoader().setDataType(THREE.FloatType).loadAsync(hdrUrl)),
  ])
  // The light's prefiltering builds its programs, synchronously, the first
  // time it runs, and they depend on the panorama's size. Once the start
  // picture is on screen (the build would hold up its first paint), run it on
  // a blank panorama of that size while the files download, so the real one
  // below finds them built. If the files are faster, it just runs once.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const first = await Promise.race([shown.then(() => 'shown' as const), loading.then(() => 'loaded' as const)])
  if (first === 'shown') {
    const envWidth = tier === 'phone' ? 512 : 1024
    const blank = new THREE.DataTexture(new Float32Array(envWidth * (envWidth / 2) * 4), envWidth, envWidth / 2, THREE.RGBAFormat, THREE.FloatType)
    blank.mapping = THREE.EquirectangularReflectionMapping
    blank.needsUpdate = true
    pmrem.fromEquirectangular(blank).dispose()
    blank.dispose()
  }
  const [image, hdr] = await loading
  const bg = new THREE.Texture(image)
  bg.flipY = !BITMAP
  bg.needsUpdate = true
  bg.colorSpace = THREE.NoColorSpace
  bg.wrapS = THREE.RepeatWrapping
  bg.wrapT = THREE.ClampToEdgeWrapping
  bg.generateMipmaps = true
  bg.minFilter = THREE.LinearMipmapLinearFilter
  bg.anisotropy = renderer.capabilities.getMaxAnisotropy()
  renderer.initTexture(bg)

  // Turn the HDR the same way and clip its sun: the directional light is the
  // sun, and lighting with both would light every shadow from the sun side.
  const img = hdr.image as { data: Float32Array; width: number; height: number }
  const { width, height, data } = img
  const turned = new Float32Array(data.length)
  const offset = Math.round(shift * width)
  const CAP = 24
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4
      const tx = (((x + offset) % width) + width) % width
      const to = (y * width + tx) * 4
      let r = data[from]
      let g = data[from + 1]
      let b = data[from + 2]
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (l > CAP) {
        const s = CAP / l
        r *= s
        g *= s
        b *= s
      }
      turned[to] = r
      turned[to + 1] = g
      turned[to + 2] = b
      turned[to + 3] = 1
    }
  }
  const env = new THREE.DataTexture(turned, width, height, THREE.RGBAFormat, THREE.FloatType)
  env.mapping = THREE.EquirectangularReflectionMapping
  env.colorSpace = THREE.LinearSRGBColorSpace
  env.needsUpdate = true
  const environment = pmrem.fromEquirectangular(env).texture
  pmrem.dispose()
  env.dispose()
  hdr.dispose()

  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      tSky: { value: bg },
      uK: { value: info.k },
      uTop: { value: info.elevationTop },
      uBottom: { value: info.elevationBottom },
      uShift: { value: shift },
      uSunDir: { value: SUN_DIRECTION },
      uSunColor: { value: sunColor },
      uSunSize: { value: THREE.MathUtils.degToRad(0.6) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  // the sphere follows the camera, so its size never matters
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position)
    mesh.updateMatrixWorld()
  }

  return {
    mesh,
    environment,
    panorama: bg,
    k: info.k,
    shift,
    dispose() {
      mesh.geometry.dispose()
      mat.dispose()
      bg.dispose()
      environment.dispose()
    },
  }
}
