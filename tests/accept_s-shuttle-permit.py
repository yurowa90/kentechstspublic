"""수정 명세만을 oracle로 삼는 심야 셔틀 수용 검사. 브라우저 실행은 별도.

KCP_BASE=<저장소 최상위 index.html 주소> python accept_s-shuttle-permit.py
harness가 함수마다 새 context, 1280x900/390x844 x light/dark, 오류 수집을 담당한다.
명세에 개별 ID가 없어 다음 ID를 부여했다(메시지 첫 토큰).

SP-12.1-01 환경/오류/가로폭, 02 메타/기존5개, 03 기반API, 04 JS구문,
05 CSS접두어/색. SP-12.2-01~26은 표의 위에서 아래 각 행,
27은 표 뒤의 키보드 요구다. SP-12.3-01 실제 UI 경로/기록/증거,
02 결과 수치, 03 비교/민감도, 04 잠금/결과 분리, 05 저장/복원,
06 다시 심사/재결정. SP-12.4-01~12는 해당 절의 bullet 순서다.
SP-12.5-01~04는 작성 당시의 확인 기록(자동 통과로 단언하지 않음),
05 포아송 재대조(Node 검사가 담당), 06 차량 설정 표시,
07 헤드의 과학/균형 검토(사람의 검토), 08 공통 창작 표시,
09 4환경 실행(이 파일을 실행했을 때만 검증됨).

12.5-05의 외부 문헌 재열람과 12.5-07의 심사 승인은 자동화할 수 없다.
제공된 표와 수식은 model_s-shuttle-permit.mjs로 대조한다.
순수 game 함수 검증은 로드 상태의 복사본에 수행하여 저장 시점과 분리한다.
"""
import copy
import json
import re
import subprocess
from pathlib import Path

from accept_originals import assert_single_request
from harness import Ctx, main

ID = "s-shuttle-permit"
KEY = "kcp:v1:" + ID
ORDER = ("clear", "rain", "fog")
ROOT = Path(__file__).resolve().parents[1]
# 검토 반영: 확정 뒤 질문은 7장(공통 2 + 개별 3 + 반문·발산). sp-hum은 확정 전 일반 질문에만 남고,
# 결함 8: 사람 운전자·인증 기준 비교는 모든 정책에서 읽을 수 있는 성찰로 옮겼다.
FIXED = ["sp-c1", "sp-c2"]
UNLOCKED = FIXED + ["sp-hum", "sp-prep"]
END = ["sp-counter", "sp-div"]
C_KEYS = FIXED + ["sp-fog-denied", "sp-op", "sp-governance-R3-L3"] + END
REASON = "이동 접근성과 증거의 양을 우선하고 공공 부담을 함께 검토한다."
MEMO = "안개 자료는 짧다."
RESET_NOTICE = "계산 규칙이 달라 게임 계획을 초기화했습니다. 메모는 남아 있습니다."


def _game(**patch):
    g = dict(version=1, decisions=0, v=dict(clear=40, rain=40, fog=30),
             testV=dict(clear=40, rain=40, fog=30), tests=[], useOp=False,
             rule="R1", liab="L1", assume=dict(auto=.1, staff=.05, proof=.4, alt=1.5),
             tab="vehicle", band="rain", reason="", locked=None)
    g.update(patch)
    return g


def _prep(c):
    c.goto("#y" + ID, wait="#phase")
    if c.page.locator("#sp-prep").count() == 0:
        c.phase("prep")
    c.page.wait_for_selector("#sp-prep")


def _text(c, sel):
    return c.page.locator(sel).inner_text().strip()


def _has(c, sel, text, aid):
    c.expect(text in _text(c, sel), f"{aid} {sel}에 {text!r} 표시")


def _eqtext(c, sel, expected, aid):
    c.eq(_text(c, sel), expected, f"{aid} {sel} 표시값")


def _number(c, sel, value):
    loc = c.page.locator(sel)
    loc.fill(str(value))
    loc.press("Tab")  # native change/blur를 통해 입력을 확정한다.


def _value(c, sel, value, aid):
    c.eq(float(c.page.locator(sel).input_value()), value, f"{aid} {sel} 입력값")


def _flush(c):
    c.page.evaluate("KCP.flush()")


def _reload(c, wait="#sp-prep"):
    _flush(c)
    c.page.reload()
    c.page.wait_for_selector(wait)


def _inject(c, game, **common):
    # 현재 화면을 떠나 flush한 뒤 주입: 이전 pending 저장의 덮어쓰기를 방지한다.
    c.goto("#home", wait=".home-grid")
    _flush(c)
    c.page.evaluate("([key,state]) => localStorage.setItem(key,JSON.stringify(state))",
                    [KEY, {"phase": "prep", "game": game, **common}])
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    _prep(c)


def _state(c):
    c.wait_saved(400)
    # 저장 대기열이 3초 안에 비지 않을 만큼 렌더러가 밀리면 wait_saved는 그냥 넘어간다(harness.py).
    # 페이지 시계로 300ms 타이머를 하나 더 기다리면 마감이 앞선 250ms 저장 타이머가 반드시 먼저 돈다
    # (accept_probe._state와 같은 보호, 2026-10-21 재발 경로 재조사의 부수 발견).
    c.page.evaluate("() => new Promise(r => setTimeout(r, 300))")
    return c.ls(KEY) or {}


def _snapshot(c):
    return c.page.evaluate("""id => {
      const s=KCP.load(id), g=KCP.games[id], before=JSON.stringify(s);
      const qs=g.questions(s), again=g.questions(s), recap=g.recap(s);
      return {qs,again,recap,pure:before===JSON.stringify(s),game:s.game,
              answers:s.answers,rubric:s.rubric,memo:s.memo};
    }""", ID)


def _questions(c, keys, aid):
    _flush(c)
    r = _snapshot(c)
    assert_single_request(c, r["qs"])
    c.eq([q["k"] for q in r["qs"]], keys, f"{aid} 질문 키와 순서")
    c.eq(len({q["k"] for q in r["qs"]}), len(keys), f"{aid} 중복 질문 키 없음")
    c.expect(all("src" not in q for q in r["qs"]), f"{aid} 질문에 출처 속성 없음")
    c.expect(r["pure"], f"{aid} questions/recap은 원본 상태를 변경하지 않음")
    c.eq(r["again"], r["qs"], f"{aid} 반복 호출 질문 동일")
    return r


def _lock(c):
    c.page.locator("#sp-lock").click()
    c.page.wait_for_selector("#sp-results", state="visible")


def _case(c, case):
    _prep(c)
    if case == "A":
        for condition in ORDER:
            _number(c, f"#sp-v-{condition}", 0)
    elif case == "B":
        for condition in ORDER:
            _number(c, f"#sp-v-{condition}", 60)
            _number(c, f"#sp-tv-{condition}", 60)
        c.page.locator("#sp-use-op").check()
        c.page.locator("#sp-rule-R2").click()
        c.page.locator("#sp-liab-L2").click()
        for condition, n in (("clear", 4), ("rain", 3), ("fog", 3)):
            for _ in range(n):
                c.page.locator(f"#sp-run-{condition}").click()
    elif case == "C":
        c.page.locator("#sp-use-op").check()
        c.page.locator("#sp-rule-R3").click()
        c.page.locator("#sp-liab-L3").click()
        for condition in ORDER:
            c.page.locator(f"#sp-run-{condition}").click()
        c.page.locator("#sp-reason").fill(REASON)
        c.page.locator("#sp-memo").fill(MEMO)
    elif case == "D":
        for condition in ("rain", "fog"):
            _number(c, f"#sp-v-{condition}", 0)
        for _ in range(10):
            c.page.locator("#sp-run-clear").click()
    elif case == "E":
        c.page.locator("#sp-use-op").check()
        c.page.locator("#sp-rule-R2").click()
        c.page.locator("#sp-liab-L2").click()
    _lock(c)


def _output(c, values, aid):
    for suffix, expected in values.items():
        _eqtext(c, "#sp-out-" + suffix, expected, aid)


def _sensitivity(c, values, aid):
    row = c.page.locator("#sp-sensitivity tbody tr").filter(has_text="전환 비율 둘 다 두 배")
    c.eq(row.count(), 1, f"{aid} 전환 두 배 비교 행 1개")
    if row.count() == 1:
        # 작은 화면의 접근성용 셀 라벨을 포함해도 수치·단위를 각각 검증한다.
        cells = row.locator("td")
        c.eq(cells.count(), 5, f"{aid} 민감도 결과 열 5개")
        for cell, expected in zip(cells.all(), values):
            c.expect(expected in cell.inner_text(), f"{aid} 비교 셀 {expected!r}")


def t_12_1_environment_metadata(c: Ctx):
    aid = "SP-12.1-02"
    c.goto("#home", wait=".home-grid")
    c.eq(c.page.locator(f'#home-originals .opkg[href="#y{ID}"]').count(), 1,
         f"{aid} 홈 창작 게임 카드 1개")
    c.eq(c.page.locator(".pkg").count(), 5, f"{aid} 기존 기출 카드 5개 보존")
    meta = c.page.evaluate("""id => ({m:KCP.YEARS[id],originals:KCP.ORIGINAL_ORDER,
       order:KCP.ORDER,base:typeof KCP.memoPanel==='function'&&typeof KCP.hbar==='function'})""", ID)
    c.eq(meta["order"], ["2022", "2023", "2024", "2025", "2026"], f"{aid} 기존 ORDER 유지")
    c.eq(meta["originals"].count(ID), 1, f"{aid} ORIGINAL_ORDER 중복 없음")
    m = meta["m"]
    c.eq(m.get("original"), True, f"{aid} original=true")
    c.eq([m.get("prep"), m.get("answer")], [25, 15], f"{aid} 기본 시간 25/15분")
    c.eq(m.get("title"), "심야 자율주행 셔틀 허가 심사", f"{aid} 제목")
    c.eq(m.get("format"), "정지 경계와 시험 증거 설계", f"{aid} 형식")
    c.eq(m.get("desc"), "날씨별 허용 속도와 시험 주행을 정하고, 안전 증거와 이동권을 함께 고려해 심야 셔틀을 심사합니다.", f"{aid} 홈 설명")
    c.eq(list(m["rubric"]), ["발산적 사고력", "문제해결 능력", "인문적 통찰 역량"], f"{aid} 평가 영역 3개")
    c.eq([len(v) for v in m["rubric"].values()], [3, 3, 3], f"{aid} 영역별 평가 문장 3개")
    c.eq(len(m["intent"]), 5, f"{aid} 의도 5개")
    c.expect(meta["base"], "SP-12.1-03 memoPanel/hbar 기반 API 존재")
    _prep(c)
    _has(c, ".brief", "창작 게임 · 가상 자료", "SP-12.5-08")
    c.check("SP-12.1-01 준비실 네 환경 가로폭")
    # 저장은 조작을 통해 발생시킨다(첫 렌더 자동 저장 여부를 가정하지 않음).
    c.page.locator("#sp-memo").fill("저장 키 확인용 가상 메모")
    c.wait_saved(400)
    c.expect(c.ls(KEY) is not None, "SP-12.1-01 400ms 뒤 게임 저장 키 생성")


def t_12_1_static_contract(c: Ctx):
    result = subprocess.run(["node", "--check", str(ROOT / "games" / (ID + ".js"))],
                            text=True, capture_output=True, check=False)
    c.eq(result.returncode, 0, f"SP-12.1-04 구현 JS 구문 검사: {result.stderr.strip()}")
    _prep(c)
    # CSSOM은 주석/문자열/중첩 @media를 브라우저 파서로 처리한다.
    rules = c.page.evaluate("""() => {
      const out=[];
      function walk(rules) {for(const r of rules) {
        if(r.selectorText) out.push({selector:r.selectorText,decl:Array.from(r.style).map(p=>[p,r.style.getPropertyValue(p)])});
        if(r.cssRules) walk(r.cssRules);
      }}
      for(const s of document.styleSheets) if((s.href||'').includes('s-shuttle-permit.css')) walk(s.cssRules);
      return out;
    }""")
    allowed = {"ink", "ink-2", "sheet", "sheet-2", "line", "accent", "volt-soft", "bad-soft", "warn", "bad"}
    for rule in rules:
        for selector in rule["selector"].split(","):
            c.expect(bool(re.match(r"^[.#]sp-", selector.strip())),
                     f"SP-12.1-05 신규 CSS 선택자 접두어 {selector}")
        for prop, value in rule["decl"]:
            c.expect(not prop.startswith("--"), f"SP-12.1-05 공통 변수 재정의 없음 {prop}")
            c.expect(not re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|url\(|@import", value),
                     f"SP-12.1-05 색상 리터럴/외부 자원 없음 {prop}: {value}")
            # 명세 11·12.1: 실제 색 지정은 공통 변수를 사용한다. var()가 든
            # background/outline 축약 선언은 CSSOM에서 하위 색 속성 값이 빈 문자열로
            # 나올 수 있다. 빈 파생값은 색 지정이 아니므로 제외하고 축약 선언을 검사한다.
            if prop in ("color", "background", "background-color", "border-color", "fill", "stroke", "outline", "outline-color") and value.strip():
                c.expect(value.strip() in ("none", "transparent", "inherit", "currentcolor", "currentColor") or "var(" in value,
                         f"SP-12.1-05 색 지정은 공통 변수 {prop}")
                c.expect(set(re.findall(r"var\(--([\w-]+)", value)) <= allowed,
                         f"SP-12.1-05 허용된 색 변수 {prop}")
            if "var(--warn)" in value or "var(--bad)" in value:
                c.expect(prop in ("fill", "stroke") and "sp-point" in rule["selector"],
                         f"SP-12.1-05 warn/bad는 점 도형 전용 {rule['selector']} {prop}")
    # 파일이 선택 사항인 만큼 rules가 비어 있다는 이유만으로 실패시키지 않는다.
    c.expect(c.page.evaluate("""() => [...document.querySelectorAll('#sp-prep [id]')].every(e=>e.id.startsWith('sp-'))"""),
             "SP-12.4-11 신규 id 접두어")
    c.expect(c.page.evaluate("""() => [...document.querySelectorAll('#sp-prep *')].every(e=>
      [...e.attributes].filter(a=>a.name.startsWith('data-')).every(a=>a.name.startsWith('data-sp-')))"""),
             "SP-12.4-11 신규 data 속성 접두어")


def t_12_2_initial(c: Ctx):
    _prep(c)
    for condition, v in zip(ORDER, (40, 40, 30)):
        _value(c, f"#sp-v-{condition}", v, "SP-12.2-01")
        _eqtext(c, f"#sp-lowx-{condition}", "0건", "SP-12.2-03")
    _value(c, "#sp-alt", 1.5, "SP-12.2-02")
    for attr, expected in (("min", 0), ("max", 3), ("step", .1)):
        c.eq(float(c.page.locator("#sp-alt").get_attribute(attr)), expected, f"SP-12.2-02 대안 입력 {attr}")
    _number(c, "#sp-alt", 2.3)
    c.page.locator("#sp-alt-default").click()
    _value(c, "#sp-alt", 1.5, "SP-12.2-02")
    _eqtext(c, "#sp-budget", "남은 시험 10/10회 · 사용 0개월", "SP-12.2-04")
    c.expect(c.page.locator("#sp-go").is_disabled(), "SP-12.2-05 확정 전 게임 이동 비활성")
    c.page.eval_on_selector("#sp-go", "e=>e.click()")
    c.expect(c.page.locator("#sp-prep").is_visible(), "SP-12.2-05 disabled 클릭은 준비실 유지")
    # 실제 속성만 믿지 않는 guard도 검증(마지막에 속성을 복구).
    c.page.eval_on_selector("#sp-go", "e=>{e.disabled=false;e.click();e.disabled=true}")
    c.expect(c.page.locator("#sp-prep").is_visible(), "SP-12.2-05 속성을 제거해도 next 호출 차단")
    for sel in ("#sp-unlock", "#sp-results"):
        c.expect(c.page.locator(sel).is_hidden(), f"SP-12.2-06 {sel} 숨김")
    c.eq(c.page.locator("#sp-results").inner_html().strip(), "", "SP-12.2-06 미확정 결과 DOM 비움")
    c.eq(c.page.locator('[id^="sp-out-"], [id^="sp-cmp-"]').count(), 0, "SP-12.2-06 연간/비교 결과 DOM 없음")
    for sel in ("#sp-est-clear", "#sp-upper-clear"):
        _eqtext(c, sel, "증거 없음", "SP-12.2-07")
    c.eq(c.page.locator("#sp-risk-chart svg").count(), 0, "SP-12.2-07 증거 없으면 hbar 없음")
    _has(c, "#sp-risk-chart", "아직 포함할 증거가 없습니다.", "SP-12.2-07")
    # 검토 반영: 실현 사고 난수의 위치와 셔틀만 뽑는다는 사실을 결정 전에 공개한다.
    c.expect(c.page.locator("#sp-seed-note").is_visible(), "SP-12.2-06 확정 전 난수 안내 표시")
    for phrase in ("셔틀 운행에서만 뽑습니다", "비 상위 약 15%, 안개 상위 약 11%", "예상값으로만"):
        _has(c, "#sp-seed-note", phrase, "SP-12.2-06")
        _has(c, ".brief", phrase, "SP-12.2-06 문제 상황")
    c.check("SP-12.1-01 초기 준비실")


def t_12_2_physics_and_test_scope(c: Ctx):
    _prep(c)
    fog = c.page.locator("#sp-v-fog")
    fog.focus()
    for speed, zone, phrase, aid in ((35, "band", "감속도에 따라 정지 조건 달라짐", "SP-12.2-08"),
                                     (40, "above", "감속도 범위 전체에서 정지 조건 초과", "SP-12.2-09")):
        fog.press("ArrowUp")
        _value(c, "#sp-v-fog", speed, aid)
        c.eq(c.page.locator("#sp-point-fog").get_attribute("data-sp-zone"), zone, f"{aid} 정지 상태 도형")
        _has(c, "#sp-zone-fog", phrase, aid)
    _number(c, "#sp-v-rain", 60)
    c.eq(c.page.locator("#sp-point-rain").get_attribute("data-sp-zone"), "band", "SP-12.2-10 비60은 띠 안")
    c.page.locator("#sp-band").select_option("rain")
    for number in ("50.63", "63.56"):
        _has(c, "#sp-physics", number, "SP-12.2-10")
    before = [c.page.locator(f"#sp-v-{condition}").input_value() for condition in ORDER]
    c.page.locator("#sp-band").select_option("clear")
    for text in ("101.32~104.73", "표시 범위 밖"):
        _has(c, "#sp-physics", text, "SP-12.2-11")
    c.eq([c.page.locator(f"#sp-v-{condition}").input_value() for condition in ORDER], before,
         "SP-12.2-11 경계 보기 변경은 속도 유지")
    c.page.locator("#sp-run-clear").click()
    _number(c, "#sp-v-clear", 45)
    _eqtext(c, "#sp-km-clear", "0 km", "SP-12.2-12")
    _eqtext(c, "#sp-excluded-clear", "1회", "SP-12.2-12")
    _has(c, "#sp-log", "40 km/h", "SP-12.2-12")
    _has(c, "#sp-log", "0건", "SP-12.2-12")
    _eqtext(c, "#sp-budget", "남은 시험 9/10회 · 사용 1개월", "SP-12.2-12")
    _value(c, "#sp-tv-clear", 40, "SP-12.2-12")
    _number(c, "#sp-v-clear", 40)
    for sel, val in (("#sp-km-clear", "2,000 km"), ("#sp-x-clear", "0건"), ("#sp-upper-clear", "15.00")):
        _eqtext(c, sel, val, "SP-12.2-13")
    c.eq(c.page.locator("#sp-log tbody tr").count(), 1, "SP-12.2-13 재포함은 새 시험을 만들지 않음")
    _number(c, "#sp-v-clear", 25)
    _eqtext(c, "#sp-km-clear", "0 km", "SP-12.2-14")
    _has(c, "#sp-log", "저속 운행에는 같은 속도 시험 필요", "SP-12.2-14")
    _eqtext(c, "#sp-lowx-clear", "0건", "SP-12.2-14")
    c.check("SP-12.1-01 경계/시험 조작 뒤")


def t_12_2_operator_scope(c: Ctx):
    _prep(c)
    c.page.locator("#sp-use-op").check()
    for condition, p, u in zip(ORDER, ("1.00", "0.00", "0.00"), ("2.58", "15.00", "100.00")):
        _eqtext(c, f"#sp-est-{condition}", p, "SP-12.2-15")
        _eqtext(c, f"#sp-upper-{condition}", u, "SP-12.2-15")
    c.eq(c.page.locator("#sp-risk-chart .sp-reference").count(), 1, "SP-12.2-15 기준선 1개")
    c.expect(c.page.evaluate("""() => {
      const e=document.querySelector('#sp-risk-chart .sp-reference');
      const x=100+(3/102)*(460-100-44);
      return Math.abs(+e.getAttribute('x1')-x)<1e-8 && Math.abs(+e.getAttribute('x2')-x)<1e-8
        && +e.getAttribute('y1')===14 && +e.getAttribute('y2')===110 && e.getAttribute('stroke-dasharray')==='4 3';
    }"""), "SP-12.2-15 기준3.00 선은 상한을 자르지 않은 max102 좌표")
    _number(c, "#sp-v-fog", 45)
    c.expect(c.page.locator("#sp-use-op").is_checked(), "SP-12.2-16 토글 선택 유지")
    for sel, val in (("#sp-km-fog", "0 km"), ("#sp-est-fog", "증거 없음"), ("#sp-upper-fog", "증거 없음")):
        _eqtext(c, sel, val, "SP-12.2-16")
    _eqtext(c, "#sp-budget", "남은 시험 10/10회 · 사용 0개월", "SP-12.2-16")


def _excluded_path(c, positive):
    _prep(c)
    for condition in ("rain", "fog"):
        _number(c, f"#sp-v-{condition}", 0)
    for speed in ([60, 60, 60, 60, 40] if positive else [60, 60, 40]):
        _number(c, "#sp-tv-clear", speed)
        c.page.locator("#sp-run-clear").click()
    _number(c, "#sp-v-clear", 45)
    _number(c, "#sp-tv-clear", 45)
    for _ in range(1 if positive else 3):
        c.page.locator("#sp-run-clear").click()
    _lock(c)


def t_12_2_excluded_original(c: Ctx):
    _excluded_path(c, False)
    for sel, value in (("#sp-km-clear", "10,000 km"), ("#sp-x-clear", "1건"),
                       ("#sp-upper-clear", "4.74"), ("#sp-lowx-clear", "0건"),
                       ("#sp-permit-clear", "기준 미충족으로 불허")):
        _eqtext(c, sel, value, "SP-12.2-17")
    _questions(c, FIXED + ["sp-fog-ban", "sp-evidence", "sp-governance-R1-L1"] + END, "SP-12.2-17")


def t_12_2_excluded_positive_redecision(c: Ctx):
    _excluded_path(c, True)
    for sel, value in (("#sp-km-clear", "10,000 km"), ("#sp-x-clear", "0건"),
                       ("#sp-upper-clear", "3.00"), ("#sp-lowx-clear", "1건"), ("#sp-permit-clear", "무인 허가")):
        _eqtext(c, sel, value, "SP-12.2-18")
    _has(c, "#sp-results", "허용 속도보다 느린 시험에서 위험 상황 1건", "SP-12.2-18")
    r = _questions(c, FIXED + ["sp-fog-ban", "sp-excluded", "sp-governance-R1-L1"] + END, "SP-12.2-18")
    c.expect("제외 시험의 위험 상황 1건" in str(r["recap"]), "SP-12.2-18 recap에도 제외 사건 공개")
    c.page.locator("#sp-unlock").click()
    _number(c, "#sp-v-clear", 40)
    _lock(c)
    for sel, value in (("#sp-km-clear", "12,000 km"), ("#sp-x-clear", "1건"),
                       ("#sp-upper-clear", "3.95"), ("#sp-lowx-clear", "0건"),
                       ("#sp-permit-clear", "기준 미충족으로 불허")):
        _eqtext(c, sel, value, "SP-12.2-19")
    r = _snapshot(c)
    c.eq(len(r["game"]["tests"]), 6, "SP-12.2-19 시험6회 유지")
    c.eq(r["game"]["decisions"], 2, "SP-12.2-19 결정 횟수2")
    # 명세 12.3·수정 기록 idx 19: 현재 증거 분기의 키 유지. 변경 후에는 빠진 기록이 없고 맑음에 시험 6회가 집중되어 sp-evidence다.
    c.eq([r["qs"][3]["k"], r["qs"][3]["tag"]], ["sp-evidence", "개별 · 재결정"], "N4 변경 재결정 키·태그")
    c.expect(r["qs"][3]["q"] == "앞선 결정의 1년 결과를 본 뒤 계획을 바꾸었습니다. 무엇을 보고 바꾸었나요?",
             "SP-12.2-19 계획을 바꾼 재결정 문장")


def t_12_2_withdrawal_sensitivity(c: Ctx):
    _prep(c)
    c.page.locator("#sp-use-op").check()
    c.page.locator("#sp-rule-R2").click()
    _lock(c)
    _eqtext(c, "#sp-permit-fog", "무인 허가", "SP-12.2-20")
    _eqtext(c, "#sp-provide-fog", "허가됐지만 운영사 미제공", "SP-12.2-20")
    _output(c, {"share": "90.0%", "expected": "0.92건/년", "operator": "27.60 가상 비용단위/년"}, "SP-12.2-20")
    r = _snapshot(c)
    fog = next(x for x in r["game"]["locked"]["result"]["rows"] if x["c"] == "fog")
    c.eq(round(fog["cost"], 8), 10.5, "SP-12.2-20 안개 비용10.50 > 수입10")
    _sensitivity(c, ["90.0%", "1.84", "100.0%", "0.00", "55.20"], "SP-12.2-21")
    # 숨은 cost21은 비교 계산의 공개 API로 검사하되 원래 확정안은 보존한다.
    cost = c.page.evaluate("""id => KCP.games[id].model.evaluateAssumptions(
      KCP.load(id).game.locked.plan,{auto:.20,staff:.10}).rows.find(e=>e.c==='fog').cost""", ID)
    c.eq(round(cost, 8), 21, "SP-12.2-21 두 배 가정 안개 비용21")
    after = _snapshot(c)
    for key in ("game", "qs", "recap"):
        c.eq(after[key], r[key], f"SP-12.2-21 비교 후 원래 {key} 유지")


def t_12_2_budget_assumptions_tabs(c: Ctx):
    _prep(c)
    _number(c, "#sp-v-clear", 0)
    c.expect(c.page.locator("#sp-match-clear").is_disabled(), "SP-12.2-22 금지 상태 맞추기 비활성")
    for _ in range(10):
        c.page.locator("#sp-run-clear").click()
    c.eq(c.page.locator("#sp-log tbody tr").count(), 10, "SP-12.2-22 금지 상태에서도 시험10행 생성")
    for condition in ORDER:
        c.expect(c.page.locator(f"#sp-run-{condition}").is_disabled(), "SP-12.2-22 모든 실행 버튼 비활성")
        c.page.eval_on_selector(f"#sp-run-{condition}", "e=>e.click()")
    c.eq(c.page.locator("#sp-log tbody tr").count(), 10, "SP-12.2-22 11번째 기록 없음")
    _eqtext(c, "#sp-budget", "남은 시험 0/10회 · 사용 10개월", "SP-12.2-22")
    c.expect(c.page.evaluate("document.activeElement.id==='sp-live'"), "SP-12.2-22 예산 소진 시 live 포커스")
    c.page.locator("#sp-reason").fill(REASON)
    before = [c.page.locator(f"#sp-v-{x}").input_value() for x in ORDER]
    c.page.locator("#sp-alt-zero").click()
    _value(c, "#sp-alt", 0, "SP-12.2-23")
    c.eq(c.page.locator("#sp-reason").input_value(), REASON, "SP-12.2-23 이유 유지")
    c.eq([c.page.locator(f"#sp-v-{x}").input_value() for x in ORDER], before, "SP-12.2-23 기타 입력 유지")
    c.eq(c.page.locator("#sp-assumptions .sp-assumption .chip").all_text_contents(), ["가장 불확실"] * 3,
         "SP-12.2-24 세 가정 모두 가장 불확실")
    for liab in ("L1", "L2", "L3"):
        c.page.locator(f"#sp-liab-{liab}").click()
        c.expect(c.page.locator("#sp-liability-note").is_visible(), "SP-12.2-25 책임 주의 문구 항상 보임")
        _has(c, "#sp-liability-note", "실제 법 제도의 해설이 아닙니다.", "SP-12.2-25")
    c.page.locator("#sp-tab-people").click()
    for tab in ("vehicle", "evidence", "people"):
        selected = tab == "people"
        loc = c.page.locator(f"#sp-tab-{tab}")
        c.eq(loc.get_attribute("aria-selected"), str(selected).lower(), "SP-12.2-26 탭 선택 상태")
        c.eq(loc.get_attribute("tabindex"), "0" if selected else "-1", "SP-12.2-26 roving tabindex")
        c.eq(c.page.locator(f"#sp-pane-{tab}").is_visible(), selected, "SP-12.2-26 탭 본문 숨김")
    c.eq(c.page.locator("#sp-pane-people").get_by_text("야간 노동자·교통약자", exact=True).count(), 1,
         "SP-12.2-26 이해관계자 자료 표시")
    c.check("SP-12.1-01 표/가정판/탭 가로폭")


def t_12_2_keyboard(c: Ctx):
    aid = "SP-12.2-27"
    _prep(c)
    v = c.page.locator("#sp-v-clear")
    v.focus()
    v.press("ArrowUp")
    _value(c, "#sp-v-clear", 45, aid)
    v.press("ArrowDown")
    _value(c, "#sp-v-clear", 40, aid)
    for value, key in ((60, "ArrowUp"), (0, "ArrowDown")):
        v.fill(str(value))
        v.press("Tab")
        v.focus()
        v.press(key)
        _value(c, "#sp-v-clear", value, aid)
    _number(c, "#sp-v-clear", 40)
    # native Tab을 실제로 사용해 + 버튼으로 이동한 뒤 Space.
    v.focus()
    for _ in range(8):
        c.page.keyboard.press("Tab")
        if c.page.evaluate("document.activeElement.id==='sp-v-inc-clear'"):
            break
    c.expect(c.page.evaluate("document.activeElement.id==='sp-v-inc-clear'"), f"{aid} 스테퍼 Tab 접근")
    c.page.keyboard.press("Space")
    _value(c, "#sp-v-clear", 45, aid)
    c.page.locator("#sp-v-dec-clear").focus()
    c.page.keyboard.press("Enter")
    _value(c, "#sp-v-clear", 40, aid)
    tv = c.page.locator("#sp-tv-clear")
    tv.focus()
    tv.press("ArrowUp")
    _value(c, "#sp-tv-clear", 45, aid)
    c.page.locator("#sp-match-clear").focus()
    c.page.keyboard.press("Space")
    _value(c, "#sp-tv-clear", 40, aid)
    c.page.locator("#sp-tab-vehicle").focus()
    for key, tab in (("ArrowRight", "evidence"), ("ArrowRight", "people"),
                     ("ArrowRight", "vehicle"), ("ArrowLeft", "people"), ("Home", "vehicle"), ("End", "people")):
        c.page.keyboard.press(key)
        c.expect(c.page.evaluate("id=>document.activeElement.id===id", "sp-tab-" + tab), f"{aid} {key} 초점/선택 순환")
        c.eq(c.page.locator(f"#sp-tab-{tab}").get_attribute("aria-selected"), "true", f"{aid} 선택도 함께 변경")
    for group, choices in (("rule", ("R1", "R2", "R3")), ("liab", ("L1", "L2", "L3"))):
        for choice in choices:
            loc = c.page.locator(f"#sp-{group}-{choice}")
            loc.focus()
            loc.press("Space")
            for other in choices:
                c.eq(c.page.locator(f"#sp-{group}-{other}").get_attribute("aria-pressed"),
                     str(other == choice).lower(), f"{aid} {group} 단일 선택")
            loc.press("Tab")
            if choice != choices[-1]:
                c.expect(c.page.evaluate("id=>document.activeElement.id===id", f"sp-{group}-{choices[choices.index(choice)+1]}"),
                         f"{aid} 모든 규칙 버튼 Tab 접근")
    c.page.locator("#sp-run-clear").focus()
    c.page.keyboard.press("Enter")
    c.eq(c.page.locator("#sp-log tbody tr").count(), 1, f"{aid} Enter 시험 실행")
    c.expect(c.page.evaluate("document.activeElement.id==='sp-run-clear'"), f"{aid} 실행 뒤 버튼 초점 유지")
    c.page.locator("#sp-lock").focus()
    c.page.keyboard.press("Space")
    c.expect(c.page.locator("#sp-results").is_visible(), f"{aid} Space 확정")
    c.expect(c.page.evaluate("document.querySelector('#sp-results').contains(document.activeElement)&&document.activeElement.getAttribute('tabindex')==='-1'"),
             f"{aid} 확정 결과 제목 포커스")
    c.page.locator("#sp-unlock").focus()
    c.page.keyboard.press("Enter")
    c.expect(c.page.evaluate("document.activeElement.id==='sp-v-clear'"), f"{aid} 해제 시 허용속도 초점")
    c.page.locator("#sp-lock").focus()
    c.page.keyboard.press("Enter")
    c.page.locator("#sp-go").focus()
    c.page.keyboard.press("Enter")
    c.page.wait_for_selector(".qdeck .qcard")
    c.check(f"{aid} 키보드 면접 이동")


def t_12_3_case_c_values(c: Ctx):
    _case(c, "C")
    aid = "SP-12.3-01"
    rows = c.page.locator("#sp-log tbody tr")
    c.eq(rows.count(), 3, f"{aid} 기록3행")
    for i, count in enumerate((0, 0, 1)):
        c.expect(f"{count}건" in rows.nth(i).locator("td, th").nth(4).inner_text(), f"{aid} 회차{i+1} 위험 상황{count}건")
    for condition, km, x, est, upper, permit in zip(ORDER,
            ("32,000 km", "4,000 km", "2,300 km"), ("3건", "0건", "1건"),
            ("0.94", "0.00", "4.35"), ("2.42", "7.50", "20.61"),
            ("무인 허가", "요원 탑승 허가", "기준 미충족으로 불허")):
        for suffix, val in (("km", km), ("x", x), ("est", est), ("upper", upper), ("permit", permit), ("lowx", "0건")):
            _eqtext(c, f"#sp-{suffix}-{condition}", val, aid)
    _output(c, dict(share="90.0%", expected="0.72건/년", actual="1건", public="10.80 가상 비용단위/년",
                   operator="10.80 가상 비용단위/년", comp="100.0%", delay="3개월"), "SP-12.3-02")
    _has(c, "#sp-out-tail", "예상 0.72건일 때 1건 이상이 나올 확률은 약 51.3%", "SP-12.3-02")
    _has(c, "#sp-out-sampled", "셔틀 운행에서만", "SP-12.3-02")
    for column in ("chosen", "zero", "default"):
        _eqtext(c, f"#sp-cmp-{column}-expected", "0.72건/년", "SP-12.3-03")
    for suffix, val in {"chosen-benefit": "90.0", "chosen-reduced": "0.81건/년", "default-reduced": "0.81건/년",
                       "chosen-remaining": "0.69건/년", "default-remaining": "0.69건/년",
                       "zero-reduced": "0.00건/년", "zero-remaining": "0.00건/년",
                       # 시험 3개월 ÷ 12 × 대안 이동 위험(검토 반영 비교 행).
                       "chosen-wait": "0.20건", "zero-wait": "0.00건", "default-wait": "0.20건"}.items():
        _eqtext(c, "#sp-cmp-" + suffix, val, "SP-12.3-03")
    _sensitivity(c, ["90.0%", "1.44", "100.0%", "21.60", "21.60"], "SP-12.3-03")
    c.expect(c.page.locator("#sp-lock").is_hidden(), "SP-12.3-04 확정 버튼 숨김")
    for sel in ("#sp-unlock", "#sp-results"):
        c.expect(c.page.locator(sel).is_visible(), f"SP-12.3-04 {sel} 표시")
    c.expect(c.page.locator("#sp-go").is_enabled(), "SP-12.3-04 면접 이동 가능")
    for loc in c.page.locator('#sp-prep input, #sp-prep .sp-step, #sp-prep .sp-run, #sp-prep .sp-choice, #sp-match-clear, #sp-match-rain, #sp-match-fog, #sp-alt-zero, #sp-alt-default').all():
        c.expect(loc.is_disabled(), f"SP-12.3-04 잠금 대상 {loc.get_attribute('id')} disabled")
    c.eq(c.page.locator("#sp-reason").get_attribute("readonly") is not None, True, "SP-12.3-04 판단 이유 readOnly")
    c.expect(c.page.locator("#sp-memo").is_editable(), "SP-12.3-04 메모는 편집 가능")
    c.eq(c.page.locator("#sp-alt-compare tbody th .chip").all_text_contents(), ["근거 없는 가정"] * 4,
         "SP-12.3-03 대안 이동 가정 행에 근거 없는 가정 표시")
    for phrase in ("이동 편익 지수", "대안 이동 예상 사고 감소", "시험 기간에 셔틀이 줄일 수 있었던 대안 이동 사고 상한"):
        c.expect(phrase not in _text(c, "#sp-dependent"), f"SP-12.3-04 의존 결과에 {phrase} 없음")
        _has(c, "#sp-compare", phrase, "SP-12.3-04")
    for suffix in ("share", "expected", "actual", "public", "operator", "comp"):
        c.expect(c.page.locator(f"#sp-dependent #sp-out-{suffix}").count() == 1,
                 f"SP-12.3-04 가정 결과 묶음에 {suffix} 포함")
    _has(c, "#sp-dependent", "가정에 따라 달라지는 값 · 운영 첫 1년", "SP-12.3-04")
    c.expect(c.page.evaluate("""() => {
      const a=document.querySelector('#sp-dependent'), b=document.querySelector('#sp-compare');
      return !a.contains(b)&&!b.contains(a);
    }"""), "SP-12.3-04 별도 비교 영역")
    c.expect(c.page.evaluate("""() => [...document.querySelectorAll('.sp-table')].every(t=>
      t.querySelector('caption') && [...t.querySelectorAll('th')].every(e=>['row','col','rowgroup','colgroup'].includes(e.scope)))"""),
             "SP-12.4-11 결과를 포함한 표 caption/th scope 유지")
    if c.cfg.mobile:
        c.expect(c.page.evaluate("""() => [...document.querySelectorAll('.sp-table,#sp-assumptions')].every(e=>
          e.getBoundingClientRect().width<=document.querySelector('#prep-body').clientWidth+1
          && e.parentElement.scrollWidth<=e.parentElement.clientWidth+1)"""),
                 "SP-12.1-01 모바일 결과 표/가정판 내부 가로 스크롤 없음")
    c.check("SP-12.1-01 사례C 결과/민감도 표")


def t_12_3_case_c_save_redecision(c: Ctx):
    _case(c, "C")
    first = _state(c)
    c.eq(first.get("game", {}).get("decisions"), 1, "SP-12.3-05 첫 확정1회")
    _reload(c)
    c.eq(_state(c).get("game"), first["game"], "SP-12.3-05 reload 후 게임 수치/locked/횟수 동일")
    _output(c, {"actual": "1건", "expected": "0.72건/년"}, "SP-12.3-05")
    c.page.locator("#sp-unlock").click()
    c.expect(c.page.locator("#sp-results").is_hidden(), "SP-12.3-06 해제 후 결과 숨김")
    c.eq(c.page.locator("#sp-results").inner_html().strip(), "", "SP-12.3-06 결과/비교 내용 제거")
    c.eq(c.page.locator('[id^="sp-cmp-"]').count(), 0, "SP-12.3-06 비교 수치 DOM 제거")
    c.expect(c.page.locator("#sp-go").is_disabled(), "SP-12.3-06 면접 버튼 비활성")
    _eqtext(c, "#sp-budget", "남은 시험 7/10회 · 사용 3개월", "SP-12.3-06")
    c.eq(c.page.locator("#sp-log tbody tr").count(), 3, "SP-12.3-06 시험 기록 유지")
    c.eq(c.page.locator("#sp-reason").input_value(), REASON, "SP-12.3-06 이유 유지")
    c.eq(c.page.locator("#sp-memo").input_value(), MEMO, "SP-12.3-06 메모 유지")
    c.eq(_state(c)["game"]["decisions"], 1, "SP-12.3-06 해제는 횟수 증가 안 함")
    _lock(c)
    _output(c, {"actual": "1건"}, "SP-12.3-06")
    # 명세 12.3(932행)·idx 19: 같은 계획 재확정은 개별 2 질문의 k를 유지한다.
    r = _questions(c, C_KEYS, "SP-12.3-06")
    c.eq(r["game"]["decisions"], 2, "SP-12.3-06 재확정2회")
    c.expect(any(x["t"] == "상태" and x["d"] == "허가 결정 확정 · 2번째 결정" for x in r["recap"]),
             "SP-12.3-06 recap 결정 횟수")
    # 검토 반영: 계획을 바꾸지 않고 다시 확정하면 '바꾸었다'고 묻지 않는다.
    # N1: 뒤에 증거 질문을 덧붙이지 않으므로 끝 공백 없이 전문을 비교한다.
    c.expect(r["qs"][3]["q"] == "앞선 결정의 1년 결과를 본 뒤에도 같은 계획으로 다시 결정했습니다. 무엇을 보고 그대로 두었나요?",
             "SP-12.3-06 계획을 유지한 재결정 선행 문장")
    c.expect("계획을 바꾸었습니다" not in str(r["qs"]), "SP-12.3-06 바꾸지 않은 계획에 변경 질문 없음")


def t_12_4_case_c_room(c: Ctx):
    _case(c, "C")
    r = _questions(c, C_KEYS, "SP-12.4-01")
    c.page.locator("#sp-memo").fill("공통 메모만 고쳤다.")
    _flush(c)
    c.eq(_snapshot(c)["qs"], r["qs"], "SP-12.4-02 메모 수정은 확정 질문에 영향 없음")
    c.page.locator("#sp-go").click()
    c.page.wait_for_selector(".qdeck .qcard")
    cards = c.page.locator(".qdeck .qcard")
    c.eq(cards.count(), 7, "SP-12.4-02 면접 질문7개")
    c.expect(6 <= cards.count() <= 9, "SP-12.5-08 창작 면접 질문6~9개")
    for card in cards.all():
        c.expect("연습용 질문" in card.inner_text(), "SP-12.5-08 모든 카드 연습용 표시")
        c.expect("보고서 문항" not in card.inner_text(), "SP-12.5-08 보고서 문항 표시 없음")
    for phrase in ("불허되었습니다", "쉬운 구간에 치우쳤을 가능성", "공공이 보상의 절반"):
        _has(c, ".qdeck", phrase, "SP-12.4-02")
    c.check("SP-12.1-01 면접실 질문 가로폭")


def t_12_4_case_b(c: Ctx):
    _case(c, "B")
    r = _questions(c, FIXED + ["sp-boundary", "sp-spread", "sp-governance-R2-L2"] + END, "SP-12.4-03")
    for text in ("안개 낀 밤", "60 km/h", "32.89 km/h"):
        c.expect(text in r["qs"][2]["q"], f"SP-12.4-03 최우선 초과 조건 {text}")
    for condition in ORDER:
        _value(c, f"#sp-v-{condition}", 60, "SP-12.4-03")
    _output(c, dict(share="65.0%", expected="0.52건/년", actual="0건", operator="6.24 가상 비용단위/년"), "SP-12.4-03")
    _has(c, "#sp-results", "올해 관측한 보상률은 계산하지 않음", "SP-12.4-03")
    c.eq(c.page.locator("#sp-out-tail").count(), 0, "SP-12.4-03 실현 0건이면 꼬리 확률 문장 없음")
    _eqtext(c, "#sp-cmp-chosen-wait", "0.49건", "SP-12.4-03")


def t_12_4_case_a(c: Ctx):
    _case(c, "A")
    r = _questions(c, FIXED + ["sp-fog-ban", "sp-evidence", "sp-governance-R1-L1"] + END, "SP-12.4-04")
    q = r["qs"][3]["q"]
    # N1: 단일 요청으로 줄이며 삭제한 시험 시작 기준 보조 질문은 요구하지 않는다.
    for phrase in ("추가 시험을 하지 않았습니다.", "증거가 없는 조건", "어떻게 다루었나요?"):
        c.expect(phrase in q, f"SP-12.4-04 전면금지 자료선택 질문 {phrase}")
    c.expect(not re.search(r"0개월|기다림의 비용|더 늦어졌", q), "SP-12.4-04 시험0회의 지연 비용 단정 없음")
    _output(c, dict(share="0.0%", expected="0.00건/년", actual="0건"), "SP-12.4-04")
    c.eq(c.page.locator("#sp-out-tail").count(), 0, "SP-12.4-04 예상·실현 0건이면 꼬리 확률 문장 없음")
    c.expect("0.00건일 때" not in _text(c, "#sp-results"), "SP-12.4-04 무의미한 확률 문장 없음")


def t_12_4_case_d(c: Ctx):
    _case(c, "D")
    _questions(c, FIXED + ["sp-fog-ban", "sp-concentrate", "sp-governance-R1-L1"] + END, "SP-12.4-04")
    _eqtext(c, "#sp-upper-clear", "2.37", "SP-12.4-04")
    _output(c, dict(share="65.0%", expected="0.52건/년", actual="0건", operator="15.60 가상 비용단위/년"), "SP-12.4-04")
    _eqtext(c, "#sp-cmp-default-reduced", "0.59건/년", "SP-12.4-04")
    _eqtext(c, "#sp-cmp-default-remaining", "0.92건/년", "SP-12.4-04")
    _eqtext(c, "#sp-cmp-chosen-waitShuttle", "0.43건", "SP-12.4-04")
    _eqtext(c, "#sp-cmp-chosen-waitNet", "0.05건", "SP-12.4-04")
    _eqtext(c, "#sp-cmp-zero-waitNet", "-0.43건", "SP-12.4-04")
    # 결함 5: 1.50×0.6×0.65×10/12=0.4875, 셔틀 0.52×10/12=0.433333, 순감소 0.054167.
    for column, value in (("chosen", "0.49건"), ("zero", "0.00건"), ("default", "0.49건")):
        _eqtext(c, f"#sp-cmp-{column}-wait", value, "SP-12.4-04")


def t_12_4_case_e(c: Ctx):
    _case(c, "E")
    r = _questions(c, FIXED + ["sp-fog-permit", "sp-outlier", "sp-governance-R2-L2"] + END, "SP-12.4-04")
    _output(c, dict(share="100.0%", expected="1.27건/년", actual="2건", operator="15.24 가상 비용단위/년"), "SP-12.4-04")
    _has(c, "#sp-out-tail", "36.3%", "SP-12.4-04")
    for phrase in ("36.3%", "실현 사고는 2건", "예상 1.27건"):
        c.expect(phrase in r["qs"][3]["q"], f"SP-12.4-04 결과변동 질문에 {phrase}")
    c.expect("운영사 자료" not in r["qs"][3]["q"], "SP-12.4-04 결과변동 질문에 운영사 질문을 덧붙이지 않음")
    _sensitivity(c, ["100.0%", "2.54", "40.0%", "0.00", "30.48"], "SP-12.4-04")


def t_12_4_liability_answers_and_keys(c: Ctx):
    _case(c, "C")
    before = _questions(c, C_KEYS, "SP-12.4-05")
    c.page.locator("#sp-go").click()
    c.page.wait_for_selector(".qdeck .qcard")
    c.page.locator('textarea[data-a="4"]').fill("공동 기금에 대한 가상 답변 메모")
    _flush(c)
    c.phase("reflect")
    c.page.locator('table.rubric button[data-v="2"]').first.click()
    _flush(c)
    common = _snapshot(c)
    c.phase("prep")
    c.page.locator("#sp-unlock").click()
    _number(c, "#sp-alt", 0)
    _lock(c)
    same = _snapshot(c)
    c.eq([q["k"] for q in same["qs"]], [q["k"] for q in before["qs"]], "SP-12.4-05 수치만 변경하면 키 유지")
    c.page.locator("#sp-unlock").click()
    c.page.locator("#sp-liab-L2").click()
    _lock(c)
    now = _questions(c, FIXED + ["sp-fog-denied", "sp-op", "sp-governance-R3-L2"] + END, "SP-12.4-05")
    c.expect("알고리즘과 운행 기록에 접근하기 어렵다면" in now["qs"][4]["q"], "SP-12.4-05 L2 입증 접근 질문")
    for key in ("answers", "rubric", "memo"):
        c.eq(now[key], common[key], f"SP-12.4-05 재심사/배타적 질문 변경에도 공통 {key} 보존")


def t_12_4_unconfirmed_common_phases(c: Ctx):
    _prep(c)
    _flush(c)
    c.page.evaluate("KCP.goPhase('room')")
    c.page.wait_for_selector(".qdeck .qcard")
    r = _questions(c, UNLOCKED + END, "SP-12.4-06")
    c.eq(c.page.locator(".qdeck .qcard").count(), 6, "SP-12.4-06 공통 단계 이동은 일반 질문6개")
    c.expect(not re.search(r"실현 사고는|모형의 예상|숨은 기저|32\.89", str(r["qs"])), "SP-12.4-06 미확정 질문 숨은 결과 없음")
    c.expect(not any(x["t"] in ("조건별 결정", "가정에 따라 달라지는 1년 결과") for x in r["recap"]),
             "SP-12.4-06 미확정 recap에 결정/연간 항목 없음")
    _has(c, ".recap", "아직 확정하지 않음", "SP-12.4-06")
    c.check("SP-12.1-01 미확정 면접실")
    c.page.evaluate("KCP.goPhase('reflect')")
    c.page.wait_for_selector("table.rubric")
    c.eq(c.page.locator("#sp-science, #sp-model-limits, [id^='sp-example-']").count(), 0,
         "SP-12.4-06 미확정 성찰에 과학/예시/숨은 설정 생성 안 함")
    _has(c, "#exwrap", "아직 허가를 확정하지 않았습니다.", "SP-12.4-06")
    c.check("SP-12.1-01 미확정 성찰")


def t_12_4_reflection_gate(c: Ctx):
    _case(c, "C")
    c.phase("reflect")
    c.page.wait_for_selector("table.rubric")
    heads = c.page.locator("#phase h3").all_text_contents()
    c.expect(any("자기 평가" in x and "연습용 평가 기준" in x for x in heads), "SP-12.5-08 자기 평가 머리 연습용 기준")
    c.expect(any("설계 의도" in x for x in heads), "SP-12.5-08 설계 의도 머리")
    c.expect(c.page.locator("#exwrap").is_hidden(), "SP-12.4-07 관문 열기 전 예시 숨김")
    c.expect(c.page.locator("#sp-reflect").is_hidden(), "SP-12.4-07 예시 내용도 보이지 않음")
    c.expect(c.page.locator("#openEx").is_disabled(), "SP-12.4-07 빈 기준에서는 열기 disabled")
    c.page.locator("#before-" + ID).fill("123456789")
    c.expect(c.page.locator("#openEx").is_disabled(), "SP-12.4-07 10자 미만 열기 disabled")
    c.page.locator("#before-" + ID).fill("1234567890")
    c.expect(c.page.locator("#openEx").is_enabled(), "SP-12.4-07 정확히10자부터 열기 가능")
    c.page.locator("#before-" + ID).fill("이동 접근성보다 사전 안전 증거를 무겁게 두었다.")
    c.page.locator("#openEx").click()
    c.expect(c.page.locator("#exwrap #sp-reflect").is_visible(), "SP-12.4-07 공통 관문 뒤 내용 표시")
    # N7: 면접에서 성찰로 옮긴 두 질문은 관문을 연 뒤 실제로 표시되어야 한다.
    for phrase in ("사람 운전자의 위험도가 추정치라는 점", "12개월 재심사로도 남는 것은 무엇인가요?"):
        prompt = c.page.locator("#sp-reflect .sp-reflect-prompt").filter(has_text=phrase)
        c.eq(prompt.count(), 1, f"N7 성찰 질문 한 번 표시: {phrase}")
        c.expect(prompt.is_visible(), f"N7 성찰 질문 보임: {phrase}")
    details = c.page.locator("#sp-reflect details.reveal")
    c.eq(details.count(), 5, "SP-12.4-07 details.reveal 5개")
    for loc in details.all():
        c.expect(loc.get_attribute("open") is None, "SP-12.4-07 모든 details 처음 닫힘")
    for suffix in ("mobility", "proof", "staged"):
        loc = c.page.locator("#sp-example-" + suffix)
        # 닫힌 details의 내용도 text_content로 문안 계약을 확인한다.
        for phrase in ("가상의 답", "기준과 무게:", "선택:", "얻는 것과 잃는 것:", "약점:", "반문 뒤:"):
            c.expect(phrase in loc.text_content(), f"SP-12.4-07 {suffix} 예시 구성 {phrase}")
        summary = loc.locator("summary")
        summary.focus()
        summary.press("Enter")
        c.expect(loc.get_attribute("open") is not None, "SP-12.4-07 Enter로 예시 열기")
    c.eq(c.page.locator("#sp-reflect button, #sp-reflect textarea").count(), 0, "SP-12.4-07 게임 자체 관문/열기 버튼 없음")
    # 검토 반영: 과학 맥락·심각도·안개 기저율·실제 제도 연결(실제 법 해설이 아님)을 해설에 둔다.
    science = c.page.locator("#sp-science").text_content()
    for phrase in ("2억 7,500만 마일", "Kalra·Paddock, 2016", "약 17%", "상한 5.26", "Kalra·Groves, 2017",
                   "μ≈0.41~0.56", "레이더", "센서 융합", "제동력이 최대에 이르는 시간"):
        c.expect(phrase in science, f"SP-12.4-07 과학 해설 {phrase}")
    # 결함 11: 안개를 허가한 두 예시에 같은 기저율 한계를 표시한다.
    for suffix in ("mobility", "staged"):
        body = c.page.locator("#sp-example-" + suffix).text_content()
        c.expect("3.5는 비교 기준 3.0" in body, f"결함 11 {suffix} 안개 위험 한계")
    limits = c.page.locator("#sp-model-limits").text_content()
    for phrase in ("½mv²", "같은 무게로 셉니다", "어느 속도에서도 안개의 숨은 위험 상황률이 기준 아래로 내려가지 않습니다",
                   "운행가능영역(ODD", "레벨 4", "2025년 3월 20일", "이 문장은 실제 법 제도의 해설이 아닙니다",
                   "결정 전에도", "셔틀에서만 뽑고"):
        c.expect(phrase in limits, f"SP-12.4-07 숨은 설정 해설 {phrase}")
    c.expect("시험 10개월 동안 줄일 수 있었던 대안 이동 사고 상한은 0.49건" in c.page.locator("#sp-example-proof").text_content(),
             "SP-12.4-07 사전 입증 예시의 기간 일치 상한")
    c.expect(c.page.evaluate("id=>!('afterReflect' in KCP.games[id])", ID), "SP-12.4-07 자체 afterReflect 없음")
    c.check("SP-12.1-01 열린 성찰 예시")


def t_12_4_xss(c: Ctx):
    payload = "<img src=x onerror=alert(1)>"
    dialogs = []
    c.page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    _prep(c)
    baseline = (len(c.rec["console"]), len(c.rec["pageerrors"]))
    c.page.locator("#sp-reason").fill(payload)
    c.page.locator("#sp-memo").fill(payload)
    _lock(c)
    _reload(c)
    c.eq(c.page.locator("#sp-reason").input_value(), payload, "SP-12.4-08 reason 평문 저장/복원")
    c.eq(c.page.locator("#sp-memo").input_value(), payload, "SP-12.4-08 메모 평문 저장/복원")
    r = _snapshot(c)
    c.expect(any(x["t"] == "판단 설명" and x["d"] == payload for x in r["recap"]), "SP-12.4-08 recap에 원문 평문")
    c.phase("room")
    c.eq(c.page.locator(".recap img").count(), 0, "SP-12.4-08 recap에서 img 생성 안 함")
    _has(c, ".recap", payload, "SP-12.4-08")
    c.eq(dialogs, [], "SP-12.4-08 스크립트 실행 없음")
    c.eq((len(c.rec["console"]), len(c.rec["pageerrors"])), baseline, "SP-12.4-08 콘솔/페이지 오류 증가 없음")


def _corrupt_case(game, warning=False, expected=None):
    def run(c: Ctx):
        baseline = len(c.rec["pageerrors"])
        _inject(c, copy.deepcopy(game), memo=MEMO)
        c.expect(c.page.locator("#sp-prep").is_visible(), "SP-12.4-10 손상 저장 복구 후 준비실 표시")
        c.eq(c.page.locator("#sp-memo").input_value(), MEMO, "SP-12.4-10 공통 메모 유지")
        c.eq(len(c.rec["pageerrors"]), baseline, "SP-12.4-10 손상 저장 복구 페이지 오류 없음")
        notice = c.page.get_by_text(RESET_NOTICE, exact=True)
        c.eq(notice.count(), 1 if warning else 0, "SP-12.4-09 version 불일치에만 초기화 안내1회")
        for sel, value in (expected or {"#sp-v-clear": 40, "#sp-v-rain": 40, "#sp-v-fog": 30}).items():
            _value(c, sel, value, "SP-12.4-10")
        c.expect(c.page.locator("#sp-results").is_hidden(), "SP-12.4-09 부적절한 locked는 해제")
        c.page.locator("#sp-run-clear").click()
        c.expect(c.page.locator("#sp-log tbody tr").count() >= 1, "SP-12.4-10 복구 뒤 시험 실행 가능")
        c.wait_saved(400)
        c.expect(not re.search(r'"(?:NaN|Infinity)"|\bNaN\b|\bInfinity\b', json.dumps(_state(c).get("game"))),
                 "SP-12.4-10 잘못된 수치 저장 안 함")
        if warning:
            _reload(c)
            c.eq(c.page.get_by_text(RESET_NOTICE, exact=True).count(), 0, "SP-12.4-09 버전 안내 reload 후 반복 없음")
        c.check("SP-12.1-01 손상 저장 복구")
    return run


# 각각 독립 함수라 harness가 각각 새 context에서 실행한다.
t_12_4_corrupt_empty = _corrupt_case({})
t_12_4_corrupt_no_version = _corrupt_case({"v": {"clear": 60}})
t_12_4_corrupt_string = _corrupt_case("손상된 game 문자열")
t_12_4_corrupt_array = _corrupt_case([1, 2, 3])
t_12_4_corrupt_number = _corrupt_case(999)
t_12_4_corrupt_nan_string = _corrupt_case(_game(v={"clear": "NaN", "rain": "40", "fog": "Infinity"}))
t_12_4_corrupt_tests_nonarray = _corrupt_case(_game(tests="잘못된 기록"))
t_12_4_corrupt_unknown_condition = _corrupt_case(_game(tests=[{"c": "unknown", "v": 40, "x": 999, "n": 99}]))
t_12_4_corrupt_out_of_range = _corrupt_case(_game(v={"clear": 999, "rain": -10, "fog": 27},
    assume={"auto": 2, "staff": 3, "proof": -1, "alt": 9}), expected={
        "#sp-v-clear": 60, "#sp-v-rain": 0, "#sp-v-fog": 25,
        "#sp-auto": .2, "#sp-staff": .2, "#sp-proof": 0, "#sp-alt": 3})
t_12_4_corrupt_version = _corrupt_case(_game(version=2), warning=True)
t_12_4_corrupt_locked_version = _corrupt_case(_game(locked={"modelVersion": 2, "plan": {}, "result": {}}))
t_12_4_corrupt_locked_plan = _corrupt_case(_game(locked={"modelVersion": 1, "plan": {"v": "bad"}, "result": {}}))


def t_12_4_normalization_locked(c: Ctx):
    _case(c, "C")
    saved = _state(c)
    saved["game"]["locked"]["result"] = {"actual": 999, "expected": 999}
    _inject(c, saved["game"], memo=MEMO)
    _output(c, {"actual": "1건", "expected": "0.72건/년"}, "SP-12.4-09")
    c.page.locator("#sp-memo").fill(MEMO)  # 정규화된 메모리 상태를 일반 save 콜백으로 저장.
    _flush(c)
    c.eq(_snapshot(c)["game"]["decisions"], 1, "SP-12.4-09 파생값 재계산은 결정 횟수 유지")
    legacy = copy.deepcopy(saved["game"])
    del legacy["locked"]["plan"]["decisions"]
    legacy.pop("decisions")
    _inject(c, legacy, memo=MEMO)
    c.page.locator("#sp-memo").fill(MEMO)
    _flush(c)
    c.eq(_snapshot(c)["game"]["decisions"], 1, "SP-12.4-09 기존 locked 횟수 없으면1 복원")
    mismatch = copy.deepcopy(saved["game"])
    mismatch["v"]["clear"] = 45
    _inject(c, mismatch, memo=MEMO)
    _value(c, "#sp-v-clear", 45, "SP-12.4-10")
    c.expect(c.page.locator("#sp-results").is_hidden(), "SP-12.4-10 현재 입력과 locked 불일치는 해제")
    decisions_mismatch = copy.deepcopy(saved["game"])
    decisions_mismatch["decisions"] = 2
    _inject(c, decisions_mismatch, memo=MEMO)
    c.expect(c.page.locator("#sp-results").is_hidden(), "SP-12.4-09 locked/current 결정 횟수 불일치 해제")
    # x,n 변조를 무시하고 유효 c,v만 순서대로 재생.
    tampered = _game(tests=[{"c": "clear", "v": 40, "x": 99, "n": 99}] * 12)
    _inject(c, tampered, memo=MEMO)
    _lock(c)
    tests = _snapshot(c)["game"]["tests"]
    c.eq([x["x"] for x in tests], [0, 0, 0, 0, 1, 0, 0, 0, 0, 0], "SP-12.4-10 저장x 변조 무시/첫10개 재생")
    c.eq([x["n"] for x in tests], list(range(1, 11)), "SP-12.4-10 내부 순번 재구성")


def t_12_4_storage_blocked(c: Ctx):
    c.goto("#home", wait=".home-grid")
    _flush(c)
    c.page.add_init_script("""for(const method of ['getItem','setItem','removeItem'])
      Storage.prototype[method]=function(){throw new DOMException('검사용 저장 차단','SecurityError')};""")
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    _prep(c)
    c.page.locator("#sp-run-clear").click()
    c.eq(c.page.locator("#sp-log tbody tr").count(), 1, "SP-12.4-10 저장 차단에도 한 세션 시험 가능")
    _lock(c)
    c.expect(c.page.locator("#sp-results").is_visible(), "SP-12.4-10 저장 차단에도 한 세션 확정 가능")
    c.check("SP-12.1-01 저장 차단 세션")


def t_12_4_input_recovery(c: Ctx):
    _prep(c)
    loc = c.page.locator("#sp-v-clear")
    loc.focus()
    loc.fill("")
    c.eq(loc.input_value(), "", "SP-12.4-10 타이핑 중 빈 값 허용")
    c.expect(c.page.evaluate("document.activeElement.id==='sp-v-clear'"), "SP-12.4-10 입력 중 초점 유지")
    loc.press("Tab")
    _value(c, "#sp-v-clear", 40, "SP-12.4-10")
    _number(c, "#sp-auto", .03)
    _value(c, "#sp-staff", .03, "SP-12.4-10")
    _has(c, "#sp-live", "요원 전환 비율을", "SP-12.4-10")
    _has(c, "#sp-live", "함께 조정했습니다.", "SP-12.4-10")
    for sel in ("#sp-auto", "#sp-staff", "#sp-proof", "#sp-alt"):
        ids = (c.page.locator(sel).get_attribute("aria-describedby") or "").split()
        c.expect(bool(ids), f"SP-12.4-10 {sel} 영향/범위 설명 연결")
        c.expect(all(c.page.locator('[id="' + x + '"]').count() == 1 for x in ids), f"SP-12.4-10 설명 참조 유효")


def t_12_4_svg_labels_and_mobile(c: Ctx):
    _prep(c)
    for rain, fog in ((30, 30), (35, 30)):
        _number(c, "#sp-v-rain", rain)
        _number(c, "#sp-v-fog", fog)
        labels = c.page.eval_on_selector_all("#sp-boundary-svg text", r"""es=>es.filter(e=>/^(맑음|비|안개) \d+$/.test(e.textContent.trim()))
          .map(e=>{const b=e.getBBox();return {text:e.textContent.trim(),y:+e.getAttribute('y'),box:{x:b.x,y:b.y,width:b.width,height:b.height}}})""")
        c.eq(len(labels), 3, "SP-12.4-11 짧은 점 라벨3개")
        for i, label in enumerate(labels):
            for other in labels[:i]:
                c.expect(abs(label["y"] - other["y"]) >= 14, "SP-12.4-11 점 라벨 y 간격14 이상")
            box = label["box"]
            c.expect(box["x"] >= 0 and box["x"] + box["width"] <= 460 and box["y"] + box["height"] <= 300,
                     "SP-12.4-11 라벨은 SVG 범위 안")
        c.expect(not re.search(r"감속도|운행 금지 선택|정지 조건", c.page.locator("#sp-boundary-svg text").all_text_contents().__str__()),
                 "SP-12.4-11 긴 상태 문구는 SVG text에 없음")
        c.check("SP-12.4-11 같은/인접 속도 점 라벨 가로폭")
    svg = c.page.locator("#sp-boundary-svg")
    c.eq(svg.get_attribute("viewBox"), "0 0 460 300", "SP-12.4-11 차트 좌표계")
    c.eq(svg.get_attribute("aria-labelledby"), "sp-chart-title sp-chart-desc", "SP-12.4-11 title/desc 참조")
    for sel in ("#sp-bound-low", "#sp-bound-high", "#sp-band-area", "#sp-exceed-area"):
        # 명세는 이 이름들을 class로 지정한다. id에 의존하지 않는다.
        cls = sel[1:]
        count = c.page.locator("#sp-boundary-svg ." + cls).count()
        if cls == "sp-exceed-area":
            # 명세 4.2·7.2: 상한 초과 영역과 R<5의 '여유 거리 부족' 배경을
            # 함께 그린다. class는 여러 도형에 공유할 수 있으며 개수는 정하지 않았다.
            # 초과 영역 존재는 유지하되 도형 분할 개수에 대한 단언만 제거한다.
            c.expect(count >= 1, "SP-12.4-11 초과 영역 존재")
        else:
            c.eq(count, 1, "SP-12.4-11 경계선/띠 영역")
    c.expect(c.page.evaluate("""() => {
      const svg=document.querySelector('#sp-boundary-svg'), s=getComputedStyle(svg);
      const clip=document.querySelector('#sp-plot-clip');
      return !!clip && s.maxWidth==='100%' && svg.getBoundingClientRect().width<=svg.parentElement.getBoundingClientRect().width+1
        && svg.getAttribute('tabindex')===null && !!svg.querySelector('[clip-path]');
    }"""), "SP-12.4-11 SVG 반응형 크기/clipPath/비조작")
    # CSS Typed OM 대신 CSSOM 선언에서 width/height/max-width 원문을 확인한다.
    c.expect(c.page.evaluate("""() => {
      const svg=document.querySelector('#sp-boundary-svg'), props={};
      function walk(rs){for(const r of rs){
        if(r.selectorText&&svg.matches(r.selectorText)) for(const p of ['width','height','max-width'])
          if(r.style.getPropertyValue(p)) props[p]=r.style.getPropertyValue(p).trim();
        if(r.cssRules) walk(r.cssRules);
      }}
      for(const s of document.styleSheets) if((s.href||'').includes('s-shuttle-permit.css')) walk(s.cssRules);
      for(const p of ['width','height','max-width']) if(svg.style.getPropertyValue(p)) props[p]=svg.style.getPropertyValue(p).trim();
      return props.width==='100%'&&props.height==='auto'&&props['max-width']==='100%';
    }"""), "SP-12.4-11 SVG width100% heightauto max-width100%")
    c.expect(c.page.evaluate("""() => {
      const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return new Set(ids).size===ids.length;
    }"""), "SP-12.4-11 중복 id 없음")
    if c.cfg.mobile:
        for sel in ("#sp-evidence-table", "#sp-log", "#sp-assumptions"):
            c.expect(c.page.eval_on_selector(sel, "e=>e.scrollWidth<=e.clientWidth+1"), f"SP-12.1-01 {sel} 내부 가로 스크롤 없음")
        c.expect(c.page.evaluate("""() => [...document.querySelectorAll('.sp-table td:not([colspan])')].every(td=>
          [...td.querySelectorAll('[aria-hidden="true"]')].some(e=>e.getBoundingClientRect().height>0&&e.textContent.trim()))"""),
                 "SP-12.4-11 모바일 표 각 셀에 보이는 중복낭독 제외 라벨")


def t_12_4_contrast_and_accessibility(c: Ctx):
    _prep(c)
    _number(c, "#sp-v-fog", 40)
    # c.contrast는 현재 c.cfg.scheme에서 실제 계산한 전경/배경을 사용한다.
    for sel in ("#sp-zone-clear", "#sp-zone-rain", "#sp-zone-fog", "#sp-liability-note", "#sp-assumption-conversion .chip",
                "#sp-assumption-proof .chip", "#sp-assumption-alt .chip", "#sp-budget", "#sp-lock"):
        ratio = c.contrast(sel)
        c.expect(ratio is not None and ratio >= 4.5, f"SP-12.4-12 {c.cfg.scheme} {sel} 글자 대비4.5 이상 (실제 {ratio})")
    c.expect(c.page.evaluate("""() => {
      const probe=document.createElement('span');probe.style.color='var(--ink)';
      document.querySelector('#sp-prep').append(probe);const ink=getComputedStyle(probe).color;probe.remove();
      return ['clear','rain','fog'].every(c=>getComputedStyle(document.querySelector('#sp-zone-'+c)).color===ink);
    }"""), "SP-12.4-12 상태 문구 본문색은 ink, 상태색은 도형에만 사용")
    c.expect(c.page.evaluate("""() => [...document.querySelectorAll('#sp-prep button, #sp-prep input[type=number]')]
      .filter(e=>e.getBoundingClientRect().height>0).every(e=>e.getBoundingClientRect().height>=44)"""),
             "SP-12.4-12 버튼/숫자 입력 높이44px 이상")
    c.expect(c.page.evaluate("""() => [...document.querySelectorAll('#sp-prep button')].every(e=>e.tagName==='BUTTON')
      && [...document.querySelectorAll('#sp-prep input[type=number]')].every(e=>
        document.querySelector('label[for="'+e.id+'"]') || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))"""),
             "SP-12.4-12 native 버튼/숫자 입력 이름")
    c.page.locator("#sp-v-clear").focus()
    c.page.keyboard.press("Tab")
    focus = c.page.evaluate("""() => {const s=getComputedStyle(document.activeElement);
      return {width:s.outlineWidth,style:s.outlineStyle,offset:s.outlineOffset,color:s.outlineColor};}""")
    c.eq([focus["width"], focus["style"], focus["offset"]], ["2px", "solid", "2px"], "SP-12.4-12 focus-visible 명시 윤곽")
    # 비문자 대비는 실제 합성 배경에 대한 별도 계산, 3:1 이상.
    contrast = c.page.evaluate(r"""() => {
      function rgb(s){const m=s.match(/rgba?\(([^)]+)\)/);return m?m[1].split(',').map(Number):null;}
      function luminance(c){const a=c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
      function blend(f,b){const a=f.length>3?f[3]:1;return f.slice(0,3).map((v,i)=>a*v+(1-a)*b[i]);}
      function background(e){const layers=[];for(let p=e;p;p=p.parentElement){const c=rgb(getComputedStyle(p).backgroundColor);if(c)layers.push(c);}
        return layers.reverse().reduce((b,f)=>blend(f,b),[255,255,255]);}
      function ratio(f,b){const a=luminance(f),c=luminance(b);return (Math.max(a,c)+.05)/(Math.min(a,c)+.05);}
      const out=[];
      for(const e of document.querySelectorAll('.sp-bound-low,.sp-bound-high,#sp-point-clear,#sp-point-rain,#sp-point-fog')) {
        const shape=e.matches('path,circle,rect,polygon,line')?e:e.querySelector('path,circle,rect,polygon,line');
        if(!shape) {out.push({name:e.id||e.className.baseVal,ratio:0});continue;}
        const fg=rgb(getComputedStyle(shape).stroke),bg=background(shape),surrounds=[bg];
        const areaSelector=e.matches('.sp-bound-low,.sp-bound-high')||e.dataset.spZone==='band'
          ? '.sp-band-area':e.dataset.spZone==='above'?'.sp-exceed-area':null;
        const area=areaSelector?document.querySelector(areaSelector):null;
        if(area){const fill=rgb(getComputedStyle(area).fill);if(fill)surrounds.push(blend(fill,bg));}
        out.push({name:e.id||e.className.baseVal,ratio:fg?Math.min(...surrounds.map(b=>ratio(blend(fg,b),b))):0});
      }
      const el=document.activeElement,s=getComputedStyle(el),fg=rgb(s.outlineColor);
      const bg=background(el.parentElement);
      out.push({name:'focus',ratio:fg?ratio(blend(fg,bg),bg):0});
      return out;
    }""")
    for item in contrast:
        c.expect(item["ratio"] >= 3, f"SP-12.4-12 {c.cfg.scheme} 비문자 {item['name']} 대비3 이상 (실제 {item['ratio']})")
    c.eq(c.page.locator("#sp-live").get_attribute("role"), "status", "SP-12.4-12 요약 상태 알림")
    c.eq(c.page.locator("#sp-live").get_attribute("aria-live"), "polite", "SP-12.4-12 알림 polite")
    c.eq(c.page.locator("#sp-live").get_attribute("aria-atomic"), "true", "SP-12.4-12 요약 알림 atomic")
    c.eq(c.page.locator('.sp-table[aria-live], #sp-memo[aria-live]').count(), 0, "SP-12.4-12 큰 표/메모 전체 live 아님")
    c.check("SP-12.1-01 테마별 대비/접근성 준비실")


def t_12_4_point_shapes(c: Ctx):
    _prep(c)
    signatures = []
    for speed, zone in ((0, "ban"), (30, "below"), (35, "band"), (40, "above")):
        _number(c, "#sp-v-fog", speed)
        c.eq(c.page.locator("#sp-point-fog").get_attribute("data-sp-zone"), zone,
             f"SP-12.4-12 {zone} 상태를 도형과 함께 명시")
        marker = c.page.evaluate("""() => {
          const e=document.querySelector('#sp-point-fog');
          const s=typeof e.getTotalLength==='function'?e:e.querySelector('circle,rect,polygon,path');
          if(!s||typeof s.getTotalLength!=='function') return null;
          const b=s.getBBox(), length=s.getTotalLength(),cs=getComputedStyle(s);
          if(!b.width||!b.height) return null;
          const points=Array.from({length:40},(_,i)=>{const p=s.getPointAtLength(length*i/40);
            return [Math.round(100*(p.x-b.x)/b.width),Math.round(100*(p.y-b.y)/b.height)];});
          const probe=document.createElementNS('http://www.w3.org/2000/svg','rect');
          s.parentNode.append(probe);
          const surfaces=['--sheet','--sheet-2'].map(v=>{
            probe.style.fill='var('+v+')';return getComputedStyle(probe).fill;
          });
          probe.remove();
          return {signature:JSON.stringify(points),fill:cs.fill,opacity:cs.fillOpacity,tag:s.tagName,surfaces};
        }""")
        c.expect(marker is not None, f"SP-12.4-12 {zone} 색 외에 실제 SVG 도형 존재")
        if marker is not None:
            signatures.append(marker["signature"])
            if zone == "ban":
                # 명세 4.2·11: '빈 사각형'은 외곽선 도형이며 투명 채움만을
                # 요구하지 않는다. 공통 바탕색으로 내부를 비워 보이게 하는 방식도
                # 허용한다. 테마의 바탕색만 인정하고 상태색 채움은 계속 거부한다.
                c.expect(marker["fill"] in ("none", "transparent", "rgba(0, 0, 0, 0)")
                         or float(marker["opacity"]) == 0 or marker["fill"] in marker["surfaces"],
                         "SP-12.4-12 운행 금지 도형은 내부가 빈 상태")
    # 위치와 크기를 제거한 윤곽을 비교: 같은 도형의 색만 바꾸는 구현을 잡는다.
    c.eq(len(set(signatures)), 4, "SP-12.4-12 네 상태의 도형 윤곽이 서로 다름")


def t_12_5_public_settings_labels(c: Ctx):
    _prep(c)
    for phrase in ("이 차량·이 모형의 값", "기상 관측의 가시거리와 같지 않습니다.",
                   "안개 자체가 이 감속도를 정하는 것은 아닙니다.", "0.5초는 이 차량의 가정",
                   "레이더", "센서 융합", "제동력이 최대에 이르기까지 걸리는 시간"):
        _has(c, "#sp-pane-vehicle", phrase, "SP-12.5-06")
    for phrase in ("80", "45", "20", "6.5", "7.0", "3.0", "5.0", "4.0", "5.5"):
        _has(c, "#sp-pane-vehicle", phrase, "SP-12.5-06")
    c.page.locator("#sp-tab-evidence").click()
    for phrase in ("95%", "지금 위험률이 상한 아래일 확률이 95%라는 뜻은 아닙니다.",
                   "표본 편향", "표 근사", "0건은 위험률 0의 확인이 아닙니다."):
        _has(c, "#sp-prep", phrase, "SP-12.5-05")
    # 12.5-01~04는 과거 작성 작업 기록, 07은 사람의 검토, 09는 실행 이력이다.
    # 이 파일은 그 일을 했다는 허위 단언을 만들지 않는다.


if __name__ == "__main__":
    main(globals())
