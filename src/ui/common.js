// Small DOM helpers and the pieces both pages share.

import { parseQuickAdd } from '../core/quickadd.js';
import { describeRecurrence } from '../core/recurrence.js';
import { bucketOf, describeDue } from '../core/tasks.js';

/** h('div', { class: 'x', onclick }, child, 'text', [more]) */
export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key in element && key !== 'list') element[key] = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

/** Chips describing what a quick-add line was understood as. */
export function previewChips(draft, now = new Date()) {
  const chips = [];
  if (draft.due) chips.push(h('span', { class: 'chip date' }, describeDue(draft, now)));
  if (draft.recurrence) chips.push(h('span', { class: 'chip' }, describeRecurrence(draft.recurrence)));
  if (draft.priority < 4) chips.push(h('span', { class: `chip p${draft.priority}` }, `P${draft.priority}`));
  if (draft.project) chips.push(h('span', { class: 'chip' }, `#${draft.project}`));
  for (const label of draft.labels) chips.push(h('span', { class: 'chip' }, `@${label}`));
  return chips;
}

/**
 * The quick-add box. Shows live what the line will become and calls
 * `onAdd(draft)` on Enter.
 */
export function quickAdd({ onAdd, placeholder, extra = {} }) {
  const preview = h('div', { class: 'preview' });
  const input = h('input', {
    type: 'text',
    placeholder: placeholder ?? '明天下午3点 交周报 p1 #工作',
    autocomplete: 'off',
    'aria-label': '添加待办',
    oninput: () => {
      const text = input.value.trim();
      clear(preview);
      if (text) preview.append(...previewChips(parseQuickAdd(text, new Date())));
    },
    onkeydown: async (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const draft = parseQuickAdd(input.value, new Date());
      if (!draft.title) return;
      input.value = '';
      clear(preview);
      await onAdd({ ...draft, ...extra });
    },
  });
  const box = h('div', { class: 'quick' }, input, preview);
  box.focusInput = () => input.focus();
  return box;
}

export function taskRow(task, { onToggle, onEdit, onDelete, now = new Date() }) {
  const bucket = bucketOf(task, now);
  const meta = [];
  if (task.due) {
    meta.push(h('span', { class: `chip ${bucket === 'overdue' ? 'overdue' : 'date'}` }, describeDue(task, now)));
  }
  if (task.recurrence) meta.push(h('span', { class: 'chip' }, describeRecurrence(task.recurrence)));
  if (task.project) meta.push(h('span', { class: 'chip' }, `#${task.project}`));
  for (const label of task.labels ?? []) meta.push(h('span', { class: 'chip' }, `@${label}`));
  if (task.sourceUrl) {
    meta.push(h('a', { class: 'chip', href: task.sourceUrl, target: '_blank', rel: 'noopener', title: task.sourceTitle || task.sourceUrl }, '来源页面'));
  }
  return h(
    'div',
    { class: `task p${task.priority}${task.completedAt ? ' done' : ''}`, dataset: { id: task.id } },
    h('button', {
      class: 'check',
      title: task.completedAt ? '恢复为未完成' : '完成',
      'aria-label': task.completedAt ? `恢复 ${task.title}` : `完成 ${task.title}`,
      onclick: () => onToggle(task),
    }),
    h('div', { class: 'body' }, h('div', { class: 'title' }, task.title), h('div', { class: 'meta' }, meta)),
    h(
      'div',
      { class: 'actions' },
      onEdit && !task.completedAt && h('button', { onclick: () => onEdit(task) }, '改'),
      onDelete && h('button', { onclick: () => onDelete(task) }, '删'),
    ),
  );
}

export function highlightCard(item, { onEdit, onDelete, onTask } = {}) {
  const when = new Date(item.createdAt);
  const date = `${when.getMonth() + 1}月${when.getDate()}日`;
  return h(
    'div',
    { class: 'hl', dataset: { id: item.id } },
    h('blockquote', {}, item.text),
    item.note && h('div', { class: 'note' }, `我的想法：${item.note}`),
    h(
      'div',
      { class: 'meta' },
      h('span', { class: `chip ${item.source.kind === 'ai' ? 'ai' : ''}` }, item.source.label),
      item.tags.map((tag) => h('span', { class: 'chip' }, `#${tag}`)),
      item.url && h('a', { href: item.url, target: '_blank', rel: 'noopener', title: item.url }, item.pageTitle || item.url),
      h('span', {}, date),
      h(
        'span',
        { class: 'actions' },
        onTask && h('button', { onclick: () => onTask(item) }, '转待办'),
        onEdit && h('button', { onclick: () => onEdit(item) }, '标签/想法'),
        onDelete && h('button', { onclick: () => onDelete(item) }, '删'),
      ),
    ),
  );
}

/** Open the full page at a section, from the popup or from a plain page. */
export function openApp(hash) {
  if (globalThis.chrome?.runtime?.sendMessage && globalThis.chrome.runtime.id) {
    chrome.runtime.sendMessage({ type: 'app:open', hash });
  } else {
    window.open(`app.html${hash}`, '_blank');
  }
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
