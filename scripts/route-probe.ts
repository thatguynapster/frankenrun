// Drives the baked route with a pure-pursuit pilot through the full physics to prove it is completable:
//   npm run test:route
// Reports checkpoint times, finish time, and how often the car got stuck (speed near zero while racing).
import { readFileSync } from 'node:fs';
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const mapId = process.env['MAP'] ?? 'route1';
const prep = getPreparedMap(mapId);
const { polyline } = JSON.parse(readFileSync(`bake/cache/${mapId}-corridor.json`, 'utf8')) as { polyline: { x: number; z: number }[] };
const config = { game: 'frankenrun', map: mapId, players: 2, seed: 1, tickRateHz: 30, version: 1 };
const LEGS = Number(process.env['LEGS'] ?? 1); // part ids for the pilot's monster: LEGS, ARMS, HEAD, BODY env vars
const ARMS = Number(process.env['ARMS'] ?? 0);
const HEAD = Number(process.env['HEAD'] ?? 0);
const BODY = Number(process.env['BODY'] ?? 0);

let state: GameState = createGameState(config, prep);
let progress = [0, 0]; // furthest polyline index reached per player
const wedged: number[] = [0, 0];
const turnSign: number[] = [0, 0];
const recovery = [0, 1].map(() => ({ count: 0, pivoting: false, drive: 0, ticks: 0, px: 0, pz: 0 }));

function pilot(slot: number): GameInput {
  if (state.phase === 'BUILD') return { ...DEFAULT_INPUT, ready: true, present: true, start: true, bodySel: BODY, legsSel: LEGS, armsSel: ARMS, headSel: HEAD };
  const v = projectGame(state, prep).players[slot]!;
  // Advance only once the car is actually at the next vertex, so corners are never skipped or cut.
  let best = progress[slot]!;
  while (best + 1 < polyline.length - 1 && Math.hypot(polyline[best + 1]!.x - v.x, polyline[best + 1]!.z - v.z) < 12) best += 1;
  progress[slot] = best;
  const look = Math.max(10, v.speed * 0.9);
  let target = polyline[polyline.length - 1]!;
  let acc = 0;
  for (let i = best; i + 1 < polyline.length; i += 1) {
    acc += Math.hypot(polyline[i + 1]!.x - polyline[i]!.x, polyline[i + 1]!.z - polyline[i]!.z);
    // Never look past a sharp turn: aim at the corner itself so the pilot follows the road instead of cutting it.
    const nxt = polyline[i + 2];
    if (nxt) {
      const h1 = Math.atan2(polyline[i + 1]!.x - polyline[i]!.x, polyline[i + 1]!.z - polyline[i]!.z), h2 = Math.atan2(nxt.x - polyline[i + 1]!.x, nxt.z - polyline[i + 1]!.z);
      let turn = Math.abs(h2 - h1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.7 && acc < look * 2) { target = polyline[i + 1]!; break; }
    }
    if (acc >= look) { target = polyline[i + 1]!; break; }
  }
  // Close to the next checkpoint, aim straight at it so the pilot does not cut the corner outside its radius.
  const cp = prep.checkpoints[state.players[slot]!.nextCheckpoint];
  if (cp && Math.hypot(cp.x - v.x, cp.z - v.z) < 45) target = cp;
  const yaw = 2 * Math.atan2(v.qy, v.qw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = target.x - v.x, dz = target.z - v.z;
  const err = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
  // Slow and facing well away from the target: pivot on the spot in one committed direction until it is roughly
  // ahead, instead of flipping direction as the error crosses +-180 degrees.
  if (v.speed < 3 && Math.abs(err) > 1.5 && turnSign[slot] === 0) turnSign[slot] = err >= 0 ? 1 : -1;
  if (Math.abs(err) < 0.5) turnSign[slot] = 0;
  const steer = turnSign[slot] !== 0 && v.speed < 3 ? 100 * (turnSign[slot] ?? 1) : Math.max(-100, Math.min(100, Math.round(err * 160)));
  // Brake for upcoming corners: compare the heading to a point farther ahead than the steering target.
  let far = polyline[polyline.length - 1]!;
  let accFar = 0;
  for (let i = best; i + 1 < polyline.length; i += 1) {
    accFar += Math.hypot(polyline[i + 1]!.x - polyline[i]!.x, polyline[i + 1]!.z - polyline[i]!.z);
    if (accFar >= 55 + v.speed * 1.5) { far = polyline[i + 1]!; break; }
  }
  const errFar = Math.atan2(fz * (far.z - v.z) * 0 + fz * (far.x - v.x) - fx * (far.z - v.z), fx * (far.x - v.x) + fz * (far.z - v.z));
  const speedKmh = v.speed * 3.6;
  const wanted = Math.abs(errFar) > 1.0 ? 22 : Math.abs(errFar) > 0.6 ? 35 : Math.abs(errFar) > 0.3 ? 55 : 120;
  const cap = Number(process.env['SPEEDCAP'] ?? 999);
  let throttle = Math.abs(err) > 0.7 ? 35 : speedKmh > Math.min(cap, wanted) + 10 ? -60 : speedKmh > Math.min(cap, wanted) ? 0 : 100;
  // Recover when wedged: reverse out with opposite lock for ~1.5 s.
  if (v.speed < 0.4 && state.phase === 'RACING') wedged[slot] = (wedged[slot] ?? 0) + 1; else if (v.speed > 2) wedged[slot] = 0;
  // Monsters cannot reverse. When wedged: stop and pivot to a fresh heading (alternating sides, widening), then drive
  // off that way for ~1.3 s before resuming the route.
  const sel = { ...DEFAULT_INPUT, bodySel: BODY, legsSel: LEGS, armsSel: ARMS, headSel: HEAD };
  const toward = (px: number, pz: number): number => Math.atan2(fz * (px - v.x) - fx * (pz - v.z), fx * (px - v.x) + fz * (pz - v.z));
  const rc = recovery[slot]!;
  if (rc.drive > 0) {
    rc.drive -= 1;
    return { ...sel, throttle: 100, steer: Math.max(-100, Math.min(100, Math.round(toward(rc.px, rc.pz) * 160))) };
  }
  if (rc.pivoting) {
    const e = toward(rc.px, rc.pz);
    if (Math.abs(e) < 0.25 || rc.ticks > 120) { rc.pivoting = false; rc.drive = 40; wedged[slot] = 0; return { ...sel, throttle: 100, steer: Math.round(e * 160) }; }
    rc.ticks += 1;
    return { ...sel, throttle: 0, steer: e >= 0 ? 100 : -100 };
  }
  if ((wedged[slot] ?? 0) > 20) {
    rc.count += 1;
    const offset = (rc.count % 2 === 1 ? 1 : -1) * (0.9 + 0.4 * (rc.count % 3));
    rc.px = v.x + 20 * Math.sin(yaw + offset);
    rc.pz = v.z + 20 * Math.cos(yaw + offset);
    rc.pivoting = true;
    rc.ticks = 0;
  }
  if (process.env['TRACE'] && slot === 0 && state.frame % Number(process.env['TSTEP'] ?? 30) === 0 && state.frame >= Number(process.env['TFROM'] ?? 1100) && state.frame < Number(process.env['TTO'] ?? 1700)) console.log(`t${state.frame} pos ${v.x.toFixed(0)},${v.z.toFixed(0)} yaw ${((yaw * 180) / Math.PI).toFixed(0)} tgt ${target.x.toFixed(0)},${target.z.toFixed(0)} err ${((err * 180) / Math.PI).toFixed(0)} steer ${steer} thr ${throttle} spd ${(v.speed * 3.6).toFixed(0)} prog ${best} onRoad ${prep.onRoad(v.x, v.z)} cp ${state.players[slot]!.nextCheckpoint} cpPos ${JSON.stringify(prep.checkpoints[state.players[slot]!.nextCheckpoint] ?? null)}`);
  return { ...DEFAULT_INPUT, bodySel: BODY, legsSel: LEGS, armsSel: ARMS, headSel: HEAD, throttle, steer };
}

const cpTimes: string[] = [];
let stuck = 0, raceStart = -1, maxMs = 0, sumMs = 0, nTicks = 0;
const allMs: number[] = [];
const slow: { f: number; ms: number }[] = [];
const trace = process.env['MEM'] === '1';
let denseMs = 0, denseN = 0;
let winMs = 0, winN = 0;
const frames = 30 * Number(process.env['SECS'] ?? 300);
for (let f = 0; f < frames; f += 1) {
  const t0 = performance.now();
  state = stepGame(state, [pilot(0), state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true } : DEFAULT_INPUT], prep);
  const ms = performance.now() - t0;
  maxMs = Math.max(maxMs, ms);
  if (f > 5) { sumMs += ms; nTicks += 1; allMs.push(ms); }
  if (ms > 25) slow.push({ f, ms });
  if (f >= 300 && f < 1500) { denseMs += ms; denseN += 1; }
  if (trace && f > 5) {
    winMs += ms; winN += 1;
    if (winN === 90) {
      const w = state.physics;
      const v = projectGame(state, prep).players[0]!;
      console.log(`f${f} t${((f - 90) / 30).toFixed(0)}s cp${state.players[0]!.nextCheckpoint} pos ${v.x.toFixed(0)},${v.z.toFixed(0)} avg ${(winMs / winN).toFixed(1)}ms | bodies ${w.bodies.length} pairs ${w.activePairs.length} contacts ${w.contactCache.length} joints ${w.jointCache.length} cells ${state.activeCells.length} slicks ${state.slicks.length} heapMB ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}`);
      winMs = 0; winN = 0;
    }
  }
  if (state.phase === 'RACING' && raceStart < 0) raceStart = f;
  if (raceStart >= 0) {
    const p = state.players[0]!;
    while (cpTimes.length < p.nextCheckpoint) cpTimes.push(`CP${cpTimes.length + 1}@${((f - raceStart) / 30).toFixed(0)}s`);
    if (projectGame(state, prep).players[0]!.speed < 0.5 && state.phase === 'RACING' && (f - raceStart) % 30 === 0) stuck += 1;
  }
  if (state.phase === 'RESULTS') break;
}
const p0 = state.players[0]!;
console.log(`${mapId} (${LEGS ? 'legs' : 'no legs'}): ${prep.checkpoints.length} checkpoints, phase ${state.phase}, reached ${p0.nextCheckpoint}/${prep.checkpoints.length}`);
console.log(`  ${cpTimes.join(' ')}`);
console.log(p0.finishTick >= 0 ? `  FINISHED in ${((p0.finishTick - 90) / 30).toFixed(1)} s` : `  did NOT finish (stuck-seconds ${stuck})`);
console.log(`  ticks over 25 ms: ${slow.length} of ${state.frame} (first ${slow.slice(0, 6).map((x) => `${x.f}:${x.ms.toFixed(0)}ms`).join(' ')})`);
allMs.sort((a, b) => a - b);
console.log(`  ms/tick avg ${(sumMs / Math.max(1, nTicks)).toFixed(2)} p50 ${allMs[Math.floor(allMs.length * 0.5)]!.toFixed(2)} p95 ${allMs[Math.floor(allMs.length * 0.95)]!.toFixed(2)} p99 ${allMs[Math.floor(allMs.length * 0.99)]!.toFixed(2)}`);
console.log(`  dense stretch (frames 300-1500) avg ${(denseMs / Math.max(1, denseN)).toFixed(2)} ms/tick`);
console.log(`  worst tick ${maxMs.toFixed(0)} ms, active cells ${state.activeCells.length}`);
