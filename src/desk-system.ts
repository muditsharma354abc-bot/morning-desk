import {
  Color, createSystem, CylinderGeometry, Entity, Grabbed, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  Hovered, OneHandGrabbable, Pressed, Quaternion, RayInteractable, SphereGeometry, Vector2, Vector3,
  VisibilityState, XRAnchor, XRPlane,
} from '@iwsdk/core';
import { Label, panel, para, text } from './label.js';
import { PlanChange, RulePlanner } from './planner.js';
import { C, sfx, unlockAudio } from './style.js';
import { clearStorage, clone, completeDay, demoState, dur, fmt, load, PlanState, save, scheduledMinutes } from './state.js';

// ---- layout constants (metres). Seated, ~0.6 m reach, key UI within ~30° of gaze centre.
const DESK_FWD = 0.4, DESK_DOWN = 0.26;      // card spread in easy reach
const WALL_FWD = 1.1;                         // fallback timeline distance, eye height
const TRACK_W = 0.96, TRACK_H = 0.13;         // ~0.96 m at 1.1 m ≈ ±24°
const CARD_W = 0.16, CARD_H = 0.09;
/** Small icon for icon-only (short) timeline blocks. */
function iconFor(title: string): string {
  const m: [RegExp, string][] = [[/standup|call|meet/i, '💬'], [/review|design/i, '🎨'], [/report|deep|write|blog|draft/i, '✍️'], [/gym|walk|run/i, '🏃'], [/inbox|mail/i, '📥'], [/plant|water/i, '🪴'], [/read/i, '📖'], [/plan|sprint/i, '🗂️'], [/electric|fix/i, '🔧']];
  return m.find(([r]) => r.test(title))?.[1] ?? '•';
}
const SWIPE_SPEED = 0.6;                      // m/s lateral flick = skip

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
  private tip!: Label; private tipId = '';
  private hoverId = '';
  private thumb = { dir: 0, t: 0 };
  private restoreWall: number[] | null = null; private wallSaved = false;
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
  private restored = false;
  private placeDelay = 0;
  private tutStep = -1;
  private placed = false;
  private drag: { id: string; t0: number; p0: Vector3; hist: { t: number; p: Vector3 }[] } | null = null;
  private mouseDrag: { id: string; depth: number } | null = null;
  private tmp = new Vector3(); private tmp2 = new Vector3(); private q = new Quaternion();
  private detailId = '';
  private plantGrow = 0;
  private lastDomPress = 0;

  init(): void {
    this.s = load();
    if (import.meta.env.DEV) (window as unknown as { __mdTest: unknown }).__mdTest = this; // dev-server test hook only
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
    this.streakLabel = new Label(0.2, 0.034);
    this.streakLabel.mesh.position.set(0.25, 0.012, 0.115); this.streakLabel.mesh.rotation.x = -1.0; // tag lying in front of the pot this.desk.add(this.streakLabel.mesh);

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
    this.tip = new Label(0.3, 0.05); this.tip.mesh.visible = false; this.wall.add(this.tip.mesh);
    this.agentPanel = new Label(0.62, 0.11);
    this.agentPanel.mesh.position.set(-0.12, -0.25, 0.01); this.wall.add(this.agentPanel.mesh);
    this.yesBtn = this.button('👍 Keep', 0.13, () => this.decide(true), this.wallE);
    this.noBtn = this.button('👎 Undo', 0.13, () => this.decide(false), this.wallE);
    this.yesBtn.label.mesh.position.set(0.3, -0.22, 0.01); this.noBtn.label.mesh.position.set(0.3, -0.28, 0.01);

    // Desk buttons (reachable row at the back of the desk).
    const row: [string, () => void][] = [
      ['✨ Plan for me', () => this.runAgent(true)], ['✓ Done', () => this.finishDay()],
      ['? Tutorial', () => this.startTutorial()], ['↺ Demo reset', () => this.reset(true)],
    ];
    row.forEach(([t, fn], i) => {
      const b = this.button(t, 0.125, fn, this.deskE);
      b.label.mesh.position.set(-0.24 + i * 0.135, 0.035, -0.17); b.label.mesh.rotation.x = -0.5;
    });

    this.detail = new Label(0.3, 0.16); this.detail.mesh.visible = false;
    const de = this.world.createTransformEntity(this.detail.mesh, this.deskE);
    de.addComponent(RayInteractable);
    this.buttons.set(de.index, { label: this.detail, entity: de, action: () => this.openDetail('') });
    this.detail.mesh.position.set(-0.02, 0.05, 0.1); this.detail.mesh.rotation.x = -0.75;

    this.tutorial = new Label(0.62, 0.1); this.tutorial.mesh.visible = false;
    const te = this.world.createTransformEntity(this.tutorial.mesh, this.wallE); te.addComponent(RayInteractable);
    this.buttons.set(te.index, { label: this.tutorial, entity: te, action: () => this.endTutorial() });
    this.tutorial.mesh.position.set(0, 0.29, 0.01);

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
      this.placeDelay = this.inXR() ? 0.6 : 0;
      if (this.inXR()) unlockAudio();
      for (const id of ['hud', 'hint']) { const el = document.getElementById(id); if (el) el.style.display = this.inXR() ? 'none' : ''; }
    }));
    this.hookDom();
    this.syncItems();
    this.redrawAll();
    if (!this.s.tutorialSeen) setTimeout(() => this.startTutorial(), 1200);
    if (new URLSearchParams(location.search).has('demo')) this.agentMsg = 'Demo loaded: 6h 45m planned for 6h free. Tap "Plan for me".';
  }

  // ---------------------------------------------------------------- placement
  private setBackground(flat: boolean): void {
    // Passthrough in MR: transparent background. In the flat browser view, a calm dawn tint.
    this.world.scene.background = flat ? new Color('#cfd8d2') : null;
  }
  private place(): void {
    // in XR the rendered head is the XR camera; the flat camera's pose is stale there
    const cam = this.inXR() ? this.world.renderer.xr.getCamera() : this.world.camera; cam.updateWorldMatrix(true, false);
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
    // IWSDK keeps one persistent anchor (UUID in localStorage) and restores it next session.
    // We store the wall's pose relative to it, so the timeline comes back on the same wall.
    const kept = this.inXR() ? localStorage.getItem('morning-desk.wallAnchor') : null;
    if (kept && this.wallMode !== 'detected') {
      this.restoreWall = JSON.parse(kept) as number[]; this.wallMode = 'detected'; this.restored = true;
      if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor);
    }
    for (const pe of this.queries.planes.entities) this.tryWall(pe);
    this.placed = true; this.redrawHeader();
  }
  /** Pin the timeline onto a detected vertical plane in front of the user, then anchor it. */
  private tryWall(e: Entity): void {
    if (this.wallMode === 'detected') return;
    const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
    const o = e.object3D; if (!o || plane?.orientation !== 'vertical') return;
    const cam = this.headCam();
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const p = new Vector3().setFromMatrixPosition(o.matrixWorld);
    const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
    const d = p.distanceTo(head);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
    // seated: only walls within comfortable view distance; farther walls fall back to 1.1 m ahead
    if (d < 0.5 || d > 1.7 || fwd.dot(p.clone().sub(head).normalize()) < 0.7) return;
    if (n.dot(head.clone().sub(p)) < 0) n.negate();
    // project the user's gaze point onto the wall, at eye height
    const t = n.dot(p.clone().sub(head)) / Math.min(-0.2, n.dot(fwd));
    const hit = head.clone().addScaledVector(fwd, Math.abs(t)); hit.y = head.y;
    this.wall.position.copy(hit).addScaledVector(n, 0.03);
    this.wall.rotation.set(0, Math.atan2(n.x, n.z), 0);
    this.wallMode = 'detected';
    if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor); // world-locked to the real wall
    this.wallSaved = false; // save pose relative to IWSDK's persistent anchor once attached
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- items
  private button(t: string, w: number, action: () => void, parent: Entity): Btn {
    const label = new Label(w, 0.042);
    label.draw((g, W, H) => {
      panel(g, W, H, C.sageDeep, undefined, 1);
      let size = 22; g.font = `600 ${size}px system-ui`; while (g.measureText(t).width > W - 20 && size > 12) { size--; g.font = `600 ${size}px system-ui`; }
      text(g, t, W / 2, H / 2, size, '#fff', 600, W, 'center');
    });
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
      entity.addComponent(RayInteractable);
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
  private headCam() { return this.inXR() ? this.world.renderer.xr.getCamera() : this.world.camera; }
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
      out.set(-TRACK_W / 2 + 0.1 + i * 0.17, -0.37, 0.006); this.wall.localToWorld(out); outQ.copy(this.wall.quaternion);
      return { w: 0.16, h: 0.045, visible: true };
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
        const lines = this.wrap(g, t.title, W - 44, 18, 2);
        lines.forEach((ln, i) => text(g, ln, 30, H * (lines.length > 1 ? 0.24 + i * 0.25 : 0.36), 18, C.ink, 600, W - 40));
        text(g, `${dur(t.minutes)} · ${['', 'must', 'should', 'nice'][t.priority]}`, 30, H * 0.8, 15, C.mute, 500, W - 40);
      } else if (place === 'timeline') {
        panel(g, W, H, over ? C.warn : C.prio[t.priority], undefined, 0.95);
        if (W < 120) {
          // narrow block: no clipped words, just a glyph + duration (full title shows on hover)
          text(g, iconFor(t.title), W / 2, H * 0.38, Math.min(30, W * 0.6), C.ink, 400, W, 'center');
          text(g, dur(t.minutes), W / 2, H * 0.7, 13, C.ink, 500, W - 6, 'center');
        } else {
          const lines = this.wrap(g, t.title, W - 18, 16, 2);
          lines.forEach((ln, i) => text(g, ln, 10, H * (lines.length > 1 ? 0.24 + i * 0.24 : 0.32), 16, C.ink, 600, W - 16));
          text(g, `${fmt(this.s.dayStart + this.slotStart(it.id))} · ${dur(t.minutes)}`, 10, H * 0.78, 14, C.ink, 400, W - 16);
        }
      } else {
        panel(g, W, H, '#fbf8f1', C.prio[t.priority], 1);
        text(g, `→ ${t.title}`, 24, H / 2, 15, C.ink, 600, W - 30);
      }
    });
  }
  /** Word-wrap to at most `max` lines (last line ellipsised by text()). */
  private wrap(g: CanvasRenderingContext2D, s: string, maxW: number, size: number, max: number): string[] {
    g.font = `600 ${size}px system-ui, sans-serif`;
    const out: string[] = []; let line = '';
    for (const w of s.split(' ')) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > maxW && line && out.length < max - 1) { out.push(line); line = w; } else line = t;
    }
    out.push(line); return out;
  }
  private slotStart(id: string): number {
    let m = 0; for (const x of this.s.timeline) { if (x === id) return m; m += this.s.tasks[x].minutes; } return 0;
  }

  // ---------------------------------------------------------------- drop logic (shared by hands + mouse)
  /** Where would a card released at world point p land on the wall? (head→card ray, so seated users can "aim" it). */
  private wallSlot(p: Vector3): number | null {
    const cam = this.headCam(); const head = this.tmp.setFromMatrixPosition(cam.matrixWorld);
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
    if (moved < 0.025 && held < 0.5) { this.openDetail(this.detailId === id ? '' : id); if (this.detailId) this.tutEvent('detail'); return; }
    const idx = this.wallSlot(p);
    const s = this.s;
    const strip = (arr: string[]) => arr.filter((x) => x !== id);
    if (idx !== null) {
      s.stack = strip(s.stack); s.tomorrow = strip(s.tomorrow); s.skipped = strip(s.skipped);
      const list = strip(s.timeline); list.splice(idx, 0, id); s.timeline = list;
      sfx.drop(); this.tutEvent('drop');
    } else if (Math.abs(lateralSpeed) > SWIPE_SPEED) {
      s.stack = strip(s.stack); s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow);
      s.skipped.push(id); sfx.skip(); this.tutEvent('skip');
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
    if (manual) { this.declined.clear(); if (this.pending) { this.redrawAgent(); return; } }
    const c = this.planner.nextChange(this.s);
    if (!c || this.declined.has(c.summary)) {
      this.pending = null;
      const tot = scheduledMinutes(this.s);
      this.agentMsg = tot ? `Plan fits: ${dur(tot)} of ${dur(this.s.availableMinutes)} free. Nice and calm.` : 'Drag a few cards onto the timeline first.';
      this.redrawAgent(); return;
    }
    this.pending = c; this.s = clone(c.after); this.agentMsg = c.summary;
    if (c.kind === 'split') sfx.split(); else sfx.agent(); save(this.s); this.syncItems(); this.redrawAll();
  }
  private decide(ok: boolean): void {
    if (!this.pending) return;
    this.tutEvent('decide');
    if (ok) { sfx.yes(); this.pending = null; this.agentTimer = 0.9; }
    else { sfx.no(); this.declined.add(this.pending.summary); this.s = clone(this.pending.before); this.pending = null; this.agentMsg = 'Undone. Your call.'; save(this.s); this.syncItems(); }
    this.redrawAll();
  }

  // ---------------------------------------------------------------- streak, tutorial, details
  private buildPlant(): void {
    const pot = new Mesh(new CylinderGeometry(0.03, 0.022, 0.045, 20), new MeshStandardMaterial({ color: C.clay, roughness: 0.9 }));
    pot.position.y = 0.0225; this.plant.add(pot);
    this.plant.position.set(0.25, 0, 0.0); this.desk.add(this.plant);
  }
  /** Plant growth stages: 0 seed · 1-2 sprout · 3-5 leafy · 6-9 bud · 10+ flower. */
  private growPlant(): void {
    while (this.plant.children.length > 1) this.plant.remove(this.plant.children[1]);
    const n = Math.min(this.s.streak, 12);
    const mat = (c: string, r = 0.8) => new MeshStandardMaterial({ color: c, roughness: r });
    const soil = new Mesh(new CylinderGeometry(0.027, 0.027, 0.004, 20), mat('#6b5544', 1)); soil.position.y = 0.045; this.plant.add(soil);
    if (n === 0) {
      const seed = new Mesh(new SphereGeometry(0.006, 10, 8), mat('#a98a62')); seed.position.y = 0.049; seed.scale.y = 0.6; this.plant.add(seed);
    } else {
      const stemH = 0.012 + n * 0.007;
      const stem = new Mesh(new CylinderGeometry(0.0018, 0.0028, stemH, 6), mat(C.sageDeep)); stem.position.y = 0.047 + stemH / 2; this.plant.add(stem);
      const leaves = n <= 2 ? 2 : Math.min(2 + n, 11);
      for (let i = 0; i < leaves; i++) {
        const leaf = new Mesh(new SphereGeometry(0.012, 12, 8), mat(i >= leaves - 2 ? '#b8d8a8' : C.sage));
        const a = i * 2.4, y = 0.05 + ((i + 1) / (leaves + 1)) * stemH, sz = n <= 2 ? 0.6 : 0.8 + 0.3 * (1 - i / leaves);
        leaf.scale.set(1.3 * sz, 0.4 * sz, 0.75 * sz); leaf.position.set(Math.cos(a) * 0.013, y, Math.sin(a) * 0.013); leaf.rotation.set(0, -a, 0.35);
        this.plant.add(leaf);
      }
      if (n >= 6) {
        const top = 0.047 + stemH;
        if (n < 10) { const bud = new Mesh(new SphereGeometry(0.007, 12, 10), mat('#e9b8a8')); bud.position.y = top + 0.004; bud.scale.y = 1.4; this.plant.add(bud); }
        else {
          for (let i = 0; i < 6; i++) {
            const pet = new Mesh(new SphereGeometry(0.007, 10, 8), mat('#f2c6b4')); const a = (i / 6) * Math.PI * 2;
            pet.scale.set(1.4, 0.35, 0.8); pet.position.set(Math.cos(a) * 0.009, top + 0.004, Math.sin(a) * 0.009); pet.rotation.y = -a; this.plant.add(pet);
          }
          const c = new Mesh(new SphereGeometry(0.004, 10, 8), mat(C.warn)); c.position.y = top + 0.006; this.plant.add(c);
        }
      }
    }
    this.plantGrow = 0;
    const stage = n === 0 ? 'seed' : n <= 2 ? 'sprout' : n <= 5 ? 'leafy' : n <= 9 ? 'budding' : 'in bloom';
    this.streakLabel.draw((g, W, H) => { panel(g, W, H, C.paper); text(g, `🌱 ${this.s.streak}-day streak · ${stage}`, W / 2, H / 2, 15, C.sageDeep, 600, W - 10, 'center'); });
  }
  private finishDay(): void {
    completeDay(this.s); save(this.s); this.growPlant(); sfx.done();
    this.agentMsg = `Ritual done. ${this.s.streak}-day streak, your plant grew. See you tomorrow.`; this.redrawAgent();
  }
  private openDetail(id: string): void {
    this.detailId = id; if (!id) return; this.detail.mesh.visible = true; this.detail.mesh.scale.setScalar(0.85);
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
  // Tutorial advances only when the user actually performs each gesture.
  private static TUT = [
    { on: 'pick', msg: '👋 Pinch a card on your desk to pick it up.' },
    { on: 'drop', msg: '📌 Move it toward this timeline and open your fingers to drop it.' },
    { on: 'skip', msg: '💨 Now flick a card quickly sideways to skip it for today.' },
    { on: 'detail', msg: '👆 Quick pinch (tap) on a card to open its details.' },
    { on: 'decide', msg: '✨ Tap "Plan for me", then 👍 keep or 👎 undo the change.' },
  ];
  private startTutorial(): void { this.tutStep = 0; this.tutorial.mesh.visible = true; this.tutorial.mesh.scale.setScalar(0.9); this.s.tutorialSeen = true; save(this.s); this.tutorialStep(); }
  private endTutorial(): void { this.tutStep = -1; this.tutorial.mesh.visible = false; }
  private tutEvent(ev: string): void {
    if (this.tutStep < 0 || MorningDeskSystem.TUT[this.tutStep].on !== ev) return;
    this.tutStep++; sfx.yes();
    if (this.tutStep >= MorningDeskSystem.TUT.length) {
      this.tutorial.draw((g, W, H) => { panel(g, W, H, C.sageDeep, undefined, 1); text(g, '🌿 You\'re ready. Plan your morning!', W / 2, H / 2, 24, '#fff', 600, W - 30, 'center'); });
      setTimeout(() => this.endTutorial(), 2500); this.tutStep = 99; return;
    }
    this.tutorialStep();
  }
  private tutorialStep(): void {
    const i = this.tutStep; const st = MorningDeskSystem.TUT[i]; if (!st) return;
    this.tutorial.draw((g, W, H) => {
      panel(g, W, H, C.sageDeep, undefined, 1);
      para(g, st.msg, 26, 18, 22, W - 60, '#fff');
      text(g, `${i + 1}/5 · tap here to skip`, W - 22, H - 16, 14, '#e6efe7', 500, W, 'right');
    });
  }
  private reset(demo: boolean): void {
    for (const it of this.items.values()) it.entity.dispose();
    this.items.clear(); this.pending = null; this.declined.clear(); this.detailId = ''; this.detail.mesh.visible = false;
    this.agentTimer = 0; this.thumb = { dir: 0, t: 0 }; this.endTutorial(); this.hoverId = ''; this.updateTip('');
    if (demo) { clearStorage(); }
    this.s = demo ? demoState() : load();
    this.agentMsg = demo ? 'Demo loaded: 6h 45m planned for 6h free. Tap "Plan for me".' : '';
    save(this.s); this.syncItems(); this.redrawAll();
  }

  // ---------------------------------------------------------------- drawing
  private redrawAll(): void { this.redrawHeader(); this.redrawAgent(); this.growPlant(); }
  private redrawHeader(): void {
    const tot = scheduledMinutes(this.s), av = this.s.availableMinutes, over = tot > av;
    this.header.draw((g, W, H) => {
      panel(g, W, H, C.paper, over ? C.warn : C.sage);
      text(g, `Today  ${fmt(this.s.dayStart)}–${fmt(this.s.dayStart + av)}`, 34, H * 0.34, 26, C.ink, 700);
      text(g, this.wallMode === 'detected' ? (this.restored ? '📍 restored on your wall' : '📍 pinned to your wall') : '📍 no wall found: timeline placed 1.2 m ahead', 34, H * 0.74, 17, C.mute, 500, W * 0.55);
      text(g, over ? `⚠ ${dur(tot)} planned / ${dur(av)} free` : `${dur(tot)} / ${dur(av)}`, W - 30, H / 2, 24, over ? '#b9772e' : C.sageDeep, 700, W, 'right');
    });
  }
  private redrawAgent(): void {
    const show = !!this.pending;
    this.yesBtn.label.mesh.visible = this.noBtn.label.mesh.visible = show;
    this.agentPanel.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.sky, 1);
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
      this.drag = { id, t0: performance.now(), p0: p, hist: [{ t: performance.now(), p }] }; sfx.pick(); this.tutEvent('pick');
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.mouseDrag && !this.inXR()) { this.hoverId = this.pickAt(ndc(e)) ?? ''; el.style.cursor = this.hoverId ? 'grab' : ''; }
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
    const b = d.hist[d.hist.length - 1];
    const right = new Vector3(1, 0, 0).applyQuaternion(this.desk.quaternion);
    // flick = fast sideways motion at the end of the drag: peak sample speed, or >=8 cm sideways within the last 350 ms
    let lateral = 0;
    for (let i = 1; i < d.hist.length; i++) {
      const h0 = d.hist[i - 1], h1 = d.hist[i];
      if (b.t - h1.t > 200) continue;
      const v = h1.p.clone().sub(h0.p).dot(right) / Math.max(0.008, (h1.t - h0.t) / 1000);
      if (Math.abs(v) > Math.abs(lateral)) lateral = v;
    }
    const w0 = d.hist.find((h) => b.t - h.t <= 350) ?? b;
    const side = b.p.clone().sub(w0.p).dot(right);
    if (Math.abs(lateral) < SWIPE_SPEED && Math.abs(side) >= 0.08 && b.t > w0.t) lateral = side / ((b.t - w0.t) / 1000) * 2;
    this.release(d.id, p, (performance.now() - b.t) > 120 ? 0 : lateral, p.distanceTo(d.p0), (performance.now() - d.t0) / 1000);
  }

  // ---------------------------------------------------------------- polish helpers
  private updateTip(id: string): void {
    if (id === this.tipId) return;
    this.tipId = id; this.tip.mesh.visible = !!id; if (!id) return;
    const t = this.s.tasks[id]; const m = this.items.get(id)!.label.mesh;
    this.tip.draw((g, W, H) => { panel(g, W, H, C.ink, undefined, 0.88); text(g, `${t.title} · ${fmt(this.s.dayStart + this.slotStart(id))} · ${dur(t.minutes)}`, W / 2, H / 2, 17, '#fff', 600, W - 20, 'center'); });
    const local = this.wall.worldToLocal(m.position.clone());
    this.tip.mesh.position.set(Math.max(-0.4, Math.min(0.45, local.x)), 0.095, 0.03);
  }
  /** Thumbs up / down hand gesture (held ~0.4 s) answers the pending planner change. Buttons stay as fallback. */
  private detectThumbs(delta: number): void {
    const xr = this.world.renderer.xr; const frame = xr.getFrame(); const ref = xr.getReferenceSpace();
    if (!frame || !ref) return;
    let dir = 0;
    for (const src of frame.session.inputSources) {
      const hand = src.hand; if (!hand) continue;
      const P = (j: XRHandJoint) => { const sp = hand.get(j); const pose = sp && frame.getJointPose?.(sp, ref); return pose ? new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z) : null; };
      const wrist = P('wrist'), tt = P('thumb-tip'), tm = P('thumb-metacarpal'), im = P('index-finger-metacarpal');
      const tips = (['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'] as XRHandJoint[]).map(P);
      if (!wrist || !tt || !tm || !im || tips.some((x) => !x)) continue;
      const curled = tips.every((x) => x!.distanceTo(wrist) < 0.11 && x!.distanceTo(im) < 0.075);
      const thumbOut = tt.distanceTo(im) > 0.055;
      const dy = tt.y - tm.y;
      if (curled && thumbOut && Math.abs(dy) > 0.035) dir = dy > 0 ? 1 : -1;
    }
    if (dir !== 0 && dir === this.thumb.dir) { this.thumb.t += delta; if (this.thumb.t > 0.4) { this.thumb = { dir: 0, t: -1 }; this.decide(dir > 0); } }
    else if (this.thumb.t >= 0 || dir === 0) this.thumb = { dir, t: 0 };
  }
  private persistWall(): void {
    if (!this.wallE.hasComponent(XRAnchor) || !this.wallE.getValue(XRAnchor, 'attached')) return;
    if (this.restoreWall) {
      const [x, y, z, qx, qy, qz, qw] = this.restoreWall; this.restoreWall = null;
      this.wall.position.set(x, y, z); this.wall.quaternion.set(qx, qy, qz, qw); this.wallSaved = true; this.redrawHeader(); return;
    }
    if (this.wallSaved) return;
    this.wallSaved = true;
    localStorage.setItem('morning-desk.wallAnchor', JSON.stringify([...this.wall.position.toArray(), ...this.wall.quaternion.toArray()]));
  }

  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    if (this.placeDelay > 0) this.placeDelay -= delta;
    else if (!this.placed) this.place();
    const out = this.tmp2, outQ = new Quaternion();
    const k = 1 - Math.exp(-delta * 9);
    let hovTimeline = '';
    for (const it of this.items.values()) {
      const grabbed = it.entity.hasComponent(Grabbed);
      // hand grab lifecycle
      if (grabbed && !this.drag) { const p = it.label.mesh.position.clone(); this.drag = { id: it.id, t0: performance.now(), p0: p, hist: [{ t: performance.now(), p }] }; sfx.pick(); this.tutEvent('pick'); }
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
      const hov = this.hoverId === it.id || it.entity.hasComponent(Hovered);
      if (hov) out.add(this.tmp.set(0, 0, 0.018).applyQuaternion(outQ)); // lift toward the user
      it.label.mesh.position.lerp(out, k);
      it.label.mesh.quaternion.slerp(outQ, k);
      const sc = it.label.mesh.scale.x + ((hov ? 1.07 : 1) - it.label.mesh.scale.x) * k;
      it.label.mesh.scale.setScalar(sc);
      if (hov && place === 'timeline') hovTimeline = it.id;
    }
    this.updateTip(hovTimeline);
    // details card: soft scale-in
    if (this.detail.mesh.visible) { const d = this.detail.mesh.scale.x; this.detail.mesh.scale.setScalar(d + (1 - d) * k); }
    if (!this.detailId) this.detail.mesh.visible = false;
    if (this.pending && this.inXR()) this.detectThumbs(delta);
    this.persistWall();
    // agent acts on its own after a short beat
    if (this.agentTimer > 0) { this.agentTimer -= delta; if (this.agentTimer <= 0 && !this.pending) this.runAgent(); }
    // tutorial
    if (this.tutorial.mesh.visible) { const t = this.tutorial.mesh.scale.x; this.tutorial.mesh.scale.setScalar(t + (1 - t) * k); }
    // plant breathes / grows in
    this.plantGrow = Math.min(1, this.plantGrow + delta * 1.5);
    const sc = 0.6 + 0.4 * this.plantGrow + Math.sin(performance.now() / 1400) * 0.015;
    this.plant.scale.setScalar(sc);
    // the level root marks children matrixAutoUpdate=false; our objects move every frame, so keep them live
    const live = (o: { matrixAutoUpdate: boolean; children: unknown[] }) => { o.matrixAutoUpdate = true; for (const c of o.children) live(c as typeof o); };
    live(this.desk); live(this.wall); for (const it of this.items.values()) it.label.mesh.matrixAutoUpdate = true;
  }
}
