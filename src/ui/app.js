// The full page: every list of tasks, the library of saved passages, the
// daily review and the weekly and monthly digests.

import { dayKey, fromLocalIso, toLocalIso } from '../core/dates.js';
import { buildDigest, digestToMarkdown, periodRange } from '../core/digest.js';
import { searchHighlights, tagCounts } from '../core/highlights.js';
import { describeRecurrence, parseRecurrence } from '../core/recurrence.js';
import { backlogCount, dueForReview, INTERVALS } from '../core/review.js';
import { DEFAULT_SETTINGS, Store } from '../core/store.js';
import {
  attentionCount, projectCounts, viewDone, viewInbox, viewProject, viewToday, viewUpcoming,
} from '../core/tasks.js';
import { clear, put, downloadText, h, highlightCard, quickAdd, taskRow } from './common.js';

const store = new Store();
const nav = document.getElementById('nav');
const view = document.getElementById('view');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// View state that should survive a re-render caused by a storage change.
const ui = {
  editingTask: null,
  editingHighlight: null,
  library: { query: '', kind: null, tag: null },
  periodOffset: { week: 0, month: 0 },
  reviewQueue: null,
  reviewDone: 0,
  notice: '',
};

function route() {
  const hash = decodeURIComponent(location.hash.slice(1)) || 'today';
  const [name, ...rest] = hash.split('/');
  return { name, arg: rest.join('/') };
}

// ── navigation ──────────────────────────────────────────────────────

function renderNav(state, now) {
  const current = route();
  const { overdue, today } = viewToday(state.tasks, now);
  const upcoming = viewUpcoming(state.tasks, now, 365).reduce((sum, g) => sum + g.tasks.length, 0);
  const reviewToday = dueForReview(state.highlights, now, state.settings.dailyReviewLimit).length;
  const item = (hash, label, count, alert = false) =>
    h(
      'a',
      { href: `#${hash}`, class: `${current.name}${current.arg ? `/${current.arg}` : ''}` === hash ? 'on' : '' },
      label,
      count ? h('span', { class: `n${alert ? ' alert' : ''}` }, count) : null,
    );
  put(clear(nav), 
    h('div', { class: 'brand' }, '随手', h('small', {}, '待办 · 收藏回顾')),
    h('div', { class: 'group' }, '待办'),
    item('today', '今天', overdue.length + today.length, overdue.length > 0),
    item('upcoming', '接下来', upcoming),
    item('inbox', '收件箱', viewInbox(state.tasks).length),
    projectCounts(state.tasks).map((p) => item(`project/${p.name}`, `# ${p.name}`, p.count)),
    item('done', '已完成'),
    h('div', { class: 'group' }, '收藏'),
    item('library', '收藏库', state.highlights.length),
    item('review', '每日重温', reviewToday),
    item('week', '周回顾'),
    item('month', '月回顾'),
    h('div', { class: 'group' }, ''),
    item('settings', '设置'),
  );
  document.title = attentionCount(state.tasks, now) ? `(${attentionCount(state.tasks, now)}) 随手` : '随手';
}

// ── tasks ───────────────────────────────────────────────────────────

function taskEditor(task) {
  const due = task.due ? fromLocalIso(task.due) : null;
  const title = h('input', { type: 'text', value: task.title });
  const date = h('input', { type: 'date', value: due ? dayKey(due) : '' });
  const time = h('input', { type: 'time', value: due && task.hasTime ? toLocalIso(due).slice(11) : '' });
  const priority = h(
    'select',
    {},
    [1, 2, 3, 4].map((p) => h('option', { value: p, selected: p === task.priority }, p === 4 ? 'P4（普通）' : `P${p}`)),
  );
  const project = h('input', { type: 'text', value: task.project ?? '', placeholder: '不填则没有项目' });
  const repeat = h('input', { type: 'text', value: describeRecurrence(task.recurrence), placeholder: '如：每周五、每天、每月5号' });
  const notes = h('textarea', { placeholder: '备注' }, task.notes ?? '');
  const save = async () => {
    const rule = repeat.value.trim() ? parseRecurrence(repeat.value).rule : null;
    if (repeat.value.trim() && !rule) {
      repeat.focus();
      repeat.select();
      return;
    }
    const hasDate = Boolean(date.value);
    ui.editingTask = null;
    await store.updateTask(task.id, {
      title: title.value.trim() || task.title,
      due: hasDate ? `${date.value}T${time.value || '00:00'}` : null,
      hasTime: hasDate && Boolean(time.value),
      priority: Number(priority.value),
      project: project.value.trim().replace(/^#/, '') || null,
      recurrence: hasDate ? rule : null,
      notes: notes.value.trim(),
      remindedFor: null,
    });
  };
  const form = h(
    'div',
    { class: 'form', onkeydown: (e) => e.key === 'Escape' && cancelEdit() },
    h('label', { class: 'wide' }, '标题', title),
    h('label', {}, '日期', date),
    h('label', {}, '时间（可不填）', time),
    h('label', {}, '优先级', priority),
    h('label', {}, '项目', project),
    h('label', { class: 'wide' }, '重复（需要有日期）', repeat),
    h('label', { class: 'wide' }, '备注', notes),
    h(
      'div',
      { class: 'buttons' },
      h('button', { class: 'btn', onclick: cancelEdit }, '取消'),
      h('button', { class: 'btn primary', onclick: save }, '保存'),
    ),
  );
  queueMicrotask(() => title.focus());
  return form;
}

function cancelEdit() {
  ui.editingTask = null;
  ui.editingHighlight = null;
  render();
}

function taskList(tasks, now) {
  return tasks.map((task) =>
    ui.editingTask === task.id
      ? taskEditor(task)
      : taskRow(task, {
          now,
          onToggle: (t) => store.toggleTask(t.id),
          onEdit: (t) => {
            ui.editingTask = t.id;
            render();
          },
          onDelete: (t) => store.deleteTask(t.id),
        }),
  );
}

function renderToday(state, now) {
  const { overdue, today } = viewToday(state.tasks, now);
  const date = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
  put(view, 
    h('h1', {}, '今天'),
    h('p', { class: 'lede' }, date),
    quickAdd({ onAdd: (draft) => store.addTask(draft.due ? draft : { ...draft, due: `${dayKey(now)}T00:00` }), placeholder: '写下要做的事，回车。可以带时间、p1、#项目、每周五' }),
    overdue.length ? [h('div', { class: 'section-title overdue' }, `已过期 ${overdue.length}`), taskList(overdue, now)] : null,
    h('div', { class: 'section-title' }, `今天 ${today.length || ''}`),
    today.length ? taskList(today, now) : h('div', { class: 'empty' }, '今天的都做完了，或者还没记。'),
  );
}

function renderUpcoming(state, now) {
  const groups = viewUpcoming(state.tasks, now, 365);
  put(view, h('h1', {}, '接下来'), h('p', { class: 'lede' }, '明天起有日期的待办'), quickAdd({ onAdd: (d) => store.addTask(d) }));
  if (!groups.length) put(view, h('div', { class: 'empty' }, '之后几天还没有安排。'));
  for (const group of groups) {
    const day = fromLocalIso(group.day);
    const diff = Math.round((day - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const label = `${diff === 1 ? '明天 · ' : diff === 2 ? '后天 · ' : ''}${day.getMonth() + 1}月${day.getDate()}日 ${WEEKDAYS[day.getDay()]}`;
    put(view, h('div', { class: 'section-title' }, label), taskList(group.tasks, now));
  }
}

function renderInbox(state, now) {
  const tasks = viewInbox(state.tasks);
  put(view, 
    h('h1', {}, '收件箱'),
    h('p', { class: 'lede' }, '没有日期也没有项目的待办。想到就先记在这里。'),
    quickAdd({ onAdd: (d) => store.addTask(d), placeholder: '先记下来，以后再排时间' }),
    tasks.length ? taskList(tasks, now) : h('div', { class: 'empty' }, '收件箱是空的。'),
  );
}

function renderProject(state, now, name) {
  const tasks = viewProject(state.tasks, name);
  put(view, 
    h('h1', {}, `# ${name}`),
    h('p', { class: 'lede' }, `${tasks.length} 项未完成`),
    quickAdd({ onAdd: (d) => store.addTask(d), extra: { project: name }, placeholder: `添加到 ${name}` }),
    tasks.length ? taskList(tasks, now) : h('div', { class: 'empty' }, '这个项目没有未完成的待办。'),
  );
}

function renderDone(state, now) {
  const tasks = viewDone(state.tasks, 100);
  put(view, 
    h('h1', {}, '已完成'),
    h('p', { class: 'lede' }, '最近完成的 100 项。点圆圈可以恢复。'),
    tasks.length ? taskList(tasks, now) : h('div', { class: 'empty' }, '还没有完成的待办。'),
  );
}

// ── library ─────────────────────────────────────────────────────────

function highlightEditor(item) {
  const tags = h('input', { type: 'text', value: item.tags.join(' '), placeholder: '标签，用空格分开' });
  const note = h('textarea', { placeholder: '我的想法' }, item.note);
  const save = async () => {
    ui.editingHighlight = null;
    await store.updateHighlight(item.id, { tags: tags.value.split(/[\s,，、]+/).filter(Boolean), note: note.value });
  };
  queueMicrotask(() => tags.focus());
  return h(
    'div',
    { class: 'hl' },
    h('blockquote', {}, item.text),
    h(
      'div',
      { class: 'form', onkeydown: (e) => e.key === 'Escape' && cancelEdit() },
      h('label', { class: 'wide' }, '标签', tags),
      h('label', { class: 'wide' }, '我的想法', note),
      h('div', { class: 'buttons' }, h('button', { class: 'btn', onclick: cancelEdit }, '取消'), h('button', { class: 'btn primary', onclick: save }, '保存')),
    ),
  );
}

function highlightList(items) {
  return items.map((item) =>
    ui.editingHighlight === item.id
      ? highlightEditor(item)
      : highlightCard(item, {
          onEdit: (x) => {
            ui.editingHighlight = x.id;
            render();
          },
          onDelete: (x) => store.deleteHighlight(x.id),
          onTask: async (x) => {
            const title = x.text.replace(/\s+/g, ' ').slice(0, 80);
            await store.addTask({ title: `跟进：${title}`, sourceUrl: x.url, sourceTitle: x.pageTitle, highlightId: x.id });
            ui.notice = '已转为待办，在收件箱里。';
            render();
          },
        }),
  );
}

function renderLibrary(state) {
  const filter = ui.library;
  const results = searchHighlights(state.highlights, filter);
  const tags = tagCounts(state.highlights);
  const search = h('input', {
    type: 'search',
    value: filter.query,
    placeholder: '搜索收藏的内容、想法、标题、标签',
    'aria-label': '搜索收藏',
    oninput: () => {
      filter.query = search.value;
      const list = document.getElementById('library-list');
      const found = searchHighlights(state.highlights, filter);
      put(clear(list), found.length ? highlightList(found) : h('div', { class: 'empty' }, '没有找到。'));
      document.getElementById('library-count').textContent = `${found.length} 条`;
    },
  });
  const kindChip = (label, kind) =>
    h('button', { class: `chip${filter.kind === kind ? ' active' : ''}`, onclick: () => { filter.kind = kind; render(); } }, label);
  put(view, 
    h('h1', {}, '收藏库'),
    h('p', { class: 'lede' }, '在网页和 AI 对话里随手收下来的话。'),
    h('div', { class: 'toolbar' }, search, h('span', { class: 'muted', id: 'library-count' }, `${results.length} 条`)),
    h('div', { class: 'chips' }, kindChip('全部', null), kindChip('AI 对话', 'ai'), kindChip('网页', 'web')),
    tags.length
      ? h(
          'div',
          { class: 'chips' },
          tags.slice(0, 24).map((tag) =>
            h('button', {
              class: `chip${filter.tag === tag.name ? ' active' : ''}`,
              onclick: () => { filter.tag = filter.tag === tag.name ? null : tag.name; render(); },
            }, `#${tag.name} ${tag.count}`),
          ),
        )
      : null,
    h(
      'div',
      { id: 'library-list' },
      results.length
        ? highlightList(results)
        : h('div', { class: 'empty' }, state.highlights.length ? '没有找到。' : '还没有收藏。在任意网页选中一段文字，点旁边的「收藏」。'),
    ),
  );
}

// ── daily review ────────────────────────────────────────────────────

function renderReview(state, now) {
  if (ui.reviewQueue === null) {
    ui.reviewQueue = dueForReview(state.highlights, now, state.settings.dailyReviewLimit).map((item) => item.id);
    ui.reviewDone = 0;
  }
  const byId = new Map(state.highlights.map((item) => [item.id, item]));
  ui.reviewQueue = ui.reviewQueue.filter((id) => byId.has(id));
  const total = ui.reviewQueue.length + ui.reviewDone;
  const current = byId.get(ui.reviewQueue[0]);
  const waiting = backlogCount(state.highlights, now);

  put(view, h('h1', {}, '每日重温'), h('p', { class: 'lede' }, '每天把几条旧收藏拿出来再看一眼。看过的会隔得越来越久才回来。'));
  if (!current) {
    put(view, 
      h(
        'div',
        { class: 'empty' },
        total ? `今天的 ${total} 条看完了。` : '今天没有需要重温的。新收藏的内容第二天会出现在这里。',
        waiting > 0 ? h('div', {}, h('button', { class: 'link', onclick: () => { ui.reviewQueue = null; render(); } }, `还有 ${waiting} 条在等，再看一组`)) : null,
      ),
    );
    return;
  }
  const grade = async (value) => {
    ui.reviewQueue.shift();
    ui.reviewDone += 1;
    await store.gradeHighlight(current.id, value);
  };
  const nextBox = Math.min((current.review?.box ?? 0) + 1, INTERVALS.length - 1);
  put(view, 
    h('div', { class: 'progress' }, h('i', { style: `width:${(ui.reviewDone / total) * 100}%` })),
    h('p', { class: 'muted' }, `第 ${ui.reviewDone + 1} / ${total} 条`),
    h(
      'div',
      { class: 'review-card' },
      h('blockquote', {}, current.text),
      current.note && h('div', { class: 'note' }, `我的想法：${current.note}`),
      h(
        'div',
        { class: 'where' },
        h('span', { class: `chip ${current.source.kind === 'ai' ? 'ai' : ''}` }, current.source.label),
        current.tags.map((tag) => h('span', { class: 'chip' }, `#${tag}`)),
        current.url && h('a', { href: current.url, target: '_blank', rel: 'noopener' }, current.pageTitle || '原文'),
        h('span', {}, `收藏于 ${new Date(current.createdAt).getMonth() + 1}月${new Date(current.createdAt).getDate()}日`),
      ),
    ),
    h(
      'div',
      { class: 'review-actions' },
      h('button', { class: 'btn primary', onclick: () => grade('keep') }, '还有用，以后再看', h('small', {}, `${INTERVALS[nextBox]} 天后`)),
      h('button', { class: 'btn', onclick: () => grade('again') }, '没印象了', h('small', {}, '明天再看')),
      h('button', { class: 'btn', onclick: () => grade('retire') }, '已经吸收', h('small', {}, '不再出现')),
    ),
  );
}

// ── weekly and monthly digest ───────────────────────────────────────

function renderDigest(state, now, kind) {
  const offset = ui.periodOffset[kind];
  const digest = buildDigest(state.highlights, state.tasks, periodRange(kind, now, offset));
  const markdown = () => digestToMarkdown(digest);
  const shift = (delta) => () => { ui.periodOffset[kind] += delta; render(); };
  const peak = Math.max(1, ...digest.days.map((d) => d.saved));
  const dayLabel = (key) => {
    const day = fromLocalIso(key);
    return kind === 'week' ? WEEKDAYS[day.getDay()] : day.getDate() % 5 === 1 ? String(day.getDate()) : '';
  };

  put(view, 
    h(
      'div',
      { class: 'period' },
      h('h1', {}, kind === 'week' ? '周回顾' : '月回顾'),
      h('button', { class: 'btn', onclick: shift(-1), 'aria-label': '上一期' }, '‹'),
      h('span', { class: 'muted' }, digest.range.label),
      h('button', { class: 'btn', onclick: shift(1), disabled: offset >= 0, 'aria-label': '下一期' }, '›'),
      offset !== 0 && h('button', { class: 'link', onclick: () => { ui.periodOffset[kind] = 0; render(); } }, kind === 'week' ? '回到本周' : '回到本月'),
    ),
    h(
      'div',
      { class: 'tiles' },
      h('div', { class: 'tile' }, h('b', {}, digest.savedCount), h('span', {}, '条收藏')),
      h('div', { class: 'tile' }, h('b', {}, digest.aiCount), h('span', {}, '来自 AI 对话')),
      h('div', { class: 'tile' }, h('b', {}, `${digest.activeDays} / ${digest.days.length}`), h('span', {}, '天有收藏')),
      h('div', { class: 'tile' }, h('b', {}, digest.tasks.completedCount), h('span', {}, '项待办完成')),
    ),
    h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': '每天收藏的条数' },
      digest.days.map((d) =>
        h(
          'div',
          { class: 'bar', title: `${d.day}：收藏 ${d.saved}，完成 ${d.done}` },
          h('div', { class: `fill${d.saved ? '' : ' zero'}`, style: `height:${(d.saved / peak) * 100}%` }),
          h('div', { class: 'label' }, dayLabel(d.day)),
        ),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          await navigator.clipboard.writeText(markdown());
          ui.notice = '已复制为 Markdown。';
          render();
        },
      }, '复制 Markdown'),
      h('button', { class: 'btn', onclick: () => downloadText(`随手-${kind === 'week' ? '周' : '月'}回顾-${dayKey(digest.range.start)}.md`, markdown(), 'text/markdown') }, '下载 .md'),
    ),
  );

  if (!digest.savedCount && !digest.tasks.completedCount) {
    put(view, h('div', { class: 'empty' }, '这段时间没有收藏，也没有完成的待办。'));
    return;
  }
  if (digest.keywords.length) {
    put(view, h('h2', {}, '高频词'), h('div', { class: 'chips' }, digest.keywords.map((k) => h('span', { class: 'chip' }, `${k.word} ${k.count}`))));
  }
  if (digest.sources.length) {
    put(view, h('h2', {}, '来源'), h('div', { class: 'chips' }, digest.sources.map((s) => h('span', { class: 'chip' }, `${s.name} ${s.count}`))));
  }
  for (const topic of digest.topics) {
    put(view, h('h2', {}, `${topic.name === '未分类' ? '未分类' : `#${topic.name}`}（${topic.items.length}）`), highlightList(topic.items));
  }
  if (digest.tasks.completed.length) {
    put(view, 
      h('h2', {}, `完成的待办（${digest.tasks.completedCount}）`),
      h('div', { class: 'chips' }, digest.tasks.byProject.map((p) => h('span', { class: 'chip' }, `${p.name} ${p.count}`))),
      digest.tasks.completed.map((task) => h('div', { class: 'task done' }, h('span', { class: 'check' }), h('div', { class: 'body' }, h('div', { class: 'title' }, task.title)))),
    );
  }
}

// ── settings ────────────────────────────────────────────────────────

function renderSettings(state) {
  const s = state.settings;
  const toggle = (key) => h('input', { type: 'checkbox', checked: s[key], onchange: (e) => store.updateSettings({ [key]: e.target.checked }) });
  const row = (title, text, control) => h('div', { class: 'setting' }, h('div', {}, h('div', {}, title), h('p', {}, text)), control);
  const sites = h('textarea', { placeholder: '每行一个域名，如 mail.example.com' }, s.disabledSites.join('\n'));
  const file = h('input', {
    type: 'file',
    accept: 'application/json',
    hidden: true,
    onchange: async () => {
      try {
        const result = await store.importAll(JSON.parse(await file.files[0].text()));
        ui.notice = `已导入 ${result.tasks} 项待办、${result.highlights} 条收藏。`;
      } catch (error) {
        ui.notice = `导入失败：${error.message}`;
      }
      render();
    },
  });
  put(view, 
    h('h1', {}, '设置'),
    h('p', { class: 'lede' }, `数据只存在这台电脑的浏览器里：${state.tasks.length} 项待办，${state.highlights.length} 条收藏。`),
    row('到点提醒', '带时间的待办到点时弹出系统通知。', toggle('reminders')),
    row('选中文字时显示「收藏」按钮', '关掉后仍可用右键菜单或 Alt+S 收藏。', toggle('selectionButton')),
    row('再次打开页面时标出收藏过的句子', '在原文里用黄色底标出来，点一下可以改标签和想法。', toggle('rehighlight')),
    row(
      '每日重温的条数',
      '每天最多拿出几条旧收藏。',
      h('input', {
        type: 'number', min: 1, max: 30, value: s.dailyReviewLimit,
        onchange: (e) => store.updateSettings({ dailyReviewLimit: Math.min(30, Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.dailyReviewLimit)) }),
      }),
    ),
    row(
      '不在这些网站上显示',
      '这些域名上不显示按钮，也不标出收藏。',
      h('div', {}, sites, h('div', {}, h('button', {
        class: 'btn small',
        onclick: async () => {
          await store.updateSettings({ disabledSites: sites.value.split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean) });
          ui.notice = '已保存。';
          render();
        },
      }, '保存'))),
    ),
    row(
      '备份与恢复',
      '导出一个 JSON 文件；导入时按编号合并，不会重复。',
      h(
        'div',
        { class: 'toolbar' },
        h('button', {
          class: 'btn',
          onclick: async () => downloadText(`随手-备份-${dayKey(new Date())}.json`, JSON.stringify(await store.exportAll(), null, 2), 'application/json'),
        }, '导出'),
        h('button', { class: 'btn', onclick: () => file.click() }, '导入'),
        file,
      ),
    ),
  );
}

// ── render loop ─────────────────────────────────────────────────────

async function render() {
  const state = await store.load();
  const now = new Date();
  const current = route();
  // Keep the cursor in the quick-add box so several tasks can be typed in a row.
  const refocusQuick = Boolean(document.activeElement?.closest?.('.quick'));
  if (current.name !== 'review') ui.reviewQueue = null;
  renderNav(state, now);
  clear(view);
  if (ui.notice) {
    put(view, h('div', { class: 'notice', role: 'status' }, ui.notice));
    ui.notice = '';
  }
  const routes = {
    today: () => renderToday(state, now),
    upcoming: () => renderUpcoming(state, now),
    inbox: () => renderInbox(state, now),
    project: () => renderProject(state, now, current.arg),
    done: () => renderDone(state, now),
    library: () => renderLibrary(state),
    review: () => renderReview(state, now),
    week: () => renderDigest(state, now, 'week'),
    month: () => renderDigest(state, now, 'month'),
    settings: () => renderSettings(state),
  };
  (routes[current.name] ?? routes.today)();
  if (refocusQuick) view.querySelector('.quick input')?.focus();
}

window.addEventListener('hashchange', () => {
  ui.editingTask = null;
  ui.editingHighlight = null;
  render();
});
// A redraw replaces the whole view, so it must not happen under the user's
// hands: not while a form is open, and not while there is typed text.
function safeRender() {
  const active = document.activeElement;
  const typing = active && view.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.value;
  if (ui.editingTask || ui.editingHighlight || typing) return;
  render();
}

store.subscribe(safeRender);
// The date rolls over and timed tasks become overdue without any storage change.
setInterval(safeRender, 60000);
render();
