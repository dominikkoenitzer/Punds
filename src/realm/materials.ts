import * as THREE from 'three'
import { pbrMaterial, type PbrSet } from './assets'

// Material variants built on the scanned sets.

// Paint over wood: keep the scan's grain and wear as luminance, take the
// colour from `paint`. Used for the vermilion of the torii and the shrine.
export function paintedMaterial(set: PbrSet, paint: THREE.Color, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = pbrMaterial(set, { color: paint, ...params })
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        float paintL = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // worn spots read darker; the paint itself stays saturated
        diffuseColor.rgb *= clamp(0.55 + paintL * 1.6, 0.6, 1.25);
      #endif`,
    )
  }
  mat.customProgramCacheKey = () => 'realm-painted'
  return mat
}

// Stone that has stood outside for a century: moss settles on every surface
// that faces the sky, thickest where water lingers, in patches.
export function weatheredStone(set: PbrSet, moss: THREE.Color, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = pbrMaterial(set, params)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMoss = { value: moss }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStoneWorld;\nvarying vec3 vStoneNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 stoneW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          stoneW = instanceMatrix * stoneW;
        #endif
        vStoneWorld = (modelMatrix * stoneW).xyz;
        vStoneNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uMoss;
        varying vec3 vStoneWorld;
        varying vec3 vStoneNormal;
        float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float sNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float stoneMoss;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float up = clamp(vStoneNormal.y, 0.0, 1.0);
          float n = sNoise(vStoneWorld * 3.1) * 0.6 + sNoise(vStoneWorld * 9.7) * 0.4;
          // moss in patches where water lingers, never a clean ring
          stoneMoss = smoothstep(0.62, 0.9, up * 0.55 + n * 0.65) * up * up;
          // rain streaks: darker below edges, a vertical smear
          float streak = sNoise(vec3(vStoneWorld.x * 7.0, vStoneWorld.y * 0.6, vStoneWorld.z * 7.0));
          diffuseColor.rgb *= mix(1.0, 0.78, smoothstep(0.55, 0.9, streak) * (1.0 - up));
          diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.65 + n * 0.5), stoneMoss);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, stoneMoss);`,
      )
  }
  mat.customProgramCacheKey = () => 'realm-weathered-stone'
  return mat
}
