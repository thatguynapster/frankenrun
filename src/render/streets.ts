// The streets: roads drawn as continuous, joined surfaces with kerbs, pavements and painted markings. Presentation only.
//
// A road is a polyline with a half-width. Every layer (pavement, kerb, asphalt) is built from the same pieces: a quad per
// segment, a small wedge filling the outside of each bend so the road never gaps or spikes, and a disc at each junction
// (wider than the roads, so the asphalt flares into rounded corners and the kerb and pavement curve round them). The layers
// sit in the same plane and are ordered with a polygon offset, so the asphalt always covers the kerb and the kerb the pavement.
// The asphalt and pavement textures are computed from world position, so overlapping pieces look identical and seamless.

import * as THREE from 'three';
import type { MapData } from '../sim/mapdata.js';

const CHUNK = 100; // metres, as in city.ts: meshes are split per chunk so the view can skip far ones
const Y = 0.05;
const PAVE_WIDTH = 1.5; // metres beyond the kerb
const KERB_WIDTH = 0.35;
const MIN_PAVED_HW = 2.5; // narrower lanes get asphalt only
const FLARE = 1.45; // a junction's disc radius, as a multiple of its widest road's half-width
const DISC_SEGMENTS = 14;

type Layer = 'pavement' | 'kerb' | 'asphalt' | 'paint';

/** Small tiling textures sampled by world position (cheap on phones, and mipmapped so nothing shimmers at a distance). */
const textures: { noise?: THREE.CanvasTexture; slabs?: THREE.CanvasTexture } = {};

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

let seed = 12345;
const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** R: soft mottling (tileable value noise). G: fine grain. B: patches of repair (mostly 0). */
function noiseTexture(): THREE.CanvasTexture | undefined {
  return (textures.noise ??= canvasTexture(128, (ctx, size) => {
    const grid = 8, lattice: number[] = [];
    for (let i = 0; i < grid * grid; i += 1) lattice.push(rnd());
    const at = (x: number, y: number): number => lattice[(((y % grid) + grid) % grid) * grid + (((x % grid) + grid) % grid)]!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const gx = (x / size) * grid, gy = (y / size) * grid;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx, bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        const soft = top * (1 - sy) + bottom * sy;
        const i = (y * size + x) * 4;
        img.data[i] = soft * 255;
        img.data[i + 1] = rnd() * 255;
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // a few darker repair patches (blue channel), soft-edged rectangles
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k += 1) {
      ctx.fillStyle = 'rgba(0,0,255,0.9)';
      ctx.fillRect(rnd() * size * 0.8, rnd() * size * 0.8, size * (0.12 + rnd() * 0.1), size * (0.08 + rnd() * 0.08));
    }
    ctx.globalCompositeOperation = 'source-over';
  }));
}

/** Paving slabs: a 4 by 4 block of slabs (3.2 m across), each a little lighter or darker, with dark joints. */
function slabTexture(): THREE.CanvasTexture | undefined {
  return (textures.slabs ??= canvasTexture(128, (ctx, size) => {
    const n = 4, cell = size / n;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const v = 215 + Math.floor(rnd() * 40);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x * cell, y * cell, cell, cell);
        ctx.fillStyle = 'rgba(70,66,86,0.9)';
        ctx.fillRect(x * cell, y * cell, cell, 2);
        ctx.fillRect(x * cell, y * cell, 2, cell);
      }
    }
  }));
}

/** A flat-coloured material whose surface detail comes from a texture sampled by world position. */
function surfaceMaterial(color: number, tint: number, offset: number, detail: string, key: string, tex?: THREE.Texture): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  m.color.multiply(new THREE.Color(tint));
  m.polygonOffset = offset !== 0;
  m.polygonOffsetFactor = offset;
  m.polygonOffsetUnits = offset;
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uStreetTex'] = { value: tex ?? null };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vStreetPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvStreetPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vStreetPos;\nuniform sampler2D uStreetTex;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>\n\t${tex ? detail : ''}`);
  };
  m.customProgramCacheKey = () => `frankenrun-street-${key}-${tex ? 'tex' : 'flat'}`;
  return m;
}

// asphalt: mottling and grain, and now and then a darker repair patch
const ASPHALT_DETAIL = `
  vec3 nz = texture2D(uStreetTex, vStreetPos.xz * 0.045).rgb;
  vec3 fine = texture2D(uStreetTex, vStreetPos.xz * 0.9 + 0.37).rgb;
  diffuseColor.rgb *= 0.9 + 0.18 * nz.r + 0.08 * fine.g - 0.07 * nz.b;
`;
// pavement: slabs with joints
const PAVEMENT_DETAIL = `
  diffuseColor.rgb *= texture2D(uStreetTex, vStreetPos.xz / 3.2).rgb;
`;
// paint: worn, so the road shows through
const PAINT_DETAIL = `
  diffuseColor.rgb *= 0.86 + 0.14 * texture2D(uStreetTex, vStreetPos.xz * 1.3).g;
`;

interface Node {
  x: number;
  z: number;
  /** Segment ends meeting here: a polyline end counts one, a vertex in the middle counts two. */
  degree: number;
  /** How many roads end here (as opposed to passing through). */
  ends: number;
  hw: number;
}

/** Builds the street meshes for a map. `tint` is the route's mood colour, as for the buildings. */
export function buildStreets(map: MapData, tint = 0xffffff): THREE.Mesh[] {
  const roads = map.roads;
  if (roads.length === 0) return [];

  // ---- junctions: where segment ends meet ----
  const nodes = new Map<string, Node>();
  const nodeAt = (x: number, z: number): Node => {
    const key = `${x},${z}`;
    let n = nodes.get(key);
    if (n === undefined) {
      n = { x: x / 10, z: z / 10, degree: 0, ends: 0, hw: 0 };
      nodes.set(key, n);
    }
    return n;
  };
  for (const road of roads) {
    const count = road.pts.length / 2;
    for (let i = 0; i < count; i += 1) {
      const n = nodeAt(road.pts[i * 2]!, road.pts[i * 2 + 1]!);
      n.degree += i === 0 || i === count - 1 ? 1 : 2;
      if (i === 0 || i === count - 1) n.ends += 1;
      n.hw = Math.max(n.hw, road.hw / 10);
    }
  }
  const junctionAt = (x: number, z: number): Node | undefined => {
    const n = nodes.get(`${x},${z}`);
    return n !== undefined && n.degree >= 3 ? n : undefined;
  };

  // ---- geometry accumulators, per chunk and layer ----
  const chunks = new Map<string, Record<Layer, number[]> & { cx: number; cz: number }>();
  const target = (x: number, z: number): Record<Layer, number[]> => {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const key = `${ix},${iz}`;
    let c = chunks.get(key);
    if (c === undefined) {
      c = { pavement: [], kerb: [], asphalt: [], paint: [], cx: (ix + 0.5) * CHUNK, cz: (iz + 0.5) * CHUNK };
      chunks.set(key, c);
    }
    return c;
  };
  const tri = (layer: Layer, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void => {
    target((ax + bx + cx) / 3, (az + bz + cz) / 3)[layer].push(ax, Y, az, bx, Y, bz, cx, Y, cz);
  };
  const quad = (layer: Layer, ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): void => {
    tri(layer, ax, az, bx, bz, cx, cz);
    tri(layer, ax, az, cx, cz, dx, dz);
  };
  const disc = (layer: Layer, x: number, z: number, r: number): void => {
    for (let k = 0; k < DISC_SEGMENTS; k += 1) {
      const a0 = (k / DISC_SEGMENTS) * Math.PI * 2, a1 = ((k + 1) / DISC_SEGMENTS) * Math.PI * 2;
      tri(layer, x, z, x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r);
    }
  };

  /** The widths of each surface layer for a road of half-width hw (pavement and kerb only on wider roads). */
  const widths = (hw: number): { layer: Layer; w: number }[] =>
    hw >= MIN_PAVED_HW
      ? [{ layer: 'pavement', w: hw + KERB_WIDTH + PAVE_WIDTH }, { layer: 'kerb', w: hw + KERB_WIDTH }, { layer: 'asphalt', w: hw }]
      : [{ layer: 'asphalt', w: hw }];

  for (const road of roads) {
    const hw = road.hw / 10;
    const count = road.pts.length / 2;
    const layers = widths(hw);
    const px = (i: number): number => road.pts[i * 2]! / 10;
    const pz = (i: number): number => road.pts[i * 2 + 1]! / 10;
    // unit direction and left normal of each segment
    const dirs: { ux: number; uz: number; len: number }[] = [];
    for (let i = 0; i + 1 < count; i += 1) {
      const dx = px(i + 1) - px(i), dz = pz(i + 1) - pz(i);
      const len = Math.hypot(dx, dz);
      dirs.push({ ux: len > 1e-6 ? dx / len : 1, uz: len > 1e-6 ? dz / len : 0, len });
    }
    for (let i = 0; i + 1 < count; i += 1) {
      const d = dirs[i]!;
      if (d.len < 1e-3) continue;
      const nx = -d.uz, nz = d.ux;
      for (const { layer, w } of layers) quad(layer, px(i) + nx * w, pz(i) + nz * w, px(i + 1) + nx * w, pz(i + 1) + nz * w, px(i + 1) - nx * w, pz(i + 1) - nz * w, px(i) - nx * w, pz(i) - nz * w);
    }
    // the outside of each bend: one wedge per layer closes the gap between the two segments' corners
    for (let i = 1; i + 1 < count; i += 1) {
      const a = dirs[i - 1]!, b = dirs[i]!;
      if (a.len < 1e-3 || b.len < 1e-3) continue;
      const cross = a.ux * b.uz - a.uz * b.ux;
      if (Math.abs(cross) < 0.0005) continue;
      const side = cross > 0 ? -1 : 1; // the outer side of the turn (left normal is (-uz, ux))
      for (const { layer, w } of layers) tri(layer, px(i), pz(i), px(i) + -a.uz * side * w, pz(i) + a.ux * side * w, px(i) + -b.uz * side * w, pz(i) + b.ux * side * w);
    }
  }
  // junction discs flare the asphalt into rounded corners; dead ends get a round cap
  for (const n of nodes.values()) {
    if (n.degree >= 3) {
      const r = n.hw * FLARE;
      for (const { layer, w } of widths(n.hw)) disc(layer, n.x, n.z, w - n.hw + r);
    } else if (n.degree === 1 || (n.degree === 2 && n.ends === 2)) {
      // a dead end gets a round cap; two roads that meet end to end get a round join, which closes the gap on the outside of a bend
      for (const { layer, w } of widths(n.hw)) disc(layer, n.x, n.z, w);
    }
  }

  // ---- paint: dashed centre lines, edge lines on the widest roads, zebra crossings at big junctions ----
  for (const road of roads) {
    const hw = road.hw / 10;
    if (hw < 3) continue;
    const count = road.pts.length / 2;
    for (let i = 0; i + 1 < count; i += 1) {
      const x0 = road.pts[i * 2]! / 10, z0 = road.pts[i * 2 + 1]! / 10, x1 = road.pts[i * 2 + 2]! / 10, z1 = road.pts[i * 2 + 3]! / 10;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 4) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz, nz = ux;
      // stop short of a junction at either end
      const j0 = junctionAt(road.pts[i * 2]!, road.pts[i * 2 + 1]!), j1 = junctionAt(road.pts[i * 2 + 2]!, road.pts[i * 2 + 3]!);
      const from = j0 ? j0.hw * FLARE + 5.5 : 1, to = len - (j1 ? j1.hw * FLARE + 5.5 : 1);
      if (to - from < 3) continue;
      const at = (s: number, off: number): [number, number] => [x0 + ux * s + nx * off, z0 + uz * s + nz * off];
      // dashed centre line
      for (let s = from; s + 2 <= to; s += 7) {
        const a = at(s, -0.1), b = at(s + 2, -0.1), c = at(s + 2, 0.1), d = at(s, 0.1);
        quad('paint', a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      }
      // solid edge lines on roads at least 8 m wide
      if (hw >= 4) {
        for (const side of [-1, 1]) {
          const off = side * (hw - 0.45);
          const a = at(from, off - 0.08), b = at(to, off - 0.08), c = at(to, off + 0.08), d = at(from, off + 0.08);
          quad('paint', a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
        }
      }
    }
  }
  // zebra crossings across each wide arm of a junction, just outside the junction disc
  const arms = new Set<string>();
  for (const road of roads) {
    const hw = road.hw / 10;
    if (hw < 3.5) continue;
    const count = road.pts.length / 2;
    for (const [i, j] of [[0, 1], [count - 1, count - 2]] as const) {
      const jn = junctionAt(road.pts[i * 2]!, road.pts[i * 2 + 1]!);
      if (jn === undefined || count < 2) continue;
      const key = `${jn.x},${jn.z},${Math.round(Math.atan2(road.pts[j * 2 + 1]! - road.pts[i * 2 + 1]!, road.pts[j * 2]! - road.pts[i * 2]!) * 4)}`;
      if (arms.has(key)) continue;
      arms.add(key);
      const dx = road.pts[j * 2]! / 10 - jn.x, dz = road.pts[j * 2 + 1]! / 10 - jn.z;
      const len = Math.hypot(dx, dz);
      if (len < jn.hw * FLARE + 6) continue;
      const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
      const base = jn.hw * FLARE + 1.2;
      for (let off = -hw + 0.6; off <= hw - 0.6; off += 1.0) {
        const x = jn.x + ux * base + nx * off, z = jn.z + uz * base + nz * off;
        quad('paint', x - ux * 0.2, z - uz * 0.2, x + ux * 2.4, z + uz * 2.4, x + ux * 2.4 + nx * 0.45, z + uz * 2.4 + nz * 0.45, x - ux * 0.2 + nx * 0.45, z - uz * 0.2 + nz * 0.45);
      }
    }
  }

  // ---- meshes ----
  const materials: Record<Layer, THREE.Material> = {
    pavement: surfaceMaterial(0x948da4, tint, 0, PAVEMENT_DETAIL, 'pavement', slabTexture()),
    kerb: surfaceMaterial(0xb7b2c6, tint, -1, '', 'kerb'),
    asphalt: surfaceMaterial(0x5b6280, tint, -2, ASPHALT_DETAIL, 'asphalt', noiseTexture()),
    paint: surfaceMaterial(0xe6dfc3, tint, -4, PAINT_DETAIL, 'paint', noiseTexture()),
  };
  const out: THREE.Mesh[] = [];
  for (const c of chunks.values()) {
    for (const layer of ['pavement', 'kerb', 'asphalt', 'paint'] as const) {
      const positions = c[layer];
      if (positions.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materials[layer]);
      mesh.name = `street-${layer}`;
      // Drawn nearest layer first, so the depth test skips the pavement and kerb pixels hidden under the asphalt.
      mesh.renderOrder = layer === 'asphalt' ? -4 : layer === 'kerb' ? -3 : layer === 'pavement' ? -2 : -1;
      mesh.userData['cx'] = c.cx;
      mesh.userData['cz'] = c.cz;
      out.push(mesh);
    }
  }
  return out;
}
