import { clone, dur, fmt, layout, maxBlock, PlanState, scheduledMinutes } from './state.js';

/** One concrete change the planner agent made. It is applied immediately (visibly);
 *  thumbs-down restores `before`. */
export interface PlanChange {
  kind: 'split' | 'defer' | 'shorten' | 'conflict';
  summary: string;
  before: PlanState;
  after: PlanState;
}

/** Planner interface; RulePlanner is the only implementation (rule-based, on-device). */
export interface Planner {
  nextChange(s: PlanState): PlanChange | null;
}

export const MAX_BLOCK = 90;

export class RulePlanner implements Planner {
  nextChange(s: PlanState): PlanChange | null {
    // 0) Constraint: a block that runs into a fixed meeting. Fill the free gap, continue after the meeting.
    const { slots } = layout(s);
    for (const id of s.timeline) {
      const sl = slots[id]; const m = sl.clash; if (!m) continue;
      const task = s.tasks[id]; const gap = m.start - sl.start;
      const after = clone(s); after.conflictsFixed = (s.conflictsFixed ?? 0) + 1;
      const head = `"${task.title}" (${dur(task.minutes)}) runs into your ${fmt(m.start)} ${m.title}: only ${dur(gap)} free.`;
      if (gap >= 15) {
        const a = `${id}~a`, b = `${id}~b`;
        after.tasks[a] = { ...task, id: a, minutes: gap, title: `${task.title} (part 1)`, partOf: id, after: undefined };
        after.tasks[b] = { ...task, id: b, minutes: task.minutes - gap, title: `${task.title} (part 2)`, partOf: id, after: m.id };
        after.timeline.splice(after.timeline.indexOf(id), 1, a, b); delete after.tasks[id];
        return { kind: 'conflict', summary: `${head} Fix: ${dur(gap)} now, ${dur(task.minutes - gap)} after the meeting`, before: clone(s), after };
      }
      after.tasks[id] = { ...task, after: m.id };
      return { kind: 'conflict', summary: `${head} Fix: move it after the meeting`, before: clone(s), after };
    }
    // 1) Split any scheduled task longer than the mood's block (default 90 min).
    const sp = this.nextSplit(s); if (sp) return sp;
    // 2) Overload: defer lowest-priority, latest blocks to tomorrow until it fits.
    const total = scheduledMinutes(s);
    if (total > s.availableMinutes && !s.timeline.some((id) => !s.tasks[id].done)) return null;
    if (total > s.availableMinutes) {
      const over = total - s.availableMinutes;
      const candidates = [...s.timeline].filter((id) => !s.tasks[id].done).reverse().sort((a, b) => s.tasks[b].priority - s.tasks[a].priority);
      const pick = candidates.find((id) => s.tasks[id].minutes >= over) ?? candidates[0];
      const after = clone(s);
      after.timeline = after.timeline.filter((x) => x !== pick);
      after.tomorrow.push(pick);
      return { kind: 'defer', summary: `Overloaded by ${dur(over)} (${dur(total)} > ${dur(s.availableMinutes)} free). Moved "${s.tasks[pick].title}" to tomorrow`, before: clone(s), after };
    }
    return null;
  }
  /** Rule 1 only: split one scheduled task longer than the block length (mood: 20 / 45 / 90 min). */
  nextSplit(s: PlanState): PlanChange | null {
    // 1) Split any scheduled task longer than 90 min into <=90 min cards.
    const MAX = maxBlock(s); // mood: low 20 / okay 45 / focused 90 (unset 90)
    for (const id of s.timeline) {
      const task = s.tasks[id];
      if (task.minutes > MAX) {
        const after = clone(s);
        const parts = Math.ceil(task.minutes / MAX);
        const ids: string[] = [];
        for (let i = 0; i < parts; i++) {
          const pid = `${id}~${i + 1}`;
          // mood set: even parts (45 m at low → 3 × 15 m, no 5 m stub); unset: the v2.1 split (90 m blocks + remainder)
          const minutes = s.mood ? Math.floor(task.minutes / parts) + (i < task.minutes % parts ? 1 : 0) : i < parts - 1 ? MAX : task.minutes - MAX * (parts - 1);
          after.tasks[pid] = { ...task, id: pid, minutes, title: `${task.title} (${i + 1}/${parts})`, partOf: id };
          ids.push(pid);
        }
        const at = after.timeline.indexOf(id);
        after.timeline.splice(at, 1, ...ids);
        // keep the 2nd half after the next block so there's a break in between
        if (!s.mood && ids.length > 1 && at + ids.length < after.timeline.length) { // mood set: explicit breaks instead, parts stay in order
          const [second] = after.timeline.splice(at + 1, 1);
          after.timeline.splice(at + 2, 0, second);
        }
        delete after.tasks[id];
        return { kind: 'split', summary: `Split "${task.title}" (${dur(task.minutes)}) into ${parts} focus blocks of ≤${MAX}m${s.mood && s.mood !== 'focused' ? ` (mood: ${s.mood})` : ''}`, before: clone(s), after };
      }
    }
    return null;
  }
  /** Step 3 morning pre-plan: mood splits, low-mood cap (extras go to Pending), must-dos from the desk that fit,
   *  then meeting clashes and overload. Returns the new state and ONE line saying what changed ('' = nothing). */
  morning(s0: PlanState, cap?: number): { after: PlanState; line: string } {
    const s = clone(s0); let split = 0, parked = 0, planned = 0, fixed = 0, deferred = 0;
    const apply = (c: PlanChange) => { Object.assign(s, clone(c.after)); if (c.kind === 'conflict') fixed++; else if (c.kind === 'defer') deferred++; else split++; };
    // 1) meeting clashes first (so mood splits work on the fixed blocks)
    for (let i = 0; i < 8; i++) { const c = this.nextChange(s); if (!c || c.kind !== 'conflict') break; apply(c); }
    // 2) low-mood cap: keep whole tasks in order until ≤cap blocks after splitting; the rest wait in Pending (unsplit)
    if (cap) { const MAX = maxBlock(s); let blocks = 0; const keep: string[] = [];
      for (const id of s.timeline) { const t = s.tasks[id]; const n = t.done ? 0 : Math.ceil(t.minutes / MAX);
        if (t.done || blocks + n <= cap) { keep.push(id); blocks += n; } else { s.stack.unshift(id); parked++; } }
      s.timeline = keep; }
    // 3) mood splits
    for (let i = 0; i < 30; i++) { const c = this.nextSplit(s); if (!c) break; apply(c); }
    // 4) overload (defer) and anything else, then must-dos from the desk that fit, then a last pass
    for (let i = 0; i < 12; i++) { const c = this.nextChange(s); if (!c) break; apply(c); }
    const open = () => s.timeline.filter((id) => !s.tasks[id].done).length;
    for (const id of [...s.stack]) {
      const t = s.tasks[id]; if (!t || t.priority !== 1 || t.done || (cap && open() >= cap + 1)) continue;
      const trial = clone(s); trial.timeline.push(id); trial.stack = trial.stack.filter((x) => x !== id);
      if (scheduledMinutes(trial) <= s.availableMinutes && !layout(trial).slots[id].clash && !this.nextSplit(trial)) { Object.assign(s, trial); planned++; }
    }
    const parts: string[] = [];
    if (planned) parts.push(`${planned} must-do planned`);
    if (fixed) parts.push(`${fixed} clash${fixed > 1 ? 'es' : ''} fixed`);
    if (split) parts.push(`${split} split`);
    if (parked) parts.push(`${parked} to Pending`);
    if (deferred) parts.push(`${deferred} to tomorrow`);
    const n = planned + fixed + split + parked + deferred;
    return { after: s, line: n ? `Moved ${n} thing${n > 1 ? 's' : ''} for you: ${parts.join(', ')}` : '' };
  }
  /** Quiet auto-adjust after an early finish: put one Pending must-do / should-do into the freed time if it fits. */
  fillGap(s0: PlanState): PlanState | null {
    for (const id of s0.stack) {
      const t = s0.tasks[id]; if (!t || t.done || t.priority > 2) continue;
      const trial = clone(s0); trial.timeline.push(id); trial.stack = trial.stack.filter((x) => x !== id);
      if (scheduledMinutes(trial) <= s0.availableMinutes && !layout(trial).slots[id].clash) return trial;
    }
    return null;
  }
}
