import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, MemoryBackend, Store, localStorageBackend } from '../src/core/store.js';

function makeStore(start = new Date(2026, 4, 13, 10, 0)) {
  let now = start;
  const store = new Store(new MemoryBackend(), () => now);
  return { store, setNow: (value) => (now = value) };
}

test('an empty store loads defaults', async () => {
  const { store } = makeStore();
  assert.deepEqual(await store.load(), { tasks: [], highlights: [], settings: DEFAULT_SETTINGS });
});

test('tasks: add, edit, finish, reopen, delete', async () => {
  const { store } = makeStore();
  const task = await store.addTask({ title: '交周报', due: '2026-05-15T17:00', hasTime: true });
  await store.updateTask(task.id, { title: '交周报（含数据）', due: null });
  let { tasks } = await store.load();
  assert.equal(tasks[0].title, '交周报（含数据）');
  assert.equal(tasks[0].hasTime, false, 'clearing the date clears the time flag');
  assert.equal(tasks[0].id, task.id);

  const outcome = await store.toggleTask(task.id);
  assert.ok(outcome.done.completedAt);
  await store.toggleTask(task.id);
  assert.equal((await store.load()).tasks[0].completedAt, null);

  await store.deleteTask(task.id);
  assert.deepEqual((await store.load()).tasks, []);
  assert.equal(await store.toggleTask('missing'), null);
});

test('finishing a repeating task stores both the finished one and the next', async () => {
  const { store } = makeStore();
  const task = await store.addTask({
    title: '背单词', due: '2026-05-13T21:00', hasTime: true, recurrence: { freq: 'daily', interval: 1 },
  });
  await store.toggleTask(task.id);
  const { tasks } = await store.load();
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((t) => [Boolean(t.completedAt), t.due]), [
    [true, '2026-05-13T21:00'],
    [false, '2026-05-14T21:00'],
  ]);
});

test('writes issued together do not overwrite each other', async () => {
  const { store } = makeStore();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.addTask({ title: `任务 ${i}` })));
  assert.equal((await store.load()).tasks.length, 20);
});

test('highlights: saving twice returns the first; notes and tags can be edited', async () => {
  const { store } = makeStore();
  const draft = { text: '一句值得记住的话', url: 'https://claude.ai/chat/1', pageTitle: '对话' };
  const first = await store.addHighlight(draft);
  const second = await store.addHighlight({ ...draft, text: '  一句值得记住的话 ' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.highlight.id, first.highlight.id);

  const updated = await store.updateHighlight(first.highlight.id, { note: ' 重要 ', tags: ['#方法', '方法'] });
  assert.equal(updated.note, '重要');
  assert.deepEqual(updated.tags, ['方法']);
  assert.equal(updated.text, '一句值得记住的话');

  const graded = await store.gradeHighlight(first.highlight.id, 'keep');
  assert.equal(graded.review.box, 1);
  await store.deleteHighlight(first.highlight.id);
  assert.deepEqual((await store.load()).highlights, []);
});

test('saving a highlight does not touch tasks', async () => {
  const backend = new MemoryBackend();
  const store = new Store(backend, () => new Date(2026, 4, 13));
  const written = [];
  backend.subscribe((keys) => written.push(...keys));
  await store.addHighlight({ text: '一句话', url: 'https://example.com' });
  assert.deepEqual(written, ['suishou.highlights']);
});

test('subscribers hear about changes', async () => {
  const { store } = makeStore();
  let calls = 0;
  const stop = store.subscribe(() => calls++);
  await store.addTask({ title: 'a' });
  await store.updateSettings({ dailyReviewLimit: 8 });
  stop();
  await store.addTask({ title: 'b' });
  assert.equal(calls, 2);
  assert.equal((await store.load()).settings.dailyReviewLimit, 8);
});

test('backup round trip is idempotent and merges by id', async () => {
  const { store } = makeStore();
  await store.addTask({ title: '原有任务' });
  await store.addHighlight({ text: '原有收藏', url: 'https://example.com' });
  const backup = JSON.parse(JSON.stringify(await store.exportAll()));
  assert.equal(backup.app, 'suishou');

  const { store: other } = makeStore();
  await other.addTask({ title: '另一台电脑上的任务' });
  assert.deepEqual(await other.importAll(backup), { tasks: 1, highlights: 1 });
  await other.importAll(backup);
  const state = await other.load();
  assert.deepEqual(state.tasks.map((t) => t.title).sort(), ['另一台电脑上的任务', '原有任务'].sort());
  assert.equal(state.highlights.length, 1);
});

test('a file that is not a backup is refused', async () => {
  const { store } = makeStore();
  await assert.rejects(store.importAll({ tasks: [] }), /不是随手的备份/);
  await assert.rejects(store.importAll({ app: 'suishou', schema: 99, tasks: [], highlights: [] }), /更新的版本/);
  const result = await store.importAll({
    app: 'suishou', schema: 1, highlights: [], tasks: [{ id: 'x', title: 'bad id' }, { id: 't_ok', title: 'ok' }, null],
  });
  assert.equal(result.tasks, 1);
});

test('localStorage backend stores JSON under the same keys', async () => {
  const map = new Map();
  const fake = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  const store = new Store(localStorageBackend(fake), () => new Date(2026, 4, 13));
  await store.addTask({ title: '本地' });
  assert.equal(JSON.parse(map.get('suishou.tasks'))[0].title, '本地');
  assert.equal((await store.load()).tasks.length, 1);
});
