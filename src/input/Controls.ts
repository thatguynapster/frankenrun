import type { GameInput } from '../sim/game.js';

/** Keyboard + on-screen touch input. The sim's steer is positive toward +x, which is the car's LEFT. */
export class Controls {
  private keys = new Set<string>();
  private touchSteer = 0; // -1 (left) .. 1 (right), screen sense
  private touchBrake = false;
  private touchArms = false;
  private touchHead = false;
  private touchLegs = false;
  private touchReset = false;
  private touchActive = false;

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
  setTouchHead(on: boolean): void {
    this.touchActive = true;
    this.touchHead = on;
  }
  setTouchLegs(on: boolean): void {
    this.touchActive = true;
    this.touchLegs = on;
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
    const screenSteer = right !== 0 ? right : this.touchSteer;
    const forward = this.down('KeyW', 'ArrowUp');
    const back = this.down('KeyS', 'ArrowDown') || this.touchBrake;
    // Touch has auto-throttle on; keyboard needs W.
    const throttle = back ? -100 : forward || (this.touchActive && !this.touchBrake) ? 100 : 0;
    return {
      ...base,
      throttle,
      steer: Math.round(-screenSteer * 100),
      arms: this.down('KeyJ') || this.touchArms,
      head: this.down('KeyK') || this.touchHead,
      legs: this.down('Space') || this.touchLegs,
      reset: this.down('KeyR') || this.touchReset,
    };
  }

  pressedReady(): boolean {
    return this.down('Enter');
  }
}
