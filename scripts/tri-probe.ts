// Triangle count of every body and part on its own: node scripts/run-ts.mjs scripts/tri-probe.ts
import { MonsterModel } from '../src/render/monsters/MonsterModel.js';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS } from '../src/render/monsters/parts.js';

const count = (body: number, legs: number, arms: number, head: number): number => {
  const m = new MonsterModel(0, true);
  m.setBuild({ body, legs, arms, head }, false);
  return Math.round(m.triangles());
};
// "bare" is the body with the first (empty) option of everything; its numbers are what a part adds on top of.
const bare = BODY_DEFS.map((_, b) => count(b, 0, 0, 0));
BODY_DEFS.forEach((d, b) => console.log(`${d.name}: bare ${bare[b]}`));
for (let b = 0; b < BODY_DEFS.length; b += 1) {
  LEG_DEFS.forEach((d, i) => console.log(`  ${BODY_DEFS[b]!.name} + ${d.name}: +${count(b, i, 0, 0) - bare[b]!}`));
  ARM_DEFS.forEach((d, i) => console.log(`  ${BODY_DEFS[b]!.name} + ${d.name}: +${count(b, 0, i, 0) - bare[b]!}`));
  HEAD_DEFS.forEach((d, i) => console.log(`  ${BODY_DEFS[b]!.name} + ${d.name}: +${count(b, 0, 0, i) - bare[b]!}`));
}
