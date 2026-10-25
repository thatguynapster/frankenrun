// Monster bodies and parts, modelled in code in the faceted low-poly style of the game's art (see public/thumbnail.jpg).
//
// A monster is a body with sockets plus swappable limbs and heads:
//   root (world pose) -> hips (height set by the legs) -> legs and torso -> arms and head on the torso.
// Every moving piece is one merged mesh (see shapes.ts). Part ids match src/sim/parts.ts (0 = nothing equipped).
// This file knows nothing about the simulation or the game; MonsterModel.ts drives it.

import * as THREE from 'three';
import { Shape, type V3 } from './shapes.js';
import type { Probe, TorsoCapsule } from './collide.js';
import { createFlameMaterial, flameClock, flameGeometry } from './flame.js';

// ---------- materials (shared by every monster) ----------

export type MatKind = 'lit' | 'glow' | 'slime' | 'flame';

/** A cool rim of light on edges turned away from the camera, so a dark monster still reads against a dark street. */
export function withRim(material: THREE.MeshLambertMaterial, color: number, strength: number): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uRimColor'] = { value: new THREE.Color(color) };
    shader.uniforms['uRimStrength'] = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRimColor;\nuniform float uRimStrength;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `float rim = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
	outgoingLight += uRimColor * pow(rim, 3.0) * uRimStrength;
	#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `rim-${color}-${strength}`;
  return material;
}

export const MATERIALS: Record<MatKind, THREE.Material> = {
  lit: withRim(new THREE.MeshLambertMaterial({ vertexColors: true }), 0x9fb4ff, 0.3),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  slime: withRim(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1d6b10 }), 0xd4ff9a, 0.3),
  flame: createFlameMaterial(),
};

interface Piece {
  readonly geometry: THREE.BufferGeometry;
  readonly material: MatKind;
}

const cache = new Map<string, Piece[]>();
/** Builds a set of pieces once and shares the geometry between every monster that uses it. */
function cached(key: string, build: () => Piece[]): Piece[] {
  let pieces = cache.get(key);
  if (pieces === undefined) {
    pieces = build();
    pieces.forEach((piece, i) => (piece.geometry.name = `${key}#${i}`));
    cache.set(key, pieces);
  }
  return pieces;
}

export function meshes(pieces: readonly Piece[]): THREE.Mesh[] {
  return pieces.map((p) => new THREE.Mesh(p.geometry, MATERIALS[p.material]));
}

/** Every geometry built so far, for tests and for freeing memory. */
export function builtGeometries(): THREE.BufferGeometry[] {
  return [...cache.values()].flat().map((p) => p.geometry);
}

// ---------- how a monster is moving (computed by MonsterModel, read by the parts) ----------

export interface Motion {
  /** Run-cycle angle in radians; advances with distance travelled, so feet match the ground speed. */
  readonly phase: number;
  /** 0 standing still .. 1 full stride. */
  readonly amp: number;
  /** 0 .. 1 of top speed. */
  readonly speed01: number;
  readonly time: number;
  readonly swinging: boolean;
  /** 1 right after a steal or a grab, decaying to 0: claws snap shut. */
  readonly snap: number;
  readonly trailing: boolean;
  /** Hopper Haunches: 0..1 of a full charge (crouching), and true while mid-leap. */
  readonly charge: number;
  readonly airborne: boolean;
}

export interface Rig {
  readonly root: THREE.Group;
  /** Capsules around the moving segments, so limbs can be kept from passing through each other (see collide.ts). */
  readonly probes?: readonly Probe[];
  animate(m: Motion): void;
}

// ---------- palette ----------

const C = {
  brute: 0x7d4cc7, patch: 0x6fa08a, steelDark: 0x5d636b, steelLight: 0xd5dae0, bruteLight: 0x9b6fe6, bruteDark: 0x4a2a8a, ink: 0x1a1226, shorts: 0x5a4631, steel: 0x9aa0a8, ivory: 0xf3ecd2,
  bone: 0xe9e1c9, boneShade: 0xb9ae8c, rib: 0xd9d0b4, eyeYellow: 0xffe84a, eyeGreen: 0x6bff7a,
  fur: 0xf08a24, furLight: 0xffb55a, pad: 0x3a2a30, spiderMid: 0x3d2a52, hopLight: 0x9be08a, tentacleDark: 0x8a2f9c, clawDark: 0x9c2f1e, pumpkinLight: 0xff9d3a, vine: 0x6bbf3a, sackLight: 0xa8855f, furDark: 0xb8541a, spider: 0x2a1c38, spiderGlow: 0xff7a1a,
  tentacle: 0xc44bd8, tentacleTip: 0xe27bf0, claw: 0xd8452e, clawLight: 0xe86a4a,
  sack: 0x8a6a4a, sackDark: 0x5e4630, strap: 0x3a2a1c, hop: 0x4fbf5a, hopDark: 0x2f8a3c, spring: 0xcfd6dd, pumpkin: 0xff8a1f, pumpkinDark: 0xd96a10, stem: 0x5a7a2a, flame: 0xffb347, slime: 0x7dff3a, slimeLight: 0xd4ff9a,
} as const;

/// ---------- surface helpers ----------

type Profile = readonly (readonly [number, number])[];

/** Radius of a lathe profile at height y (profile runs bottom to top). */
function profileRadius(profile: Profile, y: number): number {
  for (let i = 0; i + 1 < profile.length; i += 1) {
    const [r0, y0] = profile[i]!, [r1, y1] = profile[i + 1]!;
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
  }
  return 0;
}

/** A point just outside a lathe body (scaled sx, sz) at height y and angle a (0 = straight ahead, +Z), and which way the surface faces there. */
function onSurface(profile: Profile, sx: number, sz: number, y: number, a: number, lift = 0.012): { p: V3; n: V3 } {
  const r = profileRadius(profile, y);
  const x = Math.sin(a) * r * sx, z = Math.cos(a) * r * sz;
  const nx = Math.sin(a) / sx, nz = Math.cos(a) / sz;
  const len = Math.hypot(nx, nz);
  return { p: [x + (nx / len) * lift, y, z + (nz / len) * lift], n: [nx / len, 0, nz / len] };
}

/** A curved seam round a lathe body from angle `a0` to `a1` at one height. */
function ringSeam(s: Shape, profile: Profile, sx: number, sz: number, y: number, a0: number, a1: number, steps: number, color: number, perStep = 1, width = 0.1): void {
  const pts: V3[] = [], norms: V3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const o = onSurface(profile, sx, sz, y, a0 + ((a1 - a0) * i) / steps);
    pts.push(o.p);
    norms.push(o.n);
  }
  s.seamPath(pts, norms, perStep, color, width);
}

/** A neck bolt: a bar through the neck with a flange and a nut on the outside. */
function neckBolt(s: Shape, side: number, y: number, z: number): void {
  s.cyl(0.04, 0.04, 0.34, 8, C.steelDark, { p: [side * 0.26, y, z], r: [0, 0, Math.PI / 2] });
  s.cyl(0.085, 0.085, 0.035, 10, C.steel, { p: [side * 0.37, y, z], r: [0, 0, Math.PI / 2] }); // washer
  s.cyl(0.062, 0.062, 0.07, 6, C.steelLight, { p: [side * 0.41, y, z], r: [0, 0, Math.PI / 2] }); // nut
  s.blob(0.04, 0.04, 0.04, C.steelLight, { p: [side * 0.455, y, z] },0);
}

// ---------- bodies ----------

export interface BodyDef {
  readonly id: number;
  readonly name: string;
  /** Overall size of the monster. */
  readonly scale: number;
  /** Size of the upper body (torso, arms and head) relative to the legs. */
  readonly torsoScale: number;
  readonly skin: number;
  /** Where limbs and the head attach, in torso space (origin = the hips). */
  readonly hipX: number;
  readonly shoulderX: number;
  readonly shoulderY: number;
  readonly neckY: number;
  /** Radius of the sash that shows the player's colour. */
  readonly sashRadius: number;
  /** Size of arm parts on this body (a skeleton's arms are slimmer than a brute's). */
  readonly armScale: number;
  /** The part of the body the arms must stay out of (torso space): a vertical capsule. */
  readonly collider: Omit<TorsoCapsule, 'node'>;
  torso(): Piece[];
  head(): Piece[];
}

const BRUTE_CHEST: Profile = [[0.01, 0.1], [0.46, 0.12], [0.52, 0.4], [0.5, 0.7], [0.6, 0.98], [0.58, 1.2], [0.36, 1.36], [0.2, 1.42], [0.01, 1.44]];

const BRUTE: BodyDef = {
  id: 0,
  name: 'Stitched Brute',
  scale: 1,
  torsoScale: 0.72,
  skin: C.brute,
  hipX: 0.32,
  shoulderX: 0.84,
  shoulderY: 1.1,
  neckY: 1.52,
  sashRadius: 0.5,
  armScale: 1,
  collider: { y0: 0.45, y1: 1.2, r: 0.62 },
  torso: () =>
    cached('brute-torso', () => {
      const s = new Shape();
      // ragged shorts with a rope belt and a tattered hem
      s.lathe([[0.01, -0.2], [0.47, -0.2], [0.53, -0.08], [0.5, 0.14], [0.45, 0.22], [0.01, 0.22]], 10, C.shorts, { s: [1, 1, 0.9] });
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        s.cone(0.07, i % 2 === 0 ? 0.2 : 0.13, 4, C.shorts, { p: [Math.sin(a) * 0.5, -0.27, Math.cos(a) * 0.45], r: [Math.PI, 0, 0] });
      }
      s.ring(0.5, 0.035, C.strap, { p: [0, 0.2, 0], s: [1, 1, 0.9] });
      s.cyl(0.06, 0.06, 0.04, 8, C.steelLight, { p: [0, 0.2, 0.46], r: [Math.PI / 2, 0, 0] }); // buckle
      // the body: one smooth shape, then muscle on top
      s.lathe(BRUTE_CHEST, 14, C.brute, { s: [1.1, 1, 0.8] });
      s.blob(0.36, 0.34, 0.26, C.bruteLight, { p: [0, 0.46, 0.2] }, 1); // belly
      for (const sx of [-1, 1]) s.blob(0.34, 0.2, 0.13, C.brute, { p: [sx * 0.3, 1.02, 0.3], r: [0.15, 0, sx * 0.1] }, 1); // chest
      s.blob(0.46, 0.4, 0.3, C.bruteDark, { p: [0, 1.12, -0.38] }, 2); // back hump
      s.blob(0.32, 0.31, 0.3, C.brute, { p: [0.8, 1.14, 0] }, 2); // shoulders
      s.blob(0.32, 0.31, 0.3, C.patch, { p: [-0.8, 1.14, 0] }, 2); // the odd one: a patch of someone else's skin
      for (const sx of [-1, 1]) s.blob(0.3, 0.13, 0.22, C.brute, { p: [sx * 0.3, 1.36, -0.02], r: [0, 0, sx * -0.35] }, 1); // neck muscles
      s.cyl(0.17, 0.23, 0.26, 10, C.brute, { p: [0, 1.46, 0.03] }); // neck
      neckBolt(s, 1, 1.44, 0.03);
      neckBolt(s, -1, 1.44, 0.03);
      // stitches: a seam across the belly, a long scar down the chest, and thread round the odd shoulder
      ringSeam(s, BRUTE_CHEST, 1.1, 0.8, 0.78, -0.75, 0.75, 6, C.ink, 1, 0.13);
      s.seamPath([[0.18, 1.3, 0.39], [0.2, 1.15, 0.46], [0.2, 1.0, 0.48], [0.2, 0.86, 0.46]], [[0, 0.5, 0.8], [0, 0.2, 1], [0, 0, 1], [0, -0.2, 1]], 2, C.ink, 0.13);
      s.ring(0.3, 0.013, C.ink, { p: [-0.62, 1.14, 0], r: [0, Math.PI / 2, 0] }, Math.PI * 2, 3, 14);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        s.limb([-0.62, 1.14 + Math.cos(a) * 0.24, Math.sin(a) * 0.24], [-0.62, 1.14 + Math.cos(a) * 0.34, Math.sin(a) * 0.34], 0.013, 0.013, C.ink, 4);
      }
      return [{ geometry: s.build(), material: 'lit' }];
    }),
  head: () =>
    cached('brute-head', () => {
      const s = new Shape();
      // a flat-topped, square-jawed head
      s.lathe([[0.01, 0.0], [0.26, 0.0], [0.34, 0.12], [0.37, 0.3], [0.35, 0.46], [0.3, 0.55], [0.01, 0.56]], 14, C.brute, { s: [1, 1, 0.95], p: [0, 0, 0.05] });
      s.cyl(0.28, 0.3, 0.05, 12, C.bruteDark, { p: [0, 0.57, 0.05] }); // flat crown plate
      for (const sx of [-1, 1]) s.box(0.05, 0.06, 0.18, C.steel, { p: [sx * 0.17, 0.62, 0.05] }); // staples across the crown
      s.blob(0.34, 0.075, 0.14, C.bruteDark, { p: [0, 0.4, 0.3] }, 2); // heavy brow
      s.blob(0.3, 0.12, 0.22, C.bruteLight, { p: [0, 0.07, 0.22] }, 2); // underbite jaw
      s.blob(0.25, 0.03, 0.04, C.ink, { p: [0, 0.14, 0.4] }, 1); // mouth line
      for (const sx of [-1, 1]) {
        s.limb([sx * 0.15, 0.12, 0.38], [sx * 0.2, 0.34, 0.44], 0.055, 0.014, C.ivory, 8); // tusks curve up past the lip
        s.blob(0.075, 0.11, 0.05, C.brute, { p: [sx * 0.39, 0.3, 0.03] }, 1); // ears
        s.blob(0.04, 0.05, 0.03, C.bruteDark, { p: [sx * 0.41, 0.3, 0.05] },0);
        s.blob(0.07, 0.06, 0.06, C.bruteDark, { p: [sx * 0.14, 0.31, 0.3] },0); // eye sockets
      }
      s.blob(0.085, 0.07, 0.09, C.bruteLight, { p: [0, 0.27, 0.37] }, 1); // nose
      for (const sx of [-1, 1]) s.blob(0.025, 0.02, 0.02, C.ink, { p: [sx * 0.035, 0.24, 0.43] },0); // nostrils
      for (let i = 0; i < 4; i += 1) s.cone(0.03, 0.07, 5, C.ivory, { p: [-0.075 + i * 0.05, 0.16, 0.38] }); // teeth
      s.seam([-0.13, 0.5, 0.31], [0.12, 0.52, 0.31], [0, 0.3, 1], 4, C.ink, 0.09); // a scar across the forehead
      const eyes = new Shape({ paint: false });
      for (const sx of [-1, 1]) {
        eyes.blob(0.062, 0.055, 0.04, C.eyeYellow, { p: [sx * 0.14, 0.325, 0.325] },0);
        eyes.blob(0.025, 0.03, 0.02, C.ink, { p: [sx * 0.14, 0.325, 0.36] },0);
      }
      return [
        { geometry: s.build(), material: 'lit' },
        { geometry: eyes.build(), material: 'glow' },
      ];
    }),
};

const RATTLER: BodyDef = {
  id: 1,
  name: 'Bone Rattler',
  scale: 0.85,
  torsoScale: 0.95,
  skin: C.bone,
  hipX: 0.22,
  shoulderX: 0.5,
  shoulderY: 0.98,
  neckY: 1.3,
  sashRadius: 0.3,
  armScale: 0.68,
  collider: { y0: 0.35, y1: 1.0, r: 0.24 },
  torso: () =>
    cached('rattler-torso', () => {
      const s = new Shape();
      // pelvis: a wide bowl of bone with two hip sockets
      s.lathe([[0.01, -0.1], [0.2, -0.08], [0.26, 0.04], [0.22, 0.14], [0.01, 0.14]], 10, C.bone, { s: [1.2, 1, 0.7] });
      for (const sx of [-1, 1]) {
        s.blob(0.14, 0.12, 0.1, C.boneShade, { p: [sx * 0.25, 0.02, 0] }, 1);
        s.blob(0.05, 0.07, 0.04, C.ink, { p: [sx * 0.1, 0.0, 0.16] },0); // pelvic holes
      }
      // spine: a stack of knuckled vertebrae with spikes
      for (let i = 0; i < 8; i += 1) {
        const y = 0.2 + i * 0.12;
        s.blob(0.075, 0.06, 0.07, C.boneShade, { p: [0, y, -0.02] },0);
        s.cone(0.03, 0.1, 4, C.boneShade, { p: [0, y, -0.12], r: [-Math.PI / 2 - 0.2, 0, 0] });
      }
      // ribs: curved bars that wrap round from the spine to the breastbone, shorter toward the top
      for (let i = 0; i < 6; i += 1) {
        const y = 0.38 + i * 0.12;
        const w = 0.36 - i * 0.02;
        s.ring(w, 0.026, C.rib, { p: [0, y, 0.02], s: [1, 1, 0.78] }, Math.PI * 1.55, 4, 9);
      }
      s.tube([[0, 0.38, 0.29], [0, 0.65, 0.31], [0, 0.95, 0.27]], 0.05, 0.04, C.bone, 6, 6); // breastbone
      s.blob(0.07, 0.09, 0.05, C.bone, { p: [0, 0.97, 0.27] }, 1);
      for (const sx of [-1, 1]) {
        s.tube([[sx * 0.05, 1.02, 0.12], [sx * 0.25, 1.05, 0.1], [sx * 0.46, 1.0, 0.0]], 0.035, 0.03, C.bone, 6, 6); // collar bones
        s.blob(0.16, 0.2, 0.05, C.boneShade, { p: [sx * 0.28, 0.9, -0.17], r: [0.2, 0, sx * -0.3] }, 1); // shoulder blades
        s.blob(0.06, 0.06, 0.06, C.bone, { p: [sx * 0.48, 0.99, 0] },0); // shoulder knobs
      }
      s.cyl(0.05, 0.06, 0.24, 8, C.bone, { p: [0, 1.2, 0.02] }); // neck
      s.blob(0.07, 0.05, 0.07, C.boneShade, { p: [0, 1.12, 0.02] },0);
      // a crack in one rib
      s.seam([-0.12, 0.55, 0.27], [-0.2, 0.73, 0.22], [-0.3, 0, 1], 3, C.ink, 0.07);
      return [{ geometry: s.build(), material: 'lit' }];
    }),
  head: () =>
    cached('rattler-head', () => {
      const s = new Shape();
      s.lathe([[0.01, 0.1], [0.14, 0.12], [0.24, 0.22], [0.27, 0.34], [0.22, 0.46], [0.01, 0.52]], 14, C.bone, { s: [1, 1, 1.08], p: [0, 0, 0.04] }); // cranium
      s.blob(0.15, 0.1, 0.12, C.bone, { p: [0, 0.2, 0.22] }, 2); // cheekbones and upper jaw
      for (const sx of [-1, 1]) s.blob(0.1, 0.09, 0.07, C.ink, { p: [sx * 0.11, 0.31, 0.22] }, 1); // eye sockets
      s.blob(0.04, 0.06, 0.03, C.ink, { p: [0, 0.2, 0.31] },0); // nose hole
      s.blob(0.14, 0.06, 0.12, C.boneShade, { p: [0, 0.04, 0.13] }, 2); // jaw
      for (let i = 0; i < 6; i += 1) {
        s.box(0.035, 0.05, 0.03, C.ivory, { p: [-0.09 + i * 0.036, 0.12, 0.26] }); // upper teeth
        if (i > 0 && i < 5) s.box(0.035, 0.04, 0.03, C.ivory, { p: [-0.07 + (i - 1) * 0.035, 0.07, 0.26] }); // lower teeth
      }
      s.seam([-0.02, 0.5, 0.1], [0.12, 0.38, 0.22], [0.3, 0.5, 1], 3, C.ink, 0.06); // a crack across the skull
      const eyes = new Shape({ paint: false });
      for (const sx of [-1, 1]) {
        eyes.blob(0.042, 0.042, 0.03, C.eyeGreen, { p: [sx * 0.11, 0.31, 0.26] },0);
        eyes.blob(0.016, 0.016, 0.015, 0xffffff, { p: [sx * 0.11, 0.315, 0.29] },0);
      }
      return [
        { geometry: s.build(), material: 'lit' },
        { geometry: eyes.build(), material: 'glow' },
      ];
    }),
};

export const BODY_DEFS: readonly BodyDef[] = [BRUTE, RATTLER];

// ---------- helpers for building rigs ----------

function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const child of children) g.add(child);
  return g;
}

function meshGroup(pieces: readonly Piece[]): THREE.Group {
  return group(...meshes(pieces));
}

/// ---------- legs ----------

export interface LegDef {
  readonly id: number;
  readonly name: string;
  /** Distance from the hips to the ground. */
  readonly hipHeight: number;
  /** Ground covered by one full step cycle, in metres (decides how fast the legs move for a given speed). */
  readonly stride: number;
  create(body: BodyDef): Rig;
}

/** Capsules for a two-segment leg: thigh and shin hang from the hip, the foot from the ankle. */
function legProbes(thigh: THREE.Object3D, shin: THREE.Object3D, side: number, thighR: number, shinR: number, footR: number): Probe[] {
  return [
    { node: thigh, a: [0, -0.05, 0.04], b: [0, -0.38, 0.14], r: thighR, kind: 'leg', side, spread: thigh },
    { node: shin, a: [0, 0, 0], b: [0, -0.42, -0.23], r: shinR, kind: 'leg', side, spread: thigh },
    { node: shin, a: [0, -0.42, -0.23], b: [0, -0.5, 0.12], r: footR, kind: 'leg', side, spread: thigh },
  ];
}

/** Digitigrade fur legs with claws: thigh forward-down, shin back-down, foot forward. */
const WEREWOLF_LEGS: LegDef = {
  id: 1,
  name: 'Werewolf Legs',
  hipHeight: 1.0,
  stride: 2.0,
  create(body) {
    const thighPieces = cached('wolf-thigh', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0, -0.5, 0.18], 0.22, 0.15, C.fur);
      s.blob(0.25, 0.33, 0.27, C.fur, { p: [0, -0.17, 0.05] }, 2); // thick haunch
      s.blob(0.18, 0.2, 0.17, C.furLight, { p: [0, -0.12, 0.2] }, 1); // lighter front of the thigh
      s.blob(0.2, 0.2, 0.2, C.furDark, { p: [0, -0.5, 0.18] }, 1); // knee joint (the shin swings about this ball)
      for (let i = 0; i < 6; i += 1) {
        // a ruff of fur down the back of the thigh
        s.cone(0.07, 0.24 - i * 0.015, 4, C.furDark, { p: [(i % 2 === 0 ? 0.08 : -0.08), -0.05 - i * 0.08, -0.18 + i * 0.02], r: [-0.55, 0, (i % 2 === 0 ? 0.25 : -0.25)] });
      }
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const shinPieces = cached('wolf-shin', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0, -0.42, -0.23], 0.15, 0.09, C.fur); // its open top end sits inside the thigh's knee ball
      s.blob(0.11, 0.2, 0.1, C.fur, { p: [0, -0.15, -0.09], r: [0.5, 0, 0] }, 1); // calf muscle
      s.blob(0.13, 0.13, 0.13, C.furDark, { p: [0, -0.42, -0.23] }, 1); // ankle
      s.limb([0, -0.42, -0.23], [0, -0.5, 0.12], 0.11, 0.08, C.furDark); // foot
      s.blob(0.1, 0.05, 0.14, C.pad, { p: [0, -0.5, 0.12] }, 1); // paw pad
      for (const dx of [-0.06, 0, 0.06]) {
        s.blob(0.045, 0.04, 0.06, C.furDark, { p: [dx, -0.5, 0.2] },0); // toes
        s.limb([dx, -0.49, 0.24], [dx, -0.56, 0.34], 0.03, 0.006, C.ivory, 6); // curved claws
      }
      s.cone(0.035, 0.15, 5, C.ivory, { p: [0, -0.4, -0.31], r: [-Math.PI / 2 - 0.3, 0, 0] }); // heel spur
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    const legs = [1, -1].map((side) => {
      const thigh = meshGroup(thighPieces);
      thigh.position.set(side * body.hipX, 0, 0);
      const shin = meshGroup(shinPieces);
      shin.position.set(0, -0.5, 0.18);
      thigh.add(shin);
      root.add(thigh);
      return { thigh, shin, side };
    });
    return {
      root,
      probes: legs.flatMap(({ thigh, shin, side }) => legProbes(thigh, shin, side, 0.25, 0.13, 0.1)),
      animate: (m) => {
        legs.forEach((leg, i) => {
          const ph = m.phase + (i === 0 ? 0 : Math.PI);
          leg.thigh.rotation.x = -Math.sin(ph) * 0.85 * m.amp + 0.12; // negative swings the foot forward
          leg.shin.rotation.x = 0.2 + 1.2 * Math.max(0, Math.cos(ph)) * m.amp; // the knee folds while the leg swings forward
        });
      },
    };
  },
};

/**
 * Six jointed legs, walking in two alternating triples. Each leg is two segments solved with two-bone IK, so the foot
 * follows a real step path: it lifts and swings forward, then plants and slides back as the body passes over it, and
 * the knee bends to suit. At rest the legs stand splayed (the front ones reach forward, the rear ones back).
 */
const SPIDER_LEGS: LegDef = {
  id: 2,
  name: 'Spider Legs',
  hipHeight: 0.72,
  stride: 1.1,
  create(body) {
    const UPPER = 0.7, LOWER = 1.15;
    const upperPieces = cached('spider-upper', () => {
      const s = new Shape();
      s.blob(0.13, 0.13, 0.13, C.spider, { p: [0, 0, 0] }, 1); // hip joint
      s.limb([0, 0, 0], [UPPER, 0, 0], 0.1, 0.075, C.spider);
      s.blob(0.2, 0.1, 0.1, C.spiderMid, { p: [UPPER * 0.35, 0.04, 0] }, 1); // muscle
      for (const k of [0.3, 0.55, 0.8]) s.cone(0.03, 0.1, 4, C.ivory, { p: [UPPER * k, 0.09, 0], r: [0, 0, 0.2] }); // bristles
      s.blob(0.115, 0.115, 0.115, C.spiderGlow, { p: [UPPER, 0, 0] }, 1); // knee
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const lowerPieces = cached('spider-lower', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [LOWER, 0, 0], 0.075, 0.03, C.spider);
      for (const k of [0.25, 0.5, 0.75]) s.cone(0.022, 0.09, 4, C.ivory, { p: [LOWER * k, 0.06, 0], r: [0, 0, 0.3] }); // bristles
      s.limb([LOWER - 0.02, 0, 0], [LOWER + 0.14, -0.07, 0], 0.03, 0.005, C.ivory, 6); // hooked claw
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    const rowZ = [0.34, 0, -0.34];
    const rowReach = [0.34, 0, -0.34]; // how far forward or back each row's foot rests from its hip
    const legs: { hip: THREE.Group; upper: THREE.Group; lower: THREE.Group; side: number; row: number; group: number }[] = [];
    for (const side of [1, -1]) {
      rowZ.forEach((z, row) => {
        const hip = new THREE.Group();
        hip.position.set(side * body.hipX * 0.5, 0, z);
        const upper = meshGroup(upperPieces);
        const lower = meshGroup(lowerPieces);
        lower.position.set(UPPER, 0, 0);
        upper.add(lower);
        hip.add(upper);
        root.add(hip);
        legs.push({ hip, upper, lower, side, row, group: (row + (side === 1 ? 0 : 1)) % 2 }); // alternating tripod
      });
    }
    const probes: Probe[] = legs.flatMap((leg) => [
      { node: leg.upper, a: [0, 0, 0] as V3, b: [UPPER, 0, 0] as V3, r: 0.1, kind: 'leg' as const, side: leg.side },
      { node: leg.lower, a: [0, 0, 0] as V3, b: [LOWER, 0, 0] as V3, r: 0.075, kind: 'leg' as const, side: leg.side },
    ]);
    const REST_OUT = 1.0; // sideways distance from the body to the planted foot
    const REST_Y = -0.72; // the foot rests on the ground, below the hip
    const STEP = 0.3; // half the stride, in leg units
    const LIFT = 0.34;
    const ease = (t: number): number => t * t * (3 - 2 * t);
    return {
      root,
      probes,
      animate: (m) => {
        for (const leg of legs) {
          const u = (((m.phase / (Math.PI * 2) + leg.group * 0.5) % 1) + 1) % 1; // 0..1 through the step cycle
          let along = 0, lift = 0;
          if (u < 0.45) {
            const t = u / 0.45; // swing: lift the foot and put it down ahead
            along = -STEP + 2 * STEP * ease(t);
            lift = Math.sin(Math.PI * t) * LIFT;
          } else {
            along = STEP - 2 * STEP * ((u - 0.45) / 0.55); // stance: the foot stays put while the body moves over it
          }
          along *= m.amp;
          lift *= m.amp;
          // an idle shuffle so a standing monster is never frozen
          const idle = (1 - m.amp) * Math.sin(m.time * 1.6 + leg.row * 1.3 + leg.side) * 0.03;
          const dx = leg.side * REST_OUT - leg.side * body.hipX * 0.5;
          const dz = rowReach[leg.row]! + along + idle;
          const reach = Math.hypot(dx, dz);
          const y = REST_Y + lift;
          // two-bone IK in the vertical plane through the hip and the foot, knee up
          const d = Math.max(Math.abs(UPPER - LOWER) + 0.05, Math.min(UPPER + LOWER - 0.02, Math.hypot(reach, y)));
          const hipAngle = Math.atan2(y, reach) + Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - LOWER * LOWER) / (2 * UPPER * d))));
          const kneeInterior = Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + LOWER * LOWER - d * d) / (2 * UPPER * LOWER))));
          leg.hip.rotation.y = Math.atan2(-dz, dx); // turn the leg's plane toward the foot
          leg.upper.rotation.z = hipAngle;
          leg.lower.rotation.z = -(Math.PI - kneeInterior);
        }
      },
    };
  },
};

/** No legs equipped: two short stumps, so the monster shuffles along low to the ground. */
const STUMPS: LegDef = {
  id: 0,
  name: 'Stumps',
  hipHeight: 0.4,
  stride: 0.7,
  create(body) {
    const pieces = cached(`stump-${body.id}`, () => {
      const s = new Shape();
      s.cyl(0.14, 0.18, 0.3, 10, body.skin, { p: [0, -0.15, 0] });
      s.blob(0.14, 0.09, 0.2, body.skin, { p: [0, -0.3, 0.06] }, 1); // a lump of a foot
      s.ring(0.15, 0.014, C.ink, { p: [0, -0.18, 0] }, Math.PI * 2, 4, 14); // stitched round the middle
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        s.limb([Math.sin(a) * 0.14, -0.14, Math.cos(a) * 0.14], [Math.sin(a) * 0.17, -0.22, Math.cos(a) * 0.17], 0.012, 0.012, C.ink, 4);
      }
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    const stumps = [1, -1].map((side) => {
      const stump = meshGroup(pieces);
      stump.position.set(side * body.hipX, -0.1, 0);
      root.add(stump);
      return stump;
    });
    return {
      root,
      animate: (m) => {
        stumps.forEach((stump, i) => {
          const ph = m.phase + (i === 0 ? 0 : Math.PI);
          stump.rotation.x = -Math.sin(ph) * 0.5 * m.amp;
          stump.position.y = -0.1 + Math.max(0, Math.cos(ph)) * 0.1 * m.amp;
        });
      },
    };
  },
};

/** Frog-green haunches with spring coils round the shins and big flat feet; they crouch to charge and tuck in the air. */
const HOPPER_LEGS: LegDef = {
  id: 3,
  name: 'Hopper Haunches',
  hipHeight: 1.0,
  stride: 1.6,
  create(body) {
    const thighPieces = cached('hop-thigh', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0, -0.5, 0.18], 0.26, 0.17, C.hop);
      s.blob(0.29, 0.34, 0.3, C.hop, { p: [0, -0.18, 0.04] }, 2); // big haunch
      s.blob(0.14, 0.18, 0.1, C.hopLight, { p: [0.12, -0.12, 0.28], r: [0, 0, 0.3] }, 1); // pale belly side
      for (const [x, y, z, r] of [[-0.12, -0.05, -0.2, 0.06], [0.1, -0.2, -0.22, 0.05], [-0.04, -0.3, -0.12, 0.045]] as const) s.blob(r, r, r, C.hopDark, { p: [x, y, z] }, 1); // warts
      s.blob(0.19, 0.19, 0.19, C.hopDark, { p: [0, -0.5, 0.18] }, 1); // knee
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const shinPieces = cached('hop-shin', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0, -0.42, -0.23], 0.12, 0.08, C.hopDark);
      for (let i = 0; i < 2; i += 1) s.ring(0.13, 0.03, C.spring, { p: [0, -0.11 - i * 0.13, -0.06 - i * 0.07], r: [0.5, 0, 0] }, Math.PI * 2, 4, 12); // spring coils
      s.blob(0.13, 0.13, 0.13, C.hopDark, { p: [0, -0.42, -0.23] }, 1); // ankle
      s.limb([0, -0.42, -0.23], [0, -0.5, 0.2], 0.13, 0.1, C.hop); // long foot
      s.blob(0.15, 0.04, 0.17, C.hopDark, { p: [0, -0.5, 0.2] }, 1); // flat pad
      for (const dx of [-0.1, 0, 0.1]) {
        s.limb([dx * 0.7, -0.49, 0.3], [dx * 1.5, -0.5, 0.46], 0.04, 0.035, C.hop, 6); // webbed toes
        s.cyl(0.05, 0.05, 0.03, 8, C.hopLight, { p: [dx * 1.5, -0.5, 0.47], r: [Math.PI / 2, 0, 0] }); // sticky toe pads
      }
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    // On a slender body the haunches are slimmed and held straighter, so they read as legs rather than a frog's
    const slim = body.hipX < 0.3;
    const legs = [1, -1].map((side) => {
      const thigh = meshGroup(thighPieces);
      thigh.position.set(side * body.hipX, 0, 0);
      if (slim) thigh.scale.set(0.62, 1, 0.68);
      const shin = meshGroup(shinPieces);
      shin.position.set(0, -0.5, 0.18);
      thigh.add(shin);
      root.add(thigh);
      return { thigh, shin, side };
    });
    return {
      root,
      probes: legs.flatMap(({ thigh, shin, side }) => legProbes(thigh, shin, side, slim ? 0.19 : 0.28, slim ? 0.1 : 0.14, 0.13)),
      animate: (m) => {
        legs.forEach((leg, i) => {
          // Both legs push together like a frog's: little bounding strides, not an alternating run.
          const ph = m.phase + (i === 0 ? 0 : 0.5);
          let thigh = -Math.sin(ph) * (slim ? 0.45 : 0.6) * m.amp + (slim ? 0.02 : 0.12);
          let shin = (slim ? 0.12 : 0.25) + (slim ? 0.65 : 0.9) * Math.max(0, Math.cos(ph)) * m.amp;
          thigh += m.charge * 0.55; // crouch: knees forward
          shin += m.charge * 0.9;
          if (m.airborne) {
            thigh = -0.7;
            shin = 1.5; // tucked up in the air
          }
          leg.thigh.rotation.x = thigh;
          leg.shin.rotation.x = shin;
        });
      },
    };
  },
};

export const LEG_DEFS: readonly LegDef[] = [STUMPS, WEREWOLF_LEGS, SPIDER_LEGS, HOPPER_LEGS];

// ---------- arms ----------

export interface ArmDef {
  readonly id: number;
  readonly name: string;
  create(body: BodyDef): Rig;
}

/** Shoulder anchor group for each side, in torso space. */
function shoulders(body: BodyDef, root: THREE.Group): THREE.Group[] {
  return [1, -1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * body.shoulderX, body.shoulderY, 0);
    g.scale.setScalar(body.armScale);
    root.add(g);
    return g;
  });
}

const NUBS: ArmDef = {
  id: 0,
  name: 'No arms',
  create(body) {
    const pieces = cached(`nub-${body.id}`, () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0.04, -0.2, 0.04], 0.13, 0.1, body.skin);
      s.blob(0.11, 0.1, 0.11, body.skin, { p: [0.04, -0.22, 0.04] }, 1);
      s.ring(0.115, 0.012, C.ink, { p: [0.03, -0.1, 0.02] }, Math.PI * 2, 4, 12); // stitched where the arm should be
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    const nubs = shoulders(body, root).map((anchor) => {
      const nub = meshGroup(pieces);
      anchor.add(nub);
      return nub;
    });
    return {
      root,
      animate: (m) => {
        nubs.forEach((nub, i) => {
          nub.rotation.x = Math.sin(m.phase + (i === 0 ? Math.PI : 0)) * 0.5 * m.amp;
        });
      },
    };
  },
};

/** Two long wavy tentacles in three segments that trail behind when running and reach out when grabbing. */
const TENTACLES: ArmDef = {
  id: 1,
  name: 'Tentacles',
  create(body) {
    const segment = (index: number): Piece[] =>
      cached(`tentacle-seg-${index}`, () => {
        const widths = [0.24, 0.18, 0.12, 0.05];
        const w0 = widths[index]!, w1 = widths[index + 1]!;
        const color = index === 2 ? C.tentacleTip : C.tentacle;
        const s = new Shape();
        if (index === 0) {
          s.blob(w0 * 1.12, w0 * 1.05, w0 * 1.12, color, { p: [0, 0.02, 0] }, 2); // ball joint: the tentacle grows out of the shoulder, not onto it
          s.ring(w0 * 1.02, 0.035, C.tentacleDark, { p: [0, -0.07, 0] }, Math.PI * 2, 4, 14); // a darker collar where it leaves the ball
        }
        s.limb([0, 0, 0], [0, -0.5, 0], w0, w1, color, 8, index === 2);
        s.blob(w1 * 1.04, w1 * 1.04, w1 * 1.04, color, { p: [0, -0.5, 0] }, 1); // joint: the next segment bends about here
        s.blob(w0 * 0.9, 0.2, w0 * 0.5, C.tentacleDark, { p: [0, -0.18, -w0 * 0.6] }, 1); // a darker back
        for (let k = 0; k < 2; k += 1) {
          // a column of suckers down the inside
          const y = -0.14 - k * 0.2;
          const r = w0 + (w1 - w0) * (-y / 0.5);
          s.cyl(0.05 - index * 0.008, 0.045 - index * 0.008, 0.04, 6, C.tentacleTip, { p: [0, y, r * 0.93], r: [Math.PI / 2, 0, 0] });
        }
        return [{ geometry: s.build(), material: 'lit' as MatKind }];
      });
    const root = new THREE.Group();
    const tentacles = shoulders(body, root).map((anchor, i) => {
      const side = i === 0 ? 1 : -1;
      const segs: THREE.Group[] = [];
      let parent: THREE.Object3D = anchor;
      for (let k = 0; k < 3; k += 1) {
        const seg = meshGroup(segment(k));
        if (k > 0) seg.position.set(0, -0.5, 0);
        parent.add(seg);
        segs.push(seg);
        parent = seg;
      }
      return { segs, side, anchor };
    });
    const radii = [0.22, 0.16, 0.09];
    return {
      root,
      probes: tentacles.flatMap(({ segs, side, anchor }) => segs.map((seg, k): Probe => ({ node: seg, a: [0, 0, 0], b: [0, -0.5, 0], r: radii[k]!, kind: 'arm', side, spread: anchor }))),
      animate: (m) => {
        for (const { segs, side } of tentacles) {
          const wave = m.time * 3 + side * 1.3;
          const swing = m.swinging ? -2.4 : Math.sin(m.phase + (side === 1 ? Math.PI : 0)) * 0.4 * m.amp + 0.3 * m.amp;
          segs.forEach((seg, k) => {
            seg.rotation.x = (k === 0 ? swing : 0) + Math.sin(wave + k * 0.9) * (m.swinging ? 0.06 : 0.28) + (m.swinging ? 0 : 0.35 * m.amp);
            seg.rotation.z = (k === 0 ? side * 0.22 : 0) + Math.sin(wave * 0.7 + k) * 0.12 * side;
          });
        }
      },
    };
  },
};

/** Big pincers on thick arms; the top jaw opens and snaps shut. */
const CLAWS: ArmDef = {
  id: 2,
  name: 'Crab Claws',
  create(body) {
    const armPieces = cached('claw-arm', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0.08, -0.42, 0.1], 0.14, 0.11, C.claw);
      s.blob(0.13, 0.13, 0.13, C.clawLight, { p: [0.08, -0.42, 0.1] }, 1); // elbow
      for (const dz of [-1, 1]) s.cone(0.04, 0.12, 4, C.ivory, { p: [0.08 + dz * 0.08, -0.42, 0.1 - dz * 0.05], r: [0, 0, dz * -Math.PI / 2] }); // elbow spikes
      s.limb([0.08, -0.42, 0.1], [0.02, -0.72, 0.42], 0.11, 0.13, C.claw);
      for (let i = 0; i < 3; i += 1) s.ring(0.12, 0.018, C.clawDark, { p: [0.07 - i * 0.015, -0.52 - i * 0.09, 0.2 + i * 0.1], r: [1.1, 0, 0] }, Math.PI * 2, 4, 10); // shell ridges
      s.blob(0.17, 0.15, 0.24, C.clawLight, { p: [0.02, -0.8, 0.5] }, 2); // claw palm
      // fixed lower pincer: a curved horn with a few teeth along its inside edge
      s.tube([[0.02, -0.84, 0.55], [0.02, -0.9, 0.78], [0.02, -0.84, 1.02]], 0.12, 0.016, C.ivory, 6, 8);
      for (let i = 0; i < 3; i += 1) s.cone(0.03, 0.08, 4, C.ivory, { p: [0.02, -0.8 - Math.abs(i - 1) * 0.015, 0.68 + i * 0.1] });
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const jawPieces = cached('claw-jaw', () => {
      const s = new Shape();
      s.tube([[0, 0.0, 0.0], [0, 0.06, 0.24], [0, -0.04, 0.5]], 0.12, 0.016, C.ivory, 6, 8);
      for (let i = 0; i < 3; i += 1) s.cone(0.03, 0.08, 4, C.ivory, { p: [0, 0.0 - Math.abs(i - 1) * 0.01, 0.16 + i * 0.1], r: [Math.PI, 0, 0] });
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = new THREE.Group();
    const arms = shoulders(body, root).map((anchor, i) => {
      const side = i === 0 ? 1 : -1;
      const arm = meshGroup(armPieces);
      if (side === -1) arm.scale.x = -1; // mirrored: the arm is built for the left side
      const jaw = meshGroup(jawPieces);
      jaw.position.set(0.02, -0.76, 0.58);
      arm.add(jaw);
      anchor.add(arm);
      return { arm, jaw, side, anchor };
    });
    // A mirrored (negative-scale) mesh needs its faces flipped back, so cull nothing on the claw arms.
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = MATERIALS.lit;
    });
    return {
      root,
      probes: arms.flatMap(({ arm, side, anchor }): Probe[] => [
        { node: arm, a: [0, 0, 0], b: [0.08, -0.42, 0.1], r: 0.15, kind: 'arm', side, spread: anchor },
        { node: arm, a: [0.08, -0.42, 0.1], b: [0.02, -0.72, 0.42], r: 0.14, kind: 'arm', side, spread: anchor },
        { node: arm, a: [0.02, -0.8, 0.5], b: [0.02, -0.8, 0.66], r: 0.19, kind: 'arm', side, spread: anchor },
      ]),
      animate: (m) => {
        for (const { arm, jaw, side } of arms) {
          arm.rotation.x = -Math.sin(m.phase + (side === 1 ? Math.PI : 0)) * 0.55 * m.amp - 0.2;
          const idle = 0.35 + Math.sin(m.time * 2.2 + side) * 0.18;
          jaw.rotation.x = -(m.snap > 0.05 ? (1 - m.snap) * 0.7 : idle);
        }
      },
    };
  },
};

export const ARM_DEFS: readonly ArmDef[] = [NUBS, TENTACLES, CLAWS];

// ---------- heads ----------

export interface HeadDef {
  readonly id: number;
  readonly name: string;
  /** True when this part replaces the body's own head. */
  readonly replacesHead: boolean;
  create(body: BodyDef): Rig;
}

const NO_HEAD: HeadDef = { id: 0, name: 'No head part', replacesHead: false, create: () => ({ root: new THREE.Group(), animate: () => undefined }) };

/** A slimy lime cap dripping over the head; swells while a trail is being laid. */
const SLIME: HeadDef = {
  id: 1,
  name: 'Slime Gland',
  replacesHead: false,
  create() {
    const pieces = cached('slime-cap', () => {
      const s = new Shape();
      s.lathe([[0.01, 0.46], [0.34, 0.49], [0.41, 0.6], [0.35, 0.76], [0.17, 0.88], [0.01, 0.92]], 12, C.slime, { s: [1.05, 1, 1.02] }); // the dome
      s.blob(0.14, 0.09, 0.1, C.slimeLight, { p: [-0.17, 0.78, 0.2], r: [0.3, 0.3, 0] }, 1); // sheen
      for (const [x, y, z, r] of [[0.15, 0.62, 0.3, 0.07], [-0.26, 0.55, 0.2, 0.05], [0.28, 0.72, 0.05, 0.045], [0.0, 0.84, -0.1, 0.05]] as const) s.blob(r, r, r, C.slimeLight, { p: [x, y, z] }, 1); // bubbles
      for (const [x, z, len] of [[0.3, 0.14, 0.36], [-0.3, 0.22, 0.26], [0.05, 0.4, 0.32], [-0.05, -0.32, 0.3], [0.2, -0.26, 0.2]] as const) {
        s.limb([x, 0.52, z], [x * 1.04, 0.52 - len, z], 0.075, 0.035, C.slime, 8);
        s.blob(0.065, 0.085, 0.065, C.slime, { p: [x * 1.04, 0.5 - len, z] }, 1); // the drip's bulb
      }
      return [{ geometry: s.build(), material: 'slime' as MatKind }];
    });
    const root = meshGroup(pieces);
    return {
      root,
      animate: (m) => {
        const swell = m.trailing ? 1.2 : 1;
        const pulse = 1 + Math.sin(m.time * 3) * 0.03;
        root.scale.set(swell * pulse, swell / pulse, swell * pulse);
      },
    };
  },
};

/** A carved pumpkin with a glowing face and a flickering flame. */
const LANTERN: HeadDef = {
  id: 2,
  name: "Jack-o'-Lantern",
  replacesHead: true,
  create() {
    const pumpkin = cached('lantern-pumpkin', () => {
      const s = new Shape();
      // a ribbed pumpkin: a ring of fat lobes round a core
      s.blob(0.4, 0.4, 0.4, C.pumpkinDark, { p: [0, 0.34, 0.05], s: [1, 0.95, 1] }, 2);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        s.blob(0.24, 0.43, 0.24, i % 2 === 0 ? C.pumpkin : C.pumpkinLight, { p: [Math.sin(a) * 0.3, 0.34, 0.05 + Math.cos(a) * 0.28] }, 1);
      }
      // the lid is off: a dark, glowing hole in the top where the flame burns, with the stem tipped over behind it
      s.cyl(0.2, 0.22, 0.03, 12, 0x1a0a04, { p: [0, 0.725, 0.05] });
      s.ring(0.21, 0.035, C.pumpkinDark, { p: [0, 0.73, 0.05] }, Math.PI * 2, 4, 14);
      s.tube([[0, 0.6, -0.34], [0.02, 0.76, -0.38], [0.1, 0.88, -0.34]], 0.07, 0.05, C.stem, 6, 6);
      s.tube([[0.1, 0.84, -0.34], [0.24, 0.9, -0.3], [0.3, 0.78, -0.26], [0.22, 0.7, -0.24]], 0.012, 0.012, C.vine, 4, 12); // curling vine
      const face = new Shape({ paint: false });
      // carved face: triangle eyes and nose, a jagged grin with a dark hollow behind the glow
      for (const sx of [-1, 1]) face.add(new THREE.CircleGeometry(0.12, 3), C.eyeYellow, { p: [sx * 0.2, 0.45, 0.5], r: [0, 0, Math.PI / 2 + sx * 0.25] });
      face.add(new THREE.CircleGeometry(0.07, 3), C.eyeYellow, { p: [0, 0.31, 0.52], r: [0, 0, Math.PI / 2] });
      for (let i = 0; i < 7; i += 1) {
        const x = -0.3 + i * 0.1;
        const y = 0.13 + Math.sin((i / 6) * Math.PI) * 0.06 * -1 + 0.04;
        face.add(new THREE.CircleGeometry(0.058, 3), C.eyeYellow, { p: [x, y, 0.5 - Math.abs(x) * 0.3], r: [0, 0, i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2] });
      }
      return [
        { geometry: s.build(), material: 'lit' as MatKind },
        { geometry: face.build(), material: 'glow' as MatKind },
      ];
    });
    const flamePieces = cached('lantern-flame', () => [{ geometry: flameGeometry(0.52, 0.62, 8), material: 'flame' as MatKind }]);
    const inner = meshGroup(pumpkin);
    inner.scale.setScalar(0.86); // a little smaller than the first cut: the head should not dwarf the shoulders
    const flame = meshGroup(flamePieces);
    flame.position.set(0, 0.74, 0.05);
    const phase = Math.random() * 20; // so two lanterns never burn in step
    flame.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.onBeforeRender = (_r, _s, _c, _g, material) => {
        (material as THREE.ShaderMaterial).uniforms['uPhase']!.value = phase;
        (material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
      };
    });
    inner.add(flame);
    const root = group(inner);
    return {
      root,
      animate: (m) => {
        flameClock.value = m.time;
        // the flame leans back when running fast
        flame.rotation.x = -0.25 * m.speed01;
        flame.scale.setScalar(1 + 0.12 * m.speed01);
      },
    };
  },
};

/** A lumpy sack on the back of the head, held on by a strap; it swells when it carries a spare part (the HUD says which). */
const HUMP: HeadDef = {
  id: 3,
  name: 'Hunchback Hump',
  replacesHead: false,
  create() {
    const pieces = cached('hump-sack', () => {
      const s = new Shape();
      s.blob(0.42, 0.4, 0.38, C.sack, { p: [0, 0.15, -0.5] }, 2); // the lump
      s.blob(0.24, 0.22, 0.22, C.sackLight, { p: [-0.14, 0.34, -0.66] }, 1);
      s.blob(0.2, 0.2, 0.2, C.sack, { p: [0.22, -0.02, -0.62] }, 1);
      s.cone(0.14, 0.22, 7, C.sackDark, { p: [0, 0.54, -0.5], r: [0.15, 0, 0] }); // the gathered, tied-off top
      s.ring(0.12, 0.028, C.strap, { p: [0, 0.46, -0.5] }, Math.PI * 2, 4, 10);
      s.blob(0.16, 0.14, 0.03, C.sackDark, { p: [0.2, 0.26, -0.28], r: [0.1, 0.5, 0.3] }, 1); // a patch...
      s.seam([0.08, 0.3, -0.27], [0.32, 0.22, -0.3], [0.6, 0.4, 0.7], 4, C.ink, 0.07); // ...stitched on
      s.seam([0.1, 0.18, -0.28], [0.34, 0.12, -0.31], [0.6, 0.4, 0.7], 4, C.ink, 0.07);
      s.tube([[-0.3, 0.55, -0.2], [-0.15, 0.3, -0.12], [0.05, -0.1, -0.15]], 0.05, 0.05, C.strap, 6, 8); // strap over the shoulder
      s.cyl(0.075, 0.075, 0.1, 8, C.steelLight, { p: [0, 0.1, -0.12], r: [Math.PI / 2, 0, 0] }); // buckle
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const root = meshGroup(pieces);
    return {
      root,
      animate: (m) => {
        const pulse = 1 + Math.sin(m.time * 1.6) * 0.025 * (1 + m.speed01);
        root.scale.set(pulse, 1 / pulse, pulse);
      },
    };
  },
};

export const HEAD_DEFS: readonly HeadDef[] = [NO_HEAD, SLIME, LANTERN, HUMP];

/** The body's own head (skull or brute face), used unless a head part replaces it. */
export function baseHead(body: BodyDef): THREE.Group {
  return meshGroup(body.head());
}

export function torsoMeshes(body: BodyDef): THREE.Mesh[] {
  return meshes(body.torso());
}

export function clampIndex(value: number, length: number): number {
  return value < 0 || value >= length || !Number.isInteger(value) ? 0 : value;
}

export type { V3 };
