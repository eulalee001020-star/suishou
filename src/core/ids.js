/** Sortable unique id: time in base 36 plus random characters. */
export function newId(prefix, now = Date.now()) {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}_${now.toString(36)}${random}`;
}
