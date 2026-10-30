// Self-synthesized UI sounds for Morning Desk (our own work, released CC0). Run: node scripts/make-sfx.mjs
import { writeFileSync } from 'node:fs';
const SR = 44100;
function wav(name, seconds, fn) {
  const n = Math.round(SR * seconds), data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  let seed = 7; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR; const fade = Math.min(1, (n - i) / (SR * 0.01)); // 10 ms tail fade, no clicks
    const v = Math.max(-1, Math.min(1, fn(t, noise) * fade));
    data.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  writeFileSync(`public/sfx/${name}.wav`, data);
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const bell = (t, f, d, a = 0.004) => env(t, a, d) * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.01 * t) * Math.exp(-t / (d * 0.5)));
// pinch: a soft, short tick (pick up)
wav('pinch', 0.09, (t, nz) => 0.32 * bell(t, 1320, 0.022, 0.002) + 0.05 * nz() * env(t, 0.001, 0.006));
// drop: a muted two-note "thock" (card lands / snaps)
wav('drop', 0.32, (t) => 0.3 * bell(t, 587.33, 0.07) + 0.26 * bell(Math.max(0, t - 0.06), 880, 0.09) * (t > 0.06 ? 1 : 0));
// timer-start: a gentle rising chime (focus timer starts)
wav('timer-start', 0.6, (t) => 0.22 * bell(t, 523.25, 0.18, 0.01) + 0.22 * (t > 0.11 ? bell(t - 0.11, 783.99, 0.22, 0.01) : 0));
// thumbs-up: a warm three-note arpeggio (keep / done)
wav('thumbs-up', 0.7, (t) => [659.25, 783.99, 1046.5].reduce((s, f, i) => s + (t > i * 0.08 ? 0.17 * bell(t - i * 0.08, f, 0.2, 0.006) : 0), 0));
console.log('wrote public/sfx/*.wav');
