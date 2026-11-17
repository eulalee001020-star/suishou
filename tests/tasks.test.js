import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionCount, bucketOf, completeTask, createTask, describeDue, dueReminders,
  projectCounts, reopenTask, viewDone, viewInbox, viewProject, viewToday, viewUpcoming,
} from '../src/core/tasks.js';

const NOW = new Date(2026, 4, 13, 10, 0); // Wednesday
let tick = 0;
const make = (draft) => createTask(draft, new Date(NOW.getTime() + tick++ * 1000));

test('a task needs a title and gets safe defaults', () => {
  assert.throws(() => createTask({ title: '  ' }, NOW));
  const task = createTask({ title: ' 买牛奶 ', priority: 9, labels: ['a', 'a'] }, NOW);
  assert.equal(task.title, '买牛奶');
  assert.equal(task.priority, 4);
  assert.deepEqual(task.labels, ['a']);
  assert.equal(task.hasTime, false);
  assert.match(task.id, /^t_/);
});

test('buckets', () => {
  const bucket = (due, hasTime = false) => bucketOf(make({ title: 'x', due, hasTime }), NOW);
  assert.equal(bucket(null), 'someday');
  assert.equal(bucket('2026-05-12T00:00'), 'overdue');
  assert.equal(bucket('2026-05-13T00:00'), 'today');
  assert.equal(bucket('2026-05-14T00:00'), 'upcoming');
  // A timed task today is overdue once its time has passed.
  assert.equal(bucket('2026-05-13T09:00', true), 'overdue');
  assert.equal(bucket('2026-05-13T15:00', true), 'today');
  assert.equal(bucketOf({ ...make({ title: 'x' }), completedAt: NOW.toISOString() }, NOW), 'done');
});

test('today view lists overdue oldest first and today by priority', () => {
  const tasks = [
    make({ title: '今天低', due: '2026-05-13T00:00', priority: 4 }),
    make({ title: '今天高', due: '2026-05-13T00:00', priority: 1 }),
    make({ title: '昨天', due: '2026-05-12T00:00' }),
    make({ title: '上周', due: '2026-05-06T00:00' }),
    make({ title: '明天', due: '2026-05-14T00:00' }),
    make({ title: '无日期' }),
  ];
  const view = viewToday(tasks, NOW);
  assert.deepEqual(view.overdue.map((t) => t.title), ['上周', '昨天']);
  assert.deepEqual(view.today.map((t) => t.title), ['今天高', '今天低']);
  assert.equal(attentionCount(tasks, NOW), 4);
});

test('upcoming view groups the next seven days', () => {
  const tasks = [
    make({ title: 'a', due: '2026-05-14T09:00', hasTime: true }),
    make({ title: 'b', due: '2026-05-14T00:00' }),
    make({ title: 'c', due: '2026-05-20T00:00' }),
    make({ title: 'd', due: '2026-05-21T00:00' }),
    make({ title: 'e', due: '2026-05-13T00:00' }),
  ];
  const view = viewUpcoming(tasks, NOW);
  assert.deepEqual(view.map((g) => g.day), ['2026-05-14', '2026-05-20']);
  assert.deepEqual(view[0].tasks.map((t) => t.title), ['b', 'a']);
});

test('inbox, project and done views', () => {
  const tasks = [
    make({ title: '收件箱' }),
    make({ title: '有项目', project: '论文' }),
    make({ title: '有项目2', project: '论文', priority: 1 }),
    make({ title: '另一个', project: '求职' }),
  ];
  const finished = completeTask(tasks[0], NOW).done;
  const all = [finished, ...tasks.slice(1)];
  assert.deepEqual(viewInbox(all), []);
  assert.deepEqual(viewProject(all, '论文').map((t) => t.title), ['有项目2', '有项目']);
  assert.deepEqual(projectCounts(all), [{ name: '论文', count: 2 }, { name: '求职', count: 1 }]);
  assert.deepEqual(viewDone(all).map((t) => t.title), ['收件箱']);
  assert.equal(reopenTask(finished).completedAt, null);
});

test('finishing a repeating task creates the next one and keeps the old', () => {
  const task = make({ title: '背单词', due: '2026-05-13T21:00', hasTime: true, recurrence: { freq: 'daily', interval: 1 } });
  const { done, next } = completeTask(task, new Date(2026, 4, 13, 21, 30));
  assert.ok(done.completedAt);
  assert.equal(next.due, '2026-05-14T21:00');
  assert.equal(next.completedAt, null);
  assert.notEqual(next.id, task.id);
  assert.deepEqual(next.recurrence, task.recurrence);
});

test('finishing a repeating task late does not create an overdue one', () => {
  const task = make({ title: '周报', due: '2026-05-01T00:00', recurrence: { freq: 'weekly', interval: 1, weekday: 5 } });
  const { next } = completeTask(task, NOW);
  assert.equal(next.due, '2026-05-15T00:00');
});

test('a one-off task has no successor', () => {
  assert.equal(completeTask(make({ title: 'x', due: '2026-05-13T00:00' }), NOW).next, null);
});

test('reminders fire once per due time', () => {
  const due = make({ title: '开会', due: '2026-05-13T09:55', hasTime: true });
  const later = make({ title: '晚点', due: '2026-05-13T11:00', hasTime: true });
  const allDay = make({ title: '全天', due: '2026-05-13T00:00' });
  const stale = make({ title: '很久以前', due: '2026-05-10T09:00', hasTime: true });
  assert.deepEqual(dueReminders([due, later, allDay, stale], NOW).map((t) => t.title), ['开会']);
  assert.deepEqual(dueReminders([{ ...due, remindedFor: due.due }], NOW), []);
});

test('due labels', () => {
  const label = (due, hasTime = false) => describeDue({ due, hasTime }, NOW);
  assert.equal(label('2026-05-13T00:00'), '今天');
  assert.equal(label('2026-05-13T15:00', true), '今天 15:00');
  assert.equal(label('2026-05-14T00:00'), '明天');
  assert.equal(label('2026-05-12T00:00'), '昨天');
  assert.equal(label('2026-05-16T00:00'), '周六');
  assert.equal(label('2026-06-20T00:00'), '6月20日');
  assert.equal(label('2027-01-02T00:00'), '2027年1月2日');
  assert.equal(describeDue({ due: null }, NOW), '');
});
