// Highlights: a saved passage with where it came from.

import { newId } from './ids.js';

// Hosts of AI chat products. A passage saved there is tagged as coming from
// a conversation rather than from an article.
const AI_SITES = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, 'ChatGPT'],
  [/(^|\.)claude\.ai$/, 'Claude'],
  [/(^|\.)gemini\.google\.com$/, 'Gemini'],
  [/(^|\.)chat\.deepseek\.com$/, 'DeepSeek'],
  [/(^|\.)kimi\.com$|(^|\.)kimi\.moonshot\.cn$/, 'Kimi'],
  [/(^|\.)doubao\.com$/, '豆包'],
  [/(^|\.)yuanbao\.tencent\.com$/, '元宝'],
  [/(^|\.)tongyi\.com$|(^|\.)qianwen\.com$/, '通义'],
  [/(^|\.)yiyan\.baidu\.com$/, '文心一言'],
  [/(^|\.)copilot\.microsoft\.com$/, 'Copilot'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)grok\.com$/, 'Grok'],
  [/(^|\.)poe\.com$/, 'Poe'],
];

export function detectSource(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: 'web', site: '', label: '未知来源' };
  }
  for (const [pattern, label] of AI_SITES) {
    if (pattern.test(host)) return { kind: 'ai', site: host, label };
  }
  const site = host.replace(/^www\./, '');
  return { kind: 'web', site, label: site };
}

/** Collapse runs of whitespace; keep paragraph breaks as single newlines. */
export function normalizeText(text) {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/[ \t 　]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function normalizeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const raw of tags ?? []) {
    const tag = String(raw).trim().replace(/^#+/, '');
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      result.push(tag);
    }
  }
  return result;
}

/** Drop the fragment and tracking parameters so the same page compares equal. */
export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|fbclid$|gclid$|share_)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export const MAX_HIGHLIGHT_LENGTH = 4000;

export function createHighlight(draft, now = new Date()) {
  const text = normalizeText(draft.text ?? '');
  if (!text) throw new Error('nothing selected');
  if (text.length > MAX_HIGHLIGHT_LENGTH) {
    throw new Error(`selection is longer than ${MAX_HIGHLIGHT_LENGTH} characters`);
  }
  return {
    id: newId('h', now.getTime()),
    text,
    note: (draft.note ?? '').trim(),
    tags: normalizeTags(draft.tags),
    url: canonicalUrl(draft.url ?? ''),
    pageTitle: (draft.pageTitle ?? '').trim(),
    source: detectSource(draft.url ?? ''),
    prefix: (draft.prefix ?? '').slice(-40),
    suffix: (draft.suffix ?? '').slice(0, 40),
    createdAt: now.toISOString(),
    review: { box: 0, dueAt: null, lastReviewedAt: null, count: 0, retired: false },
  };
}

/** The same passage on the same page, if it is already saved. */
export function findDuplicate(highlights, draft) {
  const text = normalizeText(draft.text ?? '');
  const url = canonicalUrl(draft.url ?? '');
  return highlights.find((item) => item.url === url && item.text === text) ?? null;
}

/**
 * Filter by free text (every word must appear in the passage, note, title or
 * tags), tag, source kind and date range.
 */
export function searchHighlights(highlights, { query = '', tag = null, kind = null, from = null, to = null } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return highlights
    .filter((item) => {
      if (tag && !item.tags.includes(tag)) return false;
      if (kind && item.source.kind !== kind) return false;
      if (from && item.createdAt < from) return false;
      if (to && item.createdAt >= to) return false;
      if (!words.length) return true;
      const haystack = `${item.text}\n${item.note}\n${item.pageTitle}\n${item.tags.join(' ')}\n${item.source.label}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function tagCounts(highlights) {
  const counts = new Map();
  for (const item of highlights) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));
}
