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

/** Hash of a position, 0..1: the same spot always paints the same, so every device sees the same monster. */
const hash3 = (x: number, y: number, z: number): number => {
  let h = Math.imul(Math.round(x * 211) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.round(y * 211) ^ 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(Math.round(z * 211) ^ 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
};

export interface ShapeOptions {
  /**
   * Hand-painted shading baked into the vertex colours: faces turned up are a little lighter, faces turned down a little
   * darker, with a faint grain. Off for glowing pieces (eyes, flames), which must stay one flat colour.
   */
  readonly paint?: boolean;
}

export class Shape {
  private parts: THREE.BufferGeometry[] = [];
  private readonly paint: boolean;

  constructor(options: ShapeOptions = {}) {
    this.paint = options.paint ?? true;
  }

  /**
   * Adds any geometry, coloured and transformed. The input geometry is copied, never modified. Normals the geometry
   * already has are kept (so a sphere stays smooth); pass `flat` for hard facets.
   */
  add(geometry: THREE.BufferGeometry, color: number, tf: Tf = {}, flat = false): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const [px, py, pz] = tf.p ?? [0, 0, 0];
    const [rx, ry, rz] = tf.r ?? [0, 0, 0];
    const [sx, sy, sz] = tf.s ?? [1, 1, 1];
    q.setFromEuler(e.set(rx, ry, rz));
    m4.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m4);
    g.deleteAttribute('uv');
    if (flat || !g.getAttribute('normal')) g.computeVertexNormals(); // non-indexed, so every face keeps its own flat normal
    const count = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < count; i += 1) {
      let k = 1;
      if (this.paint) {
        const up = nor.getY(i);
        k = 1 + 0.15 * up + (hash3(pos.getX(i), pos.getY(i), pos.getZ(i)) - 0.5) * 0.06;
      }
      colors[i * 3] = c.r * k;
      colors[i * 3 + 1] = c.g * k;
      colors[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  /**
   * A smooth ellipsoid: a lump of body, with radii along x, y and z. `detail` picks how round it is:
   * 0 a rough 20-sided stone, 1 a soft 56-triangle ball, 2 a smooth 120-triangle ball for the big shapes.
   */
  blob(rx: number, ry: number, rz: number, color: number, tf: Tf = {}, detail = 2): this {
    const [sx, sy, sz] = tf.s ?? [1, 1, 1];
    const geometry = detail <= 0 ? new THREE.IcosahedronGeometry(1, 0) : detail === 1 ? new THREE.SphereGeometry(1, 7, 5) : new THREE.SphereGeometry(1, 10, 7);
    return this.add(geometry, color, { ...tf, s: [rx * sx, ry * sy, rz * sz] });
  }

  /**
   * A body of revolution: `profile` is a list of [radius, height] from bottom to top, spun round the Y axis. Gives torsos,
   * skulls, necks and pumpkins a smooth, designed silhouette. Scale x and z through tf.s to make it oval.
   */
  lathe(profile: readonly (readonly [number, number])[], segments: number, color: number, tf?: Tf): this {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    return this.add(new THREE.LatheGeometry(pts, segments), color, tf);
  }

  /** A smooth tapered tube through the points (a tail, a tentacle, a scar). Radius runs from `r0` to `r1` along it. */
  tube(points: readonly V3[], r0: number, r1: number, color: number, radial = 6, steps = 10): this {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const frames = curve.computeFrenetFrames(steps, false);
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const centre = curve.getPointAt(t);
      const r = r0 + (r1 - r0) * t;
      for (let j = 0; j < radial; j += 1) {
        const a = (j / radial) * Math.PI * 2;
        const n = frames.normals[i]!, b = frames.binormals[i]!;
        positions.push(centre.x + r * (Math.cos(a) * n.x + Math.sin(a) * b.x), centre.y + r * (Math.cos(a) * n.y + Math.sin(a) * b.y), centre.z + r * (Math.cos(a) * n.z + Math.sin(a) * b.z));
      }
    }
    for (let i = 0; i < steps; i += 1)
      for (let j = 0; j < radial; j += 1) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
        index.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return this.add(g, color);
  }

  /**
   * A row of cross stitches along a straight seam from `a` to `b`, lying on a surface that faces `normal`: a thin thread
   * down the middle and `count` little bars across it, each tilted like a real stitch.
   */
  seam(a: V3, b: V3, normal: V3, count: number, color: number, width = 0.12, thread = 0.012): this {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const along = to.clone().sub(from);
    const n = new THREE.Vector3(...normal).normalize();
    const across = new THREE.Vector3().crossVectors(along, n).normalize();
    const dir = along.clone().normalize();
    this.limb(a, b, thread, thread, color, 4);
    for (let i = 0; i < count; i += 1) {
      const mid = from.clone().lerp(to, (i + 0.5) / count);
      const bar = across.clone().multiplyScalar(width / 2).add(dir.clone().multiplyScalar(width * 0.28));
      this.limb([mid.x - bar.x, mid.y - bar.y, mid.z - bar.z], [mid.x + bar.x, mid.y + bar.y, mid.z + bar.z], thread * 1.15, thread * 1.15, color, 4);
    }
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
  ring(radius: number, tube: number, color: number, tf?: Tf, arc = Math.PI * 2, radial = 4, tubular = 10): this {
    const t = tf ?? {};
    return this.add(new THREE.TorusGeometry(radius, tube, radial, tubular, arc), color, { ...t, r: t.r ?? [Math.PI / 2, 0, 0] });
  }

  /** Cross stitches along a path of points (a seam that follows a curved surface); `normals` say which way the surface faces at each point. */
  seamPath(points: readonly V3[], normals: readonly V3[], perSegment: number, color: number, width = 0.12, thread = 0.012): this {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const n0 = new THREE.Vector3(...normals[i]!), n1 = new THREE.Vector3(...normals[i + 1]!);
      const n = n0.add(n1).normalize();
      this.seam(points[i]!, points[i + 1]!, [n.x, n.y, n.z], perSegment, color, width, thread);
    }
    return this;
  }

  /** A tapered rod between two points (a limb segment, a claw, a horn). */
  /** A tapered rod between two points. Its ends are left open (a joint, claw or hand always covers them): half the triangles. */
  limb(a: V3, b: V3, radiusA: number, radiusB: number, color: number, segments = 8, capped = false): this {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const dir = to.clone().sub(from);
    const length = dir.length();
    if (length < 1e-6) return this;
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const euler = new THREE.Euler().setFromQuaternion(quat);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    return this.cyl(radiusB, radiusA, length, segments, color, { p: [mid.x, mid.y, mid.z], r: [euler.x, euler.y, euler.z] }, !capped);
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
