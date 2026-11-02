"""채널 ACK·진행자 경고 브라우저 검사. 총괄이 샌드박스 밖에서 실행하며 여기서는 py_compile만 한다.
사용: tests/.venv/bin/python tests/league/chanlimit.py http://127.0.0.1:9430/index.html
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from league_flow import confirm_seat, select_mode

HERE = Path(__file__).resolve().parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9430/index.html"
PORT = int(os.environ.get("KCP_MOCK_PORT", "9339"))
assert urlsplit(BASE).hostname in ("127.0.0.1", "localhost", "::1"), "페이지 서버는 loopback만 허용"


def wait_server(process):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        assert process.poll() is None, "가짜 서버 조기 종료"
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("가짜 서버 시작 대기 초과")


def run(browser, cap):
    with socket.socket() as check:
        assert check.connect_ex(("127.0.0.1", PORT)) != 0, "검사 포트가 이미 사용 중"
    args = ["node", str(HERE / "mockrt.js"), str(PORT)]
    if cap:
        args += ["--max-bytes", str(cap)]
    env = dict(os.environ)
    env.pop("MOCK_MAX_BYTES", None)
    server = subprocess.Popen(args, stdout=subprocess.DEVNULL, env=env)
    contexts, errors = [], []
    try:
        wait_server(server)

        def page():
            context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
            contexts.append(context)
            p = context.new_page()
            p.on("pageerror", lambda error: errors.append(str(error)))
            p.on("console", lambda msg: errors.append(msg.text) if msg.type in ("error", "warning") else None)
            return p

        def online(p, mode):
            p.goto(BASE + "#league")
            select_mode(p, mode)
            if not p.locator(".lg-net[open]").count():
                p.click(".lg-net summary")
            p.check('input[name="lg-net"][value="supabase"]')
            p.fill("#lg-url", f"ws://127.0.0.1:{PORT}/realtime/v1/websocket")
            p.fill("#lg-key", "sb_publishable_test_key")

        host = page()
        online(host, "host")
        # D-58: 도시 식별자도 화면과 실제 자료에서 읽는다. mocktest처럼 두 도시·고정 씨앗.
        cities = host.evaluate("""() => {
            const boxes = [...document.querySelectorAll('.lg-pickc input.lg-chipcheck')];
            const all = Object.values(KCP.LEAGUE_REGIONS).flatMap(r => r.teams);
            const first = boxes.find(b => b.disabled && b.checked) || boxes[0];
            const second = boxes.find(b => b !== first);
            return [first, second].map(b => all.find(t => t.id === b.value).id);
        }""")
        boxes = host.locator(".lg-pickc input.lg-chipcheck")
        for i in range(boxes.count()):
            box = boxes.nth(i)
            if not box.is_disabled():
                box.set_checked(box.get_attribute("value") in cities)
        host.select_option("#lg-host-seed", "fixed")
        host.evaluate("""() => {
            const fixture = window.chanFixture = {sizes: [], delivered: [], missed: [], oversized: []};
            // 시험 메시지 없이 앱이 실제 보낸 snap의 UTF-8 프레임 크기만 관찰한다.
            const rawSend = WebSocket.prototype.send;
            WebSocket.prototype.send = function(raw) {
                const m = JSON.parse(raw);
                if (m.event === 'broadcast' && m.payload?.event === 'snap') {
                    const data = m.payload.payload.data;
                    fixture.sizes.push({bytes: new TextEncoder().encode(raw).length,
                        phase: data?.body?.phase || data?.phase});
                }
                return rawSend.call(this, raw);
            };
            const N = KCP.leagueNet, open = N.open;
            N.open = function(opts) {
                const conn = open(opts);
                for (const [event, key] of [['delivered', 'delivered'], ['undelivered', 'missed'], ['oversize', 'oversized']])
                    conn.on(event, m => { if (m.ev === 'snap') fixture[key].push(m); });
                return conn;
            };
        }""")
        host.click("#lg-host")
        host.wait_for_selector("#lg-roomcode")
        host.wait_for_function("() => document.getElementById('lg-conn').dataset.s === 'open'")
        room = host.inner_text("#lg-roomcode")
        teams = []
        # 작은 검사 한도에서는 첫 snap부터 버려져 자리 선택 자체가 막힐 수 있다.
        # 무제한 조건에서 두 팀의 실제 참가·결과 수신을 검사하고, 버림 조건은 진행자 경고를 검사한다.
        if not cap:
            for city in cities:
                p = page()
                online(p, "join")
                p.fill("#lg-code", room)
                p.click("#lg-join")
                confirm_seat(p, city, timeout=15000)
                teams.append(p)
        warning = host.locator("#lg-host-warning")
        host.click("#lg-next")
        host.wait_for_function("() => KCP.league.state().S.phase === 'plan'")
        host.click("#lg-next")
        host.wait_for_function("() => KCP.league.state().S.phase === 'review'")
        host.wait_for_function("() => window.chanFixture.sizes.some(m => m.phase === 'review')")
        largest = host.evaluate("() => Math.max(...window.chanFixture.sizes.filter(m => m.phase === 'review').map(m => m.bytes))")
        assert largest <= 256000, "검사 대상은 앱의 전송 상한 이내"
        if cap:
            assert largest > cap, "두 도시 결과 snap이 검사 한도를 넘어야 함"
            host.wait_for_function("""cap => window.chanFixture.missed.some(m =>
                m.bytes > cap && m.reason === 'timeout')""", arg=cap, timeout=15000)
            expect(warning).to_contain_text("방금 상태(")
            expect(warning).to_contain_text("KB)의 전달 확인을 서버에서 받지 못했어요. 팀 화면이 멈췄으면 연결을 확인해요.")
            expect(warning).not_to_contain_text("256KB")
            expect(warning).not_to_contain_text("한도")
            assert host.evaluate("() => document.getElementById('lg-conn').dataset.s") == "open"
            print(f"통과: 두 도시 결과 {largest}B 버림·5초 ACK 미확인 경고·연결 유지")
        else:
            for p in teams:
                p.wait_for_function("() => KCP.league.state().snap.phase === 'review'", timeout=15000)
                expect(p.locator("#lg-host-warning")).to_have_count(0)
            # 첫 송신부터 ACK 대기 시간보다 오래 관찰한다. 무제한 조건의 지연 경고도 놓치지 않는다.
            host.wait_for_timeout(5500)
            assert host.evaluate("() => window.chanFixture.delivered.length") > 0
            assert host.evaluate("() => window.chanFixture.missed.length") == 0
            expect(warning).to_have_text("")
            print(f"통과: 두 도시 결과 {largest}B 실제 수신·ACK 확인·진행자와 팀 경고 없음")
        assert host.evaluate("() => window.chanFixture.oversized.length") == 0
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/stats") as response:
            stats = json.load(response)
        assert stats["dropped"] > 0 if cap else stats["dropped"] == 0
        assert stats["badJoin"] == 0
        assert not errors, errors
        print(f"통과: 제한 {cap or '없음'}, 버림 {stats['dropped']}회, 콘솔·페이지 오류 0")
    finally:
        for context in contexts:
            context.close()
        server.terminate()
        server.wait(timeout=5)


if __name__ == "__main__":
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            run(browser, 20000)
            run(browser, None)
        finally:
            browser.close()
