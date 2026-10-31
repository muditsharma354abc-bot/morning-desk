// dev-only: measure every visible button / pill in dp at its real distance (48 dp ≈ 48 mm at 1 m) and the poke-row distance
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'https://localhost:8097/morning-desk/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0');
await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 });
for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
await p.waitForTimeout(6000);
const audit = (tag) => p.evaluate((tag) => { const t = window.__mdTest; const V = t.desk.position.constructor; const head = t.headCam().getWorldPosition(new V()); const out = [];
  for (const x of t.buttons.values()) { const m = x.label.mesh; let vis = true; for (let o = m; o; o = o.parent) if (!o.visible) vis = false; if (!vis) continue;
    const s = m.getWorldScale(new V()); const d = m.getWorldPosition(new V()).distanceTo(head); const h = x.label.h * s.y, w = x.label.w * s.x;
    out.push({ n: String(m.userData.btn ?? '?').slice(0, 18), d: +d.toFixed(2), hdp: Math.round(h / d * 1000), wdp: Math.round(w / d * 1000) }); }
  return { tag, out }; }, tag);
const show = (r) => { console.log('==', r.tag); for (const x of r.out.sort((a, b) => a.hdp - b.hdp)) console.log(`${x.hdp < 48 ? 'SMALL' : 'ok   '} ${String(x.hdp).padStart(3)}x${String(x.wdp).padStart(3)} dp @ ${x.d} m  ${x.n}`); };
show(await audit('default'));
await p.evaluate(() => { const t = window.__mdTest; const id = t.s.stack[0]; t.openOptions(id); }); await p.waitForTimeout(1500); show(await audit('options')); await p.evaluate(() => window.__mdTest.closeOptions());
await p.evaluate(() => window.__mdTest.openWindDown()); await p.waitForTimeout(1500); show(await audit('wind'));
await b.close();
