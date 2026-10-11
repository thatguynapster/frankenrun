import * as THREE from 'three';
import type { GameProjection, PlayerView } from '../sim/game.js';
import { ARENA_HALF, CHECKPOINTS, OBSTACLES, POLES } from '../sim/track.js';
import { CHASSIS_HALF, CHECKPOINT_RADIUS, HEADS } from '../sim/parts.js';

const SLOT_COLORS = [0x6fbf5a, 0x5aa7bf, 0xbf7a5a, 0xbfa95a, 0x9a5abf, 0xbf5a8d, 0x5abf9a, 0xbfbfbf];
const LEGS_COLOR = 0xff9a2e;
const ARMS_COLOR = 0xb04cff;
const HEAD_COLOR = 0xb6ff3b;

interface CarRig {
  group: THREE.Group;
  legs: THREE.Group;
  arms: THREE.Group;
  head: THREE.Group;
  rope: THREE.Line;
}

/** Renders a GameProjection. Reads state, never writes back into the simulation. */
export class RaceView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.5, 600);
  private cars: CarRig[] = [];
  private rings: THREE.Mesh[] = [];
  private slickPool: THREE.Mesh[] = [];
  private slickGeo = new THREE.CircleGeometry(HEADS.slime.slickRadius, 20);
  private slickMat = new THREE.MeshBasicMaterial({ color: 0x4dff6a, transparent: true, opacity: 0.45 });
  private resizeObserver: ResizeObserver;
  private camPos = new THREE.Vector3(0, 6, -10);
  private camLook = new THREE.Vector3(0, 1, 10);
  private cameraReady = false;
  private frameHandle = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';

    this.scene.background = new THREE.Color(0x1a2142);
    this.scene.fog = new THREE.Fog(0x1a2142, 70, 300);
    this.scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x3a3358, 2.4));
    const moon = new THREE.DirectionalLight(0xeaf0ff, 2.6);
    moon.position.set(-60, 120, -40);
    this.scene.add(moon);

    this.buildWorld();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private buildWorld(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry((ARENA_HALF + 20) * 2, (ARENA_HALF + 20) * 2),
      new THREE.MeshLambertMaterial({ color: 0x343d5c, flatShading: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(ARENA_HALF * 2, ARENA_HALF / 5, 0x2c3552, 0x232a40);
    grid.position.y = 0.02;
    this.scene.add(grid);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x3a2f55, flatShading: true });
    const wall = (x: number, z: number, hx: number, hz: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 6, hz * 2), wallMat);
      m.position.set(x, 3, z);
      this.scene.add(m);
    };
    wall(0, ARENA_HALF + 1, ARENA_HALF + 2, 1);
    wall(0, -ARENA_HALF - 1, ARENA_HALF + 2, 1);
    wall(ARENA_HALF + 1, 0, 1, ARENA_HALF);
    wall(-ARENA_HALF - 1, 0, 1, ARENA_HALF);

    const boxMat = new THREE.MeshLambertMaterial({ color: 0x5b4a7a, flatShading: true });
    for (const o of OBSTACLES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.halfX * 2, o.height, o.halfZ * 2), boxMat);
      m.position.set(o.x, o.height / 2, o.z);
      this.scene.add(m);
    }

    const poleMat = new THREE.MeshLambertMaterial({ color: ARMS_COLOR, emissive: 0x3a1566, flatShading: true });
    for (const p of POLES) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 8), poleMat);
      m.position.set(p.x, 1.5, p.z);
      this.scene.add(m);
    }

    CHECKPOINTS.forEach((cp, i) => {
      const final = i === CHECKPOINTS.length - 1;
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(CHECKPOINT_RADIUS, CHECKPOINT_RADIUS, 14, 32, 1, true),
        new THREE.MeshBasicMaterial({
          color: final ? 0xffd23b : 0x3bd1ff,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.position.set(cp.x, 7, cp.z);
      this.scene.add(ring);
      this.rings.push(ring);
    });
  }

  private makeCar(slot: number): CarRig {
    const group = new THREE.Group();
    const bodyColor = SLOT_COLORS[slot % SLOT_COLORS.length] ?? 0xffffff;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS_HALF.x * 2, CHASSIS_HALF.y * 2, CHASSIS_HALF.z * 2),
      new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true }),
    );
    group.add(body);
    // Stitches: a dark seam across the torso.
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS_HALF.x * 2 + 0.05, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x151515 }),
    );
    seam.position.set(0, 0.1, 0);
    group.add(seam);

    const legs = new THREE.Group();
    const legMat = new THREE.MeshLambertMaterial({ color: LEGS_COLOR, flatShading: true });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.95, 6), legMat);
        leg.position.set(sx * 0.65, -0.45, sz * 0.9);
        legs.add(leg);
      }
    }
    group.add(legs);

    const arms = new THREE.Group();
    const armMat = new THREE.MeshLambertMaterial({ color: ARMS_COLOR, flatShading: true });
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 1.1, 3, 6), armMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(sx * 0.9, 0.1, 0.6);
      arms.add(arm);
    }
    group.add(arms);

    const head = new THREE.Group();
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshLambertMaterial({ color: HEAD_COLOR, flatShading: true }),
    );
    headMesh.position.set(0, 0.75, 0.2);
    head.add(headMesh);
    group.add(head);

    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: ARMS_COLOR }),
    );
    rope.frustumCulled = false;
    rope.visible = false;
    this.scene.add(rope);
    this.scene.add(group);
    return { group, legs, arms, head, rope };
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
    rig.legs.visible = p.build.legs;
    rig.arms.visible = p.build.arms;
    rig.head.visible = p.build.head;
    rig.head.children[0]?.scale.setScalar(p.trailing ? 1.25 : 1);
    if (p.swingPole >= 0) {
      const pole = POLES[p.swingPole];
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

  render(frame: GameProjection | undefined, localSlot: number, dtSeconds: number): void {
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
