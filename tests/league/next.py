"""Independent ECON-NEXT acceptance checks; expected behavior: ECON-NEXT only.

Run (by coordinator): tests/.venv/bin/python tests/league/next.py LOCAL_URL
Only loopback networking is allowed. U2 repairs documented diagnostic mismatches.
Public APIs/storage envelopes from existing harnesses are bootstrap conventions,
not acceptance criteria. Unspecified UI ids are never used as selectors.
"""

from league_flow import finish_trial
from league_flow import pass_issue_check, wait_unfolded
import argparse
import json
import re
import sys
import time
from urllib.parse import urlsplit

from playwright.sync_api import Error, expect
from league_flow import confirm_seat, select_mode, start_solo


WAIT = 12000
IDS = ["pyeongtaek", "hwaseong", "anseong", "dangjin", "asan", "cheonan"]
BOOT = "() => !!(window.KCP && KCP.leagueCore && KCP.league && KCP.buildGame)"
READ = """() => {
  const L = KCP.league.state(), S = L && (L.S || L.snap);
  if (!S || !S.teams) throw Error('public league state unavailable');
  return {team:L.team, S, view: L.S ? KCP.leagueCore.publicView(L.S, Date.now()) : S};
}"""
SYNC = """([round, phase]) => {
  const L = KCP.league.state(), S = L && (L.S || L.snap);
  return !!S && S.round === round && S.phase === phase;
}"""
SEED = """ids => {
  const C = KCP.leagueCore, BG = KCP.buildGame, now = Date.now(), room = 'NEXT66';
  const S = C.newState(room, 'south', now, ids, {turns:12});
  ids.slice(1).forEach(team => {
    const reply = C.reduce(S, {type:'claim', team, token:'next-' + team}, now, BG);
    if (!reply.ok) throw Error('claim fixture rejected: ' + team);
  });
  const net = {kind:'local'};
  localStorage.setItem('kcp-league-net-v1', JSON.stringify(net));
  localStorage.setItem('kcp-league-host-v1', JSON.stringify({room, net, state:S}));
  return {room, team:ids[0], names:ids.map(id => KCP.ECON_DATA.start[id].name)};
}"""
PLAN = """() => {
  const BG = KCP.buildGame, L = KCP.league.state();
  BG.selectPack(L.team, 'league');
  const anchor = BG.SITES.find(s => s.dem).tile;
  const candidate = BG.TILES.find(t => !t.out && t.site < 0 &&
    !BG.siteRule('solar', t) && BG.routePath(anchor, t.i));
  if (!candidate) throw Error('paid plan fixture unavailable');
  const route = BG.routePath(anchor, candidate.i), lines = [];
  for (let i=0; i<route.length-1; i+=79) lines.push({p:route.slice(i, i+80)});
  return KCP.league.plan(st => Object.assign(st, {builds:[{t:'solar', i:candidate.i}],
    lines, policies:[], missions:[], rq:[], seed:2026, shed:'equal'}));
}"""
PLAN_SYNC = """id => {
  const S = KCP.league.state().S;
  return !!S && ((S.teams[id].plan || {}).builds || []).length === 1;
}"""
TRIAL = """() => {
  const C = KCP.leagueCore, BG = KCP.buildGame, R = C.regionOf('south');
  const id = 'pyeongtaek', S = C.newState('NEXTTRIAL', R.id, 0,
    ['pyeongtaek','dangjin'], {turns:12});
  S.round = 1; S.phase = 'plan';
  BG.selectPack(C.teamDef(R, id).pack, 'league');
  const anchor = BG.SITES.find(s => s.dem).tile;
  const tile = BG.TILES.find(t => !t.out && t.site < 0 && !BG.siteRule('solar', t)
    && BG.routePath(anchor, t.i));
  if (!tile) throw Error('trial generation fixture unavailable');
  const p = BG.sanitize({builds:[{t:'solar',i:tile.i}],
    lines:[{p:BG.routePath(anchor,tile.i)}], policies:[], missions:[], rq:[], seed:2026}, 1e9);
  p.season = S.rounds[0].season;
  S.teams[id].plan = JSON.parse(JSON.stringify(p));
  S.events = [];
  const noEvent = C.trialMods(JSON.parse(JSON.stringify(S)), R, id);
  // A real event with a declared effect must target this city. modsFor is
  // not used as an oracle: ECON-NEXT does not promise that it includes events.
  const definition = R.events.find(e => C.hits(R,e,id) && e.effect && Object.keys(e.effect).length);
  if (!definition) throw Error('targeted event with operating effect unavailable');
  const runs = [0.2, 2.8].map(x => {
    const state = JSON.parse(JSON.stringify(S));
    state.events = [{id:definition.id, round:state.round, x}];
    const mods = C.trialMods(state, R, id);
    const result = BG.simulate(JSON.parse(JSON.stringify(p)), 30, {league:true, mods});
    return {mods, result};
  });
  return {xs:[0.2,2.8], runs, noEvent, eventHasEffect:!!Object.keys(definition.effect).length};
}"""


class Checks:
    def __init__(self):
        self.count = 0
        self.failed = 0

    def ok(self, condition, label, detail=""):
        self.count += 1
        if not condition:
            self.failed += 1
            print(f"FAIL {label}" + (f": {detail}" if detail else ""), flush=True)

    def run(self, label, function):
        try:
            function()
        except Exception as error:
            self.ok(False, label + " / execution", str(error))


def visible(locator):
    return [locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible()]


def button(page, pattern):
    """No id promised: use the accessible Korean action text (allow suffixes)."""
    nodes = visible(page.get_by_role("button", name=re.compile(pattern)))
    if not nodes:
        nodes = visible(page.get_by_role("link", name=re.compile(pattern)))
    if len(nodes) != 1:
        raise AssertionError(f"action {pattern!r}: expected one visible control, got {len(nodes)}")
    return nodes[0]


def panel(page, word):
    wait_unfolded(page)
    # Prefer the league controls: the trial sheet also has a "결과" tab.
    controls = page.locator('#lg-bar [data-panel]').filter(has_text=re.compile(word))
    if controls.count() == 1:
        control = controls.first
    else:
        tabs = visible(page.get_by_role("tab", name=re.compile(word)))
        control = tabs[0] if len(tabs) == 1 else button(page, word)
    if control.get_attribute("aria-selected") != "true" and control.get_attribute("aria-expanded") != "true":
        control.click()


def close_panel(page):
    # "닫기" may occur in several cards; use only a unique visible drawer close.
    nodes = visible(page.get_by_role("button", name=re.compile(r"^(?:서랍\s*)?닫기$|접기")))
    if len(nodes) == 1:
        nodes[0].click()


def text_present(page, pattern):
    return bool(visible(page.get_by_text(re.compile(pattern))))


def single_line(page, checks, pattern, label, required_words=()):
    # "한 줄" is interpreted as one visible, compact text block, not one CSS
    # line at every viewport (390px may legitimately wrap). Select the smallest
    # DOM text container by text; do not depend on an unspecified id/class.
    texts = page.evaluate("""([pattern,words]) => {
      const re=new RegExp(pattern), visible=n=>n.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true});
      return [...document.querySelectorAll('body *')].filter(visible)
        .map(n=>(n.innerText||'').trim()).filter(t=>re.test(t) && words.every(w=>t.includes(w)));
    }""", [pattern, list(required_words)])
    checks.ok(bool(texts), label + " visible")
    if texts:
        chosen = min(texts, key=len)
        checks.ok(len(chosen.splitlines()) <= 2 and len(chosen) <= 700,
                  label + " compact line", chosen[:180])
        return chosen
    return ""


def no_overflow(page, checks, label):
    excess = page.evaluate("""() => Math.max(document.documentElement.scrollWidth,
      document.body.scrollWidth) - document.documentElement.clientWidth""")
    checks.ok(excess <= 0, label + " 390px horizontal scroll = 0", str(excess))


def monitor(context, pages, label):
    page = context.new_page()
    events = {"console": [], "page": []}
    page.on("console", lambda event: events["console"].append(event.text) if event.type == "error" else None)
    page.on("pageerror", lambda error: events["page"].append(str(error)))
    pages.append((page, label, events))
    return page


def make_context(browser, base, width):
    context = browser.new_context(viewport={"width": width, "height": 844},
                                  locale="ko-KR", service_workers="block")
    context.set_default_timeout(WAIT)
    origin = urlsplit(base)

    def route(request):
        target = urlsplit(request.request.url)
        if (target.scheme, target.netloc) == (origin.scheme, origin.netloc):
            request.continue_()
        elif target.hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
            # Fulfill locally: no external font request is sent.
            request.fulfill(status=200, content_type="text/css", body="")
        else:
            request.abort()

    context.route("**/*", route)
    context.route_web_socket("**/*", lambda socket: socket.close())
    return context


def setup_pair(context, base, pages):
    host = monitor(context, pages, "host")
    host.goto(base + "#home")
    host.wait_for_function(BOOT)
    fixture = host.evaluate(SEED, IDS)
    host.goto(base + "#league/host")
    host.wait_for_function("() => !!KCP.league.state().S")
    host.wait_for_selector("#lg-roomcode")
    fixture["room"] = host.inner_text("#lg-roomcode").replace("-", "").strip()
    team = monitor(context, pages, "team")
    team.goto(base + "#league")
    select_mode(team, "join")
    # No join ids specified. Interpret "방 코드" as label or placeholder.
    code = visible(team.get_by_label(re.compile(r"방\s*코드|참가\s*코드")))
    if not code:
        code = visible(team.get_by_placeholder(re.compile(r"방\s*코드|코드")))
    if len(code) != 1:
        raise AssertionError("one room-code input required")
    code[0].fill(fixture["room"])
    button(team, r"^(?:방\s*)?(?:참가|참여|입장|들어가기)(?:하기)?$").click()
    confirm_seat(team, fixture["team"])
    return host, team, fixture


def host_first_screen(host, checks, fixture):
    checks.ok(host.locator('#lg-download').is_visible(), 'U6 host public CSV download control')

    # U5는 지휘 막대와 바로 다음 위험 줄로 정보를 나눈다. 한 DOM 블록이라는
    # 구조 조건만 완화하고, 여섯 정보의 표시·간결함·장부 앞 순서는 유지한다.
    concepts = [r"턴|월", r"남은\s*시간|\d+\s*분|시간\s*제한", r"준비", r"공동\s*목표"]
    data = host.evaluate("""patterns => {
      const tests = patterns.map(p => new RegExp(p));
      const visible = n => n.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true});
      const nodes = [...document.querySelectorAll('body *')].filter(visible);
      const command = document.querySelector('.lg-host-command');
      const alerts = document.querySelector('#lg-host-alerts');
      const summary = document.querySelector('#lg-host-summary');
      const before = (a,b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      // Ignore SVG button icons: a detailed map occupies substantial area.
      const maps=nodes.filter(n=>['CANVAS','svg'].includes(n.tagName) &&
        n.getBoundingClientRect().width>=200 && n.getBoundingClientRect().height>=140);
      const tables = nodes.filter(n => n.tagName === 'TABLE' || n.getAttribute('role') === 'table');
      return {band:command && visible(command) && tests.every(re => re.test(command.innerText)) ? command.innerText : null,
        alerts:alerts && visible(alerts) ? alerts.innerText : '',
        order:before(command,alerts) && before(alerts,summary),
        visibleMaps:maps.length,
        tables:tables.map(n => ({text:n.innerText,
          rows:[...n.querySelectorAll('tr,[role="row"]')].map(r => r.innerText),
          beforeMap:maps.every(m => !!(n.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING))}))};
    }""", concepts)
    checks.ok(bool(data["band"]) and bool(re.search(r"미준비|준비\s*전", data["alerts"])) and
              "위험" in data["alerts"] and len((data["band"] or "") + data["alerts"]) <= 900,
              "host first screen: compact command and risk row with six concepts")
    checks.ok(data["order"], "host first screen: command then risks then city ledger")
    tables = [table for table in data["tables"] if all(name in table["text"] for name in fixture["names"])]
    checks.ok(len(tables) == 1, "host first screen: one six-city summary table")
    if tables:
        table = tables[0]
        for term in [r"정전", r"CO[₂2]", r"현금", r"지지율", r"주민.*[Δ△변화]|[Δ△].*주민", r"준비"]:
            checks.ok(bool(re.search(term, table["text"])), f"host summary column {term}")
        for name in fixture["names"]:
            checks.ok(sum(name in row for row in table["rows"]) == 1, f"host summary: one row for {name}")
        checks.ok(table["beforeMap"], "host summary comes before visible map")
    # Detailed map / cards are initially collapsed. Summary alone is visible.
    checks.ok(data["visibleMaps"] == 0, "host first screen: detailed maps initially collapsed")
    checks.ok(host.locator("[data-host-card]").count() > 0 and
              host.locator("[data-host-card][open]").count() == 0,
              "host first screen: city detail cards initially collapsed")
    no_overflow(host, checks, "host first screen")


def advance(host, team, phase=None):
    # Only preparation uses the existing public next() entry point. UI behavior
    # under test (event gates, result tabs, solo confirmation) uses real clicks.
    before = host.evaluate(READ)["S"]
    host.evaluate("() => KCP.league.next()")
    host.wait_for_function("([r,p]) => {const S=KCP.league.state().S; return S && (S.round!==r || S.phase!==p) && S.phase!=='run';}",
                           arg=[before["round"], before["phase"]])
    state = host.evaluate(READ)["S"]
    host.wait_for_function(SYNC, arg=[state["round"], state["phase"]])
    team.wait_for_function(SYNC, arg=[state["round"], state["phase"]])
    if phase and state["phase"] != phase:
        raise AssertionError(f"expected phase {phase}, got {state['phase']}")
    return state


def money_near_label(node):
    # No money id / rounding precision is specified. Read the numeric value
    # immediately associated with the visible "남은 돈" label, preserving the
    # minus sign and accepting comma separators / optional 억 unit.
    return node.evaluate(r"""n => {
      for (let p=n, depth=0; p && depth<4; p=p.parentElement, depth++) {
        const text = p.innerText || '';
        const hit = /남은\s*돈\s*[:：]?\s*([−-]?\d[\d,]*(?:\.\d+)?)\s*(?:억)?/.exec(text);
        if (hit) return {text:hit[1], number:Number(hit[1].replace(/,/g,'').replace('−','-'))};
      }
      return null;
    }""")


def plan_co2(host, team, checks, fixture):
    state = host.evaluate(READ)
    goal = state['view']['goals']
    values = []
    mobile = team.viewport_size['width'] <= 600
    previous_panel = team.locator('#lg-bar [data-panel][aria-expanded="true"]').evaluate_all(
        "els => els[0]?.dataset.panel || null")
    if mobile:
        panel(team, '일지')
    team_selector = '#lg-plan-co2-drawer' if mobile else '#lg-plan-co2'
    for page, selector in [(host, '#lg-host-goals'), (team, team_selector)]:
        text = page.locator(selector).inner_text()
        match = re.search(r'이번 달 CO₂ 목표 ≤ ([\d,]+)\s*t', text)
        shown = float(match.group(1).replace(',', '')) if match else None
        checks.ok(page.locator(selector).is_visible() and shown is not None and shown > 0 and
                  abs(shown - goal['co2Plan']) <= .5 and
                  '계획 시작 때 확정' in text and f"기준: {goal['co2Basis']}" in text,
                  'S8 계획 CO₂ 월 목표·확정 시점·근거 표시')
        values.append(shown)
    if mobile:
        team.locator('[data-pclose]').click()
        if previous_panel:
            team.locator(f'[data-panel="{previous_panel}"]').click()
    checks.ok(values[0] == values[1], 'S8 진행자·팀의 계획 CO₂ 목표 일치')
    fixture.setdefault('plan_goals', {})[state['S']['round']] = values[0]


def evaluated_plan_co2(state, checks, fixture):
    result = state['results'][-1]
    shown = fixture.get('plan_goals', {}).get(result['round'])
    target = result['econ']['region']['goal']['co2']
    checks.ok(shown is not None and shown > 0 and abs(shown - target) <= .5,
              'S8 계획 때 보인 값 = 결과 뒤 그 달 평가 목표')


def money_tolerance(value):
    precision = len(value["text"].split(".")[1]) if "." in value["text"] else 0
    return 0.5 * 10 ** (-precision) + 1e-8


def read_left_labels(host, team, fixture):
    host_labels = visible(host.get_by_text(re.compile(r"남은\s*돈")))
    team_labels = visible(team.get_by_text(re.compile(r"남은\s*돈")))
    values_h = [value for value in (money_near_label(node) for node in host_labels) if value is not None]
    values_t = [value for value in (money_near_label(node) for node in team_labels) if value is not None]
    # If the host displays multiple city cards, restrict the label to the
    # smallest ancestor containing this city's name and one 남은 돈 label.
    relevant_h = []
    for node in host_labels:
        belongs = node.evaluate(r"""(n,name) => {
          for (let p=n, d=0; p && d<7; p=p.parentElement,d++) {
            const t=p.innerText || '';
            if (t.includes(name) && (t.match(/남은\s*돈/g)||[]).length===1) return true;
          } return false;
        }""", fixture["names"][0])
        value = money_near_label(node)
        if belongs and value:
            relevant_h.append(value)
    return values_h, values_t, relevant_h


def left_consistency(host, team, checks, fixture):
    state = advance(host, team, "plan")
    plan_co2(host, team, checks, fixture)
    # Remove current-month events only for this display fixture. Actual event
    # gate and hidden event-size checks have their own scenarios below.
    host.evaluate("() => { KCP.league.state().S.events = []; }")
    team.evaluate(PLAN)
    host.wait_for_function(PLAN_SYNC, arg=fixture["team"])
    host_state = host.evaluate(READ)
    team_state = team.evaluate(READ)
    checks.ok(host_state["S"]["round"] == team_state["S"]["round"] == state["round"], "money: same month on host/team")
    expected = host_state["view"]["teams"][fixture["team"]].get("left")
    checks.ok(isinstance(expected, (int, float)), "money: public left finite")
    budget = host_state["view"]["teams"][fixture["team"]].get("budget")
    checks.ok(expected != budget, "money: paid plan distinguishes left from budget")
    # Open the city card by city name, as the spec does not assign its id.
    cities = visible(host.get_by_role("button", name=re.compile(re.escape(fixture["names"][0]))))
    if len(cities) == 1:
        cities[0].click()
    elif len(cities) > 1:
        raise AssertionError("ambiguous host city-card action")
    panel(team, r"도시")
    # 진행자는 상태를 바꾼 뒤 묶음 대기(ui/league.js changed(), 150ms)를 거쳐 자기 화면을 다시 그리고
    # 팀에 공개 상태를 보낸다. PLAN_SYNC는 진행자 상태만 보므로, 두 화면이 그 상태로 다시 그려질 때까지
    # 조건 대기한다(기대값 left는 그대로). WAIT 안에 옛 값이 남으면 아래 단언이 그대로 실패한다.
    started = time.monotonic()
    deadline = started + WAIT / 1000
    values_h = values_t = relevant_h = []
    while True:
        try:
            values_h, values_t, relevant_h = read_left_labels(host, team, fixture)
        except Error:
            # 다시 그리는 중 떨어져 나간 요소: 다음 읽기에서 새 요소를 찾는다.
            pass
        shown = relevant_h + values_t
        if (relevant_h and values_t and isinstance(expected, (int, float)) and
                all(abs(value["number"] - expected) <= money_tolerance(value) for value in shown)) or \
                time.monotonic() > deadline:
            break
        host.wait_for_timeout(50)
    print(f"INFO left_consistency 화면 반영 대기 {round((time.monotonic() - started) * 1000)}ms", flush=True)
    checks.ok(bool(values_h), "host card has labeled remaining money")
    checks.ok(bool(values_t), "team HUD/drawer has labeled remaining money")
    checks.ok(bool(relevant_h), "host remaining money belongs to selected city card")
    if relevant_h and values_t and isinstance(expected, (int, float)):
        for value in relevant_h + values_t:
            checks.ok(abs(value["number"] - expected) <= money_tolerance(value),
                      "host/team displayed money equals same-month left", f"shown={value['number']}, left={expected}")
        checks.ok(relevant_h[0]["number"] == values_t[0]["number"], "host card remaining money == team remaining money")
    no_overflow(team, checks, "team money / indicators")
    close_panel(team)


def results(host, team, checks, fixture):
    state = advance(host, team, "review")
    evaluated_plan_co2(state, checks, fixture)
    # 품질8 UX U10(docs/QUALITY-ux.md 6절): 폭 760px 이하에서는 재생(2~4초) 동안 결과 서랍이 접혀 있고
    # 결과 토스트(약 2초)는 그 사이에 뜬다. 토스트가 떠 있는 순간(결과 직후)에 서랍 제목 줄·결과 제목과
    # 겹치지 않는지 본다. 접힌 서랍의 결과 제목은 그려지지 않으므로(크기 0) 그 항목은 건너뛴다.
    checks.ok(team.evaluate("""() => {
      const toast=document.querySelector('#bd-toast'), t=toast.getBoundingClientRect();
      return toast.dataset.show==='true' && ['.lg-ptabs','#lg-result-heading'].every(key => {
        const el=document.querySelector(key); if (!el) return true;
        const h=el.getBoundingClientRect(); if (!h.width || !h.height) return true;
        return t.right<=h.left || t.left>=h.right || t.bottom<=h.top || t.top>=h.bottom;
      });
    }"""), 'D-A9 결과 토스트와 서랍·결과 제목의 겹침 없음')
    panel(team, r"결과")
    annual = [line for line in host.locator('#lg-log li').all_inner_texts()
              if line.startswith('국가 재정지원금 연액:')]
    pay_month_count = host.evaluate('() => KCP.ECON_DATA.params.subsidyPayMonths.v.length')
    payout_suffix = f'(지급 월마다 1/{pay_month_count} 지급)'
    checks.ok(len(annual) == 1 and all(name in annual[0] for name in fixture['names']) and
              annual[0].count(payout_suffix) == 1 and len(annual[0]) <= 120,
              'D-A5 120자 안에서 지원금 여섯 도시·지급 설명 모두 표시')
    goals = host.locator('#lg-host-goals').inner_text()
    target = state['results'][-1]['econ']['region']['goal']['co2']
    shown_goal = re.search(r'CO₂ ≤ ([\d,]+)\s*t', goals)
    checks.ok(shown_goal is not None and abs(float(shown_goal.group(1).replace(',', '')) - target) <= .5,
              'D-A3 결과 CO₂ 목표 = 해당 달 평가 보고서 값')
    # D-74: 계통이 메운 달에는 '계통이 메운 전기' 칸(data-grid-fill)이 붙는다. 고정 숫자 셋은 그대로 센다.
    checks.ok(team.locator('#lg-result-deltas > div:not([data-grid-fill])').count() == 3, 'U2 result starts with exactly three numbers')
    # 결과 서랍(결과 단계)의 S8 아래 상세는 '이번 달 자세히'(#lg-month-details) 접힘 안에 있다(품질8 UX, 2026-10-21). 먼저 연다.
    month = team.locator('#lg-month-details')
    if month.count() and not month.evaluate('el => el.open'):
        month.locator(':scope > summary').click()
    for key in ('lg-result-reasons', 'lg-result-details'):
        detail = team.locator('#' + key)
        checks.ok(detail.count() == 1, 'U2 native disclosure ' + key)
        if detail.count() and not detail.evaluate('el => el.open'):
            detail.locator(':scope > summary').focus()
            detail.locator(':scope > summary').press('Enter')
            checks.ok(detail.evaluate('el => el.open'), 'U2 result layer opens by keyboard ' + key)
    # rev11 R5: 같은 생산 개념은 CO₂ 접두 뒤 종류를 붙인다.
    for pattern in [r"CO₂\s*생산\s*\(이번\s*달\)", r"민원\s*\(지금\s*지도\s*기준\)", r"정전\s*\(이번\s*달\)"]:
        checks.ok(text_present(team, pattern), f"team indicator reference name {pattern}")
    checks.ok(team.locator('#lg-map-result').is_visible(), 'U2 public result remains on city map')
    result = state["results"][-1]
    # Months wrap 12→1; use the completed round's month, not S.round+1.
    month = state["rounds"][state["round"] - 1]["month"]
    next_month = month % 12 + 1
    checks.ok(text_present(team, rf"{month}월\s*결과\s*·\s*다음\s*운영\s*{next_month}월"),
              "result header names completed month and next operation month")
    ledger = result["team"][fixture["team"]].get("ledger", {})
    checks.ok(all(isinstance(ledger.get(key), (int, float)) for key in ["open", "income", "invest", "opex", "close"]),
              "result fixture has contractual ledger")
    spend_nodes = visible(team.get_by_text(re.compile(r"이번\s*(?:달|턴)\s*총지출")))
    checks.ok(bool(spend_nodes), "result labels current-turn total spending")
    if spend_nodes and "invest" in ledger and "opex" in ledger:
        shown = spend_nodes[0].evaluate(r"""n => {
          for(let p=n,d=0;p && d<4;p=p.parentElement,d++) {
            const m=/이번\s*(?:달|턴)\s*총지출\s*[:：]?\s*([\d,]+(?:\.\d+)?)/.exec(p.innerText||'');
            if(m) return {text:m[1], value:Number(m[1].replace(/,/g,''))};
          } return null;
        }""")
        checks.ok(shown is not None, "result spending numeric value associated with label")
        if shown:
            precision = len(shown["text"].split(".")[1]) if "." in shown["text"] else 0
            checks.ok(abs(shown["value"] - ledger["invest"] - ledger["opex"]) <= 0.5 * 10 ** (-precision) + 1e-8,
                      "current-turn total spending = invest + opex")
    # spec-C §M3: 결과 장부 이름 변경, 금액 검산은 유지한다.
    ledger_line = single_line(team, checks, r"기초\s*(?:잔액|현금)|달\s*초|장부", "ledger one line", ("투자", "운영"))
    if ledger_line:
        for key, term in [("open", r"(?:기초(?:\s*잔액|\s*현금)?|달\s*초)"), ("income", r"(?:지원금\s*[·+]?\s*)?수입"),
                          ("invest", r"(?:신규\s*)?투자"), ("opex", r"연료·운영비"), ("close", r"(?:기말(?:\s*잔액)?|달\s*말)")]:
            match = re.search(term + r"\s*[:：]?\s*([−-]?\d[\d,]*(?:\.\d+)?)", ledger_line)
            checks.ok(bool(match), f"ledger line names numeric {key}")
            if match and key in ledger:
                raw = match.group(1).replace(",", "").replace("−", "-")
                precision = len(raw.split(".")[1]) if "." in raw else 0
                checks.ok(abs(float(raw) - ledger[key]) <= 0.5 * 10 ** (-precision) + 1e-8, f"ledger line {key} matches engine")
    single_line(team, checks, r"원인|이번\s*달.*기여", "cause one line")
    report = result.get("econ", {})
    causes = report.get("cities", {}).get(fixture["team"], {}).get("causes", [])
    checks.ok(bool(causes), "result fixture has at least one explanatory cause")
    if causes:
        checks.ok(text_present(team, re.escape(causes[0]["label"])), "display includes leading engine cause label")
    for term in [r"시험", r"실제", r"차이\s*원인"]:
        checks.ok(text_present(team, term), f"trial/actual/difference section: {term}")
    for term in [r"사건", r"이웃\s*거래", r"접속\s*대기", r"날씨"]:
        checks.ok(text_present(team, term), f"difference explanation dimension: {term}")
    # The three exact section names are in §3, unlike their DOM containers.
    titles = ["지역 공동성과", "도시별 기여", "도시 자체 성과"]
    for title in titles:
        checks.ok(text_present(team, re.escape(title)), f"shared goals section {title}")
    positions = team.evaluate("""titles => {
      const t=document.body.innerText; return titles.map(title => t.indexOf(title));
    }""", titles)
    checks.ok(all(position >= 0 for position in positions) and positions == sorted(positions)
              and len(set(positions)) == 3, "shared goals: region / contribution / city in order")
    checks.ok(text_present(team, r"공동\s*보너스"), "shared bonus visible")
    single_line(team, checks, r"자리\s*탓|송전\s*손실|미연결", "placement explanation one line")
    cause = team.locator('#lg-result-causes').inner_text()
    checks.ok(not re.search(r'\d+\.\d{2,}%p|-\d+(?:\.\d+)?%p', cause),
              'D-A11 지지율 원인 한 자리·음수 − 표시')
    # spec-C §M1: 정전·현금도 S6 생산 CO₂와 Δ는 소수 1자리 t/일, 월 합계만 정수 t다.
    # rev11 R5: 수치 검산 기준은 그대로, S6 표지의 순서만 바뀐다.
    co2 = team.locator('#lg-result-deltas > div').filter(has_text='CO₂ 생산(이번 달)')
    token = r'[+−-]?\d[\d,]*(?:\.\d)?'
    daily = re.fullmatch(rf'({token}) t/일', co2.locator('dd').inner_text())
    change = co2.locator('small').inner_text()
    monthly = re.search(r'이번 달 합 ([\d,]+) t(?:\)|$)', change)
    delta = re.search(rf'Δ ({token}) t/일(?:\(|$)', change)
    previous = next((r for r in state['results'] if r['round'] == result['round'] - 1), None)
    actual = result['team'][fixture['team']]['co2Prod'] / result['days']
    days = state['rounds'][result['round'] - 1]['mdays']
    checks.ok(bool(daily) and abs(float(daily[1].replace(',', '').replace('−', '-')) - actual) <= .05 + 1e-7 and
              bool(monthly) and abs(float(monthly[1].replace(',', '')) - actual * days) <= .5 + 1e-7,
              'M1 S6 생산 CO₂ 하루 평균 t/일·보조 월 합계 t')
    if previous:
        expected_delta = actual - previous['team'][fixture['team']]['co2Prod'] / previous['days']
        checks.ok(bool(delta) and abs(float(delta[1].replace(',', '').replace('−', '-')) - expected_delta) <= .05 + 1e-7,
                  'M1 S6 생산 CO₂ 지난달 대비 Δ도 하루 평균 t/일')
    else:
        checks.ok(bool(delta) or 'Δ 비교 없음(시험 기록 없음)' in change,
                  'M1 S6 첫 달 생산 CO₂는 시험 대비 Δ t/일 또는 기록 없음')
    no_overflow(team, checks, "result")
    close_panel(team)


def record_trial(team, checks, days=7):
    # E: 멀티는 1주, 혼자 하기는 1달 시험 기록·비교 경로를 계속 검사한다.
    team.evaluate("""() => {
      if(typeof KCP.buildGame.lastTrial!=='function') throw Error('BG.lastTrial API missing');
    }""")
    duration = '1주' if days == 7 else '1달'
    checks.ok([n.get_attribute('data-run') for n in team.locator('[data-run]:visible').all()] ==
              (['7'] if days == 7 else ['7', '30', '90']), 'E visible trial periods match multiplayer / solo')
    button(team, rf"^시험 {duration}$").click()
    team.wait_for_function("() => /날씨는/.test(document.querySelector('#bd-run-wx')?.textContent || '')")
    month = team.evaluate("() => KCP.leagueCore.roundsOf(KCP.league.state().snap)[KCP.league.state().snap.round-1].month")
    checks.ok(f'{month}월 (날씨는 ' in team.locator('#bd-run-wx').inner_text(),
              '#32 시험 운전 날씨 칩의 현재 달과 날씨 기준월')
    team.wait_for_selector('#bd-res-title')
    checks.ok(f'· {month}월 (날씨는 ' in team.locator('#bd-res-title').inner_text(),
              '#32 시험 성적표의 현재 달과 날씨 기준월')
    trial = finish_trial(team, days)
    checks.ok(isinstance(trial, dict) and trial.get('days') == days and
              all(isinstance(trial.get(k), (int, float)) for k in ('unsPct', 'outH', 'co2', 'cost', 'capex', 'opex')),
              f"{duration} UI trial records exact duration and comparison metrics in BG.lastTrial")
    checks.ok(team.evaluate("document.documentElement.classList.contains('bd-drawer-open')") and
              not team.locator('#lg-panel').is_visible(), 'U2 first trial keeps its score sheet')
    ready = team.locator('#lg-ready')
    ready.scroll_into_view_if_needed()
    checks.ok(ready.evaluate("el => {const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}"),
              'U2 390 trial sheet leaves 준비 clickable')
    result = team.locator('#lg-bar [data-panel="result"]')
    result.click()
    checks.ok(not team.evaluate("document.documentElement.classList.contains('bd-drawer-open')") and
              team.locator('#lg-panel').is_visible(), 'U2 trial → league result closes build drawer')
    checks.ok(team.locator('#bd-hud .bd-cap').evaluate_all("""caps => caps.length===5 && caps.every(cap => {
      const bounds=cap.getBoundingClientRect();
      return [...cap.querySelectorAll('.v2-cap-k,.v2-cap-v')].every(value => {
        // rev12 Q5: .bd-sr는 낭독용이다. 보이는 모든 이름·숫자의 기존 경계 검사는 유지한다.
        const rects=[...value.childNodes].filter(n=>!(n.nodeType===1 && n.classList.contains('bd-sr')))
          .flatMap(n=>{const range=document.createRange();range.selectNode(n);return [...range.getClientRects()];});
        return value.scrollWidth<=value.clientWidth && rects.length>0 && rects.every(r =>
          r.left>=bounds.left && r.right<=bounds.right && r.top>=bounds.top && r.bottom<=bounds.bottom);
      });
    })"""), 'D-A8 390 머리 칩의 이름·숫자 전체가 칩 안에 표시')
    no_overflow(team, checks, duration + " trial")


def peek(team, checks, fixture):
    # U5 supplies these four ids explicitly; check ALL DOM occurrences, even
    # hidden duplicates. Enter actual observation, rather than a normal page.
    panel(team, r"지역")
    other = fixture["names"][1]
    button(team, re.escape(other)).click()
    team.locator("#lg-peek").first.wait_for(state="visible")
    checks.ok(text_present(team, r"관전"), "U5 actually entered observation mode")
    for element_id in ["lg-peek", "lg-peek-region", "lg-peek-back", "lg-ready"]:
        count = team.locator(f"[id='{element_id}']").count()
        checks.ok(count <= 1, f"U5 {element_id} no duplicate ids", str(count))
        if element_id != "lg-ready":
            checks.ok(count == 1, f"U5 {element_id} present in observation")
    no_overflow(team, checks, "U5 observation")
    team.locator("#lg-peek-back").click()
    no_overflow(team, checks, "U5 return to city")


def trial_no_leak(page, checks):
    output = page.evaluate(TRIAL)
    a, b = output["runs"]
    checks.ok(output["xs"][0] != output["xs"][1], "trial fixture uses two different actual event sizes")
    checks.ok(a["mods"] == b["mods"], "trialMods exclude actual ev.x")
    checks.ok(a["result"] == b["result"], "two ev.x values produce identical complete trial results")
    checks.ok(output["eventHasEffect"], "trial fixture has a declared operating event effect for this city")
    for field in ["reCap", "curtailP", "essCap"]:
        checks.ok(field in a["mods"], f"trialMods preserve actual operating field {field}")
    # Second contrast: an event with an effect vs no event, so a constant
    # effect leak also fails even when x is ignored.
    checks.ok(a["mods"] == output["noEvent"], "trialMods exclude event effect as well as event size")


def event_gate_and_journal(host, team, checks, fixture):
    advance(host, team, "plan")
    plan_co2(host, team, checks, fixture)
    seeded = host.evaluate("""id => {
      const L=KCP.league.state(), S=L.S, C=KCP.leagueCore, R=C.regionOf('south');
      const def=R.events.find(e => C.hits(R,e,id) && (e.opts||[]).some(o=>o.cost>0));
      if(!def) throw Error('paid event response fixture missing');
      S.events=[{id:def.id, round:S.round, x:1}];
      S.teams[id].crit=null;
      const option=def.opts.find(o=>o.cost>0);
      return {event:def.id, option:option.id, name:option.name, round:S.round};
    }""", fixture["team"])
    # Reopen host from its persisted fixture so the normal local broadcast
    # publishes the exact event/criteria setup; do not mock respond() or gate().
    host.evaluate("""() => {
      const raw=JSON.parse(localStorage.getItem('kcp-league-host-v1'));
      raw.state=KCP.league.state().S;
      localStorage.setItem('kcp-league-host-v1',JSON.stringify(raw));
    }""")
    host.reload()
    host.wait_for_function(BOOT)
    team.wait_for_function("""([ev,round]) => {
      const L=KCP.league.state(), S=L.S||L.snap;
      return (S.events||[]).some(e=>e.id===ev && e.round===round) && !S.teams[L.team].crit;
    }""", arg=[seeded["event"], seeded["round"]])
    # rev8 4절: 사건 서랍 이름 변경을 반영하고 옛 '이웃·거래' 이름도 허용한다.
    panel(team, r"(?:사건|이웃)·거래")
    response_button = team.locator('#lg-panel [data-resp]').filter(has_text=seeded["name"])
    response_button.scroll_into_view_if_needed()
    checks.ok(response_button.evaluate("el => {const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}"),
              "U2 event response is clickable after trial/result")
    response_button.click()
    host.wait_for_function("([id,key,opt]) => KCP.league.state().S.teams[id].resp[key]===opt",
                           arg=[fixture["team"], f"{seeded['round']}:{seeded['event']}", seeded["option"]])
    checks.ok(True, "v1.1 event response applies before 준비")
    team.locator('#lg-ready').click()
    pass_issue_check(team)
    checks.ok(team.locator('#lg-predict').is_visible() and team.locator('#lg-ready-confirm').is_disabled(),
              "v1.1 response → 준비 → promise gate")
    no_overflow(team, checks, "event criterion gate")
    choices = visible(team.locator('#lg-crit [data-crit]'))
    if choices:
        choices[0].click()
        team.locator('#lg-crit-line').fill("10")
    team.locator('#lg-predict [data-evidence]:enabled').first.click()
    team.locator('#lg-predict [data-pred]').select_option('same')
    team.locator('#lg-predict [data-confidence="half"]').click()
    team.locator('#lg-ready-confirm').click()
    close_panel(team)
    state = advance(host, team, "review")
    evaluated_plan_co2(state, checks, fixture)
    panel(team, r"결과")
    # 사건 달 반문은 결과 서랍의 질문 카드(질문 은행 키 lg-f-event, ECON-UI 결과 단계 .lg-ask)다.
    card = team.locator('#lg-panel .lg-ask[data-question="lg-f-event"]')
    checks.ok(card.count() == 1 and card.is_visible(), "event-month counterquestion uses lg-f-event")
    reply = card.locator("textarea[data-note]")
    answer = "가상검사답: 이웃 정전 수치를 보고 예비 전력을 유지한다."
    if reply.count() != 1 or not reply.is_visible():
        raise AssertionError("event reply input missing")
    if reply.evaluate("n => ['TEXTAREA','INPUT'].includes(n.tagName)"):
        reply.fill(answer)
    else:
        reply.get_by_role("textbox").fill(answer)
    # Both immediate-save and explicit-save UI are allowed by the spec.
    save = visible(team.get_by_role("button", name=re.compile(r"일지.*저장|답.*저장|^저장$")))
    if len(save) == 1:
        save[0].click()
    reply.press("Tab")
    close_panel(team)
    next_change = '저장 설비를 먼저 확인해요 <가상 검사>'
    panel(team, r"일지")
    team.locator('[data-j="next"]').fill(next_change)
    team.locator('[data-j="next"]').press('Tab')
    close_panel(team)
    advance(host, team, "plan")
    plan_co2(host, team, checks, fixture)
    team.locator('#lg-ready').click()
    pass_issue_check(team)
    checks.ok(team.locator('#lg-previous-change').inner_text().endswith(next_change) and
              team.locator('#lg-previous-change').evaluate("""el => {
                const p=document.querySelector('#lg-panel').getBoundingClientRect(), r=el.getBoundingClientRect();
                const h=document.querySelector('.lg-ptabs').getBoundingClientRect();
                return r.top>=h.bottom && r.bottom<=p.bottom && !el.querySelector('input,textarea');
              }"""), 'D-S8 준비 직후 약속 카드 위에 지난달 다음 변경을 안전하게 표시')
    panel(team, r"일지")
    checks.ok(text_present(team, re.escape(answer)), "next-month journal includes exact prior counterquestion answer")
    checks.ok(text_present(team, r"다음에\s*바꿀\s*것"), "next-month journal includes 다음에 바꿀 것")
    order = team.evaluate(r"""answer => {
      const visible=n=>n.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true});
      const nodes=[...document.querySelectorAll('body *')].filter(visible)
        .filter(n=>(n.innerText||'').includes(answer)).sort((a,b)=>a.innerText.length-b.innerText.length);
      const previous=nodes[0];
      if(!previous) return {before:false, current:false};
      for(let p=previous.parentElement;p;p=p.parentElement) {
        const fields=[...p.querySelectorAll('textarea,input')].filter(n=>visible(n) && !n.disabled && !n.readOnly);
        if(fields.length && /다음에\s*바꿀\s*것/.test(p.innerText||'')) {
          return {before:!!(previous.compareDocumentPosition(fields[0]) & Node.DOCUMENT_POSITION_FOLLOWING),current:true};
        }
      }
      return {before:false,current:false};
    }""", answer)
    checks.ok(order["current"] and order["before"],
              "prior answer precedes current-month journal fields")
    no_overflow(team, checks, "event / next-month journal")


def solo(context, base, checks, pages):
    page = monitor(context, pages, "solo")
    page.goto(base + "#league")
    page.wait_for_function(BOOT)
    start_solo(page)
    page.wait_for_function("() => !!(KCP.league.state().S || KCP.league.state().snap)")
    page.locator('#lg-guide-close').click()
    record_trial(page, checks, 30)
    month_trial = page.evaluate('() => KCP.buildGame.lastTrial()')
    close_panel(page)
    before = page.evaluate(READ)["S"]
    dialogs = []

    def cancel(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()

    page.on("dialog", cancel)
    # 품질8 UX U2(docs/QUALITY-ux.md 6절): '처음부터'는 주 행동 옆 막대에서 도움말 서랍으로 옮겼다.
    if not visible(page.get_by_role("button", name=re.compile(r"처음부터"))):
        page.locator("#bd-help").click()
        page.wait_for_timeout(300)
    button(page, r"처음부터").click()
    if dialogs:
        checks.ok(any(re.search(r"처음|다시|초기|지우|기록", message) for message in dialogs), "solo restart native confirmation has clear text")
    else:
        # Custom accessible confirmation is also a valid 확인 창.
        modal = visible(page.get_by_role("dialog")) + visible(page.get_by_role("alertdialog"))
        checks.ok(len(modal) == 1, "solo 처음부터 opens confirmation window")
        if len(modal) != 1:
            raise AssertionError("restart confirmation missing")
        modal[0].get_by_role("button", name=re.compile(r"취소|계속\s*하기|돌아가기")).click()
    after = page.evaluate(READ)["S"]
    checks.ok(before == after, "cancel solo restart preserves complete game state")
    page.remove_listener("dialog", cancel)
    # 위에서 '처음부터'를 찾으려고 연 도움말 서랍을 닫고 원래 화면에서 이어 간다.
    if page.locator("#lg-solo-restart").is_visible():
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    # Fast-forward only this end-screen fixture with public next(). No event
    # or learning UI is replaced; confirmation above is exercised by clicks.
    compared_month_trial = False
    for _ in range(30):
        state = page.evaluate(READ)["S"]
        if state["phase"] == "end":
            break
        if state['phase'] == 'review' and state['round'] == 1:
            compared_month_trial = True
            panel(page, r'^결과$')
            # 결과 서랍(결과 단계)의 S8 아래 상세는 '이번 달 자세히'(#lg-month-details) 접힘 안에 있다(품질8 UX, 2026-10-21). 먼저 연다.
            month = page.locator('#lg-month-details')
            if month.count() and not month.evaluate('el => el.open'):
                month.locator(':scope > summary').click()
            detail = page.locator('#lg-result-details')
            if not detail.evaluate('el => el.open'):
                detail.locator(':scope > summary').click()
            expect(page.locator('#lg-trial-compare table')).to_be_visible()
            result = state['results'][0]
            actual = result['team'][page.evaluate(READ)['team']]
            monthly = 31  # 첫 운영은 1월. 대표 운전 기간과 각 시험 기간을 따로 환산한다.
            values = page.locator('#lg-trial-compare tbody tr').evaluate_all('''rows => rows.map(row =>
              [...row.querySelectorAll('td')].map(n => Number(n.textContent.replace(/[^0-9.−-]/g,'').replace('−','-'))))''')
            expected = [[month_trial['unsPct'], actual['unsPct']],
                        [month_trial['outH'] * monthly / 30, actual['outH'] * monthly / result['days']],
                        # D-74(fe4473d): 경제 모드 시험은 계통 수입분을 포함하고 그 CO₂는 소비 기준에만 귀속된다.
                        # 그래서 비교 줄은 'CO₂ 소비(계통 포함)'이며 실제 값은 co2Cons다(생산 co2Prod 아님).
                        [month_trial['co2'] * monthly / 30, actual['co2Cons'] * monthly / result['days']],
                        [month_trial['opex'] * monthly / 30,
                         (actual['cost']['fuel'] + actual['cost']['policy']) * monthly / result['days']]]
            checks.ok(len(values) == 4 and all(len(row) == 2 for row in values) and
                      all(abs(a-b) <= .0051 for row, wanted in zip(values, expected) for a, b in zip(row, wanted)),
                      'E 혼자 1달 시험·실제 비교: 비율 유지·시간/CO₂/운영비 각각 31일 환산')
            close_panel(page)
        page.evaluate("() => KCP.league.next()")
        page.wait_for_function("""([round,phase]) => {
          const L=KCP.league.state(), S=L.S||L.snap;
          return S.phase==='end' || S.round!==round || S.phase!==phase;
        }""", arg=[state["round"], state["phase"]])
    ended = page.evaluate(READ)["S"]
    checks.ok(compared_month_trial, 'E 혼자 1달 시험의 첫 달 비교 검사를 실제로 수행')
    checks.ok(ended["phase"] == "end", "solo fixture reaches completed game")
    # Match phrase literally; merely showing a generic 다시 button is insufficient.
    wait_unfolded(page)  # 품질8 UX U10: 마지막 달 재생 동안 접힌 끝 서랍이 펼쳐지기를 기다린다.
    retry = button(page, r"같은\s*조건으로\s*다시")
    checks.ok(retry.is_visible(), "solo end screen offers 같은 조건으로 다시")
    settings = {key: ended.get(key) for key in ["region", "active", "rounds", "seed"]}
    retry.click()
    resumed = page.evaluate(READ)["S"]
    checks.ok(resumed["phase"] != "end" and not resumed.get("results"), "same-conditions retry starts a fresh run")
    for key, value in settings.items():
        checks.ok(resumed.get(key) == value, f"same-conditions retry preserves {key}")
    no_overflow(page, checks, "solo confirmation / retry")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:9430/index.html")
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    checks = Checks()
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.password:
        checks.ok(False, "external network forbidden; pass loopback URL")
        print(f"checks {checks.count} fail {checks.failed}")
        return 1
    base = args.url.split("#", 1)[0]
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            context = make_context(browser, base, 390)
            pages = []
            pair = []
            checks.run("local six-city setup", lambda: pair.extend(setup_pair(context, base, pages)))
            if pair:
                host, team, fixture = pair
                checks.run("host first screen", lambda: host_first_screen(host, checks, fixture))
                checks.run("left money consistency", lambda: left_consistency(host, team, checks, fixture))
                checks.run("one-week multiplayer UI trial record", lambda: record_trial(team, checks))
                checks.run("trialMods leak", lambda: trial_no_leak(team, checks))
                checks.run("result contracts", lambda: results(host, team, checks, fixture))
                checks.run("U5 mobile observation", lambda: peek(team, checks, fixture))
                checks.run("event gate / next journal", lambda: event_gate_and_journal(host, team, checks, fixture))
            # Isolate solo storage and listeners from the host/team room.
            solo_context = make_context(browser, base, 390)
            checks.run("solo restart / same conditions", lambda: solo(solo_context, base, checks, pages))
            for page, label, events in pages:
                checks.ok(not events["console"], label + " console errors = 0", " | ".join(events["console"]))
                checks.ok(not events["page"], label + " uncaught errors = 0", " | ".join(events["page"]))
                if not page.is_closed():
                    no_overflow(page, checks, label + " final")
            solo_context.close()
            context.close()
            browser.close()
    except Exception as error:
        checks.ok(False, "browser bootstrap / execution", str(error))
    print(f"checks {checks.count} fail {checks.failed}")
    return int(checks.failed > 0)


if __name__ == "__main__":
    sys.exit(main())
