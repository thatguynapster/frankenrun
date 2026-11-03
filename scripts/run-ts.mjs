// Dev helper: bundle a TypeScript entry with esbuild (ships with Vite) and run it in Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs <entry.ts> [args...]');
  process.exit(2);
}
// Output must live inside the project so Node resolves node_modules packages.
const dir = path.join('node_modules', '.cache', `run-ts-${process.pid}`);
mkdirSync(dir, { recursive: true });
const outfile = path.join(dir, 'out.mjs');
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    outfile,
    packages: 'external',
    logLevel: 'error',
  });
  const result = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
