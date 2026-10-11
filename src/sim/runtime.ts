import {
  createInstalledRuntimeAdapter,
  kinetixRuntimeIdentitiesEqual,
  kinetixSessionConfigDigest,
  type KinetixRuntimeIdentity,
} from '@series-inc/rundot-syncplay/core/runtime';
import { decodeCanonicalBytes, encodeCanonicalBytes } from '@series-inc/rundot-syncplay/browser';
import { runtimeIdentity } from './identity.generated.js';
import {
  createGameState,
  projectGame,
  stepGame,
  type GameInput,
  type GameProjection,
  type GameState,
  type SessionConfig,
} from './game.js';

/** M1 greybox: a fixed two-player room. The session config is part of the room's identity. */
export const sessionConfig: SessionConfig = Object.freeze({
  game: 'frankenrun',
  players: 2,
  seed: 1,
  tickRateHz: 30,
  version: 1,
});
export const sessionConfigBytes = new TextEncoder().encode(JSON.stringify(sessionConfig));
export const sessionConfigDigest = kinetixSessionConfigDigest(sessionConfigBytes);
export { runtimeIdentity };

// The runner calls this as (identity, sessionConfigBytes) for every session it starts, offline and
// networked. Reject anything that is not this build.
export function createGameRuntime(
  identity: Readonly<KinetixRuntimeIdentity> = runtimeIdentity,
  configBytes: Uint8Array = sessionConfigBytes,
) {
  if (!kinetixRuntimeIdentitiesEqual(identity, runtimeIdentity)) throw new Error('FRANKENRUN_IDENTITY_MISMATCH');
  if (kinetixSessionConfigDigest(configBytes) !== sessionConfigDigest) throw new Error('FRANKENRUN_CONFIG_MISMATCH');

  let state: GameState = createGameState(sessionConfig);
  return createInstalledRuntimeAdapter<GameState, GameInput, never, GameProjection>({
    identity: runtimeIdentity,
    sessionConfigBytes,
    captureState: () => state,
    restoreState: (selected) => {
      state = selected;
    },
    frameOf: (selected) => selected.frame,
    step: (inputs, _commands) => {
      state = stepGame(state, inputs);
    },
    capturedStateIsDetached: true, // immutable state, fresh root per tick
    serializeState: (selected) => encodeCanonicalBytes(selected as never),
    hydrateState: (_frame, bytes) => decodeCanonicalBytes(bytes) as unknown as GameState,
    checksumBytes: (selected) => encodeCanonicalBytes(selected as never),
    projectState: (selected) => projectGame(selected),
  });
}
