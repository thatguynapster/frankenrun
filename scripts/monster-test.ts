// Every body/legs/arms/head combination builds, stays within the triangle budget, has finite geometry and keeps its
// feet near the ground and its extent inside the monster's footprint while animated.
import * as THREE from 'three';
import { MonsterModel } from '../src/render/monsters/MonsterModel.js';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS } from '../src/render/monsters/parts.js';

const BUDGET = 2400;
let failures = 0;
let worst = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.log('FAIL', msg);
};

for (let body = 0; body < BODY_DEFS.length; body += 1)
  for (let legs = 0; legs < LEG_DEFS.length; legs += 1)
    for (let arms = 0; arms < ARM_DEFS.length; arms += 1)
      for (let head = 0; head < HEAD_DEFS.length; head += 1) {
        const name = `${BODY_DEFS[body]!.name}/${LEG_DEFS[legs]!.name}/${ARM_DEFS[arms]!.name}/${HEAD_DEFS[head]!.name}`;
        const m = new MonsterModel(0x6fbf5a);
        m.setBuild({ body, legs, arms, head }, false);
        const tris = m.triangles();
        worst = Math.max(worst, tris);
        if (tris > BUDGET) fail(`${name}: ${tris} triangles`);
        for (const speed of [0, 6, 22]) {
          let x = 0;
          for (let i = 0; i < 90; i += 1) {
            x += (speed / 30);
            m.update({ x, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed, swingPole: i % 2 === 0 ? 1 : -1, trailing: i % 3 === 0 }, 1 / 30, i / 30);
          }
          m.root.position.set(0, 1, 0);
          m.root.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(m.root);
          if (![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) fail(`${name}: NaN bounds at ${speed}`);
          else {
            if (box.min.y < -0.25 || box.min.y > 0.8) fail(`${name}: feet at ${box.min.y.toFixed(2)} m at speed ${speed}`);
            if (box.max.y > 4.2) fail(`${name}: ${box.max.y.toFixed(2)} m tall`);
            if (Math.max(box.max.x, -box.min.x) > 3 || Math.max(box.max.z, -box.min.z) > 3.5) fail(`${name}: too wide at speed ${speed}`);
          }
        }
      }
console.log(`worst triangle count ${Math.round(worst)}; ${failures === 0 ? 'all monster checks pass' : failures + ' failures'}`);
process.exit(failures === 0 ? 0 : 1);
