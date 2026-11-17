// Weekly and monthly review: what was saved and what got done in a period,
// arranged so it can be read back in a few minutes.

import { addDays, dayKey, startOfDay, startOfWeek } from './dates.js';
import { topKeywords } from './keywords.js';

export const UNTAGGED = '未分类';

/**
 * The week (Monday to Sunday) or calendar month containing `anchor`,
 * shifted by `offset` periods (-1 is the previous one).
 */
export function periodRange(kind, anchor = new Date(), offset = 0) {
  if (kind === 'week') {
    const start = addDays(startOfWeek(anchor), offset * 7);
    const end = addDays(start, 7);
    return { kind, start, end, label: `${fmt(start)} – ${fmt(addDays(end, -1))}` };
  }
  if (kind === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { kind, start, end, label: `${start.getFullYear()} 年 ${start.getMonth() + 1} 月` };
  }
  throw new Error(`unknown period: ${kind}`);
}

function fmt(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function within(iso, range) {
  if (!iso) return false;
  const moment = new Date(iso);
  return moment >= range.start && moment < range.end;
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    for (const key of [].concat(keyOf(item))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh'))
    .map(([name, count]) => ({ name, count }));
}

export function buildDigest(highlights, tasks, range) {
  const saved = highlights
    .filter((item) => within(item.createdAt, range))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const completed = tasks
    .filter((task) => within(task.completedAt, range))
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));
  const created = tasks.filter((task) => within(task.createdAt, range));

  // One group per tag; a passage with several tags appears under each, and
  // one with none goes to the untagged group, which is listed last.
  const groups = new Map();
  for (const item of saved) {
    for (const tag of item.tags.length ? item.tags : [UNTAGGED]) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(item);
    }
  }
  const topics = [...groups.entries()]
    .sort(([a, listA], [b, listB]) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return listB.length - listA.length || a.localeCompare(b, 'zh');
    })
    .map(([name, items]) => ({ name, items }));

  const days = [];
  for (let day = startOfDay(range.start); day < range.end; day = addDays(day, 1)) {
    const key = dayKey(day);
    days.push({
      day: key,
      saved: saved.filter((item) => dayKey(new Date(item.createdAt)) === key).length,
      done: completed.filter((task) => dayKey(new Date(task.completedAt)) === key).length,
    });
  }

  return {
    range,
    savedCount: saved.length,
    activeDays: days.filter((day) => day.saved > 0).length,
    aiCount: saved.filter((item) => item.source.kind === 'ai').length,
    webCount: saved.filter((item) => item.source.kind === 'web').length,
    sources: countBy(saved, (item) => item.source.label),
    tags: countBy(saved.filter((item) => item.tags.length), (item) => item.tags),
    keywords: topKeywords(saved.map((item) => `${item.text}\n${item.note}`)),
    topics,
    days,
    tasks: {
      createdCount: created.length,
      completedCount: completed.length,
      completed: completed.map((task) => ({ title: task.title, project: task.project, completedAt: task.completedAt })),
      byProject: countBy(completed, (task) => task.project ?? '无项目'),
    },
  };
}

function quote(text) {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

/** The digest as Markdown, ready to paste into a notes app. */
export function digestToMarkdown(digest) {
  const title = digest.range.kind === 'week' ? '周回顾' : '月回顾';
  const lines = [`# ${title}：${digest.range.label}`, ''];
  lines.push(
    `收藏 ${digest.savedCount} 条（AI 对话 ${digest.aiCount}，网页 ${digest.webCount}），` +
      `有收藏的天数 ${digest.activeDays}；完成待办 ${digest.tasks.completedCount} 项。`,
    '',
  );
  if (digest.keywords.length) {
    lines.push(`**高频词**：${digest.keywords.map((k) => `${k.word}（${k.count}）`).join('、')}`, '');
  }
  if (digest.sources.length) {
    lines.push(`**来源**：${digest.sources.map((s) => `${s.name} ${s.count}`).join('、')}`, '');
  }
  for (const topic of digest.topics) {
    lines.push(`## ${topic.name}（${topic.items.length}）`, '');
    for (const item of topic.items) {
      lines.push(quote(item.text), '');
      if (item.note) lines.push(`我的想法：${item.note}`, '');
      const where = item.pageTitle || item.source.label;
      lines.push(item.url ? `— [${where}](${item.url})` : `— ${where}`, '');
    }
  }
  if (digest.tasks.completed.length) {
    lines.push('## 完成的待办', '');
    for (const task of digest.tasks.completed) {
      lines.push(`- ${task.title}${task.project ? `（${task.project}）` : ''}`);
    }
    lines.push('');
  }
  if (!digest.savedCount && !digest.tasks.completedCount) {
    lines.push('这段时间没有收藏，也没有完成的待办。', '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
