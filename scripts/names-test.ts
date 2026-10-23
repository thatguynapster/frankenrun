// Gametags travel between clients on the room's ephemeral channel, attributed to the sender's slot by the room.
//   npm run test:names          (exits 1 on a failed check)
import { createSyncplayRunner, type SyncplayRunner } from '@series-inc/rundot-syncplay';
import { createSimulatedSyncplayMatch } from '@series-inc/rundot-syncplay/testing';
import { encodeInput, decodeInput } from '../src/sim/input-codec.ts';
import { DEFAULT_INPUT, type GameProjection } from '../src/sim/game.ts';
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

const match = createSimulatedSyncplayMatch({
  roomConfig: {
    playerCount: MAX_PLAYERS,
    seed: 1,
    hardToleranceTicks: 6,
    tickRateHz: 30,
    redundancyWindowTicks: 8,
    runtimeIdentity,
    sessionConfigBytes: session.bytes,
    sessionConfigDigest: session.digest,
    neutralInput: encodeInput(DEFAULT_INPUT),
  },
  networkSeed: 3,
});
const link = { latencyMin: 2, latencyMax: 4, lossRate: 0 };
const makeRunner = (): SyncplayRunner<never, GameProjection, never> =>
  createSyncplayRunner({
    runtimeFactory: () => createGameRuntime(undefined, session.bytes),
    defaultInput: DEFAULT_INPUT,
    encodeInput,
    decodeInput,
    maxPredictionTicks: 12,
    presentation: { project: (p: GameProjection) => p },
  }) as never;

const runners = [makeRunner(), makeRunner(), makeRunner()] as const;
const heard: Record<number, Map<number, string>> = { 0: new Map(), 1: new Map(), 2: new Map() };
const pump = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    for (const r of runners) {
      r.applyInput({ ...DEFAULT_INPUT, present: true } as never);
      r.update(33.4);
    }
    match.advance(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

async function main(): Promise<void> {
  for (let i = 0; i < runners.length; i += 1) {
    const transport = match.openTransport(`P${i}`, link);
    const started = runners[i]!.start({ mode: 'networked', connect: async () => transport } as never);
    started.catch(() => undefined);
    runners[i]!.onEphemeral((slot, payload) => {
      const name = (payload as { n?: unknown } | null)?.n;
      if (typeof name === 'string') heard[i]!.set(slot, name);
    });
    await pump(40);
  }
  runners[0]!.sendEphemeral({ n: 'Ada' });
  runners[1]!.sendEphemeral({ n: 'Bo' });
  runners[2]!.sendEphemeral({ n: 'Cy' });
  await pump(60);
  check('slot 1 and slot 2 names reach player 0', heard[0]!.get(1) === 'Bo' && heard[0]!.get(2) === 'Cy', JSON.stringify([...heard[0]!]));
  check('slot 0 and slot 2 names reach player 1', heard[1]!.get(0) === 'Ada' && heard[1]!.get(2) === 'Cy', JSON.stringify([...heard[1]!]));
  check('slot 0 and slot 1 names reach player 2', heard[2]!.get(0) === 'Ada' && heard[2]!.get(1) === 'Bo', JSON.stringify([...heard[2]!]));
  check('nobody receives their own name back', !heard[0]!.has(0) && !heard[1]!.has(1) && !heard[2]!.has(2));
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
