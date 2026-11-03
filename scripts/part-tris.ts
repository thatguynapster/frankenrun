// Dev tool: how many triangles each monster part adds, and which kinds of primitive they come from.
import { MonsterModel } from '../src/render/monsters/MonsterModel.js';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS } from '../src/render/monsters/parts.js';
import { Shape } from '../src/render/monsters/shapes.js';

const byType = new Map<string, number>();
const add = Shape.prototype.add;
Shape.prototype.add = function (geometry, color, tf, flat) {
  const n = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
  const key = geometry.type;
  byType.set(key, (byType.get(key) ?? 0) + n);
  return add.call(this, geometry, color, tf, flat);
};
const tris = (body: number, legs = 0, arms = 0, head = 0): number => {
  const m = new MonsterModel(0);
  m.setBuild({ body, legs, arms, head }, false);
  return Math.round(m.triangles());
};
for (let b = 0; b < BODY_DEFS.length; b += 1) {
  const base = tris(b);
  console.log(BODY_DEFS[b]!.name, 'torso + head + stumps + nubs:', base);
  for (let l = 1; l < LEG_DEFS.length; l += 1) console.log('  legs', LEG_DEFS[l]!.name, tris(b, l) - base);
  for (let a = 1; a < ARM_DEFS.length; a += 1) console.log('  arms', ARM_DEFS[a]!.name, tris(b, 0, a) - base);
  for (let h = 1; h < HEAD_DEFS.length; h += 1) console.log('  head', HEAD_DEFS[h]!.name, tris(b, 0, 0, h) - base);
}
console.log([...byType].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
import { builtGeometries } from '../src/render/monsters/parts.js';
console.log('--- every merged piece, largest first');
console.log(builtGeometries().map((g) => [Math.round(g.getAttribute('position').count / 3), g.name] as const).sort((a, b) => b[0] - a[0]).map(([n, name]) => `${n} ${name}`).join(String.fromCharCode(10)));
