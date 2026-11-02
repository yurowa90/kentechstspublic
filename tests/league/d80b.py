"""D-80 B 명세 검사. 브라우저 실행은 샌드박스 밖 총괄 담당자 전용.

tests/.venv/bin/python tests/league/d80b.py http://127.0.0.1:9430/index.html
기대값: D80-gridtopic.md B절, D80-contract-A.md. B 구현은 참조하지 않는다.
실제 시험/운영 결과를 공개 필드로 검산한다. uiMath의 판정/계통 함수는 부르지 않는다.
캡처: tests/results/d80b-*.png, 실행 보고: tests/results/d80b/last.md.
작성 단계에서는 py_compile만 실행한다. main() 밖에서는 브라우저를 띄우지 않는다.
"""

from league_flow import finish_trial
import calendar
import copy
import json
import math
import py_compile
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urldefrag, urljoin

from playwright.sync_api import sync_playwright

from econui import (Checks, RESULTS, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, screenshot, shown)
from league_flow import pass_issue_check, select_mode, start_solo
from s8n import NOTES, STATE, SYNC
from solo import click_next, close_drawer

KEY = "kcp-league-solo-v1"
TRIAL_KEY = "kcp-build-trial-v1"
ZERO = 0.005
# D80-contract-A.md 확정 계약. UI의 gridSameTol을 기대값으로 호출하지 않는다.
SAME_MWH, SAME_SHARE = 1.0, 0.05
SAME_PER_DAY = .05  # D-82 결정 1·화면 지시서: 판정과 표시 모두 MWh/일, 월 합계는 보조.
DIRECTIONS = {"up": "늘 것", "down": "줄 것", "same": "같을 것"}
NUMBER = r"[+−–-]?\s*\d[\d,]*(?:\.\d+)?"
WHY = "시험에서 정전이 없어서, 이번 달은 부족한 전기를 바깥 계통이 얼마나 메웠는지로 약속해요."  # 총괄 10-23 아르곤 문구(UX 갈래)

# 기존 s7.py와 같은 공개 계획 API. 합법적 칸과 연결 경로만 사용한다.
# 결과/정전/판정 수치, 계통 수입 상한, 단가는 덮어쓰지 않는다.
PLAN = """([count, empty]) => KCP.league.plan(st => {
  const B=KCP.buildGame, id=KCP.league.state().team;
  const p=empty ? {builds:[],lines:[]} : structuredClone(KCP.ECON_DATA.normalStartPlans[id]);
  p.builds ||= []; p.lines ||= [];
  const connected=new Set(p.lines.flatMap(l=>l.p)), used=new Set(p.builds.map(b=>b.i));
  for(let n=0;n<count;n++) {
    const t=B.TILES.find(t=>!t.out && t.site<0 && !used.has(t.i) &&
      !B.siteRule('diesel',t) && t.nb.some(i=>connected.has(i)));
    if(!t) throw Error('합법적 연결 디젤 칸 부족: '+n+'/'+count);
    p.builds.push({t:'diesel',i:t.i}); used.add(t.i);
    p.lines.push({p:[t.nb.find(i=>connected.has(i)),t.i]}); connected.add(t.i);
  }
  Object.assign(st,p,{policies:[],missions:[],rq:[],shed:'equal'});
})"""

# 시나리오 선택에만 복제 운영을 쓴다(s7.py expected_operation과 같은 계약).
# 실제 판은 약속 확인 버튼으로 운영하고, 단언은 그 실제 결과를 다시 읽는다.
PREVIEW = """() => {
  const L=KCP.league.state(), C=KCP.leagueCore, B=KCP.buildGame;
  const before=JSON.stringify(L.S), S=structuredClone(L.S), id=L.team;
  const save=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
  try {
    C.computerPlans(S,B,id,save.style || 'balanced',true);
    const result=C.run(S,B,0);
    if(before!==JSON.stringify(L.S)) throw Error('복제 운영이 실제 상태를 변경함');
    return {S, result, id};
  } finally {B.selectPack(C.teamDef(C.regionOf(L.S.region),id).pack,'league');}
}"""


class ReportChecks(Checks):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.notes = []
        self.zero_months = []

    def ok(self, condition, label):
        self.rows.append((bool(condition), label))
        return super().ok(condition, label)

    def run(self, label, function):
        try:
            return function()
        except Exception as exc:
            self.ok(False, f"{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
            return None


def require(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError(label)


def capture(checks, page, label):
    overflow(checks, page, label)
    screenshot(checks, page, f"d80b-{label}.png")


def bundle(page):
    # pagehide 저장 전에도 확정 UI 동작의 저장이 끝났는지 확인 가능한 전체 wrapper.
    return page.evaluate("""() => ({
      solo:JSON.parse(localStorage.getItem('kcp-league-solo-v1')),
      trial:localStorage.getItem('kcp-build-trial-v1')
    })""")


def restore(page, saved):
    """s8n.restore_solo 방식: 먼저 떠나 저장을 끝낸 뒤 두 저장 키를 복원한다."""
    base = urldefrag(page.url)[0]
    page.goto(urljoin(base, "README.md"))
    page.evaluate("""([key,trialKey,b]) => {
      localStorage.setItem(key,JSON.stringify(b.solo));
      if(b.trial===null) localStorage.removeItem(trialKey);
      else localStorage.setItem(trialKey,b.trial);
    }""", [KEY, TRIAL_KEY, saved])
    page.goto(base + "#league/solo")
    state = saved["solo"]["state"]
    page.wait_for_function(SYNC, arg=[state["round"], state["phase"]])
    page.wait_for_selector("#lg-bar")
    if shown(page, "#lg-guide-close"):
        page.locator("#lg-guide-close").click()


def note(page):
    state = page.evaluate(STATE)
    return page.evaluate(NOTES).get(str(state["round"]), {})


def trial(page, checks, label):
    close_drawer(page)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    result = page.evaluate("() => KCP.buildGame.lastTrial()")
    require(checks, bool(result) and result["days"] == 7, label + " 실제 1주 시험 저장")
    capture(checks, page, label + "-trial")
    page.locator("#bd-drawer-x").click()
    return result


def apply_plan(page, count=0, empty=False):
    close_drawer(page)
    if not page.evaluate(PLAN, [count, empty]):
        raise AssertionError("공개 계획 API가 배치를 거부함")
    # 기존 계획 API는 리그 쪽 전송/저장을 debounce한다(s7.py와 동일한 대기).
    page.wait_for_timeout(500)


def filled(team):
    """계약의 공개 필드 네 개만 읽는 독립 검산. 누락을 0으로 바꾸지 않는다."""
    values = [team.get("isolated", {}).get("uns"), team.get("uns"),
              team.get("imp"), team.get("sub")]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in values):
        raise AssertionError("계통 검산에 필요한 공개 필드( isolated.uns / uns / imp / sub ) 누락")
    isolated, uns, imp, sub = values
    return max(0, isolated - uns - imp + sub)


def month_days(state, result):
    # 12달 혼자 하기의 달 길이를 Python 달력으로 계산. UI resultPeriod를 부르지 않는다.
    rd = state["rounds"][result["round"] - 1]
    days = calendar.monthrange(result["year"], result["month"])[1]
    if rd.get("mdays") != days or result["days"] <= 0:
        raise AssertionError("달력/대표 운영 기간 계약 불일치")
    return days


def oracle(page, state, result, player, tested):
    prices = page.evaluate("""() => {
      const p=KCP.ECON_DATA.params;
      return [p.normalCost.v,p.gridImportMarkup.v];
    }""")
    if not all(isinstance(p, (int, float)) and math.isfinite(p) and p > 0 for p in prices):
        raise AssertionError("공개 원가/할증 계수 누락")
    price = math.prod(prices)
    days = month_days(state, result)
    mwh = filled(result["team"][player]) * days / result["days"]
    previous = next((r for r in state["results"] if r["round"] == result["round"] - 1), None)
    if previous:
        base = filled(previous["team"][player]) * month_days(state, previous) / previous["days"]
        base_per_day = filled(previous["team"][player]) / previous["days"]  # D-82
        label = "지난달 대비"
    elif tested and isinstance(tested.get("gridMWh"), (int, float)) and tested.get("days", 0) > 0:  # D-82: 옛 기간 누락/0은 비교 없음.
        if (tested["month"], tested["year"], tested["season"]) != (
                result["month"], result["year"], result["season"]):
            raise AssertionError("다른 월의 시험을 비교 기준으로 쓰려 함")
        base = tested["gridMWh"] * days / tested["days"]
        base_per_day = tested["gridMWh"] / tested["days"]  # D-82: 시험 원기간 직접 평균.
        label = "시험 1주 대비"
    else:
        base = None
        base_per_day = None  # D-82
        label = "비교 없음(시험 기록에 계통 값 없음)" if tested else "비교 없음(첫 결과)"
    delta = None if base is None else mwh - base
    return {"mwh": mwh, "perDay": mwh / days, "cost": mwh * price, "base": base, "label": label,  # D-82 결정 1·화면 지시서: 달력으로 구한 하루 평균.
            "delta": delta, "deltaCost": None if delta is None else delta * price,
            "tol": max(SAME_MWH, SAME_SHARE * abs(base)) if base is not None else SAME_MWH,
            "deltaPerDay": None if base_per_day is None else mwh / days - base_per_day,  # D-82
            "tolPerDay": max(SAME_PER_DAY, SAME_SHARE * abs(base_per_day)) if base_per_day is not None else SAME_PER_DAY}  # D-82


def direction(values):
    delta = values["deltaPerDay"]  # D-82 결정 1·화면 지시서: 판정·표시 같은 일평균.
    if delta is None:
        raise AssertionError("비교 기준 없는 시나리오의 방향을 단정할 수 없음")
    return "same" if abs(delta) <= values["tolPerDay"] else "up" if delta > 0 else "down"  # D-82


# D-82 결정 1·화면 지시서: 표시 자릿수를 고정해 일평균 검산 허용폭을 늘리지 않는다.
def numeric_match(token, value, precision):
    raw = re.sub(r"\s|,", "", token).replace("−", "-").replace("–", "-")
    decimals = len(raw.rsplit(".", 1)[1]) if "." in raw else 0
    half_unit = 0.5 * 10 ** -precision
    signed = raw.startswith(("+", "-")) or float(raw) == 0
    return decimals <= precision and signed and abs(float(raw) - value) <= half_unit + 1e-8


def delta_pair(checks, text, values, label, summary=False):
    # 총괄 10-23 아르곤 문구(UX 갈래): 요약은 기준 이름→기대 판정 낱말→괄호 안 하루 평균 Δ, 결과 칸은 기존 형식 유지.
    segment = text.split(values["label"], 1)[-1]
    pattern = rf"^\s*하루 평균 {'(?:Δ)' if not summary else ''}\s*({NUMBER})\s*MWh/일"
    precision = 2 if values["tolPerDay"] < .1 else 1  # T F13: 요약/접힘/계통 칸 같은 눈금.
    if summary:  # 총괄 10-23 아르곤 문구(UX 갈래)
        actual_word = {"same": "같음", "up": "늘어남", "down": "줄어듦"}[direction(values)]  # 총괄 10-23 아르곤 문구(UX 갈래)
        precision = 2 if values["tolPerDay"] < .1 else 1  # 총괄 10-23 아르곤 문구(UX 갈래)
        same_range = r"±(?P<tol>\d[\d,]*(?:\.\d+)?) 안, " if actual_word == "같음" else ""  # 총괄 10-23 아르곤 문구(UX 갈래)
        pattern = rf"^\s*{actual_word}\({same_range}하루 평균\s*(?P<delta>{NUMBER})\s*MWh/일 변화\)"  # 총괄 10-23 아르곤 문구(UX 갈래)
    match = re.search(pattern, segment)
    valid = bool(match) and numeric_match(match["delta"] if summary else match[1], values["deltaPerDay"], precision)  # 총괄 10-23 아르곤 문구(UX 갈래)
    if valid and summary and actual_word == "같음":  # 총괄 10-23 아르곤 문구(UX 갈래)
        raw = match["tol"].replace(",", "")  # 총괄 10-23 아르곤 문구(UX 갈래)
        decimals = len(raw.rsplit(".", 1)[1]) if "." in raw else 0  # 총괄 10-23 아르곤 문구(UX 갈래)
        valid = decimals <= precision and abs(float(raw) - values["tolPerDay"]) <= .5 * 10 ** -precision + 1e-8  # 총괄 10-23 아르곤 문구(UX 갈래)
    if summary:
        total = re.search(rf"월 합계 ({NUMBER}) MWh · 월 비용 약 ({NUMBER})억", segment)
    else:
        total = re.search(rf"이번 달 합 ({NUMBER}) MWh · 비용 약 ({NUMBER})억", segment)
    valid = valid and bool(total) and abs(float(total[1].replace(",", "")) - values["mwh"]) <= .05 + 1e-8 and abs(float(total[2].replace(",", "")) - values["cost"]) <= .005 + 1e-8
    checks.ok(valid, f"{label} Δ 부호·크기 = 공개 필드 하루 평균: {values['deltaPerDay']:.6f} MWh/일; 보조 월 합계·비용; 표시={segment}")


def promise(page, checks, topic, prediction, label, values=None):
    close_drawer(page)
    page.locator("#lg-ready").click()
    pass_issue_check(page)
    page.wait_for_selector("#lg-ready-confirm")
    require(checks, shown(page, "#lg-predict"), label + " S4 일지 약속 카드 표시")
    require(checks, page.locator(f'[data-pred="{topic}"]').count() == 1,
            label + f" S4 자동 주제 {topic}")
    if topic == "grid":
        card = page.locator("#lg-predict").inner_text()
        baseline = page.locator("#lg-promise-baseline").inner_text()
        checks.ok("바깥 계통에 기댄 전기 방향" in card, label + " S4 방향 문구")
        checks.ok(WHY in card, label + " S4 계통 주제를 묻는 이유 한 줄")
        checks.ok("하루 평균" in baseline and "MWh/일" in baseline and "억" in baseline and values["label"] in baseline,
                  label + " S4 기준 이름·하루 평균 MWh/일·보조 월 비용 억")  # D-82 결정 1·화면 지시서.
    page.locator('[data-evidence="grid"]').click()
    page.locator(f'[data-pred="{topic}"]').select_option(prediction)
    page.locator('[data-confidence="fairly"]').click()
    require(checks, page.locator("#lg-ready-confirm").is_enabled(), label + " 약속 확정 가능")
    capture(checks, page, label + "-S4")
    round_number = page.evaluate(STATE)["round"]
    page.locator("#lg-ready-confirm").click()
    page.wait_for_function(SYNC, arg=[round_number, "review"])
    require(checks, note(page).get("topic") == topic,
            label + f" 약속 확정 뒤 저장 n.topic == {topic}")
    checks.ok(note(page).get("pred", {}).get(topic) == prediction, label + " 선택 방향 저장")


def result_check(page, checks, tested, prediction, label, zero_required=False, expected_hit=None):
    state = page.evaluate(STATE)
    player = page.evaluate("() => KCP.league.state().team")
    result = state["results"][-1]
    values = oracle(page, state, result, player, tested)
    uns = result["team"][player]["unsPct"]
    if zero_required:
        require(checks, uns < ZERO, label + f" 실제 운영 정전 0(표시 기준): {uns}%")
        checks.zero_months.append(label)
        checks.notes.append(f"{label}: 실제 운영 정전 {uns:.8f}%, 계통 {values['mwh']:.6f} MWh")
    open_panel(page, "result")
    require(checks, shown(page, "#lg-promise-summary"), label + " S6 판정 줄 표시")
    text = page.locator("#lg-promise-summary").inner_text()
    checks.ok(text.startswith("계통 예측:") and "실제 결과:" in text and values["label"] in text,
              label + " S6 계통 예측·실제 결과·기준 이름 형식")
    checks.ok(DIRECTIONS[prediction] in text, label + " S6 약속한 방향 유지")
    if values["delta"] is not None:
        # delta_pair에는 '실제 결과:' 뒤만 넘겨 예측 쪽 숫자를 오인하지 않는다.
        delta_pair(checks, text.split("실제 결과:", 1)[-1], values, label + " S6", summary=True)
        hit = prediction == direction(values)
        if expected_hit is not None:
            checks.ok(hit == expected_hit, label + " 실제 운영에서 의도한 적중/빗나감 사례 확보")
        verdict = "예상과 같음" if hit else "예상과 다름"
        other = "예상과 다름" if hit else "예상과 같음"
        # 총괄 10-23 아르곤 문구(UX 갈래): 하루 평균 Δ의 '변화)' 뒤 적중 문구, 이어지는 괄호는 월 합계 보조.
        checks.ok(bool(re.search(r"MWh/일 변화\)\s*·\s*" + verdict + r"\s*\(", text)) and other not in text,  # 총괄 10-23 아르곤 문구(UX 갈래)
                  label + f" S6 판정 {verdict} (D-82 |Δ/일|≤max(0.05,|기준/일|×5%)={values['tolPerDay']:.6f}이면 same)")  # D-82
        if not hit:
            # D-80 C-5: 유의미한 원인이 하나뿐이면 S7은 카드 목록 대신 한 줄 요약(#lg-outage-single)을 보인다.
            checks.ok(page.locator("#lg-missed").count() == 1 and
                      page.locator("#lg-outage-cards, #lg-outage-single").count() == 1,
                      label + " grid 다름 달에도 S7 카드 존재(내부 단위는 검사하지 않음)")
    if uns >= ZERO:
        require(checks, shown(page, "#lg-promise-also-outage"), label + " 실제 정전 추가 안내 표시")
        line = page.locator("#lg-promise-also-outage").inner_text()
        match = re.search(rf"이번 달은 정전도 생겼어요\s*\(\s*({NUMBER})\s*%\s*\)", line)
        checks.ok(bool(match) and abs(float(re.sub(r"\s|,", "", match[1])) - uns) <= .0051,
                  label + " 추가 안내 정전율 = 공개 실제 정전율")
        checks.ok(page.locator("#lg-promise-summary").evaluate("""el => {
          const also=document.getElementById('lg-promise-also-outage');
          const gap=also.getBoundingClientRect().top-el.getBoundingClientRect().bottom;
          return !!(el.compareDocumentPosition(also)&Node.DOCUMENT_POSITION_FOLLOWING) &&
            gap>=-1 && gap<=24;
        }"""), label + " 정전 추가 안내가 판정 바로 아래에 있음")
    else:
        checks.ok(not shown(page, "#lg-promise-also-outage"), label + " 실제 정전 0에는 추가 정전 안내 없음")
    cell = page.locator("#lg-result-deltas [data-grid-fill]")
    if values["perDay"] >= .05:  # D-82 결정 1·화면 지시서: 일평균 표시 반 단위.
        require(checks, cell.count() == 1 and shown(page, "#lg-result-deltas [data-grid-fill]"),
                label + " 결과 서랍 계통 칸 표시")
        text = cell.inner_text()
        checks.ok(values["label"] in text, label + " 계통 칸 기준 이름")
        if values["delta"] is not None:
            delta_pair(checks, text, values, label + " 계통 칸")
        else:
            tail = text.split(values["label"], 1)[-1]
            checks.ok(not re.search(r"[+−–-]\s*\d[\d,.]*\s*(?:MWh|억)", tail),
                      label + " 비교 기준이 없으면 계통 칸에 Δ를 만들지 않음")
    else:
        checks.ok(cell.count() == 0, label + " 계통 0.05 MWh/일 미만은 칸 없음")
    capture(checks, page, label + "-S6")
    return values


def zero_plan(page, checks, initial, label):
    for count in (*range(9), 12, 16, 24):
        restore(page, initial)
        apply_plan(page, count=count)
        preview = page.evaluate(PREVIEW)
        team = preview["result"]["team"][preview["id"]]
        checks.notes.append(f"{label} 디젤 +{count}: 복제 운영 정전 {team['unsPct']:.8f}%")
        if team["unsPct"] >= ZERO:
            continue
        tested = trial(page, checks, f"{label}-candidate-{count}")
        checks.notes[-1] += f", 실제 시험 정전 {tested['unsPct']:.8f}%"
        if tested["unsPct"] < ZERO:
            values = oracle(page, preview["S"], preview["result"], preview["id"], tested)
            if values["perDay"] >= .05 and values["base"] is not None:  # D-82 결정 1·화면 지시서: 칸 표시 조건.
                # 도시 이름은 자료에서 읽는다(D-58·D-86, #78).
                team_name = page.evaluate("() => KCP.leagueCore.teamDef(KCP.leagueCore.regionOf('south'), 'pyeongtaek').name")
                checks.notes.append(f"{label}: {team_name}/고정 씨앗 0, 정상 연결 배치 + 디젤 {count}개. 실제 1주 시험과 복제 운영으로 정전 0 후보 선정. 실제 판 운영은 별도로 검증.")
                return bundle(page), tested, values
    require(checks, False, label + " 정전 0 + 계통 칸을 검증할 실제 시험/운영 후보를 만들지 못함(생략·통과 처리 금지)")


def exports(page, checks, saved, prediction, label):
    end = copy.deepcopy(saved)
    # 실제 운영한 결과/약속은 유지하고 마지막 화면의 렌더링 단계만 만든다.
    end["solo"]["state"]["phase"] = "end"
    restore(page, end)
    open_panel(page, "result")
    month = saved["solo"]["state"]["round"]
    row = page.locator(f'#lg-decisions [data-decision-month="{month}"]')
    require(checks, row.count() == 1, label + " 결정과 결과의 실제 운영 월 기록")
    checks.ok("예측 계통 " + DIRECTIONS[prediction] in row.inner_text(), label + " 결정과 결과 예측 계통 방향")
    page.evaluate("""() => {
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async text=>{window.__d80bSheet=text;}}});
    }""")
    page.locator("#lg-jcopy").click()
    page.wait_for_function("() => typeof window.__d80bSheet==='string'")
    sheet = page.evaluate("window.__d80bSheet")
    checks.ok("예측 계통 " + DIRECTIONS[prediction] in sheet, label + " 활동지 복사 예측 계통 방향")
    capture(checks, page, label + "-exports")


def legacy(page, checks, saved, tested, label):
    old = copy.deepcopy(saved)
    month = str(old["solo"]["state"]["round"])
    del old["solo"]["interview"]["interview"]["months"][month]["topic"]
    restore(page, old)
    page.reload()
    page.wait_for_function(SYNC, arg=[int(month), "review"])
    open_panel(page, "result")
    require(checks, shown(page, "#lg-promise-summary"), label + " 옛 기록 결과 판정 줄 표시")
    text = page.locator("#lg-promise-summary").inner_text()
    checks.ok(text.startswith(("정전 예측:", "현금 예측:")) and "계통 예측:" not in text,
              label + " 결과 단계 topic 없는 옛 기록은 grid로 재선정하지 않음")
    capture(checks, page, label + "-legacy")

    # grid 주제는 이미 확정됐으나 옛 시험 기록에는 계통 값이 없는 별도 호환 경우.
    missing = copy.deepcopy(saved)
    trials = json.loads(missing["trial"])
    for value in trials.values():
        value.pop("gridMWh", None)
    missing["trial"] = json.dumps(trials, ensure_ascii=False)
    # 약속 확정 때 n.trial에도 gridMWh·days를 남기므로(총괄 지시 10-21, 판정은 이 저장값 우선)
    # 옛 기록을 흉내 내려면 월 기록의 시험 사본에서도 계통 값을 지운다.
    for value in missing["solo"]["interview"]["interview"]["months"].values():
        if isinstance(value.get("trial"), dict):
            value["trial"].pop("gridMWh", None)
            value["trial"].pop("days", None)
    restore(page, missing)
    old_trial = dict(tested)
    old_trial.pop("gridMWh", None)
    result_check(page, checks, old_trial, note(page)["pred"]["grid"], label + "-missing-grid")


def uns_case(page, checks, initial, label):
    restore(page, initial)
    apply_plan(page, empty=True)
    tested = trial(page, checks, label + "-uns")
    require(checks, tested["unsPct"] >= ZERO, label + f" 빈 배치 실제 시험에 정전 있음: {tested['unsPct']}%")
    promise(page, checks, "uns", "same", label + "-uns")
    open_panel(page, "result")
    checks.ok(page.locator("#lg-promise-summary").inner_text().startswith("정전 예측:"),
              label + " 기존 정전 예측: 문구 유지")
    capture(checks, page, label + "-uns-result")


def also_outage(page, checks, grid_ready, label):
    # 정전 0 시험 뒤 배치를 비운다. 약속 주제는 시험 기준이고 실제는 정전인 경우.
    restore(page, grid_ready)
    apply_plan(page, empty=True)
    tested = page.evaluate("() => KCP.buildGame.lastTrial()")
    preview = page.evaluate(PREVIEW)
    require(checks, preview["result"]["team"][preview["id"]]["unsPct"] >= ZERO,
            label + " grid 약속 후 정전 발생 시나리오 확보")
    values = oracle(page, preview["S"], preview["result"], preview["id"], tested)
    prediction = "down" if direction(values) != "down" else "up"
    promise(page, checks, "grid", prediction, label + "-also-outage", values)
    result_check(page, checks, tested, prediction, label + "-also-outage")


def cash(page, checks, initial, label):
    debt = copy.deepcopy(initial)
    player = debt["solo"]["team"]
    debt["solo"]["state"]["econ"]["cities"][player]["cash"] = -1
    restore(page, debt)
    apply_plan(page, empty=True)
    promise(page, checks, "cash", "same", label + "-cash")
    open_panel(page, "result")
    checks.ok(page.locator("#lg-promise-summary").inner_text().startswith("현금 예측:"),
              label + " 기존 현금 예측: 문구 유지")
    capture(checks, page, label + "-cash-result")


def play(page, checks, base, label):
    page.goto(base + "#league")
    capture(checks, page, label + "-lobby")
    select_mode(page, "solo")
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text("날씨·사건 · 연습 방식", exact=True).click()
    page.locator("#lg-solo-seed").select_option("fixed")
    start_solo(page, months=12)
    page.wait_for_function(SYNC, arg=[1, "plan"])
    if shown(page, "#lg-guide-close"):
        page.locator("#lg-guide-close").click()
    initial = bundle(page)
    # 예산 때문에 배치 탐색이 잘리는 것을 막는 가상 fixture. 수요/공급/결과는 원래 모형.
    initial["solo"]["state"]["econ"]["cities"][initial["solo"]["team"]]["cash"] = 100000
    capture(checks, page, label + "-initial")
    # 첫 달 시험 없을 때는 uns. 카드를 확인하고 확정 없이 원래 fixture로 돌아간다.
    page.locator("#lg-ready").click()
    pass_issue_check(page)
    checks.ok(shown(page, '[data-pred="uns"]'), label + " 첫 달 시험 없음 → uns")
    capture(checks, page, label + "-no-trial")

    candidate = checks.run(label + " 정전 0 배치 준비", lambda: zero_plan(page, checks, initial, label))
    if candidate:
        ready, tested, preview_values = candidate
        actual_direction = direction(preview_values)
        other_direction = "down" if actual_direction != "down" else "up"
        saved_hit = None
        cases = [("hit", actual_direction), ("miss", other_direction)]
        if actual_direction != "same":
            cases.append(("same", "same"))
        for name, prediction in cases:
            def branch(name=name, prediction=prediction):
                restore(page, ready)
                promise(page, checks, "grid", prediction, label + "-" + name, preview_values)
                result_check(page, checks, tested, prediction, label + "-" + name,
                             zero_required=True, expected_hit=name == "hit")
                return bundle(page)
            saved = checks.run(label + "-grid-" + name, branch)
            if name == "hit":
                saved_hit = saved
        if saved_hit:
            checks.run(label + " 내보내기", lambda: exports(page, checks, saved_hit, actual_direction, label))
            checks.run(label + " 옛 기록", lambda: legacy(page, checks, saved_hit, tested, label))

            def last_month():
                restore(page, saved_hit)
                click_next(page, page.evaluate(STATE))
                page.wait_for_function(SYNC, arg=[2, "plan"])
                _, tested2, values = zero_plan(page, checks, bundle(page), label + "-feb")
                require(checks, values["label"] == "지난달 대비", label + " 둘째 달 기준은 시험 대신 지난달")
                prediction = direction(values)
                promise(page, checks, "grid", prediction, label + "-last", values)
                result_check(page, checks, tested2, prediction, label + "-last")
            checks.run(label + " 지난달 기준", last_month)
        checks.run(label + " 계통 약속 뒤 실제 정전", lambda: also_outage(page, checks, ready, label))
    # grid 준비/판정이 실패해도 독립적인 기존 uns·cash 검사는 실행한다.
    checks.run(label + " 정전 회귀", lambda: uns_case(page, checks, initial, label))
    checks.run(label + " 현금 회귀", lambda: cash(page, checks, initial, label))


def write_report(checks, syntax):
    destination = RESULTS / "d80b" / "last.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = ["# D-80 B 브라우저 검사", "", f"checks {checks.count} fail {checks.failed}", "",
            "실행 환경: 총괄이 실행한 로컬 환경(샌드박스 밖인지 실행자가 확인).",
            f"py_compile: {syntax}", "", "## 정전 0 달 준비와 실제 결과", "",
            "실제 운영 정전 0 확인: " + (", ".join(checks.zero_months) if checks.zero_months else "미확인. 통과로 간주하지 않음."), ""]
    text += ["- " + line for line in checks.notes] or ["- 정전 0 달 생성 미확인. 실패 목록 확인 필요."]
    text += ["", "## 명세 해석", "",
             "- 정전 0은 표시 기준인 unsPct < 0.005%. 실제 1주 시험과 실제 운영 양쪽에서 확인한다.",
             "- 현금은 배치 탐색용 가상 잔액 100000억. 정상 연결 배치에 합법적 디젤을 추가한다. 모형 계수나 결과를 수정하지 않는다.",
             "- 계통 같음 문턱은 max(0.05 MWh/일, |기준 하루 평균|×5%)(D-82 결정 1·화면 지시서).",
             "- 하루 평균 Δ는 소수 1자리 반 단위까지 허용하고, 0 이외에는 부호도 확인한다. 월 합계·비용은 보조로 검산한다(D-82 결정 1·화면 지시서).",
             "- S7은 grid 예측이 다른 달의 카드 존재만 검사한다. 카드 내부 단위·분해는 C 범위다.",
             "- 내보내기는 실제 운영 결과를 유지한 저장본의 phase만 end로 바꿔 마지막 화면을 연다.",
             "- 옛 기록은 결과 단계 저장본의 topic만 삭제한다. 예측/실제 결과는 유지한다.",
             "- 옛 시험 gridMWh 누락은 별도 저장본에서 검사한다. Δ가 없으면 계통 칸의 비교 없음 이름만 요구한다.",
             "- 검사가 방문한 화면마다 넘침을 검사한다. 이 파일이 방문하지 않은 화면은 검사 범위 밖이다.",
             "", "## 검사 목록과 실제 결과", ""]
    text += [f"- {'PASS' if ok else 'FAIL'} {label}" for ok, label in checks.rows]
    destination.write_text("\n".join(text) + "\n", encoding="utf-8")


def main():
    checks = ReportChecks()
    syntax = "미실행"
    try:
        with tempfile.TemporaryDirectory(prefix="d80b-compile-") as tmp:
            py_compile.compile(__file__, cfile=str(Path(tmp) / "d80b.pyc"), doraise=True)
        syntax = "통과"
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height, scheme in ((1280, 900, "light"), (390, 844, "dark")):
                label = f"{width}x{height}-{scheme}"
                context, external = context_for(browser, base, width, height, scheme)
                page, events = monitored_page(context)
                try:
                    checks.run(label + " 진행", lambda: play(page, checks, base, label))
                finally:
                    capture(checks, page, label + "-final")
                    diagnostics(checks, events, label)
                    checks.ok(not external, label + f" 외부 연결 시도 0: {external}")
                    context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외: {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
    try:
        write_report(checks, syntax)
    except Exception as exc:
        checks.ok(False, f"last.md 작성 실패: {exc}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
