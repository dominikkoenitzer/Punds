import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// NetworkGraph — the "data is moving" beat of the Wired.
//
// A loose cluster of glowing icosahedron nodes wired to their nearest
// neighbours, with packets of light streaming along the edges. The whole graph
// slowly rotates about its own centre and pulses subtly with the audio bass.
//
// The host raycasts against `nodeMeshes` and reads `nodeWorldPosition(...)` to
// implement "jack-in" interactions, so those members are part of the contract.

interface Packet {
  a: number // start node index
  b: number // end node index
  progress: number // 0..1 along the edge
  speed: number // 1 / travel-seconds
}

const NODE_COUNT = 18
const NEIGHBOURS_MIN = 2
const NEIGHBOURS_MAX = 3
const PACKET_POOL = 12

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export class NetworkGraph implements SceneFeature {
  readonly group: THREE.Group

  // Public for host "jack-in" raycasting.
  readonly nodeMeshes: THREE.Mesh[] = []

  // --- node state ---
  private readonly nodeGeo: THREE.IcosahedronGeometry
  private readonly nodeMaterials: THREE.MeshBasicMaterial[] = []
  private readonly nodeBaseColors: THREE.Color[] = []
  private readonly nodeRadii: number[] = []
  private readonly nodePhase: number[] = []
  private readonly nodeLocal: THREE.Vector3[] = []

  // --- edges ---
  private readonly edgeGeo: THREE.BufferGeometry
  private readonly edgeMat: THREE.LineBasicMaterial
  private readonly edgeA: number[] = []
  private readonly edgeB: number[] = []
  private readonly edgeCount: number

  // --- packets ---
  private readonly packetTex: THREE.CanvasTexture
  private readonly packetMat: THREE.SpriteMaterial
  private readonly packetSprites: THREE.Sprite[] = []
  private readonly packets: Packet[] = []
  private readonly packetSize = 0.5

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    // Off-centre, mid/background to the right so it reads as a backdrop data
    // structure and not center-stage. Host may override this.group.position.
    this.group.position.set(6, 1, -14)

    // --- nodes -------------------------------------------------------------
    // Single shared geometry (radius 1); per-node radius is applied via scale.
    this.nodeGeo = new THREE.IcosahedronGeometry(1, 0)

    for (let i = 0; i < NODE_COUNT; i++) {
      // Loose cluster: random direction, radius 1.5..5 from the group centre.
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.7, 0.7), rand(-1, 1))
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1)
      dir.normalize().multiplyScalar(rand(1.5, 5))
      this.nodeLocal.push(dir)

      const radius = rand(0.18, 0.35)
      this.nodeRadii.push(radius)
      this.nodePhase.push(Math.random() * Math.PI * 2)

      const base = (Math.random() < 0.35 ? palette.hologram : palette.phosphor).clone()
      this.nodeBaseColors.push(base)

      const mat = new THREE.MeshBasicMaterial({
        color: base.clone(),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      this.nodeMaterials.push(mat)

      const mesh = new THREE.Mesh(this.nodeGeo, mat)
      mesh.position.copy(dir)
      mesh.scale.setScalar(radius)
      this.nodeMeshes.push(mesh)
      this.group.add(mesh)
    }

    // --- edges: connect each node to its 2-3 nearest neighbours ------------
    const seen = new Set<string>()
    const order: number[] = []
    for (let i = 0; i < NODE_COUNT; i++) {
      // Sort other nodes by squared distance to i.
      order.length = 0
      for (let j = 0; j < NODE_COUNT; j++) if (j !== i) order.push(j)
      order.sort(
        (x, y) =>
          this.nodeLocal[i].distanceToSquared(this.nodeLocal[x]) -
          this.nodeLocal[i].distanceToSquared(this.nodeLocal[y]),
      )
      const k = Math.min(
        order.length,
        NEIGHBOURS_MIN + (Math.random() < 0.5 ? 0 : NEIGHBOURS_MAX - NEIGHBOURS_MIN),
      )
      for (let n = 0; n < k; n++) {
        const j = order[n]
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (seen.has(key)) continue
        seen.add(key)
        this.edgeA.push(i)
        this.edgeB.push(j)
      }
    }
    this.edgeCount = this.edgeA.length

    const linePos = new Float32Array(this.edgeCount * 2 * 3)
    for (let e = 0; e < this.edgeCount; e++) {
      const a = this.nodeLocal[this.edgeA[e]]
      const b = this.nodeLocal[this.edgeB[e]]
      const o = e * 6
      linePos[o] = a.x
      linePos[o + 1] = a.y
      linePos[o + 2] = a.z
      linePos[o + 3] = b.x
      linePos[o + 4] = b.y
      linePos[o + 5] = b.z
    }
    this.edgeGeo = new THREE.BufferGeometry()
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
    this.edgeMat = new THREE.LineBasicMaterial({
      color: palette.hologram.clone(),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.group.add(new THREE.LineSegments(this.edgeGeo, this.edgeMat))

    // --- packets -----------------------------------------------------------
    this.packetTex = NetworkGraph.makeGlowTexture()
    this.packetMat = new THREE.SpriteMaterial({
      map: this.packetTex,
      color: palette.phosphor.clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const pool = Math.min(PACKET_POOL, Math.max(1, this.edgeCount))
    for (let p = 0; p < pool; p++) {
      const sprite = new THREE.Sprite(this.packetMat)
      sprite.scale.setScalar(this.packetSize)
      this.group.add(sprite)
      this.packetSprites.push(sprite)

      const packet: Packet = { a: 0, b: 0, progress: 0, speed: 1 }
      this.recycle(packet)
      packet.progress = Math.random() // stagger so they don't all sync
      this.packets.push(packet)
    }
  }

  private recycle(packet: Packet): void {
    if (this.edgeCount === 0) return
    const e = Math.floor(Math.random() * this.edgeCount)
    if (Math.random() < 0.5) {
      packet.a = this.edgeA[e]
      packet.b = this.edgeB[e]
    } else {
      packet.a = this.edgeB[e]
      packet.b = this.edgeA[e]
    }
    packet.progress = 0
    packet.speed = 1 / rand(1, 2) // travel in 1-2s
  }

  update(ctx: FeatureContext): void {
    const { dt, t, motion, audio } = ctx

    // Slow drift of the whole graph about its own centre.
    this.group.rotation.y += dt * motion * 0.04
    this.group.rotation.x = Math.sin(t * 0.07) * 0.05 * motion

    // Node pulse: emissive brightness + scale, subtly driven by the bass.
    for (let i = 0; i < this.nodeMeshes.length; i++) {
      const wobble = Math.sin(t * 1.6 + this.nodePhase[i])
      const pulse = 0.8 + 0.25 * wobble * motion + audio * 0.6
      this.nodeMaterials[i].color.copy(this.nodeBaseColors[i]).multiplyScalar(pulse)
      const s = this.nodeRadii[i] * (1 + 0.08 * wobble * motion + audio * 0.2)
      this.nodeMeshes[i].scale.setScalar(s)
    }

    // Advance packets along their edges (local space; the group transform is
    // applied by the scene graph, so node-local positions are correct here).
    const blipBoost = 1 + audio * 0.3
    for (let p = 0; p < this.packets.length; p++) {
      const packet = this.packets[p]
      packet.progress += dt * motion * packet.speed
      if (packet.progress >= 1) this.recycle(packet)

      const sprite = this.packetSprites[p]
      sprite.position.lerpVectors(this.nodeLocal[packet.a], this.nodeLocal[packet.b], packet.progress)
      const blip = 0.55 + 0.45 * Math.sin(packet.progress * Math.PI)
      sprite.scale.setScalar(this.packetSize * blip * blipBoost)
    }
  }

  /** Current world position of a node mesh (accounts for the group transform). */
  nodeWorldPosition(mesh: THREE.Mesh, target: THREE.Vector3): THREE.Vector3 {
    return mesh.getWorldPosition(target)
  }

  dispose(): void {
    this.nodeGeo.dispose()
    for (const mat of this.nodeMaterials) mat.dispose()
    this.edgeGeo.dispose()
    this.edgeMat.dispose()
    this.packetMat.dispose()
    this.packetTex.dispose()
  }

  private static makeGlowTexture(): THREE.CanvasTexture {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx2d = canvas.getContext('2d')
    if (ctx2d) {
      const half = size / 2
      const grad = ctx2d.createRadialGradient(half, half, 0, half, half, half)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.25, 'rgba(255,255,255,0.7)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx2d.fillStyle = grad
      ctx2d.fillRect(0, 0, size, size)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }
}
