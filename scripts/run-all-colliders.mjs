// Runs the collider coverage audit on every baked route.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let failed = false;
for (const f of readdirSync('bake/out').filter((n) => n.endsWith('.map.json'))) {
  const id = f.replace('.map.json', '');
  console.log(`== ${id}`);
  const r = spawnSync('node', ['scripts/run-ts.mjs', 'scripts/collider-audit.ts'], { env: { ...process.env, MAP: id }, stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
