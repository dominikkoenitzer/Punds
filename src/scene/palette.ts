import * as THREE from 'three'
import type { ScenePalette } from './features/types'

export function readPalette(el: HTMLElement): ScenePalette {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string): string => {
    const val = cs.getPropertyValue(name).trim()
    return val || fallback
  }
  const phosphorStr = v('--phosphor', '#76e4ff')
  const hologramStr = v('--hologram', '#2f7fc4')
  const tachibanaStr = v('--tachibana', '#e7a93c')
  const warningStr = v('--warning', '#d83a2b')
  return {
    voidColor: new THREE.Color(v('--copland-void', '#04101c')),
    phosphor: new THREE.Color(phosphorStr),
    hologram: new THREE.Color(hologramStr),
    tachibana: new THREE.Color(tachibanaStr),
    warning: new THREE.Color(warningStr),
    phosphorStr,
    hologramStr,
    tachibanaStr,
    warningStr,
  }
}
