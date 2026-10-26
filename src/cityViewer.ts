// Dev-only city viewer (city.html): fly a camera along a baked route to look at the buildings and street scenery.
// window.cityView.go(route, t, dist, height, yawOffset) puts the camera on the route. Not part of the game build.
import * as THREE from 'three';
import type { MapData } from './sim/mapdata.js';
import { buildCity, cullCity } from './render/city.js';
import { THEMES, routeInfo } from './routes.js';

const hideOverlay = (): void => document.getElementById('rundot-game-sandbox-loading')?.remove();
hideOverlay();
setInterval(hideOverlay, 500);

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600);
let world: THREE.Group | undefined;
let cityMeshes: THREE.Object3D[] = [];
let fogFar = 230;
let map: MapData | undefined;

async function load(id: string): Promise<void> {
  const res = await fetch(`/cdn-assets/${routeInfo(id)?.city ?? "accra"}/${id}.map.json.gz`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  map = JSON.parse(new TextDecoder().decode(bytes)) as MapData;
  if (world) scene.remove(world);
  const theme = THEMES[id] ?? THEMES['route1']!;
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
  world = new THREE.Group();
  const b = map.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((b.maxX - b.minX) / 10 + 200, (b.maxZ - b.minZ) / 10 + 200), new THREE.MeshBasicMaterial({ color: 0x1f2540 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 20, 0, (b.minZ + b.maxZ) / 20);
  world.add(ground);
  // one merged ribbon mesh, as the race view draws the roads
  const positions: number[] = [];
  for (const r of map.roads) {
    const hw = r.hw / 10;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const x0 = r.pts[i]! / 10, z0 = r.pts[i + 1]! / 10, x1 = r.pts[i + 2]! / 10, z1 = r.pts[i + 3]! / 10;
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      const nx = (-(z1 - z0) / len) * hw, nz = ((x1 - x0) / len) * hw;
      const y = 0.04;
      positions.push(x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x0 - nx, y, z0 - nz);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  world.add(new THREE.Mesh(roadGeo, new THREE.MeshBasicMaterial({ color: 0x6a728f, side: THREE.DoubleSide })));
  cityMeshes = buildCity(map, theme.cityTint, routeInfo(id)?.city);
  fogFar = theme.fogFar;
  for (const o of cityMeshes) world.add(o);
  scene.add(world);
}

function triangles(): number {
  let t = 0;
  world?.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && (o as THREE.Mesh).isMesh) t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return t;
}

function resize(): void {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const view = {
  load,
  /** Camera on the route at fraction t (0..1), `dist` metres behind and `height` above, turned `yaw` radians. */
  go(t: number, dist = 9, height = 5, yaw = 0): void {
    const r = map?.route;
    if (!r) return;
    const n = r.length / 2;
    const i = Math.min(n - 2, Math.max(0, Math.floor(t * (n - 1))));
    const x = r[i * 2]! / 10, z = r[i * 2 + 1]! / 10, nx = r[i * 2 + 2]! / 10, nz = r[i * 2 + 3]! / 10;
    const a = Math.atan2(nx - x, nz - z) + yaw;
    camera.position.set(x - Math.sin(a) * dist, height, z - Math.cos(a) * dist);
    camera.lookAt(x + Math.sin(a) * 12, 3, z + Math.cos(a) * 12);
  },
  triangles,
  /** Average milliseconds per frame over n frames, waiting for the GPU each time. */
  bench(n = 30): number {
    const gl = renderer.getContext();
    const t0 = performance.now();
    cullCity(cityMeshes, camera.position.x, camera.position.z, fogFar);
    for (let i = 0; i < n; i += 1) {
      renderer.render(scene, camera);
      gl.finish();
    }
    return (performance.now() - t0) / n;
  },
  /** Camera near world point (x, z) looking toward (lx, lz). */
  look(x: number, z: number, lx: number, lz: number, height = 3): void {
    camera.position.set(x, height, z);
    camera.lookAt(lx, 1.5, lz);
  },
  get map(): MapData | undefined {
    return map;
  },
  breakdown(): Record<string, number> {
    const out: Record<string, number> = {};
    world?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      out[m.name || "ground/roads"] = (out[m.name || "ground/roads"] ?? 0) + (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    });
    return out;
  },
  calls: () => renderer.info.render.calls,
};
(window as unknown as { cityView: typeof view }).cityView = view;

function frame(): void {
  cullCity(cityMeshes, camera.position.x, camera.position.z, fogFar);
  renderer.render(scene, camera);
  info.textContent = `${Math.round(triangles()).toLocaleString()} triangles, ${renderer.info.render.calls} draw calls`;
  requestAnimationFrame(frame);
}
frame();
