import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MorningDeskSystem } from './desk-system.js';

// ?hands=1 (not autoplay): put the IWER emulator in hand mode as soon as the device exists, before any session
{
  const q = new URLSearchParams(location.search);
  if (q.has('hands') && !q.has('autoplay')) {
    const w = window as unknown as { IWER_DEVICE?: { primaryInputMode: string } };
    let n = 0;
    const apply = () => { if (w.IWER_DEVICE) w.IWER_DEVICE.primaryInputMode = 'hand'; else if (n++ < 200) setTimeout(apply, 25); };
    apply();
  }
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(MorningDeskSystem);
  if (new URLSearchParams(location.search).has('clean')) void import('./clean.js').then((m) => m.enableCleanCapture(world)); // capture-only
  { const q = new URLSearchParams(location.search); if (q.has('demo') || q.has('clean')) void import('./hide-lamp.js').then((m) => m.enableLampHide()); } // capture-only
  if (import.meta.env.DEV) (window as unknown as { __md: unknown }).__md = world; // dev-server test hook only
});
