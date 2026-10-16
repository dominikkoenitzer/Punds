import * as THREE from 'three'
import type { Tier } from './types'

// The frame after the scene is drawn: height fog and haze from the depth
// buffer, a mip chain that feeds both the bloom and the depth of field, light
// shafts from the sun, then exposure, grading and AgX tone mapping onto the
// screen. The scene itself renders into a multisampled linear HDR target.

export interface PostParams {
  exposure: number
  fogColor: THREE.Color
  sunFogColor: THREE.Color
  fogDensity: number // per metre at fogHeight
  fogHeight: number // world y where fogDensity applies
  fogFalloff: number // per metre, how fast the fog thins upwards
  haze: number // plain distance haze per metre
  bloom: number
  shafts: number
  sunColor: THREE.Color
  focusDistance: number // metres from the camera
  focusRange: number // metres either side that stay sharp
  blur: number // 0..1 strength of the out-of-focus blur
  vignette: number
  saturation: number
  wake: number // 0 eyes closed .. 1 fully awake
}

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const ATMOS_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uSunFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform float uHaze;
varying vec2 vUv;

float heightFog(vec3 ro, vec3 rd, float dist) {
  float c = uFogDensity * exp(-uFogFalloff * (ro.y - uFogHeight));
  float k = rd.y * uFogFalloff;
  float f = abs(k) > 1e-4 ? c * (1.0 - exp(-k * dist)) / k : c * dist;
  return 1.0 - exp(-max(f, 0.0));
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  // one bad pixel from any shader would bloom across the whole frame
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(col, vec3(6e4));
  float d = texture2D(tDepth, vUv).r;
  if (d < 1.0) {
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    rd /= dist;
    float sun = pow(max(dot(rd, uSunDir), 0.0), 6.0);
    vec3 fogCol = mix(uFogColor, uSunFogColor, sun);
    float haze = 1.0 - exp(-dist * uHaze);
    // far things (the cloud sea, the distant islands) fade into the sky by
    // their own haze; the fog here is for the island and its surroundings
    float near = 1.0 - smoothstep(140.0, 260.0, dist);
    col = mix(col, fogCol, clamp(max(heightFog(uCamPos, rd, dist), haze), 0.0, 1.0) * near);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

// 13-tap downsample; the first level also caps single bright pixels so the
// bloom cannot sparkle on specular glints
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  if (uFirst > 0.5) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= min(1.0, 24.0 / max(l, 1e-4));
  }
  return c;
}
void main() {
  vec3 a = tap(vec2(-2.0, 2.0)), b = tap(vec2(0.0, 2.0)), c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0)), h = tap(vec2(0.0, -2.0)), i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0)), k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0)), m = tap(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}
`

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tLow, vUv + vec2(-1.0, 1.0) * uTexel).rgb
         + texture2D(tLow, vUv + vec2(0.0, 1.0) * uTexel).rgb * 2.0
         + texture2D(tLow, vUv + vec2(1.0, 1.0) * uTexel).rgb
         + texture2D(tLow, vUv + vec2(-1.0, 0.0) * uTexel).rgb * 2.0
         + texture2D(tLow, vUv).rgb * 4.0
         + texture2D(tLow, vUv + vec2(1.0, 0.0) * uTexel).rgb * 2.0
         + texture2D(tLow, vUv + vec2(-1.0, -1.0) * uTexel).rgb
         + texture2D(tLow, vUv + vec2(0.0, -1.0) * uTexel).rgb * 2.0
         + texture2D(tLow, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + s / 16.0, 1.0);
}
`

// the sky that the sun lights, masked by everything in front of it
const SHAFT_MASK_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  vec2 o = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float near = exp(-dot(o, o) * 9.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = d >= 1.0 ? near * min(l, 6.0) : 0.0;
  gl_FragColor = vec4(m, m, m, 1.0);
}
`

const SHAFT_BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uSunUv;
uniform float uSpan;
varying vec2 vUv;
const int N = 24;
void main() {
  vec2 delta = (vUv - uSunUv) * uSpan / float(N);
  vec2 uv = vUv;
  float decay = 1.0;
  float acc = 0.0;
  float norm = 0.0;
  for (int i = 0; i < N; i++) {
    acc += texture2D(tSrc, uv).r * decay;
    norm += decay;
    decay *= 0.94;
    uv -= delta;
  }
  float v = acc / norm;
  gl_FragColor = vec4(v, v, v, 1.0);
}
`

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tBlurNear;
uniform sampler2D tBlurFar;
uniform sampler2D tShafts;
uniform float uBloom;
uniform float uShafts;
uniform vec3 uSunColor;
uniform float uExposure;
uniform float uFocus;
uniform float uFocusRange;
uniform float uBlur;
uniform float uNear;
uniform float uFar;
uniform float uVignette;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uWake;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  float z = d >= 1.0 ? uFar : linearDepth(d);

  // depth of field from the blurred mips: background only grows soft
  // slowly, the near field a little faster, like a long lens
  float far = smoothstep(uFocus + uFocusRange * 1.5, uFocus + uFocusRange * 8.0 + 60.0, z);
  float near = 1.0 - smoothstep(max(uFocus - uFocusRange, 0.2) * 0.35, max(uFocus - uFocusRange, 0.3), z);
  float coc = clamp(max(far, near) * uBlur, 0.0, 1.0);
  // waking up: everything starts soft and comes into focus
  coc = max(coc, 1.0 - smoothstep(0.15, 0.95, uWake));
  vec3 blurA = texture2D(tBlurNear, vUv).rgb;
  vec3 blurB = texture2D(tBlurFar, vUv).rgb;
  vec3 blurred = mix(blurA, blurB, smoothstep(0.45, 1.0, coc));
  col = mix(col, blurred, smoothstep(0.0, 0.6, coc));

  col += texture2D(tBloom, vUv).rgb * uBloom;
  col += texture2D(tShafts, vUv).r * uSunColor * uShafts;

  col *= uExposure;

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, uSaturation), 0.0);
  // white balance: a little warmer than the panorama, like late sun
  col *= uTint;

  // a lens vignette, wider than it is tall
  vec2 q = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float vig = 1.0 - uVignette * smoothstep(0.35, 1.25, length(q));
  col *= vig;

  // eyelids: a soft dark edge that opens from the middle
  float opening = smoothstep(0.0, 0.7, uWake) * 1.35;
  float fromMiddle = abs(vUv.y - 0.5) * 2.0;
  col *= (1.0 - smoothstep(opening - 0.35, opening, fromMiddle)) * smoothstep(0.0, 0.4, uWake);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // dither after the curve so slow sky gradients do not band
  gl_FragColor.rgb += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
}
`

function makePass(frag: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped,
  })
}

function makeTarget(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false })
  rt.texture.minFilter = THREE.LinearFilter
  rt.texture.magFilter = THREE.LinearFilter
  rt.texture.generateMipmaps = false
  return rt
}

const MIPS = 6

export class Pipeline {
  readonly main: THREE.WebGLRenderTarget
  private renderer: THREE.WebGLRenderer
  private tier: Tier
  private atmos: THREE.WebGLRenderTarget
  private down: THREE.WebGLRenderTarget[] = []
  private up: THREE.WebGLRenderTarget[] = []
  private shaftMask: THREE.WebGLRenderTarget
  private shaftA: THREE.WebGLRenderTarget
  private shaftB: THREE.WebGLRenderTarget
  private quad: THREE.Mesh
  private quadScene = new THREE.Scene()
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private atmosMat: THREE.ShaderMaterial
  private downMat: THREE.ShaderMaterial
  private upMat: THREE.ShaderMaterial
  private maskMat: THREE.ShaderMaterial
  private blurMat: THREE.ShaderMaterial
  private finalMat: THREE.ShaderMaterial
  private width = 1
  private height = 1
  private sunScratch = new THREE.Vector3()
  private camDir = new THREE.Vector3()

  constructor(renderer: THREE.WebGLRenderer, tier: Tier) {
    this.renderer = renderer
    this.tier = tier
    const depth = new THREE.DepthTexture(1, 1)
    depth.type = THREE.FloatType
    this.main = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: depth,
    })
    this.main.texture.generateMipmaps = false
    this.atmos = makeTarget(1, 1)
    for (let i = 0; i < MIPS; i++) {
      this.down.push(makeTarget(1, 1))
      this.up.push(makeTarget(1, 1))
    }
    this.shaftMask = makeTarget(1, 1, THREE.UnsignedByteType)
    this.shaftA = makeTarget(1, 1, THREE.UnsignedByteType)
    this.shaftB = makeTarget(1, 1, THREE.UnsignedByteType)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    this.quad = new THREE.Mesh(geo)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)

    this.atmosMat = makePass(ATMOS_FRAG, {
      tColor: { value: this.main.texture },
      tDepth: { value: depth },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogColor: { value: new THREE.Color() },
      uSunFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
      uFogHeight: { value: 0 },
      uFogFalloff: { value: 0.1 },
      uHaze: { value: 0 },
    })
    this.downMat = makePass(DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFirst: { value: 0 },
    })
    this.upMat = makePass(UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
      uTexel: { value: new THREE.Vector2() },
    })
    this.maskMat = makePass(SHAFT_MASK_FRAG, {
      tColor: { value: this.main.texture },
      tDepth: { value: depth },
      uSunUv: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
    })
    this.blurMat = makePass(SHAFT_BLUR_FRAG, {
      tSrc: { value: null },
      uSunUv: { value: new THREE.Vector2() },
      uSpan: { value: 0.5 },
    })
    this.finalMat = makePass(
      FINAL_FRAG,
      {
        tScene: { value: this.atmos.texture },
        tDepth: { value: depth },
        tBloom: { value: null },
        tBlurNear: { value: this.down[0].texture },
        tBlurFar: { value: this.down[1].texture },
        tShafts: { value: this.shaftB.texture },
        uBloom: { value: 0.05 },
        uShafts: { value: 0 },
        uSunColor: { value: new THREE.Color() },
        uExposure: { value: 1 },
        uFocus: { value: 10 },
        uFocusRange: { value: 5 },
        uBlur: { value: 0.5 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uVignette: { value: 0.25 },
        uSaturation: { value: 1 },
        uTint: { value: new THREE.Vector3(1.06, 1.0, 0.9) },
        uWake: { value: 1 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      true,
    )
  }

  setSize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    this.width = w
    this.height = h
    this.main.setSize(w, h)
    this.main.depthTexture!.image.width = w
    this.main.depthTexture!.image.height = h
    this.atmos.setSize(w, h)
    let mw = w
    let mh = h
    for (let i = 0; i < MIPS; i++) {
      mw = Math.max(1, Math.round(mw / 2))
      mh = Math.max(1, Math.round(mh / 2))
      this.down[i].setSize(mw, mh)
      this.up[i].setSize(mw, mh)
    }
    const sw = Math.max(1, Math.round(w / 4))
    const sh = Math.max(1, Math.round(h / 4))
    this.shaftMask.setSize(sw, sh)
    this.shaftA.setSize(sw, sh)
    this.shaftB.setSize(sw, sh)
    this.finalMat.uniforms.uResolution.value.set(w, h)
    this.maskMat.uniforms.uAspect.value = w / h
  }

  private draw(mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCam)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, p: PostParams, sunDir: THREE.Vector3, t: number): void {
    const r = this.renderer
    r.setRenderTarget(this.main)
    r.render(scene, camera)

    // fog and haze
    const a = this.atmosMat.uniforms
    a.uInvProj.value.copy(camera.projectionMatrixInverse)
    a.uCamWorld.value.copy(camera.matrixWorld)
    a.uCamPos.value.setFromMatrixPosition(camera.matrixWorld)
    a.uSunDir.value.copy(sunDir)
    a.uFogColor.value.copy(p.fogColor)
    a.uSunFogColor.value.copy(p.sunFogColor)
    a.uFogDensity.value = p.fogDensity
    a.uFogHeight.value = p.fogHeight
    a.uFogFalloff.value = p.fogFalloff
    a.uHaze.value = p.haze
    this.draw(this.atmosMat, this.atmos)

    // mip chain: down then up
    let src: THREE.Texture = this.atmos.texture
    let sw = this.width
    let sh = this.height
    for (let i = 0; i < MIPS; i++) {
      this.downMat.uniforms.tSrc.value = src
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh)
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0
      this.draw(this.downMat, this.down[i])
      src = this.down[i].texture
      sw = this.down[i].width
      sh = this.down[i].height
    }
    let low: THREE.Texture = this.down[MIPS - 1].texture
    for (let i = MIPS - 2; i >= 0; i--) {
      this.upMat.uniforms.tLow.value = low
      this.upMat.uniforms.tHigh.value = this.down[i].texture
      this.upMat.uniforms.uTexel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height)
      this.draw(this.upMat, this.up[i])
      low = this.up[i].texture
    }

    // light shafts, only while the sun is ahead of the camera
    camera.getWorldDirection(this.camDir)
    const facing = this.camDir.dot(sunDir)
    let shafts = 0
    if (facing > 0 && p.shafts > 0) {
      const s = this.sunScratch.copy(camera.position).addScaledVector(sunDir, 1000).project(camera)
      const su = s.x * 0.5 + 0.5
      const sv = s.y * 0.5 + 0.5
      this.maskMat.uniforms.uSunUv.value.set(su, sv)
      this.draw(this.maskMat, this.shaftMask)
      this.blurMat.uniforms.uSunUv.value.set(su, sv)
      this.blurMat.uniforms.tSrc.value = this.shaftMask.texture
      this.blurMat.uniforms.uSpan.value = 0.65
      this.draw(this.blurMat, this.shaftA)
      this.blurMat.uniforms.tSrc.value = this.shaftA.texture
      this.blurMat.uniforms.uSpan.value = 0.25
      this.draw(this.blurMat, this.shaftB)
      shafts = p.shafts * THREE.MathUtils.smoothstep(facing, 0.0, 0.5)
    }

    const f = this.finalMat.uniforms
    f.tBloom.value = this.up[0].texture
    f.uBloom.value = p.bloom
    f.uShafts.value = shafts
    f.uSunColor.value.copy(p.sunColor)
    f.uExposure.value = p.exposure
    f.uFocus.value = p.focusDistance
    f.uFocusRange.value = p.focusRange
    f.uBlur.value = this.tier === 'phone' ? p.blur * 0.7 : p.blur
    f.uNear.value = camera.near
    f.uFar.value = camera.far
    f.uVignette.value = p.vignette
    f.uSaturation.value = p.saturation
    f.uWake.value = p.wake
    f.uTime.value = t
    this.draw(this.finalMat, null)
  }

  dispose(): void {
    this.main.depthTexture?.dispose()
    this.main.dispose()
    this.atmos.dispose()
    for (const rt of [...this.down, ...this.up]) rt.dispose()
    this.shaftMask.dispose()
    this.shaftA.dispose()
    this.shaftB.dispose()
    this.quad.geometry.dispose()
    for (const m of [this.atmosMat, this.downMat, this.upMat, this.maskMat, this.blurMat, this.finalMat]) m.dispose()
  }
}
