/**
 * ?demo=1&autoplay=1&mr=1 — v2 filming pass (deterministic). Same rules as autoplay.ts: it drives the REAL app through
 * the IWER emulator's hands (poke, pinch, thumbs); the app's own input code decides every outcome.
 * Order: MR placement (real table + real wall) → exit + re-enter XR (anchor restore) → lean aside + poke 📍 Re-place → one Focus block → 🌙 Wind down → close day.
 */
import { Quaternion, Vector3, VisibilityState, type World } from '@iwsdk/core';
import { selectHandsInToolbar } from './autoplay.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V3 = [number, number, number];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Move the emulated head sideways (what Shift+A/D does in IWER). */
function leanEmulatedHead(dx: number): void {
  const dev = (window as any).IWER_DEVICE; if (!dev) return;
  for (const k of Object.getOwnPropertySymbols(dev)) {
    const l = dev[k]?.devui?.inputLayer; if (l?.playerRig && l.combinedCameraPosition) { l.playerRig.position.x += dx; l.combinedCameraPosition.x += dx; return; }
  }
}

export async function runAutoplayV2(sys: any, world: World): Promise<void> {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:56px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#2f3a36e6;color:#f4efe4;font:600 15px system-ui,sans-serif;padding:8px 16px;border-radius:16px;pointer-events:none;display:flex;gap:10px;align-items:center';
  const tag = document.createElement('span'); tag.textContent = '▶ autoplay demo · v2'; tag.style.cssText = 'background:#9cbf9b;color:#2f3a36;border-radius:10px;padding:2px 8px;font-size:12px;display:none'; // pill never shown in filming runs (text kept for test scripts)
  el.append(tag, document.createElement('span')); document.body.append(el);
  const say = (t: string) => { el.lastChild!.textContent = t; };
  const dev = (window as any).IWER_DEVICE;
  if (!dev) { say('needs the IWER emulator (desktop browser)'); return; }
  sys.noAutoAgent = true;
  localStorage.removeItem('morning-desk.demo.mr.v2'); // deterministic (demo key only; real anchors untouched): always place from scratch
  say('starting…');
  dev.primaryInputMode = 'hand';
  await sys.enterXR();
  for (let i = 0; i < 50 && world.visibilityState.value === VisibilityState.NonImmersive; i++) await sleep(100);
  const until = async (cond: () => boolean, ms: number) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await sleep(30); return cond(); };
  await until(() => sys.mr.phase === 'done', 8000);
  await selectHandsInToolbar(); dev.primaryInputMode = 'hand'; await sleep(600);

  const R = dev.hands.right, L = dev.hands.left;
  const head = () => sys.headCam().getWorldPosition(new Vector3());
  const H = (dx: number, dy: number, dz: number): V3 => { const h = head(); return [h.x + dx, h.y + dy, h.z + dz]; };
  let cur: V3 = H(-0.05, -0.36, -0.22);
  const pin = (h: any, p: V3, rot?: number[]) => h.setPin(rot ? { anchor: 'wrist', target: p, wristRotation: rot } : { anchor: 'grasp', target: p });
  pin(L, H(-0.22, -0.55, -0.2));
  const tween = async (ms: number, fn: (k: number) => void) => { const t0 = performance.now(); for (;;) { const t = Math.min(1, (performance.now() - t0) / ms); fn(ease(t)); if (t >= 1) return; await sleep(16); } };
  const lerp3 = (a: V3, b: V3, k: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as V3;
  const move = async (to: V3, ms = 1000) => { const from = cur; await tween(ms, (k) => pin(R, lerp3(from, to, k))); cur = to; };
  const pinch = async (v: number, ms = 120) => { const from = R.pinchValue ?? 0; await tween(ms, (k) => R.updatePinchValue(from + (v - from) * k)); };
  const posOf = (o: any): V3 => o.getWorldPosition(new Vector3()).toArray() as V3;
  const button = (name: string) => [...sys.buttons.values()].find((b: any) => b.label.mesh.visible && b.label.mesh.userData.btn?.includes(name));
  const snap = () => JSON.stringify([!!sys.focus, sys.mr.phase, sys.wind?.step ?? -1, sys.s.streak, sys.agentMsg, document.body.dataset.wind ?? '', sys.optId, document.body.dataset.optDone ?? '']);
  const press = async (name: string) => {
    let b = button(name); const tw0 = performance.now(); // retry: at a low frame rate boards/buttons can take a while to reappear
    while (!b && performance.now() - tw0 < 30000) { say(`(waiting for "${name}"…)`); await sleep(500); b = button(name); }
    if (!b) throw new Error(`button "${name}" not found after 30 s`);
    const p = posOf(b.label.mesh);
    const n = new Vector3(0, 0, 1).applyQuaternion(b.label.mesh.getWorldQuaternion(new (b.label.mesh.quaternion.constructor)())).toArray() as V3;
    const off = (d: number): V3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
    const tip = (q: V3) => R.setPin({ anchor: 'index-tip', target: q });
    R.poseId = 'point'; const from = cur, before = snap();
    await tween(800, (k) => tip(lerp3(from, off(0.07), k)));
    for (let a = 0; a < 2 && snap() === before; a++) {
      await tween(800, (k) => tip(off(0.07 - 0.09 * k))); await until(() => snap() !== before, 700);
    }
    log(`${name}${snap() === before ? '-' : '+'}`);
    cur = off(0.08); R.poseId = 'default'; pin(R, cur);
  };
  const thumbs = async (up: boolean) => {
    const s2 = Math.SQRT1_2, rot = up ? [0, 0, -s2, s2] : [0, 0, s2, s2];
    const p = H(0.2, -0.3, -0.28); await move(p, 700); // low and right: never over the Focus / Wind down panel
    const before = snap(); R.poseId = 'thumbs-up'; pin(R, p, rot); await sleep(500); // snapshot first: a fast frame rate can fire the gesture inside the 500 ms
    await until(() => snap() !== before, 4000); await sleep(900);
    R.poseId = 'default'; pin(R, p);
  };
  const log = (x: string) => { document.body.dataset.v2log = `${document.body.dataset.v2log ?? ''}${x};`; };
  // Reel (&wake=1): Room wakes up plays, then a real poke on a mood orb (&mood=low|okay|focused, default okay) and 👍 Keep
  { const q = new URLSearchParams(location.search);
    if (q.get('wake') === '1') {
      say('Room wakes up'); await until(() => document.body.dataset.wake === 'done', 30000);
      await until(() => document.body.dataset.mood === 'ask', 20000); await sleep(1200);
      const m = (['low', 'okay', 'focused'].includes(q.get('mood') ?? '') ? q.get('mood') : 'okay') as string;
      const o = sys.wake.orbItems.find((x: any) => x.m === m);
      if (o) { say(`Mood: ${m}`); sys.wake.hint = m; await sleep(1400); const p = posOf(o.label.mesh);
        const n = new Vector3(0, 0, 1).applyQuaternion(o.label.mesh.getWorldQuaternion(new (o.label.mesh.quaternion.constructor)())).toArray() as V3;
        const off = (d: number): V3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
        R.poseId = 'point'; const from = cur;
        await tween(900, (k) => R.setPin({ anchor: 'index-tip', target: lerp3(from, off(0.07), k) }));
        // poke by wall-clock time and hold at depth (low fps: a quick pass can fall between frames); retry, then pick directly
        for (let tries = 0; tries < 3 && document.body.dataset.mood === 'ask'; tries++) {
          await tween(500, (k) => R.setPin({ anchor: 'index-tip', target: lerp3(off(0.07), off(-0.015), k) }));
          await until(() => document.body.dataset.mood !== 'ask', 1200);
          await tween(400, (k) => R.setPin({ anchor: 'index-tip', target: lerp3(off(-0.015), off(0.07), k) }));
        }
        if (document.body.dataset.mood === 'ask') { log('moodFallback'); sys.wake.pick(m); }
        sys.wake.hint = null;
        R.setPin({ anchor: 'index-tip', target: off(0.1) }); cur = off(0.1);
        if (!(await until(() => !sys.wake.moodShown(), 6000))) { say('autoplay stopped: mood check did not close'); return; }
        await until(() => !!sys.pending || document.body.dataset.morning === '0', 15000); await sleep(2200);
        if (sys.pending) { say('👍 Keep'); try { await press('Keep'); } catch (e) { say(`autoplay stopped: ${(e as Error).message}`); return; } await sleep(1500); } }
    } }
  const card = (id: string) => posOf(sys.items.get(id).label.mesh);
  { // ⋯ task options: poke a Pending card's ⋯ pill, then +15 min in the one-column menu
    const oid = sys.s.stack.find((x: string) => sys.dotBtns.get(x)?.label.mesh.visible);
    if (oid) { say('⋯ options: Skip · +15 min · Tomorrow'); try { await press(`⋯ options ${oid}`); await until(() => !!sys.optId, 3000); await sleep(1200); await press('+15 min'); await until(() => !sys.optId, 3000); log(`opts:${document.body.dataset.optDone ?? '-'}`); } catch (e) { say(`autoplay stopped: ${(e as Error).message}`); return; } await sleep(600); } }
  // Reel (&zones=1): Room Zones beat after Keep: Focus + Quick zones on the table either side, agent cards fly in, then look to target
  if (new URLSearchParams(location.search).get('zones') === '1') {
    const ui0 = Object.getOwnPropertySymbols(dev).map((k) => dev[k]?.devui?.inputLayer).find((x: any) => x?.playerRig);
    const turn = async (ms: number, ty: number, tx: number) => { if (!ui0) return; const fy = ui0.playerRig.rotation.y, fx = ui0.cameraRig.rotation.x; await tween(ms, (k) => { ui0.playerRig.rotation.y = fy + (ty - fy) * k; ui0.cameraRig.rotation.x = fx + (tx - fx) * k; ui0.cameraRig.updateMatrixWorld(true); dev.quaternion.copy(ui0.cameraRig.getWorldQuaternion(new Quaternion())); }); };
    const shotHold = async () => { if (document.body.dataset.shotWait !== '1') return; document.body.dataset.shotHold = '1'; while (document.body.dataset.shotHold === '1') await sleep(100); }; // dev screenshot script only: pauses the beat while a frame is captured
    const dpos = () => new Vector3(dev.position.x, dev.position.y, dev.position.z); // IWER's own Vector3 has no lerp: convert
    const lean = async (ms: number, to: Vector3 | null) => { const p0 = dpos(); const p1 = to ?? lean0; await tween(ms, (k) => { const v = p0.clone().lerp(p1, k); dev.position.set(v.x, v.y, v.z); }); };
    const lean0 = dpos();
    const home = { y: ui0?.playerRig.rotation.y ?? 0, x: ui0?.cameraRig.rotation.x ?? 0 };
    { // head turns to where the Focus patch goes, the card glides in (1.2 s), patch flashes, hold ~2 s (all wall-clock)
      const w = sys.desk.localToWorld(new Vector3(-0.3, 0.01, 0.0)); const d = w.sub(head());
      say('🎯 Claim a Focus zone'); await turn(900, Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
      await lean(700, lean0.clone().lerp(sys.desk.localToWorld(new Vector3(-0.3, 0.2, 0.0)), 0.5)); // lean in so patch + card read on camera
      sys.claimAt([-0.3, 0.01, 0.0]); document.body.dataset.zoneLand = 'fly'; await sleep(1300);
      say('🎯 Focus zone: the long card lands on the patch'); document.body.dataset.zoneLand = 'hold'; await sleep(600); await shotHold(); await sleep(1400); delete document.body.dataset.zoneLand;
      await lean(700, null); await turn(800, home.y, home.x); }
    say('🎯 Claim a Quick zone'); sys.claimAt([0.42, 0.01, -0.1]); await sleep(2600);
    const inZone = (k: string) => (x: string) => sys.items.get(x)?.label.mesh.visible && !!sys.zoneTarget(x, new Vector3(), new (sys.desk.quaternion.constructor)()) && sys.lastZone === k;
    const quick = sys.s.stack.filter(inZone('quick')); // glow close-up: the faced card glows beside a plain neighbour on the same patch
    const id = (quick.length >= 2 ? quick[0] : undefined) ?? sys.s.stack.find(inZone('focus')) ?? sys.s.stack.find((x: string) => sys.items.get(x)?.label.mesh.visible);
    if (id) {
      // turn the emulated head (head gaze, not eye tracking) to the card, hold, turn back
      const m = sys.items.get(id).label.mesh; const w = m.getWorldPosition(new Vector3()); const h = head(); const d = w.sub(h);
      const ui = Object.getOwnPropertySymbols(dev).map((k) => dev[k]?.devui?.inputLayer).find((x: any) => x?.playerRig);
      const y0 = ui?.playerRig.rotation.y ?? 0, x0 = ui?.cameraRig.rotation.x ?? 0;
      const y1 = Math.atan2(-d.x, -d.z), x1 = Math.atan2(d.y, Math.hypot(d.x, d.z));
      const aim = (k: number, fy: number, ty: number, fx: number, tx: number) => { if (!ui) return; ui.playerRig.rotation.y = fy + (ty - fy) * k; ui.cameraRig.rotation.x = fx + (tx - fx) * k; ui.cameraRig.updateMatrixWorld(true); dev.quaternion.copy(ui.cameraRig.getWorldQuaternion(new Quaternion())); };
      say('👀 Look to target: the card you face glows');
      const hp = dpos(); await Promise.all([tween(900, (k) => aim(k, y0, y1, x0, x1)), (async () => { const t = m.getWorldPosition(new Vector3()); t.y += 0.12; await lean(900, hp.clone().lerp(t, 0.4)); })()]); await until(() => document.body.dataset.gaze === id, 4000); log(`gaze${document.body.dataset.gaze === id ? '+' : '-'}`); document.body.dataset.zonesBeat = document.body.dataset.gaze === id ? 'gaze' : 'nogaze'; await sleep(600); await shotHold(); await sleep(1600); // glow held ~2 s on the faced card (wall-clock)
      await Promise.all([tween(900, (k) => aim(k, y1, y0, x1, x0)), lean(900, hp)]);
    }
  }
  try {
    say('1/6  passthrough: desk on your table, plan on your wall');
    await move(H(-0.05, -0.36, -0.22), 900); await sleep(4000);

    say('2/6  leave and re-enter XR: desk + wall come back in the same spot (persistent anchor)');
    { const before = posOf(sys.desk).map((v) => v.toFixed(3)).join(',');
      sys.mr.phase = 'idle'; sys.mr.desk = ''; await world.renderer.xr.getSession()?.end(); await until(() => world.visibilityState.value === VisibilityState.NonImmersive, 4000); await sleep(1200);
      await sys.enterXR(); await until(() => world.visibilityState.value !== VisibilityState.NonImmersive, 5000);
      await until(() => sys.mr.phase === 'done' && sys.mr.desk !== '', 10000); dev.primaryInputMode = 'hand'; await sleep(800);
      const after = posOf(sys.desk).map((v) => v.toFixed(3)).join(',');
      say(`2/6  ${sys.mr.desk.startsWith('restored') ? 'restored' : 'NOT restored'} · same spot: ${before === after ? 'yes' : 'no'}`);
      document.body.dataset.restore = `${sys.mr.desk}|${before === after}`; cur = H(-0.05, -0.36, -0.22); pin(R, cur); pin(L, H(-0.22, -0.55, -0.2)); await sleep(3500); }

    say('3/6  Shift in your seat · poke 📍 Re-place');
    { let last = 0; await tween(1200, (k) => { leanEmulatedHead(0.18 * (k - last)); last = k; }); } // slide ~18 cm to the right
    await sleep(500); cur = H(-0.05, -0.36, -0.22); pin(R, cur);
    for (let i = 0; i < 3 && sys.mr.desk.startsWith('restored'); i++) { await press('Re-place'); await sleep(400); } await until(() => sys.mr.phase === 'done' && sys.mr.desk !== '', 6000); await sleep(3000);

    say('4/6  pinch a block to focus · 👍 done');
    const id = sys.s.timeline.find((x: string) => !sys.s.tasks[x].done);
    const c = card(id); await move([c[0], c[1] + 0.05, c[2] + 0.12], 1300); await move(card(id), 500); await sleep(250);
    await pinch(1); await sleep(120); await pinch(0);
    await until(() => !!sys.focus, 3000); await until(() => sys.focusPanel.mesh.scale.x > 0.97, 4000); await move(H(0.3, -0.45, -0.1), 600); say('4/6  Focus: timer running, room dimmed'); await sleep(900); if (document.body.dataset.shotWait === '1') { document.body.dataset.shotHold = '1'; while (document.body.dataset.shotHold === '1') await sleep(100); } await sleep(2600); // hold ~3 s on the Focus panel + timer (readable on a slow box)
    await thumbs(true); await until(() => !sys.focus, 3000); await sleep(1500);

    if (sys.pending) { say('4/6  the planner adjusted the day · 👍 keep'); await thumbs(true); await until(() => !sys.pending, 3000); await sleep(1200); }
    say('5/6  🌙 Wind down: today in real numbers');
    // state-driven so a missed poke just retries (deterministic outcome: all but the last kept, 1 dropped)
    let said = 0; const t0 = performance.now();
    while (document.body.dataset.wind !== 'closed' && performance.now() - t0 < 360000) {
      const w = sys.wind;
      if (sys.pending) { log('keep'); await thumbs(true); await sleep(600); continue; }
      if (!w) { log('open'); await press('Wind down'); await sleep(said ? 400 : 1200); continue; }
      if (w.step === 0) { if (!said) { await sleep(3500); } log('next'); await press('Next'); continue; }
      if (w.step <= w.list.length) {
        if (said < 1) { said = 1; say('5/6  roll each unfinished task: 👍 keep for tomorrow · 👎 drop'); }
        const keep = w.step < w.list.length; await sleep(900); log(keep ? 'up' : 'down');
        await press(keep ? 'Next' : 'Drop'); // the Next pill (keeps it for tomorrow) · deterministic demo: all but the last kept → 1 dropped // gesture missed (slow/fast frame rate): same choice by poke
        await until(() => sys.thumb.dir === 0, 1500); await sleep(300); // let the thumb gesture settle so a late 👎 can't hit the next step (👎 on Close day = Back)
        continue;
      }
      if (said < 2) { said = 2; await sleep(2000); say('6/6  close the day: tomorrow starts with these'); }
      log('close'); await press('Close day'); await sleep(400);
    }
    await sleep(2500);
    if (document.body.dataset.wind !== 'closed') { say('autoplay stopped: wind-down did not close (retry the take)'); return; }
    say(`Demo complete · ${sys.s.streak}-day streak`);
  } catch (e) {
    say(`autoplay stopped: ${(e as Error).message}`);
  }
}
