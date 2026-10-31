import { chromium } from 'playwright';
const TH = process.argv.includes('--throttle');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
if (TH) { await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 400); });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }); }
await p.goto('https://localhost:8097/morning-desk/?demo=1&mr=1&hands=1&wake=0');
await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 });
for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const dev = window.IWER_DEVICE; dev.primaryInputMode = 'hand'; const s = window.__mdTest.world.renderer.xr.getSession();
  const seen = []; let prev = {}; let frames = 0;
  const loop = (t, f) => { frames++; for (const src of s.inputSources) { const gp = src.gamepad; if (!src.hand || !gp) continue; for (let i = 5; i <= 9; i++) { const k = src.handedness + i; const pr = !!gp.buttons[i]?.pressed; if (pr && !prev[k]) seen.push(k); prev[k] = pr; } } s.requestAnimationFrame(loop); };
  s.requestAnimationFrame(loop);
  const out = []; const errs = [];
  for (let n = 0; n < 10; n++) { const g = ['swipe-right', 'swipe-left'][n % 2]; try { await dev.remote.dispatch('microgesture', { device: 'hand-right', gesture: g }); } catch (e) { errs.push(String(e.message).slice(0, 120)); } await new Promise((r) => setTimeout(r, 600)); out.push(g); }
  await new Promise((r) => setTimeout(r, 1500));
  return { sent: out.length, seen, frames, errs: [...new Set(errs)], btns: [...s.inputSources].map((x) => x.handedness + ':' + (x.gamepad?.buttons.length ?? 0)) };
});
console.log(TH ? 'THROTTLE' : 'NORMAL', JSON.stringify(r)); await b.close();
