// Repeat rules for tasks.
//
// A rule is { freq, interval, weekday?, monthDay? }:
//   daily      every `interval` days
//   weekdays   Monday to Friday
//   weekly     every `interval` weeks, on `weekday` (0 = Sunday) when given
//   monthly    every `interval` months, on `monthDay` when given
//   yearly     every `interval` years

import { toNumber } from './dates.js';

const ZH_WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const EN_WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const NUM = '[0-9一二两三四五六七八九十]+';

const RULES = [
  [/每个?工作日|工作日每天/, () => ({ freq: 'weekdays', interval: 1 })],
  [new RegExp(`每(?:周|星期|礼拜)([一二三四五六日天])`), (m) => ({ freq: 'weekly', interval: 1, weekday: ZH_WEEKDAYS[m[1]] })],
  [new RegExp(`每(${NUM})(?:周|个?星期)`), (m) => ({ freq: 'weekly', interval: toNumber(m[1]) })],
  [/每周|每星期|每礼拜/, () => ({ freq: 'weekly', interval: 1 })],
  [new RegExp(`每个?月(${NUM})[日号]`), (m) => ({ freq: 'monthly', interval: 1, monthDay: toNumber(m[1]) })],
  [new RegExp(`每(${NUM})个?月`), (m) => ({ freq: 'monthly', interval: toNumber(m[1]) })],
  [/每个?月/, () => ({ freq: 'monthly', interval: 1 })],
  [new RegExp(`每(${NUM})天`), (m) => ({ freq: 'daily', interval: toNumber(m[1]) })],
  [/每天|每日|天天/, () => ({ freq: 'daily', interval: 1 })],
  [/每年/, () => ({ freq: 'yearly', interval: 1 })],
  [/\bevery\s+weekday\b|\bweekdays\b/i, () => ({ freq: 'weekdays', interval: 1 })],
  [/\bevery\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (m) => ({ freq: 'weekly', interval: 1, weekday: EN_WEEKDAYS[m[1].toLowerCase()] })],
  [/\bevery\s+(\d+)\s+days\b/i, (m) => ({ freq: 'daily', interval: +m[1] })],
  [/\bevery\s+(\d+)\s+weeks\b/i, (m) => ({ freq: 'weekly', interval: +m[1] })],
  [/\bevery\s+day\b|\bdaily\b/i, () => ({ freq: 'daily', interval: 1 })],
  [/\bevery\s+week\b|\bweekly\b/i, () => ({ freq: 'weekly', interval: 1 })],
  [/\bevery\s+month\b|\bmonthly\b/i, () => ({ freq: 'monthly', interval: 1 })],
  [/\bevery\s+year\b|\byearly\b|\bannually\b/i, () => ({ freq: 'yearly', interval: 1 })],
];

/** Find a repeat phrase. Returns { rule, rest } or { rule: null, rest: text }. */
export function parseRecurrence(text) {
  let best = null;
  for (const [pattern, build] of RULES) {
    const match = text.match(pattern);
    if (!match) continue;
    const rule = build(match);
    if (!(rule.interval >= 1)) continue;
    if (best === null || match.index < best.index) {
      best = { index: match.index, length: match[0].length, rule };
    }
  }
  if (!best) return { rule: null, rest: text };
  const rest = text.slice(0, best.index) + ' ' + text.slice(best.index + best.length);
  return { rule: best.rule, rest };
}

function clampDay(year, month, day, hours, minutes) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last), hours, minutes);
}

/**
 * The first occurrence on or after `from` (same clock time as `from`).
 * Used when a repeating task is created without a date.
 */
export function firstOccurrence(rule, from) {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes());
  if (rule.freq === 'weekdays') {
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    return day;
  }
  if (rule.freq === 'weekly' && rule.weekday !== undefined) {
    day.setDate(day.getDate() + ((rule.weekday - day.getDay() + 7) % 7));
    return day;
  }
  if (rule.freq === 'monthly' && rule.monthDay !== undefined) {
    const candidate = clampDay(day.getFullYear(), day.getMonth(), rule.monthDay, day.getHours(), day.getMinutes());
    if (candidate >= new Date(day.getFullYear(), day.getMonth(), day.getDate())) return candidate;
    return clampDay(day.getFullYear(), day.getMonth() + 1, rule.monthDay, day.getHours(), day.getMinutes());
  }
  return day;
}

/**
 * The occurrence after `current`. When a task is finished late, pass the
 * completion time as `notBefore` so the next one is not already overdue.
 */
export function nextOccurrence(rule, current, notBefore = current) {
  const floor = new Date(notBefore.getFullYear(), notBefore.getMonth(), notBefore.getDate());
  let next = new Date(current.getTime());
  const step = () => {
    const h = next.getHours();
    const min = next.getMinutes();
    switch (rule.freq) {
      case 'daily':
        next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + rule.interval, h, min);
        break;
      case 'weekdays':
        do {
          next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1, h, min);
        } while (next.getDay() === 0 || next.getDay() === 6);
        break;
      case 'weekly':
        next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 7 * rule.interval, h, min);
        break;
      case 'monthly':
        next = clampDay(next.getFullYear(), next.getMonth() + rule.interval, rule.monthDay ?? current.getDate(), h, min);
        break;
      case 'yearly':
        next = clampDay(next.getFullYear() + rule.interval, next.getMonth(), current.getDate(), h, min);
        break;
      default:
        throw new Error(`unknown repeat frequency: ${rule.freq}`);
    }
  };
  step();
  let guard = 0;
  while (next < floor && guard++ < 5000) step();
  return next;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Short Chinese label for a rule, e.g. "每周五" or "每 2 天". */
export function describeRecurrence(rule) {
  if (!rule) return '';
  const n = rule.interval;
  switch (rule.freq) {
    case 'daily':
      return n === 1 ? '每天' : `每 ${n} 天`;
    case 'weekdays':
      return '每个工作日';
    case 'weekly':
      if (rule.weekday !== undefined) return `每${WEEKDAY_NAMES[rule.weekday]}`;
      return n === 1 ? '每周' : `每 ${n} 周`;
    case 'monthly':
      if (rule.monthDay !== undefined) return `每月 ${rule.monthDay} 号`;
      return n === 1 ? '每月' : `每 ${n} 个月`;
    case 'yearly':
      return '每年';
    default:
      return '';
  }
}
