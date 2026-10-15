// A player drops out of a room mid-race and rejoins through the same runner call the game uses (start networked again
// with a fresh transport for the same player): they must get their original slot and monster back and keep racing.
//   npm run test:rejoin          (exits 1 on a failed check)
import { createSyncplayRunner, type SyncplayRunnerSnapshot } from '@series-inc/rundot-syncplay';
import { createSimulatedSyncplayMatch } from '@series-inc/rundot-syncplay/testing';
import { encodeInput, decodeInput } from '../src/sim/input-codec.ts';
import { DEFAULT_INPUT, type GameInput, type GameProjection } from '../src/sim/game.ts';
import { MAX_PLAYERS } from '../src/sim/limits.ts';
import { createGameRuntime, makeSessionConfig, runtimeIdentity } from '../src/sim/runtime.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const session = makeSessionConfig('route1');
let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const driver = (slot: number, tick: number): GameInput => ({
  ...DEFAULT_INPUT,
  present: true,
  ready: tick > 5,
  start: tick > 5,
  throttle: 100,
  steer: Math.round((40 * Math.sin((tick + slot * 40) / 25)) / 10) * 10,
});
const roomConfig = {
  playerCount: MAX_PLAYERS,
  seed: 1,
  hardToleranceTicks: 6,
  tickRateHz: 30,
  redundancyWindowTicks: 8,
  runtimeIdentity,
  sessionConfigBytes: session.bytes,
  sessionConfigDigest: session.digest,
  neutralInput: encodeInput(DEFAULT_INPUT),
  // Production uses the platform default (3600 ticks); SNAP=default tests that, otherwise a short cadence is used.
  ...(process.env['SNAP'] === 'default' ? {} : { snapshotCadenceTicks: 60 }),
};

const match = createSimulatedSyncplayMatch({ roomConfig, networkSeed: 3 });
const link = { latencyMin: 2, latencyMax: 4, lossRate: 0 };
// Player A is the host (first to join, slot 0); B is the player who will drop out.
const a = match.connect(
  'A',
  { runtimeFactory: () => createGameRuntime(undefined, session.bytes), defaultInput: DEFAULT_INPUT, localInputForTick: (slot, tick) => driver(slot, tick), encodeInput, decodeInput, maxPredictionTicks: 12 },
  link,
);

type Snap = SyncplayRunnerSnapshot<GameProjection>;
const runner = createSyncplayRunner({
  runtimeFactory: () => createGameRuntime(undefined, session.bytes),
  defaultInput: DEFAULT_INPUT,
  encodeInput,
  decodeInput,
  maxPredictionTicks: 12,
  presentation: { project: (p: GameProjection) => p },
});
let snap: Snap | undefined;
runner.subscribe((s: Snap) => {
  snap = s;
});

let tick = 0;
/** Steps the simulated network and runs B's runner; yields between steps so its async connection work can progress. */
const pump = async (n: number, withB = true): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    tick += 1;
    if (withB) {
      runner.applyInput(driver(1, tick));
      runner.update(33.4);
    }
    match.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
const frameOf = (s: Snap | undefined): GameProjection | undefined => s?.renderState;

async function main(): Promise<void> {
  const transport1 = match.openTransport('B', link);
  const started1 = runner.start({ mode: 'networked', connect: async () => transport1 }); // resolves once the room's greeting arrives
  pump(40);
  started1.catch((e: unknown) => console.log('first start rejected:', e));
  await pump(Number(process.env['RACETICKS'] ?? 440));
  let view = frameOf(snap);
  check('B joined as slot 1 and the race is running', snap?.status === 'live' && snap.localSlot === 1 && view?.phase === 'RACING', `status ${snap?.status}, slot ${snap?.localSlot}, phase ${view?.phase}`);
  check('B is in the race with a monster', view?.players[1]?.inRace === true && view.players[1].present === true);
  const before = view?.players[1];

  // B drops off for a while: the seat is released, the others carry on.
  transport1.close();
  runner.stop();
  const aBefore = a.client.appliedThrough;
  await pump(150, false);
  check('the room keeps running without B', a.client.appliedThrough > aBefore + 100, `+${a.client.appliedThrough - aBefore} ticks`);

  // Rejoin exactly as Game.rejoin() does: start networked again with a fresh connect factory.
  const transport2 = match.openTransport('B', link);
  const started2 = runner.start({ mode: 'networked', connect: async () => transport2 });
  started2.catch((e: unknown) => console.log('rejoin start rejected:', e));
  await pump(340);
  view = frameOf(snap);
  check('B is live again', snap?.status === 'live', `status ${snap?.status}, error ${snap?.error?.message ?? 'none'}`);
  check('B got its original slot back', snap?.localSlot === 1, `slot ${snap?.localSlot}`);
  check('and is still a racer with its monster', view?.players[1]?.inRace === true && view.players[1].present === true);
  const after = view?.players[1];
  check('its monster progressed through the gap (checkpoint progress did not reset)', (after?.nextCheckpoint ?? -1) >= (before?.nextCheckpoint ?? 99), `before CP ${before?.nextCheckpoint}, after CP ${after?.nextCheckpoint}`);
  check('B is in step with the room', Math.abs((snap?.appliedThrough ?? 0) - a.client.appliedThrough) < 30, `B ${snap?.appliedThrough}, A ${a.client.appliedThrough}`);
}

main()
  .then(() => {
    console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('FAIL (threw)', error);
    process.exit(1);
  });
