import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MorningDeskSystem } from './desk-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(MorningDeskSystem);
  (window as unknown as { __md: unknown }).__md = world;
});
