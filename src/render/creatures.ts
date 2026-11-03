// The things that live on the road: the stitched mimic chest behind every mystery box, and the three wandering creatures
// (a shambling zombie, a sheet ghost and a pumpkin walker). Modelled in code with the same kit and the same vocabulary
// as the monsters (smooth lathe bodies, rounded blobs for muscle and joints, ink stitches, glowing eyes; see
// monsters/parts.ts), so they look like they belong to the same world. Presentation only.
//
// Every model faces +Z, Y up, +X to its left, and stands on y = 0. Geometry is built once and shared between instances.

import * as THREE from 'three';
import { Shape, type V3 } from './monsters/shapes.js';
import { MATERIALS, withRim } from './monsters/parts.js';
import { GHOST_AURA_M, STOMP_RADIUS_M } from '../sim/events.js';

const lit = MATERIALS['lit'];
const glow = MATERIALS['glow'];
const ghostMat = withRim(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, emissive: 0x4c4c78, depthWrite: false }), 0xcdd8ff, 0.4);

/** Colours shared with the monsters' palette (monsters/parts.ts), so the whole cast reads as one set. */
const C = {
  ink: 0x1a1226,
  ivory: 0xf3ecd2,
  steel: 0x9aa0a8,
  steelDark: 0x5d636b,
  steelLight: 0xd5dae0,
  eyeYellow: 0xffe84a,
  eyeGreen: 0x6bff7a,
  thread: 0xe9d9ae,
  ember: 0xffb02e,
  strap: 0xff7a1a,
  chest: 0x8f55d6,
  chestDark: 0x6a36ad,
  chestLight: 0xa97ae8,
  skin: 0x7fc15a,
  skinDark: 0x58963f,
  skinLight: 0xa2dd7c,
  shirt: 0x7d4cc7,
  shirtDark: 0x4a2a8a,
  pants: 0x4f5a8a,
  boot: 0x3a2a30,
  sheet: 0xece9ff,
  sheetShade: 0xcfc9f4,
  pumpkin: 0xff8a1f,
  pumpkinDark: 0xd96a10,
  pumpkinLight: 0xffa84a,
  stem: 0x5a7a2a,
  vine: 0x6bbf3a,
  vineDark: 0x3d8a2a,
} as const;

const cache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (g === undefined) {
    g = build();
    g.name = key;
    cache.set(key, g);
  }
  return g;
}

const flat = (): Shape => new Shape({ paint: false });

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  parent.add(m);
  return m;
}

/** A limb segment with a rounded ball at each end, so joints are smooth like the monsters'. */
function segment(s: Shape, a: V3, b: V3, ra: number, rb: number, color: number, jointColor = color): void {
  s.limb(a, b, ra, rb, color, 8);
  s.blob(ra * 1.12, ra * 1.12, ra * 1.12, jointColor, { p: a }, 1);
  s.blob(rb * 1.12, rb * 1.12, rb * 1.12, jointColor, { p: b }, 1);
}

// ---------- the mimic chest (mystery box) ----------

/** The floating question mark, as one smooth tube plus a dot. */
function questionMark(s: Shape, y: number): void {
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = Math.PI * 0.95 - (i / 8) * Math.PI * 1.55;
    pts.push([Math.cos(a) * 0.3, y + 0.62 + Math.sin(a) * 0.3, 0]);
  }
  pts.push([0.0, y + 0.16, 0], [0, y + 0.0, 0]);
  s.tube(pts, 0.085, 0.085, C.ember, 8, 18);
  s.blob(0.1, 0.1, 0.1, C.ember, { p: [0, y - 0.2, 0] }, 1);
}

/** An arched chest lid: half a cylinder lying along X, from the front edge (z = 1.24) over the top to the hinge (z = 0). */
const archGeometry = (radius: number, length: number): THREE.BufferGeometry => new THREE.CylinderGeometry(radius, radius, length, 16, 1, false, 0, Math.PI);

export interface Crate {
  readonly root: THREE.Group;
  /** Chomps the lid; `t` in seconds. */
  animate(t: number): void;
}

const TOOTH_X_LOWER = [-0.52, -0.26, 0, 0.26, 0.52];
const TOOTH_X_UPPER = [-0.39, -0.13, 0.13, 0.39];

export function createCrate(): Crate {
  const root = new THREE.Group();
  mesh(
    root,
    geo('crate-base', () => {
      const s = new Shape();
      // a plump body with rounded corner posts, bun feet and a stitched mouth seam
      s.box(1.28, 0.78, 1.28, C.chest, { p: [0, 0.41, 0] });
      s.blob(0.64, 0.12, 0.64, C.chestDark, { p: [0, 0.05, 0] }, 1);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          s.cyl(0.1, 0.1, 0.84, 8, C.strap, { p: [sx * 0.64, 0.42, sz * 0.64] });
          s.blob(0.13, 0.13, 0.13, C.strap, { p: [sx * 0.64, 0.86, sz * 0.64] }, 1);
          s.blob(0.17, 0.12, 0.17, C.chestDark, { p: [sx * 0.6, 0.04, sz * 0.6] }, 1);
        }
      s.seam([-0.55, 0.3, 0.7], [0.55, 0.3, 0.7], [0, 0, 1], 8, C.thread, 0.14, 0.016);
      // neck bolts, one each side, like the Brute's
      for (const sx of [-1, 1]) {
        s.cyl(0.05, 0.05, 0.34, 8, C.steelDark, { p: [sx * 0.74, 0.46, 0], r: [0, 0, Math.PI / 2] });
        s.cyl(0.11, 0.11, 0.04, 10, C.steel, { p: [sx * 0.88, 0.46, 0], r: [0, 0, Math.PI / 2] });
        s.cyl(0.075, 0.075, 0.08, 6, C.steelLight, { p: [sx * 0.93, 0.46, 0], r: [0, 0, Math.PI / 2] });
      }
      // lower teeth: flattened fangs standing on the front rim, between the upper ones
      for (const x of TOOTH_X_LOWER) s.cone(0.1, 0.36, 5, C.ivory, { p: [x, 0.95, 0.67], s: [1, 1, 0.5] });
      return s.build();
    }),
    lit,
  );
  mesh(
    root,
    geo('crate-glow', () => {
      const s = flat();
      s.box(1.16, 0.1, 1.16, C.ember, { p: [0, 0.8, 0] });
      questionMark(s, 2.1);
      return s.build();
    }),
    glow,
  );
  // the lid hinges at the back edge and chomps
  const hinge = pivot(root, 0, 0.82, -0.62);
  mesh(
    hinge,
    geo('crate-lid', () => {
      const s = new Shape();
      s.add(archGeometry(0.64, 1.36), C.chestDark, { p: [0, 0, 0.62], r: [0, 0, Math.PI / 2], s: [1, 1, 0.74] });
      for (const x of [-0.46, 0, 0.46]) s.add(archGeometry(0.66, 0.15), C.strap, { p: [x, 0, 0.62], r: [0, 0, Math.PI / 2], s: [1, 1, 0.74] });
      s.blob(0.6, 0.1, 0.42, C.chest, { p: [0, 0.4, 0.5] }, 1);
      // upper teeth hang from the front edge, between the lower ones
      for (const x of TOOTH_X_UPPER) s.cone(0.1, 0.34, 5, C.ivory, { p: [x, -0.1, 1.27], r: [Math.PI, 0, 0], s: [1, 1, 0.5] });
      return s.build();
    }),
    lit,
  );
  mesh(
    hinge,
    geo('crate-eyes', () => {
      const s = flat();
      for (const sx of [-1, 1]) {
        s.blob(0.17, 0.2, 0.07, C.eyeYellow, { p: [sx * 0.3, 0.3, 1.1], r: [-0.6, 0, 0] }, 1);
        s.blob(0.07, 0.1, 0.05, C.ink, { p: [sx * 0.3, 0.33, 1.15], r: [-0.6, 0, 0] }, 0);
      }
      return s.build();
    }),
    glow,
  );
  return {
    root,
    animate: (t) => {
      hinge.rotation.x = -(0.06 + 0.5 * Math.max(0, Math.sin(t * 4.2)));
    },
  };
}

// ---------- the wandering creatures ----------

export const CREATURE_KINDS = 3;

export interface Creature {
  readonly root: THREE.Group;
  /** `t` seconds of game time; `step` is the walking phase in radians; `wind` is 0..1 while a pumpkin walker winds up a stomp. */
  animate(t: number, step: number, wind?: number): void;
}

/** A flat ring on the ground showing how far a creature reaches (a ghost's chill, a pumpkin's stomp). */
const reachRing = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);
const reachDisc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const chillMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
const chillDiscMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending });

const ZOMBIE_TORSO: readonly (readonly [number, number])[] = [[0.01, 0], [0.46, 0.02], [0.56, 0.4], [0.52, 0.78], [0.6, 1.02], [0.46, 1.2], [0.2, 1.28], [0.01, 1.3]];

function zombie(): Creature {
  const root = new THREE.Group();
  const body = mesh(
    root,
    geo('zombie-body', () => {
      const s = new Shape();
      // ragged shirt over a smooth hunched body, with a rope belt and a tattered hem
      s.lathe(ZOMBIE_TORSO, 14, C.shirt, { p: [0, 0.82, 0], s: [1.05, 1, 0.8] });
      s.blob(0.38, 0.32, 0.26, C.shirt, { p: [0, 1.3, 0.2] }, 1); // belly
      for (const sx of [-1, 1]) s.blob(0.3, 0.2, 0.14, C.shirt, { p: [sx * 0.28, 1.72, 0.3], r: [0.2, 0, sx * 0.1] }, 1); // chest
      s.blob(0.5, 0.4, 0.3, C.shirtDark, { p: [0, 1.82, -0.4] }, 2); // hunch
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        s.cone(0.08, i % 2 === 0 ? 0.3 : 0.2, 4, i % 3 === 0 ? C.shirtDark : C.shirt, { p: [Math.sin(a) * 0.52, 0.8, Math.cos(a) * 0.42], r: [Math.PI, 0, 0] });
      }
      s.ring(0.54, 0.045, C.boot, { p: [0, 1.02, 0], s: [1.05, 1, 0.8] }, Math.PI * 2, 5, 14);
      s.cyl(0.07, 0.07, 0.05, 8, C.steelLight, { p: [0, 1.02, 0.42], r: [Math.PI / 2, 0, 0] });
      // a torn patch showing bare ribs
      s.blob(0.2, 0.24, 0.06, C.skin, { p: [0.2, 1.6, 0.44], r: [0, 0, 0.2] }, 1);
      for (let i = 0; i < 3; i += 1) s.limb([0.06, 1.52 + i * 0.1, 0.5], [0.34, 1.56 + i * 0.1, 0.48], 0.016, 0.016, C.ivory, 5);
      s.seamPath([[-0.3, 1.8, 0.4], [-0.22, 1.62, 0.5], [-0.2, 1.46, 0.52]], [[0, 0.3, 1], [0, 0, 1], [0, -0.2, 1]], 2, C.ink, 0.13);
      // neck, big lopsided head with a heavy brow and underbite, ears, crooked teeth, hair tufts and neck bolts
      s.cyl(0.17, 0.22, 0.26, 10, C.skin, { p: [0, 2.12, 0.02] });
      s.blob(0.43, 0.46, 0.42, C.skin, { p: [0, 2.5, 0.05] }, 2);
      s.blob(0.34, 0.09, 0.16, C.skinDark, { p: [0, 2.6, 0.34] }, 2); // brow
      s.blob(0.3, 0.14, 0.24, C.skinLight, { p: [0, 2.2, 0.25] }, 2); // jaw
      s.blob(0.09, 0.08, 0.09, C.skinLight, { p: [0.02, 2.44, 0.46] }, 1); // nose
      for (const sx of [-1, 1]) {
        s.blob(0.08, 0.14, 0.06, C.skin, { p: [sx * 0.43, 2.48, 0.02] }, 1);
        s.blob(0.045, 0.08, 0.04, C.skinDark, { p: [sx * 0.45, 2.48, 0.04] }, 0);
        s.cyl(0.04, 0.04, 0.32, 8, C.steelDark, { p: [sx * 0.28, 2.1, 0.02], r: [0, 0, Math.PI / 2] });
        s.cyl(0.09, 0.09, 0.035, 10, C.steel, { p: [sx * 0.4, 2.1, 0.02], r: [0, 0, Math.PI / 2] });
        s.cyl(0.062, 0.062, 0.07, 6, C.steelLight, { p: [sx * 0.44, 2.1, 0.02], r: [0, 0, Math.PI / 2] });
      }
      s.blob(0.22, 0.04, 0.05, C.ink, { p: [0.02, 2.28, 0.44], r: [0, 0, -0.08] }, 1); // mouth line
      for (let i = 0; i < 5; i += 1) s.cone(0.032, i % 2 === 0 ? 0.1 : 0.07, 5, C.ivory, { p: [-0.12 + i * 0.06, 2.28, 0.45] });
      s.seam([-0.3, 2.78, 0.33], [0.3, 2.86, 0.33], [0, 0.4, 1], 5, C.ink, 0.1, 0.014);
      for (let i = 0; i < 5; i += 1) s.cone(0.08, 0.26, 5, C.ink, { p: [-0.2 + i * 0.1, 2.92, -0.05 - (i % 2) * 0.08], r: [0.2, 0, (i - 2) * 0.2] });
      return s.build();
    }),
    lit,
  );
  mesh(
    body,
    geo('zombie-eyes', () => {
      const s = flat();
      s.blob(0.14, 0.13, 0.06, C.ink, { p: [0.19, 2.56, 0.44] }, 1);
      s.blob(0.085, 0.085, 0.05, C.eyeGreen, { p: [0.19, 2.56, 0.48] }, 0);
      s.blob(0.1, 0.09, 0.06, C.ink, { p: [-0.18, 2.52, 0.44] }, 1);
      s.blob(0.05, 0.05, 0.05, C.eyeGreen, { p: [-0.18, 2.52, 0.48] }, 0);
      return s.build();
    }),
    glow,
  );
  const armGeo = geo('zombie-arm', () => {
    const s = new Shape();
    s.blob(0.26, 0.24, 0.24, C.shirt, { p: [0, 0, 0] }, 2); // shoulder
    segment(s, [0, 0, 0], [0.04, -0.12, 0.5], 0.17, 0.14, C.shirt);
    for (let i = 0; i < 3; i += 1) s.cone(0.06, 0.18, 4, C.shirtDark, { p: [(i - 1) * 0.1, -0.1, 0.56], r: [Math.PI / 2, 0, 0] });
    segment(s, [0.04, -0.12, 0.5], [0.06, -0.2, 1.0], 0.12, 0.1, C.skin);
    s.blob(0.17, 0.15, 0.2, C.skin, { p: [0.06, -0.22, 1.1] }, 2);
    for (let i = -1; i <= 1; i += 1) s.limb([0.06 + i * 0.07, -0.22, 1.2], [0.06 + i * 0.09, -0.24, 1.38], 0.045, 0.02, C.skinDark, 6);
    return s.build();
  });
  const legGeo = geo('zombie-leg', () => {
    const s = new Shape();
    segment(s, [0, 0, 0], [0, -0.5, 0.01], 0.21, 0.17, C.pants);
    for (let i = 0; i < 4; i += 1) s.cone(0.07, 0.16, 4, C.pants, { p: [Math.sin(i * 1.6) * 0.14, -0.52, Math.cos(i * 1.6) * 0.1], r: [Math.PI, 0, 0] });
    segment(s, [0, -0.5, 0.01], [0, -0.84, 0.02], 0.12, 0.11, C.skin);
    s.blob(0.19, 0.12, 0.32, C.boot, { p: [0, -0.9, 0.1] }, 2);
    s.blob(0.15, 0.1, 0.14, C.boot, { p: [0, -0.88, 0.32] }, 1);
    return s.build();
  });
  const armL = pivot(root, 0.62, 1.9, 0.02);
  const armR = pivot(root, -0.62, 1.9, 0.02);
  mesh(armL, armGeo, lit);
  mesh(armR, armGeo, lit);
  const legL = pivot(root, 0.26, 1.0, 0);
  const legR = pivot(root, -0.26, 1.0, 0);
  mesh(legL, legGeo, lit);
  mesh(legR, legGeo, lit);
  return {
    root,
    animate: (t, step) => {
      legL.rotation.x = Math.sin(step) * 0.55;
      legR.rotation.x = -Math.sin(step) * 0.55;
      armL.rotation.x = -0.15 + Math.sin(t * 2.2) * 0.12;
      armR.rotation.x = -0.15 + Math.sin(t * 2.2 + 1.7) * 0.12;
      body.position.y = Math.abs(Math.sin(step)) * 0.06;
      root.rotation.z = Math.sin(step) * 0.05;
    },
  };
}

function ghost(): Creature {
  const root = new THREE.Group();
  const sheet = pivot(root, 0, 0.25, 0);
  mesh(
    sheet,
    geo('ghost-sheet', () => {
      const s = new Shape();
      s.lathe([[0.05, 0], [0.6, 0.02], [0.68, 0.55], [0.6, 1.15], [0.52, 1.6], [0.56, 1.85], [0.44, 2.15], [0.2, 2.3], [0.0, 2.32]], 14, C.sheet, { s: [1, 1, 0.9] });
      s.blob(0.5, 0.42, 0.4, C.sheet, { p: [0, 1.95, 0.02] }, 2); // round head
      // scalloped hem
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2;
        s.blob(0.24, 0.2, 0.24, i % 2 === 0 ? C.sheet : C.sheetShade, { p: [Math.sin(a) * 0.54, 0.02, Math.cos(a) * 0.5] }, 1);
      }
      // a stitched patch on the chest, like the monsters wear
      s.blob(0.24, 0.24, 0.05, C.strap, { p: [0.12, 1.0, 0.6], r: [0, 0, 0.12] }, 1);
      s.seam([-0.06, 0.82, 0.65], [0.3, 0.82, 0.65], [0, 0, 1], 4, C.thread, 0.1, 0.014);
      s.seam([-0.06, 1.18, 0.65], [0.3, 1.18, 0.65], [0, 0, 1], 4, C.thread, 0.1, 0.014);
      s.seamPath([[-0.3, 1.1, 0.58], [-0.22, 0.9, 0.62], [-0.2, 0.72, 0.64]], [[-0.4, 0, 1], [-0.2, 0, 1], [0, 0, 1]], 2, C.ink, 0.12);
      // sheet arms with round hands
      for (const sx of [-1, 1]) {
        segment(s, [sx * 0.55, 1.3, 0.2], [sx * 0.85, 1.05, 0.65], 0.17, 0.12, C.sheet);
        s.blob(0.16, 0.14, 0.16, C.sheetShade, { p: [sx * 0.88, 1.02, 0.75] }, 1);
      }
      // dark hollows for a face, brows and cheeks
      s.blob(0.14, 0.21, 0.06, C.ink, { p: [0.19, 1.95, 0.5] }, 1);
      s.blob(0.14, 0.21, 0.06, C.ink, { p: [-0.19, 1.95, 0.5] }, 1);
      s.blob(0.16, 0.22, 0.06, C.ink, { p: [0, 1.5, 0.56] }, 1);
      s.limb([0.1, 2.2, 0.48], [0.34, 2.12, 0.44], 0.04, 0.03, C.ink, 5);
      s.limb([-0.1, 2.2, 0.48], [-0.34, 2.12, 0.44], 0.04, 0.03, C.ink, 5);
      for (const sx of [-1, 1]) s.blob(0.1, 0.07, 0.04, 0xffb5d8, { p: [sx * 0.34, 1.72, 0.5] }, 1);
      return s.build();
    }),
    ghostMat,
  );
  mesh(
    sheet,
    geo('ghost-eyes', () => {
      const s = flat();
      for (const sx of [-1, 1]) s.blob(0.055, 0.08, 0.04, C.eyeGreen, { p: [sx * 0.19, 1.97, 0.54] }, 0);
      return s.build();
    }),
    glow,
  );
  // the chilling aura on the ground
  const aura = mesh(root, reachRing, chillMat);
  const auraDisc = mesh(root, reachDisc, chillDiscMat);
  aura.position.y = auraDisc.position.y = 0.14;
  aura.scale.setScalar(GHOST_AURA_M);
  auraDisc.scale.setScalar(GHOST_AURA_M);
  return {
    root,
    animate: (t, step) => {
      aura.scale.setScalar(GHOST_AURA_M * (1 + Math.sin(t * 3) * 0.03));
      sheet.position.y = 0.3 + Math.sin(t * 2.4 + step * 0.3) * 0.16;
      sheet.rotation.z = Math.sin(t * 1.9) * 0.1;
      sheet.rotation.x = 0.06 + Math.sin(t * 2.4) * 0.03;
    },
  };
}

function pumpkin(): Creature {
  const root = new THREE.Group();
  const body = pivot(root, 0, 1.3, 0);
  mesh(
    body,
    geo('pumpkin-body', () => {
      const s = new Shape();
      s.blob(0.95, 0.78, 0.88, C.pumpkin, { p: [0, 0, 0] }, 2);
      for (let i = 0; i < 8; i += 1) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        s.blob(0.11, 0.66, 0.15, C.pumpkinDark, { p: [Math.sin(a) * 0.8, 0, Math.cos(a) * 0.74], r: [0, a, 0] }, 1);
      }
      s.blob(0.5, 0.2, 0.4, C.pumpkinLight, { p: [0, 0.62, -0.05] }, 1);
      // stem, curled vine and leaf
      s.cyl(0.1, 0.17, 0.34, 8, C.stem, { p: [0, 0.9, 0], r: [0.1, 0, 0.1] });
      s.tube([[0.05, 0.95, 0], [0.3, 1.12, 0], [0.5, 1.0, 0.05], [0.5, 0.85, 0.1]], 0.045, 0.025, C.vine, 6, 10);
      s.blob(0.2, 0.04, 0.12, C.vineDark, { p: [-0.24, 0.98, 0.05], r: [0, 0, 0.5] }, 1);
      // vine arms with leaf hands
      for (const sx of [-1, 1]) {
        s.tube([[sx * 0.85, 0.1, 0.1], [sx * 1.1, -0.05, 0.4], [sx * 1.05, -0.15, 0.8]], 0.1, 0.07, C.vine, 6, 8);
        s.blob(0.08, 0.2, 0.13, C.vineDark, { p: [sx * 1.05, -0.17, 0.92], r: [0.2, 0, sx * 0.4] }, 1);
        s.blob(0.08, 0.16, 0.11, C.vineDark, { p: [sx * 0.98, -0.17, 0.98], r: [0.2, 0, sx * -0.2] }, 1);
      }
      return s.build();
    }),
    lit,
  );
  mesh(
    body,
    geo('pumpkin-face', () => {
      const s = flat();
      const c = 0xffd23b;
      for (const sx of [-1, 1]) s.cone(0.2, 0.32, 3, c, { p: [sx * 0.34, 0.2, 0.9], r: [Math.PI / 2, sx * 0.25, 0] });
      s.cone(0.1, 0.18, 3, c, { p: [0, -0.02, 0.92], r: [Math.PI / 2, 0, 0] });
      s.blob(0.5, 0.07, 0.04, c, { p: [0, -0.3, 0.88] }, 1);
      for (let i = 0; i < 4; i += 1) s.cone(0.07, 0.2, 3, c, { p: [-0.33 + i * 0.22, i % 2 === 0 ? -0.36 : -0.22, 0.88], r: [i % 2 === 0 ? 0 : Math.PI, 0, 0] });
      return s.build();
    }),
    glow,
  );
  const legGeo = geo('pumpkin-leg', () => {
    const s = new Shape();
    segment(s, [0, 0, 0], [0, -0.66, 0], 0.17, 0.14, C.vine, C.vineDark);
    s.blob(0.23, 0.12, 0.32, C.stem, { p: [0, -0.74, 0.1] }, 2);
    for (let i = -1; i <= 1; i += 1) s.cone(0.05, 0.14, 4, C.pumpkinDark, { p: [i * 0.1, -0.74, 0.4], r: [Math.PI / 2, 0, 0] });
    return s.build();
  });
  const legL = pivot(root, 0.34, 0.8, 0);
  const legR = pivot(root, -0.34, 0.8, 0);
  mesh(legL, legGeo, lit);
  mesh(legR, legGeo, lit);
  // the stomp warning on the ground: a ring that grows to the stomp's reach while the pumpkin winds up
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const warn = mesh(root, reachRing, warnMat);
  warn.position.y = 0.14;
  warn.visible = false;
  return {
    root,
    animate: (t, step, wind = 0) => {
      warn.visible = wind > 0;
      warn.scale.setScalar(Math.max(0.01, STOMP_RADIUS_M * wind));
      warnMat.opacity = 0.2 + 0.5 * wind;
      body.scale.set(1 + wind * 0.1, 1 - wind * 0.2, 1 + wind * 0.1);
      legL.rotation.x = Math.sin(step) * 0.65;
      legR.rotation.x = -Math.sin(step) * 0.65;
      body.position.y = 1.3 - wind * 0.15 + Math.abs(Math.sin(step)) * 0.12 * (1 - wind);
      body.rotation.z = Math.sin(step) * 0.1;
      body.rotation.y = Math.sin(t * 1.4) * 0.08;
    },
  };
}

export function createCreature(kind: number): Creature {
  const k = ((kind % CREATURE_KINDS) + CREATURE_KINDS) % CREATURE_KINDS;
  return k === 0 ? zombie() : k === 1 ? ghost() : pumpkin();
}
