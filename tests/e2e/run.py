"""End-to-end check of the extension in a real Chrome.

    pip install playwright
    python tests/e2e/run.py [path-to-chrome]

Loads the unpacked extension, saves passages on a test page, reloads to see
them marked again, then drives the popup and every section of the full page.
Exits non-zero on the first failed expectation.
"""

import asyncio
import functools
import http.server
import json
import sys
import tempfile
import threading
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"
PORT = 8899
checks = 0


def expect(condition, message):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(message)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def select(page, selector, start, end):
    """Select characters [start, end) of an element's text."""
    await page.evaluate(
        """([sel, s, e]) => {
          const root = document.querySelector(sel);
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let pos = 0, sn, so, en, eo;
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const len = t.nodeValue.length;
            if (sn === undefined && s <= pos + len) { sn = t; so = s - pos; }
            if (en === undefined && e <= pos + len) { en = t; eo = e - pos; }
            pos += len;
          }
          const range = document.createRange();
          range.setStart(sn, so); range.setEnd(en, eo);
          const selection = getSelection();
          selection.removeAllRanges(); selection.addRange(range);
        }""",
        [selector, start, end],
    )
    await page.wait_for_timeout(350)


async def main():
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", PORT), functools.partial(Quiet, directory=str(Path(__file__).parent))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    site = f"http://127.0.0.1:{PORT}/fixture.html"

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            tempfile.mkdtemp(),
            executable_path=CHROME,
            headless=False,
            args=["--headless=new", "--no-sandbox", f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"],
            viewport={"width": 1200, "height": 900},
        )
        worker = context.service_workers[0] if context.service_workers else await context.wait_for_event("serviceworker")
        extension = worker.url.split("/")[2]
        errors = []

        def watch(page, name):
            page.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
            page.on("console", lambda m: errors.append(f"{name} console: {m.text}") if m.type == "error" else None)

        async def stored(key):
            return (await worker.evaluate("k => chrome.storage.local.get(k)", key)).get(key, [])

        async def marks(page):
            return await page.evaluate(
                "[...document.querySelectorAll('mark.suishou-mark')].map(m => ({text: m.textContent, p: m.closest('p').id, id: m.dataset.suishouId}))"
            )

        # ── saving on a page ────────────────────────────────────────
        page = await context.new_page()
        watch(page, "page")
        await page.goto(site)
        await page.bring_to_front()
        await page.wait_for_timeout(600)

        # The selection crosses a <b>; save with the bar next to the selection.
        await select(page, "#p1", 0, 27)
        box = await page.evaluate(
            "(() => { const r = getSelection().getRangeAt(0).getClientRects(); const b = r[r.length - 1]; return [b.right, b.bottom]; })()"
        )
        await page.mouse.click(box[0] - 30, box[1] + 22)  # the 收藏 button of the bar
        await page.wait_for_timeout(600)
        saved = await stored("suishou.highlights")
        expect(len(saved) == 1, f"bar click should save one passage, got {len(saved)}")
        expect(saved[0]["text"] == "调度算法的难点多半不在求解，而在把业务规则翻译成约束。", saved[0]["text"])
        expect(saved[0]["suffix"].startswith("不懂业务"), "suffix context is recorded")
        found = await marks(page)
        expect("".join(m["text"] for m in found) == saved[0]["text"], "passage is marked across the inline element")
        expect(len(found) == 3, "one mark per text node")

        # The card that opens after saving takes tags and a note.
        await page.keyboard.type("排程 方法")
        await page.keyboard.press("Tab")
        await page.keyboard.type("先懂业务")
        await page.keyboard.press("Control+Enter")
        await page.wait_for_timeout(400)
        saved = await stored("suishou.highlights")
        expect(saved[0]["tags"] == ["排程", "方法"], f"tags saved from the card: {saved[0]['tags']}")
        expect(saved[0]["note"] == "先懂业务", "note saved from the card")

        # Saving the same passage again does not duplicate it.
        await select(page, "#p1", 0, 27)
        await worker.evaluate("async () => { const [t] = await chrome.tabs.query({active: true, currentWindow: true}); return chrome.tabs.sendMessage(t.id, {type: 'save-selection'}); }")
        await page.wait_for_timeout(400)
        expect(len(await stored("suishou.highlights")) == 1, "duplicate is not stored twice")
        await page.keyboard.press("Escape")

        # Text in a form field is never offered.
        await page.evaluate("document.getElementById('ta').focus(); document.getElementById('ta').select()")
        reply = await worker.evaluate("async () => { const [t] = await chrome.tabs.query({active: true, currentWindow: true}); return chrome.tabs.sendMessage(t.id, {type: 'save-selection'}); }")
        expect(reply == {"ok": False}, "selection inside a textarea is refused")

        # The second of two identical sentences, and one that arrives late.
        text = await page.evaluate("document.querySelector('#p3').textContent")
        second = text.rindex("这很重要。")
        await select(page, "#p3", second, second + 5)
        await page.keyboard.press("Alt+S")  # may not reach the extension in headless; fall back below
        await page.wait_for_timeout(300)
        if len(await stored("suishou.highlights")) < 2:
            await worker.evaluate("async () => { const [t] = await chrome.tabs.query({active: true, currentWindow: true}); return chrome.tabs.sendMessage(t.id, {type: 'save-selection'}); }")
            await page.wait_for_timeout(400)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1300)
        await select(page, "#p4", 0, 12)
        await worker.evaluate("async () => { const [t] = await chrome.tabs.query({active: true, currentWindow: true}); return chrome.tabs.sendMessage(t.id, {type: 'save-selection'}); }")
        await page.wait_for_timeout(400)
        expect(len(await stored("suishou.highlights")) == 3, "three passages saved")

        # ── coming back to the page ─────────────────────────────────
        await page.reload()
        await page.wait_for_timeout(700)
        early = await marks(page)
        expect({m["p"] for m in early} == {"p1", "p3"}, f"static passages are marked on load: {early}")
        before = await page.evaluate("document.querySelector('#p3 mark').previousSibling.textContent")
        expect(before.endswith("出现第二次："), "the second occurrence is the one marked")
        await page.wait_for_timeout(2600)
        late = await marks(page)
        expect(any(m["p"] == "p4" for m in late), "a passage in late-arriving content is marked once it appears")

        # Clicking a mark opens its card; deleting removes the marks.
        await page.click("#p3 mark")
        await page.wait_for_timeout(300)
        await page.keyboard.press("Escape")
        count_before = len(await stored("suishou.highlights"))
        expect(count_before == 3, "opening a card changes nothing")

        # Selection to task.
        await select(page, "#p2", 0, 16)
        box = await page.evaluate(
            "(() => { const r = getSelection().getRangeAt(0).getClientRects(); const b = r[r.length - 1]; return [b.right, b.bottom]; })()"
        )
        await page.mouse.click(box[0] + 28, box[1] + 22)  # the 记为待办 button
        await page.wait_for_timeout(500)
        tasks = await stored("suishou.tasks")
        expect(len(tasks) == 1 and tasks[0]["title"].startswith("ERP 的本质"), f"selection became a task: {tasks}")
        expect(tasks[0]["sourceUrl"].endswith("fixture.html"), "task remembers the page")

        # ── popup ───────────────────────────────────────────────────
        popup = await context.new_page()
        watch(popup, "popup")
        await popup.set_viewport_size({"width": 380, "height": 580})
        await popup.goto(f"chrome-extension://{extension}/src/ui/popup.html")
        await popup.wait_for_timeout(400)
        await popup.fill(".quick input", "明天下午3点 交论文初稿 p1 #论文")
        chips = await popup.evaluate("[...document.querySelectorAll('.quick .chip')].map(c => c.textContent)")
        expect(chips == ["明天 15:00", "P1", "#论文"], f"live preview: {chips}")
        await popup.keyboard.press("Enter")
        await popup.wait_for_timeout(250)
        for line in ["今天 买牛奶", "每周五下午5点 交周报 p2 #工作"]:
            await popup.keyboard.type(line)  # focus must still be in the box
            await popup.keyboard.press("Enter")
            await popup.wait_for_timeout(250)
        tasks = await stored("suishou.tasks")
        expect(len(tasks) == 4, f"three tasks typed in a row without clicking: {len(tasks)}")
        expect(await worker.evaluate("chrome.action.getBadgeText({})") == "1", "badge counts today's task")
        await popup.click('.tab[data-tab="saved"]')
        expect(await popup.locator(".hl").count() == 3, "popup lists recent saves")

        # ── full page ───────────────────────────────────────────────
        app = await context.new_page()
        watch(app, "app")
        base = f"chrome-extension://{extension}/src/ui/app.html"

        async def open_section(name):
            await app.goto(f"{base}#{name}")
            await app.wait_for_timeout(350)

        await open_section("upcoming")
        titles = await app.evaluate("[...document.querySelectorAll('.task .title')].map(t => t.textContent)")
        expect(titles == ["交论文初稿", "交周报"], f"upcoming in date order: {titles}")
        await app.click('.task:has-text("交周报") .check')
        await app.wait_for_timeout(400)
        reports = [t for t in await stored("suishou.tasks") if t["title"] == "交周报"]
        expect(len(reports) == 2 and sum(1 for t in reports if t["completedAt"]) == 1, "finishing a repeat creates the next one")

        await open_section("project/论文")
        await app.click('.task >> text=改')
        await app.fill('.form input[type="text"] >> nth=0', "交论文初稿（含图表）")
        await app.select_option(".form select", "2")
        await app.click('.form >> text=保存')
        await app.wait_for_timeout(400)
        edited = next(t for t in await stored("suishou.tasks") if t["project"] == "论文")
        expect(edited["title"] == "交论文初稿（含图表）" and edited["priority"] == 2, f"task edited: {edited['title']}")

        await open_section("library")
        await app.fill('input[type="search"]', "业务规则")
        await app.wait_for_timeout(200)
        expect(await app.locator(".hl").count() == 1, "search narrows the library")
        await app.fill('input[type="search"]', "")
        await app.click('button.chip:has-text("#排程")')
        await app.wait_for_timeout(300)
        expect(await app.locator(".hl").count() == 1, "tag filter")

        await open_section("week")
        expect(await app.locator(".tile b >> nth=0").inner_text() == "3", "weekly digest counts the saves")
        expect(await app.locator('h2:has-text("#排程")').count() == 1, "digest groups by tag")
        expect(await app.locator('h2:has-text("完成的待办")').count() == 1, "digest lists finished tasks")
        await open_section("month")
        expect(await app.locator(".bars .bar").count() >= 28, "monthly bars, one per day")

        # Daily review: age the saves by two days, then grade one of each kind.
        await worker.evaluate(
            """async () => {
              const key = 'suishou.highlights';
              const data = (await chrome.storage.local.get(key))[key];
              for (const h of data) h.createdAt = new Date(Date.now() - 2 * 86400000).toISOString();
              await chrome.storage.local.set({[key]: data});
            }"""
        )
        await open_section("review")
        expect("第 1 / 3 条" in await app.inner_text("#view"), "three passages are due")
        for label in ["还有用", "没印象了", "已经吸收"]:
            await app.click(f'.review-actions button:has-text("{label}")')
            await app.wait_for_timeout(350)
        expect("看完了" in await app.inner_text("#view"), "review session ends")
        review = sorted((h["review"]["box"], h["review"]["retired"]) for h in await stored("suishou.highlights"))
        expect(review == [(0, False), (0, True), (1, False)], f"grades recorded: {review}")

        await open_section("settings")
        await app.fill('.setting input[type="number"]', "8")
        await app.keyboard.press("Tab")
        await app.wait_for_timeout(300)
        settings = (await worker.evaluate("chrome.storage.local.get('suishou.settings')"))["suishou.settings"]
        expect(settings["dailyReviewLimit"] == 8, "setting saved")

        for name in ["today", "inbox", "done"]:
            await open_section(name)
        expect(not errors, f"no script errors: {errors}")
        await context.close()
    server.shutdown()
    print(json.dumps({"checks": checks, "result": "ok"}))


asyncio.run(main())
