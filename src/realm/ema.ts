import * as THREE from 'three'
import { EMA_RACK, groundHeight, rng } from './layout'
import { LINKS, type Link } from '../links'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { bevelBox, merge, transformed, worldUv } from './geo'
import { paintedMaterial } from './materials'
import { realmUniforms } from './atmosphere'
import type { Frame, RealmPart, Tier } from './types'

// The plaque rack beside the shrine. Older plaques hang in overlapping rows,
// weathered grey; in front of them hang three new ones in pale wood, one per
// link, each on its own long peg. Those three hang turned a little away on
// their cords; pointing at one (or the first tap on a phone) turns it to face
// the visitor, a click (or a second tap) opens its link. They are boards on
// cords: a touch sets them swinging, a brush across the rack knocks them
// into each other, and a gust stirs them now and then.

const RACK_W = 1.75
const POST_H = 1.92
const RAILS = [1.58, 1.3, 1.02] // above the terrace
const LINK_W = 0.34
const LINK_H = 0.24
const LINK_T = 0.009
// the link plaques' pegs: their spacing along the rail and how far they
// stand out, so a plaque can turn to the visitor without reaching the boards
const LINK_STEP = 0.37
const LINK_Z = 0.11
// the front of the boards behind the top rail
const BOARD_FRONT = -0.0225
// the furthest a link plaque turns on its cord, either way
const TWIST_MAX = 0.7
const OLD_W = 0.18
const OLD_H = 0.12
// how far each link plaque hangs turned away on its cord, in radians
const LINK_REST = [-0.22, 0.12, 0.28]
// a board hung from its top: its swing, fore and aft and to the side, as a
// physical pendulum (rad/s), the twist on the cord, and how fast each settles
const SWING_W = 7.4
const SIDE_W = 6.2
const TWIST_W = 3.0
const SWING_DAMP = 1.5
const TWIST_DAMP = 2.2

function plaqueShape(w: number, h: number): THREE.Shape {
  // a rectangle with a shallow gabled top
  const s = new THREE.Shape()
  const shoulder = h * 0.72
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(w / 2, shoulder)
  s.lineTo(0, h)
  s.lineTo(-w / 2, shoulder)
  s.closePath()
  return s
}

function plaqueGeometry(w: number, h: number, t: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(plaqueShape(w, h), {
    depth: t,
    bevelEnabled: true,
    bevelThickness: 0.0015,
    bevelSize: 0.002,
    bevelSegments: 2,
    curveSegments: 1,
  })
  // hang from the apex: the cord hole sits at the origin
  geo.translate(0, -h + 0.012, -t / 2)
  geo.clearGroups()
  return geo
}

// The face of a new plaque: planed hinoki with its fine straight grain, and
// the name written on it by hand in ink: each letter set a little off the
// line and turned by a hair, the word placed slightly high and to one side as
// people write on ema, and the ink broken by the grain where the brush ran
// dry. The letterforms come from the system serif, so the word stays crisp
// and legible at any size; at 2048 across it holds up in the close view.
function faceTexture(name: string, w: number, h: number, seed: number): THREE.CanvasTexture {
  const px = 2048
  const c = document.createElement('canvas')
  c.width = px
  c.height = Math.round((px * h) / w)
  const g = c.getContext('2d')!
  const rand = rng(seed)
  // the board: pale wood, lighter toward the middle where the plane ran
  // last, with the grain's fine lines running along it
  const base = g.createLinearGradient(0, 0, 0, c.height)
  base.addColorStop(0, '#e2cda4')
  base.addColorStop(0.5, '#ecdab6')
  base.addColorStop(1, '#ddc79d')
  g.fillStyle = base
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 9; i++) {
    // broad soft bands where the growth rings were wide
    const y = rand() * c.height
    g.fillStyle = `rgba(176, 140, 92, ${0.04 + rand() * 0.05})`
    g.fillRect(0, y, c.width, 20 + rand() * 70)
  }
  for (let i = 0; i < 230; i++) {
    const y0 = rand() * c.height
    const amp = 2 + rand() * 7
    const freq = 0.0012 + rand() * 0.002
    const ph = rand() * 6.28
    g.strokeStyle = `rgba(${150 + rand() * 30}, ${112 + rand() * 25}, ${70 + rand() * 20}, ${0.05 + rand() * 0.16})`
    g.lineWidth = 0.8 + rand() * 2.6
    g.beginPath()
    for (let x = 0; x <= c.width; x += 32) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.25
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  // the edges a shade darker, where hands and weather reach first
  const edge = g.createRadialGradient(c.width / 2, c.height * 0.55, c.height * 0.3, c.width / 2, c.height * 0.55, c.width * 0.62)
  edge.addColorStop(0, 'rgba(120, 90, 55, 0)')
  edge.addColorStop(1, 'rgba(120, 90, 55, 0.16)')
  g.fillStyle = edge
  g.fillRect(0, 0, c.width, c.height)
  // the ink on a layer of its own, so the dry brush lifts only ink
  const ink = document.createElement('canvas')
  ink.width = c.width
  ink.height = c.height
  const k2 = ink.getContext('2d')!
  const size = Math.round(c.height * 0.3)
  k2.font = `600 ${size}px 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`
  k2.textBaseline = 'alphabetic'
  const widths = [...name].map((ch) => k2.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) * 1.03
  let x = c.width * (0.48 + (rand() - 0.5) * 0.04) - total / 2
  const baseline = c.height * (0.6 + (rand() - 0.5) * 0.03)
  const slope = (rand() - 0.5) * 0.05
  k2.fillStyle = 'rgb(16, 12, 9)'
  k2.shadowColor = 'rgba(16, 12, 9, 0.45)'
  k2.shadowBlur = size * 0.035
  ;[...name].forEach((ch, i) => {
    k2.save()
    const cx = x + widths[i] / 2
    k2.translate(cx, baseline + (cx - c.width / 2) * slope + (rand() - 0.5) * size * 0.05)
    k2.rotate((rand() - 0.5) * 0.07)
    const k = 1 + (rand() - 0.5) * 0.06
    k2.scale(k, k)
    k2.fillText(ch, -widths[i] / 2, 0)
    k2.restore()
    x += widths[i] * 1.03
  })
  // dry brush: fine streaks along the stroke direction lift ink off the grain
  k2.shadowBlur = 0
  k2.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 520; i++) {
    const sx = rand() * c.width
    const sy = baseline - size * (0.9 * rand())
    k2.globalAlpha = 0.15 + rand() * 0.35
    k2.fillRect(sx, sy, 12 + rand() * 80, 1 + rand() * 3)
  }
  g.globalAlpha = 0.94
  g.drawImage(ink, 0, 0)
  g.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  return tex
}

// the corners of a link plaque in its pivot's space, at rest
const CORNERS = (() => {
  const hw = LINK_W / 2 + 0.002
  const hz = LINK_T / 2 + 0.0015
  const bottom = -LINK_H + 0.012
  const shoulder = bottom + LINK_H * 0.72
  const out: THREE.Vector3[] = []
  for (const x of [-hw, hw]) for (const y of [bottom, shoulder]) for (const z of [-hz, hz]) out.push(new THREE.Vector3(x, y, z))
  return out
})()
const LINK_DROP = LINK_H - 0.012 // pivot to the bottom edge

// Four faces of handwriting, too small and loose to read: columns of quick
// brush strokes, as wishes look from a step away. Painted once at startup.
function wishAtlas(): THREE.CanvasTexture {
  const size = 1024
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  g.clearRect(0, 0, size, size)
  const rand = rng(77)
  g.lineCap = 'round'
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * (size / 2)
    const oy = Math.floor(cell / 2) * (size / 2)
    const cols = 3 + Math.floor(rand() * 3)
    for (let k = 0; k < cols; k++) {
      // columns run top to bottom, right to left, like written Japanese
      const x = ox + size / 2 - 90 - k * ((size / 2 - 180) / Math.max(cols - 1, 1))
      let y = oy + 120 + rand() * 30
      const end = oy + size / 2 - 60 - rand() * 120
      while (y < end) {
        const len = 10 + rand() * 26
        g.strokeStyle = `rgba(20, 16, 12, ${0.55 + rand() * 0.35})`
        g.lineWidth = 3 + rand() * 6
        g.beginPath()
        const a = (rand() - 0.5) * 1.6
        g.moveTo(x + (rand() - 0.5) * 30, y)
        g.quadraticCurveTo(x + Math.sin(a) * len, y + len * 0.5, x + (rand() - 0.5) * 34, y + len)
        g.stroke()
        y += len * (0.7 + rand() * 0.6)
      }
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// pale hinoki with the scan's grain as luminance, a per-plaque tone from the
// instance colour, and the writing from the atlas cell the plaque was given
function decoyMaterial(set: PbrSet, wishes: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = pbrMaterial(set, { color: 0xffffff, roughness: 0.85, metalness: 0 })
  mat.metalnessMap = null
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tWish = { value: wishes }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 face;\nattribute float cell;\nvarying vec2 vFace;\nvarying float vCell;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFace = face;\nvCell = cell;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWish;\nvarying vec2 vFace;\nvarying float vCell;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          float grainL = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb *= clamp(0.6 + grainL * 1.5, 0.65, 1.2);
        #endif
        {
          vec2 cellOrigin = vec2(mod(vCell, 2.0), floor(vCell / 2.0)) * 0.5;
          vec2 fuv = cellOrigin + clamp(vFace, 0.0, 1.0) * 0.5;
          float ink = texture2D(tWish, fuv).a * 0.8;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.02), ink);
        }`,
      )
  }
  mat.customProgramCacheKey = () => 'realm-ema-decoy'
  return mat
}

interface Plaque {
  pivot: THREE.Group
  link: Link | null
  rest: number // resting turn on the cord
  turn: number // the twist on the cord
  turnVel: number
  swing: number // fore and aft, positive back toward the boards
  swingVel: number
  side: number // to the side, positive toward +x
  sideVel: number
  phase: number
  hit: THREE.Mesh | null
  glow: THREE.MeshStandardMaterial | null
  focus: number
  lastKnock: number
}

export class EmaRack implements RealmPart {
  readonly kind = 'EmaRack'
  readonly object = new THREE.Group()
  private plaques: Plaque[] = []
  private hits: THREE.Object3D[] = []
  private hovered: Plaque | null = null
  private armed: Plaque | null = null
  private focused: Plaque | null = null
  private disposables: { dispose(): void }[] = []
  private raycaster = new THREE.Raycaster()
  private camLocal = new THREE.Vector3()
  private decoys: THREE.InstancedMesh | null = null
  private cords: THREE.InstancedMesh | null = null
  // where the pointer crosses the plaques' plane, for the brush of a hand
  private brushX = 0
  private brushAt = 0
  private brushVel = 0
  private kicks: { p: Plaque; swing: number; side: number; twist: number }[] = []
  private euler = new THREE.Euler(0, 0, 0, 'XZY')
  private corner = new THREE.Vector3()
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -LINK_Z)
  private local = new THREE.Ray()
  private inv = new THREE.Matrix4()
  private hitPoint = new THREE.Vector3()
  private screen = new THREE.Vector3()

  static async create(tier: Tier): Promise<EmaRack> {
    const [aged, cedar, copper] = await Promise.all([loadPbr('wood_aged', tier), loadPbr('cedar_planks', tier), loadPbr('copper', tier)])
    return new EmaRack(aged, cedar, copper)
  }

  private constructor(aged: PbrSet, cedar: PbrSet, copper: PbrSet) {
    const rand = rng(31)
    const frame: THREE.BufferGeometry[] = []
    const roof: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      frame.push(transformed(bevelBox(0.085, POST_H, 0.085, 0.01, 2), (side * RACK_W) / 2, POST_H / 2, 0))
    }
    // the rails: squared bars with a peg every few plaques
    for (const y of RAILS) {
      frame.push(transformed(bevelBox(RACK_W, 0.035, 0.035, 0.005, 1), 0, y + 0.01, 0))
      for (let k = 0; k < 14; k++) {
        const x = -RACK_W / 2 + 0.1 + (k * (RACK_W - 0.2)) / 13
        frame.push(transformed(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), x, y + 0.01, 0.03, Math.PI / 2))
      }
    }
    // the link plaques' own pegs, long enough to hang them clear of the rest,
    // each with a knob so the cord cannot slip off
    for (let i = 0; i < LINKS.length; i++) {
      const x = (i - (LINKS.length - 1) / 2) * LINK_STEP
      frame.push(transformed(new THREE.CylinderGeometry(0.0065, 0.0075, LINK_Z + 0.01, 8), x, RAILS[0] + 0.01, (LINK_Z + 0.01) / 2, Math.PI / 2))
      frame.push(transformed(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 10), x, RAILS[0] + 0.01, LINK_Z + 0.012, Math.PI / 2))
    }
    // a backboard of broad slats behind each rail, as on a wall rack
    for (const y of RAILS) frame.push(transformed(bevelBox(RACK_W - 0.02, 0.2, 0.025, 0.004, 1), 0, y - 0.07, -0.035))
    // tie beam under the roof, past the posts
    frame.push(transformed(bevelBox(RACK_W + 0.34, 0.11, 0.1, 0.01, 2), 0, POST_H - 0.04, 0))
    // the little gabled roof: two boards, purlins, a copper ridge
    const pitch = 0.5
    const boardW = 0.52
    for (const side of [-1, 1]) {
      const cz = side * Math.cos(pitch) * boardW * 0.5
      const cy = POST_H + 0.2 - Math.sin(pitch) * boardW * 0.5
      roof.push(transformed(bevelBox(RACK_W + 0.62, 0.045, boardW, 0.008, 1), 0, cy, cz, side * pitch))
      frame.push(transformed(bevelBox(RACK_W + 0.5, 0.05, 0.05, 0.006, 1), 0, cy - 0.06, cz * 0.8))
    }
    for (const side of [-1, 1]) frame.push(transformed(bevelBox(0.06, 0.2, 0.06, 0.006, 1), (side * RACK_W) / 2, POST_H + 0.08, 0))
    const frameGeo = merge(frame.map((g) => worldUv(g, 1.2)))
    const frameMat = pbrMaterial(aged, { color: new THREE.Color(0.62, 0.52, 0.42), metalness: 0 })
    frameMat.metalnessMap = null
    const frameMesh = new THREE.Mesh(frameGeo, frameMat)
    frameMesh.castShadow = true
    frameMesh.receiveShadow = true
    this.object.add(frameMesh)
    const roofGeo = merge(roof.map((g) => worldUv(g, 1.0)))
    const roofMat = pbrMaterial(aged, { color: new THREE.Color(0.3, 0.24, 0.2), metalness: 0 })
    roofMat.metalnessMap = null
    const roofMesh = new THREE.Mesh(roofGeo, roofMat)
    roofMesh.castShadow = true
    roofMesh.receiveShadow = true
    this.object.add(roofMesh)
    const capGeo = transformed(new THREE.CylinderGeometry(0.045, 0.045, RACK_W + 0.64, 16, 1), 0, POST_H + 0.215, 0, 0, 0, Math.PI / 2)
    worldUv(capGeo, 1)
    const capMat = pbrMaterial(copper, { color: new THREE.Color(0.42, 0.72, 0.62), metalness: 0.3, roughness: 0.6 })
    capMat.metalnessMap = null
    const cap = new THREE.Mesh(capGeo, capMat)
    cap.castShadow = true
    this.object.add(cap)
    this.disposables.push(frameGeo, frameMat, roofGeo, roofMat, capGeo, capMat)

    // older plaques: many hands' wishes, overlapping like scales, some new
    // and pale, most weathered, a few hung back to front. One instanced mesh
    // for all of them and one for their cords, so the rack stays a handful of
    // draw calls.
    const decoyGeo = plaqueGeometry(OLD_W, OLD_H, 0.007)
    // each plaque is one board: the scan's planks are spread so no seam crosses it
    worldUv(decoyGeo, 2.4)
    {
      // plaque-local coordinates for the written face
      const p = decoyGeo.getAttribute('position')
      const face = new Float32Array(p.count * 2)
      for (let i = 0; i < p.count; i++) {
        face[i * 2] = p.getX(i) / OLD_W + 0.5
        face[i * 2 + 1] = (p.getY(i) + OLD_H - 0.012) / OLD_H
      }
      decoyGeo.setAttribute('face', new THREE.BufferAttribute(face, 2))
    }
    const wishes = wishAtlas()
    const decoyMat = decoyMaterial(cedar, wishes)
    const cordGeo = new THREE.TorusGeometry(0.018, 0.0025, 4, 12)
    const cordMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
    this.disposables.push(decoyGeo, decoyMat, wishes, cordGeo, cordMat)
    const tones = ['#ead9b4', '#e3cfa8', '#dcc69c', '#d2ba90', '#c4b39a'].map((c) => new THREE.Color(c).convertSRGBToLinear())
    const white = new THREE.Color(0.86, 0.84, 0.8)
    const red = new THREE.Color(0.6, 0.06, 0.04)
    // Plaques hang in stacks, many to a hook, each a little lower and nearer
    // than the one behind, their cords gathered into one bundle at the hook.
    interface Hung {
      x: number
      y: number
      z: number
      k: number
      tilt: number
      turn: number
      tone: THREE.Color
      cord: THREE.Color
      hookY: number
      hookX: number
    }
    const hung: Hung[] = []
    // Sizes, offsets and turns are bounded so that neighbouring stacks keep a
    // gap and each plaque in a stack stands clear of the one behind it (the
    // spacing is a board's thickness plus what its turn swings its edge out).
    const linkReach = ((LINKS.length - 1) / 2) * LINK_STEP + LINK_W / 2
    for (let r = 0; r < RAILS.length; r++) {
      const hooks = 6
      for (let hk = 0; hk < hooks; hk++) {
        const hx = -RACK_W / 2 + 0.16 + ((RACK_W - 0.32) * hk) / (hooks - 1) + (rand() - 0.5) * 0.03
        const n = 3 + Math.floor(rand() * 4)
        for (let j = 0; j < n; j++) {
          const k = 0.95 + rand() * 0.1
          const x = hx + (rand() - 0.5) * 0.04
          const tilt = (rand() - 0.5) * 0.16
          const turn = (rand() - 0.5) * 0.05
          const tiltReach = Math.sin(Math.abs(tilt)) * OLD_H * k
          // the middle of the top rail belongs to the three link plaques
          if (r === 0 && Math.abs(x) - (OLD_W * k) / 2 - tiltReach < linkReach + 0.04) continue
          hung.push({
            x,
            y: RAILS[r] - 0.06 - j * 0.012 - rand() * 0.01,
            z: 0.03 + j * 0.016,
            k,
            tilt,
            turn,
            tone: tones[Math.floor(rand() * tones.length)],
            cord: rand() < 0.85 ? white : red,
            hookY: RAILS[r] + 0.04,
            hookX: hx,
          })
        }
      }
    }
    const decoys = new THREE.InstancedMesh(decoyGeo, decoyMat, hung.length)
    // each cord is a thin strand from the plaque's hole up to the hook
    const strandGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 4, 1, true)
    strandGeo.translate(0, 0.5, 0)
    const strands = new THREE.InstancedMesh(strandGeo, cordMat, hung.length * 2)
    this.disposables.push(strandGeo)
    this.decoys = decoys
    this.cords = strands
    const cells = new Float32Array(hung.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const sc = new THREE.Vector3()
    const at = new THREE.Vector3()
    const top = new THREE.Vector3()
    const hook = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    hung.forEach((h, i) => {
      q.setFromEuler(e.set(0, h.turn, h.tilt))
      sc.set(h.k, h.k, 1)
      at.set(h.x, h.y, h.z)
      decoys.setMatrixAt(i, m4.compose(at, q, sc))
      decoys.setColorAt(i, h.tone)
      cells[i] = Math.floor(rand() * 4)
      // two strands per plaque, a few millimetres apart at the hole
      for (let side = 0; side < 2; side++) {
        top.set(h.x + (side - 0.5) * 0.008, h.y - 0.004, h.z)
        hook.set(h.hookX + (side - 0.5) * 0.004, h.hookY, 0.02)
        dir.subVectors(hook, top)
        const len = dir.length()
        q.setFromUnitVectors(up, dir.normalize())
        sc.set(1, len, 1)
        strands.setMatrixAt(i * 2 + side, m4.compose(top, q, sc))
        strands.setColorAt(i * 2 + side, h.cord)
      }
    })
    decoys.instanceMatrix.needsUpdate = true
    strands.instanceMatrix.needsUpdate = true
    decoyGeo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 1))
    for (const m of [decoys, strands]) {
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      this.object.add(m)
    }

    // the three link plaques
    const linkGeo = plaqueGeometry(LINK_W, LINK_H, LINK_T)
    worldUv(linkGeo, 2.4)
    const faceGeo = new THREE.ShapeGeometry(plaqueShape(LINK_W * 0.97, LINK_H * 0.97))
    faceGeo.translate(0, -LINK_H * 0.97 + 0.012, 0.0062)
    // map the face's texture coordinates to the plaque's bounds
    {
      const p = faceGeo.getAttribute('position')
      const uv = faceGeo.getAttribute('uv')
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (LINK_W * 0.97) + 0.5, (p.getY(i) + LINK_H * 0.97 - 0.012) / (LINK_H * 0.97))
    }
    const hitGeo = new THREE.BoxGeometry(LINK_W * 1.05, LINK_H * 1.2, 0.06)
    hitGeo.translate(0, -LINK_H / 2, 0)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    const linkCordMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.6, 0.05, 0.035), roughness: 0.65 })
    this.disposables.push(linkCordMat)
    this.disposables.push(linkGeo, faceGeo, hitGeo, hitMat)
    LINKS.forEach((link, i) => {
      const pivot = new THREE.Group()
      pivot.rotation.order = 'XZY'
      const x = (i - (LINKS.length - 1) / 2) * LINK_STEP
      pivot.position.set(x, RAILS[0] - 0.005, LINK_Z)
      const mat = paintedMaterial(cedar, new THREE.Color('#e4d1aa').convertSRGBToLinear(), { roughness: 0.78, metalness: 0 })
      mat.metalnessMap = null
      const body = new THREE.Mesh(linkGeo, mat)
      body.castShadow = true
      body.receiveShadow = true
      pivot.add(body)
      const tex = faceTexture(link.name, LINK_W, LINK_H, 101 + i * 17)
      // the face holds a little of the low sun even in shade, more when the
      // plaque turns to the visitor
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, emissive: new THREE.Color(1, 0.7, 0.4), emissiveMap: tex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1 })
      const face = new THREE.Mesh(faceGeo, faceMat)
      face.receiveShadow = true
      pivot.add(face)
      const cord = new THREE.Mesh(cordGeo, linkCordMat)
      cord.scale.set(1.3, 1.6, 1.3)
      pivot.add(cord)
      const hit = new THREE.Mesh(hitGeo, hitMat)
      hit.userData.plaque = this.plaques.length
      pivot.add(hit)
      this.hits.push(hit)
      this.object.add(pivot)
      this.disposables.push(mat, tex, faceMat)
      this.plaques.push({ pivot, link, rest: LINK_REST[i % LINK_REST.length], turn: 0, turnVel: 0, swing: 0, swingVel: 0, side: 0, sideVel: 0, phase: i * 2.1, hit, glow: faceMat, focus: 0, lastKnock: 0 })
    })
    for (const p of this.plaques) p.turn = p.rest

    this.object.position.set(EMA_RACK.x, groundHeight(EMA_RACK.x, EMA_RACK.z), EMA_RACK.z)
    this.object.rotation.y = EMA_RACK.rotation
  }

  private pick(ray: THREE.Ray | null): Plaque | null {
    if (!ray) return null
    this.raycaster.ray.copy(ray)
    const hit = this.raycaster.intersectObjects(this.hits, false)[0]
    return hit ? this.plaques[hit.object.userData.plaque as number] : null
  }

  // the cursor the host should show over the canvas
  get pointing(): boolean {
    return this.hovered !== null
  }

  // the name on the plaque under the pointer, if it is a link
  get hoveredName(): string | null {
    return this.hovered?.link?.name ?? null
  }

  // a mouse hover; touches go through tap(). A hand brushing in from the
  // side pushes a plaque aside as well as back.
  hover(ray: THREE.Ray | null): void {
    const before = this.hovered
    const p = this.pick(ray)
    if (ray) {
      const x = this.planeX(ray)
      const now = performance.now()
      if (x !== null) {
        const dt = Math.max(0.008, (now - this.brushAt) / 1000)
        this.brushVel = now - this.brushAt < 120 ? (x - this.brushX) / dt : 0
        this.brushX = x
        this.brushAt = now
      }
    }
    this.hovered = p ?? this.focused
    if (p && p !== before) this.kicks.push({ p, swing: 0.75, side: THREE.MathUtils.clamp(this.brushVel * 2.4, -1.5, 1.5), twist: -this.localX(p) * 4 })
  }

  // where a ray crosses the plane the link plaques hang in, along the rack
  private planeX(ray: THREE.Ray): number | null {
    this.inv.copy(this.object.matrixWorld).invert()
    this.local.copy(ray).applyMatrix4(this.inv)
    return this.local.intersectPlane(this.plane, this.hitPoint) ? this.hitPoint.x : null
  }

  // the pointer's offset from a plaque's middle, -1 at its left edge
  private localX(p: Plaque): number {
    return THREE.MathUtils.clamp((this.brushX - p.pivot.position.x) / (LINK_W / 2), -1, 1)
  }

  // keyboard focus on one of the page's links turns its plaque
  focusLink(index: number | null): void {
    this.focused = index === null ? null : (this.plaques.filter((p) => p.link)[index] ?? null)
    this.hovered = this.focused
  }

  // A click or tap. Mouse: opens the plaque under the pointer. Touch: the
  // first tap turns a plaque to face the visitor, a second tap on it opens.
  // Returns whether the tap landed on a plaque.
  tap(ray: THREE.Ray, touch: boolean): boolean {
    const p = this.pick(ray)
    if (!p || !p.link) {
      if (touch) this.armed = null
      return false
    }
    const x = this.planeX(ray)
    if (x !== null) this.brushX = x
    this.kicks.push({ p, swing: 1.5, side: 0, twist: -this.localX(p) * 5 })
    if (touch && this.armed !== p) {
      this.armed = p
      this.hovered = p
      return true
    }
    window.open(p.link.href, '_blank', 'noopener,noreferrer')
    this.armed = null
    return true
  }

  // the lowest a plaque's corners reach toward the boards, and how far along
  // the rail its sides reach, for a pose
  private reach(p: Plaque, swing: number, turn: number, side: number): { back: number; left: number; right: number } {
    this.euler.set(swing, turn, side, 'XZY')
    let back = Infinity
    let left = Infinity
    let right = -Infinity
    for (const c of CORNERS) {
      this.corner.copy(c).applyEuler(this.euler)
      back = Math.min(back, LINK_Z + this.corner.z)
      left = Math.min(left, p.pivot.position.x + this.corner.x)
      right = Math.max(right, p.pivot.position.x + this.corner.x)
    }
    return { back, left, right }
  }

  private knock(frame: Frame, p: Plaque, speed: number): void {
    if (frame.t - p.lastKnock < 0.09) return
    p.lastKnock = frame.t
    this.screen.copy(p.pivot.position)
    this.object.localToWorld(this.screen).project(frame.camera)
    frame.sound.knock(speed / 0.35, this.screen.x * 0.7)
  }

  update(frame: Frame): void {
    const dt = frame.dt
    const moving = frame.motion > 0
    // the turn that makes a plaque face the camera, in rack space
    this.camLocal.copy(frame.camera.position)
    this.object.worldToLocal(this.camLocal)
    if (moving) {
      for (const k of this.kicks) {
        k.p.swingVel += k.swing
        k.p.sideVel += k.side
        k.p.turnVel += k.twist
      }
    }
    this.kicks.length = 0
    // only the stronger gusts reach in under the little roof
    const gust = realmUniforms.uGust.value as number
    const stir = moving ? THREE.MathUtils.smoothstep(gust, 0.45, 0.9) : 0
    for (const p of this.plaques) {
      const active = p === this.hovered || p === this.armed
      p.focus += ((active ? 1 : 0) - p.focus) * Math.min(1, dt * 6)
      if (p.glow) p.glow.emissiveIntensity = 0.06 + p.focus * 0.1
    }
    // the pendulums in small fixed steps, so a knock is met where it happens
    const steps = Math.min(16, Math.ceil(dt / (1 / 240)))
    const h = dt / Math.max(1, steps)
    for (let s = 0; s < steps; s++) {
      for (const p of this.plaques) {
        const facing = THREE.MathUtils.clamp(Math.atan2(this.camLocal.x - p.pivot.position.x, this.camLocal.z - p.pivot.position.z), -TWIST_MAX, TWIST_MAX)
        const target = p.link ? THREE.MathUtils.lerp(p.rest, facing, p.focus) : p.rest
        p.phase += h
        const wind = stir * (Math.sin(p.phase * 1.3) + 0.5 * Math.sin(p.phase * 2.3 + 1.1))
        if (moving) {
          p.swingVel += (-SWING_W * SWING_W * Math.sin(p.swing) - SWING_DAMP * p.swingVel + wind * 1.6) * h
          p.sideVel += (-SIDE_W * SIDE_W * Math.sin(p.side) - SWING_DAMP * p.sideVel + wind * 0.9 * Math.cos(p.phase * 0.7)) * h
          p.turnVel += ((target - p.turn) * TWIST_W * TWIST_W - TWIST_DAMP * p.turnVel + wind * 0.4) * h
        } else {
          // without motion the plaque only turns, critically damped
          p.swing = p.side = p.swingVel = p.sideVel = 0
          p.turnVel += ((target - p.turn) * TWIST_W * TWIST_W - 2 * TWIST_W * p.turnVel) * h
        }
        p.swing += p.swingVel * h
        p.side += p.sideVel * h
        p.turn += p.turnVel * h
        // the boards behind: a plaque swung back far enough strikes them and
        // comes away; a turn alone is held short of them
        if (this.reach(p, p.swing, p.turn, p.side).back < BOARD_FRONT + 0.004) {
          if (p.swing > 0.02 && p.swingVel > 0) {
            this.knock(frame, p, p.swingVel * LINK_DROP)
            p.swingVel *= -0.35
          }
          let lo = 0
          let hi = 1
          for (let i = 0; i < 8; i++) {
            const m = (lo + hi) / 2
            if (this.reach(p, p.swing * m, p.turn * m, p.side).back < BOARD_FRONT + 0.004) hi = m
            else lo = m
          }
          p.swing *= lo
          p.turn *= lo
        }
      }
      // neighbours: when the edges meet, the boards knock and share the blow
      for (let i = 0; i + 1 < this.plaques.length; i++) {
        const a = this.plaques[i]!
        const b = this.plaques[i + 1]!
        const ra = this.reach(a, a.swing, a.turn, a.side)
        const rb = this.reach(b, b.swing, b.turn, b.side)
        const overlap = ra.right + 0.003 - rb.left
        if (overlap <= 0) continue
        const closing = (a.sideVel - b.sideVel) * LINK_DROP
        if (closing > 0) {
          this.knock(frame, a, closing)
          const mean = (a.sideVel + b.sideVel) / 2
          const half = ((a.sideVel - b.sideVel) / 2) * 0.45
          a.sideVel = mean - half
          b.sideVel = mean + half
          // a corner blow sets both turning a little
          a.turnVel -= closing * 1.2
          b.turnVel += closing * 1.2
        }
        a.side -= overlap / (2 * LINK_DROP)
        b.side += overlap / (2 * LINK_DROP)
      }
    }
    for (const p of this.plaques) p.pivot.rotation.set(p.swing, p.turn, p.side, 'XZY')
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.decoys?.dispose()
    this.cords?.dispose()
  }
}
