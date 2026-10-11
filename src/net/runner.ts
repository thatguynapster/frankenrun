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
import {
  createGameRuntime,
  runtimeIdentity,
  sessionConfig,
  sessionConfigBytes,
  sessionConfigDigest,
} from '../sim/runtime.js';

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

export type FrankenRunner = SyncplayRunner<GameInput, GameProjection, never>;

export function createRunner(): FrankenRunner {
  return createSyncplayRunner({
    runtimeFactory: createGameRuntime,
    defaultInput: DEFAULT_INPUT,
    encodeInput,
    decodeInput,
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

/** Offline practice: a real rollback session with an idle bot that readies up immediately. */
export async function startPractice(runner: FrankenRunner): Promise<void> {
  await runner.start({
    mode: 'offline',
    identity: runtimeIdentity,
    sessionConfigBytes,
    playerCount: sessionConfig.players,
    localSlot: 0,
    botInputForTick: () => ({ ...DEFAULT_INPUT, ready: true }),
  });
}

export async function hostRace(runner: FrankenRunner): Promise<string> {
  await RundotGameAPI.initializeAsync();
  const transport = await createSyncplayRoom(RundotGameAPI.realtime, {
    maxPlayers: sessionConfig.players,
    runtimeIdentity,
    sessionConfigBytes,
    sessionConfigDigest,
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
export async function quickMatch(runner: FrankenRunner): Promise<void> {
  await RundotGameAPI.initializeAsync();
  const transport = await quickMatchSyncplayRoom(RundotGameAPI.realtime, {
    maxPlayers: sessionConfig.players,
    runtimeIdentity,
    sessionConfigBytes,
    sessionConfigDigest,
  });
  await runner.start({ mode: 'networked', connect: async () => transport });
}
