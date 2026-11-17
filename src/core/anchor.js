// Find a saved passage again in a page's text.
//
// The page may have changed since the passage was saved, and the same words
// may appear more than once. The few characters saved before and after the
// passage pick the right occurrence.

/** Remove all whitespace, remembering where each kept character came from. */
export function squash(text) {
  const chars = [];
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      chars.push(text[i]);
      map.push(i);
    }
  }
  return { text: chars.join(''), map };
}

/**
 * Locate `target.text` in `pageText`.
 * @returns {{ start: number, end: number } | null} offsets into `pageText`
 */
export function findAnchor(pageText, target) {
  const page = squash(pageText);
  const needle = squash(target.text).text;
  if (!needle) return null;
  const prefix = squash(target.prefix ?? '').text;
  const suffix = squash(target.suffix ?? '').text;

  let best = null;
  let from = 0;
  for (;;) {
    const index = page.text.indexOf(needle, from);
    if (index === -1) break;
    let score = 0;
    if (prefix && page.text.slice(Math.max(0, index - prefix.length), index).endsWith(prefix.slice(-12))) score += 1;
    if (suffix && page.text.slice(index + needle.length).startsWith(suffix.slice(0, 12))) score += 1;
    if (best === null || score > best.score) best = { index, score };
    if (score === 2) break;
    from = index + 1;
  }
  if (best === null) return null;
  return { start: page.map[best.index], end: page.map[best.index + needle.length - 1] + 1 };
}
