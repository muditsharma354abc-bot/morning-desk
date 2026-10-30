// dev-only J3: place desk + wall, reload the page, re-enter XR, confirm the anchor restores to the same spot; screenshots to ../screens
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://localhost:8093/morning-desk/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
const tag = (t) => p.evaluate((t) => { const d = document.getElementById('emu-tag') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'emu-tag' })); d.textContent = `Emulator capture (IWER, desktop browser) · not a headset · ${t}`; Object.assign(d.style, { position: 'fixed', left: '10px', bottom: '10px', zIndex: 99999, background: 'rgba(0,0,0,.7)', color: '#fff', font: '600 14px sans-serif', padding: '4px 8px', borderRadius: '6px' }); }, t);
const pose = () => p.evaluate(() => { const t = window.__mdTest; return { desk: t.mr.desk, phase: t.mr.phase, p: t.desk.position.toArray().map((v) => +v.toFixed(3)), w: t.wall.position.toArray().map((v) => +v.toFixed(3)) }; });
const enter = async () => { await p.waitForTimeout(4000); await p.click('#btn-enter'); for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000); const s = await pose().catch(() => null); if (s?.phase === 'done' && s.desk) return s; } return pose(); };
await p.goto(BASE + '?demo=1&mr=1&hands=1&wake=0'); await p.evaluate(() => localStorage.clear()); await p.reload();
const a = await enter(); await p.waitForTimeout(2500); await tag('1/2 placed'); await p.screenshot({ path: '/workspace/meta-vr/screens/j3-1-placed.png' });
await p.reload(); const c = await enter(); await p.waitForTimeout(2500); await tag(`2/2 after page reload: ${c.desk}`); await p.screenshot({ path: '/workspace/meta-vr/screens/j3-2-after-reload.png' });
const d = Math.hypot(...a.p.map((v, i) => v - c.p[i])); console.log(JSON.stringify({ before: a, after: c, deskMoved_m: +d.toFixed(3) }));
await b.close(); process.exit(c.desk.startsWith('restored') && d < 0.02 ? 0 : 1);
