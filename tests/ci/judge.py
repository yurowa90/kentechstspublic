#!/usr/bin/env python3
"""실행 상태와 로그 전체를 읽어 알려진 실패와 새 실패를 구분한다."""

import argparse
import json
import os
from pathlib import Path
import re
import sys

STATES = ("done", "timeout", "crash", "skip", "missing", "unlisted")
RUNNER = "(실행기)"


class Parser(argparse.ArgumentParser):
    def format_usage(self):
        return super().format_usage().replace("usage:", "사용법:", 1)

    def format_help(self):
        return super().format_help().replace("usage:", "사용법:", 1)

    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "인자 오류: 필수 인자와 선택 값을 확인하세요\n")


def normalize(name):
    return name.replace("__", ":")


def read_text(path):
    return path.read_text(encoding="utf-8", errors="replace")


def first_json(lines):
    """stderr가 같은 로그에 섞이므로 첫 줄로 고정하지 않고 `cfg`가 든 첫 JSON 줄을 찾는다."""
    for raw in lines:
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and "cfg" in value:
            return value
    return None


# ux_task 장면 줄: ` S4  1.2s 행동  3 스크롤 1 조작  38 작은조작  0 글자  803 넘침 False 가림 []`
SCENE = re.compile(r"^(\S+)\s+[\d.]+s\s+행동\s+\d+\b.*\s넘침\s+(True|False)\b")


def failure_lines(kind, name, text):
    """실패 표지 한 줄을 한 항목으로 센다. 요약 숫자는 별도로 확인한다."""
    lines = text.splitlines()
    failures = []
    if lines and lines[0].startswith(("MISSING ", "UNLISTED ")):
        # 실행기가 검사 대신 남긴 표지. 상태가 done으로 적혀 있어도 실패로 센다.
        failures.append(lines[0].strip())
    if kind == "browser" and (name.startswith("ux_task:") or name == "ux_coach"):
        result = first_json(lines)
        if result is None:
            failures.append("JSON 결과 줄 없음 또는 형식 오류")
        else:
            reasons = []
            if name.startswith("ux_task:"):
                if result.get("completed") is not True:
                    reasons.append("실행 미완료(completed)")
                # ux_task는 콘솔 문제가 있어도 0으로 끝나므로 JSON의 console이 유일한 근거다.
                if "console" not in result:
                    reasons.append("콘솔 결과 없음(console 키, ux_task.py 판 확인)")
                elif result["console"]:
                    reasons.append(f"콘솔 error·warning·페이지 오류 {len(result['console'])}건")
            if result.get("error") is not None:
                reasons.append("실행 오류(error)")
            if reasons:
                failures.append("·".join(reasons) + ": " + json.dumps(
                    {k: result.get(k) for k in ("cfg", "completed", "error", "console") if k in result},
                    ensure_ascii=False))
        if name == "ux_coach":
            reports = [line.strip() for line in lines if line.strip().startswith("console:")]
            if not reports:
                failures.append("콘솔 결과 없음(console: 줄)")
            failures.extend(line for line in reports if line != "console: []")

    for index, raw in enumerate(lines):
        line = raw.strip()
        if kind == "browser":
            # PASS BLOCKED는 통과 줄이다. 줄머리 FAIL·BLOCKED만 실패로 본다.
            if re.match(r"^(?:FAIL|BLOCKED)\b", line) or line.startswith("막힘:"):
                failures.append(line)
            elif re.match(r"^errors \[.+\]$", line):
                # rules·econint는 페이지 오류를 `errors [...]` 한 줄로만 찍고 0으로 끝난다. `errors []`는 통과.
                failures.append(line)
            elif line.startswith("Traceback (most recent call last):"):
                detail = next((item.strip() for item in lines[index + 1:]
                               if item.strip() and not item[0].isspace()), "")
                failures.append(line + (" " + detail if detail else ""))
            elif name.startswith("ux_task:"):
                # 장면마다 찍는 문서 가로 넘침(scrollWidth > 화면 폭 + 1). 검사 자체는 0으로 끝난다.
                scene = SCENE.match(line)
                if scene and scene[2] == "True":
                    failures.append("가로 넘침: " + line)
        else:
            marked = bool(re.match(r"^(?:FAIL|BLOCKED|not ok)\b", line))
            # node:test의 실패 줄과 자체 검사의 실패 기호는 들여쓰기 뒤 줄머리에 온다.
            # 줄 가운데의 ✗는 화면 문구(앱이 쓰는 기호)일 수 있어 세지 않는다.
            marked = marked or line.startswith(("✖", "✗"))
            # 모형 검산(tests/model_*.mjs)은 실패 항목을 줄머리 `실패 `로 찍는다.
            marked = marked or bool(re.match(r"^실패\s", line))
            count = re.search(r"ℹ\s+fail\s+(\d+)\b", line)
            marked = marked or bool(count and int(count[1]) > 0)
            counts = re.match(r"^FAILURE_COUNTS\s+(\{.*\})\s*$", line)
            if counts:
                try:
                    marked = marked or bool(json.loads(counts[1]))
                except ValueError:
                    marked = True
            if marked:
                failures.append(line)
    return failures


# 요약 숫자를 찾지 않는 줄머리. 통과·정보 줄 본문의 '실패 2' 같은 화면 문구를 요약으로 오인하지 않는다.
NOT_SUMMARY = ("PASS", "INFO", "OBS", "SKIP", "DETECTED", "MUTATION", "BASELINE")
# `PASS n / FAIL m`은 PASS로 시작해도 요약 줄이다(ux_s2fix·ux_s2fix2).
PASS_FAIL = re.compile(r"^PASS\s+\d+\s*/\s*FAIL\s+(\d+)(?![\d.])")
# `PROBLEMS N`(콜론 없음)은 rules·e2e 계열의 요약 줄이다. 실패 줄 없이 이 수만 0보다 클 수 있다.
# 숫자 뒤에 `\b`를 쓰지 않는다. `실패 1건`처럼 한글 단위가 붙으면 낱말 경계가 없어 놓치기 때문이다.
SUMMARY_FAIL = tuple(re.compile(pattern) for pattern in (
    r"\b(?:failures|failed|fails|fail|FAIL|FAILED)\s*[:=]?\s*(\d+)(?![\d.])",
    # `3 failed`처럼 수가 앞에 오는 꼴. `assertions 800 failures 0`·`1984 failed 0`처럼 뒤에 수가 또 오면 앞 수는 실패 수가 아니다.
    r"(?<![\d.])(\d+)\s+(?:failed|failing)\b(?!\s*[:=]?\s*\d)",
    r"\b(?:problems|PROBLEMS)\s*[:=]?\s*(\d+)(?![\d.])",
    r'"failures"\s*:\s*(\d+)\b',
    r"실패\s*[:=]?\s*(\d+)\s*(?:건|개|줄)?(?![\d.])",
))


def summary_failures(text):
    found = []
    for raw in text.splitlines():
        line = raw.strip()
        words = line.split()
        if not words:
            continue
        passfail = PASS_FAIL.match(line)
        if passfail:
            if int(passfail[1]) > 0:
                found.append(line)
            continue
        if words[0] in NOT_SUMMARY:
            continue
        if any(int(match[1]) > 0 for pattern in SUMMARY_FAIL for match in pattern.finditer(line)):
            found.append(line)
    return found


# 단언 수가 든 요약 줄의 형식. 잡는 값은 (단언 수, 실패 수, 요약의 SKIP 수).
SUMMARY_COUNT = (
    re.compile(r"^assertions\s+(\d+)\s+failures\s+(\d+)\b()"),
    re.compile(r"^checks\s+(\d+)\s+fail\s+(\d+)\b(?:\s+SKIP\s+(\d+)\b)?"),
    re.compile(r"^PASS\s+(\d+)\s*/\s*FAIL\s+(\d+)\b()"),
    re.compile(r"^pass\s+(\d+)\s+fail\s+(\d+)\b()"),
)


def read_summary(kind, name, text):
    """기준 수치와 비교할 마지막 요약. 요약 줄이 없으면 None(중간에 멈춘 실행)."""
    lines = text.splitlines()
    skips = sum(1 for line in lines if re.match(r"^SKIP\b", line.strip()))
    if kind == "browser" and (name.startswith("ux_task:") or name == "ux_coach"):
        result = first_json(lines)
        if result is None:
            return None
        if name == "ux_coach":
            step = result.get("reachedStep")
            return dict(assertions=step if isinstance(step, int) else 0, failures=None, skips=skips,
                        line="reachedStep")
        scenes = sum(1 for line in lines if SCENE.match(line.strip()))
        return dict(assertions=scenes, failures=None, skips=skips, line="장면 줄 수")
    for raw in reversed(lines):
        line = raw.strip()
        for pattern in SUMMARY_COUNT:
            match = pattern.match(line)
            if match:
                return dict(assertions=int(match[1]), failures=int(match[2]),
                            skips=max(skips, int(match[3] or 0)), line=line)
    return None


OLD_LINE = re.compile(r"^(\S+) exit=(-|\d+)(?:\((CRASH|TIMEOUT)\))?(?=\s|$)")


def read_status(path):
    records = {}
    for number, raw in enumerate(read_text(path).splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "\t" in raw and " exit=" not in raw:
            parts = raw.split("\t")
            if len(parts) != 4:
                raise ValueError(f"상태 파일 {number}번째 줄: 탭 4칸 필요")
            name, code, seconds, state = (item.strip() for item in parts)
            if state not in STATES:
                raise ValueError(f"상태 파일 {number}번째 줄: 알 수 없는 상태")
            try:
                code = None if code == "-" else int(code)
                seconds = int(seconds)
            except ValueError:
                raise ValueError(f"상태 파일 {number}번째 줄: 종료 코드와 초는 정수 필요") from None
        elif re.match(r"^\S+ exit=", line):
            # 옛 요약 형식(`이름 exit=N …`, browser.sh의 summary.txt는 `exit=- … state=missing`).
            # 이 모양인데 읽지 못하는 줄은 건너뛰지 않고 멈춘다. 필수 검사 누락이 조용히 사라지기 때문이다.
            match = OLD_LINE.match(line)
            if not match:
                raise ValueError(f"상태 파일 {number}번째 줄: `이름 exit=` 줄을 읽을 수 없음")
            name, code, label = match.groups()
            # ` :: ` 뒤는 로그 끝줄 사본이다. 그 안의 `state=`·`12s` 같은 글자를 상태로 읽지 않는다.
            head = line.split(" :: ", 1)[0]
            named = re.search(r"\sstate=(\S+)", head)
            if named and named[1] not in STATES:
                raise ValueError(f"상태 파일 {number}번째 줄: 알 수 없는 상태")
            state = named[1] if named else {"CRASH": "crash", "TIMEOUT": "timeout"}.get(label, "done")
            if code == "-":
                if state not in ("skip", "missing", "unlisted"):
                    raise ValueError(f"상태 파일 {number}번째 줄: 종료 코드 없이 상태 {state}")
                code = None
            else:
                code = int(code)
            elapsed = re.search(r"\s(\d+)s(?:\s|$)", head)
            seconds = int(elapsed[1]) if elapsed else None
        else:
            continue
        name = normalize(name)
        if not name or name in records:
            raise ValueError(f"상태 파일 {number}번째 줄: 비어 있거나 중복된 이름")
        records[name] = (code, seconds, state)
    return records


WILD_MIN = 20


def read_baseline(path):
    entries = []
    for number, raw in enumerate(read_text(path).splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "\t" not in raw:
            raise ValueError(f"기준선 {number}번째 줄: 탭 구분 필요")
        name, pattern = (item.strip() for item in raw.split("\t", 1))
        if not name or not pattern:
            raise ValueError(f"기준선 {number}번째 줄: 빈 항목")
        if pattern.startswith("Traceback"):
            raise ValueError(f"기준선 {number}번째 줄: 예외(Traceback)는 기준선에 넣지 않음")
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            # 접두는 `FAIL BLOCKED <장면 라벨>:`처럼 실패 표지·장면 라벨·콜론까지 있어야 한다.
            # 빈 접두나 `FAIL*`가 그 검사의 새 실패를 모두 알려진 실패로 바꾸는 일을 막는다.
            if len(prefix) < WILD_MIN or not re.match(r"^(?:FAIL|BLOCKED)\s+\S.*:", prefix):
                raise ValueError(f"기준선 {number}번째 줄: * 앞부분은 실패 표지·장면 라벨·콜론을 포함해 "
                                 f"{WILD_MIN}자 이상이어야 함")
        entries.append((normalize(name), pattern))
    return entries


def read_counts(path, kind):
    counts = {}
    for number, raw in enumerate(read_text(path).splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.split()
        if len(parts) != 5 or parts[0] not in ("browser", "node"):
            raise ValueError(f"기준 수치 {number}번째 줄: 종류·이름·최소단언·최대SKIP·종료코드 다섯 칸 필요")
        try:
            values = [int(item) for item in parts[2:]]
        except ValueError:
            raise ValueError(f"기준 수치 {number}번째 줄: 수치는 정수 필요") from None
        if min(values) < 0 or values[2] > 128:
            raise ValueError(f"기준 수치 {number}번째 줄: 수치 범위 오류")
        name = normalize(parts[1])
        if parts[0] != kind:
            continue
        if name in counts:
            raise ValueError(f"기준 수치 {number}번째 줄: 중복된 이름")
        counts[name] = dict(assertions=values[0], skips=values[1], exit=values[2])
    return counts


CREDIT_MAX = 50


def read_credits(path, kind):
    """조건부 단언 보정. 앱 상태에 따라 묶음째 돌지 않는 단언을, 그 분기를 탔다는 통과 줄로 센다.

    칸(탭 하나로 구분): 종류<TAB>검사 이름<TAB>한 줄당 단언 수<TAB>정규식. 정규식은 줄머리 `^PASS `로
    시작해야 하고 줄 전체(앞뒤 공백 제거)에 맞춘다. 실패 줄·요약 줄을 보정으로 세지 않기 위해서다.
    """
    credits = {}
    for number, raw in enumerate(read_text(path).splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = raw.split("\t")
        if len(parts) != 4:
            raise ValueError(f"단언 보정 {number}번째 줄: 탭 4칸(종류·이름·단언 수·정규식) 필요")
        group, name, amount, pattern = (item.strip() for item in parts)
        if group not in ("browser", "node") or not name:
            raise ValueError(f"단언 보정 {number}번째 줄: 종류는 browser·node, 이름 필요")
        try:
            amount = int(amount)
        except ValueError:
            raise ValueError(f"단언 보정 {number}번째 줄: 단언 수는 정수 필요") from None
        if not 1 <= amount <= CREDIT_MAX:
            raise ValueError(f"단언 보정 {number}번째 줄: 단언 수는 1~{CREDIT_MAX}")
        if not pattern.startswith("^PASS "):
            raise ValueError(f"단언 보정 {number}번째 줄: 정규식은 ^PASS 로 시작해야 함")
        try:
            compiled = re.compile(pattern)
        except re.error:
            raise ValueError(f"단언 보정 {number}번째 줄: 정규식 오류") from None
        if group == kind:
            credits.setdefault(normalize(name), []).append((amount, compiled))
    return credits


def credit_of(rules, text):
    """보정 단언 수. 줄 하나는 규칙 하나에만 쓴다."""
    total = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("PASS "):
            # 정규식 최상위 '|'로 ^PASS 머리를 우회해도 PASS 줄 밖에는 보정하지 않는다.
            continue
        hit = next((amount for amount, pattern in rules if pattern.fullmatch(line)), None)
        if hit:
            total += hit
    return total


def read_names(path):
    names = []
    for raw in read_text(path).splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            names.append(normalize(line))
    if len(set(names)) != len(names):
        raise ValueError("기대 목록에 중복된 이름")
    return names


def matches(line, pattern):
    return line.startswith(pattern[:-1]) if pattern.endswith("*") else line == pattern


def classify(failures, patterns):
    """기준선 줄 하나는 실패 줄 하나에만 대응한다. 정확한 줄을 와일드카드보다 먼저 맞춘다."""
    order = sorted(range(len(patterns)), key=lambda index: patterns[index].endswith("*"))
    used = set()
    known, new = [], []
    for line in failures:
        hit = next((index for index in order if index not in used and matches(line, patterns[index])), None)
        if hit is None:
            new.append(line)
        else:
            used.add(hit)
            known.append(line)
    return known, new, [pattern for index, pattern in enumerate(patterns) if index not in used]


def blank(name, code=None, seconds=None):
    # advisory: CI 전용 참고 줄(시간 민감)
    return dict(name=name, code=code, seconds=seconds, verdict="통과", new=[], known=[], resolved=[],
                issue="", details=[], summary=None, counts=None, advisory=[])


# 검사 전체 참고의 단언 부족 상한. CI 3차 ux_s2fix2 713/736(부족 23)·5차 714/736(22)에 여유를 둔 값(G).
ADVISORY_SHORTFALL_MAX = 40


def shortfall(expect, summary):
    if expect and summary and summary["assertions"] + summary["credit"] < expect["assertions"]:
        return f"단언 수 {summary['assertions']} + 보정 {summary['credit']} < 기준 {expect['assertions']}"
    return ""


def whole_advisory_ok(result, expect, summary, failures):
    """검사 전체 참고로 돌려도 되는 실패인가: 대기 시간 초과로 장면이 끊긴 FAIL·BLOCKED 줄만 있을 때.

    값·레이아웃·콘솔·다른 예외 줄이 하나라도 있으면 실패다. 요약 없음·SKIP 초과·요약 실패 수와 줄 수 불일치,
    상한을 넘는 단언 부족도 실패다.
    """
    new = result["new"]
    if result["issue"] or not new:
        return False
    if any(not line.startswith(("FAIL ", "BLOCKED ")) or "TimeoutError" not in line for line in new):
        return False
    if expect and summary is None:
        return False
    if expect and summary["skips"] > expect["skips"]:
        return False
    if expect and summary["failures"] is not None and summary["failures"] != len(failures):
        return False
    if shortfall(expect, summary) and \
            expect["assertions"] - summary["assertions"] - summary["credit"] > ADVISORY_SHORTFALL_MAX:
        return False
    return True


def evaluate(kind, logs, records, baseline, counts, credits=None, advisory=None):
    credits = credits or {}
    advisory = advisory or {}
    results = []
    for name, (code, seconds, state) in records.items():
        result = blank(name, code, seconds)
        result["counts"] = counts.get(name)
        results.append(result)
        if state in ("skip", "missing", "unlisted"):
            result["verdict"] = "건너뜀" if state == "skip" else "실패"
            if state == "missing":
                result["issue"] = "검사 파일 없음"
            elif state == "unlisted":
                result["issue"] = "목록에 없는 검사 파일(tests/ci/node-suites.txt에 등록 필요)"
            continue
        paths = (logs / (name.replace(":", "__") + ".log"), logs / (name + ".log"))
        path = next((item for item in paths if item.is_file()), None)
        if path is None:
            result.update(verdict="실패", issue="로그 없음")
            continue
        text = read_text(path)
        if not text.strip():
            result.update(verdict="실패", issue="빈 로그")
            continue
        failures = failure_lines(kind, name, text)
        patterns = [pattern for test, pattern in baseline if test == name]
        result["known"], result["new"], result["resolved"] = classify(failures, patterns)
        # CI 전용 참고 줄: 공유 실행기 속도에 걸리는 시간 단언. 맥 로컬 최종 확인(advisory 없이 판정)에서 판정한다.
        line_rules = [pattern for pattern in advisory.get(name, []) if pattern]
        if line_rules:
            result["advisory"] = [line for line in result["new"] if any(matches(line, rule) for rule in line_rules)]
            result["new"] = [line for line in result["new"] if line not in result["advisory"]]
        expect = result["counts"]
        summary = read_summary(kind, name, text) if expect else None
        if summary is not None:
            # 기준 단언 수와 비교하는 값은 요약의 단언 수에 조건부 보정(baseline-credit.txt)을 더한 것이다.
            summary["credit"] = credit_of(credits.get(name, []), text)
        result["summary"] = summary
        if state == "timeout" or code == 124:
            result.update(verdict="실패", issue="시간 초과")
        elif state == "crash" or (code is not None and code > 128):
            result.update(verdict="실패", issue="크래시")
        elif code is None:
            result.update(verdict="실패", issue="종료 코드 모름(상태 파일 확인)")
        elif result["new"]:
            result["verdict"] = "실패"
        elif expect and summary is None:
            result.update(verdict="실패", issue="요약 줄 없음(중간에 멈췄거나 출력 형식이 바뀜)")
        elif expect and summary["assertions"] + summary["credit"] < expect["assertions"]:
            credit = f" + 보정 {summary['credit']}" if summary["credit"] else ""
            result.update(verdict="실패", issue=f"단언 수 {summary['assertions']}{credit} < 기준 {expect['assertions']}"
                                               f"({summary['line']})")
        elif expect and summary["skips"] > expect["skips"]:
            result.update(verdict="실패", issue=f"SKIP {summary['skips']} > 기준 {expect['skips']}")
        elif expect and summary["failures"] is not None and summary["failures"] != len(failures):
            result.update(verdict="실패", issue=f"요약의 실패 수 {summary['failures']} ≠ 실패 줄 {len(failures)}"
                                               f"({summary['line']})")
        elif result["known"] and not expect:
            result.update(verdict="실패", issue="알려진 실패가 있는데 기준 수치 없음(baseline-counts.txt에 줄 필요)")
        elif result["known"] and (code == 0 or code != expect["exit"]):
            result.update(verdict="실패", issue=f"종료 코드 {code} ≠ 기준판 {expect['exit']}(알려진 실패가 남은 실행)")
        elif not failures and code != 0:
            result.update(verdict="실패", issue="실패 줄 없이 비정상 종료")
            result["details"] = text.splitlines()[-5:]
        elif not failures and summary_failures(text):
            result.update(verdict="실패", issue="요약에만 실패 수가 있음")
            result["details"] = summary_failures(text)
        elif result["known"]:
            result["verdict"] = f"통과(알려진 실패 {len(result['known'])}줄)"
        if result["issue"] and not result["details"]:
            result["details"] = text.splitlines()[-5:]
        # 검사 전체가 CI 참고인 경우(advisory 파일에 이름만 적은 줄): 새 실패 줄이 모두 대기 시간 초과
        # (TimeoutError)일 때만 참고로 돌린다(whole_advisory_ok). 시간 초과(124)·크래시 같은 issue가 있으면 실패다.
        if result["verdict"] == "실패" and "" in advisory.get(name, []) and whole_advisory_ok(result, expect, summary, failures):
            result["verdict"] = "참고(CI 시간 민감 — 맥 로컬 최종 확인에서 판정)"
            short = shortfall(expect, summary)
            result["advisory"] = result["new"] + ([short] if short else [])
            result["new"] = []
        elif result.get("advisory") and result["verdict"] != "실패":
            result["verdict"] = f"{result['verdict']} · 참고 {len(result['advisory'])}줄(CI 시간 민감)"
    return results


def read_advisory(path, kind):
    """CI 전용 참고 목록. 줄 형식: '<종류>\t<검사 이름>' 또는 '<종류>\t<검사 이름>\t<실패 줄 패턴>'."""
    rules = {}
    for number, raw in enumerate(read_text(path).splitlines(), 1):
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) not in (2, 3) or parts[0] not in ("browser", "node"):
            raise ValueError(f"참고 목록 형식 오류 {path}:{number}: {line}")
        if parts[0] != kind:
            continue
        if len(parts) == 3 and not parts[2].strip():
            raise ValueError(f"참고 목록 형식 오류 {path}:{number}: 셋째 칸(실패 줄 패턴)이 비었음")
        pattern = parts[2] if len(parts) == 3 else ""
        # 줄 패턴은 기준선 줄처럼 장면 이름표와 단언 설명, 콜론까지 담아야 한다(장면 전체를 삼키지 않게).
        if pattern and (len(pattern.rstrip('*')) < 20 or
                        not re.match(r"^(?:FAIL|BLOCKED)\s+\S+\s+\S.*:", pattern)):
            raise ValueError(f"참고 패턴은 'FAIL|BLOCKED <장면> <설명>:' 꼴의 20자 이상이어야 함 {path}:{number}")
        rules.setdefault(parts[1], []).append(pattern)
    return rules


def cell(value):
    return str(value).replace("\n", " ")[:300].replace("|", "\\|")


def against(item, key):
    if not item["counts"]:
        return "-"
    have = item["summary"][key] if item["summary"] else "없음"
    if key == "assertions" and item["summary"] and item["summary"].get("credit"):
        have = f"{have}+{item['summary']['credit']}"
    return f"{have}/{item['counts'][key]}"


def render(title, results, max_lines):
    failed = any(item["verdict"] == "실패" for item in results)
    known = sum(len(item["known"]) for item in results)
    resolved = sum(len(item["resolved"]) for item in results)
    skipped = sum(item["verdict"] == "건너뜀" for item in results)
    lines = [f"## {cell(title)}", "",
             f"**{'실패' if failed else '통과'}** · 검사 {len(results)}개(건너뜀 {skipped}) · "
             f"알려진 실패 {known}줄 · 해소 경고 {resolved}건", "",
             "| 검사 | 판정 | 종료 코드 | 초 | 실패 줄 수(새/알려진) | 단언/기준 | SKIP/기준 |",
             "|---|---|---|---|---|---|---|"]
    for item in results:
        values = (item["name"], item["verdict"],
                  "모름" if item["code"] is None else item["code"],
                  "모름" if item["seconds"] is None else item["seconds"],
                  f"{len(item['new'])}/{len(item['known'])}",
                  against(item, "assertions"), against(item, "skips"))
        lines.append("| " + " | ".join(cell(value) for value in values) + " |")
    for title, key in (("새 실패", "new"), ("CI 참고(시간 민감, 맥 로컬 최종 확인에서 판정)", "advisory"), ("해소 경고", "resolved"),
                       ("비정상 종료·크래시·시간 초과·파일·로그·요약·실행 누락", "issue")):
        lines.extend(("", f"### {title}", ""))
        found = False
        for item in results:
            if not item[key]:
                continue
            found = True
            lines.extend((f"#### {cell(item['name'])}", ""))
            entries = [item["issue"]] + item["details"] if key == "issue" else item[key]
            lines.extend(f"- {cell(entry)}" for entry in entries[:max_lines])
            if len(entries) > max_lines:
                lines.append(f"- 외 {len(entries) - max_lines}줄")
            lines.append("")
        if not found:
            lines.append("없음")
    return "\n".join(lines) + "\n", int(failed)


def write_summary(output, report):
    if output:
        with Path(output).open("a", encoding="utf-8") as handle:
            handle.write(report + "\n")


def main():
    parser = Parser(description=__doc__, add_help=False)
    parser.add_argument("-h", "--help", action="help", help="사용법 표시")
    parser._positionals.title = "위치 인자"
    parser._optionals.title = "선택 인자"
    here = Path(__file__).parent
    parser.add_argument("--kind", choices=("browser", "node"), required=True, help="검사 종류")
    parser.add_argument("--logs", type=Path, required=True, help="로그 폴더")
    parser.add_argument("--status", type=Path, help="상태 파일 또는 옛 요약 파일(기본: 로그 폴더의 status.tsv)")
    parser.add_argument("--expect", type=Path,
                        help="실행해야 할 검사 이름 목록(기본: 로그 폴더에 expected.txt가 있으면 그것)")
    parser.add_argument("--baseline", type=Path, default=here / "baseline-fail.txt", help="알려진 실패 기준선")
    parser.add_argument("--counts", type=Path, default=here / "baseline-counts.txt", help="검사별 기준 수치")
    parser.add_argument("--credits", type=Path, default=here / "baseline-credit.txt",
                        help="조건부 단언 보정(없으면 보정 없음)")
    parser.add_argument("--advisory", type=Path,
                        help="CI 전용 참고 목록(시간 민감 검사). 맥 로컬 최종 확인에서는 주지 않는다")
    parser.add_argument("--title", help="요약 제목")
    parser.add_argument("--summary-out", type=Path, help="요약을 덧붙일 파일")
    parser.add_argument("--max-lines", type=int, default=20, help="검사별 표시 줄 수")
    args = parser.parse_args()
    if args.max_lines < 1:
        parser.error("표시 줄 수는 1 이상이어야 합니다")
    title = args.title or f"{args.kind} 검사 판정"
    output = args.summary_out or os.environ.get("GITHUB_STEP_SUMMARY")
    try:
        if not args.logs.is_dir():
            raise ValueError(f"로그 폴더 없음: {args.logs} (실행 단계가 결과 폴더를 만들기 전에 멈춤)")
        runner = args.logs / "runner-error.txt"
        runner_error = [line for line in read_text(runner).splitlines() if line.strip()] if runner.is_file() else []
        expect_path = args.expect or args.logs / "expected.txt"
        expected = read_names(expect_path) if args.expect or expect_path.is_file() else None
        status = args.status or args.logs / "status.tsv"
        if status.is_file():
            records = read_status(status)
        elif args.status is None and (runner_error or expected is not None):
            records = {}
        else:
            # 상태 없이 로그만으로 판정하면 종료 코드 규칙(시간 초과·크래시·비정상 종료)이 꺼진다.
            raise ValueError(f"상태 파일 없음: {status} (실행기의 status.tsv나 --status 필요)")
        results = []
        if runner_error:
            item = blank(RUNNER)
            item.update(verdict="실패", issue="실행기 오류로 멈춤(runner-error.txt)", details=runner_error)
            results.append(item)
        results += evaluate(args.kind, args.logs, records, read_baseline(args.baseline),
                            read_counts(args.counts, args.kind) if args.counts.is_file() else {},
                            read_credits(args.credits, args.kind) if args.credits.is_file() else {},
                            read_advisory(args.advisory, args.kind) if args.advisory else {})
        if expected is not None:
            for item in results:
                if item["name"] != RUNNER and item["name"] not in expected:
                    item.update(verdict="실패", issue="기대 목록(expected.txt)에 없는 검사")
            for name in expected:
                if name not in records:
                    item = blank(name)
                    item.update(verdict="실패", issue="실행 안 됨(상태 없음, 실행이 중간에 끊김)")
                    results.append(item)
        if not results:
            raise ValueError("판정할 검사 없음")
        report, code = render(title, results, args.max_lines)
        print(report, end="")
        write_summary(output, report)
        return code
    except (OSError, ValueError) as error:
        if isinstance(error, OSError):
            message = f"파일 오류: {error.filename or '경로 확인 필요'} (오류 번호 {error.errno})"
        else:
            message = f"형식 오류: {error}"
        print(message, file=sys.stderr)
        # 판정하지 못해도 요약 칸에 이유를 남긴다. 실행 단계 로그를 열지 않아도 원인을 알 수 있게 한다.
        try:
            write_summary(output, f"## {cell(title)}\n\n**판정 불가** · {cell(message)}\n")
        except OSError:
            pass
        return 2


if __name__ == "__main__":
    sys.exit(main())
