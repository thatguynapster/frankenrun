// Prints where landmarks fall on the baked maps (metres): node scripts/run-ts.mjs scripts/landmark-spots.ts
import { readFileSync } from 'node:fs';
import { CITY_ORIGINS } from '../bake/lib/geo.ts';

const spots: [string, string, string, number, number][] = [
  ['bigben', 'london', 'london-westminster-soho', 51.50073, -0.12463],
  ['empire', 'newyork', 'newyork-midtown', 40.74844, -73.98566],
];
for (const [name, city, map, lat, lon] of spots) {
  const o = CITY_ORIGINS[city]!;
  const x = (lon - o.lon) * Math.cos((o.lat * Math.PI) / 180) * 111320, z = -(lat - o.lat) * 110540;
  const m = JSON.parse(readFileSync(`bake/out/${map}.map.json`, 'utf8')) as { bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; buildings: { h: number; pts: number[] }[]; route: number[] };
  const b = m.bounds;
  const inside = x * 10 >= b.minX && x * 10 <= b.maxX && z * 10 >= b.minZ && z * 10 <= b.maxZ;
  let near = Infinity;
  for (let i = 0; i + 1 < m.route.length; i += 2) near = Math.min(near, Math.hypot(m.route[i]! / 10 - x, m.route[i + 1]! / 10 - z));
  const hit = m.buildings.filter((bd) => {
    let c = false;
    for (let i = 0, j = bd.pts.length - 2; i < bd.pts.length; j = i, i += 2) {
      const xi = bd.pts[i]! / 10, zi = bd.pts[i + 1]! / 10, xj = bd.pts[j]! / 10, zj = bd.pts[j + 1]! / 10;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  });
  console.log(`${name} on ${map}: x ${x.toFixed(1)} z ${z.toFixed(1)}, inside map ${inside}, ${near.toFixed(0)} m from the route, footprints containing it: ${hit.map((h) => `${(h.h / 10).toFixed(0)} m high (${h.pts.length / 2} pts)`).join('; ') || 'none'}`);
}
