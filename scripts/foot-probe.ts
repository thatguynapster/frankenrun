// Lowest point of each legs option relative to the ground the monster stands on (chassis centre y = 1):
//   node scripts/run-ts.mjs scripts/foot-probe.ts
import * as THREE from 'three';
import { MonsterModel } from '../src/render/monsters/MonsterModel.js';
import { BODY_DEFS, LEG_DEFS } from '../src/render/monsters/parts.js';

for (let body = 0; body < BODY_DEFS.length; body += 1) for (let legs = 0; legs < LEG_DEFS.length; legs += 1) {
  const m = new MonsterModel(0x6fbf5a);
  m.setBuild({ body, legs, arms: 0, head: 0 }, false);
  const mins: number[] = [];
  for (const speed of [0, 8, 22]) {
    for (let i = 0; i < 60; i += 1) {
      m.update({ x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed, swingPole: -1, trailing: false }, 1 / 30, i / 30);
      m.root.position.set(0, 1, 0);
      m.root.updateMatrixWorld(true);
      mins.push(new THREE.Box3().setFromObject(m.root).min.y);
    }
  }
  console.log(`${BODY_DEFS[body]!.name} / ${LEG_DEFS[legs]!.name}: lowest ${Math.min(...mins).toFixed(2)}, highest of the lows ${Math.max(...mins).toFixed(2)} (0 = ground)`);
}
