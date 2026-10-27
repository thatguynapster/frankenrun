// Landmark models: the Elizabeth Tower (Big Ben) and the Empire State Building, built from basic shapes in the same chunky,
// slightly exaggerated style as the rest of the game. They are original models, not copies of anyone's artwork.
// Each model is split in two: a body (stone, shaded by the moon like the buildings) and the glowing parts (clock faces, the
// floodlit crown), which are drawn without fog so they show from far away like beacons.
//
// A landmark replaces the plain extruded building that the map data has at its spot, and takes that footprint's direction.

import * as THREE from 'three';
import { Shape } from './monsters/shapes.js';

export type LandmarkKind = 'bigben' | 'empire';

export interface Landmark {
  readonly map: string;
  readonly kind: LandmarkKind;
  /** Where it stands on that map, in metres (the middle of its footprint). */
  readonly x: number;
  readonly z: number;
}

export const LANDMARKS: readonly Landmark[] = [
  { map: 'london-westminster-soho', kind: 'bigben', x: -1013.6, z: 1024.7 },
  { map: 'newyork-midtown', kind: 'empire', x: 366.2, z: -3143.8 },
];

export function landmarksOf(mapId: string): readonly Landmark[] {
  return LANDMARKS.filter((l) => l.map === mapId);
}

export interface LandmarkModel {
  readonly body: THREE.BufferGeometry;
  readonly glow: THREE.BufferGeometry;
}

const cache = new Map<LandmarkKind, LandmarkModel>();

export function landmarkModel(kind: LandmarkKind): LandmarkModel {
  let m = cache.get(kind);
  if (m === undefined) {
    m = kind === 'bigben' ? elizabethTower() : empireState();
    cache.set(kind, m);
  }
  return m;
}

/** Rotates a point on the model's horizontal plane about the vertical axis. */
const spin = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];

// ---------- the Elizabeth Tower ----------

function elizabethTower(): LandmarkModel {
  const stone = 0xe1d1a6, stoneDark = 0xb9a579, gold = 0xe0b84a, slate = 0x5d6e62, dark = 0x2d2a3c;
  const s = new Shape();
  const glow = new Shape({ paint: false });
  // the base and the long shaft, with a buttress at each corner
  s.box(17, 16, 17, stoneDark, { p: [0, 8, 0] });
  s.box(18.2, 1.2, 18.2, stone, { p: [0, 16.6, 0] });
  s.box(13, 40, 13, stone, { p: [0, 37.2, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box(2.1, 40, 2.1, stoneDark, { p: [sx * 6.3, 37.2, sz * 6.3] });
  // tall pointed windows down each face (dark recesses)
  for (let face = 0; face < 4; face += 1) {
    const a = (face * Math.PI) / 2;
    for (const y of [26, 34, 43]) {
      const [x, z] = spin(0, 6.6, a);
      s.box(1.7, 4.6, 0.35, dark, { p: [x, y, z], r: [0, a, 0] });
      const [cx, cz] = spin(0, 6.6, a);
      s.cone(0.95, 1.6, 4, dark, { p: [cx, y + 3.1, cz], r: [0, a + Math.PI / 4, 0] });
    }
  }
  // the clock stage: a wider block, a dial on each face, and a pinnacle at each corner
  s.box(15.6, 1.4, 15.6, stoneDark, { p: [0, 58.2, 0] });
  s.box(14.6, 12, 14.6, stone, { p: [0, 65, 0] });
  for (let face = 0; face < 4; face += 1) {
    const a = (face * Math.PI) / 2;
    const at = (lx: number, ly: number, lz: number): [number, number, number] => {
      const [x, z] = spin(lx, lz, a);
      return [x, 65 + ly, z];
    };
    glow.cyl(3.6, 3.6, 0.6, 28, 0xffe9a0, { p: at(0, 0, 7.4), r: [Math.PI / 2, a, 0] });
    s.ring(3.9, 0.3, gold, { p: at(0, 0, 7.5), r: [0, a, 0] }, Math.PI * 2, 4, 28);
    for (let h = 0; h < 12; h += 1) {
      const t = (h / 12) * Math.PI * 2;
      s.box(h % 3 === 0 ? 0.45 : 0.3, h % 3 === 0 ? 0.95 : 0.6, 0.2, dark, { p: at(Math.sin(t) * 3.05, Math.cos(t) * 3.05, 7.75), r: [0, a, -t] });
    }
    s.box(0.34, 2.6, 0.2, dark, { p: at(0.5, 1.0, 7.8), r: [0, a, -0.4] }); // the minute hand
    s.box(0.5, 1.8, 0.2, dark, { p: at(-0.6, 0.5, 7.8), r: [0, a, 1.2] }); // the hour hand
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      s.box(1.9, 8, 1.9, stoneDark, { p: [sx * 7.1, 75, sz * 7.1] });
      s.cone(1.4, 3.6, 4, gold, { p: [sx * 7.1, 80.8, sz * 7.1], r: [0, Math.PI / 4, 0] });
    }
  }
  // the belfry, with louvres, then the spire
  s.box(12.4, 11, 12.4, stone, { p: [0, 76.4, 0] });
  for (let face = 0; face < 4; face += 1) {
    const a = (face * Math.PI) / 2;
    for (const dx of [-3.4, 0, 3.4]) {
      const [x, z] = spin(dx, 6.3, a);
      s.box(1.9, 6.4, 0.3, dark, { p: [x, 76.8, z], r: [0, a, 0] });
    }
  }
  s.box(13.8, 1.2, 13.8, stoneDark, { p: [0, 82.6, 0] });
  s.cone(9.2, 13, 4, slate, { p: [0, 89.7, 0], r: [0, Math.PI / 4, 0] });
  s.cyl(0.35, 0.9, 6, 6, gold, { p: [0, 99.3, 0] });
  s.blob(0.75, 0.75, 0.75, gold, { p: [0, 102.6, 0] }, 1);
  return { body: s.build(), glow: glow.build() };
}

// ---------- the Empire State Building ----------

function empireState(): LandmarkModel {
  const limestone = 0xcfc6ac, pier = 0xe8e1ca, base = 0xb3ab93, dark = 0x3a3646, steel = 0xa9b0bd;
  const s = new Shape();
  const glow = new Shape({ paint: false });
  // The tiers, from the street up: width along its length, depth, bottom and top. Each steps in from the one below.
  const tiers: [number, number, number, number][] = [
    [80, 50, 0, 25],
    [52, 34, 25, 120],
    [44, 27, 120, 200],
    [36, 22, 200, 280],
    [28, 17, 280, 340],
    [20, 12, 340, 381],
  ];
  for (const [w, d, y0, y1] of tiers) {
    const h = y1 - y0;
    s.box(w, h, d, y0 === 0 ? base : limestone, { p: [0, y0 + h / 2, 0] });
    s.box(w + 1.6, 1.2, d + 1.6, base, { p: [0, y1 - 0.6, 0] }); // the setback ledge
    // vertical piers and rows of dark windows on the four faces
    for (let face = 0; face < 4; face += 1) {
      const a = (face * Math.PI) / 2;
      const across = face % 2 === 0 ? w : d, depth = face % 2 === 0 ? d : w;
      const count = Math.max(3, Math.floor(across / 5));
      for (let k = 0; k < count; k += 1) {
        const off = -across / 2 + (across * (k + 0.5)) / count;
        const [x, z] = spin(off, depth / 2 + 0.06, a);
        s.add(new THREE.PlaneGeometry(0.9, h - 2), pier, { p: [x, y0 + h / 2, z], r: [0, a, 0] });
        if (y0 > 0) {
          for (let row = y0 + 8; row < y1 - 6; row += 9) {
            const [wx, wz] = spin(off + across / count / 2 - 0.1, depth / 2 + 0.08, a);
            s.add(new THREE.PlaneGeometry(1.1, 3.2), dark, { p: [wx, row, wz], r: [0, a, 0] });
          }
        }
      }
    }
  }
  // the crown: floodlit steps, then the mast
  glow.box(15, 20, 9, 0xff9a2e, { p: [0, 391, 0] });
  glow.box(10, 17, 6, 0xffc15a, { p: [0, 409.5, 0] });
  s.box(2.4, 25, 2.4, steel, { p: [0, 430.5, 0] });
  glow.cyl(0.25, 1.1, 14, 6, 0xffd98a, { p: [0, 436, 0] });
  return { body: s.build(), glow: glow.build() };
}
