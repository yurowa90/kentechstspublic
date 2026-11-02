"""docs/ECON-TECH-SPEC.md의 독립 엔진/화면 수용 검사.

실행은 총괄 담당: python tests/league/tech.py http://127.0.0.1:9430/index.html
기대값은 위 명세에만 의존한다. 기존 라우트/상태 API는 검사 연결에만 사용한다.
화면이 없어도 엔진 블록을 실행하며, 실패는 checks N fail M에 합산한다.
기술 0장 결과는 같은 엔진에서 TECH_DATA를 제거한 실행과 비교한다.
"""

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent))
from league_flow import wait_unfolded  # noqa: E402

HELPERS = Path(__file__).with_suffix(".js").read_text(encoding="utf-8")
WAIT = 12000  # 실행기 대기 한도, 게임의 계수가 아님
BOOT = "() => !!(window.KCP?.leagueCore && KCP.buildGame && KCP.econ && KCP.league)"


class Checks:
    def __init__(self):
        self.count = 0
        self.failed = 0

    def ok(self, condition, label):
        self.count += 1
        self.failed += not bool(condition)
        print(("PASS " if condition else "FAIL ") + label, flush=True)
        return bool(condition)

    def test(self, label, fn):
        try:
            return self.ok(bool(fn()), label)
        except Exception as exc:
            return self.ok(False, f"{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")

    def rows(self, rows, prefix):
        for passed, label in rows:
            self.ok(passed, f"{prefix} {label}")

    def finish(self):
        print(f"checks {self.count} fail {self.failed}", flush=True)
        return int(bool(self.failed))


def local_address(argv):
    base = argv[1] if len(argv) > 1 else "http://127.0.0.1:9430/index.html"
    parsed = urlsplit(base)
    if (parsed.scheme not in ("http", "https") or parsed.hostname not in
            ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password):
        raise ValueError("외부 네트워크 금지: loopback 주소만 사용할 수 있습니다")
    return base.split("#", 1)[0]


def browser_context(browser, base, scheme="light", width=1280):
    ctx = browser.new_context(viewport={"width": width, "height": 850},
                              locale="ko-KR", color_scheme=scheme, service_workers="block")
    ctx.set_default_timeout(WAIT)
    ctx.set_default_navigation_timeout(WAIT)
    origin = urlsplit(base)
    external = []

    def route(r):
        parsed = urlsplit(r.request.url)
        if (parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc):
            r.continue_()
        elif parsed.hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
            r.fulfill(status=200, content_type="text/css", body="")
        else:
            external.append(parsed.hostname or parsed.scheme)
            r.abort()

    ctx.route("**/*", route)
    ctx.route_web_socket("**/*", lambda ws: (external.append("websocket"), ws.close()))
    ctx.add_init_script("""(() => {
      const apply = () => { document.documentElement.dataset.theme = %s; };
      if (document.documentElement) apply();
      else document.addEventListener('DOMContentLoaded', apply, {once:true});
    })();""" % json.dumps(scheme))
    return ctx, external


def monitored(ctx, pages, label):
    page = ctx.new_page()
    errors = []
    page.on("console", lambda msg: errors.append("console: " + msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append("pageerror: " + str(err)))
    pages.append((label, errors))
    return page


def install_helpers(page):
    page.add_script_tag(content=HELPERS)


def engine_block(checks, browser, base):
    ctx, external = browser_context(browser, base)
    pages = []
    try:
        page = monitored(ctx, pages, "엔진")
        page.goto(base + "#home")
        page.wait_for_function(BOOT)
        install_helpers(page)
        # 화면 검사와 독립: 화면의 존재나 렌더링 성공을 엔진의 전제로 두지 않는다.
        for suite in ("ruleChecks", "royaltyChecks", "paceChecks"):
            checks.test(f"엔진 블록 {suite}", lambda suite=suite: consume_suite(checks, page, suite))
        checks.test("T5 기술0 회귀: #build·계절·달 모드", lambda: baseline_check(checks, page))
    except Exception as exc:
        checks.ok(False, f"엔진 초기화: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")
    finally:
        for label, errors in pages:
            checks.ok(not errors, f"{label} 콘솔 오류·미처리 예외 0" + (f": {errors[:2]}" if errors else ""))
        checks.ok(not external, "엔진 외부 요청 0")
        ctx.close()


def consume_suite(checks, page, suite):
    rows = page.evaluate("name => KCPTechChecks[name]()", suite)
    checks.rows(rows, "엔진")
    return bool(rows)


ZERO_JS = r"""() => {
  const H = KCPTechChecks, {K, C, BG, R} = H.context();
  // 같은 계획을 TECH_DATA 유/무로 운영한다. 결과 계산식을 검사에 복제하지 않는다.
  function metrics(res) {
    return {tot:res.tot, cost:res.cost, uns:res.unsTotal, hosp:res.hospH,
      dem:Array.from(res.hrDem), outages:Array.from(res.hrUns)};
  }
  BG.selectPack('island', 'build');
  const sandbox = BG.sanitize({builds:[], lines:[], policies:[], missions:[], rq:[], seed:2026}, 1e9);
  const build = metrics(BG.simulate(sandbox, 7));
  const leagues = [];
  for (const turns of [0, 12]) {
    const {S, ids} = H.fixture({turns, staff:true});
    // 연구기관이 있어도 도입·대기열이 0이면 기존 경제/전력 결과를 유지해야 한다.
    const months = turns ? 12 : 4, rows = [];
    for (let m = 0; m < months; m++) {
      const res = H.operate(S);
      rows.push({team:Object.fromEntries(ids.map(id => {
        const t = res.team[id];
        const costKeys = ['capex','ties','loss','rfix','stock','inv','fuel','policy','resp','research','trade','opex','total'];
        return [id, {dem:t.dem, unsPct:t.unsPct, co2Prod:t.co2Prod, co2Cons:t.co2Cons,
          cost:Object.fromEntries(costKeys.map(k=>[k,t.cost[k]])),
          hospH:t.hospH, renPct:t.renPct, imp:t.imp, exp:t.exp, earn:t.earn, pay:t.pay}];
      })), region:res.region, econ:S.econ ? {
        cities:Object.fromEntries(ids.map(id=> {
          const city = S.econ.cities[id], fiscal = res.econ.fiscal[id];
          return [id, {pop:city.pop, ind:city.ind, cash:city.cash, approval:city.approval,
            co2pc:city.co2pc, unsS:city.unsS, debtCap:city.debtCap,
            fiscal:Object.fromEntries(['cashBefore','cashAfter','revTotal','expTotal'].map(k=>[k,fiscal[k]]))}];
        })), score:K.econ.score(S.econ)
      } : null});
    }
    leagues.push({turns, rows, score:S.econ ? K.econ.score(S.econ) : null});
  }
  return {build, leagues};
}"""


def baseline_check(checks, current):
    actual = current.evaluate(ZERO_JS)
    expected = current.evaluate("""source => {
      const data = KCP.TECH_DATA;
      if (!data) throw new Error('T5 양성 대조에 TECH_DATA 필요');
      try {
        delete KCP.TECH_DATA;
        return (0, eval)('(' + source + ')')();
      } finally { KCP.TECH_DATA = data; }
    }""", ZERO_JS)
    checks.ok(actual["build"] == expected["build"], "T5 #build 기술0 결과: 같은 엔진의 TECH_DATA 유/무 동일")
    for i, label in enumerate(("계절 4턴", "달 12턴")):
        checks.ok(actual["leagues"][i] == expected["leagues"][i],
                  f"T5 {label} 기술0 전력·정산·경제·점수: 같은 엔진의 TECH_DATA 유/무 동일")
    return True


SEED_UI = r"""async kind => {
  const H = KCPTechChecks, {K, C, R} = H.context(), {S, ids} = H.fixture({staff:true});
  const [team, other] = ids;
  if (kind === 'adopted') S.teams[team].research = H.research(
    ['grid','hvdc','sic','tandem','bms','nbat','h2store','h2mix','smr']);
  if (kind === 'transfer') {
    S.teams[other].research = H.research(['grid']);
    S.ties = [{...C.tieDef(R, team, other), cap:4, st:'built'}];
    // Same connected internal grid as tech.js fixture; no engine helper export needed.
    for (const [id, peer] of [[team, other], [other, team]]) {
      const BG = K.buildGame; BG.selectPack(id, 'league');
      const gate = BG.SITES.find(s => s.kind === 'gridpt' && (s.to || []).includes(peer));
      const path = gate && BG.routePath(BG.SITES.find(s => s.dem).tile, gate.tile);
      if (!path) throw Error('공동 연구 연결 경로 없음');
      S.teams[id].plan.lines.push({p:path});
    }
    H.request(S, other, ['sic']);
  }
  if (kind === 'completion') {
    const card = H.cardsOf().find(c => c.id === 'grid');
    if (!card) throw new Error('grid 카드 없음');
    H.request(S, team, ['grid']);
    const RS = K.buildGame.RS;
    const step = RS.roundSteps * Math.min(2*RS.labStaff + RS.uniStaff, 2*RS.labSeats);
    S.teams[team].research.prog.grid = Math.max(0, H.number(card.need)-step);
  }
  const N = K.leagueNet, identity = await N.createIdentity(), hostIdentity = await N.createIdentity();
  S.seedKey ??= S.room;
  const binding = await N.hostBinding(hostIdentity.publicKey), room = S.room = binding.room;
  S.sid = N.sessionId();
  S.teams[team].publicKey = identity.publicKey;
  S.teams[team].token = await N.fingerprint(identity.publicKey);
  S.teams[team].lastN = 0;
  const net = {kind:'local'};
  // 날짜 기반 타이머를 검사 fixture의 가상 시각에서 분리한다.
  S.ends = Date.now() + 600000;
  localStorage.setItem('kcp-league-net-v1', JSON.stringify(net));
  localStorage.setItem('kcp-league-host-v1', JSON.stringify({room, net, state:S, identity:hostIdentity, fingerprint:binding.fingerprint}));
  return {team, other, room, net, identity, fingerprint:binding.fingerprint,
    teamName:R.teams.find(t=>t.id===team).name};
}"""


def setup_ui(ctx, base, pages, kind):
    host = monitored(ctx, pages, kind + " 진행자")
    host.goto(base + "#home")
    host.wait_for_function(BOOT)
    install_helpers(host)
    state = host.evaluate(SEED_UI, kind)
    host.goto(base + "#league/host")
    host.wait_for_selector("#lg-roomcode")
    install_helpers(host)
    team = monitored(ctx, pages, kind + " 팀")
    team.goto(base + "#home")
    team.wait_for_function(BOOT)
    team.evaluate("s => sessionStorage.setItem('kcp-league-tab-v1', JSON.stringify(s))", state)
    team.goto(base + "#league/team")
    team.wait_for_selector("#lg-bar")
    install_helpers(team)
    return host, team, state


def open_tech(team):
    # ECON-UI v1.2 · ECON-TECH-SPEC T4: 연구 탐색은 아래 막대 한 곳이다.
    button = team.locator('#lg-bar [data-panel="tech"]')
    if button.count() != 1:
        raise AssertionError('T4 #lg-bar data-panel="tech" 버튼 한 개 필요')
    if button.get_attribute("aria-expanded") != "true":
        button.click()
    # 서랍 머리 줄(.lg-ptabs: 제목·접기·닫기)은 남아 있다. 금지 대상은 탭 버튼이다(econui.py와 같은 기준).
    if team.locator('.lg-ptabs [data-ptab], #lg-panel [data-ptab]').count() != 0:
        raise AssertionError('ECON-UI v1.2 서랍 안 탭 줄은 없어야 함')
    return team.locator("#lg-panel")


def card_detail(team, card_id):
    panel = open_tech(team)
    name = team.evaluate("id => KCPTechChecks.cardsOf().find(c=>c.id===id)?.name", card_id)
    if not name:
        raise AssertionError(f"{card_id} 카드 이름 없음")
    candidates = panel.get_by_text(name, exact=True)
    if not candidates.count():
        raise AssertionError(f"트리 카드 {name} 없음")
    candidates.first.click()
    return panel


def queue_from_ui(host, team, state):
    panel = card_detail(team, "grid")
    panel.get_by_role("button", name="연구 순서에 넣기", exact=True).click()
    host.wait_for_function("id => KCP.league.state().S.teams[id].research?.queue.includes('grid')", arg=state["team"])
    return True


def tool_state(team, name, locked):
    # data-tool은 기존 건설 도구 연결부. 새 기술 화면의 전용 속성은 가정하지 않는다.
    if team.locator("#lg-panel:not([hidden]) [data-pclose]").count():
        team.locator("#lg-panel [data-pclose]").click()
    group = {"탠덤 태양광": "ren", "탠덤 지붕 태양광": "ren", "차세대 배터리": "store", "수소 탱크": "store", "SMR": "thermal"}.get(name)
    # Pack group ids are discovered from the existing base tool, avoiding naming assumptions.
    base = {"ren":"solar", "store":"battery", "thermal":"diesel"}.get(group)
    group_id = team.evaluate("base => {const BG=KCP.buildGame; return BG.PACKS[KCP.league.state().team]?.groups?.find(g=>g.tools.includes(base))?.id;}", base)
    if group_id:
        control = team.locator(f'[data-group="{group_id}"]')
        if control.get_attribute("aria-expanded") != "true": control.click()
    tools = team.locator("[data-tool]").filter(has_text=name)
    if not tools.count():
        return False
    return tools.first.evaluate(r"""(el, locked) => {
      const isLocked = el.disabled || el.getAttribute('aria-disabled') === 'true';
      const label = el.textContent + ' ' + (el.getAttribute('title') || '') + ' ' +
        (el.getAttribute('aria-label') || '');
      const hasLock = /🔒|자물쇠|잠김/.test(label) || !!el.querySelector(
        '[data-icon="lock"], .lock, .locked, svg use[href*="lock"]');
      return locked ? isLocked && /연구\s*필요/.test(label) && hasLock : !isLocked;
    }""", locked)


def title_badge(host, team, state):
    panel = open_tech(team)
    team_badge = panel.get_by_text("그리드 개척자", exact=False)
    row = host.locator(f'[data-team="{state["team"]}"]').filter(has_text="그리드 개척자")
    return (team_badge.count() > 0 and team_badge.first.is_visible() and row.count() > 0 and
            row.first.get_by_text("그리드 개척자", exact=False).count() > 0)


def completion_element(team):
    control = team.locator('#lg-bar [data-panel="result"]')
    if control.get_attribute('aria-expanded') != 'true': control.click()
    return team.evaluate(r"""() => {
      const card = KCPTechChecks.cardsOf().find(c=>c.id==='grid');
      const result = document.querySelector('#lg-panel .lg-pbody');
      if (!result || !card) return null;
      // 카드 전체: 이름·효과·분야·등급을 함께 표시하는 작은 결과 요소를 찾는다.
      const found = [...result.querySelectorAll('*')].find(el => {
        const text = el.textContent;
        return el.getBoundingClientRect().height > 0 && text.length < 1500 &&
          text.includes(card.name) && text.includes(card.field) && text.includes('근거 ' + KCP.gradeWords(card.evidenceGrade)) && text.includes('효과 크기 ' + KCP.gradeWords(card.effectGrade)) &&
          (typeof card.eff !== 'string' || text.includes(card.eff));
      });
      if (!found) return null;
      const nodes = [found, ...found.querySelectorAll('*')];
      const durations = nodes.flatMap(el => getComputedStyle(el).animationDuration
        .split(',').map(v=>parseFloat(v)*1000));
      const animation = nodes.flatMap(el=>el.getAnimations()).map(a=>a.effect.getTiming().duration);
      const top = found.getBoundingClientRect().top - result.getBoundingClientRect().top;
      return {top, durations:[...durations,...animation],
        running:nodes.flatMap(el=>el.getAnimations()).some(a=>a.playState==='running')};
    }""")


def completion_flow(checks, host, team, label, state):
    # 실제 요청→진척→실증→도입을 운영한다. 화면에 카드가 직접 주입된 결과를 쓰지 않는다.
    observed = False
    before = host.evaluate("id => KCP.leagueCore.techOf(KCP.league.state().S, id)", state["team"])
    for month in range(4):
        phase = host.evaluate("() => KCP.league.state().S.phase")
        if phase == "review":
            host.evaluate("() => KCP.league.next()")
            host.wait_for_function("() => KCP.league.state().S.phase === 'plan'")
        previous = host.evaluate("() => KCP.league.state().S.round")
        host.evaluate("() => KCP.league.next()")
        host.wait_for_function("() => KCP.league.state().S.phase === 'review'")
        team.wait_for_function("r => KCP.league.state().snap?.phase==='review' && KCP.league.state().snap.round===r", arg=previous)
        now = host.evaluate("id => KCP.leagueCore.techOf(KCP.league.state().S, id)", state["team"])
        completed = host.evaluate("id => KCP.league.state().S.results.at(-1)?.team[id]?.research?.completed || []", state["team"])
        if "grid" in completed:
            observed = True
            wait_unfolded(team)  # 품질8 UX U10: 폭 760px 이하에서는 재생 동안 결과 서랍이 접혀 있다.
            element = completion_element(team)
            checks.ok(bool(element) and element["top"] <= 100, f"{label} T2 연구 완료 달(다음 달 도입) 결과 맨 위 완료 카드·효과·분야·등급")
            checks.ok(bool(element) and any(abs(d - 800) < 5 for d in element["durations"]),
                      f"{label} T2 완료 연출 0.8초")
            checks.ok("개발" in host.locator("body").inner_text() and
                      "스마트 송전" in host.locator("body").inner_text(), f"{label} T2 진행자 개발 소식")
            team.emulate_media(reduced_motion="reduce")
            reduced = completion_element(team)
            checks.ok(bool(reduced) and not reduced["running"] and
                      all(d == 0 for d in reduced["durations"]), f"{label} T2 reduced-motion 정지")
            break
        before = now
    return observed


def ui_block(checks, browser, base, scheme, width=390):
    ctx, external = browser_context(browser, base, scheme, width=width)
    pages = []
    label = f"{width}px {scheme}"
    try:
        host, team, state = setup_ui(ctx, base, pages, "locked")
        checks.test(f"{label} T4 연구 탭·아래 막대", lambda: open_tech(team).is_visible())

        def tree():
            panel = open_tech(team)
            branches = team.evaluate("() => KCPTechChecks.entries(KCP.TECH_DATA.branches).map(b=>b.name||b.label||b.id)")
            return len(branches) == 6 and all(panel.get_by_text(name, exact=True).count() for name in branches)

        checks.test(f"{label} T4 트리 6갈래", tree)
        checks.test(f"{label} T4 카드 15장", lambda: team.evaluate("""() => {
          const panel = document.querySelector('#lg-panel');
          return KCPTechChecks.cardsOf().length===15 && KCPTechChecks.cardsOf()
            .every(c=>panel?.textContent.includes(c.name));
        }"""))
        checks.test(f"{label} T4 연구 인력·대학·연구소 요약", lambda: all(
            word in open_tech(team).inner_text() for word in ("인력", "대학", "연구소")))
        checks.test(f"{label} T4 배타 쌍 둘 중 하나 표시", lambda: "둘 중 하나" in open_tech(team).inner_text())

        def detail():
            panel = card_detail(team, "tandem")
            card = team.evaluate("() => KCPTechChecks.cardsOf().find(c=>c.id==='tandem')")
            body = panel.inner_text()
            # D-72(품질8 UX U9): 연구 상세의 근거·효과 크기 등급은 학생 말로 보인다.
            words = team.evaluate("g => [KCP.gradeWords(g[0]), KCP.gradeWords(g[1])]", [card["evidenceGrade"], card["effectGrade"]])
            return (card["field"] in body and ("근거 " + words[0]) in body and
                    ("효과 크기 " + words[1]) in body and
                    "유레카" in body and "출처" in body and "배속" in body)

        checks.test(f"{label} T4 상세 분야·등급·출처·유레카·배속", detail)
        for card_id in team.evaluate("() => KCP.TECH_DATA.cards.map(c=>c.id)"):
            card_detail(team, card_id)
            # D-72(품질8 UX U9): 연구 상세 기본 화면의 등급 글자 '(G)'는 학생 말 '· 게임 가정'으로 보인다.
            checks.ok(bool(re.search(r"교육용 배속(?: ×[\d.]+|: 비교값 없음) · 게임 가정", team.locator(".lg-tech-scale").inner_text())),
                      f"{label} U2 {card_id} 구조화 배속 표시")
        checks.test(f"{label} T3 화면 연구 요청 서버 반영", lambda: queue_from_ui(host, team, state))
        for name in ("탠덤 태양광", "탠덤 지붕 태양광", "차세대 배터리", "수소 탱크", "SMR"):
            checks.test(f"{label} T2 {name} 해금 전 자물쇠·필요 연구", lambda name=name: tool_state(team, name, True))
        checks.test(f"{label} T5 가로 넘침 0", lambda: team.evaluate(
            "() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth"))
        checks.test(f"{label} T5 기술 조작 버튼 44px", lambda: open_tech(team).evaluate("""panel => {
          const buttons = [...panel.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().height>0);
          return buttons.length>0 && buttons.every(el=>{const r=el.getBoundingClientRect(); return r.width>=44 && r.height>=44;});
        }"""))
        host.close()
        team.close()

        host, team, state = setup_ui(ctx, base, pages, "adopted")
        for name in ("탠덤 태양광", "탠덤 지붕 태양광", "차세대 배터리", "수소 탱크", "SMR"):
            checks.test(f"{label} T2 {name} 도입 후 건설 가능", lambda name=name: tool_state(team, name, False))
        checks.test(f"{label} T2 팀 칭호·진행자 순위 배지", lambda: title_badge(host, team, state))
        host.close()
        team.close()

        host, team, state = setup_ui(ctx, base, pages, "transfer")

        def transfer():
            panel = card_detail(team, "grid")
            panel.get_by_role("button", name="기술 이전", exact=True).click()
            host.wait_for_function("id => !!KCP.league.state().S.teams[id].research?.licensedFrom.grid", arg=state["team"])
            # 사용료 숫자·6달 기간은 엔진의 실제 현금 증감과 별도로 화면에서도 보여야 한다.
            body = open_tech(team).inner_text()
            return "사용료" in body and "0.5" in body and re.search(r"6\s*달", body) is not None

        checks.test(f"{label} T2 기술 이전 요청·사용료 안내", transfer)

        def joint():
            panel = card_detail(team, "sic")
            panel.get_by_role("button", name="공동 연구", exact=True).click()
            host.wait_for_function("id => !!KCP.league.state().S.teams[id].research?.joint.sic", arg=state["team"])
            return True

        checks.test(f"{label} T2 공동 연구 요청 서버 반영", joint)
        host.close()
        team.close()

        host, team, _ = setup_ui(ctx, base, pages, "completion")
        checks.test(f"{label} T2 실제 도입 완료 연출", lambda: completion_flow(checks, host, team, label, state))
    except Exception as exc:
        checks.ok(False, f"{label} 화면 초기화: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")
    finally:
        for name, errors in pages:
            checks.ok(not errors, f"{label} {name} 콘솔 오류·미처리 예외 0" + (f": {errors[:2]}" if errors else ""))
        checks.ok(not external, f"{label} 외부 요청 0")
        ctx.close()


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                engine_block(checks, browser, base)
                for width in (1280, 390):
                    for scheme in ("light", "dark"):
                        ui_block(checks, browser, base, scheme, width)
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"실행 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
