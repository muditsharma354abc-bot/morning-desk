// dev-only: list the semantic labels of detected planes + meshes in the IWER synthetic room
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
await p.goto((process.argv[2] ?? 'https://localhost:8098/morning-desk/') + '?demo=1&mr=1&hands=1&wake=0');
await p.waitForFunction(() => !!window.__mdTest, null, { timeout: 90000 });
for (const t0 = Date.now(); Date.now() - t0 < 90000;) { if (await p.evaluate(() => !!window.__mdTest?.inXR?.()).catch(() => false)) break; await p.click('#btn-enter', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(4000); }
await p.waitForTimeout(5000);
console.log(await p.evaluate(() => new Promise((res) => { const s = window.__mdTest.world.renderer.xr.getSession(); const ref = window.__mdTest.world.renderer.xr.getReferenceSpace();
  s.requestAnimationFrame((t, f) => { const pl = [...(f.detectedPlanes ?? [])].map((x) => x.semanticLabel ?? x.orientation); const me = [...(f.detectedMeshes ?? [])].map((x) => x.semanticLabel ?? '?');
    const win = [...(f.detectedMeshes ?? []), ...(f.detectedPlanes ?? [])].filter((x) => /window|door|opening/.test(x.semanticLabel ?? '')).map((x) => { const pose = f.getPose(x.meshSpace ?? x.planeSpace, ref); return { l: x.semanticLabel, p: pose ? [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z].map((v) => +v.toFixed(2)) : null }; });
    res(JSON.stringify({ planes: pl, meshes: me, win })); }); })));
await b.close();
