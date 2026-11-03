// The sky over the race: stars, a moon, and (on stormy routes) lightning. It follows the camera so it is always overhead,
// and takes its colours from the route's theme (see routes.ts). Presentation only.

import * as THREE from 'three';
import type { RouteTheme } from '../routes.js';

const STAR_COUNT = 260;

export class Atmosphere {
  /** Add to the scene; positioned at the camera every frame. */
  readonly sky = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private theme: RouteTheme | undefined;
  private baseHemi = 2.4;
  private flash = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hemi: THREE.HemisphereLight,
    private readonly moonLight: THREE.DirectionalLight,
  ) {
    const pts = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      // a dome of stars, deterministic so the sky looks the same every visit
      const a = (Math.sin(i * 12.9898) * 43758.5453) % 1, b = (Math.sin(i * 78.233) * 12345.6789) % 1;
      const theta = Math.abs(a) * Math.PI * 2, phi = 0.12 + Math.abs(b) * 1.2;
      pts[i * 3] = Math.cos(theta) * Math.sin(phi) * 280;
      pts[i * 3 + 1] = Math.cos(phi) * 280;
      pts[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * 280;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(22, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false }));
    this.halo = new THREE.Mesh(new THREE.CircleGeometry(48, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.12, depthWrite: false }));
    const dir = new THREE.Vector3(-0.45, 0.42, -0.5).normalize().multiplyScalar(270);
    this.moon.position.copy(dir);
    this.halo.position.copy(dir.clone().multiplyScalar(0.99));
    this.moon.lookAt(0, 0, 0);
    this.halo.lookAt(0, 0, 0);
    this.sky.add(this.stars, this.halo, this.moon);
    this.sky.renderOrder = -10;
    for (const o of [this.stars, this.halo, this.moon]) o.renderOrder = -10;
    scene.add(this.sky);
  }

  apply(theme: RouteTheme): void {
    this.theme = theme;
    this.baseHemi = theme.hemiIntensity;
    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.hemi.intensity = theme.hemiIntensity;
    this.moonLight.color.set(theme.moonColor);
    (this.moon.material as THREE.MeshBasicMaterial).color.set(theme.moonDisc);
    (this.halo.material as THREE.MeshBasicMaterial).color.set(theme.moonDisc);
    this.stars.visible = theme.stars;
    this.flash = 0;
  }

  /** Keeps the sky overhead and plays the lightning. `time` is the race clock in seconds. */
  update(camera: THREE.Camera, time: number, visible: boolean): void {
    this.sky.visible = visible;
    this.sky.position.copy(camera.position);
    const theme = this.theme;
    if (theme === undefined || !visible) return;
    let flash = 0;
    if (theme.storm) {
      const t = time % 11;
      flash = t < 0.07 ? 1 : t > 0.22 && t < 0.28 ? 0.6 : 0;
    }
    if (flash !== this.flash) {
      this.flash = flash;
      this.hemi.intensity = this.baseHemi * (1 + flash * 2.2);
      (this.scene.background as THREE.Color).set(theme.sky).lerp(new THREE.Color(0xcfe0ff), flash * 0.45);
    }
  }
}
