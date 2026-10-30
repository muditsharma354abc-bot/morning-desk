/**
 * Step 1 "Room wakes up" + step 2 "Mood check" (MR flow only).
 * Wake (~9 s, once per XR session, after the desk + wall are placed): the room dims, a warm sunrise glow rises on the
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
const CARD0 = 1.8, CARD_DT = 0.3; // cards start within 2 s and finish well inside 5 s
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Original low-poly blob with two eyes; 3 draw calls. Expressions via eye shape + a little hop. */
export class Buddy {
  root = new Group(); private body: Mesh; private eyes: Mesh[] = []; face: Face = 'asleep'; private open = 0; private hop = 0; private t = 0;
  constructor() {
    this.body = new Mesh(new IcosahedronGeometry(0.055, 1), new MeshStandardMaterial({ color: '#FFC24D', emissive: new Color('#FFB547'), emissiveIntensity: 0.45, roughness: 0.5, flatShading: true }));
    this.body.scale.set(1, 0.82, 0.9); this.root.add(this.body);
    for (const x of [-0.02, 0.02]) { const e = new Mesh(new SphereGeometry(0.009, 10, 8), new MeshBasicMaterial({ color: '#14161C' })); e.position.set(x, 0.01, 0.047); this.eyes.push(e); this.root.add(e); }
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
    this.body.position.y = this.hop > 0 ? Math.sin((0.5 - this.hop) * Math.PI * 2) * 0.018 : Math.sin(this.t * 1.6) * 0.003; // breathing
    for (const e of this.eyes) e.position.y = 0.01 + this.body.position.y;
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
  onDone(): void;                              // sequence over and no mood question (mood already known today)
}

export class Wake {
  buddy = new Buddy();
  private dim: Mesh; private glow: Mesh; private beam: Mesh; private beamHead!: Mesh; private orbs = new Group();
  private t = -1; private order: string[] = []; private chimed = 0; private ran = false;
  private moodOpen = false; private moodT = 0;
  static readonly LEN = 9;
  /** dev/test only: freeze the sequence at this time (screenshots under slow software rendering). */
  hold?: number;
  /** dev/test only: keep the picked-orb highlight on screen (screenshots). */
  pickHold = false;
  constructor(private h: WakeHost) {
    this.dim = new Mesh(new SphereGeometry(1.5, 24, 16), new MeshBasicMaterial({ color: '#0b0f0d', transparent: true, opacity: 0, side: BackSide, depthWrite: false, depthTest: false }));
    this.dim.renderOrder = -2; this.dim.visible = false; h.scene.add(this.dim);
    this.glow = new Mesh(new PlaneGeometry(2.0, 1.0), new MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    this.glow.position.set(0, -0.2, -0.02); this.glow.visible = false; h.wall.add(this.glow);
    // readable on a bright wall: dark under-bar + solid accent core with a bright leading head (no additive blending)
    const bg = new PlaneGeometry(h.trackW, 0.026); bg.translate(h.trackW / 2, 0, 0);
    this.beam = new Mesh(bg, new MeshBasicMaterial({ color: '#14161C', transparent: true, opacity: 0, depthWrite: false }));
    const cg = new PlaneGeometry(h.trackW, 0.012); cg.translate(h.trackW / 2, 0, 0);
    const core = new Mesh(cg, new MeshBasicMaterial({ color: '#FFB547', transparent: true, depthWrite: false })); core.position.z = 0.001; this.beam.add(core);
    this.beamHead = new Mesh(new SphereGeometry(0.014, 12, 8), new MeshBasicMaterial({ color: '#FFF1C9', transparent: true, depthWrite: false })); this.beam.add(this.beamHead);
    this.beam.position.set(-h.trackW / 2, 0.1, 0.012); this.beam.visible = false; h.wall.add(this.beam);
    this.buddy.root.position.set(-0.45, 0.05, -0.18); this.buddy.root.rotation.y = 0.3; h.desk.add(this.buddy.root); // left of the cards, inside the downward line of sight
    h.group(this.orbs); this.orbs.visible = false; this.buildOrbs();
  }
  /** true while the sequence runs (cards / agent wait). */
  busy(): boolean { return this.t >= 0 && this.t < Wake.LEN; }
  started(): boolean { return this.ran; }
  moodShown(): boolean { return this.moodOpen; }
  start(): void { if (this.ran) return; this.ran = true; this.ended = false; this.t = 0; this.chimed = 0; this.order = this.h.cardOrder(); this.buddy.root.visible = true; this.buddy.setFace('asleep');
    this.dim.visible = this.glow.visible = this.beam.visible = true; document.body.dataset.wake = 'run'; }
  /** session end / re-place: hide everything; the next session wakes up again. */
  reset(): void { this.t = -1; this.ran = false; this.dim.visible = this.glow.visible = this.beam.visible = false; this.orbs.visible = false; this.moodOpen = false; this.buddy.root.visible = false; delete document.body.dataset.wake; }
  /** Card scale multiplier 0..1 (cards appear one by one after the beam). */
  cardK(id: string): number {
    if (!this.busy()) return 1;
    const i = this.order.indexOf(id); if (i < 0) return 1;
    return ease((this.t - (CARD0 + i * CARD_DT)) / 0.25);
  }
  update(dt: number): void {
    this.buddy.update(dt); this.tick(dt);
    if (this.moodOpen) this.updateOrbs(dt);
    if (this.t < 0 || this.t >= Wake.LEN) return;
    this.t = this.hold ?? this.t + dt; const t = this.t;
    const { pos } = this.h.head(); this.dim.position.copy(pos);
    // dim in (0-1 s), hold, lift with the sunrise (8-13 s)
    (this.dim.material as MeshBasicMaterial).opacity = 0.6 * ease(t / 0.6) * (1 - ease((t - 5) / 4));
    (this.dim.material as MeshBasicMaterial).color.lerpColors(new Color('#0b0f0d'), new Color('#3a2414'), ease((t - 0.8) / 4));
    const gm = this.glow.material as MeshBasicMaterial; gm.opacity = 0.75 * ease((t - 0.5) / 3) * (1 - ease((t - 6) / 3));
    this.glow.position.y = -0.45 + 0.3 * ease((t - 0.5) / 4);
    // light beam draws the timeline in (2-4 s), then fades; the wall boards scale in along it
    const bk = Math.max(0.001, ease((t - 0.4) / 1.2)); const bo = 1 - ease((t - 3) / 1);
    this.beam.scale.x = bk; this.beamHead.scale.set(1 / bk, 1, 1); this.beamHead.position.x = this.h.trackW;
    (this.beam.material as MeshBasicMaterial).opacity = 0.8 * bo; for (const c of this.beam.children) (((c as Mesh).material) as MeshBasicMaterial).opacity = bo;
    const ws = this.h.wallScale(); this.h.wall.scale.set(ws * bk, ws, ws);
    // soft chime per card
    while (this.chimed < this.order.length && t >= CARD0 + this.chimed * CARD_DT) { tone([0, 2, 4, 3, 5, 1][this.chimed % 6], 0.5, 0.045); this.chimed++; }
    const cardsEnd = CARD0 + this.order.length * CARD_DT;
    if (t > Math.min(6, cardsEnd + 0.3)) { if (this.buddy.face === 'asleep') { this.buddy.setFace('awake'); tone(4, 0.6, 0.05); } }
    if (t >= Wake.LEN) this.finish();
  }
  /** Evening: cool blue room tint (0 = off). */
  tint(on: boolean): void { this.tintOn = on; }
  private tintOn = false; private tintK = 0;
  tick(dt: number): void {
    this.tintK += ((this.tintOn ? 1 : 0) - this.tintK) * (1 - Math.exp(-dt * 2));
    if (this.busy()) return;
    const m = this.dim.material as MeshBasicMaterial;
    if (this.tintK > 0.01) { this.dim.visible = true; m.color.set('#1b2f55'); m.opacity = 0.3 * this.tintK; this.dim.position.copy(this.h.head().pos); }
    else if (this.dim.visible) this.dim.visible = false;
  }
  /** Skip to the end (any pinch on a mood orb also ends the sequence). */
  private ended = false;
  finish(): void {
    if (this.ended || this.t < 0) return; this.ended = true;
    this.t = Wake.LEN; const ws = this.h.wallScale(); this.h.wall.scale.setScalar(ws);
    this.dim.visible = this.glow.visible = this.beam.visible = false; if (this.buddy.face === 'asleep') this.buddy.setFace('awake');
    document.body.dataset.wake = 'done';
    if (this.h.askMood()) this.showMood(); else this.h.onDone();
  }
  // ------------------------------------------------------------ mood
  private orbItems: { m: Mood; orb: Mesh; label: Label; col: string }[] = [];
  private buildOrbs(): void {
    const defs: [Mood, string, string, string][] = [['low', 'Low', '20 min + breaks', '#8AB4F8'], ['okay', 'Okay', '45 min blocks', '#8FD1A5'], ['focused', 'Focused', 'up to 90 min', '#FFB547']];
    const head = new Label(0.3, 0.05); head.draw((g, W, H) => { panel(g, W, H, C.glass, C.accent); text(g, 'How do you feel today?', W / 2 + 4, H / 2, 26, C.ink, 600, W, 'center'); });
    head.mesh.position.set(0, 0.115, 0); this.orbs.add(head.mesh); (head.mesh.material as MeshBasicMaterial).depthTest = false; head.mesh.renderOrder = 20; // left of the orbs: nothing reaches up over a real monitor
    defs.forEach(([m, name, sub, col], i) => {
      const label = new Label(0.115, 0.115);
      label.draw((g, W, H) => { panel(g, W, H, C.glass, col); text(g, name, W / 2, H * 0.74, 22, C.ink, 700, W, 'center'); text(g, sub, W / 2, H * 0.89, 13, C.mute, 500, W, 'center'); });
      const orb = new Mesh(new IcosahedronGeometry(0.03, 2), new MeshBasicMaterial({ color: col, transparent: true }));
      orb.position.set(0, 0.018, 0.02); label.mesh.add(orb); // child of the pressable, so a ray/poke on the orb counts
      this.h.pressable(label.mesh, this.orbs, () => this.pick(m)); label.mesh.position.set((i - 1) * 0.13, 0, 0);
      for (const x of [label.mesh, orb]) { (x.material as MeshBasicMaterial).depthTest = false; x.renderOrder = 20 + (x === orb ? 1 : 0); } // UI stays on top of room meshes
      this.orbItems.push({ m, orb, label, col });
    });
  }
  private showMood(): void {
    const { pos, fwd } = this.h.head(); const f = fwd.clone(); f.y = 0; f.normalize();
    this.orbs.position.copy(pos).addScaledVector(f, 0.45); this.orbs.position.y = pos.y - 0.07; // eye height (the wall boards step aside meanwhile) // within poke reach, below the timeline and a real monitor // inside the seated FoV, within reach
    this.orbs.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-f.x, -f.z));
    this.orbs.rotateX(-0.12); this.orbs.visible = true; this.moodOpen = true; this.picked = null; this.moodT = 0; document.body.dataset.mood = 'ask';
    for (const o of this.orbItems) o.label.mesh.scale.setScalar(0.01);
  }
  private updateOrbs(dt: number): void {
    this.moodT += dt;
    if (this.picked) { this.pickT += dt; const p = ease(this.pickT / 0.35);
      for (const o of this.orbItems) { const on = o.m === this.picked; o.label.mesh.scale.setScalar(on ? 1 + 0.25 * p : Math.max(0.01, 1 - p));
        (o.orb.material as MeshBasicMaterial).color.set(on && Math.floor(this.pickT * 8) % 2 === 0 ? '#FFFFFF' : o.col); }
      if (this.pickT > 0.9 && !this.pickHold) this.applyPick(this.picked); return; }
    this.orbItems.forEach((o, i) => { const k = ease((this.moodT - i * 0.12) / 0.25); o.label.mesh.scale.setScalar(Math.max(0.01, k)); o.orb.rotation.y += dt * 0.6; o.orb.position.y = 0.018 + Math.sin(this.moodT * 2 + i) * 0.004; });
  }
  private picked: Mood | null = null; private pickT = 0;
  /** One pinch: the chosen orb lights up and grows, the others fade, then the choice is applied. */
  pick(m: Mood): void {
    if (!this.moodOpen || this.picked) return;
    this.picked = m; this.pickT = 0; document.body.dataset.mood = `picked:${m}`;
    tone(m === 'low' ? 1 : m === 'okay' ? 3 : 5, 0.5, 0.06);
  }
  private applyPick(m: Mood): void {
    this.picked = null; this.moodOpen = false; this.orbs.visible = false; document.body.dataset.mood = m;
    this.buddy.setFace(m === 'low' ? 'sleepy' : m === 'focused' ? 'happy' : 'awake');
    this.h.onMood(m);
  }
}
