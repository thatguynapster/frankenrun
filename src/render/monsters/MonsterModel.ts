// One monster: a body with swappable legs, arms and head, animated from the game state each frame.
// Presentation only: it reads what the renderer already knows (position, speed, build) and never touches the sim.

import * as THREE from 'three';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS, MATERIALS, baseHead, clampIndex, meshes, torsoMeshes, type BodyDef, type LegDef, type Motion, type Rig } from './parts.js';
import { createHat, type HatModel } from './hats.js';
import { DEFAULT_STYLE, TINTS, type Style } from './style.js';

export interface BuildIds {
  readonly body: number;
  readonly legs: number;
  readonly arms: number;
  readonly head: number;
}

/** The slice of a player's state that drives the model (a PlayerView satisfies this). */
export interface MonsterPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly speed: number;
  readonly swingPole: number;
  readonly trailing: boolean;
  /** Hopper Haunches: 0..1 of a full charge, and whether it is mid-leap. */
  readonly hopCharge?: number;
  readonly airborne?: boolean;
}

export type PartSlot = 'legs' | 'arms' | 'head';

const TOP_SPEED = 22;
/** Visual size boost over the physics chassis: monsters read small on a phone screen at the racing camera distance. */
const SIZE = 1.4;
const easeOutBack = (t: number): number => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const sashMaterials = new Map<number, THREE.MeshLambertMaterial>();
function sashMaterial(color: number): THREE.MeshLambertMaterial {
  let m = sashMaterials.get(color);
  if (m === undefined) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    sashMaterials.set(color, m);
  }
  return m;
}
const sashGeometry = new THREE.CylinderGeometry(1, 1, 0.14, 10, 1, true);

export class MonsterModel {
  /** Place this in the scene; it is positioned at the chassis centre (feet 1 m below it, on the ground). */
  readonly root = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly sash: THREE.Mesh;
  private body: BodyDef = BODY_DEFS[0]!;
  private legDef: LegDef = LEG_DEFS[0]!;
  private legs: Rig | undefined;
  private arms: Rig | undefined;
  private head: Rig | undefined;
  private headBase: THREE.Group | undefined;
  private torsoMeshes: THREE.Mesh[] = [];
  private current: BuildIds = { body: -1, legs: -1, arms: -1, head: -1 };
  /** 0..1 progress of the pop-in when a part is gained. */
  private pop: Record<PartSlot, number> = { legs: 1, arms: 1, head: 1 };
  private phase = 0;
  private squash = 0;
  private snap = 0;
  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private started = false;
  private style: Style = DEFAULT_STYLE;
  private hat: HatModel | undefined;
  /** This monster's own copy of the body material, so its tint never touches anyone else. */
  private readonly litTint = (MATERIALS.lit as THREE.MeshLambertMaterial).clone();

  /** How far this body and legs combination sinks below the ground at rest (some feet reach lower than the chassis allows). */
  private static readonly liftCache = new Map<string, number>();
  private static liftFor(body: number, legs: number): number {
    const key = `${body}:${legs}`;
    let lift = MonsterModel.liftCache.get(key);
    if (lift === undefined) {
      const scratch = new MonsterModel(0, true);
      scratch.setBuild({ body, legs, arms: 0, head: 0 }, false);
      scratch.update({ x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, swingPole: -1, trailing: false }, 1 / 30, 0);
      scratch.root.position.set(0, 1, 0);
      scratch.root.updateMatrixWorld(true);
      lift = Math.max(0, -new THREE.Box3().setFromObject(scratch.root).min.y);
      MonsterModel.liftCache.set(key, lift);
    }
    return lift;
  }
  /** Added to the hip height so the lowest toe rests on the ground. */
  private lift = 0;

  constructor(accentColor: number, private readonly measuring = false) {
    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.torso.add(this.headPivot);
    this.sash = new THREE.Mesh(sashGeometry, sashMaterial(accentColor));
    this.torso.add(this.sash);
    this.setBuild({ body: 0, legs: 1, arms: 1, head: 1 }, false);
  }

  /** Swaps in whatever differs from the current build. `popIn` makes newly gained parts spring into place. */
  setBuild(build: BuildIds, popIn = true): void {
    const next: BuildIds = {
      body: clampIndex(build.body, BODY_DEFS.length),
      legs: clampIndex(build.legs, LEG_DEFS.length),
      arms: clampIndex(build.arms, ARM_DEFS.length),
      head: clampIndex(build.head, HEAD_DEFS.length),
    };
    const prev = this.current;
    const bodyChanged = next.body !== prev.body;
    if (bodyChanged) this.buildBody(BODY_DEFS[next.body]!);
    if (bodyChanged || next.legs !== prev.legs) {
      if (this.legs) this.hips.remove(this.legs.root);
      this.legDef = LEG_DEFS[next.legs]!;
      this.lift = this.measuring ? 0 : MonsterModel.liftFor(next.body, next.legs);
      this.legs = this.legDef.create(this.body);
      this.hips.add(this.legs.root);
      if (popIn && !bodyChanged && next.legs !== 0) this.pop.legs = 0;
    }
    if (bodyChanged || next.arms !== prev.arms) {
      if (this.arms) this.torso.remove(this.arms.root);
      this.arms = ARM_DEFS[next.arms]!.create(this.body);
      this.torso.add(this.arms.root);
      if (popIn && !bodyChanged && next.arms !== 0) this.pop.arms = 0;
    }
    if (bodyChanged || next.head !== prev.head) {
      if (this.head) this.headPivot.remove(this.head.root);
      const def = HEAD_DEFS[next.head]!;
      this.head = def.create(this.body);
      this.headPivot.add(this.head.root);
      if (this.headBase) this.headBase.visible = !def.replacesHead;
      if (popIn && !bodyChanged && next.head !== 0) this.pop.head = 0;
    }
    this.current = next;
    this.applyTint();
    this.placeHat();
  }

  /** Chooses the colour tint and hat. Cheap to call every frame: it does nothing when the style has not changed. */
  setStyle(style: Style): void {
    if (style.tint === this.style.tint && style.hat === this.style.hat) return;
    const hatChanged = style.hat !== this.style.hat;
    this.style = style;
    this.applyTint();
    if (hatChanged) this.placeHat();
  }

  /** Paints every body-coloured piece with the tint (hats and the player-colour sash keep their own colours). */
  private applyTint(): void {
    this.litTint.color.set(TINTS[this.style.tint]?.color ?? 0xffffff);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData['noTint'] === true) return;
      const base = (mesh.userData['baseMaterial'] as THREE.Material | undefined) ?? mesh.material;
      if (base !== MATERIALS.lit) return;
      mesh.userData['baseMaterial'] = base;
      mesh.material = this.litTint;
    });
  }

  /**
   * Where a hat sits and how big it is for the head underneath. Heads are round, so a hat's base goes a little way into
   * the head, to the depth where the head is as wide as the hat's brim: that makes it sit flush instead of floating.
   * (Numbers come from each head's shape in parts.ts: its top, and how wide it is just below the top.)
   */
  private hatFit(): { y: number; z: number; scale: number } {
    if (this.current.head === 2) return { y: 0.6, z: 0.05, scale: 0.86 }; // pumpkin
    if (this.current.head === 1) return { y: 0.8, z: 0.02, scale: 1 }; // slime cap
    return this.body.id === 0 ? { y: 0.5, z: 0.06, scale: 1 } : { y: 0.43, z: 0.05, scale: 0.8 };
  }

  /**
   * Height of the head's surface at (x, z) in the head pivot's space: the highest point of any head triangle above that
   * spot (the flame of the Jack-o'-Lantern, which is not part of the head, is left out).
   */
  private surfaceY(x: number, z: number): number | undefined {
    let best: number | undefined;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    this.headPivot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData['noTint'] === true || mesh.material === MATERIALS.flame || mesh.material === MATERIALS.glow) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i + 2 < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        for (const v of [a, b, c]) this.headPivot.worldToLocal(mesh.localToWorld(v));
        const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
        const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * a.y + l2 * b.y + l3 * c.y;
        if (best === undefined || y > best) best = y;
      }
    });
    return best;
  }

  /** The Jack-o'-Lantern's flame would poke through a hat, so it is put out while one is worn. */
  private updateFlame(): void {
    const show = this.style.hat === 0;
    this.headPivot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === MATERIALS.flame) mesh.visible = show;
    });
  }

  /** Puts the hat on: lowered until the points of its base that should touch the head do. */
  private placeHat(): void {
    this.updateFlame();
    if (this.hat) this.headPivot.remove(this.hat.root);
    this.hat = createHat(this.style.hat);
    if (!this.hat) return;
    const fit = this.hatFit();
    this.hat.root.scale.setScalar(fit.scale);
    this.hat.root.position.set(0, fit.y, fit.z);
    // measure at rest: the head pivot with no nod, and the head parts at their scale
    this.headPivot.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const heights: number[] = [];
    for (const [ax, az] of this.hat.anchors) {
      const y = this.surfaceY(ax * fit.scale, az * fit.scale + fit.z);
      if (y !== undefined) heights.push(y);
    }
    if (heights.length > 0) {
      heights.sort((p, q) => p - q);
      const middle = heights[Math.floor(heights.length / 2)]!;
      this.hat.root.position.y = middle - 0.02 + this.hat.lift * fit.scale;
    }
    this.headPivot.add(this.hat.root);
  }

  private buildBody(def: BodyDef): void {
    for (const m of this.torsoMeshes) this.torso.remove(m);
    if (this.headBase) this.headPivot.remove(this.headBase);
    this.body = def;
    this.torsoMeshes = torsoMeshes(def);
    for (const m of this.torsoMeshes) this.torso.add(m);
    this.headBase = baseHead(def);
    this.headPivot.add(this.headBase);
    this.headPivot.position.set(0, def.neckY, 0.05);
    this.sash.scale.set(def.sashRadius, 1, def.sashRadius * 0.8);
    this.sash.position.set(0, def.id === 0 ? 0.16 : 0.1, 0);
    this.hips.scale.setScalar(def.scale * SIZE);
    this.torso.scale.setScalar(def.torsoScale);
  }

  /** A crash: the whole monster squashes and springs back. */
  hit(strength = 1): void {
    this.squash = Math.max(this.squash, clamp01(strength));
  }

  /** A steal or a grab: claws snap shut. */
  snapClaws(): void {
    this.snap = 1;
  }

  /** Positions the monster and advances its animation by `dt` seconds. */
  update(p: MonsterPose, dt: number, time: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    const yaw = 2 * Math.atan2(p.qy, p.qw);
    if (!this.started) {
      this.lastX = p.x;
      this.lastZ = p.z;
      this.lastYaw = yaw;
      this.started = true;
    }
    let dist = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if (dist > 6 || dt <= 0) dist = 0; // a teleport (reset) is not a stride
    const turn = dt > 0 ? Math.abs(wrapAngle(yaw - this.lastYaw)) / dt : 0;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.lastYaw = yaw;

    const speed01 = clamp01(p.speed / TOP_SPEED);
    // Feet advance with the ground; the rate is capped so a flat-out sprint is a blur of legs, not a strobe.
    const stride = this.legDef.stride * this.body.scale * SIZE;
    this.phase += Math.min(dist / stride, (5 * dt) / 1) * Math.PI * 2;
    let amp = clamp01(p.speed / 5) * (1 - 0.3 * speed01);
    if (p.speed < 3 && turn > 0.6) {
      // pivoting on the spot: shuffle the feet
      this.phase += turn * dt * 1.5;
      amp = Math.max(amp, clamp01(turn / 3) * 0.7);
    }

    this.squash = Math.max(0, this.squash - dt * 4.5);
    this.snap = Math.max(0, this.snap - dt * 3);
    const motion: Motion = { phase: this.phase, amp, speed01, time, swinging: p.swingPole >= 0, snap: this.snap, trailing: p.trailing, charge: p.hopCharge ?? 0, airborne: p.airborne ?? false };

    // posture: hips ride at the leg length with a bounce each step, the torso leans into the run
    const bounce = Math.abs(Math.sin(this.phase)) * 0.07 * amp;
    // Hopper Haunches crouch while charging: the hips sink as the knees bend.
    const crouch = (p.hopCharge ?? 0) * 0.3 * this.legDef.hipHeight * this.body.scale * SIZE;
    this.hips.position.y = -1 + this.legDef.hipHeight * this.body.scale * SIZE + bounce * SIZE + this.lift - crouch;
    const lean = 0.06 + 0.22 * speed01;
    this.torso.rotation.set(lean, Math.sin(this.phase) * 0.12 * amp, Math.sin(this.phase) * 0.04 * amp);
    const breathe = 1 + Math.sin(time * 2.2) * 0.015 * (1 - amp);
    const ts = this.body.torsoScale;
    this.torso.scale.set(ts, ts * breathe, ts);
    this.headPivot.rotation.set(-lean * 0.75 + Math.sin(this.phase * 2) * 0.05 * amp + Math.sin(time * 0.9) * 0.03, -Math.sin(this.phase) * 0.08 * amp, 0);

    this.hat?.animate(time);
    this.legs?.animate(motion);
    this.arms?.animate(motion);
    this.head?.animate(motion);

    // squash and pop-in
    this.root.scale.set(1 + 0.18 * this.squash, 1 - 0.22 * this.squash, 1 + 0.18 * this.squash);
    for (const key of ['legs', 'arms', 'head'] as const) {
      if (this.pop[key] < 1) {
        this.pop[key] = Math.min(1, this.pop[key] + dt / 0.35);
        const rig = key === 'legs' ? this.legs : key === 'arms' ? this.arms : this.head;
        rig?.root.scale.setScalar(Math.max(0.01, easeOutBack(this.pop[key])));
      }
    }
  }

  /** How many triangles this monster draws (for budget checks). */
  triangles(): number {
    let n = 0;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) n += mesh.geometry.getAttribute('position').count / 3;
    });
    return n;
  }
}

/**
 * A free-standing copy of one part (both limbs of a pair, or the head) in its rest pose, for the pop-off animation
 * when a part is lost. Position and motion are the caller's job.
 */
export function createPartProp(slot: PartSlot, id: number, bodyId: number): THREE.Group {
  const body = BODY_DEFS[clampIndex(bodyId, BODY_DEFS.length)]!;
  const def = slot === 'legs' ? LEG_DEFS[clampIndex(id, LEG_DEFS.length)]! : slot === 'arms' ? ARM_DEFS[clampIndex(id, ARM_DEFS.length)]! : HEAD_DEFS[clampIndex(id, HEAD_DEFS.length)]!;
  const rig = def.create(body);
  rig.animate({ phase: 0, amp: 0, speed01: 0, time: 0, swinging: false, snap: 0, trailing: false, charge: 0, airborne: false });
  const prop = new THREE.Group();
  prop.add(rig.root);
  if (slot === 'arms') rig.root.position.set(0, -body.shoulderY, 0); // arms hang from the shoulder: centre them on the prop
  if (slot === 'legs') rig.root.position.set(0, 0.5, 0);
  prop.scale.setScalar(body.scale * SIZE);
  return prop;
}

export { meshes };
