import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalUrl, createHighlight, detectSource, findDuplicate, normalizeTags, normalizeText,
  searchHighlights, tagCounts,
} from '../src/core/highlights.js';
import { backlogCount, dueForReview, gradeReview, INTERVALS } from '../src/core/review.js';
import { buildDigest, digestToMarkdown, periodRange, UNTAGGED } from '../src/core/digest.js';
import { topKeywords } from '../src/core/keywords.js';
import { findAnchor } from '../src/core/anchor.js';
import { createTask, completeTask } from '../src/core/tasks.js';
import { dayKey } from '../src/core/dates.js';

const NOW = new Date(2026, 4, 13, 10, 0); // Wednesday
const on = (day, hour = 9) => new Date(2026, 4, day, hour, 0);
const save = (text, extra = {}, when = NOW) =>
  createHighlight({ text, url: 'https://example.com/a', pageTitle: '一篇文章', ...extra }, when);

test('source detection separates AI chats from web pages', () => {
  assert.deepEqual(detectSource('https://chatgpt.com/c/abc'), { kind: 'ai', site: 'chatgpt.com', label: 'ChatGPT' });
  assert.equal(detectSource('https://claude.ai/chat/1').label, 'Claude');
  assert.equal(detectSource('https://www.doubao.com/chat/').label, '豆包');
  assert.equal(detectSource('https://chat.deepseek.com/a').kind, 'ai');
  assert.deepEqual(detectSource('https://www.zhihu.com/question/1'), { kind: 'web', site: 'zhihu.com', label: 'zhihu.com' });
  // A look-alike host is not an AI chat.
  assert.equal(detectSource('https://notclaude.ai.example.com/').kind, 'web');
  assert.equal(detectSource('not a url').label, '未知来源');
});

test('text and tags are normalised', () => {
  assert.equal(normalizeText('  第一句。 \n\n\n  第二句　很长\t很长  '), '第一句。\n第二句 很长 很长');
  assert.deepEqual(normalizeTags([' 排程 ', '#排程', 'AI', 'ai', '']), ['排程', 'AI']);
  assert.equal(canonicalUrl('https://a.com/p?id=3&utm_source=x&spm=1#part'), 'https://a.com/p?id=3');
});

test('creating a highlight', () => {
  const item = save('  调度的难点不在求解，\n而在把业务规则翻译成约束。 ', { tags: ['排程'], note: ' 同意 ', prefix: 'x'.repeat(100) });
  assert.equal(item.text, '调度的难点不在求解，\n而在把业务规则翻译成约束。');
  assert.equal(item.note, '同意');
  assert.equal(item.prefix.length, 40);
  assert.equal(item.source.kind, 'web');
  assert.equal(item.review.box, 0);
  assert.throws(() => save('   '));
  assert.throws(() => save('长'.repeat(4001)));
});

test('the same passage on the same page is a duplicate', () => {
  const list = [save('一句话')];
  assert.ok(findDuplicate(list, { text: ' 一句话 ', url: 'https://example.com/a#x' }));
  assert.equal(findDuplicate(list, { text: '一句话', url: 'https://example.com/b' }), null);
});

test('search matches every word across text, note, title and tags', () => {
  const list = [
    save('约束规划适合排程', { tags: ['排程'] }, on(11)),
    save('安全库存的计算', { note: '和服务水平有关', url: 'https://chatgpt.com/c/1' }, on(12)),
    save('啤酒游戏说明牛鞭效应', {}, on(13)),
  ];
  assert.deepEqual(searchHighlights(list, { query: '排程' }).map((h) => h.text), ['约束规划适合排程']);
  assert.deepEqual(searchHighlights(list, { query: '库存 服务水平' }).length, 1);
  assert.deepEqual(searchHighlights(list, { query: '库存 排程' }), []);
  assert.deepEqual(searchHighlights(list, { kind: 'ai' }).map((h) => h.source.label), ['ChatGPT']);
  assert.deepEqual(searchHighlights(list, { tag: '排程' }).length, 1);
  assert.equal(searchHighlights(list)[0].text, '啤酒游戏说明牛鞭效应');
  assert.deepEqual(tagCounts(list), [{ name: '排程', count: 1 }]);
});

test('review: a new highlight comes back the next day', () => {
  const item = save('一句话', {}, on(13));
  assert.deepEqual(dueForReview([item], on(13, 23)), []);
  assert.deepEqual(dueForReview([item], on(14, 0)).length, 1);
});

test('review: keeping moves up a box, again resets, retire removes', () => {
  let item = save('一句话', {}, on(1));
  item = gradeReview(item, 'keep', on(2));
  assert.equal(item.review.box, 1);
  assert.equal(dayKey(new Date(item.review.dueAt)), '2026-05-05');
  assert.deepEqual(dueForReview([item], on(4)), []);
  assert.equal(dueForReview([item], on(5)).length, 1);

  item = gradeReview(item, 'keep', on(5));
  assert.equal(item.review.box, 2);
  assert.equal(dayKey(new Date(item.review.dueAt)), '2026-05-12');

  const again = gradeReview(item, 'again', on(12));
  assert.equal(again.review.box, 0);
  assert.equal(dayKey(new Date(again.review.dueAt)), '2026-05-13');

  const retired = gradeReview(item, 'retire', on(12));
  assert.equal(retired.review.retired, true);
  assert.deepEqual(dueForReview([retired], new Date(2027, 0, 1)), []);
  assert.equal(retired.review.count, 3);
});

test('review: the top box repeats at the longest interval', () => {
  let item = save('一句话', {}, on(1));
  for (let i = 0; i < 10; i++) item = gradeReview(item, 'keep', on(2));
  assert.equal(item.review.box, INTERVALS.length - 1);
});

test('review: daily cap takes the longest-waiting first', () => {
  const list = [1, 2, 3, 4, 5, 6, 7].map((day) => save(`第 ${day} 条`, {}, on(day)));
  const today = dueForReview(list, on(13), 3);
  assert.deepEqual(today.map((h) => h.text), ['第 1 条', '第 2 条', '第 3 条']);
  assert.equal(backlogCount(list, on(13)), 7);
});

test('periods: week is Monday to Sunday, month is the calendar month', () => {
  const week = periodRange('week', NOW);
  assert.equal(dayKey(week.start), '2026-05-11');
  assert.equal(dayKey(week.end), '2026-05-18');
  assert.equal(week.label, '5月11日 – 5月17日');
  assert.equal(dayKey(periodRange('week', NOW, -1).start), '2026-05-04');
  const month = periodRange('month', NOW);
  assert.equal(dayKey(month.start), '2026-05-01');
  assert.equal(dayKey(month.end), '2026-06-01');
  assert.equal(periodRange('month', new Date(2026, 0, 15), -1).label, '2025 年 12 月');
});

test('keywords are counted once per passage and need two passages', () => {
  const words = topKeywords([
    '调度算法的难点是把业务规则翻译成约束',
    '约束规划可以表达复杂的业务规则',
    '调度 调度 调度 调度',
    'MRP 运算从订单算出采购建议',
  ]);
  const map = Object.fromEntries(words.map((k) => [k.word, k.count]));
  assert.equal(map['调度'], 2);
  assert.equal(map['约束'], 2);
  assert.equal(map['mrp'], undefined);
  assert.equal(map['的'], undefined);
});

test('digest groups the week by tag and counts sources, days and tasks', () => {
  const highlights = [
    save('约束规划适合排程问题', { tags: ['排程'] }, on(11)),
    save('排程要先建模再求解', { tags: ['排程', '方法'], url: 'https://claude.ai/chat/1' }, on(12)),
    save('牛鞭效应来自信息延迟', {}, on(12)),
    save('上周的一条', { tags: ['排程'] }, on(6)),
  ];
  const report = createTask({ title: '交周报', project: '工作' }, on(11));
  const tasks = [
    completeTask(report, on(13)).done,
    createTask({ title: '没做完的' }, on(12)),
    completeTask(createTask({ title: '上周做的' }, on(5)), on(6)).done,
  ];
  const digest = buildDigest(highlights, tasks, periodRange('week', NOW));

  assert.equal(digest.savedCount, 3);
  assert.equal(digest.activeDays, 2);
  assert.equal(digest.aiCount, 1);
  assert.equal(digest.webCount, 2);
  assert.deepEqual(digest.topics.map((t) => [t.name, t.items.length]), [['排程', 2], ['方法', 1], [UNTAGGED, 1]]);
  assert.deepEqual(digest.sources[0], { name: 'example.com', count: 2 });
  assert.equal(digest.days.length, 7);
  assert.deepEqual(digest.days[1], { day: '2026-05-12', saved: 2, done: 0 });
  assert.equal(digest.tasks.completedCount, 1);
  assert.equal(digest.tasks.createdCount, 2);
  assert.deepEqual(digest.tasks.byProject, [{ name: '工作', count: 1 }]);
  assert.ok(digest.keywords.some((k) => k.word === '排程'));
});

test('digest as Markdown', () => {
  const highlights = [save('第一行\n第二行', { tags: ['排程'], note: '值得再看' }, on(11))];
  const tasks = [completeTask(createTask({ title: '交周报', project: '工作' }, on(11)), on(12)).done];
  const markdown = digestToMarkdown(buildDigest(highlights, tasks, periodRange('week', NOW)));
  assert.ok(markdown.startsWith('# 周回顾：5月11日 – 5月17日\n'));
  assert.ok(markdown.includes('## 排程（1）'));
  assert.ok(markdown.includes('> 第一行\n> 第二行'));
  assert.ok(markdown.includes('我的想法：值得再看'));
  assert.ok(markdown.includes('— [一篇文章](https://example.com/a)'));
  assert.ok(markdown.includes('- 交周报（工作）'));

  const empty = digestToMarkdown(buildDigest([], [], periodRange('month', NOW)));
  assert.ok(empty.includes('# 月回顾：2026 年 5 月'));
  assert.ok(empty.includes('这段时间没有收藏'));
});

test('anchor finds a passage despite whitespace changes', () => {
  const page = '标题\n\n  调度的难点不在求解，\n  而在把业务规则   翻译成约束。\n结尾';
  const found = findAnchor(page, { text: '调度的难点不在求解，而在把业务规则翻译成约束。' });
  assert.equal(page.slice(found.start, found.end).replace(/\s/g, ''), '调度的难点不在求解，而在把业务规则翻译成约束。');
  assert.equal(findAnchor(page, { text: '页面上没有的话' }), null);
  assert.equal(findAnchor(page, { text: '   ' }), null);
});

test('anchor uses the surrounding text to pick among repeats', () => {
  const page = '甲说：这很重要。乙说：这很重要。丙说：这很重要。';
  const second = findAnchor(page, { text: '这很重要。', prefix: '乙说：', suffix: '丙说：' });
  assert.equal(second.start, page.indexOf('乙说：') + 3);
  const first = findAnchor(page, { text: '这很重要。' });
  assert.equal(first.start, 3);
});
