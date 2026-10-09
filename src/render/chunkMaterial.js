// Shared shader materials for chunk meshes (GLSL3, texture arrays).

import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 aUvw;
in vec2 aLight;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vUvw;
out vec2 vLight;
out float vFogDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vUvw = aUvw;
  vLight = aLight;
  vFogDepth = length(mv.xyz);
}
`;

function frag(water) {
  return /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uDay;
uniform float uBrightness;
uniform vec3 uSkyTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
in vec3 vUvw;
in vec2 vLight;
in float vFogDepth;
out vec4 outColor;
void main() {
  ${water
    // water drifts slowly; wrap within the tile, with gradients from the
    // unwrapped coords so the mip level doesn't jump at the wrap
    ? `vec2 wuv = vUvw.xy + vec2(uTime * 0.045, sin(uTime * 0.6) * 0.06 + uTime * 0.02);
  vec4 tex = textureGrad(uAtlas, vec3(fract(wuv), vUvw.z), dFdx(vUvw.xy), dFdy(vUvw.xy));`
    : 'vec4 tex = texture(uAtlas, vec3(vUvw.xy, vUvw.z));'}
  ${water ? '' : 'if (tex.a < 0.5) discard;'}
  // torchlight is a touch warm; skylight takes the tint of the hour
  vec3 br = clamp(max(vLight.y * vec3(1.0, 0.93, 0.82), vLight.x * uDay * uSkyTint) + 0.04, 0.0, 1.0);
  // brightness setting: lift the darks (gamma), never blow out the brights
  br = pow(br, vec3(1.0 / (1.0 + uBrightness * 1.2)));
  vec3 col = tex.rgb * br;
  // the atlas is sampled as-is (sRGB) and written straight out, while
  // THREE.Color uniforms are linear: convert the fog so it matches the sky
  vec3 fogC = mix(uFogColor * 12.92, 1.055 * pow(uFogColor, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, uFogColor));
  float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
  ${water
    ? 'outColor = vec4(mix(col, fogC, fogF), tex.a * 0.82);'
    : 'outColor = vec4(mix(col, fogC, fogF), 1.0);'}
}
`;
}

export function createChunkMaterials(atlas) {
  const uniforms = {
    uAtlas: { value: atlas.texture },
    uDay: { value: 1.0 },
    uBrightness: { value: 0.0 },   // 0 moody .. 1 bright (settings)
    uSkyTint: { value: new THREE.Vector3(1, 1, 1) },   // set by the sky
    uFogColor: { value: new THREE.Color(0x8fbcec) },
    uFogNear: { value: 80 },
    uFogFar: { value: 140 },
    uTime: { value: 0 },   // seconds, wraps (water drift)
  };

  const opaque = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: frag(false),
  });

  const water = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: frag(true),
    transparent: true,
    depthWrite: true,
  });

  return { opaque, water, uniforms };
}
