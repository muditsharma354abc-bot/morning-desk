/**
 * ?demo=1&autoplay=1 — a hands-free filming pass. It drives the REAL app through the IWER
 * emulator: emulated hand position (grasp pin), pinch value and hand poses. The app's own
 * grab / drop / flick / thumbs-gesture code reacts exactly as it would to a person.
 * It never calls app result functions; every outcome comes from the real input paths.
 */
import { Vector3, VisibilityState, type World } from '@iwsdk/core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sys = any;
type V3 = [number, number, number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10); // minimum-jerk-ish

export async function runAutoplay(sys: Sys, world: World): Promise<void> {
  const cap = caption();
  const say = (t: string) => { cap.lastChild!.textContent = t; };
  const dev = (window as any).IWER_DEVICE;
  sys.noAutoAgent = true;
  say('starting…');

  // ---- enter emulated XR with hand tracking (seated head height)
  let xr = false;
  if (dev) {
    try {
      dev.primaryInputMode = 'hand';
      world.launchXR();
      for (let i = 0; i < 40 && world.visibilityState.value === VisibilityState.NonImmersive; i++) await sleep(100);
      xr = world.visibilityState.value !== VisibilityState.NonImmersive;
    } catch { xr = false; }
  }
  await sleep(1500); // let the app place desk + timeline around the head
  if (!xr) { say('needs the IWER emulator (desktop browser): open this URL on a desktop, not a headset'); return; }

  const R = dev.hands.right, L = dev.hands.left;
  let cur: V3 = [0.22, 1.3, -0.35];
  const pin = (h: any, p: V3, rot?: number[]) => h.setPin(rot ? { anchor: rot.length ? 'wrist' : 'grasp', target: p, wristRotation: rot } : { anchor: 'grasp', target: p });
  pin(L, [-0.22, 1.05, -0.2]);
  const move = async (to: V3, ms = 1200) => {
    const from = cur, t0 = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / ms), k = ease(t);
      pin(R, [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * k) as V3);
      if (t >= 1) break;
      await sleep(16);
    }
    cur = to;
  };
  const pinch = async (v: number, ms = 250) => {
    const from = R.pinchValue ?? 0, t0 = performance.now();
    for (;;) { const t = Math.min(1, (performance.now() - t0) / ms); R.updatePinchValue(from + (v - from) * t); if (t >= 1) break; await sleep(16); }
  };
  const posOf = (o: any): V3 => o.getWorldPosition(new Vector3()).toArray() as V3;
  const card = (id: string) => posOf(sys.items.get(id).label.mesh);
  const button = (name: string) => [...sys.buttons.values()].find((b: any) => b.label.mesh.userData.btn?.includes(name));
  /** aim point for a drop: on the head→slot ray, ~0.45 m from the head (seated reach) */
  const aimAt = (x: number): V3 => {
    const head = sys.headCam().getWorldPosition(new Vector3());
    const w = sys.wall.localToWorld(new Vector3(x, 0, 0));
    return head.clone().addScaledVector(w.sub(head).normalize(), 0.45).toArray() as V3;
  };
  /** Poke a button with the index fingertip (real PokeInteractable path). */
  const press = async (name: string) => {
    const b = button(name); if (!b) return;
    const p = posOf(b.label.mesh);
    const n = new Vector3(0, 0, 1).applyQuaternion(b.label.mesh.getWorldQuaternion(new (b.label.mesh.quaternion.constructor)())).toArray() as V3;
    const off = (d: number): V3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
    R.poseId = 'point';
    const tip = (q: V3) => R.setPin({ anchor: 'index-tip', target: q });
    const from = cur; const via = off(0.08);
    for (let i = 1; i <= 50; i++) { const k = ease(i / 50); tip([0, 1, 2].map((j) => from[j] + (via[j] - from[j]) * k) as V3); await sleep(20); }
    for (let i = 1; i <= 15; i++) { const d = 0.08 - (0.095 * i) / 15; tip(off(d)); await sleep(25); } // push 1.5 cm through
    await sleep(200);
    for (let i = 1; i <= 15; i++) { tip(off(-0.015 + (0.1 * i) / 15)); await sleep(20); }
    cur = off(0.085); R.poseId = 'default'; pin(R, cur);
  };
  const thumbs = async (up: boolean) => {
    const s2 = Math.SQRT1_2;
    R.poseId = 'thumbs-up';
    const p: V3 = [0.1, 1.38, -0.33];
    await move(p, 800);
    pin(R, p, up ? [0, 0, -s2, s2] : [0, 0, s2, s2]);
    for (let i = 0; i < 40 && sys.pending; i++) await sleep(50); // the app's own gesture detector decides
    await sleep(600); R.poseId = 'default'; pin(R, p);
  };

  // ---- the pass (~75 s)
  say('1/7  pinch a card, drop it on the timeline');
  await move([0.2, 1.3, -0.3], 1200);
  const c1 = card('inbox'); await move([c1[0], c1[1] + 0.06, c1[2] + 0.04], 1300); await move(c1, 500);
  await pinch(1); await sleep(300);
  await move([c1[0], c1[1] + 0.1, c1[2] - 0.02], 700);
  await move(aimAt(0.4), 1800); await sleep(400); await pinch(0); await sleep(1800);

  say('2/7  quick pinch opens details');
  const c2 = card('plants'); await move([c2[0], c2[1] + 0.06, c2[2] + 0.05], 1300); await move(c2, 500);
  await pinch(1, 120); await sleep(120); await pinch(0, 120);
  for (let i = 0; i < 30 && !sys.detailId; i++) await sleep(100);
  await sleep(3000);
  await pinch(1, 120); await sleep(120); await pinch(0, 120); await sleep(600); // tap again closes it
  await move([c2[0], c2[1] + 0.08, c2[2] + 0.06], 500);

  say('3/7  flick a card sideways to skip it');
  const c3 = card('call'); await move([c3[0], c3[1] + 0.06, c3[2] + 0.05], 1100); await move(c3, 450);
  await pinch(1); await sleep(250);
  await move([c3[0] + 0.42, c3[1] + 0.03, c3[2]], 100); await pinch(0, 60); await sleep(1500);

  say('4/7  ask the planner');
  await press('Plan'); await sleep(3500);

  say('5/7  👍 thumbs up keeps the split');
  await thumbs(true); await sleep(3500);

  say('6/7  👎 thumbs down undoes the next change');
  if (sys.pending) await thumbs(false); await sleep(3000);

  say('7/7  done for today: streak +1, the plant grows');
  await press('Done'); await sleep(4000);
  await move([0.22, 1.1, -0.25], 1200);
  say('demo complete');
}

function caption(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#2f3a36e6;color:#f4efe4;font:600 15px system-ui,sans-serif;padding:8px 16px;border-radius:16px;pointer-events:none;display:flex;gap:10px;align-items:center';
  const tag = document.createElement('span'); tag.textContent = '▶ autoplay demo'; tag.style.cssText = 'background:#9cbf9b;color:#2f3a36;border-radius:10px;padding:2px 8px;font-size:12px';
  el.append(tag, document.createElement('span'));
  document.body.append(el);
  return el;
}
