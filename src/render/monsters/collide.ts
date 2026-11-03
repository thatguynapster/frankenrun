// Keeps a monster's own limbs from passing through each other or through its body.
// Each moving limb segment is described as a capsule (a thick line between two points). Every frame, after the run
// animation has posed the limbs, overlapping capsules are pushed apart by swinging the limb outward from its shoulder or
// hip. Presentation only: the simulation never sees any of this.

import * as THREE from 'three';
import type { V3 } from './shapes.js';

export interface Probe {
  /** The object the capsule is attached to; `a` and `b` are in its space. */
  readonly node: THREE.Object3D;
  readonly a: V3;
  readonly b: V3;
  /** Radius in the node's own units (scaled by the node's world scale). */
  readonly r: number;
  readonly kind: 'arm' | 'leg';
  /** +1 for the character's left (+X), -1 for the right. */
  readonly side: number;
  /** The shoulder or hip this limb swings from. Absent for limbs that cannot be pushed (they still push others away). */
  readonly spread?: THREE.Object3D;
}

/** The body the arms must stay out of: a vertical capsule in the torso's space. */
export interface TorsoCapsule {
  readonly node: THREE.Object3D;
  readonly y0: number;
  readonly y1: number;
  readonly r: number;
}

const MAX_SPREAD = 0.9;
const PASSES = 4;

interface Cap {
  readonly probe: Probe;
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  r: number;
}

const caps: Cap[] = [];
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const pivot = new THREE.Vector3();
const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const rv = new THREE.Vector3();
const torsoA = new THREE.Vector3();
const torsoB = new THREE.Vector3();

/** Closest points between segments p1-q1 and p2-q2 (written into `c1` and `c2`); returns the squared distance. */
function closestPoints(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  rv.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(rv);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    // both are points
  } else if (a <= 1e-9) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(rv);
    if (e <= 1e-9) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceToSquared(c2);
}

function measure(probes: readonly Probe[]): void {
  caps.length = 0;
  for (const probe of probes) {
    probe.node.updateWorldMatrix(true, false);
    const cap: Cap = { probe, a: new THREE.Vector3(...probe.a).applyMatrix4(probe.node.matrixWorld), b: new THREE.Vector3(...probe.b).applyMatrix4(probe.node.matrixWorld), r: probe.r * probe.node.matrixWorld.getMaxScaleOnAxis() };
    caps.push(cap);
  }
}

/** Swings a limb outward by enough to take up `depth` of overlap at the contact point `at`. */
function push(probe: Probe, depth: number, at: THREE.Vector3, share: number): boolean {
  const node = probe.spread;
  if (node === undefined) return false;
  node.getWorldPosition(pivot);
  const lever = Math.max(0.3, pivot.distanceTo(at));
  const before = node.rotation.z;
  const next = before + Math.min(0.4, (depth * share) / lever) * probe.side;
  node.rotation.z = Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, next));
  return node.rotation.z !== before;
}

/** Poses every limb clear of the others. Call after the limbs' own animation. */
export function resolveLimbs(probes: readonly Probe[], torso: TorsoCapsule | undefined): void {
  if (probes.length === 0) return;
  for (const probe of probes) if (probe.spread) probe.spread.rotation.z = 0;
  for (let pass = 0; pass < PASSES; pass += 1) {
    measure(probes);
    let moved = false;
    for (let i = 0; i < caps.length; i += 1) {
      const A = caps[i]!;
      for (let j = i + 1; j < caps.length; j += 1) {
        const B = caps[j]!;
        const sameOwner = (A.probe.spread ?? A.probe.node) === (B.probe.spread ?? B.probe.node);
        if (sameOwner || (!A.probe.spread && !B.probe.spread)) continue;
        const dist = Math.sqrt(closestPoints(A.a, A.b, B.a, B.b, tmp, tmp2));
        const depth = A.r + B.r - dist;
        if (depth <= 0.005) continue;
        tmp.add(tmp2).multiplyScalar(0.5);
        if (A.probe.side !== B.probe.side) {
          // opposite sides: each swings outward
          if (push(A.probe, depth, tmp, 0.5)) moved = true;
          if (push(B.probe, depth, tmp, 0.5)) moved = true;
        } else if (A.probe.kind !== B.probe.kind) {
          // an arm against the leg on its own side: the arm gives way
          const arm = A.probe.kind === 'arm' ? A.probe : B.probe;
          if (push(arm, depth, tmp, 1)) moved = true;
        } else if (!A.probe.spread || !B.probe.spread) {
          if (push((A.probe.spread ? A : B).probe, depth, tmp, 1)) moved = true;
        }
      }
      if (torso !== undefined && A.probe.kind === 'arm') {
        torsoA.set(0, torso.y0, 0).applyMatrix4(torso.node.matrixWorld);
        torsoB.set(0, torso.y1, 0).applyMatrix4(torso.node.matrixWorld);
        const dist = Math.sqrt(closestPoints(A.a, A.b, torsoA, torsoB, tmp, tmp2));
        const depth = A.r + torso.r * torso.node.matrixWorld.getMaxScaleOnAxis() - dist;
        if (depth > 0.005 && push(A.probe, depth, tmp, 1)) moved = true;
      }
    }
    if (!moved) break;
  }
}

/** The deepest overlap (metres) between any two limbs, or a limb and the body, in the current pose. For tests. */
export function worstOverlap(probes: readonly Probe[], torso: TorsoCapsule | undefined): number {
  measure(probes);
  let worst = 0;
  for (let i = 0; i < caps.length; i += 1) {
    const A = caps[i]!;
    for (let j = i + 1; j < caps.length; j += 1) {
      const B = caps[j]!;
      if ((A.probe.spread ?? A.probe.node) === (B.probe.spread ?? B.probe.node) || (!A.probe.spread && !B.probe.spread)) continue;
      worst = Math.max(worst, A.r + B.r - Math.sqrt(closestPoints(A.a, A.b, B.a, B.b, tmp, tmp2)));
    }
    if (torso !== undefined && A.probe.kind === 'arm') {
      torsoA.set(0, torso.y0, 0).applyMatrix4(torso.node.matrixWorld);
      torsoB.set(0, torso.y1, 0).applyMatrix4(torso.node.matrixWorld);
      worst = Math.max(worst, A.r + torso.r * torso.node.matrixWorld.getMaxScaleOnAxis() - Math.sqrt(closestPoints(A.a, A.b, torsoA, torsoB, tmp, tmp2)));
    }
  }
  return worst;
}
