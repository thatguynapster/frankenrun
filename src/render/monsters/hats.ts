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
      // top hat: a curved brim, a slightly flared crown with a dent, a red band and a gold buckle
      const s = new Shape();
      s.lathe([[0.01, 0.0], [0.5, 0.0], [0.56, 0.03], [0.5, 0.07], [0.31, 0.08], [0.01, 0.08]], 12, 0x1b1b24); // brim, turned up at the edge
      s.lathe([[0.31, 0.06], [0.3, 0.3], [0.32, 0.55], [0.28, 0.6], [0.01, 0.61]], 12, 0x22222d); // crown
      s.cyl(0.325, 0.33, 0.1, 12, 0xb02a3a, { p: [0, 0.14, 0] });
      s.box(0.12, 0.1, 0.05, 0xe8b830, { p: [0, 0.14, 0.33] });
      s.box(0.07, 0.05, 0.06, 0x1b1b24, { p: [0, 0.14, 0.335] });
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 2: {
      // witch hat: a floppy brim and a tall cone that bends over at the tip
      const s = new Shape();
      s.lathe([[0.01, 0.0], [0.62, 0.0], [0.66, 0.03], [0.6, 0.06], [0.4, 0.09], [0.01, 0.09]], 12, 0x3a2a5a);
      s.tube([[0, 0.06, 0], [0, 0.32, 0], [0.06, 0.62, 0], [0.22, 0.88, 0]], 0.38, 0.03, 0x4a3470, 8, 6);
      s.cyl(0.4, 0.43, 0.1, 10, 0xe0a82e, { p: [0, 0.14, 0] });
      s.box(0.14, 0.11, 0.05, 0xf3cc4a, { p: [0, 0.14, 0.41] });
      s.blob(0.04, 0.04, 0.04, 0xe0a82e, { p: [0.23, 0.9, 0] }, 0); // a little bell on the tip
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 3: {
      // crown: a band with five points, each topped with a jewel
      const s = new Shape();
      s.lathe([[0.3, 0.0], [0.34, 0.0], [0.34, 0.2], [0.3, 0.2]], 12, 0xe8b830);
      s.cyl(0.345, 0.345, 0.04, 12, 0xf3cc4a, { p: [0, 0.03, 0] });
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        s.cone(0.08, 0.26, 5, 0xf3cc4a, { p: [Math.cos(a) * 0.31, 0.32, Math.sin(a) * 0.31] });
        s.blob(0.05, 0.05, 0.05, 0xd8283a, { p: [Math.cos(a) * 0.31, 0.47, Math.sin(a) * 0.31] }, 0);
        s.blob(0.035, 0.035, 0.035, i % 2 === 0 ? 0x3bd1ff : 0x7dff6a, { p: [Math.cos(a + Math.PI / 5) * 0.34, 0.1, Math.sin(a + Math.PI / 5) * 0.34] }, 0);
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: ring(0.3), lift: 0 };
    }
    case 4: {
      // devil horns: curved, ridged, with a dark root
      const s = new Shape();
      for (const side of [-1, 1]) {
        s.tube([[side * 0.2, 0.0, 0.04], [side * 0.28, 0.2, 0.06], [side * 0.26, 0.4, 0.0], [side * 0.18, 0.52, -0.06]], 0.095, 0.012, 0xc22a2a, 6, 6);
        s.blob(0.115, 0.08, 0.115, 0x8a1a1a, { p: [side * 0.2, 0.0, 0.04] }, 1);
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: [[-0.22, 0.04], [0.22, 0.04]], lift: 0.02 };
    }
    case 5: {
      // antlers: smooth branching bone
      const s = new Shape();
      const bone = 0xcdbb98;
      for (const side of [-1, 1]) {
        s.tube([[side * 0.18, 0.0, 0], [side * 0.34, 0.25, 0], [side * 0.42, 0.5, 0], [side * 0.56, 0.78, 0]], 0.06, 0.025, bone, 5, 5);
        s.tube([[side * 0.34, 0.25, 0], [side * 0.52, 0.34, 0.08], [side * 0.62, 0.5, 0.1]], 0.04, 0.015, bone, 5, 4);
        s.tube([[side * 0.46, 0.58, 0], [side * 0.4, 0.74, 0.02], [side * 0.42, 0.92, 0]], 0.035, 0.014, bone, 5, 4);
        s.blob(0.08, 0.06, 0.08, 0x8a7a5a, { p: [side * 0.18, 0.0, 0] }, 0); // burr at the base
      }
      root.add(piece(s));
      return { root, animate: idle, anchors: [[-0.2, 0], [0.2, 0]], lift: 0.02 };
    }
    case 6: {
      // halo: a glowing ring floating above the head, bobbing gently
      const s = new Shape({ paint: false });
      s.ring(0.42, 0.055, 0xffe27a, { p: [0, 0.42, 0] }, Math.PI * 2, 5, 20);
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
