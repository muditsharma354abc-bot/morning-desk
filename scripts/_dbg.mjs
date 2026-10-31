import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
await p.goto('https://localhost:8097/morning-desk/?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay&zones=1');
const T0 = Date.now(); let last = '';
while (Date.now() - T0 < 90000) { const s = await p.evaluate(() => JSON.stringify({ log: document.body.dataset.v2log, opts: document.body.dataset.opts, done: document.body.dataset.optDone, optId: window.__mdTest?.optId, hold: window.__mdTest?.holdOpened, drag: window.__mdTest?.drag?.id })).catch(() => ''); if (s !== last) { console.log(((Date.now() - T0) / 1000).toFixed(1), s); last = s; } await p.waitForTimeout(200); }
await b.close();
