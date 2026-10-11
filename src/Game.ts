import type { SyncplayRunnerSnapshot } from '@series-inc/rundot-syncplay/browser';
import { Controls } from './input/Controls.js';
import { createRunner, hostRace, joinRace, startPractice, type FrankenRunner } from './net/runner.js';
import { RaceView } from './render/RaceView.js';
import { DEFAULT_INPUT, type Build, type GameProjection } from './sim/game.js';

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
}

type Listener = (state: UiState) => void;

/** Owns the runner, renderer and input. React only subscribes to UiState and calls the methods below. */
export class Game {
  readonly controls = new Controls();
  private runner: FrankenRunner = createRunner();
  private view: RaceView;
  private listeners = new Set<Listener>();
  private snapshot: SyncplayRunnerSnapshot<GameProjection> | undefined;
  private screen: Screen = 'title';
  private error = '';
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
        this.error = snap.error?.message ?? 'Connection problem';
      }
    });
    this.raf = requestAnimationFrame(this.frame);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  state(): UiState {
    const snap = this.snapshot;
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
      await start();
      this.screen = 'play';
    } catch (e) {
      this.screen = 'error';
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  practice(): Promise<void> {
    return this.enter(() => startPractice(this.runner));
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
