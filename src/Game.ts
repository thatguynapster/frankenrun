import type { SyncplayRunnerSnapshot } from '@series-inc/rundot-syncplay/browser';
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { Controls } from './input/Controls.js';
import { ensureMap } from './net/mapLoader.js';
import { createRunner, hostRace, joinRace, quickMatch, startPractice, type FrankenRunner } from './net/runner.js';
import { RaceView } from './render/RaceView.js';
import { ARM_TENTACLES, DEFAULT_BUILD, DEFAULT_INPUT, HEAD_SLIME, type Build, type GameProjection } from './sim/game.js';
import { ARM_PARTS, BODIES, HEAD_PARTS, LEG_PARTS } from './sim/parts.js';
import type { MapData } from './sim/mapdata.js';
import { DEFAULT_MAP } from './sim/runtime.js';
import { TipCoach } from './tips.js';
import { AudioEngine, type AudioSettings, type Scene } from './audio/engine.js';
import { AudioEvents } from './audio/events.js';

export type Screen = 'title' | 'connecting' | 'play' | 'error';

/** Graphics setting: Auto adapts the render resolution to the device; the others pin it. */
export type Graphics = 'auto' | 'high' | 'medium' | 'low';
const GRAPHICS_ORDER: readonly Graphics[] = ['auto', 'high', 'medium', 'low'];
const GRAPHICS_STORAGE_KEY = 'frankenrun.graphics';
const BUILD_STORAGE_KEY = 'frankenrun.build';
const SETTINGS_STORAGE_KEY = 'frankenrun.settings';
/** The aiming reticle on PC is off for now (it only matters once there are projectiles or aimed grabs). */
const SHOW_AIM_RETICLE = false;
/** Gametags are relayed between clients; keep them short and plain. */
const NAME_MAX = 20;
const NAME_RESEND_MS = 2500;

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
}
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
  readonly showColliders: boolean;
  /** Number of checkpoints on the current map. */
  readonly checkpointTotal: number;
  /** Direction to the next checkpoint relative to the car's heading (degrees, + = to the left) and distance in metres. */
  readonly hint: { readonly angle: number; readonly distance: number } | null;
  /** A first-time tip to show over the race, or null. */
  readonly tip: string | null;
  /** True once the player has pressed Rematch and the room has not restarted yet. */
  readonly rematchRequested: boolean;
  /** The last results this player saw, kept so a race that starts without them does not take them away. */
  readonly cachedResults: GameProjection | undefined;
  /** Progress text for the Connecting screen (for example while rejoining). */
  readonly connectNote: string;
  /** Gametags by slot (own tag from the profile, others relayed through the room). */
  readonly names: Readonly<Record<number, string>>;
  readonly menuOpen: boolean;
  /** True in an online room (the game keeps running while the menu is open). */
  readonly online: boolean;
  /** Show the performance readout on screen. */
  readonly showInfo: boolean;
  /** A phone or tablet: touch controls, chase camera only. */
  readonly touch: boolean;
  readonly audio: AudioSettings;
}

type Listener = (state: UiState) => void;

/** How long a connect or a room sync may take before we give up and let the player retry. */
const CONNECT_TIMEOUT_MS = 20000;
/** A live race that makes no progress for this long is treated as a lost connection. */
const STALL_TIMEOUT_MS = 8000;
/** After returning to a hidden tab the connection may need a while to catch up; the stall watchdog stays quiet for this long. */
const RESUME_GRACE_MS = 20000;
/** Pauses between rejoin attempts: the room may take a few seconds to notice the old connection is gone. */
const REJOIN_DELAYS_MS = [1500, 2500, 3500, 4500, 6000, 8000];
/** Errors that retrying cannot fix. */
const PERMANENT_ERROR = /room-full|room is full|room not found|no such room|identity|config invalid|history-unavailable|history unavailable|disposed|expired/i;

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
  if (/history-unavailable|history unavailable/i.test(message)) return 'The room can no longer rebuild the race for you. Go back and join or host a new race.';
  if (/room-full|room is full/i.test(message)) return 'That room is full.';
  if (/room not found|no such room|not found|expired|disposed/i.test(message)) return 'That room is gone.';
  if (/already-joined|already joined/i.test(message)) return 'The room still thinks your old connection is open. It should clear in a few seconds.';
  if (/duplicate session/i.test(message)) return 'You are still seated in a previous room. Wait a few seconds and try again.';
  if (/rate limit/i.test(message)) return 'The server is busy. Please try again in a moment.';
  if (/stalled/i.test(message)) return 'The connection to the race stalled. Rejoin to pick up where you left off.';
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
  private build: Build = DEFAULT_BUILD;
  private ready = false;
  private wantRematch = false;
  private startUntil = 0;
  private menuOpen = false;
  readonly audio = new AudioEngine();
  private audioEvents = new AudioEvents();
  /** Ability buttons held on the previous frame, to catch the moment of a press. */
  private prevPress = { arms: false, head: false, reset: false };
  private showInfo = true;
  private aimScreen: { x: number; y: number } | null = null;
  private ownName = '';
  private names = new Map<number, string>();
  private lastNameSend = 0;
  private lastOccupied = -1;
  private unbindNames: (() => void) | undefined;
  private connectNote = '';
  private rejoining = false;
  /** One automatic rejoin per dropped connection; after that the player decides. */
  private autoRejoinArmed = false;
  private autoRejoinTimes: number[] = [];
  private resumeGraceUntil = 0;
  private backgroundTimer = 0;
  private lifecycleUnsubs: (() => void)[] = [];
  private lastResults: GameProjection | undefined;
  private tips = new TipCoach();
  private tipText: string | null = null;
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
  private showColliders = false;
  /** In Auto, the sharpest step the GPU has proven it can hold; raised again only after a long steady spell. */
  private ceiling = 0;
  private ceilingAge = 0;
  private perfFrames = 0;
  private perfUpdate = 0;
  private perfRender = 0;
  private perfMaxUpdate = 0;
  private perfSince = 0;
  private syncingSince = 0;
  private stallSince = 0;
  private lastPredicted = -1;
  private perfRollbacks = 0;
  private unsubscribe: () => void;

  constructor(container: HTMLElement) {
    this.view = new RaceView(container);
    this.unsubscribe = this.runner.subscribe((snap) => {
      this.snapshot = snap;
      if (snap.roomCode) this.lastRoom = snap.roomCode;
      if (snap.status === 'error' && this.screen !== 'connecting') {
        if (this.screen === 'play') this.armAutoRejoin();
        this.screen = 'error';
        this.errorDetail = snap.error?.message ?? '';
        this.error = friendlyError(this.errorDetail);
        console.warn('[net] connection lost:', this.errorDetail);
      }
    });
    this.raf = requestAnimationFrame(this.frame);
    void this.loadGraphics();
    void this.loadBuild();
    void this.tips.load();
    void this.loadSettings();
    void this.loadProfile();
    this.audio.setChangeListener(() => this.emit());
    this.watchVisibility();
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && !e.repeat && this.screen === 'play') {
        e.preventDefault();
        this.toggleMenu();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
    this.onPointerMove = (e: PointerEvent): void => {
      if (SHOW_AIM_RETICLE && e.pointerType === 'mouse') this.aimScreen = { x: e.clientX, y: e.clientY };
    };
    this.onPointerOut = (e: MouseEvent): void => {
      if (e.relatedTarget === null) this.aimScreen = null;
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('mouseout', this.onPointerOut);
  }

  private onPointerMove: (e: PointerEvent) => void;
  private onPointerOut: (e: MouseEvent) => void;

  private onKeyDown: (e: KeyboardEvent) => void;

  /** The player's own gametag comes from their profile; everyone else's arrives through the room (see bindNames). */
  private async loadProfile(): Promise<void> {
    try {
      await RundotGameAPI.initializeAsync();
      this.ownName = cleanName(RundotGameAPI.getProfile().username);
    } catch {
      // No profile (should not happen in the host): players are shown as Player N.
    }
  }

  private nameTable(): Record<number, string> {
    const table: Record<number, string> = {};
    for (const [slot, name] of this.names) table[slot] = name;
    const own = this.snapshot?.localSlot ?? 0;
    if (this.ownName !== '') table[own] = this.ownName;
    return table;
  }

  /** Listens for the other players' gametags on the room's ephemeral channel (best effort; they are re-sent every few seconds). */
  private bindNames(): void {
    this.unbindNames?.();
    this.unbindNames = undefined;
    this.names.clear();
    try {
      this.unbindNames = this.runner.onEphemeral((slot, payload) => {
        const name = cleanName((payload as { n?: unknown } | null)?.n);
        if (name !== '' && this.names.get(slot) !== name) {
          this.names.set(slot, name);
          this.emit();
        }
      });
    } catch {
      // Not networked: nothing to listen to.
    }
  }

  /** Announces this player's gametag to the room, every couple of seconds and whenever somebody joins. */
  private shareName(now: number): void {
    const snap = this.snapshot;
    if (this.ownName === '' || this.lastRoom === '' || snap?.status !== 'live') return;
    const occupied = snap.occupancy?.occupied ?? 0;
    if (now - this.lastNameSend < NAME_RESEND_MS && occupied === this.lastOccupied) return;
    this.lastNameSend = now;
    this.lastOccupied = occupied;
    try {
      this.runner.sendEphemeral({ n: this.ownName });
    } catch {
      // Best effort.
    }
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    this.emit();
  }

  setGraphics(value: Graphics): void {
    this.graphics = value;
    this.applyGraphics();
    this.saveGraphics();
    this.emit();
  }

  setShowInfo(on: boolean): void {
    this.showInfo = on;
    this.saveSettings();
    this.emit();
  }

  setColliders(on: boolean): void {
    this.showColliders = on;
    this.emit();
  }

  replayTips(): void {
    this.tips.reset();
    this.emit();
  }

  private async loadSettings(): Promise<void> {
    try {
      const saved = await RundotGameAPI.deviceCache.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const raw = JSON.parse(saved) as { showInfo?: unknown };
        if (typeof raw.showInfo === 'boolean') this.showInfo = raw.showInfo;
        this.emit();
      }
    } catch {
      // Defaults.
    }
  }

  private saveSettings(): void {
    RundotGameAPI.deviceCache.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ showInfo: this.showInfo })).catch(() => undefined);
  }

  /**
   * A browser throttles or freezes a hidden tab, which would silence this client (no inputs, no keep-alive) and get it
   * dropped from the room. While hidden, a timer keeps the session ticking with neutral input; when the tab is shown
   * again the connection gets a grace period to catch up, and a dropped connection is re-established automatically.
   */
  private watchVisibility(): void {
    const onVisibility = (): void => {
      if (document.hidden) {
        if (this.backgroundTimer === 0) this.backgroundTimer = window.setInterval(this.backgroundTick, 250);
      } else {
        this.leaveBackground();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.lifecycleUnsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));
    try {
      const lifecycles = RundotGameAPI.lifecycles;
      const subs = [
        lifecycles.onPause(() => {
          console.warn('[net] host paused the game');
          this.audio.setSuspended(true);
        }),
        lifecycles.onSleep(() => {
          console.warn('[net] host put the game to sleep');
          this.audio.setSuspended(true);
        }),
        lifecycles.onResume(() => {
          this.audio.setSuspended(false);
          this.leaveBackground();
        }),
        lifecycles.onAwake(() => {
          this.audio.setSuspended(false);
          this.leaveBackground();
        }),
      ];
      this.lifecycleUnsubs.push(() => subs.forEach((sub) => sub.unsubscribe()));
    } catch {
      // Lifecycle hooks are not available outside the host; the visibility handler above still works.
    }
  }

  /** Allows one automatic rejoin for this drop, but not an endless loop if the connection keeps flapping (3 per 2 minutes). */
  private armAutoRejoin(): void {
    const now = performance.now();
    this.autoRejoinTimes = this.autoRejoinTimes.filter((t) => now - t < 120000);
    if (this.lastRoom === '' || this.autoRejoinTimes.length >= 3) return;
    this.autoRejoinTimes.push(now);
    this.autoRejoinArmed = true;
  }

  private leaveBackground(): void {
    if (this.backgroundTimer !== 0) {
      window.clearInterval(this.backgroundTimer);
      this.backgroundTimer = 0;
    }
    this.resumeGraceUntil = performance.now() + RESUME_GRACE_MS;
    this.stallSince = 0;
    this.lastNow = 0;
  }

  /** Runs while the tab is hidden: keep the session alive with neutral input, and no rendering. */
  private backgroundTick = (): void => {
    // Online rooms only: an offline practice race simply pauses while the tab is hidden.
    if (this.screen !== 'play' || this.lastRoom === '') return;
    const now = performance.now();
    let elapsed = this.lastNow === 0 ? 250 : now - this.lastNow;
    this.lastNow = now;
    this.runner.applyInput({
      ...DEFAULT_INPUT,
      present: true,
      bodySel: this.build.body,
      legsSel: this.build.legs,
      armsSel: this.build.arms,
      headSel: this.build.head,
      ready: this.ready,
    });
    for (let i = 0; i < 6 && elapsed > 0; i += 1) {
      const step = Math.min(250, elapsed);
      this.runner.update(step);
      elapsed -= step;
    }
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  private hint(frame: GameProjection | undefined, slot: number): UiState['hint'] {
    const me = frame?.players[slot];
    if (!frame || !me || !this.map || frame.phase !== 'RACING' || !me.inRace) return null;
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
      showColliders: this.showColliders,
      checkpointTotal: this.map?.checkpoints.length ?? 0,
      hint: this.hint(frame, snap?.localSlot ?? 0),
      tip: this.tipText,
      rematchRequested: this.wantRematch,
      cachedResults: this.lastResults,
      connectNote: this.connectNote,
      names: this.nameTable(),
      menuOpen: this.menuOpen,
      online: this.lastRoom !== '',
      showInfo: this.showInfo,
      touch: this.controls.coarse,
      audio: this.audio.settings,
    };
  }

  private emit(): void {
    const snap = this.snapshot;
    this.tipText = this.screen === 'play'
      ? this.tips.update({ frame: snap?.interpolatedRenderState ?? snap?.renderState, slot: snap?.localSlot ?? 0, nowMs: performance.now(), checkpointTotal: this.map?.checkpoints.length ?? 0, offline: this.lastRoom === '', scheme: this.controls.coarse ? 'touch' : 'keyboard' })
      : null;
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

  toggleColliders(): void {
    this.showColliders = !this.showColliders;
    this.emit();
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

  /**
   * Self-heal for a networked game that stops making progress. Two cases: a session that never finishes
   * syncing, and a live session that freezes (the connection is "reconnecting", or the clock has not
   * advanced). After a few seconds we stop waiting and offer a clean rejoin, which re-syncs from the server's
   * state instead of grinding through a long backlog of catch-up ticks.
   */
  private watchSync(now: number): void {
    const snap = this.snapshot;
    const status = snap?.status;
    const networked = this.lastRoom !== '';
    const waiting = this.screen === 'play' && (status === 'syncing' || status === 'connecting');
    if (!waiting) this.syncingSince = 0;
    else {
      if (this.syncingSince === 0) this.syncingSince = now;
      if (now - this.syncingSince > CONNECT_TIMEOUT_MS) return this.dropToError('Timed out while syncing with the room');
    }

    // Frozen while "live": the predicted clock stops advancing, or the transport sits in reconnecting.
    const phase = snap?.interpolatedRenderState?.phase ?? snap?.renderState?.phase;
    const racing = networked && this.screen === 'play' && status === 'live' && phase !== undefined && phase !== 'BUILD' && phase !== 'RESULTS';
    if (!racing) {
      this.stallSince = 0;
      this.lastPredicted = -1;
      return;
    }
    const predicted = snap?.predictedThrough ?? -1;
    const stuck = now >= this.resumeGraceUntil && (snap?.connection === 'reconnecting' || predicted === this.lastPredicted);
    this.lastPredicted = predicted;
    if (!stuck) {
      this.stallSince = 0;
      return;
    }
    if (this.stallSince === 0) this.stallSince = now;
    if (now - this.stallSince > STALL_TIMEOUT_MS) this.dropToError('The connection stalled');
  }

  private dropToError(detail: string): void {
    this.syncingSince = 0;
    this.stallSince = 0;
    if (this.screen === 'play') this.armAutoRejoin();
    console.warn('[net] giving up on the connection:', detail);
    this.runner.stop();
    this.screen = 'error';
    this.errorDetail = detail;
    this.error = friendlyError(detail);
    this.emit();
  }

  private frame = (now: number): void => {
    const dt = this.lastNow === 0 ? 16 : Math.min(100, now - this.lastNow);
    this.watchSync(now);
    if (this.autoRejoinArmed && this.screen === 'error' && !this.rejoining) {
      this.autoRejoinArmed = false;
      void this.rejoin();
    }
    this.lastNow = now;
    if (this.screen === 'play') {
      // The ready flag is per race: it is cleared on the results screen so a rematch starts at the build screen.
      const current = this.snapshot?.interpolatedRenderState ?? this.snapshot?.renderState;
      const me = current?.players[this.snapshot?.localSlot ?? 0];
      if (current?.phase === 'RESULTS') this.lastResults = current;
      // In the lobby (the build screen, or after asking for a rematch) Ready is the player's own choice; elsewhere it resets.
      const inLobby = current?.phase === 'BUILD' || this.wantRematch || me?.rematch === true;
      if (!inLobby) this.ready = false;
      // The rematch request is sent until the room has taken it (build phase) or this player is in the next race.
      if (current?.phase === 'BUILD' || (me?.inRace === true && (current?.phase === 'COUNTDOWN' || current?.phase === 'RACING'))) this.wantRematch = false;
      this.shareName(now);
      const base = {
        ...DEFAULT_INPUT,
        present: true, // a connected client always announces itself, so the room can tell occupied slots from empty ones
        start: performance.now() < this.startUntil,
        bodySel: this.build.body,
        legsSel: this.build.legs,
        armsSel: this.build.arms,
        headSel: this.build.head,
        ready: this.ready,
        rematch: this.wantRematch,
      };
      // With the menu open the monster gets neutral input; an offline race pauses, an online one keeps running.
      const input = this.menuOpen ? base : this.controls.read(base);
      this.pressSounds(input, me, current?.phase);
      this.runner.applyInput(input);
      if (!(this.menuOpen && this.lastRoom === '')) {
        const u0 = performance.now();
        this.runner.update(dt);
        const um = performance.now() - u0;
        this.perfUpdate += um;
        if (um > this.perfMaxUpdate) this.perfMaxUpdate = um;
      }
    }
    const frame = this.snapshot?.interpolatedRenderState ?? this.snapshot?.renderState;
    this.updateAudio(frame, now);
    // The mouse aims: the reticle sits on the ground under the cursor (no firing yet).
    this.view.setAim(this.screen === 'play' && !this.menuOpen && this.aimScreen !== null ? this.view.groundPoint(this.aimScreen.x, this.aimScreen.y) : null);
    const r0 = performance.now();
    this.view.render(frame, this.snapshot?.localSlot ?? 0, dt / 1000, this.showColliders);
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

  /** Music follows the scene; sound effects come from what changed since the last frame (see audio/events.ts). */
  private updateAudio(frame: GameProjection | undefined, now: number): void {
    const slot = this.snapshot?.localSlot ?? 0;
    const me = frame?.players[slot];
    const scene: Scene = this.screen !== 'play' ? 'title' : frame !== undefined && (frame.phase === 'COUNTDOWN' || frame.phase === 'RACING') && me?.inRace === true ? 'race' : 'lobby';
    this.audio.setScene(scene);
    if (this.screen !== 'play' || frame === undefined || document.hidden) return;
    for (const event of this.audioEvents.update(frame, slot, now)) this.audio.play(event, frame, slot);
  }

  /**
   * Instant feedback when an ability button (or its key) goes down, whether or not the ability can fire: a whip or a
   * squelch when it can, a dull "not now" when the part is missing or still cooling down. Reset gets a soft click now
   * and a poof when the monster lands back at its checkpoint (see audio/events.ts).
   */
  private pressSounds(input: { arms: boolean; head: boolean; reset: boolean }, me: GameProjection['players'][number] | undefined, phase: GameProjection['phase'] | undefined): void {
    const racing = phase === 'RACING' && me !== undefined && me.inRace && me.finishTick < 0;
    const prev = this.prevPress;
    if (racing && me !== undefined && !this.menuOpen) {
      const slot = this.snapshot?.localSlot ?? 0;
      const frame = this.snapshot?.interpolatedRenderState ?? this.snapshot?.renderState;
      if (input.arms && !prev.arms) {
        if (me.build.arms === ARM_TENTACLES && me.armsCooldown === 0 && me.swingPole < 0 && frame) this.audio.play({ id: 'tentacle', slot }, frame, slot);
        else this.audio.playUi('denied');
      }
      if (input.head && !prev.head) {
        if (me.build.head === HEAD_SLIME && me.headCooldown === 0 && !me.trailing && frame) this.audio.play({ id: 'slime', slot }, frame, slot);
        else this.audio.playUi('denied');
      }
      if (input.reset && !prev.reset) this.audio.playUi('click');
    }
    this.prevPress = { arms: input.arms, head: input.head, reset: input.reset };
  }

  setAudio(patch: Partial<AudioSettings>): void {
    this.audio.setSettings(patch);
  }

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
      this.bindNames();
      this.audioEvents.reset();
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
    if (!code || this.rejoining) return;
    this.rejoining = true;
    this.screen = 'connecting';
    this.error = '';
    this.errorDetail = '';
    this.emit();
    const attempts: string[] = [];
    try {
      for (let attempt = 0; attempt < REJOIN_DELAYS_MS.length; attempt += 1) {
        this.connectNote = `Rejoining the race (attempt ${attempt + 1} of ${REJOIN_DELAYS_MS.length})...`;
        this.emit();
        await new Promise((r) => setTimeout(r, REJOIN_DELAYS_MS[attempt]));
        try {
          this.map = await ensureMap(DEFAULT_MAP);
          this.view.setMap(this.map);
          await withTimeout(joinRace(this.runner, code), CONNECT_TIMEOUT_MS, () => this.runner.stop());
          this.bindNames();
          this.screen = 'play';
          this.connectNote = '';
          this.resumeGraceUntil = performance.now() + RESUME_GRACE_MS;
          this.emit();
          return;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          attempts.push(`#${attempt + 1}: ${message}`);
          console.warn(`[net] rejoin attempt ${attempt + 1} failed:`, message);
          if (PERMANENT_ERROR.test(message)) break;
        }
      }
      this.screen = 'error';
      this.connectNote = '';
      this.errorDetail = attempts.join(' | ');
      this.error = friendlyError(attempts[attempts.length - 1] ?? '');
      this.emit();
    } finally {
      this.rejoining = false;
    }
  }

  leave(): void {
    this.lastRoom = '';
    this.lastResults = undefined;
    this.audioEvents.reset();
    this.menuOpen = false;
    this.names.clear();
    this.runner.stop();
    this.snapshot = undefined;
    this.screen = 'title';
    this.ready = false;
    this.emit();
  }

  setBuild(build: Build): void {
    this.build = build;
    this.saveBuild();
    this.emit();
  }

  /** The player's last build is remembered between sessions (spec: saved per player with appStorage). */
  private async loadBuild(): Promise<void> {
    try {
      const saved = await RundotGameAPI.appStorage.getItem(BUILD_STORAGE_KEY);
      if (!saved) return;
      const raw = JSON.parse(saved) as Partial<Build>;
      const within = (value: unknown, count: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : 0);
      this.build = {
        body: within(raw.body, BODIES.length),
        legs: within(raw.legs, LEG_PARTS.length),
        arms: within(raw.arms, ARM_PARTS.length),
        head: within(raw.head, HEAD_PARTS.length),
      };
      this.emit();
    } catch {
      // No saved build, or storage unavailable: keep the default.
    }
  }

  private saveBuild(): void {
    RundotGameAPI.appStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(this.build)).catch(() => undefined);
  }
  setReady(ready: boolean): void {
    this.ready = ready;
    this.emit();
  }

  /** Host only: start the race. A short pulse; the room starts it if everyone in the lobby is ready. */
  startRace(): void {
    this.startUntil = performance.now() + 400;
    this.emit();
  }

  /** Results screen (or a race you are not in): go to the lobby for the next race. Only this player moves. */
  rematch(): void {
    this.wantRematch = true;
    this.ready = false;
    this.emit();
  }

  dismissTip(): void {
    this.tips.dismiss(performance.now());
    this.emit();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('mouseout', this.onPointerOut);
    this.unbindNames?.();
    cancelAnimationFrame(this.raf);
    if (this.backgroundTimer !== 0) window.clearInterval(this.backgroundTimer);
    this.lifecycleUnsubs.forEach((off) => off());
    this.unsubscribe();
    this.runner.dispose();
    this.view.dispose();
  }
}
