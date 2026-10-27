/**
 * ?demo=1 / ?clean=1 — capture-only: hides the black adjustable desk lamp of IWER's synthetic
 * 'home_office' room (it reads like a mouse cursor next to the emulated hand on video).
 * The room lives in IWER's own SEM scene (IWER_DEVICE.sem.scene). The lamp head is its own cone mesh;
 * its base and arms are merged into the shared black-metal mesh, so only those triangles inside the
 * lamp's box on the desk are collapsed. Nothing else in the room changes.
 */
type V3 = { x: number; y: number; z: number };
type Obj = { isMesh?: boolean; visible: boolean; userData: Record<string, unknown>; matrixWorld: unknown; material?: { color?: { r: number; g: number; b: number } };
  geometry?: { type: string; parameters?: { radius?: number; height?: number; openEnded?: boolean }; index?: { count: number; getX(i: number): number; setX(i: number, v: number): void; needsUpdate: boolean } | null;
    attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } } };
export const LAMP = { minX: 0.25, maxX: 0.75, minY: 0.745, maxY: 1.35, minZ: -2.45, maxZ: -2.0 }; // world box around the lamp on the desk

export function enableLampHide(): void {
  const sweep = () => {
    const sem = (window as unknown as { IWER_DEVICE?: { sem?: { scene?: { traverse(f: (o: Obj) => void): void } } } }).IWER_DEVICE?.sem;
    sem?.scene?.traverse((o) => {
      const g = o.geometry, c = o.material?.color;
      if (!o.isMesh || !g || !c || o.userData.mdLamp) return;
      const dark = c.r + c.g + c.b < 0.1;
      // lamp head: open cone r 0.06, h 0.12, dark grey
      if (dark && g.type === 'ConeGeometry' && g.parameters?.radius === 0.06 && g.parameters.height === 0.12 && g.parameters.openEnded) { o.visible = false; o.userData.mdLamp = true; return; }
      // merged black-metal mesh: collapse triangles inside the lamp box (vertices are already in world space)
      if (dark && g.type === 'BufferGeometry' && g.index) {
        const p = g.attributes.position, idx = g.index;
        const inside = (i: number) => { const v: V3 = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
          return v.x > LAMP.minX && v.x < LAMP.maxX && v.y > LAMP.minY && v.y < LAMP.maxY && v.z > LAMP.minZ && v.z < LAMP.maxZ; };
        let hit = 0;
        for (let t = 0; t + 2 < idx.count; t += 3) {
          if (inside(idx.getX(t)) && inside(idx.getX(t + 1)) && inside(idx.getX(t + 2))) { const a = idx.getX(t); idx.setX(t + 1, a); idx.setX(t + 2, a); hit++; }
        }
        if (hit) idx.needsUpdate = true;
        o.userData.mdLamp = true;
      }
    });
  };
  sweep(); setInterval(sweep, 500); // the room loads async and can be re-loaded from the devui
}
