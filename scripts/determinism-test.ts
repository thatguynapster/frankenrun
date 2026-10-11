// Proves the simulation is deterministic under rollback, replay and checkpoint hydration:  npm run test:determinism
import { assertDeterministic } from '@series-inc/rundot-syncplay/testing';
import { DEFAULT_INPUT, type GameInput } from '../src/sim/game.ts';
import { createGameRuntime } from '../src/sim/runtime.ts';

// Fuzzed inputs that ready up quickly, then drive, steer and hit every ability and reset.
const fuzz = (random: { nextInt: (min: number, max: number) => number }, _slot: number, frame: number): GameInput => ({
  ...DEFAULT_INPUT,
  ready: frame > 5,
  throttle: random.nextInt(-100, 100),
  steer: random.nextInt(-100, 100),
  arms: random.nextInt(0, 9) === 0,
  head: random.nextInt(0, 14) === 0,
  legs: random.nextInt(0, 9) === 0,
  reset: random.nextInt(0, 199) === 0,
  legsSel: random.nextInt(0, 1) === 1,
  armsSel: true,
  headSel: true,
});

const result = assertDeterministic({
  runtimeFactory: () => createGameRuntime(),
  policy: { playerCount: 2, defaultInput: DEFAULT_INPUT, snapshotBufferSize: 256, checksumIntervalFrames: 30 },
  frames: Number(process.env.FRAMES ?? 900),
  seeds: [1, 2, 3],
  inputFuzz: fuzz,
});
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
