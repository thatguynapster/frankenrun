// Dev-only model viewer (models.html): look at any body and part combination, turn it around, and run its animation
// at any speed. Not part of the game build. Uses the same lights as the race view so what you see matches the game.
import * as THREE from 'three';
import { MonsterModel, type BuildIds } from './render/monsters/MonsterModel.js';
import { ARM_DEFS, BODY_DEFS, HEAD_DEFS, LEG_DEFS } from './render/monsters/parts.js';

// The dev server injects the playground's loading overlay into every page; this tool does not use the SDK.
const hideOverlay = (): void => document.getElementById('rundot-game-sandbox-loading')?.remove();
hideOverlay();
setInterval(hideOverlay, 500);

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15172b);
scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x3a3358, 2.4));
const moon = new THREE.DirectionalLight(0xeaf0ff, 2.6);
moon.position.set(-40, 80, -30);
scene.add(moon);
const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshLambertMaterial({ color: 0x2b2f52 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

const model = new MonsterModel(0x6fbf5a);
scene.add(model.root);

const select = (id: string, names: readonly string[]): HTMLSelectElement => {
  const el = document.getElementById(id) as HTMLSelectElement;
  names.forEach((name, i) => el.add(new Option(name, String(i))));
  return el;
};
const ui = {
  body: select('body', BODY_DEFS.map((d) => d.name)),
  legs: select('legs', LEG_DEFS.map((d) => d.name)),
  arms: select('arms', ARM_DEFS.map((d) => d.name)),
  head: select('head', HEAD_DEFS.map((d) => d.name)),
  speed: document.getElementById('speed') as HTMLInputElement,
  az: document.getElementById('az') as HTMLInputElement,
  el: document.getElementById('el') as HTMLInputElement,
};
ui.legs.value = '1';
ui.arms.value = '1';
ui.head.value = '2';

const state = { x: 0, frozen: false, swinging: false, trailing: false, time: 0 };
/** A row of monsters wearing every hat, for checking the fit side by side. */
let row: MonsterModel[] = [];
let rowFocus = false;
let focusIndex = -1; // -1 = the whole row, else one monster of it, up close

function build(): BuildIds {
  return { body: Number(ui.body.value), legs: Number(ui.legs.value), arms: Number(ui.arms.value), head: Number(ui.head.value) };
}

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.frozen) {
    const speed = Number(ui.speed.value);
    state.time += dt;
    state.x += speed * dt;
    model.setBuild(build());
    model.update({ x: state.x, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed, swingPole: state.swinging ? 1 : -1, trailing: state.trailing }, dt, state.time);
    model.root.position.set(0, 1, 0); // the model runs on the spot
    row.forEach((m, i) => {
      m.update({ x: (i - 3) * 2.7, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, swingPole: -1, trailing: false }, dt, state.time);
      m.root.position.set((i - 3) * 2.7, 1, 0);
    });
  }
  const az = (Number(ui.az.value) * Math.PI) / 180;
  const el = (Number(ui.el.value) * Math.PI) / 180;
  const r = rowFocus ? (focusIndex >= 0 ? 4.2 : 15) : 9.5;
  const lookY = rowFocus ? (focusIndex >= 0 ? 2.75 : 3.1) : 1.1;
  const lookX = focusIndex >= 0 ? (focusIndex - 3) * 2.7 : 0;
  camera.position.set(lookX + Math.sin(az) * Math.cos(el) * r, lookY + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
  camera.lookAt(lookX, lookY, 0);
  renderer.render(scene, camera);
  (document.getElementById('info') as HTMLElement).textContent = `${model.triangles()} triangles`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handles for scripted inspection (and screenshots): window.viewer.set({...}), .look(turn, tilt), .run(speed), .freeze().
(window as unknown as { viewer: unknown }).viewer = {
  set(b: Partial<BuildIds>): void {
    const next = { ...build(), ...b };
    ui.body.value = String(next.body);
    ui.legs.value = String(next.legs);
    ui.arms.value = String(next.arms);
    ui.head.value = String(next.head);
  },
  look(turn: number, tilt: number): void {
    ui.az.value = String(turn);
    ui.el.value = String(tilt);
  },
  run(speed: number): void {
    ui.speed.value = String(speed);
  },
  freeze(on = true): void {
    state.frozen = on;
  },
  swing(on: boolean): void {
    state.swinging = on;
  },
  trail(on: boolean): void {
    state.trailing = on;
  },
  /** Seven monsters side by side, one per hat (none, then the six hats), on the given body and head. */
  hats(body: number, head: number): void {
    for (const m of row) scene.remove(m.root);
    row = [];
    for (let hat = 0; hat < 7; hat += 1) {
      const m = new MonsterModel(0x6fbf5a);
      m.setBuild({ body, legs: 0, arms: 0, head }, false);
      m.setStyle({ tint: 0, hat });
      scene.add(m.root);
      row.push(m);
    }
    model.root.visible = false;
    rowFocus = true;
  },
  focus(index: number): void {
    focusIndex = index;
  },
  style(tint: number, hat: number): void {
    model.setStyle({ tint, hat });
  },
  hit(strength = 1): void {
    model.hit(strength);
  },
  snap(): void {
    model.snapClaws();
  },
  triangles: (): number => model.triangles(),
};
