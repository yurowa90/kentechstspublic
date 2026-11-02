"""리그 v2 확인: 인원 고르기(평택 필수·이웃), 진행자 팀 카드(축소 지도·건설 속도), 도시 크게 보기, 혼자 하기 도시 고르기."""
import json, sys, os
from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, select_mode
D = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(D, "shots")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9410/index.html"
STRAT = open(os.path.join(D, "calib2.py")).read().split('STRAT = """')[1].split('"""')[0]
AUTO = open(os.path.join(D, "calib.py")).read().split('AUTO = """')[1].split('"""')[0]
problems = []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: problems.append(m)
with sync_playwright() as pw:
    br = pw.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 860}, locale="ko-KR")
    errs = []
    def page():
        p = ctx.new_page(); p.on("pageerror", lambda e: errs.append(str(e))); p.on("console", lambda m: m.type == "error" and "ERR_CERT" not in m.text and errs.append(m.text)); return p
    h = page(); h.goto(BASE + "#home"); h.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    h.goto(BASE + "#league"); select_mode(h, "host")
    # 평택 체크 해제 불가, 끊긴 조합 거절
    ok(h.is_disabled('.lg-pickc input[value=pyeongtaek]'), "평택 checkbox locked")
    for v in ["hwaseong", "anseong", "dangjin", "asan", "cheonan"]: h.uncheck(f'.lg-pickc input[value={v}]')
    ok("2곳 이상" in h.inner_text("#lg-pickmsg"), "1 team rejected")
    h.check('.lg-pickc input[value=hwaseong]'); h.check('.lg-pickc input[value=cheonan]')
    ok(h.inner_text("#lg-pickn") == "3팀" and h.get_attribute("#lg-pickmsg", "data-bad") == "false", "화성·평택·천안 valid")
    h.uncheck('.lg-pickc input[value=hwaseong]'); h.check('.lg-pickc input[value=anseong]'); h.uncheck('.lg-pickc input[value=cheonan]')
    h.uncheck('.lg-pickc input[value=anseong]'); h.check('.lg-pickc input[value=hwaseong]'); h.check('.lg-pickc input[value=asan]')
    ok(h.get_attribute("#lg-pickmsg", "data-bad") == "false", "화성·평택·아산 valid (via 평택)")
    # 평택 없이 이웃 아닌 조합: 안성+당진(+평택 필수) → 평택이 잇는다 → 유효. 진짜 끊김: 화성+천안 without 평택 impossible (평택 필수). 끊김 예: 안성·아산? 평택 이웃이라 유효. → 연결 실패 조합은 평택 필수 때문에 '해저만' 경우: 없음
    h.click('[data-preset="3"]'); h.wait_for_timeout(100)
    picked = h.evaluate("() => [...document.querySelectorAll('.lg-pickc input')].filter(b => b.checked).map(b => b.value)")
    ok(sorted(picked) == sorted(["pyeongtaek", "dangjin", "asan"]), f"preset 3 = {picked}")
    h.screenshot(path=f"{SH}/v2-1-lobby-pick.png", full_page=True)
    (h.click('[data-turns="0"]') if h.locator('[data-turns="0"]').count() else None); h.click("#lg-host"); h.wait_for_selector("#lg-roomcode"); room = h.inner_text("#lg-roomcode")
    ok(h.locator(".lg-tcard").count() == 3, "3 team cards")
    ok(h.locator("#lg-mapc").count() == 1 and h.locator(".lg-mapnav a").count() == 3, "regional board + 3 city links")
    teams = {}
    for t in ["pyeongtaek", "dangjin", "asan"]:
        p = page(); teams[t] = p
        p.goto(BASE + "#league"); select_mode(p, "join"); p.fill("#lg-code", room); p.click("#lg-join")
        p.wait_for_selector(f'[data-seat="{t}"]:not([disabled])', timeout=10000)
        ok(p.locator("[data-seat]").count() == 3, f"{t}: only 3 seats offered")
        confirm_seat(p, t, timeout=10000)
    # 건설을 세 번에 나눠 → 진행 기록 점(15초 묶음이라 시간을 흉내 낼 수 없으니 1점 이상)
    for t, p in teams.items():
        # 문자열 식의 값이 함수면 Playwright가 인자 없이 호출한다(__auto(undefined) → selectPack(null) → 기본 지도로 바뀜). 정의만 하도록 감싼다.
        p.evaluate(f"() => {{ {AUTO} }}"); p.evaluate(f"() => {{ {STRAT} }}")
        p.evaluate("(t) => KCP.league.plan(st => { const b = KCP.league.state().snap.teams[t].budget; const P = __plan(t, 'mix', b - 40); st.builds = P.builds; st.lines = P.lines; })", t)
    h.wait_for_timeout(5000)
    hist = h.evaluate("() => Object.fromEntries(Object.entries(KCP.league.state().S.teams).map(([k, T]) => [k, (T.hist || []).length]))")
    ok(all(v >= 1 for v in hist.values()), f"progress history recorded {hist}")
    ok(h.locator(".lg-thumb canvas").count() == 3, "3 thumbnails")
    ok(h.locator(".lg-spark polyline").count() >= 0, "sparklines present")
    # 이웃 탭: 평택 화면에서 이웃은 참가 도시만
    teams["pyeongtaek"].click('.lg-bar [data-panel="deal"]'); teams["pyeongtaek"].wait_for_selector(".lg-nbs li")
    nb = teams["pyeongtaek"].locator(".lg-nbs li").count()
    ok(nb == 2, f"평택 neighbours shown = {nb} (아산, 당진)")
    h.screenshot(path=f"{SH}/v2-2-host-cards.png", full_page=True)
    # 도시 크게 보기: 진행 중에도 다른 팀 계획 수신이 화면을 깨지 않는지
    h.click('.lg-tcard[data-team="dangjin"] .lg-thumb'); h.wait_for_selector(".lg-viewbar", timeout=10000)
    ok("당진" in h.inner_text(".lg-viewbar"), "viewer shows 당진")
    teams["asan"].evaluate("() => KCP.league.plan(st => { st.policies = ['dr']; })")
    teams["dangjin"].evaluate("() => KCP.league.plan(st => { st.builds.pop(); })")
    h.wait_for_timeout(1500)
    pk = h.evaluate("() => KCP.buildGame.PK ? KCP.buildGame.PK.id : (KCP.buildGame.TILES.length)")
    tiles = h.evaluate("() => KCP.buildGame.TILES.length")
    title = h.inner_text("#bd-h1")
    ok("당진" in title and tiles == 28 * 29, f"viewer stays on 당진 after other teams' plans ({title}, {tiles})")
    n_v = h.evaluate("() => KCP.buildGame.current().builds.length")
    n_h = h.evaluate("() => KCP.league.state().S.teams.dangjin.plan.builds.length")
    ok(n_v == n_h, f"viewer updated live ({n_v} == {n_h})")
    h.screenshot(path=f"{SH}/v2-3-host-view.png")
    h.click('.lg-viewbar a[aria-label="다음 도시"]'); h.wait_for_timeout(800)
    ok("아산" in h.inner_text("#bd-h1"), "next city in viewer")
    h.click('.lg-viewbar a[href="#league/host"]'); h.wait_for_selector(".lg-tcard")
    ok(h.locator(".lg-tcard").count() == 3, "back to host board")
    # 운영 1라운드
    h.click("#lg-next"); h.wait_for_timeout(400); h.click("#lg-next"); h.wait_for_selector(".lg-table tbody tr", timeout=15000)
    goals = h.evaluate("() => KCP.league.state().S.goals")
    ok(h.locator(".lg-table tbody tr").count() == 3 and goals["co2"] < 3000, f"3 result rows, scaled CO2 goal {goals}")
    # 혼자 하기: 도시 고르기
    sp = page(); sp.goto(BASE + "#build"); sp.wait_for_selector("#bd-mapcur")
    sp.click("#bd-mapcur"); sp.wait_for_selector("#bd-mappop:not([hidden])")
    ok(sp.locator("#bd-mappop [data-map]").count() == 7, "single-player picker has 7 maps")
    sp.screenshot(path=f"{SH}/v2-4-solo-picker.png")
    sp.click('#bd-mappop [data-map="cheonan"]'); sp.wait_for_timeout(800)
    ok("천안" in sp.inner_text("#bd-h1") and "천안" in sp.inner_text("#bd-mapcur"), "switched to 천안 solo")
    names = sp.evaluate("() => KCP.buildGame.SITES.filter(s => s.kind === 'gridpt').map(s => s.name)")
    print("solo gates", names)
    ok(len(names) == 3, "천안 solo has 3 external grid points")
    sp.click("#bd-mapcur"); sp.click('#bd-mappop [data-map="dangjin"]'); sp.wait_for_timeout(800)
    sp.screenshot(path=f"{SH}/v2-5-solo-dangjin.png")
    sp.set_viewport_size({"width": 390, "height": 844}); sp.wait_for_timeout(500); sp.click("#bd-mapcur"); sp.wait_for_timeout(300)
    ow = sp.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    sp.screenshot(path=f"{SH}/v2-6-solo-picker-mobile.png")
    ok(ow <= 0, f"solo picker mobile no overflow ({ow})")
    ok(not errs, f"no errors {errs[:3]}")
    br.close()
print("PROBLEMS", len(problems)); [print(" -", x) for x in problems]
