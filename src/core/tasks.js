// Tasks: creation, completion (with repeats), and the views the UI shows.
//
// A task's `due` is a local wall-clock string ("2026-05-14T15:00"). When
// `hasTime` is false only the day matters and the task is due all day.

import { addDays, dayKey, fromLocalIso, startOfDay, toLocalIso } from './dates.js';
import { newId } from './ids.js';
import { nextOccurrence } from './recurrence.js';

export function createTask(draft, now = new Date()) {
  const title = (draft.title ?? '').trim();
  if (!title) throw new Error('a task needs a title');
  return {
    id: newId('t', now.getTime()),
    title,
    notes: draft.notes ?? '',
    due: draft.due ?? null,
    hasTime: Boolean(draft.due && draft.hasTime),
    priority: [1, 2, 3, 4].includes(draft.priority) ? draft.priority : 4,
    project: draft.project || null,
    labels: [...new Set(draft.labels ?? [])],
    recurrence: draft.recurrence ?? null,
    sourceUrl: draft.sourceUrl ?? null,
    sourceTitle: draft.sourceTitle ?? null,
    highlightId: draft.highlightId ?? null,
    createdAt: now.toISOString(),
    completedAt: null,
    remindedFor: null,
  };
}

/**
 * Finish a task. A repeating task is closed and a new one is returned for the
 * next occurrence, so the history of completions is kept.
 * @returns {{ done: object, next: object | null }}
 */
export function completeTask(task, now = new Date()) {
  const done = { ...task, completedAt: now.toISOString() };
  if (!task.recurrence || !task.due) return { done, next: null };
  const nextDue = nextOccurrence(task.recurrence, fromLocalIso(task.due), now);
  const next = {
    ...task,
    id: newId('t', now.getTime()),
    due: toLocalIso(nextDue),
    createdAt: now.toISOString(),
    completedAt: null,
    remindedFor: null,
  };
  return { done, next };
}

export function reopenTask(task) {
  return { ...task, completedAt: null };
}

/** overdue | today | upcoming | someday | done */
export function bucketOf(task, now = new Date()) {
  if (task.completedAt) return 'done';
  if (!task.due) return 'someday';
  const due = fromLocalIso(task.due);
  const today = startOfDay(now);
  if (task.hasTime ? due < now && dayKey(due) !== dayKey(now) : due < today) return 'overdue';
  if (dayKey(due) === dayKey(now)) return task.hasTime && due < now ? 'overdue' : 'today';
  return 'upcoming';
}

/** Order for a list: priority first, then time, then creation. */
export function compareTasks(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function compareByDue(a, b) {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return compareTasks(a, b);
}

/** What needs attention now: overdue first, then today. */
export function viewToday(tasks, now = new Date()) {
  const overdue = [];
  const today = [];
  for (const task of tasks) {
    const bucket = bucketOf(task, now);
    if (bucket === 'overdue') overdue.push(task);
    else if (bucket === 'today') today.push(task);
  }
  return { overdue: overdue.sort(compareByDue), today: today.sort(compareTasks) };
}

/** The next `days` days after today, one group per day that has tasks. */
export function viewUpcoming(tasks, now = new Date(), days = 7) {
  const first = addDays(startOfDay(now), 1);
  const last = addDays(first, days);
  const groups = new Map();
  for (const task of tasks) {
    if (task.completedAt || !task.due) continue;
    const due = fromLocalIso(task.due);
    if (due < first || due >= last) continue;
    const key = dayKey(due);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, list]) => ({ day, tasks: list.sort(compareByDue) }));
}

export function viewInbox(tasks) {
  return tasks.filter((task) => !task.completedAt && !task.due && !task.project).sort(compareTasks);
}

export function viewProject(tasks, project) {
  return tasks.filter((task) => !task.completedAt && task.project === project).sort(compareTasks);
}

export function viewDone(tasks, limit = 50) {
  return tasks
    .filter((task) => task.completedAt)
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
    .slice(0, limit);
}

/** Open projects with their open task counts, busiest first. */
export function projectCounts(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    if (task.completedAt || !task.project) continue;
    counts.set(task.project, (counts.get(task.project) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));
}

/** Number for the toolbar badge: overdue plus today. */
export function attentionCount(tasks, now = new Date()) {
  const { overdue, today } = viewToday(tasks, now);
  return overdue.length + today.length;
}

/**
 * Timed tasks whose moment has arrived and that have not been announced for
 * this due time yet.
 */
export function dueReminders(tasks, now = new Date()) {
  return tasks.filter((task) => {
    if (task.completedAt || !task.due || !task.hasTime) return false;
    if (task.remindedFor === task.due) return false;
    const due = fromLocalIso(task.due);
    return due <= now && now.getTime() - due.getTime() < 12 * 3600000;
  });
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Human label for a due value relative to now: 今天 15:00, 明天, 周五, 5月20日. */
export function describeDue(task, now = new Date()) {
  if (!task.due) return '';
  const due = fromLocalIso(task.due);
  const diff = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  let day;
  if (diff === 0) day = '今天';
  else if (diff === 1) day = '明天';
  else if (diff === -1) day = '昨天';
  else if (diff > 1 && diff < 7) day = WEEKDAYS[due.getDay()];
  else if (due.getFullYear() === now.getFullYear()) day = `${due.getMonth() + 1}月${due.getDate()}日`;
  else day = `${due.getFullYear()}年${due.getMonth() + 1}月${due.getDate()}日`;
  if (!task.hasTime) return day;
  return `${day} ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
}
