"""ECON-UI U3: 화면 버튼만 눌러 혼자 하기 12달 완주.

evaluate는 상태/저장/DOM 조회만 한다. 엔진 호출·상태 주입·AI 대체는 금지.
새 컨텍스트의 빈 저장소로 시작하며 새로고침은 한 번 수행한다.
실행: python3 tests/league/solo.py <로컬 주소> (브라우저 실행은 총괄 담당).
"""

from league_flow import finish_trial
from league_flow import pass_issue_check
import json
import re
import sys

from playwright.sync_api import expect, sync_playwright
from league_flow import select_mode, start_solo

from econui import (Checks, UI_WAIT, WAIT, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, rank_checks,
                    screenshot, shown)

KEY = "kcp-league-solo-v1"
# 저장 wrapper 필드는 U3에 미지정. 전체 규칙 상태는 teams/phase/round로 식별한다.
# UI 코드의 비공개 변수 이름에는 의존하지 않는다.
READ_JS = r"""() => {
  const raw = localStorage.getItem('kcp-league-solo-v1');
  let save = null, invalid = false;
  try { save = raw === null ? null : JSON.parse(raw); } catch (_) { invalid = true; }
  const find = (x, depth=0) => {
    if (!x || typeof x !== 'object' || depth > 4) return null;
    if (x.teams && typeof x.phase === 'string' && Number.isInteger(x.round)) return x;
    for (const child of Object.values(x)) { const S = find(child, depth+1); if (S) return S; }
    return null;
  };
  const L = window.KCP && KCP.league && KCP.league.state ? KCP.league.state() : null;
  const live = find(L), saved = find(save), S = live || saved;
  const active = S ? (S.active || Object.keys(S.teams)) : [];
  const player = (L && L.team) || (save && (save.team || save.player || save.human || save.myCity));
  return {raw:raw !== null, invalid, saved, live, S, player, active,
    hash:location.hash, soloKeys:Object.keys(localStorage).filter(k => k.startsWith('kcp-league-solo'))};
}"""
STATE_READY_JS = r"""() => {
  const find = (x, depth=0) => {
    if (!x || typeof x !== 'object' || depth > 4) return false;
    if (x.teams && typeof x.phase === 'string' && Number.isInteger(x.round)) return true;
    return Object.values(x).some(v => find(v, depth+1));
  };
  const L = window.KCP && KCP.league && KCP.league.state ? KCP.league.state() : null;
  if (find(L)) return true;
  try { return find(JSON.parse(localStorage.getItem('kcp-league-solo-v1'))); }
  catch (_) { return false; }
}"""
CHANGED_JS = r"""([oldRound, oldPhase, oldCount]) => {
  const find = (x, depth=0) => {
    if (!x || typeof x !== 'object' || depth > 4) return null;
    if (x.teams && typeof x.phase === 'string' && Number.isInteger(x.round)) return x;
    for (const v of Object.values(x)) { const found = find(v, depth+1); if (found) return found; }
    return null;
  };
  const L = window.KCP && KCP.league && KCP.league.state ? KCP.league.state() : null;
  let S = find(L);
  if (!S) { try { S = find(JSON.parse(localStorage.getItem('kcp-league-solo-v1'))); } catch (_) {} }
  return !!S && (S.round !== oldRound || S.phase !== oldPhase ||
    (S.results || []).length !== oldCount);
}"""
# // ECON-UI v1.1: 준비 뒤에는 단계 전환 또는 건너뛰기 카드가 열릴 때까지 기다린다.
PROGRESS_OR_PREDICT_JS = """args => {
  const skip = document.querySelector('#lg-predict-skip');
  return (""" + CHANGED_JS + """)(args) || !!(skip && skip.getClientRects().length);
}"""


def read(page):
    return page.evaluate(READ_JS)


def fingerprint(state):
    """재시작/재운영을 잡도록 달·단계·결과·경제·모든 팀 계획·연계선을 비교한다."""
    if not state:
        return None
    teams = {key: {field: value.get(field) for field in
                   ("plan", "econPol", "base", "hist", "ready", "crit")}
             for key, value in state["teams"].items()}
    return json.dumps({"round": state["round"], "phase": state["phase"],
                       "active": state.get("active"), "rounds": state.get("rounds"),
                       "results": state.get("results"), "econ": state.get("econ"),
                       "teams": teams, "ties": state.get("ties")},
                      ensure_ascii=False, sort_keys=True)


def start(page):
    start_solo(page)
    page.wait_for_function(STATE_READY_JS)
    page.wait_for_timeout(400)
    return read(page)


def close_drawer(page):
    close = page.locator(".lg-px")
    if close.count() and close.first.is_visible():
        close.first.click()


def settle_progress(page, previous):
    """rev15 명세 #53-1: 달 운영 계산 중이거나 결과 직후 600ms 가드 중에는 #lg-ready가 잠깐 꺼진다.
    꺼져 있으면 최대 3초 기다린다(다른 이유로 계속 꺼져 있으면 예전처럼 다른 후보를 찾게 넘긴다).
    그 사이 단계가 이미 바뀌었으면 True: 다시 누르면 결과를 건너뛰므로 누르지 않는다."""
    ready_button = page.locator("#lg-ready")
    if ready_button.count() and ready_button.is_visible() and not ready_button.is_enabled():
        try:
            # 재검토 minor 2: 감속 실행(KCP_UI_WAIT)에서는 계산 시간도 늘어나므로 대기도 비례해 늘린다(기본 3초).
            expect(ready_button).to_be_enabled(timeout=max(3000, int(UI_WAIT * 0.6)))
        except AssertionError:
            pass
    return page.evaluate(CHANGED_JS, previous)


def click_next(page, state):
    close_drawer(page)
    if settle_progress(page, [state["round"], state["phase"], len(state.get("results", []))]):
        page.wait_for_timeout(400)
        return read(page)
    # 기존 팀 '준비'가 우선. 결과→다음 달도 UI에 있는 버튼만 누른다.
    candidates = [page.locator("#lg-ready"), page.locator("#lg-next"),
                  page.get_by_role("button", name=re.compile(
                      r"^(?:준비(?: 완료)?|다음 (?:달|턴|라운드)(?:.*)?|"
                      r"최종 (?:결과|순위)(?:.*)?|리그 끝|끝내기|운영(?:.*)?|"
                      r"(?:1월|1달|첫 달|게임) 시작)$"))]
    for locator in candidates:
        for i in range(locator.count()):
            button = locator.nth(i)
            if button.is_visible() and button.is_enabled():
                ready = button.get_attribute("id") == "lg-ready"
                button.click()
                if ready:
                    pass_issue_check(page)
                previous = [state["round"], state["phase"], len(state.get("results", []))]
                # // ECON-UI v1.1: 준비가 예측 카드만 열었으면 화면의 건너뛰기로 준비를 확정한다.
                if ready:
                    page.wait_for_function(PROGRESS_OR_PREDICT_JS, arg=previous)
                    if not page.evaluate(CHANGED_JS, previous):
                        page.locator("#lg-predict-skip").click()
                page.wait_for_function(CHANGED_JS, arg=previous)
                page.wait_for_timeout(400)
                return read(page)
    raise AssertionError(f"{state['round']}달 {state['phase']}: 누를 진행 버튼 없음")


def response_evidence(state, proposal):
    """수락/거절 모두 답이다. 단순히 제안이 사라진 것만으로는 통과시키지 않는다."""
    if not state or not proposal:
        return False
    for tie in state.get("ties", []):
        if {tie.get("a"), tie.get("b")} == {proposal["human"], proposal["other"]}:
            if tie.get("st") in ("built", "accepted", "rejected", "declined"):
                return True
            if tie.get("response") in ("accept", "reject", "accepted", "rejected"):
                return True
    # // ECON-UI v1.1: 새 응답 로그의 수락·거절·연결·거둠을 인정하며 상대 도시·연계선 조건은 유지한다.
    for item in state.get("log", []):
        text = item if isinstance(item, str) else str(item.get("t", item.get("text", item.get("msg", ""))))
        if (text not in proposal["old_log"] and proposal["other_name"] in text and
                "연계선" in text and re.search(r"수락|거절|연결|거둠", text)):
            return True
    return False


def propose(page, observation):
    open_panel(page, "deal")
    buttons = page.locator('[data-tie="propose"][data-other][data-cap]')
    human = observation["player"]
    computers = set(observation["active"]) - {human}
    for i in range(buttons.count()):
        button = buttons.nth(i)
        other = button.get_attribute("data-other")
        if other in computers and button.is_visible() and button.is_enabled():
            old_log = []
            for item in observation["S"].get("log", []):
                old_log.append(item if isinstance(item, str) else
                               str(item.get("t", item.get("text", item.get("msg", "")))))
            proposal = {"human": human, "other": other, "old_log": old_log,
                        "other_name": page.evaluate("id => KCP.ECON_DATA.start[id].name", other)}
            button.click()
            page.wait_for_timeout(400)
            return proposal
    raise AssertionError("컴퓨터 도시에 보낼 활성 연계선 제안 버튼 없음")


def computer_builds(observation):
    human = observation["player"]
    return {city: len((observation["S"]["teams"][city].get("plan") or {}).get("builds", []))
            for city in observation["active"] if city != human}


def resume(checks, page, label):
    page.wait_for_timeout(400)
    before = read(page)
    checks.ok(before["raw"] and not before["invalid"] and before["saved"] is not None,
              f"{label} U3 {KEY}에 전체 규칙 상태 저장")
    checks.ok(before["soloKeys"] == [KEY], f"{label} U3 혼자 하기 저장 키 하나")
    checks.ok(fingerprint(before["S"]) == fingerprint(before["saved"]),
              f"{label} U3 저장 상태 = 현재 상태")
    page.reload()
    page.wait_for_function(STATE_READY_JS)
    page.wait_for_timeout(400)
    after = read(page)
    checks.ok(after["hash"] == "#league/solo", f"{label} U3 새로고침 뒤 혼자 하기 경로")
    checks.ok(fingerprint(before["S"]) == fingerprint(after["S"]),
              f"{label} U3 새로고침 뒤 달·단계·경제·설비·결과·연계선 그대로")
    checks.ok(before["player"] == after["player"], f"{label} U3 새로고침 뒤 내 도시 그대로")
    overflow(checks, page, label + " 새로고침")
    screenshot(checks, page, f"econui-solo-{label}-resume.png")
    return after


def play(checks, page, base, label):
    page.goto(base + "#league")
    select_mode(page, "solo")
    checks.test(f"{label} U3 로비 #lg-solo 카드", lambda: shown(page, "#lg-solo"))
    overflow(checks, page, label + " 로비")
    screenshot(checks, page, f"econui-solo-{label}-lobby.png")
    select_mode(page, "host")
    # 분기 지급·수업 시간 설명은 진행자 설정에 있다. 숨겨진 문구를 읽지 않는다.
    checks.ok(shown(page, '#lg-turnmsg') and
              '분기 초(1·4·7·10월)에 1/4씩' in page.locator('#lg-turnmsg').inner_text() and
              '해마다 1월에 국가 재정지원금' not in page.locator('#lg-turnmsg').inner_text(),
              f'{label} D-A6 로비 분기 지급 설명')
    checks.ok(shown(page, '#lg-class-time') and page.locator('#lg-class-time option').count() == 3 and page.locator('#lg-class-time').input_value() == '100',
              f'{label} U6 로비 수업 시간 50·100·제한 없음')
    overflow(checks, page, label + " 진행자 설정")
    observation = start(page)
    checks.ok(not shown(page, '#lg-panel'), f'{label} U1 혼자 하기 첫 화면 기준 서랍 닫힘')
    # 품질8 UX U5: 한 줄 안내(#lg-first-guide)를 8단계 첫 달 코치 띠(#lg-coach)로 바꿨다.
    checks.ok(shown(page, '#lg-coach'), f'{label} U1 첫 달 단계 안내')
    page.locator('#lg-guide-close').click()
    page.locator('#bd-help').focus(); page.locator('#bd-help').press('Enter')
    checks.ok(shown(page, '#lg-help'), f'{label} U1 혼자 하기 리그 도움말 다시 보기')
    help_text = page.locator('#lg-help').inner_text()
    checks.ok('분기 초(1·4·7·10월)에 1/4씩' in help_text and
              '지방채 한도' in help_text and '빚' in help_text,
              f'{label} D-A6 도움말 분기 지급·지방채 설명')
    page.locator('#lg-panel').press('Escape')
    checks.ok([n.get_attribute('data-run') for n in page.locator('[data-run]:visible').all()] == ['7', '30', '90'],
              f'{label} E C10 혼자 하기는 시험 세 기간 유지')
    page.locator('#bd-pm').click()
    checks.ok(all(not shown(page, sel) for sel in
                  ('[data-tab="research"]', '[data-tab="journal"]', '[data-fab2]')),
              f'{label} E G11·G12·D03 혼자 하기에서도 리그 중복 UI 숨김')
    page.locator('#bd-drawer-x').click()
    for days in (30, 90):
        page.locator(f'[data-run="{days}"]').click()
        finish_trial(page, days)
        checks.ok(page.evaluate('() => KCP.buildGame.lastTrial().days') == days and
                  all(not shown(page, sel) for sel in ('#bd-jopen', '#bd-j-dlg', '#bd-speak')),
                  f'{label} E C10·G12 혼자 하기 {days}일 실제 시험·별도 일지 숨김')
        overflow(checks, page, label + f' E {days}일 시험')
        page.locator('#bd-drawer-x').click()
    page.locator('[data-run="7"]').click()
    trial_uns = finish_trial(page)['unsPct']
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    checks.ok(shown(page, '#lg-predict-skip'), f'{label} U8 혼자 자유 실험에서만 건너뛰기')
    checks.ok(page.locator('#lg-ready-confirm').is_disabled(), f'{label} U8 빈 근거 제출 금지')
    page.locator('[data-evidence="evening"]').click()
    page.locator('[data-pred]').select_option('down')
    page.locator('[data-confidence="fairly"]').click()
    checks.ok(not page.locator('#lg-ready-confirm').is_disabled() and page.locator('[data-pred]').count() == 1,
              f'{label} U8 근거·주제 하나·확신이면 약속 가능')
    calib = page.locator('#lg-calibration').inner_text() if shown(page, '#lg-calibration') else ''
    checks.ok(bool(re.search(r'기록이 쌓이면|기록이 \d+번뿐', calib)) and '순위에는 넣지 않아요' in calib,
              f'{label} U8 혼자 하기 확신 보정·작은 표본 표시')
    close_drawer(page)

    state = observation["S"]
    page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {configurable:true,
      value:{writeText:async text => {window.__soloSheet=text;}}})""")
    open_panel(page, 'journal')
    page.locator('#lg-jcopy').click()
    page.wait_for_function('() => !!window.__soloSheet')
    sheet = page.evaluate('window.__soloSheet')
    checks.ok('내 계획을 기준 먼저' in sheet and '우리 계획을 기준 먼저' not in sheet,
              f'{label} #16 혼자 하기 활동지 끝 성찰은 내 계획')
    initial_fingerprint = fingerprint(state)
    initial_room = state["room"]
    close_drawer(page)
    # 품질8 UX U2(docs/QUALITY-ux.md 6절): '처음부터'는 주 행동 옆 막대에서 도움말 서랍으로 옮겼다.
    # 같은 id·같은 확인 창이므로 도움말을 연 뒤 누른다.
    page.locator("#bd-help").click()
    page.wait_for_selector("#lg-solo-restart", state="visible")
    page.once("dialog", lambda dialog: dialog.dismiss())
    with page.expect_event("dialog") as dialog_info:
        page.locator("#lg-solo-restart").click()
    checks.ok(dialog_info.value.type == "confirm", f"{label} 처음부터 확인 대화상자")
    checks.ok(fingerprint(read(page)["S"]) == initial_fingerprint, f"{label} 처음부터 취소 → 진행 보존")
    checks.ok(state.get("econ") is not None and len(state.get("rounds") or []) == 12,
              f"{label} U3 시작은 경제 모드 12달")
    checks.ok(observation["player"] in observation["active"] and
              2 <= len(observation["active"]) <= 6 and "pyeongtaek" in observation["active"],
              f"{label} U3 내 도시 하나 + 컴퓨터 도시, 필수 도시 포함")
    checks.ok(observation["hash"] == "#league/solo", f"{label} U3 시작 경로")
    checks.test(f"{label} U3 준비 버튼", lambda: shown(page, "#lg-ready"))
    proposal = None
    replied = False
    attempted = False
    reloaded = False
    reviews = set()
    built = {}
    # 12달 × 계획/결과 + 로비/끝. 무한 루프를 막는 실행기 한도다.
    for _ in range(40):
        state = observation["S"]
        current_builds = computer_builds(observation)
        for city, count in current_builds.items():
            built[city] = max(built.get(city, 0), count)
        if response_evidence(state, proposal):
            replied = True
        if state["phase"] == "end":
            break
        if state["phase"] == "plan" and not attempted:
            attempted = True
            try:
                proposal = propose(page, observation)
                checks.ok(True, f"{label} U3 화면 버튼으로 연계선 제안")
                observation = read(page)
                replied = response_evidence(observation["S"], proposal)
            except Exception as exc:
                checks.ok(False, f"{label} U3 화면 버튼으로 연계선 제안: {str(exc).splitlines()[0]}")
            overflow(checks, page, label + " 연계선 서랍")
            screenshot(checks, page, f"econui-solo-{label}-tie.png")
        if state["phase"] == "review" and state["round"] not in reviews:
            reviews.add(state["round"])
            checks.ok(len(state.get("results", [])) == state["round"],
                      f"{label} U3 {state['round']}달 버튼 진행 → 운영 결과")
            if state['round'] == 1:
                open_panel(page, 'result')
                actual = state['results'][-1]['team'][observation['player']]['unsPct']
                expected = round(actual - trial_uns, 2)
                top = page.locator('#lg-result-deltas > div').first.inner_text()
                prediction = page.locator('#lg-promise-result [data-compare="uns"]').inner_text()
                def shown_delta(text):
                    # rev10 R2: S6는 판정 낱말·같음 범위 뒤 괄호 안에 Δ를 둔다.
                    match = re.search(r'시험 1주 대비(?: Δ)?\s*(?:(?:같음|늘어남|줄어듦)\((?:±[\d.]+%p 안, )?)?([+−-]?\d+(?:\.\d+)?)%p', text)
                    return float(match.group(1).replace('−', '-')) if match else None
                checks.ok('시험 1주 대비' in top and '시험 1주 대비' in prediction and
                          shown_delta(top) == shown_delta(prediction) == expected,
                          f'{label} D-A1 첫 달 위·예측 Δ = 시험 1주 대비 같은 값')
                # 품질8 UX U1(docs/QUALITY-ux.md 6절): 서랍 자체 대신 본문(.lg-pbody)만 스크롤하고
                # 제목 줄은 본문 밖에 고정된다. D-A7의 뜻(스크롤해도 제목이 보임)을 새 구조로 확인한다.
                checks.ok(page.evaluate('''() => {
                  const p=document.querySelector('#lg-panel'), h=p.querySelector('.lg-ptabs');
                  const s=p.querySelector('.lg-pbody') || p;
                  const m=p.querySelector('#lg-calibration meter'), before=s.scrollTop, top0=h.getBoundingClientRect().top;
                  s.scrollTop += m.getBoundingClientRect().top-h.getBoundingClientRect().bottom;
                  const a=h.getBoundingClientRect(), b=m.getBoundingClientRect();
                  const kept=Math.abs(a.top-top0)<1 && a.bottom<=b.top+1 &&
                    h.contains(document.elementFromPoint(a.left+a.width/2, a.top+a.height/2));
                  s.scrollTop=before; return kept;
                }'''), f'{label} D-A7 스크롤한 확신 막대 위에 고정 제목 표시')
            overflow(checks, page, f"{label} {state['round']}달 결과")
            if not reloaded:
                observation = resume(checks, page, label)
                reloaded = True
        observation = click_next(page, observation["S"])
        overflow(checks, page, f"{label} {observation['S']['round']}달 {observation['S']['phase']}")
    state = observation["S"]
    checks.ok(state["phase"] == "end" and state["round"] == 12 and
              len(state.get("results", [])) == 12 and (state.get("econ") or {}).get("t") == 12,
              f"{label} U3 버튼 클릭만으로 12달 완주")
    checks.ok(reviews == set(range(1, 13)), f"{label} U3 1–12달 결과 모두 거침")
    checks.ok(reloaded, f"{label} U3 진행 중 새로고침 검사 수행")
    checks.ok(bool(built) and all(count > 0 for count in built.values()),
              f"{label} U3 컴퓨터 도시 실제 설비 수 > 0: {built}")
    checks.ok(replied or response_evidence(state, proposal), f"{label} U3 컴퓨터 연계선 수락/거절 응답")
    # // ECON-UI v1.1: 최종 순위 탭을 직접 열고 공통 data-team·meter[value]·data-total 계약으로 검사한다.
    open_panel(page, "rank")
    rank_checks(checks, page, observation["active"], label + " U3 최종")
    overflow(checks, page, label + " 끝")
    screenshot(checks, page, f"econui-solo-{label}-end.png")
    open_panel(page, "result")
    checks.ok(page.locator('#lg-timeline [data-trend]').count() == 4 and shown(page, '.lg-season-chip'),
              f'{label} U5·U7 끝 화면 타임라인·실제 계절 칩')
    practice_before = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('kcp-league-solo-v1'))?.interview?.freeExperiment ?? null } catch (e) { return 'err' } }")
    page.locator('#lg-solo-same').click()
    page.wait_for_function("""() => KCP.league.state()?.S?.phase === 'plan' && KCP.league.state()?.S?.round === 1""")
    page.wait_for_timeout(400)
    replay = read(page)
    practice_after = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('kcp-league-solo-v1'))?.interview?.freeExperiment ?? null } catch (e) { return 'err' } }")
    checks.ok(practice_after == practice_before, f"{label} 같은 조건으로 다시 → 연습 방식(약속/자유 실험) 유지")
    checks.ok(replay['S']['room'] == initial_room and replay['S']['active'] == observation['active'] and
              replay['S'].get('seedKey') == state.get('seedKey') and replay['S'].get('salt') == state.get('salt'),
              f"{label} 같은 조건으로 다시 → 씨앗·참가 도시 보존")
    checks.ok(fingerprint(replay['S']) == initial_fingerprint,
              f"{label} 같은 조건으로 다시 → 첫 달 경제·계획·연계선 동일")
    overflow(checks, page, label + ' 같은 조건 재시작')


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            # // ECON-UI v1.1: 공통 수용 기준의 데스크톱·모바일을 밝음·어두움 모두 검사한다.
            for width, height in ((1280, 900), (390, 844)):
                for scheme in ("light", "dark"):
                    label = f"{width}x{height}-{scheme}"
                    context, external = context_for(browser, base, width, height, scheme)
                    page, events = monitored_page(context)
                    try:
                        play(checks, page, base, label)
                    except Exception as exc:
                        checks.ok(False, f"{label} U3 진행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
                        screenshot(checks, page, f"econui-solo-{label}-failure.png")
                    finally:
                        diagnostics(checks, events, label + " U3")
                        checks.ok(not external, f"{label} U3 외부 연결 시도 0: {external}")
                        context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
