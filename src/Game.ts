import type { SyncplayRunnerSnapshot } from '@series-inc/rundot-syncplay/browser';
import { Controls } from './input/Controls.js';
import { ensureMap } from './net/mapLoader.js';
import { createRunner, hostRace, joinRace, quickMatch, startPractice, type FrankenRunner } from './net/runner.js';
import { RaceView } from './render/RaceView.js';
import { DEFAULT_INPUT, type Build, type GameProjection } from './sim/game.js';
import type { MapData } from './sim/mapdata.js';
import { DEFAULT_MAP } from './sim/runtime.js';

export type Screen = 'title' | 'connecting' | 'play' | 'error';

export interface UiState {
  readonly screen: Screen;
  readonly status: string;
  readonly roomCode: string;
  readonly localSlot: number;
  readonly frame: GameProjection | undefined;
  readonly build: Build;
  readonly ready: boolean;
  readonly error: string;
  readonly rollbackCount: number;
  readonly connection: string;
  readonly occupied: number;
  readonly maxPlayers: number;
  readonly rttMs: number;
  /** Number of checkpoints on the current map. */
  readonly checkpointTotal: number;
  /** Direction to the next checkpoint relative to the car's heading (degrees, + = to the left) and distance in metres. */
  readonly hint: { readonly angle: number; readonly distance: number } | null;
}

type Listener = (state: UiState) => void;

/** Turns transport/matchmaking errors into something a player can act on. */
function friendlyError(message: string): string {
  if (/duplicate session/i.test(message)) return 'You are still seated in a previous room. Wait a few seconds and try again.';
  if (/rate limit/i.test(message)) return 'The server is busy. Please try again in a moment.';
  return message || 'Connection problem';
}

/** Owns the runner, renderer and input. React only subscribes to UiState and calls the methods below. */
export class Game {
  readonly controls = new Controls();
  private runner: FrankenRunner = createRunner();
  private view: RaceView;
  private listeners = new Set<Listener>();
  private snapshot: SyncplayRunnerSnapshot<GameProjection> | undefined;
  private screen: Screen = 'title';
  private error = '';
  private map: MapData | undefined;
  private build: Build = { legs: true, arms: true, head: true };
  private ready = false;
  private lastNow = 0;
  private lastEmit = 0;
  private raf = 0;
  private unsubscribe: () => void;

  constructor(container: HTMLElement) {
    this.view = new RaceView(container);
    this.unsubscribe = this.runner.subscribe((snap) => {
      this.snapshot = snap;
      if (snap.status === 'error') {
        this.screen = 'error';
        this.error = friendlyError(snap.error?.message ?? '');
      }
    });
    this.raf = requestAnimationFrame(this.frame);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  private hint(frame: GameProjection | undefined, slot: number): UiState['hint'] {
    const me = frame?.players[slot];
    if (!frame || !me || !this.map || frame.phase !== 'RACING') return null;
    const cp = this.map.checkpoints[me.nextCheckpoint];
    if (!cp) return null;
    // Forward vector of the car from its orientation (+z forward, +x is the car's left).
    const fx = 2 * (me.qx * me.qz + me.qw * me.qy), fz = 1 - 2 * (me.qx * me.qx + me.qy * me.qy);
    const dx = cp.x / 10 - me.x, dz = cp.z / 10 - me.z;
    const angle = (Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz) * 180) / Math.PI;
    return { angle, distance: Math.hypot(dx, dz) };
  }

  state(): UiState {
    const snap = this.snapshot;
    const frame = snap?.interpolatedRenderState ?? snap?.renderState;
    return {
      screen: this.screen,
      status: snap?.status ?? 'offline',
      roomCode: snap?.roomCode ?? '',
      localSlot: snap?.localSlot ?? 0,
      frame: snap?.interpolatedRenderState ?? snap?.renderState,
      build: this.build,
      ready: this.ready,
      error: this.error,
      rollbackCount: snap?.rollbackCount ?? 0,
      connection: snap?.connection ?? 'connected',
      occupied: snap?.occupancy?.occupied ?? 0,
      maxPlayers: snap?.occupancy?.maxPlayers ?? 0,
      rttMs: Math.round((snap?.netStats as { rttMs?: number } | null | undefined)?.rttMs ?? 0),
      checkpointTotal: this.map?.checkpoints.length ?? 0,
      hint: this.hint(frame, snap?.localSlot ?? 0),
    };
  }

  private emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  private frame = (now: number): void => {
    const dt = this.lastNow === 0 ? 16 : Math.min(100, now - this.lastNow);
    this.lastNow = now;
    if (this.screen === 'play') {
      const base = { ...DEFAULT_INPUT, legsSel: this.build.legs, armsSel: this.build.arms, headSel: this.build.head, ready: this.ready };
      this.runner.applyInput(this.controls.read(base));
      this.runner.update(dt);
    }
    const frame = this.snapshot?.interpolatedRenderState ?? this.snapshot?.renderState;
    this.view.render(frame, this.snapshot?.localSlot ?? 0, dt / 1000);
    // React gets ~15 updates/s; the 3D view runs every frame.
    if (now - this.lastEmit > 66) {
      this.lastEmit = now;
      this.emit();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private async enter(start: () => Promise<void>): Promise<void> {
    this.screen = 'connecting';
    this.error = '';
    this.ready = false;
    this.emit();
    try {
      // The map must be loaded and digest-verified before any session starts: it is a deterministic input.
      this.map = await ensureMap(DEFAULT_MAP);
      this.view.setMap(this.map);
      await start();
      this.screen = 'play';
    } catch (e) {
      this.screen = 'error';
      this.error = friendlyError(e instanceof Error ? e.message : String(e));
    }
    this.emit();
  }

  practice(): Promise<void> {
    return this.enter(() => startPractice(this.runner));
  }
  quick(): Promise<void> {
    return this.enter(() => quickMatch(this.runner));
  }
  host(): Promise<void> {
    return this.enter(async () => {
      await hostRace(this.runner);
    });
  }
  join(code: string): Promise<void> {
    return this.enter(() => joinRace(this.runner, code.trim().toUpperCase()));
  }
  leave(): void {
    this.runner.stop();
    this.snapshot = undefined;
    this.screen = 'title';
    this.ready = false;
    this.emit();
  }

  setBuild(build: Build): void {
    this.build = build;
    this.emit();
  }
  setReady(ready: boolean): void {
    this.ready = ready;
    this.emit();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.runner.dispose();
    this.view.dispose();
  }
}
