import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameProjection, PlayerView } from '../sim/game.js';
import type { MapData } from '../sim/mapdata.js';
import { getPreparedMap, type PreparedMap } from '../sim/world.js';
import { CHASSIS_HALF, CHECKPOINT_RADIUS, HEADS } from '../sim/parts.js';

const SLOT_COLORS = [0x6fbf5a, 0x5aa7bf, 0xbf7a5a, 0xbfa95a, 0x9a5abf, 0xbf5a8d, 0x5abf9a, 0xbfbfbf];
const LEGS_COLOR = 0xff9a2e;
const ARMS_COLOR = 0xb04cff;
const HEAD_COLOR = 0xb6ff3b;

interface CarRig {
  group: THREE.Group;
  /** Torso mesh and seam, scaled/tinted per body. */
  torso: THREE.Group;
  /** One model per part id (index 0 is an empty slot and has no model). */
  legs: (THREE.Group | undefined)[];
  arms: (THREE.Group | undefined)[];
  head: (THREE.Group | undefined)[];
  rope: THREE.Line;
}

/** Renders a GameProjection. Reads state, never writes back into the simulation. */
export class RaceView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.5, 320);
  private cars: CarRig[] = [];
  private rings: THREE.Mesh[] = [];
  private worldGroup: THREE.Group | undefined;
  private anchors: { x: number; z: number }[] = [];
  private prep: PreparedMap | undefined;
  private colliderLines: THREE.LineSegments | undefined;
  private colliderSignature = '';
  private slickPool: THREE.Mesh[] = [];
  private slickGeo = new THREE.CircleGeometry(HEADS.slime.slickRadius, 20);
  private slickMat = new THREE.MeshBasicMaterial({ color: 0x4dff6a, transparent: true, opacity: 0.45 });
  private resizeObserver: ResizeObserver;
  private camPos = new THREE.Vector3(0, 6, -10);
  private camLook = new THREE.Vector3(0, 1, 10);
  private cameraReady = false;
  private frameHandle = 0;
  private quality = 0;
  private baseQuality = 0;

  constructor(private container: HTMLElement) {
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    // Multisampling is expensive on phone GPUs, and phones start at a lower render resolution.
    this.renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' });
    this.quality = touch ? 1 : 0;
    this.baseQuality = 0;
    this.applyQuality();
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';

    this.scene.background = new THREE.Color(0x232b52);
    this.scene.fog = new THREE.Fog(0x232b52, 50, 230);
    this.scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x3a3358, 2.4));
    const moon = new THREE.DirectionalLight(0xeaf0ff, 2.6);
    moon.position.set(-60, 120, -40);
    this.scene.add(moon);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Builds (or rebuilds) the static city for a baked map. Everything is merged into a handful of meshes. */
  setMap(map: MapData): void {
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.worldGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    const group = new THREE.Group();
    this.worldGroup = group;
    this.rings = [];
    this.anchors = map.anchors.map((a) => ({ x: a.x / 10, z: a.z / 10 }));
    this.prep = getPreparedMap(map.id);
    this.clearColliderLines();

    const { minX, maxX, minZ, maxZ } = map.bounds;
    const cx = (minX + maxX) / 20, cz = (minZ + maxZ) / 20, w = (maxX - minX) / 10 + 60, h = (maxZ - minZ) / 10 + 60;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x1f2540 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    group.add(ground);
    if (map.roads.length === 0) {
      const grid = new THREE.GridHelper(Math.max(w, h), Math.max(w, h) / 10, 0x3a4468, 0x2c3552);
      grid.position.set(cx, 0.02, cz);
      group.add(grid);
    }

    // Roads: one flat ribbon per segment, merged into a single mesh.
    if (map.roads.length > 0) {
      const positions: number[] = [];
      for (const road of map.roads) {
        const hw = road.hw / 10;
        for (let i = 0; i + 3 < road.pts.length; i += 2) {
          const x0 = road.pts[i]! / 10, z0 = road.pts[i + 1]! / 10, x1 = road.pts[i + 2]! / 10, z1 = road.pts[i + 3]! / 10;
          const len = Math.hypot(x1 - x0, z1 - z0) || 1;
          const nx = (-(z1 - z0) / len) * hw, nz = ((x1 - x0) / len) * hw;
          const y = 0.04;
          positions.push(x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x0 - nx, y, z0 - nz);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x6a728f, side: THREE.DoubleSide })));
    }

    // Buildings: extruded footprints in a few muted night colours. They are merged per 100 m chunk, so the
    // camera frustum can skip whole chunks instead of drawing the entire city every frame.
    if (map.buildings.length > 0) {
      const palette = [0x8a78c0, 0x6d86bd, 0x9a7ec4, 0x6fa3ad].map((c) => new THREE.Color(c));
      const chunks = new Map<string, THREE.BufferGeometry[]>();
      map.buildings.forEach((b, i) => {
        const shape = new THREE.Shape();
        let sx = 0, sz = 0;
        for (let k = 0; k < b.pts.length; k += 2) {
          const x = b.pts[k]! / 10, z = b.pts[k + 1]! / 10;
          sx += x;
          sz += z;
          if (k === 0) shape.moveTo(x, -z);
          else shape.lineTo(x, -z);
        }
        const n = b.pts.length / 2;
        const extruded = new THREE.ExtrudeGeometry(shape, { depth: b.h / 10, bevelEnabled: false });
        extruded.rotateX(-Math.PI / 2); // extrude along +Y; (x, -z) in shape space maps back to (x, z)
        const g = extruded.index ? extruded.toNonIndexed() : extruded;
        if (g !== extruded) extruded.dispose();
        const c = palette[i % palette.length]!;
        const count = g.getAttribute('position').count;
        const colors = new Float32Array(count * 3);
        for (let v = 0; v < count; v += 1) {
          colors[v * 3] = c.r;
          colors[v * 3 + 1] = c.g;
          colors[v * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.deleteAttribute('uv');
        const key = `${Math.floor(sx / n / 100)},${Math.floor(sz / n / 100)}`;
        const list = chunks.get(key);
        if (list) list.push(g);
        else chunks.set(key, [g]);
      });
      // Lighting is baked into the vertex colours (a fixed moon direction plus ambient), so the city can be
      // drawn with a trivial unlit shader. This keeps the flat-shaded look at a fraction of the GPU cost.
      const material = new THREE.MeshBasicMaterial({ vertexColors: true });
      const moon = new THREE.Vector3(-0.45, 0.8, -0.3).normalize();
      for (const geos of chunks.values()) {
        const merged = mergeGeometries(geos, false);
        if (merged) {
          merged.computeVertexNormals();
          const normals = merged.getAttribute('normal');
          const colors = merged.getAttribute('color');
          for (let v = 0; v < normals.count; v += 1) {
            const lit = Math.max(0, normals.getX(v) * moon.x + normals.getY(v) * moon.y + normals.getZ(v) * moon.z);
            const shade = 0.5 + 0.62 * lit;
            colors.setXYZ(v, Math.min(1, colors.getX(v) * shade), Math.min(1, colors.getY(v) * shade), Math.min(1, colors.getZ(v) * shade));
          }
          merged.deleteAttribute('normal');
          merged.computeBoundingSphere();
          group.add(new THREE.Mesh(merged, material));
        }
        geos.forEach((g) => g.dispose());
      }
    }

    // Walls and the boundary.
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x6a5a86, flatShading: true });
    for (const wl of map.walls) {
      const [x0, z0, x1, z1] = wl.pts;
      const len = Math.hypot(x1 - x0, z1 - z0) / 10;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, wl.h / 10, 0.3), wallMat);
      mesh.position.set((x0 + x1) / 20, wl.h / 20, (z0 + z1) / 20);
      mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      group.add(mesh);
    }
    const edge = new THREE.MeshLambertMaterial({ color: 0x3a2f55, flatShading: true });
    const hx = (maxX - minX) / 20, hz = (maxZ - minZ) / 20;
    const boundary: [number, number, number, number][] = [
      [cx, cz + hz + 1, hx * 2 + 4, 2],
      [cx, cz - hz - 1, hx * 2 + 4, 2],
      [cx + hx + 1, cz, 2, hz * 2],
      [cx - hx - 1, cz, 2, hz * 2],
    ];
    for (const [bx, bz, bw, bd] of boundary) {
      const edgeMesh = new THREE.Mesh(new THREE.BoxGeometry(bw, 6, bd), edge);
      edgeMesh.position.set(bx, 3, bz);
      group.add(edgeMesh);
    }

    // Tentacle anchors.
    const poleMat = new THREE.MeshLambertMaterial({ color: ARMS_COLOR, emissive: 0x3a1566, flatShading: true });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), poleMat, Math.max(1, this.anchors.length));
    this.anchors.forEach((a, i) => poles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(a.x, 1.5, a.z)));
    poles.count = this.anchors.length;
    group.add(poles);

    // Checkpoints.
    map.checkpoints.forEach((cp, i) => {
      const final = i === map.checkpoints.length - 1;
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(CHECKPOINT_RADIUS, CHECKPOINT_RADIUS, 14, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: final ? 0xffd23b : 0x3bd1ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.position.set(cp.x / 10, 7, cp.z / 10);
      group.add(ring);
      this.rings.push(ring);
    });
    this.scene.add(group);
  }

  private makeCar(slot: number): CarRig {
    const group = new THREE.Group();
    const bodyColor = SLOT_COLORS[slot % SLOT_COLORS.length] ?? 0xffffff;
    const lambert = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const torso = new THREE.Group();
    torso.add(new THREE.Mesh(new THREE.BoxGeometry(CHASSIS_HALF.x * 2, CHASSIS_HALF.y * 2, CHASSIS_HALF.z * 2), lambert(bodyColor)));
    // Stitches: a dark seam across the torso.
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS_HALF.x * 2 + 0.05, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x151515 }),
    );
    seam.position.set(0, 0.1, 0);
    torso.add(seam);
    group.add(torso);

    // Legs: 1 = Werewolf (four stout legs), 2 = Spider (eight thin legs splayed outwards).
    const werewolf = new THREE.Group();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.95, 6), lambert(LEGS_COLOR));
        leg.position.set(sx * 0.65, -0.45, sz * 0.9);
        werewolf.add(leg);
      }
    }
    const spider = new THREE.Group();
    for (const sx of [-1, 1]) {
      for (const z of [-0.95, -0.32, 0.32, 0.95]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.15, 5), lambert(0x3a2a1a));
        leg.position.set(sx * 0.95, -0.4, z);
        leg.rotation.z = -sx * 0.7;
        spider.add(leg);
      }
    }

    // Arms: 1 = Tentacles (two long purple capsules), 2 = Crab Claws (two red pincers).
    const tentacles = new THREE.Group();
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 1.1, 3, 6), lambert(ARMS_COLOR));
      arm.rotation.x = Math.PI / 2;
      arm.position.set(sx * 0.9, 0.1, 0.6);
      tentacles.add(arm);
    }
    const claws = new THREE.Group();
    for (const sx of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), lambert(0xd8452e));
      upper.position.set(sx * 0.95, 0.1, 0.7);
      claws.add(upper);
      for (const side of [-1, 1]) {
        const pincer = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 5), lambert(0xe86a4a));
        pincer.rotation.x = Math.PI / 2;
        pincer.position.set(sx * 0.95 + side * 0.14, 0.1, 1.3);
        claws.add(pincer);
      }
    }

    // Head: 1 = Slime Gland (green blob), 2 = Jack-o'-Lantern (orange head with a dark carved face).
    const slime = new THREE.Group();
    const slimeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), lambert(HEAD_COLOR));
    slimeMesh.position.set(0, 0.75, 0.2);
    slime.add(slimeMesh);
    const lantern = new THREE.Group();
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lambert(0xff8a1f));
    pumpkin.scale.set(1.1, 0.9, 1.1);
    pumpkin.position.set(0, 0.75, 0.2);
    lantern.add(pumpkin);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe84a }));
      eye.position.set(sx * 0.18, 0.82, 0.7);
      lantern.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe84a }));
    mouth.position.set(0, 0.62, 0.7);
    lantern.add(mouth);

    const legs = [undefined, werewolf, spider];
    const arms = [undefined, tentacles, claws];
    const head = [undefined, slime, lantern];
    for (const g of [...legs, ...arms, ...head]) if (g) group.add(g);

    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: ARMS_COLOR }),
    );
    rope.frustumCulled = false;
    rope.visible = false;
    this.scene.add(rope);
    this.scene.add(group);
    return { group, torso, legs, arms, head, rope };
  }

  private updateSlicks(frame: GameProjection): void {
    while (this.slickPool.length < frame.slicks.length) {
      const m = new THREE.Mesh(this.slickGeo, this.slickMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.05;
      this.scene.add(m);
      this.slickPool.push(m);
    }
    this.slickPool.forEach((m, i) => {
      const s = frame.slicks[i];
      m.visible = s !== undefined;
      if (s !== undefined) m.position.set(s.x, 0.05, s.z);
    });
  }

  private updateCar(rig: CarRig, p: PlayerView): void {
    rig.group.position.set(p.x, p.y, p.z);
    rig.group.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    rig.legs.forEach((g, i) => g && (g.visible = i === p.build.legs));
    rig.arms.forEach((g, i) => g && (g.visible = i === p.build.arms));
    rig.head.forEach((g, i) => g && (g.visible = i === p.build.head));
    if (p.build.head === 1) rig.head[1]?.children[0]?.scale.setScalar(p.trailing ? 1.25 : 1);
    // The Bone Rattler is a smaller, paler frame than the Brute.
    const small = p.build.body === 1;
    rig.group.scale.setScalar(small ? 0.85 : 1);
    if (p.swingPole >= 0) {
      const pole = this.anchors[p.swingPole];
      if (pole !== undefined) {
        const pos = rig.rope.geometry.attributes['position'] as THREE.BufferAttribute;
        pos.setXYZ(0, p.x, p.y + 0.4, p.z);
        pos.setXYZ(1, pole.x, 2.6, pole.z);
        pos.needsUpdate = true;
        rig.rope.visible = true;
      }
    } else {
      rig.rope.visible = false;
    }
  }

  private updateCamera(local: PlayerView | undefined, dt: number): void {
    if (local === undefined) return;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(local.qx, local.qy, local.qz, local.qw));
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, 1);
    forward.normalize();
    const pull = 9 + Math.min(local.speed, 24) * 0.35;
    const wantPos = new THREE.Vector3(local.x, local.y + 4.2 + local.speed * 0.04, local.z).addScaledVector(forward, -pull);
    const wantLook = new THREE.Vector3(local.x, local.y + 0.8, local.z).addScaledVector(forward, 5);
    if (!this.cameraReady) {
      this.camPos.copy(wantPos);
      this.camLook.copy(wantLook);
      this.cameraReady = true;
    } else {
      const k = 1 - Math.exp(-dt * 6);
      this.camPos.lerp(wantPos, k);
      this.camLook.lerp(wantLook, 1 - Math.exp(-dt * 10));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private clearColliderLines(): void {
    if (this.colliderLines) {
      this.scene.remove(this.colliderLines);
      this.colliderLines.geometry.dispose();
      this.colliderLines = undefined;
    }
    this.colliderSignature = '';
  }

  /**
   * Draws the colliders that are currently loaded in the physics world (the cells around each car) as red
   * wireframes. It rebuilds only when the set of loaded cells changes, which is the same moment the sim loads
   * or drops colliders, so it shows exactly what the cars can hit.
   */
  private updateColliderLines(frame: GameProjection | undefined, show: boolean): void {
    if (!show || !frame || !this.prep) {
      if (this.colliderLines) this.clearColliderLines();
      return;
    }
    const signature = frame.activeCells.join(',');
    if (signature === this.colliderSignature && this.colliderLines) return;
    this.clearColliderLines();
    this.colliderSignature = signature;
    const positions: number[] = [];
    const drawn = new Set<string>();
    for (const cell of frame.activeCells) {
      for (const { footprint, heightM } of this.prep.cellHulls(cell)) {
        const key = `${footprint[0]},${footprint[1]},${footprint.length}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const n = footprint.length / 2;
        for (let i = 0; i < n; i += 1) {
          const j = (i + 1) % n;
          const x0 = footprint[i * 2]! / 10, z0 = footprint[i * 2 + 1]! / 10, x1 = footprint[j * 2]! / 10, z1 = footprint[j * 2 + 1]! / 10;
          positions.push(x0, 0.15, z0, x1, 0.15, z1, x0, heightM, z0, x1, heightM, z1, x0, 0.15, z0, x0, heightM, z0);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.colliderLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff3b3b, depthTest: false }));
    this.colliderLines.renderOrder = 10;
    this.colliderLines.frustumCulled = false;
    this.scene.add(this.colliderLines);
  }

  render(frame: GameProjection | undefined, localSlot: number, dtSeconds: number, showColliders = false): void {
    this.updateColliderLines(frame, showColliders);
    if (frame !== undefined) {
      while (this.cars.length < frame.players.length) this.cars.push(this.makeCar(this.cars.length));
      frame.players.forEach((p, i) => {
        const rig = this.cars[i];
        if (rig !== undefined) this.updateCar(rig, p);
      });
      this.updateSlicks(frame);
      const local = frame.players[localSlot] ?? frame.players[0];
      this.updateCamera(local, dtSeconds);
      const next = local === undefined ? 0 : local.nextCheckpoint;
      this.rings.forEach((ring, i) => {
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.opacity = i === next ? 0.38 : i < next ? 0.04 : 0.14;
      });
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Render-resolution steps: index 0 is the sharpest. Each step down cuts the pixels drawn substantially. */
  static readonly PIXEL_RATIOS = [2, 1.5, 1, 0.75, 0.5] as const;

  get qualityLevel(): number {
    return this.quality;
  }
  get minQualityLevel(): number {
    return this.baseQuality;
  }
  get maxQualityLevel(): number {
    return RaceView.PIXEL_RATIOS.length - 1;
  }

  setQualityLevel(level: number): void {
    this.quality = Math.max(0, Math.min(RaceView.PIXEL_RATIOS.length - 1, level));
    this.applyQuality();
  }

  private applyQuality(): void {
    const ratio = Math.min(window.devicePixelRatio, RaceView.PIXEL_RATIOS[this.quality] ?? 1);
    this.renderer.setPixelRatio(ratio);
    if (this.container.clientWidth > 0) this.resize();
  }

  /** Static facts about the GPU path, for the on-screen diagnostics. */
  gpuInfo(): { gpu: string; width: number; height: number; ratio: number } {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    return { gpu, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, ratio: this.renderer.getPixelRatio() };
  }

  /** Draw-call and triangle counts of the last rendered frame (for performance diagnostics). */
  stats(): { triangles: number; calls: number; geometries: number } {
    const info = this.renderer.info;
    return { triangles: info.render.triangles, calls: info.render.calls, geometries: info.memory.geometries };
  }

  /** World position of a checkpoint projected to screen NDC, for an off-screen arrow in the HUD. */
  projectToNdc(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: v.x, y: v.y, behind: v.z > 1 };
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
