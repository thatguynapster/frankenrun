// A small pooled particle burst system for hits, part loss, steals and pickups: one THREE.Points object, one draw call.
// Particles are additive, so fading is done by darkening their colour. Presentation only; it never touches the simulation.

import * as THREE from 'three';

const MAX = 160;
const GRAVITY = 14;

export interface BurstOptions {
  readonly count: number;
  readonly color: number;
  /** Outward speed in m/s. */
  readonly speed: number;
  /** Extra upward speed in m/s. */
  readonly up?: number;
  /** Seconds the particles live. */
  readonly life?: number;
  /** 0 = float, 1 = fall with gravity. */
  readonly gravity?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly position = new Float32Array(MAX * 3);
  private readonly color = new Float32Array(MAX * 3);
  private readonly velocity = new Float32Array(MAX * 3);
  private readonly base = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly gravity = new Float32Array(MAX);
  private next = 0;
  private active = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    // soft round dots instead of hard squares
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    }
    const material = new THREE.PointsMaterial({ size: 0.5, map: new THREE.CanvasTexture(canvas), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.position.fill(0);
  }

  /** Throws a burst of particles outward from a point. Old particles are recycled when the pool is full. */
  burst(x: number, y: number, z: number, o: BurstOptions): void {
    const c = new THREE.Color(o.color);
    for (let n = 0; n < o.count; n += 1) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const lift = (Math.random() - 0.3) * 0.9; // mostly outward and up
      const s = o.speed * (0.4 + Math.random() * 0.6);
      this.position[i * 3] = x;
      this.position[i * 3 + 1] = y;
      this.position[i * 3 + 2] = z;
      this.velocity[i * 3] = Math.cos(a) * s * (1 - Math.abs(lift) * 0.5);
      this.velocity[i * 3 + 1] = (o.up ?? 2) * (0.5 + Math.random()) + lift * s * 0.5;
      this.velocity[i * 3 + 2] = Math.sin(a) * s * (1 - Math.abs(lift) * 0.5);
      this.base[i * 3] = c.r;
      this.base[i * 3 + 1] = c.g;
      this.base[i * 3 + 2] = c.b;
      const life = (o.life ?? 0.7) * (0.7 + Math.random() * 0.5);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.gravity[i] = (o.gravity ?? 1) * GRAVITY;
    }
    this.active = MAX;
  }

  update(dt: number): void {
    if (this.active === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX; i += 1) {
      if (this.life[i]! <= 0) {
        this.color[i * 3] = this.color[i * 3 + 1] = this.color[i * 3 + 2] = 0;
        continue;
      }
      this.life[i]! -= dt;
      alive += 1;
      this.velocity[i * 3 + 1]! -= this.gravity[i]! * dt;
      this.position[i * 3]! += this.velocity[i * 3]! * dt;
      this.position[i * 3 + 1]! += this.velocity[i * 3 + 1]! * dt;
      this.position[i * 3 + 2]! += this.velocity[i * 3 + 2]! * dt;
      if (this.position[i * 3 + 1]! < 0.05) {
        this.position[i * 3 + 1] = 0.05;
        this.velocity[i * 3 + 1] = Math.abs(this.velocity[i * 3 + 1]!) * 0.3;
      }
      const f = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.color[i * 3] = this.base[i * 3]! * f;
      this.color[i * 3 + 1] = this.base[i * 3 + 1]! * f;
      this.color[i * 3 + 2] = this.base[i * 3 + 2]! * f;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
    this.points.visible = alive > 0;
    if (alive === 0) this.active = 0;
  }

  /** Clears everything (a new race, or the lobby). */
  clear(): void {
    this.life.fill(0);
    this.color.fill(0);
    this.points.visible = false;
    this.active = 0;
  }
}
