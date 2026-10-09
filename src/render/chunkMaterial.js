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
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
in vec3 vUvw;
in vec2 vLight;
in float vFogDepth;
out vec4 outColor;
void main() {
  vec4 tex = texture(uAtlas, vec3(vUvw.xy, vUvw.z));
  ${water ? '' : 'if (tex.a < 0.5) discard;'}
  float br = clamp(max(vLight.y, vLight.x * uDay) + 0.04, 0.0, 1.0);
  // brightness setting: lift the darks (gamma), never blow out the brights
  br = pow(br, 1.0 / (1.0 + uBrightness * 1.2));
  vec3 col = tex.rgb * br;
  float fogF = smoothstep(uFogNear, uFogFar, vFogDepth);
  ${water
    ? 'outColor = vec4(mix(col, uFogColor, fogF), tex.a * 0.82);'
    : 'outColor = vec4(mix(col, uFogColor, fogF), 1.0);'}
}
`;
}

export function createChunkMaterials(atlas) {
  const uniforms = {
    uAtlas: { value: atlas.texture },
    uDay: { value: 1.0 },
    uBrightness: { value: 0.0 },   // 0 moody .. 1 bright (settings)
    uFogColor: { value: new THREE.Color(0x8fbcec) },
    uFogNear: { value: 80 },
    uFogFar: { value: 140 },
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
