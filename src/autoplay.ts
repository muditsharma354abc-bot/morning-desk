/**
 * ?demo=1&autoplay=1 — a hands-free filming pass. It drives the REAL app through the IWER
 * emulator: emulated hand position (grasp pin), pinch value and hand poses. The app's own
 * grab / drop / flick / thumbs-gesture code reacts exactly as it would to a person.
 * Falls back to calling the same actions directly when no emulator/XR is available.
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
  if (!xr) return desktopPass(sys, say);

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
  const press = async (name: string) => {
    const b = button(name); if (!b) return;
    const p = posOf(b.label.mesh); const before = JSON.stringify([sys.pending?.summary, sys.s.streak, sys.agentMsg]);
    await move([p[0], p[1] + 0.03, p[2] + 0.06], 1000); await move([p[0], p[1] + 0.005, p[2] + 0.01], 350);
    await pinch(1, 120); await sleep(150); await pinch(0, 120); await sleep(300);
    // if the hand ray missed the button, press it the way a ray select would
    if (JSON.stringify([sys.pending?.summary, sys.s.streak, sys.agentMsg]) === before) b.action();
    await move([p[0], p[1] + 0.08, p[2] + 0.1], 500);
  };
  const thumbs = async (up: boolean) => {
    const s2 = Math.SQRT1_2;
    R.poseId = 'thumbs-up';
    const p: V3 = [0.1, 1.38, -0.33];
    await move(p, 800);
    pin(R, p, up ? [0, 0, -s2, s2] : [0, 0, s2, s2]);
    for (let i = 0; i < 40 && sys.pending; i++) await sleep(50); // the app's gesture detector decides
    if (sys.pending) sys.decide(up); // safety net
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
  await sleep(3000); sys.openDetail(''); await move([c2[0], c2[1] + 0.08, c2[2] + 0.06], 500);

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

/** No emulator / XR: run the same pass through the app's own actions in the flat view. */
async function desktopPass(sys: Sys, say: (t: string) => void): Promise<void> {
  const steps: [string, () => void, number][] = [
    ['1/7  drop a card on the timeline', () => { sys.release('inbox', aimFlat(sys), 0, 0.3, 1); }, 2500],
    ['2/7  open details', () => sys.openDetail('plants'), 3000],
    ['3/7  flick a card to skip it', () => { sys.openDetail(''); sys.release('call', sys.desk.position.clone().add(new Vector3(0.6, 0.4, 0)), 1.5, 0.3, 1); }, 2500],
    ['4/7  ask the planner', () => sys.runAgent(true), 3500],
    ['5/7  👍 keep', () => sys.decide(true), 3500],
    ['6/7  👎 undo', () => sys.decide(false), 3000],
    ['7/7  done for today', () => sys.finishDay(), 3500],
  ];
  for (const [t, fn, ms] of steps) { say(t); fn(); await sleep(ms); }
  say('demo complete (desktop)');
}
function aimFlat(sys: Sys): Vector3 {
  const head = sys.headCam().getWorldPosition(new Vector3());
  const w = sys.wall.localToWorld(new Vector3(0.4, 0, 0));
  return head.clone().addScaledVector(w.sub(head).normalize(), 0.6);
}

function caption(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#2f3a36e6;color:#f4efe4;font:600 15px system-ui,sans-serif;padding:8px 16px;border-radius:16px;pointer-events:none;display:flex;gap:10px;align-items:center';
  const tag = document.createElement('span'); tag.textContent = '▶ autoplay demo'; tag.style.cssText = 'background:#9cbf9b;color:#2f3a36;border-radius:10px;padding:2px 8px;font-size:12px';
  el.append(tag, document.createElement('span'));
  document.body.append(el);
  return el;
}
