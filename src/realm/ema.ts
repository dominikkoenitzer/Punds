import * as THREE from 'three'
import { EMA_RACK, TERRACE_Y, rng } from './layout'
import { LINKS, type Link } from '../links'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { bevelBox, merge, transformed, worldUv } from './geo'
import { paintedMaterial } from './materials'
import type { Frame, RealmPart, Tier } from './types'

// The plaque rack beside the shrine. Older plaques hang in overlapping rows,
// weathered grey; in front of them hang three new ones in pale wood, one per
// link. Those three hang turned a little away on their cords; pointing at one
// (or the first tap on a phone) turns it to face the visitor, a click (or a
// second tap) opens its link.

const RACK_W = 1.75
const POST_H = 1.92
const RAILS = [1.58, 1.3, 1.02] // above the terrace
const LINK_W = 0.34
const LINK_H = 0.24
const OLD_W = 0.18
const OLD_H = 0.12
// how far each link plaque hangs turned away on its cord, in radians
const LINK_REST = [-0.22, 0.12, 0.28]

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

// the name, brushed in ink on the plaque face, as a transparent texture
function nameTexture(name: string, w: number, h: number): THREE.CanvasTexture {
  const px = 1024
  const c = document.createElement('canvas')
  c.width = px
  c.height = Math.round((px * h) / w)
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = 'rgba(18, 14, 11, 0.94)'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const size = Math.round(c.height * 0.3)
  g.font = `600 ${size}px 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`
  // ink pools a little: draw twice, the second slightly offset and fainter
  g.shadowColor = 'rgba(18, 14, 11, 0.35)'
  g.shadowBlur = size * 0.04
  g.fillText(name, c.width / 2, c.height * 0.56)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

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
  turn: number
  turnVel: number
  swing: number
  phase: number
  hit: THREE.Mesh | null
  glow: THREE.MeshStandardMaterial | null
  focus: number
}

export class EmaRack implements RealmPart {
  readonly object = new THREE.Group()
  private plaques: Plaque[] = []
  private hits: THREE.Object3D[] = []
  private hovered: Plaque | null = null
  private armed: Plaque | null = null
  private disposables: { dispose(): void }[] = []
  private raycaster = new THREE.Raycaster()
  private camLocal = new THREE.Vector3()
  private decoys: THREE.InstancedMesh | null = null
  private cords: THREE.InstancedMesh | null = null

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
    worldUv(decoyGeo, 0.5)
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
    for (let r = 0; r < RAILS.length; r++) {
      const hooks = 6
      for (let hk = 0; hk < hooks; hk++) {
        const hx = -RACK_W / 2 + 0.16 + ((RACK_W - 0.32) * hk) / (hooks - 1) + (rand() - 0.5) * 0.04
        // the middle of the top rail belongs to the three link plaques
        if (r === 0 && Math.abs(hx) < 0.62) continue
        const n = 3 + Math.floor(rand() * 4)
        for (let j = 0; j < n; j++) {
          const k = 0.95 + rand() * 0.3
          hung.push({
            x: hx + (rand() - 0.5) * 0.05,
            y: RAILS[r] - 0.06 - j * 0.012 - rand() * 0.01,
            z: 0.03 + j * 0.0085,
            k,
            tilt: (rand() - 0.5) * 0.16,
            turn: (rand() - 0.5) * 0.18,
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
    const linkGeo = plaqueGeometry(LINK_W, LINK_H, 0.009)
    worldUv(linkGeo, 0.6)
    const faceGeo = new THREE.ShapeGeometry(plaqueShape(LINK_W * 0.97, LINK_H * 0.97))
    faceGeo.translate(0, -LINK_H * 0.97 + 0.012, 0.0062)
    // map the face's texture coordinates to the plaque's bounds
    {
      const p = faceGeo.getAttribute('position')
      const uv = faceGeo.getAttribute('uv')
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (LINK_W * 0.97) + 0.5, (p.getY(i) + LINK_H * 0.97 - 0.012) / (LINK_H * 0.97))
    }
    const hitGeo = new THREE.BoxGeometry(LINK_W * 1.25, LINK_H * 1.35, 0.06)
    hitGeo.translate(0, -LINK_H / 2, 0)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    const linkCordMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.6, 0.05, 0.035), roughness: 0.65 })
    this.disposables.push(linkCordMat)
    this.disposables.push(linkGeo, faceGeo, hitGeo, hitMat)
    LINKS.forEach((link, i) => {
      const pivot = new THREE.Group()
      const x = (i - (LINKS.length - 1) / 2) * 0.42
      pivot.position.set(x, RAILS[0] - 0.005, 0.06)
      const mat = paintedMaterial(cedar, new THREE.Color('#ecdcb8').convertSRGBToLinear(), { roughness: 0.75, metalness: 0, emissive: new THREE.Color(1, 0.7, 0.4), emissiveIntensity: 0 })
      mat.metalnessMap = null
      const body = new THREE.Mesh(linkGeo, mat)
      body.castShadow = true
      body.receiveShadow = true
      pivot.add(body)
      const tex = nameTexture(link.name, LINK_W, LINK_H)
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
      const face = new THREE.Mesh(faceGeo, faceMat)
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
      this.plaques.push({ pivot, link, rest: LINK_REST[i % LINK_REST.length], turn: 0, turnVel: 0, swing: 0, phase: i * 2.1, hit, glow: mat, focus: 0 })
    })
    for (const p of this.plaques) p.turn = p.rest

    this.object.position.set(EMA_RACK.x, TERRACE_Y, EMA_RACK.z)
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

  // a mouse hover; touches go through tap()
  hover(ray: THREE.Ray | null): void {
    this.hovered = this.pick(ray)
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
    if (touch && this.armed !== p) {
      this.armed = p
      this.hovered = p
      return true
    }
    window.open(p.link.href, '_blank', 'noopener,noreferrer')
    this.armed = null
    return true
  }

  update(frame: Frame): void {
    const dt = frame.dt
    // the turn that makes a plaque face the camera, in rack space
    this.camLocal.copy(frame.camera.position)
    this.object.worldToLocal(this.camLocal)
    for (const p of this.plaques) {
      const facing = Math.atan2(this.camLocal.x - p.pivot.position.x, this.camLocal.z - p.pivot.position.z)
      const active = p === this.hovered || p === this.armed
      p.focus += ((active ? 1 : 0) - p.focus) * Math.min(1, dt * 6)
      const target = p.link ? THREE.MathUtils.lerp(p.rest, facing, p.focus) : p.rest
      // a damped spring on the cord: a turn overshoots a little and settles
      const k = 22
      const c = 7
      p.turnVel += ((target - p.turn) * k - p.turnVel * c) * dt
      p.turn += p.turnVel * dt
      p.phase += dt
      const breeze = frame.motion * (Math.sin(p.phase * 1.3) * 0.05 + Math.sin(p.phase * 2.9) * 0.02)
      p.pivot.rotation.set(Math.sin(p.phase * 1.7) * 0.03 * frame.motion, p.turn + breeze, p.swing)
      if (p.glow) p.glow.emissiveIntensity = p.focus * 0.12
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.decoys?.dispose()
    this.cords?.dispose()
  }
}
