/**
 * ?clean=1 — capture-only: hides emulator chrome for clean video. No app/gesture behaviour changes.
 * Hides: IWER devui overlay canvas (transform gizmos, origin ring), devui toolbar/panels (kept in DOM,
 * still clickable by autoplay), and the hand ray beams. Keeps hands and the small ray cursor dot.
 */
import type { World } from '@iwsdk/core';

export function enableCleanCapture(world: World): void {
  const style = document.createElement('style');
  document.head.append(style);
  const appCanvas = () => world.renderer.domElement;
  const sweep = () => {
    // devui renders its gizmos on its own fixed, centred WebGL canvas drawn above the app (z-index 3; the z-index 1 one is the emulated room); the app canvas is left alone
    for (const c of document.querySelectorAll('canvas')) {
      if (c !== appCanvas() && (c as HTMLElement).style.top === '50vh' && Number((c as HTMLElement).style.zIndex) > 2) (c as HTMLElement).style.visibility = 'hidden';
    }
    // devui toolbar / corner panels / banners live in shadow-root hosts: invisible, still in the DOM (autoplay clicks them)
    for (const h of document.querySelectorAll<HTMLElement>('body *')) {
      if (h.shadowRoot && h.id !== 'scene-container') { h.style.opacity = '0'; h.style.pointerEvents = 'none'; }
    }
    // hand ray beams (thin open cylinders from @iwsdk/xr-input ray-pointer); the cursor dot stays
    world.scene.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; geometry?: { parameters?: { radiusTop?: number; height?: number; openEnded?: boolean } }; material?: { visible: boolean } };
      const p = m.geometry?.parameters;
      if (m.isMesh && p && p.radiusTop === 0.001 && p.height === 1 && p.openEnded && m.material) m.material.visible = false;
    });
  };
  sweep(); setInterval(sweep, 500);
}
