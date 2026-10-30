/** Morning Desk plan state: tasks, timeline order, streak. Persisted in localStorage. */
export interface Task {
  id: string;
  title: string;
  minutes: number;
  priority: 1 | 2 | 3; // 1 = must, 3 = nice-to-have
  note: string;
  partOf?: string;
  after?: string;   // meeting id: this block may not start before that meeting ends
  done?: boolean;
  actual?: number;  // measured focus minutes once done (planned = minutes)
}
/** Fixed calendar event (not movable by the planner). */
/** One closed day, as measured: tasks marked done and focus minutes timed by the app. */
export interface DayLog { d: string; done: number; focus: number; }
export type Mood = 'low' | 'okay' | 'focused';
/** Mood → longest focus block and break after each block (minutes). low = short blocks + more breaks; focused = deep work. */
export const MOODS: Record<Mood, { block: number; brk: number }> = { low: { block: 20, brk: 10 }, okay: { block: 45, brk: 5 }, focused: { block: 90, brk: 0 } };
export const maxBlock = (s: PlanState) => (s.mood ? MOODS[s.mood].block : 90);
export const breakMin = (s: PlanState) => (s.mood ? MOODS[s.mood].brk : 0);
export interface Meeting { id: string; title: string; start: number; minutes: number; }
export interface PlanState {
  tasks: Record<string, Task>;
  stack: string[]; // desk stack, top first
  timeline: string[]; // scheduled order, packed from dayStart
  tomorrow: string[];
  skipped: string[];
  dayStart: number; // minutes since midnight
  availableMinutes: number;
  streak: number;
  lastDone: string; // YYYY-MM-DD
  tutorialSeen: boolean;
  meetings?: Meeting[];
  focusMinutes?: number;   // measured focus time today
  conflictsFixed?: number;
  carry?: string[];        // v2 wind-down: tasks rolled into tomorrow (tomorrow's plan starts with them)
  carriedIn?: number;      // how many came in this morning (for the morning message)
  history?: DayLog[];      // closed days, newest last (real measured data only; max 30)
  mood?: Mood;             // step 2 mood check (on-device only); unset = v2.1 behaviour (90 min blocks, no breaks)
  moodDay?: string;        // YYYY-MM-DD the mood was picked (asked once per day)
}
export const IS_DEMO = new URLSearchParams(location.search).has('demo');
// demo runs keep their own key so they never overwrite (or mark the tutorial seen for) a real visit
const KEY = IS_DEMO ? 'morning-desk.demo.v1' : 'morning-desk.state.v1';
const t = (id: string, title: string, minutes: number, priority: 1 | 2 | 3, note: string): Task => ({ id, title, minutes, priority, note });

export function sampleState(): PlanState {
  const tasks = [
    t('standup', 'Team standup', 15, 1, 'Share yesterday, today, blockers.'),
    t('review', 'Design review', 60, 1, 'Walk through the new onboarding screens.'),
    t('inbox', 'Inbox sweep', 30, 3, 'Archive, reply to the 3 flagged mails.'),
    t('walk', 'Walk outside', 30, 2, 'No phone. Sunlight and water.'),
    t('read', 'Read 20 pages', 30, 3, 'Current book, paper copy.'),
    t('plan', 'Plan next sprint', 45, 2, 'Draft goals before Thursday.'),
  ];
  return {
    tasks: Object.fromEntries(tasks.map((x) => [x.id, x])),
    stack: tasks.map((x) => x.id),
    timeline: [], tomorrow: [], skipped: [],
    dayStart: 9 * 60, availableMinutes: 6 * 60,
    streak: 0, lastDone: '', tutorialSeen: false,
  };
}

/** ?tutorial=1 only: the sample desk plus one 10:00 meeting that the scheduled design review runs into, so step 5 has a fix to Keep. */
export function tutorialState(): PlanState {
  const s = sampleState();
  s.timeline = ['standup', 'review']; s.stack = s.stack.filter((id) => !s.timeline.includes(id));
  s.meetings = [{ id: 'm-sync', title: 'Team sync', start: 10 * 60, minutes: 30 }];
  return s;
}

/** Fixed demo state: a 14:00 meeting and a 90-min deep-work block with only 60 min free before it. */
export function demoState(): PlanState {
  const tasks = [
    t('standup', 'Team standup', 15, 1, 'Share yesterday, today, blockers.'),
    t('review', 'Design review', 45, 1, 'Walk through the new onboarding screens.'),
    t('inbox', 'Inbox sweep', 30, 2, 'Archive, reply to the 3 flagged mails.'),
    t('call', 'Call the electrician', 30, 2, 'Ask about the kitchen socket.'),
    t('deep', 'Deep work: quarterly report', 90, 1, 'The big one. Charts + summary.'),
    t('gym', 'Gym session', 60, 2, 'Legs day. Bring water.'),
    t('blog', 'Write blog draft', 45, 3, 'Outline + first 500 words.'),
    t('plants', 'Stretch break', 10, 3, 'Stand up: neck, shoulders, back.'),
    t('read', 'Read 20 pages', 30, 3, 'Current book, paper copy.'),
    t('prep', 'Prep client sync notes', 20, 1, 'Three questions for the 14:00 call.'),
  ];
  return {
    tasks: Object.fromEntries(tasks.map((x) => [x.id, x])),
    stack: ['prep', 'blog', 'plants', 'read'],
    timeline: ['standup', 'review', 'inbox', 'call', 'deep', 'gym'], // deep work starts 13:00, meeting at 14:00
    tomorrow: [], skipped: [],
    dayStart: 11 * 60, availableMinutes: 6 * 60,
    streak: 4, lastDone: '', tutorialSeen: true,
    meetings: [{ id: 'm-client', title: 'Client sync', start: 14 * 60, minutes: 60 }],
    focusMinutes: 0, conflictsFixed: 0,
  };
}

export interface Slot { start: number; end: number; clash?: Meeting; }
/** Pack the timeline from dayStart around fixed meetings. A block that runs into a meeting is a clash. */
export function layout(s: PlanState): { slots: Record<string, Slot>; end: number } {
  const ms = [...(s.meetings ?? [])].sort((a, b) => a.start - b.start);
  const slots: Record<string, Slot> = {}; let cur = s.dayStart; const brk = breakMin(s); let first = true;
  for (const id of s.timeline) {
    if (!first) cur += brk; first = false; // mood breaks between blocks
    const t = s.tasks[id]; const m = t.done ? (t.actual ?? t.minutes) : t.minutes;
    if (t.after) { const mm = ms.find((x) => x.id === t.after); if (mm) cur = Math.max(cur, mm.start + mm.minutes); }
    for (const x of ms) if (cur >= x.start && cur < x.start + x.minutes) cur = x.start + x.minutes;
    const end = cur + m;
    const clash = t.done ? undefined : ms.find((x) => x.start > cur && x.start < end);
    slots[id] = { start: cur, end, clash }; cur = end;
  }
  return { slots, end: Math.max(cur, s.dayStart) };
}
export function load(): PlanState {
  if (IS_DEMO) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } return demoState(); } // demo: fixed state every load, own key, never real history
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return rollover(JSON.parse(raw) as PlanState);
  } catch { /* ignore */ }
  return sampleState();
}
/** v2: the first load on a new day after a wind-down: done tasks clear, the timeline starts with the carried-over tasks. */
export function rollover(s: PlanState): PlanState {
  if (!s.carry || !s.lastDone || s.lastDone === today()) return s;
  const carry = s.carry.filter((id) => s.tasks[id]);
  for (const id of Object.keys(s.tasks)) if (s.tasks[id].done) delete s.tasks[id];
  for (const id of carry) { const t = s.tasks[id]; delete t.after; delete t.actual; }
  const live = (a: string[]) => a.filter((id) => s.tasks[id] && !carry.includes(id));
  s.timeline = carry; s.stack = live(s.stack); s.tomorrow = []; s.skipped = []; s.meetings = []; s.focusMinutes = 0; s.conflictsFixed = 0;
  s.carriedIn = carry.length; delete s.carry;
  save(s); return s;
}
/** Demo reset: clears demo keys only (morning-desk.demo.*). Real history and real anchors are never touched by demo runs. */
export function clearStorage(): void {
  for (const k of Object.keys(localStorage)) if (k.startsWith('morning-desk.demo.')) localStorage.removeItem(k);
}
export function save(s: PlanState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export const clone = (s: PlanState): PlanState => JSON.parse(JSON.stringify(s));
/** The last 7 calendar days ending yesterday-or-today, from stored history only (missing days = null, never invented). */
export function lastWeek(s: PlanState): { d: string; log: DayLog | null }[] {
  const out: { d: string; log: DayLog | null }[] = []; const end = Date.now() + DAY_SHIFT;
  for (let i = 6; i >= 0; i--) { const d = new Date(end - i * 864e5).toISOString().slice(0, 10); out.push({ d, log: s.history?.find((x) => x.d === d) ?? null }); }
  return out;
}
/** Minutes from day start to the end of the last block (meetings included). */
export const scheduledMinutes = (s: PlanState) => (s.timeline.length ? layout(s).end - s.dayStart : 0);
/** ?nextday=1 (test only): pretend it is tomorrow, to verify the wind-down → morning rollover. */
const DAY_SHIFT = new URLSearchParams(location.search).has('nextday') ? 864e5 : 0;
export const today = () => new Date(Date.now() + DAY_SHIFT).toISOString().slice(0, 10);

/** Marks today's ritual complete; extends or resets the streak. Returns new streak. */
export function completeDay(s: PlanState): number {
  const d = today();
  const log: DayLog = { d, done: Object.values(s.tasks).filter((x) => x.done).length, focus: Math.round(s.focusMinutes ?? 0) };
  s.history = [...(s.history ?? []).filter((x) => x.d !== d), log].slice(-30);
  if (s.lastDone === d) return s.streak;
  const y = new Date(Date.now() + DAY_SHIFT - 864e5).toISOString().slice(0, 10);
  s.streak = s.lastDone === y || s.lastDone === '' ? s.streak + 1 : 1;
  s.lastDone = d;
  return s.streak;
}
export const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
