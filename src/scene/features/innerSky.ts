import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// InnerSky — the endless twilight-blue "inner world" sky that wraps the whole
// Wired plaza (the BLEACH inner-world bleed: a vast sky instead of a ceiling).
// Two pieces, both deliberately CHEAP and fog-immune so they read as the far
// backdrop behind every other feature:
//
//   1. SKY DOME — a single large inverted SphereGeometry (radius 340, BackSide)
//      drawn with a raw ShaderMaterial that paints a VERTICAL twilight gradient
//      (deep indigo/navy zenith -> lighter teal-blue horizon -> dark nadir) on
//      the sphere's local Y direction. The gradient is kept in the mid/low range
//      so it never crosses the bloom threshold (~0.85) and washes the scene out.
//      Because the world camera's far plane is only 240 (< the 340 dome), the
//      vertex shader uses the standard skybox depth trick `gl_Position.z = w`
//      (=> ndc.z = 1, the far plane) so the dome is NOT far-clipped, and the
//      mesh is frustumCulled:false / renderOrder:-1000 / depthTest:false so it
//      is always drawn first as the unconditional backdrop, writing no depth.
//      Raw ShaderMaterials get no fog by default — exactly what we want.
//
//   2. CLOUDS — a set of soft, melancholy cloud billboards drifting high in the
//      sky. One shared fluffy CanvasTexture (overlapping radial lobes, white-
//      blue, soft alpha) and one shared unit plane back every cloud; each cloud
//      owns only a thin MeshBasicMaterial (NormalBlending, fog:false) so it can
//      carry its own cool-blue tint and its own opacity breathe. Clouds circle
//      the sky on fixed-radius rings (constant camera distance => they stay
//      comfortably inside the 240 far plane) and yaw-billboard upright.
//
// update(): one scalar sky-breathe uniform + per-cloud (advance ring angle,
// reposition, yaw to camera, opacity breathe). No per-frame allocation; all
// rates scale with ctx.motion and lift faintly with ctx.audio.
// ============================================================================

const TAU = Math.PI * 2

const DOME_RADIUS = 340
const CLOUD_COUNT = 14

// Cloud placement is capped so the farthest cloud (corner included) stays well
// inside the camera far plane (240) even when the viewer dollies forward (+26).
const CLOUD_RADIUS_MIN = 110
const CLOUD_RADIUS_MAX = 170
const CLOUD_Y_MIN = 30
const CLOUD_Y_MAX = 78

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // sphere is centred at the group origin, so the local position direction is
    // the sky direction used for the vertical gradient
    vDir = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // skybox depth trick: force z = w (ndc.z = 1, the far plane) so the dome,
    // which sits beyond the camera's far plane, is never far-clipped
    gl_Position = clip.xyww;
  }
`

const DOME_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uNadir;
  uniform float uBreathe;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    vec3 col;
    if (h >= 0.0) {
      // horizon (brightest) -> zenith (deep navy); pow keeps a soft glow band
      col = mix(uHorizon, uZenith, pow(h, 0.55));
    } else {
      // horizon -> dark nadir below the world plane
      col = mix(uHorizon, uNadir, pow(-h, 0.8));
    }
    col *= uBreathe;
    gl_FragColor = vec4(col, 1.0);
  }
`

interface Cloud {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  angle: number
  angSpeed: number
  radius: number
  y: number
  baseOpacity: number
  breatheSpeed: number
  breathePhase: number
}

// One soft, fluffy white-blue cloud — a few overlapping radial-gradient lobes
// accumulated with the 'lighter' op so the body is dense and the edges fade to
// nothing. Shared by every cloud; tinted cooler per-cloud via material.color.
function makeCloudTexture(): THREE.CanvasTexture {
  const W = 256
  const H = 128
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex // stays transparent if no 2d context

  ctx.clearRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'

  // lobes: [centreX, centreY, radius] — wider-than-tall, denser along the base
  const lobes: ReadonlyArray<readonly [number, number, number]> = [
    [W * 0.5, H * 0.6, H * 0.46],
    [W * 0.34, H * 0.64, H * 0.34],
    [W * 0.66, H * 0.64, H * 0.36],
    [W * 0.42, H * 0.5, H * 0.3],
    [W * 0.6, H * 0.52, H * 0.3],
    [W * 0.5, H * 0.46, H * 0.26],
  ]

  for (const [cx, cy, r] of lobes) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(214,232,255,0.5)')
    g.addColorStop(0.5, 'rgba(196,220,250,0.2)')
    g.addColorStop(1, 'rgba(180,210,245,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    ctx.fill()
  }

  tex.needsUpdate = true
  return tex
}

export class InnerSky implements SceneFeature {
  readonly group: THREE.Group

  private readonly domeGeo: THREE.SphereGeometry
  private readonly domeMat: THREE.ShaderMaterial
  private readonly cloudGeo: THREE.PlaneGeometry
  private readonly cloudTex: THREE.CanvasTexture
  private readonly clouds: Cloud[] = []
  private t = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'InnerSky'

    // ----- twilight gradient colours (sRGB inputs -> stored linear) ----------
    // Kept mid/low so the sky never crosses the bloom threshold and blooms.
    const horizon = new THREE.Color('#357a9e').lerp(palette.hologram, 0.25)
    const zenith = new THREE.Color('#0c1738').lerp(palette.voidColor, 0.4)
    const nadir = palette.voidColor.clone().lerp(new THREE.Color('#02060e'), 0.5)

    // ----- sky dome ----------------------------------------------------------
    this.domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 24, 16)
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: zenith },
        uHorizon: { value: horizon },
        uNadir: { value: nadir },
        uBreathe: { value: 1 },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false, // always drawn (renderOrder -1000) as the backdrop
      fog: false,
      toneMapped: false,
    })

    const dome = new THREE.Mesh(this.domeGeo, this.domeMat)
    dome.frustumCulled = false // its bounding sphere lies beyond the far plane
    dome.renderOrder = -1000 // first: the unconditional sky behind everything
    this.group.add(dome)

    // ----- clouds ------------------------------------------------------------
    this.cloudTex = makeCloudTexture()
    this.cloudGeo = new THREE.PlaneGeometry(1, 1) // unit plane; per-cloud scale

    const cloudBase = new THREE.Color('#8fb7dc') // cool blue, "lit by the sky"

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const tint = cloudBase.clone().lerp(palette.hologram, 0.12 + Math.random() * 0.2)
      const mat = new THREE.MeshBasicMaterial({
        map: this.cloudTex,
        color: tint,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      })

      const mesh = new THREE.Mesh(this.cloudGeo, mat)
      mesh.renderOrder = -100 // behind the plaza, in front of the dome

      const width = 60 + Math.random() * 60
      const height = width * (0.4 + Math.random() * 0.15)
      mesh.scale.set(width, height, 1)

      const c: Cloud = {
        mesh,
        mat,
        angle: Math.random() * TAU,
        angSpeed: (0.004 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1),
        radius: CLOUD_RADIUS_MIN + Math.random() * (CLOUD_RADIUS_MAX - CLOUD_RADIUS_MIN),
        y: CLOUD_Y_MIN + Math.random() * (CLOUD_Y_MAX - CLOUD_Y_MIN),
        baseOpacity: 0.12 + Math.random() * 0.18,
        breatheSpeed: 0.03 + Math.random() * 0.05,
        breathePhase: Math.random() * TAU,
      }

      // seat at the start position so nothing pops on the first frame
      mesh.position.set(Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius)

      this.group.add(mesh)
      this.clouds.push(c)
    }
  }

  update(ctx: FeatureContext): void {
    const m = ctx.motion
    this.t += ctx.dt * m

    // faint sky-tint breathe, lifted a touch by the bass — kept tiny so the sky
    // stays under the bloom threshold
    this.domeMat.uniforms.uBreathe.value = 1 + Math.sin(this.t * 0.05) * 0.04 + ctx.audio * 0.05

    const cam = ctx.camera.position
    const audioGain = 1 + ctx.audio * 0.15

    for (const c of this.clouds) {
      c.angle += c.angSpeed * ctx.dt * m
      const x = Math.cos(c.angle) * c.radius
      const z = Math.sin(c.angle) * c.radius
      c.mesh.position.set(x, c.y, z)

      // yaw-billboard: face the plane's +Z toward the camera, staying upright
      c.mesh.rotation.y = Math.atan2(cam.x - x, cam.z - z)

      // melancholy opacity breathe
      c.mat.opacity =
        c.baseOpacity * (0.8 + 0.2 * Math.sin(this.t * c.breatheSpeed + c.breathePhase)) * audioGain
    }
  }

  dispose(): void {
    this.domeGeo.dispose()
    this.domeMat.dispose()
    for (const c of this.clouds) c.mat.dispose()
    this.clouds.length = 0
    this.cloudGeo.dispose()
    this.cloudTex.dispose()
    this.group.clear()
  }
}
