// The Jack-o'-Lantern's flame: a few crossed ribbons drawn by a small shader (a licking, noisy teardrop that runs from a
// white-hot core through orange to dark red at the tips) plus embers that float up, fade and shrink. One cheap mesh,
// drawn additively. Presentation only.

import * as THREE from 'three';

/** Time shared by every flame; set from the monster's animation clock. */
export const flameClock = { value: 0 };

const VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute float aKind;
attribute float aSeed;
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
varying vec2 vCorner;
varying float vKind;
varying float vLife;
varying float vSeed;
void main() {
  vUv = uv;
  vKind = aKind;
  vSeed = aSeed;
  vCorner = aCorner;
  vLife = 0.0;
  float t = uTime + uPhase;
  vec3 p = position;
  if (aKind < 0.5) {
    // the flame sways and leans, more toward the tip
    float h = uv.y;
    p.x += (sin(t * 8.0 + h * 4.0 + aSeed * 6.0) * 0.045 + sin(t * 3.1 + aSeed) * 0.03) * h * h;
    p.z += cos(t * 6.5 + h * 3.0 + aSeed * 4.0) * 0.035 * h * h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  } else {
    // an ember: rises from the flame, drifts sideways, shrinks as it fades
    float life = fract(t * (0.35 + aSeed * 0.3) + aSeed * 11.0);
    vLife = life;
    vec3 c = position + vec3(sin(aSeed * 40.0 + t * 2.4) * 0.14 * life, life * 0.9, cos(aSeed * 25.0 + t * 1.9) * 0.1 * life);
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    mv.xy += aCorner * 0.028 * (1.0 - life);
    gl_Position = projectionMatrix * mv;
  }
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
varying vec2 vCorner;
varying float vKind;
varying float vLife;
varying float vSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  if (vKind > 0.5) {
    float d = length(vCorner);
    float a = smoothstep(1.0, 0.2, d) * (1.0 - vLife);
    gl_FragColor = vec4(mix(vec3(1.0, 0.75, 0.25), vec3(1.0, 0.3, 0.05), vLife), a);
    return;
  }
  float t = uTime + uPhase;
  vec2 q = vec2((vUv.x - 0.5) * 2.0, vUv.y);
  // turbulence rises with the flame
  float n = noise(vec2(q.x * 2.6 + vSeed * 7.0, q.y * 2.2 - t * 2.8)) * 0.65 + noise(vec2(q.x * 5.5, q.y * 4.5 - t * 5.0)) * 0.35;
  float width = (1.0 - pow(q.y, 0.85)) * 0.78 + 0.04;
  float bend = (n - 0.5) * 0.5 * q.y;
  float body = 1.0 - smoothstep(width * 0.35, width, abs(q.x + bend));
  float tip = smoothstep(1.0, 0.5, q.y + (n - 0.5) * 0.35);
  float base = smoothstep(0.0, 0.08, q.y);
  float density = body * tip * base;
  // heat: hottest low in the middle, cooling toward the edge and tip
  float heat = clamp(density * (1.15 - q.y * 0.65) + (n - 0.5) * 0.25, 0.0, 1.0);
  vec3 col = mix(vec3(0.55, 0.05, 0.01), vec3(1.0, 0.38, 0.04), smoothstep(0.05, 0.4, heat));
  col = mix(col, vec3(1.0, 0.82, 0.25), smoothstep(0.4, 0.75, heat));
  col = mix(col, vec3(1.0, 0.97, 0.8), smoothstep(0.75, 1.0, heat));
  gl_FragColor = vec4(col * 1.25, density * 0.95);
}
`;

/** The flame's material: additive, no depth writes, shared by every Jack-o'-Lantern. */
export function createFlameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: flameClock, uPhase: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Three crossed ribbons for the flame (each split into rows so it can sway) and a handful of ember quads. */
export function flameGeometry(width = 0.5, height = 0.8, embers = 7): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], corners: number[] = [], kinds: number[] = [], seeds: number[] = [], index: number[] = [];
  const rows = 6;
  const push = (x: number, y: number, z: number, u: number, v: number, cx: number, cy: number, kind: number, seed: number): number => {
    positions.push(x, y, z);
    uvs.push(u, v);
    corners.push(cx, cy);
    kinds.push(kind);
    seeds.push(seed);
    return positions.length / 3 - 1;
  };
  for (let k = 0; k < 3; k += 1) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * width * 0.5, dz = Math.sin(a) * width * 0.5;
    const first = positions.length / 3;
    for (let r = 0; r <= rows; r += 1) {
      const v = r / rows;
      push(-dx, v * height, -dz, 0, v, 0, 0, 0, k * 0.37);
      push(dx, v * height, dz, 1, v, 0, 0, 0, k * 0.37);
    }
    for (let r = 0; r < rows; r += 1) {
      const i = first + r * 2;
      index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  for (let e = 0; e < embers; e += 1) {
    const seed = (e + 0.5) / embers;
    const x = (seed * 7.0 % 1 - 0.5) * 0.18, z = (seed * 13.0 % 1 - 0.5) * 0.18;
    const first = positions.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) push(x, 0.1, z, 0, 0, cx, cy, 1, seed);
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  g.setIndex(index);
  // the embers rise above the box the positions suggest, so give the culling box room
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height);
  return g;
}
