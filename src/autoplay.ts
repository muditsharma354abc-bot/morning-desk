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
  if (xr) { await selectHandsInToolbar(); dev.primaryInputMode = 'hand'; await sleep(600); } // corner panels read "hand"
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
  /** Time-based tween: same duration even if the tab's timers/frames are throttled. */
  const tween = async (ms: number, fn: (k: number) => void) => {
    const t0 = performance.now();
    for (;;) { const t = Math.min(1, (performance.now() - t0) / ms); fn(ease(t)); if (t >= 1) return; await sleep(16); }
  };
  const until = async (cond: () => boolean, ms: number) => { const t0 = performance.now(); while (!cond() && performance.now() - t0 < ms) await sleep(30); return cond(); };
  const lerp3 = (a: V3, b: V3, k: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as V3;
  const snap = () => JSON.stringify([!!sys.focus, sys.pending?.summary ?? '', sys.s.streak, sys.agentMsg]);

  /** Poke a button with the index fingertip (real PokeInteractable path). Retries the poke once if nothing happened. */
  const press = async (name: string) => {
    const b = button(name); if (!b) return;
    const p = posOf(b.label.mesh);
    const n = new Vector3(0, 0, 1).applyQuaternion(b.label.mesh.getWorldQuaternion(new (b.label.mesh.quaternion.constructor)())).toArray() as V3;
    const off = (d: number): V3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
    const tip = (q: V3) => R.setPin({ anchor: 'index-tip', target: q });
    R.poseId = 'point';
    const from = cur, before = snap();
    await tween(900, (k) => tip(lerp3(from, off(0.07), k)));
    for (let attempt = 0; attempt < 2 && snap() === before; attempt++) {
      await tween(260, (k) => tip(off(0.07 - 0.09 * k)));   // push ~2 cm through the face
      await until(() => snap() !== before, 500);
      await tween(220, (k) => tip(off(-0.02 + 0.09 * k)));  // lift off
    }
    cur = off(0.08); R.poseId = 'default'; pin(R, cur);
  };
  /** Hold a clearly visible thumbs-up / thumbs-down in front of the face; the app's own detector decides. */
  const thumbs = async (up: boolean) => {
    const s2 = Math.SQRT1_2, rot = up ? [0, 0, -s2, s2] : [0, 0, s2, s2];
    const p: V3 = [0.06, 1.42, -0.32];
    await move(p, 900);
    R.poseId = 'thumbs-up'; pin(R, p, rot);
    await sleep(500);
    const before = snap();
    await until(() => snap() !== before, 4000);
    await sleep(1400); // keep the gesture on screen after it registers
    R.poseId = 'default'; pin(R, p);
  };
  const tap = async () => { await pinch(1, 120); await sleep(120); await pinch(0, 120); };

  /** Reach to a block and quick-pinch it (near tap: the app's real grab -> release-as-tap path). */
  const rayTap = async (target: V3) => {
    await move([target[0], target[1] + 0.05, target[2] + 0.12], 1500); await move(target, 500); await sleep(200); await tap();
  };
  try {
    // ---- the pass (~60 s); every caption is set before its action
    say('1/6  your day in space: desk, timeline, a 14:00 meeting');
    await move([0.2, 1.3, -0.3], 1000);
    const deep = card('deep'); await move([deep[0] * 0.4, deep[1] - 0.05, -0.4], 1500); await sleep(2500);

    say('2/6  pinch "Inbox sweep" to enter Focus Mode');
    await rayTap(card('inbox'));
    await until(() => !!sys.focus, 3000);
    await move([0.22, 1.12, -0.3], 900);

    say('3/6  25-min focus timer (accelerated in the demo) · others fade');
    await sleep(3500);

    say('4/6  👍 done early: the planner reschedules the day');
    await thumbs(true);
    await until(() => !!sys.pending, 4000); await sleep(2500);

    say('5/6  conflict: 90m deep work vs 14:00 meeting · 👍 approve the fix');
    if (sys.pending) await thumbs(true);
    await sleep(2500);

    say('6/6  poke "Done": end-of-day summary');
    await press('Done'); await sleep(1500);
    await move([0.22, 1.05, -0.2], 1000);
    await sleep(3000);
    say(`demo complete · ${sys.s.streak}-day streak`);
  } catch (e) {
    say(`autoplay stopped: ${(e as Error).message}`);
  }
}

function caption(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#2f3a36e6;color:#f4efe4;font:600 15px system-ui,sans-serif;padding:8px 16px;border-radius:16px;pointer-events:none;display:flex;gap:10px;align-items:center';
  const tag = document.createElement('span'); tag.textContent = '▶ autoplay demo'; tag.style.cssText = 'background:#9cbf9b;color:#2f3a36;border-radius:10px;padding:2px 8px;font-size:12px';
  el.append(tag, document.createElement('span'));
  document.body.append(el);
  return el;
}

/** Click the IWER devui toolbar's input-mode menu → Hands (same as a person would). */
async function selectHandsInToolbar(): Promise<void> {
  const find = (pred: (b: HTMLElement) => boolean): HTMLElement | undefined => {
    const walk = (r: Document | ShadowRoot): HTMLElement | undefined => {
      for (const el of r.querySelectorAll<HTMLElement>('*')) {
        if (el.tagName === 'BUTTON' && pred(el)) return el;
        if (el.shadowRoot) { const x = walk(el.shadowRoot); if (x) return x; }
      }
      return undefined;
    };
    return walk(document);
  };
  const menu = find((b) => b.title === 'Select input mode'); if (!menu) return;
  menu.click(); await sleep(400);
  const ctl = find((b) => /^Controllers/.test(b.textContent?.trim() ?? '')); ctl?.click(); await sleep(500);
  menu.click(); await sleep(400);
  find((b) => /^Hands/.test(b.textContent?.trim() ?? ''))?.click();
}
