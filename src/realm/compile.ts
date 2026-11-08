import type * as THREE from 'three'

// three.js asks for the parallel compile extension inside compileAsync and
// warns in the console wherever the browser lacks it. Without it the programs
// are built at once in compile() anyway, so the plain call does the same work
// without the warning.
export function compileAll(renderer: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene | null = null): Promise<unknown> {
  if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(object, camera, scene)
  try {
    renderer.compile(object, camera, scene)
    return Promise.resolve(object)
  } catch (error) {
    return Promise.reject(error)
  }
}
