// The look of the city: buildings with painted walls, lit windows and roofs, and street lamps along the roads.
// Everything here is presentation only: it reads the baked map and draws, and the simulation never sees it.
// Every choice (colours, roofs, lamp spots) comes from a hash of the map's own numbers, so the city looks the same on
// every device and on every visit.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingData, MapData } from '../sim/mapdata.js';
import { Shape } from './monsters/shapes.js';
import { buildStreets } from './streets.js';
import { landmarkModel, landmarksOf, type Landmark } from './landmarks.js';

// ---------- tunables ----------

const CHUNK = 100; // metres: geometry is merged per chunk so the camera can skip whole chunks

/** How a city's buildings look: wall and roof colours, how common signs, chimneys and rooftop tanks are. */
export interface CityStyle {
  readonly facades: readonly number[];
  readonly roofs: readonly number[];
  readonly flatRoof: number;
  readonly signs: readonly number[];
  readonly signChance: number;
  readonly chimneyChance: number;
  readonly tankChance: number;
}

const STYLES: Readonly<Record<string, CityStyle>> = {
  // Accra: sun-faded pastel plaster and tin roofs
  accra: { facades: [0xe8d9b5, 0xd9a441, 0xc7704f, 0xa9c9a4, 0x8fb4d8, 0xe3a6b4, 0xf0ebe0, 0xcfa27a, 0x9fd0c8], roofs: [0x9c4a3a, 0x6d7a86, 0xa3552f, 0x4f6f6a, 0x7a6a8a], flatRoof: 0x8c8f99, signs: [0xff4fa3, 0x41e0ff, 0xffd23b, 0x7dff6a, 0xff7a2e, 0xb06bff], signChance: 0.4, chimneyChance: 0.25, tankChance: 0.3 },
  // London: London stock brick, red brick and cream stucco under slate, with a chimney on most houses
  london: { facades: [0xb5654a, 0xa05a45, 0xc98a5e, 0xd9c7a0, 0x8d7a6a, 0xe8dcc0, 0x9a6b52, 0x6f7a86], roofs: [0x4a5668, 0x5a4a4a, 0x3d4658, 0x6b3f36], flatRoof: 0x6f7480, signs: [0xd9242f, 0x2f6bd9, 0x2fa05a, 0xffd23b, 0xf0e6d8], signChance: 0.35, chimneyChance: 0.65, tankChance: 0.15 },
  // New York: brick and brownstone, flat roofs with water towers
  newyork: { facades: [0x9a4e3a, 0x7a4636, 0xb26a45, 0x8a6a56, 0xc7a070, 0x6f6a78, 0xa8574a, 0x5f6a7a], roofs: [0x5a5560, 0x4a4a55], flatRoof: 0x4f5360, signs: [0xff3b3b, 0xffd23b, 0x41e0ff, 0xff7a2e, 0xf0f0ff], signChance: 0.5, chimneyChance: 0.05, tankChance: 0.55 },
  // Tokyo: pale concrete and tile, flat roofs, signs everywhere
  tokyo: { facades: [0xd8d8de, 0xbfc4cf, 0xe8e2d4, 0x9aa6b8, 0xcfd6c8, 0xb8a89a, 0xe0d0d6, 0x8fa0a8], roofs: [0x4a5058, 0x3a4a5a, 0x5a4a44], flatRoof: 0x7a808c, signs: [0xff2f8a, 0x2fe0ff, 0xffe02f, 0x6aff4f, 0xff5a2f, 0xb04fff, 0xffffff], signChance: 0.75, chimneyChance: 0.02, tankChance: 0.4 },
  // Mexico City: strong colour: terracotta, ochre, pink, turquoise and cobalt
  mexicocity: { facades: [0xd9604a, 0xe8a23a, 0xe36a9a, 0x2fb0b8, 0x3a6ad0, 0xf0d070, 0xc9503a, 0x7bc86a, 0xe8d9b5], roofs: [0xb04a2f, 0x8a3f2f, 0x6a6f7a], flatRoof: 0x9a8f86, signs: [0xff4f7a, 0xffd23b, 0x41e0b0, 0xff7a2e, 0x6a9bff], signChance: 0.5, chimneyChance: 0.05, tankChance: 0.5 },
};
let style: CityStyle = STYLES['accra']!;
const FACADES_OF = (): readonly number[] => style.facades;

const h32 = (n: number): number => {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
};
const rand01 = (n: number): number => h32(n) / 4294967296;

// ---------- cut-away: buildings between the camera and the monster dissolve ----------

/**
 * A funnel from the camera to the monster: building surfaces inside it are cut away (with a dithered edge), so a wall
 * close to the camera never hides the monster. Wide near the camera, narrow at the monster. Set each frame by the view.
 */
export const cutaway = {
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  /** Funnel radius (metres) at the camera and at the monster. */
  nearRadius: { value: 7 },
  farRadius: { value: 2.4 },
  /** 0 = off. */
  on: { value: 0 },
};

function makeCutaway(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uCutA'] = { value: cutaway.from };
    shader.uniforms['uCutB'] = { value: cutaway.to };
    shader.uniforms['uCutNear'] = cutaway.nearRadius;
    shader.uniforms['uCutFar'] = cutaway.farRadius;
    shader.uniforms['uCutOn'] = cutaway.on;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `varying vec3 vCutPos;
void main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vCutPos;
uniform vec3 uCutA;
uniform vec3 uCutB;
uniform float uCutNear;
uniform float uCutFar;
uniform float uCutOn;
void main() {
	if (uCutOn > 0.5) {
		vec3 ab = uCutB - uCutA;
		float t = dot(vCutPos - uCutA, ab) / dot(ab, ab);
		if (t > 0.0 && t < 0.97) {
			float d = distance(vCutPos, uCutA + ab * t);
			float r = mix(uCutNear, uCutFar, t);
			float inside = 1.0 - smoothstep(r * 0.6, r, d);
			float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
			if (n < inside) discard;
		}
	}`,
      );
  };
  material.customProgramCacheKey = () => 'frankenrun-cutaway';
}

// ---------- facade texture ----------

let facadeTexture: THREE.CanvasTexture | undefined;
let facadeMask: THREE.CanvasTexture | undefined;
/** Windows on a 16 m x 12 m tile (4 columns, 4 floors); a few are lit. White wall, so the vertex colour paints it. */
function getFacadeTexture(): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  if (facadeTexture !== undefined) return facadeTexture;
  const size = 256, cell = size / 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  // the mask marks the window glass; the shader lights each window separately, so no two buildings share a pattern
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = size;
  maskCanvas.height = size;
  const mctx = maskCanvas.getContext('2d')!;
  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  // plaster: faint speckle (left edge of every cell stays plain, the plinth, parapets and doors sample it)
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 900; k += 1) {
    const sx = rnd() * size, sy = rnd() * size;
    if (sx % cell < 8) continue;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,110,130,0.07)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(sx, sy, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * cell, y = row * cell;
      // floor slab line along the top of each floor (canvas y runs down, texture v runs up: row 3 is the ground floor)
      ctx.fillStyle = '#d4d0dc';
      ctx.fillRect(x, y, cell, 5);
      ctx.fillStyle = '#9a96ab';
      ctx.fillRect(x, y + 5, cell, 2);
      const index = row * 4 + col;
      const on = false;
      const shuttered = (row * 3 + col) % 5 === 0;
      const wx = x + cell * 0.27, wy = y + cell * 0.27, ww = cell * 0.46, wh = cell * 0.5;
      // lintel over the window and a projecting sill under it
      ctx.fillStyle = '#e6e2ec';
      ctx.fillRect(wx - 5, wy - 6, ww + 10, 4);
      ctx.fillStyle = '#e6e2ec';
      ctx.fillRect(wx - 5, wy + wh + 1, ww + 10, 4);
      ctx.fillStyle = '#7c7890';
      ctx.fillRect(wx - 5, wy + wh + 5, ww + 10, 2);
      // frame, then the glass: a gradient, warm when the light is on
      ctx.fillStyle = '#f4f1f8';
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 5);
      const glass = ctx.createLinearGradient(0, wy, 0, wy + wh);
      if (on) { glass.addColorStop(0, '#ffe9a6'); glass.addColorStop(1, '#f0b95a'); } else { glass.addColorStop(0, '#46507c'); glass.addColorStop(1, '#232846'); }
      ctx.fillStyle = glass;
      ctx.fillRect(wx, wy, ww, wh);
      mctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = on ? '#fff6d0' : '#6a72a0';
      ctx.fillRect(wx + 2, wy + 2, ww * 0.3, 2); // a glint
      ctx.fillStyle = on ? '#b98a3c' : '#14172b';
      ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh); // mullion
      ctx.fillRect(wx, wy + wh * 0.42, ww, 2); // transom
      if (on && (index & 1) === 0) {
        ctx.fillStyle = '#3c2a1c'; // somebody standing at the window
        ctx.fillRect(wx + ww * 0.62, wy + wh * 0.5, ww * 0.16, wh * 0.5);
        ctx.fillRect(wx + ww * 0.64, wy + wh * 0.34, ww * 0.12, wh * 0.16);
      }
      if (shuttered) {
        ctx.fillStyle = '#3f6a58';
        ctx.fillRect(wx - 11, wy - 3, 7, wh + 5);
        ctx.fillRect(wx + ww + 4, wy - 3, 7, wh + 5);
        ctx.fillStyle = '#2b4a3e';
        for (let sl = 0; sl < 4; sl += 1) { ctx.fillRect(wx - 11, wy + sl * 6, 7, 1); ctx.fillRect(wx + ww + 4, wy + sl * 6, 7, 1); }
      }
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  facadeTexture = t;
  const mt = new THREE.CanvasTexture(maskCanvas);
  mt.wrapS = THREE.RepeatWrapping;
  mt.wrapT = THREE.RepeatWrapping;
  mt.anisotropy = 4;
  facadeMask = mt;
  return t;
}

// ---------- facade shaders ----------

const HASH_GLSL = `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** Lights each window separately (so no two buildings repeat a pattern) and draws shopfronts, on top of the facade tile. */
function patchWalls(material: THREE.Material, mask: THREE.Texture | undefined): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms['uMask'] = { value: mask ?? null };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float aKind;\nvarying float vKind;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvKind = aKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying float vKind;\nuniform sampler2D uMask;\n${HASH_GLSL}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	float bright = dot(vColor.rgb, vec3(0.34));
	float winMask = texture2D(uMask, vMapUv).r;
	if (winMask > 0.02) {
		vec2 c = floor(vMapUv * 4.0);
		float h = h21(c);
		float lit = step(0.7, h);
		float cool = step(0.86, fract(h * 13.7));
		vec3 litCol = mix(vec3(1.0, 0.8, 0.46), vec3(0.78, 0.9, 1.0), cool);
		vec3 darkCol = vec3(0.08, 0.11, 0.21) * (0.6 + 0.6 * bright);
		diffuseColor.rgb = mix(diffuseColor.rgb, mix(darkCol, litCol * 1.05, lit), clamp(winMask, 0.0, 1.0));
	}
	if (vKind > 0.5) {
		float y = vMapUv.y * 12.0;
		float cu = fract(vMapUv.x * 4.0);
		float h = h21(vec2(floor(vMapUv.x * 4.0), 3.7));
		float pane = step(0.1, cu) * step(cu, 0.9) * step(0.7, y) * step(y, 2.55);
		float mull = step(abs(cu - 0.5), 0.025) * pane;
		float lit = step(0.3, h);
		vec3 inside = mix(vec3(0.16, 0.14, 0.2), mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.95, 0.85), step(0.7, fract(h * 9.1))), lit);
		inside *= 0.72 + 0.4 * (1.0 - clamp((y - 0.7) / 1.85, 0.0, 1.0));
		vec3 col = mix(diffuseColor.rgb, inside, pane);
		col = mix(col, vec3(0.1, 0.09, 0.12), mull);
		col = mix(col, vec3(0.12, 0.1, 0.15) * (0.6 + 0.8 * bright), step(2.55, y));
		diffuseColor.rgb = col;
	}`);
  };
  material.customProgramCacheKey = () => 'frankenrun-cutaway-walls';
}

/** A glass curtain wall for towers, drawn entirely in the shader: mullions, floor bands, lit offices in runs, a sky tint. */
function patchGlass(material: THREE.Material): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vGlassUv;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlassUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec2 vGlassUv;\n${HASH_GLSL}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	{
		vec2 m = vec2(vGlassUv.x * 16.0, vGlassUv.y * 12.0);
		vec2 cell = vec2(floor(m.x / 1.5), floor(m.y / 3.6));
		vec2 f = vec2(fract(m.x / 1.5), fract(m.y / 3.6));
		float frame = min(step(f.x, 0.07) + step(0.93, f.x) + step(f.y, 0.1), 1.0);
		float bright = dot(diffuseColor.rgb, vec3(0.34));
		vec3 sky = mix(vec3(0.16, 0.21, 0.36), vec3(0.34, 0.42, 0.62), clamp(m.y / 140.0, 0.0, 1.0));
		float run = h21(vec2(floor(cell.x / 4.0), cell.y));
		float lit = step(0.74, run) * step(0.35, h21(cell + 5.1));
		vec3 glass = mix(sky * (0.55 + 1.1 * bright), vec3(0.95, 0.78, 0.52), lit);
		diffuseColor.rgb = mix(glass, diffuseColor.rgb * 0.55, frame);
	}`);
  };
  material.customProgramCacheKey = () => 'frankenrun-cutaway-glass';
}

// ---------- footprint helpers ----------

interface Footprint {
  readonly xs: number[];
  readonly zs: number[];
  readonly area: number;
  readonly cx: number;
  readonly cz: number;
}

function footprintOf(b: BuildingData): Footprint | undefined {
  const xs: number[] = [], zs: number[] = [];
  for (let k = 0; k < b.pts.length; k += 2) {
    const x = b.pts[k]! / 10, z = b.pts[k + 1]! / 10;
    const lx = xs[xs.length - 1], lz = zs[zs.length - 1];
    if (lx !== undefined && Math.hypot(x - lx, z - lz!) < 0.05) continue;
    xs.push(x);
    zs.push(z);
  }
  if (xs.length > 2 && Math.hypot(xs[0]! - xs[xs.length - 1]!, zs[0]! - zs[zs.length - 1]!) < 0.05) {
    xs.pop();
    zs.pop();
  }
  if (xs.length < 3) return undefined;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    a += xs[i]! * zs[j]! - xs[j]! * zs[i]!;
    cx += xs[i]!;
    cz += zs[i]!;
  }
  return { xs, zs, area: a / 2, cx: cx / xs.length, cz: cz / xs.length };
}

function inside(f: Footprint, x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = f.xs.length - 1; i < f.xs.length; j = i, i += 1) {
    if (f.zs[i]! > z !== f.zs[j]! > z && x < ((f.xs[j]! - f.xs[i]!) * (z - f.zs[i]!)) / (f.zs[j]! - f.zs[i]!) + f.xs[i]!) c = !c;
  }
  return c;
}

// ---------- drawing ----------

const moon = new THREE.Vector3(-0.45, 0.8, -0.3).normalize();
const shadeFor = (nx: number, ny: number, nz: number): number => 0.5 + 0.62 * Math.max(0, nx * moon.x + ny * moon.y + nz * moon.z);

interface Chunk {
  cars: THREE.BufferGeometry[];
  props: THREE.BufferGeometry[];
  signs: THREE.BufferGeometry[];
  walls: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[];
  lamps: THREE.BufferGeometry[];
  pools: THREE.BufferGeometry[];
}

function chunkOf(chunks: Map<string, Chunk>, x: number, z: number): Chunk {
  const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  let c = chunks.get(key);
  if (c === undefined) {
    c = { cars: [], props: [], signs: [], walls: [], glass: [], roofs: [], lamps: [], pools: [] };
    chunks.set(key, c);
  }
  return c;
}

function wallGeometry(w: WallBuilder): THREE.BufferGeometry {
  const g = geometryFrom(w.p, w.c, w.u);
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(w.k, 1));
  return g;
}

function geometryFrom(positions: number[], colors: number[], uvs?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

// A plain stretch of the facade tile (no window, no floor line): the plinth, parapets and doors use it for flat colour.
const PLAIN_U = 4 / 256, PLAIN_V = 1 - 32 / 256;
const STONE = new THREE.Color(0x6d6a78);
const PLINTH = 0.6; // metres of darker stone at the foot of every wall
const TOWER_H = 45; // buildings at least this tall get a glass curtain wall
const SHOP_TOP = 3.2; // a shopfront fills the ground floor up to this height
const FLOOR = 3; // metres per floor: matches the facade tile (4 floors in 12 m)

type P3 = readonly [number, number, number];

/** Collects wall triangles (position, colour, uv) for one building. */
class WallBuilder {
  readonly p: number[] = [];
  readonly c: number[] = [];
  readonly u: number[] = [];
  /** 0 for a window wall, 1 for a shopfront. */
  readonly k: number[] = [];
  /** A quad a-b-c-d (anticlockwise seen from outside), flat colour from the plain part of the tile. */
  flat(a: P3, b: P3, c: P3, d: P3, color: THREE.Color, shade: number): void {
    const v = [a, b, c, a, c, d];
    for (const q of v) {
      this.p.push(q[0], q[1], q[2]);
      this.c.push(color.r * shade, color.g * shade, color.b * shade);
      this.u.push(PLAIN_U, PLAIN_V);
      this.k.push(0);
    }
  }
}

/** Walls (plinth, windowed body, cornice, parapet), then a roof: pitched with eaves over small houses, flat over big blocks. */
function addBuilding(i: number, b: BuildingData, chunk: Chunk): void {
  const f = footprintOf(b);
  if (f === undefined) return;
  const height = Math.max(2.5, b.h / 10);
  const seed = Math.floor(f.cx * 13 + f.cz * 7) + i * 101;
  const tint = new THREE.Color(FACADES_OF()[h32(seed) % FACADES_OF().length]!);
  const n = f.xs.length;
  const sign = f.area >= 0 ? 1 : -1; // winding, so the wall normal points outward
  const small = Math.abs(f.area) < 220 && height < 9 && inside(f, f.cx, f.cz);
  const tall = height >= 9;
  const trim = new THREE.Color(tint).lerp(new THREE.Color(0xf4efe4), 0.5);
  const plinth = new THREE.Color(tint).lerp(STONE, 0.6);

  const walls = new WallBuilder();
  const wp = walls.p;
  const glassWalls = new WallBuilder();
  const isTower = height >= TOWER_H;
  // the longest wall of some buildings is a shopfront with a sign, a door and an awning
  let shopWall = -1;
  if (rand01(seed + 21) < style.signChance && height < 22) {
    let longest = 0;
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n;
      const len = Math.hypot(f.xs[j]! - f.xs[k]!, f.zs[j]! - f.zs[k]!);
      if (len > longest) { longest = len; shopWall = k; }
    }
    if (longest <= 5) shopWall = -1;
  }
  const tileShift = h32(seed + 3) % 61; // shifts each building along the facade tile so lit windows differ
  let balconies = tall && height < 34 && rand01(seed + 61) < 0.5;
  for (let k = 0; k < n; k += 1) {
    const j = (k + 1) % n;
    const x0 = f.xs[k]!, z0 = f.zs[k]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) continue;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const nx = sign * uz, nz = -sign * ux; // outward
    const wall = new THREE.Color(tint).multiplyScalar(0.94 + 0.12 * rand01(seed + k * 17)); // each wall a touch different
    const shade = shadeFor(nx, 0, nz);
    const bottom = shade * 0.78, top = shade;
    const u1 = len / 16;
    // the body: windows tiled along it (the tile starts at the wall's own start, so windows sit at 2, 6, 10 ... metres)
    const y0 = PLINTH, y1 = height;
    const ua = tileShift + k * 5, ub = ua + u1; // whole tiles, so windows still line up
    const body = (target: WallBuilder, ya: number, yb: number, kind: number): void => {
      const sa = bottom + (top - bottom) * ((ya - y0) / (y1 - y0)), sb = bottom + (top - bottom) * ((yb - y0) / (y1 - y0));
      const va = ya / 12, vb = yb / 12;
      const corners = [
        [x0, ya, z0, ua, va, sa], [x1, ya, z1, ub, va, sa], [x1, yb, z1, ub, vb, sb],
        [x0, ya, z0, ua, va, sa], [x1, yb, z1, ub, vb, sb], [x0, yb, z0, ua, vb, sb],
      ] as const;
      for (const v of corners) {
        target.p.push(v[0], v[1], v[2]);
        target.c.push(wall.r * v[5], wall.g * v[5], wall.b * v[5]);
        target.u.push(v[3], v[4]);
        target.k.push(kind);
      }
    };
    const faceTarget = isTower ? glassWalls : walls;
    if (k === shopWall && height > SHOP_TOP + 1) {
      body(walls, y0, SHOP_TOP, 1);
      body(faceTarget, SHOP_TOP, y1, 0);
    } else body(faceTarget, y0, y1, 0);
    // the plinth: darker stone, a hair proud of the wall so it reads as a step
    const o = 0.06;
    const ax: P3 = [x0 + nx * o, 0, z0 + nz * o], bx: P3 = [x1 + nx * o, 0, z1 + nz * o];
    walls.flat(ax, bx, [bx[0], PLINTH, bx[2]], [ax[0], PLINTH, ax[2]], plinth, shade * 0.85);
    if (len < 3) continue;
    if (tall) {
      // cornice: a lit lip round the top of the wall, standing out from it
      const e = 0.32;
      const lo: P3 = [x0 + nx * e, height - 0.34, z0 + nz * e], lo1: P3 = [x1 + nx * e, height - 0.34, z1 + nz * e];
      const hi: P3 = [lo[0], height, lo[2]], hi1: P3 = [lo1[0], height, lo1[2]];
      walls.flat(lo, lo1, hi1, hi, trim, shade);
      walls.flat(hi, hi1, [x1, height, z1], [x0, height, z0], trim, shadeFor(0, 1, 0));
      // parapet: the wall carries on above the roof
      const pr: P3 = [x0, height + 0.7, z0], pr1: P3 = [x1, height + 0.7, z1];
      walls.flat([x0, height, z0], [x1, height, z1], pr1, pr, wall, top * 0.92);
    }
    if (balconies && len > 6 && height > 10) {
      // a balcony on the first long wall: a slab and a rail on each upper floor, in front of a window
      balconies = false;
      const cols = Math.floor((len - 2) / 4);
      const col = 1 + (h32(seed + 5) % Math.max(1, cols - 1));
      const d = col * 4 + 2;
      const cx = x0 + ux * d, cz = z0 + uz * d;
      const floors = Math.min(3, Math.floor(height / FLOOR) - 1);
      for (let fl = 1; fl <= floors; fl += 1) {
        const y = fl * FLOOR + 0.05;
        const hw = 1.25, dep = 0.9;
        const bl: P3 = [cx - ux * hw, 0, cz - uz * hw], br: P3 = [cx + ux * hw, 0, cz + uz * hw];
        const fo = (p: P3, off: number, yy: number): P3 => [p[0] + nx * off, yy, p[2] + nz * off];
        // slab top and front, then a low rail (front and top)
        walls.flat(fo(bl, 0.02, y), fo(br, 0.02, y), fo(br, dep, y), fo(bl, dep, y), trim, shadeFor(0, 1, 0));
        walls.flat(fo(bl, dep, y - 0.18), fo(br, dep, y - 0.18), fo(br, dep, y), fo(bl, dep, y), trim, shade * 0.9);
        walls.flat(fo(bl, dep, y), fo(br, dep, y), fo(br, dep, y + 1.0), fo(bl, dep, y + 1.0), STONE, shade * 0.7);
        walls.flat(fo(bl, dep, y + 1.0), fo(br, dep, y + 1.0), fo(br, dep - 0.1, y + 1.0), fo(bl, dep - 0.1, y + 1.0), trim, shadeFor(0, 1, 0));
      }
    }
  }
  if (wp.length > 0) chunk.walls.push(wallGeometry(walls));
  if (glassWalls.p.length > 0) chunk.glass.push(wallGeometry(glassWalls));

  // A glowing shop sign, a door and an awning on the longest wall of some buildings (street level, facing out).
  if (shopWall >= 0) {
    const bk = shopWall;
    const blen = Math.hypot(f.xs[(bk + 1) % n]! - f.xs[bk]!, f.zs[(bk + 1) % n]! - f.zs[bk]!);
    {
      const j = (bk + 1) % n;
      const x0 = f.xs[bk]!, z0 = f.zs[bk]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
      const ux = (x1 - x0) / blen, uz = (z1 - z0) / blen;
      const nx = sign * uz, nz = -sign * ux;
      const w = Math.min(3.6, blen * 0.55), h = 0.8, y0 = 2.55;
      const t = 0.3 + 0.4 * rand01(seed + 33);
      const cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
      const neon = new THREE.Color(style.signs[h32(seed + 44) % style.signs.length]!);
      const dark = new THREE.Color(0x14121f);
      const sg = new WallBuilder();
      const at = (along: number, off: number, y: number): P3 => [cx + ux * along + nx * off, y, cz + uz * along + nz * off];
      const push = (a: P3, b2: P3, c2: P3, d2: P3, c: THREE.Color, shade = 1): void => {
        sg.flat(a, b2, c2, d2, c, shade);
      };
      const board = (grow: number, off: number, c: THREE.Color): void => {
        const hw = w / 2 + grow, yl = y0 - grow, yh = y0 + h + grow;
        push(at(-hw, off, yl), at(hw, off, yl), at(hw, off, yh), at(-hw, off, yh), c);
      };
      board(0.12, 0.05, dark); // backing board
      board(0, 0.1, neon); // the glowing panel
      // a door under the sign and a striped awning over it
      const dw = 0.55;
      const doorOff = 0.07;
      push(at(-dw, doorOff, 0.05), at(dw, doorOff, 0.05), at(dw, doorOff, 2.15), at(-dw, doorOff, 2.15), new THREE.Color(0x2a2336), shadeFor(nx, 0, nz) * 0.9);
      const awn = new THREE.Color(style.signs[h32(seed + 77) % style.signs.length]!).lerp(new THREE.Color(0x201a30), 0.35);
      const aw = Math.min(w * 0.5, 1.4);
      for (let s = 0; s < 2; s += 1) {
        const a0 = -aw + s * aw, a1 = a0 + aw;
        push(at(a0, 0.08, 2.4), at(a1, 0.08, 2.4), at(a1, 0.95, 2.2), at(a0, 0.95, 2.2), s % 2 === 0 ? awn : new THREE.Color(0xf0e6d8), 0.95);
      }
      chunk.signs.push(geometryFrom(sg.p, sg.c, sg.u));
    }
  }

  // roof
  const rp: number[] = [], rc: number[] = [];
  if (small) {
    const roof = new THREE.Color(style.roofs[h32(seed + 5) % style.roofs.length]!);
    const rise = 1.2 + Math.min(2, Math.sqrt(Math.abs(f.area)) * 0.1);
    const eave = 0.45; // the roof overhangs the walls
    const out = (x: number, z: number): [number, number] => {
      const dx = x - f.cx, dz = z - f.cz;
      const l = Math.hypot(dx, dz) || 1;
      return [x + (dx / l) * eave, z + (dz / l) * eave];
    };
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n;
      const x0 = f.xs[k]!, z0 = f.zs[k]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
      const ex = x1 - x0, ez = z1 - z0;
      const [ox0, oz0] = out(x0, z0), [ox1, oz1] = out(x1, z1);
      const tri = [ox0, height - 0.15, oz0, ox1, height - 0.15, oz1, f.cx, height + rise, f.cz];
      // outward normal of this roof face, for the baked shading
      const len = Math.hypot(ex, ez) || 1;
      const nx = (sign * ez) / len, nz = (-sign * ex) / len;
      const slope = rise / Math.max(1, Math.hypot(f.cx - x0, f.cz - z0));
      const l = Math.hypot(nx, slope, nz) || 1;
      const shade = shadeFor(nx / l, slope / l, nz / l);
      for (let v = 0; v < 3; v += 1) {
        const ridge = v === 2 ? 1.12 : 1; // the ridge catches a little more light than the eaves
        rp.push(tri[v * 3]!, tri[v * 3 + 1]!, tri[v * 3 + 2]!);
        rc.push(roof.r * shade * ridge, roof.g * shade * ridge, roof.b * shade * ridge);
      }
    }
    // a chimney on some houses
    if (rand01(seed + 13) < style.chimneyChance) {
      const cxp = f.cx + (f.xs[0]! - f.cx) * 0.35, czp = f.cz + (f.zs[0]! - f.cz) * 0.35;
      if (inside(f, cxp, czp)) addProp(rp, rc, 'chimney', cxp, height + rise * 0.55, czp);
    }
  } else {
    const flat = new THREE.Color(style.flatRoof).lerp(new THREE.Color(FACADES_OF()[h32(seed) % FACADES_OF().length]!), 0.15);
    const shade = shadeFor(0, 1, 0);
    const contour = f.xs.map((x, k) => new THREE.Vector2(x, f.zs[k]!));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      const pts = [contour[t[0]!]!, contour[t[1]!]!, contour[t[2]!]!];
      // make the top face point up whichever way the footprint winds
      const area = (pts[1]!.x - pts[0]!.x) * (pts[2]!.y - pts[0]!.y) - (pts[2]!.x - pts[0]!.x) * (pts[1]!.y - pts[0]!.y);
      const ordered = area > 0 ? [pts[0]!, pts[2]!, pts[1]!] : pts;
      for (const p of ordered) {
        rp.push(p.x, height, p.y);
        rc.push(flat.r * shade, flat.g * shade, flat.b * shade);
      }
    }
    // rooftop clutter on the bigger roofs: a water tank, an air-conditioning box, a stairwell
    if (inside(f, f.cx, f.cz) && Math.abs(f.area) > 60) {
      const r = rand01(seed + 9);
      if (r < style.tankChance) addProp(rp, rc, 'tank', f.cx, height, f.cz);
      else if (r < style.tankChance + 0.3) addProp(rp, rc, 'stair', f.cx, height, f.cz);
      if (rand01(seed + 19) < 0.5) {
        const ax = f.cx + (f.xs[1 % n]! - f.cx) * 0.4, az = f.cz + (f.zs[1 % n]! - f.cz) * 0.4;
        if (inside(f, ax, az)) addProp(rp, rc, 'ac', ax, height, az);
      }
    }
  }
  if (rp.length > 0) chunk.roofs.push(geometryFrom(rp, rc));
}

const roofProps = new Map<string, { pos: Float32Array; col: Float32Array }>();
/** Appends a rooftop prop (shaded, flat-coloured triangles) at a spot on a roof. */
function addProp(rp: number[], rc: number[], kind: 'tank' | 'stair' | 'ac' | 'chimney', x: number, y: number, z: number): void {
  let t = roofProps.get(kind);
  if (t === undefined) {
    const s = new Shape();
    if (kind === 'tank') {
      s.box(1.2, 1.0, 1.2, 0x4a4d5a, { p: [0, 0.5, 0] }); // stand
      s.cyl(0.95, 0.95, 1.5, 6, 0x5f86a8, { p: [0, 1.75, 0] }, true); // the tank
    } else if (kind === 'stair') {
      s.box(2.4, 1.7, 2.0, 0x7a7e8c, { p: [0, 0.85, 0] });
      s.box(0.7, 1.2, 0.08, 0x2a2336, { p: [0.3, 0.6, 1.02] });
    } else if (kind === 'ac') {
      s.box(1.3, 0.8, 0.9, 0x9ca0ae, { p: [0, 0.4, 0] });
    } else {
      s.box(0.7, 1.5, 0.7, 0x8a4a3a, { p: [0, 0.75, 0] });
    }
    const g = bakeShade(s.build()).toNonIndexed();
    t = { pos: g.getAttribute('position').array as Float32Array, col: g.getAttribute('color').array as Float32Array };
    g.dispose();
    roofProps.set(kind, t);
  }
  for (let v = 0; v < t.pos.length; v += 3) {
    rp.push(t.pos[v]! + x, t.pos[v + 1]! + y, t.pos[v + 2]! + z);
    rc.push(t.col[v]!, t.col[v + 1]!, t.col[v + 2]!);
  }
}

// (streets: see streets.ts)

// ---------- scenery: parked cars, trees, gravestones, pumpkins ----------

const GLOW = new THREE.Color(0xffe84a);
/** Bakes the moonlight into a Shape's vertex colours (the city is drawn unlit), keeping glowing parts bright. */
function bakeShade(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const nor = g.getAttribute('normal'), col = g.getAttribute('color');
  for (let v = 0; v < nor.count; v += 1) {
    if (Math.abs(col.getX(v) - GLOW.r) < 0.02 && Math.abs(col.getY(v) - GLOW.g) < 0.02 && Math.abs(col.getZ(v) - GLOW.b) < 0.02) continue;
    const s = shadeFor(nor.getX(v), nor.getY(v), nor.getZ(v));
    col.setXYZ(v, Math.min(1, col.getX(v) * s), Math.min(1, col.getY(v) * s), Math.min(1, col.getZ(v) * s));
  }
  g.deleteAttribute('normal');
  return g;
}

const CAR_COLORS = [0xd9d9e0, 0xb02a2a, 0x2a5fb0, 0x1f1f26, 0xe8c640, 0x3a8a4a];
const templates = new Map<string, THREE.BufferGeometry>();
function template(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let t = templates.get(key);
  if (t === undefined) {
    t = bakeShade(build());
    templates.set(key, t);
  }
  return t;
}

function carTemplate(colorIndex: number): THREE.BufferGeometry {
  return template(`car${colorIndex}`, () => {
    const c = CAR_COLORS[colorIndex % CAR_COLORS.length]!;
    const s = new Shape();
    s.box(1.9, 0.62, 4.3, c, { p: [0, 0.6, 0] }); // body (length along +Z)
    s.box(1.8, 0.14, 4.4, 0x1a1a22, { p: [0, 0.3, 0] }); // bumper line and sills
    s.cyl(0.7, 1.0, 0.62, 4, c, { p: [0, 1.2, -0.2], r: [0, Math.PI / 4, 0], s: [1.2, 1, 1.5] }); // tapered cabin
    s.cyl(0.7, 1.0, 0.5, 4, 0x23283a, { p: [0, 1.22, -0.2], r: [0, Math.PI / 4, 0], s: [1.23, 1, 1.2] }); // windows
    for (const sx of [-0.95, 0.95]) for (const sz of [-1.4, 1.4]) {
      s.cyl(0.36, 0.36, 0.3, 8, 0x14141c, { p: [sx, 0.36, sz], r: [0, 0, Math.PI / 2] });
      s.cyl(0.18, 0.18, 0.32, 6, 0xa8abb8, { p: [sx, 0.36, sz], r: [0, 0, Math.PI / 2] }, true); // hubcap
    }
    s.box(1.3, 0.14, 0.08, 0xfff1b8, { p: [0, 0.78, 2.16] }); // headlights
    s.box(1.5, 0.12, 0.08, 0xc02424, { p: [0, 0.78, -2.16] }); // tail lights
    return s.build();
  });
}

function decorTemplate(kind: number, seed: number): THREE.BufferGeometry {
  const leaf = [0x4f7a3a, 0xc96a1e, 0x6a4a8a][seed % 3]!;
  const variant = kind === 0 ? seed % 3 : 0;
  return template(`decor${kind}-${variant}`, () => {
    const s = new Shape();
    if (kind === 0) {
      if (variant === 1) {
        // a palm: a leaning trunk with a crown of drooping fronds
        const trunk = 0x6b5338;
        s.tube([[0, 0, 0], [0.25, 2.2, 0.1], [0.1, 4.4, 0.25], [-0.2, 6.0, 0.3]], 0.3, 0.16, trunk, 5, 8);
        for (let ring = 0; ring < 3; ring += 1) {
          s.cyl(0.33 - ring * 0.03, 0.33 - ring * 0.03, 0.12, 5, 0x4f3d28, { p: [0.2 - ring * 0.13, 1.8 + ring * 1.7, 0.1 + ring * 0.07] }, true); // trunk rings
        }
        const frond = 0x3f8a52;
        for (let k = 0; k < 7; k += 1) {
          const a = (k / 7) * Math.PI * 2;
          const dx = Math.sin(a), dz = Math.cos(a);
          s.tube([[-0.2, 6.0, 0.3], [-0.2 + dx * 1.2, 6.7, 0.3 + dz * 1.2], [-0.2 + dx * 2.5, 6.0, 0.3 + dz * 2.5], [-0.2 + dx * 3.1, 4.9, 0.3 + dz * 3.1]], 0.32, 0.03, k % 2 === 0 ? frond : 0x57a064, 4, 5);
        }
        s.ico(0.3, 0, 0x6b4a2a, { p: [-0.2, 5.8, 0.3] }); // coconuts
      } else {
        s.cyl(0.16, 0.26, 2.4, 5, 0x4a3426, { p: [0, 1.2, 0] }, true);
        const light = new THREE.Color(leaf).lerp(new THREE.Color(0xffffff), 0.18).getHex();
        const dark = new THREE.Color(leaf).lerp(new THREE.Color(0x101820), 0.25).getHex();
        s.ico(1.5, 0, dark, { p: [0, 3.2, 0], s: [1.05, 0.8, 1.05] });
        s.ico(1.1, 0, leaf, { p: [-0.7, 3.9, 0.3] });
        s.ico(1.0, 0, light, { p: [0.55, 4.3, -0.2] });
        s.ico(0.7, 0, light, { p: [0.1, 5.0, 0.4] });
      }
    } else if (kind === 1) {
      const wood = 0x2f2a33;
      s.cyl(0.1, 0.28, 3.4, 5, wood, { p: [0, 1.7, 0] }, true);
      s.limb([0, 2.4, 0], [0.95, 3.6, 0.2], 0.09, 0.03, wood, 5);
      s.limb([0, 2.8, 0], [-0.85, 4.0, -0.3], 0.09, 0.03, wood, 5);
      s.limb([0, 3.1, 0], [0.2, 4.6, 0.7], 0.08, 0.03, wood, 5);
      s.limb([0.4, 3.2, 0.1], [1.1, 4.5, 0.4], 0.05, 0.02, wood, 4);
    } else if (kind === 2) {
      const stone = 0x9a9aa8;
      s.ico(1.3, 0, 0x3a3a2e, { p: [0, 0.05, 0.5], s: [1.6, 0.22, 0.9] });
      s.box(0.8, 1.1, 0.22, stone, { p: [0, 0.6, 0] });
      s.ico(0.42, 0, stone, { p: [0, 1.15, 0], s: [1, 0.6, 0.3] });
      s.box(0.6, 0.8, 0.2, 0x8a8a98, { p: [1.3, 0.4, 0.3], r: [0, 0.25, 0.12] });
      s.box(0.55, 0.7, 0.2, 0x8a8a98, { p: [-1.2, 0.35, 0.5], r: [0, -0.2, -0.1] });
    } else {
      s.ico(0.5, 1, 0xff8a1f, { p: [0, 0.42, 0], s: [1.15, 0.85, 1.15] });
      s.cyl(0.06, 0.09, 0.22, 5, 0x4a6a2a, { p: [0, 0.9, 0], r: [0.15, 0, 0.1] }, true);
      s.box(0.12, 0.12, 0.05, 0xffe84a, { p: [-0.16, 0.5, 0.56] });
      s.box(0.12, 0.12, 0.05, 0xffe84a, { p: [0.16, 0.5, 0.56] });
      s.box(0.36, 0.08, 0.05, 0xffe84a, { p: [0, 0.3, 0.55] });
    }
    return s.build();
  });
}

let lampTemplate: THREE.BufferGeometry | undefined;
/** One street lamp at the origin, its arm reaching along +X. Vertex-coloured: dark metal and a bright cream lamp head. */
function lampGeometry(): THREE.BufferGeometry {
  if (lampTemplate) return lampTemplate;
  const s = new Shape();
  const metal = 0x3d4054;
  s.cyl(0.2, 0.26, 0.5, 6, metal, { p: [0, 0.25, 0] }, true); // base
  s.cyl(0.07, 0.11, 5.7, 6, metal, { p: [0, 3.1, 0] }, true); // pole
  s.box(1.5, 0.09, 0.09, metal, { p: [0.7, 5.95, 0] }); // arm
  s.box(0.2, 0.2, 0.2, metal, { p: [0, 5.9, 0] }); // joint
  s.box(0.62, 0.12, 0.34, 0xfff1b8, { p: [1.35, 5.84, 0] }); // lamp head (drawn bright: it is the light)
  lampTemplate = s.build();
  lampTemplate.deleteAttribute('normal');
  return lampTemplate;
}

let poolTemplate: THREE.BufferGeometry | undefined;
/** A soft warm pool of light on the ground: bright at the centre, fading to nothing at the rim (drawn additively). */
function poolGeometry(): THREE.BufferGeometry {
  if (poolTemplate) return poolTemplate;
  const g = new THREE.CircleGeometry(4.6, 14).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  for (let v = 0; v < pos.count; v += 1) {
    const d = Math.hypot(pos.getX(v), pos.getZ(v)) / 4.6;
    const f = Math.max(0, 1 - d);
    colors.push(0.62 * f * f, 0.45 * f * f, 0.16 * f * f);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  poolTemplate = g;
  return g;
}

/** The direction of a footprint's longest edge, as the yaw that turns a model's +Z axis to run along it. */
function footprintYaw(f: Footprint): number {
  let best = 0, yaw = 0;
  for (let k = 0; k < f.xs.length; k += 1) {
    const j = (k + 1) % f.xs.length;
    const dx = f.xs[j]! - f.xs[k]!, dz = f.zs[j]! - f.zs[k]!;
    const len = Math.hypot(dx, dz);
    if (len > best) { best = len; yaw = Math.atan2(dx, dz); }
  }
  return yaw;
}

/** Puts a landmark where its footprint is: the body joins the buildings (so it dissolves in the cut-away), the glow is kept apart. */
function placeLandmark(lm: Landmark, f: Footprint, chunks: Map<string, Chunk>, beacons: THREE.BufferGeometry[]): void {
  const model = landmarkModel(lm.kind);
  const m = new THREE.Matrix4().makeRotationY(footprintYaw(f)).setPosition(lm.x, 0, lm.z);
  chunkOf(chunks, lm.x, lm.z).roofs.push(bakeShade(model.body.clone().applyMatrix4(m)));
  beacons.push(model.glow.clone().applyMatrix4(m));
}

/** Everything that makes the city look like a city: returns the meshes to add to the world group. */
export function buildCity(map: MapData, tint = 0xffffff, city = 'accra'): THREE.Object3D[] {
  style = STYLES[city] ?? STYLES['accra']!;
  const chunks = new Map<string, Chunk>();
  const landmarks = landmarksOf(map.id);
  const beacons: THREE.BufferGeometry[] = [];
  map.buildings.forEach((b, i) => {
    if (b.car !== undefined) return; // parked cars are drawn below
    const f = footprintOf(b);
    if (f === undefined) return;
    const landmark = landmarks.find((l) => inside(f, l.x, l.z));
    if (landmark !== undefined) {
      placeLandmark(landmark, f, chunks, beacons); // a landmark stands where this plain building would
      return;
    }
    addBuilding(i, b, chunkOf(chunks, f.cx, f.cz));
  });
  // parked cars (they are solid buildings in the map data) and street scenery
  map.buildings.forEach((b) => {
    if (b.car === undefined) return;
    const f = footprintOf(b);
    if (f === undefined || b.pts.length < 4) return;
    const ux = b.pts[2]! - b.pts[0]!, uz = b.pts[3]! - b.pts[1]!;
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(ux, uz)).setPosition(f.cx, 0, f.cz);
    chunkOf(chunks, f.cx, f.cz).cars.push(carTemplate(b.car - 1).clone().applyMatrix4(m));
  });
  const decorData = map.decor ?? [];
  for (let k = 0; k + 3 < decorData.length; k += 4) {
    const x = decorData[k]! / 10, z = decorData[k + 1]! / 10, kind = decorData[k + 2]!, seed = decorData[k + 3]!;
    const size = 0.85 + 0.4 * rand01(seed + 3);
    const m = new THREE.Matrix4().makeRotationY(rand01(seed + 7) * Math.PI * 2).scale(new THREE.Vector3(size, size, size)).setPosition(x, 0, z);
    chunkOf(chunks, x, z).props.push(decorTemplate(kind, seed).clone().applyMatrix4(m));
  }
  const lampData = map.lamps ?? [];
  for (let k = 0; k + 3 < lampData.length; k += 4) {
    // baked lamp: x, z in decimetres, then the direction toward the road as hundredths of a unit
    const lamp = { x: lampData[k]! / 10, z: lampData[k + 1]! / 10, dx: lampData[k + 2]! / 100, dz: lampData[k + 3]! / 100 };
    const chunk = chunkOf(chunks, lamp.x, lamp.z);
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(-lamp.dz, lamp.dx)).setPosition(lamp.x, 0, lamp.z);
    chunk.lamps.push(lampGeometry().clone().applyMatrix4(m));
    const pool = poolGeometry().clone();
    pool.translate(lamp.x + lamp.dx * 1.3, 0.12, lamp.z + lamp.dz * 1.3);
    chunk.pools.push(pool);
  }

  const wallMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, map: getFacadeTexture() ?? null, side: THREE.DoubleSide });
  const solid = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  wallMaterial.color.set(tint); // the route's mood
  solid.color.set(tint);
  makeCutaway(wallMaterial);
  makeCutaway(solid);
  patchWalls(wallMaterial, facadeMask);
  const glassMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  glassMaterial.color.set(tint);
  makeCutaway(glassMaterial);
  patchGlass(glassMaterial);
  const lampMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  // the light pools sit above every street layer (streets.ts orders its layers with a polygon offset, which would otherwise hide them)
  glow.polygonOffset = true;
  glow.polygonOffsetFactor = -8;
  glow.polygonOffsetUnits = -8;
  const out: THREE.Object3D[] = [];
  /** Chunk key -> its centre, so the view can skip chunks that lie beyond the fog. */
  const merge = (geos: THREE.BufferGeometry[], material: THREE.Material, key: string, order = 0, name = '', keepUv = false): void => {
    if (geos.length === 0) return;
    // everything merged into one mesh must carry the same attributes
    const same = geos.map((g) => {
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      if (!keepUv && flat.getAttribute('uv')) flat.deleteAttribute('uv');
      if (flat.getAttribute('normal')) flat.deleteAttribute('normal');
      return flat;
    });
    const merged = mergeGeometries(same, false);
    for (const g of same) g.dispose();
    if (merged === null) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    mesh.name = name;
    const [ix, iz] = key.split(',').map(Number) as [number, number];
    mesh.userData['cx'] = (ix + 0.5) * CHUNK;
    mesh.userData['cz'] = (iz + 0.5) * CHUNK;
    out.push(mesh);
  };
  for (const [key, c] of chunks) {
    merge(c.walls, wallMaterial, key, 0, 'walls', true);
    merge(c.glass, glassMaterial, key, 0, 'glass', true);
    // roofs, shop signs and parked cars all dissolve with the cut-away, so they share one mesh
    merge([...c.roofs, ...c.signs, ...c.cars], solid, key, 0, 'solid');
    // trees, graves, lamp posts and pavements stay put (only buildings dissolve)
    merge([...c.props, ...c.lamps], lampMaterial, key, 0, 'scenery');
    merge(c.pools, glow, key, 2, 'pools');
  }
  if (beacons.length > 0) {
    // the glowing parts of landmarks are not fogged and not culled, so they show from far away
    const first = out.length;
    merge(beacons, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), '0,0', 0, 'beacons');
    const mesh = out[first];
    if (mesh !== undefined) {
      delete mesh.userData['cx'];
      delete mesh.userData['cz'];
    }
  }
  out.push(...buildStreets(map, tint));
  return out;
}

/** Hides the city's chunks that lie wholly beyond `range` metres of (x, z): past the fog they cannot be seen anyway. */
export function cullCity(meshes: readonly THREE.Object3D[], x: number, z: number, range: number): void {
  const reach = range + CHUNK * 0.75; // half a chunk's diagonal, with a little to spare
  const limit = reach * reach;
  for (const m of meshes) {
    const cx = m.userData['cx'] as number | undefined, cz = m.userData['cz'] as number | undefined;
    if (cx === undefined || cz === undefined) continue;
    const dx = cx - x, dz = cz - z;
    m.visible = dx * dx + dz * dz <= limit;
  }
}
