// Natural-language dates and times, in Chinese and English.
//
// `parseDateTime(text, now)` finds the date and time phrases in a sentence
// and returns the moment they describe together with the text that is left.
// It never returns a moment in the past for a relative phrase: "周五" on a
// Friday means today, "3点" after 3 o'clock means tomorrow.

const ZH_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 末: 6 };
const EN_WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const EN_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const NUM = '[0-9零〇一二两三四五六七八九十]+';

/** Read an Arabic or Chinese numeral up to 99. Returns NaN when it is neither. */
export function toNumber(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === '十') return 10;
  let match = raw.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (match) return (match[1] ? ZH_DIGITS[match[1]] : 1) * 10 + (match[2] ? ZH_DIGITS[match[2]] : 0);
  match = raw.match(/^[零〇一二两三四五六七八九]+$/);
  if (match) return Number([...raw].map((ch) => ZH_DIGITS[ch]).join(''));
  return NaN;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Monday-based start of the week that contains `date`. */
export function startOfWeek(date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(startOfDay(date), -day);
}

function weekdayInWeek(now, weekday, weekOffset) {
  const monday = startOfWeek(now);
  return addDays(monday, weekOffset * 7 + ((weekday + 6) % 7));
}

function nextWeekday(now, weekday) {
  const today = startOfDay(now);
  return addDays(today, (weekday - today.getDay() + 7) % 7);
}

function clampDay(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

/** A month and day with no year: this year, or next year if already past. */
function monthDay(now, month, day) {
  const today = startOfDay(now);
  const candidate = new Date(now.getFullYear(), month, day);
  if (candidate.getMonth() !== month) return null;
  return candidate < today ? new Date(now.getFullYear() + 1, month, day) : candidate;
}

// Each rule: a pattern and a function that returns a day (midnight) or null.
const DATE_RULES = [
  [/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => new Date(+m[1], +m[2] - 1, +m[3])],
  [new RegExp(`(${NUM})月(${NUM})[日号]?`), (m, now) => monthDay(now, toNumber(m[1]) - 1, toNumber(m[2]))],
  [/(?<![\d:.])(\d{1,2})\/(\d{1,2})(?![\d:])/, (m, now) => monthDay(now, +m[1] - 1, +m[2])],
  [/大后天/, (m, now) => addDays(startOfDay(now), 3)],
  [/后天/, (m, now) => addDays(startOfDay(now), 2)],
  [/明天|明日/, (m, now) => addDays(startOfDay(now), 1)],
  [/今天|今日/, (m, now) => startOfDay(now)],
  [/下下(?:周|星期|礼拜)([一二三四五六日天末])/, (m, now) => weekdayInWeek(now, ZH_WEEKDAYS[m[1]], 2)],
  [/下(?:周|星期|礼拜)([一二三四五六日天末])/, (m, now) => weekdayInWeek(now, ZH_WEEKDAYS[m[1]], 1)],
  [/[本这](?:周|星期|礼拜)([一二三四五六日天末])/, (m, now) => weekdayInWeek(now, ZH_WEEKDAYS[m[1]], 0)],
  [/(?:周|星期|礼拜)([一二三四五六日天末])/, (m, now) => nextWeekday(now, ZH_WEEKDAYS[m[1]])],
  [/下周|下星期/, (m, now) => weekdayInWeek(now, 1, 1)],
  [new RegExp(`(${NUM})天[后後]`), (m, now) => addDays(startOfDay(now), toNumber(m[1]))],
  [new RegExp(`(${NUM})(?:周|个?星期)[后後]`), (m, now) => addDays(startOfDay(now), toNumber(m[1]) * 7)],
  [
    new RegExp(`(${NUM})个?月[后後]`),
    (m, now) => clampDay(now.getFullYear(), now.getMonth() + toNumber(m[1]), now.getDate()),
  ],
  [/下个?月(?:(\d{1,2}|[一二三四五六七八九十]+)[日号])?/, (m, now) =>
    clampDay(now.getFullYear(), now.getMonth() + 1, m[1] ? toNumber(m[1]) : 1)],
  [/月底|月末/, (m, now) => new Date(now.getFullYear(), now.getMonth() + 1, 0)],
  [new RegExp(`(?<![月\\d])(${NUM})[日号]`), (m, now) => {
    const day = toNumber(m[1]);
    if (!(day >= 1 && day <= 31)) return null;
    const candidate = clampDay(now.getFullYear(), now.getMonth(), day);
    return candidate < startOfDay(now) ? clampDay(now.getFullYear(), now.getMonth() + 1, day) : candidate;
  }],
  [/\b(?:today|tonight)\b/i, (m, now) => startOfDay(now)],
  [/\b(?:tomorrow|tmr|tmrw)\b/i, (m, now) => addDays(startOfDay(now), 1)],
  [/\bnext\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (m, now) =>
    weekdayInWeek(now, EN_WEEKDAYS[m[1].toLowerCase()], 1)],
  [/\b(?:on\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?\b/i, (m, now) =>
    nextWeekday(now, EN_WEEKDAYS[m[1].toLowerCase()])],
  [/\bin\s+(\d+)\s+days?\b/i, (m, now) => addDays(startOfDay(now), +m[1])],
  [/\bin\s+(\d+)\s+weeks?\b/i, (m, now) => addDays(startOfDay(now), +m[1] * 7)],
  [/\bnext\s+week\b/i, (m, now) => weekdayInWeek(now, 1, 1)],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m, now) =>
    monthDay(now, EN_MONTHS[m[1].toLowerCase()], +m[2])],
  [/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, (m, now) =>
    monthDay(now, EN_MONTHS[m[2].toLowerCase()], +m[1])],
];

const PERIOD = '凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里';

function applyPeriod(hour, period) {
  if (!period) {
    // A bare "3点" is far more often 15:00 than 03:00 in a to-do list.
    return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  }
  if (/下午|傍晚|晚上|夜里/.test(period)) {
    if (hour === 12) return /晚上|夜里/.test(period) ? 24 : 12;
    return hour < 12 ? hour + 12 : hour;
  }
  if (/中午/.test(period)) return hour < 11 ? hour + 12 : hour;
  if (/凌晨/.test(period)) return hour === 12 ? 0 : hour;
  return hour;
}

// Each rule returns { hour, minute } (hour may be 24 for midnight) or null.
const TIME_RULES = [
  [new RegExp(`(${PERIOD})?\\s*(${NUM})[点點时時](?:(半)|(一刻)|(三刻)|(${NUM})分?)?`), (m) => {
    const hour = toNumber(m[2]);
    if (!(hour >= 0 && hour <= 24)) return null;
    const minute = m[3] ? 30 : m[4] ? 15 : m[5] ? 45 : m[6] ? toNumber(m[6]) : 0;
    if (!(minute >= 0 && minute < 60)) return null;
    return { hour: applyPeriod(hour, m[1]), minute };
  }],
  [new RegExp(`(${PERIOD})?\\s*(?<!\\d)(\\d{1,2})[:：](\\d{2})(?!\\d)\\s*(am|pm)?`, 'i'), (m) => {
    let hour = +m[2];
    const minute = +m[3];
    if (hour > 24 || minute > 59) return null;
    if (m[4]) hour = (hour % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
    else if (m[1]) hour = applyPeriod(hour, m[1]);
    return { hour, minute };
  }],
  [/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i, (m) => {
    const hour = +m[1];
    if (hour < 1 || hour > 12) return null;
    return { hour: (hour % 12) + (m[2].toLowerCase() === 'pm' ? 12 : 0), minute: 0 };
  }],
  [/\bat\s+(\d{1,2})\b/i, (m) => (+m[1] <= 24 ? { hour: applyPeriod(+m[1], null), minute: 0 } : null)],
  [/\bnoon\b/i, () => ({ hour: 12, minute: 0 })],
];

const RELATIVE_RULES = [
  [new RegExp(`(${NUM}|半)个?小时[后後]`), (m, now) =>
    new Date(now.getTime() + (m[1] === '半' ? 0.5 : toNumber(m[1])) * 3600000)],
  [new RegExp(`(${NUM})分钟[后後]`), (m, now) => new Date(now.getTime() + toNumber(m[1]) * 60000)],
  [/\bin\s+(\d+)\s+(?:hours?|hrs?)\b/i, (m, now) => new Date(now.getTime() + +m[1] * 3600000)],
  [/\bin\s+(\d+)\s+(?:minutes?|mins?)\b/i, (m, now) => new Date(now.getTime() + +m[1] * 60000)],
];

function firstMatch(text, rules, now) {
  let best = null;
  for (const [pattern, build] of rules) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = build(match, now);
    if (value === null || (value instanceof Date && Number.isNaN(value.getTime()))) continue;
    if (best === null || match.index < best.index) {
      best = { index: match.index, length: match[0].length, value };
    }
  }
  return best;
}

function cut(text, found) {
  return text.slice(0, found.index) + ' ' + text.slice(found.index + found.length);
}

/**
 * @param {string} text
 * @param {Date} now
 * @returns {{ date: Date | null, hasTime: boolean, rest: string }}
 */
export function parseDateTime(text, now) {
  // "今晚" carries both a day and a period of day; spell it out so each rule
  // sees its own part.
  let rest = text
    .replace(/([今明])晚上?/g, '$1天晚上')
    .replace(/([今明])早上?/g, '$1天早上');

  const relative = firstMatch(rest, RELATIVE_RULES, now);
  if (relative) {
    return { date: relative.value, hasTime: true, rest: tidy(cut(rest, relative)) };
  }

  const day = firstMatch(rest, DATE_RULES, now);
  if (day) rest = cut(rest, day);
  const time = firstMatch(rest, TIME_RULES, now);
  if (time) rest = cut(rest, time);

  if (!day && !time) return { date: null, hasTime: false, rest: tidy(text) };

  let date = day ? day.value : startOfDay(now);
  if (time) {
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.value.hour, time.value.minute);
    // A clock time with no day that has already passed means tomorrow.
    if (!day && date <= now) date = new Date(date.getTime() + 86400000);
  }
  return { date, hasTime: Boolean(time), rest: tidy(rest) };
}

function tidy(text) {
  return text.replace(/\s+/g, ' ').replace(/^[\s,，、。:：]+|[\s,，、:：]+$/g, '');
}

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local wall-clock ISO string without a zone: 2026-05-14T15:00. */
export function toLocalIso(date) {
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalIso(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return new Date(NaN);
  return new Date(+match[1], +match[2] - 1, +match[3], +(match[4] ?? 0), +(match[5] ?? 0));
}

export { addDays, startOfDay };
