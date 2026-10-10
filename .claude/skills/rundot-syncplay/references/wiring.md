# SyncPlay wiring skeleton

Minimal end-to-end shape for a custom deterministic game, modelled on the
internal FPS reference integration. Every symbol here exists on
`@series-inc/rundot-syncplay` >= 5.26.0 — run the preflight from `SKILL.md`
section 2 first; on an older install none of these imports resolve.

## src/sim/game.ts — plain data in, plain data out

```ts
export interface GameState { readonly frame: number; readonly players: readonly PlayerState[] }
export interface GameInput { readonly moveX: -1 | 0 | 1; readonly jump: boolean }
export interface GameProjection { readonly frame: number; readonly players: readonly PlayerView[] }

export const DEFAULT_INPUT: GameInput = { moveX: 0, jump: false }

export function createGameState(seed: number): GameState { /* … */ }
export function stepGame(state: GameState, inputs: readonly GameInput[]): GameState { /* … */ }
export function projectGame(state: GameState): GameProjection { /* … */ }
```

`stepGame` returns a **fresh root** every tick and never mutates `state` in
place — structural sharing is what makes capture O(1) and delta projection
possible. No `Math.random`, `Date.now`, `performance.now` or wall-clock delta in
here; for randomness use `new DeterministicRandom(seed)` from the root export
with a seed carried in session config, and `.fork(label)` per subsystem.

## scripts/gen-identity.ts — identity bound to your source

```ts
import { deriveCustomRuntimeIdentity, kinetixRuntimeModuleManifest } from '@series-inc/rundot-syncplay/core'

export const runtimeIdentity = deriveCustomRuntimeIdentity({
  tickRate: 30,                                   // 10 | 20 | 30 | 60 only
  inputSchema: { id: 'my-game-input/v1' },
  stateSchema: { id: 'my-game-state/v1' },
  deterministicVersion: 'my-game@1+syncplay<installed version>',
  runtimeModules: kinetixRuntimeModuleManifest('src', ['sim/game.ts', 'sim/runtime.ts']),
})
```

Node-only, build time. Write the result to a checked-in
`src/sim/identity.generated.ts`; that file must not appear in its own
`runtimeModules` list. Regenerate whenever the simulation source or the
installed syncplay version changes.

## src/sim/runtime.ts — adapter over the step function

```ts
import {
  createInstalledRuntimeAdapter,
  kinetixRuntimeIdentitiesEqual,
  kinetixSessionConfigDigest,
  type KinetixRuntimeIdentity,
} from '@series-inc/rundot-syncplay/core/runtime'
import { decodeCanonicalBytes, encodeCanonicalBytes } from '@series-inc/rundot-syncplay/browser'

import { runtimeIdentity } from './identity.generated.js'
import { createGameState, projectGame, stepGame, type GameInput, type GameProjection, type GameState } from './game.js'

const sessionConfig = Object.freeze({ game: 'my-game', players: 2, seed: 1, tickRateHz: 30, version: 1 })
export const sessionConfigBytes = new TextEncoder().encode(JSON.stringify(sessionConfig))
export const sessionConfigDigest = kinetixSessionConfigDigest(sessionConfigBytes)
export { runtimeIdentity }

// The runner calls this as (identity, sessionConfigBytes) for every session it
// starts, offline and networked. Reject anything that is not this build.
export function createGameRuntime(
  identity: Readonly<KinetixRuntimeIdentity> = runtimeIdentity,
  configBytes: Uint8Array = sessionConfigBytes,
) {
  if (!kinetixRuntimeIdentitiesEqual(identity, runtimeIdentity)) throw new Error('MY_GAME_IDENTITY_MISMATCH')
  if (kinetixSessionConfigDigest(configBytes) !== sessionConfigDigest) throw new Error('MY_GAME_CONFIG_MISMATCH')

  let state: GameState = createGameState(sessionConfig.seed)
  return createInstalledRuntimeAdapter<GameState, GameInput, never, GameProjection>({
    identity: runtimeIdentity,
    sessionConfigBytes,
    captureState: () => state,
    restoreState: (selected) => { state = selected },
    frameOf: (selected) => selected.frame,
    step: (inputs, _commands) => { state = stepGame(state, inputs) },
    capturedStateIsDetached: true,                                    // immutable state, fresh root per tick
    serializeState: (selected) => encodeCanonicalBytes(selected),     // pair with hydrateState (late join)
    hydrateState: (_frame, bytes) => decodeCanonicalBytes(bytes) as unknown as GameState,
    checksumBytes: (selected) => encodeCanonicalBytes(selected),
    projectState: (selected) => projectGame(selected),                // omit and project() throws
  })
}
```

Add `decodeCommand` only when the game accepts authority-ordered commands;
without it every non-empty command list is rejected.

## src/sim/input-codec.ts

```ts
import { defineSyncplayInputCodec, type CanonicalValue } from '@series-inc/rundot-syncplay'
import type { GameInput } from './game.js'

const codec = defineSyncplayInputCodec<GameInput>({
  moveX: { kind: 'enum', values: [-1, 0, 1] },
  jump: { kind: 'boolean' },
})

export const encodeInput = codec.encodeInput
export const decodeInput = (value: CanonicalValue): GameInput => codec.decodeInput(value)
```

## src/net/runner.ts — offline with bots first, then networked

```ts
import RundotGameAPI from '@series-inc/rundot-game-sdk/api'
import {
  createSyncplayRoom,
  createSyncplayRunner,
  joinSyncplayRoomByCode,
  type SyncplayRunner,
} from '@series-inc/rundot-syncplay/browser'

import { DEFAULT_INPUT, type GameInput, type GameProjection } from '../sim/game.js'
import { decodeInput, encodeInput } from '../sim/input-codec.js'
import { createGameRuntime, runtimeIdentity, sessionConfigBytes, sessionConfigDigest } from '../sim/runtime.js'

// `draw`, `readControls` and `offerRejoin` are your game's; nothing here is SDK-provided.
export const runner: SyncplayRunner<GameInput, GameProjection, never> = createSyncplayRunner({
  runtimeFactory: createGameRuntime,
  defaultInput: DEFAULT_INPUT,
  encodeInput,
  decodeInput,
  presentation: { project: (projection) => projection },
})

runner.subscribe((snapshot) => {
  if (snapshot.status === 'error') offerRejoin(snapshot.error)          // see startNetworked below
  if (snapshot.renderState !== undefined) draw(snapshot.renderState, snapshot.localSlot)
})

// Step 1 — no network, no room. Bot-filled slots, real rollback session.
export function startSolo(): void {
  runner.startOffline({
    identity: runtimeIdentity,
    sessionConfigBytes,
    playerCount: 2,
    localSlot: 0,
    botInputForTick: () => DEFAULT_INPUT,
  })
}

// Step 2 — only once solo is stable and assertDeterministic passes.
export async function host(): Promise<string> {
  await RundotGameAPI.initializeAsync()
  const transport = await createSyncplayRoom(RundotGameAPI.realtime, {
    maxPlayers: 2,
    runtimeIdentity,
    sessionConfigBytes,
    sessionConfigDigest,
  })
  await runner.startNetworked(async () => transport)
  return transport.roomCode                                            // share this to let a friend join
}

export async function join(code: string): Promise<void> {
  await RundotGameAPI.initializeAsync()
  await runner.startNetworked(async () => joinSyncplayRoomByCode(RundotGameAPI.realtime, code))
}
```

Drive the clock yourself, once per frame:

```ts
let previous = performance.now()
function frame(now: number): void {
  runner.applyInput(readControls())          // last value is reused for every simulated local frame
  runner.update(Math.max(0, now - previous))
  previous = now
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

`performance.now()` here is presentation only — it drives the runner's clock,
never the simulation. A hard disconnect is terminal (`status: 'error'` carrying
`SYNCPLAY_TRANSPORT_DISCONNECTED`); `offerRejoin` must call `host`/`join` again
with a fresh connect factory. `quickMatchSyncplayRoom(api, options, criteria?)`
replaces `createSyncplayRoom` for matchmaking instead of room codes.

## rundot/realtime.config.json — fileless deterministic entry

```json
{
  "rooms": [
    {
      "type": "deterministic",
      "deterministic": true,
      "config": { "maxPlayers": 2, "tickRateHz": 30 }
    }
  ]
}
```

`tickRateHz` must equal the identity's `tickRate`. No `file`, no `GameRoom`
subclass, no `rundot/rooms.config.json`, no server bundle.

## Prove the sim before shipping it

```ts
import { assertDeterministic } from '@series-inc/rundot-syncplay/testing'

assertDeterministic({
  runtimeFactory: () => createGameRuntime(),
  policy: { playerCount: 2, defaultInput: DEFAULT_INPUT, snapshotBufferSize: 256, checksumIntervalFrames: 30 },
  frames: 600,
})
```

Then `assertTwoClientConvergence`, `assertLateJoinHydration` and
`assertPresentationParity` — see `SKILL.md` section 5.
