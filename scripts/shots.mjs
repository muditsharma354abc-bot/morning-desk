// dev-only: capture autoplay beats (emulator) to ../screens. usage: node scripts/shots.mjs BASE QUERY PREFIX [--throttle]
import { chromium } from 'playwright';
const [BASE, Q, PRE] = process.argv.slice(2); const TH = process.argv.includes('--throttle');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
if (TH) { await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 400); });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }); }
await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.body.dataset.shotWait = '1'; }); });
await p.goto(BASE + Q); const T0 = Date.now(); const done = new Set();
// close-up: clip around a world point (projected with the head camera), same emulator label kept inside the crop
const near = async (n, which, w = 560, h = 360) => { if (done.has(n)) return; const c = await p.evaluate((which) => { const t = window.__mdTest; if (!t) return null; const cam = t.headCam(); cam.updateMatrixWorld();
  let v; if (which === 'zone') { const z = t.zones.find((x) => x.kind === 'focus'); if (!z) return null; v = t.desk.localToWorld(new t.desk.position.constructor(...z.p)); v.y += 0.04; }
  else if (which === 'gaze') { const it = t.items.get(document.body.dataset.gaze); if (!it) return null; v = it.label.mesh.getWorldPosition(new t.desk.position.constructor()); }
  else { v = t.focusPanel.mesh.getWorldPosition(new t.desk.position.constructor()); }
  v.project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }, which).catch(() => null); if (!c) return;
  done.add(n); await p.evaluate((h) => { let d = document.getElementById('emu-tag2'); if (!d) { d = document.createElement('div'); d.id = 'emu-tag2'; d.textContent = 'Emulator capture (IWER, desktop browser) · not a headset · close-up'; Object.assign(d.style, { position: 'fixed', zIndex: 99999, background: 'rgba(0,0,0,.75)', color: '#fff', font: '600 13px sans-serif', padding: '3px 7px', borderRadius: '6px' }); document.body.appendChild(d); } d.style.display = 'block'; return h; }, h);
  const x = Math.max(0, Math.min(1280 - w, c.x - w / 2)), y = Math.max(0, Math.min(800 - h, c.y - h / 2));
  await p.evaluate(([x, y, h]) => { const d = document.getElementById('emu-tag2'); d.style.left = (x + 8) + 'px'; d.style.top = (y + h - 26) + 'px'; }, [x, y, h]);
  await p.screenshot({ path: `/workspace/meta-vr/screens/${PRE}-${n}.png`, clip: { x, y, width: w, height: h } }); await p.evaluate(() => { document.getElementById('emu-tag2').style.display = 'none'; }); console.log(((Date.now() - T0) / 1000).toFixed(0) + 's', n); };
const shot = async (n) => { if (done.has(n)) return; done.add(n); await p.evaluate(() => { if (document.getElementById('emu-tag')) return; const d = document.createElement('div'); d.id = 'emu-tag'; d.textContent = 'Emulator capture (IWER, desktop browser) · not a headset'; Object.assign(d.style, { position: 'fixed', left: '10px', bottom: '10px', zIndex: 99999, background: 'rgba(0,0,0,.7)', color: '#fff', font: '600 14px sans-serif', padding: '4px 8px', borderRadius: '6px' }); document.body.appendChild(d); }).catch(() => {}); await p.screenshot({ path: `/workspace/meta-vr/screens/${PRE}-${n}.png` }); console.log(((Date.now() - T0) / 1000).toFixed(0) + 's', n); };
while (Date.now() - T0 < 1500000) {
  const s = await p.evaluate(() => ({ mood: document.body.dataset.mood ?? '', focus: document.body.dataset.focus ?? '', zb: document.body.dataset.zonesBeat ?? '', gaze: document.body.dataset.gaze ?? '', claim: document.body.dataset.claim ?? '', land: document.body.dataset.zoneLand ?? '', hold: document.body.dataset.shotHold === '1', wind: document.body.dataset.wind ?? '', say: [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('autoplay demo')).pop()?.lastChild.textContent ?? '' })).catch(() => ({}));
  if (s.mood === 'ask') { await p.waitForTimeout(TH ? 2500 : 1500); await shot('mood-hint'); }
  if (/quick@/.test(s.claim ?? '')) { await p.waitForTimeout(TH ? 3000 : 1500); await shot('zones'); }
  if (s.hold && s.land === 'hold' && !done.has('zones-close')) { await near('zones-close', 'zone', 560, 360); await shot('zones-land'); await p.evaluate(() => { delete document.body.dataset.shotHold; }); }
  if (s.hold && s.gaze && s.zb === 'gaze' && !done.has('glow-close')) { await near('glow-close', 'gaze', 820, 480); await shot('gaze-glow'); await p.evaluate(() => { delete document.body.dataset.shotHold; }); }
  if (/Plan for me|changed your day/.test(s.say) || s.mood?.startsWith('picked')) { }
  if (/^2\/6/.test(s.say ?? '')) await shot('anchor-restored');
  if (/^3\/6/.test(s.say ?? '')) { await p.waitForTimeout(3000); await shot('replace'); }
  if (/timer running/.test(s.say ?? '') && s.hold && !done.has('focus-close')) { await near('focus-close', 'focus', 760, 440); await shot('focus'); await p.evaluate(() => { delete document.body.dataset.shotHold; }); }
  if (/Keep$/.test(s.say ?? '')) await shot('keep');
  if (s.wind === '0') await shot('wind0');
  if (/^6\/6/.test(s.say ?? '')) await shot('wind-close');
  if (/^5\/6/.test(s.say ?? '')) await shot('wind');
  if (/complete|stopped/.test(s.say ?? '')) { await shot('end'); console.log(s.say); break; }
  await p.waitForTimeout(300);
}
await b.close();
