// Content script: runs in every page.
//
// It does three things and holds no data of its own:
//   1. shows a small bar next to a text selection (收藏 / 待办);
//   2. after a save, lets the user add tags and a note in place;
//   3. marks passages saved earlier when the page is opened again.
//
// Everything is sent to the background worker. The UI lives in a closed
// shadow root so that page styles and page scripts cannot reach into it.

(() => {
  if (window.__suishouLoaded) return;
  window.__suishouLoaded = true;

  const MARK_CLASS = 'suishou-mark';
  const MAX_LENGTH = 4000;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE-INPUT']);

  let settings = { selectionButton: true, rehighlight: true };
  let pending = []; // saved passages not yet found in the page
  let findAnchor = null;
  let currentUrl = location.href;

  const send = (message) =>
    chrome.runtime.sendMessage(message).then((reply) => {
      if (!reply?.ok) throw new Error(reply?.error ?? '扩展没有响应');
      return reply.result;
    });

  // ── UI shell ──────────────────────────────────────────────────────

  const host = document.createElement('suishou-root');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; }
      .bar { position: fixed; display: none; gap: 2px; padding: 3px; background: #1f2328; border-radius: 8px;
             box-shadow: 0 4px 16px rgba(0,0,0,.25); }
      .bar button { all: unset; cursor: pointer; color: #fff; font-size: 13px; line-height: 1; padding: 7px 10px; border-radius: 6px; }
      .bar button:hover { background: #3a4048; }
      .card { position: fixed; right: 20px; bottom: 20px; width: 320px; display: none; background: #fff; color: #1f2328;
              border: 1px solid #d8dee4; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 14px; font-size: 13px; }
      .card h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
      .card .quote { max-height: 66px; overflow: hidden; color: #57606a; border-left: 3px solid #f2c94c; padding-left: 8px; margin-bottom: 10px; line-height: 1.5; }
      .card input, .card textarea { width: 100%; border: 1px solid #d0d7de; border-radius: 6px; padding: 6px 8px; font-size: 13px; margin-bottom: 8px; color: #1f2328; background: #fff; outline: none; }
      .card input:focus, .card textarea:focus { border-color: #d9480f; }
      .card textarea { resize: none; height: 52px; }
      .card .row { display: flex; justify-content: space-between; align-items: center; }
      .card button { all: unset; cursor: pointer; font-size: 13px; padding: 6px 12px; border-radius: 6px; }
      .card .primary { background: #d9480f; color: #fff; }
      .card .ghost { color: #57606a; }
      .card .danger { color: #cf222e; }
      .card .close { color: #8c959f; padding: 0 4px; font-size: 16px; }
      .toast { position: fixed; right: 20px; bottom: 20px; display: none; background: #1f2328; color: #fff; padding: 10px 14px;
               border-radius: 8px; font-size: 13px; max-width: 320px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    </style>
    <div class="bar" part="bar">
      <button data-action="save" title="Alt+S">收藏</button>
      <button data-action="task">记为待办</button>
    </div>
    <div class="card">
      <h4><span class="card-title">已收藏</span><button class="close" data-action="close" title="关闭">×</button></h4>
      <div class="quote"></div>
      <input class="tags" placeholder="标签，用空格分开" />
      <textarea class="note" placeholder="我的想法（可不填）"></textarea>
      <div class="row">
        <button class="danger" data-action="delete">删除</button>
        <span><button class="ghost" data-action="open">收藏库</button><button class="primary" data-action="done">保存</button></span>
      </div>
    </div>
    <div class="toast"></div>`;
  const bar = root.querySelector('.bar');
  const card = root.querySelector('.card');
  const toast = root.querySelector('.toast');
  let cardId = null;
  let toastTimer = 0;

  function mount() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!document.getElementById('suishou-style')) {
      const style = document.createElement('style');
      style.id = 'suishou-style';
      style.textContent = `mark.${MARK_CLASS}{background:#ffe89a;color:inherit;border-radius:2px;padding:0;cursor:pointer}`;
      (document.head ?? document.documentElement).appendChild(style);
    }
  }

  function showToast(text) {
    mount();
    card.style.display = 'none';
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.style.display = 'none'), 2600);
  }

  function showCard(highlight, title) {
    mount();
    toast.style.display = 'none';
    cardId = highlight.id;
    root.querySelector('.card-title').textContent = title;
    root.querySelector('.quote').textContent = highlight.text;
    root.querySelector('.tags').value = (highlight.tags ?? []).join(' ');
    root.querySelector('.note').value = highlight.note ?? '';
    card.style.display = 'block';
    root.querySelector('.tags').focus();
  }

  async function saveCard() {
    if (!cardId) return;
    const tags = root.querySelector('.tags').value.split(/[\s,，、]+/).filter(Boolean);
    const note = root.querySelector('.note').value;
    const id = cardId;
    closeCard();
    try {
      const updated = await send({ type: 'highlight:update', id, patch: { tags, note } });
      for (const mark of document.querySelectorAll(`mark.${MARK_CLASS}[data-suishou-id="${id}"]`)) {
        mark.dataset.suishouTags = updated.tags.join(' ');
        mark.dataset.suishouNote = updated.note;
      }
    } catch (error) {
      showToast(`没保存上：${error.message}`);
    }
  }

  function closeCard() {
    card.style.display = 'none';
    cardId = null;
  }

  card.addEventListener('click', async (event) => {
    const action = event.target.dataset?.action;
    if (action === 'done') await saveCard();
    if (action === 'close') closeCard();
    if (action === 'open') send({ type: 'app:open', hash: '#library' }).catch(() => {});
    if (action === 'delete' && cardId) {
      const id = cardId;
      closeCard();
      await send({ type: 'highlight:delete', id }).catch(() => {});
      unmark(id);
      showToast('已删除');
    }
  });
  card.addEventListener('keydown', (event) => {
    event.stopPropagation(); // keep page shortcuts from firing while typing
    if (event.key === 'Enter' && !event.shiftKey && event.target.classList.contains('tags')) saveCard();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveCard();
    if (event.key === 'Escape') closeCard();
  });
  for (const type of ['keyup', 'keypress', 'mousedown', 'mouseup']) {
    card.addEventListener(type, (event) => event.stopPropagation());
  }

  // ── selection ─────────────────────────────────────────────────────

  function isEditable(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
  }

  function blockOf(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element && element !== document.body) {
      const display = getComputedStyle(element).display;
      if (display !== 'inline' && display !== 'contents') return element;
      element = element.parentElement;
    }
    return document.body;
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text.trim() || isEditable(range.commonAncestorContainer) || host.contains(range.commonAncestorContainer)) {
      return null;
    }
    const block = blockOf(range.commonAncestorContainer);
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    return { text, prefix: before.toString().slice(-40), suffix: after.toString().slice(0, 40), range };
  }

  function placeBar() {
    const captured = settings.selectionButton ? captureSelection() : null;
    if (!captured) {
      bar.style.display = 'none';
      return;
    }
    mount();
    const rects = captured.range.getClientRects();
    const rect = rects[rects.length - 1] ?? captured.range.getBoundingClientRect();
    bar.style.display = 'flex';
    const width = bar.offsetWidth || 130;
    const left = Math.min(Math.max(8, rect.right - width / 2), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    const top = below + 40 > window.innerHeight ? Math.max(8, rect.top - 40) : below;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  async function saveSelection() {
    const captured = captureSelection();
    if (!captured) return false;
    bar.style.display = 'none';
    if (captured.text.length > MAX_LENGTH) {
      showToast(`选得太长了（上限 ${MAX_LENGTH} 字），请分段收藏`);
      return true;
    }
    try {
      const { highlight, duplicate } = await send({
        type: 'highlight:add',
        draft: {
          text: captured.text,
          prefix: captured.prefix,
          suffix: captured.suffix,
          url: location.href,
          pageTitle: document.title,
        },
      });
      window.getSelection()?.removeAllRanges();
      if (settings.rehighlight) {
        pending.push(highlight);
        await applyPending();
      }
      showCard(highlight, duplicate ? '这段已经收藏过' : '已收藏');
    } catch (error) {
      showToast(`没收藏上：${error.message}`);
    }
    return true;
  }

  async function selectionToTask() {
    const captured = captureSelection();
    if (!captured) return;
    bar.style.display = 'none';
    const title = captured.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    try {
      await send({ type: 'task:add', draft: { title, sourceUrl: location.href, sourceTitle: document.title } });
      window.getSelection()?.removeAllRanges();
      showToast(`已记为待办：${title.length > 24 ? `${title.slice(0, 24)}…` : title}`);
    } catch (error) {
      showToast(`没记上：${error.message}`);
    }
  }

  bar.addEventListener('mousedown', (event) => event.preventDefault()); // keep the selection
  bar.addEventListener('click', (event) => {
    const action = event.target.dataset?.action;
    if (action === 'save') saveSelection();
    if (action === 'task') selectionToTask();
  });

  let selectionTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(placeBar, 180);
  });
  window.addEventListener('scroll', () => (bar.style.display = 'none'), { passive: true, capture: true });

  // ── marking saved passages ────────────────────────────────────────

  function textNodes() {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || host.contains(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: text.length });
      text += node.nodeValue;
    }
    return { nodes, text };
  }

  function wrap(nodes, start, end, highlight) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, start: nodeStart } = nodes[i];
      const nodeEnd = nodeStart + node.nodeValue.length;
      if (nodeEnd <= start || nodeStart >= end) continue;
      const from = Math.max(start, nodeStart) - nodeStart;
      const to = Math.min(end, nodeEnd) - nodeStart;
      if (!node.nodeValue.slice(from, to).trim()) continue;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      mark.dataset.suishouId = highlight.id;
      mark.dataset.suishouTags = (highlight.tags ?? []).join(' ');
      mark.dataset.suishouNote = highlight.note ?? '';
      try {
        range.surroundContents(mark);
      } catch {
        /* the node changed under us; the next pass will retry */
      }
    }
  }

  function unmark(id) {
    for (const mark of document.querySelectorAll(`mark.${MARK_CLASS}[data-suishou-id="${id}"]`)) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  let applying = false;
  async function applyPending() {
    if (applying || !pending.length || !document.body) return;
    applying = true;
    try {
      if (!findAnchor) {
        ({ findAnchor } = await import(chrome.runtime.getURL('src/core/anchor.js')));
      }
      mount();
      const { nodes, text } = textNodes();
      const located = [];
      const still = [];
      for (const highlight of pending) {
        if (document.querySelector(`mark.${MARK_CLASS}[data-suishou-id="${highlight.id}"]`)) continue;
        const span = findAnchor(text, highlight);
        if (span) located.push({ highlight, span });
        else still.push(highlight);
      }
      // Wrap from the end of the page backwards so earlier offsets stay valid.
      located.sort((a, b) => b.span.start - a.span.start);
      let floor = Infinity;
      for (const { highlight, span } of located) {
        if (span.end > floor) continue; // overlaps one already wrapped
        wrap(nodes, span.start, span.end, highlight);
        floor = span.start;
      }
      pending = still;
    } catch {
      pending = [];
    } finally {
      applying = false;
    }
  }

  document.addEventListener('click', (event) => {
    const mark = event.target instanceof Element ? event.target.closest(`mark.${MARK_CLASS}`) : null;
    if (!mark || !window.getSelection()?.isCollapsed) return;
    const parts = [...document.querySelectorAll(`mark.${MARK_CLASS}[data-suishou-id="${mark.dataset.suishouId}"]`)];
    showCard(
      {
        id: mark.dataset.suishouId,
        text: parts.map((part) => part.textContent).join(''),
        tags: (mark.dataset.suishouTags ?? '').split(' ').filter(Boolean),
        note: mark.dataset.suishouNote ?? '',
      },
      '我的收藏',
    );
  });

  async function loadForPage() {
    try {
      const result = await send({ type: 'highlight:for-page', url: location.href });
      settings = result.settings;
      pending = settings.rehighlight ? result.highlights : [];
      await applyPending();
    } catch {
      /* the extension was reloaded; this page keeps working without it */
    }
  }

  // Pages that load content late (chat apps, single-page sites): retry while
  // there are saved passages still not found, and reload on navigation.
  let mutationTimer = 0;
  let retries = 0;
  new MutationObserver(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      retries = 0;
      closeCard();
      loadForPage();
      return;
    }
    if (!pending.length || retries > 20) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      retries += 1;
      applyPending();
    }, 1200);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'save-selection') {
      saveSelection().then((handled) => {
        if (!handled) showToast('先选中一段文字');
        respond({ ok: handled });
      });
      return true;
    }
    if (message?.type === 'toast') showToast(message.text);
    return false;
  });

  loadForPage();
})();
