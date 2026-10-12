// Audits which rendered buildings have no collider, and why:  node scripts/run-ts.mjs scripts/collider-audit.ts
import { readFileSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';
const map = JSON.parse(readFileSync('bake/out/route1.map.json', 'utf8')) as MapData;
const poly = (JSON.parse(readFileSync('bake/cache/route1-corridor.json', 'utf8')) as { polyline: { x: number; z: number }[] }).polyline;
const area = (p: readonly number[]): number => { let s = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; s += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!; } return Math.abs(s) / 2 / 100; };
const nearRoute = (b: { pts: readonly number[] }): boolean => { const cx = b.pts.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / (b.pts.length / 2) / 10, cz = b.pts.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) / (b.pts.length / 2) / 10; return poly.some((p, i) => { const q = poly[i + 1]; if (!q) return false; const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz; const t = l2 ? Math.max(0, Math.min(1, ((cx - p.x) * dx + (cz - p.z) * dz) / l2)) : 0; return Math.hypot(cx - p.x - t * dx, cz - p.z - t * dz) < 60; }); };
let withHull = 0, without = 0, areaWith = 0, areaWithout = 0, nearWithout = 0, nearAreaWithout = 0, nearTotal = 0;
for (const b of map.buildings) {
  const a = area(b.pts), near = nearRoute(b);
  if (near) nearTotal += 1;
  if (b.hulls) { withHull += 1; areaWith += a; } else { without += 1; areaWithout += a; if (near) { nearWithout += 1; nearAreaWithout += a; } }
}
console.log(`rendered buildings ${map.buildings.length}: with collider ${withHull} (${(areaWith / 1000).toFixed(0)}k m2), WITHOUT ${without} (${(areaWithout / 1000).toFixed(0)}k m2)`);
console.log(`within 60 m of the route: ${nearTotal} buildings, of which ${nearWithout} have no collider (${(nearAreaWithout / 1000).toFixed(1)}k m2 of footprint)`);
const big = map.buildings.filter((b) => !b.hulls && nearRoute(b)).map((b) => area(b.pts)).sort((x, y) => y - x).slice(0, 8);
console.log(`largest uncovered buildings near the route (m2): ${big.map((v) => v.toFixed(0)).join(', ')}`);

// Regression guard: a rebake with a stray setting once shipped a map where 88% of buildings had no collider.
const uncoveredNear = nearWithout / Math.max(1, nearTotal);
if (uncoveredNear > 0.02 || without / map.buildings.length > 0.02) { console.error(`FAIL: too many buildings without colliders (${(uncoveredNear * 100).toFixed(1)}% near the route)`); process.exit(1); }
console.log('OK: collider coverage');
