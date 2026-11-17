// Daily review of saved highlights, on a Leitner schedule.
//
// A highlight sits in a box. Each time it is reviewed and kept it moves up a
// box and waits longer before it comes back; "看不懂了/再看看" sends it back
// to the first box; "已吸收" retires it. Intervals in days per box:
//
//   box   0  1  2   3   4   5
//   wait  1  3  7  14  30  90

import { addDays, startOfDay } from './dates.js';

export const INTERVALS = [1, 3, 7, 14, 30, 90];
export const DEFAULT_DAILY_LIMIT = 5;

function dueDay(highlight) {
  if (highlight.review?.dueAt) return new Date(highlight.review.dueAt);
  // Never reviewed: first comes back the day after it was saved.
  return addDays(startOfDay(new Date(highlight.createdAt)), INTERVALS[0]);
}

/** Highlights to review today: the longest-waiting first, capped. */
export function dueForReview(highlights, now = new Date(), limit = DEFAULT_DAILY_LIMIT) {
  const endOfToday = addDays(startOfDay(now), 1);
  return highlights
    .filter((item) => !item.review?.retired && dueDay(item) < endOfToday)
    .sort((a, b) => dueDay(a) - dueDay(b) || (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, limit);
}

/** How many are waiting in total, ignoring the daily cap. */
export function backlogCount(highlights, now = new Date()) {
  return dueForReview(highlights, now, Infinity).length;
}

/**
 * Record a review.
 * @param {'keep' | 'again' | 'retire'} grade
 */
export function gradeReview(highlight, grade, now = new Date()) {
  const previous = highlight.review ?? { box: 0, count: 0 };
  const base = { ...previous, lastReviewedAt: now.toISOString(), count: (previous.count ?? 0) + 1 };
  if (grade === 'retire') {
    return { ...highlight, review: { ...base, retired: true, dueAt: null } };
  }
  const box = grade === 'again' ? 0 : Math.min((previous.box ?? 0) + 1, INTERVALS.length - 1);
  const dueAt = addDays(startOfDay(now), INTERVALS[box]).toISOString();
  return { ...highlight, review: { ...base, box, dueAt, retired: false } };
}
