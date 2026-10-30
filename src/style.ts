/** One palette for every panel (style_reference.md): dark glass, light text, one warm morning accent. */
export const C = {
  glass: '#14161C', glassHi: '#262A34', glassLo: '#3A3F4B',
  ink: '#F2F4F8', mute: '#A7AFBD', accent: '#FFB547',
  // legacy names, mapped onto the same palette
  paper: '#14161C', sage: '#FFB547', sageDeep: '#FFB547', clay: '#FFB547', sky: '#8AB4F8', warn: '#FF8A5B',
  prio: { 1: '#FFB547', 2: '#8AB4F8', 3: '#8FD1A5' } as Record<number, string>,
};
/** Glass alpha for panels (style reference: #14161C @ 0.75). */
export let GLASS_ALPHA = 0.75;
/** High-contrast mode (button or ?contrast=1): opaque black panels, pure white text, thicker rims. */
export const HC = { on: new URLSearchParams(location.search).has('contrast') };
const BASE = { ...{} } as Record<string, string>;
export function setContrast(on: boolean): void {
  if (!Object.keys(BASE).length) for (const k of ['glass', 'glassHi', 'glassLo', 'ink', 'mute', 'paper']) BASE[k] = (C as unknown as Record<string, string>)[k];
  HC.on = on; GLASS_ALPHA = on ? 1 : 0.75;
  const c = C as unknown as Record<string, string>;
  for (const k of Object.keys(BASE)) c[k] = BASE[k];
  if (on) { c.glass = '#000000'; c.paper = '#000000'; c.glassHi = '#000000'; c.glassLo = '#1A1A1A'; c.ink = '#FFFFFF'; c.mute = '#FFFFFF'; }
}
if (HC.on) setContrast(true);
/** Inter (SIL OFL 1.1, public/fonts/inter/OFL.txt), the typeface Meta recommends for Horizon OS UI. */
export const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
/** Load Inter before the first canvas is drawn (falls back to system-ui after 2 s). */
export async function loadFonts(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const faces: [string, string][] = [['Inter-Regular', '400 500'], ['Inter-SemiBold', '600'], ['Inter-Bold', '700 900']];
  try {
    const all = faces.map(([f, w]) => { const ff = new FontFace('Inter', `url(${base}fonts/inter/${f}.woff2) format("woff2")`, { weight: w }); document.fonts.add(ff); return ff.load(); });
    await Promise.race([Promise.all(all), new Promise((r) => setTimeout(r, 2000))]);
  } catch { /* system font fallback */ }
}

let ctx: AudioContext | null = null;
/** Browsers start audio suspended; create/resume it on the first real user gesture (click, key, XR select). */
export function unlockAudio(): void {
  try { ctx ??= new AudioContext(); if (ctx.state !== 'running') void ctx.resume().then(loadSamples); else loadSamples(); } catch { /* no audio */ }
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlockAudio, { capture: true });
/** Soft sine "marimba" tones; all sounds come from one pentatonic scale. */
export function tone(step = 0, len = 0.35, vol = 0.08): void {
  try {
    if (!ctx || ctx.state !== 'running') { unlockAudio(); if (!ctx || ctx.state !== 'running') return; }
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = scale[((step % scale.length) + scale.length) % scale.length];
    const n = ctx.currentTime;
    g.gain.setValueAtTime(0, n);
    g.gain.linearRampToValueAtTime(vol, n + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, n + len);
    o.connect(g).connect(ctx.destination);
    o.start(n); o.stop(n + len + 0.05);
  } catch { /* audio optional */ }
}
/** Self-made one-shot samples (public/sfx, CC0): pinch, drop, timer start, thumbs-up. Tones are the fallback. */
const SAMPLES = ['pinch', 'drop', 'timer-start', 'thumbs-up'] as const;
const buffers = new Map<string, AudioBuffer>();
let loading = false;
function loadSamples(): void {
  if (loading || !ctx) return; loading = true;
  for (const n of SAMPLES) void fetch(`${import.meta.env.BASE_URL}sfx/${n}.wav`).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b)).then((buf) => buffers.set(n, buf)).catch(() => { /* tone fallback */ });
}
function sample(name: (typeof SAMPLES)[number], fallback: () => void, vol = 0.9): void {
  try {
    if (!ctx || ctx.state !== 'running') { unlockAudio(); if (!ctx || ctx.state !== 'running') return; }
    loadSamples();
    const buf = buffers.get(name); if (!buf) { fallback(); return; }
    const src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = vol;
    src.buffer = buf; src.connect(g).connect(ctx.destination); src.start();
  } catch { /* audio optional */ }
}
export const sfx = {
  pick: () => sample('pinch', () => tone(0, 0.12, 0.06)), drop: () => sample('drop', () => { tone(2); setTimeout(() => tone(4), 90); }),
  timer: () => sample('timer-start', () => { tone(0, 0.3); setTimeout(() => tone(3, 0.4), 110); }),
  split: () => { tone(5, 0.25); setTimeout(() => tone(3, 0.25), 70); setTimeout(() => tone(1, 0.35), 140); },
  done: () => [0, 2, 4, 5].forEach((n, i) => setTimeout(() => tone(n, 0.5, 0.07), i * 110)),
  skip: () => tone(1, 0.25, 0.05), agent: () => { tone(3); setTimeout(() => tone(5), 120); },
  yes: () => sample('thumbs-up', () => { tone(2); setTimeout(() => tone(4), 80); setTimeout(() => tone(5), 160); }), no: () => tone(0, 0.4, 0.06),
};
