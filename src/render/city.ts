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
  const lit = new Set([1, 6, 8, 11, 13]);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * cell, y = row * cell;
      // floor slab line along the top of each floor (canvas y runs down, texture v runs up: row 3 is the ground floor)
      ctx.fillStyle = '#c9c9d4';
      ctx.fillRect(x, y, cell, 4);
      // window with a frame
      const wx = x + cell * 0.2, wy = y + cell * 0.25, ww = cell * 0.6, wh = cell * 0.5;
      ctx.fillStyle = '#6b6b86';
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const index = row * 4 + col;
      ctx.fillStyle = lit.has(index) ? '#ffe8a0' : '#3a3f63';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = lit.has(index) ? '#e6c36a' : '#2b2f4e';
      ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh); // mullion
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
  walls: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[];
  lamps: THREE.BufferGeometry[];
  pools: THREE.BufferGeometry[];
}

function chunkOf(chunks: Map<string, Chunk>, x: number, z: number): Chunk {
  const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  let c = chunks.get(key);
  if (c === undefined) {
    c = { walls: [], roofs: [], lamps: [], pools: [] };
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

/** Walls (windowed, shaded darker toward the ground), then a roof: pitched over small houses, flat over big blocks. */
function addBuilding(i: number, b: BuildingData, chunk: Chunk): void {
  const f = footprintOf(b);
  if (f === undefined) return;
  const height = Math.max(2.5, b.h / 10);
  const seed = Math.floor(f.cx * 13 + f.cz * 7) + i * 101;
  const tint = new THREE.Color(FACADES[h32(seed) % FACADES.length]!);
  const n = f.xs.length;
  const sign = f.area >= 0 ? 1 : -1; // winding, so the wall normal points outward

  const wp: number[] = [], wc: number[] = [], wu: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const j = (k + 1) % n;
    const x0 = f.xs[k]!, z0 = f.zs[k]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) continue;
    const nx = (sign * (z1 - z0)) / len, nz = (-sign * (x1 - x0)) / len; // outward
    const shade = shadeFor(nx, 0, nz);
    const bottom = shade * 0.7, top = shade;
    const u1 = len / 16, v1 = height / 12;
    // two triangles (the material draws both sides, so the winding does not matter)
    const quad = [
      [x0, 0, z0, 0, 0, bottom], [x1, 0, z1, u1, 0, bottom], [x1, height, z1, u1, v1, top],
      [x0, 0, z0, 0, 0, bottom], [x1, height, z1, u1, v1, top], [x0, height, z0, 0, v1, top],
    ] as const;
    for (const v of quad) {
      wp.push(v[0], v[1], v[2]);
      wc.push(tint.r * v[5], tint.g * v[5], tint.b * v[5]);
      wu.push(v[3], v[4]);
    }
  }
  if (wp.length > 0) chunk.walls.push(geometryFrom(wp, wc, wu));

  // roof
  const rp: number[] = [], rc: number[] = [];
  const small = Math.abs(f.area) < 220 && height < 9 && inside(f, f.cx, f.cz);
  if (small) {
    const roof = new THREE.Color(ROOFS[h32(seed + 5) % ROOFS.length]!);
    const rise = 1.2 + Math.min(2, Math.sqrt(Math.abs(f.area)) * 0.1);
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n;
      const x0 = f.xs[k]!, z0 = f.zs[k]!, x1 = f.xs[j]!, z1 = f.zs[j]!;
      const ex = x1 - x0, ez = z1 - z0;
      const tri = [x0, height, z0, x1, height, z1, f.cx, height + rise, f.cz];
      // outward normal of this roof face, for the baked shading
      const len = Math.hypot(ex, ez) || 1;
      const nx = (sign * ez) / len, nz = (-sign * ex) / len;
      const slope = rise / Math.max(1, Math.hypot(f.cx - x0, f.cz - z0));
      const l = Math.hypot(nx, slope, nz) || 1;
      const shade = shadeFor(nx / l, slope / l, nz / l);
      for (let v = 0; v < 3; v += 1) {
        rp.push(tri[v * 3]!, tri[v * 3 + 1]!, tri[v * 3 + 2]!);
        rc.push(roof.r * shade, roof.g * shade, roof.b * shade);
      }
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
    // a rooftop box (a stairwell or water tank) on some of the bigger roofs
    if (rand01(seed + 9) < 0.4 && inside(f, f.cx, f.cz) && Math.abs(f.area) > 60) {
      const box = new THREE.BoxGeometry(2.2, 1.4, 1.8).toNonIndexed();
      box.translate(f.cx, height + 0.7, f.cz);
      const pos = box.getAttribute('position');
      const nor = box.getAttribute('normal');
      const col = new THREE.Color(0x6e7380);
      for (let v = 0; v < pos.count; v += 1) {
        rp.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        const s = shadeFor(nor.getX(v), nor.getY(v), nor.getZ(v));
        rc.push(col.r * s, col.g * s, col.b * s);
      }
      box.dispose();
    }
  }
  if (rp.length > 0) chunk.roofs.push(geometryFrom(rp, rc));
}

let lampTemplate: THREE.BufferGeometry | undefined;
/** One street lamp at the origin, its arm reaching along +X. Vertex-coloured: dark metal and a bright cream lamp head. */
function lampGeometry(): THREE.BufferGeometry {
  if (lampTemplate) return lampTemplate;
  const s = new Shape();
  const metal = 0x3d4054;
  s.cyl(0.2, 0.26, 0.5, 6, metal, { p: [0, 0.25, 0] }); // base
  s.cyl(0.07, 0.11, 5.7, 6, metal, { p: [0, 3.1, 0] }); // pole
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
export function buildCity(map: MapData): THREE.Object3D[] {
  const chunks = new Map<string, Chunk>();
  map.buildings.forEach((b, i) => {
    const f = footprintOf(b);
    if (f === undefined) return;
    addBuilding(i, b, chunkOf(chunks, f.cx, f.cz));
  });
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
  makeCutaway(wallMaterial);
  makeCutaway(solid);
  const lampMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const out: THREE.Object3D[] = [];
  const merge = (geos: THREE.BufferGeometry[], material: THREE.Material, order = 0): void => {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged === null) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    out.push(mesh);
  };
  for (const c of chunks.values()) {
    merge(c.walls, wallMaterial);
    merge(c.roofs, solid);
    merge(c.lamps, lampMaterial); // lamp posts never dissolve (only buildings do)
    merge(c.pools, glow, 2);
  }
  return out;
}
