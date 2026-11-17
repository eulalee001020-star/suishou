// Toolbar popup: add a task in one line, see what needs attention today,
// and get to the saved passages.

import { periodRange } from '../core/digest.js';
import { backlogCount, dueForReview } from '../core/review.js';
import { Store } from '../core/store.js';
import { viewToday, viewUpcoming } from '../core/tasks.js';
import { clear, h, highlightCard, openApp, quickAdd, taskRow } from './common.js';

const store = new Store();
const tasksPanel = document.getElementById('panel-tasks');
const savedPanel = document.getElementById('panel-saved');
let quick = null;

async function currentTab() {
  if (!globalThis.chrome?.tabs?.query) return null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith('http') ? tab : null;
}

async function render() {
  const { tasks, highlights, settings } = await store.load();
  const now = new Date();
  const actions = {
    now,
    onToggle: (task) => store.toggleTask(task.id),
    onDelete: (task) => store.deleteTask(task.id),
  };

  // ── tasks ──
  const { overdue, today } = viewToday(tasks, now);
  const upcoming = viewUpcoming(tasks, now).reduce((sum, group) => sum + group.tasks.length, 0);
  document.getElementById('count-tasks').textContent = overdue.length + today.length || '';

  if (!quick) {
    quick = quickAdd({ onAdd: (draft) => store.addTask(draft) });
    const tab = await currentTab();
    tasksPanel.append(
      quick,
      h(
        'div',
        { class: 'sub' },
        tab
          ? h('button', {
              class: 'link',
              onclick: () => store.addTask({ title: tab.title || tab.url, sourceUrl: tab.url, sourceTitle: tab.title }),
            }, '＋ 把当前页面记为待办')
          : h('span', {}),
        h('span', { class: 'faint' }, '回车添加'),
      ),
      h('div', { id: 'task-lists' }),
    );
    quick.focusInput();
  }
  const lists = clear(document.getElementById('task-lists'));
  if (overdue.length) {
    lists.append(
      h('div', { class: 'section-title overdue' }, `已过期 ${overdue.length}`),
      overdue.map((task) => taskRow(task, actions)),
    );
  }
  lists.append(h('div', { class: 'section-title' }, `今天 ${today.length || ''}`));
  lists.append(
    today.length
      ? today.map((task) => taskRow(task, actions))
      : h('div', { class: 'empty' }, overdue.length ? '今天没有别的安排' : '今天没有待办，记一条试试'),
  );
  lists.append(
    h(
      'div',
      { class: 'sub' },
      h('button', { class: 'link', onclick: () => openApp('#upcoming') }, `接下来 7 天还有 ${upcoming} 项`),
      h('button', { class: 'link', onclick: () => openApp('#inbox') }, '全部待办'),
    ),
  );

  // ── saved ──
  const week = periodRange('week', now);
  const thisWeek = highlights.filter((item) => new Date(item.createdAt) >= week.start).length;
  const waiting = backlogCount(highlights, now);
  const todayReview = dueForReview(highlights, now, settings.dailyReviewLimit).length;
  document.getElementById('count-review').textContent = todayReview || '';
  const recent = [...highlights].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 4);

  clear(savedPanel).append(
    h(
      'div',
      { class: 'stat' },
      h('div', {}, h('div', { class: 'muted' }, '今日重温'), h('b', {}, todayReview), waiting > todayReview && h('span', { class: 'faint' }, ` / 共 ${waiting} 条在等`)),
      h('button', { class: 'btn primary', disabled: !todayReview, onclick: () => openApp('#review') }, '开始'),
    ),
    h(
      'div',
      { class: 'stat' },
      h('div', {}, h('div', { class: 'muted' }, '本周收藏'), h('b', {}, thisWeek), h('span', { class: 'faint' }, ` / 共 ${highlights.length} 条`)),
      h('button', { class: 'btn', onclick: () => openApp('#week') }, '周回顾'),
    ),
    h('div', { class: 'section-title' }, '最近收藏', h('button', { class: 'link', onclick: () => openApp('#library') }, '全部')),
    recent.length ? recent.map((item) => highlightCard(item)) : h('div', { class: 'empty' }, '还没有收藏'),
    h('div', { class: 'tip' }, '在任意网页或 AI 对话里选中一段文字，点旁边的「收藏」，或按 ', h('kbd', {}, 'Alt'), ' + ', h('kbd', {}, 'S'), '。'),
  );
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('on', other === tab);
    tasksPanel.hidden = tab.dataset.tab !== 'tasks';
    savedPanel.hidden = tab.dataset.tab !== 'saved';
    if (tab.dataset.tab === 'tasks') quick?.focusInput();
  });
}
document.getElementById('open-app').addEventListener('click', () => openApp('#today'));

store.subscribe(render);
render();
