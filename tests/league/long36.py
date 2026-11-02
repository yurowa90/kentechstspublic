"""혼자 하기 36달 장시간 검사(Chromium, 화면 버튼만 사용).

실행: tests/.venv/bin/python tests/league/long36.py <loopback 주소>
브라우저 실행은 샌드박스 밖 로컬 환경의 총괄 담당.
달별 기록은 tests/results/long36.json. 시간은 부하 기록이며 합격 기준이 아니다.
"""

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from econui import (OVERFLOW_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, overflow, shown)
from solo import KEY, STATE_READY_JS, click_next, read
from storage import start_solo

MONTHS = 36
WAIT = 120000  # 부하 규칙: 속도가 아니라 크기·누적 메모리를 판정한다.
CHECKPOINTS = (12, 24, 36)
# docs/QUALITY-stability.md §1-C: 같은 review 단계의 12·36달 GC 뒤 힙을 비교한다.
HEAP_RATIO = 2.0
# 분리 DOM 누수 감지: document 밖 노드도 포함하는 CDP Nodes를 2배로 제한한다.
NODE_RATIO = 2.0
# D-93(QA ST-C-06·07): 원문 '이벤트 수신기 수 일정'을 12·24·36달 GC 뒤 측정에서 이웃한 두 값의
# 증가가 2 이하인 것으로 읽는다(지연 초기화 여유 2). 예전 여유 '36달 ≤ 12달 + 20'은 달마다 1개씩 새는
# 누수를 놓쳐 바꿨다(#77). 2026-10-13 기준선 16달 측정에서 수신기는 151로 일정했다(§2-C).
LISTENER_STEP = 2
# 아래 값은 기준표에 없는 이 검사의 여유값이다. 같은 기준선에서 DOM 노드는 3,267→1,644였다(§2-C).
# document 요소 1.5배는 화면 재구성 차이를 허용하는 회귀 경계다.
ELEMENT_RATIO = 1.5
# docs/QUALITY-stability.md §1-C·§2-C: 약 520만 글자 저장 한도의 40%.
# UTF-8 바이트나 Python 문자 수 대신 JS 문자열.length로 저장 글자를 센다.
SAVE_LIMIT = 2080000
RESULT = Path(__file__).resolve().parents[1] / "results/long36.json"
METRICS = ("JSHeapUsedSize", "JSEventListeners", "Nodes")


def signature(state):
    return state["round"], state["phase"], len(state.get("results", []))


def document_sample(page):
    return page.evaluate("""key => {
      const raw = localStorage.getItem(key);
      return {document_elements: document.querySelectorAll('*').length,
              save_chars: raw === null ? null : raw.length};
    }""", KEY)


def gc_sample(cdp, page):
    cdp.send("HeapProfiler.collectGarbage")
    cdp.send("HeapProfiler.collectGarbage")
    metrics = {m["name"]: m["value"]
               for m in cdp.send("Performance.getMetrics")["metrics"]}
    # 지표 누락을 0으로 채워 누수를 통과시키지 않는다.
    missing = set(METRICS) - metrics.keys()
    if missing:
        raise AssertionError("CDP 지표 누락: " + ", ".join(sorted(missing)))
    return {**{name: metrics[name] for name in METRICS}, **document_sample(page)}


def write_result(report, checks):
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    report["problems"] = checks.failed
    report["passed"] = report["complete"] and checks.failed == 0
    # 중단해도 이미 측정한 달을 남긴다. 앱 저장과 달리 이 파일은 검사 결과다.
    temporary = RESULT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(RESULT)


def budget_checks(checks, checkpoints):
    first, last = checkpoints.get(12), checkpoints.get(36)
    checks.ok(set(checkpoints) == set(CHECKPOINTS), "12·24·36달 GC 뒤 CDP 측정 모두 수행")
    if first is None or last is None:
        checks.ok(False, "예산 비교에 필요한 12·36달 측정 없음")
        return
    checks.ok(first["JSHeapUsedSize"] > 0 and
              last["JSHeapUsedSize"] <= first["JSHeapUsedSize"] * HEAP_RATIO,
              f"36달 힙 ≤ 12달 × {HEAP_RATIO:g}: "
              f"{last['JSHeapUsedSize']:.0f} / {first['JSHeapUsedSize']:.0f}바이트")
    # D-93: 24달 − 12달 ≤ 2, 36달 − 24달 ≤ 2. 세 값은 long36.json의 listeners에도 남긴다.
    for before, after in zip(CHECKPOINTS, CHECKPOINTS[1:]):
        a, b = checkpoints.get(before), checkpoints.get(after)
        checks.ok(a is not None and b is not None and
                  b["JSEventListeners"] - a["JSEventListeners"] <= LISTENER_STEP,
                  f"{after}달 수신기 ≤ {before}달 + {LISTENER_STEP}: "
                  f"{'%.0f' % b['JSEventListeners'] if b else '측정 없음'} / "
                  f"{'%.0f' % a['JSEventListeners'] if a else '측정 없음'}개")
    checks.ok(first["Nodes"] > 0 and last["Nodes"] <= first["Nodes"] * NODE_RATIO,
              f"36달 review CDP Nodes ≤ 12달 review × {NODE_RATIO:g}: "
              f"{last['Nodes']:.0f} / {first['Nodes']:.0f}개")
    checks.ok(first["document_elements"] > 0 and
              last["document_elements"] <= first["document_elements"] * ELEMENT_RATIO,
              f"36달 document 요소 ≤ 12달 × {ELEMENT_RATIO:g}: "
              f"{last['document_elements']} / {first['document_elements']}개")


def reload_end(checks, page, report):
    page.wait_for_timeout(400)  # tests.md: 250ms 저장 지연 뒤 확인.
    before = read(page)
    checks.ok(before["live"] is not None and before["saved"] is not None and
              signature(before["live"]) == signature(before["saved"]) == (MONTHS, "end", MONTHS),
              "36달 끝 달·단계·결과 개수 저장")
    page.reload()
    page.wait_for_selector("#lg-bar")
    page.wait_for_function(STATE_READY_JS)
    page.wait_for_timeout(400)
    after = read(page)
    report["reload"] = {
        "before": list(signature(before["S"])),
        "after": list(signature(after["S"])) if after["S"] else None,
        "hash": after["hash"],
    }
    checks.ok(after["hash"] == "#league/solo" and after["live"] is not None and
              signature(after["live"]) == signature(before["live"]) and
              shown(page, "#lg-bar"), "새로고침 뒤 같은 36달·끝 단계·결과 36개 복구")
    overflow(checks, page, "36달 끝 새로고침")


def play(checks, context, page, events, base, report):
    cdp = context.new_cdp_session(page)
    cdp.send("Performance.enable")
    cdp.send("HeapProfiler.enable")
    checkpoints = {}
    recorded = set()
    previous_events = {kind: 0 for kind in events}
    try:
        page.goto(base + "#league")
        overflow(checks, page, "36달 설정 로비")
        start_solo(page, MONTHS)
        page.wait_for_function(STATE_READY_JS)
        observation = read(page)
        started = time.monotonic()
        # 보통 달마다 계획→결과→다음 달 두 번. 정체/추가 단계에 대비한 유한 한도다.
        for _ in range(150):
            state = observation["S"]
            label = f"{state['round']}달 {state['phase']}"
            overflow(checks, page, label)
            month = state["round"]
            # 최종 진행 클릭 전인 36달 review를 12달 review와 같은 단계에서 비교한다.
            completed = state["phase"] == "review"
            if completed and month not in recorded:
                ended = time.monotonic()
                counts = {kind: len(messages) for kind, messages in events.items()}
                delta = {kind: messages[previous_events[kind]:]
                         for kind, messages in events.items()}
                diagnostics(checks, delta, f"{month}달")
                sample = gc_sample(cdp, page) if month in CHECKPOINTS else document_sample(page)
                row = {"month": month, "round": state["round"], "phase": state["phase"],
                       "results": len(state.get("results", [])),
                       "seconds": round(ended - started, 3), **sample,
                       "horizontal_overflow": page.evaluate(OVERFLOW_JS),
                       "diagnostics": {kind: len(messages) for kind, messages in delta.items()}}
                report["rows"].append(row)
                recorded.add(month)
                previous_events = counts
                checks.ok(row["results"] == month, f"{month}달 운영 결과 {month}개")
                checks.ok(row["save_chars"] is not None and 0 < row["save_chars"] < SAVE_LIMIT,
                          f"{month}달 저장 글자 < {SAVE_LIMIT:,}: {row['save_chars']}")
                if month in CHECKPOINTS:
                    checkpoints[month] = sample
                    print(f"{month}달 GC 뒤: 힙 {sample['JSHeapUsedSize']:.0f}바이트, "
                          f"수신기 {sample['JSEventListeners']:.0f}, Nodes {sample['Nodes']:.0f}, "
                          f"document 요소 {sample['document_elements']}, "
                          f"저장 {sample['save_chars']}글자", flush=True)
                write_result(report, checks)
                started = time.monotonic()
            if state["phase"] == "end":
                # end는 화면이 달라지므로 기록만 하고 review 예산 비교에는 넣지 않는다.
                report["end"] = {"month": month, "phase": "end", **gc_sample(cdp, page)}
                write_result(report, checks)
                break
            observation = click_next(page, state)
        checks.ok(signature(observation["S"]) == (MONTHS, "end", MONTHS),
                  "화면 버튼으로 혼자 하기 36달 완주")
        checks.ok(recorded == set(range(1, MONTHS + 1)), "36달 달별 기록 모두 저장")
        # D-93(ST-C-06): 12·24·36달 GC 뒤 수신기 수를 결과 파일에 따로 남긴다(rows에도 있다).
        report["listeners"] = {str(m): checkpoints[m]["JSEventListeners"]
                               for m in CHECKPOINTS if m in checkpoints}
        budget_checks(checks, checkpoints)
        if signature(observation["S"]) == (MONTHS, "end", MONTHS):
            reload_end(checks, page, report)
        else:
            checks.ok(False, "36달 끝 새로고침 검증 미수행")
    finally:
        cdp.detach()


def main():
    expect.set_options(timeout=60000)
    checks = Checks()
    report = {"browser": "Chromium", "months": MONTHS,
              "budgets": {"heap_ratio": HEAP_RATIO, "node_ratio": NODE_RATIO,
                          "comparison_phase": "review", "listener_step": LISTENER_STEP,
                          "element_ratio": ELEMENT_RATIO, "save_chars_exclusive": SAVE_LIMIT},
              "rows": [], "end": None, "reload": None, "complete": False}
    try:
        base = local_address(sys.argv)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                context, external = context_for(browser, base, 1280, 900, "light")
                context.set_default_timeout(WAIT)
                context.set_default_navigation_timeout(WAIT)
                page, events = monitored_page(context)
                try:
                    play(checks, context, page, events, base, report)
                    report["complete"] = len(report["rows"]) == MONTHS and report["reload"] is not None
                except Exception as exc:
                    checks.ok(False, f"36달 검사 예외 {type(exc).__name__}")
                    report["exception"] = type(exc).__name__
                finally:
                    # 마지막 달 측정 이후·새로고침 중 발생한 오류도 빠뜨리지 않는다.
                    diagnostics(checks, events, "36달 전체·새로고침 포함")
                    checks.ok(not external, "외부 요청 0")
                    context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"36달 검사 실행 예외 {type(exc).__name__}")
        report["exception"] = type(exc).__name__
    try:
        write_result(report, checks)
    except Exception as exc:
        checks.ok(False, f"달별 결과 파일 기록 실패 {type(exc).__name__}")
    checks.finish()
    print(f"problems: {checks.failed}", flush=True)
    return int(bool(checks.failed))


if __name__ == "__main__":
    sys.exit(main())
