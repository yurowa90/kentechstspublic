"""리그 e2e: 진행자 1 + 팀 6 (같은 브라우저 컨텍스트, 탭끼리 연결). 2라운드 운영까지."""
import json, sys, os, time
from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, pass_issue_check, select_mode
D = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(D, "shots")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9400/index.html"
SCHEME = sys.argv[2] if len(sys.argv) > 2 else "light"
TEAMS = ["pyeongtaek", "hwaseong", "anseong", "dangjin", "asan", "cheonan"]
STRAT = open(os.path.join(D, "calib2.py")).read().split('STRAT = """')[1].split('"""')[0]
AUTO = open(os.path.join(D, "calib.py")).read().split('AUTO = """')[1].split('"""')[0]
problems = []
def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: problems.append(msg)
with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 800}, locale="ko-KR", color_scheme=SCHEME)
    ctx.add_init_script("try{ if(!sessionStorage.getItem('__init')){ sessionStorage.setItem('__init','1'); } }catch(e){}")
    errs = {}
    def page(name):
        pg = ctx.new_page(); errs[name] = []
        pg.on("pageerror", lambda e: errs[name].append("PAGEERROR " + str(e)))
        pg.on("console", lambda m: m.type == "error" and "ERR_CERT_AUTHORITY_INVALID" not in m.text and errs[name].append("CONSOLE " + m.text))
        return pg
    host = page("host")
    host.goto(BASE + "#home"); host.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    host.goto(BASE + "#league"); select_mode(host, "host")
    host.screenshot(path=f"{SH}/{SCHEME}-1-lobby.png", full_page=True)
    ok(host.locator(".bd-home-link").count() == 0, "lobby rendered (no home hero)")
    (host.click('[data-turns="0"]') if host.locator('[data-turns="0"]').count() else None); host.click("#lg-host"); host.wait_for_selector("#lg-roomcode")
    room = host.inner_text("#lg-roomcode"); print("room", room)
    ok(len(room) == 9 and room[4] == "-", "room code 8 chars in 4-4 format")
    tp = {}
    for i, t in enumerate(TEAMS):
        pg = page(t); tp[t] = pg
        pg.goto(BASE + "#league"); select_mode(pg, "join")
        pg.fill("#lg-code", room.lower()); pg.click("#lg-join")
        pg.wait_for_selector(f'[data-seat="{t}"]:not([disabled])', timeout=15000)
        if i == 0: pg.screenshot(path=f"{SH}/{SCHEME}-2-seats.png")
        confirm_seat(pg, t)
    host.wait_for_timeout(1500)
    seated = host.evaluate("() => Object.values(KCP.league.state().S.teams).filter(T => T.token).length")
    ok(seated == 6, f"6 seats claimed ({seated})")
    # 다른 팀 자리 빼앗기 시도: 7번째 탭이 평택을 고르려 하면 막힌다
    intr = page("intruder"); intr.goto(BASE + "#league"); select_mode(intr, "join"); intr.fill("#lg-code", room); intr.click("#lg-join")
    intr.wait_for_selector("[data-seat]")
    intr.wait_for_function("() => [...document.querySelectorAll('[data-seat]')].every(b => b.disabled && b.textContent.includes('다른 팀이 맡음'))")
    ok(intr.locator('[data-seat]:not([disabled])').count() == 0, "all seats shown as taken to a 7th device")
    ok(intr.locator('#lg-seat-confirm').is_disabled(), "7th device cannot confirm a taken seat")
    intr.close()
    # 천안: 화면 조작으로 지붕 태양광 1기
    ch = tp["cheonan"]
    ch.click('[data-group="ren"]'); ch.click('[data-tool="roof"]')
    xy = ch.evaluate("() => { const T = KCP.buildGame.TILES.find(t => t.t === 'urban' && t.site < 0); return [KCP.buildGame.tileXY(T.c, T.r), T.c, T.r]; }")
    if not xy[0]:
        xy = ch.evaluate("() => { const T = KCP.buildGame.TILES.find(t => t.t === 'urban' && t.site >= 0); return [KCP.buildGame.tileXY(T.c, T.r), T.c, T.r]; }")
    ch.mouse.click(*xy[0]); ch.wait_for_timeout(300)
    if ch.locator("#bd-confirm:not([hidden]) button").count():
        ch.locator("#bd-confirm:not([hidden]) button").first.click()
    ch.wait_for_timeout(1200)
    hb = host.evaluate("() => (KCP.league.state().S.teams.cheonan.plan || {builds: []}).builds.length")
    ok(hb >= 1, f"UI build reached host plan ({hb})")
    # 나머지 계획은 코드로(같은 길: rev → 진행자)
    for t, pg in tp.items():
        # 문자열 식의 값이 함수면 Playwright가 인자 없이 호출한다(__auto(undefined) → selectPack(null) → 기본 지도로 바뀜). 정의만 하도록 감싼다.
        pg.evaluate(f"() => {{ {AUTO} }}"); pg.evaluate(f"() => {{ {STRAT} }}")
        done = pg.evaluate("""(t) => KCP.league.plan(st => { const b = KCP.league.state().snap.teams[t].budget; const P = __plan(t, 'mix', b - 45); st.builds = P.builds; st.lines = P.lines; st.missions = ['outage','co2']; })""", t)
        ok(done, f"{t} plan applied")
    host.wait_for_timeout(1500)
    plans = host.evaluate("() => Object.fromEntries(Object.entries(KCP.league.state().S.teams).map(([k, T]) => [k, T.plan ? [T.plan.builds.length, T.plan.lines.length] : null]))")
    print("host plans", plans)
    ok(all(v and v[1] > 0 for v in plans.values()), "all plans on host")
    # 연계선: 당진→아산 4 MW 제안, 아산 수락 (화면 조작)
    dj, asn = tp["dangjin"], tp["asan"]
    dj.click('.lg-bar [data-panel="deal"]'); dj.wait_for_selector('[data-tie="propose"][data-other="asan"][data-cap="4"]')
    dj.click('[data-tie="propose"][data-other="asan"][data-cap="4"]')
    asn.wait_for_selector("#lg-badge:not([hidden])", timeout=8000)
    ok(asn.inner_text("#lg-badge") == "1", "asan sees 1 incoming proposal")
    asn.click('.lg-bar [data-panel="deal"]'); asn.wait_for_selector('[data-tie="accept"][data-other="dangjin"]', timeout=8000)
    asn.screenshot(path=f"{SH}/{SCHEME}-4-team-deal.png")
    asn.click('[data-tie="accept"][data-other="dangjin"]')
    # 나머지 연계선은 요청으로
    pairs = [("pyeongtaek", "cheonan"), ("hwaseong", "pyeongtaek"), ("pyeongtaek", "dangjin"), ("cheonan", "asan"), ("anseong", "pyeongtaek")]
    for a, b in pairs:
        tp[a].evaluate("([b]) => { const s = KCP.league.state(); }", [b])
        tp[a].click('.lg-bar [data-panel="deal"]') if tp[a].locator("#lg-panel[hidden]").count() else None
        tp[a].wait_for_selector(f'[data-tie="propose"][data-other="{b}"][data-cap="4"]', timeout=8000)
        tp[a].click(f'[data-tie="propose"][data-other="{b}"][data-cap="4"]')
        tp[b].wait_for_timeout(600)
        if tp[b].locator("#lg-panel[hidden]").count(): tp[b].click('.lg-bar [data-panel="deal"]')
        tp[b].wait_for_selector(f'[data-tie="accept"][data-other="{a}"]', timeout=8000)
        tp[b].click(f'[data-tie="accept"][data-other="{a}"]')
    host.wait_for_timeout(1500)
    ties = host.evaluate("() => KCP.league.state().S.ties.map(T => T.a + '~' + T.b + ':' + T.st + ':' + T.cap)")
    print("ties", ties)
    ok(sum(1 for x in ties if ":built:" in x) == 6, "6 ties built")
    # 판매 단가: 당진 0.010
    dj.evaluate("() => { const r = document.getElementById('lg-price'); r.value = '0.010'; r.dispatchEvent(new Event('input', {bubbles: true})); r.dispatchEvent(new Event('change', {bubbles: true})); }")
    host.wait_for_timeout(1200)
    ok(abs(host.evaluate("() => KCP.league.state().S.teams.dangjin.price") - 0.01) < 1e-9, "price update reached host")
    for t in TEAMS:
        tp[t].click("#lg-ready")
        pass_issue_check(tp[t])
    host.wait_for_timeout(1500)
    rd = host.evaluate("() => Object.values(KCP.league.state().S.teams).filter(T => T.ready).length")
    ok(rd == 6, f"6 teams ready ({rd})")
    host.screenshot(path=f"{SH}/{SCHEME}-3-host-lobby.png", full_page=True)
    # 1라운드 시작 → 운영
    host.click("#lg-next"); host.wait_for_timeout(800)
    ok(host.evaluate("() => KCP.league.state().S.phase") == "plan", "round 1 plan phase")
    tp["cheonan"].wait_for_timeout(1500)
    ok("계획" in tp["cheonan"].inner_text("#lg-bphase"), "team bar shows plan phase")
    host.click("#lg-next"); host.wait_for_selector(".lg-table tbody tr", timeout=15000)
    res = host.evaluate("() => { const S = KCP.league.state().S; const r = S.results[S.results.length - 1]; return { phase: S.phase, region: r.region, team: Object.fromEntries(Object.entries(r.team).map(([k, v]) => [k, [v.unsPct, v.co2Prod, v.co2Cons, v.imp, v.sub, v.exp, v.unlinked]])), flow: r.flow }; }")
    print(json.dumps(res, ensure_ascii=False))
    ok(res["phase"] == "review", "review phase after run")
    ok(host.locator(".lg-table tbody tr").count() == 6, "6 result rows")
    ok(host.locator(".lg-flowlab").count() >= 1 or int(host.locator("#lg-mapc").get_attribute("data-flows") or 0) >= 1, "flow labels on map")
    host.wait_for_timeout(600)
    host.screenshot(path=f"{SH}/{SCHEME}-5-host-result.png", full_page=True)
    for t in TEAMS:
        tp[t].wait_for_selector(".lg-kpi", timeout=10000)
    ok(True, "all teams got result panel")
    tp["dangjin"].screenshot(path=f"{SH}/{SCHEME}-6-team-result.png")
    ok(tp["asan"].locator("#lg-ready").count() == 1, "ready button exists")
    # 결과 단계에서 짓기 잠금
    locked = tp["asan"].evaluate("() => KCP.league.plan(st => st.builds.pop())")
    ok(locked is False, "building locked in review phase")
    # ECON-UI v1.2: 일지는 서랍 탭 대신 아래 막대에서 연다.
    tp["asan"].click('#lg-bar [data-panel="journal"]'); tp["asan"].fill('[data-j="why"]', "디스플레이 단지 정전을 막으려고 이웃 도시와 4 MW 연계선을 이었다."); tp["asan"].press('[data-j="why"]', "Tab")
    tp["asan"].screenshot(path=f"{SH}/{SCHEME}-7-team-journal.png")
    # 2라운드
    host.click("#lg-next"); host.wait_for_timeout(1000)
    ok(host.evaluate("() => KCP.league.state().S.round") == 2, "round 2")
    ok(tp["hwaseong"].evaluate("() => KCP.league.plan(st => { st.policies = ['dr']; })"), "plan editable in round 2")
    host.wait_for_timeout(1200)
    host.click("#lg-next"); host.wait_for_function("() => KCP.league.state().S.results.length === 2", timeout=15000)
    ok(True, "round 2 results")
    budgets = host.evaluate("() => Object.fromEntries(Object.keys(KCP.league.state().S.teams).map(k => [k, KCP.leagueCore.budget(KCP.league.state().S, k)]))")
    print("budgets r2", budgets)
    # 진행자 새로고침 → 상태 유지
    host.reload(); host.wait_for_selector(".lg-table tbody tr", timeout=10000)
    ok(host.evaluate("() => KCP.league.state().S.results.length") == 2, "host reload keeps state")
    # 팀 새로고침 → 자리 유지(같은 탭)
    tp["anseong"].reload(); tp["anseong"].wait_for_selector("#lg-bar", timeout=15000)
    ok(tp["anseong"].evaluate("() => KCP.league.state().team") == "anseong", "team reload keeps seat")
    # 모바일 팀 화면
    mob = ctx.browser.new_context(viewport={"width": 390, "height": 844}, locale="ko-KR", color_scheme=SCHEME, is_mobile=True, has_touch=True) if False else None
    tp["cheonan"].set_viewport_size({"width": 390, "height": 844}); tp["cheonan"].wait_for_timeout(800)
    tp["cheonan"].click('.lg-bar [data-panel="result"]') if tp["cheonan"].locator("#lg-panel[hidden]").count() else None
    tp["cheonan"].wait_for_timeout(500)
    tp["cheonan"].screenshot(path=f"{SH}/{SCHEME}-8-team-mobile.png")
    ow = tp["cheonan"].evaluate("() => document.documentElement.scrollWidth - innerWidth")
    ok(ow <= 0, f"no horizontal overflow on mobile team ({ow})")
    host.set_viewport_size({"width": 390, "height": 844}); host.wait_for_timeout(600)
    ow = host.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    ok(ow <= 0, f"no horizontal overflow on mobile host ({ow})")
    host.screenshot(path=f"{SH}/{SCHEME}-9-host-mobile.png", full_page=True)
    small = host.evaluate("""() => [...document.querySelectorAll('.lg-host button, .lg-host a')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 36).map(b => b.textContent.trim()).slice(0, 8)""")
    print("small targets host", small)
    for k, v in errs.items():
        ok(not v, f"no console/page errors on {k}: {v[:3]}")
    br.close()
print("PROBLEMS", len(problems)); [print(" -", p) for p in problems]
