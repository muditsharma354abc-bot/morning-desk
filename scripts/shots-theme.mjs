// v11 theme screenshots from &tour=theme + renderer.info per beat. Usage: node scripts/shots-theme.mjs BASE PREFIX [extraQuery]
import { chromium } from 'playwright';
const [BASE, PREFIX, EXTRA = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } })).newPage();
await p.goto(BASE + '?demo=1&autoplay=1&mr=1&hands=1&clean=1&tour=theme' + EXTRA);
const beats = [['light line', 'opening', 1400], ['sunrise', 'curtain-autoopen', 3200], ['Pull', 'curtain-pull', 2600], ['Closed', 'revive-closed', 3000], ['Half', 'curtain-half', 3000], ['Open: plan', 'revive-open', 3000], ['closes slowly', 'renew-autoclose', 3800], ['lantern', 'renew', 2500]];
const say = () => p.evaluate(() => { const els = [...document.querySelectorAll('div')].filter((d) => d.textContent.includes('autoplay demo')); return els.length ? els[els.length - 1].lastChild.textContent : ''; });
const t0 = Date.now(); let i = 0;
while (i < beats.length && Date.now() - t0 < 300000) {
  const s = await say().catch(() => '');
  if (s.includes(beats[i][0])) { await p.waitForTimeout(beats[i][2]);
    const info = await p.evaluate(() => { const r = window.__mdTest?.world?.renderer; return r ? { calls: r.info.render.calls, tris: r.info.render.triangles } : null; });
    await p.screenshot({ path: `${PREFIX}${beats[i][1]}.png` }); console.log(beats[i][1], JSON.stringify(info), (await p.evaluate(() => document.body.dataset.curtain + '/' + document.body.dataset.look))); i++; }
  else await p.waitForTimeout(150);
}
console.log('log', await p.evaluate(() => document.body.dataset.v2log), 'anchor', await p.evaluate(() => document.body.dataset.curtainAnchor));
await b.close();
