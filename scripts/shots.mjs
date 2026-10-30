// dev-only: capture autoplay beats (emulator) to ../screens. usage: node scripts/shots.mjs BASE QUERY PREFIX [--throttle]
import { chromium } from 'playwright';
const [BASE, Q, PRE] = process.argv.slice(2); const TH = process.argv.includes('--throttle');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
if (TH) { await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 400); });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }); }
await p.goto(BASE + Q); const T0 = Date.now(); const done = new Set();
const shot = async (n) => { if (done.has(n)) return; done.add(n); await p.evaluate(() => { if (document.getElementById('emu-tag')) return; const d = document.createElement('div'); d.id = 'emu-tag'; d.textContent = 'Emulator capture (IWER, desktop browser) · not a headset'; Object.assign(d.style, { position: 'fixed', left: '10px', bottom: '10px', zIndex: 99999, background: 'rgba(0,0,0,.7)', color: '#fff', font: '600 14px sans-serif', padding: '4px 8px', borderRadius: '6px' }); document.body.appendChild(d); }).catch(() => {}); await p.screenshot({ path: `/workspace/meta-vr/screens/${PRE}-${n}.png` }); console.log(((Date.now() - T0) / 1000).toFixed(0) + 's', n); };
while (Date.now() - T0 < 1500000) {
  const s = await p.evaluate(() => ({ mood: document.body.dataset.mood ?? '', focus: document.body.dataset.focus ?? '', zb: document.body.dataset.zonesBeat ?? '', gaze: document.body.dataset.gaze ?? '', claim: document.body.dataset.claim ?? '', wind: document.body.dataset.wind ?? '', say: [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('autoplay demo')).pop()?.lastChild.textContent ?? '' })).catch(() => ({}));
  if (s.mood === 'ask') { await p.waitForTimeout(TH ? 2500 : 1500); await shot('mood-hint'); }
  if (/quick@/.test(s.claim ?? '')) { await p.waitForTimeout(TH ? 3000 : 1500); await shot('zones'); }
  if (s.gaze && s.zb === '' && /Look/.test(s.say)) { await p.waitForTimeout(TH ? 1500 : 600); await shot('gaze-glow'); }
  if (/Plan for me|changed your day/.test(s.say) || s.mood?.startsWith('picked')) { }
  if (/^2\/6/.test(s.say ?? '')) await shot('anchor-restored');
  if (/^3\/6/.test(s.say ?? '')) { await p.waitForTimeout(3000); await shot('replace'); }
  if (/timer running/.test(s.say ?? '')) { await p.waitForTimeout(800); await shot('focus'); }
  if (/^5\/6/.test(s.say ?? '')) await shot('wind');
  if (/complete|stopped/.test(s.say ?? '')) { await shot('end'); console.log(s.say); break; }
  await p.waitForTimeout(300);
}
await b.close();
