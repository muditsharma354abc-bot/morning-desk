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

export const PATCH_W = 0.36, PATCH_H = 0.24;
/** Claimed zone: a soft outlined patch with its name (Focus / Quick); the claim cursor stays a ring + "Pinch to claim" tag. */
export function zoneMarker(kind: ZoneKind | 'cursor'): { ring: Mesh; tag: Label } {
  const col = kind === 'cursor' ? '#E6E9EE' : kind === 'focus' ? '#B9A3E3' : '#8FD1A5';
  const tag = new Label(0.13, 0.034);
  if (kind === 'cursor') {
    const ring = new Mesh(new RingGeometry(0.075, 0.09, 40), new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
    tag.draw((g, W, H) => { panel(g, W, H, C.glass, col, 0.95); text(g, 'Pinch to claim', W / 2, H / 2, 17, C.ink, 600, W, 'center'); });
    return { ring, tag };
  }
  const patch = new Label(PATCH_W, PATCH_H); (patch.mesh.material as MeshBasicMaterial).depthWrite = false; (patch.mesh.material as MeshBasicMaterial).depthTest = false; // always drawn on the table surface (the emulated table can sit a few mm above desk-local 0)
  patch.draw((g, W, H) => {
    const r = 36, lw = 14; g.beginPath(); g.roundRect(lw, lw, W - 2 * lw, H - 2 * lw, r);
    g.fillStyle = kind === 'focus' ? 'rgba(255,170,40,0.75)' : 'rgba(143,209,165,0.62)'; g.fill(); // strong fill: reads from the seat
    g.shadowColor = col; g.shadowBlur = 18; g.lineWidth = lw; g.strokeStyle = col; g.stroke(); g.shadowBlur = 0;
    g.setLineDash([22, 14]); g.lineWidth = 4; g.strokeStyle = '#E6E9EE'; g.beginPath(); g.roundRect(lw * 2.6, lw * 2.6, W - 5.2 * lw, H - 5.2 * lw, r * 0.6); g.stroke(); g.setLineDash([]);
  });
  // upright name tag at the back edge of the patch, turned to face the seated user (big, readable at default distance)
  const big = new Label(0.2, 0.05); big.mesh.renderOrder = 6; // depth-tested: a lifted card in front of it stays in front
  big.draw((g, W, H) => { panel(g, W, H, C.glassHi, col, 1); text(g, kind === 'focus' ? '🎯 Focus zone' : '⚡ Quick zone', W / 2, H / 2, Math.round(H * 0.4), '#E6E9EE', 800, W - 8, 'center'); });
  return { ring: patch.mesh, tag: big };
}
/** Card slot i on a zone (zone-local, 2 × 2): on a flat patch cards lie on it, leaning back toward the user; on a wall they hang on it. */
export const ZONE_CARDS = 4;
export function zoneSlot(z: Zone, i: number, out: Vector3, q: Quaternion): void {
  const col = i % 2, row = Math.floor(i / 2);
  const flat = z.surface === 'flat';
  out.set((col - 0.5) * 0.2, flat ? 0.02 + row * 0.012 : 0.03 - row * 0.12, flat ? -0.04 + row * 0.12 : 0.01); // ~5 cm between cards: a highlight never covers a neighbour
  q.setFromAxisAngle(new Vector3(0, 1, 0), z.yaw);
  if (flat) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.95)); // lying on the patch, tilted up to the user
  out.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), z.yaw)).add(new Vector3(...z.p));
}
