// Monster bodies and parts, modelled in code in the faceted low-poly style of the game's art (see public/thumbnail.jpg).
//
// A monster is a body with sockets plus swappable limbs and heads:
//   root (world pose) -> hips (height set by the legs) -> legs and torso -> arms and head on the torso.
// Every moving piece is one merged mesh (see shapes.ts). Part ids match src/sim/parts.ts (0 = nothing equipped).
// This file knows nothing about the simulation or the game; MonsterModel.ts drives it.

import * as THREE from 'three';
import { Shape, type V3 } from './shapes.js';

// ---------- materials (shared by every monster) ----------

export type MatKind = 'lit' | 'glow' | 'slime' | 'flame';

export const MATERIALS: Record<MatKind, THREE.Material> = {
  lit: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  slime: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1d6b10 }),
  flame: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
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
}

export interface Rig {
  readonly root: THREE.Group;
  animate(m: Motion): void;
}

// ---------- palette ----------

const C = {
  brute: 0x7d4cc7, bruteLight: 0x9b6fe6, bruteDark: 0x4a2a8a, ink: 0x1a1226, shorts: 0x5a4631, steel: 0x9aa0a8, ivory: 0xf3ecd2,
  bone: 0xe9e1c9, boneShade: 0xb9ae8c, rib: 0xd9d0b4, eyeYellow: 0xffe84a, eyeGreen: 0x6bff7a,
  fur: 0xf08a24, furDark: 0xb8541a, spider: 0x2a1c38, spiderGlow: 0xff7a1a,
  tentacle: 0xc44bd8, tentacleTip: 0xe27bf0, claw: 0xd8452e, clawLight: 0xe86a4a,
  pumpkin: 0xff8a1f, pumpkinDark: 0xd96a10, stem: 0x5a7a2a, flame: 0xffb347, slime: 0x7dff3a, slimeLight: 0xd4ff9a,
} as const;

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
  torso(): Piece[];
  head(): Piece[];
}

const BRUTE: BodyDef = {
  id: 0,
  name: 'Stitched Brute',
  scale: 1,
  torsoScale: 0.72,
  skin: C.brute,
  hipX: 0.32,
  shoulderX: 0.78,
  shoulderY: 1.1,
  neckY: 1.52,
  sashRadius: 0.5,
  torso: () =>
    cached('brute-torso', () => {
      const s = new Shape();
      s.cyl(0.46, 0.52, 0.36, 8, C.shorts, { p: [0, -0.02, 0] }); // ragged shorts
      for (let i = 0; i < 5; i += 1) s.cone(0.07, 0.16, 4, C.shorts, { p: [-0.36 + i * 0.18, -0.26, 0.2], r: [Math.PI, 0, 0] }); // tatters
      s.ico(0.5, 1, C.bruteLight, { p: [0, 0.44, 0.04], s: [1, 0.95, 0.85] }); // belly
      s.ico(0.62, 1, C.brute, { p: [0, 0.94, 0], s: [1.15, 0.85, 0.8] }); // chest
      s.ico(0.4, 0, C.brute, { p: [0, 1.15, -0.3], s: [1.15, 0.8, 0.7] }); // back hump
      for (const sx of [-1, 1]) s.ico(0.3, 0, C.brute, { p: [sx * 0.68, 1.14, 0] }); // shoulders
      s.cyl(0.17, 0.22, 0.26, 6, C.brute, { p: [0, 1.46, 0.03] }); // neck
      for (const sx of [-1, 1]) s.cyl(0.05, 0.05, 0.22, 6, C.steel, { p: [sx * 0.24, 1.42, 0.03], r: [0, 0, Math.PI / 2] }); // neck bolts
      // stitches: a seam across the belly and short diagonal threads across the chest
      s.box(0.78, 0.035, 0.03, C.ink, { p: [0, 0.76, 0.44] });
      for (let i = 0; i < 5; i += 1) s.box(0.03, 0.14, 0.03, C.ink, { p: [-0.32 + i * 0.16, 0.76, 0.46], r: [0, 0, 0.5] });
      s.box(0.03, 0.5, 0.03, C.ink, { p: [0.18, 1.0, 0.5], r: [0, 0, -0.25] });
      for (let i = 0; i < 4; i += 1) s.box(0.14, 0.03, 0.03, C.ink, { p: [0.17 + i * 0.012, 0.82 + i * 0.12, 0.5], r: [0, 0, 0.3] });
      return [{ geometry: s.build(), material: 'lit' }];
    }),
  head: () =>
    cached('brute-head', () => {
      const s = new Shape();
      s.ico(0.36, 1, C.brute, { p: [0, 0.3, 0.06], s: [1, 0.9, 0.95] });
      s.box(0.6, 0.1, 0.16, C.bruteDark, { p: [0, 0.4, 0.3] }); // heavy brow
      s.box(0.5, 0.16, 0.28, C.bruteLight, { p: [0, 0.1, 0.2] }); // underbite jaw
      for (const sx of [-1, 1]) {
        s.cone(0.05, 0.2, 4, C.ivory, { p: [sx * 0.17, 0.2, 0.34] }); // tusks
        s.ico(0.1, 0, C.brute, { p: [sx * 0.38, 0.3, 0.02] }); // ears
      }
      s.ico(0.08, 0, C.bruteLight, { p: [0, 0.27, 0.36] }); // nose
      const eyes = new Shape();
      for (const sx of [-1, 1]) eyes.box(0.1, 0.06, 0.04, C.eyeYellow, { p: [sx * 0.14, 0.33, 0.33] });
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
  torso: () =>
    cached('rattler-torso', () => {
      const s = new Shape();
      s.box(0.5, 0.16, 0.26, C.bone, { p: [0, 0, 0] }); // pelvis
      for (const sx of [-1, 1]) s.ico(0.15, 0, C.boneShade, { p: [sx * 0.24, 0.02, 0], s: [0.8, 1, 0.9] });
      s.cyl(0.05, 0.065, 1.0, 6, C.boneShade, { p: [0, 0.55, -0.02] }); // spine
      for (let i = 0; i < 6; i += 1) s.ring(0.34 - i * 0.022, 0.03, C.rib, { p: [0, 0.36 + i * 0.13, 0.02], s: [1, 0.72, 1] }); // ribs
      s.box(0.07, 0.72, 0.04, C.bone, { p: [0, 0.65, 0.27] }); // breastbone
      s.limb([-0.46, 1.02, 0], [0.46, 1.02, 0], 0.04, 0.04, C.bone); // collar bones
      for (const sx of [-1, 1]) s.ico(0.14, 0, C.boneShade, { p: [sx * 0.3, 0.98, -0.12], s: [1.1, 1, 0.4] }); // shoulder blades
      s.cyl(0.045, 0.05, 0.22, 5, C.bone, { p: [0, 1.2, 0.02] }); // neck
      return [{ geometry: s.build(), material: 'lit' }];
    }),
  head: () =>
    cached('rattler-head', () => {
      const s = new Shape();
      s.ico(0.27, 1, C.bone, { p: [0, 0.26, 0.05], s: [1, 0.95, 1.05] }); // skull
      s.box(0.3, 0.09, 0.22, C.boneShade, { p: [0, 0.04, 0.13] }); // jaw
      for (let i = 0; i < 4; i += 1) s.box(0.04, 0.05, 0.03, C.ivory, { p: [-0.09 + i * 0.06, 0.1, 0.25] }); // teeth
      for (const sx of [-1, 1]) s.ico(0.075, 0, C.ink, { p: [sx * 0.1, 0.3, 0.24] }); // eye sockets
      const eyes = new Shape();
      for (const sx of [-1, 1]) eyes.ico(0.042, 0, C.eyeGreen, { p: [sx * 0.1, 0.3, 0.28] });
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

// ---------- legs ----------

export interface LegDef {
  readonly id: number;
  readonly name: string;
  /** Distance from the hips to the ground. */
  readonly hipHeight: number;
  /** Ground covered by one full step cycle, in metres (decides how fast the legs move for a given speed). */
  readonly stride: number;
  create(body: BodyDef): Rig;
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
      s.ico(0.26, 1, C.fur, { p: [0, -0.17, 0.05], s: [1, 1.3, 1.1] });
      s.cone(0.07, 0.22, 4, C.furDark, { p: [0, -0.25, -0.12], r: [-0.5, 0, 0] }); // fur tufts
      s.cone(0.06, 0.18, 4, C.furDark, { p: [0.1, -0.12, -0.1], r: [-0.5, 0, 0.3] });
      s.cone(0.06, 0.18, 4, C.furDark, { p: [-0.1, -0.12, -0.1], r: [-0.5, 0, -0.3] });
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const shinPieces = cached('wolf-shin', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [0, -0.42, -0.23], 0.15, 0.09, C.fur);
      s.ico(0.12, 0, C.furDark, { p: [0, -0.42, -0.23] }); // ankle
      s.limb([0, -0.42, -0.23], [0, -0.5, 0.12], 0.11, 0.08, C.furDark); // foot
      for (const dx of [-0.05, 0, 0.05]) s.cone(0.025, 0.16, 4, C.ivory, { p: [dx, -0.5, 0.18], r: [Math.PI / 2 + 0.25, 0, 0] }); // claws
      s.cone(0.03, 0.14, 4, C.ivory, { p: [0, -0.4, -0.31], r: [-Math.PI / 2 - 0.3, 0, 0] }); // heel spur
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
      return { thigh, shin };
    });
    return {
      root,
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
      s.limb([0, 0, 0], [UPPER, 0, 0], 0.1, 0.075, C.spider);
      s.ico(0.1, 0, C.spiderGlow, { p: [UPPER, 0, 0] }); // knee
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const lowerPieces = cached('spider-lower', () => {
      const s = new Shape();
      s.limb([0, 0, 0], [LOWER, 0, 0], 0.075, 0.03, C.spider);
      s.cone(0.03, 0.14, 4, C.ivory, { p: [LOWER + 0.05, 0, 0], r: [0, 0, -Math.PI / 2] });
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
    const REST_OUT = 1.0; // sideways distance from the body to the planted foot
    const REST_Y = -0.72; // the foot rests on the ground, below the hip
    const STEP = 0.3; // half the stride, in leg units
    const LIFT = 0.34;
    const ease = (t: number): number => t * t * (3 - 2 * t);
    return {
      root,
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
      s.cyl(0.14, 0.18, 0.3, 6, body.skin, { p: [0, -0.15, 0] });
      s.ico(0.12, 0, body.skin, { p: [0, -0.3, 0.05], s: [1.1, 0.6, 1.4] });
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

export const LEG_DEFS: readonly LegDef[] = [STUMPS, WEREWOLF_LEGS, SPIDER_LEGS];

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
      s.ico(0.1, 0, body.skin, { p: [0.04, -0.22, 0.04] });
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
        const s = new Shape();
        s.limb([0, 0, 0], [0, -0.5, 0], widths[index]!, widths[index + 1]!, index === 2 ? C.tentacleTip : C.tentacle, 6);
        for (const dz of [0.04, -0.04]) s.ico(0.05 - index * 0.008, 0, C.tentacleTip, { p: [0, -0.25, dz > 0 ? widths[index]! : -widths[index]!], s: [1, 1, 1] }); // suckers
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
      return { segs, side };
    });
    return {
      root,
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
      s.ico(0.13, 0, C.clawLight, { p: [0.08, -0.42, 0.1] }); // elbow
      s.limb([0.08, -0.42, 0.1], [0.02, -0.72, 0.42], 0.11, 0.13, C.claw);
      s.ico(0.16, 1, C.clawLight, { p: [0.02, -0.8, 0.5], s: [1, 0.8, 1.3] }); // claw palm
      s.cone(0.1, 0.5, 4, C.ivory, { p: [0.02, -0.82, 0.86], r: [Math.PI / 2, 0, 0] }); // fixed lower pincer
      return [{ geometry: s.build(), material: 'lit' as MatKind }];
    });
    const jawPieces = cached('claw-jaw', () => {
      const s = new Shape();
      s.cone(0.1, 0.5, 4, C.ivory, { p: [0, 0, 0.25], r: [Math.PI / 2, 0, 0] });
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
      return { arm, jaw, side };
    });
    // A mirrored (negative-scale) mesh needs its faces flipped back, so cull nothing on the claw arms.
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = MATERIALS.lit;
    });
    return {
      root,
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
      s.ico(0.4, 1, C.slime, { p: [0, 0.6, 0.02], s: [1.1, 0.75, 1.05] });
      s.ico(0.14, 0, C.slimeLight, { p: [-0.16, 0.8, 0.12] }); // sheen
      for (const [x, z, len] of [[0.3, 0.12, 0.34], [-0.28, 0.2, 0.24], [0.05, 0.38, 0.3], [-0.05, -0.3, 0.3]] as const) {
        s.limb([x, 0.5, z], [x * 1.05, 0.5 - len, z], 0.07, 0.03, C.slime, 5);
        s.ico(0.06, 0, C.slime, { p: [x * 1.05, 0.5 - len, z] });
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
      s.ico(0.5, 1, C.pumpkin, { p: [0, 0.34, 0.05], s: [1.15, 0.95, 1.05] });
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        s.ico(0.16, 0, C.pumpkinDark, { p: [Math.sin(a) * 0.5, 0.34, 0.05 + Math.cos(a) * 0.46], s: [0.5, 1.9, 0.5] }); // ribs
      }
      s.cyl(0.07, 0.1, 0.22, 5, C.stem, { p: [0, 0.78, 0.05], r: [0.2, 0, 0.15] });
      const face = new Shape();
      for (const sx of [-1, 1]) face.box(0.12, 0.12, 0.05, C.eyeYellow, { p: [sx * 0.2, 0.42, 0.5], r: [0, 0, Math.PI / 4] });
      face.box(0.07, 0.07, 0.05, C.eyeYellow, { p: [0, 0.3, 0.52], r: [0, 0, Math.PI / 4] });
      for (let i = 0; i < 5; i += 1) face.box(0.09, 0.07, 0.05, C.eyeYellow, { p: [-0.24 + i * 0.12, 0.14 + (i % 2) * 0.06, 0.49] });
      return [
        { geometry: s.build(), material: 'lit' as MatKind },
        { geometry: face.build(), material: 'glow' as MatKind },
      ];
    });
    const flamePieces = cached('lantern-flame', () => {
      const s = new Shape();
      s.cone(0.14, 0.42, 4, C.flame, { p: [0, 1.0, 0.05] });
      s.cone(0.08, 0.3, 4, 0xfff0a0, { p: [0, 0.96, 0.05] });
      return [{ geometry: s.build(), material: 'flame' as MatKind }];
    });
    const inner = meshGroup(pumpkin);
    inner.scale.setScalar(0.86); // a little smaller than the first cut: the head should not dwarf the shoulders
    const flame = meshGroup(flamePieces);
    inner.add(flame);
    const root = group(inner);
    return {
      root,
      animate: (m) => {
        const flicker = 1 + Math.sin(m.time * 14) * 0.18 + Math.sin(m.time * 23) * 0.1;
        flame.scale.set(1 + (flicker - 1) * 0.4, flicker, 1 + (flicker - 1) * 0.4);
      },
    };
  },
};

export const HEAD_DEFS: readonly HeadDef[] = [NO_HEAD, SLIME, LANTERN];

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
