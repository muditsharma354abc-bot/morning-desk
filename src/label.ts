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
    this.mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, transparent: true })); this.mesh.userData.label = this;
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
  /** Smallest font size (canvas px = mm on the panel) drawn on this label: the text audit turns it into dp at the real distance. */
  minPx = 0; static cur: Label | null = null;
  draw(fn: (g: CanvasRenderingContext2D, W: number, H: number) => void): void {
    this.last = fn; this.minPx = 0; Label.cur = this; const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(g, this.canvas.width, this.canvas.height); Label.cur = null;
    this.tex.needsUpdate = true;
  }
}

/** The one panel family: rounded dark glass, soft drop shadow, hairline rim light, optional accent stripe. */
const FLUTED = new URLSearchParams(location.search).get('ribs') !== '0';
export function panel(g: CanvasRenderingContext2D, W: number, H: number, fill: string = C.glass, _accent?: string, alpha = 0.98): void {
  // design pass: rounded tile, soft shadow, no rim / outline / edge stripe (accent colours only mark the selected state elsewhere)
  const m = Math.min(8, H * 0.08), x = m, y = m * 0.6, w = W - 2 * m, h = H - 2 * m, r = Math.min(h / 2, Math.max(18, Math.min(44, h * 0.22)));
  const a = fill === C.glass ? Math.min(alpha, 1) * GLASS_ALPHA / 0.98 : alpha;
  g.save();
  g.shadowColor = 'rgba(12,14,18,0.35)'; g.shadowBlur = m * 1.6; g.shadowOffsetY = m * 0.45;
  g.globalAlpha = Math.min(1, a); g.fillStyle = fill;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.restore();
  if (FLUTED && fill !== C.paper) { // v11 frosted glass: subtle vertical fluted ribs, canvas-shaded (no extra draw calls / textures)
    g.save(); g.beginPath(); g.roundRect(x, y, w, h, r); g.clip(); const step = 16;
    for (let rx = x; rx < x + w; rx += step) { const gr = g.createLinearGradient(rx, 0, rx + step, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.045)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(10,12,16,0.07)'); g.fillStyle = gr; g.fillRect(rx, y, step, h); }
    g.restore(); }
  void HC;
}
/** A pill (fully rounded): every button. `sel` = selected state (the only place gold is used). */
export function pill(g: CanvasRenderingContext2D, W: number, H: number, sel = false): void {
  const m = Math.min(6, H * 0.08); g.save(); g.shadowColor = 'rgba(12,14,18,0.3)'; g.shadowBlur = m * 1.4; g.shadowOffsetY = m * 0.4;
  g.fillStyle = sel ? C.sel : C.glassHi; g.beginPath(); g.roundRect(m, m * 0.6, W - 2 * m, H - 2 * m, (H - 2 * m) / 2); g.fill(); g.restore();
}
/** Small round priority dot (replaces the old edge stripe). */
export function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = C.ink, weight = 500, maxW = 9999, align: CanvasTextAlign = 'left'): void {
  const L = Label.cur; if (L && s.trim()) L.minPx = L.minPx ? Math.min(L.minPx, size) : size;
  g.fillStyle = color; g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  let t = s;
  while (g.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2);
  g.fillText(t === s ? s : `${t}…`, x, y);
}
/** Word-wrapped paragraph. */
export function para(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, maxW: number, color: string = C.ink): void {
  const L = Label.cur; if (L && s.trim()) L.minPx = L.minPx ? Math.min(L.minPx, size) : size;
  g.font = `400 ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'top';
  let line = '', yy = y;
  for (const w of s.split(' ')) {
    if (g.measureText(`${line}${w} `).width > maxW && line) { g.fillText(line, x, yy); yy += size * 1.3; line = ''; }
    line += `${w} `;
  }
  g.fillText(line, x, yy);
}
