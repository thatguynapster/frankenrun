// The things that live on the road: the stitched mimic crate behind every mystery box, and the three wandering creatures
// (a shambling zombie, a sheet ghost and a pumpkin walker). Modelled in code with the same faceted low-poly kit as the
// monsters (see monsters/shapes.ts), so they sit in the same world. Presentation only.
//
// Every model faces +Z, Y up, +X to its left, and stands on y = 0. Geometry is built once and shared between instances.

import * as THREE from 'three';
import { Shape } from './monsters/shapes.js';
import { MATERIALS, withRim } from './monsters/parts.js';

const lit = MATERIALS['lit'];
const glow = MATERIALS['glow'];
const ghostMat = withRim(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, emissive: 0x4c4c78, depthWrite: false }), 0xcdd8ff, 0.4);

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

/** A group holding one mesh per (geometry, material), positioned as given. */
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

// ---------- the mimic crate (mystery box) ----------

const CRATE_PURPLE = 0x4d2a78;
const CRATE_PURPLE_DARK = 0x35195a;
const STRAP = 0xff7a1a;
const BONE = 0xf3ead2;
const THREAD = 0xe9d9ae;
const EMBER = 0xffb02e;

/** The floating question mark, as one smooth tube plus a dot. */
function questionMark(s: Shape, y: number): void {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = Math.PI * 0.95 - (i / 8) * Math.PI * 1.55;
    pts.push([Math.cos(a) * 0.3, y + 0.62 + Math.sin(a) * 0.3, 0]);
  }
  pts.push([0.0, y + 0.16, 0], [0, y + 0.0, 0]);
  s.tube(pts, 0.075, 0.075, EMBER, 6, 18);
  s.blob(0.09, 0.09, 0.09, EMBER, { p: [0, y - 0.2, 0] }, 1);
}

export interface Crate {
  readonly root: THREE.Group;
  /** Chomps the lid; `t` in seconds. */
  animate(t: number): void;
}

export function createCrate(): Crate {
  const root = new THREE.Group();
  mesh(
    root,
    geo('crate-base', () => {
      const s = new Shape();
      s.box(1.3, 0.8, 1.3, CRATE_PURPLE, { p: [0, 0.4, 0] });
      // orange corner straps and a belt, like the stitched monsters' seams
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box(0.14, 0.84, 0.14, STRAP, { p: [sx * 0.64, 0.42, sz * 0.64] });
      s.box(1.34, 0.12, 1.34, STRAP, { p: [0, 0.3, 0] });
      s.seam([-0.55, 0.62, 0.66], [0.55, 0.62, 0.66], [0, 0, 1], 8, THREAD, 0.14, 0.016);
      // neck bolts, one each side
      for (const sx of [-1, 1]) {
        s.cyl(0.07, 0.07, 0.4, 6, 0x9aa0b4, { p: [sx * 0.78, 0.45, 0], r: [0, 0, Math.PI / 2] });
        s.cyl(0.14, 0.14, 0.06, 6, 0x9aa0b4, { p: [sx * 0.96, 0.45, 0], r: [0, 0, Math.PI / 2] });
      }
      // lower teeth
      for (let i = 0; i < 6; i += 1) s.cone(0.1, 0.3, 4, BONE, { p: [-0.5 + i * 0.2, 0.94, 0.55] });
      return s.build();
    }),
    lit,
  );
  mesh(
    root,
    geo('crate-glow', () => {
      const s = flat();
      s.box(1.16, 0.1, 1.16, EMBER, { p: [0, 0.8, 0] });
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
      s.box(1.38, 0.4, 1.38, CRATE_PURPLE_DARK, { p: [0, 0.2, 0.62] });
      s.box(0.2, 0.44, 1.42, STRAP, { p: [0, 0.2, 0.62] });
      s.box(1.42, 0.44, 0.16, STRAP, { p: [0, 0.2, 1.2] });
      // upper teeth hang from the front rim
      for (let i = 0; i < 6; i += 1) s.cone(0.1, 0.28, 4, BONE, { p: [-0.5 + i * 0.2, -0.12, 1.18], r: [Math.PI, 0, 0] });
      return s.build();
    }),
    lit,
  );
  mesh(
    hinge,
    geo('crate-eyes', () => {
      const s = flat();
      for (const sx of [-1, 1]) {
        s.blob(0.17, 0.2, 0.06, 0xffe84a, { p: [sx * 0.3, 0.26, 1.3] }, 1);
        s.blob(0.07, 0.1, 0.05, 0x1a0a2a, { p: [sx * 0.3, 0.26, 1.34] }, 0);
      }
      return s.build();
    }),
    glow,
  );
  return {
    root,
    animate: (t) => {
      hinge.rotation.x = -(0.2 + 0.16 * Math.sin(t * 5.5));
    },
  };
}

// ---------- the wandering creatures ----------

export const CREATURE_KINDS = 3;

export interface Creature {
  readonly root: THREE.Group;
  /** `t` seconds of game time; `step` is the walking phase in radians. */
  animate(t: number, step: number): void;
}

const SKIN = 0x86b86b;
const SKIN_DARK = 0x5f8f4c;

function zombie(): Creature {
  const root = new THREE.Group();
  const body = mesh(
    root,
    geo('zombie-body', () => {
      const s = new Shape();
      // ragged shirt: a lathe torso with torn strips hanging from the hem
      s.lathe([[0.0, 0], [0.5, 0.02], [0.56, 0.45], [0.5, 0.9], [0.36, 1.12], [0.0, 1.16]], 9, 0x5b4a76, { p: [0, 0.85, 0], s: [1, 1, 0.74] });
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        s.cone(0.1, 0.34, 3, 0x5b4a76, { p: [Math.sin(a) * 0.46, 0.84, Math.cos(a) * 0.36], r: [Math.PI, 0, 0] });
      }
      s.box(0.5, 0.06, 0.04, 0x3a2a52, { p: [0.05, 1.5, 0.4], r: [0, 0, 0.5] });
      // neck, head, brow
      s.cyl(0.14, 0.18, 0.2, 6, SKIN, { p: [0, 2.05, 0] });
      s.blob(0.4, 0.46, 0.4, SKIN, { p: [0, 2.35, 0.03] });
      s.blob(0.34, 0.1, 0.18, SKIN_DARK, { p: [0, 2.46, 0.28] }, 1);
      s.box(0.3, 0.07, 0.07, 0x2a1a22, { p: [0, 2.1, 0.38] });
      for (let i = 0; i < 4; i += 1) s.box(0.045, 0.07, 0.03, BONE, { p: [-0.1 + i * 0.067, 2.08, 0.39] });
      s.seam([-0.3, 2.55, 0.28], [0.3, 2.62, 0.28], [0, 0.4, 1], 5, 0x2a1a22, 0.1, 0.014);
      // tufts of hair and a bolt through the neck
      for (let i = 0; i < 5; i += 1) s.cone(0.07, 0.24, 3, 0x2a2438, { p: [-0.2 + i * 0.1, 2.76, -0.05 - (i % 2) * 0.08], r: [0.2, 0, (i - 2) * 0.2] });
      for (const sx of [-1, 1]) s.cyl(0.05, 0.05, 0.3, 5, 0x9aa0b4, { p: [sx * 0.2, 2.0, 0], r: [0, 0, Math.PI / 2] });
      return s.build();
    }),
    lit,
  );
  mesh(
    root,
    geo('zombie-eyes', () => {
      const s = flat();
      for (const sx of [-1, 1]) {
        s.blob(0.11, 0.1, 0.05, 0x2a1a22, { p: [sx * 0.17, 2.4, 0.4] }, 1);
        s.blob(0.06, 0.06, 0.05, 0xd8ff3a, { p: [sx * 0.17, 2.4, 0.43] }, 0);
      }
      return s.build();
    }),
    glow,
  );
  const armGeo = geo('zombie-arm', () => {
    const s = new Shape();
    s.limb([0, 0, 0], [0.04, -0.12, 0.5], 0.15, 0.13, 0x5b4a76, 6);
    s.limb([0.04, -0.12, 0.5], [0.06, -0.2, 1.0], 0.12, 0.1, SKIN, 6);
    s.blob(0.13, 0.12, 0.16, SKIN, { p: [0.06, -0.22, 1.1] }, 1);
    for (let i = -1; i <= 1; i += 1) s.cone(0.035, 0.18, 3, SKIN_DARK, { p: [0.06 + i * 0.07, -0.24, 1.26], r: [Math.PI / 2, 0, 0] });
    return s.build();
  });
  const legGeo = geo('zombie-leg', () => {
    const s = new Shape();
    s.limb([0, 0, 0], [0, -0.9, 0.02], 0.19, 0.15, 0x3f3a52, 6);
    s.box(0.26, 0.14, 0.44, 0x2a2438, { p: [0, -0.96, 0.1] });
    return s.build();
  });
  const armL = pivot(root, 0.6, 1.88, 0.02);
  const armR = pivot(root, -0.6, 1.88, 0.02);
  mesh(armL, armGeo, lit);
  mesh(armR, armGeo, lit);
  const legL = pivot(root, 0.24, 0.92, 0);
  const legR = pivot(root, -0.24, 0.92, 0);
  mesh(legL, legGeo, lit);
  mesh(legR, legGeo, lit);
  return {
    root,
    animate: (t, step) => {
      legL.rotation.x = Math.sin(step) * 0.6;
      legR.rotation.x = -Math.sin(step) * 0.6;
      armL.rotation.x = -0.15 + Math.sin(t * 2.2) * 0.12;
      armR.rotation.x = -0.15 + Math.sin(t * 2.2 + 1.7) * 0.12;
      body.position.y = Math.abs(Math.sin(step)) * 0.08;
      root.rotation.z = Math.sin(step) * 0.06;
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
      s.lathe([[0.05, 0], [0.6, 0.02], [0.66, 0.55], [0.58, 1.15], [0.5, 1.6], [0.52, 1.85], [0.4, 2.15], [0.0, 2.28]], 10, 0xe9e6ff, { s: [1, 1, 0.9] });
      // scalloped hem
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        s.blob(0.24, 0.2, 0.24, 0xe9e6ff, { p: [Math.sin(a) * 0.52, 0.02, Math.cos(a) * 0.48] }, 1);
      }
      // a stitched patch on the chest
      s.box(0.42, 0.42, 0.04, STRAP, { p: [0.12, 1.0, 0.6], r: [0, 0, 0.12] });
      s.seam([-0.06, 0.82, 0.63], [0.3, 0.82, 0.63], [0, 0, 1], 4, THREAD, 0.1, 0.014);
      s.seam([-0.06, 1.18, 0.63], [0.3, 1.18, 0.63], [0, 0, 1], 4, THREAD, 0.1, 0.014);
      // sheet "arms"
      for (const sx of [-1, 1]) s.limb([sx * 0.55, 1.3, 0.2], [sx * 0.85, 1.05, 0.65], 0.17, 0.1, 0xe9e6ff, 6);
      // dark hollows for a face
      s.blob(0.13, 0.2, 0.05, 0x1c1632, { p: [0.19, 1.82, 0.5] }, 1);
      s.blob(0.13, 0.2, 0.05, 0x1c1632, { p: [-0.19, 1.82, 0.5] }, 1);
      s.blob(0.12, 0.17, 0.05, 0x1c1632, { p: [0, 1.38, 0.54] }, 1);
      return s.build();
    }),
    ghostMat,
  );
  mesh(
    sheet,
    geo('ghost-eyes', () => {
      const s = flat();
      for (const sx of [-1, 1]) s.blob(0.05, 0.07, 0.04, 0x9affd8, { p: [sx * 0.19, 1.84, 0.54] }, 0);
      return s.build();
    }),
    glow,
  );
  return {
    root,
    animate: (t, step) => {
      sheet.position.y = 0.3 + Math.sin(t * 2.4 + step * 0.3) * 0.16;
      sheet.rotation.z = Math.sin(t * 1.9) * 0.1;
      sheet.rotation.x = 0.06 + Math.sin(t * 2.4) * 0.03;
    },
  };
}

const PUMPKIN = 0xe8761a;
const PUMPKIN_DARK = 0xb85a0c;
const VINE = 0x4f7a2a;

function pumpkin(): Creature {
  const root = new THREE.Group();
  const body = pivot(root, 0, 1.15, 0);
  mesh(
    body,
    geo('pumpkin-body', () => {
      const s = new Shape();
      s.blob(0.95, 0.8, 0.88, PUMPKIN, { p: [0, 0, 0] });
      // ribs
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        s.blob(0.14, 0.76, 0.2, PUMPKIN_DARK, { p: [Math.sin(a) * 0.82, 0, Math.cos(a) * 0.76], r: [0, a, 0] }, 1);
      }
      // stem and curled vine
      s.cyl(0.1, 0.17, 0.34, 6, VINE, { p: [0, 0.9, 0], r: [0.1, 0, 0.1] });
      s.tube([[0.05, 0.95, 0], [0.3, 1.12, 0], [0.5, 1.0, 0.05], [0.5, 0.85, 0.1]], 0.04, 0.025, VINE, 5, 10);
      s.cone(0.16, 0.3, 4, VINE, { p: [-0.22, 0.95, 0.05], r: [0, 0, 1.2] });
      // vine arms
      for (const sx of [-1, 1]) {
        s.tube([[sx * 0.85, 0.1, 0.1], [sx * 1.1, -0.05, 0.4], [sx * 1.05, -0.15, 0.8]], 0.09, 0.06, VINE, 5, 8);
        s.cone(0.1, 0.26, 4, VINE, { p: [sx * 1.05, -0.17, 0.95], r: [Math.PI / 2, 0, 0] });
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
      for (const sx of [-1, 1]) s.cone(0.2, 0.32, 3, c, { p: [sx * 0.32, 0.2, 0.86], r: [Math.PI / 2, 0, 0] });
      s.cone(0.1, 0.18, 3, c, { p: [0, -0.02, 0.9], r: [Math.PI / 2, 0, 0] });
      s.box(0.9, 0.12, 0.06, c, { p: [0, -0.3, 0.84] });
      for (let i = 0; i < 4; i += 1) s.box(0.14, 0.2, 0.06, c, { p: [-0.33 + i * 0.22, i % 2 === 0 ? -0.4 : -0.22, 0.84] });
      return s.build();
    }),
    glow,
  );
  const legGeo = geo('pumpkin-leg', () => {
    const s = new Shape();
    s.limb([0, 0, 0], [0, -0.55, 0], 0.15, 0.12, 0x3d5a20, 6);
    s.blob(0.19, 0.1, 0.27, 0x2a3f16, { p: [0, -0.6, 0.08] }, 1);
    return s.build();
  });
  const legL = pivot(root, 0.32, 0.6, 0);
  const legR = pivot(root, -0.32, 0.6, 0);
  mesh(legL, legGeo, lit);
  mesh(legR, legGeo, lit);
  return {
    root,
    animate: (t, step) => {
      legL.rotation.x = Math.sin(step) * 0.7;
      legR.rotation.x = -Math.sin(step) * 0.7;
      body.position.y = 1.15 + Math.abs(Math.sin(step)) * 0.12;
      body.rotation.z = Math.sin(step) * 0.1;
      body.rotation.y = Math.sin(t * 1.4) * 0.08;
    },
  };
}

export function createCreature(kind: number): Creature {
  const k = ((kind % CREATURE_KINDS) + CREATURE_KINDS) % CREATURE_KINDS;
  return k === 0 ? zombie() : k === 1 ? ghost() : pumpkin();
}
