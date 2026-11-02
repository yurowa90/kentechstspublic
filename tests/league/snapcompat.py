"""공개 상태 새 봉투·옛 형식 수신·연결 안내 검사(단위2-E 명세 기준).

실행: tests/.venv/bin/python tests/league/snapcompat.py <loopback 주소>
Chromium 1280×900. 브라우저 실행은 샌드박스 밖 로컬 환경의 총괄 담당.
C3는 명세에서 허용한 진행자 종료·복원·팀 새로고침 대체 사례다.
"""

import sys
import time

from playwright.sync_api import sync_playwright

from econui import (Checks, HOST_JS, advance, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow,
                    setup_pair, shown)

# 단계 안내(2026-10-21 총괄 승인): 10·20초 문턱에는 확인 중만, 30초가 지나면 새로고침 권유를 붙인다.
NOTICE_FIRST = "진행자 화면과 연결을 확인하는 중"
NOTICE = NOTICE_FIRST + " · 새로고침하면 다시 연결됩니다"
RECONNECT_WAIT = 30000

# 실제 전송에 성공한 공개 메시지만 관찰한다. 서명·봉투·수신 경로는 바꾸지 않는다.
CAPTURE_JS = """(() => {
  const original = BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage = function(message) {
    const result = original.call(this, message);
    if (message?.ev === 'snap') window.__snapcompatWire = structuredClone(message.data);
    return result;
  };
})();"""

SUMMARY_JS = """state => state ? {
  room:state.room, round:state.round, phase:state.phase,
  results:Array.isArray(state.results) ? state.results.length : null
} : null"""
SNAP_MATCH_JS = """expected => {
  const actual = (""" + SUMMARY_JS + """)(window.KCP?.league?.state()?.snap);
  return !!actual && Object.keys(expected).every(key => actual[key] === expected[key]);
}"""
HOST_MATCH_JS = """expected => {
  const actual = (""" + SUMMARY_JS + """)(window.KCP?.league?.state()?.S);
  return !!actual && Object.keys(expected).every(key => actual[key] === expected[key]);
}"""
NOTICE_JS = """text => [...document.querySelectorAll('#lg-conn, #lg-wait')].some(el =>
  el.checkVisibility({visibilityProperty:true}) && el.getBoundingClientRect().width > 0 &&
  el.getBoundingClientRect().height > 0 && el.innerText.trim() === text)
"""


def host_summary(host):
    return host.evaluate("() => (" + SUMMARY_JS + ")((" + HOST_JS + ")())")


def wire_contract(checks, host):
    host.wait_for_function("() => !!window.__snapcompatWire")
    actual = host.evaluate("""async () => {
      const wire = structuredClone(window.__snapcompatWire), data = wire.data;
      const {sig, ...signed} = wire;
      const key = await crypto.subtle.importKey('jwk', wire.hostKey,
        {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
      const verified = await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key,
        Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
        new TextEncoder().encode(KCP.leagueNet.canonical(signed)));
      const S = KCP.league.state().S;
      return {verified, event:wire.event, cp:data?._cp,
        fields:Object.keys(data || {}).sort(), hasTeams:Object.hasOwn(data || {}, 'teams'),
        bodyPresent:data?.body != null,
        roomMatches:wire.room === S.room && data?.room === S.room,
        regionMatches:data?.region === S.region};
    }""")
    checks.ok(actual["event"] == "snap" and actual["verified"],
              "C1 실제 전송 공개 상태의 진행자 서명 유효")
    # D-77 계약: 최상위 teams 없이 {_cp:1, room, region, sid, keys, body}로 전송한다.
    # sid는 hostReceiver의 세션 검사(D-64)에, keys는 행 배열 키 사전에 필요하다(독립 검토 2026-10-17 지적으로
    # 단위2-E 명세의 네 필드를 실제 계약에 맞춰 고침). 허용 집합 밖의 필드와 최상위 teams는 실패.
    # 중복 접기(2026-10-25, D-77 각주): 접은 경로가 있으면 _cp 2와 _refs, 없으면 옛 형식 _cp 1(‘_refs’ 없음).
    checks.ok(((actual.get("cp") == 1 and "_refs" not in actual["fields"]) or
               (actual.get("cp") == 2 and "_refs" in actual["fields"])) and
              set(actual["fields"]) <= {"_cp", "_refs", "body", "keys", "region", "room", "sid"} and
              {"_cp", "body", "region", "room"} <= set(actual["fields"]) and
              not actual["hasTeams"] and actual["bodyPresent"] and
              actual["roomMatches"] and actual["regionMatches"],
              "C1 공개 상태는 _cp=1·room·region·body 봉투, 최상위 teams 없음")


def new_pair(checks, host, team):
    advance(host, team, 1, "plan")
    overflow(checks, host, "C1 진행자 1달 계획")
    overflow(checks, team, "C1 팀 1달 계획")
    advance(host, team, 1, "review")
    expected = host_summary(host)
    checks.ok(expected["round"] == 1 and expected["phase"] == "review" and
              expected["results"] == 1, "C1 진행자 1달 운영 결과 1개")
    team.wait_for_function(SNAP_MATCH_JS, arg=expected, timeout=RECONNECT_WAIT)
    checks.ok(team.evaluate(SNAP_MATCH_JS, expected),
              "C1 새 팀 snap의 round·phase·결과 개수 = 진행자 S")
    checks.ok(shown(team, "#lg-bar"), "C1 새 팀 상태 막대 표시")
    open_panel(team, "result")
    checks.ok(shown(team, '#lg-panel[data-tab="result"]') and
              shown(team, "#lg-result-heading"), "C1 팀 결과 서랍 정상 표시")
    overflow(checks, host, "C1 진행자 결과")
    overflow(checks, team, "C1 팀 결과 서랍")
    wire_contract(checks, host)
    return True


def legacy_snapshot(checks, host, team):
    # C2 명세대로 진행자 S의 publicView를 사용한다. compactSnapshot으로 만들지 않는다.
    legacy = host.evaluate("() => KCP.leagueCore.publicView(KCP.league.state().S, Date.now())")
    checks.ok("_cp" not in legacy and isinstance(legacy.get("teams"), dict) and
              bool(legacy["teams"]), "C2 입력은 _cp 없는 최상위 teams 옛 공개 상태")
    actual = team.evaluate("""legacy => {
      const expected = {round:legacy.round, phase:legacy.phase,
        results:legacy.results.length, teams:Object.keys(legacy.teams).sort()};
      const view = KCP.leagueNet.expandSnapshot(legacy);
      return {expected, object:!!view && typeof view === 'object' && !Array.isArray(view),
        teams:!!view?.teams && typeof view.teams === 'object' && !Array.isArray(view.teams),
        round:view?.round, phase:view?.phase, results:view?.results?.length,
        ids:Object.keys(view?.teams || {}).sort()};
    }""", legacy)
    expected = actual["expected"]
    checks.ok(actual["object"] and actual["teams"] and actual["ids"] == expected["teams"] and
              all(actual.get(key) == expected[key] for key in ("round", "phase", "results")),
              "C2 팀 페이지 expandSnapshot은 예외 없이 옛 teams·달·단계·결과 유지")
    overflow(checks, host, "C2 진행자")
    overflow(checks, team, "C2 옛 공개 상태 수신 팀")
    return True


def reconnect(checks, context, base, host, team, pages):
    expected = host_summary(host)
    # 지연 저장이 끝난 뒤 닫는다. 저장을 직접 써 넣어 복원을 통과시키지 않는다.
    host.wait_for_function("""expected => {
      const saved = JSON.parse(localStorage.getItem('kcp-league-host-v1'));
      const actual = (""" + SUMMARY_JS + """)(saved?.state);
      return !!actual && Object.keys(expected).every(key => actual[key] === expected[key]);
    }""", arg=expected, timeout=5000)
    overflow(checks, host, "C3 종료 전 진행자")
    checks.ok(not team.evaluate(NOTICE_JS, NOTICE_FIRST) and not team.evaluate(NOTICE_JS, NOTICE), "C3 진행자 종료 전 무응답 안내 없음")
    # 직전 수신 후 시간이 많이 지난 채 닫으면 종료 직후 안내가 떠도 통과할 수 있다.
    # 다음 정상 스냅숏 수신을 기다려 실제 메시지를 끊은 시점을 분명히 한다.
    previous = team.evaluate("() => KCP.league.state().snap.now")
    team.wait_for_function("now => KCP.league.state().snap?.now > now",
                           arg=previous, timeout=12000)
    host.close()
    started = time.monotonic()

    def wait_notice():
        # C3 대체 계약: 10초 초과 무응답 뒤 보통 11~15초에 안내, 조건 대기 상한 20초.
        # 안내 실패도 기록한 뒤 아래 복원·새로고침 검사를 계속한다.
        team.wait_for_function(NOTICE_JS, arg=NOTICE_FIRST, polling=100, timeout=20000)
        elapsed = time.monotonic() - started
        # 마지막 진행자 메시지 기준 10초 초과인지도 확인한다. 종료 시각만으로는
        # 닫기 직전 전송·검증 중인 메시지의 시차를 정확히 판단할 수 없다.
        # lastHostAt은 공개 상태(KCP.league.state())에 없다. 진행자 종료 시각부터 잰 경과가 10초를 넘었는지로 본다
        # (종료 직전 메시지가 있었다면 실제 무응답은 이보다 조금 짧을 수 있으나, 앱 판정 문턱 10초보다 이르게 뜨면 실패다).
        checks.ok(10 < elapsed <= 20 and team.evaluate(NOTICE_JS, NOTICE_FIRST),
                  f"C3 무응답 10초 초과 뒤 연결 확인 안내 표시, 새로고침 권유 없음(종료 후 {elapsed:.1f}초, 상한 20초)")
        # 안내는 5초 주기로 다시 판정하므로 30초를 넘긴 뒤 보통 30~35초에 권유가 붙는다. 상한 40초.
        team.wait_for_function(NOTICE_JS, arg=NOTICE, polling=100, timeout=max(1, int((40 - (time.monotonic() - started)) * 1000)))
        later = time.monotonic() - started
        checks.ok(30 < later <= 40, f"C3 무응답 30초 초과 뒤 새로고침 권유 추가(종료 후 {later:.1f}초, 상한 40초)")
        return True

    checks.test("C3 무응답 안내 조건 대기(최대 40초)", wait_notice)
    overflow(checks, team, "C3 진행자 없는 팀")

    restored, events = monitored_page(context)
    pages.append((restored, events, "복원 진행자"))
    # 탐색·복원·새로고침마다 30초를 새로 주지 않고 재연결 전체에 상한을 적용한다.
    deadline = time.monotonic() + RECONNECT_WAIT / 1000

    def remaining():
        milliseconds = int((deadline - time.monotonic()) * 1000)
        if milliseconds <= 0:
            raise TimeoutError("C3 진행자 복원·팀 재연결 전체 대기 30초 초과")
        return milliseconds

    restored.goto(base + "#league/host", timeout=remaining())
    restored.wait_for_function(HOST_MATCH_JS, arg=expected, timeout=remaining())
    checks.ok(host_summary(restored) == expected,
              "C3 같은 컨텍스트에서 진행자 저장의 방·달·단계·결과 복원")
    team.reload(timeout=remaining())
    team.wait_for_function(SNAP_MATCH_JS, arg=expected, timeout=remaining())
    team.wait_for_selector("#lg-bar", timeout=remaining())
    checks.ok(team.evaluate(SNAP_MATCH_JS, host_summary(restored)) and shown(team, "#lg-bar"),
              "C3 팀 새로고침 후 진행자와 같은 round·phase·결과로 재연결")
    checks.ok(not team.evaluate(NOTICE_JS, NOTICE_FIRST) and not team.evaluate(NOTICE_JS, NOTICE), "C3 재연결 후 무응답 안내 해제")
    overflow(checks, restored, "C3 복원 진행자")
    overflow(checks, team, "C3 새로고침 팀")
    return True


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                context, external = context_for(browser, base, 1280, 900, "light")
                context.add_init_script(CAPTURE_JS)
                pages = []
                try:
                    host, team, _ = setup_pair(context, base, 12, pages)
                    overflow(checks, host, "C1 진행자 참가 대기")
                    overflow(checks, team, "C1 팀 참가 직후")
                    checks.test("C1 새 진행자·새 팀 1달 진행", lambda: new_pair(checks, host, team))
                    checks.test("C2 옛 형식 페이지 안 수신", lambda: legacy_snapshot(checks, host, team))
                    checks.test("C3 진행자 종료·복원·팀 새로고침", lambda:
                                reconnect(checks, context, base, host, team, pages))
                except Exception as exc:
                    checks.ok(False, f"검사 준비 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
                finally:
                    # local BroadcastChannel에는 mocktest의 WebSocket 연결 거부 근거가 없다.
                    # 관찰하지 않은 경고 패턴을 추측해 면제하지 않고, 의도한 종료 구간도 모두 검사한다.
                    for _, events, role in pages:
                        diagnostics(checks, events, "공개 상태 호환 " + role)
                    checks.ok(not external, f"외부 연결 시도 0: {external}")
                    context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
    result = checks.finish()
    print(f"problems: {checks.failed}", flush=True)
    return result


if __name__ == "__main__":
    sys.exit(main())
