// Every body, legs and arms combination, run at several speeds: no limb may sink deep into another limb or the body.
import { MonsterModel } from '../src/render/monsters/MonsterModel.js';
import { worstOverlap } from '../src/render/monsters/collide.js';
import { ARM_DEFS, BODY_DEFS, LEG_DEFS } from '../src/render/monsters/parts.js';

const LIMIT = Number(process.argv[2] ?? 0.16); // metres of overlap that still counts as touching (spider legs reach over hanging arms, so some overlap remains there)
let failures = 0, worstAll = 0;
for (let body = 0; body < BODY_DEFS.length; body += 1)
  for (let legs = 0; legs < LEG_DEFS.length; legs += 1)
    for (let arms = 0; arms < ARM_DEFS.length; arms += 1) {
      const m = new MonsterModel(0x6fbf5a);
      m.setBuild({ body, legs, arms, head: 0 }, false);
      let worst = 0, x = 0;
      // running at several speeds, then swinging on a pole, charging a leap and mid-leap
      for (const [speed, swing, charge, air] of [[0, false, 0, false], [5, false, 0, false], [12, false, 0, false], [22, false, 0, false], [12, true, 0, false], [0, false, 1, false], [12, false, 0.5, true]] as const) {
        for (let i = 0; i < 120; i += 1) {
          x += speed / 30;
          m.update({ x, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed, swingPole: swing ? 1 : -1, trailing: false, hopCharge: charge, airborne: air }, 1 / 30, (i + 120 * speed) / 30);
          worst = Math.max(worst, m.limbOverlap());
        }
      }
      worstAll = Math.max(worstAll, worst);
      if (worst > LIMIT) {
        failures += 1;
        console.log(`FAIL ${BODY_DEFS[body]!.name}/${LEG_DEFS[legs]!.name}/${ARM_DEFS[arms]!.name}: limbs overlap by ${worst.toFixed(2)} m`);
      }
    }
console.log(failures === 0 ? `ok (worst overlap ${worstAll.toFixed(3)} m)` : `${failures} failures (worst ${worstAll.toFixed(3)} m)`);
process.exit(failures === 0 ? 0 : 1);
