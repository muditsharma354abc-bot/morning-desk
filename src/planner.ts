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
}
