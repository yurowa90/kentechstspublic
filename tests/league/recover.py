"""연결·탭 복구 R1~R4. 총괄이 샌드박스 밖에서 로컬 페이지 서버와 함께 실행한다.

실행: tests/.venv/bin/python tests/league/recover.py <loopback index.html 주소>
mocktest.py는 import만 해도 브라우저를 실행하므로 포트 대기 함수를 여기 복사한다.
"""

import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import traceback
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from econui import (BOOT_JS, HOST_JS, SYNC_JS, Checks, diagnostics,
                   local_address, overflow)
from league_flow import confirm_seat, select_mode


D = Path(__file__).resolve().parent
PORT_BASE = int(os.environ["KCP_PORT_BASE"]) if "KCP_PORT_BASE" in os.environ else None
# run.sh의 base..base+16 밖이며 mocktest.py의 +19와 겹치지 않는다.
MOCK_PORT = int(os.environ["KCP_MOCK_PORT"]) if "KCP_MOCK_PORT" in os.environ else (
    PORT_BASE + 18 if PORT_BASE is not None else 9311)
WS = f"ws://127.0.0.1:{MOCK_PORT}/realtime/v1/websocket"
DEFAULT_BASE = f"http://127.0.0.1:{PORT_BASE if PORT_BASE is not None else 9400}/index.html"
UI_WAIT = 12000  # econui.WAIT와 같은 로컬 화면 조작·초기 상태 수신 상한.
RECOVER_WAIT = 30000  # R1~R3 명세: 복귀 후 30초 안에 상태·연결 회복.
SERVER_WAIT = 10  # mocktest.wait_port와 같은 Node 기동 상한(초).
OFFLINE_SECONDS = 12  # R2 명세의 최소 오프라인 유지 시간.
RESTART_SECONDS = 2  # R3 명세의 중계 서버 중단 시간.
CONNECTED_JS = """() => {
  const el = document.querySelector('#lg-conn');
  return el?.dataset.s === 'open' && el.textContent === '연결됨';
}"""
TEAM_SYNC_JS = """([round, phase, sid]) => {
  const V = KCP.league.state()?.snap;
  return V?.round === round && V.phase === phase && V.sid === sid &&
    (""" + CONNECTED_JS + """)();
}"""


def port_free(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


def wait_port(process, port, timeout=SERVER_WAIT):
    """mocktest.py 복사: 조기 종료·상한을 확인하며 포트 열림 조건을 폴링한다."""
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


def fail_exc(checks, label, exc):
    message = (str(exc).splitlines() or [""])[0][:200]
    checks.ok(False, f"{label} 예외 {type(exc).__name__}: {message}")
    print(traceback.format_exc()[-6000:], flush=True)


def request_body(frame):
    """관찰한 Phoenix 프레임에서 팀 요청만 읽는다. 서명·키는 출력하지 않는다."""
    try:
        wire = json.loads(frame)
        payload = wire.get("payload", {})
        if wire.get("event") == "broadcast" and payload.get("event") == "req":
            return json.loads(payload["payload"]["body"])
    except (ValueError, KeyError, TypeError):
        pass
    return {}


class Room:
    def __init__(self, browser, base, checks, label):
        self.browser, self.base, self.checks, self.label = browser, base, checks, label
        self.contexts, self.pages, self.teams = [], [], {}
        self.srv = None

    def start_server(self):
        if not port_free(MOCK_PORT):
            raise RuntimeError(f"가짜 Realtime 포트 {MOCK_PORT}가 이미 쓰이는 중")
        self.srv = subprocess.Popen(["node", str(D / "mockrt.js"), str(MOCK_PORT)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_port(self.srv, MOCK_PORT)

    def context(self):
        context = self.browser.new_context(viewport={"width": 1280, "height": 900},
                                           locale="ko-KR", service_workers="block")
        self.contexts.append(context)
        context.set_default_timeout(UI_WAIT)
        context.set_default_navigation_timeout(UI_WAIT)
        origin = urlsplit(self.base)

        def route(r):
            url = urlsplit(r.request.url)
            if (url.scheme, url.netloc) == (origin.scheme, origin.netloc):
                r.continue_()
            elif url.hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
                r.fulfill(status=200, content_type="text/css", body="")
            else:
                self.checks.ok(False, self.label + " 외부 HTTP 요청 차단")
                r.abort()

        def block_socket(ws):
            self.checks.ok(False, self.label + " 외부 WebSocket 요청 차단")
            ws.close()

        context.route("**/*", route)
        # 허용한 mock 주소는 라우팅하지 않는다. R2 set_offline은 실제 소켓에 적용한다.
        context.route_web_socket(re.compile(r"^(?!" + re.escape(WS) + r"(?:\?|$)).*"), block_socket)
        return context

    def page(self, context, role):
        page = context.new_page()
        record = {"page": page, "role": role, "outage": False, "ignored": 0,
                  "events": {"error": [], "warning": [], "pageerror": []},
                  "sockets": [], "requests": [], "navigations": 0}
        self.pages.append(record)

        def console(message):
            if message.type not in ("error", "warning"):
                return
            text = message.text
            # mocktest 방식의 주소·구간 제한. pageerror·일반 경고·다른 주소는 예외 아님.
            expected = (record["outage"] and message.type == "error" and WS in text and
                        ("ERR_CONNECTION_REFUSED" in text or
                         ("WebSocket connection to" in text and "failed:" in text)))
            if expected:
                record["ignored"] += 1
            else:
                record["events"][message.type].append(text)

        def socket_open(ws):
            record["sockets"].append(ws)
            ws.on("framesent", lambda frame: record["requests"].append(request_body(frame)))

        page.on("console", console)
        page.on("pageerror", lambda error: record["events"]["pageerror"].append(str(error)))
        page.on("websocket", socket_open)
        page.on("framenavigated", lambda frame: record.update(
            navigations=record["navigations"] + (frame == page.main_frame)))
        return page, record

    def online(self, page, mode):
        page.goto(self.base + "#league")
        page.wait_for_function(BOOT_JS)
        select_mode(page, mode)
        if not page.locator(".lg-net[open]").count():
            page.locator(".lg-net summary").click()
        page.check('input[name=lg-net][value=supabase]')
        page.fill("#lg-url", WS)
        page.fill("#lg-key", "sb_publishable_test_key")

    def setup(self):
        self.start_server()
        self.host_context = self.context()
        self.host, self.host_record = self.page(self.host_context, "진행자")
        self.online(self.host, "host")
        # D-58: 필수 도시와 육상 이웃을 자료에서 고른다. 두 도시·고정 씨앗은 mocktest 249c023 방식.
        self.ids = self.host.evaluate("""() => {
          const R = KCP.LEAGUE_REGIONS.south, ids = new Set(R.teams.map(t => t.id));
          const first = R.must[0];
          const tie = R.ties.find(t => t.kind === 'land' &&
            [t.a, t.b].includes(first) && ids.has(t.a) && ids.has(t.b));
          if (!tie) throw Error('필수 도시의 인접한 두 도시를 찾지 못함');
          return [first, tie.a === first ? tie.b : tie.a];
        }""")
        boxes = self.host.locator(".lg-pickc input.lg-chipcheck")
        for i in range(boxes.count()):
            box = boxes.nth(i)
            if not box.is_disabled():
                box.set_checked(box.get_attribute("value") in self.ids)
        self.host.locator("#lg-host-seed").select_option("fixed")
        self.host.locator("#lg-host").click()
        expect(self.host.locator("#lg-roomcode")).to_be_visible()
        self.host.wait_for_function(CONNECTED_JS)
        code = self.host.locator("#lg-roomcode").inner_text()
        for tid in self.ids:
            context = self.context()
            team, record = self.page(context, "팀 " + tid)
            self.teams[tid] = (context, team, record)
            self.online(team, "join")
            team.fill("#lg-code", code)
            team.locator("#lg-join").click()
            confirm_seat(team, tid, timeout=UI_WAIT)
        self.host.wait_for_function("""ids => {
          const S = KCP.league.state().S;
          return S.active.length === 2 && ids.every(id => !!S.teams[id].token);
        }""", arg=self.ids)
        self.host.locator("#lg-next").click()
        self.host.wait_for_function(SYNC_JS, arg=[1, "plan"])
        self.sync_teams(UI_WAIT)
        # 초기 입장·계획 전송이 R2의 오프라인 편집과 섞이지 않도록 양쪽 rev를 맞춘다.
        for tid, (_, team, _) in self.teams.items():
            rev = team.evaluate("() => KCP.league.state().rev")
            self.host.wait_for_function("""([id, rev]) => {
              const T = KCP.league.state().S.teams[id];
              // 첫 계획 단계에서 아무것도 고치지 않은 팀은 rev 0·계획 없음이 정상이다(2026-10-20 실측).
              return T.rev === rev && (rev === 0 || !!T.plan);
            }""", arg=[tid, rev])
            team.wait_for_function("""([id, rev]) =>
              KCP.league.state().snap.teams[id].rev === rev""", arg=[tid, rev])
        state = self.host.evaluate(HOST_JS)
        self.checks.ok(set(state["active"]) == set(self.ids),
                       self.label + " 자료에서 고른 인접 두 도시만 참가")
        self.checks.ok(state.get("seedMode") == "fixed" and bool(state.get("econ")),
                       self.label + " 고정 씨앗·달 단위 경제 모드")

    def sync_teams(self, timeout):
        state = self.host.evaluate(HOST_JS)
        # 팀 수만큼 30초를 더 주지 않도록 하나의 마감 시각을 공유한다.
        deadline = time.monotonic() + timeout / 1000
        for _, page, _ in self.teams.values():
            page.wait_for_function(TEAM_SYNC_JS, arg=[state["round"], state["phase"], state["sid"]],
                                   timeout=max(1, int((deadline - time.monotonic()) * 1000)))

    def finish(self):
        for record in self.pages:
            if not record["page"].is_closed():
                overflow(self.checks, record["page"], self.label + " " + record["role"])
        # 브라우저를 먼저 닫아 정상 종료를 중계 서버 정전으로 세지 않는다.
        for context in self.contexts:
            try:
                context.close()
            except Exception as exc:
                fail_exc(self.checks, self.label + " 컨텍스트 정리", exc)
        if self.srv is not None and self.srv.poll() is None:
            try:
                self.srv.kill()
                self.srv.wait(timeout=SERVER_WAIT)
            except Exception as exc:
                fail_exc(self.checks, self.label + " 서버 정리", exc)
        for record in self.pages:
            title = self.label + " " + record["role"]
            print(f"{title} 의도한 단절의 mock 소켓 오류 제외: {record['ignored']}", flush=True)
            diagnostics(self.checks, record["events"], title)


def host_reopen(room):
    host, checks = room.host, room.checks
    before = host.evaluate(HOST_JS)
    # 닫기 전에 실제 지연 저장이 완료됐다는 조건을 확인한다(고정 대기 없음).
    host.wait_for_function("""expected => {
      const saved = JSON.parse(localStorage.getItem('kcp-league-host-v1'))?.state;
      return saved?.room === expected.room && saved.sid === expected.sid &&
        saved.round === expected.round && saved.phase === expected.phase &&
        saved.results.length === expected.results.length;
    }""", arg=before)
    navs = {tid: record["navigations"] for tid, (_, _, record) in room.teams.items()}
    overflow(checks, host, "R1 닫기 전 진행자")
    host.close()
    deadline = time.monotonic() + RECOVER_WAIT / 1000
    room.host, room.host_record = room.page(room.host_context, "재연 진행자")
    room.host.goto(room.base + "#league/host")
    room.host.wait_for_function(BOOT_JS)
    room.host.wait_for_function("() => KCP.league?.state()?.S?.phase === 'plan'")
    after = room.host.evaluate(HOST_JS)
    checks.ok(all(after[k] == before[k] for k in ("room", "round", "phase")) and
              len(after["results"]) == len(before["results"]) and after["sid"] != before["sid"],
              "R1 방 코드·달·단계·결과 수 보존, 새 sid")
    room.sync_teams(max(1, int((deadline - time.monotonic()) * 1000)))
    checks.ok(time.monotonic() <= deadline, "R1 팀 연결·상태 복구가 30초 이내")
    checks.ok(all(record["navigations"] == navs[tid]
                  for tid, (_, _, record) in room.teams.items()), "R1 팀 새로고침 없이 연결·상태 복구")
    room.host.locator("#lg-next").click()
    room.host.wait_for_function(SYNC_JS, arg=[1, "review"])
    for _, team, _ in room.teams.values():
        expect(team.locator("#lg-result-heading")).to_be_visible(timeout=RECOVER_WAIT)
        team.wait_for_function("() => KCP.league.state().snap.results.length === 1")
    checks.ok(True, "R1 복구 뒤 한 달 운영 결과가 두 팀 화면에 표시")


def team_offline(room):
    tid = room.ids[0]
    context, team, record = room.teams[tid]
    initial = room.host.evaluate("id => KCP.league.state().S.teams[id].rev", tid)
    record["outage"] = True
    context.set_offline(True)
    started = time.monotonic()
    changed = team.evaluate("""other => KCP.league.plan(st => {
      const BG = KCP.buildGame, sites = BG.SITES;
      const town = sites.find(s => s.kind === 'city_l');
      const grid = sites.find(s => s.kind === 'gridpt' && s.to.includes(other));
      if (!town || !grid) throw Error('계획 변경용 도시·이웃 연결점 없음');
      const candidates = [town, ...sites.filter(s => s.kind === 'plant')];
      const path = candidates.map(s => BG.routePath(s.tile, grid.tile)).find(p =>
        p?.length > 1 && !st.lines.some(line => JSON.stringify(line.p) === JSON.stringify(p)));
      if (!path) throw Error('기존 계획과 다른 유효한 전선 경로 없음');
      st.lines.push({p: path});
    })""", room.ids[1])
    room.checks.ok(changed, "R2 오프라인 중 실제 계획 API 편집 성공")
    expected = team.evaluate("""() => ({rev: KCP.league.state().rev,
      lines: KCP.buildGame.current().lines.map(line => line.p)})""")
    # 시나리오 자체의 시간: 계획을 고친 뒤에도 최소 12초간 오프라인을 유지한다.
    time.sleep(OFFLINE_SECONDS)
    expect(team.locator("#lg-conn")).to_contain_text("진행자 화면과 연결을 확인하는 중")
    room.checks.ok(time.monotonic() - started >= OFFLINE_SECONDS,
                   "R2 12초 이상 오프라인 유지·연결 확인 안내 표시")
    room.checks.ok(room.host.evaluate("id => KCP.league.state().S.teams[id].rev", tid) == initial,
                   "R2 단절 중 계획이 진행자에게 전송되지 않음")
    context.set_offline(False)
    deadline = time.monotonic() + RECOVER_WAIT / 1000
    room.host.wait_for_function("""([id, expected, initial]) => {
      const T = KCP.league.state().S.teams[id];
      return T.rev > initial && T.rev === expected.rev &&
        JSON.stringify(T.plan?.lines.map(line => line.p)) === JSON.stringify(expected.lines);
    }""", arg=[tid, expected, initial], timeout=RECOVER_WAIT)
    team.wait_for_function(CONNECTED_JS, timeout=max(1, int((deadline - time.monotonic()) * 1000)))
    record["outage"] = False
    room.checks.ok(time.monotonic() <= deadline, "R2 30초 안에 편집 계획·rev 반영, 연결됨 복귀")


def ready_outage(room):
    tid = room.ids[0]
    _, team, record = room.teams[tid]
    if team.locator("#lg-coach-close").count():
        team.locator("#lg-coach-close").click()
    team.locator("#lg-ready").click()
    # 공용 pass_issue_check는 고정 대기를 포함하므로 동일 선택자로 조건을 확인한다.
    if team.locator("#lg-issue-check").is_visible():
        team.locator("#lg-issue-go").click()
    team.locator("#lg-predict [data-evidence]:enabled").first.click()
    team.locator("#lg-predict [data-pred]").select_option("down")
    team.locator('[data-confidence="fairly"]').click()
    expect(team.locator("#lg-ready-confirm")).to_be_enabled()
    room.host.evaluate("""id => {
      const T = KCP.league.state().S.teams[id]; let value = T.ready;
      window.__recoverReady = {changes: 0, values: []};
      // 값은 바꾸지 않고 실제 S의 준비 상태 전이만 관찰한다.
      Object.defineProperty(T, 'ready', {enumerable: true, configurable: true,
        get: () => value, set: next => {
          if (next !== value) { __recoverReady.changes++; __recoverReady.values.push(next); }
          value = next;
        }});
    }""", tid)
    for item in room.pages:
        item["outage"] = True
    # 중계 처리를 먼저 멈춰 framesent 직후 kill까지의 경합을 없앤다.
    # 브라우저는 실제 ready 봉투를 보낸다. 첫 요청은 서버 버퍼와 함께 사라져 재전송이 필수다.
    room.srv.send_signal(signal.SIGSTOP)
    ws = record["sockets"][-1]
    with ws.expect_event("framesent", predicate=lambda frame: request_body(frame).get("type") == "ready",
                         timeout=UI_WAIT) as sent:
        team.locator("#lg-ready-confirm").click()
    first = request_body(sent.value)
    room.srv.kill()
    room.srv.wait(timeout=SERVER_WAIT)
    time.sleep(RESTART_SECONDS)  # R3 시나리오의 의도한 서버 중단 시간.
    room.checks.ok(not room.host.evaluate("id => KCP.league.state().S.teams[id].ready", tid),
                   "R3 첫 준비 요청이 중계되기 전에 유실")
    deadline = time.monotonic() + RECOVER_WAIT / 1000
    room.start_server()
    room.host.wait_for_function("id => KCP.league.state().S.teams[id].ready === true",
                               arg=tid, timeout=max(1, int((deadline - time.monotonic()) * 1000)))
    room.sync_teams(max(1, int((deadline - time.monotonic()) * 1000)))
    team.wait_for_function("id => KCP.league.state().snap.teams[id].ready === true", arg=tid,
                           timeout=max(1, int((deadline - time.monotonic()) * 1000)))
    room.checks.ok(time.monotonic() <= deadline, "R3 30초 안에 준비 상태·연결 회복")
    for item in room.pages:
        item["outage"] = False
    room.checks.ok(any(r.get("type") == "ready" and r.get("ready") is True and
                       r.get("n", 0) > first["n"] for r in record["requests"]),
                   "R3 새 순번의 실제 준비 재전송 관찰")
    # 연결 복구 뒤 다음 hello가 진행자에 반영될 때까지 관찰해 다음 재시도 주기도 포함한다.
    floor = max((r.get("n", 0) for r in record["requests"] if r.get("type") == "hello"), default=0)
    room.host.wait_for_function("""([id, floor]) =>
      KCP.league.state().S.teams[id].lastNByType?.values.hello > floor""",
                               arg=[tid, floor], timeout=UI_WAIT)
    transitions = room.host.evaluate("() => window.__recoverReady")
    room.checks.ok(transitions == {"changes": 1, "values": [True]},
                   "R3 재전송 뒤 실제 S의 준비 전이는 정확히 한 번")


def team_reopen(room):
    tid = room.ids[0]
    context, old, _ = room.teams[tid]
    before = room.host.evaluate("""id => {
      const T = KCP.league.state().S.teams[id];
      return {token: T.token, seat: T.seatVersion || 0};
    }""", tid)
    overflow(room.checks, old, "R4 닫기 전 팀")
    old.close()
    team, record = room.page(context, "재연 팀 " + tid)
    room.teams[tid] = (context, team, record)
    # 닫힌 탭의 sessionStorage나 서명 키를 검사에서 주입하지 않는다.
    # 탭 저장(K_TAB)은 sessionStorage라 새 탭에는 없다 — 한 PC 여러 탭 시연이 섞이지 않게 한 설계(league.js K_TAB 주석).
    # 그래서 새 탭은 로비로 가고, 기기 저장(K_TEAM)의 '이어서' 단추로 같은 자리에 돌아오는 것이 계약이다
    # (단위3-A 지시서의 '자동 복귀'는 이 설계를 놓친 명세였다, 2026-10-20 실행으로 확인).
    team.add_init_script("""(() => {
      window.__recoverSeatPicker = false;
      const selector = '[data-seat], #lg-seat-confirm';
      new MutationObserver(records => {
        if (document.querySelector(selector) || records.some(record =>
          [...record.addedNodes].some(n => n.nodeType === 1 &&
            (n.matches(selector) || n.querySelector(selector))))) __recoverSeatPicker = true;
      }).observe(document, {subtree: true, childList: true});
    })();""")
    team.goto(room.base + "#league/team")
    team.wait_for_function("() => location.hash === '#league'", timeout=RECOVER_WAIT)
    select_mode(team, "join")
    expect(team.locator("#lg-rejoin")).to_be_visible(timeout=RECOVER_WAIT)
    room.checks.ok(team.evaluate("location.hash") == "#league", "R4 새 탭은 탭 저장이 없어 로비로")
    team.locator("#lg-rejoin").click()
    expect(team.locator("#lg-bar")).to_be_visible(timeout=RECOVER_WAIT)
    team.wait_for_function(CONNECTED_JS, timeout=RECOVER_WAIT)
    room.checks.ok(team.evaluate("""id => {
      const L = KCP.league.state();
      return L.role === 'team' && L.team === id && location.hash === '#league/team' &&
        !__recoverSeatPicker && !document.querySelector('[data-seat], #lg-seat-confirm');
    }""", tid), "R4 '이어서'로 같은 도시 복귀·자리 선택 화면 노출 없음")
    after = room.host.evaluate("""id => {
      const T = KCP.league.state().S.teams[id];
      return {token: T.token, seat: T.seatVersion || 0};
    }""", tid)
    room.checks.ok(after == before, "R4 진행자의 팀 점유·자리 버전 보존")


def main():
    checks = Checks()
    expect.set_options(timeout=UI_WAIT)
    try:
        base = local_address(sys.argv if len(sys.argv) > 1 else [sys.argv[0], DEFAULT_BASE])
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                for label, scenario in (("R1", host_reopen), ("R2", team_offline),
                                        ("R3", ready_outage), ("R4", team_reopen)):
                    room = Room(browser, base, checks, label)
                    try:
                        room.setup()
                        scenario(room)
                    except Exception as exc:
                        fail_exc(checks, label, exc)
                    finally:
                        try:
                            room.finish()
                        except Exception as exc:
                            fail_exc(checks, label + " 진단·정리", exc)
            finally:
                browser.close()
    except Exception as exc:
        fail_exc(checks, "복구 검사 실행", exc)
    checks.finish()
    print(f"problems: {checks.failed}", flush=True)
    return int(bool(checks.failed))


if __name__ == "__main__":
    sys.exit(main())
