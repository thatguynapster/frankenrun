import {
  createInstalledRuntimeAdapter,
  kinetixRuntimeIdentitiesEqual,
  kinetixSessionConfigDigest,
  verifyKinetixAuxiliaryAsset,
  type KinetixRuntimeIdentity,
} from '@series-inc/rundot-syncplay/core/runtime';
import { decodeCanonicalBytes, encodeCanonicalBytes } from '@series-inc/rundot-syncplay/browser';
import { mapAssets, runtimeIdentity } from './identity.generated.js';
import {
  createGameState,
  projectGame,
  stepGame,
  type GameInput,
  type GameProjection,
  type GameState,
  type SessionConfig,
} from './game.js';
import type { MapData } from './mapdata.js';
import { getPreparedMap, registerMap } from './world.js';

export { runtimeIdentity };

/** Map used by public matchmaking and the default private rooms. */
export const DEFAULT_MAP = 'route1';
export const PLAYERS = 2; // M1/M2: fixed two-player rooms

export interface EncodedSessionConfig {
  readonly config: SessionConfig;
  readonly bytes: Uint8Array;
  readonly digest: string;
}

/** The session config is part of the room's identity: same map, same players, same tick rate. */
export function makeSessionConfig(map: string): EncodedSessionConfig {
  const config: SessionConfig = Object.freeze({ game: 'frankenrun', map, players: PLAYERS, seed: 1, tickRateHz: 30, version: 1 });
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  return { config, bytes, digest: kinetixSessionConfigDigest(bytes) };
}

function parseSessionConfig(bytes: Uint8Array): SessionConfig {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SessionConfig>;
  if (
    value.game !== 'frankenrun' ||
    typeof value.map !== 'string' ||
    value.players !== PLAYERS ||
    value.tickRateHz !== 30 ||
    value.version !== 1 ||
    typeof value.seed !== 'number'
  ) {
    throw new Error('FRANKENRUN_CONFIG_INVALID');
  }
  return value as SessionConfig;
}

/** Name under which a baked map is declared in the runtime identity. */
export const mapAssetName = (id: string): string => `map-${id}`;

/**
 * Verifies a baked map's bytes against the digest pinned in the runtime identity, then registers it.
 * A mismatch is terminal: never substitute other content, or this client would desync from its peers.
 */
export function registerMapBytes(id: string, bytes: Uint8Array): void {
  const declared = mapAssets.find((a) => a.name === mapAssetName(id));
  if (!declared) throw new Error(`FRANKENRUN_MAP_UNDECLARED ${id}`);
  const verified = verifyKinetixAuxiliaryAsset(declared, bytes);
  registerMap(JSON.parse(new TextDecoder().decode(verified)) as MapData);
}

// The runner calls this as (identity, sessionConfigBytes) for every session it starts, offline and
// networked. Reject anything that is not this build.
export function createGameRuntime(identity: Readonly<KinetixRuntimeIdentity> = runtimeIdentity, configBytes: Uint8Array = makeSessionConfig('greybox').bytes) {
  if (!kinetixRuntimeIdentitiesEqual(identity, runtimeIdentity)) throw new Error('FRANKENRUN_IDENTITY_MISMATCH');
  const config = parseSessionConfig(configBytes);
  const prep = getPreparedMap(config.map); // throws FRANKENRUN_MAP_NOT_LOADED until the map is loaded

  let state: GameState = createGameState(config, prep);
  return createInstalledRuntimeAdapter<GameState, GameInput, never, GameProjection>({
    identity: runtimeIdentity,
    sessionConfigBytes: configBytes,
    captureState: () => state,
    restoreState: (selected) => {
      state = selected;
    },
    frameOf: (selected) => selected.frame,
    step: (inputs, _commands) => {
      state = stepGame(state, inputs, prep);
    },
    capturedStateIsDetached: true, // immutable state, fresh root per tick
    serializeState: (selected) => encodeCanonicalBytes(selected as never),
    hydrateState: (_frame, bytes) => decodeCanonicalBytes(bytes) as unknown as GameState,
    checksumBytes: (selected) => encodeCanonicalBytes(selected as never),
    projectState: (selected) => projectGame(selected, prep),
  });
}
