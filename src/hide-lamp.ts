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

/**
 * Every view: hide the potted plants of IWER's synthetic 'home_office' room (emulator only; a real
 * headset shows your own room). In IWER's SEM scene each plant is a 0.28 × 0.38 m textured
 * PlaneGeometry card; the floor / side-table pots are tapered CylinderGeometry (radiusTop ≠
 * radiusBottom) plus a thin dark soil disc. Only those meshes are hidden.
 */
export function enablePlantHide(): void {
  const cards: { min: V3; max: V3 }[] = [];
  const sweep = () => {
    const sem = (window as unknown as { IWER_DEVICE?: { sem?: { scene?: { traverse(f: (o: Obj) => void): void } } } }).IWER_DEVICE?.sem;
    sem?.scene?.traverse((o) => {
      const g = o.geometry as (Obj['geometry'] & { parameters?: Record<string, number> }) | undefined; const c = o.material?.color;
      if (!o.isMesh || !g || o.userData.mdPlant !== undefined) return;
      const pr = (g.parameters ?? {}) as Record<string, number>; const ph = pr.height ?? 1;
      const card = g.type === 'PlaneGeometry' && Math.abs(pr.width - 0.28) < 1e-6 && Math.abs(ph - 0.38) < 1e-6;
      const pot = g.type === 'CylinderGeometry' && pr.radiusTop !== pr.radiusBottom;
      const soil = g.type === 'CylinderGeometry' && ph < 0.02 && !!c && c.r + c.g + c.b < 0.1;
      o.userData.mdPlant = card || pot || soil; if (card || pot || soil) o.visible = false;
      if (card) { const gg = o.geometry as unknown as { computeBoundingBox(): void; boundingBox: { clone(): { applyMatrix4(m: unknown): { min: V3; max: V3 } } } };
        gg.computeBoundingBox(); cards.push(gg.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    });
    // terracotta pots under the plant cards are merged into one shared mesh (world-space vertices): collapse only the triangles right under a card
    if (cards.length) sem?.scene?.traverse((o) => {
      const g = o.geometry, c = o.material?.color;
      if (!o.isMesh || !g || !c || g.type !== 'BufferGeometry' || !g.index || o.userData.mdPot) return;
      if (!(c.r > 0.3 && c.g < 0.2 && c.b < 0.1)) return;
      const p = g.attributes.position, idx = g.index;
      const inside = (i: number) => cards.some((b) => p.getX(i) > b.min.x - 0.12 && p.getX(i) < b.max.x + 0.12 && p.getZ(i) > b.min.z - 0.12 && p.getZ(i) < b.max.z + 0.12 && p.getY(i) > b.min.y - 0.3 && p.getY(i) < b.min.y + 0.12);
      let hit = 0;
      for (let t = 0; t + 2 < idx.count; t += 3) if (inside(idx.getX(t)) && inside(idx.getX(t + 1)) && inside(idx.getX(t + 2))) { const a = idx.getX(t); idx.setX(t + 1, a); idx.setX(t + 2, a); hit++; }
      if (hit) idx.needsUpdate = true; o.userData.mdPot = true;
    });
  };
  sweep(); setInterval(sweep, 500);
}
