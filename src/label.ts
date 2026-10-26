import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { C, FONT } from './style.js';

const PX = 1000; // canvas pixels per metre

/** A flat rounded card mesh whose face is drawn with Canvas2D. */
export class Label {
  mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  constructor(public w: number, public h: number) {
    this.canvas.width = Math.round(w * PX); this.canvas.height = Math.round(h * PX);
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, transparent: true }));
  }
  resize(w: number, h: number): void {
    if (Math.abs(w - this.w) < 1e-4 && Math.abs(h - this.h) < 1e-4) return;
    this.w = w; this.h = h;
    this.canvas.width = Math.max(8, Math.round(w * PX)); this.canvas.height = Math.max(8, Math.round(h * PX));
    this.mesh.geometry.dispose();
    this.mesh.geometry = new PlaneGeometry(w, h);
    this.tex.dispose();
    this.tex = new CanvasTexture(this.canvas); this.tex.colorSpace = SRGBColorSpace;
    (this.mesh.material as MeshBasicMaterial).map = this.tex;
  }
  draw(fn: (g: CanvasRenderingContext2D, W: number, H: number) => void): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(g, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}

export function panel(g: CanvasRenderingContext2D, W: number, H: number, fill: string = C.paper, accent?: string, alpha = 0.94): void {
  const r = Math.min(28, H / 4);
  g.globalAlpha = alpha; g.fillStyle = fill;
  g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, r); g.fill();
  g.globalAlpha = 1;
  if (accent) { g.fillStyle = accent; g.beginPath(); g.roundRect(2, 2, 14, H - 4, [r, 0, 0, r]); g.fill(); }
}
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = C.ink, weight = 500, maxW = 9999, align: CanvasTextAlign = 'left'): void {
  g.fillStyle = color; g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  let t = s;
  while (g.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2);
  g.fillText(t === s ? s : `${t}…`, x, y);
}
/** Word-wrapped paragraph. */
export function para(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, maxW: number, color: string = C.ink): void {
  g.font = `400 ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'top';
  let line = '', yy = y;
  for (const w of s.split(' ')) {
    if (g.measureText(`${line}${w} `).width > maxW && line) { g.fillText(line, x, yy); yy += size * 1.3; line = ''; }
    line += `${w} `;
  }
  g.fillText(line, x, yy);
}
