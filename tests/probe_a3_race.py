"""probe A3 '덱 위치 저장 = None' 증상 재현(검사 읽기 경합).

가설: 10-13 실패 당시 _state는 파이썬 쪽 400ms 대기 뒤 곧바로 localStorage를 읽었다(2d949a5).
페이지의 250ms 저장 타이머는 렌더러 시계라서, 클릭 직후 긴 작업이 250ms 마감을 넘겨
400ms 이후까지 이어지면, 끝난 순간 대기 중인 '저장 타이머'와 '검사의 읽기(Runtime.evaluate)'
중 무엇이 먼저 도는지가 스케줄러에 달린다. 읽기가 먼저면 None.

방법: 덱 넘김 클릭 직후 페이지에 setTimeout(0)으로 STALL ms짜리 바쁜 반복을 건다
(저장 타이머보다 먼저 예약되므로 타이머 마감 전에 시작해 마감을 넘긴다).
  old  = 10-13 방식(400ms 고정 대기 후 읽기)
  new  = 지금 방식(wait_saved 조건 대기 + 페이지 300ms 타이머)
기대: old에서 None이 나오고 new에서는 항상 1. STALL 0(대조군)은 둘 다 1.
이것은 '이 경합으로 같은 증상이 난다'는 재현이며, 10-13 실패 로그로 원인을 확정한 것은 아니다.
결과 기록: docs/QUALITY-stability.md §4.
사용: tests/.venv/bin/python tests/probe_a3_race.py http://127.0.0.1:10060/index.html [회수] [STALL]
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 10
STALL = int(sys.argv[3]) if len(sys.argv) > 3 else 500
KEY = "kcp:v1:2022"


def card(page):
    raw = page.evaluate(f"localStorage.getItem({json.dumps(KEY)})")
    st = json.loads(raw) if raw else {}
    return ((st.get("ext") or {}).get("probe") or {}).get("22-q1", {}).get("card")


def old_read(page):
    page.wait_for_timeout(400)
    return card(page)


def new_read(page):
    page.wait_for_timeout(400)
    try:
        page.wait_for_function("() => KCP.savePending() === 0", timeout=3000, polling=50)
    except Exception:
        pass
    page.evaluate("() => new Promise(r => setTimeout(r, 300))")
    return card(page)


def once(browser, mode):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + "#y2022")
    page.wait_for_selector('[data-phase="room"]')
    page.click('[data-phase="room"]')
    page.wait_for_selector('#pb-speak-0 .speak-go')
    page.click('[data-pb-open="0"]')
    page.wait_for_selector('#pb-box-0 .pb-card', state="visible")
    # 클릭 처리기(저장 예약)보다 먼저 바쁜 반복을 예약해 두면 처리기 → setTimeout(0) 반복 → 타이머 순서가 된다.
    page.evaluate("""stall => {
      document.querySelector('[data-pb-next="0"]').addEventListener('click', () => {
        setTimeout(() => { const t = performance.now(); while (performance.now() - t < stall) {} }, 0);
      }, { capture: true, once: true });
    }""", STALL)
    page.click('[data-pb-next="0"]')
    got = old_read(page) if mode == "old" else new_read(page)
    ctx.close()
    return got, errors


with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ("old", "new"):
        res = [once(b, mode) for _ in range(N)]
        vals = [r[0] for r in res]
        errs = sum(len(r[1]) for r in res)
        print(mode, "STALL", STALL, "card values:", vals, "None:", vals.count(None), "pageerrors:", errs)
    b.close()
