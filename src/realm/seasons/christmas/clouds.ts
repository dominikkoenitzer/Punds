import * as THREE from 'three'
import { dress } from '../../season'
import type { CloudDress } from '../../skyscape'

// What the cloud sea wears at the blue hour: its sky is the evening's, the
// tops toward the set sun keep a last dim rose, and the shade runs blue.

// every rewrite must find its place, or the clouds would quietly stay as they are
function swap(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`christmas: no "${from.slice(0, 40)}" in the cloud shader`)
  return src.replace(from, to)
}

function skyRewrite(src: string): string {
  const grade = dress()?.sky?.glsl
  if (!grade) throw new Error('christmas: the clouds need the evening sky')
  src = swap(src, 'vec3 skyLookup(vec3 d) {', 'vec3 skyLookupDay(vec3 d) {')
  return swap(
    src,
    '// the colour of the air in direction d, sampled just above the horizon',
    `${grade}
vec3 skyLookup(vec3 d) { return dressSky(skyLookupDay(d), d); }
// the colour of the air in direction d, sampled just above the horizon`,
  )
}

function marchRewrite(src: string): string {
  src = skyRewrite(src)
  src = swap(src, 'mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.95, 0.85), sunward)', 'mix(vec3(0.9, 0.62, 0.56), vec3(0.78, 0.8, 0.95), sunward)')
  return swap(src, 'amb * mix(vec3(0.86, 0.96, 1.12), vec3(1.0), sunward)', 'amb * mix(vec3(0.78, 0.9, 1.22), vec3(0.88, 0.94, 1.12), sunward)')
}

export const clouds: CloudDress = {
  sky: skyRewrite,
  march: marchRewrite,
  wisp: skyRewrite,
  uniforms: () => ({ ...(dress()?.sky?.uniforms ?? {}) }),
  sunColor: new THREE.Color(0.95, 0.6, 0.5).multiplyScalar(1.3),
  shadowColor: new THREE.Color(0.3, 0.38, 0.62).multiplyScalar(0.8),
  farLight: 0.3,
}
