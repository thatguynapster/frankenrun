// Reproduces "player drops off the network and comes back" in the simulated room:  npm run test:outage
// Reports how far the OTHER player advances during the outage and how many rollbacks the recovery costs.
import { createSimulatedSyncplayMatch } from '@series-inc/rundot-syncplay/testing';
import { encodeInput, decodeInput } from '../src/sim/input-codec.ts';
import { DEFAULT_INPUT, type GameInput } from '../src/sim/game.ts';
import { createGameRuntime, makeSessionConfig, runtimeIdentity } from '../src/sim/runtime.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const session = makeSessionConfig('route1');
const driver = (slot: number, tick: number): GameInput => ({
  ...DEFAULT_INPUT, ready: tick > 5, throttle: 100,
  steer: Math.round((60 * Math.sin((tick + slot * 40) / 25)) / 10) * 10,
});
const roomConfig = {
  playerCount: 2, seed: 1, hardToleranceTicks: Number(process.env['TOL'] ?? 12), tickRateHz: 30, redundancyWindowTicks: 8,
  runtimeIdentity, sessionConfigBytes: session.bytes, sessionConfigDigest: session.digest,
  neutralInput: encodeInput(DEFAULT_INPUT), snapshotCadenceTicks: 60,
};
const clientOptions = () => ({
  runtimeFactory: () => createGameRuntime(undefined, session.bytes), defaultInput: DEFAULT_INPUT, localInputForTick: driver,
  encodeInput, decodeInput, maxPredictionTicks: Number(process.env['MAXPRED'] ?? 12),
});

for (const outageSteps of [30, 90, 240]) {
  const match = createSimulatedSyncplayMatch({ roomConfig, networkSeed: 3 });
  const link = { latencyMin: 3, latencyMax: 6, lossRate: 0.01 };
  const p0 = match.connect('desktop', clientOptions(), link);
  const p1 = match.connect('phone', clientOptions(), link);
  match.advance(240);
  const before = { rb0: p0.client.rollbacks, rb1: p1.client.rollbacks, a0: p0.client.appliedThrough, a1: p1.client.appliedThrough };
  // Cut the phone's link in both directions.
  const saved = { up: { ...p1.uplink }, down: { ...p1.downlink } };
  p1.uplink.lossRate = 1; p1.downlink.lossRate = 1;
  match.advance(outageSteps);
  const during = { a0: p0.client.appliedThrough, pred0: p0.client.predictedThrough, a1: p1.client.appliedThrough };
  // Restore.
  Object.assign(p1.uplink, saved.up); Object.assign(p1.downlink, saved.down);
  const t0 = Date.now();
  match.advance(240);
  const recoverMs = Date.now() - t0;
  console.log(`outage ${(outageSteps / 30).toFixed(0)}s: desktop confirmed +${during.a0 - before.a0} of ${outageSteps} ticks during it (predicted ${during.pred0 - before.a0}); phone confirmed +${during.a1 - before.a1}`);
  console.log(`   rollbacks: desktop +${p0.client.rollbacks - before.rb0}, phone +${p1.client.rollbacks - before.rb1} | recovery (240 steps) took ${recoverMs} ms | final applied: desktop ${p0.client.appliedThrough}, phone ${p1.client.appliedThrough}`);
}
