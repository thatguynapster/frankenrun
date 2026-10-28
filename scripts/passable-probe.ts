// Is the route physically passable for a monster? Rasterises the building colliders and walls on a 0.5 m grid, grows them by the
// monster's radius, and flood-fills from the start to see whether the finish is reachable.
//   node scripts/run-ts.mjs scripts/passable-probe.ts [mapId...]
import { readFileSync, readdirSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';

const CELL = 0.5;
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : readdirSync('bake/out').filter((n) => n.endsWith('.map.json')).map((n) => n.replace('.map.json', ''));
for (const radius of [0.8, 1.1]) {
  for (const id of ids) {
    const map = JSON.parse(readFileSync(`bake/out/${id}.map.json`, 'utf8')) as MapData;
    const poly = (JSON.parse(readFileSync(`bake/cache/${id}-corridor.json`, 'utf8')) as { polyline: { x: number; z: number }[] }).polyline;
    const x0 = map.bounds.minX / 10, z0 = map.bounds.minZ / 10;
    const W = Math.ceil((map.bounds.maxX - map.bounds.minX) / 10 / CELL), H = Math.ceil((map.bounds.maxZ - map.bounds.minZ) / 10 / CELL);
    const solid = new Uint8Array(W * H);
    const cx = (x: number): number => Math.floor((x - x0) / CELL), cz = (z: number): number => Math.floor((z - z0) / CELL);
    const fill = (h: readonly number[]): void => {
      const xs: number[] = [], zs: number[] = [];
      for (let i = 0; i < h.length; i += 2) { xs.push(h[i]! / 10); zs.push(h[i + 1]! / 10); }
      const gz0 = Math.max(0, cz(Math.min(...zs))), gz1 = Math.min(H - 1, cz(Math.max(...zs)));
      for (let gz = gz0; gz <= gz1; gz += 1) {
        const z = z0 + (gz + 0.5) * CELL, hits: number[] = [];
        for (let i = 0; i < xs.length; i += 1) {
          const j = (i + 1) % xs.length;
          if ((zs[i]! <= z && zs[j]! > z) || (zs[j]! <= z && zs[i]! > z)) hits.push(xs[i]! + ((z - zs[i]!) / (zs[j]! - zs[i]!)) * (xs[j]! - xs[i]!));
        }
        hits.sort((a, b) => a - b);
        for (let k = 0; k + 1 < hits.length; k += 2) for (let gx = Math.max(0, cx(hits[k]!)); gx <= Math.min(W - 1, cx(hits[k + 1]!)); gx += 1) solid[gz * W + gx] = 1;
      }
    };
    for (const b of map.buildings) for (const h of b.hulls ?? []) fill(h);
    for (const w of map.walls) {
      const [ax, az, bx, bz] = w.pts.map((v) => v / 10) as [number, number, number, number];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2));
      for (let k = 0; k <= n; k += 1) { const gx = cx(ax + ((bx - ax) * k) / n), gz = cz(az + ((bz - az) * k) / n); if (gx >= 0 && gx < W && gz >= 0 && gz < H) solid[gz * W + gx] = 1; }
    }
    // grow by the monster radius (separable box filter)
    const r = Math.ceil(radius / CELL);
    const grow = (src: Uint8Array, horizontal: boolean): Uint8Array => {
      const out = new Uint8Array(W * H);
      for (let gz = 0; gz < H; gz += 1) for (let gx = 0; gx < W; gx += 1) {
        if (!src[gz * W + gx]) continue;
        for (let d = -r; d <= r; d += 1) { const x = horizontal ? gx + d : gx, z = horizontal ? gz : gz + d; if (x >= 0 && x < W && z >= 0 && z < H) out[z * W + x] = 1; }
      }
      return out;
    };
    const blocked = grow(grow(solid, true), false);
    const start = poly[0]!, end = poly[poly.length - 1]!;
    const seen = new Uint8Array(W * H);
    const stack = [cz(start.z) * W + cx(start.x)];
    seen[stack[0]!] = 1;
    while (stack.length) {
      const c = stack.pop()!, gx = c % W, gz = (c / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = gx + dx, z = gz + dz;
        if (x < 0 || x >= W || z < 0 || z >= H) continue;
        const k = z * W + x;
        if (seen[k] || blocked[k]) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    // furthest polyline vertex reachable
    let reach = -1;
    for (let i = 0; i < poly.length; i += 1) if (seen[cz(poly[i]!.z) * W + cx(poly[i]!.x)]) reach = i;
    const blockedVerts = poly.map((p, i) => (blocked[cz(p.z) * W + cx(p.x)] ? i : -1)).filter((i) => i >= 0);
    console.log(`r=${radius} ${id}: finish ${seen[cz(end.z) * W + cx(end.x)] ? 'REACHABLE' : 'NOT reachable'}; furthest reachable vertex ${reach + 1}/${poly.length}; route vertices inside grown walls: ${blockedVerts.length}${blockedVerts.length ? ` (first at ${poly[blockedVerts[0]!]!.x.toFixed(0)},${poly[blockedVerts[0]!]!.z.toFixed(0)})` : ''}`);
  }
}
