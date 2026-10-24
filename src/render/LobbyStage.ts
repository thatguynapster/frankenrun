// The lobby's 3D stage: a stitching lab where every player's monster stands, with the local player's in front.
// It lives far above the race world (STAGE_Y) so the same scene can show either; RaceView switches between them.

import * as THREE from 'three';

export const STAGE_Y = 400;
/** The floor's top surface: monsters stand on it. */
export const FLOOR_Y = STAGE_Y + 0.2;
const MAX_SLOTS = 10;

const lambert = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
const glow = (color: number, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

export interface StageSpot {
  readonly x: number;
  readonly z: number;
  /** Which way the monster faces (radians about Y; 0 faces the camera). */
  readonly yaw: number;
}

/** Where the k-th monster stands (k = 0 is the local player, at the centre front). */
export function stageSpot(k: number): StageSpot {
  if (k === 0) return { x: 0, z: 0.8, yaw: 0 };
  const rank = Math.ceil(k / 2);
  const side = k % 2 === 1 ? 1 : -1;
  const x = side * (2.7 + 2.0 * (rank - 1));
  return { x, z: -0.4 - 1.1 * (rank - 1), yaw: -side * 0.35 };
}

export class LobbyStage {
  readonly group = new THREE.Group();
  readonly lights: THREE.Object3D[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringMats = [glow(0x6a4a9a), glow(0x8cff3a)];
  private readonly motes: THREE.Points;
  private readonly orbs: THREE.Mesh[] = [];

  constructor() {
    const g = this.group;
    g.position.set(0, 0, 0);
    // floor: a round platform with a glowing rim
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.6, 0.4, 36), lambert(0x2e1a47));
    floor.position.y = STAGE_Y;
    g.add(floor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(10.2, 0.12, 4, 48), glow(0xff8a1f, 0.9));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = FLOOR_Y + 0.02;
    g.add(rim);
    // back wall: tall dark panels with glowing seams, like a lab's riveted wall
    for (let i = -4; i <= 4; i += 1) {
      const a = i * 0.27;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 9, 0.5), lambert(i % 2 === 0 ? 0x24153a : 0x2c1a48));
      panel.position.set(Math.sin(a) * 13, STAGE_Y + 4.4, -Math.cos(a) * 13);
      panel.rotation.y = -a;
      g.add(panel);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 8, 0.1), glow(0xb06aff));
      seam.position.set(Math.sin(a + 0.135) * 12.7, STAGE_Y + 4.4, -Math.cos(a + 0.135) * 12.7);
      seam.rotation.y = -a;
      g.add(seam);
    }
    // two tesla coils with glowing orbs
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 5.2, 7), lambert(0x4e3a6a));
      post.position.set(side * 8.4, STAGE_Y + 2.7, -5.2);
      g.add(post);
      for (let r = 0; r < 3; r += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 - r * 0.1, 0.08, 4, 10), lambert(0x8a6ab0));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(side * 8.4, STAGE_Y + 3.4 + r * 0.55, -5.2);
        g.add(ring);
      }
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), glow(0xd9a6ff));
      orb.position.set(side * 8.4, STAGE_Y + 5.6, -5.2);
      g.add(orb);
      this.orbs.push(orb);
    }
    // a stitching table off to one side, with a sheet over a lumpy shape
    const table = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 1.5), lambert(0x4a3d34));
    table.position.set(-7.6, STAGE_Y + 1.4, 1.8);
    g.add(table);
    for (const [dx, dz] of [[-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), lambert(0x38302a));
      leg.position.set(-7.6 + dx, STAGE_Y + 0.75, 1.8 + dz);
      g.add(leg);
    }
    const sheet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), lambert(0xcfd0e0));
    sheet.scale.set(1.8, 0.55, 0.9);
    sheet.position.set(-7.6, STAGE_Y + 1.95, 1.8);
    g.add(sheet);
    // hanging lamp over the local player's spot, with a faint beam
    const lamp = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.9, 8, 1, true), lambert(0x40285e));
    lamp.position.set(0, STAGE_Y + 10, 0.8);
    (lamp.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    g.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.6, 9.6, 14, 1, true), glow(0xffd9a0, 0.08));
    beam.position.set(0, STAGE_Y + 5.2, 0.8);
    (beam.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    g.add(beam);
    // a ring under each spot: dim while choosing, green when ready
    for (let i = 0; i < MAX_SLOTS; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 4, 28), this.ringMats[0]!);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      g.add(ring);
      this.rings.push(ring);
    }
    // drifting motes
    const pts = new Float32Array(48 * 3);
    for (let i = 0; i < 48; i += 1) {
      pts[i * 3] = (Math.random() - 0.5) * 20;
      pts[i * 3 + 1] = STAGE_Y + 1 + Math.random() * 8;
      pts[i * 3 + 2] = -6 + Math.random() * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb347, size: 0.14, transparent: true, opacity: 0.7, depthWrite: false }));
    this.motes.frustumCulled = false;
    g.add(this.motes);
    // a soft green light from the coils
    const coil = new THREE.PointLight(0xb06aff, 40, 26, 1.6);
    coil.position.set(0, STAGE_Y + 6, -3);
    g.add(coil);
    this.lights.push(coil);
    g.visible = false;
  }

  /** Places the rings under the monsters standing now; `ready` marks the ones to light green. */
  setSpots(spots: readonly { spot: StageSpot; ready: boolean }[]): void {
    this.rings.forEach((ring, i) => {
      const s = spots[i];
      ring.visible = s !== undefined;
      if (s === undefined) return;
      ring.position.set(s.spot.x, FLOOR_Y + 0.05, s.spot.z);
      ring.material = this.ringMats[s.ready ? 1 : 0]!;
    });
  }

  update(time: number): void {
    const p = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 1) {
      p.setY(i, STAGE_Y + 1 + ((p.getY(i) - STAGE_Y - 1 + 0.004 + (i % 5) * 0.0006) % 8));
    }
    p.needsUpdate = true;
    this.orbs.forEach((o, i) => o.scale.setScalar(1 + Math.sin(time * 3 + i * 2) * 0.12));
  }
}
