// Storage: one small repository over a key-value backend.
//
// The extension keeps everything in chrome.storage.local. The same code runs
// on a plain web page (localStorage) and in tests (memory), which is what
// lets the logic be tested without a browser.
//
// Tasks and highlights live under separate keys so that saving one never
// rewrites the other.

import { createHighlight, findDuplicate, normalizeTags } from './highlights.js';
import { gradeReview } from './review.js';
import { completeTask, createTask, reopenTask } from './tasks.js';

export const SCHEMA_VERSION = 1;
const KEYS = { tasks: 'suishou.tasks', highlights: 'suishou.highlights', settings: 'suishou.settings' };

export const DEFAULT_SETTINGS = {
  dailyReviewLimit: 5,
  reminders: true,
  selectionButton: true,
  rehighlight: true,
  disabledSites: [],
};

export class MemoryBackend {
  constructor(initial = {}) {
    this.data = structuredClone(initial);
    this.listeners = new Set();
  }

  async get(keys) {
    return Object.fromEntries(keys.filter((k) => k in this.data).map((k) => [k, structuredClone(this.data[k])]));
  }

  async set(values) {
    Object.assign(this.data, structuredClone(values));
    for (const listener of this.listeners) listener(Object.keys(values));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function chromeBackend(area = globalThis.chrome.storage.local) {
  return {
    get: (keys) => area.get(keys),
    set: (values) => area.set(values),
    subscribe(listener) {
      const handler = (changes, areaName) => {
        if (areaName === 'local') listener(Object.keys(changes));
      };
      globalThis.chrome.storage.onChanged.addListener(handler);
      return () => globalThis.chrome.storage.onChanged.removeListener(handler);
    },
  };
}

export function localStorageBackend(storage = globalThis.localStorage) {
  const listeners = new Set();
  return {
    async get(keys) {
      const result = {};
      for (const key of keys) {
        const raw = storage.getItem(key);
        if (raw !== null) result[key] = JSON.parse(raw);
      }
      return result;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) storage.setItem(key, JSON.stringify(value));
      for (const listener of listeners) listener(Object.keys(values));
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event) => event.key && listener([event.key]);
      globalThis.addEventListener?.('storage', onStorage);
      return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.('storage', onStorage);
      };
    },
  };
}

/** chrome.storage inside the extension, localStorage on a plain page. */
export function defaultBackend() {
  if (globalThis.chrome?.storage?.local) return chromeBackend();
  if (globalThis.localStorage) return localStorageBackend();
  return new MemoryBackend();
}

export class Store {
  constructor(backend = defaultBackend(), clock = () => new Date()) {
    this.backend = backend;
    this.clock = clock;
    this.queue = Promise.resolve();
  }

  async load() {
    const raw = await this.backend.get(Object.values(KEYS));
    return {
      tasks: raw[KEYS.tasks] ?? [],
      highlights: raw[KEYS.highlights] ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(raw[KEYS.settings] ?? {}) },
    };
  }

  subscribe(listener) {
    return this.backend.subscribe((keys) => {
      if (keys.some((key) => Object.values(KEYS).includes(key))) listener();
    });
  }

  // Writes read the latest value first and run one at a time, so two quick
  // actions in the same page cannot overwrite each other.
  mutate(key, change) {
    const run = async () => {
      const current = (await this.backend.get([KEYS[key]]))[KEYS[key]] ?? (key === 'settings' ? {} : []);
      const { value, result } = change(current);
      await this.backend.set({ [KEYS[key]]: value });
      return result;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  // ── tasks ─────────────────────────────────────────────────────────

  addTask(draft) {
    const task = createTask(draft, this.clock());
    return this.mutate('tasks', (tasks) => ({ value: [...tasks, task], result: task }));
  }

  updateTask(id, patch) {
    return this.mutate('tasks', (tasks) => {
      let updated = null;
      const value = tasks.map((task) => {
        if (task.id !== id) return task;
        updated = { ...task, ...patch, id: task.id, createdAt: task.createdAt };
        if (!updated.due) updated.hasTime = false;
        return updated;
      });
      return { value, result: updated };
    });
  }

  /** Finish an open task, or reopen a finished one. */
  toggleTask(id) {
    const now = this.clock();
    return this.mutate('tasks', (tasks) => {
      const task = tasks.find((item) => item.id === id);
      if (!task) return { value: tasks, result: null };
      if (task.completedAt) {
        const reopened = reopenTask(task);
        return { value: tasks.map((item) => (item.id === id ? reopened : item)), result: { done: reopened, next: null } };
      }
      const outcome = completeTask(task, now);
      const value = tasks.map((item) => (item.id === id ? outcome.done : item));
      if (outcome.next) value.push(outcome.next);
      return { value, result: outcome };
    });
  }

  deleteTask(id) {
    return this.mutate('tasks', (tasks) => ({ value: tasks.filter((task) => task.id !== id), result: true }));
  }

  // ── highlights ────────────────────────────────────────────────────

  /** Save a passage. Saving the same passage on the same page twice returns the first. */
  addHighlight(draft) {
    const now = this.clock();
    return this.mutate('highlights', (highlights) => {
      const duplicate = findDuplicate(highlights, draft);
      if (duplicate) return { value: highlights, result: { highlight: duplicate, duplicate: true } };
      const highlight = createHighlight(draft, now);
      return { value: [...highlights, highlight], result: { highlight, duplicate: false } };
    });
  }

  updateHighlight(id, patch) {
    return this.mutate('highlights', (highlights) => {
      let updated = null;
      const value = highlights.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item };
        if (patch.note !== undefined) updated.note = String(patch.note).trim();
        if (patch.tags !== undefined) updated.tags = normalizeTags(patch.tags);
        return updated;
      });
      return { value, result: updated };
    });
  }

  gradeHighlight(id, grade) {
    const now = this.clock();
    return this.mutate('highlights', (highlights) => {
      let updated = null;
      const value = highlights.map((item) => {
        if (item.id !== id) return item;
        updated = gradeReview(item, grade, now);
        return updated;
      });
      return { value, result: updated };
    });
  }

  deleteHighlight(id) {
    return this.mutate('highlights', (highlights) => ({
      value: highlights.filter((item) => item.id !== id),
      result: true,
    }));
  }

  // ── settings and backup ───────────────────────────────────────────

  updateSettings(patch) {
    return this.mutate('settings', (settings) => {
      const value = { ...DEFAULT_SETTINGS, ...settings, ...patch };
      return { value, result: value };
    });
  }

  async exportAll() {
    const state = await this.load();
    return { app: 'suishou', schema: SCHEMA_VERSION, exportedAt: this.clock().toISOString(), ...state };
  }

  /**
   * Restore a backup. Items are merged by id and the backup wins on a clash,
   * so importing the same file twice changes nothing.
   */
  async importAll(backup) {
    if (!backup || backup.app !== 'suishou' || !Array.isArray(backup.tasks) || !Array.isArray(backup.highlights)) {
      throw new Error('这不是随手的备份文件');
    }
    if (backup.schema > SCHEMA_VERSION) throw new Error('备份来自更新的版本，请先升级扩展');
    const valid = (item, prefix) => item && typeof item.id === 'string' && item.id.startsWith(prefix);
    const merge = (current, incoming) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of incoming) byId.set(item.id, item);
      return [...byId.values()];
    };
    const tasks = backup.tasks.filter((item) => valid(item, 't_') && typeof item.title === 'string');
    const highlights = backup.highlights.filter((item) => valid(item, 'h_') && typeof item.text === 'string');
    await this.mutate('tasks', (current) => ({ value: merge(current, tasks), result: null }));
    await this.mutate('highlights', (current) => ({ value: merge(current, highlights), result: null }));
    if (backup.settings) await this.updateSettings(backup.settings);
    return { tasks: tasks.length, highlights: highlights.length };
  }
}
