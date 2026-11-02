"""저장 손상·옛 판본·공간 부족 검사(Chromium).

실행: tests/.venv/bin/python tests/league/storage.py <loopback 주소>
브라우저 실행은 샌드박스 밖 로컬 환경의 총괄 담당.
"""

import copy
import json
import os
import traceback
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from econui import (BOOT_JS, Checks, HOST_JS, SYNC_JS, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, shown)
from league_flow import confirm_seat, select_mode
from solo import KEY, STATE_READY_JS, click_next, read

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).with_name("fixtures")
ROUTES = ("#league", "#league/solo", "#league/host", "#league/team")
WAIT = 120000  # 부하가 높은 로컬에서도 시간 자체를 성능 실패로 판정하지 않는다.
NOTICE = "#lg-solo header .lg-hint"
TOAST = '#bd-toast[data-show="true"]'
HOST_WARNING = "#lg-host-warning"
# (비공개 작업 지시서): 키 × 경로의 기대 화면.
# K_TEAM은 로비의 재참가 정보, K_TAB은 /team에서 실제로 읽는 탭 저장이다.
# K_HOST의 유효한 방·wrapper 안에 팀 상태가 손상된 경우만 D-64 대체 상태를 쓴다.
#                       로비       혼자 하기     진행자       팀
EXPECTED_SCREENS = {
    "K_NET":  ("lobby", "solo",  "host",  "team"),
    "K_HOST": ("lobby", "solo",  "lobby", "team"),
    "K_TEAM": ("lobby", "solo",  "host",  "team"),
    "K_DATA": ("lobby", "solo",  "host",  "team"),
    "K_TAB":  ("lobby", "solo",  "host",  "lobby"),
    "K_SOLO": ("lobby", "lobby", "host",  "team"),
}
SCREEN_SELECTORS = {"lobby": ".lg-modes", "solo": "#lg-bar",
                    "host": "#lg-roomcode", "team": "#lg-bar",
                    "replacement": "#lg-roomcode", "seat": ".lg-seats"}

# git log -p -S 'initial: L.initial' / -S 'previous: L.previous' -- ui/league.js:
# adc9b502c2584bba57031929586638fbb24f3db4에서 두 재도전 필드가 추가됐다.
# git log -p -S 'seedMode' / -S 'seedKey' -- ui/league-core.js 및
# -S 'identity: L.identity, fingerprint: L.fingerprint' / -S 'state.sid' -- ui/league.js:
# 198345b0bc9aead185c4862ba76cfcfd198ca0c8에서 씨앗·소금·진행자 서명 필드가 추가됐다.
# git log -p -S 'aiRound: L.aiRound' -- ui/league.js:
# b80676cf9fcbff8b72150088c812e7f380f7ea1f의 최초 saveSolo부터 aiRound가 있었다.
# 따라서 aiRound 없는 저장을 실제 옛 판본이라고 꾸며 검사하지 않는다.
# league.js startSolo의 valid는 initial·previous·seedKey·seedMode·salt를
# 요구하지 않는다. 이 필드만 뺀 옛 판본 조리법은 반드시 restore여야 한다.

QUOTA_JS = """([key, selector, prefix = false]) => {
  const original = Storage.prototype.setItem;
  const matches = (storage, k) => storage === localStorage &&
    (prefix ? String(k).startsWith(key) : k === key);
  const probe = window.__storageProbe = {key, failed:0, succeeded:0,
    warningSeen:false, failedAt:null, warningAt:null, warningText:''};
  // 진행 중 화면이 다시 그려져도 실제 표시된 짧은 토스트를 놓치지 않는다.
  const observer = new MutationObserver(() => {
    const n = document.querySelector(selector);
    if (n && n.getClientRects().length && /저장/.test(n.innerText) && /못|실패/.test(n.innerText)) {
      probe.warningSeen = true;
      probe.warningText = n.innerText;
      if (probe.warningAt === null) probe.warningAt = performance.now();
    }
  });
  observer.observe(document.documentElement, {subtree:true, childList:true,
    characterData:true, attributes:true, attributeFilter:['data-show']});
  probe.fail = () => {
    probe.warningSeen = false; probe.failedAt = null; probe.warningAt = null;
    probe.warningText = '';
    Storage.prototype.setItem = function(k, v) {
      if (matches(this, k)) {
        probe.failed++;
        if (probe.failedAt === null) probe.failedAt = performance.now();
      }
      // 기존 solo·host는 모든 쓰기를 실패시킨다. 팀은 팀 자료 키만 막는다.
      if (prefix && !matches(this, k)) return original.call(this, k, v);
      throw new DOMException('검사용 저장 공간 부족', 'QuotaExceededError');
    };
  };
  probe.fail();
  probe.restore = () => {
    Storage.prototype.setItem = function(k, v) {
      const result = original.call(this, k, v);
      if (matches(this, k)) probe.succeeded++;
      return result;
    };
  };
  probe.cleanup = () => { Storage.prototype.setItem = original; observer.disconnect(); };
}"""


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def start_solo(page, months=12):
    # league_flow.start_solo의 같은 조작·선택자. 공용 함수의 명시적 15초는
    # expect.set_options로 바뀌지 않으므로 이 두 부하 검사만 기본 60초를 적용한다.
    select_mode(page, "solo")
    length = page.locator(f'[data-select="lg-solo-turns"][data-value="{months}"]')
    length.click()
    expect(length).to_have_attribute("aria-pressed", "true")
    page.locator("#lg-solo-start").click()
    expect(page).to_have_url(re.compile(r".*#league/solo$"))
    expect(page.locator("#lg-bar")).to_be_visible()


def storage_keys():
    # 키를 중복 정의하지 않고 league.js 맨 위의 현재 상수를 읽는다.
    source = (ROOT / "ui/league.js").read_text()
    names = ("K_NET", "K_HOST", "K_TEAM", "K_DATA", "K_TAB")
    keys = {name: re.search(r'\b' + name + r'\s*=\s*"([^"]+)"', source)[1]
            for name in names}
    keys["K_SOLO"] = KEY
    return keys


def new_context(browser, base):
    context, external = context_for(browser, base, 1280, 900, "light")
    context.set_default_timeout(WAIT)
    context.set_default_navigation_timeout(WAIT)
    return context, external


def inject_once(page, local, session=None):
    # 페이지 단위 init script이므로 도우미 진행자에는 재주입하지 않는다.
    # sessionStorage 표시는 hash 이동·새로고침 때 삭제한 손상값의 부활을 막는다.
    page.add_init_script("""(() => {
      if (!/^https?:$/.test(location.protocol)) return;
      const marker = '__league_storage_injected';
      if (sessionStorage.getItem(marker)) return;
      const [local, session] = %s;
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
      sessionStorage.setItem(marker, '1');
    })();""" % encoded([local, session or {}]))


STATE_DUMP_JS = """() => { const L = KCP.league?.state?.(); let tab = null;
  try { tab = JSON.parse(sessionStorage.getItem('kcp-league-tab-v1')); } catch (_) {}
  return {hash: location.hash, role: L?.role, team: L?.team, room: L?.room, snap: !!L?.snap,
    tabTeam: tab?.team, tabRoom: tab?.room, text: document.querySelector('main')?.innerText?.slice(0, 120)}; }"""


def fail_exc(checks, label, exc):
    """예외를 실패로 세고, 원인을 볼 수 있게 메시지와 traceback 끝을 남긴다."""
    message = (str(exc).splitlines() or [""])[0][:200]
    checks.ok(False, f"{label} 예외 {type(exc).__name__}: {message}")
    print(traceback.format_exc()[-1500:], flush=True)


def selected(label):
    """KCP_ONLY(쉼표로 여러 개)가 있으면 이름에 그 글자가 들어간 사례만 돌린다."""
    only = [x for x in os.environ.get("KCP_ONLY", "").split(",") if x]
    return not only or any(x in label for x in only)


def screen_ok(page):
    # 공통 머리글만 남은 화면과 기다림 문구만 있는 반쪽 팀 화면은 인정하지 않는다.
    return any(shown(page, selector) for selector in
               (".lg-modes", "#lg-bar", "#lg-roomcode", "#lg-seat-confirm"))


def check_screen(checks, page, label):
    checks.test(label + " 로비 또는 리그 화면 표시", lambda: screen_ok(page))
    overflow(checks, page, label)


def notice_visible(page):
    return any(node.is_visible() and "저장" in node.inner_text()
               for node in page.locator(NOTICE).all())


def failed_warning(page, selector):
    nodes = page.locator(selector)
    return any(node.is_visible() and "저장" in node.inner_text() and
               re.search("못|실패", node.inner_text()) for node in nodes.all())


def create_host(context, base, keys, pages, join=False):
    host, events = monitored_page(context)
    pages.append((host, events, "진행자 도우미"))
    host.goto(base + "#league")
    select_mode(host, "host")
    host.locator(".lg-net summary").click()
    host.locator('input[name="lg-net"][value="local"]').check()
    host.locator('[data-turns="12"]').click()
    host.locator("#lg-host").click()
    host.wait_for_selector("#lg-roomcode")
    host.wait_for_timeout(1400)  # 진행자 1초 디바운스(tests.md·D-64).
    save = host.evaluate("key => JSON.parse(localStorage.getItem(key))", keys["K_HOST"])
    if not join:
        return host, save, None
    team, events = monitored_page(context)
    pages.append((team, events, "팀 도우미"))
    team.goto(base + "#league")
    select_mode(team, "join")
    team.fill("#lg-code", save["room"])
    team.click("#lg-join")
    city_id = host.evaluate("() => KCP.LEAGUE_REGIONS.south.teams[1].id")
    confirm_seat(team, city_id, timeout=60000)
    tab = team.evaluate("key => JSON.parse(sessionStorage.getItem(key))", keys["K_TAB"])
    return host, save, tab


def normal_saves(checks, browser, base, keys):
    context, external = new_context(browser, base)
    pages = []
    try:
        page, events = monitored_page(context)
        pages.append((page, events, "정상 저장 원본"))
        page.goto(base + "#league")
        start_solo(page, 12)
        page.wait_for_function(STATE_READY_JS)
        observation = read(page)
        for _ in range(10):
            state = observation["S"]
            if state["round"] == 3 and state["phase"] == "plan":
                break
            observation = click_next(page, state)
        checks.ok(len(observation["S"]["results"]) == 2 and
                  observation["S"]["round"] == 3,
                  "S2 화면 버튼으로 2달 진행한 정상 저장")
        page.wait_for_timeout(400)
        solo_save = page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)
        checks.ok(solo_save["state"] == observation["S"], "S2 정상 저장과 현재 상태 일치")
        host, _, tab_save = create_host(context, base, keys, pages, join=True)
        host.wait_for_function("id => !!KCP.league.state().S.teams[id].publicKey", arg=tab_save["team"])
        pages[-1][0].close()
        # 로비 저장이면 무효→newState 초기화도 복원처럼 보인다. 화면에서 2달 운영한다.
        for month in (1, 2):
            host.locator("#lg-next").click()
            host.wait_for_function(SYNC_JS, arg=[month, "plan"])
            host.locator("#lg-next").click()
            host.wait_for_function(SYNC_JS, arg=[month, "review"])
        host.wait_for_timeout(1400)
        host_save = host.evaluate("key => JSON.parse(localStorage.getItem(key))", keys["K_HOST"])
        checks.ok(host_save["state"] == host.evaluate(HOST_JS) and
                  len(host_save["state"]["results"]) == 2,
                  "S2 진행자 화면에서 2달 운영한 정상 저장")
        return solo_save, host_save
    finally:
        for page, events, label in pages:
            diagnostics(checks, events, "S2 정상 저장 생성 " + label)
            if not page.is_closed():
                overflow(checks, page, "S2 정상 저장 생성 " + label)
        checks.ok(not external, "S2 정상 저장 생성 외부 요청 0")
        context.close()


def damaged(kind, baseline, solo_save, name):
    if kind == "깨진 JSON":
        return '{"state":'
    if kind == "null":
        return "null"
    if kind == "숫자":
        return "42"
    if kind == "배열":
        return "[]"
    if kind == "100만 자 문자열":
        return encoded("x" * 1000000)
    value = copy.deepcopy(baseline)
    if kind == "null 상태":
        # 팀 탭은 state가 아니라 room·team을 읽는다. 실제로 읽는 상태를 손상시킨다.
        value["room" if name == "K_TAB" else "state"] = None
    elif kind == "없는 팀":
        value["team"] = "__없는_검사용_팀__"
        value.setdefault("state", copy.deepcopy(solo_save["state"]))
        value["state"]["teams"].pop(solo_save["team"], None)
        value.setdefault("teams", {})
    else:
        raise ValueError("알 수 없는 손상 조리법")
    return encoded(value)


def corruption_matrix(checks, browser, base, keys, solo_save, host_save, cases):
    for name, key in keys.items():
        for kind in cases:
            for route in ROUTES:
                label = f"S1 {name} {kind} {route}"
                if not selected(label):
                    continue
                context, external = new_context(browser, base)
                pages = []
                try:
                    tab_save = {"room": host_save["room"], "team": solo_save["team"],
                                "net": {"kind": "local"}}
                    current_host = host_save
                    if route in ("#league/host", "#league/team"):
                        helper_host, current_host, tab_save = create_host(
                            context, base, keys, pages, join=True)
                        # 실제 서명된 팀 탭의 저장을 새 탭에 넣어 복원 경로도 통과시킨다.
                        pages[-1][0].close()
                        if route == "#league/host":
                            # 기존 진행자의 flushHost가 손상 주입을 덮어쓰지 않게 먼저 닫는다.
                            helper_host.close()
                    team_data = {"docs": {}, "journal": {}, "interview": {"months": {}}}
                    baseline = {"K_NET": {"kind": "local"}, "K_HOST": current_host,
                                "K_TEAM": tab_save, "K_DATA": team_data,
                                "K_SOLO": solo_save, "K_TAB": tab_save}
                    if route in ("#league/host", "#league/team"):
                        # 같은 컨텍스트에서 방금 만든 정상 저장은 그대로 두고 해당 키만 바꾼다.
                        local = {}
                    else:
                        local = {keys[n]: encoded(v) for n, v in baseline.items() if n != "K_TAB"}
                    session = {keys["K_TAB"]: encoded(tab_save)}
                    raw = damaged(kind, baseline[name], solo_save, name)
                    if name == "K_TAB":
                        session[key] = raw
                    else:
                        local[key] = raw
                    if name == "K_DATA":
                        # K_DATA는 접두사다. 실제로 읽는 방:팀 키에도 같은 손상을 넣는다.
                        local[f"{key}:{tab_save['room']}:{tab_save['team']}"] = raw
                    page, events = monitored_page(context)
                    pages.append((page, events, label))
                    inject_once(page, local, session)
                    page.goto(base + route)
                    page.wait_for_function(BOOT_JS)
                    expected = EXPECTED_SCREENS[name][ROUTES.index(route)]
                    if name == "K_HOST" and route == "#league/host" and kind == "없는 팀":
                        expected = "replacement"
                    if name == "K_TAB" and route == "#league/team" and kind == "없는 팀":
                        # 방은 유효하고 팀 id만 이 방에 없다: 기다림 화면에 멈추지 않고 자리 선택으로 돌아가야 한다
                        # (league.js onSnap, 2026-10-20 총괄 승인). 다른 K_TAB 손상은 방을 읽지 못해 로비로 간다.
                        expected = "seat"
                    selector = SCREEN_SELECTORS[expected]
                    expect(page.locator(selector)).to_be_visible()
                    wanted_hash = "#league" if expected == "lobby" else route
                    checks.ok(page.evaluate("location.hash") == wanted_hash and shown(page, selector),
                              label + " 기대 화면 " + expected)
                    if expected == "replacement":
                        state = page.evaluate(HOST_JS)
                        checks.ok(bool(state.get("sid")) and state["round"] == 0 and
                                  state["results"] == [],
                                  label + " D-64 깨진 저장 대체 상태·sid")
                    elif expected in ("host", "team", "solo"):
                        checks.ok(page.evaluate("() => KCP.league.state()?.role") == expected,
                                  label + " 정상 역할 유지")
                    overflow(checks, page, label)
                    if name == "K_SOLO" and route == "#league/solo":
                        checks.ok(notice_visible(page), label + " 저장 안내 표시")
                        checks.ok(page.evaluate("key => localStorage.getItem(key) === null", KEY),
                                  label + " 손상 저장 키 삭제")
                        page.reload()
                        page.wait_for_function(BOOT_JS)
                        checks.ok(page.evaluate("key => localStorage.getItem(key) === null", KEY),
                                  label + " 새로고침 뒤 손상값 재주입 없음")
                except Exception as exc:
                    fail_exc(checks, label, exc)
                    for pg, _, title in pages:
                        if not pg.is_closed():
                            try:
                                print("상태", title, pg.evaluate(STATE_DUMP_JS), flush=True)
                            except Exception:
                                pass
                finally:
                    for _, events, title in pages:
                        diagnostics(checks, events, title)
                    checks.ok(not external, label + " 외부 요청 0")
                    context.close()


def remove_fields(save, paths):
    old = copy.deepcopy(save)
    for path in paths:
        fields = path.split(".")
        parent = old
        for field in fields[:-1]:
            parent = parent[field]
        # 필드가 없어도 조용히 통과시키면 현재 저장 변경 시 시험이 무효화된다.
        del parent[fields[-1]]
    return old


def advance_month(page):
    before = read(page)
    old = before["S"]
    for _ in range(6):
        after = click_next(page, before["S"])
        if (after["S"]["round"] > old["round"] and
                len(after["S"]["results"]) > len(old["results"])):
            return after
        before = after
    raise AssertionError("준비 뒤 한 달 진행되지 않음")


def host_restoration(checks, page, old, recipe, label, key):
    expect(page.locator("#lg-roomcode")).to_be_visible()
    restored = page.evaluate(HOST_JS)
    original = old["state"]
    checks.ok(len(original["results"]) == 2 and
              restored["results"] == original["results"] and
              restored["round"] == original["round"] and
              restored["phase"] == original["phase"],
              label + " 2달 결과·달·단계 보존(newState 초기화와 구분)")
    checks.ok(restored["teams"].keys() == original["teams"].keys(), label + " 참가 도시 보존")
    if recipe.get("migration"):
        # league.js hostInit → league-core.js host(kick): 이전 때만 rev·log에
        # 자리 비움이 추가된다. 원본 로그와 예상 증가를 검증하고, 재로드에서는 정확히 비교한다.
        names = page.evaluate("() => Object.fromEntries(KCP.LEAGUE_REGIONS.south.teams.map(t => [t.id,t.name]))")
        kicks = [names[city] + " 자리 비움" for city in original["teams"]]
        count = len(kicks)
        original_log = original["log"][-(40 - count):]
        checks.ok(restored["rev"] == original["rev"] + count and
                  restored["log"][:-count] == original_log and
                  [item["t"] for item in restored["log"][-count:]] == kicks,
                  label + " 원본 rev·log 보존 + 이전의 자리 비움만 추가")
        checks.ok(restored["seedKey"] == original.get("seedKey", original["room"]),
                  label + " 기존 씨앗 또는 옛 방 씨앗 보존")
        checks.ok(all(not team.get("token") and not team.get("publicKey") and
                      not team.get("ready") for team in restored["teams"].values()) and
                  all(restored["teams"][city]["seatVersion"] == team.get("seatVersion", 0) + 1
                      for city, team in original["teams"].items()), label + " 모든 자리 비움")
        room = page.evaluate("() => KCP.league.state().room")
        # sid만 없는 저장은 기존 진행자 키의 코드가 같다. 짧은 옛 코드 사례만 교체를 요구한다.
        checks.ok(bool(re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", room)) and
                  (not recipe.get("legacy_room") or room != old["room"]) and
                  restored["room"] == room, label + " 이전 후 8자리 방 코드")
        checks.ok(shown(page, HOST_WARNING) and
                  "예전 방" in page.locator(HOST_WARNING).inner_text() and
                  "새 코드" in page.locator(HOST_WARNING).inner_text(), label + " 이전 안내 표시")
        page.wait_for_timeout(1400)
        saved = page.evaluate("key => JSON.parse(localStorage.getItem(key)).state", key)
        checks.ok(all(saved.get(field) == restored.get(field)
                      for field in ("results", "round", "rev", "seedKey", "log")),
                  label + " 이전 완료 상태 저장")
        page.reload()
        expect(page.locator("#lg-roomcode")).to_be_visible()
        restored = page.evaluate(HOST_JS)
        original = saved
    checks.ok(all(restored.get(field) == original.get(field)
                  for field in ("round", "rev", "seedKey", "log")) and
              restored["results"] == original["results"],
              label + " 복원 results·round·rev·seedKey·log 저장값 일치")


def old_versions(checks, browser, base, keys, solo_save, host_save, recipes):
    for group in ("solo", "host"):
        for recipe in recipes[group]:
            label = f"S2 {group} {recipe['name']}"
            context, external = new_context(browser, base)
            page, events = monitored_page(context)
            try:
                expected = recipe["expect"]
                if expected not in ("restore", "clear"):
                    raise ValueError("옛 판본 기대 결과는 restore 또는 clear")
                old = remove_fields(solo_save if group == "solo" else host_save, recipe["remove"])
                if recipe.get("legacy_room"):
                    old["room"] = old["state"]["room"] = recipe["legacy_room"]
                    checks.ok(any(team.get("token") for team in old["state"]["teams"].values()),
                              label + " 이전 전 실제 점유 자리 존재")
                # Git 이력의 필드 삭제 조리법을 UI 정상 저장에 적용하되 디스크에는 쓰지 않는다.
                # 진행자 개인 서명 키가 있는 저장도 메모리에만 둔다.
                key = KEY if group == "solo" else keys["K_HOST"]
                route = "#league/solo" if group == "solo" else "#league/host"
                inject_once(page, {key: encoded(old)})
                page.goto(base + route)
                page.wait_for_function(BOOT_JS)
                if expected == "clear":
                    expect(page.locator(".lg-modes")).to_be_visible()
                    checks.ok(page.evaluate("location.hash") == "#league" and
                              page.evaluate("key => localStorage.getItem(key) === null", key),
                              label + " 기대 clear: 저장 삭제·로비 복귀")
                    if group == "solo":
                        checks.ok(notice_visible(page), label + " 삭제 이유 안내")
                elif group == "host":
                    host_restoration(checks, page, old, recipe, label, key)
                else:
                    expect(page.locator("#lg-bar")).to_be_visible()
                    restored = read(page)
                    checks.ok(restored["hash"] == route and restored["live"] is not None and
                              restored["S"]["round"] == old["state"]["round"] and
                              restored["S"]["phase"] == old["state"]["phase"] and
                              restored["S"]["results"] == old["state"]["results"],
                              label + " 기대 restore: 진행 기록 보존")
                    raw_before = page.evaluate("key => localStorage.getItem(key)", KEY)
                    after = advance_month(page)
                    checks.ok(after["S"]["round"] > restored["S"]["round"] and
                              len(after["S"]["results"]) == len(restored["S"]["results"]) + 1,
                              label + " 준비로 한 달 더 진행")
                    checks.ok(page.evaluate("key => localStorage.getItem(key)", KEY) != raw_before and
                              after["saved"] == after["live"], label + " 저장 갱신")
                check_screen(checks, page, label)
            except Exception as exc:
                fail_exc(checks, label, exc)
            finally:
                diagnostics(checks, events, label)
                checks.ok(not external, label + " 외부 요청 0")
                context.close()


def solo_quota_warning(checks, page, label):
    # (비공개 작업 지시서), league.js writeSolo·warnSoloSave:
    # 토스트는 2.2초 뒤 숨는다. 실제 실패 시각부터 2초 안의 표시를 관찰한 값으로 판정한다.
    page.wait_for_function("() => __storageProbe.warningSeen", timeout=2000)
    checks.ok(page.evaluate("""() => {
      const p = __storageProbe;
      return p.failedAt !== null && p.warningAt !== null &&
        p.warningAt >= p.failedAt && p.warningAt - p.failedAt <= 2000 &&
        /저장/.test(p.warningText);
    }"""), label + " 실패 직후 2초 안에 저장 토스트 표시")


def team_quota_step(host, team, month, phase):
    # 저장 함수·진행 함수를 호출하지 않고 진행자 화면의 실제 버튼으로 진행한다.
    host.locator("#lg-next").click()
    for page in (host, team):
        page.wait_for_function(SYNC_JS, arg=[month, phase])
    expect(team.locator("#lg-bphase")).to_have_text(
        {"plan": "계획·협상", "review": "결과·일지"}[phase])


def team_quota(checks, host, page, label):
    prefix = "kcp-league-data-v1:"
    message = "진행을 저장하지 못했어요. 브라우저 저장 공간·설정을 확인해요."

    def write_note(text):
        open_panel(page, "journal")
        # 약속 카드의 decision 칸은 2월 계획 단계에 없다(브라우저 확인 2026-10-21). 일지 질문 칸은 매달 있으므로
        # e2e.py와 같은 [data-j="why"]에 쓴다. 일지도 D-65에 따라 기기 안 팀 자료 키에만 저장된다.
        field = page.locator('[data-j="why"]')
        field.fill(text)
        field.press("Tab")  # 기존 e2e·econui 검사와 같이 화면의 입력·변경 이벤트로 저장한다.

    def warning(title):
        solo_quota_warning(checks, page, title)
        checks.ok(page.evaluate("() => __storageProbe.warningText") == message,
                  title + " 혼자 하기와 같은 저장 실패 문구")

    team_quota_step(host, page, 1, "plan")
    if shown(page, "#lg-guide-close"):
        page.locator("#lg-guide-close").click()
    initial_note = "가상 팀의 저장 전 기준을 기록한다"
    write_note(initial_note)
    page.wait_for_function("""([prefix, note]) => Object.keys(localStorage).some(k =>
      k.startsWith(prefix) && localStorage.getItem(k).includes(note))
    """, arg=[prefix, initial_note])
    data_keys = page.evaluate("prefix => Object.keys(localStorage).filter(k => k.startsWith(prefix))", prefix)
    if not checks.ok(len(data_keys) == 1, label + " 팀 자료 접두어 키 1개 발견"):
        raise AssertionError("격리된 진행자 1·팀 1 컨텍스트에 팀 자료 키 1개 필요")
    key = data_keys[0]
    raw_before = page.evaluate("key => localStorage.getItem(key)", key)
    checks.ok(raw_before is not None and initial_note in raw_before,
              label + " 화면 입력으로 기존 팀 자료 저장 생성")
    page.evaluate(QUOTA_JS, [prefix, TOAST, True])
    write_note("가상 팀의 첫 저장 실패를 확인한다")
    page.wait_for_function("() => __storageProbe.failed > 0")
    warning(label)
    team_quota_step(host, page, 1, "review")
    team_quota_step(host, page, 2, "plan")
    checks.ok(page.evaluate("""() => {
      const s = KCP.league.state().snap;
      return s.round === 2 && s.phase === 'plan' && s.results.length === 1;
    }"""), label + " 실패 중에도 진행자와 팀이 다음 달로 진행")
    checks.ok(page.evaluate("() => __storageProbe.failed > 0") and
              page.evaluate("key => localStorage.getItem(key)", key) == raw_before,
              label + " 실제 setItem 실패·기존 팀 자료 보존")

    page.evaluate("() => __storageProbe.restore()")
    successes = page.evaluate("() => __storageProbe.succeeded")
    recovered_note = "가상 팀의 복구 뒤 기준을 새로 기록한다"
    write_note(recovered_note)
    page.wait_for_function("n => __storageProbe.succeeded > n", arg=successes)
    page.wait_for_function("""([key, note]) => localStorage.getItem(key)?.includes(note)
    """, arg=[key, recovered_note])
    raw_recovered = page.evaluate("key => localStorage.getItem(key)", key)
    checks.ok(raw_recovered != raw_before and recovered_note in raw_recovered,
              label + " 복구 뒤 화면 입력으로 팀 자료 저장 성공·입력값 일치")
    # 첫 표시가 실제로 숨은 뒤에만 프로브를 초기화해 재실패 표시를 관찰한다.
    page.locator(TOAST).wait_for(state="hidden")
    checks.ok(not failed_warning(page, TOAST), label + " 다음 성공 뒤 실패 경고 해제")
    # 토스트가 숨는 동안(약 2초) 다른 정상 저장이 더 일어날 수 있으므로, 보존 비교 기준은 재실패 직전에 읽는다.
    raw_refail = page.evaluate("key => localStorage.getItem(key)", key)
    failures = page.evaluate("() => __storageProbe.failed")
    page.evaluate("() => __storageProbe.fail()")
    write_note("가상 팀의 두 번째 저장 실패를 확인한다")
    page.wait_for_function("n => __storageProbe.failed > n", arg=failures)
    warning(label + " 재실패")
    team_quota_step(host, page, 2, "review")
    team_quota_step(host, page, 3, "plan")
    checks.ok(page.evaluate("""() => {
      const s = KCP.league.state().snap;
      return s.round === 3 && s.phase === 'plan' && s.results.length === 2;
    }"""), label + " 재실패 중에도 진행자와 팀이 다음 달로 진행")
    checks.ok(page.evaluate("() => __storageProbe.failed") > failures and
              page.evaluate("key => localStorage.getItem(key)", key) == raw_refail,
              label + " 재실패 때 실제 setItem 실패·성공 팀 자료 보존")


def quota(checks, browser, base, keys, role):
    label = "S3 " + {"solo": "혼자 하기", "host": "진행자", "team": "팀"}[role]
    if not selected(label):
        return
    context, external = new_context(browser, base)
    pages = []
    page = None
    try:
        if role == "team":
            host, _, _ = create_host(context, base, keys, pages, join=True)
            page = pages[-1][0]
            team_quota(checks, host, page, label)
            check_screen(checks, page, label)
            return
        key = KEY if role == "solo" else keys["K_HOST"]
        if role == "solo":
            page, events = monitored_page(context)
            pages.append((page, events, label))
            page.goto(base + "#league")
            start_solo(page, 12)
            page.wait_for_function(STATE_READY_JS)
            warning = TOAST
        else:
            page, _, _ = create_host(context, base, keys, pages)
            page.locator("#lg-next").click()
            page.wait_for_function(SYNC_JS, arg=[1, "plan"])
            page.wait_for_timeout(1400)
            warning = HOST_WARNING
        raw_before = page.evaluate("key => localStorage.getItem(key)", key)
        page.evaluate(QUOTA_JS, [key, warning])
        if role == "solo":
            after = read(page)
            for _ in range(6):
                after = click_next(page, after["S"])
                if after["S"]["phase"] == "review" and len(after["S"]["results"]) == 1:
                    break
            checks.ok(after["S"]["round"] == 1 and len(after["S"]["results"]) == 1,
                      label + " 실패 중에도 한 달 진행")
        else:
            page.locator("#lg-next").click()
            page.wait_for_function(SYNC_JS, arg=[1, "review"])
            checks.ok(len(page.evaluate(HOST_JS)["results"]) == 1, label + " 실패 중에도 한 달 진행")
        if role == "solo":
            solo_quota_warning(checks, page, label)
        else:
            checks.test(label + " 저장 실패 경고 표시", lambda: bool(page.wait_for_function(
                "() => __storageProbe.warningSeen")))
        checks.ok(page.evaluate("() => __storageProbe.failed > 0") and
                  page.evaluate("key => localStorage.getItem(key)", key) == raw_before,
                  label + " 실제 setItem 실패·기존 저장 보존")
        if role == "host":
            # D-64, (비공개 작업 지시서):
            # league.js flushHost·hostWarning의 진행자 경고는 성공 저장까지 유지한다.
            page.wait_for_timeout(2500)
            checks.ok(failed_warning(page, warning), label + " 다음 성공 전 진행자 경고 유지")
        page.evaluate("() => { __storageProbe.restore(); }")
        if role == "solo":
            recovered = advance_month(page)
            live = recovered["live"]
        else:
            page.locator("#lg-next").click()
            page.wait_for_function(SYNC_JS, arg=[2, "plan"])
            live = page.evaluate(HOST_JS)
        page.wait_for_function("() => __storageProbe.succeeded > 0")
        page.wait_for_timeout(400)
        saved = page.evaluate("key => JSON.parse(localStorage.getItem(key))", key)
        checks.ok(saved["state"] == live, label + " 복구 뒤 다음 저장 성공·현재 상태 일치")
        page.wait_for_function("""selector => {
          const n = document.querySelector(selector);
          return !n || !n.getClientRects().length || !/저장.*(?:못|실패)/.test(n.innerText);
        }""", arg=warning)
        checks.ok(not failed_warning(page, warning), label + " 다음 성공 뒤 실패 경고 해제")
        if role == "solo":
            # 직전 토스트가 숨은 뒤 재실패시켜 첫 표시를 재사용하는 거짓 통과를 막는다.
            raw_recovered = page.evaluate("key => localStorage.getItem(key)", key)
            failures = page.evaluate("() => __storageProbe.failed")
            page.evaluate("() => { __storageProbe.fail(); }")
            retried = advance_month(page)
            checks.ok(len(retried["S"]["results"]) == len(live["results"]) + 1,
                      label + " 재실패 중에도 한 달 진행")
            solo_quota_warning(checks, page, label + " 재실패")
            checks.ok(page.evaluate("() => __storageProbe.failed") > failures and
                      page.evaluate("key => localStorage.getItem(key)", key) == raw_recovered,
                      label + " 재실패 때 실제 setItem 실패·성공 저장 보존")
        check_screen(checks, page, label)
    except Exception as exc:
        fail_exc(checks, label, exc)
    finally:
        if page is not None and not page.is_closed():
            checks.test(label + " setItem 원상 복구", lambda: page.evaluate(
                "() => { window.__storageProbe?.cleanup(); return true; }"))
        for _, events, title in pages:
            diagnostics(checks, events, title)
        checks.ok(not external, label + " 외부 요청 0")
        context.close()


def main():
    expect.set_options(timeout=60000)
    checks = Checks()
    try:
        base = local_address(sys.argv)
        keys = storage_keys()
        recipes = json.loads((FIXTURES / "storage-cases.json").read_text())
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                try:
                    solo_save, host_save = normal_saves(checks, browser, base, keys)
                    corruption_matrix(checks, browser, base, keys, solo_save, host_save, recipes["damage"])
                    old_versions(checks, browser, base, keys, solo_save, host_save, recipes)
                except Exception as exc:
                    checks.ok(False, f"S1·S2 저장 시험 자료 생성·검사 예외 {type(exc).__name__}")
                # 정상 저장 생성 실패가 별개의 공간 부족 검사까지 생략하게 하지 않는다.
                quota(checks, browser, base, keys, "solo")
                quota(checks, browser, base, keys, "host")
                quota(checks, browser, base, keys, "team")
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"저장 검사 실행 예외 {type(exc).__name__}")
    checks.finish()
    print(f"problems: {checks.failed}", flush=True)
    return int(bool(checks.failed))


if __name__ == "__main__":
    sys.exit(main())
