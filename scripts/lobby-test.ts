// Lobby, host start, presence and rematch rules: node scripts/run-ts.mjs scripts/lobby-test.ts   (exits 1 on a failure)
import { applyDeterministicWorldEdit3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { MAX_PLAYERS } from '../src/sim/limits.ts';
import { PRESENCE_TIMEOUT_TICKS } from '../src/sim/parts.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const MAP = 'greybox';
const prep = getPreparedMap(MAP);
let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};

/** A test room: `players` slots, the first `bots`-many at the end are bots. Slots that are not in `here` send the neutral input. */
class Room {
  state: GameState;
  here = new Set<number>();
  choices = new Map<number, Partial<GameInput>>();
  constructor(readonly players: number, readonly bots = 0) {
    this.state = createGameState({ game: 'frankenrun', map: MAP, players, bots, seed: 3, tickRateHz: 30, version: 1 }, prep);
  }
  /** Advances one tick. `extra` adds per-slot input for this tick only (start, rematch...). */
  tick(extra: Record<number, Partial<GameInput>> = {}): void {
    const inputs: GameInput[] = [];
    for (let slot = 0; slot < this.players; slot++) {
      if (slot >= this.players - this.bots) inputs.push({ ...DEFAULT_INPUT, present: true, ready: true });
      else if (!this.here.has(slot)) inputs.push(DEFAULT_INPUT);
      else inputs.push({ ...DEFAULT_INPUT, present: true, ...this.choices.get(slot), ...extra[slot] });
    }
    this.state = stepGame(this.state, inputs, prep);
  }
  run(ticks: number, extra: Record<number, Partial<GameInput>> = {}): void {
    for (let i = 0; i < ticks; i++) this.tick(extra);
  }
  join(...slots: number[]): void {
    for (const s of slots) this.here.add(s);
  }
  leave(...slots: number[]): void {
    for (const s of slots) this.here.delete(s);
  }
  ready(...slots: number[]): void {
    for (const s of slots) this.choices.set(s, { ...this.choices.get(s), ready: true });
  }
  /** Runs the countdown to the first racing tick. */
  toRacing(): void {
    this.run(100);
  }
  /** Puts the car on the last checkpoint so it finishes on the next tick. */
  finish(slot: number): void {
    const last = prep.checkpoints.length - 1;
    const cp = prep.checkpoints[last]!;
    const car = deterministicPhysicsBodyById3D(this.state.physics, `car-${slot}`)!;
    this.state = {
      ...this.state,
      physics: applyDeterministicWorldEdit3D(this.state.physics, { replace: [{ ...car, x: cp.x, z: cp.z, vx: 0, vz: 0 }] }),
      players: this.state.players.map((p) => (p.slot === slot ? { ...p, nextCheckpoint: last } : p)),
    };
  }
  hasCar(slot: number): boolean {
    return deterministicPhysicsBodyById3D(this.state.physics, `car-${slot}`) !== undefined;
  }
  get view() {
    return projectGame(this.state, prep);
  }
}

console.log(`--- limits (MAX_PLAYERS = ${MAX_PLAYERS})`);
check('the start grid has room for every slot', Array.from({ length: MAX_PLAYERS }, (_, s) => prep.startPose(s)).every((p, i, all) => all.every((q, j) => i === j || Math.hypot(p.x - q.x, p.z - q.z) > 2.4)));

console.log('--- a partly filled room: only the host can start, and only when everyone else is ready');
{
  const room = new Room(MAX_PLAYERS);
  room.join(0, 1);
  room.run(5);
  check('the creator (slot 0) is the host', room.view.hostSlot === 0 && room.view.players[0]!.host && !room.view.players[1]!.host);
  check('empty slots are not joined', !room.view.players[2]!.joined && room.view.players[1]!.joined);
  room.run(3, { 0: { start: true } });
  check('start is refused while another player is not ready', room.state.phase === 'BUILD');
  room.ready(1);
  room.run(3, { 1: { start: true } });
  check('a non-host cannot start', room.state.phase === 'BUILD');
  room.run(2, { 0: { start: true } });
  check('the host starts once everyone present is ready, without waiting for the empty slots', room.state.phase === 'COUNTDOWN');
  check('cars exist only for the players in the lobby', room.hasCar(0) && room.hasCar(1) && !room.hasCar(2) && !room.hasCar(3));
  check('the race roster is exactly those players', room.state.players.map((p) => p.inRace).join() === [true, true, ...Array(MAX_PLAYERS - 2).fill(false)].join());
  room.toRacing();
  check('race starts', room.state.phase === 'RACING');
  room.finish(0);
  room.tick();
  check('one finisher does not end it', room.state.phase === 'RACING' && room.state.players[0]!.finishTick >= 0);
  room.finish(1);
  room.tick();
  check('it ends when every racer has finished (empty slots never hold it open)', room.state.phase === 'RESULTS');
}

console.log('--- minimum of two players');
{
  const room = new Room(MAX_PLAYERS);
  room.join(0);
  room.run(5, { 0: { start: true } });
  check('a host alone cannot start', room.state.phase === 'BUILD');
  room.join(1);
  room.ready(1);
  room.run(3, { 0: { start: true } });
  check('with a second ready player it can', room.state.phase === 'COUNTDOWN');
}

console.log('--- a player who disappears cannot block the start; the host role passes on');
{
  const room = new Room(MAX_PLAYERS);
  room.join(0, 1, 2);
  room.ready(2);
  room.run(5);
  room.run(3, { 0: { start: true } });
  check('a present player who is not ready blocks the start', room.state.phase === 'BUILD');
  room.leave(1); // slot 1 drops out and never comes back
  room.run(PRESENCE_TIMEOUT_TICKS + 5);
  check('after the timeout they no longer count as joined', !room.view.players[1]!.joined);
  room.run(3, { 0: { start: true } });
  check('the host can start without them', room.state.phase === 'COUNTDOWN' && room.hasCar(0) && room.hasCar(2) && !room.hasCar(1));

  const room2 = new Room(MAX_PLAYERS);
  room2.join(0, 1, 2);
  room2.ready(2);
  room2.run(5);
  room2.leave(0); // the creator leaves for good
  room2.run(PRESENCE_TIMEOUT_TICKS + 5);
  check('the lowest present player becomes host', room2.view.hostSlot === 1);
  room2.ready(2);
  room2.run(3, { 1: { start: true } });
  check('and can start', room2.state.phase === 'COUNTDOWN');
}

console.log('--- after a race: each player returns on their own; the host can start without stragglers');
{
  const room = new Room(MAX_PLAYERS);
  room.join(0, 1);
  room.ready(1);
  room.run(5);
  room.run(2, { 0: { start: true } });
  room.toRacing();
  room.join(2); // a late joiner arrives while the race runs
  room.run(5);
  check('a late joiner is in the room but not in the race', room.view.players[2]!.joined && !room.view.players[2]!.inRace && !room.hasCar(2));
  room.run(3, { 2: { rematch: true } });
  check('they can go to the lobby for the next race right away', room.state.players[2]!.rematch);
  room.finish(0);
  room.tick();
  room.finish(1);
  room.tick();
  check('results', room.state.phase === 'RESULTS' && room.state.players[2]!.rematch);
  room.run(3, { 0: { start: true } });
  check('the host cannot start before they have returned to the lobby themselves', room.state.phase === 'RESULTS');
  room.ready(0);
  room.run(3, { 0: { rematch: true } }); // the host returns; slot 1 is still reading the results; slot 2 is waiting
  check('one player returning does not move anyone else', room.state.phase === 'RESULTS' && !room.state.players[1]!.rematch);
  room.ready(2);
  room.run(3, { 0: { start: true } });
  check('the host starts the next race for those in the lobby, without slot 1', room.state.phase === 'COUNTDOWN');
  check('roster: slots 0 and 2 race; slot 1 does not', room.hasCar(0) && room.hasCar(2) && !room.hasCar(1) && room.state.players[1]!.inRace === false);
  check('the straggler is still in the room', room.view.players[1]!.joined);
  room.run(3, { 1: { rematch: true } });
  check('and can join the lobby for the race after', room.state.players[1]!.rematch);
}

console.log('--- everyone back means a fresh build phase for the room');
{
  const room = new Room(MAX_PLAYERS);
  room.join(0, 1);
  room.ready(1);
  room.run(5);
  room.run(2, { 0: { start: true } });
  room.toRacing();
  room.finish(0);
  room.tick();
  room.finish(1);
  room.tick();
  room.ready(1);
  room.run(2, { 1: { rematch: true } });
  check('one player returning keeps the room on the results', room.state.phase === 'RESULTS');
  room.run(2, { 0: { rematch: true } });
  check('when everyone present is back, the room goes to the build phase', room.state.phase === 'BUILD');
  check('the world is clean and a player who had readied up stays ready', !room.hasCar(0) && room.state.pickups.length === 0 && room.state.players[1]!.ready);
}

console.log('--- practice: one human and an idle bot');
{
  const room = new Room(2, 1);
  room.join(0);
  room.run(5);
  room.run(3, { 0: { start: true } });
  check('the human (host) can start, the bot counts as the second player', room.state.phase === 'COUNTDOWN' && room.hasCar(0) && room.hasCar(1));
  room.toRacing();
  room.finish(0);
  room.tick();
  check('the race ends the moment the human finishes', room.state.phase === 'RESULTS');
  room.run(3, { 0: { rematch: true } });
  check('Rematch goes straight back to the build phase', room.state.phase === 'BUILD');
}

console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
