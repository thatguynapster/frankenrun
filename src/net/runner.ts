import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import {
  createSyncplayRoom,
  createSyncplayRunner,
  joinSyncplayRoomByCode,
  quickMatchSyncplayRoom,
  type SyncplayRunner,
} from '@series-inc/rundot-syncplay/browser';
import { DEFAULT_INPUT, type GameInput, type GameProjection, type PlayerView } from '../sim/game.js';
import { decodeInput, encodeInput } from '../sim/input-codec.js';
import { createGameRuntime, DEFAULT_MAP, makeSessionConfig, MAX_PLAYERS, runtimeIdentity } from '../sim/runtime.js';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpPlayer(a: PlayerView, b: PlayerView, t: number): PlayerView {
  // Normalised lerp of the quaternion; shortest path via sign flip.
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = dot < 0 ? -1 : 1;
  let qx = lerp(a.qx, b.qx * s, t);
  let qy = lerp(a.qy, b.qy * s, t);
  let qz = lerp(a.qz, b.qz * s, t);
  let qw = lerp(a.qw, b.qw * s, t);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= len;
  qy /= len;
  qz /= len;
  qw /= len;
  return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), qx, qy, qz, qw };
}

/** Netcode prediction budget in ticks. See the note in createRunner. */
export const MAX_PREDICTION_TICKS = 12;

export type FrankenRunner = SyncplayRunner<GameInput, GameProjection, never>;

export function createRunner(): FrankenRunner {
  return createSyncplayRunner({
    runtimeFactory: createGameRuntime,
    defaultInput: DEFAULT_INPUT,
    encodeInput,
    decodeInput,
    // The netcode needs a prediction span of about (RTT in ticks + 2) to keep our inputs ahead of the
    // authority's clock; the default cap of 8 ticks (267 ms) is below the ~330 ms round trips seen in
    // practice, which forced input delay and caused our own inputs to be substituted. The cap also bounds the
    // work of a rollback (depth x tick cost), so it is kept modest: on a bad link the netcode adds input
    // delay instead of re-simulating ever deeper.
    maxPredictionTicks: MAX_PREDICTION_TICKS,
    presentation: {
      project: (projection) => projection,
      interpolate: (previous, current, alpha) => {
        // Never blend across a respawn/teleport or a phase change.
        if (previous.phase !== current.phase) return current;
        return {
          ...current,
          players: current.players.map((p, i) => {
            const prev = previous.players[i];
            if (prev === undefined || Math.hypot(p.x - prev.x, p.z - prev.z) > 8) return p;
            return lerpPlayer(prev, p, alpha);
          }),
        };
      },
    },
  });
}

/** Practice races: you against AI racers (the simulation drives them; see sim/bot.ts). */
export const PRACTICE_BOTS = Math.min(MAX_PLAYERS - 1, 5);

/** Offline practice: a real rollback session with one human and a pack of AI racers. */
export async function startPractice(runner: FrankenRunner, map: string = DEFAULT_MAP): Promise<void> {
  await runner.start({
    mode: 'offline',
    identity: runtimeIdentity,
    sessionConfigBytes: makeSessionConfig(map, PRACTICE_BOTS, PRACTICE_BOTS + 1).bytes,
    playerCount: PRACTICE_BOTS + 1,
    localSlot: 0,
    botInputForTick: () => ({ ...DEFAULT_INPUT, present: true, ready: true }),
  });
}

export async function hostRace(runner: FrankenRunner, map: string = DEFAULT_MAP): Promise<string> {
  await RundotGameAPI.initializeAsync();
  const session = makeSessionConfig(map);
  const transport = await createSyncplayRoom(RundotGameAPI.realtime, {
    maxPlayers: MAX_PLAYERS,
    runtimeIdentity,
    sessionConfigBytes: session.bytes,
    sessionConfigDigest: session.digest,
  });
  await runner.start({ mode: 'networked', connect: async () => transport });
  return transport.roomCode ?? '';
}

export async function joinRace(runner: FrankenRunner, code: string): Promise<void> {
  await RundotGameAPI.initializeAsync();
  await runner.start({
    mode: 'networked',
    connect: async () => joinSyncplayRoomByCode(RundotGameAPI.realtime, code),
  });
}

/** Public matchmaking: the platform pools compatible players (same build, same config) into an open room. */
export async function quickMatch(runner: FrankenRunner, map: string = DEFAULT_MAP): Promise<void> {
  await RundotGameAPI.initializeAsync();
  const session = makeSessionConfig(map);
  const transport = await quickMatchSyncplayRoom(RundotGameAPI.realtime, {
    maxPlayers: MAX_PLAYERS,
    runtimeIdentity,
    sessionConfigBytes: session.bytes,
    sessionConfigDigest: session.digest,
  });
  await runner.start({ mode: 'networked', connect: async () => transport });
}
