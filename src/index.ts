import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MorningDeskSystem } from './desk-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(MorningDeskSystem);
  if (new URLSearchParams(location.search).has('clean')) void import('./clean.js').then((m) => m.enableCleanCapture(world)); // capture-only
  { const q = new URLSearchParams(location.search); if (q.has('demo') || q.has('clean')) void import('./hide-lamp.js').then((m) => m.enableLampHide()); } // capture-only
  if (import.meta.env.DEV) (window as unknown as { __md: unknown }).__md = world; // dev-server test hook only
});
