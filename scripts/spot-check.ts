import { readFileSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';
const [px, pz, r] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] ?? 25)];
const map = JSON.parse(readFileSync('bake/out/route1.map.json', 'utf8')) as MapData;
const segD = (x: number, z: number, x0: number, z0: number, x1: number, z1: number): number => { const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz; const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0; return Math.hypot(x - x0 - t * dx, z - z0 - t * dz); };
console.log(`around ${px},${pz} radius ${r} m`);
map.roads.forEach((road, i) => { for (let k = 0; k + 3 < road.pts.length; k += 2) { const d = segD(px, pz, road.pts[k]! / 10, road.pts[k + 1]! / 10, road.pts[k + 2]! / 10, road.pts[k + 3]! / 10); if (d < r) { console.log(`road ${i} hw ${road.hw / 10} seg (${road.pts[k]! / 10},${road.pts[k + 1]! / 10})->(${road.pts[k + 2]! / 10},${road.pts[k + 3]! / 10}) d=${d.toFixed(1)}`); break; } } });
map.buildings.forEach((b, i) => { const poly = b.hulls?.[0] ?? b.pts; let md = Infinity; for (let k = 0; k < poly.length; k += 2) { const n = (k + 2) % poly.length; md = Math.min(md, segD(px, pz, poly[k]! / 10, poly[k + 1]! / 10, poly[n]! / 10, poly[n + 1]! / 10)); } if (md < r) console.log(`bldg ${i} ${b.hulls?.[0] ? 'COLLIDES' : 'render-only'} h ${b.h / 10} d=${md.toFixed(1)} hull ${(b.hulls?.[0] ?? []).map((v) => v / 10).join(',')}`); });
for (const a of map.anchors) if (Math.hypot(a.x / 10 - px, a.z / 10 - pz) < r) console.log(`anchor at ${a.x / 10},${a.z / 10}`);
