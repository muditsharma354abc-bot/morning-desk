import {
  Color, createSystem, Matrix4, CylinderGeometry, Entity, Grabbed, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  Hovered, OneHandGrabbable, PokeInteractable, Pressed, Quaternion, RayInteractable, SphereGeometry, Vector2, Vector3,
  VisibilityState, XRAnchor, XRPlane, SessionMode, PlaneGeometry, BoxGeometry,
} from '@iwsdk/core';
import { Label, panel, para, text } from './label.js';
import { PlanChange, RulePlanner } from './planner.js';
import { C, sfx, unlockAudio } from './style.js';
import { clearStorage, clone, tutorialState, completeDay, demoState, dur, fmt, IS_DEMO, layout, load, PlanState, save, scheduledMinutes } from './state.js';
import { BackSide, MeshBasicMaterial } from '@iwsdk/core';
/** Demo days run the focus timer accelerated (and say so on the panel). */
const FOCUS_ACCEL = IS_DEMO ? 120 : 1;
/** ?clean=1 video capture: hides the fallback-wall note (see clean.ts for the emulator chrome). */
const CLEAN_CAPTURE = new URLSearchParams(location.search).has('clean');
/** v2: ?mr=1 forces the MR flow in the IWER emulator (real headsets always use it, except ?demo / ?clean). */
const MR_FORCED = new URLSearchParams(location.search).has('mr') || new URLSearchParams(location.search).has('vr');
/** ?vr=1 (test): behave as if immersive-ar were unsupported → the VR-room fallback. */
/** ?noplanes=1 (test): ignore plane detection + hit-test → exercises the tap-to-place fallback. */
const NO_PLANES = new URLSearchParams(location.search).has('noplanes');
/** v2 Wind-down replaces '✓ Done' everywhere except the filmed v1 demo (?demo without ?mr). */
const WIND_DOWN = !IS_DEMO || new URLSearchParams(location.search).has('mr');
const FORCE_VR = new URLSearchParams(location.search).has('vr');
/** Seated head position used for ?mr=1 in IWER's home_office room (metres). */
const MR_SEAT: [number, number, number] = [0, 1.2, -1.45];
/** IWER devui moves the emulated head through its player rig (as Shift+WASD does); offset it to MR_SEAT. */
function seatEmulatedHead(): boolean {
  const dev = (window as unknown as { IWER_DEVICE?: object }).IWER_DEVICE; if (!dev) return false;
  for (const k of Object.getOwnPropertySymbols(dev)) {
    const rig = (dev as Record<symbol, { devui?: { inputLayer?: { playerRig?: { position: Vector3 }; combinedCameraPosition?: Vector3 } } }>)[k]?.devui?.inputLayer;
    if (rig?.playerRig && rig.combinedCameraPosition) { rig.playerRig.position.set(MR_SEAT[0], 0, MR_SEAT[2]); rig.combinedCameraPosition.set(...MR_SEAT); return true; }
  }
  return false;
}
const MR_KEY = 'morning-desk.mr.v2';               // { uuid, desk pose, wall pose } relative to IWSDK's persistent anchor
const ANCHOR_UUID_KEY = 'iwsdk_scene_anchor_uuid'; // IWSDK SceneUnderstandingSystem's persistent anchor UUID

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
  private tray = new Label(0.62, 0.3);
  private vrRoom = new Group();
  private agentPanel!: Label;
  private detail!: Label;
  private tip!: Label; private tipId = '';
  private hoverId = '';
  private thumb = { dir: 0, t: 0 };
  private restoreWall: number[] | null = null; private wallSaved = false;
  private tutorial!: Label;
  private marker!: Mesh;
  private streakLabel!: Label;
  private yesBtn!: Btn; private noBtn!: Btn;
  private pending: PlanChange | null = null;
  private declined = new Set<string>();
  private agentMsg = '';
  private agentTimer = 0;
  private justKept = false;
  private handsSet = false;
  private wallMode: 'detected' | 'fallback' = 'fallback';
  private restored = false;
  private placeDelay = 0;
  private tutStep = -1;
  private placed = false;
  private drag: { id: string; t0: number; p0: Vector3; hist: { t: number; p: Vector3 }[] } | null = null;
  private mouseDrag: { id: string; depth: number; px: { t: number; x: number; y: number }[]; maxPx: number } | null = null;
  private tmp = new Vector3(); private tmp2 = new Vector3(); private q = new Quaternion();
  private detailId = '';
  private lastDomPress = 0;
  private meetingLabels: Label[] = [];
  private deskRow: Mesh[] = [];
  // P1 spatial layout: meetings board on the left, pending board on the right, progress in the background
  private left = new Group(); private right = new Group();
  private meetBoard!: Label; private pendHeader!: Label; private progress!: Label;
  private focusPanel!: Label; private focusE!: Entity; private focusBtns: Btn[] = [];
  private dim!: Mesh;
  /** Focus Mode: one task, big, in front; timer in task minutes. */
  focus: { id: string; length: number; t0: number; base: number; phase: 'run' | 'ask'; shown: string } | null = null;
  private summary!: Label;
  private streakAnim = { t: 9, from: 0, to: 0 }; private sumDraw: ((k: number) => void) | null = null;
  /** ids of tasks a hand ray currently hovers (autoplay aims with it). */
  hoveredIds(): string[] { return [...this.items.values()].filter((x) => x.entity.hasComponent(Hovered)).map((x) => x.id); }
  noAutoAgent = false; // autoplay asks the planner explicitly

  init(): void {
    // ?tutorial=1: fresh start: wipe saved desk/card/wall state, then the sample desk loads (never in demo)
    { const tq = new URLSearchParams(location.search); if (tq.has('tutorial') && !tq.has('demo')) { clearStorage(); save(tutorialState()); } }
    this.s = load();
    if (import.meta.env.DEV) (window as unknown as { __mdTest: unknown }).__mdTest = this; // dev-server test hook only
    const scene = this.world.scene;
    scene.add(new HemisphereLight(0xfff6e8, 0x6b7a72, 1.6));
    { // VR-room fallback (devices without immersive-ar): floor + a desk-height table + a back wall, built around the desk
      const floor = new Mesh(new PlaneGeometry(6, 6), new MeshStandardMaterial({ color: '#8a7a66', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.name = 'vr-floor';
      const table = new Mesh(new BoxGeometry(1.2, 0.04, 0.6), new MeshStandardMaterial({ color: '#b48a62', roughness: 0.8 })); table.position.set(0, -0.025, -0.05);
      const back = new Mesh(new PlaneGeometry(4, 3), new MeshStandardMaterial({ color: '#d9d4c8', roughness: 1 })); back.position.set(0, 0.6, -1.0);
      this.vrRoom.add(floor, table, back); this.vrRoom.visible = false; this.desk.add(this.vrRoom);
    }
    this.deskE = this.world.createTransformEntity(this.desk, { persistent: true });
    this.wallE = this.world.createTransformEntity(this.wall, { persistent: true });
    this.setBackground(true);
    this.world.createTransformEntity(this.left, { persistent: true }); this.world.createTransformEntity(this.right, { persistent: true });
    this.meetBoard = new Label(0.4, 0.3); this.left.add(this.meetBoard.mesh);
    this.pendHeader = new Label(0.36, 0.05); this.pendHeader.mesh.position.set(0, 0.16, 0); this.right.add(this.pendHeader.mesh);
    this.pendHeader.draw((g, W, H) => { panel(g, W, H, C.paper, C.sky, 0.95); text(g, '🗂 Pending · drag to plan', 30, H / 2, 20, C.ink, 700, W - 40); });
    this.progress = new Label(0.7, 0.08); this.progress.mesh.position.set(0, 0.44, -0.25); this.wall.add(this.progress.mesh);

    // Desk surface (soft paper tray) + streak.
    const tray = this.tray;
    tray.draw((g, W, H) => panel(g, W, H, '#e9e2d3', undefined, 0.55));
    tray.mesh.rotation.x = -Math.PI / 2; tray.mesh.position.set(0, -0.005, 0);
    this.desk.add(tray.mesh);
    this.streakLabel = new Label(0.2, 0.034);
    this.streakLabel.mesh.position.set(0.27, 0.012, 0.06); this.streakLabel.mesh.rotation.x = -1.0; this.desk.add(this.streakLabel.mesh); 

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
    this.agentPanel = new Label(0.56, 0.12);
    this.agentPanel.mesh.position.set(-0.15, -0.25, 0.01); this.wall.add(this.agentPanel.mesh);
    this.yesBtn = this.button('👍 Keep', 0.13, () => this.decide(true), this.wallE);
    this.noBtn = this.button('👎 Undo', 0.13, () => this.decide(false), this.wallE);
    this.yesBtn.label.mesh.position.set(0.2, -0.22, 0.01); this.noBtn.label.mesh.position.set(0.2, -0.28, 0.01); // clear of the Pending pile

    // Desk buttons (reachable row at the back of the desk).
    const row: [string, () => void][] = [
      ['✨ Plan for me', () => this.runAgent(true)], [WIND_DOWN ? '🌙 Wind down' : '✓ Done', () => (WIND_DOWN ? this.openWindDown() : this.finishDay())],
      ['? Tutorial', () => this.startTutorial()], ['↺ Demo reset', () => this.reset(true)],
    ];
    row.forEach(([t, fn], i) => {
      const b = this.button(t, 0.125, fn, this.deskE); this.deskRow.push(b.label.mesh);
      b.label.mesh.position.set(-0.24 + i * 0.135, 0.035, -0.17); b.label.mesh.rotation.x = -0.5;
    });

    // v2 MR: tap-to-place hint + Re-place button (front-left of the desk, within reach)
    this.placeHint = new Label(0.42, 0.06); this.placeHint.mesh.visible = false; this.placeHint.mesh.position.set(0, 0.12, -0.05); this.placeHint.mesh.rotation.x = -0.35; this.desk.add(this.placeHint.mesh);
    if (!CLEAN_CAPTURE) {
      this.replaceBtn = this.button('📍 Re-place', 0.12, () => this.replace(), this.deskE);
      this.replaceBtn.label.mesh.position.set(-0.24, 0.02, 0.13); this.replaceBtn.label.mesh.rotation.x = -0.9; this.replaceBtn.label.mesh.visible = false;
    }

    this.detail = new Label(0.3, 0.16); this.detail.mesh.visible = false;
    const de = this.world.createTransformEntity(this.detail.mesh, this.deskE);
    de.addComponent(RayInteractable);
    this.buttons.set(de.index, { label: this.detail, entity: de, action: () => this.openDetail('') });
    this.detail.mesh.position.set(-0.02, 0.05, 0.1); this.detail.mesh.rotation.x = -0.75;

    // Focus Mode panel (replaces the old details card): big, in front of the head, with a timer.
    this.focusPanel = new Label(0.46, 0.27); this.focusPanel.mesh.visible = false;
    this.focusE = this.world.createTransformEntity(this.focusPanel.mesh, this.deskE);
    const fb: [string, number, number, () => void][] = [
      ['25 min', -0.165, 0.09, () => this.setFocusLength(25)], ['50 min', -0.055, 0.09, () => this.setFocusLength(50)],
      ['+15 min', 0.055, 0.09, () => this.moreTime()], ['✓ Done', 0.165, 0.09, () => this.endFocus(true)],
      ['✕ Exit', 0.19, -0.17, () => this.endFocus(false)],
    ];
    for (const [t, x, w, fn] of fb) {
      const b = this.button(t, w, fn, this.focusE); b.label.mesh.position.set(x, t === '✕ Exit' ? 0.11 : -0.105, 0.004); this.focusBtns.push(b);
    }
    this.focusBtns[4].label.resize(0.07, 0.034);
    // passthrough dimmer: a dark shell around the head while focusing
    this.dim = new Mesh(new SphereGeometry(2.5, 24, 16), new MeshBasicMaterial({ color: '#0b0f0d', transparent: true, opacity: 0, side: BackSide, depthWrite: false }));
    this.dim.renderOrder = -1; this.dim.visible = false; scene.add(this.dim);
    this.summary = new Label(0.54, 0.44); this.summary.mesh.visible = false;
    // draw the summary over desk labels behind it (the streak tag must not show through)
    (this.summary.mesh.material as MeshBasicMaterial).depthTest = false; this.summary.mesh.renderOrder = 10;
    const se = this.world.createTransformEntity(this.summary.mesh, this.deskE); se.addComponent(RayInteractable);
    this.buttons.set(se.index, { label: this.summary, entity: se, action: () => { this.summary.mesh.visible = false; } });

    this.buildWindDown();
    this.tutorial = new Label(0.62, 0.1); this.tutorial.mesh.visible = false;
    const te = this.world.createTransformEntity(this.tutorial.mesh, this.wallE); te.addComponent(RayInteractable);
    this.buttons.set(te.index, { label: this.tutorial, entity: te, action: () => this.endTutorial() });
    this.tutorial.mesh.position.set(0, 0.29, 0.01);

    this.queries.pressed.subscribe('qualify', (e) => {
      if (performance.now() - this.lastDomPress <= 400) return;
      const b = this.buttons.get(e.index); if (b) { b.action(); return; }
      // ray + pinch on a task (e.g. a timeline block out of reach) opens Focus Mode
      // flat view: the mouse handler decides click (Focus) vs drag/flick on release; a press here would open Focus mid-drag
      if (!this.inXR()) return;
      const it = [...this.items.values()].find((x) => x.entity.index === e.index); if (!it) return;
      if (this.focus?.phase === 'ask') this.moreTime(); else if (!this.focus) { this.startFocus(it.id); this.tutEvent('detail'); }
    });
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
      // ?mr=1 in IWER: sit the emulated headset at home_office's desk (seated eye height, facing the wall) so plane
      // detection / hit-test find a real table within reach. Real headsets have no IWER_DEVICE and ignore this.
      if (MR_FORCED && this.inXR() && seatEmulatedHead()) this.placeDelay = 1.0;
      if (this.inXR()) unlockAudio();
      // Focus Mode: when the timer asks "Done or more time?", any pinch adds 15 min (👍 = done)
      const ses = this.world.renderer.xr.getSession();
      if (ses && !(ses as unknown as { mdHook?: boolean }).mdHook) { (ses as unknown as { mdHook?: boolean }).mdHook = true; ses.addEventListener('selectstart', () => { if (this.mr.phase === 'tap' && this.mr.t > 0.5) { this.mr.tapped = true; return; } if (this.focus?.phase === 'ask') this.moreTime(); }); }
      // hands-first: in the desktop emulator, switch to emulated hands (the devui can switch back)
      const iwer = (window as unknown as { IWER_DEVICE?: { primaryInputMode: string } }).IWER_DEVICE;
      // (input mode left to the IWER toolbar: setting it from code desynced the devui corner panels)
      // ?hands=1: same switch autoplay uses (clicks the IWER toolbar → Hands), once per session; autoplay does its own
      const hq = new URLSearchParams(location.search);
      if (iwer && this.inXR() && hq.has('hands') && !hq.has('autoplay')) { iwer.primaryInputMode = 'hand'; this.handsOn(); }
      for (const id of ['hud', 'hint']) { const el = document.getElementById(id); if (el) el.style.display = this.inXR() ? 'none' : ''; }
    }));
    this.hookDom();
    this.syncItems();
    this.redrawAll();
    const q = new URLSearchParams(location.search);
    // first real visit (or ?tutorial=1): start the hands tutorial automatically; never in demo/autoplay
    if ((!this.s.tutorialSeen && !q.has('demo')) || q.has('tutorial')) setTimeout(() => this.startTutorial(), 1200);
    if (q.has('autoplay')) setTimeout(() => void import('./autoplay.js').then((m) => m.runAutoplay(this as never, this.world)), 1500);
    if (new URLSearchParams(location.search).has('demo')) this.agentMsg = this.demoMsg();
    if (this.s.carriedIn) { this.agentMsg = `☀️ Good morning. Your plan starts with ${this.s.carriedIn} task${this.s.carriedIn > 1 ? 's' : ''} you rolled over last night.`; delete this.s.carriedIn; save(this.s); this.redrawAgent(); }
  }

  // ---------------------------------------------------------------- placement
  private setBackground(flat: boolean): void {
    // Passthrough in MR: transparent background. In the flat browser view, a calm dawn tint.
    this.world.scene.background = flat ? new Color('#cfd8d2') : this.mr.vr ? new Color('#3a4440') : null;
    this.vrRoom.visible = !flat && !!this.mr.vr; // no passthrough on this device: a simple virtual room instead
  }
  private place(): void {
    if (this.mrFlow()) { this.mrBegin(); return; }
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
    // side boards, turned to face the seated user
    const side = (g: Group, deg: number, dist: number, dy: number) => {
      const a = yaw + (deg * Math.PI) / 180; const d = new Vector3(-Math.sin(a), 0, -Math.cos(a));
      g.position.copy(head).addScaledVector(d, dist); g.position.y = head.y + dy; g.rotation.set(0, a, 0);
    };
    side(this.left, 37, 0.9, -0.04); side(this.right, -31, 0.82, -0.17); // below the timeline, right of the desk // inside a ~16:9 capture FoV
    for (const pe of this.queries.planes.entities) this.tryWall(pe);
    this.placed = true; this.redrawHeader();
  }
  /** Pin the timeline onto a detected vertical plane in front of the user, then anchor it. */
  private tryWall(e: Entity, force = false): void {
    if (this.wallMode === 'detected') return;
    if (this.mrFlow() && !force) return; // v2 MR flow places the wall itself (after the desk)
    const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
    const o = e.object3D; if (!o || plane?.orientation !== 'vertical') return;
    const cam = this.headCam();
    const head = force && this.mr.head ? this.mr.head.clone() : new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const p = new Vector3().setFromMatrixPosition(o.matrixWorld);
    const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
    const d = p.distanceTo(head);
    const fwd = force && this.mr.fwd ? this.mr.fwd.clone() : new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
    // seated: only walls within comfortable view distance; farther walls fall back to 1.1 m ahead
    if (d < 0.5 || d > 1.7 || fwd.dot(p.clone().sub(head).normalize()) < 0.7) return;
    if (n.dot(head.clone().sub(p)) < 0) n.negate();
    // project the user's gaze point onto the wall, at eye height
    const t = n.dot(p.clone().sub(head)) / Math.min(-0.2, n.dot(fwd));
    const hit = head.clone().addScaledVector(fwd, Math.abs(t)); hit.y = head.y;
    this.wall.position.copy(hit).addScaledVector(n, 0.03);
    this.wall.rotation.set(0, Math.atan2(n.x, n.z), 0);
    this.wallMode = 'detected';
    if (force) { this.redrawHeader(); return; } // MR flow anchors desk + wall together
    if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor); // world-locked to the real wall
    this.wallSaved = false; // save pose relative to IWSDK's persistent anchor once attached
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- v2: MR placement (real desk + real wall) and persistent anchors
  /** v2 MR flow: real headsets, or ?mr=1 in the emulator. Never in ?clean (the filmed v1 run keeps its layout). */
  mrFlow(): boolean {
    if (!this.inXR() || CLEAN_CAPTURE) return false;
    if (IS_DEMO && !MR_FORCED) return false;
    return MR_FORCED || !(window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE;
  }
  /** How the desk / wall were placed this session (shown on the header, read by tests/autoplay). */
  mr: { phase: 'idle' | 'restore' | 'scan' | 'hit' | 'tap' | 'anchor' | 'done'; t: number; desk: string; wall: string; head?: Vector3; fwd?: Vector3; hit?: XRHitTestSource; hitReq?: boolean; tapped?: boolean; vr?: boolean; noPlanes?: boolean } = { phase: 'idle', t: 0, desk: '', wall: '' };
  private replaceBtn?: Btn; private placeHint!: Label;
  private session(): XRSession | null { return this.world.renderer.xr.getSession(); }
  private detach(e: Entity, o: Group): void {
    if (e.hasComponent(XRAnchor)) e.removeComponent(XRAnchor);
    if (o.parent !== this.world.scene) this.world.scene.attach(o);
  }
  /** Session start: restore last session's anchored desk + wall, else scan for a real table + wall. */
  private mrBegin(): void {
    this.detach(this.deskE, this.desk); this.detach(this.wallE, this.wall);
    this.wallMode = 'fallback'; this.restored = false;
    const cam = this.headCam(); cam.updateMatrixWorld();
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.q)); fwd.y = 0; fwd.normalize();
    this.mr.head = head; this.mr.fwd = fwd;
    this.tray.mesh.visible = true; this.placeHint.mesh.visible = false;
    this.layoutAround(head, fwd); // provisional, head-relative, until a surface is found
    this.mr.noPlanes = !!this.mr.vr || NO_PLANES;
    if (this.mr.vr) { this.mr.phase = 'scan'; this.deskFound(this.desk.position.clone(), 'VR room'); this.placed = true; return; }
    const saved = localStorage.getItem(MR_KEY);
    this.mr = { ...this.mr, phase: saved && !this.mr.vr ? 'restore' : 'scan', t: 0, desk: '', wall: '', tapped: false };
    if (this.mr.phase === 'restore') { this.deskE.addComponent(XRAnchor); this.wallE.addComponent(XRAnchor); }
    this.placed = true; this.redrawHeader();
  }
  private layoutAround(head: Vector3, fwd: Vector3): void {
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.desk.position.copy(head).addScaledVector(fwd, DESK_FWD); this.desk.position.y -= DESK_DOWN;
    this.desk.rotation.set(0, yaw, 0);
    this.wall.position.copy(head).addScaledVector(fwd, WALL_FWD); this.wall.position.y = head.y + 0.02; this.wall.rotation.set(0, yaw, 0);
    this.layoutSides(head, yaw);
  }
  private layoutSides(head: Vector3, yaw: number): void {
    const side = (g: Group, deg: number, dist: number, dy: number) => {
      const a = yaw + (deg * Math.PI) / 180; const d = new Vector3(-Math.sin(a), 0, -Math.cos(a));
      g.position.copy(head).addScaledVector(d, dist); g.position.y = head.y + dy; g.rotation.set(0, a, 0);
    };
    side(this.left, 37, 0.9, -0.04); side(this.right, -31, 0.82, -0.17);
  }
  /** Nearest detected table-height horizontal plane in front of the head: the desk centre just inside its near edge. */
  private findTable(): Vector3 | null {
    if (this.mr.noPlanes) return null;
    const head = this.mr.head!, fwd = this.mr.fwd!; let best: Vector3 | null = null; let bestD = 1e9;
    for (const e of this.queries.planes.entities) {
      const pl = e.getValue(XRPlane, '_plane') as { orientation?: string; polygon?: DOMPointReadOnly[] } | undefined;
      const o = e.object3D; if (!o || pl?.orientation !== 'horizontal' || !pl.polygon?.length) continue;
      o.updateMatrixWorld();
      const c = new Vector3().setFromMatrixPosition(o.matrixWorld);
      if (c.y < 0.5 || c.y > 1.15 || head.y - c.y < 0.15) continue; // table height, below the eyes (not floor / ceiling)
      const pts = pl.polygon.map((q) => new Vector3(q.x, 0, q.z).applyMatrix4(o.matrixWorld));
      const fl = new Vector3(head.x, c.y, head.z);
      let near = pts[0];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]; const ab = b.clone().sub(a);
        const t = Math.max(0, Math.min(1, fl.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
        const q = a.clone().addScaledVector(ab, t); if (q.distanceTo(fl) < near.distanceTo(fl)) near = q;
      }
      const inside = this.inPoly(fl, pts);
      const d = inside ? 0 : near.distanceTo(fl);
      const dir = c.clone().sub(fl); dir.y = 0;
      if (d > 0.9 || dir.lengthSq() < 1e-6 || dir.normalize().dot(fwd) < 0.3) continue;
      // desk centre: ~DESK_FWD (40 cm) ahead of the user, but never outside the surface's near edge
      const at = inside ? fl.clone().addScaledVector(fwd, DESK_FWD) : near.clone().addScaledVector(dir, 0.18); at.y = c.y + 0.004;
      if (d < bestD) { bestD = d; best = at; }
    }
    return best;
  }
  private inPoly(p: Vector3, pts: Vector3[]): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  /** Fallback 2: hit-test a ray from the head, ~30° down, for a table-height surface within reach. */
  private hitTestTable(): Vector3 | null {
    if (this.mr.noPlanes) return null;
    const ses = this.session(); const frame = this.world.renderer.xr.getFrame(); const ref = this.world.renderer.xr.getReferenceSpace();
    if (!ses || !frame || !ref) return null;
    if (!this.mr.hitReq) {
      this.mr.hitReq = true;
      void ses.requestReferenceSpace('viewer').then((viewer) => ses.requestHitTestSource?.({ space: viewer, offsetRay: new XRRay({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.58, z: -1 }) }))
        .then((src) => { if (src) this.mr.hit = src; }).catch(() => { /* no hit-test here → tap to place */ });
      return null;
    }
    if (!this.mr.hit) return null;
    for (const r of frame.getHitTestResults(this.mr.hit)) {
      const pose = r.getPose(ref); if (!pose) continue;
      const p = new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      const h = this.mr.head!; const flat = Math.hypot(p.x - h.x, p.z - h.z);
      if (p.y > 0.5 && p.y < 1.15 && flat < 0.75) { p.y += 0.004; return p; }
    }
    return null;
  }
  private deskFound(at: Vector3, how: string): void {
    const head = this.mr.head!, fwd = this.mr.fwd!; const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.desk.position.copy(at); this.desk.rotation.set(0, yaw, 0);
    this.mr.desk = how; this.placeHint.mesh.visible = false;
    // passthrough matters: on a real surface the paper tray goes away and the cards lie on the real desk
    this.tray.mesh.visible = how === 'tap' || !!this.mr.vr;
    if (!this.mr.noPlanes) for (const pe of this.queries.planes.entities) this.tryWall(pe, true);
    if (this.wallMode !== 'detected') { this.wall.position.copy(head).addScaledVector(fwd, WALL_FWD); this.wall.position.y = head.y + 0.02; this.wall.rotation.set(0, yaw, 0); }
    this.mr.wall = this.wallMode === 'detected' ? 'wall plane' : `${WALL_FWD} m ahead`;
    this.layoutSides(head, yaw);
    if (this.mr.vr) { const f = this.vrRoom.getObjectByName('vr-floor'); if (f) f.position.y = -this.desk.position.y; this.mr.phase = 'done'; this.redrawHeader(); return; }
    this.deskE.addComponent(XRAnchor); this.wallE.addComponent(XRAnchor);
    this.mr.phase = 'anchor'; this.mr.t = 0; this.redrawHeader();
  }
  private poseOf(o: Group): number[] { return [...o.position.toArray(), ...o.quaternion.toArray()]; }
  private setPose(o: Group, a: number[]): void { o.position.fromArray(a, 0); o.quaternion.fromArray(a, 3); }
  /** Per-frame MR placement state machine. */
  private mrStep(delta: number): void {
    const m = this.mr; if (m.phase === 'idle' || m.phase === 'done') return;
    m.t += delta;
    const anchored = () => this.deskE.hasComponent(XRAnchor) && !!this.deskE.getValue(XRAnchor, 'attached') && !!this.wallE.getValue(XRAnchor, 'attached');
    if (m.phase === 'restore') {
      const saved = JSON.parse(localStorage.getItem(MR_KEY) ?? 'null') as { uuid: string; desk: number[]; wall: number[]; how: string; wall2: string; tray: boolean } | null;
      const uuid = localStorage.getItem(ANCHOR_UUID_KEY);
      // IWSDK deletes its UUID when restorePersistentAnchor fails, then makes a new one: a different UUID = a different origin
      if (!saved || (m.t > 0.3 && uuid !== saved.uuid)) { this.mrForget('anchor not restored'); return; }
      if (m.t < 1.2 || !anchored()) { if (m.t > 4) this.mrForget('anchor timeout'); return; }
      this.setPose(this.desk, saved.desk); this.setPose(this.wall, saved.wall);
      this.tray.mesh.visible = saved.tray; this.wallMode = 'detected'; this.restored = true;
      m.desk = `restored (${saved.how})`; m.wall = `restored (${saved.wall2})`; m.phase = 'done';
      this.desk.updateMatrixWorld(true); const dp = this.desk.getWorldPosition(new Vector3()); const q = this.desk.getWorldQuaternion(new Quaternion());
      const f = new Vector3(0, 0, -1).applyQuaternion(q); f.y = 0; f.normalize();
      const head = dp.clone().addScaledVector(f, -DESK_FWD); head.y = m.head!.y; this.layoutSides(head, Math.atan2(-f.x, -f.z));
      this.redrawHeader(); return;
    }
    if (m.phase === 'scan') {
      const t = this.findTable(); if (t) { this.deskFound(t, 'table plane'); return; }
      if (m.t > 1.5) { m.phase = 'hit'; m.t = 0; this.redrawHeader(); }
      return;
    }
    if (m.phase === 'hit') {
      const t = this.hitTestTable(); if (t) { this.deskFound(t, 'hit-test'); return; }
      if (m.t > 1.5) { m.phase = 'tap'; m.t = 0; m.tapped = false; this.showPlaceHint(); this.redrawHeader(); }
      return;
    }
    if (m.phase === 'tap') {
      // desk follows the gaze ~60 cm away (29° down) until a pinch / trigger sets it down
      const cam = this.headCam(); cam.updateMatrixWorld();
      const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.q)); fwd.y = 0; fwd.normalize();
      m.head = head; m.fwd = fwd;
      const at = head.clone().addScaledVector(fwd, 0.6 * Math.cos(0.5)); at.y = head.y - 0.6 * Math.sin(0.5);
      this.desk.position.lerp(at, 1 - Math.exp(-delta * 8)); this.desk.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
      if (m.tapped) this.deskFound(at, 'tap');
      return;
    }
    if (m.phase === 'anchor') {
      const uuid = localStorage.getItem(ANCHOR_UUID_KEY);
      if (anchored() && uuid) {
        localStorage.setItem(MR_KEY, JSON.stringify({ uuid, desk: this.poseOf(this.desk), wall: this.poseOf(this.wall), how: m.desk, wall2: m.wall, tray: this.tray.mesh.visible }));
        m.phase = 'done'; this.redrawHeader();
      } else if (m.t > 5) { m.phase = 'done'; m.wall += ' · not saved (no persistent anchor)'; this.redrawHeader(); }
    }
  }
  private mrForget(why: string): void {
    localStorage.removeItem(MR_KEY); console.log('[MD] re-place:', why);
    this.detach(this.deskE, this.desk); this.detach(this.wallE, this.wall); this.wallMode = 'fallback'; this.restored = false;
    this.layoutAround(this.mr.head!, this.mr.fwd!);
    this.mr.phase = 'scan'; this.mr.t = 0; this.redrawHeader();
  }
  /** "📍 Re-place": forget the saved spot and place again from where the user is now. */
  replace(): void {
    if (!this.mrFlow()) return;
    localStorage.removeItem(MR_KEY); sfx.pick();
    this.mrBegin();
  }
  /** Enter XR: passthrough (immersive-ar) when the device supports it, else the VR-room fallback. */
  async enterXR(): Promise<void> {
    let ar = !FORCE_VR;
    try { if (ar && navigator.xr) ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch { ar = false; }
    this.mr.vr = !ar;
    this.world.launchXR(ar ? undefined : { sessionMode: SessionMode.ImmersiveVR });
  }
  /** Test/autoplay hook: confirm the tap-to-place step (what a pinch does). */
  tapPlace(): void { if (this.mr.phase === 'tap') this.mr.tapped = true; }
  mrStatus(): string {
    const m = this.mr;
    if (m.vr) return '🖥 VR room (no passthrough on this device)';
    if (m.phase === 'restore') return '📍 finding your saved desk…';
    if (m.phase === 'scan' || m.phase === 'hit') return '📍 looking for your desk…';
    if (m.phase === 'tap') return '📍 pinch to set your desk';
    return m.desk.startsWith('restored') ? '📍 desk + wall restored in the same spot' : `📍 desk: ${m.desk} · wall: ${m.wall}`;
  }
  private showPlaceHint(): void {
    this.placeHint.mesh.visible = true;
    this.placeHint.draw((g, W, H) => { panel(g, W, H, C.sageDeep, undefined, 1); text(g, '📍 Look where you want your desk, then pinch', W / 2, H / 2, 18, '#fff', 600, W - 30, 'center'); });
  }

  // ---------------------------------------------------------------- v2: Wind-down (evening ritual: recap → roll each unfinished task → close the day)
  wind: { step: number; list: string[]; kept: string[]; dropped: string[] } | null = null;
  private windPanel!: Label; private windE!: Entity; private windBtns: Btn[] = [];
  private buildWindDown(): void {
    this.windPanel = new Label(0.5, 0.3); this.windPanel.mesh.visible = false;
    (this.windPanel.mesh.material as MeshBasicMaterial).depthTest = false; this.windPanel.mesh.renderOrder = 10;
    this.windE = this.world.createTransformEntity(this.windPanel.mesh, this.deskE);
    const a = this.button('a', 0.16, () => this.windChoice(true), this.windE), b = this.button('b', 0.16, () => this.windChoice(false), this.windE);
    a.label.mesh.position.set(-0.09, -0.115, 0.004); b.label.mesh.position.set(0.09, -0.115, 0.004);
    for (const x of [a, b]) { (x.label.mesh.material as MeshBasicMaterial).depthTest = false; x.label.mesh.renderOrder = 11; }
    this.windBtns = [a, b];
  }
  /** Unfinished = scheduled today but not done, plus anything already parked for tomorrow. Real state only. */
  private unfinished(): string[] {
    const s = this.s; const seen = new Set<string>();
    return [...s.timeline, ...s.tomorrow].filter((id) => s.tasks[id] && !s.tasks[id].done && !seen.has(id) && (seen.add(id), true));
  }
  openWindDown(): void {
    if (this.focus) this.endFocus(false); this.summary.mesh.visible = false; this.pending = null;
    this.wind = { step: 0, list: this.unfinished(), kept: [], dropped: [] };
    this.windPanel.mesh.visible = true; this.placeInView(this.windPanel.mesh, 0.55, -0.14); sfx.pick();
    document.body.dataset.wind = '0'; this.drawWind();
  }
  /** A = Next / → Tomorrow / ✓ Close day · B = Close / ✕ Drop / ← Back. 👍 / 👎 do the same. */
  windChoice(a: boolean): void {
    const w = this.wind; if (!w) return;
    const n = w.list.length;
    if (w.step === 0) { if (!a) { this.closeWind(); return; } w.step = 1; }
    else if (w.step <= n) { (a ? w.kept : w.dropped).push(w.list[w.step - 1]); a ? sfx.yes() : sfx.skip(); w.step++; }
    else { if (a) { this.closeDay(); return; } w.step = 0; w.kept = []; w.dropped = []; }
    document.body.dataset.wind = String(w.step); this.drawWind();
  }
  private closeWind(): void { this.wind = null; this.windPanel.mesh.visible = false; delete document.body.dataset.wind; }
  private closeDay(): void {
    const w = this.wind!; const s = this.s;
    for (const id of w.dropped) {
      s.timeline = s.timeline.filter((x) => x !== id); s.tomorrow = s.tomorrow.filter((x) => x !== id); s.stack = s.stack.filter((x) => x !== id);
      delete s.tasks[id];
    }
    s.carry = [...w.kept];
    const before = s.streak; completeDay(s); this.streakAnim = { t: 9, from: before, to: s.streak }; save(s); sfx.done();
    this.closeWind(); this.syncItems();
    this.agentMsg = `🌙 Day closed. ${w.kept.length ? `Tomorrow starts with ${w.kept.length} task${w.kept.length > 1 ? 's' : ''}.` : 'Nothing carried over.'} ${s.streak}-day streak.`;
    document.body.dataset.wind = 'closed'; this.redrawAll();
  }
  private drawWind(): void {
    const w = this.wind; if (!w) return; const s = this.s; const n = w.list.length;
    const [la, lb] = w.step === 0 ? ['Next →', '✕ Close'] : w.step <= n ? ['→ Tomorrow', '✕ Drop'] : ['✓ Close day', '← Back'];
    this.windBtns.forEach((b, i) => {
      const t = i ? lb : la; b.label.mesh.userData.btn = t;
      b.label.draw((g, W, H) => { panel(g, W, H, i ? '#7a837d' : C.sageDeep, undefined, 1); text(g, t, W / 2, H / 2, 21, '#fff', 600, W - 16, 'center'); });
    });
    this.windPanel.draw((g, W, H) => {
      panel(g, W, H, C.paper, '#5e6a7a', 1);
      text(g, '🌙 Wind down', 32, 34, 24, C.ink, 700);
      text(g, w.step === 0 ? 'step 1 · today' : w.step <= n ? `step 2 · roll over ${w.step} of ${n}` : 'step 3 · tomorrow', W - 28, 34, 15, C.mute, 600, W, 'right');
      if (w.step === 0) {
        const sched = s.timeline.filter((id) => s.tasks[id]); const done = sched.filter((id) => s.tasks[id].done).length;
        const lines: [string, string][] = [
          ['Done today', `${done} of ${sched.length} scheduled`],
          ['Focus time', dur(s.focusMinutes ?? 0)],
          ['Unfinished', n ? `${n} task${n > 1 ? 's' : ''}` : 'none'],
        ];
        lines.forEach(([k, v], i) => { text(g, k, 32, 84 + i * 32, 19, C.mute, 600); text(g, v, 190, 84 + i * 32, 19, C.ink, 700, W - 210); });
        para(g, n ? 'Next: decide, one by one, what rolls into tomorrow.' : 'Everything scheduled is done.', 32, 182, 16, W - 60, C.sageDeep);
      } else if (w.step <= n) {
        const t = s.tasks[w.list[w.step - 1]];
        text(g, t.title, 32, 96, 28, C.ink, 700, W - 60);
        text(g, `${dur(t.minutes)} · ${['', 'must do', 'should do', 'nice to have'][t.priority]}`, 32, 132, 18, C.sageDeep, 600, W - 60);
        text(g, 'Roll into tomorrow?  👍 keep · 👎 drop', 32, 176, 17, C.mute, 500, W - 60);
      } else {
        const titles = w.kept.map((id) => s.tasks[id]?.title).filter(Boolean);
        text(g, titles.length ? 'Tomorrow starts with:' : 'Tomorrow starts fresh.', 32, 84, 19, C.ink, 700, W - 60);
        titles.slice(0, 4).forEach((t, i) => text(g, `${i + 1}. ${t}`, 44, 116 + i * 26, 18, C.ink, 500, W - 80));
        if (titles.length > 4) text(g, `+${titles.length - 4} more`, 44, 116 + 4 * 26, 16, C.mute, 500);
        if (w.dropped.length) text(g, `Dropped: ${w.dropped.length}`, W - 28, 84, 16, C.mute, 500, W, 'right');
      }
    });
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
    label.mesh.userData.btn = t;
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable); // fingertip press
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
      const start = parent?.label.mesh.position ?? this.desk.getWorldPosition(new Vector3());
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
      const sl = layout(s).slots[it.id]; const start = sl.start - s.dayStart;
      const w = Math.max(0.03, (sl.end - sl.start) * this.pxPerM() - 0.006);
      out.set(-TRACK_W / 2 + start * this.pxPerM() + w / 2 + 0.003, 0, 0.006);
      this.wall.localToWorld(out); this.wall.getWorldQuaternion(outQ);
      return { w, h: TRACK_H, visible: true };
    }
    if (place === 'tomorrow') {
      const i = s.tomorrow.indexOf(it.id);
      out.set(-TRACK_W / 2 + 0.1 + i * 0.17, -0.37, 0.006); this.wall.localToWorld(out); this.wall.getWorldQuaternion(outQ);
      return { w: 0.16, h: 0.045, visible: true };
    }
    if (place === 'skipped') {
      out.set(0.7, -0.2, 0); this.desk.localToWorld(out); this.desk.getWorldQuaternion(outQ);
      return { w: CARD_W, h: CARD_H, visible: false };
    }
    const onDesk = s.stack.filter((id) => s.tasks[id].priority === 1);
    if (s.tasks[it.id].priority !== 1) {
      const j = s.stack.filter((id) => s.tasks[id].priority !== 1).indexOf(it.id);
      out.set(-0.095 + (j % 2) * 0.19, 0.065 - Math.floor(j / 2) * 0.12, 0.004); this.right.localToWorld(out); this.right.getWorldQuaternion(outQ);
      return { w: CARD_W, h: CARD_H, visible: true };
    }
    const i = onDesk.indexOf(it.id);
    const col = i % 3, row = Math.floor(i / 3);
    out.set(-0.17 + col * 0.165, 0.035 + row * 0.005, 0.07 - row * 0.1); this.desk.localToWorld(out);
    this.desk.getWorldQuaternion(outQ).multiply(this.q.setFromAxisAngle(new Vector3(1, 0, 0), -1.05));
    return { w: CARD_W, h: CARD_H, visible: true };
  }
  private drawItem(it: Item, place: string, w: number, h: number): void {
    const t = this.s.tasks[it.id]; if (!t) return;
    const key = `${place}|${w.toFixed(3)}|${t.title}|${t.minutes}|${this.slotStart(it.id)}|${t.done}|${JSON.stringify(layout(this.s).slots[it.id]?.clash ?? '')}`;
    if (key === it.drawnKey) return; it.drawnKey = key;
    it.label.resize(w, h);
    const sl = layout(this.s).slots[it.id];
    const over = place === 'timeline' && (!!sl?.clash || sl.end - this.s.dayStart > this.s.availableMinutes);
    it.label.draw((g, W, H) => {
      if (place === 'stack') {
        panel(g, W, H, C.paper, C.prio[t.priority]);
        const lines = this.wrap(g, t.title, W - 44, 18, 2);
        lines.forEach((ln, i) => text(g, ln, 30, H * (lines.length > 1 ? 0.24 + i * 0.25 : 0.36), 18, C.ink, 600, W - 40));
        text(g, `${dur(t.minutes)} · ${['', 'must', 'should', 'nice'][t.priority]}`, 30, H * 0.8, 15, C.mute, 500, W - 40);
      } else if (place === 'timeline') {
        panel(g, W, H, t.done ? '#dfe6dc' : over ? C.warn : C.prio[t.priority], undefined, t.done ? 0.7 : 0.95);
        if (W < 120) {
          // narrow block: no clipped words, just a glyph + duration (full title shows on hover)
          text(g, t.done ? '✓' : iconFor(t.title), W / 2, H * 0.38, Math.min(30, W * 0.55), C.ink, 400, W, 'center');
          const ds = dur(t.minutes); let fs = 18; g.font = `600 ${fs}px system-ui`; while (fs > 10 && g.measureText(ds).width > W - 8) { fs--; g.font = `600 ${fs}px system-ui`; }
          text(g, ds, W / 2, H * 0.72, fs, C.ink, 600, W, 'center'); // fit, never ellipsised
        } else {
          const lines = this.wrap(g, `${t.done ? '✓ ' : ''}${t.title}`, W - 18, 21, 2);
          lines.forEach((ln, i) => text(g, ln, 10, H * (lines.length > 1 ? 0.22 + i * 0.26 : 0.32), 21, C.ink, 700, W - 16));
          text(g, `${fmt(this.s.dayStart + this.slotStart(it.id))} · ${t.done ? `${dur(t.actual ?? t.minutes)} of ${dur(t.minutes)}` : dur(t.minutes)}`, 10, H * 0.8, 18, C.ink, 500, W - 16);
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
  private slotStart(id: string): number { const sl = layout(this.s).slots[id]; return sl ? sl.start - this.s.dayStart : 0; }

  // ---------------------------------------------------------------- drop logic (shared by hands + mouse)
  /** Where would a card released at world point p land on the wall? (head→card ray, so seated users can "aim" it). */
  private wallSlot(p: Vector3, strict = false): number | null {
    const cam = this.headCam(); const head = this.tmp.setFromMatrixPosition(cam.matrixWorld);
    const n = new Vector3(0, 0, 1).applyQuaternion(this.wall.getWorldQuaternion(new Quaternion()));
    const dir = p.clone().sub(head).normalize();
    const denom = n.dot(dir); if (Math.abs(denom) < 1e-3) return null;
    const t = n.dot(this.wall.getWorldPosition(new Vector3()).sub(head)) / denom; if (t <= 0) return null;
    const hit = this.wall.worldToLocal(head.clone().addScaledVector(dir, t));
    if (Math.abs(hit.y) > 0.16 || hit.x < -TRACK_W / 2 - 0.1 || hit.x > TRACK_W / 2 + 0.25) return null;
    if (strict && (Math.abs(hit.y) > 0.1 || Math.abs(hit.x) > TRACK_W / 2)) return null; // on the track itself, not its margin
    // insertion index by comparing to block centres (excluding the dragged one)
    const list = this.s.timeline.filter((x) => x !== this.drag?.id && x !== this.mouseDrag?.id);
    const sl = layout(this.s).slots; let idx = list.length;
    for (let i = 0; i < list.length; i++) {
      const b = sl[list[i]]; if (!b) continue;
      const cx = -TRACK_W / 2 + ((b.start + b.end) / 2 - this.s.dayStart) * this.pxPerM();
      if (hit.x < cx) { idx = i; break; }
    }
    return idx;
  }
  private markerAt(idx: number | null): void {
    this.marker.visible = idx !== null; if (idx === null) return;
    const list = this.s.timeline.filter((x) => x !== this.drag?.id && x !== this.mouseDrag?.id);
    const sl = layout(this.s).slots; const ref = list[idx] ?? list[idx - 1];
    const m = !ref ? 0 : (list[idx] ? sl[ref].start : sl[ref].end) - this.s.dayStart;
    this.marker.position.set(-TRACK_W / 2 + m * this.pxPerM(), 0, 0.012);
  }
  private release(id: string, p: Vector3, lateralSpeed: number, moved: number, held: number, flick = false): void {
    this.marker.visible = false;
    if (moved < (this.inXR() ? 0.04 : 0.025) && held < (this.inXR() ? 4 : 0.5)) { if (this.focus?.phase === 'ask') { this.moreTime(); return; } if (!this.focus) { this.startFocus(id); this.tutEvent('detail'); } return; }
    const idx = flick ? null : this.wallSlot(p);
    const s = this.s;
    const strip = (arr: string[]) => arr.filter((x) => x !== id);
    if (idx !== null) {
      s.stack = strip(s.stack); s.tomorrow = strip(s.tomorrow); s.skipped = strip(s.skipped);
      const list = strip(s.timeline); list.splice(idx, 0, id); s.timeline = list;
      sfx.drop(); this.tutEvent('drop');
    } else if (Math.abs(lateralSpeed) > SWIPE_SPEED) {
      s.stack = strip(s.stack); s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow);
      s.skipped.push(id); sfx.skip(); this.tutEvent('skip');
    } else if (this.placeOf(id) !== 'stack' && p.distanceTo(this.desk.getWorldPosition(new Vector3())) < 0.35) {
      s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow); s.stack.push(id); sfx.drop();
    }
    this.commit();
  }
  private commit(): void {
    save(this.s); this.syncItems(); this.redrawAll();
    if (!this.pending && !this.noAutoAgent && this.needsAgent()) this.agentTimer = 1.6; // agent notices overload by itself
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
      this.agentMsg = (this.justKept ? '✓ Kept. ' : '') + (tot ? `Plan fits: ${dur(tot)} of ${dur(this.s.availableMinutes)} free. Nice and calm.` : 'Drag a few cards onto the timeline first.'); this.justKept = false;
      this.redrawAgent(); return;
    }
    this.pending = c; this.s = clone(c.after); this.agentMsg = c.summary; this.justKept = false;
    if (c.kind === 'split') sfx.split(); else sfx.agent(); save(this.s); this.syncItems(); this.redrawAll();
  }
  private decide(ok: boolean): void {
    if (!this.pending) return;
    this.tutEvent('decide');
    if (ok) { sfx.yes(); this.pending = null; this.agentTimer = 0.9; this.justKept = true; this.agentMsg = '✓ Kept. Your day is updated.'; }
    else { sfx.no(); this.declined.add(this.pending.summary); this.s = clone(this.pending.before); this.pending = null; this.agentMsg = 'Undone. Your call.'; save(this.s); this.syncItems(); }
    this.redrawAll();
  }

  // ---------------------------------------------------------------- streak, tutorial, details
  /** Streak is a plain day count (v2: no plant / growth reward). */
  private drawStreak(): void {
    this.streakLabel.draw((g, W, H) => { panel(g, W, H, C.paper); text(g, `${this.s.streak}-day streak`, W / 2, H / 2, 15, C.sageDeep, 600, W - 10, 'center'); });
  }
  private finishDay(): void {
    const before = this.s.streak; completeDay(this.s); this.streakAnim = { t: 0, from: before, to: this.s.streak }; save(this.s); this.drawStreak(); sfx.done();
    this.agentMsg = `Day closed. ${this.s.streak}-day streak. See you tomorrow.`; this.redrawAgent();
    this.showSummary();
  }
  /** Spawn a panel in front of the viewer's current head pose: `dist` ahead (level gaze), `drop` below eye height, facing the head. */
  private placeInView(m: Mesh, dist: number, drop: number): void {
    const cam = this.headCam(); cam.updateMatrixWorld();
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
    // clamp pitch so the panel stays inside the FoV even if the head looks steeply up/down
    fwd.y = Math.max(-0.35, Math.min(0.2, fwd.y)); fwd.normalize();
    const world = head.clone().addScaledVector(fwd, dist); world.y += drop;
    const parent = m.parent!; parent.updateMatrixWorld();
    m.position.copy(parent.worldToLocal(world.clone()));
    // face the head: world rotation = lookAt(head); local = parent^-1 * world
    const look = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(head, world, new Vector3(0, 1, 0)));
    m.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(look));
  }
  private openDetail(id: string): void {
    this.detailId = id; if (!id) return; this.detail.mesh.visible = true; this.detail.mesh.scale.setScalar(0.85);
    this.placeInView(this.detail.mesh, 0.7, -0.12);
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
  // ---------------------------------------------------------------- Focus Mode
  private onThumb(dir: number): void {
    if (this.wind) { this.windChoice(dir > 0); return; }
    if (this.focus) { if (dir > 0) this.endFocus(true); return; } // 👍 = done (early or at the bell)
    this.decide(dir > 0);
  }
  /** Elapsed task-minutes of the current focus block (accelerated on demo days). */
  focusElapsed(): number { const f = this.focus; return f ? f.base + (f.phase === 'run' ? (performance.now() - f.t0) / 60000 * FOCUS_ACCEL : 0) : 0; }
  startFocus(id: string): void {
    if (!this.s.tasks[id] || this.s.tasks[id].done) return;
    document.body.dataset.focus = id; // test/automation hook, not rendered
    this.focus = { id, length: 25, t0: performance.now(), base: 0, phase: 'run', shown: '' };
    this.focusPanel.mesh.visible = true; this.focusPanel.mesh.scale.setScalar(0.8);
    this.placeInView(this.focusPanel.mesh, 0.62, -0.15);
    this.dim.visible = true; sfx.pick();
  }
  private setFocusLength(n: number): void { if (!this.focus) return; this.focus.length = n; if (this.focus.phase === 'ask') this.moreTime(0); this.focus.shown = ''; sfx.yes(); }
  private moreTime(add = 15): void {
    const f = this.focus; if (!f) return;
    if (f.phase === 'ask') { f.phase = 'run'; f.t0 = performance.now(); }
    f.length = Math.max(f.length, Math.floor(this.focusElapsed())) + add; f.shown = ''; sfx.agent();
  }
  endFocus(done: boolean): void {
    const f = this.focus; if (!f) return;
    const mins = Math.max(1, Math.round(this.focusElapsed()));
    delete document.body.dataset.focus; this.focus = null; this.focusPanel.mesh.visible = false; this.dim.visible = false;
    for (const it of this.items.values()) (it.label.mesh.material as MeshBasicMaterial).opacity = 1;
    this.s.focusMinutes = (this.s.focusMinutes ?? 0) + mins;
    if (!done) { save(this.s); this.redrawAll(); return; }
    const t = this.s.tasks[f.id]; t.done = true; t.actual = mins; sfx.done();
    if (!this.s.timeline.includes(f.id)) { this.s.stack = this.s.stack.filter((x) => x !== f.id); this.s.timeline.unshift(f.id); }
    // reschedule: later blocks follow the measured time, then the planner re-checks clashes / overload
    const diff = t.minutes - mins;
    this.agentMsg = diff > 0 ? `"${t.title}" done ${dur(diff)} early (${dur(mins)} of ${dur(t.minutes)} planned). Later blocks moved ${dur(diff)} earlier.`
      : diff < 0 ? `"${t.title}" took ${dur(-diff)} longer (${dur(mins)} of ${dur(t.minutes)}). Later blocks moved ${dur(-diff)} later.` : `"${t.title}" done right on time.`;
    save(this.s); this.syncItems(); this.redrawAll();
    const c = this.planner.nextChange(this.s);
    if (c && !this.declined.has(c.summary)) setTimeout(() => { const m = this.agentMsg; this.runAgent(); if (this.pending) this.agentMsg = `${m.split('.')[0]}. ${this.pending.summary}`; this.redrawAgent(); }, 1200);
  }
  private updateFocus(delta: number): void {
    const f = this.focus;
    const k = 1 - Math.exp(-delta * 6);
    (this.dim.material as MeshBasicMaterial).opacity += ((f ? 0.55 : 0) - (this.dim.material as MeshBasicMaterial).opacity) * k;
    for (const m of this.deskRow) m.visible = !f && !this.summary.mesh.visible;
    this.streakLabel.mesh.visible = !this.summary.mesh.visible; // tag hidden under the open summary // one Done while focusing
    if (!f) return;
    this.dim.position.copy(new Vector3().setFromMatrixPosition(this.headCam().matrixWorld));
    for (const it of this.items.values()) (it.label.mesh.material as MeshBasicMaterial).opacity = it.id === f.id ? 1 : 0.22;
    const sc = this.focusPanel.mesh.scale.x; this.focusPanel.mesh.scale.setScalar(sc + (1 - sc) * k);
    const el = this.focusElapsed();
    if (f.phase === 'run' && el >= f.length) { f.base = f.length; f.phase = 'ask'; sfx.agent(); }
    const left = Math.max(0, f.length - el);
    const shown = `${f.phase}|${Math.floor(left * 60 / (FOCUS_ACCEL > 1 ? 30 : 1))}|${f.length}`;
    if (shown === f.shown) return; f.shown = shown;
    const t = this.s.tasks[f.id]; const ask = f.phase === 'ask';
    this.focusPanel.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.prio[t.priority], 1);
      text(g, '🎯 Focus', 36, 34, 18, C.sageDeep, 700);
      if (FOCUS_ACCEL > 1) text(g, `⏩ Demo: 1 s = ${FOCUS_ACCEL / 60} min (accelerated)`, 132, 34, 13, '#b9772e', 700, W - 132 - 96);
      text(g, t.title, 36, 72, 28, C.ink, 700, W - 140);
      const mm = Math.floor(left), ss = Math.floor((left - mm) * 60);
      text(g, ask ? 'Done or more time?' : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, W / 2, H * 0.43, ask ? 40 : 64, ask ? '#b9772e' : C.ink, 700, W - 40, 'center');
      g.fillStyle = '#d8d2c4'; g.beginPath(); g.roundRect(36, H * 0.55, W - 72, 10, 5); g.fill();
      g.fillStyle = C.sageDeep; g.beginPath(); g.roundRect(36, H * 0.55, (W - 72) * Math.min(1, el / f.length), 10, 5); g.fill();
      text(g, ask ? '👍 thumbs up = done · pinch = +15 min' : `${f.length}-min timer · planned ${dur(t.minutes)} · 👍 = done early`, W / 2, H * 0.74, 17, C.mute, 500, W - 40, 'center');


    });
  }
  // ---------------------------------------------------------------- end-of-day summary (only measured numbers)
  private showSummary(): void {
    const s = this.s;
    // count by original task id: split parts roll up into one task, done only when every part is done
    const root = (id: string) => s.tasks[id].partOf ?? id;
    const groups = new Map<string, string[]>();
    for (const id of [...s.timeline, ...s.tomorrow].filter((x) => s.tasks[x])) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
    const today = [...groups.entries()].filter(([, ids]) => ids.some((x) => s.timeline.includes(x)));
    const doneN = today.filter(([, ids]) => ids.every((x) => s.tasks[x].done)).length;
    const unsched = s.stack.filter((x) => s.tasks[x]).length;
    const all = s.timeline.filter((id) => s.tasks[id]);
    const done = all.filter((id) => s.tasks[id].done);
    const measured = done.filter((id) => s.tasks[id].actual !== undefined);
    const planned = measured.reduce((a, id) => a + s.tasks[id].minutes, 0), actual = measured.reduce((a, id) => a + (s.tasks[id].actual ?? 0), 0);
    const ms = s.meetings ?? []; const post = s.tomorrow.map((id) => s.tasks[id]?.title).filter(Boolean);
    const lines: [string, string][] = [
      ['Tasks', IS_DEMO ? `${doneN} of ${today.length} done` : `${doneN} of ${today.length} scheduled done${unsched ? ` · ${unsched} not scheduled` : ''}`],
      ['Focus time', dur(s.focusMinutes ?? 0)],
      ['Meetings', ms.length ? `${ms.length} · ${dur(ms.reduce((a, m) => a + m.minutes, 0))}` : 'none'],
      ['Postponed', post.length ? post.join(', ') : 'none'],
    ];
    if (measured.length && planned !== actual) lines.push([planned > actual ? 'Time saved' : 'Over plan', `${dur(Math.abs(planned - actual))} (planned ${dur(planned)} vs actual ${dur(actual)})`]);
    if (measured.length && planned !== actual && IS_DEMO) lines.push(['', '(demo clock, accelerated)']);
    const why: string[] = [];
    if (s.conflictsFixed) why.push(`The planner fixed ${s.conflictsFixed} meeting clash${s.conflictsFixed > 1 ? 'es' : ''}.`);
    if (measured.length) why.push(planned > actual ? 'Focused tasks finished faster than planned.' : planned < actual ? 'Focused tasks ran longer than planned.' : 'Focused tasks ran to plan.');
    if (post.length) why.push(`${post.length} task${post.length > 1 ? 's were' : ' was'} postponed to keep the day fitting.`);
    const tip = post.length ? `Start with "${post[0]}" first thing.` : measured.length && actual < planned ? `Plan ${dur(Math.max(15, Math.round(actual / measured.length / 5) * 5))} blocks for similar tasks.` : doneN < today.length ? 'Schedule fewer blocks before your first meeting.' : 'Keep the same rhythm.';
    this.summary.mesh.visible = true; this.placeInView(this.summary.mesh, 0.62, -0.12);
    this.sumDraw = (k: number) => this.summary.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.sage, 1);
      text(g, '🌙 Day so far', 36, 36, 26, C.ink, 700);
      lines.forEach(([k, v], i) => { text(g, k, 36, 82 + i * 30, 18, C.mute, 600); text(g, v, 170, 82 + i * 30, 17, C.ink, 600, W - 190); });
      const y = 82 + lines.length * 30 + 6;
      para(g, why.join(' ') || 'A quiet day.', 36, y, 16, W - 70, C.ink);
      text(g, `Tomorrow: ${tip}`, 36, H - 46, 17, C.sageDeep, 700, W - 60);
      text(g, 'tap to close', W - 24, 36, 13, C.mute, 400, W, 'right');
      // streak moment: bar grows from yesterday's streak to today's (real state)
      const a = this.streakAnim, v = a.from + (a.to - a.from) * k, max = Math.max(7, a.to + 2);
      const ys = H - 92;
      text(g, `Streak ${k >= 1 ? a.to : a.from}${k >= 1 && a.to > a.from ? ` (+${a.to - a.from})` : ''} days`, 36, ys, 18, C.sageDeep, 700);
      g.fillStyle = '#d8d2c4'; g.beginPath(); g.roundRect(220, ys - 7, W - 260, 14, 7); g.fill();
      g.fillStyle = C.sage; g.beginPath(); g.roundRect(220, ys - 7, (W - 260) * Math.min(1, v / max), 14, 7); g.fill();
    });
    this.sumDraw(this.streakAnim.t >= 3 ? 1 : 0);
  }
  // Tutorial advances only when the user actually performs each gesture.
  private static TUT = [
    { on: 'pick', msg: '👋 Pinch (or drag) a card on your desk to pick it up.' },
    { on: 'drop', msg: '📌 Move it toward this timeline and open your fingers to drop it.' },
    { on: 'skip', msg: '💨 Now flick a card quickly sideways to skip it for today.' },
    { on: 'detail', msg: '🎯 Quick pinch (tap) a card to focus on it. 👍 when done.' },
    { on: 'decide', msg: '✨ Tap "Plan for me", then 👍 keep or 👎 undo the change.' },
  ];
  private startTutorial(): void { this.tutStep = 0; document.body.dataset.tutStep = '0'; this.tutorial.mesh.visible = true; this.tutorial.mesh.scale.setScalar(0.9); this.tutorialStep(); }
  private endTutorial(): void {
    if (this.tutStep >= 0) { this.s.tutorialSeen = true; save(this.s); } // seen only once finished or skipped
    this.tutStep = -1; this.tutorial.mesh.visible = false;
  }
  private tutEvent(ev: string): void {
    if (this.tutStep < 0 || MorningDeskSystem.TUT[this.tutStep].on !== ev) return;
    this.tutStep++; sfx.yes(); document.body.dataset.tutStep = String(this.tutStep); // test/automation hook, not rendered
    // tutorial-only: after step 4 (focus tap) close Focus after a short beat so it doesn't cover "Plan for me" in step 5
    if (ev === 'detail') setTimeout(() => { if (this.tutStep >= 0 && this.focus) this.endFocus(false); }, 800);
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
      text(g, `${i + 1}/5 · tap here to skip`, W - 22, H - 18, 19, '#e6efe7', 600, W, 'right');
    });
  }
  private demoMsg(): string { const c = this.planner.nextChange(this.s); return c ? `⚠ ${c.summary.split(' Fix:')[0]} Tap "Plan for me".` : ''; }
  private reset(demo: boolean): void {
    if (this.focus) this.endFocus(false); this.summary.mesh.visible = false;
    for (const it of this.items.values()) it.entity.dispose();
    this.items.clear(); this.pending = null; this.declined.clear(); this.detailId = ''; this.detail.mesh.visible = false;
    this.agentTimer = 0; this.thumb = { dir: 0, t: 0 }; this.endTutorial(); this.hoverId = ''; this.updateTip('');
    if (demo) { clearStorage(); }
    this.s = demo ? demoState() : load();
    this.agentMsg = demo ? this.demoMsg() : '';
    save(this.s); this.syncItems(); this.redrawAll();
  }

  // ---------------------------------------------------------------- drawing
  private redrawAll(): void { this.redrawHeader(); this.redrawAgent(); this.drawStreak(); this.redrawMeetings(); this.redrawBoards(); }
  private redrawBoards(): void {
    const s = this.s; const ms = s.meetings ?? []; const sl = layout(s).slots;
    const clash = new Set(Object.values(sl).map((x) => x.clash?.id).filter(Boolean));
    this.meetBoard.draw((g, W, H) => {
      panel(g, W, H, C.paper, '#5e6a7a', 0.95);
      text(g, '📅 Meetings', 34, 36, 24, C.ink, 700);
      if (!ms.length) text(g, 'No meetings today', 34, 84, 18, C.mute, 500);
      ms.forEach((m, i) => {
        const y = 84 + i * 80;
        text(g, `${fmt(m.start)}–${fmt(m.start + m.minutes)}`, 34, y, 18, C.sageDeep, 700);
        text(g, m.title, 34, y + 24, 20, C.ink, 600, W - 60);
        if (clash.has(m.id)) text(g, '⚠ a task runs into this', 34, y + 50, 16, '#b9772e', 700, W - 60);
      });
      text(g, 'Fixed times', 34, H - 24, 18, C.mute, 600, W - 50);
    });
    const tasks = [...s.timeline, ...s.tomorrow, ...s.stack].filter((id) => s.tasks[id]);
    const done = s.timeline.filter((id) => s.tasks[id].done);
    this.progress.mesh.visible = done.length > 0;
    this.progress.draw((g, W, H) => {
      panel(g, W, H, '#ffffff', undefined, 0.5);
      text(g, `✓ Completed ${done.length}/${tasks.length}${done.length ? ': ' + done.map((id) => s.tasks[id].title).join(', ') : ''}`, 24, H * 0.36, 20, C.sageDeep, 700, W - 48);
      g.fillStyle = '#d8d2c4'; g.beginPath(); g.roundRect(24, H * 0.66, W - 48, 10, 5); g.fill();
      g.fillStyle = C.sage; g.beginPath(); g.roundRect(24, H * 0.66, (W - 48) * (done.length / Math.max(1, tasks.length)), 10, 5); g.fill();
    });
  }
  private redrawMeetings(): void {
    const ms = this.s.meetings ?? [];
    while (this.meetingLabels.length > ms.length) this.wall.remove(this.meetingLabels.pop()!.mesh);
    ms.forEach((m, i) => {
      const w = m.minutes * this.pxPerM() - 0.006;
      const l = this.meetingLabels[i] ?? (this.meetingLabels[i] = new Label(w, TRACK_H + 0.02)); this.wall.add(l.mesh);
      l.resize(w, TRACK_H + 0.02);
      l.mesh.position.set(-TRACK_W / 2 + (m.start - this.s.dayStart) * this.pxPerM() + w / 2 + 0.003, 0, 0.002);
      l.draw((g, W, H) => {
        g.fillStyle = '#5e6a7a'; g.globalAlpha = 0.9; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 14); g.fill(); g.globalAlpha = 1;
        text(g, '📅', W / 2, H * 0.3, 26, '#fff', 400, W, 'center');
        text(g, fmt(m.start), W / 2, H * 0.58, 17, '#fff', 700, W - 6, 'center');
        text(g, m.title, W / 2, H * 0.8, 15, '#eef', 500, W - 6, 'center');
      });
    });
  }
  private redrawHeader(): void {
    const tot = scheduledMinutes(this.s), av = this.s.availableMinutes, over = tot > av;
    this.header.draw((g, W, H) => {
      panel(g, W, H, C.paper, over ? C.warn : C.sage);
      text(g, `Today  ${fmt(this.s.dayStart)}–${fmt(this.s.dayStart + av)}`, 34, H * 0.34, 26, C.ink, 700);
      if (!CLEAN_CAPTURE || this.wallMode === 'detected') text(g, this.mrFlow() && this.mr.phase !== 'idle' ? this.mrStatus() : this.wallMode === 'detected' ? (this.restored ? '📍 restored on your wall' : '📍 pinned to your wall') : `📍 no wall found: timeline placed ${WALL_FWD} m ahead`, 34, H * 0.74, 17, C.mute, 500, W * 0.55);
      text(g, over ? `⚠ ${dur(tot)} planned / ${dur(av)} free` : `${dur(tot)} / ${dur(av)}`, W - 30, H / 2, 24, over ? '#b9772e' : C.sageDeep, 700, W, 'right');
    });
  }
  private redrawAgent(): void {
    const show = !!this.pending;
    this.yesBtn.label.mesh.visible = this.noBtn.label.mesh.visible = show;
    this.agentPanel.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.sky, 1);
      text(g, show ? '✨ Planner changed your day' : '✨ Planner', 34, 26, 20, C.sageDeep, 700);
      para(g, this.agentMsg || 'Watching your plan for overload and blocks over 90 minutes.', 34, 46, 19, W - 50);
    });
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- desktop mouse (emulator / flat view)
  private hookDom(): void {
    const el = this.world.renderer.domElement;
    const ndc = (e: PointerEvent) => new Vector2((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1);
    window.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.inXR() || e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return;
      const id = this.pickAt(ndc(e), true);
      if (id?.startsWith('btn:')) { this.lastDomPress = performance.now(); this.buttons.get(Number(id.slice(4)))?.action(); return; }
      if (!id) return;
      const mesh = this.items.get(id)!.label.mesh;
      this.mouseDrag = { id, depth: mesh.position.distanceTo(this.world.camera.position), px: [{ t: performance.now(), x: e.clientX, y: e.clientY }], maxPx: 0 };
      const p = mesh.position.clone();
      this.drag = { id, t0: performance.now(), p0: p, hist: [{ t: performance.now(), p }] }; sfx.pick(); this.tutEvent('pick');
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.mouseDrag && !this.inXR()) { this.hoverId = this.pickAt(ndc(e)) ?? ''; el.style.cursor = this.hoverId ? 'grab' : ''; }
      if (!this.mouseDrag || !this.drag) return;
      const cam = this.world.camera; const dir = new Vector3(ndc(e).x, ndc(e).y, 0.5).unproject(cam).sub(cam.position).normalize();
      const p = cam.position.clone().addScaledVector(dir, Math.min(this.mouseDrag.depth, 0.6));
      this.items.get(this.mouseDrag.id)!.label.mesh.position.copy(p);
      this.drag.hist.push({ t: performance.now(), p }); if (this.drag.hist.length > 120) this.drag.hist.shift();
      const md = this.mouseDrag; md.px.push({ t: performance.now(), x: e.clientX, y: e.clientY }); if (md.px.length > 120) md.px.shift();
      md.maxPx = Math.max(md.maxPx, Math.hypot(e.clientX - md.px[0].x, e.clientY - md.px[0].y));
      this.markerAt(this.wallSlot(p));
    }, { capture: true });
    // tooltip should not linger after a drop
    window.addEventListener('pointerup', () => { this.hoverId = ''; }, { capture: true });
    window.addEventListener('pointerup', (e: PointerEvent) => { if (this.mouseDrag) { this.endMouseDrag(e); this.mouseDrag = null; } });
    const bind = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
    bind('btn-enter', () => {
      // ?hands=1: enter the emulator already in hand mode (as autoplay does), then sync the IWER toolbar
      const iwer = (window as unknown as { IWER_DEVICE?: { primaryInputMode: string } }).IWER_DEVICE;
      const hq = new URLSearchParams(location.search);
      if (iwer && hq.has('hands') && !hq.has('autoplay')) iwer.primaryInputMode = 'hand';
      void this.enterXR();
    });
    bind('btn-plan', () => this.runAgent(true));
    bind('btn-done', () => (WIND_DOWN ? this.openWindDown() : this.finishDay()));
    if (WIND_DOWN) { const el = document.getElementById('btn-done'); if (el) el.textContent = '🌙 Wind down'; }
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
  /** Desktop drag end: judged in screen pixels (world motion at <=0.6 m is tiny, so fast drags read as clicks). */
  /** ?hands=1: switch the IWER emulator to hand tracking, once per XR session (same path autoplay uses). */
  private handsOn(): void {
    if (this.handsSet) return; this.handsSet = true;
    const iwer = (window as unknown as { IWER_DEVICE?: { primaryInputMode: string } }).IWER_DEVICE; if (!iwer) return;
    void import('./autoplay.js').then(async (m) => {
      // the emulator can flip back to controllers while the session settles: keep re-applying for ~6 s
      let synced = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, i ? 300 : 150));
        if (!this.inXR()) { this.handsSet = false; return; }
        if (!synced) { await m.selectHandsOnly(); synced = true; } // sync the toolbar without passing through Controllers
        if (iwer.primaryInputMode !== 'hand') { iwer.primaryInputMode = 'hand'; await m.selectHandsOnly(); }
        if (!this.inXR()) { this.handsSet = false; return; }
        if (iwer.primaryInputMode !== 'hand') iwer.primaryInputMode = 'hand';
      }
    });
  }
  private endMouseDrag(e: PointerEvent): void {
    const md = this.mouseDrag, d = this.drag; if (!md || !d || d.id !== md.id) { this.endDrag(); return; }
    const now = performance.now(); md.px.push({ t: now, x: e.clientX, y: e.clientY });
    md.maxPx = Math.max(md.maxPx, Math.hypot(e.clientX - md.px[0].x, e.clientY - md.px[0].y));
    // flick: >=60 px mostly-horizontal within the last 300 ms at >=500 px/s
    const w0 = md.px.find((q) => now - q.t <= 300) ?? md.px[0];
    const dx = e.clientX - w0.x, dy = e.clientY - w0.y, dt = Math.max(0.016, (now - w0.t) / 1000);
    const fast = Math.abs(dx) >= 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && Math.abs(dx) / dt >= 500;
    // loose flick (any speed): whole drag ends >120 px mostly sideways, or >=15 cm sideways in world, and not on the timeline
    const tx = e.clientX - md.px[0].x, ty = e.clientY - md.px[0].y;
    const endP = this.items.get(md.id)?.label.mesh.position;
    const side = new Vector3(1, 0, 0).applyQuaternion(this.desk.getWorldQuaternion(new Quaternion()));
    const worldSide = endP ? Math.abs(endP.clone().sub(d.p0).dot(side)) : 0;
    const offTimeline = !endP || this.wallSlot(endP, true) === null;
    const loose = offTimeline && Math.abs(tx) > 1.5 * Math.abs(ty) && (Math.abs(tx) > 120 || worldSide >= 0.15);
    const flick = fast || loose;
    const dxs = loose && !fast ? tx : dx;
    if (!flick && md.maxPx < 6) { this.endDrag(); return; } // plain click/tap: unchanged (opens Focus)
    this.drag = null;
    const it = this.items.get(d.id); if (!it) return;
    const p = it.label.mesh.position.clone();
    // moved >= click threshold so a real drag never opens Focus; a flick skips like the XR flick
    this.release(d.id, p, flick ? Math.sign(dxs) * (SWIPE_SPEED + 1) : 0, Math.max(0.1, p.distanceTo(d.p0)), (now - d.t0) / 1000, flick);
  }
  private endDrag(): void {
    const d = this.drag; if (!d) return; this.drag = null;
    const it = this.items.get(d.id); if (!it) return;
    const p = it.label.mesh.position.clone();
    const b = d.hist[d.hist.length - 1];
    const right = new Vector3(1, 0, 0).applyQuaternion(this.desk.getWorldQuaternion(new Quaternion()));
    // flick = fast sideways motion at the end of the drag: peak sample speed, or >=8 cm sideways within the last 350 ms
    let lateral = 0;
    for (let i = 1; i < d.hist.length; i++) {
      const h0 = d.hist[i - 1], h1 = d.hist[i];
      if (b.t - h1.t > 1500) continue; // hand-tracking release can lag the flick itself
      const v = h1.p.clone().sub(h0.p).dot(right) / Math.max(0.008, (h1.t - h0.t) / 1000);
      if (Math.abs(v) > Math.abs(lateral)) lateral = v;
    }
    const w0 = d.hist.find((h) => b.t - h.t <= 500) ?? b;
    const side = b.p.clone().sub(w0.p).dot(right);
    if (Math.abs(lateral) < SWIPE_SPEED && Math.abs(side) >= 0.08 && b.t > w0.t) lateral = side / ((b.t - w0.t) / 1000) * 2;
    this.release(d.id, p, lateral, p.distanceTo(d.p0), (performance.now() - d.t0) / 1000);
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
    if (dir !== 0 && dir === this.thumb.dir) { this.thumb.t += delta; if (this.thumb.t > 0.4) { this.thumb = { dir: 0, t: -1 }; this.onThumb(dir); } }
    else if (this.thumb.t >= 0 || dir === 0) this.thumb = { dir, t: 0 };
  }
  private persistWall(): void {
    if (this.mrFlow()) return; // v2 MR flow persists desk + wall in mrStep
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
          this.drag.hist.push({ t: performance.now(), p }); if (this.drag.hist.length > 120) this.drag.hist.shift();
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
    if ((this.pending || this.focus || this.wind) && this.inXR()) this.detectThumbs(delta);
    this.updateFocus(delta);
    if (this.sumDraw && this.summary.mesh.visible && this.streakAnim.t < 3.6) {
      const p0 = Math.floor(this.streakAnim.t * 12); this.streakAnim.t += delta;
      if (Math.floor(this.streakAnim.t * 12) !== p0) this.sumDraw(Math.min(1, Math.max(0, (this.streakAnim.t - 0.6) / 2.4)));
    }
    this.persistWall();
    this.mrStep(delta);
    if (this.replaceBtn) this.replaceBtn.label.mesh.visible = this.mrFlow() && this.mr.phase === 'done' && !this.mr.vr;
    // agent acts on its own after a short beat
    if (this.agentTimer > 0) { this.agentTimer -= delta; if (this.agentTimer <= 0 && !this.pending) this.runAgent(); }
    // tutorial
    if (this.tutorial.mesh.visible) { const t = this.tutorial.mesh.scale.x; this.tutorial.mesh.scale.setScalar(t + (1 - t) * k); }
    // the level root marks children matrixAutoUpdate=false; our objects move every frame, so keep them live
    const live = (o: { matrixAutoUpdate: boolean; children: unknown[] }) => { o.matrixAutoUpdate = true; for (const c of o.children) live(c as typeof o); };
    live(this.desk); live(this.wall); live(this.left); live(this.right); for (const it of this.items.values()) it.label.mesh.matrixAutoUpdate = true;
  }
}
