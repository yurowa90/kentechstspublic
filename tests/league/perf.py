"""저사양 응답 측정(앱 파일 수정 없음). 브라우저 실행은 총괄의 로컬 환경에서 한다.

실행: tests/.venv/bin/python tests/league/perf.py http://127.0.0.1:9430/index.html
선택: --rate 4 --budget. 서버는 python3 tests/srv.py 9430 . 을 사용한다.
기본은 측정만 하며 측정 실패·예외만 problems에 센다. --budget이면 확정 예산(2026-10-20)으로 판정한다.
4배 감속은 교실 태블릿의 대리값이다. 실제 태블릿 측정은 시범 수업 때 따로 한다.
"""

import argparse
import json
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import econui
from league_flow import wait_unfolded
from playwright.sync_api import sync_playwright

RESULT = Path(__file__).resolve().parents[1] / "results" / "perf.json"
METRICS = ("TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration")
WAIT = 60000  # 측정 실패를 가리는 예산이 아니라 감속 실행의 대기 상한이다.
REPEATS = 3
LOAD_LIMIT = 150
# 2026-10-13 CPU 4배: 달 넘김 0.23~1.28초, 결과 서랍 2.1~2.8초,
# 새로고침 3.3~8.1초. 교실 기준은 측정 뒤 총괄이 정한다(--budget 때만 사용).
# M3는 총괄 확정(2026-10-20): 새로고침→첫 도시 화면 중앙 ≤ 1초(4배 감속). 이른 claim 수정 뒤 실측 0.51~0.65초.
# M1·M2·긴 작업도 총괄 확정(2026-10-20): 달 넘김 ≤ 1.0초, 서랍 ≤ 1.5초(중앙), 표본마다 200ms 넘는
# 주 스레드 작업 0개. 확정 직전 실측: 달 넘김 0.17~0.42초, 서랍 0.51~0.64초, 긴 작업 0개(최장 124ms).
BUDGETS = {"M1": 1.0, "M2": 1.5, "M3": 1.0}
LONG_BUDGET = 0
LABELS = {"M1-plan-review": "M1 계획→결과", "M1-review-plan": "M1 결과→계획",
          "M2-result": "M2 결과 서랍", "M2-city": "M2 도시 서랍",
          "M2-deal": "M2 거래 서랍", "M3": "M3 새로고침→첫 화면"}
STAGES = {"verify": "수신 서명 검증", "snapshot": "스냅숏 풀기",
          "selectPack": "지도 선택", "map": "지도 mount·refresh"}
FILES = ("ui/league.js", "ui/league-net.js", "ui/build.js", "ui/league-core.js",
         "ui/econ.js", "기타")

# 측정 전용 초기 스크립트. 모듈 할당을 즉시 잡아 폴링 전에 실행된 함수를 놓치지 않는다.
# build.js의 공개 mount·refresh만 감싼다. 내부 selectPack·layout·draw 등의 직접 호출은
# 공개 함수의 포함 시간 또는 프로파일에만 잡힌다. 지연된 비공개 그리기는 '기타'다.
INIT_JS = r"""(() => {
  const p = window.__leaguePerf = {spans: [], hooks: {}, errors: [], serial: 0};
  const watched = new WeakMap();
  const wrap = (object, key, transform, label) => {
    let keys = watched.get(object);
    if (!keys) watched.set(object, keys = new Set());
    if (keys.has(key)) return;
    keys.add(key);
    let value;
    const adapt = original => {
      if (typeof original !== 'function') return original;
      p.hooks[label] = true;
      return transform(original);
    };
    try {
      value = adapt(object[key]);
      Object.defineProperty(object, key, {configurable: true, enumerable: true,
        get: () => value, set: next => { value = adapt(next); }});
    } catch (e) { p.hooks[label] = false; p.errors.push(`${label}: ${e.name}`); }
  };
  const begin = (stage, fn) => {
    const span = {stage, fn, id: ++p.serial, start_ms: performance.now()};
    span.mark = `리그성능:${stage}:${span.id}`;
    performance.mark(span.mark + ':시작', {startTime: span.start_ms});
    p.spans.push(span);
    return span;
  };
  const end = span => {
    span.end_ms = performance.now();
    performance.mark(span.mark + ':끝', {startTime: span.end_ms});
    performance.measure(span.mark, span.mark + ':시작', span.mark + ':끝');
  };
  const sync = (stage, fn) => original => function (...args) {
    const span = begin(stage, fn);
    try { return Reflect.apply(original, this, args); }
    finally { end(span); }
  };
  let receiving = 0;
  try {
    wrap(crypto.subtle, 'verify', original => function (...args) {
      // hostReceiver의 반환 수신 함수가 처리 중일 때만 수신 서명 검증으로 분류한다.
      // 이 시간은 네이티브 암호 연산을 기다리는 시간도 포함하며 CPU 시간이 아니다.
      if (!receiving) return Reflect.apply(original, this, args);
      const span = begin('verify', 'crypto.subtle.verify');
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (e) { end(span); throw e; }
      return Promise.resolve(result).finally(() => end(span));
    }, 'crypto.subtle.verify');
  } catch (e) { p.errors.push(`crypto.subtle.verify: ${e.name}`); }
  const attach = kcp => {
    if (!kcp || typeof kcp !== 'object') return kcp;
    const module = (key, install) => {
      let current = kcp[key];
      try {
        if (current) install(current);
        Object.defineProperty(kcp, key, {configurable: true, enumerable: true,
          get: () => current, set: next => { current = next; if (next) install(next); }});
      } catch (e) { p.errors.push(`KCP.${key}: ${e.name}`); }
    };
    module('leagueNet', net => {
      wrap(net, 'expandSnapshot', sync('snapshot', 'expandSnapshot'), 'expandSnapshot');
      wrap(net, 'hostReceiver', original => function (...args) {
        const receive = Reflect.apply(original, this, args);
        return function (...incoming) {
          receiving++;
          let result;
          try { result = Reflect.apply(receive, this, incoming); }
          catch (e) { receiving--; throw e; }
          return Promise.resolve(result).finally(() => { receiving--; });
        };
      }, 'hostReceiver');
    });
    module('buildGame', build => {
      for (const [key, stage] of [['selectPack', 'selectPack'], ['mount', 'map'],
                                   ['refresh', 'map']]) {
        wrap(build, key, sync(stage, key), `buildGame.${key}`);
      }
    });
    return kcp;
  };
  let kcp = attach(window.KCP);
  Object.defineProperty(window, 'KCP', {configurable: true, enumerable: true,
    get: () => kcp, set: next => { if (next !== kcp) kcp = attach(next); }});
})();"""

# econui.open_panel과 동일한 제목·본문 조건. 그 도우미는 결과 상세를 추가로 펼치므로
# M2에서는 버튼·완료 조건만 재사용하고 상세 펼치기는 측정하지 않는다.
PANEL_READY_JS = """([name, title]) => {
  const panel = document.querySelector('#lg-panel');
  const heading = panel?.querySelector('.lg-ptabs strong');
  const body = panel?.querySelector('.lg-pbody');
  return panel?.dataset.tab === name && heading?.textContent === title &&
    body?.checkVisibility({visibilityProperty:true}) && !!body.textContent.trim();
}"""
LONG_TASK_MS = 200
# 이 브라우저에서 longtask 관찰은 값을 받지 못해 Chromium 추적의 렌더러 주 스레드 RunTask 길이로 센다.
# 감속은 스레드를 멈추는 방식이라 RunTask 길이는 감속이 반영된 경과 시간이다.
TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline"]
TRACER = {"browser": None}
FRAMES_JS = "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"


def metrics(session):
    values = {m["name"]: m["value"] for m in session.send("Performance.getMetrics")["metrics"]}
    missing = set(METRICS) - values.keys()
    if missing:
        raise RuntimeError(f"CDP 작업 지표 누락: {sorted(missing)}")
    return {key: values[key] for key in METRICS}


def long_tasks(raw):
    data = json.loads(raw)
    events = data["traceEvents"] if isinstance(data, dict) else data
    names = {(e["pid"], e["tid"]): e["args"]["name"] for e in events
             if e.get("name") == "thread_name" and e.get("ph") == "M"}
    tasks = [e["dur"] / 1000 for e in events if e.get("name") == "RunTask" and e.get("ph") == "X"
             and names.get((e["pid"], e["tid"])) == "CrRendererMain"]
    if not tasks:
        raise RuntimeError("추적에 렌더러 주 스레드 RunTask가 없음")
    return {"long_tasks": sum(ms > LONG_TASK_MS for ms in tasks), "longest_task_ms": max(tasks),
            "main_tasks": len(tasks)}


def measure(sessions, action, **extra):
    browser = TRACER["browser"]
    if browser:
        browser.start_tracing(categories=TRACE_CATEGORIES)
    try:
        before = {role: metrics(session) for role, session in sessions.items()}
        start = time.perf_counter()
        action()
        elapsed = time.perf_counter() - start
        after = {role: metrics(session) for role, session in sessions.items()}
    finally:
        raw = browser.stop_tracing() if browser else None
    tasks = long_tasks(raw) if browser else {}
    delta, reset = {}, []
    for role in sessions:
        delta[role] = {}
        for key in METRICS:
            value = after[role][key] - before[role][key]
            if value < -1e-9:
                # 새로고침으로 새 문서·렌더러가 되면 CDP 누계가 0부터 다시 쌓인다. 그때는 새 문서의 누계가 곧
                # 구간 값이다(옛 문서의 내리기 비용은 빠진다 — 첫 화면까지의 새 문서 비용만 잰다).
                value = after[role][key]
                reset.append(f"{role}.{key}")
            delta[role][key] = max(0.0, value)
    return dict(seconds=elapsed, main_thread_seconds=delta, counters_reset=reset,
                counters_before=before, counters_after=after, **tasks, **extra)


def failure(report, label, exc):
    report["failures"].append({"label": label, "type": type(exc).__name__,
                               "detail": (str(exc).splitlines() or ["상세 없음"])[0][:300]})


def attempt(report, label, action):
    try:
        return action()
    except Exception as exc:
        failure(report, label, exc)
        return None


def settle(team):
    team.evaluate(FRAMES_JS)


def transition(host, team, round_number, phase):
    host.locator("#lg-next").click(timeout=WAIT)
    team.wait_for_function(econui.SYNC_JS, arg=[round_number, phase], timeout=WAIT)


def months(report, host, team, sessions):
    transition(host, team, 1, "plan")  # 로비→계획은 M1 표본에서 제외한다.
    for month in range(1, REPEATS + 1):
        for key, round_number, phase in (("M1-plan-review", month, "review"),
                                         ("M1-review-plan", month + 1, "plan")):
            settle(team)
            host.wait_for_function(econui.SYNC_JS, arg=[month, "plan" if phase == "review"
                                                       else "review"], timeout=WAIT)
            # 이전 상태에서 버튼을 누를 수 있는지 확인하는 준비는 표본 밖에서 한다.
            host.locator("#lg-next").click(trial=True, timeout=WAIT)
            row = measure(sessions, lambda: transition(host, team, round_number, phase),
                          round=round_number, phase=phase)
            report["samples"][key].append(row)


def close_panel(team):
    close = team.locator("#lg-panel:not([hidden]) [data-pclose]")
    if close.count():
        close.click(timeout=WAIT)
    team.wait_for_function("() => !document.querySelector('#lg-panel') || "
                           "document.querySelector('#lg-panel').hidden", timeout=WAIT)
    settle(team)


def panels(report, team, session):
    for name, title in (("result", "결과"), ("city", "도시"), ("deal", "사건·거래")):
        def sample():
            close_panel(team)
            wait_unfolded(team, timeout=WAIT)
            button = team.locator(f'#lg-bar [data-panel="{name}"]')
            button.click(trial=True, timeout=WAIT)

            def action():
                button.click(timeout=WAIT)
                team.wait_for_function(PANEL_READY_JS, arg=[name, title], timeout=WAIT)
                settle(team)  # 제목·본문 변경 뒤 두 프레임: econui.open_panel과 같은 기준.

            return measure({"팀": session}, action)

        for repeat in range(REPEATS):
            row = attempt(report, f"M2 {title} {repeat + 1}회", sample)
            if row is not None:
                report["samples"][f"M2-{name}"].append(row)


def profile_summary(profile):
    nodes = {node["id"]: node["callFrame"] for node in profile["nodes"]}
    samples, deltas = profile.get("samples", []), profile.get("timeDeltas", [])
    if not samples or len(samples) != len(deltas):
        raise RuntimeError("CDP 프로파일 표본·시간 차이가 없거나 길이가 다름")
    functions = defaultdict(float)
    files = dict.fromkeys(FILES, 0.0)
    for node_id, micros in zip(samples, deltas):
        frame = nodes[node_id]
        url = frame.get("url", "")
        line = frame.get("lineNumber", -1) + 1
        seconds = micros / 1_000_000
        functions[(frame.get("functionName") or "(익명)", url, line)] += seconds
        path = urlsplit(url).path
        group = next((name for name in FILES[:-1] if path.endswith("/" + name)), "기타")
        files[group] += seconds
    ranked = sorted(functions.items(), key=lambda item: item[1], reverse=True)
    duration = (profile["endTime"] - profile["startTime"]) / 1_000_000
    return {"sampling_interval_us": 100, "duration_seconds": duration,
            "sampled_seconds": sum(files.values()), "files_self_seconds": files,
            "top15": [dict(function=key[0], url=key[1], line=key[2], self_seconds=value)
                      for key, value in ranked[:15]], "raw": profile}


def breakdown(data, wall_seconds):
    """함수 포함 시간과 겹침을 뺀 경과 시간을 함께 보관한다(합계를 CPU로 해석하지 않는다)."""
    end = data["end_ms"]
    spans = [dict(span, start_ms=max(0, span["start_ms"]), end_ms=min(end, span.get("end_ms", end)),
                  unfinished="end_ms" not in span)
             for span in data["spans"] if span["start_ms"] < end and span.get("end_ms", end) > 0]
    cuts = sorted({point for span in spans for point in (span["start_ms"], span["end_ms"])})
    exclusive = dict.fromkeys(STAGES, 0.0)
    for left, right in zip(cuts, cuts[1:]):
        active = [span for span in spans if span["start_ms"] <= left and span["end_ms"] >= right]
        if active:
            # 중첩 함수는 가장 안쪽(짧은 구간)에 귀속해 이중 합산하지 않는다.
            inner = min(active, key=lambda span: span["end_ms"] - span["start_ms"])
            exclusive[inner["stage"]] += (right - left) / 1000
    rows = []
    for stage, label in STAGES.items():
        selected = [span for span in spans if span["stage"] == stage]
        rows.append(dict(stage=stage, label=label, calls=len(selected),
                         inclusive_seconds=sum(span["end_ms"] - span["start_ms"]
                                               for span in selected) / 1000,
                         exclusive_seconds=exclusive[stage]))
    covered = sum(exclusive.values())
    return {"wall_seconds": wall_seconds, "navigation_to_bar_seconds": end / 1000,
            "stages": rows, "other_seconds": max(0.0, wall_seconds - covered),
            "hooks": data["hooks"], "hook_errors": data["errors"], "spans": spans,
            "notes": ["구간 포함 시간은 중첩·비동기 대기를 포함한다. 겹침 제외 열만 합산한다.",
                      "기타에는 탐색·대기·비공개 그리기·후킹되지 않은 호출·측정 통신이 포함된다.",
                      "mount 내부의 비공개 selectPack 호출은 mount에 포함된다.",
                      "측정 끝까지 반환되지 않은 호출은 첫 화면 시점에서 잘라 계산한다.",
                      "서명은 수신 함수 처리 중 시작된 verify만 계측한다(동시 수신은 겹칠 수 있음)."]}


def reloads(report, team, session):
    close_panel(team)
    # 초기 스크립트는 다음 탐색부터 적용된다. M1·M2에는 함수 래퍼 부하를 넣지 않는다.
    team.add_init_script(INIT_JS)
    for repeat in range(REPEATS):
        profiled = repeat == 1

        def sample():
            started = False
            profile = None
            data = None
            if profiled:
                session.send("Profiler.enable")
                session.send("Profiler.setSamplingInterval", {"interval": 100})
            try:
                if profiled:
                    session.send("Profiler.start")
                    started = True

                def action():
                    nonlocal data
                    # load 이벤트 뒤의 자원 대기와 혼동하지 않도록 commit부터 #lg-bar를 기다린다.
                    team.reload(wait_until="commit", timeout=WAIT)
                    team.wait_for_selector("#lg-bar", state="visible", timeout=WAIT)
                    if profiled:
                        # Profiler.stop·getMetrics 뒤의 작업이 분해 구간에 섞이지 않게 여기서 닫는다.
                        data = team.evaluate("""() => ({...window.__leaguePerf, end_ms: performance.now()})""")

                row = measure({"팀": session}, action, profiled=profiled)
            finally:
                if started:
                    profile = session.send("Profiler.stop")["profile"]
                if profiled:
                    session.send("Profiler.disable")
            report["samples"]["M3"].append(row)
            if profiled:
                report["m3_profile"] = profile_summary(profile)
                report["m3_breakdown"] = breakdown(data, row["seconds"])

        attempt(report, f"M3 새로고침 {repeat + 1}회", sample)


def run(report, base, rate):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        TRACER["browser"] = browser
        context, external = econui.context_for(browser, base, 1280, 900, "light")
        pages, sessions = [], {}

        def attach(page):
            session = context.new_cdp_session(page)
            session.send("Emulation.setCPUThrottlingRate", {"rate": rate})
            session.send("Performance.enable", {"timeDomain": "timeTicks"})
            sessions[page] = session

        # setup_pair가 만드는 두 페이지 모두 첫 탐색 전에 감속한다.
        context.on("page", attach)
        try:
            host, team, _ = econui.setup_pair(context, base, 12, pages)
            if host not in sessions or team not in sessions:
                raise RuntimeError("진행자·팀 감속 세션 누락")
            report["fixture"] = {"turns": 12, "connection": "local", "same_context": True}
            coach = team.locator("#lg-coach-close")
            if coach.count() and coach.is_visible():
                coach.click(timeout=WAIT)
            attempt(report, "M1 달 넘김", lambda: months(
                report, host, team, {"진행자": sessions[host], "팀": sessions[team]}))
            attempt(report, "M2 서랍 측정 준비", lambda: panels(report, team, sessions[team]))
            attempt(report, "M3 새로고침 측정 준비", lambda: reloads(report, team, sessions[team]))
        finally:
            for _, events, role in pages:
                report["diagnostics"][role] = events
                for detail in events["pageerror"]:
                    failure(report, role + " 페이지 예외", RuntimeError(detail))
            if external:
                failure(report, "외부 연결 차단", RuntimeError(str(external)))
            TRACER["browser"] = None
            context.close()
            browser.close()


def summarize(report):
    for key, samples in report["samples"].items():
        if len(samples) != REPEATS:
            # 같은 예외를 다시 세지 않고, 불완전한 집계임을 표와 JSON에 남긴다.
            report["incomplete"].append(key)
        if not samples:
            continue
        values = [row["seconds"] for row in samples]
        roles = {role for row in samples for role in row["main_thread_seconds"]}
        summary = {"count": len(values), "min_seconds": min(values),
                   "median_seconds": statistics.median(values), "max_seconds": max(values),
                   "main_thread_median_seconds": {role: {metric: statistics.median(
                       row["main_thread_seconds"][role][metric] for row in samples)
                       for metric in METRICS} for role in sorted(roles)},
                   "long_tasks_max": max(row["long_tasks"] for row in samples),
                   "longest_task_ms_max": max(row["longest_task_ms"] for row in samples)}
        if report["budget_enabled"] and len(samples) == REPEATS:
            limit = BUDGETS[key[:2]]
            summary["budget"] = {"limit_seconds": limit, "exceeded": summary["median_seconds"] > limit,
                                 "long_task_limit": LONG_BUDGET,
                                 "long_tasks_exceeded": summary["long_tasks_max"] > LONG_BUDGET,
                                 "judgment_valid": report["judgment_valid"]}
        report["summary"][key] = summary
    report["budget_exceeded"] = sum(row.get("budget", {}).get("exceeded", False) +
                                     row.get("budget", {}).get("long_tasks_exceeded", False)
                                     for row in report["summary"].values())
    report["problems"] = len(report["failures"]) + report["budget_exceeded"]


def output(report):
    if not report["judgment_valid"]:
        print("판정 무효(부하)")
    print(f"CPU {report['rate']:g}배 감속 · 1280×900 · 같은 컨텍스트 진행자+팀 · 로컬 · 12달")
    start, end = report["load_start_1m"], report["load_end_1m"]
    print(f"1분 부하: 시작 {start:.2f} / 끝 {end:.2f} (무효 기준 ≥ {LOAD_LIMIT})")
    print("기본은 측정만. 예산: " + ("확정 예산 적용(4배 감속 = 교실 태블릿 대리값)" if report["budget_enabled"] else "적용 안 함"))
    print("클릭 표본은 실제 click 호출·동기화 대기를 포함한다. M2는 두 프레임 뒤까지 잰다.")
    print("M3는 세 표본 모두 함수 후킹, 2회차만 100µs 프로파일을 켜므로 계측 부하가 포함된다.")
    print(f"긴 작업: 표본 구간 안 렌더러 주 스레드 RunTask > {LONG_TASK_MS}ms 개수(추적 기준, 표본 중 최대).")
    print("\n| 지표 | 횟수 | 최소 초 | 중앙 초 | 최대 초 | 긴 작업 | 최장 ms | 예산 |")
    print("|---|---:|---:|---:|---:|---:|---:|---|")
    for key, label in LABELS.items():
        row = report["summary"].get(key)
        if not row:
            print(f"| {label} | 0/3 | — | — | — | — | — | 측정 없음 |")
            continue
        budget = row.get("budget")
        verdict = (f"{'초과' if budget['exceeded'] or budget['long_tasks_exceeded'] else '이내'}"
                   f"(≤ {budget['limit_seconds']:g}초, 긴 작업 ≤ {budget['long_task_limit']})"
                   if budget else "미적용" if not report["budget_enabled"] else "표본 부족")
        print(f"| {label} | {row['count']}/3 | {row['min_seconds']:.3f} | "
              f"{row['median_seconds']:.3f} | {row['max_seconds']:.3f} | {row['long_tasks_max']} | "
              f"{row['longest_task_ms_max']:.0f} | {verdict} |")
    print("\n메인 스레드: 구간별 CDP 누계 차이의 중앙값(초). Task에 Script·Layout·Style을 더하지 않는다.")
    print("같은 렌더러에서 중복 집계될 수 있어 진행자·팀 Task도 합산하지 않는다.")
    print("| 지표 | 페이지 | Task | Script | Layout | RecalcStyle |")
    print("|---|---|---:|---:|---:|---:|")
    for key, row in report["summary"].items():
        for role, values in row["main_thread_median_seconds"].items():
            print(f"| {LABELS[key]} | {role} | " + " | ".join(f"{values[m]:.4f}" for m in METRICS) + " |")
    detail = report.get("m3_breakdown")
    if detail:
        print("\nM3 2회차 분해: 경과 시간(초). 포함 시간은 겹칠 수 있으며 CPU 시간이 아니다.")
        print("| 구간 | 호출 | 포함 초 | 겹침 제외 초 |")
        print("|---|---:|---:|---:|")
        for row in detail["stages"]:
            print(f"| {row['label']} | {row['calls']} | {row['inclusive_seconds']:.4f} | "
                  f"{row['exclusive_seconds']:.4f} |")
        print(f"| 기타(감싸지 못한 구간·대기 포함) | — | — | {detail['other_seconds']:.4f} |")
        print(f"| 합계 | — | — | {detail['wall_seconds']:.4f} |")
        for note in detail["notes"]:
            print(note)
        print("후킹 상태: " + json.dumps(detail["hooks"], ensure_ascii=False))
        if detail["hook_errors"]:
            print("후킹 불가(기타에 포함): " + "; ".join(detail["hook_errors"]))
    profile = report.get("m3_profile")
    if profile:
        print("\nM3 CDP 표본 self time 상위 15개(통계적 추정, idle·내장 포함)")
        print("| 함수 | url:줄(1부터) | self 초 |")
        print("|---|---|---:|")
        for row in profile["top15"]:
            name = row["function"].replace("|", "\\|")
            url = (row["url"] or "(브라우저/내장)").replace("|", "\\|")
            print(f"| {name} | {url}:{row['line']} | {row['self_seconds']:.4f} |")
        print("\n| 파일별 self time | 초 |")
        print("|---|---:|")
        for name, seconds in profile["files_self_seconds"].items():
            print(f"| {name} | {seconds:.4f} |")
        print(f"| 표본 합계 | {profile['sampled_seconds']:.4f} |")
        print(f"프로파일 전체 {profile['duration_seconds']:.4f}초. 표본 합계는 CDP TaskDuration과 다르다.")
    for role, events in report["diagnostics"].items():
        print(f"{role} 진단: " + ", ".join(f"{kind} {len(items)}" for kind, items in events.items()))
    for item in report["failures"]:
        print(f"측정 실패: {item['label']} ({item['type']}: {item['detail']})")
    if report["incomplete"]:
        print("표본 부족: " + ", ".join(LABELS[key] for key in report["incomplete"]))
    print(f"{'결과' if report['result_saved'] else '결과 저장 실패'}: {RESULT}")
    print(f"problems: {report['problems']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="교실 태블릿 체감 응답 측정(실행은 총괄 담당)")
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:9430/index.html", help="loopback 주소")
    parser.add_argument("--rate", type=float, default=4, help="CPU 감속 배수(기본 4, 최소 1)")
    parser.add_argument("--budget", action="store_true", help="확정 중앙값·긴 작업 예산으로 초과 수를 셈")
    args = parser.parse_args()
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "rate": args.rate,
              "budget_enabled": args.budget, "load_start_1m": os.getloadavg()[0],
              "samples": {key: [] for key in LABELS}, "summary": {}, "failures": [],
              "diagnostics": {}, "incomplete": []}
    try:
        if not math.isfinite(args.rate) or args.rate < 1:
            raise ValueError("--rate는 1 이상의 유한한 수여야 합니다")
        base = econui.local_address([sys.argv[0], args.url])
        run(report, base, args.rate)
    except Exception as exc:
        failure(report, "측정 실행", exc)
    report["load_end_1m"] = os.getloadavg()[0]
    report["judgment_valid"] = max(report["load_start_1m"], report["load_end_1m"]) < LOAD_LIMIT
    summarize(report)
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
