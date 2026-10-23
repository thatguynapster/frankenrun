// Hats and horns, modelled in code like the rest of the monsters. Each is built with its base at the origin (sitting on the
// top of the head) and gets a little idle motion where it suits.

import * as THREE from 'three';
import { MATERIALS } from './parts.js';
import { Shape } from './shapes.js';

export interface HatModel {
  readonly root: THREE.Group;
  animate(time: number): void;
  /** Points (x, z in the hat's own space) where the hat's base must touch the head: the hat is lowered until they do. */
  readonly anchors: readonly (readonly [number, number])[];
  /** How far above those points the hat's origin ends up (a halo floats, a hat sits). */
  readonly lift: number;
}

const ring = (radius: number, n = 8): [number, number][] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * radius, Math.sin((i / n) * Math.PI * 2) * radius]);

const piece = (shape: Shape, kind: 'lit' | 'glow' = 'lit'): THREE.Mesh => {
  const mesh = new THREE.Mesh(shape.build(), MATERIALS[kind]);
  mesh.userData['noTint'] = true; // hats keep their own colours whatever tint the monster has
  return mesh;
};

export function createHat(id: number): HatModel | undefined {
  const root = new THREE.Group();
  const idle = (time: number): void => void time;
  switch (id) {
    case 1: {
      // top hat
      const s = new Shape();
      s.cyl(0.3, 0.32, 0.55, 8, 0x1b1b24, { p: [0, 0.3, 0] });
      s.cyl(0.52, 0.52, 0.06, 10, 0x1b1b24, { p: [0, 0.03, 0] });
      s.cyl(0.325, 0.325, 0.1, 8, 0xb02a3a, { p: [0, 0.1, 0] });
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 2: {
      // witch hat, a little bent at the tip
      const s = new Shape();
      s.cyl(0.62, 0.62, 0.05, 10, 0x3a2a5a, { p: [0, 0.02, 0] });
      s.cone(0.4, 0.55, 8, 0x4a3470, { p: [0, 0.32, 0] });
      s.cone(0.24, 0.5, 7, 0x4a3470, { p: [0.08, 0.78, 0], r: [0, 0, -0.35] });
      s.cyl(0.405, 0.43, 0.1, 8, 0xe0a82e, { p: [0, 0.1, 0] });
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 3: {
      // crown
      const s = new Shape();
      s.cyl(0.34, 0.3, 0.22, 8, 0xe8b830, { p: [0, 0.11, 0] });
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        s.cone(0.07, 0.24, 4, 0xf3cc4a, { p: [Math.cos(a) * 0.3, 0.32, Math.sin(a) * 0.3] });
        s.ico(0.045, 0, 0xd8283a, { p: [Math.cos(a) * 0.3, 0.46, Math.sin(a) * 0.3] });
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 4: {
      // devil horns
      const s = new Shape();
      for (const side of [-1, 1]) {
        s.cone(0.1, 0.42, 5, 0xc22a2a, { p: [side * 0.24, 0.16, 0.04], r: [0, 0, -side * 0.4] });
        s.ico(0.1, 0, 0x8a1a1a, { p: [side * 0.2, 0.0, 0.04] });
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: [[-0.22, 0.04], [0.22, 0.04]], lift: 0.02 };
    }
    case 5: {
      // antlers
      const s = new Shape();
      const bone = 0xcdbb98;
      for (const side of [-1, 1]) {
        s.limb([side * 0.2, 0.0, 0], [side * 0.45, 0.45, 0], 0.06, 0.04, bone, 5);
        s.limb([side * 0.45, 0.45, 0], [side * 0.7, 0.8, 0], 0.045, 0.025, bone, 5);
        s.limb([side * 0.36, 0.3, 0], [side * 0.6, 0.38, 0.1], 0.04, 0.02, bone, 5);
        s.limb([side * 0.52, 0.6, 0], [side * 0.45, 0.9, 0], 0.035, 0.02, bone, 5);
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: [[-0.2, 0], [0.2, 0]], lift: 0.02 };
    }
    case 6: {
      // halo: a glowing ring floating above the head, bobbing gently
      const s = new Shape();
      s.ring(0.42, 0.06, 0xffe27a, { p: [0, 0.42, 0] });
      const halo = piece(s, 'glow');
      root.add(halo);
      return {
        root,
        animate: (time) => {
          halo.position.y = Math.sin(time * 2.2) * 0.04;
          halo.rotation.y = time * 0.8;
        },
        anchors: [[0, 0]],
        lift: 0.15,
      };
    }
    default:
      return undefined;
  }
}
