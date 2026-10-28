// Build balance: node scripts/run-ts.mjs scripts/balance-test.ts [mapId...]
// Four archetype builds race each other, driven by the bot brain, with the seats rotated so no build always gets the best grid
// spot. Reports wins and progress per build. It flags a build that wins most races or one that cannot keep up (STRICT=1 turns that into a failure).
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { botInput } from '../src/sim/bot.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const maps = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['route1', 'ring-sprint'];
const SECONDS = Number(process.env['SECS'] ?? 200);
const LEVEL = Number(process.env['LEVEL'] ?? 1);

// body 0 Brute 1 Rattler; legs 1 Werewolf 2 Spider; arms 1 Tentacles 2 Claws; head 1 Slime 2 Lantern
const ARCHETYPES = [
  { name: 'Sprinter  (Rattler, Werewolf, Tentacles, Lantern)', sel: { bodySel: 1, legsSel: 1, armsSel: 1, headSel: 2 } },
  { name: 'Bruiser   (Brute, Werewolf, Claws, Slime)', sel: { bodySel: 0, legsSel: 1, armsSel: 2, headSel: 1 } },
  { name: 'Gripper   (Brute, Spider, Tentacles, Lantern)', sel: { bodySel: 0, legsSel: 2, armsSel: 1, headSel: 2 } },
  { name: 'Trickster (Rattler, Spider, Claws, Slime)', sel: { bodySel: 1, legsSel: 2, armsSel: 2, headSel: 1 } },
] as const;

const wins = ARCHETYPES.map(() => 0);
const score = ARCHETYPES.map(() => 0); // average share of the winner's progress
let races = 0;

for (const mapId of maps) {
  const prep = getPreparedMap(mapId);
  const total = prep.checkpoints.length;
  for (let rot = 0; rot < ARCHETYPES.length; rot += 1) {
    // seat -> archetype index, rotated each race
    const seatOf = ARCHETYPES.map((_, a) => (a + rot) % ARCHETYPES.length);
    const archetypeOfSeat = new Array<number>(ARCHETYPES.length);
    seatOf.forEach((seat, a) => { archetypeOfSeat[seat] = a; });
    const config = { game: 'frankenrun', map: mapId, players: 4, seed: 1 + rot, tickRateHz: 30, version: 1, botLevel: LEVEL };
    let state: GameState = createGameState(config, prep);
    const finish = new Map<number, number>();
    for (let f = 0; f < (SECONDS + 10) * 30; f += 1) {
      // The seats are people as far as the sim knows; the bot brain drives them from outside, with its memory kept in the state.
      const brains = new Map<number, ReturnType<typeof botInput>['brain']>();
      const inputs: GameInput[] = state.players.map((p) => {
        const sel = ARCHETYPES[archetypeOfSeat[p.slot]!]!.sel;
        if (state.phase !== 'RACING') return { ...DEFAULT_INPUT, present: true, ready: true, start: p.slot === 0, ...sel };
        const r = botInput(state, prep, p.slot, state.frame);
        brains.set(p.slot, r.brain);
        return { ...r.input, present: true, ...sel };
      });
      state = stepGame(state, inputs, prep);
      state = { ...state, players: state.players.map((p) => ({ ...p, brain: brains.get(p.slot) ?? p.brain })) };
      for (const p of state.players) if (p.finishTick >= 0 && !finish.has(p.slot)) finish.set(p.slot, (p.finishTick - state.raceStart) / 30);
      if (state.phase === 'RESULTS' || (state.phase === 'RACING' && f > SECONDS * 30 + 300)) break;
    }
    const view = projectGame(state, prep).players;
    // Winner: first to finish; otherwise the furthest along (checkpoints, then closeness to the next one).
    const key = (slot: number): number => {
      const t = finish.get(slot);
      if (t !== undefined) return 1e6 - t;
      const v = view[slot]!;
      const cp = prep.checkpoints[v.nextCheckpoint];
      return v.nextCheckpoint * 1000 - (cp ? Math.hypot(cp.x - v.x, cp.z - v.z) : 0);
    };
    const order = [...state.players.keys()].sort((a, b) => key(b) - key(a));
    const winnerSeat = order[0]!;
    wins[archetypeOfSeat[winnerSeat]!] += 1;
    const best = Math.max(1, view[winnerSeat]!.nextCheckpoint);
    state.players.forEach((p) => { score[archetypeOfSeat[p.slot]!] += Math.min(1, view[p.slot]!.nextCheckpoint / best); });
    races += 1;
    const line = order.map((s) => `${ARCHETYPES[archetypeOfSeat[s]!]!.name.split(' ')[0]} ${finish.has(s) ? `${finish.get(s)!.toFixed(0)}s` : `${view[s]!.nextCheckpoint}/${total}`}`).join(', ');
    console.log(`${mapId} race ${rot + 1}: ${line}`);
  }
}

console.log('');
let failures = 0;
ARCHETYPES.forEach((a, i) => {
  const rel = score[i]! / races;
  console.log(`${a.name}: ${wins[i]} win(s) of ${races}, keeps ${(rel * 100).toFixed(0)}% of the leader's progress`);
  if (rel < 0.6) { console.log('FAIL  cannot keep up'); failures += 1; }
  if (wins[i]! / races > 0.6) { console.log('FAIL  wins too much'); failures += 1; }
});
if (failures > 0) {
  console.log(`${failures} balance problem(s) (a report: set STRICT=1 to make this fail the run)`);
  if (process.env['STRICT'] === '1') process.exit(1);
} else {
  console.log('builds are balanced enough');
}
