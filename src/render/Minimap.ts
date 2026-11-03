import type { MapData } from '../sim/mapdata.js';
import type { GameProjection } from '../sim/game.js';

const SIZE = 116; // css px
const VIEW_M = 160; // metres from the centre to the edge of the circle
const BAKE_PX_PER_M = 0.5;

/** A round, heading-up map in the corner: streets, the next checkpoint and rival monsters. Plain canvas, drawn from the game loop. */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private roads: HTMLCanvasElement | null = null;
  private map: MapData | undefined;
  private shown = false;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(parent: HTMLElement) {
    const dpr = this.dpr;
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.className = 'minimap';
    this.canvas.style.display = 'none';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
  }

  setMap(map: MapData | undefined): void {
    if (map === this.map) return;
    this.map = map;
    this.roads = null;
    if (!map) return;
    // The streets are drawn once, at a fixed scale; every frame then only rotates and blits a piece of it.
    const w = Math.ceil((map.bounds.maxX - map.bounds.minX) / 10 * BAKE_PX_PER_M) + 8;
    const h = Math.ceil((map.bounds.maxZ - map.bounds.minZ) / 10 * BAKE_PX_PER_M) + 8;
    if (w > 4096 || h > 4096) return; // too big to bake: no streets, markers only
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const px = (x: number, z: number): [number, number] => [((x - map.bounds.minX) / 10) * BAKE_PX_PER_M + 4, ((z - map.bounds.minZ) / 10) * BAKE_PX_PER_M + 4];
    for (const road of map.roads) {
      g.beginPath();
      for (let i = 0; i < road.pts.length; i += 2) {
        const [x, y] = px(road.pts[i]!, road.pts[i + 1]!);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.lineWidth = Math.max(2, (road.hw / 5) * BAKE_PX_PER_M * 1.2);
      g.strokeStyle = 'rgba(210, 220, 255, 0.5)';
      g.stroke();
    }
    this.roads = c;
  }

  draw(frame: GameProjection | undefined, slot: number, racing: boolean): void {
    const me = frame?.players[slot];
    const map = this.map;
    if (!racing || !frame || !me || !map || !me.inRace || frame.phase === 'RESULTS') {
      if (this.shown) {
        this.canvas.style.display = 'none';
        this.shown = false;
      }
      return;
    }
    if (!this.shown) {
      this.canvas.style.display = 'block';
      this.shown = true;
    }
    const g = this.ctx;
    const half = SIZE / 2;
    const s = half / VIEW_M; // css px per metre
    const fx = 2 * (me.qx * me.qz + me.qw * me.qy);
    const fz = 1 - 2 * (me.qx * me.qx + me.qy * me.qy);
    const len = Math.hypot(fx, fz) || 1;
    const ux = fx / len, uz = fz / len;
    // World offset (metres) to a point on the map: forward is up, the monster's left is the left.
    const toMap = (wx: number, wz: number): [number, number] => {
      const dx = wx - me.x, dz = wz - me.z;
      return [half + (-uz * dx + ux * dz) * s, half + -(dx * ux + dz * uz) * s];
    };

    g.save();
    g.clearRect(0, 0, SIZE, SIZE);
    g.beginPath();
    g.arc(half, half, half - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(6, 8, 20, 0.7)';
    g.fillRect(0, 0, SIZE, SIZE);
    if (this.roads) {
      const k = s / BAKE_PX_PER_M;
      const ox = map.bounds.minX / 10 - 4 / BAKE_PX_PER_M, oz = map.bounds.minZ / 10 - 4 / BAKE_PX_PER_M;
      g.save();
      // Position the baked image: its pixel (0,0) is world (ox, oz) metres.
      const [mx, my] = toMap(ox, oz);
      const dpr = this.dpr;
      g.setTransform(-uz * k * dpr, -ux * k * dpr, ux * k * dpr, -uz * k * dpr, mx * dpr, my * dpr);
      g.drawImage(this.roads, 0, 0);
      g.restore();
    }
    // The next checkpoint: a gold ring, pinned to the rim when it is further away than the map shows.
    const cp = map.checkpoints[me.nextCheckpoint];
    if (cp) {
      let [cx, cy] = toMap(cp.x / 10, cp.z / 10);
      const off = Math.hypot(cx - half, cy - half);
      const lim = half - 7;
      if (off > lim) {
        cx = half + ((cx - half) / off) * lim;
        cy = half + ((cy - half) / off) * lim;
      }
      g.beginPath();
      g.arc(cx, cy, 5, 0, Math.PI * 2);
      g.lineWidth = 2.5;
      g.strokeStyle = '#ffd24a';
      g.stroke();
    }
    // Rivals.
    for (const p of frame.players) {
      if (p.slot === slot || !p.inRace) continue;
      const [x, y] = toMap(p.x, p.z);
      if (Math.hypot(x - half, y - half) > half - 3) continue;
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fillStyle = p.finishTick >= 0 ? '#8a8fa8' : '#ff6a3d';
      g.fill();
    }
    // You, always in the middle, pointing up.
    g.beginPath();
    g.moveTo(half, half - 7);
    g.lineTo(half + 5, half + 5);
    g.lineTo(half, half + 2);
    g.lineTo(half - 5, half + 5);
    g.closePath();
    g.fillStyle = '#3bd1ff';
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(half, half, half - 1, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    g.stroke();
  }
}
