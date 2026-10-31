/**
 * v11 theme: palette tokens, materials, and the procedural set pieces (Opening light line, curtain,
 * Revive Focus room, Renew lantern). Procedural geometry only, unlit emissive-colour materials, no real-time lights.
 * Geometry is merged per material so each piece costs 1-3 draw calls.
 */
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace,
  TorusGeometry, TubeGeometry, Vector2, Vector3,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Grays only (no pure black / white), one gold accent for the selected state, emissive intensities. */
export const THEME = {
  g0: '#121419', g1: '#1A1D23', g2: '#23272F', g3: '#2E333C', g4: '#3D434E', g5: '#5B6270', ink: '#D9DDE4',
  gold: '#FFB547', // selected state only
  warm: '#F6C58C', cool: '#6F86A8', fabric: '#4A4F5A', fabricHi: '#6A707D',
  emissive: { line: 1.0, led: 0.9, shelf: 0.75, lantern: 1.0, pool: 0.55, window: 0.8 },
} as const;
const emi = (hex: string, k: number) => new Color(hex).multiplyScalar(k);
const basic = (hex: string, k = 1, o: Partial<{ transparent: boolean; opacity: number; side: number; blend: boolean }> = {}) =>
  new MeshBasicMaterial({ color: emi(hex, k), transparent: o.transparent ?? false, opacity: o.opacity ?? 1, side: (o.side ?? 0) as 0, depthWrite: !o.transparent, toneMapped: false, ...(o.blend ? { blending: AdditiveBlending } : {}) });
const merge = (gs: BufferGeometry[]) => { const m = mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g))); gs.forEach((g) => g.dispose()); return m!; };
const at = (g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
const radial = (inner: string, outer: string) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t; };
const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Opening: an organic curved light line draws down the wall, then settles into the timeline track. */
export class LightLine {
  root = new Group(); private mesh: Mesh; private count: number; t = -1; static readonly LEN = 4.2;
  constructor(trackW: number, trackY: number) {
    const x0 = -trackW / 2, x1 = trackW / 2;
    const pts = [[0.1, 0.95], [-0.08, 0.78], [0.12, 0.6], [-0.05, 0.42], [0.05, 0.25], [x0 * 0.4, trackY + 0.04], [x0, trackY], [x0 * 0.3, trackY], [x1 * 0.4, trackY], [x1, trackY]]
      .map(([x, y]) => new Vector3(x, y, 0.006));
    const geo = new TubeGeometry(new CatmullRomCurve3(pts, false, 'catmullrom', 0.5), 160, 0.0045, 6, false);
    this.count = geo.index!.count; geo.setDrawRange(0, 0);
    this.mesh = new Mesh(geo, basic(THEME.warm, THEME.emissive.line, { transparent: true, opacity: 0.95 })); this.mesh.renderOrder = 6;
    this.root.add(this.mesh); this.root.visible = false;
  }
  start(): void { this.t = 0; this.root.visible = true; document.body.dataset.line = 'draw'; }
  update(dt: number): void {
    if (this.t < 0) return; this.t += dt; const t = this.t;
    this.mesh.geometry.setDrawRange(0, Math.floor(this.count * ease(t / 2.6) / 3) * 3);
    (this.mesh.material as MeshBasicMaterial).opacity = 0.95 - 0.6 * ease((t - 2.8) / 1.2); // settles into the timeline: stays as a faint track line
    if (t >= LightLine.LEN && document.body.dataset.line !== 'settled') document.body.dataset.line = 'settled';
  }
}

/** Simple pleated curtain: two sliding panels (no cloth physics), a grab handle on the inner edge. k: 0 closed, 0.5 half, 1 open. */
export class Curtain {
  root = new Group(); handle: Mesh; private panels: Mesh[] = []; k = 1; target = 1; rate = 1.6; w: number; h: number;
  anchored = 'fallback'; // 'window' when anchored to a scene-understanding window label
  constructor(w = 1.3, h = 1.25) {
    this.w = w; this.h = h;
    const mat = basic(THEME.fabric, 1, { side: DoubleSide });
    for (const s of [-1, 1]) {
      const g = new PlaneGeometry(w / 2, h, 28, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, 0.025 * Math.sin((x / (w / 2)) * Math.PI * 14)); }
      // shade the pleats (vertex colours, no lights): folds facing away read darker
      const col: number[] = []; for (let i = 0; i < p.count; i++) { const v = 0.72 + 0.28 * Math.cos((p.getX(i) / (w / 2)) * Math.PI * 14); col.push(v, v, v); }
      g.setAttribute('color', new (p.constructor as any)(new Float32Array(col), 3)); g.translate(s * w / 4, 0, 0);
      const m = new Mesh(g, mat); m.userData.side = s; this.panels.push(m); this.root.add(m);
    }
    (mat as MeshBasicMaterial).vertexColors = true;
    const rod = new Mesh(new CylinderGeometry(0.008, 0.008, w + 0.12, 8), basic(THEME.g4)); rod.rotation.z = Math.PI / 2; rod.position.y = h / 2 + 0.02; this.root.add(rod);
    this.handle = new Mesh(new BoxGeometry(0.035, 0.22, 0.035), basic(THEME.fabricHi)); this.handle.userData.curtainHandle = true;
  }
  /** panel inner-edge x for openness k (right panel; left mirrors). */
  edgeX(k = this.k): number { return 0.02 + (this.w / 2 - 0.1) * k; }
  update(dt: number, grabbedLocalX?: number): void {
    if (grabbedLocalX !== undefined) { this.target = this.k = Math.min(1, Math.max(0, (Math.abs(grabbedLocalX) - 0.02) / (this.w / 2 - 0.1))); }
    else this.k += (this.target - this.k) * (1 - Math.exp(-dt * this.rate));
    const sx = 1 - 0.78 * this.k; // panels gather toward the sides
    for (const m of this.panels) { const s = m.userData.side as number; m.scale.x = sx; m.position.x = s * (this.w / 2) * (1 - sx); }
    document.body.dataset.curtain = this.state();
  }
  state(): 'closed' | 'half' | 'open' { return this.k < 0.25 ? 'closed' : this.k > 0.75 ? 'open' : 'half'; }
}

/** Revive Focus virtual room around the desk: wavy ceiling (3 layers, 1 mesh), straight + curved LED strip, two edge-lit shelves
 * with plain shapes, dim walls, warm light pool on the desk, a window (the curtain hangs in front of it). */
export function reviveRoom(): Group {
  const r = new Group(); r.name = 'revive';
  const walls = new Mesh(new BoxGeometry(6.4, 2.9, 6.4), basic(THEME.g1, 1, { side: BackSide })); walls.position.y = 0.7; r.add(walls);
  const waves: BufferGeometry[] = [];
  for (let l = 0; l < 3; l++) { const g = new PlaneGeometry(4.0, 1.2, 40, 4); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.07 * Math.sin(p.getX(i) * 3.2 + l * 1.3));
    waves.push(at(g, 0, 1.85 - l * 0.05, -1.4 + l * 1.3, Math.PI / 2)); }
  const ceil = new Mesh(merge(waves), basic(THEME.g3, 1, { side: DoubleSide })); r.add(ceil);
  const led: BufferGeometry[] = [at(new BoxGeometry(3.2, 0.012, 0.012), 0, 1.72, -1.9)];
  led.push(new TubeGeometry(new CatmullRomCurve3([[-1.6, 1.78, 0.6], [-0.8, 1.74, -0.2], [0, 1.78, 0.4], [0.8, 1.74, -0.3], [1.6, 1.78, 0.5]].map(([x, y, z]) => new Vector3(x, y, z))), 80, 0.006, 5, false));
  const shapes: BufferGeometry[] = [], shelves: BufferGeometry[] = [];
  for (const [sx, sy] of [[-1.55, 0.55], [-1.55, 0.9]] as const) {
    shelves.push(at(new BoxGeometry(0.06 * 0 + 0.28, 0.025, 0.9), sx, sy, -0.9));
    led.push(at(new BoxGeometry(0.008, 0.006, 0.9), sx + 0.14, sy - 0.014, -0.9));
    shapes.push(at(new SphereGeometry(0.06, 12, 8), sx, sy + 0.07, -1.15), at(new ConeGeometry(0.05, 0.14, 10), sx, sy + 0.08, -0.85), at(new BoxGeometry(0.09, 0.12, 0.09), sx, sy + 0.07, -0.6), at(new TorusGeometry(0.05, 0.015, 6, 16), sx, sy + 0.065, -1.35, 0, Math.PI / 2));
  }
  r.add(new Mesh(merge(shelves), basic(THEME.g3)), new Mesh(merge(shapes), basic(THEME.g5)), new Mesh(merge(led), basic(THEME.warm, THEME.emissive.led)));
  const pool = new Mesh(new CircleGeometry(0.45, 32), new MeshBasicMaterial({ map: radial('rgba(246,197,140,0.55)', 'rgba(246,197,140,0)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.012, -0.05); pool.name = 'pool'; r.add(pool);
  return r;
}
/** A window (frame + soft sky pane) placed where the curtain hangs; part of the Revive room. */
export function windowPane(w: number, h: number): Group {
  const g = new Group(); const t = 0.03;
  const frame = merge([at(new BoxGeometry(w, t, t), 0, h / 2, 0), at(new BoxGeometry(w, t, t), 0, -h / 2, 0), at(new BoxGeometry(t, h, t), -w / 2, 0, 0), at(new BoxGeometry(t, h, t), w / 2, 0, 0), at(new BoxGeometry(t * 0.6, h, t * 0.6), 0, 0, 0)]);
  g.add(new Mesh(frame, basic(THEME.g4)));
  const pane = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: radial('#8FA6C4', '#3A4C66'), toneMapped: false })); pane.position.z = -0.02; g.add(pane);
  return g;
}
/** Renew: low-poly paper lantern with an emissive glow. */
export function lantern(): Group {
  const g = new Group(); g.name = 'lantern';
  const prof = [[0.012, 0], [0.05, 0.02], [0.068, 0.07], [0.07, 0.11], [0.06, 0.16], [0.03, 0.19], [0.012, 0.2]].map(([x, y]) => new Vector2(x, y));
  g.add(new Mesh(new LatheGeometry(prof, 8), basic(THEME.warm, THEME.emissive.lantern)));
  g.add(new Mesh(merge([at(new CylinderGeometry(0.035, 0.04, 0.012, 8), 0, 0.006, 0), at(new CylinderGeometry(0.02, 0.02, 0.01, 8), 0, 0.205, 0)]), basic(THEME.g3)));
  const glow = new Mesh(new CircleGeometry(0.3, 24), new MeshBasicMaterial({ map: radial('rgba(246,197,140,0.6)', 'rgba(246,197,140,0)'), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.003; g.add(glow);
  return g;
}
