// Proves the simulation is deterministic under rollback, replay and checkpoint hydration:  npm run test:determinism
import { MAX_PLAYERS } from '../src/sim/limits.ts';
import { assertDeterministic } from '@series-inc/rundot-syncplay/testing';
import { DEFAULT_INPUT, type GameInput } from '../src/sim/game.ts';
import { createGameRuntime, makeSessionConfig } from '../src/sim/runtime.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();

// Fuzzed inputs that ready up quickly, then drive, steer and hit every ability and reset.
const fuzz = (random: { nextInt: (min: number, max: number) => number }, _slot: number, frame: number): GameInput => ({
  ...DEFAULT_INPUT,
  ready: frame > 5,
  present: true,
  start: frame > 5,
  throttle: random.nextInt(-100, 100),
  steer: random.nextInt(-100, 100),
  arms: random.nextInt(0, 9) === 0,
  head: random.nextInt(0, 14) === 0,
  legs: random.nextInt(0, 9) === 0,
  reset: random.nextInt(0, 199) === 0,
  bodySel: random.nextInt(0, 1),
  legsSel: random.nextInt(0, 2),
  armsSel: random.nextInt(0, 2),
  headSel: random.nextInt(0, 2),
});

// Drives hard so the cars cross many collision cells (exercises building streaming under rollback).
const drive = (random: { nextInt: (min: number, max: number) => number }, slot: number, frame: number): GameInput => ({
  ...DEFAULT_INPUT,
  ready: frame > 5,
  present: true,
  start: frame > 5,
  throttle: 100,
  steer: Math.round(50 * Math.sin((frame + slot * 30) / 40)) + random.nextInt(-10, 10),
  arms: frame % 90 < 8,
  head: frame % 200 < 3,
  bodySel: slot % 2,
  legsSel: 1 + (slot % 2),
  armsSel: 1 + (slot % 2),
  headSel: 1 + ((slot + 1) % 2),
});

for (const [mode, inputFuzz, frames] of [['random', fuzz, 900], ['drive', drive, 1500]] as const) {
for (const map of (process.env['MAPS'] ?? 'greybox,route1').split(',')) {
  const config = makeSessionConfig(map);
  const result = assertDeterministic({
    runtimeFactory: () => createGameRuntime(undefined, config.bytes),
    policy: { playerCount: MAX_PLAYERS, defaultInput: DEFAULT_INPUT, snapshotBufferSize: 256, checksumIntervalFrames: 30 },
    frames: Number(process.env['FRAMES'] ?? frames),
    seeds: [1, 2, 3],
    inputFuzz,
  });
  console.log(`${mode.padEnd(7)} ${map.padEnd(8)}`, JSON.stringify(result));
  if (!result.ok) process.exit(1);
}
}
