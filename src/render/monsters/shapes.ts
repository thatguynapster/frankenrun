// A tiny low-poly modelling kit. A Shape collects primitives (each with its own colour, position, rotation and scale)
// and merges them into ONE non-indexed BufferGeometry with vertex colours and flat normals. One merged geometry per
// moving piece keeps a monster to about a dozen draw calls, which matters with several monsters on a phone.
//
// Conventions for every monster model: Y up, the monster faces +Z, and +X is its LEFT (the scene's convention).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = readonly [number, number, number];

export interface Tf {
  readonly p?: V3;
  /** Euler rotation in radians (XYZ). */
  readonly r?: V3;
  readonly s?: V3;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const up = new THREE.Vector3(0, 1, 0);

export class Shape {
  private parts: THREE.BufferGeometry[] = [];

  /** Adds any geometry, coloured and transformed. The input geometry is copied, never modified. */
  add(geometry: THREE.BufferGeometry, color: number, tf: Tf = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const [px, py, pz] = tf.p ?? [0, 0, 0];
    const [rx, ry, rz] = tf.r ?? [0, 0, 0];
    const [sx, sy, sz] = tf.s ?? [1, 1, 1];
    q.setFromEuler(e.set(rx, ry, rz));
    m4.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m4);
    g.deleteAttribute('uv');
    g.computeVertexNormals(); // non-indexed, so every face keeps its own flat normal
    const count = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  /** A box. One thinner than 6 cm (a stitch, a tooth, an eye) is drawn as a single flat plate facing +Z: 2 triangles instead of 12. */
  box(w: number, h: number, d: number, color: number, tf?: Tf): this {
    if (d <= 0.06) {
      const t = tf ?? {};
      const [px, py, pz] = t.p ?? [0, 0, 0];
      return this.add(new THREE.PlaneGeometry(w, h), color, { ...t, p: [px, py, pz + d / 2] });
    }
    return this.add(new THREE.BoxGeometry(w, h, d), color, tf);
  }

  /** Cylinder along Y (top radius, bottom radius, height). */
  cyl(top: number, bottom: number, h: number, segments: number, color: number, tf?: Tf, open = false): this {
    return this.add(new THREE.CylinderGeometry(top, bottom, h, segments, 1, open), color, tf);
  }

  /** Cone pointing +Y. */
  cone(radius: number, h: number, segments: number, color: number, tf?: Tf): this {
    return this.add(new THREE.ConeGeometry(radius, h, segments, 1), color, tf);
  }

  /** Faceted blob (icosahedron); scale it non-uniformly through tf.s for ellipsoids. */
  ico(radius: number, detail: number, color: number, tf?: Tf): this {
    return this.add(new THREE.IcosahedronGeometry(radius, detail), color, tf);
  }

  /** Ring (torus) lying flat around the Y axis, for ribs and bands. */
  ring(radius: number, tube: number, color: number, tf?: Tf, arc = Math.PI * 2): this {
    const t = tf ?? {};
    return this.add(new THREE.TorusGeometry(radius, tube, 3, 8, arc), color, { ...t, r: t.r ?? [Math.PI / 2, 0, 0] });
  }

  /** A tapered rod between two points (a limb segment, a claw, a horn). */
  /** A tapered rod between two points. Its ends are left open (a joint, claw or hand always covers them): half the triangles. */
  limb(a: V3, b: V3, radiusA: number, radiusB: number, color: number, segments = 6): this {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const dir = to.clone().sub(from);
    const length = dir.length();
    if (length < 1e-6) return this;
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const euler = new THREE.Euler().setFromQuaternion(quat);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    return this.cyl(radiusB, radiusA, length, segments, color, { p: [mid.x, mid.y, mid.z], r: [euler.x, euler.y, euler.z] }, true);
  }

  /** Merges everything into one geometry. */
  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts = [];
    return merged ?? new THREE.BufferGeometry();
  }
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
}

/** Mirrors a transform across the YZ plane (left becomes right): negates x positions and the y and z rotations. */
export function mirrorX(v: V3): V3 {
  return [-v[0], v[1], v[2]];
}
