// The look of the city: buildings with painted walls, lit windows and roofs, and street lamps along the roads.
// Everything here is presentation only: it reads the baked map and draws, and the simulation never sees it.
// Every choice (colours, roofs, lamp spots) comes from a hash of the map's own numbers, so the city looks the same on
// every device and on every visit.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingData, MapData } from '../sim/mapdata.js';
import { Shape } from './monsters/shapes.js';

// ---------- tunables ----------

const CHUNK = 100; // metres: geometry is merged per chunk so the camera can skip whole chunks

const FACADES = [0xe8d9b5, 0xd9a441, 0xc7704f, 0xa9c9a4, 0x8fb4d8, 0xe3a6b4, 0xf0ebe0, 0xcfa27a, 0x9fd0c8];
const ROOFS = [0x9c4a3a, 0x6d7a86, 0xa3552f, 0x4f6f6a, 0x7a6a8a];
const FLAT_ROOF = 0x8c8f99;
const SIGN_COLORS = [0xff4fa3, 0x41e0ff, 0xffd23b, 0x7dff6a, 0xff7a2e, 0xb06bff];

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
  const lit = new Set([1, 6, 8, 11, 13, 14]);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * cell, y = row * cell;
      // floor slab line along the top of each floor (canvas y runs down, texture v runs up: row 3 is the ground floor)
      ctx.fillStyle = '#d4d0dc';
      ctx.fillRect(x, y, cell, 5);
      ctx.fillStyle = '#9a96ab';
      ctx.fillRect(x, y + 5, cell, 2);
      const index = row * 4 + col;
      const on = lit.has(index);
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
  return t;
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
  roofs: THREE.BufferGeometry[];
  lamps: THREE.BufferGeometry[];
  pools: THREE.BufferGeometry[];
  street: THREE.BufferGeometry[];
}

function chunkOf(chunks: Map<string, Chunk>, x: number, z: number): Chunk {
  const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  let c = chunks.get(key);
  if (c === undefined) {
    c = { cars: [], props: [], signs: [], walls: [], roofs: [], lamps: [], pools: [], street: [] };
    chunks.set(key, c);
  }
  return c;
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
const FLOOR = 3; // metres per floor: matches the facade tile (4 floors in 12 m)

type P3 = readonly [number, number, number];

/** Collects wall triangles (position, colour, uv) for one building. */
class WallBuilder {
  readonly p: number[] = [];
  readonly c: number[] = [];
  readonly u: number[] = [];
  /** A quad a-b-c-d (anticlockwise seen from outside), flat colour from the plain part of the tile. */
  flat(a: P3, b: P3, c: P3, d: P3, color: THREE.Color, shade: number): void {
    const v = [a, b, c, a, c, d];
    for (const q of v) {
      this.p.push(q[0], q[1], q[2]);
      this.c.push(color.r * shade, color.g * shade, color.b * shade);
      this.u.push(PLAIN_U, PLAIN_V);
    }
  }
}

/** Walls (plinth, windowed body, cornice, parapet), then a roof: pitched with eaves over small houses, flat over big blocks. */
function addBuilding(i: number, b: BuildingData, chunk: Chunk): void {
  const f = footprintOf(b);
  if (f === undefined) return;
  const height = Math.max(2.5, b.h / 10);
  const seed = Math.floor(f.cx * 13 + f.cz * 7) + i * 101;
  const tint = new THREE.Color(FACADES[h32(seed) % FACADES.length]!);
  const n = f.xs.length;
  const sign = f.area >= 0 ? 1 : -1; // winding, so the wall normal points outward
  const small = Math.abs(f.area) < 220 && height < 9 && inside(f, f.cx, f.cz);
  const tall = height >= 9;
  const trim = new THREE.Color(tint).lerp(new THREE.Color(0xf4efe4), 0.5);
  const plinth = new THREE.Color(tint).lerp(STONE, 0.6);

  const walls = new WallBuilder();
  const wp = walls.p, wc = walls.c, wu = walls.u;
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
    const v0 = y0 / 12, v1 = y1 / 12;
    const quad = [
      [x0, y0, z0, 0, v0, bottom], [x1, y0, z1, u1, v0, bottom], [x1, y1, z1, u1, v1, top],
      [x0, y0, z0, 0, v0, bottom], [x1, y1, z1, u1, v1, top], [x0, y1, z0, 0, v1, top],
    ] as const;
    for (const v of quad) {
      wp.push(v[0], v[1], v[2]);
      wc.push(wall.r * v[5], wall.g * v[5], wall.b * v[5]);
      wu.push(v[3], v[4]);
    }
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
  if (wp.length > 0) chunk.walls.push(geometryFrom(wp, wc, wu));

  // A glowing shop sign, a door and an awning on the longest wall of some buildings (street level, facing out).
  if (rand01(seed + 21) < 0.4 && height < 22) {
    let bk = -1, blen = 0;
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n;
      const len = Math.hypot(f.xs[j]! - f.xs[k]!, f.zs[j]! - f.zs[k]!);
      if (len > blen) { blen = len; bk = k; }
    }
    if (bk >= 0 && blen > 5) {
      const j = (bk + 1) % n;
      const x0 = f.xs[bk]!, z0 = f.zs[bk]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
      const ux = (x1 - x0) / blen, uz = (z1 - z0) / blen;
      const nx = sign * uz, nz = -sign * ux;
      const w = Math.min(3.6, blen * 0.55), h = 0.8, y0 = 2.55;
      const t = 0.3 + 0.4 * rand01(seed + 33);
      const cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
      const neon = new THREE.Color(SIGN_COLORS[h32(seed + 44) % SIGN_COLORS.length]!);
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
      const awn = new THREE.Color(SIGN_COLORS[h32(seed + 77) % SIGN_COLORS.length]!).lerp(new THREE.Color(0x201a30), 0.35);
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
    const roof = new THREE.Color(ROOFS[h32(seed + 5) % ROOFS.length]!);
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
    if (rand01(seed + 13) < 0.25) {
      const cxp = f.cx + (f.xs[0]! - f.cx) * 0.35, czp = f.cz + (f.zs[0]! - f.cz) * 0.35;
      if (inside(f, cxp, czp)) addProp(rp, rc, 'chimney', cxp, height + rise * 0.55, czp);
    }
  } else {
    const flat = new THREE.Color(FLAT_ROOF).lerp(new THREE.Color(FACADES[h32(seed) % FACADES.length]!), 0.15);
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
      if (r < 0.3) addProp(rp, rc, 'tank', f.cx, height, f.cz);
      else if (r < 0.6) addProp(rp, rc, 'stair', f.cx, height, f.cz);
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

// ---------- street level: pavements with kerbs, and dashed centre lines ----------

const PAVEMENT = new THREE.Color(0x8a8398);
const KERB = new THREE.Color(0x5d6078);
const PAINT = new THREE.Color(0xd9d3b4);
const PAVE_WIDTH = 1.5; // metres
const KERB_HEIGHT = 0.14;

/** Looks up which road surfaces are near a point, so pavements and paint stop short of side streets. */
class RoadIndex {
  private readonly cells = new Map<number, number[]>(); // cell -> indices into `segs`
  private readonly segs: { x0: number; z0: number; x1: number; z1: number; hw: number; road: number }[] = [];
  private static readonly CELL = 24;
  constructor(roads: MapData['roads']) {
    roads.forEach((road, ri) => {
      for (let i = 0; i + 3 < road.pts.length; i += 2) {
        const seg = { x0: road.pts[i]! / 10, z0: road.pts[i + 1]! / 10, x1: road.pts[i + 2]! / 10, z1: road.pts[i + 3]! / 10, hw: road.hw / 10, road: ri };
        const id = this.segs.push(seg) - 1;
        const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
        const steps = Math.max(1, Math.ceil(len / 8));
        const reach = seg.hw + PAVE_WIDTH + 2;
        for (let s = 0; s <= steps; s += 1) {
          const x = seg.x0 + ((seg.x1 - seg.x0) * s) / steps, z = seg.z0 + ((seg.z1 - seg.z0) * s) / steps;
          for (let cx = Math.floor((x - reach) / RoadIndex.CELL); cx <= Math.floor((x + reach) / RoadIndex.CELL); cx += 1) {
            for (let cz = Math.floor((z - reach) / RoadIndex.CELL); cz <= Math.floor((z + reach) / RoadIndex.CELL); cz += 1) {
              const key = cx * 100003 + cz;
              const list = this.cells.get(key);
              if (list === undefined) this.cells.set(key, [id]);
              else if (list[list.length - 1] !== id) list.push(id);
            }
          }
        }
      }
    });
  }
  /** True when (x, z) lies within `margin` metres of the surface of any road other than `except`. */
  covered(x: number, z: number, margin: number, except: number): boolean {
    const list = this.cells.get(Math.floor(x / RoadIndex.CELL) * 100003 + Math.floor(z / RoadIndex.CELL));
    if (list === undefined) return false;
    for (const id of list) {
      const s = this.segs[id]!;
      if (s.road === except) continue;
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / l2));
      if (Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t)) < s.hw + margin) return true;
    }
    return false;
  }
}

/** Raised pavements on both sides of every road and a dashed centre line on the wide ones. */
function addStreet(map: MapData, chunks: Map<string, Chunk>): void {
  const index = new RoadIndex(map.roads);
  const up = shadeFor(0, 1, 0) * 0.82;
  const pushQuad = (chunk: Chunk, a: P3, b: P3, c: P3, d: P3, color: THREE.Color, shade: number): void => {
    const pos = [...a, ...b, ...c, ...a, ...c, ...d];
    const col: number[] = [];
    for (let v = 0; v < 6; v += 1) col.push(color.r * shade, color.g * shade, color.b * shade);
    chunk.street.push(geometryFrom(pos, col));
  };
  map.roads.forEach((road, ri) => {
    const hw = road.hw / 10;
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const x0 = road.pts[i]! / 10, z0 = road.pts[i + 1]! / 10, x1 = road.pts[i + 2]! / 10, z1 = road.pts[i + 3]! / 10;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const nx = -uz, nz = ux; // left of the direction of travel
      const chunk = chunkOf(chunks, (x0 + x1) / 2, (z0 + z1) / 2);
      const at = (s: number, off: number, y: number): P3 => [x0 + ux * s + nx * off, y, z0 + uz * s + nz * off];
      const step = 1.5;
      const count = Math.max(1, Math.ceil(len / step));
      for (const side of [1, -1]) {
        // runs of the segment where the pavement is not crossing a side street
        let runStart = -1;
        for (let k = 0; k <= count; k += 1) {
          const s = Math.min(len, k * step);
          const p = at(s, side * (hw + PAVE_WIDTH / 2), 0);
          const blocked = index.covered(p[0], p[2], PAVE_WIDTH / 2 + 0.2, ri);
          if (!blocked && runStart < 0) runStart = s;
          if ((blocked || k === count) && runStart >= 0) {
            const end = blocked ? Math.max(runStart, s - step) : s;
            if (end - runStart > 1) {
              const o0 = side * hw, o1 = side * (hw + PAVE_WIDTH);
              pushQuad(chunk, at(runStart, o0, KERB_HEIGHT), at(end, o0, KERB_HEIGHT), at(end, o1, KERB_HEIGHT), at(runStart, o1, KERB_HEIGHT), PAVEMENT, up);
              pushQuad(chunk, at(runStart, o0, 0.04), at(end, o0, 0.04), at(end, o0, KERB_HEIGHT), at(runStart, o0, KERB_HEIGHT), KERB, shadeFor(-nx * side, 0, -nz * side));
            }
            runStart = -1;
          }
        }
      }
      // dashed centre line on roads at least 6 m wide
      if (hw >= 3) {
        for (let s = 1; s + 2 < len; s += 7) {
          const mx = x0 + ux * (s + 1), mz = z0 + uz * (s + 1);
          if (index.covered(mx, mz, 1.5, ri)) continue;
          pushQuad(chunk, at(s, -0.09, 0.05), at(s + 2, -0.09, 0.05), at(s + 2, 0.09, 0.05), at(s, 0.09, 0.05), PAINT, up);
        }
      }
    }
  });
}

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

/** Everything that makes the city look like a city: returns the meshes to add to the world group. */
export function buildCity(map: MapData, tint = 0xffffff): THREE.Object3D[] {
  const chunks = new Map<string, Chunk>();
  map.buildings.forEach((b, i) => {
    if (b.car !== undefined) return; // parked cars are drawn below
    const f = footprintOf(b);
    if (f === undefined) return;
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
  addStreet(map, chunks);
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
    pool.translate(lamp.x + lamp.dx * 1.3, 0.08, lamp.z + lamp.dz * 1.3);
    chunk.pools.push(pool);
  }

  const wallMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, map: getFacadeTexture() ?? null, side: THREE.DoubleSide });
  const solid = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  wallMaterial.color.set(tint); // the route's mood
  solid.color.set(tint);
  makeCutaway(wallMaterial);
  makeCutaway(solid);
  const lampMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const out: THREE.Object3D[] = [];
  const merge = (geos: THREE.BufferGeometry[], material: THREE.Material, order = 0, name = ""): void => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged === null) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    mesh.name = name;
    out.push(mesh);
  };
  for (const c of chunks.values()) {
    merge(c.walls, wallMaterial, 0, "walls");
    merge(c.roofs, solid, 0, "roofs");
    merge(c.signs, solid, 0, "signs"); // shop signs dissolve with their wall
    merge(c.cars, solid, 0, "cars"); // parked cars can dissolve too, so they never hide a monster
    merge(c.props, lampMaterial, 0, "props"); // trees and graves stay put
    merge(c.lamps, lampMaterial, 0, "lamps"); // lamp posts never dissolve (only buildings do)
    merge(c.street, lampMaterial, 0, "street");
    merge(c.pools, glow, 2, "pools");
  }
  return out;
}
