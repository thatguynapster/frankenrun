// Presentation of the race surprises: mystery boxes, the warnings and strikes of street events, wandering creatures
// and the glow of mystery box effects on a monster. Reads a projection and the map's features; never writes back.

import * as THREE from 'three';
import { roamerAt } from '../sim/features.js';
import { EVENT_FLOOD, EVENT_LIGHTNING, EVENT_RAIN, EVENT_TELEGRAPH_TICKS, LIGHTNING_RADIUS } from '../sim/events.js';
import type { GameProjection } from '../sim/game.js';
import type { PreparedMap } from '../sim/world.js';
import type { Particles } from './Particles.js';
import { createCrate, createCreature, type Crate, type Creature } from './creatures.js';

/** Creatures further than this from the camera are not drawn (keeps the draw-call count down in busy cities). */
const ROAMER_DRAW_M = 150;
const BOX_DRAW_M = 170;
const EVENT_COLORS: Readonly<Record<number, number>> = { [EVENT_LIGHTNING]: 0xfff27a, [EVENT_FLOOD]: 0x4cff6a, [EVENT_RAIN]: 0xc77dff };


export class RaceFun {
  readonly group = new THREE.Group();
  private readonly boxBeamMat = new THREE.MeshBasicMaterial({ color: 0xffa13a, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly boxBeamGeo = new THREE.CylinderGeometry(0.45, 0.45, 12, 8, 1, true);
  private boxes: { group: THREE.Group; crate: Crate; open: boolean }[] = [];
  private roamers: Creature[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.76, 1, 40).rotateX(-Math.PI / 2);
  private readonly discGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  private warnings: { ring: THREE.Mesh; disc: THREE.Mesh; bolt: THREE.Mesh }[] = [];
  private readonly boltGeo = new THREE.CylinderGeometry(0.5, 0.18, 40, 6, 1, true);
  private shields: THREE.Mesh[] = [];
  private readonly shieldGeo = new THREE.SphereGeometry(2.4, 14, 10);
  private readonly shieldMat = new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.22, depthWrite: false });
  private lastItemTick: number[] = [];
  private firedEvents = new Set<number>();

  constructor() {
    this.group.visible = false;
  }

  /** Hides everything (lobby, results). */
  hide(): void {
    this.group.visible = false;
  }

  private makeBox(): { group: THREE.Group; crate: Crate; open: boolean } {
    const group = new THREE.Group();
    const crate = createCrate();
    const beam = new THREE.Mesh(this.boxBeamGeo, this.boxBeamMat);
    beam.position.y = 6;
    group.add(crate.root, beam);
    this.group.add(group);
    return { group, crate, open: true };
  }

  private makeWarning(): { ring: THREE.Mesh; disc: THREE.Mesh; bolt: THREE.Mesh } {
    const mat = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const ring = new THREE.Mesh(this.ringGeo, mat());
    const disc = new THREE.Mesh(this.discGeo, mat());
    const bolt = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: 0xfffbd0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    bolt.position.y = 20;
    ring.position.y = disc.position.y = 0.12;
    this.group.add(ring, disc, bolt);
    return { ring, disc, bolt };
  }

  update(frame: GameProjection, prep: PreparedMap, camera: THREE.Camera, dt: number, particles: Particles): void {
    const racing = frame.phase === 'RACING' || frame.phase === 'COUNTDOWN' || frame.phase === 'RESULTS';
    this.group.visible = racing;
    if (!racing) return;
    const time = frame.frame / 30;
    const cam = camera.position;

    // --- mystery boxes ---
    const boxes = prep.features.boxes;
    while (this.boxes.length < boxes.length) this.boxes.push(this.makeBox());
    this.boxes.forEach((entry, i) => {
      const spot = boxes[i];
      if (spot === undefined || Math.hypot(spot.x - cam.x, spot.z - cam.z) > BOX_DRAW_M) {
        entry.group.visible = false;
        return;
      }
      const ready = frame.frame >= (frame.boxReady[i] ?? 0);
      if (entry.open && !ready) particles.burst(spot.x, 1.2, spot.z, { count: 22, color: 0xffa13a, speed: 6, up: 5, life: 0.8, gravity: 0.5 });
      entry.open = ready;
      entry.group.visible = ready;
      entry.group.position.set(spot.x, 0, spot.z);
      // the crate faces the racers coming down the road, and sways a little
      entry.crate.root.rotation.y = Math.atan2(-spot.dx, -spot.dz) + Math.sin(time * 0.9 + i) * 0.35;
      entry.crate.root.position.y = 0.25 + Math.abs(Math.sin(time * 2.2 + i * 1.7)) * 0.18;
      entry.crate.animate(time + i);
    });

    // --- wandering creatures ---
    const roamers = prep.features.roamers;
    while (this.roamers.length < roamers.length) {
      const creature = createCreature(this.roamers.length);
      this.group.add(creature.root);
      this.roamers.push(creature);
    }
    const walking = frame.phase === 'RACING';
    this.roamers.forEach((entry, i) => {
      const spot = roamers[i];
      if (spot === undefined || !walking) {
        entry.root.visible = false;
        return;
      }
      const at = roamerAt(spot, i, frame.raceStart, frame.frame);
      if (Math.hypot(at.x - cam.x, at.z - cam.z) > ROAMER_DRAW_M) {
        entry.root.visible = false;
        return;
      }
      entry.root.visible = true;
      entry.root.position.set(at.x, 0, at.z);
      entry.root.rotation.y = at.heading;
      entry.animate(time, time * 7 + i * 2.3);
    });

    // --- street event warnings and strikes ---
    while (this.warnings.length < frame.events.length) this.warnings.push(this.makeWarning());
    this.warnings.forEach((w, i) => {
      const ev = frame.events[i];
      w.ring.visible = w.disc.visible = w.bolt.visible = false;
      if (ev === undefined) return;
      const color = EVENT_COLORS[ev.kind] ?? 0xffffff;
      const left = ev.fireAt - frame.frame; // ticks until it happens; negative afterwards
      const radius = ev.kind === EVENT_LIGHTNING ? LIGHTNING_RADIUS : ev.kind === EVENT_FLOOD ? 17 : 15;
      if (left > 0 && left <= EVENT_TELEGRAPH_TICKS) {
        const urgency = 1 - left / EVENT_TELEGRAPH_TICKS;
        const pulse = 0.5 + 0.5 * Math.sin(time * (6 + urgency * 14));
        w.ring.visible = w.disc.visible = true;
        w.ring.position.set(ev.x, 0.13, ev.z);
        w.disc.position.set(ev.x, 0.12, ev.z);
        w.ring.scale.setScalar(radius);
        w.disc.scale.setScalar(radius * (0.25 + 0.75 * urgency));
        (w.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
        (w.disc.material as THREE.MeshBasicMaterial).color.setHex(color);
        (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * pulse;
        (w.disc.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.25 * urgency * pulse;
      } else if (left <= 0 && left > -12) {
        if (!this.firedEvents.has(ev.fireAt)) {
          this.firedEvents.add(ev.fireAt);
          if (ev.kind === EVENT_LIGHTNING) {
            particles.burst(ev.x, 0.6, ev.z, { count: 40, color: 0xfff27a, speed: 12, up: 8, life: 0.7, gravity: 0.4 });
            particles.burst(ev.x, 0.6, ev.z, { count: 20, color: 0xffffff, speed: 6, up: 14, life: 0.5, gravity: 0.2 });
          } else if (ev.kind === EVENT_RAIN) {
            particles.burst(ev.x, 8, ev.z, { count: 50, color: 0xc77dff, speed: 9, up: 2, life: 1.1, gravity: 0.7 });
          } else {
            particles.burst(ev.x, 0.5, ev.z, { count: 40, color: 0x4cff6a, speed: 9, up: 6, life: 0.9, gravity: 0.5 });
          }
        }
        if (ev.kind === EVENT_LIGHTNING) {
          w.bolt.visible = true;
          w.bolt.position.set(ev.x, 20, ev.z);
          (w.bolt.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 + left / 12);
        }
      }
    });
    if (frame.events.length === 0) this.firedEvents.clear();

    // --- effects on monsters: shield bubble, surge sparks, slowed smoke, prize bursts ---
    frame.players.forEach((p, i) => {
      let shield = this.shields[i];
      if (shield === undefined) {
        shield = new THREE.Mesh(this.shieldGeo, this.shieldMat);
        this.group.add(shield);
        this.shields[i] = shield;
      }
      shield.visible = p.present && (p.fx & 2) !== 0;
      if (shield.visible) {
        shield.position.set(p.x, p.y + 0.6, p.z);
        shield.scale.setScalar(1 + Math.sin(time * 6 + i) * 0.04);
      }
      if (p.present && dt > 0) {
        if ((p.fx & 1) !== 0) particles.burst(p.x, p.y + 0.3, p.z, { count: 2, color: 0xffa23b, speed: 2.5, up: 1.5, life: 0.35, gravity: 0.1 });
        if ((p.fx & 8) !== 0) particles.burst(p.x, p.y + 1.2, p.z, { count: 1, color: 0x8a8aa0, speed: 1.5, up: 2, life: 0.5, gravity: 0 });
      }
      const seen = this.lastItemTick[i];
      if (seen !== undefined && p.itemTick !== seen && p.itemKind > 0 && frame.frame - p.itemTick < 6) {
        particles.burst(p.x, p.y + 1.5, p.z, { count: 26, color: p.itemKind === 5 ? 0x9a5bff : 0xffd23b, speed: 5, up: 7, life: 0.9, gravity: 0.3 });
      }
      this.lastItemTick[i] = p.itemTick;
    });
  }
}
