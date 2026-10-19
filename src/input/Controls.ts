import type { GameInput } from '../sim/game.js';

/** Keyboard + on-screen touch input. The sim's steer is positive toward +x, which is the car's LEFT. */
export class Controls {
  private keys = new Set<string>();
  private touchSteer = 0; // -1 (left) .. 1 (right), screen sense
  private touchBrake = false;
  private touchArms = false;
  private touchHead = false;
  private touchSlimeFwd = false;
  private slimeTimer = 0;
  private touchGetUp = false;
  private touchReset = false;
  // A phone or tablet (coarse primary pointer) drives automatically from the start; keyboards need W.
  private touchActive = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  /** A phone or tablet: the primary pointer is touch. Decides the control scheme and which options are offered. */
  readonly coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  private steerSmoothed = 0; // keyboard steering eases in so a tap doesn't snap to full lock

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  setTouchSteer(value: number): void {
    this.touchActive = true;
    this.touchSteer = Math.max(-1, Math.min(1, value));
  }
  setTouchBrake(on: boolean): void {
    this.touchActive = true;
    this.touchBrake = on;
  }
  setTouchArms(on: boolean): void {
    this.touchActive = true;
    this.touchArms = on;
  }
  /** A swipe or tap on the slime button: one short press, thrown ahead or behind. */
  pulseSlime(forward: boolean): void {
    this.touchActive = true;
    this.touchHead = true;
    this.touchSlimeFwd = forward;
    window.clearTimeout(this.slimeTimer);
    this.slimeTimer = window.setTimeout(() => {
      this.touchHead = false;
      this.touchSlimeFwd = false;
    }, 140); // long enough for the sim's 30 Hz tick to see the press
  }
  setTouchHead(on: boolean): void {
    this.touchActive = true;
    this.touchHead = on;
  }
  setTouchGetUp(on: boolean): void {
    this.touchActive = true;
    this.touchGetUp = on;
  }
  setTouchReset(on: boolean): void {
    this.touchActive = true;
    this.touchReset = on;
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  read(base: GameInput): GameInput {
    const right = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    if (this.touchSteer !== 0) {
      this.steerSmoothed = this.touchSteer; // touch drag is already analogue
    } else {
      // Keyboard: ease toward the key's direction slowly, and back to centre faster.
      const rate = right === 0 ? 0.35 : 0.14;
      const delta = right - this.steerSmoothed;
      this.steerSmoothed += Math.max(-rate, Math.min(rate, delta));
    }
    const screenSteer = this.steerSmoothed;
    const forward = this.down('KeyW', 'ArrowUp');
    const back = this.down('KeyS', 'ArrowDown') || this.touchBrake;
    // Touch has auto-throttle on; keyboard needs W.
    const throttle = back ? -100 : forward || (this.touchActive && !this.touchBrake) ? 100 : 0;
    return {
      ...base,
      throttle,
      // The sim only resolves steering in steps of 10 (its vehicle input is -10..10), so send exactly that
      // resolution: identical driving, but far fewer distinct inputs, and every input change that differs from
      // the other client's prediction forces a rollback, so this roughly halves the re-simulation work.
      steer: Math.round((-screenSteer * 100) / 10) * 10,
      arms: this.down('KeyJ') || this.touchArms,
      head: this.down('KeyK', 'KeyI') || this.touchHead,
      slimeFwd: this.down('KeyI') || this.touchSlimeFwd,
      getUp: this.down('Space') || this.touchGetUp,
      reset: this.down('KeyR') || this.touchReset,
    };
  }

  pressedReady(): boolean {
    return this.down('Enter');
  }
}
