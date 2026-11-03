import { readFileSync } from 'node:fs';
import { createDeterministicPhysicsWorld3D, stepDeterministicPhysicsWorld3D } from '@series-inc/rundot-syncplay/creator';
import type { MapData } from '../src/sim/mapdata.ts';
const map = JSON.parse(readFileSync('bake/out/route1.map.json', 'utf8')) as MapData;
const bad: { i: number; why: string; hull: number[]; h: number }[] = [];
map.buildings.forEach((b, i) => {
  if (!b.hulls?.[0]) return;
  const verts: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < b.hulls?.[0].length; k += 2) { const x = b.hulls?.[0][k]! / 10, z = b.hulls?.[0][k + 1]! / 10; verts.push({ x, y: 0, z }, { x, y: b.h / 10, z }); }
  try {
    const w = createDeterministicPhysicsWorld3D([{ id: 's', kind: 'static', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, shape: { type: 'compound', children: [{ shape: { type: 'hull', vertices: verts }, offset: { x: 0, y: 0, z: 0 } }] }, layer: 1, mask: 1 },
      { id: 'd', kind: 'dynamic', x: 0, y: 50, z: 0, vx: 0, vy: 0, vz: 0, mass: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, shape: { type: 'sphere', radius: 0.5 }, layer: 2, mask: 1 }]);
    stepDeterministicPhysicsWorld3D(w, { gravityY: 0, dtTicks: 1 });
  } catch (e) { bad.push({ i, why: (e as Error).message.slice(0, 60), hull: [...b.hulls?.[0]], h: b.h }); }
});
console.log(`bad hulls: ${bad.length} of ${map.buildings.filter((b) => b.hulls?.[0]).length}`);
for (const b of bad.slice(0, 5)) console.log(JSON.stringify(b));
