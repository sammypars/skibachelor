// Snow glints: tiny ice crystals that catch the sun up close and twinkle as
// you move past them. Added to a material's shader after lighting, only on
// bright (snow) pixels within a few tens of metres of the camera.

export function addSparkle(mat, { density = 14, range = 45 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSparkleW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSparkleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSparkleW;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float sd = distance(vSparkleW, cameraPosition);
          float nearS = 1.0 - smoothstep(${(range * 0.25).toFixed(1)}, ${range.toFixed(1)}, sd);
          if (nearS > 0.0) {
            vec2 cell = floor(vSparkleW.xz * ${density.toFixed(1)});
            float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
            float tw = fract(sin(dot(cell + floor(cameraPosition.xz * 1.7), vec2(39.3468, 11.1351))) * 24634.6345);
            float glint = step(0.986, h) * step(0.55, tw);
            float lum = dot(gl_FragColor.rgb, vec3(0.333));
            gl_FragColor.rgb += glint * nearS * smoothstep(0.5, 0.8, lum) * 0.85;
          }
        }`,
      );
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|sparkle';
  return mat;
}
