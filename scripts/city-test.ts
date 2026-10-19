// Street lamps keep their distance: node scripts/run-ts.mjs scripts/city-test.ts
// For every baked route: lamps are placed, none is within LAMP_BUILDING_GAP of a building or on a carriageway.
import { readFileSync, readdirSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';
import { LAMP_BUILDING_GAP, placeLamps } from '../bake/lamps.ts';

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
let failures = 0;
for (const f of readdirSync('bake/out').filter((n) => n.endsWith('.map.json'))) {
  const map = JSON.parse(readFileSync(`bake/out/${f}`, 'utf8')) as MapData;
  const t0 = performance.now();
  const lamps = placeLamps(map);
  const ms = performance.now() - t0;
  let nearestBuilding = Infinity, onRoad = 0;
  for (const l of lamps) {
    for (const b of map.buildings) {
      for (let i = 0; i < b.pts.length; i += 2) {
        const j = (i + 2) % b.pts.length;
        const d = segDist(l.x, l.z, b.pts[i]! / 10, b.pts[i + 1]! / 10, b.pts[j]! / 10, b.pts[j + 1]! / 10);
        if (d < nearestBuilding) nearestBuilding = d;
      }
    }
    for (const r of map.roads) for (let i = 0; i + 3 < r.pts.length; i += 2) if (segDist(l.x, l.z, r.pts[i]! / 10, r.pts[i + 1]! / 10, r.pts[i + 2]! / 10, r.pts[i + 3]! / 10) < r.hw / 10 + 0.45) { onRoad += 1; break; }
  }
  const ok = lamps.length > 0 && nearestBuilding >= LAMP_BUILDING_GAP - 0.01 && onRoad === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.replace('.map.json', '').padEnd(16)} ${String(lamps.length).padStart(3)} lamps, closest to a building ${nearestBuilding.toFixed(1)} m, on a road: ${onRoad}, placed in ${ms.toFixed(0)} ms`);
}
process.exit(failures === 0 ? 0 : 1);
