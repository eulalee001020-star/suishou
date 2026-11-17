// Quick add: one line of text becomes a task.
//
//   明天下午3点 交论文初稿 p1 #论文 @写作
//   每周五 交周报
//   call dentist friday 3:30pm p2
//
// Recognised parts, in any order:
//   p1..p4 or !!! / !! / !    priority (1 is highest; default 4)
//   #name                     project
//   @name                     label, any number
//   a repeat phrase           每天 / 每周五 / every weekday ...
//   a date and time           see dates.js
// Everything else is the title.

import { parseDateTime, toLocalIso } from './dates.js';
import { firstOccurrence, parseRecurrence } from './recurrence.js';

const TOKEN_END = '(?=\\s|$)';

export function parseQuickAdd(input, now = new Date()) {
  let text = ` ${input.trim()} `;
  let priority = 4;
  let project = null;
  const labels = [];

  text = text.replace(new RegExp(`\\s[pP]([1-4])${TOKEN_END}`), (_all, level) => {
    priority = Number(level);
    return ' ';
  });
  text = text.replace(new RegExp(`\\s([!！]{1,3})${TOKEN_END}`), (_all, marks) => {
    priority = Math.min(priority, 4 - marks.length);
    return ' ';
  });
  text = text.replace(new RegExp(`\\s#([^\\s#@]+)${TOKEN_END}`), (_all, name) => {
    project = name;
    return ' ';
  });
  text = text.replace(new RegExp(`\\s@([^\\s#@]+)${TOKEN_END}`, 'g'), (_all, name) => {
    if (!labels.includes(name)) labels.push(name);
    return ' ';
  });

  const repeat = parseRecurrence(text);
  const when = parseDateTime(repeat.rest, now);
  let due = when.date;
  if (repeat.rule) {
    // "每周五" names the day itself; a clock time found alongside is kept.
    const base = due ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const first = firstOccurrence(repeat.rule, base);
    due = when.date && !(repeat.rule.weekday !== undefined || repeat.rule.monthDay !== undefined)
      ? when.date
      : new Date(first.getFullYear(), first.getMonth(), first.getDate(), base.getHours(), base.getMinutes());
    if (when.hasTime && due <= now && !sameDay(due, now)) due = first;
    if (when.hasTime && due <= now) due = firstOccurrence(repeat.rule, new Date(due.getTime() + 86400000));
  }

  return {
    title: when.rest,
    due: due ? toLocalIso(due) : null,
    hasTime: when.hasTime,
    priority,
    project,
    labels,
    recurrence: repeat.rule,
  };
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
