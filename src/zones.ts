/**
 * Step 4 Room Zones: the user claims areas of the real room (a spot on the desk, a wall area, a shelf top) by looking at
 * it and pinching. Zones are stored relative to the anchored desk, so they come back in the same spot with it
 * (tested in emulator). Pending cards the agent moves fly to a matching zone; a card dropped onto a zone stays there.
 */
import { Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from '@iwsdk/core';
import { Label, panel, text } from './label.js';
import { C } from './style.js';

export type ZoneKind = 'focus' | 'quick';
export interface Zone { id: string; kind: ZoneKind; p: [number, number, number]; yaw: number; surface: 'flat' | 'wall'; }
export const ZONE_NAME: Record<ZoneKind, string> = { focus: 'Focus zone', quick: 'Quick zone' };
/** Which Pending tasks a zone collects on its own: focus = 45 min or longer, quick = 30 min or less. */
export const zoneWants = (k: ZoneKind, minutes: number) => (k === 'focus' ? minutes >= 45 : minutes <= 30);

const KEY = (demo: boolean) => (demo ? 'morning-desk.demo.zones.v1' : 'morning-desk.zones.v1');
export function loadZones(demo: boolean): Zone[] { try { return JSON.parse(localStorage.getItem(KEY(demo)) ?? '[]') as Zone[]; } catch { return []; } }
export function saveZones(demo: boolean, z: Zone[]): void { try { localStorage.setItem(KEY(demo), JSON.stringify(z)); } catch { /* ignore */ } }

/** Ring + name tag that marks a claimed zone (or the claim cursor). */
export function zoneMarker(kind: ZoneKind | 'cursor'): { ring: Mesh; tag: Label } {
  const col = kind === 'cursor' ? '#FFFFFF' : kind === 'focus' ? C.accent : '#8FD1A5';
  const ring = new Mesh(new RingGeometry(0.075, 0.09, 40), new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
  const tag = new Label(0.13, 0.034);
  const name = kind === 'cursor' ? 'Pinch to claim' : ZONE_NAME[kind];
  tag.draw((g, W, H) => { panel(g, W, H, C.glass, col, 0.95); text(g, name, W / 2, H / 2, 17, C.ink, 600, W, 'center'); });
  return { ring, tag };
}
/** Card slot i inside a zone (zone-local, 2 columns, cards stand 7 cm above the surface facing the user). */
export function zoneSlot(z: Zone, i: number, out: Vector3, q: Quaternion): void {
  const col = i % 2, row = Math.floor(i / 2);
  out.set((col - 0.5) * 0.17, 0.07 + row * 0.1, 0);
  q.setFromAxisAngle(new Vector3(0, 1, 0), z.yaw);
  out.applyQuaternion(q).add(new Vector3(...z.p));
}
