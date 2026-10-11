// Two simulated clients through the real authority room, with latency/jitter and rollback; then a late joiner.
// Proves the networked path converges on identical checksums:  npm run test:network
import { assertLateJoinHydration, assertTwoClientConvergence } from '@series-inc/rundot-syncplay/testing';
import { encodeInput, decodeInput } from '../src/sim/input-codec.ts';
import { DEFAULT_INPUT, type GameInput } from '../src/sim/game.ts';
import { createGameRuntime, runtimeIdentity, sessionConfigBytes, sessionConfigDigest } from '../src/sim/runtime.ts';

const driver = (slot: number, tick: number): GameInput => ({
  ...DEFAULT_INPUT,
  ready: tick > 5,
  throttle: 100,
  steer: Math.round(60 * Math.sin((tick + slot * 40) / 25)),
  arms: tick % 70 < 12,
  head: tick % 150 < 3,
  legs: false,
  reset: false,
});

const roomConfig = {
  playerCount: 2,
  seed: 1,
  hardToleranceTicks: 12,
  tickRateHz: 30,
  redundancyWindowTicks: 8,
  runtimeIdentity,
  sessionConfigBytes,
  sessionConfigDigest,
  neutralInput: encodeInput(DEFAULT_INPUT),
  snapshotCadenceTicks: 60,
};
const clientOptions = () => ({
  runtimeFactory: () => createGameRuntime(),
  defaultInput: DEFAULT_INPUT,
  localInputForTick: driver,
  encodeInput,
  decodeInput,
});
const steps = Number(process.env.STEPS ?? 600);
const link = { latencyTicks: 3, jitterTicks: 2, lossRate: 0.02 };

const two = assertTwoClientConvergence({ roomConfig, clientOptions, steps, link, networkSeed: 7 });
console.log('two-client convergence', JSON.stringify(two));
const late = assertLateJoinHydration({ roomConfig, clientOptions, steps, link, networkSeed: 9, initialClientCount: 1, beforeJoinSteps: 200, afterJoinSteps: 300 });
console.log('late-join hydration  ', JSON.stringify(late));
