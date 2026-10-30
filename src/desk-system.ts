import {
  Color, createSystem, Matrix4, CylinderGeometry, Entity, Grabbed, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  Hovered, OneHandGrabbable, PokeInteractable, Pressed, Quaternion, RayInteractable, SphereGeometry, Vector2, Vector3,
  VisibilityState, XRAnchor, XRPlane, SessionMode, PlaneGeometry, BoxGeometry, Box3, Ray,
} from '@iwsdk/core';
import { Label, panel, para, text } from './label.js';
import { LAMP } from './hide-lamp.js';
import { PlanChange, RulePlanner } from './planner.js';
import { Wake } from './wake.js';
import { C, FONT, HC, setContrast, sfx, unlockAudio } from './style.js';
import { MOODS, Mood, today, clearStorage, clone, tutorialState, completeDay, demoState, dur, fmt, IS_DEMO, lastWeek, layout, load, PlanState, save, scheduledMinutes } from './state.js';
import { BackSide, DepthOccludable, MeshBasicMaterial, OcclusionShadersMode } from '@iwsdk/core';
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
/** ?debug=1: show placement / anchor status on the timeline header (never in user-facing modes). */
const DEBUG = new URLSearchParams(location.search).has('debug');
/** ?test=1: headset test checklist (poke to tick) + live fps (avg / min over the last 10 s). */
const TEST = new URLSearchParams(location.search).has('test');
const TEST_KEY = 'morning-desk.test.v1';
const TEST_ITEMS = ['Desk on real table', 'Timeline on real wall', 'Re-place works', 'Anchors after reload', 'Pinch-drag → plan', '📅 Plan it button', 'Flick → skip', '⏭ Skip button', 'Tap → Focus · 👍 done', 'Done/+15/Exit btns', '👍/👎 Keep · Undo', 'Wind-down 👍/👎 + btns', 'High contrast', 'Last 7 days', 'Tutorial completes', '60 fps held'];
const MR_KEY = IS_DEMO ? 'morning-desk.demo.mr.v2' : 'morning-desk.mr.v2'; // demo runs keep their own placement; real anchors untouched               // { uuid, desk pose, wall pose } relative to IWSDK's persistent anchor
const ANCHOR_UUID_KEY = 'iwsdk_scene_anchor_uuid'; // IWSDK SceneUnderstandingSystem's persistent anchor UUID

// ---- layout constants (metres). Seated, ~0.6 m reach, key UI within ~30° of gaze centre.
const DESK_FWD = 0.4, DESK_DOWN = 0.26;      // card spread in easy reach
const WALL_FWD = 1.1;                         // fallback timeline distance, eye height
const TRACK_W = 0.96, TRACK_H = 0.13;         // ~0.96 m at 1.1 m ≈ ±24°
const CARD_W = 0.16, CARD_H = 0.09;
/** Small icon for icon-only (short) timeline blocks. */
function iconFor(title: string): string {
  const m: [RegExp, string][] = [[/standup|call|meet/i, '💬'], [/review|design/i, '🎨'], [/report|deep|write|blog|draft/i, '✍️'], [/gym|walk|run|stretch/i, '🏃'], [/inbox|mail/i, '📥'], [/plant|water/i, '🪴'], [/read/i, '📖'], [/plan|sprint/i, '🗂️'], [/electric|fix/i, '🔧']];
  return m.find(([r]) => r.test(title))?.[1] ?? '•';
}
const SWIPE_SPEED = 0.6;                      // m/s lateral flick = skip

interface Item { id: string; label: Label; entity: Entity; place: string; drawnKey: string; snap?: number; }
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
  private agentMsg = ''; private agentDrawn = '';
  private agentTimer = 0;
  private justKept = false;
  private handsSet = false;
  private wallMode: 'detected' | 'fallback' = 'fallback';
  private restored = false;
  private placeDelay = 0;
  private tutStep = -1;
  private placed = false; private wasXR = false; private windDimmed = false;
  private drag: { id: string; t0: number; p0: Vector3; hist: { t: number; p: Vector3 }[] } | null = null;
  private mouseDrag: { id: string; depth: number; px: { t: number; x: number; y: number }[]; maxPx: number } | null = null;
  private tmp = new Vector3(); private tmp2 = new Vector3(); private q = new Quaternion();
  private detailId = '';
  private lastDomPress = 0;
  private meetingLabels: Label[] = [];
  private deskRow: Mesh[] = [];
  // P1 spatial layout: meetings board on the left, pending board on the right, progress in the background
  private left = new Group(); private right = new Group(); private leftE!: Entity; private rightE!: Entity;
  private tmpQ = new Quaternion(); private testG = new Group(); private testHead?: Label; private testTicks: Record<string, boolean> = {}; private fpsB: number[] = []; private fpsCur = 0; private fpsT = 0; private fpsShowT = 0;
  private chips: Mesh[] = []; private flatFovAspect = 0;
  private sampleWeek = false; private sampleBtn!: Btn;
  private history!: Label; private histT = 0; private wallScale = 1; private tableYaw: number | null = null;
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
  /** steps 1-2: Room wakes up + mood check (MR flow; never in autoplay / ?clean / ?wake=0). */
  wake!: Wake; private moodAsked = false; private wakeGroups = new Map<Group, Entity>();
  private wakeOn(): boolean { const q = new URLSearchParams(location.search); return this.mrFlow() && !q.has('autoplay') && !CLEAN_CAPTURE && q.get('wake') !== '0'; }
  private setMood(m: Mood): void {
    this.moodAsked = true;
    const before = clone(this.s); const after = clone(this.s); after.mood = m; after.moodDay = today();
    let n = 0; for (let c = this.planner.nextSplit(after); c && n < 30; c = this.planner.nextSplit(after)) { Object.assign(after, clone(c.after)); n++; }
    const { block, brk } = MOODS[m];
    const summary = `Mood: ${m}. ${n ? `Split ${n} block${n > 1 ? 's' : ''} into ≤${block}m` : `Blocks up to ${block}m`}${brk ? `, ${brk}m break after each` : ', no breaks'}`;
    if (this.pending) { this.s = clone(this.pending.before); this.pending = null; } // a mood pick replaces an open suggestion
    if (!n && !brk) { this.s = clone(after); this.agentMsg = summary; save(this.s); this.agentTimer = 1.2; this.redrawAll(); return; } // focused + nothing to split: no change to approve
    const ch: PlanChange = { kind: 'split', summary, before, after };
    this.pending = ch; this.s = clone(after); this.agentMsg = summary; this.justKept = false;
    sfx.split(); save(this.s); this.syncItems(); this.redrawAll();
  }

  init(): void {
    // ?tutorial=1: fresh start: wipe saved desk/card/wall state, then the sample desk loads (never in demo)
    { const tq = new URLSearchParams(location.search); if (tq.has('tutorial') && !tq.has('demo')) { const h = load().history; const ts = tutorialState(); if (h) ts.history = h; save(ts); } }
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
    this.leftE = this.world.createTransformEntity(this.left, { persistent: true }); this.rightE = this.world.createTransformEntity(this.right, { persistent: true });
    this.meetBoard = new Label(0.4, 0.3); this.left.add(this.meetBoard.mesh);
    // between-session progress: last 7 days from stored history only (never in demo runs, which use fixed demo data)
    this.history = new Label(0.4, 0.13); this.history.mesh.position.set(0, -0.29, 0); this.left.add(this.history.mesh);
    this.history.mesh.visible = false; this.drawHistory();
    // accessibility: high-contrast toggle (also ?contrast=1)
    const hb = this.button('📊 7 days', 0.11, () => { this.drawHistory(); this.history.mesh.visible = !this.history.mesh.visible; this.histT = this.history.mesh.visible ? 25 : 0; this.syncHistBtns(); }, this.rightE);
    this.chips.push(hb.label.mesh); hb.label.mesh.position.set(-0.05, -0.15, 0.004); for (const m of [hb.label.mesh]) { (m.material as MeshBasicMaterial).depthTest = false; m.renderOrder = 12; } if (CLEAN_CAPTURE && !MR_FORCED) hb.label.mesh.visible = false;
    // 'Sample week (demo data)': clearly labelled fake week for showing the view; held in memory only, never saved or mixed with real history
    this.sampleBtn = this.button('Sample week (demo data): off', 0.27, () => this.toggleSample(), this.leftE);
    this.sampleBtn.label.mesh.position.set(0, -0.385, 0.004); this.sampleBtn.label.mesh.visible = false;
    if (TEST && !CLEAN_CAPTURE && !new URLSearchParams(location.search).has('autoplay')) this.buildTest(); // never in filming runs
    const hc = this.button('◐ Contrast', 0.11, () => this.toggleContrast(), this.rightE); this.chips.push(hc.label.mesh); hc.label.mesh.position.set(0.075, -0.15, 0.004); (hc.label.mesh.material as MeshBasicMaterial).depthTest = false; hc.label.mesh.renderOrder = 12; // never hidden behind Meetings
    if (CLEAN_CAPTURE && !MR_FORCED) hc.label.mesh.visible = false; // the filmed v1 layout stays as recorded
    this.pendHeader = new Label(0.36, 0.05); this.pendHeader.mesh.position.set(0, 0.16, 0); this.right.add(this.pendHeader.mesh);
    this.pendHeader.draw((g, W, H) => { panel(g, W, H, C.paper, C.sky, 0.95); text(g, '🗂 Pending · drag to plan', 30, H / 2, 20, C.ink, 700, W - 40); });
    this.progress = new Label(0.7, 0.08); this.progress.mesh.position.set(0, 0.44, -0.25); this.wall.add(this.progress.mesh);

    // Desk surface (soft paper tray) + streak.
    const tray = this.tray;
    tray.draw((g, W, H) => panel(g, W, H, C.glass, undefined, 0.55));
    tray.mesh.rotation.x = -Math.PI / 2; tray.mesh.position.set(0, -0.005, 0);
    this.desk.add(tray.mesh);
    this.streakLabel = new Label(0.2, 0.034);
    this.streakLabel.mesh.position.set(0.19, 0.012, 0.13); this.streakLabel.mesh.rotation.x = -1.0; this.desk.add(this.streakLabel.mesh); 

    // Wall: header + track + agent panel.
    this.header = new Label(TRACK_W + 0.2, 0.09);
    this.header.mesh.position.set(0, 0.17, 0); this.wall.add(this.header.mesh);
    const track = new Label(TRACK_W + 0.04, TRACK_H + 0.04);
    track.draw((g, W, H) => {
      panel(g, W, H, '#ffffff', undefined, 0.12);
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
    this.agentPanel.mesh.position.set(-0.15, 0.31, 0.01); this.wall.add(this.agentPanel.mesh); // above the header: never over a real monitor below the timeline
    this.yesBtn = this.button('👍 Keep', 0.13, () => this.decide(true), this.wallE);
    this.noBtn = this.button('👎 Undo', 0.13, () => this.decide(false), this.wallE);
    this.yesBtn.label.mesh.position.set(0.24, 0.335, 0.01); this.noBtn.label.mesh.position.set(0.24, 0.285, 0.01);

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
    if (!CLEAN_CAPTURE || MR_FORCED) {
      this.replaceBtn = this.button('📍 Re-place', 0.12, () => this.replace(), this.deskE);
      this.replaceBtn.label.mesh.position.set(0.3, 0.035, -0.17); this.replaceBtn.label.mesh.rotation.x = -0.5; this.replaceBtn.label.mesh.visible = false; // end of the desk button row: inside the level-gaze view, within reach
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
      // button alternatives to pinch-drag (plan it) and flick (skip)
      ['📅 Plan it', 0.02, 0.1, () => this.planFromFocus()], ['⏭ Skip', 0.11, 0.07, () => this.skipFromFocus()],
    ];
    for (const [t, x, w, fn] of fb) {
      const b = this.button(t, w, fn, this.focusE); b.label.mesh.position.set(x, /Exit|Plan it|Skip/.test(t) ? 0.11 : -0.105, 0.004); this.focusBtns.push(b);
    }
    for (const i of [4, 5, 6]) this.focusBtns[i].label.resize(i === 5 ? 0.1 : 0.07, 0.034);
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
    this.tutorial.mesh.position.set(0, -0.25, 0.01);

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
    this.wake = new Wake({
      scene: this.world.scene, desk: this.desk, wall: this.wall, trackW: TRACK_W,
      head: () => { const cam = this.headCam(); cam.updateMatrixWorld(); return { pos: new Vector3().setFromMatrixPosition(cam.matrixWorld), fwd: new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion())) }; },
      cardOrder: () => { const s = this.s; return [...s.timeline, ...s.stack, ...s.tomorrow].filter((id, i, a) => s.tasks[id] && a.indexOf(id) === i); },
      wallScale: () => this.wallScale,
      group: (g) => { this.wakeGroups.set(g, this.world.createTransformEntity(g, { persistent: true })); },
      pressable: (mesh, parent, action) => { const e = this.world.createTransformEntity(mesh, this.wakeGroups.get(parent)); e.addComponent(RayInteractable); e.addComponent(PokeInteractable); this.buttons.set(e.index, { label: { mesh } as unknown as Label, entity: e, action }); },
      askMood: () => !this.moodAsked && (IS_DEMO || this.s.moodDay !== today()),
      onMood: (m) => this.setMood(m),
    });
    this.cleanupFuncs.push(this.world.visibilityState.subscribe((v) => {
      this.setBackground(v === VisibilityState.NonImmersive);
      // hand grabbing only in XR; the flat view uses our own mouse drag (avoids two systems moving a card)
      for (const it of this.items.values()) {
        if (this.inXR() && !it.entity.hasComponent(OneHandGrabbable)) it.entity.addComponent(OneHandGrabbable, { rotate: false });
        if (!this.inXR() && it.entity.hasComponent(OneHandGrabbable)) it.entity.removeComponent(OneHandGrabbable);
      }
      // v2 MR flow: visible ↔ visible-blurred inside one session must not re-place (or re-seat) anything
      const entering = this.inXR() && !this.wasXR; this.wasXR = this.inXR();
      if (!(MR_FORCED || !(window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE) || IS_DEMO && !MR_FORCED || entering || !this.inXR()) {
        this.placed = false; // re-place around the head once the session pose settles
        this.placeDelay = this.inXR() ? 0.6 : 0;
        // ?mr=1 in IWER: sit the emulated headset at home_office's desk (seated eye height, facing the wall) so plane
        // detection / hit-test find a real table within reach. Real headsets have no IWER_DEVICE and ignore this.
        if (MR_FORCED && entering && seatEmulatedHead()) this.placeDelay = 1.0;
      }
      if (this.inXR()) unlockAudio();
      // Focus Mode: when the timer asks "Done or more time?", any pinch adds 15 min (👍 = done)
      const ses = this.world.renderer.xr.getSession();
      if (ses && !(ses as unknown as { mdHook?: boolean }).mdHook) { (ses as unknown as { mdHook?: boolean }).mdHook = true; ses.addEventListener('selectstart', () => { if (this.mr.phase === 'tap' && this.mr.t > 0.5) { this.mr.tapped = true; return; } if (this.focus?.phase === 'ask') this.moreTime(); }); }
      // hands-first: in the desktop emulator, switch to emulated hands (the devui can switch back)
      const iwer = (window as unknown as { IWER_DEVICE?: { primaryInputMode: string } }).IWER_DEVICE;
      // (input mode left to the IWER toolbar: setting it from code desynced the devui corner panels)
      // ?hands=1: same switch autoplay uses (clicks the IWER toolbar → Hands), once per session; autoplay does its own
      const hq = new URLSearchParams(location.search);
      if (iwer && this.inXR() && !hq.has('controllers') && !hq.has('autoplay')) { iwer.primaryInputMode = 'hand'; this.handsOn(); }
      for (const id of ['hud', 'hint']) { const el = document.getElementById(id); if (el) el.style.display = this.inXR() ? 'none' : ''; }
    }));
    this.hookDom();
    // depth occlusion (soft): every app panel/card/timeline. Plain MeshBasic/MeshStandard materials only (canvas-textured labels, no troika/uikit text), so the inline shader patch applies cleanly. No depth granted → uniforms stay off, normal rendering.
    for (const e of [this.deskE, this.wallE, this.leftE, this.rightE]) this.occl(e);
    if (!IS_DEMO && (this.s.history ?? []).length) { this.history.mesh.visible = true; this.histT = 25; this.syncHistBtns(); } // shown on open, then out of the way
    if (HC.on) document.body.dataset.contrast = '1';
    this.syncItems();
    this.redrawAll();
    const q = new URLSearchParams(location.search);
    // first real visit (or ?tutorial=1): start the hands tutorial automatically; never in demo/autoplay
    if ((!this.s.tutorialSeen && !q.has('demo')) || q.has('tutorial')) setTimeout(() => this.startTutorial(), 1200);
    if (q.has('autoplay') && MR_FORCED) setTimeout(() => void import('./autoplay-v2.js').then((m) => m.runAutoplayV2(this as never, this.world)), 1500);
    else if (q.has('autoplay')) setTimeout(() => void import('./autoplay.js').then((m) => m.runAutoplay(this as never, this.world)), 1500);
    if (new URLSearchParams(location.search).has('demo')) this.agentMsg = this.demoMsg();
    if (this.s.carriedIn) { this.agentMsg = `☀️ Good morning. Your plan starts with ${this.s.carriedIn} task${this.s.carriedIn > 1 ? 's' : ''} you rolled over last night.`; delete this.s.carriedIn; save(this.s); this.redrawAgent(); }
  }

  // ---------------------------------------------------------------- placement
  private setBackground(flat: boolean): void {
    this.plannerSpot(flat);
    // flat page: the toolbar already has Last 7 days / Contrast, so the 3D chips (which overlap Meetings in perspective) and the XR test checklist hide
    for (const m of this.chips ?? []) m.visible = !flat && !(CLEAN_CAPTURE && !MR_FORCED);
    if (this.testG) this.testG.visible = !flat;
    // Passthrough in MR: transparent background. In the flat browser view, a calm dawn tint.
    this.world.scene.background = flat ? new Color('#3B4250') : this.mr.vr ? new Color('#3a4440') : null;
    this.vrRoom.visible = !flat && !!this.mr.vr; // no passthrough on this device: a simple virtual room instead
  }
  private place(): void {
    if (this.mrFlow()) { this.mrBegin(); return; }
    // in XR the rendered head is the XR camera; the flat camera's pose is stale there
    const cam = this.inXR() ? this.world.renderer.xr.getCamera() : this.world.camera; cam.updateWorldMatrix(true, false);
    const head = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.q)); fwd.y = 0; fwd.normalize();
    // flat browser view: the camera stays put, so seat a virtual head in front of it to frame desk + wall at 16:9
    const flatView = this.world.visibilityState.value === VisibilityState.NonImmersive;
    if (flatView) { head.addScaledVector(fwd, 0.3); head.y -= 0.2; } // lower so the layout sits mid-window
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) {  }
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.desk.position.copy(head).addScaledVector(fwd, DESK_FWD + (flatView ? 0 : 0.04)); this.desk.position.y -= DESK_DOWN - (flatView ? 0 : 0.09); // within seated reach; cards sit above the chair in view
    this.desk.rotation.set(0, yaw, 0);
    const saved = this.world.visibilityState.value !== VisibilityState.NonImmersive ? localStorage.getItem(IS_DEMO ? 'morning-desk.demo.wall' : 'morning-desk.wall') : null;
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
    const kept = this.inXR() ? localStorage.getItem(IS_DEMO ? 'morning-desk.demo.wallAnchor' : 'morning-desk.wallAnchor') : null;
    if (kept && this.wallMode !== 'detected') {
      this.restoreWall = JSON.parse(kept) as number[]; this.wallMode = 'detected'; this.restored = true;
      if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor);
    }
    // side boards, turned to face the seated user
    const side = (g: Group, deg: number, dist: number, dy: number) => {
      const a = yaw + (deg * Math.PI) / 180; const d = new Vector3(-Math.sin(a), 0, -Math.cos(a));
      g.position.copy(head).addScaledVector(d, dist); g.position.y = head.y + dy; g.rotation.set(0, a, 0);
    };
    side(this.left, 37, 0.9, -0.04); side(this.right, -31, 0.82, -0.17); side(this.testG, -36, 1.05, 0.3); // below the timeline, right of the desk // inside a ~16:9 capture FoV
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
    this.fitWall(e, Math.abs(t));
    this.wallMode = 'detected';
    if (force) { this.redrawHeader(); return; } // MR flow anchors desk + wall together
    if (!this.wallE.hasComponent(XRAnchor)) this.wallE.addComponent(XRAnchor); // world-locked to the real wall
    this.wallSaved = false; // save pose relative to IWSDK's persistent anchor once attached
    this.redrawHeader();
  }

  // ---------------------------------------------------------------- v2: MR placement (real desk + real wall) and persistent anchors
  /** v2 MR flow: real headsets, or ?mr=1 in the emulator. Never in ?clean (the filmed v1 run keeps its layout). */
  mrFlow(): boolean {
    if (!this.inXR() || (CLEAN_CAPTURE && !MR_FORCED)) return false;
    if (IS_DEMO && !MR_FORCED) return false;
    return MR_FORCED || !(window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE;
  }
  /** How the desk / wall were placed this session (shown on the header, read by tests/autoplay). */
  mr: { phase: 'idle' | 'restore' | 'scan' | 'hit' | 'tap' | 'anchor' | 'done'; t: number; desk: string; wall: string; head?: Vector3; fwd?: Vector3; hit?: XRHitTestSource; hitReq?: boolean; tapped?: boolean; vr?: boolean; wallSize?: string; deskYaw?: string; noPlanes?: boolean; blocked?: string } = { phase: 'idle', t: 0, desk: '', wall: '' };
  private replaceBtn?: Btn; private placeHint!: Label;
  /** Size the timeline to the detected wall: ~85% of its width / half its height, clamped to a comfortable seated FoV (±26° at that distance). */
  private fitWall(e: Entity, dist: number): void {
    const pl = e.getValue(XRPlane, '_plane') as { polygon?: DOMPointReadOnly[] } | undefined;
    if (!pl?.polygon?.length) return;
    const xs = pl.polygon.map((q) => q.x), zs = pl.polygon.map((q) => q.z);
    const pw = Math.max(...xs) - Math.min(...xs), ph = Math.max(...zs) - Math.min(...zs); // plane-local extents
    const UI_W = TRACK_W, UI_H = 0.9; // timeline + header/progress above + tomorrow row below
    const fov = 2 * dist * Math.tan((26 * Math.PI) / 180);
    const k = Math.min(pw * 0.85 / UI_W, ph * 0.5 / UI_H * 2, fov / UI_W, 1.3);
    this.wallScale = Math.max(0.7, k); this.wall.scale.setScalar(this.wallScale);
    this.mr.wallSize = `${pw.toFixed(2)}×${ph.toFixed(2)} m → ×${this.wallScale.toFixed(2)}`;
  }
  /** XR: planner + Keep/Undo above the timeline header (clear of a real monitor below the timeline). Flat page: below the timeline. */
  private plannerSpot(flat: boolean): void {
    if (!this.agentPanel || !this.tutorial || !this.yesBtn) return;
    if (this.agentPanel.mesh.parent !== this.wall) return; // MR obstacle logic moved it onto the desk
    const y = flat ? -0.25 : 0.31;
    this.agentPanel.mesh.position.set(-0.15, y, 0.01);
    this.yesBtn.label.mesh.position.set(flat ? 0.2 : 0.24, y + (flat ? 0.03 : 0.025), 0.01); this.noBtn.label.mesh.position.set(flat ? 0.2 : 0.24, y - (flat ? 0.03 : 0.025), 0.01);
    this.tutorial.mesh.position.set(0, flat ? 0.29 : -0.25, 0.01);
  }
  private session(): XRSession | null { return this.world.renderer.xr.getSession(); }
  private detach(e: Entity, o: Group): void {
    if (e.hasComponent(XRAnchor)) e.removeComponent(XRAnchor);
    if (o.parent !== this.world.scene) this.world.scene.attach(o);
  }
  /** Session start: restore last session's anchored desk + wall, else scan for a real table + wall. */
  private mrBegin(): void {
    this.detach(this.deskE, this.desk); this.detach(this.wallE, this.wall);
    this.wallMode = 'fallback'; this.restored = false; this.wallScale = 1; this.wall.scale.setScalar(1); this.tableYaw = null;
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
    side(this.left, 37, 0.9, -0.04); side(this.right, -31, 0.82, -0.17); side(this.testG, -36, 1.05, 0.3);
    if (this.mrFlow()) { side(this.right, -32, 0.7, -0.22); this.avoidObstacles(head); } // below the timeline's right end
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
      // square the desk to the table: face along the normal of the table edge nearest the user (if within 35° of gaze)
      let eb = 0, ed = 1e9;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ab = b.clone().sub(a);
        const t = Math.max(0, Math.min(1, fl.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()))); const dd = a.clone().addScaledVector(ab, t).distanceTo(fl); if (dd < ed) { ed = dd; eb = i; } }
      const ea = pts[eb], ee = pts[(eb + 1) % pts.length]; const en = new Vector3(-(ee.z - ea.z), 0, ee.x - ea.x).normalize();
      if (en.dot(fwd) < 0) en.negate();
      const yawE = en.dot(fwd) > Math.cos((35 * Math.PI) / 180) ? Math.atan2(-en.x, -en.z) : null;
      if (d < bestD) { bestD = d; best = at; this.tableYaw = yawE; }
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
    const head = this.mr.head!, fwd = this.mr.fwd!; const gaze = Math.atan2(-fwd.x, -fwd.z);
    const yaw = how === 'table plane' && this.tableYaw !== null ? this.tableYaw : gaze;
    this.mr.deskYaw = `${(((yaw - gaze) * 180) / Math.PI).toFixed(1)}° from gaze${yaw !== gaze ? ' (table edge)' : ''}`;
    this.desk.position.copy(at); this.desk.rotation.set(0, yaw, 0);
    this.mr.desk = how; this.placeHint.mesh.visible = false;
    // passthrough matters: on a real surface the paper tray goes away and the cards lie on the real desk
    this.tray.mesh.visible = how === 'tap' || !!this.mr.vr;
    if (!this.mr.noPlanes) for (const pe of this.queries.planes.entities) this.tryWall(pe, true);
    if (this.wallMode !== 'detected') { this.wall.position.copy(head).addScaledVector(fwd, WALL_FWD); this.wall.position.y = head.y + 0.02; this.wall.rotation.set(0, yaw, 0); }
    this.mr.wall = this.wallMode === 'detected' ? 'wall plane' : `${WALL_FWD} m ahead`;
    this.layoutSides(head, gaze);
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
      const saved = JSON.parse(localStorage.getItem(MR_KEY) ?? 'null') as { uuid: string; desk: number[]; wall: number[]; how: string; wall2: string; tray: boolean; ws?: number } | null;
      const uuid = localStorage.getItem(ANCHOR_UUID_KEY);
      // IWSDK deletes its UUID when restorePersistentAnchor fails, then makes a new one: a different UUID = a different origin
      if (!saved || (m.t > 0.3 && uuid !== saved.uuid)) { this.mrForget('anchor not restored'); return; }
      if (m.t < 1.2 || !anchored()) { if (m.t > 4) this.mrForget('anchor timeout'); return; }
      this.setPose(this.desk, saved.desk); this.setPose(this.wall, saved.wall); this.wallScale = saved.ws ?? 1; this.wall.scale.setScalar(this.wallScale);
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
        localStorage.setItem(MR_KEY, JSON.stringify({ uuid, desk: this.poseOf(this.desk), wall: this.poseOf(this.wall), how: m.desk, wall2: m.wall, tray: this.tray.mesh.visible, ws: this.wallScale }));
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
    this.placeHint.draw((g, W, H) => { panel(g, W, H, C.glassHi, C.accent, 1); text(g, '📍 Look where you want your desk, then pinch', W / 2, H / 2, 18, '#fff', 600, W - 30, 'center'); });
  }

  // ---------------------------------------------------------------- v2: Wind-down (evening ritual: recap → roll each unfinished task → close the day)
  wind: { step: number; list: string[]; kept: string[]; dropped: string[] } | null = null;
  private windPanel!: Label; private windE!: Entity; private windBtns: Btn[] = [];
  private buildWindDown(): void {
    this.windPanel = new Label(0.46, 0.25); this.windPanel.mesh.visible = false;
    (this.windPanel.mesh.material as MeshBasicMaterial).depthTest = false; this.windPanel.mesh.renderOrder = 10;
    this.windE = this.world.createTransformEntity(this.windPanel.mesh, this.deskE);
    const a = this.button('a', 0.16, () => this.windChoice(true), this.windE), b = this.button('b', 0.16, () => this.windChoice(false), this.windE);
    a.label.mesh.position.set(-0.09, -0.093, 0.004); b.label.mesh.position.set(0.09, -0.093, 0.004);
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
    queueMicrotask(() => this.drawHistory());
    const w = this.wind!; const s = this.s;
    for (const id of w.dropped) {
      s.timeline = s.timeline.filter((x) => x !== id); s.tomorrow = s.tomorrow.filter((x) => x !== id); s.stack = s.stack.filter((x) => x !== id);
      delete s.tasks[id];
    }
    s.carry = [...w.kept];
    const before = s.streak; completeDay(s); this.streakAnim = { t: 9, from: before, to: s.streak }; save(s); sfx.done();
    this.closeWind(); this.summary.mesh.visible = false; this.detailId = ''; this.syncItems(); // nothing from wind-down stays open behind the end banner
    this.agentMsg = `🌙 Day closed. ${w.kept.length ? `Tomorrow starts with ${w.kept.length} task${w.kept.length > 1 ? 's' : ''}.` : 'Nothing carried over.'} ${s.streak}-day streak.`;
    document.body.dataset.wind = 'closed'; this.redrawAll();
  }
  private drawWind(): void {
    const w = this.wind; if (!w) return; const s = this.s; const n = w.list.length;
    const [la, lb] = w.step === 0 ? ['Next →', '✕ Close'] : w.step <= n ? ['→ Tomorrow', '✕ Drop'] : ['✓ Close day', '← Back'];
    this.windBtns.forEach((b, i) => {
      const t = i ? lb : la; b.label.mesh.userData.btn = t;
      b.label.draw((g, W, H) => { panel(g, W, H, i ? C.glassLo : C.glassHi, i ? undefined : C.accent, 1); text(g, t, W / 2, H / 2, 21, '#fff', 600, W - 16, 'center'); });
    });
    this.windPanel.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.sky, 1);
      text(g, '🌙 Wind down', 28, 30, 23, C.ink, 700);
      text(g, w.step === 0 ? 'step 1 · today' : w.step <= n ? `step 2 · roll over ${w.step} of ${n}` : 'step 3 · tomorrow', W - 24, 30, 14, C.mute, 600, W, 'right');
      if (w.step === 0) {
        const sched = s.timeline.filter((id) => s.tasks[id]); const done = sched.filter((id) => s.tasks[id].done).length;
        const lines: [string, string][] = [
          ['Done today', `${done} of ${sched.length} scheduled`],
          ['Focus time', dur(s.focusMinutes ?? 0)],
          ['Unfinished', n ? `${n} task${n > 1 ? 's' : ''}` : 'none'],
        ];
        lines.forEach(([k, v], i) => { text(g, k, 28, 72 + i * 28, 18, C.mute, 600); text(g, v, 170, 72 + i * 28, 18, C.ink, 700, W - 190); });
        para(g, n ? 'Next: decide, one by one, what rolls into tomorrow.' : 'Everything scheduled is done.', 28, 146, 15, W - 56, C.sageDeep);
      } else if (w.step <= n) {
        const t = s.tasks[w.list[w.step - 1]];
        text(g, t.title, 28, 78, 26, C.ink, 700, W - 56);
        text(g, `${dur(t.minutes)} · ${['', 'must do', 'should do', 'nice to have'][t.priority]}`, 28, 112, 17, C.sageDeep, 600, W - 56);
        text(g, 'Roll into tomorrow?  👍 keep · 👎 drop', 28, 146, 16, C.mute, 500, W - 56);
      } else {
        const titles = w.kept.map((id) => s.tasks[id]?.title).filter(Boolean);
        text(g, titles.length ? 'Tomorrow starts with:' : 'Tomorrow starts fresh.', 28, 70, 18, C.ink, 700, W - 56);
        titles.slice(0, 3).forEach((t, i) => text(g, `${i + 1}. ${t}`, 38, 98 + i * 24, 17, C.ink, 500, W - 70));
        if (titles.length > 3) text(g, `+${titles.length - 3} more`, 38, 98 + 3 * 24, 15, C.mute, 500);
        if (w.dropped.length) text(g, `Dropped: ${w.dropped.length}`, W - 24, 70, 15, C.mute, 500, W, 'right');
      }
    });
  }

  /** Real-object boxes from mesh detection (screen, lamp, shelves…), in front of the head; excludes room shell + the desk itself. */
  private obstacleBoxes(head: Vector3, fwd: Vector3): Box3[] {
    const frame = this.world.renderer.xr.getFrame() as (XRFrame & { detectedMeshes?: Set<{ meshSpace: XRSpace; vertices: Float32Array; semanticLabel?: string }> }) | null;
    const ref = this.world.renderer.xr.getReferenceSpace(); const out: Box3[] = [];
    if (!frame?.detectedMeshes || !ref) return out;
    for (const m of frame.detectedMeshes) {
      if (['global mesh', 'desk', 'table', 'floor', 'ceiling', 'wall', 'window', 'door', 'wall art'].includes(m.semanticLabel ?? '')) continue;
      const pose = frame.getPose(m.meshSpace, ref); if (!pose) continue;
      const M = new Matrix4().fromArray(pose.transform.matrix); const b = new Box3(); const v = new Vector3();
      for (let i = 0; i < m.vertices.length; i += 3) b.expandByPoint(v.set(m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]).applyMatrix4(M));
      const c = b.getCenter(new Vector3()); if (b.containsPoint(head) || c.clone().sub(head).dot(fwd) < 0.1) continue; // behind / around the user (chair)
      out.push(b.expandByScalar(0.02));
    }
    // IWER home_office only: its desk lamp is not in the emulated mesh list, so add its known box (emulator-specific, see hide-lamp.ts)
    if ((window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE && out.length) out.push(new Box3(new Vector3(LAMP.minX, LAMP.minY, LAMP.minZ), new Vector3(LAMP.maxX, LAMP.maxY, LAMP.maxZ)));
    return out;
  }
  /** Is any corner of this panel hidden behind a real object (as seen from the head)? */
  private occluded(m: Mesh, head: Vector3, boxes: Box3[]): boolean {
    m.updateMatrixWorld(true);
    const g = (m.geometry as PlaneGeometry).parameters; const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([x, y]) => new Vector3(x * g.width / 2, y * g.height / 2, 0).applyMatrix4(m.matrixWorld));
    const ray = new Ray(); const hit = new Vector3();
    return pts.some((p) => { ray.set(head, p.clone().sub(head).normalize()); return boxes.some((b) => !!ray.intersectBox(b, hit) && hit.distanceTo(head) < p.distanceTo(head) - 0.01); });
  }
  /** v2 MR: keep panels clear of real objects. Planner card + Keep/Undo move onto the real desk (in front of e.g. a monitor);
   *  the Pending board comes closer until nothing real sits in front of it. Uses mesh-detection bounds when available. */
  private avoidObstacles(head: Vector3): void {
    const fwd = this.mr.fwd ?? new Vector3(0, 0, -1);
    this.wall.updateMatrixWorld(true); this.desk.updateMatrixWorld(true); this.right.updateMatrixWorld(true);
    // start from the wall layout every time (Re-place can make the room clear again)
    if (this.agentPanel.mesh.parent !== this.wall) {
      this.wall.add(this.agentPanel.mesh); this.wall.add(this.yesBtn.label.mesh); this.wall.add(this.noBtn.label.mesh);
      this.agentPanel.mesh.position.set(-0.15, 0.31, 0.01); this.agentPanel.mesh.rotation.set(0, 0, 0);
      this.yesBtn.label.mesh.position.set(0.24, 0.335, 0.01); this.noBtn.label.mesh.position.set(0.24, 0.285, 0.01);
      this.yesBtn.label.mesh.rotation.set(0, 0, 0); this.noBtn.label.mesh.rotation.set(0, 0, 0);
    }
    const boxes = this.obstacleBoxes(head, fwd); this.mr.blocked = boxes.length ? '' : 'no meshes';
    if (!boxes.length) return;
    if (false as boolean) { // v2.1: the planner stays above the timeline header (clear of monitor + stand); no desk relocation
      // stand the planner card up at the back of the real desk, ~1.5 cm above it, tilted toward the user; Keep/Undo beside it
      this.desk.add(this.agentPanel.mesh); this.agentPanel.mesh.position.set(-0.07, 0.11, -0.2); this.agentPanel.mesh.rotation.set(-0.35, 0, 0);
      this.desk.add(this.yesBtn.label.mesh); this.desk.add(this.noBtn.label.mesh);
      this.yesBtn.label.mesh.position.set(0.28, 0.135, -0.19); this.noBtn.label.mesh.position.set(0.28, 0.085, -0.18);
      this.yesBtn.label.mesh.rotation.set(-0.35, 0, 0); this.noBtn.label.mesh.rotation.set(-0.35, 0, 0);
      this.mr.blocked += 'planner→desk ';
    }
    const fr = this.right.getWorldPosition(new Vector3()); const dir = fr.clone().sub(head); const d0 = dir.length(); dir.normalize();
    for (let d = d0; d >= 0.45; d -= 0.05) {
      this.right.position.copy(head).addScaledVector(dir, d); this.right.updateMatrixWorld(true);
      if (!this.right.children.some((c) => c instanceof Mesh && this.occluded(c, head, boxes))) {
        if (d < d0) this.right.position.copy(head).addScaledVector(dir, Math.max(0.45, d - 0.06)); // a few cm of air in front of the object
        break;
      }
      this.mr.blocked += '·';
    }
  }

  // ---------------------------------------------------------------- items
  private button(t: string, w: number, action: () => void, parent: Entity): Btn {
    const label = new Label(w, 0.042);
    label.draw((g, W, H) => {
      panel(g, W, H, C.glassHi, C.accent, 1);
      let size = 22; g.font = `600 ${size}px ${FONT}`; while (g.measureText(t).width > W - 20 && size > 12) { size--; g.font = `600 ${size}px ${FONT}`; }
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
  private modalKey = ''; private modalHidden: Mesh[] = [];
  private occl(e: Entity): void { if (!new URLSearchParams(location.search).has('depth')) return; // occlusion opt-in (?depth=1) until it ships
    if (!e.hasComponent(DepthOccludable)) e.addComponent(DepthOccludable, { mode: OcclusionShadersMode.SoftOcclusion }); }
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
      this.occl(entity);
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
      return { w: w * this.wallScale, h: TRACK_H * this.wallScale, visible: true };
    }
    if (place === 'tomorrow') {
      const i = s.tomorrow.indexOf(it.id);
      out.set(-TRACK_W / 2 + 0.1 + i * 0.17, -0.37, 0.006); this.wall.localToWorld(out); this.wall.getWorldQuaternion(outQ);
      return { w: 0.16 * this.wallScale, h: 0.045 * this.wallScale, visible: true };
    }
    if (place === 'skipped') {
      out.set(0.7, -0.2, 0); this.desk.localToWorld(out); this.desk.getWorldQuaternion(outQ);
      return { w: CARD_W, h: CARD_H, visible: false };
    }
    const onDesk = s.stack.filter((id) => s.tasks[id].priority === 1);
    if (s.tasks[it.id].priority !== 1) {
      const j = s.stack.filter((id) => s.tasks[id].priority !== 1).indexOf(it.id);
      out.set(-0.1 + (j % 2) * 0.2 * (this.mrFlow() ? 1.05 : 1), 0.065 - Math.floor(j / 2) * (this.mrFlow() ? 0.13 : 0.12), 0.004); this.right.localToWorld(out); this.right.getWorldQuaternion(outQ);
      return { w: CARD_W, h: CARD_H, visible: true };
    }
    const i = onDesk.indexOf(it.id);
    const col = i % 3, row = Math.floor(i / 3);
    out.set(-0.17 + col * 0.165, 0.035 + row * 0.005 + (this.mrFlow() ? 0.015 : 0), 0.07 - row * 0.1); this.desk.localToWorld(out); // MR: ~1.5 cm clear of the real desk
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
        panel(g, W, H, t.done ? '#1C2A22' : C.glass, over ? C.warn : C.prio[t.priority], t.done ? 0.7 : 0.95);
        if (W < 120) {
          // narrow block: no clipped words, just a glyph + duration (full title shows on hover)
          text(g, t.done ? '✓' : iconFor(t.title), W / 2, H * 0.38, Math.min(45, W * 0.6), C.ink, 400, W, 'center');
          const ds = dur(t.minutes); let fs = 27; g.font = `600 ${fs}px ${FONT}`; while (fs > 10 && g.measureText(ds).width > W - 8) { fs--; g.font = `600 ${fs}px ${FONT}`; }
          text(g, ds, W / 2, H * 0.72, fs, C.ink, 600, W, 'center'); // fit, never ellipsised
        } else {
          const lines = this.wrap(g, `${t.done ? '✓ ' : ''}${t.title}`, W - 18, 32, 2);
          lines.forEach((ln, i) => text(g, ln, 10, H * (lines.length > 1 ? 0.22 + i * 0.27 : 0.32), 32, C.ink, 700, W - 16));
          text(g, `${fmt(this.s.dayStart + this.slotStart(it.id))} · ${t.done ? `${dur(t.actual ?? t.minutes)} of ${dur(t.minutes)}` : dur(t.minutes)}`, 10, H * 0.82, 27, C.ink, 500, W - 16);
        }
      } else {
        panel(g, W, H, C.glass, C.prio[t.priority], 1);
        text(g, `→ ${t.title}`, 24, H / 2, 15, C.ink, 600, W - 30);
      }
    });
  }
  /** Word-wrap to at most `max` lines (last line ellipsised by text()). */
  private wrap(g: CanvasRenderingContext2D, s: string, maxW: number, size: number, max: number): string[] {
    g.font = `600 ${size}px ${FONT}`;
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
  private buildTest(): void {
    const te = this.world.createTransformEntity(this.testG, { persistent: true });
    try { this.testTicks = JSON.parse(localStorage.getItem(TEST_KEY) ?? '{}'); } catch { /* fresh */ }
    this.testHead = new Label(0.62, 0.07); this.testHead.mesh.position.set(0, 0.2, 0); this.testHead.mesh.position.y = 0.19; this.testG.add(this.testHead.mesh);
    TEST_ITEMS.forEach((name, i) => {
      const b = this.button(name, 0.19, () => { this.testTicks[name] = !this.testTicks[name]; localStorage.setItem(TEST_KEY, JSON.stringify(this.testTicks)); draw(); sfx.yes(); }, te);
      b.label.resize(0.3, 0.05);
      const draw = () => b.label.draw((g, W, H) => { const on = !!this.testTicks[name]; panel(g, W, H, on ? '#1C3A26' : C.glassHi, on ? '#8FD1A5' : C.mute, 1);
        text(g, on ? '☑' : '☐', 24, H / 2, 18, '#fff', 700);
        // full label, wrapped to two lines (shrinks until it fits; never ellipsised)
        let sz = 16, ln = this.wrap(g, name, W - 58, sz, 2); const fits = () => ln.every((x) => { g.font = `600 ${sz}px ${FONT}`; return g.measureText(x).width <= W - 58; });
        while (!fits() && sz > 11) { sz--; ln = this.wrap(g, name, W - 58, sz, 2); }
        ln.forEach((x, k) => text(g, x, 42, H / 2 + (k - (ln.length - 1) / 2) * (sz + 3), sz, '#fff', 600, 9999)); });
      draw(); b.label.mesh.position.set(i < 8 ? -0.155 : 0.155, 0.13 - (i % 8) * 0.055, 0.004);
    });
    this.drawFps();
  }
  /** fps avg / min over the last 10 one-second buckets, plus draw calls and triangles (renderer.info). */
  private drawFps(): void {
    if (!this.testHead) return;
    const b = this.fpsB, avg = b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0, min = b.length ? Math.min(...b) : 0;
    const info = this.world.renderer.info.render; const done = TEST_ITEMS.filter((n) => this.testTicks[n]).length;
    this.testHead.draw((g, W, H) => { panel(g, W, H, C.glass, min >= 60 ? '#8FD1A5' : C.warn, 1);
      text(g, `🧪 ${avg.toFixed(0)} fps avg · ${min.toFixed(0)} min (10 s) · ${info.calls} calls · ${done}/${TEST_ITEMS.length} ✓`, 22, H / 2, 24, '#fff', 700, W - 30); });
  }
  /** Focus-panel button alternative to pinch-dragging a card onto the wall timeline (appends it). */
  private planFromFocus(): void {
    const id = this.focus?.id; if (!id) return; this.endFocus(false);
    const s = this.s, strip = (a: string[]) => a.filter((x) => x !== id);
    s.stack = strip(s.stack); s.tomorrow = strip(s.tomorrow); s.skipped = strip(s.skipped); s.timeline = [...strip(s.timeline), id];
    sfx.drop(); this.tutEvent('drop'); this.commit();
  }
  /** Focus-panel button alternative to the sideways flick (skip for today). */
  private skipFromFocus(): void {
    const id = this.focus?.id; if (!id) return; this.endFocus(false);
    const s = this.s, strip = (a: string[]) => a.filter((x) => x !== id);
    s.stack = strip(s.stack); s.timeline = strip(s.timeline); s.tomorrow = strip(s.tomorrow); s.skipped.push(id);
    sfx.skip(); this.tutEvent('skip'); this.commit();
  }
  toggleSample(): void {
    this.sampleWeek = !this.sampleWeek; const t = `Sample week (demo data): ${this.sampleWeek ? 'on' : 'off'}`;
    this.sampleBtn.label.mesh.userData.btn = t;
    this.sampleBtn.label.draw((g, W, H) => { panel(g, W, H, this.sampleWeek ? '#3A2A10' : C.glassHi, C.accent, 1); let sz = 18; g.font = `600 ${sz}px ${FONT}`; while (g.measureText(t).width > W - 24 && sz > 11) { sz--; g.font = `600 ${sz}px ${FONT}`; } text(g, t, W / 2, H / 2, sz, '#fff', 600, 9999, 'center'); });
    const el = document.getElementById('btn-sample'); if (el) el.textContent = t;
    this.history.mesh.visible = true; this.histT = 25; this.syncHistBtns(); this.drawHistory();
  }
  private syncHistBtns(): void {
    this.sampleBtn.label.mesh.visible = this.history.mesh.visible;
    const el = document.getElementById('btn-sample'); if (el) el.style.display = this.history.mesh.visible ? '' : 'none';
  }
  toggleContrast(): void {
    setContrast(!HC.on); document.body.dataset.contrast = HC.on ? '1' : '0';
    for (const l of Label.all) l.redraw();
    for (const it of this.items.values()) it.drawnKey = '';
    this.redrawAll(); this.drawHistory();
    const el = document.getElementById('btn-contrast'); if (el) el.textContent = HC.on ? '◐ Contrast: on' : '◐ Contrast';
  }
  /** Last 7 days, measured only: done count + focus minutes per closed day; blank days stay blank. */
  private drawHistory(): void {
    const SAMPLE = [[3, 50], null, [2, 25], [4, 95], null, [1, 25], [3, 75]] as ([number, number] | null)[];
    const wk = this.sampleWeek ? lastWeek(this.s).map((x, i) => ({ d: x.d, log: SAMPLE[i] ? { d: x.d, done: SAMPLE[i]![0], focus: SAMPLE[i]![1] } : null })) : lastWeek(this.s);
    const logs = wk.filter((x) => x.log); const title = this.sampleWeek ? 'Sample week (demo data)' : 'Last 7 days';
    this.history.draw((g, W, H) => {
      panel(g, W, H, this.sampleWeek ? '#2A2010' : C.paper, C.accent, 0.95);
      const tot = logs.reduce((a, x) => a + x.log!.focus, 0), done = logs.reduce((a, x) => a + x.log!.done, 0);
      text(g, title, 28, 24, 16, this.sampleWeek ? C.accent : C.ink, 700, W - 40);
      if (!this.sampleWeek) text(g, `${done} done · ${dur(tot)} focus · ${logs.length}/7 days`, W - 18, 24, 12, C.mute, 500, this.sampleWeek ? W - 250 : W - 150, 'right');
      const max = Math.max(1, ...logs.map((x) => x.log!.focus));
      const cw = (W - 56) / 7;
      wk.forEach((x, i) => {
        const cx = 28 + i * cw + cw / 2, base = H - 26;
        if (x.log) { const h = Math.max(4, (H - 74) * x.log.focus / max); g.fillStyle = C.accent; g.beginPath(); g.roundRect(cx - cw * 0.3, base - h, cw * 0.6, h, 4); g.fill();
          text(g, `${x.log.done}✓`, cx, base - h - 10, 12, C.ink, 600, cw, 'center'); }
        else { g.fillStyle = C.mute; g.fillRect(cx - cw * 0.3, base - 2, cw * 0.6, 2); }
        text(g, 'SMTWTFS'[new Date(x.d + 'T12:00:00Z').getUTCDay()], cx, H - 12, 11, C.mute, 600, cw, 'center');
      });
    });
  }
  /** Streak is a plain day count (v2: no plant / growth reward). */
  private drawStreak(): void {
    this.streakLabel.draw((g, W, H) => { panel(g, W, H, C.paper); const st = this.s.streak ? `${this.s.streak}-day streak` : 'Start your streak today'; let fz = 15; g.font = `600 ${fz}px ${FONT}`; while (g.measureText(st).width > W - 14 && fz > 10) { fz--; g.font = `600 ${fz}px ${FONT}`; } text(g, st, W / 2, H / 2, fz, C.sageDeep, 600, 9999, 'center'); });
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
    sfx.timer();
    document.body.dataset.focus = id; // test/automation hook, not rendered
    this.focus = { id, length: 25, t0: performance.now(), base: 0, phase: 'run', shown: '' };
    this.focusPanel.mesh.visible = true; this.focusPanel.mesh.scale.setScalar(0.8);
    this.focusBtns[5].label.mesh.visible = this.placeOf(id) !== 'timeline';
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
    const w = !!this.wind;
    (this.dim.material as MeshBasicMaterial).opacity += ((f || w ? 0.55 : 0) - (this.dim.material as MeshBasicMaterial).opacity) * k;
    for (const m of this.deskRow) m.visible = !f && !w && !this.summary.mesh.visible;
    // Wind-down: same calm as Focus: dim the room, fade every other panel, hide the progress strip
    if (w !== this.windDimmed) {
      this.windDimmed = w; this.dim.visible = w || !!f;
      const fade = (m: Mesh) => { const mat = m.material as MeshBasicMaterial; mat.transparent = true; mat.opacity = w ? 0.2 : 1; };
      for (const it of this.items.values()) fade(it.label.mesh);
      for (const l of [this.header, this.agentPanel, this.meetBoard, this.pendHeader, this.streakLabel, this.tray]) fade(l.mesh);
      for (const b of [this.yesBtn, this.noBtn]) fade(b.label.mesh);
      for (const l of this.meetingLabels) fade(l.mesh);
    }
    if (w) { this.progress.mesh.visible = false; this.dim.position.copy(new Vector3().setFromMatrixPosition(this.headCam().matrixWorld)); }
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
      if (FOCUS_ACCEL > 1) text(g, `⏩ Demo: 1 s = ${FOCUS_ACCEL / 60} min (accelerated)`, 132, 34, 13, C.accent, 700, W - 132 - 96);
      text(g, t.title, 36, 72, 28, C.ink, 700, W - 140);
      const mm = Math.floor(left), ss = Math.floor((left - mm) * 60);
      text(g, ask ? 'Done or more time?' : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, W / 2, H * 0.43, ask ? 40 : 64, ask ? C.accent : C.ink, 700, W - 40, 'center');
      g.fillStyle = C.glassLo; g.beginPath(); g.roundRect(36, H * 0.55, W - 72, 10, 5); g.fill();
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
      g.fillStyle = C.glassLo; g.beginPath(); g.roundRect(220, ys - 7, W - 260, 14, 7); g.fill();
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
      this.tutorial.draw((g, W, H) => { panel(g, W, H, C.glassHi, C.accent, 1); text(g, '🌿 You\'re ready. Plan your morning!', W / 2, H / 2, 24, '#fff', 600, W - 30, 'center'); });
      setTimeout(() => this.endTutorial(), 2500); this.tutStep = 99; return;
    }
    this.tutorialStep();
  }
  private tutorialStep(): void {
    const i = this.tutStep; const st = MorningDeskSystem.TUT[i]; if (!st) return;
    this.tutorial.draw((g, W, H) => {
      panel(g, W, H, C.glassHi, C.accent, 1);
      para(g, st.msg, 26, 18, 22, W - 60, '#fff');
      text(g, `${i + 1}/5 · tap here to skip`, W - 22, H - 18, 19, C.mute, 600, W, 'right');
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
    { const n = this.s.stack.filter((id) => this.s.tasks[id]?.priority !== 1).length, rows = Math.max(1, Math.ceil(n / 2)), step = this.mrFlow() ? 0.13 : 0.12;
      const y = 0.065 - (rows - 1) * step - 0.045 - 0.04; for (const m of this.chips) m.position.y = y; } // chips sit just under the last Pending row
    const s = this.s; const ms = s.meetings ?? []; const sl = layout(s).slots;
    const clash = new Set(Object.values(sl).map((x) => x.clash?.id).filter(Boolean));
    this.meetBoard.draw((g, W, H) => {
      panel(g, W, H, C.paper, C.sky, 0.95);
      text(g, '📅 Meetings', 34, 36, 24, C.ink, 700);
      if (!ms.length) text(g, 'No meetings today', 34, 84, 18, C.mute, 500);
      ms.forEach((m, i) => {
        const y = 84 + i * 80;
        text(g, `${fmt(m.start)}–${fmt(m.start + m.minutes)}`, 34, y, 18, C.sageDeep, 700);
        text(g, m.title, 34, y + 24, 20, C.ink, 600, W - 60);
        if (clash.has(m.id)) text(g, '⚠ a task runs into this', 34, y + 50, 16, C.accent, 700, W - 60);
      });
      text(g, 'Fixed times', 34, H - 24, 18, C.mute, 600, W - 50);
    });
    const tasks = [...s.timeline, ...s.tomorrow, ...s.stack].filter((id) => s.tasks[id]);
    const done = s.timeline.filter((id) => s.tasks[id].done);
    this.progress.mesh.visible = done.length > 0 && !this.wind;
    this.progress.draw((g, W, H) => {
      panel(g, W, H, '#ffffff', undefined, 0.5);
      text(g, `✓ Completed ${done.length}/${tasks.length}${done.length ? ': ' + done.map((id) => s.tasks[id].title).join(', ') : ''}`, 24, H * 0.36, 20, C.sageDeep, 700, W - 48);
      g.fillStyle = C.glassLo; g.beginPath(); g.roundRect(24, H * 0.66, W - 48, 10, 5); g.fill();
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
        g.fillStyle = '#2B3A55'; g.globalAlpha = 0.9; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 14); g.fill(); g.globalAlpha = 1;
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
      if (DEBUG) text(g, this.mrFlow() && this.mr.phase !== 'idle' ? this.mrStatus() : this.wallMode === 'detected' ? (this.restored ? '📍 restored on your wall' : '📍 pinned to your wall') : `📍 no wall found: timeline placed ${WALL_FWD} m ahead`, 34, H * 0.74, 17, C.mute, 500, W * 0.55);
      text(g, over ? `⚠ ${dur(tot)} planned / ${dur(av)} free` : `${dur(tot)} / ${dur(av)}`, W - 30, H / 2, 24, over ? C.accent : C.sageDeep, 700, W, 'right');
    });
  }
  private redrawAgent(): void {
    const show = !!this.pending; this.agentDrawn = this.agentMsg;
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
      if (iwer && !hq.has('controllers') && !hq.has('autoplay')) iwer.primaryInputMode = 'hand'; // hands by default (?controllers=1 opts out)
      void this.enterXR();
    });
    bind('btn-plan', () => this.runAgent(true));
    bind('btn-done', () => (WIND_DOWN ? this.openWindDown() : this.finishDay()));
    if (WIND_DOWN) { const el = document.getElementById('btn-done'); if (el) el.textContent = '🌙 Wind down'; }
    bind('btn-tutorial', () => this.startTutorial());
    bind('btn-demo', () => this.reset(true));
    bind('btn-contrast', () => this.toggleContrast());
    bind('btn-sample', () => this.toggleSample());
    bind('btn-history', () => { this.drawHistory(); this.history.mesh.visible = !this.history.mesh.visible; this.histT = this.history.mesh.visible ? 25 : 0; this.syncHistBtns(); });
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
    this.tip.draw((g, W, H) => { panel(g, W, H, C.glassHi, C.accent, 0.95); text(g, `${t.title} · ${fmt(this.s.dayStart + this.slotStart(id))} · ${dur(t.minutes)}`, W / 2, H / 2, 17, '#fff', 600, W - 20, 'center'); });
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
    localStorage.setItem(IS_DEMO ? 'morning-desk.demo.wallAnchor' : 'morning-desk.wallAnchor', JSON.stringify([...this.wall.position.toArray(), ...this.wall.quaternion.toArray()]));
  }

  /** micro-animation: a picked-up card scales up ~12 % while held. */
  private liftScale(it: Item, k: number): void { const s = it.label.mesh.scale.x; it.label.mesh.scale.setScalar(s + (1.12 - s) * k); }
  // ---------------------------------------------------------------- frame
  update(delta: number): void {
    // v2.1 MR stack-up: while Focus or Wind down is open, the wall boards step aside so no two panels overlap;
    // idle planner header (nothing pending, no message) is hidden in MR
    { const mrOn = this.mrFlow(); const modal = mrOn && (!!this.focus || !!this.wind || !!this.wake?.moodShown()); // mood check: like Wind down, side board + desk cards step aside
      const focusOn = mrOn && !!this.focus; // Focus hides all boards; Wind down keeps the timeline + meetings visible (panel sits below the timeline)
      for (const e of [this.leftE, this.wallE]) if (e?.object3D) e.object3D.visible = !focusOn;
      if (this.rightE?.object3D) this.rightE.object3D.visible = !modal;
      this.agentPanel.mesh.visible = !modal && (!mrOn || !!this.pending || !!this.agentDrawn);
      // cards: Focus hides every card, Wind down hides the Pending ones (timeline stays); edge-triggered so other visibility rules keep working
      const key = focusOn ? 'focus' : modal ? 'wind' : '';
      if (key !== this.modalKey) { for (const m of this.modalHidden) m.visible = true; this.modalHidden = [];
        this.modalKey = key; } }
    // flat page: widen the camera's field of view on narrow/tall windows so the whole layout fits (≈84° across)
    if (!this.inXR()) { const cam = this.world.camera as unknown as { aspect: number; fov: number; updateProjectionMatrix(): void };
      if (cam.aspect && cam.aspect !== this.flatFovAspect) { this.flatFovAspect = cam.aspect; cam.fov = Math.max(50, (2 * Math.atan(Math.tan((42 * Math.PI) / 180) / cam.aspect) * 180) / Math.PI); cam.updateProjectionMatrix(); } }
    else this.flatFovAspect = 0;
    if (TEST && !this.inXR() && this.fpsShowT === 0 && this.fpsB.length) { const b = this.fpsB; const h = document.getElementById('hint'); if (h) h.textContent = `🧪 test: ${(b.reduce((a, x) => a + x, 0) / b.length).toFixed(0)} fps avg · ${Math.min(...b).toFixed(0)} min (10 s) · checklist is in XR`; }
    if (TEST) { this.fpsCur++; this.fpsT += delta; this.fpsShowT += delta;
      if (this.fpsT >= 1) { this.fpsB.push(this.fpsCur / this.fpsT); if (this.fpsB.length > 10) this.fpsB.shift(); this.fpsCur = 0; this.fpsT = 0; }
      if (this.fpsShowT >= 0.5) { this.fpsShowT = 0; this.drawFps(); } }
    if (this.histT > 0) { this.histT -= delta; if (this.histT <= 0) { this.history.mesh.visible = false; this.syncHistBtns(); } }
    if (this.placeDelay > 0) this.placeDelay -= delta;
    else if (!this.placed) this.place();
    const out = this.tmp2, outQ = this.tmpQ;
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
          this.markerAt(this.wallSlot(p)); this.liftScale(it, k); continue;
        }
        this.endDrag();
      }
      if (this.mouseDrag?.id === it.id) { this.liftScale(it, k); continue; }
      const tgt = this.target(it, out, outQ);
      const place = this.placeOf(it.id);
      this.drawItem(it, place, tgt.w, tgt.h);
      it.label.mesh.visible = tgt.visible && !(this.modalKey && (this.modalKey === 'focus' || this.placeOf(it.id) !== 'timeline'));
      const hov = this.hoverId === it.id || it.entity.hasComponent(Hovered);
      if (hov) out.add(this.tmp.set(0, 0, 0.018).applyQuaternion(outQ)); // lift toward the user
      it.label.mesh.position.lerp(out, k);
      it.label.mesh.quaternion.slerp(outQ, k);
      // micro-animation: a soft bounce when a card snaps into a new place (timeline / desk / tomorrow)
      if (place !== it.place) { if (it.place) it.snap = 0; it.place = place; }
      let bounce = 0;
      if (it.snap !== undefined) { it.snap += delta; const t = it.snap; bounce = t < 0.6 ? 0.09 * Math.exp(-t * 7) * Math.sin(t * 22) : 0; if (t >= 0.6) it.snap = undefined; }
      const sc = it.label.mesh.scale.x + ((hov ? 1.07 : 1) - it.label.mesh.scale.x) * k;
      it.label.mesh.scale.setScalar(it.snap !== undefined ? 1 + bounce : sc);
      if (this.wake?.busy()) it.label.mesh.scale.multiplyScalar(Math.max(0.001, this.wake.cardK(it.id))); // step 1: cards appear one by one
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
    // steps 1-2: wake once the desk + wall are placed this session
    if (this.wake) { if (!this.inXR()) { if (this.wake.started()) this.wake.reset(); } // once per XR session (Re-place does not replay it)
      else if (!this.wake.started() && this.wakeOn() && this.mr.phase === 'done') this.wake.start();
      this.wake.update(delta); }
    if (this.replaceBtn) this.replaceBtn.label.mesh.visible = this.mrFlow() && this.mr.phase === 'done' && !this.mr.vr;
    // agent acts on its own after a short beat
    if (this.agentTimer > 0 && !this.wake?.busy() && !this.wake?.moodShown()) { this.agentTimer -= delta; if (this.agentTimer <= 0 && !this.pending) this.runAgent(); }
    // tutorial
    if (this.tutorial.mesh.visible) { const t = this.tutorial.mesh.scale.x; this.tutorial.mesh.scale.setScalar(t + (1 - t) * k); }
    // the level root marks children matrixAutoUpdate=false; our objects move every frame, so keep them live
    const live = (o: { matrixAutoUpdate: boolean; children: unknown[] }) => { o.matrixAutoUpdate = true; for (const c of o.children) live(c as typeof o); };
    live(this.desk); live(this.wall); live(this.left); live(this.right); for (const it of this.items.values()) it.label.mesh.matrixAutoUpdate = true;
  }
}
