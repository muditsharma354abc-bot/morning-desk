/** Morning Desk plan state: tasks, timeline order, streak. Persisted in localStorage. */
export interface Task {
  id: string;
  title: string;
  minutes: number;
  priority: 1 | 2 | 3; // 1 = must, 3 = nice-to-have
  note: string;
  partOf?: string;
}
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
}
const KEY = 'morning-desk.state.v1';
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

/** Fixed demo state: a 3 h task (forces a split) and 7 h scheduled vs 6 h free (forces overload). */
export function demoState(): PlanState {
  const tasks = [
    t('report', 'Deep work: quarterly report', 180, 1, 'The big one. Charts + summary.'),
    t('standup', 'Team standup', 15, 1, 'Share yesterday, today, blockers.'),
    t('review', 'Design review', 60, 1, 'Walk through the new onboarding screens.'),
    t('gym', 'Gym session', 60, 2, 'Legs day. Bring water.'),
    t('blog', 'Write blog draft', 90, 3, 'Outline + first 500 words.'),
    t('inbox', 'Inbox sweep', 30, 3, 'Archive, reply to the 3 flagged mails.'),
    t('plants', 'Water the plants', 10, 3, 'Balcony + desk plant.'),
    t('call', 'Call the electrician', 15, 2, 'Ask about the kitchen socket.'),
  ];
  return {
    tasks: Object.fromEntries(tasks.map((x) => [x.id, x])),
    stack: ['inbox', 'plants', 'call'],
    timeline: ['standup', 'report', 'review', 'gym', 'blog'], // 405 min
    tomorrow: [], skipped: [],
    dayStart: 9 * 60, availableMinutes: 6 * 60,
    streak: 4, lastDone: '', tutorialSeen: true,
  };
}

export function load(): PlanState {
  if (new URLSearchParams(location.search).has('demo')) return demoState();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PlanState;
  } catch { /* ignore */ }
  return sampleState();
}
export function clearStorage(): void {
  for (const k of Object.keys(localStorage)) if (k.startsWith('morning-desk.')) localStorage.removeItem(k);
}
export function save(s: PlanState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export const clone = (s: PlanState): PlanState => JSON.parse(JSON.stringify(s));
export const scheduledMinutes = (s: PlanState) => s.timeline.reduce((a, id) => a + s.tasks[id].minutes, 0);
export const today = () => new Date().toISOString().slice(0, 10);

/** Marks today's ritual complete; extends or resets the streak. Returns new streak. */
export function completeDay(s: PlanState): number {
  const d = today();
  if (s.lastDone === d) return s.streak;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.streak = s.lastDone === y || s.lastDone === '' ? s.streak + 1 : 1;
  s.lastDone = d;
  return s.streak;
}
export const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
