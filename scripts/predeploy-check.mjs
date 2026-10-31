#!/usr/bin/env node
// Pre-deploy check (IWER emulator, headless Chromium + SwiftShader). Exits non-zero on any failure.
//  1. Full Reel autoplay (?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay): wake-up → mood → Keep → … → Wind down closed.
//  2. Hands-only: hands are the default input, ?controllers=1 switches to controllers, and Wind down closes by hand
//     both by poke and by pinch (hand ray) on its buttons (needs the dev server: uses the window.__mdTest hook).
//  3. Step 5 (&toss=1): hand crumple + throw into the bin → task dropped; 🗑 Toss button fallback; no bin without the flag.
// Usage: node scripts/predeploy-check.mjs [baseUrl]   (default https://localhost:8091/morning-desk/; run `npx vite --port 8091` first)
import { chromium } from 'playwright';
const args = process.argv.slice(2); const THROTTLE = Number((args.find((a) => a.startsWith('--throttle')) ?? '').split('=')[1] || (args.includes('--throttle') ? 6 : 0));
const BASE = args.find((a) => !a.startsWith('--')) || 'https://localhost:8091/morning-desk/';
// --throttle[=N]: rendering forced to ~4 fps and CPU slowed N× (default 6) through CDP, like a slow recording box; the autoplay must still finish or stop with a banner, never hang
const fails = []; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails.push(m); };
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = async () => { const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: THROTTLE ? { width: 1280, height: 800 } : { width: 1280, height: 720 } })).newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  if (THROTTLE) await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { const id = setTimeout(() => raf(cb), 400); return id; }; }); // ≤ 2-3 fps (the emulator's XR frames ride on rAF)
  if (THROTTLE) { const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  return p; };
const sayOf = (p) => p.evaluate(() => { const els = [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('autoplay demo')); return els.length ? els[els.length - 1].lastChild.textContent : ''; });

if (THROTTLE) console.log(`CPU throttled ${THROTTLE}×`);
// 1. full autoplay
const ONLY = process.env.ONLY; // e.g. ONLY=pinch to re-run one check while debugging
if (!ONLY || ONLY === 'autoplay') { const p = await page(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay');
  const T0 = Date.now(); let say = '', seen = new Set();
  while (Date.now() - T0 < (THROTTLE ? 1500000 : 480000)) { const prev = say; say = await sayOf(p).catch(() => ''); if (say !== prev && process.env.VERBOSE) console.log(`  ${((Date.now() - T0) / 1000).toFixed(0)}s ${say}`); if (say) seen.add(say.slice(0, 4)); if (/complete|stopped/.test(say)) break; await p.waitForTimeout(500); }
  ok(seen.has('Room') || seen.has('Mood'), 'autoplay: wake-up + mood check ran');
  ok(/v2 demo complete/.test(say), `autoplay reached the end (${say})`);
  ok(await p.evaluate(() => document.body.dataset.wind === 'closed'), 'autoplay: Wind down closed (day closed)');
  ok(!p.errs.length, `autoplay: no page errors ${p.errs.join(' | ')}`); await p.close(); }

// 1b. Room Zones beat (&zones=1): Focus + Quick patches claimed, a card on Focus (Okay mood), look-to-target glow fires, run still ends
if (!ONLY || ONLY === 'zones') { const p = await page(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay&zones=1');
  const T0 = Date.now(); let say = '', zs = null;
  while (Date.now() - T0 < (THROTTLE ? 1500000 : 480000)) { say = await sayOf(p).catch(() => ''); if (!zs && /^1\/6/.test(say)) zs = await p.evaluate(() => { const t = window.__mdTest; if (!t) return null; const V = t.desk.position.constructor, Q = t.desk.quaternion.constructor;
      const kinds = t.zones.map((z) => z.kind); const on = t.s.stack.map((id) => (t.zoneTarget(id, new V(), new Q()) ? t.lastZone : '')); const focus = on.filter((k) => k === 'focus').length, quick = on.filter((k) => k === 'quick').length;
      return { kinds, focus, quick, gaze: document.body.dataset.zonesBeat ?? '' }; }); if (/complete|stopped/.test(say)) break; await p.waitForTimeout(500); }
  ok(!!zs && zs.kinds.includes('focus') && zs.kinds.includes('quick'), `zones: Focus + Quick claimed (${JSON.stringify(zs)})`);
  ok(!!zs && zs.focus > 0, 'zones: Focus patch has a card on Okay');
  ok(!!zs && zs.gaze === 'gaze', 'zones: look-to-target glow fired on the faced card');
  ok(/v2 demo complete/.test(say), `zones autoplay reached the end (${say})`); ok(!p.errs.length, `zones: no page errors ${p.errs.join(' | ')}`); await p.close(); }

// 1c. Step 5 Crumple & toss (&toss=1): pinch-grab → crumple → throw by hand lands in the bin, task 'dropped' in state, basket counted, run still ends
if (!ONLY || ONLY === 'toss') { const p = await page(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay&toss=1');
  const T0 = Date.now(); let say = '', ts = null, wb = -1;
  while (Date.now() - T0 < (THROTTLE ? 1500000 : 480000)) { const prev = say; say = await sayOf(p).catch(() => ''); if (say !== prev && process.env.VERBOSE) console.log(`  ${((Date.now() - T0) / 1000).toFixed(0)}s ${say}`);
    if (wb < 0 && /^5\/6/.test(say)) wb = await p.evaluate(() => window.__mdTest?.basketsToday() ?? -1);
    if (!ts && /^4\/6/.test(say)) ts = await p.evaluate(() => { const t = window.__mdTest; if (!t) return null; return { beat: document.body.dataset.tossBeat ?? '', log: document.body.dataset.v2log ?? '', dropped: t.s.dropped ?? [], baskets: t.basketsToday(), inLists: (t.s.dropped ?? []).some((id) => [...t.s.stack, ...t.s.timeline, ...t.s.tomorrow, ...t.s.skipped].includes(id)) }; });
    if (/complete|stopped/.test(say)) break; await p.waitForTimeout(500); }
  ok(!!ts && ts.beat === 'hand', `toss: card crumpled and thrown into the bin by hand (${JSON.stringify(ts)})`);
  ok(!!ts && ts.dropped.length === 1 && !ts.inLists && ts.baskets === 1, 'toss: task is dropped in state (out of every list), 1 basket today');
  ok(wb === 1, `toss: basket still counted when Wind down opens (${wb})`);
  { const lg = /v2 demo complete/.test(say) ? '' : await p.evaluate(() => `${document.body.dataset.v2log} wind=${window.__mdTest?.wind?.step}/${window.__mdTest?.wind?.list.length} dw=${document.body.dataset.wind}`).catch(() => ''); ok(/v2 demo complete/.test(say), `toss autoplay reached the end (${say}) ${lg}`); } ok(!p.errs.length, `toss: no page errors ${p.errs.join(' | ')}`); await p.close(); }
// 1d. 🗑 Toss button fallback (hands-only poke on the Focus panel) + no bin without the flag
if (!ONLY || ONLY === 'tossbtn') { for (const q of ['?demo=1&mr=1&hands=1&wake=0&toss=1', '?demo=1&mr=1&hands=1&wake=0']) { const p = await page(); await p.goto(BASE + q);
  await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 }).catch(() => {});
  for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
  await p.waitForFunction(() => window.__mdTest?.mr?.phase === 'done', null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);
  if (!q.includes('toss')) { ok(await p.evaluate(() => !window.__mdTest.toss && ![...window.__mdTest.buttons.values()].some((b) => b.label.mesh.userData.btn?.includes('Toss'))), 'no &toss: no bin, no 🗑 Toss button (live behaviour unchanged)'); ok(!p.errs.length, `no page errors (no toss) ${p.errs.join(' | ')}`); await p.close(); continue; }
  ok(await p.evaluate(() => window.__mdTest.toss?.bin.visible === true), 'toss: floor bin shown in MR');
  const id = await p.evaluate(() => { const t = window.__mdTest; window.IWER_DEVICE.primaryInputMode = 'hand'; const id = t.s.stack[t.s.stack.length - 1]; t.startFocus(id); return id; });
  await p.waitForFunction(() => window.__mdTest.focusPanel.mesh.scale.x > 0.97, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6; i++) { if (await p.evaluate((id) => !!window.__mdTest.s.dropped?.includes(id), id)) break;
    await p.evaluate(async () => { const t = window.__mdTest, R = window.IWER_DEVICE.hands.right; const btn = [...t.buttons.values()].find((x) => x.label.mesh.visible && x.label.mesh.userData.btn?.includes('Toss')); if (!btn) return;
      const m = btn.label.mesh; const V = m.position.constructor, Q = m.quaternion.constructor; m.updateMatrixWorld(); const pos = m.getWorldPosition(new V()); const nrm = new V(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new Q())); const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      R.poseId = 'point'; const t0 = performance.now(); for (;;) { const k = Math.min(1, (performance.now() - t0) / 900); const d = 0.07 - 0.09 * k; R.setPin({ anchor: 'index-tip', target: [pos.x + nrm.x * d, pos.y + nrm.y * d, pos.z + nrm.z * d] }); if (k >= 1) break; await sl(30); }
      await sl(700); R.setPin({ anchor: 'index-tip', target: [pos.x + nrm.x * 0.2, pos.y - 0.2, pos.z + nrm.z * 0.2] }); await sl(500); });
    await p.waitForTimeout(2500); }
  ok(await p.evaluate((id) => { const s = window.__mdTest.s; return !!s.dropped?.includes(id) && !s.stack.includes(id) && !s.timeline.includes(id); }, id), 'toss: 🗑 Toss button (poke) drops the task into the bin');
  ok(!p.errs.length, `no page errors (toss button) ${p.errs.join(' | ')}`); await p.close(); } }

// 2. hands-only
for (const [q, want] of ONLY ? [] : [['?demo=1', 'hand'], ['?demo=1&controllers=1', 'controller']]) {
  const p = await page(); await p.goto(BASE + q); await p.waitForTimeout(4000);
  ok(await p.evaluate(() => window.IWER_DEVICE?.primaryInputMode) === want, `input default for ${q} is ${want}`); ok(!p.errs.length, `no page errors on ${q}`); await p.close(); }
for (const how of ['autoplay', 'zones', 'toss', 'tossbtn'].includes(ONLY) ? [] : ONLY ? [ONLY] : ['poke', 'pinch']) {
  const p = await page(); await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0');
  // enter XR by state, not by fixed sleeps: under --throttle the page can still be loading after 3.5 s, the click is lost and
  // the run stays in the flat view (inXR false), so no hand gesture can ever land. Click until the session is up (wall-clock budget).
  await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 }).catch(() => {});
  for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
  await p.waitForTimeout(3000);
  const hook = await p.evaluate(() => !!window.__mdTest); if (!hook) { ok(false, `wind-down by ${how}: needs the dev server (test hook)`); await p.close(); continue; }
  ok(await p.evaluate(() => window.__mdTest.inXR()), `wind-down by ${how}: entered XR`);
  await p.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__mdTest.openWindDown(); }); await p.waitForTimeout(1200);
  for (let i = 0; i < 20; i++) {
    const st = await p.evaluate(() => document.body.dataset.wind ?? ''); if (st === 'closed') break;
    if (process.env.VERBOSE) console.log("  wind", st, await p.evaluate(() => JSON.stringify({ step: window.__mdTest.wind?.step, n: window.__mdTest.wind?.list.length, xr: window.__mdTest.inXR() })));
    const r = await p.evaluate(async (how) => { const t = window.__mdTest, R = window.IWER_DEVICE.hands.right; const w = t.wind; const n = w.list.length;
      const want = w.step === 0 ? 'Next' : w.step <= n ? (t.s.tasks[w.list[w.step - 1]].priority === 1 ? 'Tomorrow' : 'Drop') : 'Close day';
      const btn = [...t.buttons.values()].find((x) => x.label.mesh.visible && x.label.mesh.userData.btn?.includes(want)); if (!btn) return 'nobtn:' + want;
      const m = btn.label.mesh; const V = m.position.constructor, Q = m.quaternion.constructor; m.updateMatrixWorld();
      const pos = m.getWorldPosition(new V()); const nrm = new V(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new Q())); const sl = (ms) => new Promise((r) => setTimeout(r, ms));
      if (how === 'poke') { R.poseId = 'point'; for (let i = 0; i <= 25; i++) { const d = 0.07 - 0.09 * i / 25; R.setPin({ anchor: 'index-tip', target: [pos.x + nrm.x * d, pos.y + nrm.y * d, pos.z + nrm.z * d] }); await sl(30); } R.setPin({ anchor: 'index-tip', target: [pos.x + nrm.x * 0.2, pos.y - 0.2, pos.z + nrm.z * 0.2] }); await sl(500); return; }
      // pinch (held 600 ms wall-clock, >= 2 frames at the forced ~4 fps): aim the emulated hand's real target ray (IWSDK raySpace) at the button, then pinch
      const rs = t.world.playerSpaceEntities.raySpaces.right.object3D; const head = t.headCam().getWorldPosition(new V());
      const wr = head.clone().add(new V(0.15, -0.35, -0.15)); let q = new Q().setFromUnitVectors(new V(0, 0, -1), pos.clone().sub(wr).normalize()); R.poseId = 'default';
      for (let i = 0; i < 6; i++) { R.setPin({ anchor: 'wrist', target: wr.toArray(), wristRotation: [q.x, q.y, q.z, q.w] }); await sl(250);
        rs.updateMatrixWorld(true); const o = rs.getWorldPosition(new V()); const cur = new V(0, 0, -1).applyQuaternion(rs.getWorldQuaternion(new Q()));
        q = new Q().setFromUnitVectors(cur, pos.clone().sub(o).normalize()).multiply(q); }
      await sl(300); for (let i = 0; i <= 8; i++) { R.updatePinchValue(i / 8); await sl(16); } await sl(600); for (let i = 8; i >= 0; i--) { R.updatePinchValue(i / 8); await sl(16); } await sl(500);
      R.setPin({ anchor: 'wrist', target: head.clone().add(new V(0.25, -0.5, -0.1)).toArray() }); await sl(300); return want + ' ' + pos.toArray().map((v) => v.toFixed(2)).join(',');
      R.updatePinchValue(1); await sl(200); R.updatePinchValue(0); await sl(500); }, how); if (process.env.VERBOSE) console.log('   ->', r);
    await p.waitForTimeout(400);
  }
  ok(await p.evaluate(() => document.body.dataset.wind === 'closed'), `wind-down closes by hand ${how}`); ok(!p.errs.length, `no page errors (${how}) ${p.errs.join(' | ')}`); await p.close(); }
await b.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed'); process.exit(fails.length ? 1 : 0);
