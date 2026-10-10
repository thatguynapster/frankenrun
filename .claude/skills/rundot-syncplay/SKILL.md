---
name: rundot-syncplay
description: >-
  Add deterministic multiplayer to a RUN.game title with SyncPlay
  (`@series-inc/rundot-syncplay`) — one fixed-tick simulation every client runs
  identically, rollback prediction, lockstep input authority, replays, late
  join, and desync debugging. Use when the creator says syncplay or sync-play,
  deterministic multiplayer, rollback netcode, lockstep, desync, checksum
  mismatch, replay verification, "the same match on every device", or wants a
  physics/action game where players "play together in real time". For
  server-authoritative rooms where the server owns state, use
  `rundot-multiplayer` instead.
---

# RUN.game SyncPlay — deterministic multiplayer (BETA)

Every client runs the same fixed-tick simulation from the same inputs and the same canonical session config, so every device lands on the identical state at every frame. The authority orders inputs; it does not own state. That buys rollback prediction, byte-exact replays, snapshot late join, and cheat-resistant runtime identity — paid for with a hard determinism contract on the simulation code.

## 1. Which multiplayer system

| Use | When |
|---|---|
| `rundot-syncplay` (this skill) | Action, physics, platformers, fighting, racing, shooters, RTS — every player must see the same world at the same tick. Also whenever the creator wants replays, rollback, or a simulation a client can't lie about. |
| `rundot-multiplayer` | The server owns state and clients only propose — board and card games, turn-based, async, lobbies, anything where authoritative validation matters more than frame-exact agreement. |

Turn-based, async, and server-validated games belong in `rundot-multiplayer`; don't make them pay the determinism tax. And if a creator's simulation can't be made deterministic (section 3) and they don't want to restructure it, `rundot-multiplayer` is the honest answer — not a half-ported syncplay build that desyncs.

## 2. Install and verify before writing a line of code

**Never install this package unpinned.** `npm install @series-inc/rundot-syncplay` resolves the `latest` dist-tag, and RUN Studio's `add_dependency` tool defaults to `latest` too. For this package `latest` trails the usable builds: it has been sitting on 5.23.0, which publishes only `.`, `./creator`, `./node`, `./browser`, `./testing` and `./tools` — no `/core`, no `/core/runtime`, no `/modules/*`, and no `defineSyncplayInputCodec` or `createSyncplayRunner` on the root export. Every import path in the docs fails against it.

The procedure, in order:

1. Read the published tags:

   ```bash
   npm view @series-inc/rundot-syncplay dist-tags
   ```

2. Take the **greater of `latest` and `beta`**, and require **>= 5.26.0** — `/core`, `/core/runtime` and `/modules/*` do not exist before that. If neither tag reaches 5.26.0, stop and say so instead of installing something the docs don't describe.
3. Install that exact version (pinned, not a range):

   ```bash
   npm install @series-inc/rundot-syncplay@<version from step 2>
   ```

4. **Expect the game SDK to move.** A current syncplay declares a peer range on `@series-inc/rundot-game-sdk` above what an older scaffold pins, so npm bumps the SDK with it. That bump is correct — don't pin the SDK back down to satisfy a stale lockfile.
5. Verify the subpaths actually resolve, from the project root:

```bash
node --input-type=module -e "
const fs = await import('node:fs');
console.log('syncplay', JSON.parse(fs.readFileSync('node_modules/@series-inc/rundot-syncplay/package.json','utf8')).version);
await import('@series-inc/rundot-syncplay/core/runtime');
await import('@series-inc/rundot-syncplay/creator');
console.log('subpaths resolve OK');
"
```

Only continue once it prints the installed version followed by `subpaths resolve OK`. The failure you will otherwise hit looks like this:

```
ERR_PACKAGE_PATH_NOT_EXPORTED  Package subpath './core/runtime' is not defined by "exports"
```

> **A subpath that won't resolve is a version problem — never an account, entitlement, or beta-enablement problem. No syncplay feature is gated per creator.**

So don't report that the package "installs but is empty of the parts it documents", don't send the creator to support, and don't ask for the beta to be turned on for them. Above all, don't delete syncplay and hand-roll a fixed-step loop: that throws away rollback, replays, late join and identity, and it will not converge across devices. Go back to step 1 and fix the version.

## 3. Does this game qualify?

Run this against the creator's existing code before promising deterministic multiplayer. Every line is load-bearing; one violation shows up as a desync, not as a compile error.

- **One fixed tick rate.** `tickRate` in the runtime identity is `10 | 20 | 30 | 60` — nothing else — and it must match `tickRateHz` in the room config.
- **Simulation state is plain data.** Numbers, booleans, strings, arrays, plain objects; canonically serializable. No three.js objects, physics-engine handles, DOM nodes or class instances living inside the state the sim steps.
- **No ambient nondeterminism in the sim.** No `Math.random`, no `Date.now`, no `performance.now`, no wall-clock delta, no reading a live input device mid-step. The tick number is your clock.
- **RNG is seeded and derived.** `new DeterministicRandom(seed)` (root export) with the seed coming from session config; `.fork(label)` per subsystem so adding a draw in one system doesn't shift another's stream; `.nextInt(min, max)`, `.pickOne(items)`, `.snapshot()`/`.restore()`.
- **The renderer reads a projection and never writes back.** Interpolation, camera, particles, audio and juice all live outside the simulation.
- **Input is a codec-validated struct** — a small fixed set of booleans, bounded ints and enums, derived with `defineSyncplayInputCodec`.

Say the hard part out loud: retrofitting a `requestAnimationFrame` game that steps by `deltaTime` and mutates renderer objects in place is a **restructure, not a wrapper**. The honest order of work is: extract the step function into plain-data-in / plain-data-out → prove it offline with bot slots → only then network it. A creator who networks first spends days debugging desyncs that were never network bugs.

## 4. Wiring

Five steps, in this order. Skeleton in `references/wiring.md`; detail in the pages from section 7.

1. **Identity** — `deriveCustomRuntimeIdentity` (`/core`) over `kinetixRuntimeModuleManifest('src', [...])`, so the identity hash is bound to your simulation source. Bind the installed syncplay version into `deterministicVersion` and regenerate on every dependency bump. Generate it in a checked script; the generated file must not appear in its own module manifest.
2. **Runtime adapter** — `createInstalledRuntimeAdapter` (`/core/runtime`) wraps your step function: `identity`, `sessionConfigBytes`, `captureState`, `restoreState`, `frameOf`, `step(inputs, commands)`. Add `projectState` for rendering, `serializeState` + `hydrateState` as a pair for late join, `decodeCommand` only if you accept authority commands. `step` takes **two** arguments — snippets showing `step: (inputs) => …` predate commands and will silently ignore any command you add later.
3. **Session or runner** — `createSyncplaySession(runtime, policy)` (`/creator`) is a **local** rollback session and does no networking at all; it is for offline proof, replays and tests. A shipping game uses `createSyncplayRunner` (root export, also re-exported from `/browser`), which owns the `offline → connecting → syncing → live` lifecycle, offline bot filling, pacing and presentation.
4. **Input codec** — `defineSyncplayInputCodec<Input>({ … })` (root export) with `{ kind: 'boolean' }`, `{ kind: 'int', min, max, neutral? }`, `{ kind: 'enum', values }` fields; hand its `encodeInput`/`decodeInput` to the runner.
5. **Networked + room config** — get a transport from `createSyncplayRoom`, `quickMatchSyncplayRoom` or `joinSyncplayRoomByCode` (`/browser`), then `await runner.startNetworked(async () => transport)`. Create and quick-match carry `runtimeIdentity`, `sessionConfigBytes` and `sessionConfigDigest`; join-by-code takes only the room code and receives the room-owned bytes, which the joiner verifies before frame 0. The room needs a **fileless** deterministic entry in `rundot/realtime.config.json`:

   ```json
   { "rooms": [{ "type": "deterministic", "deterministic": true, "config": { "maxPlayers": 4, "tickRateHz": 30 } }] }
   ```

   No `GameRoom` subclass, no `rundot/rooms.config.json`, no server bundle — the deterministic authority is built in. That is the whole server-side story for a syncplay room.

File layout that works — the shape of RUN's reference deterministic FPS integration, which is internal and unpublished, so copy the layout, not a dependency:

```
src/sim/game.ts            plain-data state + step + projection
src/sim/runtime.ts         identity + createInstalledRuntimeAdapter
src/sim/input-codec.ts     defineSyncplayInputCodec
src/net/runner.ts          createSyncplayRunner + room create/join
src/render.ts              reads the projection, writes nothing back
rundot/realtime.config.json
```

## 5. Prove it before blaming the network

`@series-inc/rundot-syncplay/testing` exposes exactly nine entry points. These are the ones to reach for, in this order:

| Assertion | What it proves |
|---|---|
| `assertDeterministic` | Straight-line stepping and rollback stepping produce identical checksums. If this fails nothing downstream matters — the simulation is nondeterministic. |
| `assertTwoClientConvergence` | Two real networked clients over a simulated link agree on the confirmed checksum. |
| `assertLateJoinHydration` | A late joiner hydrates from the stored snapshot and converges with the peers already playing. |
| `assertPresentationParity` | The same inputs produce the same confirmed presentation offline and networked. This is the only assertion that catches a projection that is deterministically **wrong yet checksum-consistent** — convergence tests can't see it, because the state agrees and only the projection differs. |
| `createSyncplayRunnerHarness` | Drives a real runner on a fully controlled clock; nothing advances outside `advance()`. Use it for status/lifecycle assertions. |
| `runSyncplaySynctest` | The synctest under `assertDeterministic`, when you want the divergence record instead of a throw. |

Treat any desync report as a determinism bug until `assertDeterministic` passes on that runtime.

## 6. Error to cause

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PACKAGE_PATH_NOT_EXPORTED`, "the package installs but is empty", missing `/core` or `/modules/*` | Wrong version installed — `latest` is behind | Section 2: resolve the tags, install >= 5.26.0, re-run the preflight |
| `SYNCPLAY_INPUT_CODEC_UNSAFE` | Hand-written encoder/decoder that doesn't round-trip; the dev-mode probe rejects it | Derive the codec with `defineSyncplayInputCodec` |
| Checksum mismatch, rollback storms, "fine solo, desyncs in a match" | Nondeterminism in the simulation | Walk the section 3 checklist, then `assertDeterministic` |
| `SYNCPLAY_TRANSPORT_DISCONNECTED`, status `error` | Hard disconnect — terminal by design; the runner deliberately never re-dials an opaque connect factory | Offer an explicit re-join that calls `startNetworked` with a fresh connect factory |
| `SYNCPLAY_RUNNER_NO_RENDER_STATE` | `getRenderState()` called before the first projection | Render from the `subscribe` snapshot's `renderState`, or wait for `ready` |
| `SYNCPLAY_PROJECTION_UNSUPPORTED` | Runtime built without `projectState` | Add `projectState` to the adapter options |

## 7. Which page to read

The SDK docs land in a creator project via `npx rundot-sdk-setup`, under `rundot/docs/` (legacy installs: `.rundot/docs/`). There are two dozen `SYNCPLAY-*` pages — route to one, don't read the set.

| Question | Page |
|---|---|
| What syncplay is, how the pieces fit, the full runner contract | `api/SYNCPLAY.md` — start here |
| Preset vs game-owned adapter vs hand-written ABI; identity, checkpoint codec, projection, commands, deterministic assets end to end | `api/SYNCPLAY-RUNTIME-COMPOSITIONS.md` |
| Room type and config for a deterministic room | `api/MULTIPLAYER.md`, the "One config for deterministic rooms" note only |
| A shipped module the game actually uses | the matching `api/SYNCPLAY-<MODULE>.md` (movement, character-3d, physics, combat, firearm, lag-compensation, animation, actors-ai, pathfinding, stats-abilities, inventory-equipment, components, entity-registry, gameplay-effects, spatial-interaction, unit-control, rts, platformer-2d, bots) |
| Hidden information — decks, bags, roles, fog of war | `api/SYNCPLAY-SECRETS.md` |
| Shared/collaborative editing on a deterministic session | `api/SYNCPLAY-EDITOR.md` |

Don't open a module page for a module the game doesn't use, and don't infer an API from a module page's neighbours.

## Resources

- `references/wiring.md` — minimal end-to-end skeleton (identity → adapter → codec → runner → room → config).
- `rundot-multiplayer` — server-authoritative `GameRoom` rooms; the right skill whenever the server should own state.
- `rundot-sdk` — SDK boot order and error posture. A syncplay room rides `RundotGameAPI.realtime`, so `initializeAsync()` must have completed first.
