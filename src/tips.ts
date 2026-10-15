import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { ARM_CLAWS, ARM_TENTACLES, HEAD_LANTERN, HEAD_SLIME, type GameProjection } from './sim/game.js';

const STORAGE_KEY = 'frankenrun.tips';
/** How long a tip stays up if the player does not tap it away. */
const SHOW_MS = 7000;
/** Pause between two tips so they never pile up. */
const GAP_MS = 1500;

interface Tip {
  readonly id: string;
  readonly text: string;
}

export interface TipContext {
  readonly frame: GameProjection | undefined;
  readonly slot: number;
  readonly nowMs: number;
  readonly checkpointTotal: number;
  /** Offline practice: tips replay every race. Online they show once per device. */
  readonly offline: boolean;
}

/**
 * Tips taught while playing: each appears when it becomes relevant. Online each is shown once and remembered on
 * this device; in offline practice, where players learn the game, every tip replays in every race. Reactive tips (stuck, lost a part) jump the queue; the rest wait their turn.
 */
export class TipCoach {
  private seen = new Set<string>();
  private current: (Tip & { until: number }) | null = null;
  private queue: Tip[] = [];
  private lastEnd = 0;
  private stuckSince = 0;
  private loaded = false;
  private offline = false;
  private lastPhase = '';
  /** Tips already shown in the current race (used instead of `seen` while offline). */
  private shownThisRace = new Set<string>();
  private readonly touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  async load(): Promise<void> {
    try {
      const saved = await RundotGameAPI.deviceCache.getItem(STORAGE_KEY);
      if (saved) for (const id of JSON.parse(saved) as string[]) this.seen.add(id);
    } catch {
      // Storage unavailable: tips simply show again next session.
    }
    this.loaded = true;
  }

  private save(): void {
    RundotGameAPI.deviceCache.setItem(STORAGE_KEY, JSON.stringify([...this.seen])).catch(() => undefined);
  }

  /** Ids already shown or queued, so the same tip is never offered twice. */
  private known(id: string): boolean {
    const alreadyShown = this.offline ? this.shownThisRace.has(id) : this.seen.has(id);
    return alreadyShown || this.queue.some((t) => t.id === id) || this.current?.id === id;
  }

  private offer(tip: Tip, urgent = false): void {
    if (this.known(tip.id)) return;
    if (urgent) this.queue.unshift(tip);
    else this.queue.push(tip);
  }

  /** Forgets which tips were shown, so they all appear again (Menu > Show tips again). */
  reset(): void {
    this.seen.clear();
    this.save();
  }

  dismiss(nowMs: number): void {
    if (this.current) {
      this.current = null;
      this.lastEnd = nowMs;
    }
  }

  /** Call regularly while a race screen is up. Returns the text to show, or null. */
  update(ctx: TipContext): string | null {
    const { frame, slot, nowMs } = ctx;
    this.offline = ctx.offline;
    // A new race starts with a clean slate (matters for offline replays and for rematches).
    if (frame && frame.phase === 'COUNTDOWN' && this.lastPhase !== 'COUNTDOWN') {
      this.shownThisRace.clear();
      this.queue = [];
      this.current = null;
      this.stuckSince = 0;
    }
    if (frame) this.lastPhase = frame.phase;
    const me = frame?.players[slot];
    if (!this.loaded || !frame || !me || !me.inRace || me.finishTick >= 0 || (frame.phase !== 'COUNTDOWN' && frame.phase !== 'RACING')) {
      this.stuckSince = 0;
      if (this.current && frame && frame.phase !== 'COUNTDOWN' && frame.phase !== 'RACING') this.dismiss(nowMs);
      return this.current?.text ?? null;
    }

    if (frame.phase === 'COUNTDOWN') {
      this.offer({
        id: 'steer',
        text: this.touch
          ? 'Drag left or right on the left side of the screen to steer. Your monster drives by itself.'
          : 'W to go, A and D to steer.',
      });
    } else {
      const raceTicks = frame.phaseTicks;
      if (raceTicks >= 75) this.offer({ id: 'goal', text: `Follow the arrow to the next checkpoint. Clear all ${ctx.checkpointTotal} to win, and watch out for rivals.` });
      if (raceTicks >= 270) {
        if (me.build.arms === ARM_TENTACLES) this.offer({ id: 'tentacles', text: 'Tentacles: hold the button near a pole to swing round it.' });
        if (me.build.arms === ARM_CLAWS) this.offer({ id: 'claws', text: 'Crab Claws: ram a rival from behind to steal one of their parts.' });
        if (me.build.head === HEAD_SLIME) this.offer({ id: 'slime', text: 'Slime Gland: tap the button to drop a slippery trail behind you.' });
        if (me.build.head === HEAD_LANTERN) this.offer({ id: 'lantern', text: "Jack-o'-Lantern: follow the orange line on the road to the next checkpoint." });
      }
      // Reactive tips.
      if (me.speed < 0.5 && raceTicks > 120) {
        if (this.stuckSince === 0) this.stuckSince = nowMs;
        else if (nowMs - this.stuckSince > 2500) this.offer({ id: 'stuck', text: 'Stuck? Hold steer left or right to spin on the spot, then drive off. Hold Reset to return to the last checkpoint.' }, true);
      } else {
        this.stuckSince = 0;
      }
      if (me.partsLost > 0 && frame.frame - me.lastLossTick < 30) {
        this.offer({ id: 'partLost', text: `You lost a part! Drive through the glowing gem to get it back. A missing part makes you lighter and faster.` }, true);
      }
    }

    if (this.current && nowMs >= this.current.until) this.dismiss(nowMs);
    if (!this.current && this.queue.length > 0 && nowMs - this.lastEnd >= GAP_MS) {
      const next = this.queue.shift()!;
      this.current = { ...next, until: nowMs + SHOW_MS };
      this.shownThisRace.add(next.id);
      if (!this.seen.has(next.id)) {
        this.seen.add(next.id);
        this.save();
      }
    }
    return this.current?.text ?? null;
  }
}
