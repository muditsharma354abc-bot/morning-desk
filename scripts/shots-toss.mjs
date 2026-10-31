// dev-only: step 5 (&toss=1) emulator captures to ../screens/step5-*.png. usage: node scripts/shots-toss.mjs BASE
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://localhost:8197/morning-desk/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const tag = async (p, extra = '') => p.evaluate((extra) => { let d = document.getElementById('emu-tag'); if (!d) { d = document.createElement('div'); d.id = 'emu-tag'; Object.assign(d.style, { position: 'fixed', left: '10px', bottom: '10px', zIndex: 99999, background: 'rgba(0,0,0,.7)', color: '#fff', font: '600 14px sans-serif', padding: '4px 8px', borderRadius: '6px' }); document.body.append(d); } d.textContent = `Emulator capture (IWER, desktop browser) · not a headset · step 5 crumple & toss${extra}`; }, extra);
const shot = async (p, n, extra) => { await tag(p, extra); await p.screenshot({ path: `/workspace/meta-vr/screens/step5-${n}.png` }); console.log('shot', n); };
{ const p = await ctx.newPage(); await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&wake=1&mood=okay&toss=1');
    const done = new Set(); const T0 = Date.now();
  while (Date.now() - T0 < 600000) {
    const s = await p.evaluate(() => ({ say: [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('autoplay demo')).pop()?.lastChild.textContent ?? '', cr: document.body.dataset.crumple ?? '', toss: document.body.dataset.toss ?? '', hold: document.body.dataset.shotHold === '1', wind: document.body.dataset.wind ?? '', held: window.__mdTest?.toss?.held?.c ?? 0 })).catch(() => ({}));
    if (/grab a card/.test(s.say) && !done.has('a')) { done.add('a'); await p.waitForTimeout(2200); await shot(p, '1-grab', ' · pinch-grab a card'); }
    if (s.held > 0.3 && s.held < 1 && !done.has('b')) { done.add('b'); await shot(p, '2-crumpling', ' · card crumpling'); }
    if (s.held >= 1 && !done.has('c')) { done.add('c'); await shot(p, '3-ball', ' · paper ball over the floor bin'); }
    if (s.toss === 'flying' && !done.has('d')) { done.add('d'); await shot(p, '4-throw', ' · thrown'); }
    if (s.toss.startsWith('in:') && !done.has('e')) { done.add('e'); await p.waitForTimeout(450); await shot(p, '5-basket', ' · basket: task dropped'); }
    if (s.hold) await p.evaluate(() => { delete document.body.dataset.shotHold; }); // never stall a beat
    if (s.wind === '0' && !done.has('f')) { done.add('f'); await p.waitForTimeout(2500); await shot(p, '6-wind-baskets', ' · Wind down: baskets today'); }
    if (/complete|stopped/.test(s.say)) { console.log(s.say); break; }
    await p.waitForTimeout(150);
  } await p.close(); }
{ const p = await ctx.newPage(); await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0&toss=1');
  await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 });
  for (let i = 0; i < 10; i++) { if (await p.evaluate(() => window.__mdTest.inXR())) break; await p.click('#btn-enter').catch(() => {}); await p.waitForTimeout(3000); }
  await p.waitForFunction(() => window.__mdTest.mr.phase === 'done', null, { timeout: 60000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { const t = window.__mdTest; t.startFocus(t.s.stack[t.s.stack.length - 1]); }); await p.waitForTimeout(2500);
  await shot(p, '7-focus-toss-button', ' · 🗑 Toss button fallback on the Focus panel'); await p.close(); }
await b.close();
