// Two simulated clients through the real authority room, with latency/jitter and rollback; then a late joiner.
// Proves the networked path converges on identical checksums:  npm run test:network
import { MAX_PLAYERS } from '../src/sim/limits.ts';
import { assertLateJoinHydration, assertTwoClientConvergence } from '@series-inc/rundot-syncplay/testing';
import { encodeInput, decodeInput } from '../src/sim/input-codec.ts';
import { DEFAULT_INPUT, type GameInput } from '../src/sim/game.ts';
import { createGameRuntime, makeSessionConfig, runtimeIdentity } from '../src/sim/runtime.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const session = makeSessionConfig(process.env['MAP'] ?? 'route1');

const Q = Number(process.env['QUANT'] ?? 1);
const q = (v: number): number => Math.round(v / Q) * Q;
const driver = (slot: number, tick: number): GameInput => ({
  ...DEFAULT_INPUT,
  ready: tick > 5,
  present: true,
  start: tick > 5,
  throttle: 100,
  steer: q(Math.round(60 * Math.sin((tick + slot * 40) / 25))),
  arms: tick % 70 < 12,
  head: tick % 150 < 3,
  legs: false,
  reset: false,
});

const roomConfig = {
  playerCount: MAX_PLAYERS, // a real room's simulation slots equal its player limit; two clients occupy slots 0 and 1
  seed: 1,
  hardToleranceTicks: 12,
  tickRateHz: 30,
  redundancyWindowTicks: 8,
  runtimeIdentity,
  sessionConfigBytes: session.bytes,
  sessionConfigDigest: session.digest,
  neutralInput: encodeInput(DEFAULT_INPUT),
  snapshotCadenceTicks: 60,
};
const clientOptions = () => ({
  runtimeFactory: () => createGameRuntime(undefined, session.bytes),
  defaultInput: DEFAULT_INPUT,
  localInputForTick: driver,
  encodeInput,
  decodeInput,
  maxPredictionTicks: Number(process.env['MAXPRED'] ?? 8),
});
const steps = Number(process.env.STEPS ?? 600);
const link = { latencyTicks: Number(process.env['LAT'] ?? 3), jitterTicks: Number(process.env['JIT'] ?? 2), lossRate: Number(process.env['LOSS'] ?? 0.02) };

const t0 = Date.now();
const two = assertTwoClientConvergence({ roomConfig, clientOptions, steps, link, networkSeed: 7 });
console.log('two-client convergence', JSON.stringify(two), `wall ${Date.now() - t0} ms`);
const late = assertLateJoinHydration({ roomConfig, clientOptions, steps, link, networkSeed: 9, initialClientCount: 1, beforeJoinSteps: 200, afterJoinSteps: 300 });
console.log('late-join hydration  ', JSON.stringify(late));
