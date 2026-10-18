// Small pictures of every body and part for the lobby's pick grid, drawn once from the real models.
// They are rendered into an off-screen target with the game's own renderer (no second GL context) and kept as data URLs.

import * as THREE from 'three';
import { MonsterModel, type BuildIds } from './monsters/MonsterModel.js';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS } from './monsters/parts.js';

const SIZE = 128;

type Category = 'body' | 'legs' | 'arms' | 'head';

/** Key used by the UI to look an icon up. */
export const iconKey = (category: Category, id: number): string => `${category}:${id}`;

interface Shot {
  readonly build: BuildIds;
  /** Camera target and distance for this category's crop. */
  readonly look: readonly [number, number, number];
  readonly dist: number;
  readonly yaw: number;
}

function shotFor(category: Category, id: number): Shot {
  const full: BuildIds = { body: 0, legs: 1, arms: 1, head: 1 };
  switch (category) {
    case 'body':
      return { build: { body: id, legs: 0, arms: 0, head: 0 }, look: [0, 1.15, 0], dist: 7.6, yaw: 0.45 };
    case 'legs':
      return { build: { ...full, body: 0, legs: id, arms: 0, head: 0 }, look: [0, 0.3, 0], dist: 5.2, yaw: 0.6 };
    case 'arms':
      return { build: { body: 0, legs: 0, arms: id, head: 0 }, look: [0, 1.7, 0.25], dist: 5.4, yaw: 0.35 };
    case 'head':
      return { build: { body: 0, legs: 0, arms: 0, head: id }, look: [0, 2.8, 0.2], dist: 3.3, yaw: 0.35 };
  }
}

/** Draws every icon. Call once; the renderer's own state (target, clear colour) is put back afterwards. */
export function makeIcons(renderer: THREE.WebGLRenderer): Record<string, string> {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x3a3358, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 6, 8);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true });
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const out: Record<string, string> = {};
  if (ctx === null) return out;

  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevFog = scene.fog;
  renderer.setClearColor(0x000000, 0);
  const pixels = new Uint8Array(SIZE * SIZE * 4);

  const model = new MonsterModel(0x6fbf5a);
  scene.add(model.root);
  const draw = (category: Category, id: number): void => {
    const shot = shotFor(category, id);
    model.setBuild(shot.build, false);
    model.root.position.set(0, 1, 0);
    model.root.quaternion.identity();
    // settle the pose: standing still, no pop-in
    model.update({ x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, swingPole: -1, trailing: false }, 0.016, 0);
    model.root.rotation.y = shot.yaw;
    camera.position.set(shot.look[0], shot.look[1] + shot.dist * 0.12, shot.look[2] + shot.dist);
    camera.lookAt(shot.look[0], shot.look[1], shot.look[2]);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    // pixels are bottom-up: flip while copying into the canvas
    const image = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      image.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
    }
    ctx.putImageData(image, 0, 0);
    out[iconKey(category, id)] = canvas.toDataURL('image/png');
  };
  try {
    BODY_DEFS.forEach((_, i) => draw('body', i));
    LEG_DEFS.forEach((_, i) => draw('legs', i));
    ARM_DEFS.forEach((_, i) => draw('arms', i));
    HEAD_DEFS.forEach((_, i) => draw('head', i));
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    scene.fog = prevFog;
    target.dispose();
  }
  return out;
}
