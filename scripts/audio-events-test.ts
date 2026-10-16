// When does each sound play? Checks the event detector against synthetic game frames.
//   npm run test:audio          (exits 1 on a failed check)
import { AudioEvents, type SoundEvent } from '../src/audio/events.ts';
import { distanceGain } from '../src/audio/spatial.ts';
import { SOUNDS, MUSIC, soundFile } from '../src/audio/manifest.ts';
import type { GameProjection, PlayerView } from '../src/sim/game.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const monster = (slot: number, over: Partial<PlayerView> = {}): PlayerView =>
  ({
    slot, build: { body: 0, legs: 1, arms: 1, head: 1 }, ready: true, present: true, joined: true, inRace: true, host: slot === 0, bot: false,
    x: slot * 10, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, nextCheckpoint: 0, finishTick: -1, armsCooldown: 0, headCooldown: 0,
    swingPole: -1, trailing: false, partsLost: 0, partsGained: 0, partsStolen: 0, lastLossTick: -1000, rematch: false, ...over,
  }) as PlayerView;
const frame = (n: number, phase: GameProjection['phase'], phaseTicks: number, players: PlayerView[]): GameProjection =>
  ({ frame: n, phase, phaseTicks, raceStart: 0, hostSlot: 0, players, slicks: [], pickups: [], finishOrder: [], activeCells: [] }) as unknown as GameProjection;
const ids = (events: SoundEvent[]): string => events.map((e) => `${e.id}@${e.slot}`).join(',');

// A fixed random source keeps the growl timing predictable.
const make = (): AudioEvents => new AudioEvents(() => 0.5);

console.log('--- race flow');
{
  const a = make();
  const heard: SoundEvent[] = [];
  for (const [n, ticks] of [[1, 0], [2, 10], [3, 31], [4, 61], [5, 80]] as const) heard.push(...a.update(frame(n, 'COUNTDOWN', ticks, [monster(0), monster(1)]), 0, n * 33));
  const beats = heard.filter((e) => e.id === 'count');
  check('three countdown beats, each a little higher', beats.length === 3 && beats[0]!.rate! < beats[1]!.rate! && beats[1]!.rate! < beats[2]!.rate!, beats.map((b) => b.rate?.toFixed(2)).join(' '));
  check('GO roar when the race starts', ids(a.update(frame(6, 'RACING', 0, [monster(0), monster(1)]), 0, 300)).includes('go@0'));
  const r = make();
  r.update(frame(1, 'RACING', 5, [monster(0)]), 0, 0);
  check('results sting when the race ends', ids(r.update(frame(2, 'RESULTS', 0, [monster(0)]), 0, 33)).includes('results@0'));
}

console.log('--- parts and abilities');
{
  const a = make();
  a.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  check('a lost part is heard at the monster that lost it', ids(a.update(frame(2, 'RACING', 6, [monster(0), monster(1, { partsLost: 1 })]), 0, 33)) === 'partLoss@1');
  const b = make();
  b.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  check('picking up a part', ids(b.update(frame(2, 'RACING', 6, [monster(0, { partsGained: 1 }), monster(1)]), 0, 33)) === 'pickup@0');
  const c = make();
  c.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  check('a steal is a claw snap, not also a pickup', ids(c.update(frame(2, 'RACING', 6, [monster(0, { partsGained: 1, partsStolen: 1 }), monster(1, { partsLost: 1 })]), 0, 33)) === 'steal@0,partLoss@1');
  const d = make();
  d.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  check("another monster's tentacle swing is heard once", ids(d.update(frame(2, 'RACING', 6, [monster(0), monster(1, { swingPole: 3 })]), 0, 33)) === 'tentacle@1' && ids(d.update(frame(3, 'RACING', 7, [monster(0), monster(1, { swingPole: 3 })]), 0, 66)) === '');
  const e = make();
  e.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  check("another monster's slime trail is heard once", ids(e.update(frame(2, 'RACING', 6, [monster(0), monster(1, { trailing: true })]), 0, 33)) === 'slime@1');
  const own = make();
  own.update(frame(1, 'RACING', 5, [monster(0)]), 0, 0);
  check('your own tentacle and slime come from the button press, not from the state (no double sound)', ids(own.update(frame(2, 'RACING', 6, [monster(0, { swingPole: 3, trailing: true })]), 0, 33)) === '');
  const reset = make();
  reset.update(frame(1, 'RACING', 5, [monster(0, { x: 100, z: 200 })]), 0, 0);
  check('a reset (teleport back to a checkpoint) plays the poof', ids(reset.update(frame(2, 'RACING', 6, [monster(0, { x: 20, z: 60 })]), 0, 33)) === 'respawn@0');
  const fast = make();
  fast.update(frame(1, 'RACING', 5, [monster(0, { x: 0, z: 0, speed: 24 })]), 0, 0);
  check('driving at full speed is not mistaken for a reset', !ids(fast.update(frame(2, 'RACING', 6, [monster(0, { x: 0.8, z: 0, speed: 24 })]), 0, 33)).includes('respawn'));
  const f = make();
  f.update(frame(1, 'RACING', 5, [monster(0), monster(1)]), 0, 0);
  const fin = f.update(frame(2, 'RACING', 6, [monster(0), monster(1, { finishTick: 100 })]), 0, 33).find((x) => x.id === 'finish');
  check('another monster finishing is heard, quieter than your own', fin !== undefined && fin.slot === 1 && (fin.gain ?? 1) < 1);
}

console.log('--- footsteps and crashes');
{
  const a = make();
  let x = 0;
  const steps: number[] = [];
  a.update(frame(1, 'RACING', 5, [monster(0, { x, speed: 15 })]), 0, 0);
  for (let i = 2; i < 200; i += 1) {
    x += 0.5; // 15 m/s at 30 ticks per second
    const events = a.update(frame(i, 'RACING', 5 + i, [monster(0, { x, speed: 15 })]), 0, i * 33);
    if (events.some((e) => e.id === 'step')) steps.push(i);
  }
  const gaps = steps.slice(1).map((s, i) => s - steps[i]!);
  check('a running monster stomps about every stride', steps.length > 20 && gaps.every((g) => g >= 5 && g <= 12), `${steps.length} steps, gaps ${Math.min(...gaps)}-${Math.max(...gaps)} frames`);
  const b = make();
  let stepped = 0;
  for (let i = 1; i < 100; i += 1) stepped += b.update(frame(i, 'RACING', 5 + i, [monster(0, { x: 0, speed: 0 })]), 0, i * 33).filter((e) => e.id === 'step').length;
  check('a standing monster makes no footsteps', stepped === 0);
  const c = make();
  for (let i = 1; i < 6; i += 1) c.update(frame(i, 'RACING', 5 + i, [monster(0, { speed: 20 })]), 0, i * 33);
  const crash = c.update(frame(6, 'RACING', 12, [monster(0, { speed: 4 })]), 0, 200);
  check('a sudden speed loss is an impact', ids(crash).includes('impact@0'));
  check('and only once (cooldown)', !ids(c.update(frame(7, 'RACING', 13, [monster(0, { speed: 1 })]), 0, 233)).includes('impact'));
}

console.log('--- rewinds and jumps stay quiet');
{
  const a = make();
  a.update(frame(100, 'RACING', 50, [monster(0), monster(1)]), 0, 0);
  const quiet = a.update(frame(60, 'RACING', 10, [monster(0), monster(1, { partsLost: 3 })]), 0, 33);
  check('after the game clock jumps back, old events are not replayed', !ids(quiet).includes('partLoss'));
  const b = make();
  b.update(frame(10, 'RACING', 5, [monster(0)]), 0, 0);
  check('a jump forward (late join) re-baselines silently', !ids(b.update(frame(500, 'RACING', 400, [monster(0, { partsLost: 2, swingPole: 1, trailing: true })]), 0, 33)).match(/partLoss|tentacle|slime/));
}

console.log('--- distance and files');
check('full volume close by, silent far away', distanceGain(3) === 1 && distanceGain(100) === 0 && distanceGain(30) > 0 && distanceGain(30) < 1);
check('quieter the farther away', distanceGain(20) > distanceGain(40));
const files = new Set<string>();
for (const s of SOUNDS) for (let v = 0; v < s.variants; v += 1) files.add(soundFile(s.id, v, s.variants));
for (const m of MUSIC) files.add(soundFile(m.id));
check('every sound has a unique file name', files.size === SOUNDS.reduce((n, s) => n + s.variants, 0) + MUSIC.length, `${files.size} files`);
check('no vehicle sounds in the list', ![...SOUNDS, ...MUSIC].some((s) => /engine|motor|tyre|tire|horn|skid|car /i.test(s.prompt) || /engine|motor|tyre|tire|horn|skid/i.test(s.id)));

console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
