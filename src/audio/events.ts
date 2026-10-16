// Turns the stream of game states into sound events. Pure and presentation-only: it reads projections the renderer
// already has and never touches the simulation. It watches the numbers change between frames (a part lost, a swing
// started, a speed drop) rather than needing the sim to announce anything.

import type { GameProjection, PlayerView } from '../sim/game.js';
import type { SoundId } from './manifest.js';

export interface SoundEvent {
  readonly id: SoundId;
  /** Whose sound it is (its position decides loudness and stereo placement). */
  readonly slot: number;
  /** Playback rate (pitch); 1 by default. */
  readonly rate?: number;
  /** Extra gain multiplier for this particular event. */
  readonly gain?: number;
}

interface SlotMemory {
  partsLost: number;
  partsGained: number;
  partsStolen: number;
  swinging: boolean;
  trailing: boolean;
  finished: boolean;
  steppedDistance: number;
  lastStepAt: number;
  x: number;
  z: number;
  speeds: number[];
  lastImpactAt: number;
}

const RESPAWN_JUMP = 12; // metres moved in a single frame: far more than any speed can do, so it is a reset teleport
const STEP_MIN_SPEED = 1.5; // m/s: below this a monster is not stepping
const STEP_MIN_INTERVAL_MS = 170;
const IMPACT_DROP = 7; // m/s lost within the recent window counts as a crash
const IMPACT_WINDOW = 8; // frames
const IMPACT_COOLDOWN_MS = 700;
const GROWL_MIN_MS = 9000;
const GROWL_MAX_MS = 16000;

export class AudioEvents {
  private memory = new Map<number, SlotMemory>();
  private lastFrame = -1;
  private lastPhase = '';
  private countdownMark = -1;
  private nextGrowlAt = 0;
  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** Forget everything (a new session, or the game rewound too far to compare). */
  reset(): void {
    this.memory.clear();
    this.lastFrame = -1;
    this.lastPhase = '';
    this.countdownMark = -1;
  }

  private slotMemory(p: PlayerView): SlotMemory {
    let m = this.memory.get(p.slot);
    if (m === undefined) {
      m = {
        partsLost: p.partsLost,
        partsGained: p.partsGained,
        partsStolen: p.partsStolen,
        swinging: p.swingPole >= 0,
        trailing: p.trailing,
        finished: p.finishTick >= 0,
        steppedDistance: 0,
        lastStepAt: 0,
        x: p.x,
        z: p.z,
        speeds: [],
        lastImpactAt: -1e9,
      };
      this.memory.set(p.slot, m);
    }
    return m;
  }

  /**
   * Compares this frame with the last one and returns the sounds to play. `nowMs` is a wall clock (for cooldowns).
   * A jump in the game clock (late join, rollback, a new race) re-baselines silently instead of replaying old events.
   */
  update(frame: GameProjection, localSlot: number, nowMs: number): SoundEvent[] {
    const events: SoundEvent[] = [];
    const jumped = this.lastFrame >= 0 && (frame.frame < this.lastFrame || frame.frame - this.lastFrame > 12);
    if (jumped || (this.lastPhase !== '' && this.lastPhase !== frame.phase && frame.phase === 'BUILD')) {
      this.memory.clear();
    }
    const phaseChanged = this.lastPhase !== frame.phase;

    // --- race flow ---
    if (frame.phase === 'COUNTDOWN') {
      const mark = Math.floor(frame.phaseTicks / 30); // 0, 1, 2: three beats
      if (mark !== this.countdownMark && mark <= 2) {
        this.countdownMark = mark;
        events.push({ id: 'count', slot: localSlot, rate: 1 + mark * 0.12 });
      }
    } else {
      this.countdownMark = -1;
    }
    if (phaseChanged && frame.phase === 'RACING' && this.lastPhase === 'COUNTDOWN') events.push({ id: 'go', slot: localSlot });
    if (phaseChanged && frame.phase === 'RESULTS' && this.lastPhase !== '') events.push({ id: 'results', slot: localSlot });

    // --- per monster ---
    const racing = frame.phase === 'RACING';
    for (const p of frame.players) {
      if (p.bot && !p.present) continue;
      const m = this.slotMemory(p);
      if (p.partsLost > m.partsLost) events.push({ id: 'partLoss', slot: p.slot });
      if (p.partsStolen > m.partsStolen) events.push({ id: 'steal', slot: p.slot });
      else if (p.partsGained > m.partsGained) events.push({ id: 'pickup', slot: p.slot });
      // Your own tentacle and slime sounds play the moment you press the button (see Game); others' follow the state.
      if (p.slot !== localSlot && p.swingPole >= 0 && !m.swinging) events.push({ id: 'tentacle', slot: p.slot });
      if (p.slot !== localSlot && p.trailing && !m.trailing) events.push({ id: 'slime', slot: p.slot });
      // A reset puts the monster back at its last checkpoint: a jump no speed could cover.
      if (racing && this.lastPhase === 'RACING' && p.present && Math.hypot(p.x - m.x, p.z - m.z) > RESPAWN_JUMP) {
        events.push({ id: 'respawn', slot: p.slot });
        m.speeds.length = 0;
        m.steppedDistance = 0;
      }
      if (p.finishTick >= 0 && !m.finished) events.push({ id: 'finish', slot: p.slot, gain: p.slot === localSlot ? 1 : 0.6 });

      // footsteps: one stomp per stride travelled
      if (racing && p.present && p.inRace && p.finishTick < 0 && p.speed > STEP_MIN_SPEED) {
        m.steppedDistance += Math.hypot(p.x - m.x, p.z - m.z);
        const stride = 2.2 + p.speed * 0.03;
        if (m.steppedDistance >= stride && nowMs - m.lastStepAt >= STEP_MIN_INTERVAL_MS) {
          m.steppedDistance = 0;
          m.lastStepAt = nowMs;
          events.push({ id: 'step', slot: p.slot, gain: 0.45 + 0.55 * Math.min(p.speed / 20, 1) });
        }
      } else {
        m.steppedDistance = 0;
      }

      // a crash shows as a sudden loss of speed
      m.speeds.push(p.speed);
      if (m.speeds.length > IMPACT_WINDOW) m.speeds.shift();
      const recentMax = Math.max(...m.speeds);
      if (racing && recentMax - p.speed >= IMPACT_DROP && nowMs - m.lastImpactAt >= IMPACT_COOLDOWN_MS) {
        m.lastImpactAt = nowMs;
        events.push({ id: 'impact', slot: p.slot, gain: Math.min(1, (recentMax - p.speed) / 14) });
      }

      m.partsLost = p.partsLost;
      m.partsGained = p.partsGained;
      m.partsStolen = p.partsStolen;
      m.swinging = p.swingPole >= 0;
      m.trailing = p.trailing;
      m.finished = p.finishTick >= 0;
      m.x = p.x;
      m.z = p.z;
    }

    // an occasional growl from the local monster while it runs
    const me = frame.players[localSlot];
    if (racing && me !== undefined && me.inRace && me.finishTick < 0 && me.speed > 3) {
      if (this.nextGrowlAt === 0) this.nextGrowlAt = nowMs + GROWL_MIN_MS * (0.5 + this.random());
      if (nowMs >= this.nextGrowlAt) {
        events.push({ id: 'growl', slot: localSlot });
        this.nextGrowlAt = nowMs + GROWL_MIN_MS + this.random() * (GROWL_MAX_MS - GROWL_MIN_MS);
      }
    } else if (!racing) {
      this.nextGrowlAt = 0;
    }

    this.lastFrame = frame.frame;
    this.lastPhase = frame.phase;
    return events;
  }
}
