import {
  Color, createSystem, CylinderGeometry, Entity, Grabbed, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  OneHandGrabbable, Pressed, Quaternion, RayInteractable, SphereGeometry, Vector2, Vector3,
  VisibilityState, XRAnchor, XRPlane,
} from '@iwsdk/core';
import { Label, panel, para, text } from './label.js';
import { PlanChange, RulePlanner } from './planner.js';
import { C, sfx } from './style.js';
import { clone, completeDay, demoState, dur, fmt, load, PlanState, save, scheduledMinutes } from './state.js';

// ---- layout constants (metres). Seated, ~0.6 m reach, key UI within ~30° of gaze centre.
const DESK_FWD = 0.42, DESK_DOWN = 0.3;      // card spread in easy reach
const WALL_FWD = 1.2;                         // fallback timeline distance, eye height
const TRACK_W = 1.0, TRACK_H = 0.12;          // 1.0 m at 1.2 m ≈ ±23°
const CARD_W = 0.15, CARD_H = 0.085;
const SWIPE_SPEED = 0.9;                      // m/s lateral flick = skip

interface Item { id: string; label: Label; entity: Entity; place: string; drawnKey: string; }
type Btn = { label: Label; entity: Entity; action: () => void };

export class MorningDeskSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  planes: { required: [XRPlane] },
}) {
  private s!: PlanState;
  private planner = new RulePlanner();
  private items = new Map<string, Item>();
  private buttons = new Map<number, Btn>();
  private desk = new Group();
  private deskE!: Entity; private wallE!: Entity;
  private wall = new Group();
  private header!: Label;
  private agentPanel!: Label;
  private detail!: Label;
  private tutorial!: Label;
  private marker!: Mesh;
  private plant = new Group();
  private streakLabel!: Label;
  private yesBtn!: Btn; private noBtn!: Btn;
  private pending: PlanChange | null = null;
  private declined = new Set<string>();
  private agentMsg = '';
  private agentTimer = 0;
  private wallMode: 'detected' | 'fallback' = 'fallback';
  private placed = false;
  private tutorialT = -1;
  private drag: { id: string; t0: number; p0: Vector3; hist: { t: number; p: Vector3 }[] } | null = null;
  private mouseDrag: { id: string; depth: number } | null = null;
  private tmp = new Vector3(); private tmp2 = new Vector3(); private q = new Quaternion();
  private detailId = '';
  private plantGrow = 0;
  private lastDomPress = 0;

  init(): void {
    this.s = load();
    (window as unknown as { __mdSys: unknown }).__mdSys = this;
    const scene = this.world.scene;
    scene.add(new HemisphereLight(0xfff6e8, 0x6b7a72, 1.6));
    this.deskE = this.world.createTransformEntity(this.desk, { persistent: true });
    this.wallE = this.world.createTransformEntity(this.wall, { persistent: true });
    this.setBackground(true);

    // Desk surface (soft paper tray) + plant + streak.
    const tray = new Label(0.62, 0.3);
    tray.draw((g, W, H) => panel(g, W, H, '#e9e2d3', undefined, 0.55));
    tray.mesh.rotation.x = -Math.PI / 2; tray.mesh.position.set(0, -0.005, 0);
    this.desk.add(tray.mesh);
    this.buildPlant();
    this.streakLabel = new Label(0.14, 0.035);
    this.streakLabel.mesh.position.set(0.24, 0.17, 0.02); this.desk.add(this.streakLabel.mesh);

    // Wall: header + track + agent panel.
    this.header = new Label(TRACK_W + 0.2, 0.09);
    this.header.mesh.position.set(0, 0.17, 0); this.wall.add(this.header.mesh);
    const track = new Label(TRACK_W + 0.04, TRACK_H + 0.04);
    track.draw((g, W, H) => {
      panel(g, W, H, '#ffffff', undefined, 0.35);
      g.strokeStyle = '#ffffff88'; g.lineWidth = 2;
      for (let h = 0; h <= this.s.availableMinutes / 60; h++) {
        const x = 20 + (h * 60 / this.s.availableMinutes) * (W - 40);
        g.beginPath(); g.moveTo(x, 10); g.lineTo(x, H - 10); g.stroke();
      }
    });
    track.mesh.position.z = -0.004; this.wall.add(track.mesh);
    this.marker = new Mesh(new CylinderGeometry(0.004, 0.004, TRACK_H + 0.05, 8), new MeshStandardMaterial({ color: C.sageDeep, emissive: new Color(C.sage), emissiveIntensity: 0.6 }));
    this.marker.visible = false; this.wall.add(this.marker);
    this.agentPanel = new Label(0.62, 0.11);
    this.agentPanel.mesh.position.set(-0.12, -0.25, 0.01); this.wall.add(this.agentPanel.mesh);
    this.yesBtn = this.button('👍 Keep', 0.11, () => this.decide(true), this.wallE);
    this.noBtn = this.button('👎 Undo', 0.11, () => this.decide(false), this.wallE);
    this.yesBtn.label.mesh.position.set(0.28, -0.225, 0.01); this.noBtn.label.mesh.position.set(0.28, -0.28, 0.01);

    // Desk buttons (reachable row at the back of the desk).
    const row: [string, () => void][] = [
      ['✨ Plan for me', () => this.runAgent(true)], ['✓ Done', () => this.finishDay()],
      ['? Tutorial', () => this.startTutorial()], ['↺ Demo reset', () => this.reset(true)],
    ];
    row.forEach(([t, fn], i) => {
      const b = this.button(t, 0.115, fn, this.deskE);
      b.label.mesh.position.set(-0.225 + i * 0.125, 0.03, -0.17); b.label.mesh.rotation.x = -0.5;
    });

    this.detail = new Label(0.34, 0.2); this.detail.mesh.visible = false;
    const de = this.world.createTransformEntity(this.detail.mesh, this.deskE);
    de.addComponent(RayInteractable);
    this.buttons.set(de.index, { label: this.detail, entity: de, action: () => this.openDetail('') });
    this.detail.mesh.position.set(0, 0.13, 0.02); this.detail.mesh.rotation.x = -0.35;

    this.tutorial = new Label(0.44, 0.12); this.tutorial.mesh.visible = false;
    this.tutorial.mesh.position.set(0, 0.29, -0.1); this.desk.add(this.tutorial.mesh);

    this.queries.pressed.subscribe('qualify', (e) => { if (performance.now() - this.lastDomPress > 400) this.buttons.get(e.index)?.action(); });
    this.queries.planes.subscribe('qualify', (e) => this.tryWall(e));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe((v) => {
      this.setBackground(v === VisibilityState.NonImmersive);
      // hand grabbing only in XR; the flat view uses our own mouse drag (avoids two systems moving a card)
      for (const it of this.items.values()) {
        if (this.inXR() && !it.entity.hasComponent(OneHandGrabbable)) it.entity.addComponent(OneHandGrabbable, { rotate: false });
        if (!this.inXR() && it.entity.hasComponent(OneHandGrabbable)) it.entity.removeComponent(OneHandGrabbable);
      }
      this.placed = false; // re-place around the head once the session pose settles
    }));
    this.hookDom();
    this.syncItems();
    this.redrawAll();
    if (!this.s.tutorialSeen) setTimeout(() => this.startTutorial(), 1200);
    if (new URLSearchParams(location.search).has('demo')) this.agentTimer = 2.5;
  }

  // ---------------------------------------------------------------- placement
  private setBackground(flat: boolean): void {
    // Passthrough in MR: transparent background. In the flat browser view, a calm dawn tint.
    this.world.scene.background = flat ? new Color('#cfd8d2') : null;
  }
  private place(): void {
    const cam = this.world.camera; cam.updateWorldMatrix(true, false);
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.q)); fwd.y = 0; fwd.normalize();
    // flat browser view: the camera stays put, so seat a virtual head in front of it to frame desk + wall at 16:9
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) { head.addScaledVector(fwd, 0.3); head.y -= 0.1; }
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) {  }
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.desk.position.copy(head).addScaledVector(fwd, DESK_FWD); this.desk.position.y -= DESK_DOWN;
    this.desk.rotation.set(0, yaw, 0);
    const saved = this.world.visibilityState.value !== VisibilityState.NonImmersive ? localStorage.getItem('morning-desk.wall') : null;
    if (this.wallMode !== 'detected') {
      if (saved) {
        const [x, y, z, r] = JSON.parse(saved) as number[];
        this.wall.position.set(x, y, z); this.wall.rotation.set(0, r, 0);
      } else {
        this.wall.position.copy(head).addScaledVector(fwd, WALL_FWD); this.wall.position.y = head.y + 0.02;
        this.wall.rotation.set(0, yaw, 0);
      }
    }
    for (const pe of this.queries.planes.entities) this.tryWall(pe);
    this.placed = true; this.redrawHeader();
  }
  /** Pin the timeline onto a detected vertical plane in front of the user, then anchor it. */
  private tryWall(e: Entity): void {
    if (this.wallMode === 'detected') return;
    const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
    const o = e.object3D; if (!o || plane?.orientation !== 'vertical') return;
    const cam = this.world.camera;
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const p = new Vector3().setFromMatrixPosition(o.matrixWorld);
    const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
    const d = p.distanceTo(head);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
    if (d < 0.5 || d > 3.5 || fwd.dot(p.clone().sub(head).normalize()) < 0.7) return;
    if (n.dot(head.clone().sub(p)) < 0) n.negate();
    // project the user's gaze point onto the wall, at eye height
    const t = n.dot(p.clone().sub(head)) / Math.min(-0.2, n.dot(fwd));
    const hit = head.clone().addScaledVector(fwd, Math.abs(t)); hit.y = head.y;
    this.wall.position.copy(hit).addScaledVector(n, 0.03);
    this.wall.rotation.set(0, Math.atan2(n.x, n.z), 0);
    this.wallMode = 'detected';
    if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor); // world-locked to the real wall
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- items
  private button(t: string, w: number, action: () => void, parent: Entity): Btn {
    const label = new Label(w, 0.042);
    label.draw((g, W, H) => { panel(g, W, H, C.sageDeep); text(g, t, W / 2, H / 2, 20, '#fff', 600, W - 16, 'center'); });
    const entity = this.world.createTransformEntity(label.mesh, parent);
    entity.addComponent(RayInteractable);
    const b = { label, entity, action };
    this.buttons.set(entity.index, b);
    return b;
  }
  private syncItems(): void {
    const live = new Set(Object.keys(this.s.tasks));
    for (const [id, it] of this.items) if (!live.has(id)) { it.entity.dispose(); this.items.delete(id); }
    for (const id of live) {
      if (this.items.has(id)) continue;
      const label = new Label(CARD_W, CARD_H);
      const entity = this.world.createTransformEntity(label.mesh);
      if (this.inXR()) entity.addComponent(OneHandGrabbable, { rotate: false });
      label.mesh.userData.taskId = id;
      // spawn split parts where the parent was, so the split is visible
      const parent = !this.s.tasks[id].partOf ? undefined : [...this.items.values()].find((x) => this.s.tasks[id].partOf === x.id || id.startsWith(`${x.id}~`));
      const start = parent?.label.mesh.position ?? this.desk.position;
      label.mesh.position.copy(start);
      this.items.set(id, { id, label, entity, place: '', drawnKey: '' });
    }
  }
  private placeOf(id: string): string {
    const s = this.s;
    if (s.timeline.includes(id)) return 'timeline';
    if (s.tomorrow.includes(id)) return 'tomorrow';
    if (s.skipped.includes(id)) return 'skipped';
    return 'stack';
  }
  private inXR(): boolean { return this.world.visibilityState.value !== VisibilityState.NonImmersive; }
  private pxPerM(): number { return TRACK_W / this.s.availableMinutes; }
  /** Target world pose for each item, derived only from state → moves animate automatically. */
  private target(it: Item, out: Vector3, outQ: Quaternion): { w: number; h: number; visible: boolean } {
    const s = this.s; const place = this.placeOf(it.id);
    if (place === 'timeline') {
      let start = 0;
      for (const id of s.timeline) { if (id === it.id) break; start += s.tasks[id].minutes; }
      const w = Math.max(0.03, s.tasks[it.id].minutes * this.pxPerM() - 0.006);
      out.set(-TRACK_W / 2 + start * this.pxPerM() + w / 2 + 0.003, 0, 0.006);
      this.wall.localToWorld(out); outQ.copy(this.wall.quaternion);
      return { w, h: TRACK_H, visible: true };
    }
    if (place === 'tomorrow') {
      const i = s.tomorrow.indexOf(it.id);
      out.set(-TRACK_W / 2 + 0.06 + i * 0.13, -0.34, 0.006); this.wall.localToWorld(out); outQ.copy(this.wall.quaternion);
      return { w: 0.12, h: 0.04, visible: true };
    }
    if (place === 'skipped') {
      out.set(0.7, -0.2, 0); this.desk.localToWorld(out); outQ.copy(this.desk.quaternion);
      return { w: CARD_W, h: CARD_H, visible: false };
    }
    const i = s.stack.indexOf(it.id);
    const col = i % 3, row = Math.floor(i / 3);
    out.set(-0.17 + col * 0.165, 0.035 + row * 0.005, 0.07 - row * 0.1); this.desk.localToWorld(out);
    outQ.copy(this.desk.quaternion).multiply(this.q.setFromAxisAngle(new Vector3(1, 0, 0), -1.05));
    return { w: CARD_W, h: CARD_H, visible: true };
  }
  private drawItem(it: Item, place: string, w: number, h: number): void {
    const t = this.s.tasks[it.id]; if (!t) return;
    const key = `${place}|${w.toFixed(3)}|${t.title}|${t.minutes}|${this.slotStart(it.id)}`;
    if (key === it.drawnKey) return; it.drawnKey = key;
    it.label.resize(w, h);
    const over = place === 'timeline' && this.slotStart(it.id) + t.minutes > this.s.availableMinutes;
    it.label.draw((g, W, H) => {
      if (place === 'stack') {
        panel(g, W, H, C.paper, C.prio[t.priority]);
        text(g, t.title, 30, H * 0.36, 19, C.ink, 600, W - 40);
        text(g, `${dur(t.minutes)} · ${['', 'must', 'should', 'nice'][t.priority]}`, 30, H * 0.72, 16, C.mute, 500, W - 40);
      } else if (place === 'timeline') {
        panel(g, W, H, over ? C.warn : C.prio[t.priority], undefined, 0.95);
        const small = W < 90;
        text(g, small ? t.title.slice(0, 6) : t.title, 10, H * 0.32, small ? 14 : 17, C.ink, 600, W - 16);
        text(g, `${fmt(this.s.dayStart + this.slotStart(it.id))} · ${dur(t.minutes)}`, 10, H * 0.7, 14, C.ink, 400, W - 16);
      } else {
        panel(g, W, H, '#ffffff', C.prio[t.priority], 0.8);
        text(g, `→ ${t.title}`, 24, H / 2, 15, C.mute, 500, W - 30);
      }
    });
  }
  private slotStart(id: string): number {
    let m = 0; for (const x of this.s.timeline) { if (x === id) return m; m += this.s.tasks[x].minutes; } return 0;
  }

  // ---------------------------------------------------------------- drop logic (shared by hands + mouse)
  /** Where would a card released at world point p land on the wall? (head→card ray, so seated users can "aim" it). */
  private wallSlot(p: Vector3): number | null {
    const cam = this.world.camera; const head = this.tmp.setFromMatrixPosition(cam.matrixWorld);
    const n = new Vector3(0, 0, 1).applyQuaternion(this.wall.quaternion);
    const dir = p.clone().sub(head).normalize();
    const denom = n.dot(dir); if (Math.abs(denom) < 1e-3) return null;
    const t = n.dot(this.wall.position.clone().sub(head)) / denom; if (t <= 0) return null;
    const hit = this.wall.worldToLocal(head.clone().addScaledVector(dir, t));
    if (Math.abs(hit.y) > 0.16 || hit.x < -TRACK_W / 2 - 0.1 || hit.x > TRACK_W / 2 + 0.25) return null;
    // insertion index by comparing to block centres (excluding the dragged one)
    const list = this.s.timeline.filter((x) => x !== this.drag?.id && x !== this.mouseDrag?.id);
    let m = 0, idx = list.length;
    for (let i = 0; i < list.length; i++) {
      const w = this.s.tasks[list[i]].minutes;
      const cx = -TRACK_W / 2 + (m + w / 2) * this.pxPerM();
      if (hit.x < cx) { idx = i; break; }
      m += w;
    }
    return idx;
  }
  private markerAt(idx: number | null): void {
    this.marker.visible = idx !== null; if (idx === null) return;
    const list = this.s.timeline.filter((x) => x !== this.drag?.id && x !== this.mouseDrag?.id);
    let m = 0; for (let i = 0; i < idx; i++) m += this.s.tasks[list[i]].minutes;
    this.marker.position.set(-TRACK_W / 2 + m * this.pxPerM(), 0, 0.012);
  }
  private release(id: string, p: Vector3, lateralSpeed: number, moved: number, held: number): void {
    this.marker.visible = false;
    if (moved < 0.025 && held < 0.5) { this.openDetail(this.detailId === id ? '' : id); return; }
    const idx = this.wallSlot(p);
    const s = this.s;
    const strip = (arr: string[]) => arr.filter((x) => x !== id);
    if (idx !== null) {
      s.stack = strip(s.stack); s.tomorrow = strip(s.tomorrow); s.skipped = strip(s.skipped);
      const list = strip(s.timeline); list.splice(idx, 0, id); s.timeline = list;
      sfx.drop();
    } else if (Math.abs(lateralSpeed) > SWIPE_SPEED) {
      s.stack = strip(s.stack); s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow);
      s.skipped.push(id); sfx.skip();
    } else if (this.placeOf(id) !== 'stack' && p.distanceTo(this.desk.position) < 0.35) {
      s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow); s.stack.push(id); sfx.drop();
    }
    this.commit();
  }
  private commit(): void {
    save(this.s); this.syncItems(); this.redrawAll();
    if (!this.pending && this.needsAgent()) this.agentTimer = 1.6; // agent notices overload by itself
  }
  private needsAgent(): boolean {
    const c = this.planner.nextChange(this.s);
    return !!c && !this.declined.has(c.summary);
  }

  // ---------------------------------------------------------------- agent
  private runAgent(manual = false): void {
    if (manual) this.declined.clear();
    const c = this.planner.nextChange(this.s);
    if (!c || this.declined.has(c.summary)) {
      this.pending = null;
      const tot = scheduledMinutes(this.s);
      this.agentMsg = tot ? `Plan fits: ${dur(tot)} of ${dur(this.s.availableMinutes)} free. Nice and calm.` : 'Drag a few cards onto the timeline first.';
      this.redrawAgent(); return;
    }
    this.pending = c; this.s = clone(c.after); this.agentMsg = c.summary;
    sfx.agent(); save(this.s); this.syncItems(); this.redrawAll();
  }
  private decide(ok: boolean): void {
    if (!this.pending) return;
    if (ok) { sfx.yes(); this.pending = null; this.agentTimer = 0.9; }
    else { sfx.no(); this.declined.add(this.pending.summary); this.s = clone(this.pending.before); this.pending = null; this.agentMsg = 'Undone. Your call.'; save(this.s); this.syncItems(); }
    this.redrawAll();
  }

  // ---------------------------------------------------------------- streak, tutorial, details
  private buildPlant(): void {
    const pot = new Mesh(new CylinderGeometry(0.03, 0.022, 0.045, 20), new MeshStandardMaterial({ color: C.clay, roughness: 0.9 }));
    pot.position.y = 0.0225; this.plant.add(pot);
    this.plant.position.set(0.24, 0, 0.02); this.desk.add(this.plant);
  }
  private growPlant(): void {
    while (this.plant.children.length > 1) this.plant.remove(this.plant.children[1]);
    const n = Math.min(this.s.streak, 10);
    const stemH = 0.02 + n * 0.008;
    const stem = new Mesh(new CylinderGeometry(0.002, 0.003, stemH, 6), new MeshStandardMaterial({ color: C.sageDeep }));
    stem.position.y = 0.045 + stemH / 2; this.plant.add(stem);
    for (let i = 0; i < n + 1; i++) {
      const leaf = new Mesh(new SphereGeometry(0.012, 10, 8), new MeshStandardMaterial({ color: i === n ? '#b8d8a8' : C.sage, roughness: 0.8 }));
      const a = i * 2.4, y = 0.05 + (i / (n + 1)) * stemH;
      leaf.scale.set(1.3, 0.45, 0.8); leaf.position.set(Math.cos(a) * 0.014, y, Math.sin(a) * 0.014); leaf.rotation.y = -a;
      this.plant.add(leaf);
    }
    this.plantGrow = 0;
    this.streakLabel.draw((g, W, H) => { panel(g, W, H, C.paper); text(g, `🌱 ${this.s.streak}-day streak`, W / 2, H / 2, 18, C.sageDeep, 600, W, 'center'); });
  }
  private finishDay(): void {
    completeDay(this.s); save(this.s); this.growPlant(); sfx.yes();
    this.agentMsg = `Ritual done. ${this.s.streak}-day streak, your plant grew. See you tomorrow.`; this.redrawAgent();
  }
  private openDetail(id: string): void {
    this.detailId = id; this.detail.mesh.visible = !!id; if (!id) return;
    const t = this.s.tasks[id]; sfx.pick();
    const place = this.placeOf(id);
    this.detail.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.prio[t.priority]);
      text(g, t.title, 36, 34, 24, C.ink, 700, W - 60);
      text(g, `${dur(t.minutes)} · ${['', 'must do', 'should do', 'nice to have'][t.priority]}${place === 'timeline' ? ` · starts ${fmt(this.s.dayStart + this.slotStart(id))}` : ''}`, 36, 72, 17, C.sageDeep, 600, W - 60);
      para(g, t.note, 36, 98, 18, W - 70);
      text(g, 'pinch / click to close', W - 24, H - 22, 13, C.mute, 400, W, 'right');
    });
  }
  private startTutorial(): void { this.tutorialT = 0; this.tutorial.mesh.visible = true; this.s.tutorialSeen = true; save(this.s); }
  private tutorialStep(): void {
    const steps = [
      '👋 Hands only. Pinch a card on your desk to pick it up.',
      '📌 Move it up toward the wall timeline and open your fingers to drop.',
      '💨 Flick a card sideways to skip it for today.',
      '👆 A quick pinch on a card opens its details.',
      '✨ The planner fixes overload by itself. 👍 keeps, 👎 undoes each change.',
    ];
    const i = Math.min(4, Math.floor(this.tutorialT / 6));
    const left = Math.max(0, 30 - Math.floor(this.tutorialT));
    this.tutorial.draw((g, W, H) => {
      panel(g, W, H, C.sageDeep, undefined, 0.92);
      para(g, steps[i], 26, 22, 21, W - 52, '#fff');
      text(g, `${i + 1}/5 · ${left}s`, W - 22, H - 18, 14, '#dfe9e0', 500, W, 'right');
    });
  }
  private reset(demo: boolean): void {
    for (const it of this.items.values()) it.entity.dispose();
    this.items.clear(); this.pending = null; this.declined.clear(); this.detailId = ''; this.detail.mesh.visible = false;
    this.s = demo ? demoState() : load(); this.agentMsg = demo ? 'Demo loaded. Watch the planner…' : '';
    save(this.s); this.syncItems(); this.redrawAll(); if (demo) this.agentTimer = 2.0;
  }

  // ---------------------------------------------------------------- drawing
  private redrawAll(): void { this.redrawHeader(); this.redrawAgent(); this.growPlant(); }
  private redrawHeader(): void {
    const tot = scheduledMinutes(this.s), av = this.s.availableMinutes, over = tot > av;
    this.header.draw((g, W, H) => {
      panel(g, W, H, C.paper, over ? C.warn : C.sage);
      text(g, `Today  ${fmt(this.s.dayStart)}–${fmt(this.s.dayStart + av)}`, 34, H * 0.34, 26, C.ink, 700);
      text(g, this.wallMode === 'detected' ? '📍 pinned to your wall' : '📍 no wall found: timeline placed 1.2 m ahead', 34, H * 0.74, 17, C.mute, 500, W * 0.55);
      text(g, over ? `⚠ ${dur(tot)} planned / ${dur(av)} free` : `${dur(tot)} / ${dur(av)}`, W - 30, H / 2, 24, over ? '#b9772e' : C.sageDeep, 700, W, 'right');
    });
  }
  private redrawAgent(): void {
    const show = !!this.pending;
    this.yesBtn.label.mesh.visible = this.noBtn.label.mesh.visible = show;
    this.agentPanel.draw((g, W, H) => {
      panel(g, W, H, '#ffffff', C.sky, 0.92);
      text(g, show ? '✨ Planner changed your day' : '✨ Planner', 34, 26, 18, C.sageDeep, 700);
      para(g, this.agentMsg || 'Watching your plan for overload and blocks over 90 minutes.', 34, 46, 18, W - 60);
    });
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- desktop mouse (emulator / flat view)
  private hookDom(): void {
    const el = this.world.renderer.domElement;
    const ndc = (e: PointerEvent) => new Vector2((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1);
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.world.visibilityState.value !== VisibilityState.NonImmersive) return;
      const id = this.pickAt(ndc(e), true);
      if (id?.startsWith('btn:')) { this.lastDomPress = performance.now(); this.buttons.get(Number(id.slice(4)))?.action(); return; }
      if (!id) return;
      const mesh = this.items.get(id)!.label.mesh;
      this.mouseDrag = { id, depth: mesh.position.distanceTo(this.world.camera.position) };
      const p = mesh.position.clone();
      this.drag = { id, t0: performance.now(), p0: p, hist: [{ t: performance.now(), p }] }; sfx.pick();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.mouseDrag || !this.drag) return;
      const cam = this.world.camera; const dir = new Vector3(ndc(e).x, ndc(e).y, 0.5).unproject(cam).sub(cam.position).normalize();
      const p = cam.position.clone().addScaledVector(dir, Math.min(this.mouseDrag.depth, 0.6));
      this.items.get(this.mouseDrag.id)!.label.mesh.position.copy(p);
      this.drag.hist.push({ t: performance.now(), p }); if (this.drag.hist.length > 8) this.drag.hist.shift();
      this.markerAt(this.wallSlot(p));
    }, { capture: true });
    window.addEventListener('pointerup', () => { if (this.mouseDrag) { this.endDrag(); this.mouseDrag = null; } });
    const bind = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
    bind('btn-enter', () => this.world.launchXR());
    bind('btn-plan', () => this.runAgent(true));
    bind('btn-done', () => this.finishDay());
    bind('btn-tutorial', () => this.startTutorial());
    bind('btn-demo', () => this.reset(true));
  }
  /** Screen-space pick (robust in the flat view): nearest item whose projected rectangle contains the pointer. */
  private pickAt(n: Vector2, withButtons = false): string | undefined {
    const cam = this.world.camera; cam.updateMatrixWorld();
    let best: string | undefined, bestD = Infinity;
    const cands: { id: string; label: Label }[] = [...this.items.values()];
    if (withButtons) for (const [k, b] of this.buttons) cands.push({ id: `btn:${k}`, label: b.label });
    for (const it of cands) {
      const m = it.label.mesh; if (!m.visible || !this.visibleInTree(m)) continue;
      m.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const v = new Vector3(cx * it.label.w / 2, cy * it.label.h / 2, 0).applyMatrix4(m.matrixWorld).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) {
        const d = m.position.distanceTo(cam.position); if (d < bestD) { bestD = d; best = it.id; }
      }
    }
    return best;
  }
  private visibleInTree(o: { visible: boolean; parent: unknown }): boolean {
    let x: { visible: boolean; parent: unknown } | null = o;
    while (x) { if (!x.visible) return false; x = x.parent as typeof x; }
    return true;
  }
  private endDrag(): void {
    const d = this.drag; if (!d) return; this.drag = null;
    const it = this.items.get(d.id); if (!it) return;
    const p = it.label.mesh.position.clone();
    const a = d.hist[0], b = d.hist[d.hist.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.desk.quaternion);
    const lateral = b.p.clone().sub(a.p).dot(right) / dt;
    this.release(d.id, p, (performance.now() - b.t) > 120 ? 0 : lateral, p.distanceTo(d.p0), (performance.now() - d.t0) / 1000);
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    if (!this.placed) this.place();
    const out = this.tmp2, outQ = new Quaternion();
    const k = 1 - Math.exp(-delta * 9);
    for (const it of this.items.values()) {
      const grabbed = it.entity.hasComponent(Grabbed);
      // hand grab lifecycle
      if (grabbed && !this.drag) { const p = it.label.mesh.position.clone(); this.drag = { id: it.id, t0: performance.now(), p0: p, hist: [{ t: performance.now(), p }] }; sfx.pick(); }
      if (this.drag?.id === it.id && !this.mouseDrag) {
        if (grabbed) {
          const p = it.label.mesh.position.clone();
          this.drag.hist.push({ t: performance.now(), p }); if (this.drag.hist.length > 8) this.drag.hist.shift();
          this.markerAt(this.wallSlot(p)); continue;
        }
        this.endDrag();
      }
      if (this.mouseDrag?.id === it.id) continue;
      const tgt = this.target(it, out, outQ);
      const place = this.placeOf(it.id);
      this.drawItem(it, place, tgt.w, tgt.h);
      it.label.mesh.visible = tgt.visible;
      it.label.mesh.position.lerp(out, k);
      it.label.mesh.quaternion.slerp(outQ, k);
    }
    // agent acts on its own after a short beat
    if (this.agentTimer > 0) { this.agentTimer -= delta; if (this.agentTimer <= 0 && !this.pending) this.runAgent(); }
    // tutorial
    if (this.tutorialT >= 0) {
      const before = Math.floor(this.tutorialT); this.tutorialT += delta;
      if (Math.floor(this.tutorialT) !== before) this.tutorialStep();
      if (this.tutorialT > 30) { this.tutorialT = -1; this.tutorial.mesh.visible = false; }
    }
    // plant breathes / grows in
    this.plantGrow = Math.min(1, this.plantGrow + delta * 1.5);
    const sc = 0.6 + 0.4 * this.plantGrow + Math.sin(performance.now() / 1400) * 0.015;
    this.plant.scale.setScalar(sc);
    // the level root marks children matrixAutoUpdate=false; our objects move every frame, so keep them live
    const live = (o: { matrixAutoUpdate: boolean; children: unknown[] }) => { o.matrixAutoUpdate = true; for (const c of o.children) live(c as typeof o); };
    live(this.desk); live(this.wall); for (const it of this.items.values()) it.label.mesh.matrixAutoUpdate = true;
  }
}
