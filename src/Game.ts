import type { SyncplayRunnerSnapshot } from '@series-inc/rundot-syncplay/browser';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { Controls } from './input/Controls.js';
import { ensureMap } from './net/mapLoader.js';
import { createRunner, hostRace, joinRace, quickMatch, startPractice, type FrankenRunner } from './net/runner.js';
import { RaceView } from './render/RaceView.js';
import { DEFAULT_INPUT, type Build, type GameProjection } from './sim/game.js';
import type { MapData } from './sim/mapdata.js';
import { DEFAULT_MAP } from './sim/runtime.js';

export type Screen = 'title' | 'connecting' | 'play' | 'error';

/** Graphics setting: Auto adapts the render resolution to the device; the others pin it. */
export type Graphics = 'auto' | 'high' | 'medium' | 'low';
const GRAPHICS_ORDER: readonly Graphics[] = ['auto', 'high', 'medium', 'low'];
const GRAPHICS_STORAGE_KEY = 'frankenrun.graphics';
/** Fixed quality steps for the pinned settings (indices into RaceView.PIXEL_RATIOS). */
const PINNED_LEVEL: Record<Exclude<Graphics, 'auto'>, number> = { high: 0, medium: 2, low: 3 };

export interface UiState {
  readonly screen: Screen;
  readonly status: string;
  readonly roomCode: string;
  readonly localSlot: number;
  readonly frame: GameProjection | undefined;
  readonly build: Build;
  readonly ready: boolean;
  readonly error: string;
  /** The unmodified error text, for diagnostics. */
  readonly errorDetail: string;
  /** True when the connection dropped in a room we can rejoin. */
  readonly canRejoin: boolean;
  readonly rollbackCount: number;
  readonly connection: string;
  readonly occupied: number;
  readonly maxPlayers: number;
  readonly rttMs: number;
  readonly fps: number;
  readonly simMs: number;
  /** One-line diagnostics for the on-screen readout. */
  readonly diag: string;
  readonly graphics: Graphics;
  /** Number of checkpoints on the current map. */
  readonly checkpointTotal: number;
  /** Direction to the next checkpoint relative to the car's heading (degrees, + = to the left) and distance in metres. */
  readonly hint: { readonly angle: number; readonly distance: number } | null;
}

type Listener = (state: UiState) => void;

/** How long a connect or a room sync may take before we give up and let the player retry. */
const CONNECT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error('Timed out connecting to the room'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Turns transport/matchmaking errors into something a player can act on. */
function friendlyError(message: string): string {
  if (/duplicate session/i.test(message)) return 'You are still seated in a previous room. Wait a few seconds and try again.';
  if (/rate limit/i.test(message)) return 'The server is busy. Please try again in a moment.';
  if (/timed out/i.test(message)) return 'Could not reach the room in time. Check your connection and try again.';
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
  private errorDetail = '';
  private lastRoom = '';
  private map: MapData | undefined;
  private build: Build = { legs: true, arms: true, head: true };
  private ready = false;
  private lastNow = 0;
  private lastEmit = 0;
  private raf = 0;
  /** Rolling per-second performance numbers; read by the HUD debug line and dev tools. */
  perf = { fps: 0, updateMs: 0, renderMs: 0, maxUpdateMs: 0, maxFrameMs: 0, triangles: 0, calls: 0, rollbacksPerSec: 0, ticksPerSec: 0 };
  private perfMaxFrame = 0;
  private perfTicks = 0;
  private goodSeconds = 0;
  private qualityCooldown = 0;
  private gpuText = '';
  private graphics: Graphics = 'auto';
  /** In Auto, the sharpest step the GPU has proven it can hold; raised again only after a long steady spell. */
  private ceiling = 0;
  private ceilingAge = 0;
  private perfFrames = 0;
  private perfUpdate = 0;
  private perfRender = 0;
  private perfMaxUpdate = 0;
  private perfSince = 0;
  private syncingSince = 0;
  private perfRollbacks = 0;
  private unsubscribe: () => void;

  constructor(container: HTMLElement) {
    this.view = new RaceView(container);
    this.unsubscribe = this.runner.subscribe((snap) => {
      this.snapshot = snap;
      if (snap.roomCode) this.lastRoom = snap.roomCode;
      if (snap.status === 'error') {
        this.screen = 'error';
        this.errorDetail = snap.error?.message ?? '';
        this.error = friendlyError(this.errorDetail);
      }
    });
    this.raf = requestAnimationFrame(this.frame);
    void this.loadGraphics();
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

  private diag(): string {
    const p = this.perf;
    if (!this.gpuText) {
      const g = this.view.gpuInfo();
      this.gpuText = g.gpu.replace(/ANGLE \(|\)/g, '').slice(0, 42);
    }
    const g = this.view.gpuInfo();
    return `${p.fps} fps · frame max ${Math.round(p.maxFrameMs)} ms · sim ${p.updateMs.toFixed(1)} ms (max ${Math.round(p.maxUpdateMs)}) · render ${this.perfRenderAvg().toFixed(1)} ms · ${p.ticksPerSec} ticks/s · rb ${p.rollbacksPerSec}/s · q${this.view.qualityLevel} ${g.width}x${g.height} · ${p.triangles} tris · ${this.gpuText}`;
  }

  private perfRenderAvg(): number {
    return this.perf.renderMs;
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
      errorDetail: this.errorDetail,
      canRejoin: this.lastRoom !== '',
      rollbackCount: snap?.rollbackCount ?? 0,
      connection: snap?.connection ?? 'connected',
      occupied: snap?.occupancy?.occupied ?? 0,
      maxPlayers: snap?.occupancy?.maxPlayers ?? 0,
      rttMs: Math.round((snap?.netStats as { rttMs?: number } | null | undefined)?.rttMs ?? 0),
      fps: this.perf.fps,
      simMs: this.perf.updateMs,
      diag: this.diag(),
      graphics: this.graphics,
      checkpointTotal: this.map?.checkpoints.length ?? 0,
      hint: this.hint(frame, snap?.localSlot ?? 0),
    };
  }

  private emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  /**
   * Render-resolution governor (Auto only). The sim runs on its own clock, so a slow GPU only costs pixels.
   * It lowers the resolution only when the frame rate is poor AND the main thread is mostly idle (so the GPU or
   * compositor is the bottleneck: if JS were the bottleneck, fewer pixels would not help). It never goes below
   * a decent floor, remembers the step that failed as a ceiling, and steps back up after a steady spell.
   */
  private adaptQuality(): void {
    if (this.screen !== 'play' || this.graphics !== 'auto') return;
    if (this.qualityCooldown > 0) {
      this.qualityCooldown -= 1;
      return;
    }
    const AUTO_FLOOR = 3; // never below 0.75x device pixels
    const frameMs = this.perf.fps > 0 ? 1000 / this.perf.fps : 1000;
    const jsMs = this.perf.updateMs + this.perf.renderMs;
    const gpuBound = this.perf.fps < 40 && jsMs < frameMs * 0.55;
    this.ceilingAge += 1;
    if (this.ceilingAge >= 45 && this.ceiling > 0) {
      this.ceiling -= 1; // it has been a while: let Auto try a sharper step again
      this.ceilingAge = 0;
    }
    if (gpuBound && this.view.qualityLevel < AUTO_FLOOR) {
      this.ceiling = Math.max(this.ceiling, this.view.qualityLevel + 1);
      this.ceilingAge = 0;
      this.view.setQualityLevel(this.view.qualityLevel + 1);
      this.qualityCooldown = 2;
      this.goodSeconds = 0;
    } else if (this.perf.fps >= 55) {
      this.goodSeconds += 1;
      if (this.goodSeconds >= 5 && this.view.qualityLevel > this.ceiling) {
        this.view.setQualityLevel(this.view.qualityLevel - 1);
        this.goodSeconds = 0;
        this.qualityCooldown = 3;
      }
    } else {
      this.goodSeconds = 0;
    }
  }

  /** Applies the Graphics setting to the renderer. */
  private applyGraphics(): void {
    if (this.graphics === 'auto') {
      this.ceiling = 0;
      this.ceilingAge = 0;
      this.goodSeconds = 0;
      this.view.setQualityLevel(this.view.minQualityLevel === 0 ? 1 : this.view.minQualityLevel);
    } else {
      this.view.setQualityLevel(PINNED_LEVEL[this.graphics]);
    }
  }

  cycleGraphics(): void {
    this.graphics = GRAPHICS_ORDER[(GRAPHICS_ORDER.indexOf(this.graphics) + 1) % GRAPHICS_ORDER.length]!;
    this.applyGraphics();
    this.saveGraphics();
    this.emit();
  }

  private async loadGraphics(): Promise<void> {
    try {
      const saved = await RundotGameAPI.deviceCache.getItem(GRAPHICS_STORAGE_KEY);
      if (saved && (GRAPHICS_ORDER as readonly string[]).includes(saved)) {
        this.graphics = saved as Graphics;
        this.applyGraphics();
        this.emit();
      }
    } catch {
      // Storage unavailable: keep Auto.
    }
  }

  private saveGraphics(): void {
    RundotGameAPI.deviceCache.setItem(GRAPHICS_STORAGE_KEY, this.graphics).catch(() => undefined);
  }

  /** If a session sits in connecting/syncing without ever going live, stop and let the player retry. */
  private watchSync(now: number): void {
    const status = this.snapshot?.status;
    const waiting = this.screen === 'play' && (status === 'syncing' || status === 'connecting');
    if (!waiting) {
      this.syncingSince = 0;
      return;
    }
    if (this.syncingSince === 0) this.syncingSince = now;
    if (now - this.syncingSince > CONNECT_TIMEOUT_MS) {
      this.syncingSince = 0;
      this.runner.stop();
      this.screen = 'error';
      this.errorDetail = 'Timed out while syncing with the room';
      this.error = friendlyError(this.errorDetail);
      this.emit();
    }
  }

  private frame = (now: number): void => {
    const dt = this.lastNow === 0 ? 16 : Math.min(100, now - this.lastNow);
    this.watchSync(now);
    this.lastNow = now;
    if (this.screen === 'play') {
      const base = { ...DEFAULT_INPUT, legsSel: this.build.legs, armsSel: this.build.arms, headSel: this.build.head, ready: this.ready };
      this.runner.applyInput(this.controls.read(base));
      const u0 = performance.now();
      this.runner.update(dt);
      const um = performance.now() - u0;
      this.perfUpdate += um;
      if (um > this.perfMaxUpdate) this.perfMaxUpdate = um;
    }
    const frame = this.snapshot?.interpolatedRenderState ?? this.snapshot?.renderState;
    const r0 = performance.now();
    this.view.render(frame, this.snapshot?.localSlot ?? 0, dt / 1000);
    this.perfRender += performance.now() - r0;
    this.perfFrames += 1;
    if (dt > this.perfMaxFrame) this.perfMaxFrame = dt;
    if (now - this.perfSince >= 1000) {
      const secs = (now - this.perfSince) / 1000;
      const rb = this.snapshot?.rollbackCount ?? 0;
      const st = this.view.stats();
      this.perf = {
        fps: Math.round(this.perfFrames / secs),
        updateMs: this.perfUpdate / Math.max(1, this.perfFrames),
        renderMs: this.perfRender / Math.max(1, this.perfFrames),
        maxUpdateMs: this.perfMaxUpdate,
        maxFrameMs: this.perfMaxFrame,
        triangles: st.triangles,
        calls: st.calls,
        rollbacksPerSec: Math.round((rb - this.perfRollbacks) / secs),
        ticksPerSec: Math.round(((this.snapshot?.predictedThrough ?? 0) - this.perfTicks) / secs),
      };
      this.perfTicks = this.snapshot?.predictedThrough ?? 0;
      this.perfMaxFrame = 0;
      this.adaptQuality();
      this.perfRollbacks = rb;
      this.perfFrames = 0;
      this.perfUpdate = 0;
      this.perfRender = 0;
      this.perfMaxUpdate = 0;
      this.perfSince = now;
    }
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
      await withTimeout(start(), CONNECT_TIMEOUT_MS, () => this.runner.stop());
      this.screen = 'play';
    } catch (e) {
      this.screen = 'error';
      this.errorDetail = e instanceof Error ? e.message : String(e);
      this.error = friendlyError(this.errorDetail);
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
  /**
   * Re-enters the room we were dropped from. The seat is reclaimed and the match history is replayed. The
   * old socket can linger on the server for a few seconds ("duplicate session") and the platform limits how
   * fast we may reconnect, so retry a few times with backoff.
   */
  async rejoin(): Promise<void> {
    const code = this.lastRoom;
    if (!code) return;
    this.screen = 'connecting';
    this.error = '';
    this.errorDetail = '';
    this.emit();
    let lastError = '';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((r) => setTimeout(r, 1500 + attempt * 2000));
      try {
        this.map = await ensureMap(DEFAULT_MAP);
        this.view.setMap(this.map);
        await withTimeout(joinRace(this.runner, code), CONNECT_TIMEOUT_MS, () => this.runner.stop());
        this.screen = 'play';
        this.emit();
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (!/duplicate session|rate limit|busy|timeout/i.test(lastError)) break;
      }
    }
    this.screen = 'error';
    this.errorDetail = lastError;
    this.error = friendlyError(lastError);
    this.emit();
  }

  leave(): void {
    this.lastRoom = '';
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
