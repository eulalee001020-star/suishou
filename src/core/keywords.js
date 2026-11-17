// Frequent words in a set of passages, for the review digest.
//
// Chinese has no spaces, so words are found with Intl.Segmenter, which ships
// with Chrome and Node. Single characters, numbers and common function words
// are dropped.

const STOP = new Set(
  (
    '的 了 是 在 和 与 及 或 而 但 也 都 就 还 又 很 更 最 这 那 这个 那个 这些 那些 一个 一种 一些 没有 不是 可以 需要 ' +
    '我们 你们 他们 自己 什么 怎么 如何 因为 所以 如果 但是 然后 以及 通过 进行 对于 关于 可能 应该 已经 时候 ' +
    '问题 方面 情况 东西 事情 一下 这样 那样 其实 就是 还是 或者 并且 而且 之后 之前 的话 起来 出来 不会 不能 ' +
    'the a an and or but of to in on for with is are was were be been it this that these those as at by from not you your i we they'
  ).split(' '),
);

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

// Characters that never start or end a term on their own.
const STOP_CHARS = new Set(
  '的了是在和与及或而但也都就还又很更最这那要先再把被对从到为以其之于等会能可将并不没有无个种些中上下里后前时来去说看想做用让给着过得地所如若且即则因此每各某该本当已曾正才只仅约共同向往由你我他她它们吗呢吧啊',
);
const CJK = /^[\u4e00-\u9fff]$/;

function words(text) {
  if (!segmenter) return text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const result = [];
  // The segmenter's dictionary misses many domain terms and returns them one
  // character at a time ("排", "程"). A run of two or three such characters
  // is taken as one candidate term; a longer run is cut into pairs. A
  // candidate that is only noise will not recur in a second passage and is
  // dropped by the caller.
  let run = [];
  const flush = () => {
    if (run.length === 2 || run.length === 3) result.push(run.join(''));
    else for (let i = 0; i + 1 < run.length; i++) result.push(run[i] + run[i + 1]);
    run = [];
  };
  for (const part of segmenter.segment(text)) {
    const word = part.segment.toLowerCase();
    if (part.isWordLike && CJK.test(word) && !STOP_CHARS.has(word)) {
      run.push(word);
      continue;
    }
    flush();
    if (!part.isWordLike || /^\d+$/.test(word)) continue;
    if (/^[a-z]/.test(word) ? word.length < 3 : word.length < 2) continue;
    if (STOP.has(word)) continue;
    result.push(word);
  }
  flush();
  return result;
}

/** The most frequent words, counted once per passage so one long quote cannot dominate. */
export function topKeywords(texts, limit = 8) {
  const counts = new Map();
  for (const text of texts) {
    for (const word of new Set(words(text))) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
