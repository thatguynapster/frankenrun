// Free width along each route's centre line (distance to the nearest building collider or wall):
//   node scripts/run-ts.mjs scripts/clearance-probe.ts [mapId...]
// A monster is about 2 m wide, so stretches under 3 m of clearance are suspicious.
import { readFileSync, readdirSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';

const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : readdirSync('bake/out').filter((n) => n.endsWith('.map.json')).map((n) => n.replace('.map.json', ''));
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
for (const id of ids) {
  const map = JSON.parse(readFileSync(`bake/out/${id}.map.json`, 'utf8')) as MapData;
  const poly = (JSON.parse(readFileSync(`bake/cache/${id}-corridor.json`, 'utf8')) as { polyline: { x: number; z: number }[] }).polyline;
  const edges: number[][] = []; // metres
  for (const b of map.buildings) for (const h of b.hulls ?? []) for (let i = 0; i < h.length; i += 2) { const j = (i + 2) % h.length; edges.push([h[i]! / 10, h[i + 1]! / 10, h[j]! / 10, h[j + 1]! / 10]); }
  for (const w of map.walls) edges.push([w.pts[0] / 10, w.pts[1] / 10, w.pts[2] / 10, w.pts[3] / 10]);
  const samples: { s: number; x: number; z: number; c: number }[] = [];
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i]!, b = poly[i + 1]!, len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < len; d += 2) {
      const x = a.x + ((b.x - a.x) * d) / len, z = a.z + ((b.z - a.z) * d) / len;
      let c = Infinity;
      for (const e of edges) { if (Math.abs(e[0]! - x) > 30 && Math.abs(e[2]! - x) > 30) continue; c = Math.min(c, segDist(x, z, e[0]!, e[1]!, e[2]!, e[3]!)); }
      samples.push({ s: s + d, x, z, c });
    }
    s += len;
  }
  const tight = samples.filter((p) => p.c < 1.5);
  const sorted = [...samples].sort((a, b) => a.c - b.c);
  console.log(`${id}: ${samples.length} samples, min clearance ${sorted[0]!.c.toFixed(1)} m at (${sorted[0]!.x.toFixed(0)},${sorted[0]!.z.toFixed(0)}); <1.5 m: ${tight.length} samples; <3 m: ${samples.filter((p) => p.c < 3).length}`);
  for (const p of sorted.slice(0, 4)) console.log(`   ${p.c.toFixed(1)} m at s=${p.s.toFixed(0)} (${p.x.toFixed(0)},${p.z.toFixed(0)})`);
}
