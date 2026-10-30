/**
 * Step 1 "Room wakes up" + step 2 "Mood check" (MR flow only).
 * Wake (~14 s, once per XR session, after the desk + wall are placed): the room dims, a warm sunrise glow rises on the
 * real wall, a light beam draws the timeline in, task cards appear one by one with a soft chime, and the desk buddy
 * opens its eyes. Then three mood orbs (low / okay / focused) ask for one pinch; the choice stays on-device.
 */
import { AdditiveBlending, BackSide, CanvasTexture, Color, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { Label, panel, text } from './label.js';
import { C } from './style.js';
import { tone } from './style.js';
import type { Mood } from './state.js';

export type Face = 'asleep' | 'awake' | 'sleepy' | 'happy';
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Original low-poly blob with two eyes; 3 draw calls. Expressions via eye shape + a little hop. */
export class Buddy {
  root = new Group(); private body: Mesh; private eyes: Mesh[] = []; face: Face = 'asleep'; private open = 0; private hop = 0; private t = 0;
  constructor() {
    this.body = new Mesh(new IcosahedronGeometry(0.045, 1), new MeshStandardMaterial({ color: '#FFB547', roughness: 0.55, flatShading: true }));
    this.body.scale.set(1, 0.82, 0.9); this.root.add(this.body);
    for (const x of [-0.016, 0.016]) { const e = new Mesh(new SphereGeometry(0.0075, 10, 8), new MeshBasicMaterial({ color: '#14161C' })); e.position.set(x, 0.008, 0.039); this.eyes.push(e); this.root.add(e); }
    this.root.visible = false;
  }
  setFace(f: Face): void { if (f !== this.face && (f === 'happy' || f === 'awake')) this.hop = 0.5; this.face = f; }
  update(dt: number): void {
    this.t += dt;
    const want = this.face === 'asleep' ? 0.08 : this.face === 'sleepy' ? 0.45 : 1;
    this.open += (want - this.open) * (1 - Math.exp(-dt * 6));
    const blink = this.face !== 'asleep' && this.t % 4.2 < 0.12 ? 0.1 : 1;
    for (const e of this.eyes) e.scale.set(this.face === 'happy' ? 1.15 : 1, Math.max(0.06, this.open * blink), 1);
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt);
    this.body.position.y = this.hop > 0 ? Math.sin((0.5 - this.hop) * Math.PI * 2) * 0.012 : Math.sin(this.t * 1.6) * 0.002; // breathing
    for (const e of this.eyes) e.position.y = 0.008 + this.body.position.y;
  }
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d')!;
  const r = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,190,110,1)'); r.addColorStop(0.45, 'rgba(255,150,80,0.55)'); r.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export interface WakeHost {
  scene: Object3D; desk: Group; wall: Group; trackW: number;
  head(): { pos: Vector3; fwd: Vector3 };
  cardOrder(): string[];                       // ids in the order they should appear
  wallScale(): number;
  pressable(mesh: Mesh, parent: Group, action: () => void): void; // makes `mesh` a child entity of `parent` (ray + poke)
  group(g: Group): void;                       // registers a top-level group as a transform entity
  askMood(): boolean;                          // false once today's mood is known
  onMood(m: Mood): void;
}

export class Wake {
  buddy = new Buddy();
  private dim: Mesh; private glow: Mesh; private beam: Mesh; private orbs = new Group();
  private t = -1; private order: string[] = []; private chimed = 0; private ran = false;
  private moodOpen = false; private moodT = 0;
  static readonly LEN = 14;
  /** dev/test only: freeze the sequence at this time (screenshots under slow software rendering). */
  hold?: number;
  constructor(private h: WakeHost) {
    this.dim = new Mesh(new SphereGeometry(2.4, 24, 16), new MeshBasicMaterial({ color: '#0b0f0d', transparent: true, opacity: 0, side: BackSide, depthWrite: false, depthTest: false }));
    this.dim.renderOrder = -2; this.dim.visible = false; h.scene.add(this.dim);
    this.glow = new Mesh(new PlaneGeometry(2.0, 1.0), new MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.glow.position.set(0, -0.2, -0.02); this.glow.visible = false; h.wall.add(this.glow);
    const bg = new PlaneGeometry(h.trackW, 0.008); bg.translate(h.trackW / 2, 0, 0);
    this.beam = new Mesh(bg, new MeshBasicMaterial({ color: '#FFE2A8', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.beam.position.set(-h.trackW / 2, 0.075, 0.012); this.beam.visible = false; h.wall.add(this.beam);
    this.buddy.root.position.set(-0.42, 0.035, -0.1); this.buddy.root.rotation.y = 0.35; h.desk.add(this.buddy.root);
    h.group(this.orbs); this.orbs.visible = false; this.buildOrbs();
  }
  /** true while the sequence runs (cards / agent wait). */
  busy(): boolean { return this.t >= 0 && this.t < Wake.LEN; }
  started(): boolean { return this.ran; }
  moodShown(): boolean { return this.moodOpen; }
  start(): void { if (this.ran) return; this.ran = true; this.t = 0; this.chimed = 0; this.order = this.h.cardOrder(); this.buddy.root.visible = true; this.buddy.setFace('asleep');
    this.dim.visible = this.glow.visible = this.beam.visible = true; document.body.dataset.wake = 'run'; }
  /** session end / re-place: hide everything; the next session wakes up again. */
  reset(): void { this.t = -1; this.ran = false; this.dim.visible = this.glow.visible = this.beam.visible = false; this.orbs.visible = false; this.moodOpen = false; this.buddy.root.visible = false; delete document.body.dataset.wake; }
  /** Card scale multiplier 0..1 (cards appear one by one after the beam). */
  cardK(id: string): number {
    if (!this.busy()) return 1;
    const i = this.order.indexOf(id); if (i < 0) return 1;
    return ease((this.t - (4.2 + i * 0.55)) / 0.28);
  }
  update(dt: number): void {
    this.buddy.update(dt);
    if (this.moodOpen) this.updateOrbs(dt);
    if (this.t < 0 || this.t >= Wake.LEN) return;
    this.t = this.hold ?? this.t + dt; const t = this.t;
    const { pos } = this.h.head(); this.dim.position.copy(pos);
    // dim in (0-1 s), hold, lift with the sunrise (8-13 s)
    (this.dim.material as MeshBasicMaterial).opacity = 0.6 * ease(t / 1) * (1 - ease((t - 8) / 5));
    (this.dim.material as MeshBasicMaterial).color.lerpColors(new Color('#0b0f0d'), new Color('#3a2414'), ease((t - 1.5) / 6));
    const gm = this.glow.material as MeshBasicMaterial; gm.opacity = 0.75 * ease((t - 1) / 4) * (1 - ease((t - 10) / 4));
    this.glow.position.y = -0.45 + 0.3 * ease((t - 1) / 6);
    // light beam draws the timeline in (2-4 s), then fades; the wall boards scale in along it
    this.beam.scale.x = Math.max(0.001, ease((t - 2) / 2)); (this.beam.material as MeshBasicMaterial).opacity = 0.9 * (1 - ease((t - 4.5) / 1.5));
    const ws = this.h.wallScale(); this.h.wall.scale.set(ws * Math.max(0.001, ease((t - 2) / 2)), ws, ws);
    // soft chime per card
    while (this.chimed < this.order.length && t >= 4.2 + this.chimed * 0.55) { tone([0, 2, 4, 3, 5, 1][this.chimed % 6], 0.5, 0.045); this.chimed++; }
    const cardsEnd = 4.2 + this.order.length * 0.55;
    if (t > Math.max(8, cardsEnd + 0.4)) { if (this.buddy.face === 'asleep') { this.buddy.setFace('awake'); tone(4, 0.6, 0.05); } }
    if (t >= Wake.LEN) this.finish();
  }
  /** Skip to the end (any pinch on a mood orb also ends the sequence). */
  finish(): void {
    this.t = Wake.LEN; const ws = this.h.wallScale(); this.h.wall.scale.setScalar(ws);
    this.dim.visible = this.glow.visible = this.beam.visible = false; if (this.buddy.face === 'asleep') this.buddy.setFace('awake');
    document.body.dataset.wake = 'done';
    if (this.h.askMood()) this.showMood();
  }
  // ------------------------------------------------------------ mood
  private orbItems: { m: Mood; orb: Mesh; label: Label }[] = [];
  private buildOrbs(): void {
    const defs: [Mood, string, string, string][] = [['low', 'Low', '20 min + breaks', '#8AB4F8'], ['okay', 'Okay', '45 min blocks', '#8FD1A5'], ['focused', 'Focused', 'up to 90 min', '#FFB547']];
    const head = new Label(0.36, 0.05); head.draw((g, W, H) => { panel(g, W, H, C.glass, C.accent); text(g, 'How do you feel this morning?', W / 2, H / 2, 24, C.ink, 600, W, 'center'); });
    head.mesh.position.set(0, 0.1, 0); this.orbs.add(head.mesh); (head.mesh.material as MeshBasicMaterial).depthTest = false; head.mesh.renderOrder = 20;
    defs.forEach(([m, name, sub, col], i) => {
      const label = new Label(0.115, 0.115);
      label.draw((g, W, H) => { panel(g, W, H, C.glass, col); text(g, name, W / 2, H * 0.74, 22, C.ink, 700, W, 'center'); text(g, sub, W / 2, H * 0.89, 13, C.mute, 500, W, 'center'); });
      const orb = new Mesh(new IcosahedronGeometry(0.03, 2), new MeshBasicMaterial({ color: col, transparent: true }));
      orb.position.set(0, 0.018, 0.02); label.mesh.add(orb); // child of the pressable, so a ray/poke on the orb counts
      this.h.pressable(label.mesh, this.orbs, () => this.pick(m)); label.mesh.position.set((i - 1) * 0.13, 0, 0);
      for (const x of [label.mesh, orb]) { (x.material as MeshBasicMaterial).depthTest = false; x.renderOrder = 20 + (x === orb ? 1 : 0); } // UI stays on top of room meshes
      this.orbItems.push({ m, orb, label });
    });
  }
  private showMood(): void {
    const { pos, fwd } = this.h.head(); const f = fwd.clone(); f.y = 0; f.normalize();
    this.orbs.position.copy(pos).addScaledVector(f, 0.42); this.orbs.position.y = pos.y - 0.15; // inside the seated FoV, within reach
    this.orbs.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-f.x, -f.z));
    this.orbs.rotateX(-0.25); this.orbs.visible = true; this.moodOpen = true; this.moodT = 0; document.body.dataset.mood = 'ask';
    for (const o of this.orbItems) o.label.mesh.scale.setScalar(0.01);
  }
  private updateOrbs(dt: number): void {
    this.moodT += dt;
    this.orbItems.forEach((o, i) => { const k = ease((this.moodT - i * 0.12) / 0.25); o.label.mesh.scale.setScalar(Math.max(0.01, k)); o.orb.rotation.y += dt * 0.6; o.orb.position.y = 0.018 + Math.sin(this.moodT * 2 + i) * 0.004; });
  }
  pick(m: Mood): void {
    if (!this.moodOpen) return;
    this.moodOpen = false; this.orbs.visible = false; document.body.dataset.mood = m;
    this.buddy.setFace(m === 'low' ? 'sleepy' : m === 'focused' ? 'happy' : 'awake');
    tone(m === 'low' ? 1 : m === 'okay' ? 3 : 5, 0.5, 0.06);
    this.h.onMood(m);
  }
}
