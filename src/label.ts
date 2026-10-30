import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { C, FONT, GLASS_ALPHA, HC } from './style.js';

const PX = 1000; // canvas pixels per metre

/** A flat rounded card mesh whose face is drawn with Canvas2D. */
export class Label {
  /** Every label, so a palette change (high contrast) can redraw them all with their last draw function. */
  static all = new Set<Label>();
  private last?: (g: CanvasRenderingContext2D, W: number, H: number) => void;
  redraw(): void { if (this.last) this.draw(this.last); }
  mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  constructor(public w: number, public h: number) {
    this.canvas.width = Math.round(w * PX); this.canvas.height = Math.round(h * PX);
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, transparent: true }));
    Label.all.add(this);
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
    this.last = fn; const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(g, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}

/** The one panel family: rounded dark glass, soft drop shadow, hairline rim light, optional accent stripe. */
export function panel(g: CanvasRenderingContext2D, W: number, H: number, fill: string = C.glass, accent?: string, alpha = 0.98): void {
  const m = Math.min(8, H * 0.08), r = Math.min(28, (H - 2 * m) / 3.2), x = m, y = m * 0.6, w = W - 2 * m, h = H - 2 * m;
  const a = fill === C.glass ? Math.min(alpha, 1) * GLASS_ALPHA / 0.98 : alpha;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = m * 1.6; g.shadowOffsetY = m * 0.45;
  g.globalAlpha = Math.min(1, a); g.fillStyle = fill;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.restore();
  // rim light: brighter along the top edge, like glass catching light
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.08)'); grad.addColorStop(1, 'rgba(255,255,255,0.04)');
  g.strokeStyle = HC.on ? '#FFFFFF' : grad; g.lineWidth = HC.on ? 4 : 2; g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, r); g.stroke();
  if (accent) { g.fillStyle = accent; g.beginPath(); g.roundRect(x, y, 10, h, [r, 0, 0, r]); g.fill(); }
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
