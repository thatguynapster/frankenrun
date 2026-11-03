// Dev-only thumbnail maker (thumbnail.html): composes the 512x512 store thumbnail from the game's own monster models,
// the Monster Mash palette and the stitched logo. Not part of the game build. Run the dev server, open /thumbnail.html,
// then window.thumb.save('thumbnail.jpg', url) posts the finished JPEG to a local saver (see the project notes).
import * as THREE from 'three';
import { MonsterModel, type BuildIds } from './render/monsters/MonsterModel.js';
import type { Style } from './render/monsters/style.js';

const hideOverlay = (): void => document.getElementById('rundot-game-sandbox-loading')?.remove();
hideOverlay();
setInterval(hideOverlay, 500);

const SIZE = 1024;
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const out = document.getElementById('out') as HTMLCanvasElement;
const ctx = out.getContext('2d')!;

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x2a1245, 26, 120);
scene.add(new THREE.HemisphereLight(0xd9a6ff, 0x3a2058, 2.6));
const rim = new THREE.DirectionalLight(0xff9a3c, 2.4);
rim.position.set(-20, 30, -40);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
camera.position.set(0, 2.4, 16);
camera.lookAt(0, 1.35, 0);
camera.updateMatrixWorld();

// the road: dark asphalt with glowing dashes, running away from the camera
const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 400), new THREE.MeshBasicMaterial({ color: 0x241338 }));
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -150);
scene.add(road);
const dashMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
for (let i = 0; i < 40; i += 1) {
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 2.4), dashMat);
  dash.rotation.x = -Math.PI / 2;
  dash.position.set(0, 0.02, 12 - i * 6);
  scene.add(dash);
}
const kerbMat = new THREE.MeshBasicMaterial({ color: 0x6a4a9a });
for (const side of [-1, 1]) {
  const kerb = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 400), kerbMat);
  kerb.rotation.x = -Math.PI / 2;
  kerb.position.set(side * 9.5, 0.03, -150);
  scene.add(kerb);
}

interface Racer {
  readonly build: BuildIds;
  readonly style: Style;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly scale: number;
}

// the hero (centre, in front) and two rivals, each a different mix of parts: the crowd of a race
const RACERS: readonly Racer[] = [
  { build: { body: 0, legs: 1, arms: 2, head: 2 }, style: { tint: 0, hat: 0 }, x: 0.2, z: 2.4, yaw: 0.18, speed: 15, scale: 1.18 },
  { build: { body: 1, legs: 2, arms: 1, head: 1 }, style: { tint: 1, hat: 2 }, x: -4.1, z: -1.8, yaw: 0.45, speed: 14, scale: 1 },
  { build: { body: 0, legs: 3, arms: 2, head: 3 }, style: { tint: 5, hat: 4 }, x: 4.3, z: -1.4, yaw: -0.45, speed: 14, scale: 1 },
];
const models = RACERS.map((r) => {
  const m = new MonsterModel(0x6fbf5a);
  m.setBuild(r.build, false);
  m.setStyle(r.style);
  scene.add(m.root);
  return m;
});

function poseMonsters(time: number): void {
  RACERS.forEach((r, i) => {
    const m = models[i]!;
    m.update({ x: 0, y: 1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: r.speed, swingPole: -1, trailing: false }, 1 / 30, time + i * 0.37);
    m.root.position.set(r.x, 1, r.z);
    m.root.rotation.y = r.yaw;
    m.root.scale.setScalar(r.scale);
  });
}

/** Where the horizon falls on the canvas, from the camera. */
function horizonY(): number {
  const p = new THREE.Vector3(0, 0, -390).project(camera);
  return ((1 - p.y) / 2) * SIZE;
}

const rand = (seed: number): (() => number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

function drawSky(c: CanvasRenderingContext2D, horizon: number): void {
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0b0514');
  sky.addColorStop(0.55, '#34124f');
  sky.addColorStop(0.9, '#8a2f5a');
  sky.addColorStop(1, '#ff7a1f');
  c.fillStyle = sky;
  c.fillRect(0, 0, SIZE, horizon + 2);
  c.fillStyle = '#2a1245';
  c.fillRect(0, horizon, SIZE, SIZE - horizon);
  const r = rand(7);
  for (let i = 0; i < 70; i += 1) {
    c.globalAlpha = 0.25 + r() * 0.6;
    c.fillStyle = '#f3ecd2';
    const s = r() < 0.15 ? 2.6 : 1.4;
    c.fillRect(r() * SIZE, r() * horizon * 0.7, s, s);
  }
  c.globalAlpha = 1;
}

function drawMoon(c: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const glow = c.createRadialGradient(x, y, radius * 0.8, x, y, radius * 1.9);
  glow.addColorStop(0, 'rgba(255,138,31,0.55)');
  glow.addColorStop(1, 'rgba(255,138,31,0)');
  c.fillStyle = glow;
  c.fillRect(x - radius * 2, y - radius * 2, radius * 4, radius * 4);
  const disc = c.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.2, x, y, radius);
  disc.addColorStop(0, '#ffd08a');
  disc.addColorStop(1, '#ff8a1f');
  c.fillStyle = disc;
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(138,61,0,0.28)';
  for (const [dx, dy, rr] of [[-0.35, -0.2, 0.17], [0.25, 0.1, 0.22], [-0.1, 0.45, 0.12], [0.4, -0.45, 0.1]] as const) {
    c.beginPath();
    c.arc(x + dx * radius, y + dy * radius, rr * radius, 0, Math.PI * 2);
    c.fill();
  }
}

function drawCity(c: CanvasRenderingContext2D, horizon: number): void {
  const r = rand(21);
  let x = -20;
  while (x < SIZE + 20) {
    const w = 38 + r() * 60;
    const h = 60 + r() * 150;
    c.fillStyle = r() < 0.5 ? '#1a0a2b' : '#220f38';
    c.fillRect(x, horizon - h, w, h + 4);
    c.fillStyle = r() < 0.5 ? '#ffb347' : '#ffe27a';
    for (let wy = horizon - h + 14; wy < horizon - 10; wy += 22) {
      for (let wx = x + 8; wx < x + w - 10; wx += 16) {
        if (r() < 0.22) c.fillRect(wx, wy, 7, 10);
      }
    }
    x += w + 2;
  }
}

function drawBat(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.fillStyle = '#0d0716';
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x - 14 * s, y - 14 * s, x - 34 * s, y - 4 * s);
  c.quadraticCurveTo(x - 22 * s, y + 2 * s, x - 14 * s, y + 8 * s);
  c.quadraticCurveTo(x - 6 * s, y + 2 * s, x, y + 6 * s);
  c.quadraticCurveTo(x + 6 * s, y + 2 * s, x + 14 * s, y + 8 * s);
  c.quadraticCurveTo(x + 22 * s, y + 2 * s, x + 34 * s, y - 4 * s);
  c.quadraticCurveTo(x + 14 * s, y - 14 * s, x, y);
  c.fill();
}

function drawSpeedLines(c: CanvasRenderingContext2D): void {
  const r = rand(99);
  c.lineCap = 'round';
  for (let i = 0; i < 26; i += 1) {
    const a = r() * Math.PI * 2;
    const d0 = 430 + r() * 150;
    const d1 = d0 + 50 + r() * 120;
    c.strokeStyle = `rgba(255,224,160,${0.1 + r() * 0.2})`;
    c.lineWidth = 2 + r() * 3;
    c.beginPath();
    c.moveTo(SIZE / 2 + Math.cos(a) * d0, SIZE * 0.45 + Math.sin(a) * d0);
    c.lineTo(SIZE / 2 + Math.cos(a) * d1, SIZE * 0.45 + Math.sin(a) * d1);
    c.stroke();
  }
}

function drawSparks(c: CanvasRenderingContext2D): void {
  const r = rand(5);
  for (let i = 0; i < 38; i += 1) {
    c.fillStyle = r() < 0.5 ? '#ffb347' : r() < 0.5 ? '#8cff3a' : '#d9a6ff';
    c.globalAlpha = 0.5 + r() * 0.5;
    const s = 3 + r() * 5;
    c.fillRect(r() * SIZE, 120 + r() * 640, s, s);
  }
  c.globalAlpha = 1;
}

/** The stitched wordmark: FRANKEN and RUN sewn together, bolts at the ends, an eye over the seam. */
function drawLogo(c: CanvasRenderingContext2D, centreX: number, baseY: number, totalWidth: number): void {
  const fontSize = 190;
  c.font = `${fontSize}px Creepster, Impact, fantasy`;
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  const a = c.measureText('FRANKEN').width;
  const b = c.measureText('RUN').width;
  const gap = 64;
  const natural = a + gap + b;
  const k = totalWidth / natural;
  c.save();
  c.translate(centreX, baseY);
  c.scale(k, k);
  const left = -natural / 2;
  const seamX = left + a + gap / 2;
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = 0;
  c.shadowOffsetY = 12;
  for (const [text, x, fill, stroke] of [
    ['FRANKEN', left, '#ff8a1f', '#7a3300'],
    ['RUN', left + a + gap, '#8cff3a', '#24560a'],
  ] as const) {
    c.lineWidth = 22;
    c.strokeStyle = stroke;
    c.strokeText(text, x, 0);
    c.shadowColor = 'transparent';
    c.fillStyle = fill;
    c.fillText(text, x, 0);
    c.shadowColor = 'rgba(0,0,0,0.6)';
  }
  c.shadowColor = 'transparent';
  // the seam: a dashed stitch line with cross stitches
  c.strokeStyle = '#f3ecd2';
  c.lineWidth = 7;
  c.lineCap = 'round';
  c.setLineDash([16, 14]);
  c.beginPath();
  c.moveTo(seamX, -150);
  c.lineTo(seamX, 14);
  c.stroke();
  c.setLineDash([]);
  for (let y = -130; y < 6; y += 24) {
    c.beginPath();
    c.moveTo(seamX - 18, y - 9);
    c.lineTo(seamX + 18, y + 9);
    c.moveTo(seamX + 18, y - 9);
    c.lineTo(seamX - 18, y + 9);
    c.stroke();
  }
  // neck bolts
  for (const bx of [left - 28, left + natural + 18]) {
    c.fillStyle = '#9aa3b5';
    c.strokeStyle = '#2e3346';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(bx - 5, -92, 20, 62, 4);
    c.fill();
    c.stroke();
    c.beginPath();
    c.roundRect(bx - 16, -78, 42, 11, 4);
    c.fill();
    c.stroke();
  }
  // the eye
  const ex = seamX, ey = -190, er = 54;
  c.fillStyle = '#f3ecd2';
  c.strokeStyle = '#3b1a14';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(ex, ey, er, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.strokeStyle = '#d6403a';
  c.lineWidth = 3;
  for (const [x1, y1, x2, y2] of [[-47, -12, -28, -6], [-49, 12, -30, 6], [47, -16, 28, -8], [44, 18, 26, 10], [-12, -50, -8, -33], [16, -50, 10, -33]] as const) {
    c.beginPath();
    c.moveTo(ex + x1, ey + y1);
    c.lineTo(ex + x2, ey + y2);
    c.stroke();
  }
  const ix = ex + 12, iy = ey + 6;
  c.fillStyle = '#8cff3a';
  c.strokeStyle = '#24560a';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(ix, iy, 27, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = '#14091f';
  c.beginPath();
  c.arc(ix + 2, iy + 1, 13, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(ix - 7, iy - 9, 5.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function draw(time = 0.6): void {
  const horizon = horizonY();
  ctx.clearRect(0, 0, SIZE, SIZE);
  drawSky(ctx, horizon);
  drawMoon(ctx, 520, horizon - 120, 250);
  drawCity(ctx, horizon);
  drawBat(ctx, 190, 150, 1.1);
  drawBat(ctx, 300, 90, 0.8);
  drawBat(ctx, 820, 130, 1);
  drawBat(ctx, 900, 215, 0.7);
  poseMonsters(time);
  renderer.render(scene, camera);
  ctx.drawImage(glCanvas, 0, 0, SIZE, SIZE);
  drawSpeedLines(ctx);
  drawSparks(ctx);
  // vignette, and a dark floor under the logo so it reads
  const v = ctx.createRadialGradient(SIZE / 2, SIZE * 0.45, SIZE * 0.35, SIZE / 2, SIZE * 0.45, SIZE * 0.78);
  v.addColorStop(0, 'rgba(8,3,16,0)');
  v.addColorStop(1, 'rgba(8,3,16,0.6)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const floor = ctx.createLinearGradient(0, SIZE * 0.72, 0, SIZE);
  floor.addColorStop(0, 'rgba(8,3,16,0)');
  floor.addColorStop(1, 'rgba(8,3,16,0.82)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, SIZE * 0.72, SIZE, SIZE * 0.28);
  drawLogo(ctx, SIZE / 2, SIZE - 70, 900);
  // the stitched frame
  ctx.strokeStyle = 'rgba(243,236,210,0.5)';
  ctx.lineWidth = 5;
  ctx.setLineDash([22, 16]);
  ctx.strokeRect(18, 18, SIZE - 36, SIZE - 36);
  ctx.setLineDash([]);
}

async function save(name: string, url: string): Promise<string> {
  const small = document.createElement('canvas');
  small.width = 512;
  small.height = 512;
  const sc = small.getContext('2d')!;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(out, 0, 0, 512, 512);
  const blob = await new Promise<Blob | null>((resolve) => small.toBlob(resolve, 'image/jpeg', 0.92));
  if (blob === null) return 'no blob';
  const res = await fetch(`${url}/?name=${name}`, { method: 'POST', body: blob });
  return `${res.status} ${blob.size}`;
}

void document.fonts.load('190px Creepster').then(() => {
  draw();
  (window as unknown as { thumb: unknown }).thumb = { draw, save };
});
