"""WebKit 리그 검사: 혼자 하기 12달·새로고침 복구와 같은 기기 팀 연결.

실행: tests/.venv/bin/python tests/league/webkit.py <loopback 주소>
브라우저 실행은 샌드박스 밖 로컬 환경에서 총괄이 담당한다.
"""

import sys

from playwright.sync_api import sync_playwright

from econui import (Checks, HOST_JS, SYNC_JS, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, shown)
from league_flow import confirm_seat, select_mode, start_solo
from solo import STATE_READY_JS, click_next, read


def progress(state):
    return state["round"], state["phase"], len(state.get("results", []))


def reload_solo(checks, page, label):
    # 저장은 250ms 지연되므로 저장이 끝난 뒤 새로고침한다(tests.md).
    page.wait_for_timeout(400)
    before = read(page)
    checks.ok(before["raw"] and not before["invalid"] and
              before["saved"] is not None and
              progress(before["saved"]) == progress(before["S"]),
              f"{label} 달·단계·결과 개수 저장")
    page.reload()
    page.wait_for_function(STATE_READY_JS)
    page.wait_for_selector("#lg-bar")
    page.wait_for_timeout(400)
    after = read(page)
    checks.ok(after["hash"] == "#league/solo" and after["live"] is not None and
              progress(before["S"]) == progress(after["live"]),
              f"{label} 새로고침 뒤 같은 달·단계·결과 개수 복구")
    overflow(checks, page, label + " 새로고침")
    return after


def solo_game(checks, context, base, label, pages):
    page, events = monitored_page(context)
    pages.append((page, events, "혼자 하기"))
    page.goto(base + "#league")
    overflow(checks, page, label + " 로비")
    start_solo(page, 12)
    page.wait_for_function(STATE_READY_JS)
    observation = read(page)
    reloaded_fourth = False
    reviews = set()
    # 12달의 단계 전환보다 넉넉한 한도로 진행 버튼 정체를 잡는다.
    for _ in range(40):
        state = observation["S"]
        overflow(checks, page, f"{label} {state['round']}달 {state['phase']}")
        if state["phase"] == "review":
            reviews.add(state["round"])
            checks.ok(len(state.get("results", [])) == state["round"],
                      f"{label} {state['round']}달 운영 결과 개수")
            if state["round"] == 4 and not reloaded_fourth:
                observation = reload_solo(checks, page, label + " 4달 운영 뒤")
                reloaded_fourth = True
        if state["phase"] == "end":
            break
        observation = click_next(page, observation["S"])
    state = observation["S"]
    checks.ok(progress(state) == (12, "end", 12),
              f"{label} 화면 버튼으로 12달 완주")
    checks.ok(reviews == set(range(1, 13)), f"{label} 12달 운영 결과 모두 거침")
    checks.ok(reloaded_fourth, f"{label} 4달 운영 뒤 새로고침 수행")
    if state["phase"] == "end":
        reload_solo(checks, page, label + " 끝")
    else:
        checks.ok(False, f"{label} 끝 단계 새로고침 수행 불가")


def paired_game(checks, context, base, label, pages):
    host, events = monitored_page(context)
    pages.append((host, events, "진행자"))
    host.goto(base + "#league")
    select_mode(host, "host")
    host.locator(".lg-net summary").click()
    host.locator('input[name="lg-net"][value="local"]').check()
    host.locator('[data-turns="12"]').click()
    overflow(checks, host, label + " 진행자 설정")
    # 도시 id는 south 자료의 첫 항목 다음 팀에서 읽는다(D-58).
    team_id = host.evaluate("() => KCP.LEAGUE_REGIONS.south.teams[1].id")
    host.locator("#lg-host").click()
    host.wait_for_selector("#lg-roomcode")
    room = host.locator("#lg-roomcode").inner_text().strip()
    overflow(checks, host, label + " 방 생성")

    team, events = monitored_page(context)
    pages.append((team, events, "팀"))
    team.goto(base + "#league")
    select_mode(team, "join")
    checks.ok(team.locator('input[name="lg-net"][value="local"]').is_checked(),
              f"{label} 같은 컨텍스트의 이 기기 연결")
    team.locator("#lg-code").fill(room)
    team.locator("#lg-join").click()
    team.wait_for_selector(f'[data-seat="{team_id}"]:not([disabled])')
    overflow(checks, team, label + " 자리 선택")
    confirm_seat(team, team_id)
    host.wait_for_function("id => !!KCP.league.state().S.teams[id].token", arg=team_id)
    checks.ok(team.evaluate("() => KCP.league.state().team") == team_id,
              f"{label} 화면에서 참가·자리 확정")

    # setup_pair와 같은 컨텍스트를 쓰되 방 생성·진행도 화면 버튼으로 한다.
    for round_number, phase in ((0, "lobby"), (1, "plan"), (1, "review")):
        if phase != "lobby":
            host.locator("#lg-next").click()
        host.wait_for_function(SYNC_JS, arg=[round_number, phase])
        team.wait_for_function(SYNC_JS, arg=[round_number, phase])
        host_state = host.evaluate(HOST_JS)
        team_state = team.evaluate("() => KCP.league.state().snap")
        checks.ok((host_state["round"], host_state["phase"]) ==
                  (team_state["round"], team_state["phase"]) == (round_number, phase),
                  f"{label} 진행자·팀 {round_number}달 {phase} 일치")
        overflow(checks, host, f"{label} 진행자 {phase}")
        overflow(checks, team, f"{label} 팀 {phase}")

    open_panel(team, "result")
    team.wait_for_selector("#lg-result-heading")
    checks.ok(shown(team, "#lg-result-heading") and
              len(host_state.get("results", [])) == len(team_state.get("results", [])) == 1 and
              team_id in team_state["results"][0]["team"],
              f"{label} 팀 화면에 1달 운영 결과 표시")
    overflow(checks, team, label + " 팀 결과 서랍")


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.webkit.launch()
            try:
                for width, height, scheme, device in (
                        (1180, 820, "light", "태블릿 밝음"),
                        (390, 844, "dark", "휴대폰 어두움")):
                    for name, scenario in (("W1", solo_game), ("W2", paired_game)):
                        label = f"{name} {device} {width}×{height}"
                        context, external = context_for(browser, base, width, height, scheme)
                        pages = []
                        try:
                            scenario(checks, context, base, label, pages)
                        except Exception as exc:
                            checks.ok(False, f"{label} 예외 {type(exc).__name__}: {(str(exc).splitlines() or [''])[0][:200]}")
                        finally:
                            for _, events, role in pages:
                                diagnostics(checks, events, f"{label} {role}")
                            checks.ok(not external, f"{label} 외부 연결 시도 0: {external}")
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {(str(exc).splitlines() or [''])[0][:200]}")
    result = checks.finish()
    print(f"problems: {checks.failed}", flush=True)
    return result


if __name__ == "__main__":
    sys.exit(main())
