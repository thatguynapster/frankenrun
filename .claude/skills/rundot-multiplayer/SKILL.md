---
name: rundot-multiplayer
description: >-
  Add server-authoritative real-time multiplayer to a RUN.game title with the
  RUN SDK realtime API — GameRoom server logic, typed message protocols,
  matchmaking/room codes, reconnection, and persistence. Use when building
  multiplayer, co-op, PvP, real-time rooms, lobbies, or turn-based online play,
  or when the user mentions multiplayer, realtime, rooms, matchmaking, or
  playing with friends.
---

# RUN.game Multiplayer (BETA)

Server-authoritative real-time rooms: game logic runs on the server in a `GameRoom` class that owns all state and validates every action; clients connect via `ServerRoom` and exchange typed messages. The server is the single source of truth — clients only *propose* and *observe*.

**Wrong skill for deterministic multiplayer.** If the game needs every client to simulate the *same* fixed-tick match — rollback netcode, lockstep, replays, frame-exact agreement for an action/physics/racing/RTS game — use `rundot-syncplay` instead. This skill is for the server owning state while clients propose.

**When to run this:** only after the single-player (or local) loop is fun and proven. Multiplayer is a large scope multiplier — netcode, matchmaking, disconnects, cheating, empty-lobby problems — and it can't rescue a loop that isn't fun solo. Add it when the game is *genuinely better with other people in it*, not to chase engagement.

## Coaching approach — decide IF, then how

The most valuable thing you can do here is help the creator decide whether multiplayer is even the right move — it's the most over-reached feature in indie games. Ask hard questions first, then design. Don't start wiring rooms until "why multiplayer?" has a real answer.

Ask as you go (a couple at a time):

- What does another *real* player add that a bot or leaderboard couldn't? Be specific.
- If only one person is online, is your game still playable? (The empty-lobby problem kills most MP games.)
- Real-time or turn-based/async? Async is far cheaper to build and forgiving of bad connections.
- How many players per session, and what happens when someone rage-quits or disconnects mid-game?
- Could a player cheat to ruin it for others — and are you ready to make the server the authority so they can't?
- What's the *smallest* slice of multiplayer that proves the fun — can you ship that first?

Teach the why, and name the blind spots first-timers miss: **the empty lobby** (no players online = dead game — plan for bots, async, or a single shared room); **cheating** (never trust the client — validate every move server-side, which this API is built around); **disconnects are normal, not exceptional** (design for reconnection and skipped turns from day one); and **scope** (multiplayer easily doubles a project — start with the minimum viable slice). If the honest answer to "why multiplayer?" is thin, the best advice is often *don't* — a great single-player loop beats a broken multiplayer one.

## Study comparable titles

Look at 2–3 successful multiplayer games with a similar loop and note: real-time vs. async, players per match, how they handle matchmaking and empty lobbies (bots? shared rooms? invite-a-friend?), and how they deal with quitters. Match on loop and session shape. Summarize back to the creator, then design the smallest slice that captures what works.

## Architecture in one picture

```
Client (ServerRoom)                        Server (your GameRoom subclass)
  joinOrCreateRoom('tictactoe')  ──────▶   onCreate()      initialize state
  room.send({ type:'move', ... }) ─────▶   onGameMessage() VALIDATE, mutate, broadcast
  room.on({ onMessage })         ◀──────   this.broadcast({ type:'boardUpdate', ... })
                                            onPlayerJoin / onPlayerLeave / onDispose
```

- **Server owns state.** Clients send intents; the room validates and decides. Reject an illegal move by simply not applying it (optionally `sendTo` the sender an error).
- **Messages are a typed discriminated union** (`{ type: string }` members) covering both directions. Switch on `message.payload.type` server-side.
- **Never name a payload field `type`** — the wire protocol overwrites it with the message type. Use `kind`/`category` instead.

## Setup

1. **Vite plugin** — add `rundotMultiplayerPlugin()` to `vite.config.ts` (builds server room code, runs a local dev server).
2. **Room-type config** — `rundot/realtime.config.json` maps room types to their `GameRoom` source files (paths relative to project root). Commit `rundot/`.

```json
{
  "rooms": [
    {
      "type": "tictactoe",
      "file": "src/rooms/TicTacToe.ts",
      "config": { "maxPlayers": 2, "allowReconnect": true, "reconnectTimeout": 30 }
    }
  ]
}
```

Key `config` fields: `maxPlayers`, `idleTimeout` (empty-room disposal, default 300s), `reconnectTimeout` (per-player slot hold, default 30s), `autoPersist` (default true), `startLocked`, `singleton` (one shared room, no matchmaking — handy for a single global lobby).

## Server: a minimal GameRoom

See `rooms/ExampleRoom.ts` for a copy-paste skeleton. The shape:

```typescript
import { GameRoom, type GameMessage, type Player, type LeaveReason } from '@series-inc/rundot-game-sdk/mp-server';

interface Move { type: 'move'; cell: number }
interface State { type: 'state'; board: string[]; turn: string }
type P = Move | State;

export default class ExampleRoom extends GameRoom<P> {
  private board = Array(9).fill('');
  private turn = '';

  onCreate() { this.log.info('room created', { roomId: this.roomId }); }

  onPlayerJoin(player: Player) {
    if (this.turn === '') this.turn = player.id;
    this.sendTo(player.id, { type: 'state', board: this.board, turn: this.turn }); // initial state
    if (this.playerCount >= this.config.maxPlayers) this.lock();
  }

  onGameMessage(message: GameMessage<P>) {
    if (message.payload.type !== 'move') return;
    const { sender, payload } = message;
    // SERVER AUTHORITY: validate before applying
    if (sender.id !== this.turn || this.board[payload.cell] !== '') return;
    // Preserve the player's stable id; usernames are display-only and not unique.
    this.board[payload.cell] = sender.id;
    this.turn = this.nextPlayer(sender.id);
    this.broadcast({ type: 'state', board: this.board, turn: this.turn });
  }

  onPlayerLeave(_p: Player, _r: LeaveReason) { /* handle quitters: end, pause, or hand off turn */ }

  protected getPersistState() { return { board: this.board, turn: this.turn }; }
  onRestore(s: Record<string, unknown>) {
    this.board = (s.board as string[]) ?? Array(9).fill('');
    this.turn = (s.turn as string) ?? '';
  }

  private nextPlayer(id: string): string {
    const ids = [...this.players.keys()];
    return ids[(ids.indexOf(id) + 1) % ids.length] ?? id;
  }
}
```

Room tools available on `this`: `broadcast`, `sendTo`, `players`/`playerCount`, `lock`/`unlock`/`kick`/`reject`, `clock` (named timers with crash recovery), `log`, `save`/`getPersistState`, and `services` (server-side broker for notifications, leaderboard, UGC, game config, simulation — each `await`ed and wrapped in try/catch on `ServiceError`).

## Client: connect and play

```typescript
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

const room = await RundotGameAPI.realtime.joinOrCreateRoom<P>('tictactoe');   // matchmaking
// or: joinRoomByCode<P>('HX9KWR')  /  createRoom<P>('tictactoe')

room.on({
  onMessage(msg) { if (msg.type === 'state') renderBoard(msg.board, msg.turn); },
  onPlayerJoined(p) { showJoin(p.username); },
  onPlayerLeft(id) { removePlayer(id); },
  onReconnecting() { showSpinner(); },
  onReconnected() { hideSpinner(); },
  onDisconnect() { showGameOver('Connection lost'); },
  onError(err) { showError(err); },  // err is a plain string
});

room.send({ type: 'move', cell: 4 });   // arrives server-side in onGameMessage
room.leave();
```

- Share `room.roomCode` (6 chars) to let friends join a private match.
- Reconnection is automatic with backoff; drive UI from `onReconnecting`/`onReconnected`/`onDisconnect` and `room.connectionState`.
- `room.getServerTime()` for synchronized countdowns.

## Design principles

- **Validate everything server-side.** Treat every client message as hostile. The room decides; the client only proposes.
- **Design for disconnects.** A player *will* drop mid-game — check `player.connected`, skip disconnected turns, and use `reconnectTimeout` to hold slots. Don't stall the whole room on one player.
- **Persist critical state.** Override `getPersistState()` and `this.save()` after key moments (round start/end) so a crash recovers cleanly via `onRestore`.
- **Solve the empty lobby up front.** Bots, async play, `singleton` shared rooms, or invite-a-friend flows — decide before launch, not after players find a dead game.
- **Use the room clock, not raw timers.** `this.clock.setInterval/setTimeout` auto-clean and survive crash recovery; raw `setInterval` doesn't.

## Checklist

```
- [ ] "Why multiplayer?" has a specific, real answer; single-player loop is already fun
- [ ] Real-time vs. async chosen deliberately (async is cheaper/forgiving)
- [ ] Server validates every action — no trust in client messages
- [ ] Disconnect/reconnect handled; disconnected turns skipped, slots held
- [ ] Empty-lobby plan exists (bots / async / singleton / invites)
- [ ] Critical state persisted via getPersistState + onRestore
- [ ] Timers use this.clock; services calls wrapped in try/catch
- [ ] Shipped as the smallest slice that proves the fun
```

## Anti-patterns

- ❌ Adding multiplayer before the solo loop is fun, or to chase engagement.
- ❌ Trusting the client — applying moves without server validation invites cheating.
- ❌ Treating disconnects as edge cases instead of the norm.
- ❌ No empty-lobby plan — players find a dead game and never return.
- ❌ Naming a payload field `type` (it gets overwritten by the message type).
- ❌ Raw `setInterval`/`setTimeout` in a room instead of `this.clock` (no cleanup / no crash recovery).
- ❌ Building the whole mode at once instead of the minimum viable slice.

## Resources

- `rundot-retention` — social/multiplayer as a retention driver *after* solo fun.
- `rundot-syncplay` — deterministic/rollback multiplayer, when every client must simulate the same match instead of asking a server.
- `rundot-analytics` — instrument match starts, completions, disconnects.
- SDK: `RundotGameAPI.realtime` (`joinOrCreateRoom`, `joinRoomByCode`, `createRoom`, `getUserRooms`) client-side; `GameRoom` from `@series-inc/rundot-game-sdk/mp-server` server-side; config in `rundot/realtime.config.json`; `rundotMultiplayerPlugin()` in `vite.config.ts`.
