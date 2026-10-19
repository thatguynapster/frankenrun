import * as THREE from 'three';
import type { GameProjection, PlayerView } from '../sim/game.js';
import type { MapData } from '../sim/mapdata.js';
import { getPreparedMap, type PreparedMap } from '../sim/world.js';
import { CHECKPOINT_RADIUS, HEADS } from '../sim/parts.js';
import { MonsterModel, createPartProp, type PartSlot } from './monsters/MonsterModel.js';
import { FLOOR_Y, LobbyStage, STAGE_Y, stageSpot } from './LobbyStage.js';
import { makeIcons } from './partIcons.js';
import { buildCity, cutaway } from './city.js';
import { Particles } from './Particles.js';
import type { SoundId } from '../audio/manifest.js';

const SLOT_COLORS = [0x6fbf5a, 0x5aa7bf, 0xbf7a5a, 0xbfa95a, 0x9a5abf, 0xbf5a8d, 0x5abf9a, 0xbfbfbf, 0x5a6fbf, 0xbf5a5a]; // one per slot, up to 10
const LEGS_COLOR = 0xff9a2e;
const ARMS_COLOR = 0xb04cff;
const HEAD_COLOR = 0xb6ff3b;

interface CarRig {
  model: MonsterModel;
  rope: THREE.Line;
  /** Last seen part ids, to spot a part being lost. */
  lastLegs: number;
  lastArms: number;
  lastHead: number;
  /** Whether the head was spewing last frame, to catch the moment a press starts. */
  lastSpew: boolean;
}

/** A lost part tumbling away from its monster. */
interface Debris {
  group: THREE.Group;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  age: number;
}

/** Renders a GameProjection. Reads state, never writes back into the simulation. */
export class RaceView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.5, 320);
  private cars: CarRig[] = [];
  private readonly lobbyStage = new LobbyStage();
  private lobbyOn = false;
  private lobbyTime = 0;
  private readonly particles = new Particles();
  private shakeLeft = 0;
  private shakeFor = 0.3;
  private shakeAmp = 0;
  /** How far the player has turned their own monster on the stage (drag to rotate), and when they last touched it. */
  private lobbyYaw = 0;
  private lobbyTouchedAt = -10;
  private lobbyLabelList: { slot: number; x: number; y: number }[] = [];
  private iconCache: Record<string, string> | undefined;
  private readonly worldBackground = new THREE.Color(0x232b52);
  private readonly lobbyBackground = new THREE.Color(0x16122e);
  private debris: Debris[] = [];
  private rings: THREE.Mesh[] = [];
  private worldGroup: THREE.Group | undefined;
  private anchors: { x: number; z: number }[] = [];
  private prep: PreparedMap | undefined;
  private routePts: { x: number; z: number }[] = [];
  private routeCp: number[] = [];
  private lanternMesh: THREE.Mesh | undefined;
  private lanternIndex = 0;
  private lanternSignature = '';
  private colliderLines: THREE.LineSegments | undefined;
  private colliderSignature = '';
  private slickPool: THREE.Group[] = [];
  private blobPool: THREE.Mesh[] = [];
  private seenSlicks = new Set<string>();
  private pickupPool: { group: THREE.Group; gem: THREE.Mesh; beam: THREE.Mesh }[] = [];
  private pickupMats = [LEGS_COLOR, ARMS_COLOR, HEAD_COLOR].map((color) => new THREE.MeshBasicMaterial({ color }));
  private beamMats = [LEGS_COLOR, ARMS_COLOR, HEAD_COLOR].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
  private slickGeo = RaceView.puddle(HEADS.slime.slickRadius, 1);
  private slickCoreGeo = RaceView.puddle(HEADS.slime.slickRadius * 0.55, 2);
  private slickMat = new THREE.MeshBasicMaterial({ color: 0x35d84a, transparent: true, opacity: 0.62, depthWrite: false });
  private slickCoreMat = new THREE.MeshBasicMaterial({ color: 0xb6ff8a, transparent: true, opacity: 0.5, depthWrite: false });
  private blobGeo = new THREE.IcosahedronGeometry(0.36, 1);
  private blobMat = new THREE.MeshLambertMaterial({ color: 0x7dff3a, emissive: 0x2c8a10, flatShading: true });
  private resizeObserver: ResizeObserver;
  private camPos = new THREE.Vector3(0, 6, -10);
  private camLook = new THREE.Vector3(0, 1, 10);
  private cameraReady = false;
  private aim: { x: number; z: number } | null = null;
  private reticle: { group: THREE.Group; line: THREE.Line } | undefined;
  private readonly raycaster = new THREE.Raycaster();
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
    this.scene.add(this.lobbyStage.group);
    this.scene.add(this.particles.points);

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
    this.setRoute(map);
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

    // Buildings with painted walls, lit windows and roofs, plus street lamps (see city.ts), merged per 100 m chunk.
    for (const object of buildCity(map)) group.add(object);

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
    // Anchors that are street lamps are drawn as lamps (see city.ts); the rest are purple poles.
    const lampKeys = new Set<string>();
    for (let k = 0; k + 3 < (map.lamps?.length ?? 0); k += 4) lampKeys.add(`${map.lamps![k]},${map.lamps![k + 1]}`);
    const posts = map.anchors.filter((a) => !lampKeys.has(`${a.x},${a.z}`));
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), poleMat, Math.max(1, posts.length));
    posts.forEach((a, i) => poles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(a.x / 10, 1.5, a.z / 10)));
    poles.count = posts.length;
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
    const model = new MonsterModel(SLOT_COLORS[slot % SLOT_COLORS.length] ?? 0xffffff);
    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: ARMS_COLOR }),
    );
    rope.frustumCulled = false;
    rope.visible = false;
    this.scene.add(rope);
    this.scene.add(model.root);
    return { model, rope, lastLegs: 0, lastArms: 0, lastHead: 0, lastSpew: false };
  }

  /** Throws a lost part off the monster: it tumbles, bounces once and shrinks away. */
  private spawnDebris(slot: PartSlot, id: number, bodyId: number, p: PlayerView): void {
    if (id === 0 || this.debris.length >= 24) return;
    const group = createPartProp(slot, id, bodyId);
    group.position.set(p.x, p.y + (slot === 'head' ? 1.1 : slot === 'arms' ? 0.5 : -0.4), p.z);
    this.scene.add(group);
    const a = Math.random() * Math.PI * 2;
    this.debris.push({ group, vx: Math.cos(a) * 3 + Math.sin(p.qy * 2) * p.speed * 0.3, vy: 5 + Math.random() * 2, vz: Math.sin(a) * 3, spin: 4 + Math.random() * 4, age: 0 });
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const d = this.debris[i]!;
      d.age += dt;
      d.vy -= 18 * dt;
      d.group.position.x += d.vx * dt;
      d.group.position.y += d.vy * dt;
      d.group.position.z += d.vz * dt;
      if (d.group.position.y < 0.3) {
        d.group.position.y = 0.3;
        d.vy = Math.abs(d.vy) * 0.35;
        d.vx *= 0.6;
        d.vz *= 0.6;
      }
      d.group.rotation.x += d.spin * dt;
      d.group.rotation.z += d.spin * 0.6 * dt;
      if (d.age > 2) d.group.scale.setScalar(Math.max(0.001, 1 - (d.age - 2) / 0.8));
      if (d.age > 2.8) {
        this.scene.remove(d.group);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Parts lying in the world: a spinning gem in the slot's colour on a tall translucent beam, visible from afar. */
  private updatePickups(frame: GameProjection, timeSeconds: number): void {
    while (this.pickupPool.length < frame.pickups.length) {
      const group = new THREE.Group();
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), this.pickupMats[0]!);
      gem.position.y = 1.4;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 8, 1, true), this.beamMats[0]!);
      beam.position.y = 7;
      group.add(gem, beam);
      this.scene.add(group);
      this.pickupPool.push({ group, gem, beam });
    }
    const slotIndex = { legs: 0, arms: 1, head: 2 } as const;
    this.pickupPool.forEach((entry, i) => {
      const pk = frame.pickups[i];
      entry.group.visible = pk !== undefined;
      if (pk === undefined) return;
      const idx = slotIndex[pk.slot];
      entry.group.position.set(pk.x, 0, pk.z);
      entry.gem.material = this.pickupMats[idx]!;
      entry.beam.material = this.beamMats[idx]!;
      entry.gem.rotation.y = timeSeconds * 2;
      entry.gem.position.y = 1.4 + Math.sin(timeSeconds * 3) * 0.25;
    });
  }

  /** An uneven, blobby disc lying on the road (a puddle, not a perfect circle). */
  private static puddle(radius: number, seed: number): THREE.BufferGeometry {
    const g = new THREE.CircleGeometry(radius, 16);
    const pos = g.getAttribute('position');
    for (let i = 1; i < pos.count; i += 1) {
      const wobble = 0.82 + 0.3 * Math.abs(Math.sin(i * 12.9898 + seed * 78.233));
      pos.setXY(i, pos.getX(i) * wobble, pos.getY(i) * wobble);
    }
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /** Slime in flight (a glob with a short drip trail) and the puddles it leaves behind. */
  private updateSlicks(frame: GameProjection, dt: number, time: number): void {
    // blobs in the air
    while (this.blobPool.length < frame.blobs.length) {
      const m = new THREE.Mesh(this.blobGeo, this.blobMat);
      this.scene.add(m);
      this.blobPool.push(m);
    }
    this.blobPool.forEach((m, i) => {
      const b = frame.blobs[i];
      m.visible = b !== undefined;
      if (b === undefined) return;
      m.position.set(b.x, b.y, b.z);
      const stretch = 1 + Math.min(0.5, Math.abs(b.vy) * 3);
      const wobble = 1 + Math.sin(time * 18 + i) * 0.08;
      m.scale.set(wobble / Math.sqrt(stretch), stretch, wobble / Math.sqrt(stretch));
      if (dt > 0) this.particles.burst(b.x, b.y, b.z, { count: 1, color: 0x7dff3a, speed: 0.6, up: 0, life: 0.35, gravity: 0.6 });
    });
    // puddles on the road: they spread out when they land, and a splat bursts from each new one
    while (this.slickPool.length < frame.slicks.length) {
      const group = new THREE.Group();
      const base = new THREE.Mesh(this.slickGeo, this.slickMat);
      base.position.y = 0.06;
      const core = new THREE.Mesh(this.slickCoreGeo, this.slickCoreMat);
      core.position.set(0.3, 0.07, -0.2);
      group.add(base, core);
      this.scene.add(group);
      this.slickPool.push(group);
    }
    const life = HEADS.slime.slickLifeTicks;
    const live = new Set<string>();
    this.slickPool.forEach((group, i) => {
      const s = frame.slicks[i];
      group.visible = s !== undefined;
      if (s === undefined) return;
      group.position.set(s.x, 0, s.z);
      const age = frame.frame - (s.expires - life); // ticks since it landed
      const grow = Math.min(1, 0.25 + age / 8);
      const fade = Math.min(1, (s.expires - frame.frame) / 30); // melts away over the last second
      group.scale.set(grow, 1, grow);
      this.slickMat.opacity = 0.62;
      group.rotation.y = i * 1.7;
      void fade;
      const key = `${s.x.toFixed(2)},${s.z.toFixed(2)},${s.expires}`;
      live.add(key);
      if (!this.seenSlicks.has(key)) {
        this.seenSlicks.add(key);
        if (age < 10) this.particles.burst(s.x, 0.3, s.z, { count: 20, color: 0x7dff3a, speed: 5, up: 4, life: 0.6 });
      }
    });
    for (const key of this.seenSlicks) if (!live.has(key)) this.seenSlicks.delete(key);
  }

  private updateCar(rig: CarRig, p: PlayerView, phase: GameProjection['phase'], dt: number, time: number): void {
    // A monster is drawn while it has a body in the world, and as a build preview on the start grid while in the lobby.
    rig.model.root.visible = p.present || (phase === 'BUILD' && p.joined);
    const b = p.build;
    if (phase !== 'BUILD') {
      if (rig.lastLegs !== 0 && b.legs === 0) this.spawnDebris('legs', rig.lastLegs, b.body, p);
      if (rig.lastArms !== 0 && b.arms === 0) this.spawnDebris('arms', rig.lastArms, b.body, p);
      if (rig.lastHead !== 0 && b.head === 0) this.spawnDebris('head', rig.lastHead, b.body, p);
    }
    rig.lastLegs = b.legs;
    rig.lastArms = b.arms;
    rig.lastHead = b.head;
    // slime spews out of the head the moment the button is pressed
    if (p.trailing && !rig.lastSpew && phase === 'RACING') this.particles.burst(p.x, p.y + 2.4, p.z, { count: 18, color: 0x7dff3a, speed: 3, up: 8, life: 0.7 });
    rig.lastSpew = p.trailing;
    rig.model.setBuild(b);
    rig.model.update(p, dt, time);
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

  // The aiming reticle (groundPoint, setAim, updateReticle) is switched off for now: Game only feeds it when
  // SHOW_AIM_RETICLE is true. It is kept for the projectile and claw-grab work.

  /** The ground point under a screen position, or null when the ray does not hit the ground (for the aiming reticle). */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (direction.y >= -1e-4) return null;
    const t = (0.3 - origin.y) / direction.y;
    return { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
  }

  /** Where the mouse is aiming (a ground point), or null to hide the reticle. */
  setAim(point: { x: number; z: number } | null): void {
    this.aim = point;
  }

  private updateReticle(own: PlayerView | undefined, racing: boolean): void {
    const show = this.aim !== null && own !== undefined && own.present && racing;
    if (!show) {
      if (this.reticle) this.reticle.group.visible = false;
      return;
    }
    if (this.reticle === undefined) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color: 0xffd23b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI / 2;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23b, side: THREE.DoubleSide, depthTest: false }));
      dot.rotation.x = -Math.PI / 2;
      group.add(ring, dot);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffd23b, transparent: true, opacity: 0.35, depthTest: false }));
      line.frustumCulled = false;
      group.add(line);
      group.renderOrder = 9;
      ring.renderOrder = 9;
      dot.renderOrder = 9;
      line.renderOrder = 9;
      this.scene.add(group);
      this.reticle = { group, line };
    }
    // Keep the reticle within reach of the monster so it never wanders off to the horizon.
    const dx = this.aim!.x - own.x, dz = this.aim!.z - own.z;
    const dist = Math.hypot(dx, dz);
    const k = dist > 60 ? 60 / dist : 1;
    const ax = own.x + dx * k, az = own.z + dz * k;
    this.reticle.group.visible = true;
    this.reticle.group.position.set(0, 0, 0);
    (this.reticle.group.children[0] as THREE.Mesh).position.set(ax, 0.35, az);
    (this.reticle.group.children[1] as THREE.Mesh).position.set(ax, 0.36, az);
    const pos = this.reticle.line.geometry.attributes['position'] as THREE.BufferAttribute;
    pos.setXYZ(0, own.x, 0.7, own.z);
    pos.setXYZ(1, ax, 0.4, az);
    pos.needsUpdate = true;
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
    // Buildings between the camera and the monster dissolve instead of hiding it.
    cutaway.from.copy(this.camPos);
    cutaway.to.set(local.x, local.y + 0.9, local.z);
    cutaway.on.value = 1;
  }

  /** Keeps the route's centre line, and which route point each checkpoint sits on, for the Lantern's guide line. */
  private setRoute(map: MapData): void {
    this.routePts = [];
    for (let i = 0; i + 1 < (map.route?.length ?? 0); i += 2) this.routePts.push({ x: map.route![i]! / 10, z: map.route![i + 1]! / 10 });
    this.routeCp = [];
    let from = 0;
    for (const cp of map.checkpoints) {
      let best = from, bestD = Infinity;
      for (let i = from; i < this.routePts.length; i += 1) {
        const d = Math.hypot(this.routePts[i]!.x - cp.x / 10, this.routePts[i]!.z - cp.z / 10);
        if (d < bestD) { bestD = d; best = i; }
      }
      this.routeCp.push(best);
      from = best;
    }
    this.lanternIndex = 0;
    this.lanternSignature = '';
    if (this.lanternMesh) this.lanternMesh.visible = false;
  }

  /**
   * Jack-o'-Lantern Head: a glowing ribbon on the road from the monster to its next checkpoint along the baked route.
   * Rebuilt only when the monster moves to a different route point.
   */
  private updateLantern(frame: GameProjection, local: PlayerView | undefined, timeSeconds: number): void {
    const racing = frame.phase === 'RACING' || frame.phase === 'COUNTDOWN';
    if (local === undefined || local.build.head !== 2 || local.finishTick >= 0 || !racing || this.routePts.length < 2) {
      if (this.lanternMesh) this.lanternMesh.visible = false;
      return;
    }
    // Nearest route point, searched near the previous one (the monster moves along the route) with a global fallback.
    const dist2 = (i: number): number => (this.routePts[i]!.x - local.x) ** 2 + (this.routePts[i]!.z - local.z) ** 2;
    let best = this.lanternIndex;
    const lo = Math.max(0, best - 60), hi = Math.min(this.routePts.length - 1, best + 160);
    for (let i = lo; i <= hi; i += 1) if (dist2(i) < dist2(best)) best = i;
    if (dist2(best) > 60 * 60) for (let i = 0; i < this.routePts.length; i += 1) if (dist2(i) < dist2(best)) best = i;
    this.lanternIndex = best;
    const end = this.routeCp[Math.min(local.nextCheckpoint, this.routeCp.length - 1)] ?? this.routePts.length - 1;
    const MAX_POINTS = 140;
    const last = Math.min(end, best + MAX_POINTS - 1);
    if (this.lanternMesh === undefined) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3));
      const indices = new Uint16Array((MAX_POINTS - 1) * 6);
      for (let i = 0; i < MAX_POINTS - 1; i += 1) indices.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.lanternMesh = mesh;
    }
    const mesh = this.lanternMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.5 + 0.2 * Math.sin(timeSeconds * 5);
    if (last <= best) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const signature = `${best}:${last}`;
    if (signature === this.lanternSignature) return;
    this.lanternSignature = signature;
    const positions = (mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
    let count = 0;
    for (let i = best; i <= last; i += 1) {
      const p = this.routePts[i]!, a = this.routePts[Math.max(best, i - 1)]!, b = this.routePts[Math.min(last, i + 1)]!;
      const tx = b.x - a.x, tz = b.z - a.z, len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len, nz = tx / len, half = 1.1;
      positions.setXYZ(count * 2, p.x + nx * half, 0.16, p.z + nz * half);
      positions.setXYZ(count * 2 + 1, p.x - nx * half, 0.16, p.z - nz * half);
      count += 1;
    }
    positions.needsUpdate = true;
    mesh.geometry.setDrawRange(0, (count - 1) * 6);
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

  /** Camera shake: a short, small jolt (intensity in metres, duration in seconds). A bigger jolt replaces a smaller one. */
  shake(intensity: number, seconds = 0.3): void {
    if (intensity * 1 < this.shakeAmp * (this.shakeLeft / this.shakeFor)) return;
    this.shakeAmp = intensity;
    this.shakeFor = seconds;
    this.shakeLeft = seconds;
  }

  /**
   * Visual feedback for something that just happened in the race (the same events that drive the sounds): a squash,
   * a burst of sparks, a claw snap, a camera shake for the local player. Presentation only.
   */
  effect(id: SoundId, slot: number, strength: number, frame: GameProjection, localSlot: number): void {
    const p = frame.players[slot];
    const rig = this.cars[slot];
    if (p === undefined || rig === undefined || this.lobbyOn) return;
    const mine = slot === localSlot;
    switch (id) {
      case 'impact':
        rig.model.hit(strength);
        this.particles.burst(p.x, p.y - 0.4, p.z, { count: Math.round(8 + strength * 14), color: 0xffd27a, speed: 6, up: 3, life: 0.45 });
        if (mine) this.shake(0.12 + strength * 0.32, 0.3);
        break;
      case 'partLoss':
        rig.model.hit(1);
        this.particles.burst(p.x, p.y + 0.4, p.z, { count: 22, color: 0xe9e1c9, speed: 7, up: 5, life: 0.8 });
        this.particles.burst(p.x, p.y + 0.4, p.z, { count: 14, color: 0xff7a2e, speed: 5, up: 4, life: 0.6 });
        if (mine) this.shake(0.5, 0.4);
        break;
      case 'steal':
        rig.model.snapClaws();
        this.particles.burst(p.x, p.y + 0.5, p.z, { count: 20, color: 0xff5a3a, speed: 6, up: 4, life: 0.6 });
        if (mine) this.shake(0.35, 0.3);
        break;
      case 'pickup':
        this.particles.burst(p.x, p.y + 0.6, p.z, { count: 18, color: 0xffe84a, speed: 3.5, up: 5, life: 0.9, gravity: 0.3 });
        break;
      case 'respawn':
        this.particles.burst(p.x, p.y, p.z, { count: 26, color: 0x7fe8ff, speed: 4, up: 6, life: 0.9, gravity: 0.25 });
        break;
      case 'finish':
        this.particles.burst(p.x, p.y + 1, p.z, { count: 20, color: 0xffd23b, speed: 6, up: 8, life: 1.2, gravity: 0.5 });
        this.particles.burst(p.x, p.y + 1, p.z, { count: 20, color: 0x6fe07a, speed: 6, up: 8, life: 1.2, gravity: 0.5 });
        break;
      default:
        break;
    }
  }

  /** Switches the scene between the race world and the lobby stage. */
  private setLobbyMode(on: boolean): void {
    if (on === this.lobbyOn) return;
    this.lobbyOn = on;
    if (on && this.iconCache === undefined) this.iconCache = makeIcons(this.renderer);
    cutaway.on.value = 0;
    this.lobbyStage.group.visible = on;
    this.particles.clear();
    this.shakeLeft = 0;
    if (this.worldGroup) this.worldGroup.visible = !on;
    this.scene.background = on ? this.lobbyBackground : this.worldBackground;
    this.scene.fog = on ? null : new THREE.Fog(0x232b52, 50, 230);
    for (const r of this.rings) r.visible = !on;
    for (const p of this.pickupPool) p.group.visible = false;
    for (const s of this.slickPool) s.visible = false;
    for (const b of this.blobPool) b.visible = false;
    if (on && this.lanternMesh) this.lanternMesh.visible = false;
    if (on) this.camera.clearViewOffset();
    else {
      this.camera.clearViewOffset();
      this.cameraReady = false; // the race camera snaps to the monster again
    }
  }

  /** The lobby: monsters stand on the stage, the local player in front; names float over them. */
  private renderLobby(frame: GameProjection, localSlot: number, dt: number): void {
    const time = frame.frame / 30;
    const standing = frame.players.filter((p) => p.joined && !p.bot);
    const ordered = [...standing.filter((p) => p.slot === localSlot), ...standing.filter((p) => p.slot !== localSlot)];
    const spots: { spot: ReturnType<typeof stageSpot>; ready: boolean }[] = [];
    this.lobbyLabelList = [];
    frame.players.forEach((p, i) => {
      const rig = this.cars[i];
      if (rig === undefined) return;
      const k = ordered.findIndex((o) => o.slot === p.slot);
      rig.rope.visible = false;
      rig.model.root.visible = k >= 0;
      if (k < 0) return;
      const spot = stageSpot(k);
      // the local monster can be turned by dragging; left alone for a couple of seconds it turns slowly by itself
      const yaw = spot.yaw + (k === 0 ? this.lobbyYaw : 0);
      // The model is updated facing forward and turned afterwards: a turning pose would make it shuffle its feet as if pivoting.
      const pose = { x: spot.x, y: FLOOR_Y + 1, z: spot.z, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, swingPole: -1, trailing: false };
      rig.model.setBuild(p.build);
      rig.model.update(pose, dt, time);
      rig.model.root.rotation.y = yaw;
      spots.push({ spot, ready: p.ready || p.host });
      const head = new THREE.Vector3(spot.x, FLOOR_Y + 4.3, spot.z).project(this.camera);
      this.lobbyLabelList.push({ slot: p.slot, x: (head.x + 1) / 2, y: (1 - head.y) / 2 });
    });
    this.lobbyStage.setSpots(spots);
    this.lobbyStage.update(time);
    this.lobbyTime += dt;
    if (this.lobbyTime - this.lobbyTouchedAt > 2.5) this.lobbyYaw += 0.45 * dt;
    // The stage sits left of centre on wide screens (the pick panel takes the right), and above centre on tall ones.
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    if (w / h >= 1.2) this.camera.setViewOffset(w, h, w * 0.2, 0, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    // Narrow screens see less sideways, so the camera backs off to keep the monsters in frame.
    const back = Math.max(1, Math.min(2, 1.1 / (w / h)));
    this.camera.position.set(0, STAGE_Y + 3.2 + (back - 1) * 1.5, 9.2 * back);
    this.camera.lookAt(0, STAGE_Y + 2.0, 0);
    this.camera.updateMatrixWorld();
  }

  /** Turns the local monster on the lobby stage by a drag of `dx` pixels (a full screen width is about a turn and a half). */
  rotateLobby(dx: number): void {
    this.lobbyYaw += (dx / Math.max(1, this.container.clientWidth)) * Math.PI * 3;
    this.lobbyTouchedAt = this.lobbyTime;
  }

  /** Where each lobby monster's name tag goes, as fractions of the canvas (empty outside the lobby). */
  lobbyLabels(): readonly { slot: number; x: number; y: number }[] {
    return this.lobbyOn ? this.lobbyLabelList : [];
  }

  /** Pictures of every body and part, once they have been drawn. */
  icons(): Readonly<Record<string, string>> | undefined {
    return this.iconCache;
  }

  render(frame: GameProjection | undefined, localSlot: number, dtSeconds: number, showColliders = false, lobby = false): void {
    this.updateColliderLines(frame, showColliders && !lobby);
    if (frame !== undefined && lobby) {
      while (this.cars.length < frame.players.length) this.cars.push(this.makeCar(this.cars.length));
      this.setLobbyMode(true);
      this.renderLobby(frame, localSlot, dtSeconds);
      this.updateDebris(dtSeconds);
    } else if (frame !== undefined) {
      this.setLobbyMode(false);
      while (this.cars.length < frame.players.length) this.cars.push(this.makeCar(this.cars.length));
      frame.players.forEach((p, i) => {
        const rig = this.cars[i];
        if (rig !== undefined) this.updateCar(rig, p, frame.phase, dtSeconds, frame.frame / 30);
      });
      this.updateDebris(dtSeconds);
      this.particles.update(dtSeconds);
      this.updateSlicks(frame, dtSeconds, frame.frame / 30);
      this.updatePickups(frame, frame.frame / 30);
      // A player with no monster in this race (late joiner, or left out of it) watches the race leader.
      const own = frame.players[localSlot] ?? frame.players[0];
      const local = own !== undefined && own.present ? own : (frame.players.filter((p) => p.present && !p.bot).sort((a, b) => b.nextCheckpoint - a.nextCheckpoint)[0] ?? own);
      this.updateLantern(frame, own !== undefined && own.present ? own : undefined, frame.frame / 30);
      this.updateReticle(own !== undefined && own.present ? own : undefined, frame.phase === 'COUNTDOWN' || frame.phase === 'RACING');
      this.updateCamera(local, dtSeconds);
      if (this.shakeLeft > 0) {
        const k = (this.shakeLeft / this.shakeFor) * this.shakeAmp;
        this.camera.position.x += (Math.random() - 0.5) * 2 * k;
        this.camera.position.y += (Math.random() - 0.5) * 2 * k;
        this.shakeLeft = Math.max(0, this.shakeLeft - dtSeconds);
      }
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
