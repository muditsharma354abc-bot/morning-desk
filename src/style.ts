/** One palette for every panel (style_reference.md): dark glass, light text, one warm morning accent. */
export const C = {
  glass: '#1E2128', glassHi: '#2E323C', glassLo: '#3C414D',
  ink: '#D9DDE4', mute: '#A3ABB8', accent: '#FFB547', // gray text (never pure white); gold = selected state only
  sel: '#FFB547',
  // legacy names, mapped onto the same palette
  paper: '#1F2229', // opaque panels (glass is the translucent one) sage: '#B4C6DC', sageDeep: '#B4C6DC', clay: '#B4C6DC', sky: '#8AB4F8', warn: '#E8957A',
  prio: { 1: '#E39B8B', 2: '#8AB4F8', 3: '#8FD1A5' } as Record<number, string>,
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
  if (on) { c.glass = '#141518'; c.paper = '#141518'; c.glassHi = '#1C1D21'; c.glassLo = '#2A2B30'; c.ink = '#EDEEF0'; c.mute = '#E2E3E6'; } // high contrast: near-black / near-white (no pure black or white)
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
/** Soft click for every pinch / poke select: synthesized (WebAudio noise tick + short sine), no audio files. */
export function click(): void {
  try {
    if (!ctx || ctx.state !== 'running') { unlockAudio(); if (!ctx || ctx.state !== 'running') return; }
    const n = ctx.currentTime, len = 0.03; const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.18));
    const src = ctx.createBufferSource(); src.buffer = buf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0.05; src.connect(f).connect(g).connect(ctx.destination); src.start(n);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(1500, n); o.frequency.exponentialRampToValueAtTime(900, n + 0.05);
    og.gain.setValueAtTime(0.025, n); og.gain.exponentialRampToValueAtTime(0.0001, n + 0.06); o.connect(og).connect(ctx.destination); o.start(n); o.stop(n + 0.08);
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
