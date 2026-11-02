"""온라인(Supabase Realtime 규약) 연결 검사: 가짜 Phoenix 서버 + 서로 다른 브라우저 컨텍스트 3개(진행자, 평택, 천안)."""
import json, sys, subprocess, time, urllib.request, os, socket
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright, expect
from league_flow import confirm_seat, select_mode
D = os.path.dirname(os.path.abspath(__file__))
# 주소 인자를 생략하면 페이지 서버는 KCP_PORT_BASE+0이다. run.sh와 같은 base로 동시에 돌리지 않는다.
# +19는 run.sh 묶음 17개(base..base+16) 밖이다. 묶음이 늘면 오프셋도 늘린다.
PORT_BASE = int(os.environ["KCP_PORT_BASE"]) if "KCP_PORT_BASE" in os.environ else None
MOCK_PORT = int(os.environ["KCP_MOCK_PORT"]) if "KCP_MOCK_PORT" in os.environ else (PORT_BASE + 19 if PORT_BASE is not None else 9310)
BASE = sys.argv[1] if len(sys.argv) > 1 else f"http://127.0.0.1:{PORT_BASE if PORT_BASE is not None else 9400}/index.html"
WS = f"ws://127.0.0.1:{MOCK_PORT}/realtime/v1/websocket"

def port_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0

if not port_free(MOCK_PORT):
    raise SystemExit(f"가짜 Realtime 포트 {MOCK_PORT}가 이미 쓰이는 중: 남은 서버에 붙지 않도록 멈춘다")

def wait_port(process, port, timeout=10):
    """서버가 포트를 열 때까지 기다리되 조기 종료와 대기 한도를 확인한다."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"가짜 Realtime 서버 종료: {process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=min(0.2, max(0.001, deadline - time.monotonic()))):
                return
        except OSError:
            time.sleep(min(0.05, max(0, deadline - time.monotonic())))
    raise TimeoutError(f"가짜 Realtime 서버 포트 {port}: {timeout}초 안에 열리지 않음")

srv = subprocess.Popen(["node", os.path.join(D, "mockrt.js"), str(MOCK_PORT)], stdout=subprocess.PIPE)
srv2 = None
problems = []
def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: problems.append(m)
try:
    wait_port(srv, MOCK_PORT)
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        errs = []
        def ctxpage():
            c = br.new_context(viewport={"width": 1280, "height": 800}, locale="ko-KR"); p = c.new_page()
            p.on("pageerror", lambda e: errs.append(str(e))); p.on("console", lambda m: m.type in ("error", "warning") and "ERR_CERT" not in m.text and errs.append(m.text))
            return p
        def online(p, mode):
            p.goto(BASE + "#league"); select_mode(p, mode)
            p.click(".lg-net summary") if not p.locator(".lg-net[open]").count() else None
            p.check('input[name=lg-net][value=supabase]'); p.fill("#lg-url", WS); p.fill("#lg-key", "sb_publishable_test_key")
        host = ctxpage(); online(host, "host")
        # 연계선 수입 > 0을 단언하려면 판을 고정해야 한다. 기본 로비는 6개 도시·'방마다 다르게' 씨앗이라
        # 방 코드(무작위)마다 1월 사건이 달라지고, 반도체 증설·RE100 사건이 겹치면 보내는 쪽 도시에 남는 시간대가 없어
        # 수입 0이 정상 결과다(무작위 방 100개 중 15개, 6개 도시 고정 씨앗은 매번 0 — 2026-10-13 Node·브라우저 재현).
        # 그래서 연계선을 놓는 두 도시만 참가시키고 씨앗을 고정한다(두 도시·고정 씨앗 Node 재현 5/5 수입 10.58MWh).
        keep = {"pyeongtaek", "cheonan"}
        boxes = host.locator(".lg-pickc input.lg-chipcheck")
        for i in range(boxes.count()):
            box = boxes.nth(i)
            if not box.is_disabled():
                box.set_checked(box.get_attribute("value") in keep)
        host.locator("#lg-host-seed").select_option("fixed")
        # 비밀 키는 거절
        host.fill("#lg-key", "sb_secret_abc"); host.click("#lg-host"); host.wait_for_timeout(200)
        ok("비밀 키" in host.inner_text("#lg-err"), "secret key rejected")
        host.fill("#lg-key", "sb_publishable_test_key")
        host.click("#lg-host"); host.wait_for_selector("#lg-roomcode")
        host.wait_for_function("() => document.getElementById('lg-conn').dataset.s === 'open'", timeout=8000)
        room = host.inner_text("#lg-roomcode")
        link = host.evaluate("() => { let t; const o = navigator.clipboard; return null; }")
        teams = {}
        for t in ["pyeongtaek", "cheonan"]:
            p = ctxpage(); teams[t] = p
            if t == "cheonan":
                # 참가 링크로 들어오기(연결 설정이 링크에 담긴다)
                url = host.evaluate("() => { const L = KCP.league.state(); return null; }")
                jl = host.evaluate("""() => { const s = JSON.parse(localStorage.getItem('kcp-league-host-v1')); const n = {kind:'supabase', url: s.net.url, key: s.net.key};
                   const b = btoa(unescape(encodeURIComponent(JSON.stringify({r: s.room, n})))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); return location.pathname + '#league/j=' + b; }""")
                p.goto(urljoin(BASE, jl)); p.wait_for_selector("#lg-code")
                ok(p.input_value("#lg-code") == room and p.is_checked('input[name=lg-net][value=supabase]'), "join link pre-fills room and online settings")
            else:
                online(p, "join"); p.fill("#lg-code", room)
            p.click("#lg-join")
            confirm_seat(p, t, timeout=10000)
        host.wait_for_timeout(1500)
        ok(host.evaluate("() => Object.values(KCP.league.state().S.teams).filter(T => T.token).length") == 2, "2 seats over websocket")
        # 계획 1개 + 연계선
        teams["cheonan"].evaluate("() => KCP.league.plan(st => { const BG = KCP.buildGame; const s = BG.SITES; const g = s.find(x => x.kind === 'gridpt' && x.to.includes('pyeongtaek')); const town = s.find(x => x.kind === 'city_l'); st.lines.push({ p: BG.routePath(town.tile, g.tile) }); })")
        teams["pyeongtaek"].evaluate("() => KCP.league.plan(st => { const BG = KCP.buildGame; const s = BG.SITES; const g = s.find(x => x.kind === 'gridpt' && x.to.includes('cheonan')); const lng = s.find(x => x.kind === 'plant'); st.lines.push({ p: BG.routePath(lng.tile, g.tile) }); const d = s.find(x => x.id === 'DOWN'); st.lines.push({ p: BG.routePath(lng.tile, d.tile) }); })")
        teams["pyeongtaek"].click('.lg-bar [data-panel="deal"]'); teams["pyeongtaek"].click('[data-tie="propose"][data-other="cheonan"][data-cap="2"]')
        teams["cheonan"].wait_for_selector("#lg-badge:not([hidden])", timeout=8000)
        teams["cheonan"].click('.lg-bar [data-panel="deal"]'); teams["cheonan"].click('[data-tie="accept"][data-other="pyeongtaek"]')
        host.wait_for_timeout(1500)
        ok(host.evaluate("() => KCP.league.state().S.ties.filter(T => T.st === 'built').length") == 1, "tie built over websocket")
        host.click("#lg-next"); host.wait_for_timeout(500); host.click("#lg-next")
        teams["cheonan"].wait_for_selector("#lg-result-heading", timeout=10000)
        imp = host.evaluate("() => { const S = KCP.league.state().S; return S.results[0].team.cheonan.imp; }")
        ok(imp > 0, f"cheonan imported over tie ({imp} MWh)")
        # D-75: 팀 서명 요청을 mockrt로 보내 실제 진행자 상태와 렌더링을 대조.
        # 자동 판정·한 달 한 번 보고는 d75.js의 실제 팀 함수 VM 검사에서 담당한다.
        box = host.locator("#lg-host-verdicts")
        active = host.evaluate("() => KCP.league.state().S.active")
        expect(box).to_be_visible()
        expect(box.locator("h2")).to_have_text(f"약속 판정: 같음 0팀 · 다름 0팀 · 미보고 {len(active)}팀")
        expected = {"pyeongtaek": True, "cheonan": False}
        for tid, hit in expected.items():
            teams[tid].evaluate("""async hit => {
                const N = KCP.leagueNet, V = KCP.league.state().snap;
                const saved = JSON.parse(sessionStorage.getItem('kcp-league-tab-v1'));
                const wire = await N.signEnvelope(saved.identity, saved.team, {
                    type:'verdict', round:V.round, hit, sid:V.sid,
                    seat:V.teams[saved.team].seatVersion, rd:V.round, ph:V.phase,
                    id:'d75-browser-' + saved.team
                });
                sessionStorage.setItem('kcp-league-tab-v1', JSON.stringify(saved));
                const conn = N.open({...saved.net, room:saved.room});
                window.d75FixtureConnection = conn;
                conn.send('req', wire);
            }""", hit)
            try:
                host.wait_for_function("""([id, hit]) => {
                    const S = KCP.league.state().S;
                    return S.teams[id].verdicts?.[S.round] === hit;
                }""", arg=[tid, hit], timeout=10000)
            finally:
                teams[tid].evaluate("() => window.d75FixtureConnection.close()")
        actual = host.evaluate("""() => {
            const S = KCP.league.state().S;
            return Object.fromEntries(S.active.map(id => [id, S.teams[id].verdicts?.[S.round] ?? null]));
        }""")
        ok(all(actual[tid] is hit for tid, hit in expected.items()), "D75 accepted team verdicts true/false")
        same = sum(v is True for v in actual.values())
        different = sum(v is False for v in actual.values())
        pending = sum(v is None for v in actual.values())
        expect(box.locator("h2")).to_have_text(f"약속 판정: 같음 {same}팀 · 다름 {different}팀 · 미보고 {pending}팀")
        expect(box.locator(".lg-hint")).to_be_visible()
        expect(box.locator(".lg-hint")).to_contain_text("점수에 들어가지 않아요")
        expect(box.locator(".lg-verdict-chip")).to_have_count(len(active))
        for kind, count in (("same", same), ("different", different), ("pending", pending)):
            expect(box.locator(f'[data-verdict="{kind}"]')).to_have_count(count)
        names = host.evaluate("() => KCP.LEAGUE_REGIONS[KCP.league.state().S.region].teams")
        for city in names:
            if city["id"] in actual:
                value = actual[city["id"]]
                label = "같음" if value is True else "다름" if value is False else "미보고"
                expect(box.get_by_text(f'{city["name"]} · {label}', exact=True)).to_be_visible()
        ok(True, "D75 summary, every team chip and no-score notice match accepted state")
        stats = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{MOCK_PORT}/stats").read())
        print("mock stats", {k: v for k, v in stats.items() if k != "keys"}, set(stats["keys"]))
        ok(stats["joins"] >= 3 and stats["badJoin"] == 0 and stats["broadcasts"] > 5, "protocol: joins ok, broadcasts relayed")
        # 서버 재시작 → 다시 연결
        # 검사가 일부러 서버를 끈 뒤에는 재연결 시도가 '연결 거부' 콘솔 오류를 남길 수 있다(재시도 시점에 따라 있고 없음).
        # 이 구간의 가짜 서버 주소 연결 거부만 정상으로 보고, 그 밖의 오류와 끄기 전 오류는 모두 실패로 센다.
        outage_from = len(errs)
        srv.kill(); srv.wait(); time.sleep(0.5)
        host.wait_for_function("() => document.getElementById('lg-conn').dataset.s !== 'open'", timeout=8000)
        ok(True, "host notices disconnect")
        srv2 = subprocess.Popen(["node", os.path.join(D, "mockrt.js"), str(MOCK_PORT)], stdout=subprocess.PIPE)
        wait_port(srv2, MOCK_PORT)
        host.wait_for_function("() => document.getElementById('lg-conn').dataset.s === 'open'", timeout=20000)
        teams["cheonan"].wait_for_function("() => document.getElementById('lg-conn').dataset.s === 'open'", timeout=20000)
        ok(True, "reconnect after server restart")
        host.click("#lg-next"); teams["cheonan"].wait_for_function("() => KCP.league.state().snap.round === 2", timeout=10000)
        ok(True, "state flows after reconnect")
        expect(host.locator("#lg-host-verdicts")).to_be_hidden()
        ok(host.evaluate("""() => Object.values(KCP.leagueCore.publicView(
            KCP.league.state().S, Date.now()).teams).every(t => !t.verdicts)"""),
           "D75 next plan hides previous month's verdicts")
        srv2.kill()
        expected = lambda e: f"127.0.0.1:{MOCK_PORT}/realtime" in e and "ERR_CONNECTION_REFUSED" in e
        bad = errs[:outage_from] + [e for e in errs[outage_from:] if not expected(e)]
        print("의도한 정전 구간의 연결 거부", len(errs) - len(bad))
        ok(not bad, f"no errors {bad[:3]}")
        br.close()
finally:
    try: srv.kill()
    except Exception: pass
    if srv2 is not None:
        try: srv2.kill()
        except Exception: pass
print("PROBLEMS", len(problems))
print(f"problems: {len(problems)}")
sys.exit(1 if problems else 0)
