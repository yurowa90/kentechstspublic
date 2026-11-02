"""ECON-UI 수용 검사. 실행: python3 tests/league/econui.py <로컬 주소>.

구현과 독립된 기대값은 docs/ECON-UI.md U1/U2/U4·수용 기준에서 온다.
calib.py는 실행/import하지 않고 AUTO 문자열만 읽는다(그 파일의 브라우저 실행 방지).
브라우저 실행은 총괄 담당. solo.py도 이 파일의 공통 검사 도구를 사용한다.
"""

from league_flow import finish_trial, map_key_visible
from league_flow import pass_issue_check, wait_unfolded
import ast
import json
import math
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect, sync_playwright
from league_flow import confirm_seat, select_mode

RESULTS = Path(__file__).resolve().parents[1] / "results"
SCORES = {"pop": "주민", "ind": "산업", "fin": "재정", "co2": "탄소",
          "appr": "지지", "rel": "전력 신뢰"}
POLICIES = ("taxRes", "taxInd", "service", "incentive")
# 실행기 대기 한도. 경제 모형 계수가 아니다. 검사가 멈추는 것을 막는 상한일 뿐 판정 기준이 아니다.
# 맥 로컬 기본 12초. 느린 공유 실행기(CI)는 KCP_WAIT로 늘린다(.github/workflows/ci.yml).
WAIT = int(os.environ.get("KCP_WAIT", "12000"))
# 2026-10-13: 결과 서랍 0.43~0.69초, CPU 4배 감속 2.1~2.8초. 그리기 여유 포함.
# 2026-10-17: CPU 4배 감속 전체 실행에서는 도시·도움말 서랍이 5초를 넘는 경우가 있었다(부하 116→46, 실패 5).
# 감속 실행에서는 KCP_UI_WAIT로 늘린다. 기본은 감속 없는 실행 기준이다.
UI_WAIT = int(os.environ.get("KCP_UI_WAIT", "5000"))
# 같은 측정의 새로고침→#lg-bar 최대 8.1초(4배 감속)에 부하 순간 상승 여유를 둔다.
RELOAD_WAIT = 30000

BOOT_JS = "() => !!(window.KCP && KCP.leagueCore && KCP.league && KCP.buildGame)"
HIDDEN_JS = r"""el => {
  if (!el.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true})) return true;
  if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") return true;
  for (let n = el; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (n.hidden || s.display === 'none' || s.visibility === 'hidden' ||
        s.visibility === 'collapse') return true;
  }
  return false;
}"""
OVERFLOW_JS = """() => Math.max(document.documentElement.scrollWidth,
  document.body.scrollWidth) - document.documentElement.clientWidth"""
HOST_JS = "() => KCP.league.state().S"
SYNC_JS = """([round, phase]) => {
  const L = KCP.league.state(), V = L && (L.S || L.snap);
  return !!V && V.round === round && V.phase === phase;
}"""
SEED_JS = """turns => {
  const C = KCP.leagueCore, ids = ['pyeongtaek', 'dangjin'];
  const room = turns ? 'ECNF22' : 'SEAS22', now = Date.now();
  const S = C.newState(room, 'south', now, ids, turns ? {turns} : null);
  C.reduce(S, {type:'claim', team:ids[1], token:'fixture-computer'}, now, KCP.buildGame);
  if (turns) C.reduce(S, {type:'econ', team:ids[1], token:'fixture-computer',
    taxRes:2, taxInd:2, service:-2, incentive:0}, now, KCP.buildGame);
  const net = {kind:'local'};
  localStorage.setItem('kcp-league-net-v1', JSON.stringify(net));
  localStorage.setItem('kcp-league-host-v1', JSON.stringify({room, net, state:S}));
  return {room, ids, team:ids[0]};
}"""
PLAN_JS = """() => {
  // calib.py의 연결 경로를 쓰되 이주를 관찰할 수 있도록 한 팀만 설비를 짓는다.
  KCP.league.plan(st => {
    const BG = KCP.buildGame, P = window.__auto('pyeongtaek');
    const connected = new Set(P.lines.flatMap(L => L.p));
    const candidates = BG.TILES.filter(t => !t.out && t.site < 0 &&
      !BG.siteRule('diesel', t) && t.nb.some(i => connected.has(i)));
    P.builds = candidates.slice(0, 6).map(t => ({t:'diesel', i:t.i}));
    candidates.slice(0, 6).forEach(t => {
      P.lines.push({p:[t.nb.find(i => connected.has(i)), t.i]});
    });
    Object.assign(st, P);
  });
}"""
RANK_JS = r"""() => {
  // ECON-UI v1.1: 표의 행·열 대신 계약의 팀 행·부분 점수 meter·총점을 읽는다.
  const root = document.querySelector('#lg-rank');
  if (!root) return {rows:[]};
  const keys = ['pop', 'ind', 'fin', 'co2', 'appr', 'rel'];
  const rows = [...root.querySelectorAll('[data-team]')].map(n => ({
    id:n.dataset.team,
    parts:[...n.querySelectorAll('[data-part]')].map(p => p.dataset.part),
    values:Object.fromEntries(keys.map(key => [key,
      [...n.querySelectorAll(`[data-part="${key}"] meter[value]`)]
        .map(m => m.getAttribute('value'))])),
    totals:[...n.querySelectorAll('[data-total]')].map(t => t.innerText)
  }));
  return {rows};
}"""
POLICY_JS = """([id, key, expected]) => {
  const S = KCP.league.state().S, P = S.teams[id].econPol;
  return !!P && (key === "re100" ? !!P[key] === expected : P[key] === expected);
}"""
CRIT_JS = """id => {
  const S = KCP.league.state().S;
  return !!S.teams[id].crit;
}"""
NEXT_JS = "() => { KCP.league.next(); }"


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
            detail = str(exc).splitlines()[0][:200]
            return self.ok(False, f"{label} ({type(exc).__name__}: {detail})")

    def finish(self):
        print(f"checks {self.count} fail {self.failed}", flush=True)
        return 1 if self.failed else 0


def local_address(argv):
    base = argv[1] if len(argv) > 1 else "http://127.0.0.1:9430/index.html"
    url = urlsplit(base)
    if url.scheme not in ("http", "https") or url.hostname not in (
            "localhost", "127.0.0.1", "::1") or url.username or url.password:
        raise ValueError("외부 네트워크 금지: loopback 주소만 사용할 수 있습니다")
    return base.split("#", 1)[0]


def context_for(browser, base, width, height, scheme):
    context = browser.new_context(viewport={"width": width, "height": height},
                                  locale="ko-KR", color_scheme=scheme,
                                  service_workers="block")
    context.set_default_timeout(WAIT)
    context.set_default_navigation_timeout(WAIT)
    context.add_init_script("""(() => {
      const apply = () => { document.documentElement.dataset.theme = %s; };
      if (document.documentElement) apply();
      else document.addEventListener('DOMContentLoaded', apply, {once:true});
    })();""" % json.dumps(scheme))
    origin = urlsplit(base)
    external = []

    def route(request_route):
        url = urlsplit(request_route.request.url)
        if (url.scheme, url.netloc) == (origin.scheme, origin.netloc):
            request_route.continue_()
        elif url.hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
            # 외부 전송 금지. 기존 Google Fonts CSS는 빈 응답 → 로컬 대체 폰트.
            request_route.fulfill(status=200, content_type="text/css", body="")
        else:
            external.append(url.hostname or url.scheme)
            request_route.abort()

    context.route("**/*", route)
    # local 리그는 BroadcastChannel. 웹소켓은 서버에 연결하기 전에 막는다.
    context.route_web_socket("**/*", lambda ws: (external.append("websocket"), ws.close()))
    return context, external


def monitored_page(context):
    page = context.new_page()
    events = {"error": [], "warning": [], "pageerror": []}
    page.on("console", lambda message: events[message.type].append(message.text)
            if message.type in ("error", "warning") else None)
    page.on("pageerror", lambda error: events["pageerror"].append(str(error)))
    return page, events


def shown(page, selector):
    nodes = page.locator(selector)
    return nodes.count() > 0 and any(
        not nodes.nth(i).evaluate(HIDDEN_JS) and nodes.nth(i).is_visible()
        for i in range(nodes.count()))


def absent_or_hidden(page, selector):
    # tests.md: 폭 0을 hidden으로 오인하지 않는다.
    nodes = page.locator(selector)
    return all(nodes.nth(i).evaluate(HIDDEN_JS) for i in range(nodes.count()))


def wait_ui(page, condition, arg=None):
    """조건이 참이면 즉시 진행한다. 시간 초과 뒤에도 기존 이름·기대값으로 판정한다."""
    try:
        page.wait_for_function(condition, arg=arg, timeout=UI_WAIT)
    except PlaywrightTimeoutError:
        return False
    return True


def wait_shown(page, selector):
    # shown의 숨김·폭 조건을 그대로 기다리고, 그 한 번의 페이지 안 판정을 결과로 쓴다. 부재 검사는 기존 shown을 사용한다.
    # 기다린 뒤 shown()을 다시 부르면 개수·요소별 확인이 여러 번 왕복하는 사이 서랍 다시 그리기의 중간 상태를 읽는다.
    # 2026-10-21 CPU 4배 감속 계측: 기다림이 참이 된 직후 shown()만 거짓 4회(.lg-grp·#lg-fiscal·#lg-evidence-direction·
    # #lg-predict), 같은 동안 프레임마다 잰 페이지 안 판정은 계속 '보임' — 화면에 숨는 순간은 없었다.
    return wait_ui(page, "selector => [...document.querySelectorAll(selector)].some(el => "
                   "!(" + HIDDEN_JS + ")(el) && el.getBoundingClientRect().width > 0 && "
                   "el.getBoundingClientRect().height > 0)", selector)


def wait_count(page, selector, count):
    wait_ui(page, "([selector, count]) => document.querySelectorAll(selector).length === count",
            [selector, count])
    return page.locator(selector).count()


def wait_text(page, selector, text):
    try:
        expect(page.locator(selector)).to_contain_text(text, timeout=UI_WAIT)
    except AssertionError:
        pass  # 시간 초과 뒤 기존 판정이 실패를 기록한다.
    return page.locator(selector).inner_text()


def open_panel(page, name):
    wait_unfolded(page)
    button = page.locator(f'#lg-bar [data-panel="{name}"]')
    wait_count(page, f'#lg-bar [data-panel="{name}"]', 1)
    if button.count() != 1:
        raise AssertionError(f"{name} 서랍 버튼 1개 필요")
    if button.get_attribute("aria-expanded") != "true":
        button.click()
    # 서랍 종류·제목·본문이 함께 그려진 뒤 검사한다.
    title = {"deal": "사건·거래", "result": "결과", "journal": "일지", "city": "도시",
             "rank": "순위", "tech": "연구", "help": "도움말"}[name]
    page.wait_for_function("""([name, title]) => {
      const panel = document.querySelector('#lg-panel');
      const heading = panel?.querySelector('.lg-ptabs strong');
      const body = panel?.querySelector('.lg-pbody');
      return panel?.dataset.tab === name && heading?.textContent === title &&
        body?.checkVisibility({visibilityProperty:true}) && !!body.textContent.trim();
    }""", arg=[name, title], timeout=UI_WAIT)
    # 서랍을 열면 지도 배치가 requestAnimationFrame으로 미뤄진다(build.js resize → request). 두 프레임을 기다린다.
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    if name == "result":
        # 기존 숫자 기대값을 유지하며 세 단계의 결과 내용을 명시적으로 펼친다.
        # 결과 서랍(결과 단계)의 S8 아래 상세는 '이번 달 자세히'(#lg-month-details) 접힘 안에 있다(품질8 UX, 2026-10-21). 먼저 연다.
        for key in ("lg-last-month", "lg-month-details", "lg-result-reasons", "lg-result-details"):
            detail = page.locator("#" + key)
            if detail.count() and not detail.evaluate("el => el.open"):
                detail.locator(":scope > summary").click()


def screenshot(checks, page, name):
    def capture():
        RESULTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(RESULTS / name), full_page=True)
        return True
    checks.test(f"캡처 {name}", capture)


def overflow(checks, page, label):
    checks.test(f"{label} 가로 스크롤 0", lambda: page.evaluate(OVERFLOW_JS) <= 0)


def diagnostics(checks, events, label):
    for kind in ("error", "warning", "pageerror"):
        checks.ok(not events[kind],
                  f"{label} {kind} 0" + (f": {events[kind][:2]}" if events[kind] else ""))


def mission_status(checks, page, expected, label, selector='#lg-learning-mission', preview=False):
    """대기·계획 미리보기·확정 판정을 구분하며 달성과 미달성을 혼동하지 않는다."""
    text = page.locator(selector).inner_text()
    marker = '(지금 계획 기준, 준비하면 확정)'
    if selector == '#lg-previous-mission':
        checks.ok(text == '지난달 학습 미션: ' + expected + (marker if preview else ''),
                  label + f' 지난달 판정 문구·꼬리 완전 일치 [V3A-fix4] (실제: {text})')
    checks.ok(text.endswith(marker) if preview else marker not in text,
              label + ' 계획 미리보기 표지 구분 [V3A-fix3]')
    if preview:
        text = text.replace(marker, '')
    text = text.split(':', 1)[-1].strip(' \n·:—-')
    # 어긋남 설명이 같은 문단/다음 줄 어디에 있든 상태 자체는 미달성이어야 한다.
    valid = text == expected or (expected == '미달성' and bool(re.fullmatch(
        r'미달성\s*[·:—-]?\s*말과 실제 변경이 달라요', text)))
    checks.ok(valid, f'{label} 학습 미션 = {expected} (실제: {text})')


def learning_note(page, month):
    return page.evaluate("""month => {
      const l=KCP.league.state();
      const d=l.role==='solo' ? JSON.parse(localStorage.getItem('kcp-league-solo-v1')).interview :
        JSON.parse(localStorage.getItem(`kcp-league-data-v1:${l.room}:${l.team}`));
      return d?.interview?.months?.[month] || {};
    }""", month)


def confirmed_plan(checks, page, month, changed, basis, label):
    note = learning_note(page, month)
    checks.ok(note.get('followingPlanChanged', 'missing') is changed,
              label + f' followingPlanChanged = {changed} [V3A-fix3]')
    checks.ok(note.get('followingPlanBasis') == basis,
              label + f' 확정 시점 = {basis} [V3A-fix3]')
    checks.ok('followingPlanConfirmedChanged' not in note,
              label + ' 별도 확정 필드 없음 [V3A-fix3]')


def pending_mission(checks, page, month, label, final=False, check_text=True):
    note = learning_note(page, month)
    checks.ok('followingPlanChanged' in note and note['followingPlanChanged'] is None,
              label + ' 새 기록 followingPlanChanged:null [V3A A1]')
    confirmed_plan(checks, page, month, None, None, label)
    if final:
        checks.ok(note.get('finalMonth') is True, label + ' 마지막 달 기록 finalMonth:true')
    if check_text:
        mission_status(checks, page, '마지막 달이라 판정 없음' if final else '다음 달 계획에서 확인해요', label)


def automatic_plan():
    module = ast.parse(Path(__file__).with_name("calib.py").read_text())
    return next(ast.literal_eval(node.value) for node in module.body
                if isinstance(node, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id == "AUTO" for t in node.targets))


def setup_pair(context, base, turns, pages, seed_js=SEED_JS):
    host, events_h = monitored_page(context)
    pages.append((host, events_h, "진행자"))
    host.goto(base + "#home", timeout=RELOAD_WAIT)
    host.wait_for_function(BOOT_JS, timeout=RELOAD_WAIT)
    fixture = host.evaluate(seed_js, turns)
    host.goto(base + "#league/host", timeout=RELOAD_WAIT)
    host.wait_for_selector("#lg-roomcode", timeout=RELOAD_WAIT)
    fixture["room"] = host.inner_text("#lg-roomcode").replace("-", "").strip()
    team, events_t = monitored_page(context)
    pages.append((team, events_t, "팀"))
    team.goto(base + "#league", timeout=RELOAD_WAIT)
    team.wait_for_selector('.lg-modes [data-mode="join"]', timeout=RELOAD_WAIT)
    select_mode(team, "join")
    team.fill("#lg-code", fixture["room"])
    team.click("#lg-join")
    confirm_seat(team, fixture["team"])
    return host, team, fixture


def advance(host, team, round_number, phase):
    host.evaluate(NEXT_JS)
    host.wait_for_function(SYNC_JS, arg=[round_number, phase])
    team.wait_for_function(SYNC_JS, arg=[round_number, phase])
    # 상태 수신 뒤 현재 단계가 화면에도 그려져야 부재 검사가 이전 화면에서 통과하지 않는다.
    phase_text = {"plan": "계획·협상", "review": "결과·일지", "end": "끝"}[phase]
    expect(team.locator('#lg-bphase')).to_have_text(phase_text, timeout=UI_WAIT)
    if host.evaluate('() => !!KCP.league.state().S.econ'):
        expect(host.locator('.lg-phase-chip')).to_have_text(phase_text, timeout=UI_WAIT)


def disabled_policies(page):
    wait_ui(page, """keys => keys.every(key => {
      const nodes = [...document.querySelectorAll(`#lg-city [data-pol="${key}"]`)];
      return nodes.length > 0 && nodes.every(el => el.disabled);
    })""", list(POLICIES))
    return all(page.locator(f'#lg-city [data-pol="{key}"]').count() > 0 and
               all(page.locator(f'#lg-city [data-pol="{key}"]').nth(i).is_disabled()
                   for i in range(page.locator(f'#lg-city [data-pol="{key}"]').count()))
               for key in POLICIES)


def change_policy(team, host, team_id, key):
    nodes = team.locator(f'#lg-city [data-pol="{key}"]')
    if not nodes.count():
        return False
    node = nodes.first
    if node.evaluate("el => el.tagName === 'INPUT' && el.type === 'range'"):
        current = float(node.input_value())
        low = float(node.get_attribute("min") or 0)
        high = float(node.get_attribute("max") or 100)
        node.focus()
        node.press("ArrowRight" if current < high else "ArrowLeft")
        expected = float(node.input_value())
        if expected == current or not low <= expected <= high:
            return False
    elif node.evaluate("el => el.tagName === 'INPUT' && el.type === 'number'"):
        current = float(node.input_value())
        maximum = node.get_attribute("max")
        expected = current - 1 if maximum is not None and current >= float(maximum) else current + 1
        node.fill(str(expected))
        node.press("Tab")
    else:
        # U1는 range 또는 5단 버튼을 허용한다. 버튼은 숫자 레이블/값으로 읽는다.
        candidates = [nodes.nth(i) for i in range(nodes.count())
                      if nodes.nth(i).get_attribute("aria-pressed") != "true"]
        if not candidates:
            return False
        node = candidates[0]
        value = node.get_attribute("value") or node.inner_text().replace("−", "-")
        number = re.search(r"[-+]?\d+(?:\.\d+)?", value)
        if not number:
            return False
        expected = float(number.group())
        node.click()
    host.wait_for_function(POLICY_JS, arg=[team_id, key, expected])
    return True


def rank_checks(checks, page, ids, label):
    # // ECON-UI v1.1: 익명 표시 여부와 무관하게 data-team으로 활성 도시를 식별한다.
    checks.test(f"{label} U2 #lg-rank 표시", lambda: wait_shown(page, "#lg-rank"))
    wait_count(page, '#lg-rank [data-team]', len(ids))
    snapshot = page.evaluate(RANK_JS)
    checks.ok(len(snapshot["rows"]) == len(ids), f"{label} U2 순위 행 = 활성 팀 {len(ids)}개")
    for team_id in ids:
        checks.ok(sum(row["id"] == team_id for row in snapshot["rows"]) == 1,
                  f"{label} U2 활성 도시 {team_id} 순위 1행")
    checks.ok(bool(snapshot["rows"]) and all(
        sorted(row["parts"]) == sorted(SCORES) for row in snapshot["rows"]),
        f"{label} U2 각 행 부분 점수 정확히 6종")
    # // ECON-UI v1.1: 총점은 [data-total]에서, 부분 점수는 meter의 원래 value에서 확인한다.
    totals_valid = bool(snapshot["rows"])
    for row in snapshot["rows"]:
        value = re.search(r"(?<![\d.])-?\d+(?:\.\d+)?", row["totals"][0]) if len(row["totals"]) == 1 else None
        totals_valid = totals_valid and bool(value) and math.isfinite(float(value.group()))
    checks.ok(totals_valid, f"{label} U2 각 행 총점 1개·유한 숫자")
    for key, title in SCORES.items():
        valid = bool(snapshot["rows"])
        for row in snapshot["rows"]:
            values = row["values"][key]
            try:
                value = float(values[0]) if len(values) == 1 else math.nan
            except ValueError:
                value = math.nan
            valid = valid and math.isfinite(value) and 0 <= value <= 100
        checks.ok(valid, f"{label} U2 부분 점수 {key}({title}) 각 행 0–100")


def crit_safe(value):
    # U4는 전송 필드 이름을 정하지 않았다. 필드명 스키마를 새로 강제하지 않고
    # 모든 깊이에서 자유 서술용 키를 거부하며 값도 칩·유한 숫자·유지/바꿈만 허용.
    prose_keys = re.compile(r"reason|why|text|memo|note|free|essay|body|description|"
                            r"comment|content|reflection|이유|서술|메모|내용", re.I)
    tokens = set(SCORES) | {"keep", "change", "유지", "바꿈"}
    leaves = []
    chip_keys = set()

    def visit(item):
        if isinstance(item, dict):
            chip_keys.update(set(item) & set(SCORES))
            return bool(item) and all(isinstance(key, str) and not prose_keys.search(key)
                                      for key in item) and all(visit(v) for v in item.values())
        if isinstance(item, list):
            return all(visit(v) for v in item)
        leaves.append(item)
        return (isinstance(item, bool) or
                isinstance(item, (int, float)) and math.isfinite(item) or
                isinstance(item, str) and item in tokens)

    return isinstance(value, dict) and visit(value) and any(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in leaves) and (
            "pop" in leaves or "pop" in chip_keys)


def choose_crit(team, host, team_id):
    root = team.locator("#lg-crit")
    if not root.count():
        return False
    # 칩의 data 속성은 미지정이므로 명세의 한국어 표시명으로 조작한다.
    chip = root.get_by_role("button", name=re.compile("주민"))
    if not chip.count():
        return False
    chip.first.click()
    wait_shown(team, '#lg-crit input[type="number"], #lg-crit input[type="range"]')
    number = root.locator('input[type="number"], input[type="range"]').first
    if not number.count():
        return False
    number.fill("1") if number.get_attribute("type") == "number" else number.press("ArrowRight")
    number.press("Tab")
    # 가상 문자열을 기기 입력에 넣어도 진행자에게 전송되어서는 안 된다(D-59).
    prose = root.locator('textarea, input[type="text"]')
    for i in range(prose.count()):
        prose.nth(i).fill("검사용 자유 서술은 기기에만 저장")
        prose.nth(i).press("Tab")
    save = root.get_by_role("button", name=re.compile("^(저장|확정|적용|기준 저장|기준 정하기)$"))
    if save.count() and save.first.is_visible():
        save.first.click()
    host.wait_for_function(CRIT_JS, arg=team_id)
    host.wait_for_timeout(400)  # tests.md: 250ms 지연 저장 뒤 확인.
    return crit_safe(host.evaluate("id => KCP.league.state().S.teams[id].crit", team_id))


def migration_caption(host, flows):
    details = host.locator("#lg-host-details")
    if not details.evaluate("el => el.open"):
        details.locator(":scope > summary").click()
    host.wait_for_selector("#lg-mapcap")
    names = host.evaluate("() => Object.fromEntries(Object.entries(KCP.ECON_DATA.start).map(([k,v]) => [k,v.name]))")
    top = sorted(flows, key=lambda flow: flow["n"], reverse=True)[:3]
    for flow in top:
        wait_text(host, '#lg-mapcap', re.compile(
            re.escape(names[flow['from']]) + r'\s*→\s*' + re.escape(names[flow['to']]) +
            r'\s+[\d,.]+\s*명\s*[:：]\s*\S'))
    text = host.locator("#lg-mapcap").inner_text()
    return wait_shown(host, "#lg-mapcap") and all(re.search(
        re.escape(names[flow["from"]]) + r"\s*→\s*" + re.escape(names[flow["to"]]) +
        r"\s+[\d,.]+\s*명\s*[:：]\s*\S", text) for flow in top)


def u_plan_contract(checks, team, host, tid, label):
    checks.ok(not shown(team, '#lg-panel'), f'{label} U1 첫 달 지도 앞에 일지 자동 열림 없음')
    team.locator('#bd-help').focus(); team.locator('#bd-help').press('Enter')
    wait_text(team, '#lg-help', '순위')
    checks.ok(wait_shown(team, '#lg-help') and all(word in team.locator('#lg-help').inner_text()
              for word in ('배치', '송전', '시험 운전', '준비', '사건·거래',
                           '사건을 보고 대응, 전기값, 연계선을 정해요.',  # 명세 B4 도움말 설명
                           '지역 지도', '연구', '결과', '일지', '도시', '순위')),
              f'{label} U1 리그 전용 도움말·네 단계·막대 설명')
    team.locator('#lg-panel').press('Escape')
    wait_ui(team, "() => document.querySelector('#bd-help') === document.activeElement")
    checks.ok(not shown(team, '#lg-panel') and team.locator('#bd-help').evaluate('el => el === document.activeElement'),
              f'{label} U1 도움말 Escape 닫기·포커스 복귀')
    team.locator('#bd-help').click()
    team.locator('#lg-help').wait_for(state='visible', timeout=UI_WAIT)  # 본문 뒤 금지 문구 검사.
    checks.ok('처음부터' not in team.locator('#lg-help').inner_text(), f'{label} U2 멀티 도움말에 혼자 다시 시작 설명 없음')
    team.locator('#lg-build-help').click()
    wait_text(team, '#bd-help-dlg', '자료와 가정')
    checks.ok(team.locator('#bd-help-dlg').is_visible() and '자료와 가정' in team.locator('#bd-help-dlg').inner_text(), f'{label} U2 원래 자료·모형 도움말 경로 유지')
    # <dialog>의 close 이벤트는 닫힌 뒤 따로 온다. 그 처리기가 초점을 도움말 버튼으로 되돌리므로,
    # 기다리지 않으면 아래 Enter가 남은 돈 칩이 아니라 도움말 버튼에 갈 수 있다(2026-10-21 4회 중 3회 close 전 Enter).
    team.evaluate("""() => { window.__helpClosed = false;
      document.getElementById('bd-help-dlg').addEventListener('close', () => { window.__helpClosed = true; }, { once: true }); }""")
    team.locator('#bd-help-dlg').press('Escape')
    wait_ui(team, "() => window.__helpClosed === true")
    team.locator('[data-cap="budget"]').focus(); team.locator('[data-cap="budget"]').press('Enter')
    # 2026-10-13: 390폭 24회 중 1회 Enter 직후에는 없고 300ms 뒤에 열렸다.
    checks.ok(wait_shown(team, '.lg-left'), f'{label} U5 HUD 남은 돈 키보드로 거래 서랍')
    team.locator('.lg-px').click()
    group = team.locator('#bd-root [data-group="ren"]')
    if group.count(): group.click()
    tool = team.locator('#bd-root [data-tool="solar"]:visible').first
    tool.focus(); tool.press('Enter')
    wait_ui(team, """() => ['complaints', 'grid'].every(key =>
      document.querySelector(`[data-lens="${key}"]`)?.getAttribute('aria-pressed') === 'true')""")
    checks.ok(all(team.locator(f'[data-lens="{key}"]').get_attribute('aria-pressed') == 'true'
              for key in ('complaints', 'grid')), f'{label} U3 설비 선택 시 민원·전력망 자동 렌즈')
    # 렌즈 글은 다음 그리기 때 채워진다.
    wait_ui(team, "() => { const g = document.querySelector('#lg-lens-grid'); return g && !g.hidden && g.textContent.trim() }")
    with map_key_visible(team, '#lg-lens-grid'):  # rev12 Q2: 좁은 계획만 펼친 뒤 같은 줄 검사.
        checks.ok(wait_shown(team, '#lg-lens-grid'), f'{label} U3 계산한 접속 여유 미리보기')
    team.locator('[data-lens="complaints"]').focus(); team.locator('[data-lens="complaints"]').press('Enter')
    wait_ui(team, "() => document.querySelector('[data-lens=complaints]')?.getAttribute('aria-pressed') === 'false'")
    checks.ok(team.locator('[data-lens="complaints"]').get_attribute('aria-pressed') == 'false',
              f'{label} U3 민원 렌즈 키보드 끄기')
    if group.count(): group.click()
    team.locator('[data-tool="solar"]').click()
    checks.ok(team.locator('[data-lens="complaints"]').get_attribute('aria-pressed') == 'false',
              f'{label} U2 도구 재선택에도 학생이 끈 렌즈 유지')
    checks.ok(all(team.locator('[data-run]').nth(i).inner_text().startswith('시험 ') for i in range(team.locator('[data-run]').count())),
              f'{label} U2 시험 단추 실제 글자')
    # 품질8 UX ③(docs/QUALITY-ux.md 8.5): 지지·주민 변화 칩은 '도시' 서랍과 같은 곳을 여는 중복 단추라 글자 표시로 바꿨다.
    # rev10 R4(검토 반영, 총괄 수정): +n 단추는 세지 않고 배지(data-watch-order)만 최대 셋. 잘림·터치 크기는 rev10.py.
    checks.ok(team.locator('#lg-watch [data-watch-order]').count() <= 3 and wait_count(team, '#lg-hud-chips > span', 2) == 2,
              f'{label} U4 이번 달 배지 최대 셋·지지·주민 칩')
    checks.ok(not shown(team, '.lg-bmoney') and not shown(team, '[data-tab="mission"]'),
              f'{label} U4·U7 남은 돈 중복·리그 미션 0/2 숨김')
    team.locator('#bd-help').click()
    wait_shown(team, '#lg-sound')
    checks.ok(team.locator('#lg-sound').get_attribute('aria-pressed') == 'false', f'{label} U7 소리 기본 꺼짐')
    team.locator('#lg-sound').click()
    wait_ui(team, "() => localStorage.getItem('kcp-league-sound-v1') === 'true'")
    checks.ok(team.evaluate("localStorage.getItem('kcp-league-sound-v1') === 'true'"), f'{label} U7 소리 켜기는 기기에만 저장')
    team.locator('#lg-sound').click()
    team.locator('#lg-panel [data-pclose]').click()
    open_panel(team, 'city')
    # 품질8 UX U1(docs/QUALITY-ux.md 6절): 스크롤은 서랍 본문 .lg-pbody가 맡는다(없으면 서랍 자체).
    team.locator('#lg-panel').evaluate("el => {(el.querySelector('.lg-pbody')||el).scrollTop=500}")
    open_panel(team, 'result')
    checks.ok(team.locator('#lg-panel').evaluate("el => (el.querySelector('.lg-pbody')||el).scrollTop===0"), f'{label} U2 새 결과 서랍은 위에서 시작')
    open_panel(team, 'city')
    checks.ok(wait_count(team, '#lg-trends [data-trend]', 4) == 4, f'{label} U5 도시 추이 네 줄')
    checks.ok('주민·기업 이동 시간 ×' in wait_text(team, '#lg-city', '주민·기업 이동 시간 ×'), f'{label} U9 배속 대상·현실 달 문구')
    # Missing recalibration fields add no false zeros or warnings; injected report stays on this device.
    checks.ok(team.evaluate("""() => {
      const V=KCP.league.state().snap, id=KCP.league.state().team;
      const c=V.econ.report?.cities?.[id], f=V.econ.report?.fiscal?.[id];
      return [['#lg-bio-co2',Number.isFinite(c?.bioCo2)],
        ['#lg-co2-intensity',Number.isFinite(c?.co2Intensity)],
        ['#lg-resident-net',Number.isFinite(f?.perResidentNet)],
        ['#lg-debt-warning',['warn','crisis'].includes(f?.debtStage)]]
        .every(([selector,present]) => !!document.querySelector(selector) === present);
    }"""), f'{label} U9 새 엔진 필드는 있을 때만 표시')
    ui = team.evaluate("""() => {
      const m=KCP.league.uiMath;
      const report={cities:{x:{bioCo2:2,co2Intensity:.25}},fiscal:{x:{perResidentNet:-.000001,debtStage:'warn'}}};
      const html=m.recalHTML(report,'x');
      return {html, speed:m.speedText({speeds:{monthsPerTurn:1.5},eduSpeed:99}),
        reason:m.migrationReason({from:KCP.league.state().team,to:KCP.league.state().team,why:'집값이 올라서 (M)',whyGrade:'M'})};
    }""")
    checks.ok(all(word in ui['html'] for word in ('바이오 CO₂ 2 t(국가 총량 밖 · IPCC 정보 항목)', '공급 1MWh당, 지연 평균', '−100 게임 원', '지방재정법 시행령 제65조의3', '2026.1.2 시행')),
              f'{label} U9 재보정 필드·재정 음수 부호·법령 문턱')
    # D-72(품질8 UX U9): 학생 기본 화면의 등급 글자는 학생 말(KCP.gradeWords)로 보인다.
    checks.ok(team.evaluate("() => KCP.league.uiMath.migrationReason({from:KCP.league.state().team,to:KCP.league.state().team,why:'생활 조건'}).includes(KCP.gradeWords('G'))"),
              f'{label} U2 이전 엔진 이주 이유 게임 가정 표시 유지')
    checks.ok('정수 반올림' not in team.locator('#lg-city').inner_text(), f'{label} U2 내부 용어 숨김')
    # D-72: '(M)'·'(추정·G)' 대신 학생 말. 근거 표시가 한 번만 붙고 추정·게임 가정 겹침이 없는지 본다.
    checks.ok('×1.5' in ui['speed'] and '99' not in ui['speed'] and ui['reason'].count('모형 계산') == 1 and '(추정' not in ui['reason']
              and '(M)' not in ui['reason'] and '(G)' not in ui['speed'],
              f'{label} U9 monthsPerTurn 우선·whyGrade 한 번')
    team.locator('.lg-px').click()
    team.locator('#lg-ready').click()
    pass_issue_check(team)
    wait_shown(team, '#lg-predict')
    wait_ui(team, """() => {
      const card = document.querySelector('#lg-predict'), panel = document.querySelector('#lg-panel');
      if (!card || !panel) return false;
      const r = card.getBoundingClientRect(), p = panel.getBoundingClientRect();
      return r.top >= p.top && r.top < p.bottom;
    }""")
    wait_ui(team, "() => document.querySelector('#lg-ready-confirm')?.disabled === true")
    wait_ui(team, "() => document.querySelector('#lg-predict [data-evidence]') === document.activeElement")
    checks.ok(team.locator('#lg-ready-confirm').is_disabled(), f'{label} U8 근거 없는 약속 제출 금지')
    checks.ok(team.locator('#lg-predict').evaluate("el => {const r=el.getBoundingClientRect(),p=document.querySelector('#lg-panel').getBoundingClientRect();return r.top>=p.top && r.top<p.bottom;}"), f'{label} U2 준비 직후 약속 카드가 서랍 안에 보임')
    checks.ok(team.locator('#lg-predict [data-evidence]').first.evaluate("el => el === document.activeElement"),
              f'{label} U2 준비 관문은 약속 근거에 바로 포커스')
    checks.ok(wait_count(team, '[data-confidence]', 3) == 3 and team.locator('#lg-predict-skip').count() == 0,
              f'{label} U8 확신 세 단계·멀티 건너뛰기 없음')
    team.locator('.lg-px').click()
    overflow(checks, team, label + ' U 새 화면')
    # Exclude overlays using the same top/bottom bounds that the map layout uses.
    checks.ok(team.evaluate("""() => {
      const top=Math.max(document.querySelector('#bd-hud').getBoundingClientRect().bottom,
        document.querySelector('#lg-bar').getBoundingClientRect().bottom,
        document.querySelector('#bd-mapbar').getBoundingClientRect().bottom);
      const bottom=document.querySelector('#bd-dock').getBoundingClientRect().top;
      return bottom-top >= innerHeight*.6;
    }"""), f'{label} U1 서랍 닫으면 지도 높이 60% 이상')
    checks.ok(wait_shown(host, '#lg-download'), f'{label} U6 진행자 기록 내려받기')
    csv = host.evaluate('() => KCP.league.uiMath.publicCSV(KCP.leagueCore.publicView(KCP.league.state().S,Date.now()))')
    import csv as csv_module
    import io
    records = list(csv_module.reader(io.StringIO(csv.lstrip('\ufeff'))))
    checks.ok(records[0][:4] == ['도시', '달', '연', '월'], f'{label} U2 CSV 연·월 열')
    if len(records) > 1:
        checks.ok(records[1][1] == '1' and records[1][4] != '', f'{label} U2 CSV 첫 달=1·정전 포함')
    checks.ok(csv.startswith('\ufeff"도시","달"') and all(word not in csv for word in ('확신', '이유', 'decision', 'askReason', 'confidence', 'token')),
              f'{label} U6 CSV 명시한 공개 숫자 열·서술과 약속 제외')


def economic(checks, context, base, label, pages):
    host, team, fixture = setup_pair(context, base, 12, pages)
    tid, ids = fixture["team"], fixture["ids"]
    checks.test(f"{label} 진행자 상세 지도·도시 카드 기본 접힘", lambda:
                wait_shown(host, "#lg-host-details > summary") and
                not host.locator("#lg-host-details").evaluate("el => el.open") and
                absent_or_hidden(host, "#lg-mapcap"))
    checks.test(f"{label} U1 로비 단계 정책 disabled", lambda:
                (open_panel(team, "city"), disabled_policies(team))[1])
    advance(host, team, 1, "plan")
    u_plan_contract(checks, team, host, tid, label)
    checks.test(f"{label} U1 #lg-bar 도시 버튼", lambda: wait_shown(team, '#lg-bar [data-panel="city"]'))
    checks.test(f"{label} U1 도시 서랍 열기", lambda: (open_panel(team, "city"), wait_shown(team, "#lg-city"))[1])
    # ECON-UI v1.2: 탐색 버튼은 막대 한 곳. 서랍은 제목·접기·닫기만 둔다.
    checks.test(f"{label} 팀 탐색 버튼 중복 없음", lambda:
                team.locator('#lg-bar [data-panel="city"]').count() == 1 and
                team.locator('[data-panel="city"]').count() == 1 and
                team.locator('.lg-ptabs [data-ptab], #lg-panel [data-ptab]').count() == 0)  # ECON-UI v1.2: 금지 대상은 서랍 안 '탭 버튼'(서랍 머리 상자의 class 이름은 무관)
    checks.test(f"{label} 팀 서랍 접기", lambda:
                (team.locator('#lg-panel-fold').click(), absent_or_hidden(team, '#lg-panel .lg-pbody'))[1])
    checks.test(f"{label} 팀 서랍 펼치기", lambda:
                (team.locator('#lg-panel-fold').click(), wait_shown(team, '#lg-city'))[1])
    checks.test(f"{label} HUD·도시 남은 돈 = 공개 left", lambda: team.evaluate("""() => {
      const V = KCP.league.state().snap, id = KCP.league.state().team;
      const expected = V.teams[id].left.toLocaleString('ko-KR', {maximumFractionDigits:1}) + '억';
      return [...document.querySelectorAll('[data-money="left"]')].every(el => el.textContent === expected);
    }"""))
    # U5 장부는 설명을 한 번으로 합쳤다. 문장 일치만 완화하고 두 화면에서
    # '남은 돈에 지방채 한도 포함'이라는 의미가 보이는 조건은 유지한다.
    debt_note = r'남은 돈[^.\n]{0,40}지방채 한도[^.\n]{0,15}포함(?!하지|되지| 안)'
    checks.ok(bool(re.search(debt_note, team.locator('#lg-city').inner_text())) and
              bool(re.search(debt_note, host.locator('.lg-host').inner_text())),
              f'{label} D-A15 팀·진행자 남은 돈에 지방채 한도 포함 설명')
    checks.test(f"{label} D-60 시작 통계 일괄 표지 없음", lambda:
                '시작값: 공식 통계' not in team.locator('#lg-city').inner_text() and
                '억 = 게임 단위' in team.locator('#lg-city').inner_text())
    groups = team.evaluate("() => Object.keys(KCP.ECON_DATA.groups)")
    checks.test(f"{label} U1 .lg-grp[data-g] 정확히 6개", lambda:
                wait_count(team, '#lg-city .lg-grp[data-g]', 6) == 6 and
                sorted(team.locator('#lg-city .lg-grp[data-g]').evaluate_all(
                    "nodes => nodes.map(n => n.dataset.g)")) == sorted(groups) and
                all(wait_shown(team, f'#lg-city .lg-grp[data-g="{key}"]') for key in groups))
    checks.test(f"{label} U1 기본 정책 4종과 RE100 지정", lambda:
                sorted(team.locator('#lg-city [data-pol]').evaluate_all(
                    "nodes => [...new Set(nodes.map(n => n.dataset.pol))]")) == sorted((*POLICIES, "re100")))
    for key in POLICIES:
        wait_ui(team, "key => {const el = document.querySelector(`#lg-city [data-pol=\"${key}\"]`); return el && !el.disabled;}", key)
        checks.test(f"{label} U1 정책 {key} 표시·활성", lambda key=key:
                    wait_shown(team, f'#lg-city [data-pol="{key}"]') and
                    not team.locator(f'#lg-city [data-pol="{key}"]').first.is_disabled())
        checks.test(f"{label} U1 정책 {key} → 진행자 econPol", lambda key=key:
                    change_policy(team, host, tid, key))
    speed = host.evaluate("() => KCP.leagueCore.publicView(KCP.league.state().S, Date.now()).econ.eduSpeed")
    checks.test(f"{label} U1 배속 ×{speed}", lambda: wait_shown(team, "#lg-city") and bool(re.search(
        r"×\s*" + re.escape(str(speed)) + r"(?![\d.])", team.locator("#lg-city").inner_text())))
    # // ECON-UI v1.1: 기준 카드는 일지 탭 안에 있으므로 확인 전에 직접 연다.
    checks.test(f"{label} U4 첫 달 #lg-crit", lambda:
                (open_panel(team, "journal"), wait_shown(team, "#lg-crit"))[1])
    checks.test(f"{label} U4 crit 객체 키·칩·숫자만 전송", lambda: choose_crit(team, host, tid))
    # ECON-NEXT §2 피드백③: 근거→예측은 기기에 저장하며 서술을 전송하지 않는다.
    team.locator('[data-evidence="grid"]').click()
    team.locator('[data-pred="uns"]').select_option('down')
    checks.ok(wait_count(team, '[data-pred]', 1) == 1, f'{label} U8 한 달 주제 지표 하나만 예측')
    team.locator('[data-confidence="fairly"]').click()
    team.locator('[data-note="decision"]').fill('가상 도시의 접속 여유를 먼저 확인한다')
    team.locator('[data-note="decision"]').press('Tab')
    checks.ok('가상 도시의 접속 여유를 먼저 확인한다' not in json.dumps(host.evaluate(HOST_JS), ensure_ascii=False),
              f"{label} 근거·예측·기준 설명은 기기에만 저장")
    # ECON-NEXT §2 U5: 두 번 관전·복귀해도 숨긴 이전 지도와 관전 id가 남지 않는다.
    other = next(city for city in ids if city != tid)
    team.locator('.lg-px').click()
    for visit in range(2):
        team.locator('#lg-bar [data-panel="region"]').click()
        team.locator(f'[data-region-city="{other}"]').click()
        team.wait_for_selector('#lg-peek-back', timeout=WAIT)  # 지도 전체를 다시 그린다(서랍 열기보다 무겁다)
        wait_ui(team, "selectors => selectors.every(s => document.querySelectorAll(s).length === 1)",
                ['#bd-root', '#lg-peek', '#lg-peek-region', '#lg-peek-back', '#lg-ready'])
        checks.ok(all(team.locator(selector).count() == 1 for selector in
                      ('#bd-root', '#lg-peek', '#lg-peek-region', '#lg-peek-back', '#lg-ready')),
                  f"{label} 관전 {visit + 1}회 지도·id 중복 0")
        team.locator('#lg-peek-region').click()
        team.locator('#lg-region-back').click()
        team.locator('#lg-bar:not(.lg-awaybar)').wait_for(state='visible', timeout=WAIT)  # 지역 막대도 id가 lg-bar다
        checks.ok(team.locator('#bd-root').count() == 1 and team.locator('#lg-ready').count() == 1,
                  f"{label} 관전 {visit + 1}회 복귀 지도·준비 id 중복 0")
    open_panel(team, 'journal')
    checks.ok(team.locator('[data-note="decision"]').input_value() == '가상 도시의 접속 여유를 먼저 확인한다',
              f"{label} 관전·복귀 후 기준 설명 보존")
    overflow(checks, team, label + " 계획 도시 서랍")
    overflow(checks, host, label + " 계획 진행자")
    screenshot(checks, team, f"econui-{label}-team-plan.png")
    # 허용된 규칙 엔진 fixture. solo.py에서는 이런 상태/계획 주입을 하지 않는다.
    # // ECON-UI v1.1: AUTO의 함수 값이 자동 호출되지 않도록 정의만 실행한다.
    team.evaluate("() => {" + automatic_plan() + "}")
    team.evaluate(PLAN_JS)
    host.wait_for_function("id => !!KCP.league.state().S.teams[id].plan", arg=tid)
    migration_months = 0
    for month in range(1, 13):
        if month > 1:
            advance(host, team, month, "plan")
            if month == 2:
                team.wait_for_function("() => document.querySelector('#lg-map-result')?.dataset.faded === 'true'")
                checks.ok(team.locator('#lg-map-result').get_attribute('data-faded') == 'true', f'{label} U2 다음 달 계획에 지난 결과 흐리게 유지')
                open_panel(team, 'journal')
                mission_status(checks, team, '달성', label + ' 다음 달 유지·변경 없음',
                               '#lg-previous-mission', preview=True)
                checks.ok(learning_note(team, 1).get('followingPlanChanged', 'missing') is None,
                          label + ' 유지·변경 없음 미리보기는 준비 전 미확정 [V3A-fix2]')
                confirmed_plan(checks, team, 1, None, None, label + ' 계획 미리보기')
        advance(host, team, month, "review")
        if month == 2:
            confirmed_plan(checks, team, 1, False, 'result', label + ' 유지·변경 없음 운영 뒤')
        if month == 1:
            team.locator('#lg-result-heading').wait_for(state='visible', timeout=WAIT)
            # D-74: 계통이 메운 달에는 '계통이 메운 전기' 칸(data-grid-fill)이 붙는다. 고정 숫자 셋은 그대로 센다.
            checks.ok(wait_count(team, '#lg-result-deltas > div:not([data-grid-fill])', 3) == 3 and
                      team.locator('#lg-result-reasons').count() == 1 and team.locator('#lg-result-details').count() == 1 and
                      not team.locator('#lg-result-details').evaluate('el => el.open'), f'{label} U2 결과 숫자 셋·원인·자세히 접힘')
            checks.ok(wait_shown(team, '#lg-map-result'), f'{label} U2 실제 도시 결과 지도 요약')
            checks.ok('[object Object]' not in team.locator('#lg-panel').inner_text(), f'{label} U2 결과 서랍에 객체 문자열 없음')
            # 서랍은 한 번에 하나: 모바일에서는 결과 서랍이 지도 렌즈를 덮으므로 닫고 렌즈를 누른다.
            if team.locator('#lg-panel [data-pclose]').count():
                team.locator('#lg-panel [data-pclose]').click()
            team.locator('[data-lens="result"]').click()
            # 기존 숨김 완료 조건을 유지하며 다음 그리기를 기다린다.
            wait_ui(team, "() => document.querySelector('#lg-map-result')?.hidden === true")
            checks.ok(not shown(team, '#lg-map-result'), f'{label} U2 운영 결과 렌즈 끄기')
            team.locator('[data-lens="result"]').click()
            open_panel(team, 'result')
            checks.ok(wait_shown(team, '#lg-promise-result') and wait_shown(team, '#lg-evidence-direction'),
                      f'{label} U8 예측 대 실제·근거 방향 비교')
            # rev12 E4(총괄 결정 10-29): 팀 기기에도 기기 안 확신 보정을 보인다(전송 없음). 진행자 화면 부재는 rev12.py가 확인.
            checks.ok(team.locator('#lg-calibration').count() == 1, f'{label} U8 멀티 팀 확신 보정 기기 안 기록 표시')
        alignment = team.evaluate("""() => {
          const L=KCP.league.state(), V=L.snap, id=L.team;
          const points=KCP.league.uiMath.monthPoints(V,id), hist=V.econ.cities[id].hist;
          return points.length === V.results.length && points.every(p => {
            const h=hist.find(h=>h.t+1===p.t), r=V.results.find(r=>r.round===p.t);
            return h && r && p.pop===h.pop && p.appr===h.appr && p.cash===h.cash && p.uns===r.team[id].unsPct;
          });
        }""")
        checks.ok(alignment, f'{label} U2 {month}달 추이 네 값이 같은 달 끝 상태')
        import csv as csv_module
        import io
        export = team.evaluate('() => KCP.league.uiMath.publicCSV(KCP.league.state().snap)')
        records = list(csv_module.reader(io.StringIO(export.lstrip('\ufeff'))))
        completed = [row for row in records[1:] if row[1] == str(month)]
        checks.ok(len(completed) == len(ids) and all(row[4] != '' for row in completed),
                  f'{label} U2 {month}달 CSV 모든 도시·마지막 달 정전 포함')
        open_panel(team, 'result')
        checks.test(f"{label} U4 {month}달 결과 .lg-ask ≤ 1", lambda:
                    team.locator('.lg-ask').count() <= 1)
        checks.test(f"{label} {month}달 질문 유형과 선택 버튼", lambda: team.evaluate("""() => {
          const ask = document.querySelector('.lg-ask');
          return !ask || (ask.querySelectorAll('[data-answer]').length ===
            (/^lg-[rpf]-/.test(ask.dataset.question) ? 2 : 0));
        }"""))
        if month == 1:
            pending_mission(checks, team, month, label + ' 비교 전')
            team.locator('[data-compared]').check()
            for choice, reason in (
                    ('keep', '실제 결과와 비교했고 다음 달에도 근거를 확인한다'),
                    ('keep', '정전 결과를 확인하여 다음 달에도 유지한다'),
                    ('revise', '정전 결과를 확인하여 다음 달에는 고친다')):
                team.locator(f'#lg-panel [data-answer="{choice}"]').click()
                team.locator('[data-note="askReason"]').fill(reason)
                team.locator('[data-note="askReason"]').press('Tab')
                pending_mission(checks, team, month, label + ' ' + choice + ' 응답 직후')
            # 다음 달 실제 변경이 없는 경우와 대조할 유지 약속을 남긴다.
            team.locator('#lg-panel [data-answer="keep"]').click()
            team.locator('[data-note="askReason"]').fill('정전 결과를 확인하여 다음 달에도 유지한다')
            team.locator('[data-note="askReason"]').press('Tab')
        if month == 12:
            # 이 달에는 근거·예측 약속이 없으므로 미션 UI를 기다리지 않는다.
            # 마지막 달의 확정 제외는 기기 기록으로 검증한다.
            pending_mission(checks, team, month, label + ' 마지막 달', final=True, check_text=False)
        # // ECON-UI v1.1: 결과로 자동 전환된 서랍에서 도시 탭을 직접 열어 검사한다.
        checks.test(f"{label} U1 {month}달 결과 정책 disabled", lambda:
                    (open_panel(team, "city"), disabled_policies(team))[1])
        state = host.evaluate(HOST_JS)
        flows = [flow for flow in state["results"][-1]["econ"]["flows"]["pop"] if flow["n"] > 0]
        if flows:
            migration_months += 1
            checks.test(f"{label} U2 {month}달 이주 화살표 설명", lambda flows=flows:
                        migration_caption(host, flows))
        if month == 1:
            # // ECON-UI v1.1: 지난달 돈 표도 도시 탭을 열고 기존 세입·세출 조건을 확인한다.
            checks.test(f"{label} U1 지난달 #lg-fiscal", lambda:
                        (open_panel(team, "city"), wait_shown(team, '#lg-fiscal') and
                         all(word in team.locator('#lg-fiscal').inner_text() for word in ('세입', '세출')))[1])
            rank_checks(checks, host, ids, label)
            checks.test(f"{label} U2 #lg-ticker 표시", lambda: wait_shown(host, '#lg-ticker'))
            for title in ("LNG", "환율", "수출", "해운"):
                checks.test(f"{label} U2 국제 지수 {title}", lambda title=title: wait_shown(host, '#lg-ticker') and bool(re.search(
                    re.escape(title) + r"[^\d]{0,30}\d+(?:\.\d+)?", host.locator('#lg-ticker').inner_text())))
            overflow(checks, host, label + " 결과 진행자")
            overflow(checks, team, label + " 결과 도시 서랍")
            screenshot(checks, host, f"econui-{label}-host-review.png")
            screenshot(checks, team, f"econui-{label}-team-review.png")
    checks.ok(migration_months > 0, f"{label} U2 이주 있는 달을 실제로 검사")
    advance(host, team, 12, "end")
    for selector in ('#lg-debrief', '#lg-wsim'):
        checks.test(f"{label} U4 끝 {selector}", lambda selector=selector: wait_shown(host, selector))
    # // ECON-UI v1.1: 끝 단계도 결과 탭으로 바뀌므로 도시 탭을 직접 연다.
    checks.test(f"{label} U1 끝 정책 disabled", lambda:
                (open_panel(team, "city"), disabled_policies(team))[1])
    overflow(checks, host, label + " 끝 진행자")
    overflow(checks, team, label + " 끝 팀")
    with host.expect_download() as downloaded:
        host.locator('#lg-download').click()
    checks.ok(downloaded.value.suggested_filename.endswith('.csv'), f'{label} U6 실제 CSV 파일 저장')
    open_panel(team, 'result')
    checks.ok(wait_count(team, '#lg-timeline [data-trend]', 4) == 4, f'{label} U5 끝 화면 같은 시간축 네 추이')
    screenshot(checks, host, f"econui-{label}-host-end.png")



# H-U #27: 실제 BroadcastChannel 전달만 보류한다. 앱 상태·mount를 대체하지 않는다.
HOLD_SNAP_JS = """(() => {
  const Native = window.BroadcastChannel;
  window.__huHold = sessionStorage.getItem('hu-hold-first-snap') === 'yes';
  window.__huQueued = [];
  window.__huRelease = () => {
    window.__huHold = false;
    sessionStorage.removeItem('hu-hold-first-snap');
    window.__huQueued.splice(0).forEach(fn => fn());
  };
  window.BroadcastChannel = class extends Native {
    set onmessage(handler) {
      super.onmessage = event => {
        if (window.__huHold && event.data?.ev === 'snap')
          window.__huQueued.push(() => handler(event));
        else handler(event);
      };
    }
  };
})();"""

CONTRAST_JS = """selector => {
  const color = s => (s.match(/[\\d.]+/g) || []).map(Number);
  const lum = c => c.slice(0,3).map(v => {
    v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length)
    .map(el => {
      let bg = [255,255,255];
      const chain = []; for (let n=el;n;n=n.parentElement) chain.unshift(n);
      for (const n of chain) {
        const c = color(getComputedStyle(n).backgroundColor), a = c[3] ?? 1;
        if(c.length >= 3) bg = c.slice(0,3).map((v,i) => v*a + bg[i]*(1-a));
      }
      const fg = color(getComputedStyle(el).color), a = fg[3] ?? 1;
      const f = lum(fg.slice(0,3).map((v,i) => v*a + bg[i]*(1-a))), b = lum(bg);
      return {text:el.textContent, ratio:(Math.max(f,b)+.05)/(Math.min(f,b)+.05)};
    });
}"""


def contrast(checks, page, selector, label):
    rows = page.evaluate(CONTRAST_JS, selector)
    checks.ok(bool(rows) and all(row['ratio'] >= 4.5 for row in rows),
              f"{label} #31 글자 대비 ≥4.5: " +
              ', '.join(f"{row['ratio']:.2f}" for row in rows))


def set_question(page, key, nb=None):
    page.evaluate("""([key, nb]) => {
      const L=KCP.league.state(), k=`kcp-league-data-v1:${L.room}:${L.team}`;
      const d=JSON.parse(localStorage.getItem(k)) || {};
      d.interview ||= {}; d.interview.months ||= {};
      d.interview.months[L.snap.round] ||= {};
      Object.assign(d.interview.months[L.snap.round], {ask:key, nb, quarterKey:null});
      localStorage.setItem(k,JSON.stringify(d));
    }""", [key, nb])
    open_panel(page, 'city')
    open_panel(page, 'result')


def ui_fixes(checks, context, base, label, pages):
    """H-U UI fixtures are isolated from the existing economic/solo acceptance runs."""
    host, team, fixture = setup_pair(context, base, 12, pages, SEED_JS.replace("'dangjin'", "'hwaseong'"))
    tid, other = fixture['team'], fixture['ids'][1]
    team.add_init_script(HOLD_SNAP_JS)
    # Both refresh and lobby's 이어서 must wait before mounting the first map.
    for route in ('새로고침', '이어서'):
        if route == '이어서':
            team.goto(base + '#league', timeout=RELOAD_WAIT)
            team.wait_for_selector('.lg-lobby .v2-kicker', timeout=RELOAD_WAIT)
            contrast(checks, team, '.lg-lobby .v2-kicker', label + ' 로비')
        team.evaluate("sessionStorage.setItem('hu-hold-first-snap','yes')")
        if route == '새로고침':
            team.reload(timeout=RELOAD_WAIT)
        else:
            # add_init_script runs on navigation; reload the lobby before 이어서.
            team.reload(timeout=RELOAD_WAIT)
            team.wait_for_selector('.lg-modes [data-mode="join"]', timeout=RELOAD_WAIT)
            select_mode(team, "join")
            team.locator('#lg-rejoin').click()
        team.wait_for_selector('#lg-team-wait', timeout=RELOAD_WAIT)
        checks.ok(team.locator('#bd-root').count() == 0 and
                  team.evaluate('() => KCP.league.state().snap === null'),
                  f'{label} #27 {route}: 첫 상태 전 대기·지도 없음')
        team.wait_for_function('() => window.__huQueued.length > 0', timeout=RELOAD_WAIT)
        team.evaluate('window.__huRelease()')
        team.wait_for_selector('#lg-bar', timeout=RELOAD_WAIT)
        checks.ok(wait_count(team, '#bd-root', 1) == 1 and
                  team.evaluate('id => KCP.league.state().team === id', tid),
                  f'{label} #27 {route}: 첫 상태 뒤 내 도시 지도 하나')
    checks.ok(team.locator('.bd-maps').count() == 0, f'{label} #38 지도 하나일 때 선택 상자 없음')
    advance(host, team, 1, 'plan')
    open_panel(team, 'result')
    checks.ok('한 달을 운영하면' in team.locator('#lg-panel').inner_text() and
              '라운드' not in team.locator('#lg-panel').inner_text(), f'{label} #17 첫 결과 전 달 안내')
    open_panel(team, 'city')
    checks.ok(team.locator('[data-pol="re100"]').is_disabled() and
              '🔒 RE100' in team.locator('.lg-re100').inner_text(), f'{label} #11 RE100 도입 전 잠금')
    # S8(H01 연결) 뒤 공기 값은 CO₂ 어림이 아니라 발전 PM2.5 증분 추정이다. 주석의 요지(관측 대기질이 아님)를 확인한다.
    checks.ok('관측 농도는 아니' in team.locator('#lg-city').inner_text(), f'{label} #24 도시 공기 추정 주석')
    open_panel(team, 'deal')
    checks.ok('🔒 HVDC' in team.locator('#lg-panel').inner_text() and
              team.locator('[data-kind="hvdc"]').count() == 0, f'{label} #11 HVDC 도입 전 잠금')
    open_panel(team, 'tech')
    ids = team.evaluate('() => KCP.TECH_DATA.cards.map(c => c.id)')
    for card in ids:
        button = team.locator(f'[data-tech-card="{card}"]')
        button.focus()
        button.press('Space')
        team.wait_for_selector(f'[data-tech-detail="{card}"]', timeout=UI_WAIT)
        detail = team.locator('#lg-tech-detail')
        checks.ok(detail.locator('[data-tech-source] a[href^="http"]').count() > 0 and
                  '기준연도' in detail.inner_text() and
                  detail.locator('[data-tech-source] a[href^="docs/"]').count() == 0,
                  f'{label} #12 {card} 외부 출처·연도(없으면 자료 없음 명시)')
        checks.ok('교육용 배속 ×' in detail.inner_text() or '비교값 없음' in detail.inner_text(),
                  f'{label} #23 {card} 배속 또는 비교값 없음')
        checks.ok(detail.locator('.lg-tech-effect .tag-mine').count() > 0 or card == 'h2mix',
                  f'{label} #22 {card} 효과 등급과 색 구분')
        if card == 're100':
            checks.ok('켄텍 융합전공:' in detail.inner_text() and
                      '12대 연구분야 아님' in detail.inner_text(), f'{label} #10 RE100 융합전공 구분')
        if card in ('grid', 'bms', 'nbat', 're100'):
            checks.ok(not any(text in detail.inner_text() for text in
                             ('기존 손실 개선 유지', '효과 유지', 'BMS의 몫', ';')),
                      f'{label} #23 {card} 학생용 한 문장')
    # A new coefficient must change displayed effect immediately, without editing prose.
    for card, param, value in (('tandem', 'tandemOutput', 1.237), ('ccu', 'ccuCo2', .321),
                               ('hvdc', 'hvdcCap', 1.73)):  # 옛 hvdcLoss .0173 → 새 hvdcCap 1.73, 근거 D-79: 효과는 용량 배수, 손실은 기본과 같음.
        before = team.evaluate('key => KCP.TECH_DATA.params[key].v', param)
        team.evaluate('([key,v]) => {KCP.TECH_DATA.params[key].v=v}', [param, value])
        try:
            team.locator(f'[data-tech-card="{card}"]').click()
            team.locator(f'[data-tech-detail="{card}"]').wait_for(state='visible', timeout=UI_WAIT)
            expected = f'연계선 용량 ×{value}' if card == 'hvdc' else str(value)  # 옛 손실 1.73% → 새 변경된 용량 배수 문구, 근거 D-79.
            checks.ok(expected in wait_text(team, '.lg-tech-effect', expected),
                      f'{label} #23 {card} 변경된 자료 값으로 효과 표시')
        finally:
            team.evaluate('([key,v]) => {KCP.TECH_DATA.params[key].v=v}', [param, before])
    before = team.evaluate('() => KCP.buildGame.M.batEff')
    team.evaluate('() => {KCP.buildGame.M.batEff=.79}')
    try:
        team.locator('[data-tech-card="bms"]').click()
        team.locator('[data-tech-detail="bms"]').wait_for(state='visible', timeout=UI_WAIT)
        # 품질8 UX U7c: BMS 효율은 왕복 효율로 보인다(한 방향 0.79 → 왕복 0.79² ≈ 62.4%).
        checks.ok(bool(re.search(r'왕복 효율 62(?:\.4\d*)?%', wait_text(team, '.lg-tech-effect', re.compile(r'왕복 효율 62(?:\.4\d*)?%')))), f'{label} #23 BMS 기본 효율은 현재 자료에서 읽음')
    finally:
        team.evaluate('v => {KCP.buildGame.M.batEff=v}', before)
    contrast(checks, team, '.lg-tech-effect [class^="tag-"]', label + ' 기술')
    overflow(checks, team, label + ' H-U 기술')
    # Host fixture adopts the two features; the normal public snapshot carries them.
    host.evaluate("""id => {
      const S=KCP.league.state().S, r=S.teams[id].research;
      for (const k of ['hvdc','re100']) {r.stage[k]='done'; r.adoptR[k]=S.round;}
    }""", tid)
    team.wait_for_function("""() => ['hvdc','re100'].every(k =>
      KCP.league.state().snap.teams[KCP.league.state().team].research.adopted.includes(k))""")
    open_panel(team, 'city')
    team.evaluate("""() => {
      window.__huEconRequests=[];
      const post=BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage=function(message) {
        if(message.ev==='req') { const body=KCP.leagueNet.requestBody(message.data);
          if(body?.type==='econ') window.__huEconRequests.push(body); }
        return post.call(this,message);
      };
    }""")
    toggle = team.locator('[data-pol="re100"]')
    toggle.focus(); toggle.press('Space'); toggle.press('Tab')
    host.wait_for_function(POLICY_JS, arg=[tid, 're100', True])
    checks.ok(True, f'{label} #11 키보드 RE100 켜기 → econ re100:true')
    # Refresh handles deferred drawer updates after server acknowledgement.
    open_panel(team, 'deal'); open_panel(team, 'city')
    # 서버 확인 뒤 미뤄진 서랍 갱신이 끝나기 전에 끄면 그 갱신이 조작을 덮는다(2026-10-17 재현: 고정 200ms를 뺀 뒤
    # 3/4환경에서 re100:false 요청 없음). 팀 기기가 켜짐을 받아 상자에 반영할 때까지 조건 대기한다.
    team.wait_for_function('''id => { const L = KCP.league.state();
      return L.snap?.teams?.[id]?.econPol?.re100 === true &&
        document.querySelector('[data-pol="re100"]')?.checked === true; }''', arg=tid, timeout=UI_WAIT)
    team.locator('[data-pol="re100"]').uncheck()
    team.locator('[data-pol="re100"]').press('Tab')
    host.wait_for_function(POLICY_JS, arg=[tid, 're100', False])
    checks.ok(team.evaluate('() => window.__huEconRequests.some(r => r.re100 === false)') and
              not team.locator('[data-pol="re100"]').is_checked(), f'{label} #11 RE100 끄기 → econ re100:false')
    open_panel(team, 'deal')
    proposal = team.locator(f'[data-kind="hvdc"][data-other="{other}"][data-cap="2"]')
    wait_ui(team, """other => {
      const nodes = document.querySelectorAll(`[data-kind="hvdc"][data-other="${other}"][data-cap="2"]`);
      return nodes.length === 1 && !nodes[0].disabled;
    }""", other)
    checks.ok(proposal.count() == 1 and not proposal.is_disabled(), f'{label} #11 HVDC로 제안 활성')
    # 4배 감속에서 bounding_box가 다시 그려지는 순간의 옛 노드를 잡아 None을 돌려준 기록이 있다(같은 순간
    # 새 노드는 231×44). locator로 잡은 뒤 재면 그 사이 다시 그리기로 떨어진 노드를 읽을 수 있으므로(CI 8·10차,
    # #56), 연결된 노드를 찾아 재는 일을 한 번의 페이지 안 판정으로 한다. 44px 기준은 그대로다.
    try:
        box = team.wait_for_function("""other => {
          const node = [...document.querySelectorAll(`[data-kind="hvdc"][data-other="${other}"][data-cap="2"]`)]
            .find(el => el.isConnected);
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 ? rect.toJSON() : false;
        }""", arg=other, timeout=UI_WAIT).json_value()
    except PlaywrightTimeoutError:
        box = None
    checks.ok(box and box['height'] >= 44 and box['width'] >= 44, f'{label} #11 HVDC 44px 터치')
    proposal.focus(); proposal.press('Enter')
    host.wait_for_function("""([a,b]) => KCP.league.state().S.ties.some(t =>
      [t.a,t.b].includes(a) && [t.a,t.b].includes(b) && t.kind==='hvdc' && t.st==='prop')""", arg=[tid, other])
    checks.ok(True, f'{label} #11 HVDC 제안 kind=hvdc 서버 반영')
    host.evaluate("id => {KCP.league.state().S.teams[id].plan={builds:[],lines:[],policies:[],rq:[]};}", other)  # 옛 암묵적 무계획 → 새 상대 도시 빈 계획 명시, 근거 D-74: 계통만 공급하는 사례를 실제 운영.
    # Leave another city as unseated: run anyway creates review with stale ready values.
    advance(host, team, 1, 'review')
    team.evaluate('() => {window.__huHold=true}')
    checks.ok(host.locator('#lg-host-ready, #lg-host-unready, .lg-ready').count() == 0 and
              '미준비' not in host.locator('#lg-host-summary-table').inner_text(), f'{label} #37 결과 준비 표시 없음')
    open_panel(team, 'result')
    team.evaluate("""() => {
      const L=KCP.league.state(), t=L.snap.results.at(-1).team[L.team];
      window.__huHadResearch=!!t.research;
      const r=t.research || (t.research={completed:[],eurekaNow:[]});
      window.__huCompleted=r.completed; r.completed=['mass','re100'];
    }""")
    open_panel(team, 'city'); open_panel(team, 'result')
    wait_ui(team, "() => document.querySelectorAll('.lg-tech-complete .tag-mine').length >= 2")
    checks.ok(team.locator('.lg-tech-complete .tag-mine').count() >= 2 and
              '켄텍 융합전공' in team.locator('.lg-tech-results').inner_text(),
              f'{label} #10·22 완료 소식도 융합전공·G 등급 표시')
    team.evaluate("""() => {
      const L=KCP.league.state(), t=L.snap.results.at(-1).team[L.team];
      if(window.__huHadResearch) t.research.completed=window.__huCompleted; else delete t.research;
    }""")
    checks.ok('공급한 전기 기준 감축(소비 배출, 추정)' in team.locator('#lg-coop').inner_text() and
              '정전으로 줄어든 배출은 감축에 넣지 않음' in team.locator('#lg-coop').inner_text(), f'{label} #8 감축 이름·정의')
    if team.locator('[data-event-source]').count() == 0:
        team.evaluate("""() => {
          const L=KCP.league.state(), R=KCP.leagueCore.regionOf(L.snap.region);
          const E=R.events.find(e => KCP.leagueCore.hits(R,e,L.team) && e.why && e.sources?.length);
          if(!E) throw Error('사건 출처 fixture 없음');
          L.snap.events.push({id:E.id,round:L.snap.round,x:1});
          L.snap.results.at(-1).events.push({id:E.id,round:L.snap.round,x:1});
        }""")
        open_panel(team, 'city'); open_panel(team, 'result')
    # 총괄 10-21 지시: asOf·published를 분리 표시하므로 기준연월 단언을 자료 시점으로 변경.
    checks.ok(team.locator('[data-event-source]').count() > 0 and
              team.locator('[data-event-source]').evaluate_all("""nodes => nodes.every(n =>
                n.querySelector('a[href^="http"]') && /자료 시점/.test(n.textContent) && !/자료 시점 미기재/.test(n.textContent) &&
                !n.querySelector('a[href^="docs/"]'))"""), f'{label} #12 사건 외부 출처·자료 시점')
    snapshot = team.evaluate('() => KCP.league.state().snap')
    # 옛 공급 0(dem == uns) → 새 계통만 공급, 근거 D-74 각주: 매시간 50% 계통 공급으로 경제 모드의 '공급 없음' 경로는 도달 불가, 단언 제외.
    # 옛 공급량만 비교 → 새 공개 결과로 자체 공급(dem - isolated.uns)·이웃 구매(imp)를 독립 판별, 근거 D-74. 0.01 MWh는 공개값 소수 둘째 자리 반올림 허용차.
    grid_only_ids = [id for id, r in snapshot['results'][-1]['team'].items()  # 옛 zero_ids → 새 계통만 공급한 도시 목록, 근거 D-74.
                     if r['dem'] - r['uns'] > .01  # 옛 dem == uns → 새 실제 공급 양수, 근거 D-74.
                     and abs(r['dem'] - r['isolated']['uns']) <= .01  # 옛 자체 공급 미확인 → 새 거래 전 부족량 = 수요로 자체 공급 0 확인, 근거 D-74.
                     and abs(r['imp']) <= .01 and abs(r['sub']) <= .01]  # 옛 이웃 공급 미확인 → 새 이웃 구매·화력 대체 0 확인, 근거 D-74.
    checks.ok(other in grid_only_ids and all('바깥 계통 공급만' in team.locator(f'[data-contrib="{id}"]').inner_text()  # 옛 공급 없음 → 새 계통 공급만 문구·빈 계획 사례 포함, 근거 D-74.
                                            for id in grid_only_ids), f'{label} #8 계통만 공급한 도시 바깥 계통 공급만')  # 옛 공급 0 단언 → 새 독립 판별한 모든 해당 도시 문구 단언, 근거 D-74.
    checks.ok(team.locator('.lg-pop-reasons meter').count() == 0 and
              '항목별 점수 변화의 비중' not in team.locator('#lg-causes').inner_text(), f'{label} #6 주민 이동 비례 막대 제거')
    reasons = team.locator('.lg-pop-reasons').inner_text() if team.locator('.lg-pop-reasons').count() else ''
    flows = snapshot['econ']['report']['flows']['pop']
    checks.ok(all(f['why'] in reasons for f in flows if tid in (f['from'],f['to']) and
                  f['why'] != '공기가 나빠서'), f'{label} #6 엔진 이주 이유 그대로 표시')
    open_panel(team, 'city')
    checks.ok(team.locator('[data-pol="re100"]').is_disabled(), f'{label} #11 결과에서 RE100 정책 잠금')
    low = team.locator('#lg-city .lg-why')
    checks.ok(low.count() == 1 and bool(re.search(r'만족도 부족 \d+(?:\.\d)?점', low.inner_text())), f'{label} #17 최저 집단 불만 한 자리 표시')
    # Synthetic royalty report proves optional 0 is shown and missing is omitted.
    fiscal = snapshot['econ']['report']['fiscal'][tid]
    had = 'royalty' in fiscal['rev']; original = fiscal['rev'].get('royalty')
    team.evaluate("""() => {const L=KCP.league.state();L.snap.econ.report.fiscal[L.team].rev.royalty=0;}""")
    open_panel(team, 'deal'); open_panel(team, 'city')
    checks.ok('기술 사용료' in team.locator('#lg-fiscal').inner_text(), f'{label} 사용료 필드 0도 별도 표시')
    team.evaluate("""() => {const L=KCP.league.state();delete L.snap.econ.report.fiscal[L.team].rev.royalty;}""")
    open_panel(team, 'deal'); open_panel(team, 'city')
    checks.ok('기술 사용료' not in team.locator('#lg-fiscal').inner_text(), f'{label} 사용료 필드 없으면 생략')
    if had:
        team.evaluate('([id,v]) => {KCP.league.state().snap.econ.report.fiscal[id].rev.royalty=v}', [tid, original])
    # All rebuttal types must display two side-by-side measures, including unavailable baselines.
    for key in ('co2', 'outage', 'tax', 'free', 'tie', 'tie-accept'):
        set_question(team, 'lg-r-' + key, other)
        checks.ok(wait_count(team, '.lg-ask .lg-rebuttal-metrics > div', 2) == 2 and
                  team.locator('.lg-ask .lg-rebuttal-metrics').evaluate("""el => {
                    const [a,b]=el.children, x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
                    return x.width > 0 && y.width > 0 && Math.abs(x.top-y.top)<1 && x.right <= y.left;
                  }"""), f'{label} #18 r-{key} 두 지표 나란히')
        overflow(checks, team, f'{label} 반문 {key}')
    team.evaluate("""() => {
      const L=KCP.league.state(); L.snap.teams[L.team].crit={chips:['rel'],line:60,choice:'keep'};
    }""")
    set_question(team, 'lg-p-line')
    checks.ok('지킬 선(전력 신뢰 60점 이상) 아래로 내려갔어요' in wait_text(team, '.lg-ask', '지킬 선(전력 신뢰 60점 이상) 아래로 내려갔어요'), f'{label} #20 하한 항목·숫자·미달 문구')
    team.evaluate("""() => {
      const L=KCP.league.state(), k=`kcp-league-data-v1:${L.room}:${L.team}`;
      const d=JSON.parse(localStorage.getItem(k));
      d.interview.months[L.snap.round].pred={uns:'down',cash:'up'};
      localStorage.setItem(k,JSON.stringify(d));
    }""")
    # Clipboard capture stays entirely within this page.
    team.evaluate("""() => Object.defineProperty(navigator,'clipboard', {configurable:true,
      value:{writeText: async text => {window.__huCopy=text;}}})""")
    open_panel(team, 'journal'); team.locator('#lg-jcopy').click()
    team.wait_for_function('() => !!window.__huCopy')
    text = team.evaluate('window.__huCopy')
    checks.ok('■ 2027년 1월' in text and '■ 1달' not in text and '예측: 정전 줄 것 / 현금 늘 것' in text and '{"uns"' not in text,
              f'{label} #16 활동지 달 머리·예측 JSON 없음')
    # Force warning/badge states to measure the exact previously failing CSS selectors.
    team.evaluate("""() => {
      const panel=document.querySelector('#lg-panel');
      panel.insertAdjacentHTML('beforeend','<p class="lg-warn">가상 경고</p><p class="lg-left"><b data-bad="true">가상 음수 예산</b></p>');
      const b=document.querySelector('#lg-bar [data-panel="deal"]');
      if(!b.querySelector('.lg-badge')) b.insertAdjacentHTML('beforeend','<span class="lg-badge">1</span>');
    }""")
    contrast(checks, team, '.lg-warn, .lg-left b[data-bad="true"], .lg-badge', label + ' 서랍·뱃지')
    host.locator('#lg-host-details').evaluate('el => {el.open=true}')
    contrast(checks, host, '.lg-conn[data-s="open"], .lg-seat[data-s="on"]', label + ' 연결 상태')
    team.evaluate('window.__huRelease()')
    # Check every actual month, including representative-weather months and end state.
    for month in range(2, 13):
        advance(host, team, month, 'plan')
        season = wait_text(team, '#bd-season-t', f'· {month}월 (날씨는 ')
        checks.ok(f'· {month}월 (날씨는 ' in season and '기준)' in season, f'{label} #32 {month}월·날씨 기준월')
        overflow(checks, team, f'{label} H-U {month}월')
        advance(host, team, month, 'review')
    advance(host, team, 12, 'end')
    checks.ok(host.locator('#lg-host-ready, #lg-host-unready, .lg-ready').count() == 0,
              f'{label} #37 끝 준비 표시 없음')
    # U5는 시간 제목과 값을 별도 칸에 둔다. 제목의 유무 대신 제한 없음이
    # 한 번 보이고 실제 카운트다운으로 오인할 숫자가 없는지 확인한다.
    time_text = wait_text(host, '#lg-host-time', '시간 제한 없음')
    board = host.locator('.lg-host-board').inner_text()
    checks.ok(wait_shown(host, '#lg-host-time') and board.count('시간 제한 없음') == 1 and
              '시간 제한 없음' in time_text and not re.search(r'\d+\s*:\s*\d+', time_text),
              f'{label} #39 시간 제한 없음 한 번 표시·카운트다운 없음')
    overflow(checks, host, label + ' H-U 끝 진행자')
    screenshot(checks, team, f'econui-{label}-hu-end.png')
    # D-58: map picker heading must track renamed regional data, then restore.
    build, events = monitored_page(context); pages.append((build, events, '자유 건설'))
    build.goto(base + '#home', timeout=RELOAD_WAIT); build.wait_for_function(BOOT_JS, timeout=RELOAD_WAIT)
    name = build.evaluate('() => KCP.LEAGUE_REGIONS.south.name')
    build.evaluate("() => {KCP.LEAGUE_REGIONS.south.name='가상 연습 지역';location.hash='#build'}")
    build.wait_for_selector('#bd-mapcur', timeout=RELOAD_WAIT)
    build.locator('#bd-mapcur').click()
    checks.ok('가상 연습 지역' in wait_text(build, '#bd-mappop', '가상 연습 지역'), f'{label} #25 지도 제목은 지역 자료에서 읽음')
    build.evaluate('name => {KCP.LEAGUE_REGIONS.south.name=name}', name)

def feature_hiding(checks, context, base, label, pages):
    """E: 화면 숨김이 모드·저장값·월 결과까지 침범하면 실패한다."""
    host, team, fixture = setup_pair(context, base, 12, pages)
    # 아래 바이오 CO₂ 사례는 기기 스냅숏을 직접 고친다. 진행자는 4초마다 스냅숏을 다시 보내 고친 값을 덮으므로
    # (2026-10-13 재현: 4.5초 대기 2/2 불일치) 그 구간만 실제 전달을 보류한다(H-U #27 장치, 다음 새로고침부터 적용).
    team.add_init_script(HOLD_SNAP_JS)
    advance(host, team, 1, 'plan')
    team.locator('#lg-guide-close').click()
    team.locator('#bd-pm').click()
    expect(team.locator('#bd-pm')).to_have_attribute('aria-expanded', 'true', timeout=UI_WAIT)
    team.locator('#bd-drawer-body').wait_for(state='visible', timeout=UI_WAIT)
    checks.ok(all(absent_or_hidden(team, sel) for sel in
                  ('[data-tab="research"]', '[data-tab="journal"]', '[data-fab2]')),
              f'{label} E G11·G12·D03 리그 옛 연구·시험 일지·증설 카드 숨김')
    checks.ok([n.get_attribute('data-run') for n in team.locator('[data-run]:visible').all()] == ['7'],
              f'{label} E C10 멀티는 시험 1주만')
    checks.ok(team.locator('[data-run="7"]').evaluate('''el => {
      const r=el.getBoundingClientRect(); return r.width>=44 && r.height>=44;}'''),
              f'{label} E 시험 단추 누르는 영역 44px')
    overflow(checks, team, label + ' E 숨긴 건설 서랍')
    screenshot(checks, team, f'econui-{label}-hide-policy.png')
    team.locator('#bd-drawer-x').click()
    # 저장된 증설 계획을 다시 여는 경로도 검사한다. 수요 규칙은 기존 엔진을 사용한다.
    team.evaluate('() => KCP.league.plan(st => {st.fab2=true; st.rq=["bms"];})')
    host.wait_for_function('id => KCP.league.state().S.teams[id].plan?.fab2 === true', arg=fixture['team'])
    team.wait_for_timeout(600)
    team.reload(timeout=RELOAD_WAIT); team.wait_for_selector('#lg-bar', timeout=RELOAD_WAIT)
    checks.ok(team.evaluate('() => KCP.buildGame.current().fab2 === true && KCP.buildGame.current().rq.includes("bms")'),
              f'{label} E D03·G11 새로고침 뒤 fab2·옛 연구 큐 보존')
    open_panel(team, 'city')
    checks.ok('반도체 증설 시나리오 적용 중' in team.locator('#lg-city').inner_text(),
              f'{label} E D03 저장된 증설 판 도시 안내')
    open_panel(team, 'tech')
    checks.ok(wait_count(team, '[data-tech-card]', 15) == 15,
              f'{label} E G11 리그 연구는 15장 트리 유지')
    team.locator('.lg-px').click()
    team.locator('[data-run="7"]').click()
    finish_trial(team)
    if not checks.ok(wait_shown(team, '#bd-fab2-active'), f'{label} E D03 시험 성적표 증설 적용 안내'):
        print('  진단:', team.evaluate("() => ({fab2: KCP.buildGame.current()?.fab2, "
              "title: document.querySelector('#bd-res-title')?.textContent, "
              "notice: !!document.querySelector('#bd-fab2-active')})"), flush=True)
    checks.ok(all(absent_or_hidden(team, sel) for sel in ('#bd-jopen', '#bd-j-dlg', '#bd-speak')),
              f'{label} E G12 시험 결과의 일지 쓰기·대화상자·타이머 숨김')
    saved = team.evaluate('''() => {
      const L=KCP.league.state(), key=`kcp-league-data-v1:${L.room}:${L.team}`;
      const map=KCP.buildGame.saveView().map, doc=JSON.parse(localStorage.getItem(key)).docs[map];
      doc.journal[0].a.why='가상 시험 기록을 보존해요';
      const data=JSON.parse(localStorage.getItem(key)); data.docs[map]=doc;
      localStorage.setItem(key, JSON.stringify(data)); return doc.journal;
    }''')
    team.reload(timeout=RELOAD_WAIT); team.wait_for_selector('#lg-bar', timeout=RELOAD_WAIT)
    checks.ok(team.evaluate('''() => {const L=KCP.league.state();
      return JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`)).docs[KCP.buildGame.saveView().map].journal;}''') == saved,
              f'{label} E G12 기존 시험 기록·자유 서술 보존')
    open_panel(team, 'journal')
    checks.ok(wait_shown(team, '#lg-crit') and wait_shown(team, '#lg-jcopy'),
              f'{label} E G12 월 일지·S8 활동지 경로 유지')
    advance(host, team, 1, 'review')
    checks.ok(team.evaluate("() => typeof window.__huRelease === 'function'"), f'{label} E 바이오 사례 스냅숏 보류 장치 적용')
    team.evaluate('() => {window.__huHold=true}')
    # 각 값은 기기 스냅샷에서만 바꾼다. 실제 결과 경로가 해당 월 report를 읽는지 검사한다.
    for value in (12.34, 0, None):
        team.evaluate('''value => {
          const L=KCP.league.state(), V=L.snap, rep=V.results.at(-1).econ;
          const c=rep.cities[L.team]; if(value===null) delete c.bioCo2; else c.bioCo2=value;
          // 최신 도시 report와 지난 운영 report가 다를 때도 결과는 운영 report를 쓴다.
          V.econ.report=JSON.parse(JSON.stringify(rep)); V.econ.report.cities[L.team].bioCo2=99;
        }''', value)
        open_panel(team, 'city'); open_panel(team, 'result')
        if value is not None and value > 0:
            wait_shown(team, '#lg-result-bio-co2')
        checks.ok(shown(team, '#lg-result-bio-co2') == (value is not None and value > 0),
                  f'{label} E 바이오 CO₂ 값 {value}: 양수일 때만 결과 줄')
        if value and value > 0:
            checks.ok(team.locator('#lg-result-bio-co2').inner_text() ==
                      '바이오 CO₂ 12.34 t(국가 총량 밖 · IPCC 정보 항목)',
                      f'{label} E 바이오 CO₂ 해당 운영 report·문구·단위')
            team.evaluate('''() => {const V=KCP.league.state().snap;
              V.econ.report=V.results.at(-1).econ;}''')
            result_text = team.locator('#lg-result-bio-co2').inner_text()
            open_panel(team, 'city')
            checks.ok(team.locator('#lg-bio-co2').inner_text() == result_text,
                      f'{label} E 도시·결과 바이오 CO₂ 같은 문구·단위')
            open_panel(team, 'result')
            screenshot(checks, team, f'econui-{label}-hide-result.png')
        overflow(checks, team, label + f' E 바이오 {value}')
    team.evaluate('() => window.__huRelease()')

    build, events = monitored_page(context); pages.append((build, events, 'E 자유 건설'))
    build.goto(base + '#home', timeout=RELOAD_WAIT); build.wait_for_function(BOOT_JS, timeout=RELOAD_WAIT)
    build.evaluate('''() => localStorage.setItem('kcp-build-v1',
      JSON.stringify(KCP.buildGame.sanitizeDoc({map:'pyeongtaek'})))''')
    build.goto(base + '#build', timeout=RELOAD_WAIT); build.wait_for_selector('#bd-mapcur', timeout=RELOAD_WAIT)
    build.locator('#bd-pm').click()
    expect(build.locator('#bd-pm')).to_have_attribute('aria-expanded', 'true', timeout=UI_WAIT)
    build.locator('#bd-drawer-body').wait_for(state='visible', timeout=UI_WAIT)
    checks.ok(all(wait_shown(build, sel) for sel in ('[data-tab="research"]', '[data-tab="journal"]', '[data-fab2]')) and
              [n.get_attribute('data-run') for n in build.locator('[data-run]:visible').all()] == ['7', '30', '90'],
              f'{label} E #build 옛 연구·일지·증설·세 기간 유지')
    build.locator('[data-tab="mission"]').click()
    build.locator('[data-mis]').first.wait_for(state='visible', timeout=UI_WAIT)
    for node in build.locator('[data-mis]').all()[:2]: node.click()
    # 390 폭에서는 열린 서랍이 실행 막대를 덮는다(숨김 작업 전 9babc7d에도 있던 #build 모바일 겹침, 별도 결함).
    # 사람이 하는 순서대로 서랍을 닫고 실행한다.
    if build.locator('#bd-drawer-x').is_visible():
        build.locator('#bd-drawer-x').click()
    # 단독 #build는 시험 기록(lastTrial)을 남기지 않는다(리그에서만 rememberTrial) — 옛 건너뛰기 흐름 유지.
    build.locator('[data-run="7"]').click(); build.wait_for_selector('#bd-skip'); build.locator('#bd-skip').click()
    build.wait_for_selector('#bd-j-dlg[open]')
    checks.ok(wait_shown(build, '#bd-speak'), f'{label} E #build 건설 일지 대화상자·말하기 유지')
    build.locator('#bd-speak').click()
    build.wait_for_function('document.querySelector("#bd-speak-t").textContent !== "0:00"')
    checks.ok(build.locator('#bd-speak').get_attribute('aria-pressed') == 'true',
              f'{label} E #build 말하기 타이머 실제 진행')
    build.locator('#bd-j-dlg').press('Escape')
    checks.ok(wait_shown(build, '#bd-jopen'), f'{label} E #build 결과의 일지 쓰기 유지')
    overflow(checks, build, label + ' E #build 결과')
    screenshot(checks, build, f'econui-{label}-hide-build.png')


def seasonal(checks, context, base, label, pages):
    host, team, _ = setup_pair(context, base, 0, pages)
    stages = [("lobby", 0)] + [(phase, round_number) for round_number in range(1, 5)
                                for phase in ("plan", "review")] + [("end", 4)]
    for phase, round_number in stages:
        if phase != "lobby":
            advance(host, team, round_number, phase)
        for page, role in ((host, "진행자"), (team, "팀")):
            for selector in ('[data-panel="city"]', '#lg-rank', '#lg-ticker', '#lg-crit'):
                checks.test(f"{label} 계절 {round_number}턴 {phase} {role} {selector} 없음/hidden",
                            lambda page=page, selector=selector: absent_or_hidden(page, selector))
            overflow(checks, page, f"{label} 계절 {round_number}턴 {phase} {role}")
    screenshot(checks, host, f"econui-{label}-season-host.png")
    screenshot(checks, team, f"econui-{label}-season-team.png")


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height in ((1280, 900), (390, 844)):
                for scheme in ("light", "dark"):
                    label = f"{width}x{height}-{scheme}"
                    for name, scenario in (("경제", economic), ("계절", seasonal), ("H-U", ui_fixes), ("E", feature_hiding)):
                        context, external = context_for(browser, base, width, height, scheme)
                        pages = []
                        try:
                            scenario(checks, context, base, label, pages)
                        except Exception as exc:
                            checks.ok(False, f"{label} {name} 진행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
                            for page, _, role in pages:
                                screenshot(checks, page, f"econui-{label}-{name}-{role}-failure.png")
                        finally:
                            for page, events, role in pages:
                                diagnostics(checks, events, f"{label} {name} {role}")
                                overflow(checks, page, f"{label} {name} {role}")
                            checks.ok(not external, f"{label} {name} 외부 연결 시도 0: {external}")
                            context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
