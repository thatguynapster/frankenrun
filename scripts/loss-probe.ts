// Part loss and pickups: node scripts/run-ts.mjs scripts/loss-probe.ts
// A: slot 0 rams the idle slot 1 car repeatedly. B: slot 0 drives flat out into the nearest building.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const MAP = process.env['MAP'] ?? 'greybox';
const prep = getPreparedMap(MAP);
const config = { game: 'frankenrun', map: MAP, players: 2, seed: 7, tickRateHz: 30, version: 1 };

function aim(from: { x: number; z: number; qy: number; qw: number }, to: { x: number; z: number }): number {
  const yaw = 2 * Math.atan2(from.qy, from.qw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = to.x - from.x, dz = to.z - from.z;
  const err = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
  return Math.max(-100, Math.min(100, Math.round(err * 160)));
}

function scenario(label: string, bodies: [number, number], ram: boolean, seconds: number, collect = false) {
  console.log(`--- ${label}`);
  let state: GameState = createGameState(config, prep);
  let last = '';
  for (let f = 0; f < 90 + 30 * seconds; f++) {
    const view = state.phase === 'BUILD' ? undefined : projectGame(state, prep);
    const input = (slot: number): GameInput => {
      if (state.phase === 'BUILD') return { ...DEFAULT_INPUT, ready: true, present: true, start: true, bodySel: bodies[slot]!, legsSel: 1, armsSel: 1, headSel: 1 };
      if (!view) return DEFAULT_INPUT;
      const me = view.players[slot]!, other = view.players[1 - slot]!;
      // Both monsters drive off in a straight line for a while (a run-up), then charge each other.
      const charge = ram && f - 90 > 90;
      // After losing a part, go back for the nearest pickup.
      const pk = view.pickups[0];
      if (collect && slot === 1 && pk !== undefined) return { ...DEFAULT_INPUT, throttle: Math.hypot(me.x - pk.x, me.z - pk.z) < 35 ? 35 : 100, steer: aim(me, pk) };
      return { ...DEFAULT_INPUT, throttle: 100, steer: charge ? aim(me, other) : 0 };
    };
    state = stepGame(state, [input(0), input(1)], prep);
    if (state.phase !== 'RACING') continue;
    const v = projectGame(state, prep);
    const sig = v.players.map((p) => `${p.build.legs}${p.build.arms}${p.build.head}`).join('/') + ` pk${v.pickups.length} lost${v.players.map((p) => p.partsLost).join(',')} got${v.players.map((p) => p.partsGained).join(',')}`;
    if (collect && v.pickups[0] && (f - 90) % 30 === 0 && f < 90 + 30 * 14) { const q = v.players[1]!; console.log(`  p1 at ${q.x.toFixed(1)},${q.z.toFixed(1)} ${(q.speed * 3.6).toFixed(0)} km/h, pickup ${v.pickups[0].x.toFixed(1)},${v.pickups[0].z.toFixed(1)} dist ${Math.hypot(q.x - v.pickups[0].x, q.z - v.pickups[0].z).toFixed(1)}`); }
    if (sig !== last) {
      last = sig;
      const p0 = v.players[0]!;
      console.log(`t+${((f - 90) / 30).toFixed(1)}s builds ${sig} | p0 ${(p0.speed * 3.6).toFixed(0)} km/h ${v.pickups.map((k) => `${k.slot}:${k.part}@${k.x.toFixed(0)},${k.z.toFixed(0)}`).join(' ')}`);
    }
  }
}

scenario('A: Brute vs Rattler charge each other', [0, 1], true, 40);
scenario('B: Brute vs Brute charge each other', [0, 0], true, 40);
scenario('C: Brute vs Rattler charge; Rattler goes back for its lost part', [0, 1], true, 40, true);

// D: Crab Claws. The attacker (slot 0, Claws) starts behind an idle victim (slot 1) facing the same way and drives
// into its rear: expect a steal. E: the same but the attacker is in front and faces away (no steal possible).
import { applyDeterministicWorldEdit3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
function claws(label: string, attackerBehind: boolean, armsFull: boolean, emptyAttacker = false) {
  console.log(`--- ${label}`);
  let state: GameState = createGameState(config, prep);
  let placed = false;
  const origin = prep.startPose(0);
  const yaw = prep.startYaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (let f = 0; f < 90 + 30 * 8; f++) {
    const input = (slot: number): GameInput =>
      state.phase === 'BUILD'
        ? { ...DEFAULT_INPUT, ready: true, present: true, start: true, bodySel: 0, legsSel: emptyAttacker && slot === 0 ? 0 : 1, armsSel: slot === 0 ? 2 : armsFull ? 2 : 1, headSel: emptyAttacker && slot === 0 ? 0 : 1 }
        : slot === 0 ? { ...DEFAULT_INPUT, throttle: 100 } : DEFAULT_INPUT;
    state = stepGame(state, [input(0), input(1)], prep);
    if (state.phase === 'RACING' && !placed) {
      placed = true;
      const a = deterministicPhysicsBodyById3D(state.physics, 'car-0')!, v = deterministicPhysicsBodyById3D(state.physics, 'car-1')!;
      const gap = 14;
      const place = (b: typeof a, x: number, z: number, speed: number) => ({ ...b, x, z, vx: fx * speed, vz: fz * speed, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
      const ax = attackerBehind ? origin.x : origin.x + fx * gap, az = attackerBehind ? origin.z : origin.z + fz * gap;
      const vx = attackerBehind ? origin.x + fx * gap : origin.x, vz = attackerBehind ? origin.z + fz * gap : origin.z;
      state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [place(a, ax, az, attackerBehind ? 0.5 : 0), place(v, vx, vz, 0)] }) };
    }
    if (placed && (f - 90) % 15 === 0) {
      const v = projectGame(state, prep);
      console.log(`t+${((f - 90) / 30).toFixed(1)}s builds ${v.players.map((p) => `${p.build.legs}${p.build.arms}${p.build.head}`).join('/')} lost${v.players.map((p) => p.partsLost).join(',')} got${v.players.map((p) => p.partsGained).join(',')} stolen${v.players.map((p) => p.partsStolen).join(',')} pickups ${v.pickups.length}`);
    }
  }
}
claws('D: Claws attacker behind victim (steal; attacker empty slot filled when it has one)', true, false);
claws('E: attacker in front, facing away (no steal)', false, false);
claws('F: attacker with empty legs and head slots steals straight into them when it can', true, false, true);
