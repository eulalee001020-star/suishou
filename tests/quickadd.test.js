import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/core/quickadd.js';
import { describeRecurrence, firstOccurrence, nextOccurrence, parseRecurrence } from '../src/core/recurrence.js';
import { toLocalIso } from '../src/core/dates.js';

// Wednesday 2026-05-13 10:00.
const NOW = new Date(2026, 4, 13, 10, 0);
const add = (text) => parseQuickAdd(text, NOW);

test('a plain title has no date and the lowest priority', () => {
  assert.deepEqual(add('买牛奶'), {
    title: '买牛奶', due: null, hasTime: false, priority: 4, project: null, labels: [], recurrence: null,
  });
});

test('everything at once, in any order', () => {
  const task = add('明天下午3点 交论文初稿 p1 #论文 @写作 @导师');
  assert.equal(task.title, '交论文初稿');
  assert.equal(task.due, '2026-05-14T15:00');
  assert.equal(task.hasTime, true);
  assert.equal(task.priority, 1);
  assert.equal(task.project, '论文');
  assert.deepEqual(task.labels, ['写作', '导师']);

  const reordered = add('#论文 p1 交论文初稿 @写作 明天下午3点');
  assert.equal(reordered.title, '交论文初稿');
  assert.equal(reordered.due, '2026-05-14T15:00');
});

test('priority marks', () => {
  assert.equal(add('回邮件 !!!').priority, 1);
  assert.equal(add('回邮件 !!').priority, 2);
  assert.equal(add('回邮件 ！').priority, 3);
  assert.equal(add('回邮件 P2').priority, 2);
});

test('words that only look like tokens stay in the title', () => {
  assert.equal(add('看 p5 的演示').title, '看 p5 的演示');
  assert.equal(add('读 C# 入门').title, '读 C# 入门');
  assert.equal(add('发邮件给 a@b.com').title, '发邮件给 a@b.com');
  assert.equal(add('完成率做到 80%!').title, '完成率做到 80%!');
});

test('English', () => {
  const task = add('call dentist friday 3:30pm p2 #health');
  assert.equal(task.title, 'call dentist');
  assert.equal(task.due, '2026-05-15T15:30');
  assert.equal(task.priority, 2);
  assert.equal(task.project, 'health');
});

test('repeat phrases', () => {
  assert.deepEqual(parseRecurrence('每天背单词').rule, { freq: 'daily', interval: 1 });
  assert.deepEqual(parseRecurrence('每周五交周报').rule, { freq: 'weekly', interval: 1, weekday: 5 });
  assert.deepEqual(parseRecurrence('每两周复盘').rule, { freq: 'weekly', interval: 2 });
  assert.deepEqual(parseRecurrence('每月5号还信用卡').rule, { freq: 'monthly', interval: 1, monthDay: 5 });
  assert.deepEqual(parseRecurrence('每个工作日站会').rule, { freq: 'weekdays', interval: 1 });
  assert.deepEqual(parseRecurrence('every monday review').rule, { freq: 'weekly', interval: 1, weekday: 1 });
  assert.deepEqual(parseRecurrence('water plants every 3 days').rule, { freq: 'daily', interval: 3 });
  assert.equal(parseRecurrence('每一个细节都要检查').rule, null);
});

test('a repeating task starts on its first occurrence', () => {
  assert.equal(add('每周五 交周报').due, '2026-05-15T00:00');
  assert.equal(add('每周五 交周报').title, '交周报');
  assert.equal(add('每周三 例会').due, '2026-05-13T00:00');
  assert.equal(add('每月5号 还信用卡').due, '2026-06-05T00:00');
  assert.equal(add('每天 背单词').due, '2026-05-13T00:00');
  assert.equal(add('每个工作日 站会').due, '2026-05-13T00:00');
});

test('a repeating task keeps its clock time', () => {
  const task = add('每天晚上9点 背单词');
  assert.equal(task.due, '2026-05-13T21:00');
  assert.equal(task.hasTime, true);
  assert.deepEqual(task.recurrence, { freq: 'daily', interval: 1 });
  assert.equal(add('每周五下午5点 交周报').due, '2026-05-15T17:00');
  // 9 o'clock has passed today, so the first one is tomorrow.
  assert.equal(add('每天上午9点 晨读').due, '2026-05-14T09:00');
});

test('next occurrence', () => {
  const next = (rule, y, m, d, hh = 0, mm = 0) => toLocalIso(nextOccurrence(rule, new Date(y, m - 1, d, hh, mm)));
  assert.equal(next({ freq: 'daily', interval: 1 }, 2026, 5, 13, 21), '2026-05-14T21:00');
  assert.equal(next({ freq: 'daily', interval: 3 }, 2026, 5, 30), '2026-06-02T00:00');
  assert.equal(next({ freq: 'weekdays', interval: 1 }, 2026, 5, 15), '2026-05-18T00:00');
  assert.equal(next({ freq: 'weekly', interval: 1, weekday: 5 }, 2026, 5, 15, 17), '2026-05-22T17:00');
  assert.equal(next({ freq: 'weekly', interval: 2 }, 2026, 5, 13), '2026-05-27T00:00');
  assert.equal(next({ freq: 'monthly', interval: 1, monthDay: 31 }, 2026, 5, 31), '2026-06-30T00:00');
  assert.equal(next({ freq: 'monthly', interval: 1, monthDay: 31 }, 2026, 6, 30), '2026-07-31T00:00');
  assert.equal(next({ freq: 'yearly', interval: 1 }, 2024, 2, 29), '2025-02-28T00:00');
});

test('finishing late skips the occurrences already missed', () => {
  const rule = { freq: 'daily', interval: 1 };
  const due = new Date(2026, 4, 10, 21, 0);
  const finished = new Date(2026, 4, 13, 10, 0);
  assert.equal(toLocalIso(nextOccurrence(rule, due, finished)), '2026-05-13T21:00');
});

test('first occurrence and labels', () => {
  const saturday = new Date(2026, 4, 16);
  assert.equal(toLocalIso(firstOccurrence({ freq: 'weekdays', interval: 1 }, saturday)), '2026-05-18T00:00');
  assert.equal(describeRecurrence({ freq: 'weekly', interval: 1, weekday: 5 }), '每周五');
  assert.equal(describeRecurrence({ freq: 'daily', interval: 2 }), '每 2 天');
  assert.equal(describeRecurrence({ freq: 'monthly', interval: 1, monthDay: 5 }), '每月 5 号');
  assert.equal(describeRecurrence(null), '');
});
