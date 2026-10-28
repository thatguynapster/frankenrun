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
  /** Lays a green disc (like a slime puddle) on the road at (x, z); level is the polygon offset the game gives road decals, 0 for none. */
  decal(x: number, z: number, level: number, color = 0x35d84a): void {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    if (level > 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -level;
      m.polygonOffsetUnits = -level;
    }
    const d = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), m);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.06, z);
    world?.add(d);
  },
  /** Shows or hides the street meshes, to time what they cost. */
  streets(on: boolean, layer = ""): void {
    for (const m of cityMeshes) if (m.name.startsWith("street-" + layer)) m.userData["off"] = !on;
  },
  /** Average milliseconds per frame over n frames, waiting for the GPU each time. */
  bench(n = 30): number {
    const gl = renderer.getContext();
    const t0 = performance.now();
    cullCity(cityMeshes, camera.position.x, camera.position.z, fogFar);
    for (const m of cityMeshes) if (m.userData["off"] === true) m.visible = false;
    for (let i = 0; i < n; i += 1) {
      renderer.render(scene, camera);
      gl.finish();
    }
    return (performance.now() - t0) / n;
  },
  /** Camera near world point (x, z) looking toward (lx, lz). */
  look(x: number, z: number, lx: number, lz: number, height = 3, ty = 1.5): void {
    camera.position.set(x, height, z);
    camera.lookAt(lx, ty, lz);
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
  for (const m of cityMeshes) if (m.userData["off"] === true) m.visible = false;
  renderer.render(scene, camera);
  info.textContent = `${Math.round(triangles()).toLocaleString()} triangles, ${renderer.info.render.calls} draw calls`;
  requestAnimationFrame(frame);
}
frame();
