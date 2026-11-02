"""ECON-UI U5 독립 수용 검사. 기대값은 docs/ECON-UI.md U5에서만 온다.

실행: tests/.venv/bin/python tests/league/peek.py http://127.0.0.1:9430/index.html
브라우저 실행은 총괄 담당. econui.py/solo.py와 구현 파일은 수정하지 않는다.
진행자+팀 탭은 local 연결, 경제 모드는 6팀/12달, 계절 모드도 별도 검사한다.
fixture만 공개 규칙/계획 API로 만들고 U5 이동은 실제 버튼으로 수행한다.
도시 표지에는 미지정 CSS 선택자 대신 도시 이름과 접근 가능한 버튼을 쓴다.
"""

from league_flow import finish_trial
import re
import sys
import time

from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, select_mode, start_solo

from econui import (BOOT_JS, Checks, HOST_JS, SYNC_JS, context_for,
                    diagnostics, local_address, monitored_page, open_panel,
                    overflow, screenshot, shown)

IDS = ("pyeongtaek", "hwaseong", "anseong", "dangjin", "asan", "cheonan")

SEED_JS = """([ids, turns]) => {
  const C = KCP.leagueCore, room = turns ? 'PKU55' : 'PKS55', now = Date.now();
  const S = C.newState(room, 'south', now, ids, turns ? {turns} : null);
  ids.slice(1).forEach(team => C.reduce(S,
    {type:'claim', team, token:'peek-fixture-' + team}, now, KCP.buildGame));
  const net = {kind:'local'};
  localStorage.setItem('kcp-league-net-v1', JSON.stringify(net));
  localStorage.setItem('kcp-league-host-v1', JSON.stringify({room, net, state:S}));
  return {room, team:ids[0]};
}"""

# send() 자체나 UI의 비공개 변수를 바꾸지 않는다. 실제 local 전송을 관찰한다.
# phase:'plan'인 스냅을 요청으로 세지 않으며 중첩 envelope/JSON도 처리한다.
WIRE_JS = r"""(() => {
  window.__peekWire = {sent:0, plans:0};
  const containsPlan = (x, depth=0) => {
    if (depth > 8 || x == null) return false;
    if (typeof x === 'string') {
      if (!/^[\[{]/.test(x.trim())) return false;
      try { return containsPlan(JSON.parse(x), depth+1); } catch (_) { return false; }
    }
    if (typeof x !== 'object') return false;
    const keys = ['type', 'kind', 't', 'action', 'op', 'cmd', 'event', 'request'];
    if (keys.some(k => x[k] === 'plan')) return true;
    return Object.values(x).some(v => containsPlan(v, depth+1));
  };
  const original = BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage = function(message) {
    window.__peekWire.sent++;
    if (containsPlan(message)) window.__peekWire.plans++;
    return original.call(this, message);
  };
})();"""

STATE_JS = """() => {
  const L = KCP.league.state(), S = L && (L.S || L.snap);
  if (!S || !S.teams) throw new Error('리그 공개 상태 없음');
  const ids = S.active || Object.keys(S.teams);
  return {team:L.team, round:S.round, phase:S.phase, rev:S.rev, ids,
    econ:!!S.econ, rounds:Array.isArray(S.rounds) ? S.rounds.length : Number(S.rounds || 0),
    counts:Object.fromEntries(ids.map(id => [id,
      ((S.teams[id].plan || {}).builds || []).length])),
    names:Object.fromEntries(ids.map(id => [id, KCP.ECON_DATA.start[id].name]))};
}"""
MAP_JS = "() => KCP.buildGame.current().builds.length"
WIRE_READ_JS = "() => ({...window.__peekWire})"
PLAN_JS = """() => {
  const BG = KCP.buildGame;
  const tile = BG.TILES.find(t => !t.out && t.site < 0 && !BG.siteRule('solar', t));
  if (!tile) throw new Error('fixture 태양광을 놓을 유효 칸 없음');
  return KCP.league.plan(st => {st.builds = [{t:'solar', i:tile.i}];});
}"""
PLAN_READY_JS = """id => {
  const L = KCP.league.state(), S = L && (L.S || L.snap);
  return !!S && !!S.teams[id].plan && S.teams[id].plan.builds.length === 1;
}"""

DRAWER_JS = """() => {
  const visible = n => !!n && !!n.getClientRects().length && !n.hidden &&
    getComputedStyle(n).visibility !== 'hidden';
  const panel = document.querySelector('#lg-panel');
  const root = document.querySelector('#bd-root');
  return {open:visible(panel),
    // ECON-UI v1.2: 서랍 선택 상태는 탐색을 맡는 막대 버튼에서 수집한다.
    buttons:[...document.querySelectorAll('#lg-bar [data-panel]')]
      .filter(n => n.dataset.panel !== 'region')
      .map(n => [n.dataset.panel, n.getAttribute('aria-expanded'),
        n.getAttribute('aria-current'), n.className]),
    mode:root?.dataset.mode,
    groups:[...root.querySelectorAll('[data-group]')]
      .map(n => [n.dataset.group, n.dataset.active || null]),
    tools:[...root.querySelectorAll('[data-tool]')].filter(visible)
      .map(n => [n.dataset.tool, n.getAttribute('aria-pressed'), n.className])};
}"""
FULLSCREEN_JS = """() => {
  const n = document.querySelector('#lg-region');
  if (!n || n.closest('#lg-panel')) return false;
  const r = n.getBoundingClientRect();
  const width = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  const height = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return width >= innerWidth * .9 && height >= innerHeight * .9;
}"""

# 각 도시의 요약 영역을 찾는다. 명세에 없는 data-* 계약을 추가하지 않는다.
SUMMARY_JS = r"""([names, economic]) => {
  const root = document.querySelector('#lg-region');
  if (!root) return [];
  const nodes = [...root.querySelectorAll('*')];
  return Object.entries(names).map(([id, name]) => {
    const candidates = nodes.filter(n => {
      if (!n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') return false;
      const text = n.innerText || '';
      return text.includes(name) && Object.values(names).filter(s => text.includes(s)).length === 1 &&
        /설비/.test(text) && /\d/.test(text);
    }).sort((a,b) => a.innerText.length - b.innerText.length);
    // 제목+설비만 담은 작은 자식보다 지표 전체를 담은 요약을 먼저 선택한다.
    const complete = economic ? candidates.filter(n =>
      ['정전', '지지', '주민'].every(word => n.innerText.includes(word))) : candidates;
    const selected = complete.length ? complete[0] : candidates[0];
    const leaves = complete.filter(n => !complete.some(m => m !== n && n.contains(m)));
    const text = selected ? selected.innerText : '';
    const m = text.match(/설비\s*(?:수\s*)?[:：]?\s*([\d,]+)/) ||
      text.match(/([\d,]+)\s*(?:기|개)\s*(?:의\s*)?설비/);
    return {id, text, summaries:leaves.length,
      count:m ? Number(m[1].replace(/,/g,'')) : null};
  });
}"""
INACTIVE_JS = """nodes => nodes.every(n => {
  for (let p = n; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (p.hidden || p.inert || style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return n.matches(':disabled') || n.getAttribute('aria-disabled') === 'true';
})"""
MAP_POINT_JS = """() => {
  const BG = KCP.buildGame;
  const t = BG.TILES.find(t => !t.out && t.site < 0 && !BG.siteRule('solar', t));
  const point = t ? BG.tileXY(t.c, t.r) : null;
  const target = point && document.elementFromPoint(point[0], point[1]);
  return target && target.closest('canvas') ? point : null;
}"""
SOLO_READY_JS = """() => {
  const L = KCP.league.state(), S = L && (L.S || L.snap);
  return !!S && !!S.teams && !!L.team && S.phase === 'plan';
}"""


def state(page):
    return page.evaluate(STATE_JS)


def own_count(host, team, tid):
    if host is not None:
        plan = host.evaluate(HOST_JS)["teams"][tid].get("plan") or {}
        return len(plan.get("builds") or [])
    return state(team)["counts"][tid]


def setup_pair(context, base, turns, pages):
    host, events = monitored_page(context)
    pages.append((host, events, "host"))
    host.on("dialog", lambda dialog: dialog.accept())
    host.goto(base + "#home")
    host.wait_for_function(BOOT_JS)
    fixture = host.evaluate(SEED_JS, [list(IDS), turns])
    host.goto(base + "#league/host")
    host.wait_for_selector("#lg-roomcode")
    fixture["room"] = host.inner_text("#lg-roomcode").replace("-", "").strip()
    team, events = monitored_page(context)
    pages.append((team, events, "team"))
    team.goto(base + "#league")
    select_mode(team, "join")
    team.fill("#lg-code", fixture["room"])
    team.click("#lg-join")
    confirm_seat(team, fixture["team"])
    host.click("#lg-next")
    for page in (host, team):
        page.wait_for_function(SYNC_JS, arg=[1, "plan"])
    return host, team


def setup_solo(context, base, pages):
    page, events = monitored_page(context)
    pages.append((page, events, "solo"))
    page.goto(base + "#league")
    start_solo(page)
    page.wait_for_function(SOLO_READY_JS)
    page.wait_for_selector("#lg-bar")
    return None, page


def city_button(page, name, names):
    """U5의 키보드 도시 버튼 목록도 확인한다. 캔버스 좌표에는 의존하지 않는다."""
    buttons = page.locator("#lg-region").get_by_role("button", name=re.compile(re.escape(name)))
    for i in range(buttons.count()):
        button = buttons.nth(i)
        text = button.inner_text() + " " + (button.get_attribute("aria-label") or "")
        if (button.is_visible() and button.is_enabled() and
                sum(city in text for city in names.values()) == 1):
            return button
    raise AssertionError(f"{name}: 접근 가능한 도시 선택 버튼 없음")


def capture(checks, page, label, stage):
    overflow(checks, page, f"{label} {stage}")
    screenshot(checks, page, f"peek-{label}-{stage}.png")


def region(checks, page, observation, label):
    checks.test(f"{label} U5 #lg-region 표시", lambda: shown(page, "#lg-region"))
    checks.test(f"{label} U5 #lg-regionmap 표시", lambda: shown(page, "#lg-regionmap"))
    checks.test(f"{label} U5 지역 보기가 화면 전체를 차지", lambda: page.evaluate(FULLSCREEN_JS))
    checks.test(f"{label} U5 #lg-region-back 버튼", lambda: shown(page, "#lg-region-back"))
    summaries = page.evaluate(SUMMARY_JS, [observation["names"], observation["econ"]])
    present = sum(item["summaries"] for item in summaries)
    checks.ok(present == len(observation["ids"]) and all(item["summaries"] == 1 for item in summaries),
              f"{label} U5 도시 요약 {len(observation['ids'])}개(활성 팀 수): {present}")
    for item in summaries:
        checks.ok(item["count"] == observation["counts"][item["id"]],
                  f"{label} U5 {observation['names'][item['id']]} 요약 설비 수 = 공개 계획")
        if observation["econ"]:
            checks.ok(all(word in item["text"] for word in ("정전", "지지", "주민")),
                      f"{label} U5 {observation['names'][item['id']]} 정전·지지율·주민 요약")
        checks.test(f"{label} U5 {observation['names'][item['id']]} 도시 선택 버튼", lambda item=item:
                    city_button(page, observation["names"][item["id"]], observation["names"]) is not None)
    capture(checks, page, label, "region")


def peek(checks, page, observation, other, label):
    city_button(page, observation["names"][other], observation["names"]).click()
    page.wait_for_selector("#lg-peek")
    checks.test(f"{label} U5 관전 중·읽기 전용·대상 도시 표시", lambda:
                all(word in page.locator("#lg-peek").inner_text() for word in
                    ("관전 중", "읽기 전용", observation["names"][other])))
    checks.test(f"{label} U5 건설·철거 도구 비활성/숨김", lambda:
                page.locator('[data-tool]').evaluate_all(INACTIVE_JS))
    checks.test(f"{label} U5 준비 버튼 존재·비활성", lambda:
                page.locator("#lg-ready").count() == 1 and page.locator("#lg-ready").is_disabled())
    checks.test(f"{label} U5 서랍 정책 편집 비활성/숨김", lambda:
                page.locator('[data-pol], #lg-econpol input, #lg-econpol button').evaluate_all(INACTIVE_JS))
    for selector in ("#lg-peek-region", "#lg-peek-back"):
        checks.test(f"{label} U5 {selector} 표시·활성", lambda selector=selector:
                    shown(page, selector) and page.locator(selector).is_enabled())
    # 실제 지도 클릭도 계획을 바꾸지 않아야 한다.
    point = page.evaluate(MAP_POINT_JS)
    if point:
        viewport = page.viewport_size
        width, height = viewport["width"], viewport["height"]
        if 0 <= point[0] < width and 0 <= point[1] < height:
            page.mouse.click(*point)
    capture(checks, page, label, "peek")


def returned(checks, page, host, tid, count, drawer, label, route):
    page.wait_for_timeout(600)  # 지연 계획 저장도 관찰한다.
    checks.test(f"{label} U5 {route} → 우리 지도 설비 수 그대로", lambda:
                page.evaluate(MAP_JS) == count)
    checks.test(f"{label} U5 {route} → 우리 plan 설비 수 그대로", lambda:
                own_count(host, page, tid) == count)
    checks.test(f"{label} U5 {route} → 서랍·선택 도구 그대로", lambda:
                page.evaluate(DRAWER_JS) == drawer)
    checks.test(f"{label} U5 {route} → 지역·관전 화면 닫힘", lambda:
                not shown(page, "#lg-region") and not shown(page, "#lg-peek"))
    checks.test(f"{label} U5 {route} → 준비 버튼 활성 복원", lambda:
                shown(page, "#lg-ready") and page.locator("#lg-ready").is_enabled())
    capture(checks, page, label, route)


def scenario(checks, context, base, label, mode, pages):
    host, team = (setup_solo(context, base, pages) if mode == "solo" else
                  setup_pair(context, base, 12 if mode == "econ" else 0, pages))
    initial = state(team)
    tid = initial["team"]
    checks.ok(tid in initial["ids"], f"{label} U5 우리 도시 식별")
    if mode != "solo":
        checks.ok(set(initial["ids"]) == set(IDS), f"{label} U5 활성 도시 정확히 6개")
    checks.ok(initial["econ"] == (mode != "season"), f"{label} U5 경제/계절 fixture")
    checks.ok([n.get_attribute('data-run') for n in team.locator('[data-run]:visible').all()] ==
              (['7', '30', '90'] if mode == 'solo' else ['7']),
              f'{label} E C10 멀티 1주·혼자 하기 세 기간')
    if mode != "season":
        checks.ok(initial["rounds"] == 12, f"{label} U5 경제 모드 12달")
        checks.ok(not shown(team, "#lg-panel"), f"{label} U1 첫 지도는 일지 서랍 닫힘")
        # 품질8 UX U5: 첫 달 코치 띠(#lg-coach)는 8단계 동안 지도 조작을 막지 않도록 열 때 포커스를
        # 옮기지 않는다(D-coach.md). 닫기 단추와 지도 밖 포커스의 Escape 닫기는 그대로 확인한다.
        guide = team.locator('#lg-coach')
        if guide.count():
            checks.ok(team.locator('#lg-coach-close').count() == 1, f'{label} U2 첫 안내 닫기 단추')
            team.evaluate('document.activeElement.blur()')
            team.keyboard.press('Escape')
            checks.ok(team.locator('#lg-coach').count() == 0, f'{label} U2 지도 밖 포커스에서도 안내 Escape 닫기')
        team.locator('[data-run="7"]').click()
        team.wait_for_selector('#bd-skip')
        team.wait_for_function("() => !!document.querySelector('#bd-run-tip')?.textContent")
        tip = team.locator('#bd-run-tip').inner_text()
        checks.ok(all(int(m) == 1 for m in re.findall(r'(\d+)월', tip)), f'{label} U7 1월 시험 TIP의 다른 계절 문구 없음')
        finish_trial(team)
        checks.ok(not shown(team, "#lg-panel") and
                  team.evaluate("document.documentElement.classList.contains('bd-drawer-open')"),
                  f"{label} U2 첫 시험 성적표 유지·리그 일지 닫힘")
        team.locator('#bd-drawer-x').click()
        checks.ok(not shown(team, "#lg-panel"), f"{label} 도구 선택 전 일지 서랍 닫힘")
    checks.ok(team.locator('[data-lens="result"]').count() == 1, f'{label} U2 지도 운영 결과 토글')
    checks.ok(team.locator('[data-lens="grid"]').count() == 1 and team.locator('[data-lens="complaints"]').count() == 1,
              f'{label} U3 두 영향 렌즈')
    checks.ok(team.evaluate(PLAN_JS), f"{label} U5 우리 계획 fixture 설정")
    (host or team).wait_for_function(PLAN_READY_JS, arg=tid)
    team.wait_for_timeout(600)
    if host is not None:
        checks.ok(team.evaluate(WIRE_READ_JS)["plans"] > 0,
                  f"{label} U5 감시기가 실제 plan 전송을 포착(양성 대조)")
    # 편집 도구와 열린 서랍을 복귀 전후 비교할 수 있도록 정한다.
    group = team.locator('#bd-root [data-group="ren"]:visible')
    group.click()
    tool = team.locator('#bd-root [data-tool="solar"]:visible')
    tool.click()
    checks.ok(team.locator('#bd-root').get_attribute('data-mode') == 'solar' and
              group.get_attribute('data-active') == 'true',
              f"{label} U5 비교 기준 태양광 도구·재생 묶음 선택됨")
    open_panel(team, "deal")
    checks.ok(shown(team, "#lg-panel"), f"{label} U5 복귀 비교용 서랍 열림")
    observation = state(team)
    count = own_count(host, team, tid)
    checks.ok(count == 1 and team.evaluate(MAP_JS) == count,
              f"{label} U5 기준 우리 plan·지도 설비 한 개")
    other = next(city for city in observation["ids"] if city != tid and
                 observation["counts"][city] != count)
    drawer = team.evaluate(DRAWER_JS)
    wire_before = team.evaluate(WIRE_READ_JS)["plans"]
    capture(checks, team, label, "own-before")
    checks.test(f"{label} U5 [data-panel=region] 표시·활성", lambda:
                shown(team, '[data-panel="region"]') and
                team.locator('[data-panel="region"]').is_enabled())
    team.click('[data-panel="region"]')
    team.wait_for_selector("#lg-regionmap")
    region(checks, team, observation, label)
    peek(checks, team, observation, other, label)
    team.wait_for_timeout(600)
    checks.test(f"{label} U5 관전 진입·지도 클릭 뒤 우리 plan 설비 수 그대로", lambda:
                own_count(host, team, tid) == count)
    checks.test(f"{label} U5 관전 진입·지도 클릭 뒤 plan 요청 0", lambda:
                team.evaluate(WIRE_READ_JS)["plans"] == wire_before)
    if host is not None:
        # 단계 전환이 실제 수신되었는지도 확인한다. 무변화 스냅으로 대체하지 않는다.
        for round_number, phase in ((1, "review"), (2, "plan")):
            host.click("#lg-next")
            for page in (host, team):
                page.wait_for_function(SYNC_JS, arg=[round_number, phase])
            team.wait_for_timeout(600)
            checks.test(f"{label} U5 {round_number}턴 {phase} 스냅 뒤 관전 유지", lambda:
                        shown(team, "#lg-peek") and observation["names"][other] in
                        team.locator("#lg-peek").inner_text())
            checks.test(f"{label} U5 {phase} 스냅 뒤 진행자 우리 plan 설비 수 그대로", lambda:
                        own_count(host, team, tid) == count)
            checks.test(f"{label} U5 {phase} 스냅 뒤 plan 요청 0", lambda:
                        team.evaluate(WIRE_READ_JS)["plans"] == wire_before)
            checks.test(f"{label} U5 {phase} 스냅 뒤 준비 비활성", lambda:
                        team.locator("#lg-ready").is_disabled())
            capture(checks, team, label, f"peek-{phase}")
        capture(checks, host, label, "host-snap")
    team.click("#lg-peek-region")
    team.wait_for_selector("#lg-regionmap")
    checks.test(f"{label} U5 #lg-peek-region → 지역 지도", lambda:
                shown(team, "#lg-region") and shown(team, "#lg-regionmap") and not shown(team, "#lg-peek"))
    capture(checks, team, label, "peek-region")
    team.click("#lg-region-back")
    returned(checks, team, host, tid, count, drawer, label, "region-back")
    # 관전에서 곧장 우리 도시로 돌아오는 별도 경로.
    team.click('[data-panel="region"]')
    team.wait_for_selector("#lg-regionmap")
    observation = state(team)
    peek(checks, team, observation, other, label + "-direct")
    team.click("#lg-peek-back")
    returned(checks, team, host, tid, count, drawer, label, "peek-back")
    checks.ok([n.get_attribute('data-run') for n in team.locator('[data-run]:visible').all()] ==
              (['7', '30', '90'] if mode == 'solo' else ['7']),
              f'{label} E C10 관전 복귀 뒤 기간 표시 복원')
    # 우리 도시 버튼은 관전 없이 복귀한다. 키보드 Enter로 목록도 검증한다.
    team.click('[data-panel="region"]')
    team.wait_for_selector("#lg-regionmap")
    button = city_button(team, observation["names"][tid], observation["names"])
    button.focus()
    button.press("Enter")
    returned(checks, team, host, tid, count, drawer, label, "own-city")
    checks.test(f"{label} U5 지역·관전·모든 복귀 중 plan 요청 0", lambda:
                team.evaluate(WIRE_READ_JS)["plans"] == wire_before)


TOOL_MODE_JS = "() => document.querySelector('#bd-root')?.dataset.mode || ''"


def esc_coach_drawer(checks, context, base, label, pages, with_tool):
    """D-83 ② 코치 > ⑤ 서랍, 총괄 10-21. 명세(docs/DECISIONS.md D-83)만 보고 쓴 단언이다.

    Esc 한 번은 위에서부터 한 층만 닫는다. 코치(#lg-coach)와 리그 서랍(#lg-panel)이 함께 열린 판에서
    with_tool=False: 초점을 코치 안에 두고 Esc → 코치만 닫힘·서랍 유지, Esc 2번 → 서랍도 닫힘.
    with_tool=True(D-83 각주 10-21): 건설 도구를 고르고 초점이 코치 밖이면 Esc 1번은 도구 선택 취소 몫이라
    코치·서랍이 그대로이고, Esc 2번에 코치, Esc 3번에 서랍이 닫힌다.
    코치는 혼자 하기 첫 달에 뜨므로(ux_coach.py) 판마다 새 컨텍스트로 시작한다.
    """
    case = "도구 선택·초점 코치 밖" if with_tool else "초점 코치 안"
    tag = f"{label} D-83 Esc({case})"
    _, page = setup_solo(context, base, pages)
    page.wait_for_selector("#lg-coach", timeout=60000)
    page.wait_for_timeout(1200)  # ux_coach.py와 같은 안정 대기
    if with_tool:
        # peek 비교 기준과 같은 화면 조작: 재생 묶음 → 태양광 도구.
        page.locator('#bd-root [data-group="ren"]:visible').click()
        page.locator('#bd-root [data-tool="solar"]:visible').click()
    open_panel(page, "city")
    ready = shown(page, "#lg-coach") and shown(page, "#lg-panel")
    if with_tool:
        ready = ready and page.evaluate(TOOL_MODE_JS) == "solar"
    if not checks.ok(ready, f"{tag} 장면 준비: 코치·서랍 함께 열림" + (" ·태양광 도구 선택" if with_tool else "")):
        screenshot(checks, page, f"peek-{label}-d83-{'tool' if with_tool else 'coach'}-setup.png")
        return
    if with_tool:
        page.evaluate("document.activeElement.blur()")
        checks.ok(page.evaluate("() => !document.querySelector('#lg-coach')?.contains(document.activeElement)"),
                  f"{tag} 초점이 코치 밖")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        # D-83 각주: 도구 선택 취소(지도 조작 모드 해제)가 코치보다 먼저다.
        checks.test(f"{tag} Esc1 → 도구 선택 취소", lambda: page.evaluate(TOOL_MODE_JS) != "solar")
        checks.test(f"{tag} Esc1 → 코치 그대로", lambda: shown(page, "#lg-coach"))
        checks.test(f"{tag} Esc1 → 서랍 그대로", lambda: shown(page, "#lg-panel"))
    else:
        page.locator("#lg-coach-close").focus()
        checks.ok(page.evaluate("() => !!document.querySelector('#lg-coach')?.contains(document.activeElement)"),
                  f"{tag} 초점이 코치 안")
    # D-83 ② 코치 > ⑤ 서랍, 총괄 10-21
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    step = "Esc2" if with_tool else "Esc1"
    checks.test(f"{tag} {step} → 코치 닫힘", lambda: not shown(page, "#lg-coach"))
    checks.test(f"{tag} {step} → 서랍 열림 유지", lambda: shown(page, "#lg-panel"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    step = "Esc3" if with_tool else "Esc2"
    checks.test(f"{tag} {step} → 서랍도 닫힘", lambda: not shown(page, "#lg-panel"))
    capture(checks, page, label, f"d83-{'tool' if with_tool else 'coach'}")


FOCUS_CANVAS_JS = """() => {
  // 지도 캔버스에 초점만 옮긴다. 클릭하면 고른 도구로 설비가 지어지므로 누르지 않는다.
  const c = [...document.querySelectorAll('#bd-root canvas')].find(n => n.getClientRects().length);
  if (!c) return 'no-canvas';
  c.focus();
  return document.activeElement === c ? 'ok' : 'not-focusable';
}"""


def esc_more(checks, context, base, label, pages, case):
    """D-83 본문·각주(10-21)와 총괄 확인 '코치가 없을 때 서랍과 도구가 함께 있으면 서랍(⑤)이 도구 취소보다 먼저'.

    (a) 코치·서랍, 도구 없음, 초점 body: Esc1 코치만, Esc2 서랍.
    (b) 코치 없음, 도구 선택 뒤 서랍, 초점 body: Esc1 서랍만(도구 유지), Esc2 도구 취소.
    (c) 코치·서랍, 도구 선택, 초점 지도 캔버스(코치 밖): Esc1 도구 취소·코치·서랍 그대로(각주).
    """
    tag = f"{label} D-83 Esc({case})"
    _, page = setup_solo(context, base, pages)
    page.wait_for_selector("#lg-coach", timeout=60000)
    page.wait_for_timeout(1200)  # ux_coach.py와 같은 안정 대기
    if case == "b":
        page.locator("#lg-coach-close").click()
        page.wait_for_timeout(300)
    if case in ("b", "c"):
        page.locator('#bd-root [data-group="ren"]:visible').click()
        page.locator('#bd-root [data-tool="solar"]:visible').click()
    open_panel(page, "city")
    coach_expected = case != "b"
    ready = shown(page, "#lg-coach") == coach_expected and shown(page, "#lg-panel")
    if case in ("b", "c"):
        ready = ready and page.evaluate(TOOL_MODE_JS) == "solar"
    focus = "body"
    if case == "c":
        focus = page.evaluate(FOCUS_CANVAS_JS)
        ready = ready and focus == "ok"
    else:
        page.evaluate("document.activeElement.blur()")
        ready = ready and page.evaluate("() => document.activeElement === document.body")
    if not checks.ok(ready, f"{tag} 장면 준비(코치 {'열림' if coach_expected else '없음'}·서랍 열림"
                     f"{'·태양광 도구' if case != 'a' else ''}·초점 {focus})"):
        screenshot(checks, page, f"peek-{label}-d83{case}-setup.png")
        return

    def esc():
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    if case == "a":
        # D-83 ② 코치 > ⑤ 서랍(초점 위치와 무관), 총괄 10-21
        esc()
        checks.test(f"{tag} Esc1 → 코치 닫힘", lambda: not shown(page, "#lg-coach"))
        checks.test(f"{tag} Esc1 → 서랍 열림 유지", lambda: shown(page, "#lg-panel"))
        esc()
        checks.test(f"{tag} Esc2 → 서랍 닫힘", lambda: not shown(page, "#lg-panel"))
    elif case == "b":
        # 총괄 확인(10-21): 코치가 없으면 ⑤ 서랍이 도구 취소보다 먼저
        esc()
        checks.test(f"{tag} Esc1 → 서랍 닫힘", lambda: not shown(page, "#lg-panel"))
        checks.test(f"{tag} Esc1 → 도구 유지(data-mode solar)", lambda: page.evaluate(TOOL_MODE_JS) == "solar")
        esc()
        checks.test(f"{tag} Esc2 → 도구 취소(data-mode solar 아님)", lambda: page.evaluate(TOOL_MODE_JS) != "solar")
    else:
        # D-83 각주(10-21): 도구를 고르고 초점이 코치 밖이면 도구 취소가 코치보다 먼저
        esc()
        checks.test(f"{tag} Esc1 → 도구 취소", lambda: page.evaluate(TOOL_MODE_JS) != "solar")
        checks.test(f"{tag} Esc1 → 코치 그대로", lambda: shown(page, "#lg-coach"))
        checks.test(f"{tag} Esc1 → 서랍 그대로", lambda: shown(page, "#lg-panel"))
    capture(checks, page, label, f"d83{case}")


FOCUS_IN_PANEL_JS = """() => {
  const panel = document.querySelector('#lg-panel');
  if (!panel) return 'no-panel';
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const n = [...panel.querySelectorAll(sel)].find(x => x.getClientRects().length && !x.disabled &&
    getComputedStyle(x).visibility !== 'hidden');
  if (!n) return 'no-control';
  n.focus();
  return panel.contains(document.activeElement) ? 'ok' : 'not-focused';
}"""
FOCUS_AFTER_JS = """() => {
  const a = document.activeElement;
  return {body: !a || a === document.body || a === document.documentElement,
    opener: !!a && a.matches('#lg-bar [data-panel="city"]'),
    inCoach: !!document.querySelector('#lg-coach')?.contains(a),
    desc: a ? (a.id ? '#' + a.id : a.tagName.toLowerCase()) + (a.dataset?.panel ? `[${a.dataset.panel}]` : '') : null};
}"""


def esc_focus_layer(checks, context, base, label, pages):
    """(d) D-83 각주2(총괄 10-21): '키보드 초점이 어떤 층(코치, 덱, 리그 서랍) 안에 있으면 그 층이 기본 순서보다
    먼저 Esc를 받는다. 초점이 body·지도·층 밖이면 기본 순서(①~⑥)를 따른다.'
    코치가 뜬 첫 달에 도시 서랍을 열고 초점을 서랍 안 조작 요소로 옮긴다(도구는 고르지 않음).
    기대: Esc1 → 서랍 닫힘·코치 유지·초점이 body가 아닌 화면 요소(서랍을 연 단추가 바람직), Esc2 → 코치 닫힘.
    """
    tag = f"{label} D-83 각주2 Esc(초점 서랍 안)"
    _, page = setup_solo(context, base, pages)
    page.wait_for_selector("#lg-coach", timeout=60000)
    page.wait_for_timeout(1200)  # ux_coach.py와 같은 안정 대기
    open_panel(page, "city")
    focus = page.evaluate(FOCUS_IN_PANEL_JS)
    ready = shown(page, "#lg-coach") and shown(page, "#lg-panel") and focus == "ok"
    if not checks.ok(ready, f"{tag} 장면 준비(코치·서랍 열림·초점 서랍 안: {focus})"):
        screenshot(checks, page, f"peek-{label}-setup.png")
        return
    # D-83 각주2: 초점이 있는 층(⑤ 서랍)이 기본 순서(② 코치)보다 먼저
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    checks.test(f"{tag} Esc1 → 서랍 닫힘", lambda: not shown(page, "#lg-panel"))
    checks.test(f"{tag} Esc1 → 코치 유지", lambda: shown(page, "#lg-coach"))
    after = page.evaluate(FOCUS_AFTER_JS)
    checks.ok(not after["body"], f"{tag} Esc1 → 초점이 body가 아닌 화면 요소로 돌아감: {after['desc']}")
    # 명세는 '서랍을 연 단추(또는 body가 아닌 화면 요소)'라 단추 복귀는 참고로만 출력한다.
    print(f"INFO {tag} Esc1 뒤 초점 {after['desc']} (도시 단추 복귀 {after['opener']}, 코치 안 {after['inCoach']})",
          flush=True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    checks.test(f"{tag} Esc2 → 코치 닫힘", lambda: not shown(page, "#lg-coach"))
    capture(checks, page, label, "d83d")


FOCUS_IN_DECK_JS = """() => {
  const deck = [...document.querySelectorAll('.fx-turn-cards')].find(d => d.getClientRects().length);
  if (!deck) return 'no-deck';
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const n = [...deck.querySelectorAll(sel)].find(x => x.getClientRects().length && !x.disabled &&
    getComputedStyle(x).visibility !== 'hidden');
  if (!n) return 'no-control';
  n.focus();
  return deck.contains(document.activeElement) ? 'ok' : 'not-focused';
}"""
# 덱 닫힘 또는 펼친 덱 접힘. fx_event.py와 같은 공개 상태 KCP.fxTurn.state()만 읽는다.
DECK_FOLDED_JS = """() => {
  const fx = KCP.fxTurn?.state?.() || {};
  const expanded = [...document.querySelectorAll('.fx-turn-cards .fx-turn-expand')]
    .some(b => b.getAttribute('aria-expanded') === 'true');
  return fx.forecastOpen === false || fx.cardsOpen === false || (fx.strip === true && !expanded);
}"""


def esc_deck_focus(checks, context, base, label, pages):
    """(e) D-83 각주2 덱(총괄 10-21): '키보드 초점이 어떤 층(코치, 덱, 리그 서랍) 안에 있으면 그 층이 기본 순서보다
    먼저 Esc를 받는다.' 기본 순서로는 ② 코치가 ④·⑥ 덱보다 먼저지만, 초점이 덱 안이면 덱이 먼저다.

    장면은 fx_event.py의 고정 시작본 첫 판(fixtures[0])을 같은 복원 경로로 넣어 만든다. fx_event.py esc_one_layer가
    이 판의 1월을 '실제 예보 열림 + 첫 달 코치 보임' 판으로 쓴다. 예보 덱은 10초 뒤 자동으로 닫히므로
    준비 뒤 곧바로 Esc를 누르고, 8초를 넘기면 INFO로 알린다(fx_event.py TimedChecks와 같은 기준).
    """
    from fx_event import DOM_JS as FX_DOM_JS, restore_fixture, seeded_fixtures, wait_state  # 지연 import: 실패해도 다른 장면에 영향 없음
    tag = f"{label} D-83 각주2 덱 Esc(초점 덱 안)"
    fixture = seeded_fixtures()[0]
    page, events = monitored_page(context)
    pages.append((page, events, "solo"))
    restore_fixture(checks, page, base, tag + " 고정 시작본", fixture)
    wait_state(page, 1, ["plan"])
    page.wait_for_function("""() => {
      const dom=(""" + FX_DOM_JS + """);
      const fx=KCP.fxTurn?.state?.();
      return !!fx?.forecastOpen && !fx.playing && dom.cards().some(c=>c.visible);
    }""", timeout=15000)
    started = time.monotonic()
    focus = page.evaluate(FOCUS_IN_DECK_JS)
    coach_up = shown(page, "#lg-coach")
    folded = page.evaluate(DECK_FOLDED_JS)  # Esc 전부터 접힌 것으로 읽히면 Esc1 단언이 공짜로 통과한다
    ready = coach_up and focus == "ok" and not folded
    if not checks.ok(ready, f"{tag} 장면 준비(덱 열림 판정 {not folded}·코치 {'보임' if coach_up else '없음'}·예보 덱 보임·초점 덱 안: {focus})"):
        screenshot(checks, page, f"peek-{label}-setup.png")
        return
    # D-83 각주2: 초점이 있는 층(덱)이 기본 순서(② 코치)보다 먼저
    page.keyboard.press("Escape")
    checks.test(f"{tag} Esc1 → 덱 닫힘(또는 펼친 덱 접힘)", lambda: bool(
        page.wait_for_function(DECK_FOLDED_JS, timeout=1000)))
    checks.test(f"{tag} Esc1 → 코치 유지", lambda: shown(page, "#lg-coach"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    checks.test(f"{tag} Esc2 → 코치 닫힘", lambda: not shown(page, "#lg-coach"))
    elapsed = time.monotonic() - started
    if elapsed > 8:
        print(f"INFO {tag} 덱 표시 확인 뒤 {elapsed:.2f}초 > 8초: 10초 자동 닫힘과 겹칠 수 있음", flush=True)
    capture(checks, page, label, "d83e")


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height in ((1280, 900), (390, 844)):
                for scheme in ("light", "dark"):
                    for mode in ("econ", "solo", "season"):
                        label = f"{mode}-{width}x{height}-{scheme}"
                        context, external = context_for(browser, base, width, height, scheme)
                        context.add_init_script(WIRE_JS)
                        pages = []
                        try:
                            scenario(checks, context, base, label, mode, pages)
                        except Exception as exc:
                            checks.ok(False, f"{label} U5 진행 예외 {type(exc).__name__}: "
                                      f"{str(exc).splitlines()[0][:200]}")
                            for page, _, role in pages:
                                screenshot(checks, page, f"peek-{label}-{role}-failure.png")
                        finally:
                            for page, events, role in pages:
                                overflow(checks, page, f"{label} {role} 마지막 화면")
                                diagnostics(checks, events, f"{label} {role}")
                            checks.ok(not external, f"{label} U5 외부 연결 시도 0: {external}")
                            context.close()
                # D-83 ② 코치 > ⑤ 서랍, 총괄 10-21: 밝음 한 번, 판마다 새 컨텍스트(코치는 첫 달에만 뜸).
                for with_tool in (False, True):
                    label = f"d83-{'tool' if with_tool else 'coach'}-{width}x{height}-light"
                    context, external = context_for(browser, base, width, height, "light")
                    pages = []
                    try:
                        esc_coach_drawer(checks, context, base, label, pages, with_tool)
                    except Exception as exc:
                        checks.ok(False, f"{label} D-83 진행 예외 {type(exc).__name__}: "
                                  f"{str(exc).splitlines()[0][:200]}")
                        for page, _, role in pages:
                            screenshot(checks, page, f"peek-{label}-{role}-failure.png")
                    finally:
                        for page, events, role in pages:
                            overflow(checks, page, f"{label} {role} 마지막 화면")
                            diagnostics(checks, events, f"{label} {role}")
                        checks.ok(not external, f"{label} D-83 외부 연결 시도 0: {external}")
                        context.close()
                # D-83 본문·각주와 총괄 확인(코치 없으면 서랍 > 도구 취소): 장면 a·b·c, 판마다 새 컨텍스트.
                for case in ("a", "b", "c"):
                    label = f"d83{case}-{width}x{height}-light"
                    context, external = context_for(browser, base, width, height, "light")
                    pages = []
                    try:
                        esc_more(checks, context, base, label, pages, case)
                    except Exception as exc:
                        checks.ok(False, f"{label} D-83 진행 예외 {type(exc).__name__}: "
                                  f"{str(exc).splitlines()[0][:200]}")
                        for page, _, role in pages:
                            screenshot(checks, page, f"peek-{label}-{role}-failure.png")
                    finally:
                        for page, events, role in pages:
                            overflow(checks, page, f"{label} {role} 마지막 화면")
                            diagnostics(checks, events, f"{label} {role}")
                        checks.ok(not external, f"{label} D-83 외부 연결 시도 0: {external}")
                        context.close()
                # D-83 각주2(총괄 10-21): 초점이 있는 층이 먼저. 장면 d, 새 컨텍스트.
                label = f"d83d-{width}x{height}-light"
                context, external = context_for(browser, base, width, height, "light")
                pages = []
                try:
                    esc_focus_layer(checks, context, base, label, pages)
                except Exception as exc:
                    checks.ok(False, f"{label} D-83 각주2 진행 예외 {type(exc).__name__}: "
                              f"{str(exc).splitlines()[0][:200]}")
                    for page, _, role in pages:
                        screenshot(checks, page, f"peek-{label}-{role}-failure.png")
                finally:
                    for page, events, role in pages:
                        overflow(checks, page, f"{label} {role} 마지막 화면")
                        diagnostics(checks, events, f"{label} {role}")
                    checks.ok(not external, f"{label} D-83 각주2 외부 연결 시도 0: {external}")
                    context.close()
                # D-83 각주2 덱(총괄 10-21): 초점이 덱 안이면 덱이 코치보다 먼저. 장면 e, 새 컨텍스트.
                label = f"d83e-{width}x{height}-light"
                context, external = context_for(browser, base, width, height, "light")
                pages = []
                try:
                    esc_deck_focus(checks, context, base, label, pages)
                except Exception as exc:
                    checks.ok(False, f"{label} D-83 각주2 덱 진행 예외 {type(exc).__name__}: "
                              f"{str(exc).splitlines()[0][:200]}")
                    for page, _, role in pages:
                        screenshot(checks, page, f"peek-{label}-{role}-failure.png")
                finally:
                    for page, events, role in pages:
                        overflow(checks, page, f"{label} {role} 마지막 화면")
                        diagnostics(checks, events, f"{label} {role}")
                    checks.ok(not external, f"{label} D-83 각주2 덱 외부 연결 시도 0: {external}")
                    context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
