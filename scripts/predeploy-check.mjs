#!/usr/bin/env node
// Pre-deploy check (IWER emulator, headless Chromium + SwiftShader). Exits non-zero on any failure.
//  1. Full Reel autoplay (?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay): wake-up → mood → Keep → … → Wind down closed.
//  2. Hands-only: hands are the default input, ?controllers=1 switches to controllers, and Wind down closes by hand
//     both by poke and by pinch (hand ray) on its buttons (needs the dev server: uses the window.__mdTest hook).
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

function themeChecks(lg, tag) {
  ok(/line:settled/.test(lg), `${tag}: Opening light line drew and settled`);
  ok(/autoopen:open/.test(lg), `${tag}: curtain auto-opened with the sunrise`);
  ok(/pull:(half|closed)/.test(lg), `${tag}: hand-pull moved the curtain (${(lg.match(/pull:[^;]*/) ?? ['none'])[0]})`);
  ok(/state:closed\/focus/.test(lg) && /state:half\/break/.test(lg) && /state:open\/plan/.test(lg), `${tag}: curtain toggles closed/focus, half/break, open/plan (${(lg.match(/state:[^;]*/g) ?? []).join(',')})`);
  ok(/autoclose:closed/.test(lg), `${tag}: curtain auto-closed in Renew (${(lg.match(/autoclose:[^;]*/) ?? ['none'])[0]})`);
}
if (THROTTLE) console.log(`CPU throttled ${THROTTLE}×`);
// 1. full autoplay
const ONLY = process.env.ONLY; // e.g. ONLY=pinch to re-run one check while debugging
if (!ONLY || ONLY === 'autoplay') { const p = await page(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay');
  const T0 = Date.now(); let say = '', seen = new Set();
  while (Date.now() - T0 < (THROTTLE ? 1500000 : 480000)) { const prev = say; say = await sayOf(p).catch(() => ''); if (say !== prev && process.env.VERBOSE) console.log(`  ${((Date.now() - T0) / 1000).toFixed(0)}s ${say}`); if (say) seen.add(say.slice(0, 4)); if (/complete|stopped/.test(say)) break; await p.waitForTimeout(500); }
  ok(seen.has('Room') || seen.has('Mood'), 'autoplay: wake-up + mood check ran');
  ok(/Demo complete/.test(say), `autoplay reached the end (${say})`);
  ok(await p.evaluate(() => document.body.dataset.wind === 'closed'), 'autoplay: Wind down closed (day closed)');
  { const lg = await p.evaluate(() => document.body.dataset.v2log ?? ''); ok(/opts:more:/.test(lg), `autoplay: ⋯ options menu opened and +15 min applied (${(lg.match(/opts:[^;]*/) ?? ['none'])[0]})`); ok(/Next\+/.test(lg), 'autoplay: Wind down advanced by the Next pill'); }
  { const lg = await p.evaluate(() => document.body.dataset.v2log ?? ''); const ms = Number(await p.evaluate(() => document.body.dataset.autoplayMs ?? 0));
    themeChecks(lg, 'autoplay'); console.log(`  autoplay duration (in-page, emulator): ${(ms / 1000).toFixed(0)} s`); if (!THROTTLE) ok(ms > 0 && ms < 300000, `autoplay: full run under 5 min (${(ms / 1000).toFixed(0)} s)`); }
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
  ok(/Demo complete/.test(say), `zones autoplay reached the end (${say})`); ok(!p.errs.length, `zones: no page errors ${p.errs.join(' | ')}`); await p.close(); }


// 1c. &tour=theme: only the theme + curtain beats (separate take)
if (!ONLY || ONLY === 'tour') { const p = await page(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&tour=theme');
  const T0 = Date.now(); let say = '';
  while (Date.now() - T0 < (THROTTLE ? 900000 : 240000)) { say = await sayOf(p).catch(() => ''); if (/complete|stopped/.test(say)) break; await p.waitForTimeout(500); }
  ok(/Theme tour complete/.test(say), `tour=theme reached the end (${say})`);
  const lg = await p.evaluate(() => document.body.dataset.v2log ?? ''); themeChecks(lg, 'tour');
  console.log(`  tour duration (in-page, emulator): ${(Number(await p.evaluate(() => document.body.dataset.tourMs ?? 0)) / 1000).toFixed(0)} s`);
  ok(await p.evaluate(() => !!document.body.dataset.curtainAnchor), `tour: curtain placed (${await p.evaluate(() => document.body.dataset.curtainAnchor)})`);
  ok(!p.errs.length, `tour: no page errors ${p.errs.join(' | ')}`); await p.close(); }

// 2. hands-only
for (const [q, want] of ONLY ? [] : [['?demo=1', 'hand'], ['?demo=1&controllers=1', 'controller']]) {
  const p = await page(); await p.goto(BASE + q); await p.waitForTimeout(4000);
  ok(await p.evaluate(() => window.IWER_DEVICE?.primaryInputMode) === want, `input default for ${q} is ${want}`); ok(!p.errs.length, `no page errors on ${q}`); await p.close(); }
for (const how of ONLY === 'autoplay' ? [] : ONLY ? [ONLY] : ['poke', 'pinch']) {
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
      const want = w.step === 0 ? 'Next' : w.step <= n ? (w.step < n ? 'Next' : 'Drop') : 'Close day';
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
// 3. Wind down by thumb microgesture (IWER 2.7 emulates Quest's hand-gamepad swipe buttons): swipe right = Next on every roll-over step
if (!ONLY || ONLY === 'swipe') { const p = await page(); await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0');
  await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 }).catch(() => {});
  for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
  await p.waitForTimeout(3000);
  const r = await p.evaluate(async () => { const t = window.__mdTest, dev = window.IWER_DEVICE; dev.primaryInputMode = 'hand'; t.openWindDown(); const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    await sl(800); const n = t.wind.list.length; const steps = [];
    for (let i = 0; i <= n && t.wind && t.wind.step <= n; i++) { const before = t.wind.step; await dev.remote.dispatch('microgesture', { device: 'hand-right', gesture: 'swipe-right' });
      const t0 = performance.now(); while (t.wind && t.wind.step === before && performance.now() - t0 < 6000) await sl(50); steps.push(t.wind?.step ?? -1); }
    return { n, steps, final: t.wind?.step, swipes: document.body.dataset.swipe }; });
  ok(r.final === r.n + 1, `wind-down advanced by thumb swipe (emulator): ${JSON.stringify(r)}`); ok(!p.errs.length, `no page errors (swipe) ${p.errs.join(' | ')}`); await p.close(); }
await b.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed'); process.exit(fails.length ? 1 : 0);
