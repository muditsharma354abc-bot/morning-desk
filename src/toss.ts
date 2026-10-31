/**
 * Step 5 · Crumple & toss (behind &toss=1). A low-poly floor bin beside the seat (within ~2 ft), a paper-ball mesh that
 * replaces a held card as it crumples, a ballistic flight on wall-clock seconds, and a small confetti burst on a basket.
 * Pure three.js via @iwsdk/core re-exports; the desk system owns state (task → 'dropped') and input.
 */
import {
  CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, Vector3, BufferAttribute,
} from '@iwsdk/core';
import { Label, panel, text } from './label.js';

export const TOSS = new URLSearchParams(location.search).get('toss') === '1';
export const BIN_R = 0.14, BIN_H = 0.3;
const G = 9.8;
export const CRUMPLE_S = 0.45; // crumple animation length (seconds, wall-clock)

function paperBall(): Mesh {
  const g = new IcosahedronGeometry(0.045, 1); const p = g.getAttribute('position') as BufferAttribute; const v = new Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 0.78 + 0.3 * Math.abs(Math.sin(v.x * 91 + v.y * 53 + v.z * 37)); v.multiplyScalar(n); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return new Mesh(g, new MeshStandardMaterial({ color: '#F3EEDF', roughness: 0.95, flatShading: true }));
}

export class Toss {
  bin = new Group(); ball = paperBall(); private confetti: Mesh[] = []; tag = new Label(0.26, 0.06);
  /** id being crumpled in the hand + progress 0..1 */
  held: { id: string; c: number } | null = null;
  /** ball in flight (seconds since launch) */
  fly: { id: string; p: Vector3; v: Vector3; t: number; into: boolean; done: (inBin: boolean) => void; assist?: { from: Vector3; T: number } } | null = null;
  private burstT = -1; private tagT = 0;
  constructor() {
    const wall = new Mesh(new CylinderGeometry(BIN_R, BIN_R * 0.82, BIN_H, 14, 1, true), new MeshStandardMaterial({ color: '#3B4A45', roughness: 0.8, side: 2 }));
    wall.position.y = BIN_H / 2;
    const base = new Mesh(new CylinderGeometry(BIN_R * 0.82, BIN_R * 0.82, 0.01, 14), new MeshStandardMaterial({ color: '#2A3532' })); base.position.y = 0.005;
    const rim = new Mesh(new TorusGeometry(BIN_R, 0.008, 6, 20), new MeshBasicMaterial({ color: '#FFC94D' })); rim.rotation.x = Math.PI / 2; rim.position.y = BIN_H;
    this.bin.add(wall, base, rim); this.bin.visible = false;
    this.ball.visible = false; this.ball.scale.setScalar(0.001);
    const cols = ['#FFC94D', '#9CBF9B', '#F3EEDF', '#E58F6A', '#8FB3D9'];
    for (let i = 0; i < 18; i++) { const m = new Mesh(new IcosahedronGeometry(0.008, 0), new MeshBasicMaterial({ color: cols[i % cols.length] })); m.visible = false; this.confetti.push(m); this.bin.add(m); }
    this.tag.mesh.visible = false; this.tag.mesh.position.set(0, BIN_H + 0.24, 0); this.bin.add(this.tag.mesh);
  }
  rimWorld(out: Vector3): Vector3 { return this.bin.getWorldPosition(out).add(new Vector3(0, BIN_H, 0)); }
  /** Launch from p with velocity v. If the throw would land within the assist radius of the rim, the arc is bent into the bin. */
  launch(id: string, p: Vector3, v: Vector3, done: (inBin: boolean) => void, force = false): boolean {
    const rim = this.rimWorld(new Vector3());
    // where does the unassisted arc cross rim height?
    const dy = p.y - rim.y; let tHit = -1;
    const a = -0.5 * G, b = v.y, c = dy; const disc = b * b - 4 * a * c;
    if (disc >= 0) { const r1 = (-b - Math.sqrt(disc)) / (2 * a); const r2 = (-b + Math.sqrt(disc)) / (2 * a); tHit = Math.max(r1, r2); }
    const land = tHit > 0 ? new Vector3(p.x + v.x * tHit, rim.y, p.z + v.z * tHit) : p.clone();
    const flat = (q: Vector3) => Math.hypot(q.x - rim.x, q.z - rim.z);
    const into = force || (tHit > 0 && flat(land) < BIN_R * 1.6) || (p.y > rim.y - 0.02 && flat(p) < BIN_R + 0.12);
    this.fly = { id, p: p.clone(), v: v.clone(), t: 0, into, done };
    if (into) this.fly.assist = { from: p.clone(), T: force ? 0.7 : Math.min(0.9, Math.max(0.35, tHit > 0 ? tHit : 0.4)) };
    this.ball.position.copy(p); this.ball.visible = true; this.ball.scale.setScalar(1);
    return into;
  }
  /** per-frame, dt in seconds (wall-clock) */
  update(dt: number): void {
    const f = this.fly;
    if (f) {
      f.t += dt; const rim = this.rimWorld(new Vector3());
      if (f.assist) { // a smooth arc from the release point down into the bin centre
        const u = Math.min(1, f.t / f.assist.T); const end = rim.clone().add(new Vector3(0, -BIN_H * 0.7, 0));
        this.ball.position.copy(f.assist.from).lerp(end, u); this.ball.position.y += 0.12 * Math.sin(Math.PI * u) * (1 - u * 0.3);
        if (u >= 1) { this.fly = null; this.ball.visible = false; this.burst(); f.done(true); }
      } else {
        f.v.y -= G * dt; f.p.addScaledVector(f.v, dt); this.ball.position.copy(f.p);
        if (f.p.y < 0.03 || f.t > 2) { this.fly = null; this.ball.visible = false; f.done(false); }
      }
      this.ball.rotation.x += dt * 7; this.ball.rotation.z += dt * 4;
    }
    if (this.burstT >= 0) {
      this.burstT += dt; const t = this.burstT;
      this.confetti.forEach((m, i) => { const a = (i / this.confetti.length) * Math.PI * 2; const r = 0.05 + 0.18 * t; m.visible = t < 2;
        m.position.set(Math.cos(a) * r, BIN_H + 0.02 + Math.max(0, 0.9 * t - 0.6 * t * t) + (i % 3) * 0.02, Math.sin(a) * r); m.rotation.x = t * 9 + i; });
      if (t >= 2) this.burstT = -1;
    }
    if (this.tagT > 0) { this.tagT -= dt; if (this.tagT <= 0) this.tag.mesh.visible = false; }
  }
  private burst(): void { this.burstT = 0; }
  say(msg: string, secs = 2.5): void {
    this.tag.draw((g, W, H) => { panel(g, W, H, '#2F3A36', '#FFC94D', 1); text(g, msg, W / 2, H / 2, 26, '#fff', 700, W - 12, 'center'); });
    this.tag.mesh.visible = true; this.tagT = secs;
  }
  busy(): boolean { return !!this.fly || !!this.held; }
}
