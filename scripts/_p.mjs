import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
await p.goto('https://localhost:8098/morning-desk/?demo=1&autoplay=1&mr=1&hands=1&clean=1&tour=theme');
await p.waitForFunction(() => /lantern/.test(document.body.innerText), null, { timeout: 200000 });
console.log(await p.evaluate(() => { const t = window.__mdTest; const out = []; const shown = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
  for (const b of t.buttons.values()) { const m = b.label.mesh; if (/15|Tomorrow|Close/.test(m.userData.btn ?? '') ) out.push([m.userData.btn, shown(m), m.parent?.type, m.material.opacity, m.scale.x.toFixed(2)]); } return { out, opt: t.optId }; }));
await b.close();
