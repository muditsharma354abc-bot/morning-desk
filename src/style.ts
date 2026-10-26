/** One calm palette shared by art, UI canvases and sound. */
export const C = {
  ink: '#2f3a36', paper: '#f4efe4', sage: '#9cbf9b', sageDeep: '#5f8a6a',
  clay: '#d9a07a', sky: '#a9c6d8', warn: '#e3b26b', mute: '#8c958f',
  prio: { 1: '#d9a07a', 2: '#a9c6d8', 3: '#c9d6b9' } as Record<number, string>,
};
export const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

let ctx: AudioContext | null = null;
/** Soft sine "marimba" tones; all sounds come from one pentatonic scale. */
export function tone(step = 0, len = 0.35, vol = 0.08): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
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
export const sfx = {
  pick: () => tone(0, 0.2), drop: () => { tone(2); setTimeout(() => tone(4), 90); },
  skip: () => tone(1, 0.25, 0.05), agent: () => { tone(3); setTimeout(() => tone(5), 120); },
  yes: () => { tone(2); setTimeout(() => tone(4), 80); setTimeout(() => tone(5), 160); }, no: () => tone(0, 0.4, 0.06),
};
