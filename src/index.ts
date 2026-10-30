import { DepthSensingSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MorningDeskSystem } from './desk-system.js';
import { loadFonts } from './style.js';

// ?hands=1 (not autoplay): put the IWER emulator in hand mode as soon as the device exists, before any session
{
  const q = new URLSearchParams(location.search);
  if (!q.has('controllers') && !q.has('autoplay')) { // emulator: hands are the default input everywhere (?controllers=1 opts out)
    const w = window as unknown as { IWER_DEVICE?: { primaryInputMode: string } };
    let n = 0;
    const apply = () => { if (w.IWER_DEVICE) w.IWER_DEVICE.primaryInputMode = 'hand'; else if (n++ < 200) setTimeout(apply, 25); };
    apply();
  }
}

void loadFonts().then(() => World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  // depth occlusion: optional feature (iwsdk.config.json); without a granted depth-sensing feature the system logs once and does nothing
  if (new URLSearchParams(location.search).has('depth')) world.registerSystem(DepthSensingSystem); // occlusion opt-in (?depth=1) until it ships
  world.registerSystem(MorningDeskSystem);
  if (new URLSearchParams(location.search).has('clean')) void import('./clean.js').then((m) => m.enableCleanCapture(world)); // capture-only
  { const q = new URLSearchParams(location.search); if (q.has('demo') || q.has('clean')) void import('./hide-lamp.js').then((m) => m.enableLampHide()); } // capture-only
  void import('./hide-lamp.js').then((m) => m.enablePlantHide());
  { const q = new URLSearchParams(location.search); if (!q.has('controllers') && !q.has('gizmos') && !q.has('clean')) void import('./clean.js').then((m) => m.hideGizmos(world)); } // IWER's red/blue/green move gizmos float over the panels // emulator room: no potted plants in any view
  if (import.meta.env.DEV) (window as unknown as { __md: unknown }).__md = world; // dev-server test hook only
})); // Inter loads first, so the first canvases draw in it
