/**
 * ?clean=1 — capture-only: hides emulator chrome for clean video. No app/gesture behaviour changes.
 * Hides: IWER devui overlay canvas (transform gizmos, origin ring), devui toolbar/panels (kept in DOM,
 * still clickable by autoplay), and the hand ray beams. Keeps hands and the small ray cursor dot.
 */
import { MeshStandardMaterial, type World } from '@iwsdk/core';

export function enableCleanCapture(world: World): void {
  const style = document.createElement('style');
  const NO_CURSOR = 'html, body, *, *::before, *::after, canvas, :fullscreen, :fullscreen *, ::backdrop { cursor: none !important; }';
  style.textContent = NO_CURSOR; // no OS mouse cursor in capture (incl. fullscreen)
  const inject = (root: ShadowRoot) => { // shadow roots (IWER devui) don't inherit page styles
    if ((root as unknown as { mdNoCursor?: boolean }).mdNoCursor) return;
    (root as unknown as { mdNoCursor?: boolean }).mdNoCursor = true;
    const st = document.createElement('style'); st.textContent = `:host, ${NO_CURSOR}`; root.append(st);
  };
  document.head.append(style);
  // emulated hands: solid, opaque, high-contrast fill (the outline stays) so a thumbs-up reads clearly
  const handMat = new MeshStandardMaterial({ color: '#ff8a5c', emissive: '#7a2e14', emissiveIntensity: 0.35, roughness: 0.55 });
  const appCanvas = () => world.renderer.domElement;
  const sweep = () => {
    // devui renders its gizmos on its own fixed, centred WebGL canvas drawn above the app (z-index 3; the z-index 1 one is the emulated room); the app canvas is left alone
    for (const c of document.querySelectorAll('canvas')) {
      if (c !== appCanvas() && (c as HTMLElement).style.top === '50vh' && Number((c as HTMLElement).style.zIndex) > 2) (c as HTMLElement).style.visibility = 'hidden';
    }
    // devui toolbar / corner panels / banners live in shadow-root hosts: invisible, still in the DOM (autoplay clicks them)
    for (const c of document.querySelectorAll<HTMLElement>('canvas')) c.style.setProperty('cursor', 'none', 'important'); // beats IWER's inline crosshair
    for (const h of document.querySelectorAll<HTMLElement>('body *')) {
      if (h.shadowRoot) inject(h.shadowRoot);
      if (h.shadowRoot && h.id !== 'scene-container') { h.style.opacity = '0'; h.style.pointerEvents = 'none'; }
    }
    // hand ray beams (thin open cylinders from @iwsdk/xr-input ray-pointer); the cursor dot stays
    world.scene.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; geometry?: { parameters?: { radiusTop?: number; height?: number; openEnded?: boolean } }; material?: { visible: boolean } };
      const p = m.geometry?.parameters;
      if (m.isMesh && p && p.radiusTop === 0.001 && p.height === 1 && p.openEnded && m.material) m.material.visible = false;
    });
    world.scene.traverse((o) => {
      const m = o as unknown as { type?: string; material?: { type?: string; side?: number; alphaTest?: number } & object; renderOrder: number };
      // the invisible stencil fill of @iwsdk/xr-input AnimatedHand (FrontSide shader, alphaTest 0.05)
      if (m.type === 'SkinnedMesh' && m.material?.type === 'ShaderMaterial' && m.material.side === 0 && m.material.alphaTest === 0.05) (m as unknown as { material: unknown }).material = handMat;
    });
  };
  sweep(); setInterval(sweep, 500);
}
