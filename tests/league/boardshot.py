from playwright.sync_api import sync_playwright
from league_flow import select_mode
with sync_playwright() as pw:
    br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 1280, "height": 900}, locale="ko-KR")
    pg.goto("http://127.0.0.1:9410/index.html#home"); pg.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    pg.goto("http://127.0.0.1:9410/index.html#league"); select_mode(pg, "host")
    (pg.click('[data-turns="0"]') if pg.locator('[data-turns="0"]').count() else None); pg.click("#lg-host"); pg.wait_for_selector("#lg-mapc"); pg.wait_for_timeout(600)
    pg.locator("#lg-mapc").screenshot(path="shots/region-board.png")
    br.close()
print("ok")
