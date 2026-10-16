// Generates the game's sounds with the RUN audio generator (credits are spent per file).
//   npm run audio:estimate        prints what it would generate and the exact credit cost; spends nothing
//   npm run audio:generate        generates every file that does not exist yet (spends credits)
//   npm run audio:generate -- --only partLoss     just one sound id (all of its variants)
// Existing files are never overwritten: delete a file to have it regenerated. The prompts live in src/audio/manifest.ts.
// Set RUNDOT_BIN if the `rundot` command is not on your PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { MUSIC, SOUNDS, soundFile } from '../src/audio/manifest.ts';

const bin = process.env['RUNDOT_BIN'] ?? 'rundot';
const estimateOnly = process.argv.includes('--estimate');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;

interface Job {
  readonly label: string;
  readonly kind: 'sfx' | 'music';
  readonly seconds: number;
  readonly prompt: string;
  readonly file: string;
}

const jobs: Job[] = [];
for (const s of SOUNDS) {
  if (only !== undefined && s.id !== only) continue;
  for (let v = 0; v < s.variants; v += 1) jobs.push({ label: s.variants > 1 ? `${s.id} #${v + 1}` : s.id, kind: 'sfx', seconds: s.seconds, prompt: s.prompt, file: `public/cdn-assets/${soundFile(s.id, v, s.variants)}` });
}
for (const m of MUSIC) {
  if (only !== undefined && m.id !== only) continue;
  jobs.push({ label: m.id, kind: 'music', seconds: m.seconds, prompt: m.prompt, file: `public/cdn-assets/${soundFile(m.id)}` });
}

function run(args: string[]): { ok: boolean; out: string } {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function costOf(job: Job): number {
  const { ok, out } = run(['generate', 'estimate', job.kind, '--duration', String(job.seconds), '--json']);
  const match = /"credits":\s*(\d+)/.exec(out);
  if (!ok || match === null) throw new Error(`could not estimate ${job.label}: ${out.trim().slice(0, 200)}`);
  return Number(match[1]);
}

/**
 * The generator leaves a small `<file>.json` beside each sound (generation id and prompt). It is a useful record of
 * where every sound came from, so it is kept, but under audio-provenance/ rather than in the shipped assets folder.
 */
function tidySidecars(): void {
  const dir = 'public/cdn-assets/audio';
  if (!existsSync(dir)) return;
  mkdirSync('audio-provenance', { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.mp3.json')) renameSync(`${dir}/${name}`, `audio-provenance/${name}`);
}
tidySidecars();

const todo = jobs.filter((j) => !existsSync(j.file));
const costs = new Map<number, number>(); // seconds+kind -> credits, so identical estimates are asked for once
let total = 0;
for (const job of todo) {
  const key = job.seconds * (job.kind === 'music' ? -1 : 1);
  if (!costs.has(key)) costs.set(key, costOf(job));
  total += costs.get(key)!;
}
console.log(`${jobs.length - todo.length} of ${jobs.length} files already exist; ${todo.length} to generate, ${total} credits in total (about $${(total / 1000).toFixed(2)}).`);
for (const job of todo) console.log(`  ${job.kind.padEnd(5)} ${job.seconds}s  ${job.label.padEnd(16)} ${job.prompt}`);
if (estimateOnly || todo.length === 0) process.exit(0);

/** Sleeps without spinning the CPU. */
const sleep = (seconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
};

let failures = 0;
for (const job of todo) {
  mkdirSync(dirname(job.file), { recursive: true });
  const args = job.kind === 'sfx'
    ? ['generate', 'sfx', '--description', job.prompt, '--duration', String(job.seconds), '--out', job.file]
    : ['generate', 'music', '--prompt', job.prompt, '--duration', String(job.seconds), '--out', job.file];
  let done = false;
  // The service rate-limits bursts ("retry in N seconds"): wait as long as it says and try again. Nothing is charged
  // for a refused call.
  for (let attempt = 1; attempt <= 6 && !done; attempt += 1) {
    const { ok, out } = run(args);
    if (ok && existsSync(job.file)) {
      console.log(`ok   ${job.label} -> ${job.file} (${Math.round(statSync(job.file).size / 1024)} KB)`);
      done = true;
      break;
    }
    const wait = /retry in (\d+) seconds/i.exec(out);
    if (wait !== null && attempt < 6) {
      console.log(`     ${job.label}: rate limited, waiting ${Number(wait[1]) + 3}s (attempt ${attempt})`);
      sleep(Number(wait[1]) + 3);
      continue;
    }
    console.log(`FAIL ${job.label}: ${out.trim().slice(0, 300)}`);
    break;
  }
  tidySidecars();
  if (!done) failures += 1;
  else sleep(2); // a small gap between calls keeps well under the limit
}
console.log(failures === 0 ? 'Done.' : `${failures} failed; run it again to retry only the missing files.`);
process.exit(failures === 0 ? 0 : 1);
