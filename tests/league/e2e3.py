"""리그 v3: 사건 예보·대응 버튼, 실제 크기 공개, 연구(대학·연구소) 진척, 철거 회수, 현금 흐름 표시."""
from league_flow import pass_issue_check
import sys, os, re
from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, select_mode
D = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(D, "shots")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9420/index.html"
problems = []
def panel(P, name):
    b = P.locator(f'.lg-bar [data-panel="{name}"]')
    if b.get_attribute("aria-expanded") != "true": b.click()
    P.wait_for_timeout(200)
    if name == "result":
        # 결과 서랍(결과 단계)의 S8 아래 상세는 '이번 달 자세히'(#lg-month-details) 접힘 안에 있다(품질8 UX, 2026-10-21). 먼저 연다.
        for key in ("lg-month-details", "lg-result-reasons", "lg-result-details"):
            detail = P.locator('#' + key)
            if detail.count() and not detail.evaluate('el => el.open'):
                detail.locator(':scope > summary').click()

def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: problems.append(m)
with sync_playwright() as pw:
    os.makedirs(SH, exist_ok=True)
    br = pw.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 860}, locale="ko-KR")
    errs = []
    def page():
        p = ctx.new_page(); p.on("pageerror", lambda e: errs.append(str(e))); p.on("console", lambda m: m.type == "error" and "ERR_CERT" not in m.text and errs.append(m.text)); return p
    def scenario(turns):
        mode = "econ" if turns else "season"
        def check(condition, message):
            ok(condition, f"{mode}: {message}")
        h = page(); h.goto(BASE + "#home"); h.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        h.goto(BASE + "#league"); select_mode(h, "host"); h.click('[data-preset="2"]')
        h.click(f'#lg-mode-host [data-turns="{turns}"]'); h.click("#lg-host"); h.wait_for_selector("#lg-roomcode"); room = h.inner_text("#lg-roomcode")
        tp = {}
        for t in ["pyeongtaek", "dangjin"]:
            p = page(); tp[t] = p
            p.goto(BASE + "#league"); select_mode(p, "join"); p.fill("#lg-code", room); p.click("#lg-join")
            confirm_seat(p, t, timeout=10000)
        P = tp["pyeongtaek"]
        # 내 도시: 태양광·배터리 + 대학·연구소, 연구 순서
        P.evaluate("""() => KCP.league.plan(st => { const BG = KCP.buildGame; const T = BG.TILES; const free = t => T.filter(x => !x.out && x.site < 0 && !BG.siteRule(t, x)).map(x => x.i);
          const s = free('solar'), u = free('uni'); st.builds = [{ t: 'solar', i: s[0] }, { t: 'solar', i: s[1] }, { t: 'battery', i: s[2] }, { t: 'uni', i: u[30] }, { t: 'lab', i: u[50] }]; st.rq = ['bms']; })""")
        h.evaluate("() => KCP.league.next()"); h.wait_for_timeout(500)
        # 사건 강제: 폭염(참가 도시 해당)
        h.evaluate("() => { const S = KCP.league.state().S; S.events = [{ id: 'heatwave_peak', round: S.round, x: 1.3 }]; S.rev++; }")
        h.wait_for_timeout(5000)
        panel(P, "deal"); P.wait_for_selector(".lg-evopt", timeout=10000)
        txt = P.inner_text(".lg-ev")
        check("예보" in txt and "수요 +6~18%" in txt, "forecast range shown (수요 +6~18%)")
        check(P.locator('.lg-evopt[data-resp="none"][aria-pressed="true"]').count() == 1, "default: no response")
        left0 = P.inner_text(".lg-left b")
        P.click('.lg-evopt[data-resp="dr"]'); h.wait_for_timeout(5500)
        resp = h.evaluate("() => KCP.league.state().S.teams.pyeongtaek.resp")
        check(resp and list(resp.values()) == ["dr"], f"host recorded response {resp}")
        panel(P, "deal"); P.wait_for_selector(".lg-left b")
        left1 = P.inner_text(".lg-left b")
        check(left0 != left1, f"budget left changed {left0} → {left1}")
        P.click('#lg-ready')
        pass_issue_check(P)
        if turns:
            P.wait_for_selector('#lg-predict', timeout=10000)
            check(P.locator('#lg-evidence').count() == 1, "event response opens criterion / evidence gate")
            check(P.locator('[data-confidence]').count() == 3 and P.locator('[data-pred]').count() == 1,
                  "U8 one topic and three verbal confidence choices")
            check(P.locator('#lg-ready-confirm').is_disabled(), "U8 no promise without evidence")
            check(P.locator('#lg-predict-skip').count() == 0, "team learning loop has no solo skip")
        else:
            check(P.locator('#lg-predict, #lg-evidence, #lg-predict-skip').count() == 0,
               "season mode has no economic prediction loop")
        check("수요반응 계약" in h.inner_text("#lg-evbox"), "host shows team responses")
        P.screenshot(path=f"{SH}/v3-{mode}-1-team-event.png")
        h.screenshot(path=f"{SH}/v3-{mode}-2-host-event.png", full_page=True)
        # 운영 → 실제 크기 공개, 결과 현금 흐름
        h.evaluate("() => KCP.league.next()"); h.wait_for_timeout(5500)
        panel(P, "result")
        P.wait_for_selector("#lg-result-heading" if turns else "#lg-panel .lg-kpi", timeout=10000)
        rt = P.inner_text(".lg-pbody")
        check("확정" in rt, "confirmed size revealed after run")
        if turns:
            check(P.locator('.lg-ask[data-question="lg-f-event"]').count() == 1, "event month uses lg-f-event")
            check(P.locator('.lg-ask [data-answer]').count() == 2, "event follow-up has revise / keep controls")
            # spec-C §M3: 결과 장부는 도시 서랍의 기타 운영과 구별한다.
            check(all(word in P.inner_text('#lg-result-ledger') for word in
                   ('달 초', '수입', '신규 투자', '연료·운영비', '달 말', '총지출')), "monthly investment / operating cash-flow ledger shown")
        else:
            check(P.locator('.lg-ask, #lg-predict').count() == 0, "season results have no economic question / prediction cards")
            check("새 투자" in rt and "누적 투자" in rt, "cash-flow KPI shown")
        rs = h.evaluate("() => KCP.league.state().S.teams.pyeongtaek.rs")
        need = P.evaluate("() => KCP.TECH_DATA.cards.find(c => c.id === 'bms').need")
        step = P.evaluate("turns => turns ? KCP.TECH_DATA.params.roundSteps.v : KCP.buildGame.RS.roundSteps", turns)
        expected = min(need, step + (need / 3 if 'bms' in (rs or {}).get('eureka', []) else 0))
        check(rs and rs['eff'] == 1 and abs(rs['prog'].get('bms', -1) - expected) < 1e-9,
           f"research progressed in first turn (lab only, including eureka: {expected}) {rs}")
        P.screenshot(path=f"{SH}/v3-{mode}-3-team-result.png")
        # 2라운드: 지난 라운드 태양광 철거 → 손실 표시
        h.evaluate("() => KCP.league.next()"); h.wait_for_timeout(5500)
        P.evaluate("() => KCP.league.plan(st => { st.builds = st.builds.slice(1); })"); h.wait_for_timeout(5500)
        panel(P, "deal"); P.wait_for_selector(".lg-left")
        loss = P.evaluate("""() => {
          const V = KCP.league.state().snap, me = V.teams.pyeongtaek;
          return KCP.leagueCore.lossOf(me.base, me.plan);
        }""")
        check(P.locator('.lg-demolition').count() > 0, "U10 demolition loss is in budget ledger")
        loss_text = P.evaluate("n => n.toLocaleString('ko-KR', {maximumFractionDigits:1})", loss)
        budget_ledger = P.locator('#lg-panel .lg-left, #lg-panel .lg-sec, #lg-fiscal, #lg-result-ledger, [data-cap="budget"], .lg-bmoney').filter(
            has_text=re.compile(r'남은 돈|예산|장부|세입|세출'))
        displayed_losses = [float(match.replace(',', '')) for node in budget_ledger.all() if node.is_visible()
                            for match in re.findall(r'철거 손실\s*([\d,]+(?:\.\d+)?)\s*억', node.inner_text())]
        check(loss > 0 and any(abs(value - loss) < 0.051 for value in displayed_losses),
           f"demolition loss {loss_text}억 shown in budget / ledger")
        P.click(".lg-px") if P.locator(".lg-px").count() else None
        # 연구 서랍(리그)
        panel(P, "tech"); P.wait_for_selector('#lg-tech')
        progress = P.locator('[data-tech-card="bms"] progress')
        check(progress.count() == 1 and abs(float(progress.get_attribute('value')) - expected / need * 100) < 1e-9 and
           '운영을 마친 뒤 인력에 반영' in P.inner_text('#lg-tech'),
           "league research drawer shows host progress and delayed university staffing")
        P.screenshot(path=f"{SH}/v3-{mode}-4-team-research.png")
        for p in [h, *tp.values()]: p.close()
    scenario(0)
    scenario(12)
    ok(not errs, f"no errors {errs[:3]}")
    br.close()
print("PROBLEMS", len(problems))
for p in problems: print(" -", p)
