/**
 * ?voice=1 — OPTIONAL voice prototype (off by default). Browser Web Speech API only: no AI, no keys,
 * no services added by us (note: Chrome's recognizer itself may use the browser vendor's servers).
 * Fixed phrases map onto the SAME handlers as pinch / thumbs / poke. Pinch stays primary.
 * Test hook: window.__voiceCommand('done') fires a SIMULATED result (labelled "simulated" in-scene).
 */
import { Label, panel, text } from './label.js';
import { C } from './style.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sys = any;
const COMMANDS: [RegExp, string][] = [
  [/\bstart (a )?focus\b/i, 'start focus'], [/\bfix (my )?schedule\b/i, 'fix my schedule'],
  [/\bsummary\b/i, 'summary'], [/\bdone\b/i, 'done'],
];

export function enableVoice(sys: Sys): void {
  const mic = new Label(0.4, 0.05);
  mic.mesh.position.set(0.3, 0.28, 0.01); sys.wall.add(mic.mesh); // above the timeline, top-right
  const show = (s: string, tone = C.ink) => mic.draw((g, W, H) => { panel(g, W, H, C.paper, C.sky, 0.95); text(g, s, 26, H / 2, 20, tone, 700, W - 34); });
  (window as any).__voiceStatus = '';
  const status = (s: string, tone?: string) => { (window as any).__voiceStatus = s; show(s, tone); };

  const run = (phrase: string, simulated: boolean): string | null => {
    const cmd = COMMANDS.find(([r]) => r.test(phrase))?.[1] ?? null;
    const tag = simulated ? ' (simulated)' : '';
    if (!cmd) { status(`🎤 not a command${tag}: "${phrase.slice(0, 24)}"`, C.mute); return null; }
    status(`🎤 heard${tag}: ${cmd}`, C.sageDeep);
    if (cmd === 'start focus') {            // same as a quick pinch on the next open block
      if (sys.focus) return cmd;
      const id = sys.s.timeline.find((x: string) => !sys.s.tasks[x].done) ?? sys.s.stack[0];
      if (id) { sys.startFocus(id); sys.tutEvent('detail'); }
    } else if (cmd === 'done') sys.onThumb(1);           // same as a held 👍
    else if (cmd === 'fix my schedule') sys.runAgent(true); // same as poking "Plan for me"
    else if (cmd === 'summary') sys.finishDay();          // same as poking "Done" (closes the day + summary)
    return cmd;
  };
  (window as any).__voiceCommand = (phrase: string) => run(phrase, true);

  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) { status('🎤 voice unsupported here · pinch works', C.mute); return; }
  const rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
  let on = false, errs = 0;
  rec.onresult = (e: any) => { const r = e.results[e.results.length - 1]; if (r?.isFinal) run(r[0].transcript.trim(), false); };
  rec.onerror = (e: any) => { errs++; status(`🎤 voice off (${e.error}) · pinch works`, C.mute); (window as any).__voiceError = e.error; };
  rec.onstart = () => status('🎤 listening…');
  rec.onend = () => { on = false; if (errs < 3) setTimeout(start, 800); };
  const start = () => { if (on) return; try { rec.start(); on = true; status('🎤 starting mic…'); } catch (e) { status(`🎤 voice failed: ${(e as Error).name}`, C.mute); (window as any).__voiceError = (e as Error).message; } };
  // browsers need a user gesture before mic capture: start on first click / XR session
  status('🎤 voice ready · tap to enable');
  window.addEventListener('pointerdown', start, { once: true });
  sys.world.renderer.xr.addEventListener('sessionstart', start);
}
