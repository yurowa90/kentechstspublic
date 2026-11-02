"""U5 1단계: 운영 직후 진행자·팀 응답과 '준비' 왕복 측정(앱 수정 없음, 측정만).

실행(총괄 로컬, 샌드박스 밖): tests/.venv/bin/python tests/league/responsive.py http://127.0.0.1:<포트>/index.html
선택: --rates 4,6 --modes host,teams,both --months 3(겹침 조건이 그 뒤 두 달을 더 쓴다). 서버는 python3 tests/srv.py <포트> . 을 쓴다.
지시서: (비공개 작업 지시서) 판정 예산은 없다. 측정 실패·예외만 problems에 센다.

장치: 진행자 1 + 팀 6(같은 컨텍스트, 로컬 BroadcastChannel), 12달 방의 앞 몇 달, 1280×900, 날씨·사건 고정.
감속 조건: 배수(4·6) × 진행자만·팀만·둘 다. 조건마다 새 컨텍스트에서 처음부터 차린다.

- R1 진행자 운영 직후: #lg-next(운영) 클릭부터 3초·10초 창의 긴 작업. C.run·publicView·signHost는 KCP 함수를
  감싸 잰다. renderHost·pushSnap·flushHost는 감쌀 수 없는 내부 함수라 CDP 표본 프로파일의 포함 시간으로 나눈다.
- R2 팀 결과 수신 직후: 결과 snap 처리(hostReceiver의 apply = onSnap + teamSave) 길이와 3초 창의 긴 작업,
  outageSnapshot·outageAttribution 포함 시간(팀 하나 프로파일), viewKey(V 전체 문자열화) 비용 미세 측정.
  2월 이후 달은 지난달 대비 분해(monthly) 경로를 지난다.
- R3 준비 왕복: 경제 리그에서 '준비'는 계획 단계에서만 보낼 수 있다(ui/league.js readyAllowed). 그래서
  '진행자가 다음 달을 열어 계획 snap이 닿은 직후, 약속(근거·방향·확신)을 고르고 약속하고 준비를 누름'을 잰다.
  확인 클릭 → 진행자 반영(host receiver ok) → 팀 snap의 me.ready 반영까지.
  '겹침'(총괄 추가): 운영 직후 팀 수신을 기다리지 않고 진행자가 바로 다음 달을 열어, 팀의 결과 처리(S7)와
  다음 계획 snap이 겹친 상태에서 같은 왕복을 잰다. 진행자 수신 결과(err 종류)와
  답 누락(replyGate null), 팀 nack 사유를 모은다.

긴 작업은 두 가지로 센다. (1) PerformanceObserver longtask(6차 녹화의 window.__kcpLong과 같은 근거),
(2) 50ms 타이머 지연이 200ms 이상인 구간(주 스레드가 막힌 시간의 대리값). perf.py 기록상 이 브라우저에서
longtask가 비어 올 수 있어 (2)를 함께 둔다. 숨김 탭의 타이머 제한이 섞이지 않도록 visibilityState를 남긴다.
프로파일은 1ms 간격 표본이라 계측 부하가 조금 들어간다(모든 달 같은 조건).

한계(보고에 밝힐 것): 1ms 프로파일은 진행자와 팀 하나에만 걸고, 그 팀은 R2·R3 통계에서 뺀다.
50ms 타이머는 일곱 페이지 모두에서 돌고, 지연 시각은 예정 틱 기준이라 최대 50ms 오차가 있다.
longtask·지연은 timeOrigin+performance 시계, 클릭·이벤트는 Date.now라 몇 ms 표류가 있을 수 있다.
프로파일 시간 배분(timeDeltas)은 근사이고, onSnap 안 stringify는 V8이 프레임으로 잡을 때만 보인다.
viewKey 비용은 미세 측정(VIEWKEY_JS)을 주 근거로 쓴다. 한 브라우저 컨텍스트의 BroadcastChannel이며
실제 태블릿·네트워크가 아니다. save의 chars는 문자 수(UTF-8 바이트 아님)다.
"""

from league_flow import finish_trial
import argparse
import json
import math
import os
import statistics
import sys
import time
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import econui
from league_flow import confirm_seat, pass_issue_check, select_mode
from playwright.sync_api import expect, sync_playwright

D = Path(__file__).resolve().parent
RESULT = D.parents[0] / "results" / "responsive.json"
STRAT = (D / "calib2.py").read_text().split('STRAT = """')[1].split('"""')[0]
AUTO = (D / "calib.py").read_text().split('AUTO = """')[1].split('"""')[0]
WAIT = 60000  # 감속 실행의 대기 상한(판정 예산이 아니다).
READY_WAIT = 30000  # 준비가 진행자에 닿지 않은 것으로 보는 상한(녹화 스크립트 15초보다 넉넉히).
LONG_MS = 200
WINDOWS = (3, 10)  # R1 창(초). R2는 3초 창.
LOAD_LIMIT = 150
PROFILE_US = 1000
MODES = {"host": "진행자만", "teams": "팀만", "both": "둘 다"}
# 이 후킹이 빠지면 측정이 조용히 비므로 실패로 센다.
REQUIRED_HOOKS = {"진행자": ("leagueCore.run", "leagueNet.signHost", "leagueNet.receiver", "leagueNet.replyGate"),
                  "팀": ("leagueNet.hostReceiver", "leagueNet.signEnvelope")}
# 프로파일 포함 시간을 뽑을 앱 함수(이름 기준). stringify는 onSnap 아래 호출만 따로 센다(viewKey 비용).
TARGETS = ("run", "runRound", "recordCo2Attribution", "econMonth", "hostNext", "renderHost",
           "pushSnap", "hostSend", "signHost", "compactSnapshot", "canonical", "publicView",
           "changed", "flushHost", "onSnap", "outageSnapshot", "outageAttribution",
           "outageAttributionMonthly", "renderBar", "renderPanel", "snapRenderPanel",
           "expandSnapshot", "teamSave", "phaseChanged", "refreshCityTownLook")

# 모든 페이지에 탐색 전에 넣는다. 앱 파일은 바꾸지 않고 KCP 모듈 메서드만 감싼다.
# league.js는 const C = KCP.leagueCore처럼 객체를 잡아 두고 C.run(...)으로 부르므로, 같은 객체의
# 속성을 감싸면 호출 때 감싼 함수가 쓰인다(perf.py와 같은 방식).
INIT_JS = r"""(() => {
  const P = window.__resp = {events: [], long: [], lag: [], hooks: {}, errors: [], visibility: []};
  const log = (kind, o) => { P.events.push(Object.assign({kind, at: Date.now()}, o)); };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries())
        P.long.push({at: Math.round(performance.timeOrigin + e.startTime), ms: e.duration});
    }).observe({type: 'longtask', buffered: true});
  } catch (e) { P.errors.push('longtask: ' + e.name); }
  // 50ms 타이머가 늦게 온 만큼을 '막힌 시간'으로 남긴다(200ms 이상만).
  let last = performance.now();
  const tick = () => {
    const now = performance.now(), gap = now - last - 50;
    if (gap >= 200) P.lag.push({at: Math.round(performance.timeOrigin + last + 50), ms: gap,
                                visible: document.visibilityState});
    last = now; setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
  document.addEventListener?.('visibilitychange', () => P.visibility.push({at: Date.now(), s: document.visibilityState}));
  window.addEventListener('click', e => {
    const b = e.target?.closest?.('#lg-next, #lg-ready, #lg-ready-confirm');
    if (b) log('click', {id: b.id});
  }, true);
  const watched = new WeakMap();
  const wrap = (object, key, transform, label) => {
    let keys = watched.get(object);
    if (!keys) watched.set(object, keys = new Set());
    if (keys.has(key)) return;
    keys.add(key);
    let value;
    const adapt = original => {
      if (typeof original !== 'function') return original;
      P.hooks[label] = true;
      return transform(original);
    };
    try {
      value = adapt(object[key]);
      Object.defineProperty(object, key, {configurable: true, enumerable: true,
        get: () => value, set: next => { value = adapt(next); }});
    } catch (e) { P.hooks[label] = false; P.errors.push(label + ': ' + e.name); }
  };
  const sync = name => original => function (...args) {
    const at = Date.now(), t0 = performance.now();
    try { return Reflect.apply(original, this, args); }
    finally { log(name, {start: at, ms: performance.now() - t0}); }
  };
  try {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (!String(key).startsWith('kcp-league')) return setItem.call(this, key, value);
      const at = Date.now(), t0 = performance.now();
      try { return setItem.call(this, key, value); }
      finally { log('save', {start: at, ms: performance.now() - t0, key: String(key).slice(0, 24),
                             chars: String(value).length}); }
    };
    P.hooks['localStorage.setItem'] = true;
  } catch (e) { P.errors.push('setItem: ' + e.name); }
  const attach = kcp => {
    if (!kcp || typeof kcp !== 'object') return kcp;
    const module = (key, install) => {
      let current = kcp[key];
      try {
        if (current) install(current);
        Object.defineProperty(kcp, key, {configurable: true, enumerable: true,
          get: () => current, set: next => { current = next; if (next) install(next); }});
      } catch (e) { P.errors.push('KCP.' + key + ': ' + e.name); }
    };
    module('leagueCore', core => {
      wrap(core, 'run', sync('run'), 'leagueCore.run');
      wrap(core, 'publicView', sync('publicView'), 'leagueCore.publicView');
    });
    module('leagueNet', net => {
      wrap(net, 'expandSnapshot', sync('expandSnapshot'), 'leagueNet.expandSnapshot');
      wrap(net, 'signHost', original => function (...args) {
        const at = Date.now(), t0 = performance.now(), event = args[1], data = args[4];
        return Promise.resolve(Reflect.apply(original, this, args))
          .finally(() => log('signHost', {start: at, ms: performance.now() - t0, event,
                                          round: data?.round ?? null, phase: data?.phase ?? null}));
      }, 'leagueNet.signHost');
      wrap(net, 'signEnvelope', original => function (...args) {
        const at = Date.now(), t0 = performance.now(), type = args[2]?.type;
        return Promise.resolve(Reflect.apply(original, this, args))
          .finally(() => log('signEnvelope', {start: at, ms: performance.now() - t0, type}));
      }, 'leagueNet.signEnvelope');
      // 진행자: 팀 요청 검증·규칙 적용 결과(err 종류, 16개 초과 폐기는 request 없는 bad).
      wrap(net, 'receiver', original => function (...args) {
        const receive = Reflect.apply(original, this, args);
        return function (envelope) {
          const at = Date.now();
          return Promise.resolve(receive.apply(this, arguments)).then(r => {
            const m = r?.request;
            log('host-recv', {start: at, team: envelope?.team ?? null, type: m?.type ?? null,
                              ok: !!r?.ok, err: r?.err ?? null, quiet: !!r?.quiet,
                              ready: m && m.type === 'ready' ? !!m.ready : null,
                              rd: m?.rd ?? null, ph: m?.ph ?? null});
            return r;
          });
        };
      }, 'leagueNet.receiver');
      // 진행자: 빈도 제한 등으로 답(ack·nack)을 보내지 않은 거절.
      wrap(net, 'replyGate', original => function (...args) {
        const gate = Reflect.apply(original, this, args);
        return function (result) {
          const reply = gate.apply(this, arguments);
          if (!reply && result && !result.ok)
            log('reply-drop', {type: result.request?.type ?? null, err: result.err ?? null});
          return reply;
        };
      }, 'leagueNet.replyGate');
      // 팀: 진행자 메시지 처리(snap은 onSnap + teamSave). 처리 뒤 내 준비 반영 여부를 남긴다.
      wrap(net, 'hostReceiver', original => function (trust, apply, rejected) {
        const timed = async function (event, data) {
          const at = Date.now(), t0 = performance.now();
          try { return await apply.apply(this, arguments); }
          finally {
            const st = window.KCP?.league?.state?.(), V = st?.snap;
            const me = V && st.team ? V.teams?.[st.team] : null;
            log('team-' + event, {start: at, ms: performance.now() - t0, round: V?.round ?? null,
                                  phase: V?.phase ?? null, ready: me ? !!me.ready : null,
                                  type: data?.type ?? null, err: data?.err ?? null});
          }
        };
        const refused = function (event) {
          log('team-rejected', {event});
          return typeof rejected === 'function' ? rejected.apply(this, arguments) : undefined;
        };
        const receive = Reflect.apply(original, this, [trust, timed, refused]);
        // 도착 시각: 앞 메시지 처리 때문에 사슬에서 기다린 시간(H3)과 건너뛴 snap을 따로 본다.
        return function (event, incoming) {
          const at = Date.now(), d = incoming?.data;
          const result = receive.apply(this, arguments);
          Promise.resolve(result).then(
            r => log('team-arrive', {start: at, event, handled: r === true,
                                     round: d?.round ?? null, phase: d?.phase ?? null}),
            () => log('team-arrive', {start: at, event, handled: null}));
          return result;
        };
      }, 'leagueNet.hostReceiver');
    });
    return kcp;
  };
  let kcp = attach(window.KCP);
  Object.defineProperty(window, 'KCP', {configurable: true, enumerable: true,
    get: () => kcp, set: next => { if (next !== kcp) kcp = attach(next); }});
})();"""

# 기록을 읽고 비운다(달마다). 큰 배열을 페이지에 쌓아 두지 않는다.
DRAIN_JS = """() => {
  const P = window.__resp;
  if (!P) return null;
  const out = {events: P.events.splice(0), long: P.long.splice(0), lag: P.lag.splice(0),
               hooks: P.hooks, errors: P.errors.slice(), visibility: P.visibility.splice(0),
               state: document.visibilityState};
  return out;
}"""
# R2 보탬: c376da4 팀 viewKey와 같은 모양의 문자열화 비용(감속이 걸린 실제 경과 ms).
VIEWKEY_JS = """() => {
  const st = KCP.league.state(), V = st?.snap;
  if (!V) return null;
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    JSON.stringify([{...V, now: 0}, st.team, st.rev]);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {median_ms: times[4], max_ms: times[8], chars: JSON.stringify(V).length};
}"""
TEAM_IDS_JS = "() => Object.keys(KCP.league.state().S.teams)"
ALL_READY_JS = "() => Object.values(KCP.league.state().S.teams).every(t => t.ready)"
PLAN_REV_JS = "id => (KCP.league.state().S.teams[id].rev || 0) >= 1"


def failure(report, label, exc):
    report["failures"].append({"label": label, "type": type(exc).__name__,
                               "detail": (str(exc).splitlines() or ["상세 없음"])[0][:300]})
    print(f"측정 실패: {label} ({type(exc).__name__})", flush=True)
    print(traceback.format_exc()[-2000:], flush=True)


def stats(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    if not values:
        return None
    return {"n": len(values), "min": min(values), "median": statistics.median(values),
            "max": max(values)}


def window(items, start, seconds):
    """[start, start+seconds) 안에 시작한 긴 작업·지연."""
    end = start + seconds * 1000
    picked = [x for x in items if start <= x["at"] < end]
    return {"count": len(picked), "max_ms": max((x["ms"] for x in picked), default=0.0),
            "sum_ms": sum(x["ms"] for x in picked)}


def inclusive(profile):
    """CDP 표본 프로파일 → 함수 이름별 포함 시간(ms). 재귀는 한 번만 센다."""
    nodes = {n["id"]: n for n in profile["nodes"]}
    parent = {}
    for n in profile["nodes"]:
        for child in n.get("children", []):
            parent[child] = n["id"]
    totals, under_onsnap = defaultdict(float), 0.0
    cache = {}

    def chain(node_id):
        if node_id not in cache:
            names, current = [], node_id
            while current is not None:
                frame = nodes[current]["callFrame"]
                path = urlsplit(frame.get("url", "")).path
                names.append((frame.get("functionName") or "", path.rsplit("/", 1)[-1]))
                current = parent.get(current)
            cache[node_id] = names
        return cache[node_id]

    for node_id, micros in zip(profile.get("samples", []), profile.get("timeDeltas", [])):
        names = chain(node_id)
        seen = set()
        for name, file in names:
            if name in TARGETS and file.startswith(("league", "econ", "build")) and name not in seen:
                seen.add(name)
                totals[name] += micros / 1000
        functions = [name for name, _ in names]
        if "onSnap" in functions and "stringify" in functions[:functions.index("onSnap")]:
            under_onsnap += micros / 1000
    totals["stringify(onSnap 안)"] = under_onsnap
    return dict(totals)


def throttle(context, page, rate):
    session = context.new_cdp_session(page)
    if rate > 1:
        session.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    return session


def profile_start(session):
    session.send("Profiler.enable")
    session.send("Profiler.setSamplingInterval", {"interval": PROFILE_US})
    session.send("Profiler.start")


def profile_stop(session):
    """(함수별 포함 ms, 실제 프로파일 구간 초). 운영이 길면 구간이 10초를 넘는다."""
    try:
        profile = session.send("Profiler.stop")["profile"]
        return inclusive(profile), (profile["endTime"] - profile["startTime"]) / 1_000_000
    finally:
        session.send("Profiler.disable")


def setup(context, base, rate_host, rate_team, pages):
    host, host_events = econui.monitored_page(context)
    pages.append((host, host_events, "진행자"))
    host_session = throttle(context, host, rate_host)
    host.goto(base + "#home", timeout=WAIT)
    host.wait_for_function(econui.BOOT_JS, timeout=WAIT)
    host.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    host.goto(base + "#league", timeout=WAIT)
    select_mode(host, "host")
    host.locator('[data-preset="6"]').click()
    host.locator('[data-turns="12"]').click()
    host.locator("#lg-host-seed").select_option("fixed")
    host.locator("#lg-host").click()
    host.wait_for_selector("#lg-roomcode", timeout=WAIT)
    room = host.inner_text("#lg-roomcode").strip()
    ids = host.evaluate(TEAM_IDS_JS)  # 도시 이름·id는 자료에서 읽는다(D-58).
    teams, sessions = {}, {}
    for tid in ids:
        page, events = econui.monitored_page(context)
        pages.append((page, events, "팀 " + tid))
        sessions[tid] = throttle(context, page, rate_team)
        page.goto(base + "#league", timeout=WAIT)
        select_mode(page, "join")
        page.fill("#lg-code", room)
        page.click("#lg-join")
        confirm_seat(page, tid, timeout=WAIT)
        coach = page.locator("#lg-coach-close")
        if coach.count() and coach.is_visible():
            coach.click()
        teams[tid] = page
    host.wait_for_function("n => Object.values(KCP.league.state().S.teams).filter(T => T.token).length === n",
                           arg=len(ids), timeout=WAIT)
    return host, host_session, teams, sessions


def sync_all(host, teams, round_number, phase):
    # rAF 폴링 대신 100ms 간격: 측정 창 동안 7개 페이지에 더하는 부하를 줄인다.
    host.wait_for_function(econui.SYNC_JS, arg=[round_number, phase], timeout=WAIT, polling=100)
    for page in teams.values():
        page.wait_for_function(econui.SYNC_JS, arg=[round_number, phase], timeout=WAIT, polling=100)


def plan_once(host, teams):
    """1월 계획 단계에서 e2e와 같은 자동 계획(calib·calib2)을 넣는다. 측정 표본 밖."""
    for tid, page in teams.items():
        page.evaluate(f"() => {{ {AUTO} }}")
        page.evaluate(f"() => {{ {STRAT} }}")
        done = page.evaluate("""t => KCP.league.plan(st => {
          const b = KCP.league.state().snap.teams[t].budget;
          const P = __plan(t, 'mix', Math.max(0, b - 45));
          st.builds = P.builds; st.lines = P.lines; st.missions = ['outage', 'co2'];
        })""", tid)
        if not done:
            raise RuntimeError(f"{tid} 계획 적용 실패")
    for tid in teams:
        host.wait_for_function(PLAN_REV_JS, arg=tid, timeout=WAIT)


def trial_week(page):
    """s8n.trial과 같은 화면 조작. 1월 S7 분해는 같은 달 시험 1주 기록이 있어야 시뮬레이션을 돈다
    (league.js matchingTrial·outageAttribution). 학생 흐름처럼 매달 계획 단계에서 한 번 돌린다."""
    close = page.locator("#lg-panel:not([hidden]) [data-pclose]")
    if close.count():
        close.first.click(timeout=WAIT)
    page.locator('[data-run="7"]').click(timeout=WAIT)
    finish_trial(page, timeout=WAIT)
    page.locator("#bd-drawer-x").click(timeout=WAIT)


def prepare_promise(page):
    """live.py ready_action에서 마지막 확인 클릭만 뺀 화면 조작. 확인은 6팀을 잇달아 누른다."""
    page.click("#lg-ready", timeout=WAIT)
    pass_issue_check(page)
    page.wait_for_selector("#lg-ready-confirm", timeout=WAIT)
    page.locator("[data-evidence]:not([disabled])").first.click(timeout=WAIT)
    page.locator("[data-pred]").first.select_option("down", timeout=WAIT)
    page.locator('[data-confidence="fairly"]').click(timeout=WAIT)


def drain(page):
    return page.evaluate(DRAIN_JS) or {"events": [], "long": [], "lag": [], "hooks": {}, "errors": [],
                                      "visibility": [], "state": None}


def first(events, kind, after=0, **match):
    for e in events:
        if e["kind"] == kind and e.get("start", e["at"]) >= after and all(e.get(k) == v for k, v in match.items()):
            return e
    return None


def ready_round(report, cond, month, host, teams, variant="기본"):
    """R3: 계획 snap 도착 직후 약속하고 준비 → 진행자 반영 → 팀 snap의 me.ready.
    variant '겹침'은 overlap_round가 부른다(직전 달 결과 snap을 팀이 처리했는지도 남긴다)."""
    prepared = []
    for tid, page in teams.items():
        try:
            trial_week(page)
            prepare_promise(page)
            prepared.append(tid)
        except Exception as exc:
            failure(report, f"{cond['label']} {month}월 {tid} 시험·약속 조작", exc)
    # 확인은 준비가 끝난 팀을 잇달아(거의 동시에) 누른다. 계획 snap 도착→확인 간격은 행마다 남긴다.
    for tid in prepared:
        try:
            teams[tid].locator("#lg-ready-confirm").click(timeout=WAIT)
        except Exception as exc:
            failure(report, f"{cond['label']} {month}월 {tid} 약속하고 준비 클릭", exc)
    # 진행자 반영과 팀 화면 반영 모두 마지막 클릭부터 READY_WAIT까지 기다린다(늦게 닿은 것을 초과로 세지 않음).
    deadline = time.monotonic() + READY_WAIT / 1000
    all_ready = True
    try:
        host.wait_for_function(ALL_READY_JS, timeout=READY_WAIT, polling=100)
    except Exception:
        all_ready = False
    for tid, page in teams.items():
        try:
            page.wait_for_function("() => { const s = KCP.league.state(); return !!s.snap.teams[s.team].ready; }",
                                   timeout=max(500, (deadline - time.monotonic()) * 1000), polling=100)
        except Exception:
            pass
    host_log = drain(host)
    cond["host_events"].extend(host_log["events"])
    rows = []
    for tid, page in teams.items():
        log = drain(page)
        click = first(log["events"], "click", id="lg-ready-confirm")
        at = click["at"] if click else None
        applied = first(host_log["events"], "host-recv", after=at or 0, team=tid, type="ready", ok=True) if at else None
        reflected = next((e for e in log["events"] if e["kind"] == "team-snap" and at and
                          e["start"] >= at and e["ready"] and e["phase"] == "plan"), None)
        plan_snap = next((e for e in log["events"] if e["kind"] == "team-snap" and e["phase"] == "plan"
                          and e["round"] == month), None)
        nacks = [{"type": e["type"], "err": e["err"]} for e in log["events"] if e["kind"] == "team-nack"]
        saw_review = any(e["kind"] == "team-snap" and e["phase"] == "review" and e["round"] == month - 1
                         for e in log["events"])
        rows.append({"month": month, "team": tid, "variant": variant, "clicked": bool(click),
                     "saw_previous_review": saw_review if variant == "겹침" else None,
                     "click_to_host_ms": applied["at"] - at if applied else None,
                     "click_to_team_ms": reflected["at"] - at if reflected else None,
                     "plan_snap_to_click_ms": at - plan_snap["at"] if plan_snap and at else None,
                     "host_miss": bool(at) and not applied, "team_miss": bool(at) and not reflected,
                     "timeout": not (applied and reflected), "nacks": nacks,
                     "rejected": sum(e["kind"] == "team-rejected" for e in log["events"]),
                     "sign_ms": [e["ms"] for e in log["events"] if e["kind"] == "signEnvelope"]})
        cond["team_lag"].extend(log["lag"])
    recv = [e for e in host_log["events"] if e["kind"] == "host-recv"]
    cond["r3"].extend(rows)
    cond["host_recv"].extend({"month": month, "type": e["type"], "ok": e["ok"], "err": e["err"],
                              "quiet": e["quiet"]} for e in recv)
    cond["reply_drop"].extend(e for e in host_log["events"] if e["kind"] == "reply-drop")
    return all_ready


def overlap_round(report, cond, month, host, teams):
    """총괄 추가 조건(10-23): 결과 단계에서 진행자가 곧바로 다음 달을 연다. 팀이 결과 snap의 S7 계산을
    하는 동안 다음 계획 snap이 겹쳐 온다(hostReceiver는 기다리는 snap 중 최신 하나만 처리하므로 결과 snap을
    건너뛸 수도 있다 — saw_previous_review로 남긴다). R1·R2 창은 재지 않는다."""
    for page in [host, *teams.values()]:
        drain(page)
    host.locator("#lg-next").click(timeout=WAIT)  # 운영
    host.wait_for_function(econui.SYNC_JS, arg=[month, "review"], timeout=WAIT)
    host.locator("#lg-next").click(timeout=WAIT)  # 팀 수신을 기다리지 않고 다음 달 계획
    sync_all(host, teams, month + 1, "plan")
    ready_round(report, cond, month + 1, host, teams, variant="겹침")


def run_round(report, cond, month, host, host_session, teams, sessions, profile_team):
    """R1·R2: 운영 클릭 → 진행자 결과 → 팀 결과 수신, 클릭부터 10초를 관찰한다."""
    for page in [host, *teams.values()]:
        drain(page)  # 준비 단계 기록을 비운다.
    profile_start(host_session)
    profile_start(sessions[profile_team])
    started = time.monotonic()
    host.locator("#lg-next").click(timeout=WAIT)
    sync_all(host, teams, month, "review")
    remain = WINDOWS[-1] + 1.0 - (time.monotonic() - started)  # 창 끝 무렵 기록이 쌓일 1초 여유
    if remain > 0:
        time.sleep(remain)
    host_profile, host_profile_s = profile_stop(host_session)
    team_profile, team_profile_s = profile_stop(sessions[profile_team])
    host_log = drain(host)
    click = first(host_log["events"], "click", id="lg-next")
    if not click:
        raise RuntimeError("진행자 운영 클릭 기록 없음")
    t0 = click["at"]
    run = first(host_log["events"], "run", after=t0)
    run_end = run["start"] + run["ms"] if run else None
    snap_sign = first(host_log["events"], "signHost", after=run_end or t0, event="snap", phase="review")
    saves = [e for e in host_log["events"] if e["kind"] == "save" and e["start"] >= t0]
    publics = [e["ms"] for e in host_log["events"] if e["kind"] == "publicView" and e["start"] >= t0]
    row = {"month": month, "run_ms": run["ms"] if run else None,
           "run_start_after_click_ms": run["start"] - t0 if run else None,
           "first_snap_sign_ms": snap_sign["ms"] if snap_sign else None,
           "first_snap_sign_end_after_click_ms": snap_sign["start"] + snap_sign["ms"] - t0 if snap_sign else None,
           "publicView_ms": stats(publics), "saves": len(saves),
           "save_ms_max": max((e["ms"] for e in saves), default=None),
           "save_chars_max": max((e["chars"] for e in saves), default=None),
           "profile_ms": host_profile, "profile_seconds": host_profile_s, "visibility": host_log["state"]}
    for seconds in WINDOWS:
        row[f"lag_{seconds}s"] = window(host_log["lag"], t0, seconds)
        row[f"long_{seconds}s"] = window(host_log["long"], t0, seconds)
    receipts = []
    for tid, page in teams.items():
        log = drain(page)
        got = next((e for e in log["events"] if e["kind"] == "team-snap" and e["start"] >= t0 and
                    e["phase"] == "review" and e["round"] == month), None)
        arrived = [e for e in log["events"] if e["kind"] == "team-arrive" and e["event"] == "snap"
                   and e["start"] >= t0]
        handled = [e for e in arrived if e["handled"] and got and e["start"] <= got["start"]]
        r2 = {"month": month, "team": tid, "visibility": log["state"], "profiled": tid == profile_team,
              "apply_start_after_click_ms": got["start"] - t0 if got else None,
              "chain_wait_ms": got["start"] - handled[-1]["start"] if handled else None,
              "snaps_arrived": len(arrived), "snaps_skipped": sum(e["handled"] is False for e in arrived),
              "apply_ms": got["ms"] if got else None}
        if got:
            r2["lag_3s"] = window(log["lag"], got["start"], 3)
            r2["long_3s"] = window(log["long"], got["start"], 3)
            receipts.append(got["start"] - t0)
        if tid == profile_team:
            r2["profile_ms"] = team_profile
            r2["profile_seconds"] = team_profile_s
            try:
                r2["viewkey"] = page.evaluate(VIEWKEY_JS)
            except Exception as exc:
                failure(report, f"{cond['label']} {month}월 viewKey 측정", exc)
        cond["r2"].append(r2)
        cond["team_lag"].extend(log["lag"])
    row["team_recv_after_click_ms"] = stats(receipts)
    cond["r1"].append(row)
    cond["host_events"].extend(host_log["events"])
    cond["hooks"]["진행자"] = host_log["hooks"]
    cond["hooks"]["팀"] = log["hooks"]
    cond["hooks"]["errors"] = host_log["errors"] + log["errors"]


def condition(report, browser, base, rate, mode, months):
    label = f"{rate:g}배 {MODES[mode]}"
    cond = {"label": label, "rate": rate, "mode": mode, "load_start_1m": os.getloadavg()[0],
            "r1": [], "r2": [], "r3": [], "host_recv": [], "reply_drop": [], "team_lag": [],
            "host_events": [], "hooks": {}, "diagnostics": {}}
    report["conditions"].append(cond)
    print(f"\n== {label} 시작 (1분 부하 {cond['load_start_1m']:.1f})", flush=True)
    context, external = econui.context_for(browser, base, 1280, 900, "light")
    context.set_default_timeout(WAIT)
    context.add_init_script(INIT_JS)
    pages = []
    try:
        rate_host = rate if mode in ("host", "both") else 1
        rate_team = rate if mode in ("teams", "both") else 1
        host, host_session, teams, sessions = setup(context, base, rate_host, rate_team, pages)
        profile_team = next(iter(teams))
        host.locator("#lg-next").click(timeout=WAIT)  # 로비 → 1월 계획(표본 밖)
        sync_all(host, teams, 1, "plan")
        plan_once(host, teams)
        for page in [host, *teams.values()]:
            drain(page)
        for month in range(1, months + 1):
            ready_round(report, cond, month, host, teams)
            run_round(report, cond, month, host, host_session, teams, sessions, profile_team)
            host.locator("#lg-next").click(timeout=WAIT)  # 다음 달 계획 열기
            sync_all(host, teams, month + 1, "plan")
        # 겹침 조건: months+1월은 평소처럼 준비하고, 운영 직후 바로 months+2월을 연다.
        ready_round(report, cond, months + 1, host, teams)
        overlap_round(report, cond, months + 1, host, teams)
    except Exception as exc:
        failure(report, label, exc)
    finally:
        for role, keys in REQUIRED_HOOKS.items():
            missing = [k for k in keys if not cond["hooks"].get(role, {}).get(k)]
            if missing:
                failure(report, f"{label} {role} 후킹 누락", RuntimeError(", ".join(missing)))
        for key in ("r1", "r2", "r3"):
            if not cond[key]:
                failure(report, f"{label} {key.upper()} 표본 없음", RuntimeError("측정 결과가 비었다"))
        for _, events, role in pages:
            cond["diagnostics"][role] = {k: len(v) for k, v in events.items()}
            for detail in events["pageerror"]:
                failure(report, f"{label} {role} 페이지 예외", RuntimeError(detail))
        if external:
            failure(report, f"{label} 외부 연결 차단", RuntimeError(str(external)))
        context.close()
    cond["load_end_1m"] = os.getloadavg()[0]
    cond["judgment_valid"] = max(cond["load_start_1m"], cond["load_end_1m"]) < LOAD_LIMIT
    del cond["host_events"]  # 원 기록은 크다. 요약에 필요한 것만 남겼다.
    cond["team_lag_count"] = len(cond.pop("team_lag"))


def summarize(cond):
    r1 = cond["r1"]
    # 1ms 프로파일을 건 팀은 계측 부하가 있어 R2·R3 통계에서 뺀다(행에는 남긴다).
    profiled = {r["team"] for r in cond["r2"] if r.get("profiled")}
    r2 = [r for r in cond["r2"] if not r.get("profiled")]
    r3 = [r for r in cond["r3"] if r["variant"] == "기본" and r["team"] not in profiled]
    r3o = [r for r in cond["r3"] if r["variant"] == "겹침" and r["team"] not in profiled]
    profiles = defaultdict(list)
    for row in r1:
        for k, v in (row.get("profile_ms") or {}).items():
            profiles["진행자 " + k].append(v)
    for row in r2:
        for k, v in (row.get("profile_ms") or {}).items():
            profiles["팀 " + k].append(v)
    errs = defaultdict(int)
    for e in cond["host_recv"]:
        if not e["ok"]:
            errs[f"{e['type']}:{e['err']}"] += 1
    nacks = defaultdict(int)
    for row in r3:
        for n in row["nacks"]:
            nacks[f"{n['type']}:{n['err']}"] += 1
    return {
        "R1 run_ms": stats([r["run_ms"] for r in r1]),
        "R1 첫 snap 서명 끝(클릭 뒤 ms)": stats([r["first_snap_sign_end_after_click_ms"] for r in r1]),
        "R1 진행자 지연 최장 3초": stats([r["lag_3s"]["max_ms"] for r in r1]),
        "R1 진행자 지연 합 10초": stats([r["lag_10s"]["sum_ms"] for r in r1]),
        "R1 진행자 longtask 최장 10초": stats([r["long_10s"]["max_ms"] for r in r1]),
        "R1 팀 결과 처리 시작(클릭 뒤 최장 ms)": stats([(r["team_recv_after_click_ms"] or {}).get("max") for r in r1]),
        "R2 결과 snap 사슬 대기 ms": stats([r["chain_wait_ms"] for r in r2]),
        "R2 건너뛴 snap": sum(r["snaps_skipped"] for r in r2),
        "R2 결과 snap 처리 ms": stats([r["apply_ms"] for r in r2]),
        "R2 팀 지연 최장 3초": stats([r.get("lag_3s", {}).get("max_ms") for r in r2]),
        "R2 팀 longtask 최장 3초": stats([r.get("long_3s", {}).get("max_ms") for r in r2]),
        "R2 viewKey 문자열화 ms": stats([(r.get("viewkey") or {}).get("median_ms") for r in r2]),
        "R3 클릭→진행자 반영 ms": stats([r["click_to_host_ms"] for r in r3]),
        "R3 클릭→팀 화면 반영 ms": stats([r["click_to_team_ms"] for r in r3]),
        "R3 시간 초과": sum(r["timeout"] for r in r3),
        "R3 진행자 미도달": sum(r["host_miss"] for r in r3),
        "R3 팀 화면 미반영": sum(r["team_miss"] for r in r3),
        "R3 계획 snap→확인 클릭 ms": stats([r["plan_snap_to_click_ms"] for r in r3 + r3o]),
        "R3 표본": len(r3),
        "R3 겹침 클릭→진행자 반영 ms": stats([r["click_to_host_ms"] for r in r3o]),
        "R3 겹침 클릭→팀 화면 반영 ms": stats([r["click_to_team_ms"] for r in r3o]),
        "R3 겹침 시간 초과": sum(r["timeout"] for r in r3o),
        "R3 겹침 표본": len(r3o),
        "R3 겹침 결과 snap 건너뜀": sum(r["saw_previous_review"] is False for r in r3o),
        "진행자 수신 거절": dict(errs), "답 누락(replyGate)": len(cond["reply_drop"]),
        "팀 nack": dict(nacks),
        "프로파일 포함 ms(중앙)": {k: statistics.median(v) for k, v in sorted(
            profiles.items(), key=lambda kv: -statistics.median(kv[1]))},
    }


def fmt(s, digits=0):
    if not s:
        return "—"
    return f"{s['min']:.{digits}f} / {s['median']:.{digits}f} / {s['max']:.{digits}f} ({s['n']})"


def output(report):
    print("\n# U5 1단계 측정 결과(최소 / 중앙 / 최대 (표본 수), ms)")
    print("측정만 한다. 긴 작업 = 50ms 타이머 지연 ≥ 200ms(지연) 또는 longtask 관찰값.")
    keys = ["R1 run_ms", "R1 첫 snap 서명 끝(클릭 뒤 ms)", "R1 진행자 지연 최장 3초", "R1 진행자 지연 합 10초",
            "R1 진행자 longtask 최장 10초", "R1 팀 결과 처리 시작(클릭 뒤 최장 ms)", "R2 결과 snap 처리 ms",
            "R2 결과 snap 사슬 대기 ms",
            "R2 팀 지연 최장 3초", "R2 팀 longtask 최장 3초", "R2 viewKey 문자열화 ms",
            "R3 클릭→진행자 반영 ms", "R3 클릭→팀 화면 반영 ms", "R3 계획 snap→확인 클릭 ms",
            "R3 겹침 클릭→진행자 반영 ms", "R3 겹침 클릭→팀 화면 반영 ms"]
    conds = report["conditions"]
    print("\n| 지표 | " + " | ".join(c["label"] + ("" if c["judgment_valid"] else " (판정 무효: 부하)")
                                    for c in conds) + " |")
    print("|---|" + "---|" * len(conds))
    for key in keys:
        print(f"| {key} | " + " | ".join(fmt(c["summary"][key]) for c in conds) + " |")
    print("| R3 시간 초과 / 표본 (진행자 미도달·팀 미반영) | " + " | ".join(
        f"{c['summary']['R3 시간 초과']} / {c['summary']['R3 표본']} "
        f"({c['summary']['R3 진행자 미도달']}·{c['summary']['R3 팀 화면 미반영']})" for c in conds) + " |")
    print("| R2 건너뛴 snap | " + " | ".join(str(c["summary"]["R2 건너뛴 snap"]) for c in conds) + " |")
    print("| R3 겹침 시간 초과 / 표본 (결과 snap 건너뜀) | " + " | ".join(
        f"{c['summary']['R3 겹침 시간 초과']} / {c['summary']['R3 겹침 표본']} "
        f"({c['summary']['R3 겹침 결과 snap 건너뜀']})" for c in conds) + " |")
    for c in conds:
        s = c["summary"]
        print(f"\n## {c['label']} — 1분 부하 {c['load_start_1m']:.1f} → {c['load_end_1m']:.1f}")
        print("진행자 수신 거절: " + json.dumps(s["진행자 수신 거절"], ensure_ascii=False) +
              f" · 답 누락 {s['답 누락(replyGate)']} · 팀 nack: " + json.dumps(s["팀 nack"], ensure_ascii=False))
        secs = [r.get("profile_seconds") for r in c["r1"] if r.get("profile_seconds")]
        print("프로파일 포함 시간 상위(중앙 ms, 1ms 표본 · 진행자는 운영 클릭부터 결과 동기화 뒤 11초까지 "
              f"(실제 구간 {min(secs, default=0):.1f}~{max(secs, default=0):.1f}초), 팀은 프로파일 건 한 팀):")
        for name, ms in list(s["프로파일 포함 ms(중앙)"].items())[:14]:
            print(f"  - {name}: {ms:.0f}")
        print("후킹: " + json.dumps(c["hooks"], ensure_ascii=False))
        print("진단: " + json.dumps(c["diagnostics"], ensure_ascii=False))
    for item in report["failures"]:
        print(f"측정 실패: {item['label']} ({item['type']}: {item['detail']})")
    print(f"{'결과' if report['result_saved'] else '결과 저장 실패'}: {RESULT}")
    print(f"problems: {report['problems']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="U5 운영 직후 응답·준비 왕복 측정(실행은 총괄 로컬)")
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:9430/index.html", help="loopback 주소")
    parser.add_argument("--rates", default="4,6", help="CPU 감속 배수 목록(쉼표, 1 이상)")
    parser.add_argument("--modes", default="host,teams,both", help="감속 대상(host·teams·both)")
    parser.add_argument("--months", type=int, default=3, help="잴 달 수(2 이상이면 지난달 대비 경로 포함)")
    args = parser.parse_args()
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "conditions": [], "failures": [],
              "fixture": {"teams": 6, "turns": 12, "connection": "local", "same_context": True,
                          "seed": "fixed", "viewport": "1280x900"}}
    try:
        rates = [float(x) for x in args.rates.split(",") if x.strip()]
        modes = [m.strip() for m in args.modes.split(",") if m.strip()]
        if not rates or any(not math.isfinite(r) or r < 1 for r in rates):
            raise ValueError("--rates는 1 이상의 유한한 수 목록이어야 합니다")
        if not modes or any(m not in MODES for m in modes):
            raise ValueError("--modes는 host·teams·both 중에서 고릅니다")
        if not 1 <= args.months <= 10:
            raise ValueError("--months는 1~10(겹침 조건이 두 달을 더 쓴다, 12달 방)")
        base = econui.local_address([sys.argv[0], args.url])
        # league_flow의 expect 대기(기본 5초)가 6배 감속에서 측정 실패로 바뀌지 않게 대기 상한만 늘린다.
        expect.set_options(timeout=WAIT)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for rate in rates:
                    for mode in modes:
                        condition(report, browser, base, rate, mode, args.months)
            finally:
                browser.close()
    except Exception as exc:
        failure(report, "측정 실행", exc)
    for cond in report["conditions"]:
        cond["summary"] = summarize(cond)
    report["problems"] = len(report["failures"])
    report["result_saved"] = True
    try:
        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    except Exception as exc:
        report["result_saved"] = False
        failure(report, "결과 저장", exc)
        report["problems"] += 1
    output(report)
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
