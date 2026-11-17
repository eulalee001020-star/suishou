// Background service worker: the one place that writes on behalf of pages.
//
// Content scripts never touch storage directly. They send a message here, so
// a web page's script context holds no data and no storage code.

import { canonicalUrl } from '../core/highlights.js';
import { Store } from '../core/store.js';
import { attentionCount, describeDue, dueReminders } from '../core/tasks.js';

const store = new Store();
const APP_PAGE = 'src/ui/app.html';
const MENU_SAVE = 'suishou-save-selection';
const MENU_TASK = 'suishou-page-to-task';
const ALARM = 'suishou-tick';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SAVE, title: '收藏选中的文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_TASK, title: '把这个页面记为待办', contexts: ['page', 'link'] });
  });
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  refreshBadge();
});

async function refreshBadge() {
  const { tasks } = await store.load();
  const count = attentionCount(tasks, new Date());
  await chrome.action.setBadgeBackgroundColor({ color: '#d9480f' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

async function sendReminders() {
  const { tasks, settings } = await store.load();
  if (!settings.reminders) return;
  const now = new Date();
  for (const task of dueReminders(tasks, now)) {
    chrome.notifications.create(`task:${task.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: task.title,
      message: `到时间了 · ${describeDue(task, now)}`,
      priority: 1,
    });
    await store.updateTask(task.id, { remindedFor: task.due });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await sendReminders();
  await refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'suishou.tasks' in changes) refreshBadge();
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  openApp('#today');
});

function openApp(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(APP_PAGE) + hash });
}

function tell(tabId, message) {
  if (tabId === undefined) return;
  // The page may have no content script (browser pages, the web store).
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE && info.selectionText) {
    // Ask the page first: it knows the text around the selection, which lets
    // the passage be found again later. Fall back to the bare text.
    const handled = await chrome.tabs
      .sendMessage(tab.id, { type: 'save-selection' })
      .then((reply) => Boolean(reply?.ok))
      .catch(() => false);
    if (!handled) {
      await store.addHighlight({ text: info.selectionText, url: tab?.url ?? '', pageTitle: tab?.title ?? '' });
    }
  }
  if (info.menuItemId === MENU_TASK) {
    const url = info.linkUrl ?? tab?.url ?? '';
    const task = await store.addTask({ title: tab?.title || url, sourceUrl: url, sourceTitle: tab?.title ?? '' });
    tell(tab?.id, { type: 'toast', text: `已记为待办：${task.title}` });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tell(tab?.id, { type: 'save-selection' });
});

const handlers = {
  async 'highlight:add'({ draft }) {
    return store.addHighlight(draft);
  },
  async 'highlight:update'({ id, patch }) {
    return store.updateHighlight(id, patch);
  },
  async 'highlight:delete'({ id }) {
    return store.deleteHighlight(id);
  },
  async 'highlight:for-page'({ url }) {
    const { highlights, settings } = await store.load();
    const page = canonicalUrl(url);
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* not a url */
    }
    const disabled = settings.disabledSites.includes(host);
    return {
      settings: { selectionButton: settings.selectionButton && !disabled, rehighlight: settings.rehighlight && !disabled },
      highlights: highlights
        .filter((item) => item.url === page)
        .map(({ id, text, prefix, suffix, note, tags }) => ({ id, text, prefix, suffix, note, tags })),
    };
  },
  async 'task:add'({ draft }) {
    return store.addTask(draft);
  },
  async 'app:open'({ hash }) {
    openApp(hash ?? '');
    return true;
  },
};

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message)
    .then((result) => respond({ ok: true, result }))
    .catch((error) => respond({ ok: false, error: String(error?.message ?? error) }));
  return true; // keep the channel open for the async reply
});
