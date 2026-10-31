// dev-only: smallest text on every visible label, in dp at its real distance (1 dp ≈ 1 mm at 1 m); flags < 24 dp
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'https://localhost:8098/morning-desk/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0');
await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 });
for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
await p.waitForTimeout(7000);
const run = (tag) => p.evaluate((tag) => { const t = window.__mdTest; const V = t.desk.position.constructor; const head = t.headCam().getWorldPosition(new V()); const out = []; const seen = new Set();
  t.world.scene.traverseVisible((o) => { const L = o.userData?.label; if (!L || seen.has(L) || !L.minPx) return; seen.add(L); const d = o.getWorldPosition(new V()).distanceTo(head); const s = o.getWorldScale(new V()).y;
    out.push({ n: (o.userData.btn ?? o.userData.taskId ?? o.userData.name ?? `[${L.w.toFixed(2)}x${L.h.toFixed(2)}]`).toString().slice(0, 22), px: L.minPx, d: +d.toFixed(2), dp: Math.round(L.minPx * s / d) }); });
  return { tag, out: out.sort((a, b) => a.dp - b.dp) }; }, tag);
const show = (r) => { console.log('==', r.tag); for (const x of r.out) console.log(`${x.dp < 24 ? 'SMALL' : 'ok   '} ${String(x.dp).padStart(3)} dp  (${x.px}px @ ${x.d} m) ${x.n}`); };
show(await run('default'));
await p.evaluate(() => window.__mdTest.openWindDown()); await p.waitForTimeout(1500); show(await run('wind'));
await b.close();
