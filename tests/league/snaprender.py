"""팀 서랍 스냅숏 다시 그리기 수용 검사 — 브라우저 실행은 샌드박스 밖 총괄 담당.

실행: tests/.venv/bin/python tests/league/snaprender.py http://127.0.0.1:<포트>/index.html

명세(구현과 독립):
- 진행자는 내용이 같아도 4초마다 공개 스냅숏을 다시 보내고(연결 복구), 상태가 바뀌면 약 150ms 뒤 다시 보낸다.
- S1. 받은 스냅숏이 지난번과 내용이 같으면(맨 위 now만 다름) 팀 화면은 서랍(#lg-panel)을 다시 그리지 않는다.
  같은 스냅숏을 두 번 이상 받은 뒤(9초 넘게)에도 서랍 안 요소([data-compared] 체크박스, .lg-ptabs)가 같은 DOM 노드다.
- S2. 내용이 바뀐 스냅숏이면 서랍을 다시 그리고 새 내용을 보인다.
- S3. 학생이 서랍 안을 누르는 동안과 뗀 뒤 약 300ms 동안은 스냅숏 때문에 다시 그리지 않고 미룬다.
  누른 요소는 같은 노드로 남고, 뗀 뒤 1.5초 안에 미뤘던 다시 그리기가 일어난다.
  (누른 채 3초 넘게 버티는 상한은 검사하지 않는다. 그래서 누른 시간을 3초보다 짧게 유지한다.)

내용 변화는 진행자 화면의 '+1분'(#lg-extend) 단추로 즉시 보내게 한다. 이 단추는 공개 스냅숏의
ends·rev를 바꾸지만 서랍 본문에는 보이지 않으므로, 단추를 누르기 전에 진행자 상태의 공개 값 하나
(내 도시 지지율)를 검사 API로 바꿔 둔다. 도시 서랍(#lg-bar의 '도시')이 이 값을 지표 칸
'<dt>지지율</dt><dd>N%</dd>'로 보인다(소수 한 자리). 검사는 이 칸을 '지지율 N%'로 읽는다.
판정 기준: 단언 실패·콘솔 error/warning·페이지 오류·가로 스크롤 0. 1280×900 밝음, 멀티 한 판만.
"""

import sys
import time

from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, select_mode
from econui import (Checks, context_for, diagnostics, local_address, monitored_page,
                    open_panel, overflow)
from s7 import SYNC, expected_operation, plan_and_trial, promise

TEAM = "pyeongtaek"
QUIET_MS = 9500  # 4초 주기 재전송 두 번 이상. 명세 S1의 '≥ 9초'.
RELEASE_MS = 1500  # 명세 S3: 뗀 뒤 1.5초 안.

# 서랍 안 요소에 표지를 붙이고 창 수준 참조로 붙잡는다. 같은 노드인지는 표지와 isConnected로 본다.
TAG_JS = """([selector, key, mark]) => {
  const el = document.querySelector('#lg-panel ' + selector);
  if (!el) return false;
  el.__snapTest = mark; window.__keep = window.__keep || {}; window.__keep[key] = el;
  return true;
}"""
SAME_JS = """([selector, key, mark]) => {
  const kept = window.__keep?.[key], now = document.querySelector('#lg-panel ' + selector);
  return !!kept && kept.isConnected && now === kept && now.__snapTest === mark;
}"""
GONE_JS = "key => !!window.__keep?.[key] && !window.__keep[key].isConnected"
SNAP_NOW = "() => KCP.league.state().snap?.now || 0"
HOST_REV = "() => KCP.league.state().S.rev"
# 도시 서랍 지표 칸의 지지율. dt '지지율' 옆 dd를 '지지율 N%'로 읽는다(없으면 빈 문자열).
APPROVAL_FN = """() => {
  const dt = [...document.querySelectorAll('#lg-panel .lg-pbody .lg-kpi dt')].find(d => d.textContent.trim() === '지지율');
  const dd = dt?.nextElementSibling;
  return dd ? '지지율 ' + dd.textContent.trim() : '';
}"""
BODY_TEXT = APPROVAL_FN
# 검사 API: 진행자 상태(공개 스냅숏의 econ.cities[도시].approval이 되는 값)만 바꾼다. 전송은 진행자 단추가 한다.
SET_APPROVAL = """([id, value]) => {
  const S = KCP.league.state().S; S.econ.cities[id].approval = value; S.rev++;
  return S.econ.cities[id].approval;
}"""
CENTER_JS = """selector => {
  const r = document.querySelector('#lg-panel ' + selector)?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? [r.x + r.width / 2, r.y + r.height / 2] : null;
}"""


def approval_text(value):
    # 화면 숫자 표기(ko-KR, 소수 한 자리). 검사 값은 소수 한 자리로 고른다.
    return f"지지율 {value:.1f}%"


def pick_value(current, candidates):
    return next(v for v in candidates if abs(v - current) >= 0.5)


def extend(host):
    """진행자 '+1분' 단추. 공개 스냅숏의 ends·rev가 바뀌고 약 150ms 뒤 다시 보낸다."""
    button = host.locator("#lg-extend")
    if button.count() and button.is_visible():
        button.click()
    else:
        # 화면 밖·접힌 영역이면 같은 단추의 처리기를 직접 부른다(숨김 단추면 ends가 없어 실패로 남는다).
        assert host.evaluate("() => { const b=document.getElementById('lg-extend'); if (!b || b.hidden) return false; b.click(); return true; }"), \
            "진행자 '+1분' 단추 없음(ends 없음)"


def to_review(host, team):
    trial = plan_and_trial(team)
    host.wait_for_function(f"() => KCP.league.state().S.teams.{TEAM}.plan.policies.includes('save')")
    forecast = expected_operation(host, TEAM)
    promise(team, trial, forecast)  # 틀린 예측 → 결과 서랍에 비교 확인 체크박스([data-compared]).
    host.wait_for_function(f"() => KCP.league.state().S.teams.{TEAM}.ready")
    host.locator("#lg-next").click()
    team.wait_for_function(SYNC, arg=[1, "review"])
    host.wait_for_function(SYNC, arg=[1, "review"])


def settle(host, team):
    """팀이 진행자의 최신 공개 상태(rev)를 받을 때까지 기다린다."""
    rev = host.evaluate(HOST_REV)
    team.wait_for_function("rev => KCP.league.state().snap?.rev === rev", arg=rev, timeout=12000)
    return rev


def quiet_identity(checks, host, team, label):
    """S1: 같은 내용 스냅숏 연속 수신 동안 서랍 요소 그대로."""
    open_panel(team, "result")
    team.wait_for_timeout(5000)  # 첫 달 결과 재생이 끝나 서랍이 자리 잡을 때까지.
    targets = [(".lg-ptabs", "tabs"), (".lg-pbody", "body")]
    if team.locator("#lg-panel [data-compared]").count():
        targets.insert(0, ("[data-compared]", "compared"))
    else:
        print(f"INFO {label} [data-compared] 없음 — .lg-ptabs·.lg-pbody로만 동일성 확인", flush=True)
    team.evaluate("() => document.activeElement?.blur?.()")
    for attempt in range(3):
        rev = settle(host, team)
        team.wait_for_timeout(600)  # 팀 쪽에서 이미 예약된 다시 그리기(누름 직후 미룸 포함)가 끝나도록.
        marks = {key: f"s1-{attempt}-{key}" for _, key in targets}
        if not all(team.evaluate(TAG_JS, [sel, key, marks[key]]) for sel, key in targets):
            raise AssertionError("표지를 붙일 서랍 요소 없음")
        before_now = team.evaluate(SNAP_NOW)
        team.wait_for_timeout(QUIET_MS)
        if host.evaluate(HOST_REV) != rev:
            # 그 사이 진행자 상태가 실제로 바뀌었으면(팀 기기의 자동 요청 등) 같은 내용 조건이 아니다. 다시 잰다.
            print(f"INFO {label} S1 시도 {attempt + 1}: 진행자 rev 변화로 다시 잼", flush=True)
            continue
        after_now = team.evaluate(SNAP_NOW)
        # 4초 주기 두 번 이상이면 마지막 now는 시작 직전 now보다 약 8초 뒤다.
        checks.ok(after_now - before_now >= 7000,
                  f"{label} 같은 내용 스냅숏 두 번 이상 수신(now {after_now - before_now}ms 진행)")
        for sel, key in targets:
            checks.ok(team.evaluate(SAME_JS, [sel, key, marks[key]]),
                      f"{label} 같은 스냅숏 연속 수신 뒤 서랍 요소 그대로 ({sel})")
        return
    checks.ok(False, f"{label} 같은 스냅숏 연속 수신 뒤 서랍 요소 그대로 (진행자 상태가 계속 바뀌어 조건을 못 만듦)")


def content_change(checks, host, team, label):
    """S2: 내용이 바뀐 스냅숏이면 서랍을 다시 그리고 새 내용을 보인다."""
    open_panel(team, "city")
    team.evaluate("() => document.activeElement?.blur?.()")
    settle(host, team)
    team.wait_for_timeout(600)
    current = host.evaluate(f"() => KCP.league.state().S.econ.cities.{TEAM}.approval")
    value = pick_value(current, (7.3, 8.6, 9.4))
    assert team.evaluate(TAG_JS, [".lg-ptabs", "s2tabs", "s2"]), ".lg-ptabs 없음"
    checks.ok(approval_text(value) not in team.evaluate(BODY_TEXT), f"{label} 바꾸기 전 서랍에 새 지지율 없음")
    ends = host.evaluate("() => KCP.league.state().S.ends")
    host.evaluate(SET_APPROVAL, [TEAM, value])
    extend(host)
    checks.test(f"{label} 진행자 '+1분'으로 공개 스냅숏 ends 변화",
                lambda: team.wait_for_function("e => KCP.league.state().snap?.ends === e + 60000",
                                               arg=ends, timeout=6000))
    checks.test(f"{label} 내용이 바뀐 스냅숏이면 서랍 다시 그림",
                lambda: team.wait_for_function(GONE_JS, arg="s2tabs", timeout=6000))
    checks.ok(approval_text(value) == team.evaluate(BODY_TEXT), f"{label} 다시 그린 서랍에 새 내용({approval_text(value)})")
    return value


def press_defers(checks, host, team, label, previous):
    """S3: 누르는 중·뗀 직후에는 다시 그리기를 미루고, 뗀 뒤 1.5초 안에 실행한다."""
    settle(host, team)
    team.wait_for_timeout(800)  # S2 다시 그리기와 그 뒤 누름 미룸 창이 모두 지나도록.
    value = pick_value(previous, (8.6, 9.4, 7.3))
    selector = ".lg-ptabs strong"  # 서랍 제목 글자: 눌러도 상태가 바뀌지 않는 요소.
    for sel, key in ((selector, "pressed"), (".lg-ptabs", "s3tabs")):
        assert team.evaluate(TAG_JS, [sel, key, "s3-" + key]), f"{sel} 없음"
    center = team.evaluate(CENTER_JS, selector)
    assert center, "서랍 제목 위치 없음"
    team.mouse.move(*center)
    team.mouse.down()
    pressed_at = time.monotonic()
    try:
        host.evaluate(SET_APPROVAL, [TEAM, value])
        extend(host)
        checks.test(f"{label} 누르는 동안 바뀐 스냅숏 수신",
                    lambda: team.wait_for_function(
                        "([id, v]) => KCP.league.state().snap?.econ?.cities?.[id]?.approval === v",
                        arg=[TEAM, value], timeout=2000))
        team.wait_for_timeout(800)
        held = time.monotonic() - pressed_at
        # 3초 상한 전에 판정해야 미룸만 본다. 넘었으면 시점 조건 실패로 남긴다.
        checks.ok(held < 2.8, f"{label} 누름 유지 {held:.2f}초 < 3초 상한")
        checks.ok(team.evaluate(SAME_JS, [selector, "pressed", "s3-pressed"]) and
                  team.evaluate(SAME_JS, [".lg-ptabs", "s3tabs", "s3-s3tabs"]),
                  f"{label} 누르는 중에는 다시 그리기 미룸(누른 요소 같은 노드)")
        checks.ok(approval_text(value) not in team.evaluate(BODY_TEXT),
                  f"{label} 누르는 중에는 새 내용으로 바뀌지 않음")
    finally:
        team.mouse.up()
    released = time.monotonic()
    checks.test(f"{label} 뗀 뒤 미뤘던 다시 그리기 실행(1.5초 안)",
                lambda: team.wait_for_function(
                    "([key, text]) => !window.__keep?.[key]?.isConnected && (" + APPROVAL_FN + ")() === text",
                    arg=["pressed", approval_text(value)], timeout=RELEASE_MS))
    print(f"INFO {label} 뗀 뒤 다시 그리기까지 {time.monotonic() - released:.2f}초", flush=True)


def multiplayer(checks, context, base, label, pages):
    host, he = monitored_page(context)
    pages.append((host, he, "host"))
    host.goto(base + "#league")
    select_mode(host, "host")
    host.locator('[data-preset="3"]').click()
    host.locator('[data-turns="12"]').click()
    host.locator("#lg-host-seed").select_option("fixed")
    host.locator("#lg-host").click()
    host.wait_for_selector("#lg-roomcode")
    room = host.locator("#lg-roomcode").inner_text()
    team, te = monitored_page(context)
    pages.append((team, te, "team"))
    team.goto(base + "#league")
    select_mode(team, "join")
    team.locator("#lg-code").fill(room)
    team.locator("#lg-join").click()
    confirm_seat(team, TEAM)
    host.locator("#lg-next").click()
    team.wait_for_function(SYNC, arg=[1, "plan"])
    to_review(host, team)
    quiet_identity(checks, host, team, label + " S1")
    value = content_change(checks, host, team, label + " S2")
    press_defers(checks, host, team, label + " S3", value)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            label = "1280x900-light"
            context, external = context_for(browser, base, 1280, 900, "light")
            pages = []
            try:
                multiplayer(checks, context, base, label, pages)
            except Exception as exc:
                checks.ok(False, f"{label} {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
            finally:
                for page, events, role in pages:
                    diagnostics(checks, events, f"{label} {role}")
                    overflow(checks, page, f"{label} {role} final")
                checks.ok(not external, f"{label} 외부 연결 시도 0: {external}")
                context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
