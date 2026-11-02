"""S7 명세 수용 검사 — 브라우저 실행은 샌드박스 밖 총괄 담당.

실행: tests/.venv/bin/python tests/league/s7.py http://127.0.0.1:9430/index.html
근거: (비공개 작업 지시서)·V3B-fix4.md·V3B-fix3.md·V3B-fix2.md와 영상 3차 V3B-s7.md가 카드 문턱·단서·병목·근거 연결·숫자 문구에 우선한다.
2월 이후는 (비공개 작업 지시서)와 D-74 일곱 단계 명세(옛 여섯 단계에서 계통 수입 분리).
1월은 (비공개 작업 지시서)가 우선. 아래 I 번호는 유지된 기존
S7-impl.md 항목의 행 번호이며 '겹침=남는 값'·겹침 막대 명세는 폐기한다.
(비공개 작업 지시서) 19–25, LEAGUE-CANON.md 12·14행(목표 4·6).
I3/D-65 비전송, I12–19 분해·캐시, I20–25 고르기/공개, I26 이어붙이기,
I28 모바일, I37–40 2022 연결. 1280 밝음·1180×820 태블릿·390 어두움에서 진단·캡처한다.

S7 DOM은 전달받은 id/data 속성만 쓴다. 기존 흐름 조작은 league_flow,
econui, solo의 선택자를 재사용한다. 결과/약속/분해값을 주입하지 않는다.
계획은 공개 검사 API로 정상 연결 배치·태양광·빈 배치를 만든다. 복수 원인
사례는 시험 뒤 절전 정책을 선택하고, 재현 점검 사례는 같은 계획을 유지한다.
복제 상태로 예측을 고르며 실제 판은 UI로 진행한다.
"""

from league_flow import finish_trial
from league_flow import pass_issue_check
import json
import calendar  # D-80: 계약 A, 월 일수 독립 계산.
import math
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache, reduce
from itertools import product

from playwright.sync_api import sync_playwright
from league_flow import confirm_seat, select_mode, start_solo
from econui import (Checks, context_for, diagnostics, local_address, monitored_page,
                   open_panel, overflow, screenshot, shown)
from solo import click_next, close_drawer, read

VALUE = re.compile(r"([+−-]?\d[\d,]*(?:\.\d+)?)\s*(?:%(?:p)?|MWh(?:/일)?)")  # D-80: C-4. D-82: 일평균 단위.
S7_SHARE = re.compile(r"[+−]?\d+\.\d{2}%p")
S7_RATE = re.compile(r"\d+\.\d{2}%")
# D-80: C-2·4 우선. 새 계산은 시험 4몫·월간 6몫, 계통 수입 이름은 옛 기록용.
NAMES = {"choice": "내 선택", "weather": "날씨·운전 기간", "event": "사건·대응",
         "trade": "이웃 거래"}  # D-80: C-2, 시험 네 몫.
MONTHLY_NAMES = {"choice": "내 선택", "weather": "날씨·계절·운전 기간",
                 "event": "사건·대응", "progress": "접속·공사·기술 진행", "growth": "도시 성장·연료 값", "trade": "이웃 거래"}  # D-80: C-2, 월간 여섯 몫.
# D-80: C-4, 옛 기록 표시 이름은 새 계산 후보와 분리해서 보존.
LEGACY_NAMES = {**NAMES, "gridImport": "계통 수입"}  # D-80: C-1·2·4·5 대상별 검사.
LEGACY_MONTHLY_NAMES = {**MONTHLY_NAMES, "gridImport": "계통 수입"}  # D-80: C-1·2·4·5 대상별 검사.


def part_min(a):  # D-80: C-5, 독립 문턱 식.
    return max(max(.05, .05 * abs(a["trial"])) / 10, .05) if a.get("target") == "grid" else .05  # D-82 수정 2(총괄 결정): 하한 0.05 = 표시 눈금 절반.


def outage_digits(a):
    if a.get('target') != 'grid':
        return 2
    if a.get('unit') != 'MWh/일':
        return 1
    base = a.get('trial') if a.get('trial') is not None else a.get('base')
    return 2 if isinstance(base, (int, float)) and math.isfinite(base) and abs(base) < 2 else 1


def rounded_share(value, a):
    # JS toFixed와 같이 입력 이진 실수의 정확한 값을 0에서 먼 쪽으로 반올림한다.
    step = Decimal('.01' if outage_digits(a) == 2 else '.1')
    return float(Decimal.from_float(float(value)).quantize(step, rounding=ROUND_HALF_UP)) + 0.0


def _tick(value, digits):
    step = Decimal('.01' if digits == 2 else '.1')
    return int(Decimal.from_float(float(value)).quantize(step, rounding=ROUND_HALF_UP) * 10**digits)


@lru_cache(maxsize=64)
def _allocation_serialized(serialized):
    """rev14b A2: 원값의 lo/lo+1 조합을 전부 훑는다. 구현 Map은 읽지 않는다."""
    a = json.loads(serialized)
    digits = outage_digits(a)
    scale = 10**digits
    total = a.get('total')
    if total is None:
        total = a['actual'] - (a.get('trial') if a.get('trial') is not None else a.get('base'))
    head = _tick(total, digits)
    parts = list(a['parts'])
    replay = a.get('replay', 0)
    # rev14b A2: 계통은 min(기존 .05, 표시 반 눈금), 정전은 기존 .005.
    replay_min = min(.05, .5 / scale) if a.get('target') == 'grid' else .005
    if not a.get('replayOutsideSum') and abs(replay) >= replay_min:
        parts.append({'key': 'replay', 'value': replay})
    raw = [p['value'] * scale for p in parts]
    near = tuple(_tick(p['value'], digits) for p in parts)
    # rev14b A2 원값 합 가드: 옛 사본의 누락은 각자 반올림·gap 0·안내 없음.
    if abs(sum(p['value'] for p in parts) - total) >= .5 / scale:
        return {'digits': digits, 'scale': scale, 'head': head, 'parts': parts, 'best': None,
                'solutions': [near], 'fallback': True, 'guarded': True}
    lo = [math.floor(v + 1e-9) for v in raw]
    options = [(v,) if raw[i] - v <= 1e-9 else (v, v+1) for i, v in enumerate(lo)]
    causes = a['parts']
    # 순위 판정은 앞 명세의 고정 문턱. replay는 c1/c2/c3 원인 후보에서 제외한다.
    threshold = max(part_min(a), .05 * abs(total))
    top = max((abs(p['value']) for p in causes), default=0)
    tied = [i for i, p in enumerate(causes) if abs(p['value']) >= threshold and
            abs(rounded_share(p['value'], a)) == abs(rounded_share(top, a))]
    allowed = []
    best = None
    for candidate in product(*options):
        if any(abs(p['value']) >= part_min(a) and abs(candidate[i]) < 1 for i, p in enumerate(causes)):
            continue
        if any(abs(raw[i]) > abs(raw[j]) + 1e-9 and abs(candidate[i]) < abs(candidate[j])
               for i in range(len(causes)) for j in range(len(causes))):
            continue
        if tied and any((abs(candidate[i]) != abs(candidate[tied[0]]) if i in tied else
                         abs(candidate[i]) >= abs(candidate[tied[0]])) for i in range(len(causes))):
            continue
        cost = (abs(head - sum(candidate)), sum((v == 0) != (near[i] == 0) for i, v in enumerate(candidate)),
                reduce(lambda n, pair: n + abs(pair[1] - raw[pair[0]]), enumerate(candidate), 0.0))
        if best is None or cost < best:
            best, allowed = cost, [candidate]
        elif cost == best:
            allowed.append(candidate)
    return {'digits': digits, 'scale': scale, 'head': head, 'parts': parts, 'best': best,
            'solutions': allowed if allowed else [near], 'fallback': best is None}


def allocation_oracle(a):
    return _allocation_serialized(json.dumps(a, sort_keys=True))


def display_shares(a):
    """호환용 첫 최적해. 동률의 실제 단언은 share_matches/전체 조합 검사로 한다."""
    o = allocation_oracle(a)
    if o['fallback']:
        return {}
    return {p['key']: o['solutions'][0][i] / o['scale'] for i, p in enumerate(o['parts'])}


def share_matches(shown_value, raw_value, a, key):
    o = allocation_oracle(a)
    index = next((i for i, p in enumerate(o['parts']) if p['key'] == key), None)
    if index is None:
        return shown_value == rounded_share(raw_value, a)
    return any(shown_value == candidate[index] / o['scale'] for candidate in o['solutions'])


def _outage_value(value, unit, signed, digits):
    prefix = ('+' if value > 0 else '−') if signed and value else ''
    return prefix + f'{abs(value):,.{digits}f}' + (' ' if unit.startswith('MWh') else '') + unit


def assert_allocation_dom(checks, page, a, visible, label):
    """전체 표시 조합이 최소 비용인지와 gap/W1/W2를 함께 검사한다(동률은 모두 허용)."""
    o = allocation_oracle(a)
    keys = [p['key'] for p in o['parts']]
    checks.ok(all(k in visible for k in keys), label + ' A2 보이는 몫 모두 확보')
    if not all(k in visible for k in keys):
        return
    candidate = tuple(round(visible[k] * o['scale']) for k in keys)
    checks.ok(candidate in o['solutions'], label + ' A2 c1/c2/N1 허용·사전순 최소 비용 조합')
    guarded = o.get('guarded', False)
    gap = 0 if guarded else o['head'] - sum(candidate)
    note = page.locator('#lg-outage-round-note')
    trial, actual = a.get('trial'), a.get('actual')
    w1 = not guarded and not gap and all(isinstance(x, (int, float)) and math.isfinite(x) for x in (trial, actual)) and \
        _tick(trial, o['digits']) + o['head'] != _tick(actual, o['digits'])
    checks.ok(note.count() == int(bool(gap or w1)), label + ' A3 W1/W2 배타적 조건')
    if note.count() != 1:
        return
    kind = 'w2' if gap else 'w1'
    checks.ok(note.get_attribute('data-round-note') == kind, label + ' A3 data-round-note=' + kind)
    unit = a.get('unit', 'MWh') if a.get('target') == 'grid' else '%p'
    value = lambda v, sign: _outage_value(v, unit, sign, o['digits'])
    diff = value(o['head'] / o['scale'], True)
    expected = (f'몫마다 표시 눈금에 맞춰 보여서, 몫의 합({value(sum(candidate)/o["scale"], True)})이 '
                f'차이({diff})와 {value(abs(gap)/o["scale"], False)} 달라요.') if gap else \
        f'몫의 합은 {diff}에 맞췄어요. 시작·끝 값은 따로 반올림해 {value(1/o["scale"], False)}만큼 어긋날 수 있어요.'
    checks.ok(note.inner_text().strip() == expected, label + ' A3 W1/W2 글자·세 자리 채움')


def share_pattern(a):
    return re.compile(r'[+−]?[\d,]+\.\d{' + str(outage_digits(a)) + r'} MWh/일') if a.get('target') == 'grid' else S7_SHARE


def attribution_endpoints(page, a):  # D-80: C-1·계약 A, 공개 결과/시험에서 독립 계산.
    state = page.evaluate(STATE)  # D-80: C-1·2·4·5 대상별 검사.
    results, player = state["results"], a["id"]  # D-80: C-1·2·4·5 대상별 검사.
    current = next(r for r in results if r["round"] == a["round"])  # D-80: C-1·2·4·5 대상별 검사.
    previous = next((r for r in results if r["round"] == a["round"] - 1), None)  # D-80: C-1·2·4·5 대상별 검사.
    days = lambda r: calendar.monthrange(r["year"], r["month"])[1] if r.get("month") else r["days"]  # D-80: C-1·2·4·5 대상별 검사.
    def public_value(result):  # D-80: C-1·2·4·5 대상별 검사.
        row = result["team"][player]  # D-80: C-1·2·4·5 대상별 검사.
        return (max(0, row["isolated"]["uns"] - row["uns"] - row["imp"] + row["sub"]) / result["days"]  # D-82: 공개 대표기간 하루 평균.
                if a.get("target") == "grid" else row["unsPct"])  # D-80: C-1·2·4·5 대상별 검사.
    if a.get("basis") == "monthly":  # D-80: C-1·2·4·5 대상별 검사.
        return public_value(previous), public_value(current)  # D-80: C-1·2·4·5 대상별 검사.
    record = page.evaluate("""id => { // D-80: C-1·2·4·5 대상별 검사.
      const L=KCP.league.state(), V=L.snap || L.S, C=KCP.leagueCore; // D-80: C-1·2·4·5 대상별 검사.
      return KCP.buildGame.lastTrial(C.teamDef(C.regionOf(V.region),id).pack, JSON.stringify([L.room,id])); // D-80: C-1·2·4·5 대상별 검사.
    }""", player)  # D-80: C-1·2·4·5 대상별 검사.
    base = record["gridMWh"] / record["days"] if a.get("target") == "grid" else record["unsPct"]  # D-82: 시험 원기간 직접 평균.
    return base, public_value(current)  # D-80: C-1·2·4·5 대상별 검사.


STATE = "() => { const l=KCP.league.state(); return l.S || l.snap; }"
SYNC = "([r,p]) => {const l=KCP.league.state(),s=l&&(l.S||l.snap); return s?.round===r&&s?.phase===p;}"

# CSS로만 가린 답도 textContent에 남는다. aria/title/data와 모든 자손을 읽는다.
# 단서의 MW/MWh/발전량 %/설비 개수는 정답 %p와 구별해야 한다(I20).
SURFACE = """root => {
  const nodes = [root], attrs = [], leaves = [];
  for (let i=0;i<nodes.length;i++) {
    const n=nodes[i]; nodes.push(...n.children);
    for (const a of n.attributes) if (/^(aria-|data-)|^title$/.test(a.name))
      attrs.push([a.name,a.value]);
    if (!n.children.length) leaves.push(n.textContent.trim());
  }
  return {text:root.textContent,attrs,leaves};
}"""
COUNT_SIM = """() => {
  if (window.__s7SimCalls !== undefined) return;
  window.__s7SimCalls=0;
  const original=KCP.buildGame.simulate;
  KCP.buildGame.simulate=function(...args) { window.__s7SimCalls++; return original.apply(this,args); };
}"""


def required(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError(label)


def student_words(checks, page, label):
    # text_content는 접힌 상세도 포함한다. 서랍 전체의 다른 근거 등급 문구는 대상 밖이다.
    text = page.locator("#lg-missed").text_content()
    checks.ok("S7" not in text and "(G)" not in text,
              f"{label} 학생 원인 영역 전체에 내부 표기 미노출")


def no_cause_summary(checks, page, label, before, after, monthly=False):
    """두 정전율은 UI 시험/독립 복제 운영과 비교하고, 재현 진단은 API와 대조한다."""
    a = current_attribution(page)  # D-80: C-1·2·4·5 대상별 검사.
    before, after = attribution_endpoints(page, a)  # D-80: C-1·2·4·5 대상별 검사.
    grid_target = a.get("target") == "grid"  # D-80: C-1·2·4·5 대상별 검사.
    # D-80: 독립 비교값과 단위에 맞게 요약을 검사한다.
    shown_high = lambda value: math.isfinite(value) and Decimal(str(value)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) >= 5
    high = not grid_target and shown_high(before) and shown_high(after)  # D-80: C-1·2·4·5 대상별 검사.
    actual_high = not grid_target and shown_high(after)  # D-80: C-1·2·4·5 대상별 검사.
    difference = after - before
    small_difference = abs(difference) < (part_min(a) if grid_target else .05)  # D-80: C-1·2·4·5 대상별 검사.
    # API는 재현/합계 밖 진단 분기만 읽는다. 두 정전율은 UI 시험·독립 복제 운영과 비교한다.
    a = current_attribution(page)
    replay = a.get("replay", 0)
    parts_sum = sum(p["value"] for p in a["parts"])
    replay_dominates = (not a.get("replayOutsideSum", False) and not small_difference and
                        replay * difference > 0 and abs(replay) > abs(difference) / 2 and
                        abs(parts_sum) < abs(difference) / 2)
    expected_label = "차이 원인 없음(정전 자체는 큼)" if high else "뚜렷한 원인 없음"
    student_words(checks, page, label + " 한 줄 요약")
    text = page.locator("#lg-missed").text_content()
    summary = page.locator("#lg-outage-single").text_content()
    pattern = r"지난달 ([\d.]+)% → 이번 달 ([\d.]+)%" if monthly else r"시험 ([\d.]+)% → 실제 ([\d.]+)%"
    if grid_target:  # D-80: C-1·2·4·5 대상별 검사.
        pattern = r"지난달 ([\d,.]+) MWh/일 → 이번 달 ([\d,.]+) MWh/일" if monthly else r"시험 ([\d,.]+) MWh/일 → 실제 ([\d,.]+) MWh/일"  # D-82
    quoted = re.search(pattern, summary)
    checks.ok(quoted is not None and abs(float(quoted[1].replace(",", "")) - rounded_share(before, a)) <= 1e-9 and  # D-80: C-1·2·4·5 대상별 검사.
              abs(float(quoted[2].replace(",", "")) - rounded_share(after, a)) <= 1e-9,  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 요약 두 숫자 = 독립 비교값(소수 둘째 자리)")
    checks.ok(expected_label in text and ("정전 자체는 큼" in text) == high,
              f"{label} 두 표시값 모두 ≥5.00%일 때만 높은 정전 기록")
    # rev10 R5: 현재 지도 대신 저장된 운영 사본의 미연결 설비 수를 읽는다.
    # rev10 총괄 수정: KCP.league.state()에는 interview가 없다. 혼자 하기는 저장본(1초 디바운스 뒤)의 interview를 읽는다.
    page.wait_for_timeout(1300)
    n = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.snap||L.S, d=L.role==='solo'?JSON.parse(localStorage.getItem('kcp-league-solo-v1')||'{}').interview:
        JSON.parse(localStorage.getItem(`kcp-league-s7-v1:${L.room}:${L.team}`)||'{}');
      const p=d?.outageSnapshots?.[V.round]?.plan || d?.months?.[V.round]?.operatingPlan;
      if(!p) return 0;
      return KCP.buildGame.network(KCP.buildGame.sanitize(p,1e9)).nodes
        .filter(x=>x.kind!=='town'&&x.kind!=='import'&&!x.live).length;
    }""")
    # rev12 E5-a: n>0은 새 C4, n=0은 기존 안내·접두 문장을 유지한다.
    hint = (f"이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요."
            if n else "지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요")
    checks.ok((("바뀐 조건 하나하나는" in summary and ("계통" if grid_target else "정전") in summary and "거의 바꾸지 않았어요" in summary)) == (not replay_dominates) and  # D-80: C-1·2·4·5 대상별 검사.
              (hint in summary) == actual_high,  # rev10 R5: N2/원래 문장의 조건별 기대.
              f"{label} 차이 설명·높은 정전의 설비·접속 부족·재점검 안내" + ("" if (hint in summary) == actual_high else f" (n={n}, 높음={actual_high}, 요약 끝={summary[-160:]})"))
    saved_name = "지난달 사본" if monthly else "시험"
    replay_detail = f"차이의 대부분은 재현 차이(저장된 {saved_name}과 같은 조건 재계산의 차이)예요 — 원인 후보로 나눌 수 없어요"
    checks.ok((replay_detail in summary) == replay_dominates, f"{label} 재현 차이가 대부분일 때 원인 분해 한계")
    checks.ok(("이번 달 변화보다" in summary) == (actual_high and small_difference and not n),
              f"{label} 0.05%p 미만 차이에만 변화 비교")
    baseline_name = "지난달" if monthly else "시험"
    baseline_prefix = f"{baseline_name}에도 정전이 컸어요." if n else f"{baseline_name}에도 정전이 컸으니"
    checks.ok((baseline_prefix in summary) == high,
              f"{label} 기준 표시값도 높을 때만 높은 정전 전제")
    return expected_label


def capture(checks, page, label, stage):
    if page.locator("#lg-missed").count():
        student_words(checks, page, f"{label} {stage}")
    overflow(checks, page, f"{label} {stage}")
    screenshot(checks, page, f"s7-{label}-{stage}.png")


def plan_and_trial(page, empty=False, renewable=False, change_after=True):
    if shown(page, "#lg-guide-close"):
        page.locator("#lg-guide-close").click()
    close_drawer(page)
    assert page.evaluate("""([empty,renewable]) => KCP.league.plan(st => {
      const id=KCP.league.state().team;
      Object.assign(st, empty ? {builds:[],lines:[]} :
        structuredClone(KCP.ECON_DATA.normalStartPlans[id]), {policies:[]});
      if (renewable) {
        const B=KCP.buildGame, connected=new Set(st.lines.flatMap(l=>l.p));
        const tiles=B.TILES.filter(t=>!t.out && t.site<0 && !B.siteRule('solar',t) &&
          t.nb.some(i=>connected.has(i))).slice(0,10);
        if (tiles.length!==10) throw Error('태양광 시험 배치 부족');
        for (const t of tiles) {
          st.builds.push({t:'solar',i:t.i});
          st.lines.push({p:[t.nb.find(i=>connected.has(i)),t.i]});
        }
      }
    })""", [empty, renewable]), "계획 단계 배치 적용 실패"
    page.wait_for_timeout(500)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    trial = page.evaluate("() => KCP.buildGame.lastTrial()")
    assert trial and trial["days"] == 7, "1주 시험 저장 없음"
    page.locator("#bd-drawer-x").click()
    if not empty and change_after:
        assert page.evaluate("() => KCP.league.plan(st => {st.policies=['save'];})")
    page.wait_for_timeout(500)
    return trial


def period_days(result):  # D-80: 대표 일수와 달력상 월 일수를 구별한다.
    return calendar.monthrange(result["year"], result["month"])[1] if result.get("month") else result["days"]  # D-80: 계약 A.


def public_grid_mwh(result, player):  # D-80: UI 계산 함수를 부르지 않고 공개 필드로 월 환산한다.
    row = result["team"][player]  # D-80: 지도 수입 설비 출력은 포함하지 않는다.
    return max(0, row["isolated"]["uns"] - row["uns"] - row["imp"] + row["sub"]) * period_days(result) / result["days"]  # D-80: 계약 A.


def expected_operation(page, player):  # D-80: 복제 운영 한 번으로 세 주제의 기대값을 함께 얻는다.
    """분해·판정 함수와 독립: 복제 실운영 결과의 공개 필드를 Python에서 계산한다."""  # D-80: 실제 판은 불변.
    forecast = page.evaluate("""id => { // D-80: 화면 주제는 약속 창을 연 뒤 읽는다.
      const L=KCP.league.state(), C=KCP.leagueCore, B=KCP.buildGame;
      const before=JSON.stringify(L.S), S=structuredClone(L.S);
      try {
        if (L.role==='solo') {
          const save=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
          C.computerPlans(S,B,id,save.style || 'balanced',true);
        }
        const result=C.run(S,B,0);
        const economy=C.publicView(S,0).econ; // D-80: 내부 S.econBefore는 공개 뷰의 econ.before로 읽는다.
        const cash=economy.cities[id].cash-economy.before[id].cash; // D-80: 현금은 운영 전 대비.
        if (JSON.stringify(L.S)!==before) throw Error('복제 운영이 원본을 변경함');
        return {result,cash}; // D-80: 계통 기대값은 공개 결과로 독립 계산.
      } finally {B.selectPack(C.teamDef(C.regionOf('south'),id).pack,'league');}
    }""", player)  # D-80: 진행자에서 복제한 결과도 팀 약속에 전달할 수 있다.
    result = forecast["result"]  # D-80: 정전·계통은 같은 복제 운영에서 읽는다.
    return {"uns": result["team"][player]["unsPct"], "cash": forecast["cash"],  # D-80: 기존 기대값 유지.
            "grid": public_grid_mwh(result, player), "days": period_days(result)}  # D-80: 첫 달 시험 환산에도 이번 달 일수 사용.


def promise(page, trial, expected, *, hit=False, topic="uns", baseline=None):  # D-80: 운영 전 독립 기대값과 hit 의도를 보존한다.
    page.evaluate(COUNT_SIM)
    close_drawer(page)
    page.locator("#lg-ready").click()
    pass_issue_check(page)
    page.locator('[data-evidence="grid"]').click()
    select = page.locator('#lg-predict [data-pred]')  # 명세 A3: 정전·계통 모두 0이면 cash, 나머지는 주제 규칙을 따른다.
    screen_topic = select.get_attribute("data-pred")  # D-80: 호출자의 주제 가정보다 실제 화면 주제를 따른다.
    assert screen_topic in ("uns", "cash", "grid"), f"알 수 없는 약속 주제: {screen_topic}"  # D-80: 누락·중복도 실패.
    assert topic != "cash" or screen_topic == "cash", f"현금 약속을 요구했으나 화면 주제는 {screen_topic}"  # D-80: cash 검사를 다른 주제로 우회하지 않는다.
    topic = screen_topic  # D-80: 확정 때 저장할 주제로 방향을 계산한다.
    state = page.evaluate(STATE)  # D-80: 지난달 값은 공개 결과에서 읽는다.
    player = page.evaluate("() => KCP.league.state().team")  # D-80: 멀티에서도 팀 도시를 기준으로 한다.
    previous = next((r for r in state["results"] if r["round"] == state["round"] - 1), None)  # D-80: 첫 달만 시험 기준.
    if topic == "grid":  # D-80: 지난달은 지난달 일수, 시험은 이번 달 일수로 환산한다.
        baseline = public_grid_mwh(previous, player) if previous else trial["gridMWh"] * expected["days"] / trial["days"]  # D-80: 계약 A.
    else:  # D-80: 정전·현금의 기존 비교 기준을 유지한다.
        baseline = 0 if topic == "cash" else baseline if baseline is not None else trial["unsPct"]  # D-80: 현금은 운영 전 대비.
    actual = expected[topic]  # D-80: 주제별 복제 운영 기대값.
    delta = actual - baseline  # D-80: UI promiseComparison/gridReliance 호출 없이 계산한다.
    # D-82 결정 1·화면 지시서: S6 표시 차이도 두 기간 각각의 일평균을 사용한다.
    base_per_day = (public_grid_mwh(previous, player) / period_days(previous) if previous else trial["gridMWh"] / trial["days"]) if topic == "grid" else None  # D-82
    same = abs(actual / expected["days"] - base_per_day) <= max(.05, .05 * abs(base_per_day)) if topic == "grid" else abs(delta) < .5  # D-82
    direction_delta = actual / expected["days"] - base_per_day if topic == "grid" else delta  # D-82
    direction = "same" if same else "up" if direction_delta > 0 else "down"  # D-82: 일평균 부호.
    prediction = direction if hit else ("down" if direction != "down" else "up")  # D-80: 모든 주제에서 맞히기/틀리기 의도 유지.
    select.select_option(prediction)  # D-80: 화면에 존재하는 주제만 조작한다.
    page.locator('[data-confidence="fairly"]').click()
    page.locator("#lg-ready-confirm").click()
    return {"topic": topic, "prediction": prediction, "direction": direction, "hit": hit,  # D-80: 운영 뒤 검증용 기대값.
            "baseline": baseline, "actual": actual, "delta": direction_delta,  # D-82 결정 1·화면 지시서: grid는 독립 일평균 Δ, 다른 주제는 기존 값.
            "grid_digits": 2 if topic == "grid" and max(.05, .05 * abs(base_per_day)) < .1 else 1,
            "basis": "운영 전 대비" if topic == "cash" else "지난달 대비" if previous else "시험 1주 대비"}  # D-80: 기준 문구도 검사한다.


def promise_result(checks, page, expected, label):  # D-80: 주제별 S6 판정과 복제 기대값을 실제 운영에 대조한다.
    topic = expected["topic"]  # D-80: 약속 때 화면에서 읽은 주제는 운영 뒤에도 고정되어야 한다.
    state = public_state(page)  # D-80: 현금의 econ.before를 포함한 공개 운영값만 읽는다.
    player = page.evaluate("() => KCP.league.state().team")  # D-80: 혼자·멀티 공통.
    result = state["results"][-1]  # D-80: 이번 달 공개 운영 결과.
    actual = (public_grid_mwh(result, player) if topic == "grid" else result["team"][player]["unsPct"] if topic == "uns"  # D-80: 계약 A.
              else state["econ"]["cities"][player]["cash"] - state["econ"]["before"][player]["cash"])  # D-80: 현금은 운영 전 대비.
    checks.ok(actual == expected["actual"], f"{label} {topic} 복제 기대값 = 실제 공개 운영값")  # D-80: 기존 복제 일치 검사 유지.
    compare = page.locator(f'[data-compare="{topic}"]').inner_text()  # D-80: grid·cash도 동일한 판정 의도 검사.
    note = current_note(page)  # D-80: 저장 주제·예측·판정도 확인한다.
    checks.ok(note.get("topic") == topic and note.get("pred", {}).get(topic) == expected["prediction"] and  # D-80: 약속 주제 고정.
              note.get("outcome", {}).get("actual") == expected["direction"] and  # D-80: 독립 방향 기대값.
              note.get("outcome", {}).get("hit") is expected["hit"], f"{label} {topic} 저장 판정 = 독립 기대 방향·적중")  # D-80: 적중 의도 완화 금지.
    verdict = "예상과 같음" if expected["hit"] else "예상과 다름"  # D-80: 틀리기/맞히기 양쪽 확인.
    checks.ok(verdict in compare and expected["basis"] in compare, f"{label} {topic} 화면 판정·비교 기준 일치")  # D-80: B-3.
    unit = "MWh/일" if topic == "grid" else "%p" if topic == "uns" else "억"  # D-82 결정 1·화면 지시서: 판정과 같은 일평균 단위.
    # rev10 R2: 같음 문장의 ±tol을 Δ로 오인하지 않도록 마지막 %p 수치를 읽는다.
    matches = list(re.finditer(r"([+−-]?\d[\d,]*(?:\.\d+)?)\s*" + re.escape(unit), compare))
    match = matches[-1] if topic == "uns" and matches else matches[0] if matches else None  # D-82 결정 1·화면 지시서: 첫 MWh/일 차이를 검사, 월 합계와 혼동 금지.
    step = (".01" if expected["grid_digits"] == 2 else ".1") if topic == "grid" else ".01"  # D-80: 화면 표시 자릿수만 반영한다.
    displayed = Decimal.from_float(expected["delta"]).quantize(Decimal(step), rounding=ROUND_HALF_UP)  # D-80: 이진 실수의 표시 반올림값과 대조, 허용 오차 확대 없음.
    checks.ok(match is not None and Decimal(match[1].replace("−", "-").replace(",", "")) == displayed,  # D-80: B-3 수치.
              f"{label} {topic} 표시 차이 = 독립 기대값의 {unit} 반올림")  # D-80: 기존 월간 판정 수치 검사를 세 주제로 확장한다.


def current_note(page):
    return page.evaluate("""() => {
      const L=KCP.league.state(), V=L.snap || L.S;
      // 혼자 하기는 state()가 interview를 내보내지 않는다. 기기 저장본(kcp-league-solo-v1)에서 읽는다.
      const d=L.role==='solo' ? JSON.parse(localStorage.getItem('kcp-league-solo-v1') || '{}').interview :
        JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`));
      return d?.interview?.months?.[V.round] || {};
    }""")


def current_attribution(page):
    return page.evaluate("""() => {
      const L=KCP.league.state(), V=L.snap || L.S;
      return KCP.league.uiMath.outageAttribution(V,V.results.at(-1),L.team);
    }""")


def frozen_after_retrial(checks, page, label):
    """실제 시험 UI로 저장 시험을 교체하고, 공개 당시 DOM·기기 기록을 비교한다."""
    def snapshot():
        return page.locator("#lg-missed").evaluate("""root => ({
          opened: root.dataset.opened,
          tags: [...root.querySelectorAll('[data-out-tag]')].map(n =>
            [n.closest('[data-missed]')?.dataset.missed, n.dataset.outTag, n.textContent]),
          bars: [...root.querySelectorAll('[data-out-step]')].map(n =>
            [n.dataset.outStep, n.dataset.outValue, n.textContent,
             n.querySelector('.lg-out-bar')?.getAttribute('style')]),
          summary: root.querySelector('#lg-outage-single')?.textContent,
          verdict: root.querySelector('#lg-outage-verdict')?.textContent,
          aria: root.querySelector('#lg-outage-waterfall')?.getAttribute('aria-label')
        })""")

    before = snapshot()
    note = current_note(page)
    required(checks, bool(note.get("missedCarry")) and
             bool(note.get("outageOpened") or note.get("outageSingleShown")),
             f"{label} 재시험 전에 공개·다음 달 기록 존재")
    trial = page.evaluate("() => KCP.buildGame.lastTrial()")
    required(checks, trial["days"] == 7, f"{label} 재시험 전 저장 시험 1주")
    state = read(page)["S"]
    # D-67: 멀티에서는 1달·3달 시험 버튼이 숨겨져 있으므로 1주를 다시 실행한다.
    days = 30 if page.evaluate("() => KCP.league.state().role") == "solo" else 7
    close_drawer(page)
    page.locator(f'[data-run="{days}"]').click()
    finish_trial(page, days)
    next_trial = page.evaluate("() => KCP.buildGame.lastTrial()")
    required(checks, next_trial["days"] == days and next_trial["month"] == trial["month"],
             f"{label} 결과 단계에서 같은 달 시험 1주 → {'1달' if days == 30 else '1주'} 실제 재실행")
    page.locator("#bd-drawer-x").click()
    open_panel(page, "result")
    checks.ok(page.evaluate(SYNC, [state["round"], "review"]), f"{label} 재시험 뒤 같은 달 결과 단계")
    for suffix in ("재시험", "재시험 후 새로고침"):
        if suffix.endswith("새로고침"):
            page.reload()
            page.wait_for_function(SYNC, arg=[state["round"], "review"])
            open_panel(page, "result")
        checks.ok(snapshot() == before, f"{label} {suffix}: 연 시점 꼬리표·막대·판정 유지")
        after = current_note(page)
        checks.ok(all(after.get(k) == note.get(k) for k in ("outageLargest", "missedCarry")),
                  f"{label} {suffix}: 연 시점 최대 몫·다음 달 기록 유지")


def copy_worksheet(page):
    page.evaluate("""() => {
      delete window.__s7Journal;
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async text=>{window.__s7Journal=text;}}});
    }""")
    page.locator("#lg-jcopy").click()
    page.wait_for_function("() => typeof window.__s7Journal==='string'")
    return page.evaluate("window.__s7Journal")


def no_answer_records(checks, page, label):
    if page.evaluate(STATE)["round"] > 1:
        return monthly_no_answer_records(checks, page, label)
    note = current_note(page)
    checks.ok(not any(note.get(k) for k in ("outageOpened", "outageSingleShown", "outageLargest", "outageFrozen")),
              f"{label} 열기/요약 표시 전 최대 몫 저장 없음")
    # 끝 단계까지 가지 않은 달에도 같은 공개 타임라인 렌더러 전체를 검사한다.
    # 기존 기록이나 결과·약속 값을 주입하지 않는다. 범례도 문구 금지의 예외가 아니다.
    html = page.evaluate("""() => {
      const L=KCP.league.state();
      return KCP.league.uiMath.trendHTML(L.snap || L.S,L.team,true);
    }""")
    checks.ok("가장 큰 몫" not in html and 'data-change="outage"' not in html,
              f"{label} 열기 전/적중 타임라인 전체에 최대 몫·원 표시 없음")
    open_panel(page, "journal")
    checks.ok("가장 큰 몫" not in page.locator("#lg-panel").text_content(),
              f"{label} 일지 DOM 최대 몫 없음")
    checks.ok("가장 큰 몫" not in copy_worksheet(page), f"{label} 활동지 최대 몫 없음")
    open_panel(page, "result")


def hidden_answer(checks, root, label, card=False):
    surface = root.evaluate(SURFACE)
    checks.ok(not re.search(r"\d\s*%p", surface["text"]) and
              not any(s in surface["text"] for s in ("가장 큰 몫", "가장 큼", "가장 큰 것")),
              f"{label} 열기 전 DOM에 원인 %p·최대 없음 [I20–21]")
    leaks = [(key, value) for key, value in surface["attrs"] if
             (key == "data-out-value" and value.strip()) or
             (key.startswith("data-") and re.search(r"\d", value)) or
             re.search(r"\d\s*%p", value) or
             (re.fullmatch(r"[+−-]?\d+(?:\.\d+)?", value.strip()))]
    checks.ok(not leaks, f"{label} aria/title/data 정답 유출 0: {leaks}")
    # 원인 크기 숫자를 단위와 다른 노드로 나누어 감춘 경우도 잡는다.
    checks.ok(not any(re.fullmatch(r"[+−-]?\d+\.\d+", s) for s in surface["leaves"]),
              f"{label} 숨은 소수 크기 텍스트 없음")
    if card:
        text = surface["text"].strip()
        key = root.get_attribute("data-missed")
        clue = text.replace(NAMES.get(key, ""), "").replace("?", "").strip()
        checks.ok("?" in text and len(clue) >= 8, f"{label} 크기 ? + 실제 단서 문구 [I20]")


def bottleneck(checks, page, a, label):
    """DOM 배선 검사. 전량 연결−실제 고립의 독립 수치 검산은 Node 30·32에서 수행."""
    grid = a["grid"]
    show = grid["waitingMW"] > 0 and math.isfinite(grid["value"]) and abs(grid["value"]) >= part_min(a)  # D-80: C-1·2·4·5 대상별 검사.
    box = page.locator("#lg-outage-grid-bottleneck")
    checks.ok(box.count() == int(show), f"{label} 대기>0·|반사실|≥0.05%p일 때만 병목 상자")
    checks.ok(page.locator("#lg-outage-single-grid").count() == 0 and
              page.locator("#lg-missed [data-out-grid]").count() == int(show),
              f"{label} 옛 선택자 대체·병목 수치 중복 없음")
    small = page.locator("#lg-outage-grid-small")
    show_small = grid["waitingMW"] > 0 and math.isfinite(grid["value"]) and abs(grid["value"]) < part_min(a)  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(small.count() == int(show_small), f"{label} 작은 대기 줄은 효과 0.05%p 미만")
    if small.count():
        waiting_text = page.evaluate("mw => mw.toLocaleString('ko-KR', {maximumFractionDigits:1})", grid["waitingMW"])
        checks.ok(small.is_visible() and (small.inner_text() == f"접속 대기 {waiting_text} MW(효과 0.05%p 이하)" if a.get("target") != "grid" else f"접속 대기 {waiting_text} MW" in small.inner_text() and "MWh" in small.inner_text() and "%p" not in small.inner_text()),  # D-80: C-1·2·4·5 대상별 검사.
                  f"{label} 작은 대기 실제 표시·대기량·문턱 문구")
    checks.ok(page.locator("#lg-outage-grid").count() == int(show) and
              page.locator("#lg-outage-grid-bottleneck #lg-outage-grid").count() == int(show),
              f"{label} grid 설명은 병목 상자 안에만")
    if not show or box.count() != 1:
        return small.evaluate("el => el.outerHTML") if small.count() else None
    checks.ok(box.is_visible(), f"{label} 병목 상자 실제 표시(열기 여부와 무관)")
    raw = float(box.locator("[data-out-grid]").get_attribute("data-out-grid"))
    text = box.locator("[data-out-grid]").inner_text()
    checks.ok(abs(raw - grid["value"]) <= 1e-9 and share_pattern(a).fullmatch(text) is not None and  # D-80: C-1·2·4·5 대상별 검사.
              abs(float(VALUE.fullmatch(text)[1].replace("−", "-").replace(",", "")) - rounded_share(raw, a)) <= 1e-9,  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 병목 반사실 원시값·숫자 형식")
    surface = box.evaluate(SURFACE)
    checks.ok("대기가 없었다면" in surface["text"] and ("계통" if a.get("target") == "grid" else "정전") in surface["text"] and "분해 합계 밖" in surface["text"],  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 실제 조건 반사실·합계 밖 설명")
    # 병목의 %p 한 개만 허용한다. 카드 몫/최대 답을 CSS·aria·data로 숨겨도 실패.
    checks.ok(len(share_pattern(a).findall(surface["text"])) == 1 and  # D-80: C-1·2·4·5 대상별 검사.
              len(re.findall(r"[+−-]?\d[\d,]*(?:\.\d+)?", surface["text"])) == 2 and
              not any(k in ("data-out-value", "data-missed", "data-out-tag") or
                      (k != "data-out-grid" and re.search(r"\d", v)) or
                      "가장 큰" in v for k, v in surface["attrs"]) and
              "가장 큰" not in surface["text"], f"{label} 병목에는 카드 몫·정답 없음")
    checks.ok(box.evaluate("el => {const next=document.querySelector('#lg-outage-cards, #lg-outage-single'); "
                           "return !!next && !!(el.compareDocumentPosition(next)&Node.DOCUMENT_POSITION_FOLLOWING);}"),
              f"{label} 카드/한 줄 요약 위 별도 병목 상자")
    return box.evaluate("el => el.outerHTML")


def number_format(checks, row, key, label, page):  # D-80: C-1·2·4·5 대상별 검사.
    text = row.locator("b").inner_text()
    a = current_attribution(page)  # D-80: C-4, 행이 속한 현재 대상.
    pattern = share_pattern(a) if a.get("target") == "grid" else S7_RATE if key in ("trial", "previous", "actual") else S7_SHARE  # D-80: C-1·2·4·5 대상별 검사.
    raw = float(row.get_attribute("data-out-value"))
    valid = pattern.fullmatch(text) is not None if math.isfinite(raw) else text == ("– MWh/일" if a.get("target") == "grid" else "–%" if key in ("trial", "previous", "actual") else "–%p")  # D-82
    checks.ok(valid, f"{label} {key} 숫자 형식·비유한 숫자는 –")



def weather_short_from_detail(full):
    detail = full.split(" · 최대 수요 ", 1)[0]
    renewable = re.search(r"하루 재생 공급량 ([\d,.]+) → ([\d,.]+) MWh/일", full)
    entries = []
    for item in detail.split(" · "):
        arrow = re.fullmatch(r"(.+?) ([\d,.]+%?|봄|여름|가을|겨울) → ([\d,.]+%?|봄|여름|가을|겨울)(.*)", item)
        if item.startswith("하루 재생 공급량") or item == "재생 공급 없음":
            assert renewable is not None
            same = renewable[1] == renewable[2]
            flat = "재생 공급 없음" if item == "재생 공급 없음" or item.endswith("−100%") else f"하루 재생 공급량 {renewable[2]} MWh/일"
        elif arrow:
            same = arrow[2] == arrow[3]
            flat = f"{arrow[1]} {arrow[3]}{arrow[4]}"
        else:
            raise AssertionError(f"해석할 수 없는 날씨 항목: {item}")
        entries.append((same, item, flat))
    changes = [text for same, text, _ in entries if not same]
    unchanged = [flat for same, _, flat in entries if same]
    body = " · ".join(changes + (["같음: " + " · ".join(unchanged)] if unchanged else []))
    with_tail = body + " · 자세한 값은 단서 더 보기"
    return body if len(with_tail) > 70 else with_tail


def clue_and_evidence(checks, page, a, label):
    """DOM 배선·실제 기기 근거 방향 검사. 날씨 물리량/순서의 독립 모델 검산은 Node 30·32."""
    short = (a.get("clues") or {}).get("weather")
    full = (a.get("clueMore") or {}).get("weather")
    required(checks, isinstance(short, str) and bool(short), f"{label} clues.weather 짧은 날씨 단서 누락")
    required(checks, isinstance(full, str) and bool(full), f"{label} clueMore.weather 상세 날씨 단서 누락")
    period = re.search(r"대표 운전 (\d+) → (\d+)일", full)
    required(checks, period is not None, f"{label} 상세 날씨의 대표 운전 기간 누락")
    hot_pattern = r"무더위 \d+ → \d+일" if period[1] == period[2] else r"무더위 \d+% → \d+% 날"
    checks.ok(short == weather_short_from_detail(full) and "육상 기준" not in short,
              f"{label} 변경 항목→같음 묶음→70자 꼬리말, 상세 물리량과 정확히 일치")
    checks.ok(re.search(r"평균 수요 [\d,.]+ → [\d,.]+ MW", full) is not None and
              re.search(hot_pattern, full) is not None, f"{label} 상세 수요·기간별 무더위 원문 유지")
    checks.ok(("하루 재생 공급량" in short or "재생 공급 없음" in short) and
              "하루 재생 가능량" not in short, f"{label} 실제 재생 공급량 문구")
    checks.ok("접속 할당·출력제어를 반영해 실제 공급한 양" in full and
              "변화의 절댓값으로 정해요(게임 가정)" in full,
              f"{label} 공급량 정의·부호 없는 단서 순서 안내")
    weather_card = page.locator('[data-missed="weather"] .lg-out-clue')
    if weather_card.count():
        # rev19 #90 개정 1: 열린 뒤 숨긴 카드 단서는 모든 너비에서 more DOM에 남아야 한다(접힘 허용).
        duplicate = (page.locator('#lg-missed[data-opened="true"]').count() == 1 and
                     not weather_card.is_visible() and
                     page.locator('#lg-outage-more').count() == 1 and
                     short in page.locator('#lg-outage-more').text_content())
        checks.ok(duplicate or (weather_card.is_visible() and weather_card.inner_text() == short), f"{label} 날씨 카드 = 검산된 짧은 단서 API")
    more = page.locator("#lg-outage-more")
    required(checks, more.count() == 1, f"{label} #lg-outage-more 상세 단서 DOM 누락 또는 중복")
    checks.ok(full in more.text_content(),
              f"{label} 상세 날씨 DOM 배선")
    if page.locator("#lg-outage-verdict").count() == 0:
        return
    names = MONTHLY_NAMES if a.get("basis") == "monthly" else NAMES
    # 구현 표와 같음(회귀 고정). 모든 짝이 독립 명세에서 나왔다는 뜻은 아니다.
    # 지시서의 grid→progress/fuel/풍력 없음/evening→choice는 Node 32에서 개별 단언한다.
    # 명세 A2: 접속 여유→내 선택은 같은 단계, 진행은 직접 연결.
    links = {"evening": {"choice": "stage", "weather": "direct", "event": "direct", "growth": "direct"},
             "wind": {"weather": "direct", "event": "direct"}, "grid": {"choice": "stage", "progress": "direct"},
             "fuel": {"event": "indirect", "growth": "indirect"}, "neighbor": {"progress": "indirect", "trade": "direct"}}
    notes = device_data(page).get("interview", {}).get("months", {})
    note = current_note(page)
    evidence = note.get("evidence", {})
    key = evidence.get("key")
    if not a.get("hasConnectedWind", False):
        links["wind"] = {"weather": "indirect", "event": "indirect"}
    previous = notes.get(str(a["round"] - 1), {})
    # V8 N1: 시작 메모가 있으면 두 달 시작 값으로 비교하고, 없을 때만 옛 경로.
    if previous.get("s1EvidenceValues") is not None:
        old_value = previous["s1EvidenceValues"].get(key)
    else:
        old_value = previous.get("evidenceValues", {}).get(key)
        if old_value is None and previous.get("evidence", {}).get("key") == key:
            old_value = previous["evidence"].get("value")
    value = note["s1EvidenceValues"].get(key) if note.get("s1EvidenceValues") is not None else evidence.get("value")
    if (key == "neighbor" and note.get("s1EvidenceValues") is not None and
            previous.get("s1EvidenceValues") is not None and
            (not note.get("s1EvidenceNeighborId") or
             note["s1EvidenceNeighborId"] != previous.get("s1EvidenceNeighborId"))):
        old_value = None
    sign = {"evening": 1, "grid": 0, "wind": -1 if a.get("hasConnectedWind", False) else 0, "neighbor": 1}.get(key, 0)
    step = {"evening": .01, "grid": .02, "wind": .02, "neighbor": .02}.get(key, .01)
    evidence_sign = 0
    if a.get("basis") == "monthly" and isinstance(old_value, (int, float)) and isinstance(value, (int, float)) and math.isfinite(old_value) and math.isfinite(value):
        change = value - old_value
        if sign and abs(change) >= max(abs(old_value) * step, .5 if key == "neighbor" else .01):
            evidence_sign = 1 if change * sign > 0 else -1
    largest = max(a["parts"], key=lambda p: abs(p["value"]))
    largest = largest if abs(largest["value"]) >= part_min(a) else None  # D-80: C-1·2·4·5 대상별 검사.
    expected_links = links.get(key, {})
    # D-80 접힘(D80-s7-fold.md): '내 예측이 놓친 것'은 #lg-outage-verdict 안의 닫힌 #lg-outage-evidence에 있다.
    # 학생처럼 펼친 뒤 읽는다. 접힘이 없는 옛 구조면 셋째 줄을 읽는다.
    page.evaluate("() => { const d = document.getElementById('lg-outage-evidence'); if (d) d.open = true; }")
    text = page.locator("#lg-outage-evidence p").first.inner_text() if page.locator("#lg-outage-evidence").count() else page.locator("#lg-outage-verdict p").nth(2).inner_text()
    for kind, prefix in (("direct", "직접 연결 — "), ("stage", "같은 단계와 연결 — "), ("indirect", "간접 연결 — ")):
        linked = [p for p in a["parts"] if expected_links.get(p["key"]) == kind]
        checks.ok((prefix in text) == bool(linked), f"{label} {kind} 근거 연결 구분")
        checks.ok(all(names[p["key"]] in text for p in linked), f"{label} {kind} 연결된 몫 이름")
    direct = bool(largest and expected_links.get(largest["key"]) == "direct")
    largest_sign = (1 if largest["value"] > 0 else -1) if largest else 0
    checks.ok(("고른 근거는 이번 차이의 가장 큰 몫과도 이어져요." in text) ==
              (direct and bool(evidence_sign) and evidence_sign == largest_sign), f"{label} 칭찬은 직접 연결·방향 일치일 때만")
    checks.ok(("고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요." in text) ==
              (direct and bool(evidence_sign) and evidence_sign != largest_sign), f"{label} 반대 방향 지정 문구")
    opposite = bool(direct and evidence_sign and evidence_sign != largest_sign)
    checks.ok(text.endswith("이 근거만으로 이번 차이의 방향을 설명하기는 어려워요.") == opposite,
              f"{label} 반대 방향 마무리")
    neutral = bool(direct and not evidence_sign)
    ending = f"고른 근거가 가장 큰 몫({names[largest['key']]})과 같은 이야기예요." if largest else ""
    checks.ok(bool(ending and text.endswith(ending)) == neutral, f"{label} 직접 연결·부호 0은 중립 마무리")
    # 명세 A2: 접속 여유·내 선택 최대는 중립 칭찬 대신 다음 근거 안내.
    if key == "grid" and largest and largest["key"] == "choice":
        checks.ok("같은 이야기" not in text and "같은 단계" in text and
                  re.search(r"다음에는 .+도 근거로 살펴봐요", text), f"{label} A2 같은 단계·다음 근거")
    if neutral or opposite:
        checks.ok("다음에는" not in text and "살펴봐요" not in text, f"{label} 이미 고른 직접 근거의 재검토 권유 없음")


def selectable_cards(checks, page, label):
    """표시된 모든 카드가 선택·열기 단계에서도 허용되는지 실제 클릭으로 확인."""
    keys = page.locator("#lg-outage-cards [data-missed]").evaluate_all("nodes => nodes.map(n => n.dataset.missed)")
    for key in keys:
        page.locator(f'#lg-outage-cards [data-missed="{key}"]').click()
        checks.ok(page.locator(f'#lg-outage-cards [data-missed="{key}"]').get_attribute("aria-pressed") == "true" and
                  not page.locator("#lg-outage-open").is_disabled() and current_note(page).get("missed") == key,
                  f"{label} 표시 카드 {key} 선택·열기 허용 집합 일치")

def link(checks, page, selector, new_tab, label):
    a = page.locator(selector)
    required(checks, a.count() == 1 and a.is_visible(), f"{label} 연결 표시 [I38]")
    checks.ok(a.get_attribute("href") == "#y2022", f"{label} 충실판 주소 [I37]")
    checks.ok(a.inner_text() == "2022 기출로 연습하기", f"{label} 수정된 링크 문구")
    target = a.get_attribute("target")
    checks.ok(target == "_blank" if new_tab else target in (None, "", "_self"),
              f"{label} {'새' if new_tab else '같은'} 탭 [I40]")
    if new_tab:
        checks.ok("noopener" in (a.get_attribute("rel") or "").split(), f"{label} noopener [I40]")
    # 명세상 링크 옆의 한 줄도 허용한다. 시안처럼 링크 자체 글자만 강제하지 않는다.
    text = a.evaluate("el => el.parentElement.textContent")
    checks.ok(all(word in text for word in ("근거", "반문")) and
              any(word in text for word in ("설명", "말", "대응")), f"{label} 연습할 사고 습관 한 줄 [I39]")


def track_drawn(checks, page, key, label):
    """폭포 막대 칸이 보이는 폭으로 그려졌는지 페이지 안에서 조건 대기로 확인한다.

    Playwright bounding_box는 CPU 감속·부하 중 요소가 연결되어 있고 폭이 152px인데도
    None을 돌려준 적이 있다(2026-10-22, 8배 감속 측정). 그래서 막대 칸을 페이지 안에서 직접 재고,
    학생에게 의미 있는 공백 기준인 1초 안에 보이는 폭이 되지 않으면 실패로 둔다.
    """
    checks.test(label, lambda: page.wait_for_function("""key => {
      const t = document.querySelector(`#lg-outage-waterfall [data-out-step="${key}"] .lg-out-track`);
      return !!t && t.checkVisibility() && t.getBoundingClientRect().width > 0;
    }""", arg=key, timeout=1000))


def scene(checks, page, requests, label, width, trial, actual):
    open_panel(page, "result")
    page.evaluate("() => { const d = document.getElementById('lg-month-details'); if (d) d.open = true; }")  # D-80 UX 접힘(cc4b9d6): 펼친 뒤 읽는다.
    required(checks, "다름" in page.locator('#lg-promise-result').inner_text(),
             f"{label} 반대 예측 → 다름 [요청1, 목표4]")
    root = page.locator("#lg-missed")
    required(checks, root.count() == 1 and root.get_attribute("data-single") == "false",
             f"{label} 두 원인이 있는 첫 달 카드 분기(생략으로 통과시키지 않음) [I24]")
    student_words(checks, page, label + " 첫 달 열기 전")
    cards = page.locator("#lg-outage-cards [data-missed]")
    required(checks, 2 <= cards.count() <= 3, f"{label} 유의미한 원인 카드 2~3장 [I20]")
    closed_card_keys = [c.get_attribute("data-missed") for c in cards.all()]
    checks.ok(closed_card_keys == [key for key in NAMES if key in closed_card_keys],
              f"{label} 열기 전 카드도 분해 순서의 부분열")
    closed_box = bottleneck(checks, page, current_attribution(page), label + " 열기 전")
    checks.ok(root.get_attribute("data-opened") == "false", f"{label} 고르기 전 닫힘")
    checks.ok(root.get_attribute("data-out-value") in (None, "") and
              all(n.get_attribute("data-out-value") == "" for n in root.locator('[data-out-value]').all()),
              f"{label} 닫힌 장면 전체 data-out-value 없음/빈 값 [요청2]")
    checks.ok(not shown(page, "#lg-outage-waterfall") and not shown(page, "#lg-outage-verdict"),
              f"{label} 고르기 전 폭포·판정 숨김 [I22]")
    for i in range(cards.count()):
        hidden_answer(checks, cards.nth(i), f"{label} 카드{i+1}", card=True)
    hidden_answer(checks, page.locator("#lg-outage-others"), label + " 나머지 후보")
    hidden_answer(checks, page.locator("#lg-outage-more"), label + " 상세 단서")
    checks.ok(all(c.get_attribute("data-missed") in NAMES for c in cards.all()),
              f"{label} 카드 후보는 네 원인만(내 선택이 상위 3개 밖이면 허용)")  # D-80: C-1·2·4·5 대상별 검사.
    no_answer_records(checks, page, label)
    checks.ok(page.locator("#lg-outage-open").is_disabled(), f"{label} 고르기 전에 열 수 없음 [I22]")
    if width == 390:
        boxes = [c.bounding_box() for c in cards.all()]
        checks.ok(all(b and b["height"] >= 44 for b in boxes), f"{label} 카드 버튼 ≥44px [I28]")
        checks.ok(all(boxes[i]["y"] >= boxes[i-1]["y"] + boxes[i-1]["height"] - 1
                      for i in range(1, len(boxes))), f"{label} 카드 세로 배치 [I28]")
        checks.ok(page.locator("#lg-outage-open").bounding_box()["height"] >= 44,
                  f"{label} 열기 버튼 ≥44px [I28]")
    cards.first.scroll_into_view_if_needed()
    capture(checks, page, label, "before")
    before_requests = len(requests)
    selectable_cards(checks, page, label)
    clue_and_evidence(checks, page, current_attribution(page), label + " 닫힘")
    # 1280 밝음 혼자 하기는 최대가 아닌 유의미한 몫을 반드시 고른다.
    # 계산 API는 사례 선택에만 쓰고, 실제 판정은 열린 막대·꼬리표와 다시 비교한다.
    nonlargest = label == "1280x900-light-solo"
    picked = cards.first.get_attribute("data-missed")
    if nonlargest:
        parts = current_attribution(page)["parts"]
        maximum = max(abs(p["value"]) for p in parts)
        candidates = {c.get_attribute("data-missed") for c in cards.all()}
        choices = [p["key"] for p in parts if p["key"] in candidates and
                   part_min(current_attribution(page)) <= abs(p["value"]) < maximum]  # D-80: C-1·2·4·5 대상별 검사.
        required(checks, bool(choices), f"{label} 최대가 아닌 유의미한 카드 존재")
        picked = choices[0]
    page.locator(f'#lg-outage-cards [data-missed="{picked}"]').click()
    for c in cards.all():
        hidden_answer(checks, c, label + " 고른 뒤 열기 전", card=True)
    student_words(checks, page, label + " 첫 달 선택 후 열기 전")
    page.locator("#lg-outage-open").click()
    student_words(checks, page, label + " 첫 달 열기 후")
    checks.ok(page.locator("#lg-outage-verdict").get_attribute("tabindex") == "-1" and
              page.evaluate("document.activeElement?.id") == "lg-outage-verdict",
              f"{label} 열기 뒤 판정 머리로 초점 이동")
    required(checks, root.get_attribute("data-opened") == "true", f"{label} 열기 상태 보존 [I22]")
    for c in cards.all():
        match = VALUE.search(c.locator(".lg-out-size").inner_text())  # D-80: C-1·2·4·5 대상별 검사.
        raw = c.get_attribute("data-out-value")
        checks.ok(match is not None and share_pattern(current_attribution(page)).fullmatch(c.locator('.lg-out-size').inner_text()) is not None and raw not in (None, "") and  # D-80: C-1·2·4·5 대상별 검사.
                  share_matches(float(match[1].replace("−", "-").replace(",", "")), float(raw), current_attribution(page), c.get_attribute('data-missed')),  # D-80: C-1·2·4·5 대상별 검사.
                  f"{label} 열린 카드 %p와 속성 크기 일치 [I22]")
    checks.ok(page.locator('[data-out-tag="picked"]').inner_text() == "내가 고름" and
              page.locator(f'[data-missed="{picked}"] [data-out-tag="picked"]').count() == 1,
              f"{label} 고른 카드 꼬리표 [I22]")
    checks.ok(page.locator('[data-out-tag="largest"]').inner_text() == "가장 큼", f"{label} 최대 몫 꼬리표 [I22]")
    order = page.locator("#lg-outage-order").inner_text()
    checks.ok("이번 달 계산 순서: " + " → ".join(NAMES.values()) in order and
              "순서를 바꾸면 몫이 달라질 수 있는 추정이에요. 게임에서 정한 순서예요." in order,
              f"{label} 순서 의존 안내 [I23]")
    rows = page.locator("#lg-outage-waterfall [data-out-step]")
    values, visible = {}, {}
    for row in rows.all():
        key = row.get_attribute("data-out-step")
        values[key] = float(row.get_attribute("data-out-value"))
        matches = VALUE.findall(row.inner_text())
        required(checks, len(matches) == 1, f"{label} {key} 화면 수치 한 개")
        visible[key] = float(matches[0].replace("−", "-").replace(",", ""))
        checks.ok(share_matches(visible[key], values[key], current_attribution(page), key), f"{label} {key} 표시 반올림")  # D-80: C-1·2·4·5 대상별 검사.
        number_format(checks, row, key, label, page)  # D-80: C-1·2·4·5 대상별 검사.
        if values[key] < 0:
            checks.ok(row.locator('[data-negative="true"]').count() == 1, f"{label} {key} 감소 막대")
        track_drawn(checks, page, key, f"{label} {key} 실제 막대 칸 폭 > 0 ({width}px)")
    # D-80: C-2, 시험 폭포는 네 원인+출발/도착(+재현)의 6/7행.
    required(checks, set(values) - {"replay"} == {"trial", "actual", *NAMES} and
             rows.count() == len(NAMES) + 2 + int("replay" in values),
             f"{label} 시험 + (재현 차이) + 네 원인 + 실제")  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(page.locator('[data-out-step="overlap"]').count() == 0, f"{label} 겹침 막대 0개")
    replay = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.snap || L.S;
      return KCP.league.uiMath.outageAttribution(V,V.results.at(-1),L.team).replay;
    }""")
    checks.ok(("replay" in values) == (abs(replay) >= .005) and  # D-80: C-1·2·4·5 대상별 검사.
              page.locator("#lg-outage-replay").count() == int(abs(replay) >= .005),  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 재현 차이·설명은 절댓값 0.005%p 이상일 때만")
    checks.ok(all(n.get_attribute("data-out-other") in NAMES for n in page.locator('[data-out-other]').all()),
              f"{label} 나머지 후보도 네 원인만")  # D-80: C-1·2·4·5 대상별 검사.
    waterfall = page.locator("#lg-outage-waterfall")
    aria = waterfall.get_attribute("aria-label") or ""
    aria_values = [float(v.replace("−", "-").replace(",", "")) for v in VALUE.findall(aria)]
    checks.ok(waterfall.get_attribute("role") == "img" and
              all(name in aria for name in ("시험", *NAMES.values(), "실제")) and
              aria_values == list(visible.values()), f"{label} 폭포 수치 요약 aria-label")
    expected_base, expected_actual = attribution_endpoints(page, current_attribution(page))  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(abs(values["trial"] - expected_base) <= 1e-9 and abs(values["actual"] - expected_actual) <= 1e-9,  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 폭포 출발·도착 = 실제 저장 시험·운영")
    checks.ok(abs(values["trial"] + replay + sum(values[k] for k in NAMES) - values["actual"]) <= 1e-9,
              f"{label} 배선 일치: 재현 차이를 포함한 원시 합계 항등식")
    checks.ok(abs(sum(v for k, v in values.items() if k != "actual") + (replay if "replay" not in values else 0) - values["actual"]) <= 1e-9,  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 생략 재현 복원 뒤 폭포 원시 합계 1e-9")  # D-80: C-4, 단위별 표시 반올림과 원시 합계를 구분.
    assert_allocation_dom(checks, page, current_attribution(page), visible, label)
    largest = max(NAMES, key=lambda k: abs(values[k]))
    top = sorted((k for k in NAMES if abs(values[k]) >= part_min(current_attribution(page))), key=lambda k: abs(values[k]), reverse=True)[:3]  # D-80: C-1·2·4·5 대상별 검사.
    card_keys = [c.get_attribute("data-missed") for c in cards.all()]
    checks.ok(set(card_keys) == set(top) and len(card_keys) == len(set(card_keys)),
              f"{label} 카드는 |몫|≥0.05%p인 상위 최대 3개(DOM 검산; 독립 계산은 Node30)")
    checks.ok(card_keys == [key for key in NAMES if key in card_keys],
              f"{label} 카드 표시 순서는 분해 순서의 부분열(크기 순위와 무관)")
    checks.ok(card_keys == closed_card_keys, f"{label} 열기 전후 카드 순서 동일")
    for card in cards.all():
        checks.ok(card.locator("strong").inner_text() == NAMES[card.get_attribute("data-missed")],
                  f"{label} 시험 카드 이름 = 순서·폭포 이름")
    checks.ok(page.locator(f'[data-missed="{largest}"] [data-out-tag="largest"]').count() == 1,
              f"{label} 가장 큼은 절댓값 최대 원인")
    checks.ok(bottleneck(checks, page, current_attribution(page), label + " 열기 뒤") == closed_box,
              f"{label} 병목은 열기 전후 동일·카드 정답과 무관")
    clue_and_evidence(checks, page, current_attribution(page), label + " 열림")
    verdict = page.locator("#lg-outage-verdict").inner_text()
    if nonlargest:
        checks.ok(part_min(current_attribution(page)) <= abs(values[picked]) < abs(values[largest]) and picked != largest and  # D-80: C-1·2·4·5 대상별 검사.
                  "몫은 있지만 가장 크지 않았어요" in verdict,
                  f"{label} 최대가 아닌 선택의 판정 분기")
    checks.ok(all(s in verdict for s in ("내가 고른 것", "가장 큰 것", "내 예측이 놓친 것")),
              f"{label} 판단 비교 세 줄 [I22]")
    simulations = int(root.get_attribute("data-simulations"))
    ms = float(root.get_attribute("data-ms"))
    expected_calls = 5 if current_attribution(page)["grid"]["waitingMW"] > 0 else 4
    checks.ok(simulations == expected_calls, f"{label} 시험 기준 대기에 따라 {expected_calls}회 [I17]")
    checks.ok(math.isfinite(ms) and ms >= 0, f"{label} data-ms 읽기 [I18]")
    print(json.dumps({"S7_performance": label, "ms": ms, "simulations": simulations}, ensure_ascii=False), flush=True)
    calls = page.evaluate("window.__s7SimCalls")
    close_drawer(page)
    open_panel(page, "result")
    checks.ok(int(root.get_attribute("data-simulations")) == simulations and
              float(root.get_attribute("data-ms")) == ms and page.evaluate("window.__s7SimCalls") == calls,
              f"{label} 재열기 캐시: 실제 재시뮬레이션 0 [I17]")
    checks.ok(root.get_attribute("data-opened") == "true", f"{label} 재열기 공개 상태 유지")
    if width == 390:
        checks.ok(page.locator("#lg-outage-carry").bounding_box()["height"] >= 44,
                  f"{label} 붙이기 버튼 ≥44px [I28]")
    page.locator("#lg-outage-carry").click()
    checks.ok(page.locator("#lg-outage-carry").is_disabled(), f"{label} 다음 달에 붙이기 저장 [I26]")
    page.wait_for_timeout(500)
    checks.ok(len(requests) == before_requests, f"{label} 고르기·열기·붙이기 요청 증가 0 [I3/D-65]")
    link(checks, page, "#lg-y2022-result", True, label + " 결과")
    cards.first.scroll_into_view_if_needed()
    capture(checks, page, label, "opened")
    page.locator("#lg-outage-waterfall").scroll_into_view_if_needed()
    capture(checks, page, label, "waterfall")
    if nonlargest:
        frozen_after_retrial(checks, page, label)
    return {"picked": picked, "largest": largest, "largest_value": visible[largest],
            "nonlargest": nonlargest}


def carry(checks, page, expected, label):
    open_panel(page, "journal")
    c = page.locator("#lg-missed-carry")
    required(checks, c.count() == 1 and c.is_visible(), f"{label} 다음 달 지난달 내가 고른 원인 표시 [I26]")
    text = c.inner_text()
    if expected["nonlargest"]:
        checks.ok(expected["picked"] != expected["largest"] and
                  f'지난달 내가 고른 원인: {NAMES[expected["picked"]]}' in text and
                  f'가장 큰 몫 {NAMES[expected["largest"]]}' in text,
                  f"{label} 다음 달 줄에 고른 것 ≠ 가장 큰 것 표시")
    checks.ok(all(s in text for s in ("지난달 내가 고른 원인", NAMES[expected["picked"]],
                                     "가장 큰 몫", NAMES[expected["largest"]])) and
              any(abs(float(v.replace("−", "-").replace(",", "")) - expected["largest_value"]) <= .0051
                  for v in VALUE.findall(text)), f"{label} 선택과 최대 몫·수치 유지")
    # 새 S7 선택자를 만들지 않고 기존 약속 흐름의 #lg-predict와 문서 순서를 비교.
    checks.ok(c.evaluate("el => !!(el.compareDocumentPosition(document.querySelector('#lg-predict')) & Node.DOCUMENT_POSITION_FOLLOWING)"),
              f"{label} 약속 카드 위에 표시 [I26]")
    capture(checks, page, label, "carry")
    return text


def end_record(checks, page, expected, label):
    open_panel(page, "result")
    # 기존 solo.py의 끝 화면 계약. S7 기록이 타임라인과 일지 양쪽에서 사라지면 실패.
    text = page.locator("#lg-timeline").text_content()
    checks.ok(all(s in text for s in ("내가 고른 원인", NAMES[expected["picked"]], "가장 큰 몫",
                                     NAMES[expected["largest"]])), f"{label} 끝 타임라인 원인 기록 [I26]")
    link(checks, page, "#lg-y2022-end", False, label + " 끝")
    capture(checks, page, label, "end")
    journal = copy_worksheet(page)
    checks.ok(all(s in journal for s in ("내가 고른 원인", NAMES[expected["picked"]], "가장 큰 몫",
                                        NAMES[expected["largest"]])), f"{label} 끝 활동지 일지 원인 기록 [I26]")
    checks.ok(page.locator("#lg-timeline svg").get_attribute("viewBox") == "0 0 380 346",
              f"{label} 타임라인 높이 346")
    for kind, y in (("outage", "310"), ("build", "325"), ("policy", "340")):
        marks = page.locator(f'#lg-timeline [data-change="{kind}"] > text')
        checks.ok(all(mark.get_attribute("y") == y for mark in marks.all()),
                  f"{label} {kind} 표시 y={y} (월 이름과 분리)")


def device_data(page):
    return page.evaluate("""() => {
      const L=KCP.league.state();
      return L.role==='solo' ? JSON.parse(localStorage.getItem('kcp-league-solo-v1')).interview :
        JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`));
    }""")


def device_s7_data(page):
    return page.evaluate("""() => {
      const L=KCP.league.state();
      return L.role==='solo' ? JSON.parse(localStorage.getItem('kcp-league-solo-v1')).interview :
        JSON.parse(localStorage.getItem(`kcp-league-s7-v1:${L.room}:${L.team}`));
    }""")


def snapshot_contract(checks, page, label):
    state = page.evaluate(STATE)
    month = state["round"]
    snapshots = device_s7_data(page).get("outageSnapshots", {})
    required(checks, sorted(map(int, snapshots)) == ([1] if month == 1 else [month-1, month]),
             f"{label} {month}월 기기 사본 최근 2달만(3월에 1월 삭제)")
    snap = snapshots[str(month)]
    checks.ok(all(k in snap for k in ("round", "plan", "seed", "days", "season", "mods",
                                      "unsPct", "isolatedUnsPct", "filledUnsPct", "gridMWh")), f"{label} 운영 사본 필수 입력")  # D-80: C-1·2·4·5 대상별 검사.
    result = state['results'][-1]
    checks.ok(all(snap[k] == result[k] for k in ('seed', 'days', 'season')),
              f"{label} 사본 재사용 조건 = 실제 seed·days·season")
    checks.ok(snap["unsPct"] == result["team"]["pyeongtaek"]["unsPct"],
              f"{label} 사본 실제 = 운영 결과")
    checks.ok(not private_fields(public_state(page)), f"{label} D-65 공개 상태에 사본 없음")
    size = len(json.dumps(snap, ensure_ascii=False, separators=(",", ":")).encode())
    print(json.dumps({"S7_snapshot": label, "month": month, "bytes": size}, ensure_ascii=False), flush=True)
    return snapshots


def monthly_no_answer_records(checks, page, label):
    """이미 연 지난달 기록을 보존하며 현재 닫힌 달의 모든 기록 표면을 검사."""
    note = current_note(page)
    checks.ok(not any(note.get(k) for k in ("outageOpened", "outageSingleShown", "outageLargest",
                                            "outageFrozen")), f"{label} 현재 닫힌 달 기기 답 기록 없음")
    result = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.snap || L.S, rd=KCP.leagueCore.roundsOf(V)[V.round-1];
      const month=`${rd.year}년 ${rd.month}월`;
      const html=KCP.league.uiMath.trendHTML(V,L.team,true);
      const doc=new DOMParser().parseFromString(html,'text/html');
      const current=[...doc.querySelectorAll('li,title')].filter(n=>n.textContent.startsWith(month+' '));
      return {month, current:current.map(n=>n.textContent),
        marks:current.filter(n=>n.closest('[data-change="outage"]')).length};
    }""")
    checks.ok(result["marks"] == 0 and not any("가장 큰 몫" in t for t in result["current"]),
              f"{label} 현재 닫힌 달 타임라인 DOM·title에 답 없음")
    open_panel(page, "journal")
    panel = page.locator("#lg-panel")
    # 이전 달 이어붙이기 한 줄은 이미 공개된 기록이다. 그 줄을 제외하고 검사.
    text = panel.evaluate("""el => {
      const copy=el.cloneNode(true); copy.querySelector('#lg-missed-carry')?.remove();
      return copy.textContent;
    }""")
    checks.ok("가장 큰 몫" not in text, f"{label} 현재 일지 DOM에 답 없음")
    worksheet = copy_worksheet(page)
    header = "■ " + result["month"]
    required(checks, header in worksheet, f"{label} 활동지 현재 달 블록 존재")
    block = worksheet.split(header, 1)[1].split("■ ", 1)[0]
    checks.ok("가장 큰 몫" not in block and not re.search(r"[0-9]\s*%p", block),
              f"{label} 현재 닫힌 달 활동지에 몫/최대 없음")
    open_panel(page, "result")


def monthly_scene(checks, page, requests, label, width, expected):  # D-80: 약속 기대값과 S7 분해 대상은 따로 검사한다.
    """C-lastmonth §2–5: 월간 분해·기준 일치·공개 전후·화면 검산."""
    open_panel(page, "result")
    promise_result(checks, page, expected, label)  # D-80: 계통 오예측도 독립 방향·차이·outcome과 대조한다.
    required(checks, "예상과 다름" in page.locator(f'[data-compare="{expected["topic"]}"]').inner_text(),  # D-80: 약속 당시 주제를 따른다.
             f"{label} 지난달 대비 {expected['topic']} 오예측")  # D-80: S7 열림 조건의 의도 유지.
    root = page.locator("#lg-missed")
    required(checks, root.get_attribute("data-single") in ("true", "false"),
             f"{label} 사본 있는 달 월간 분해")
    student_words(checks, page, label + " 월간 열기 전")
    required(checks, page.locator("#lg-outage-baseline").inner_text() ==
             "약속 판정과 같은 기준(지난달 실제 → 이번 달 실제)을 나눠요.", f"{label} 같은 비교 기준 안내")
    checks.ok("시험 1주 대비" not in root.text_content(), f"{label} 시험 대비 분해 안내 폐기")
    page.evaluate("() => { const d = document.getElementById('lg-month-details'); if (d) d.open = true; }")  # D-80 UX 접힘(cc4b9d6): 펼친 뒤 읽는다.
    comparison = page.locator('#lg-trial-compare').inner_text()
    # spec-C §M5c·impl-C 확정 문구: 약속 주제가 계통이면 계통 전기 변화로 설명한다.
    subject = '바깥 계통에 기댄 전기' if expected['topic'] == 'grid' else '정전'
    checks.ok(f'원인 카드는 지난달 실제 → 이번 달 실제의 {subject} 변화를 나눠요.' in comparison and
              '위 시험 / 실제 차이와는 기준이 달라요.' in comparison,
              f"{label} 시험 비교 절도 월간 원인 카드와 기준 차이를 설명")
    cards = page.locator('#lg-outage-cards [data-missed]')
    keys = [c.get_attribute('data-missed') for c in cards.all()]
    multi = root.get_attribute("data-single") == "false"
    closed_box = bottleneck(checks, page, current_attribution(page), label + " 월간 열기 전")
    before_requests = len(requests)
    if multi:
        clue_and_evidence(checks, page, current_attribution(page), label + " 월간 닫힘")
        required(checks, 2 <= cards.count() <= 3, f"{label} 월간 유의미한 원인 카드 2~3장")
        for card in cards.all():
            checks.ok(card.locator("strong").inner_text() == MONTHLY_NAMES[card.get_attribute("data-missed")],
                      f"{label} 월간 카드 이름 = 순서·폭포 이름")
        checks.ok(keys == [k for k in MONTHLY_NAMES if k in keys], f"{label} 닫힌 카드 분해 순서 부분열")
        checks.ok(not shown(page, '#lg-outage-waterfall') and not shown(page, '#lg-outage-verdict'),
                  f"{label} 열기 전 폭포/판정 비노출")
        for c in cards.all():
            hidden_answer(checks, c, label + ' 월간 닫힌 카드', card=True)
        hidden_answer(checks, page.locator('#lg-outage-others'), label + ' 월간 나머지 후보')
        hidden_answer(checks, page.locator('#lg-outage-more'), label + ' 월간 상세 단서')
        # 루트는 공개된 총 차이·성능만 갖는다. 원인 크기/최대 속성은 전체 자손 검사.
        attrs = root.evaluate(SURFACE)['attrs']
        checks.ok(not any((k == 'data-out-value' and v.strip()) or
                          (k == 'data-out-tag' and v == 'largest') or
                          any(s in v for s in ('가장 큰 몫', '가장 큼', '가장 큰 것')) for k, v in attrs),
                  f"{label} 전체 DOM aria/data 원인 답 비노출")
        no_answer_records(checks, page, label)
        checks.ok(page.locator('#lg-outage-open').is_disabled(), f"{label} 고르기 전 열기 불가")
        selectable_cards(checks, page, label + " 월간")
        page.locator(f'[data-missed="{keys[0]}"]').click()
        checks.ok(current_note(page).get('missedBasis') == 'monthly',
                  f"{label} 열기 전 선택 저장도 월간 기준 보존")
        for c in cards.all():
            hidden_answer(checks, c, label + ' 월간 선택 뒤 닫힌 카드', card=True)
        capture(checks, page, label, 'monthly-closed')
        page.locator('#lg-outage-open').click()
        checks.ok(page.evaluate('document.activeElement?.id') == 'lg-outage-verdict', f"{label} 판정 초점")
    a = current_attribution(page)
    required(checks, a and a.get('basis') == 'monthly', f"{label} 월간 계산 API")
    baseline, actual = attribution_endpoints(page, a)  # D-80: C-1, S7 출발/도착 독립값.
    student_words(checks, page, label + " 월간 열기 후")
    if all(abs(p['value']) < part_min(a) for p in a['parts']):  # D-80: C-1·2·4·5 대상별 검사.
        no_cause_summary(checks, page, label, baseline, actual, monthly=True)
    clue_and_evidence(checks, page, a, label + " 월간 열림")
    checks.ok(bottleneck(checks, page, a, label + " 월간 열기 뒤") == closed_box,
              f"{label} 월간 병목은 열기 전후 동일·합계 밖")
    checks.ok([p['key'] for p in a['parts']] == list(MONTHLY_NAMES), f"{label} ①~⑥ 순서·보정은 후보 밖")  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(abs(a['trial'] - baseline) <= 1e-9 and abs(a['actual'] - actual) <= 1e-9,
              f"{label} 분해 출발/도착 = 지난달/이번 실제")
    # D-80: S6 주제·방향·표시 차이는 위 promise_result에서 검증한다. 실제 정전 시 S7 대상은 달라질 수 있다.
    delta = actual - baseline  # D-80: C-2, S7 대상의 월간 합계.
    snapshots = device_s7_data(page)['outageSnapshots']
    old_snap = snapshots[str(a['round'] - 1)]
    current_snap = snapshots[str(a['round'])]
    state = page.evaluate(STATE)  # D-80: C-2, 계통 포함 사본으로 월간 거래 잔차 검산.
    previous_result, current_result = state['results'][-2:]  # D-80: C-1·2·4·5 대상별 검사.
    grid_target = a.get('target') == 'grid'  # D-80: C-1·2·4·5 대상별 검사.
    def snapshot_value(snap, result):  # D-80: C-1·2·4·5 대상별 검사.
        if not grid_target:  # D-80: C-1·2·4·5 대상별 검사.
            return snap['filledUnsPct']  # D-80: C-1·2·4·5 대상별 검사.
        return snap['gridMWh'] / result['days']  # D-82: 사본 대표기간 일평균, 정전 분기는 보존.
    old_recalculated = snapshot_value(old_snap, previous_result) + a['replay']  # D-80: C-1·2·4·5 대상별 검사.
    growth = snapshot_value(current_snap, current_result)  # D-80: C-1·2·4·5 대상별 검사.
    shares = {p['key']: p['value'] for p in a['parts']}
    wired_trade = (actual - growth) - (baseline - old_recalculated)  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(abs(shares['trade'] - wired_trade) <= 1e-9, f"{label} 거래 = 두 달 계통 포함 단계 잔차 변화")  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok('gridImport' not in shares, f"{label} 새 계산에 별도 계통 수입 몫 없음")  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(a.get('replayOutsideSum') is True and
              abs(sum(p['value'] for p in a['parts']) - delta) <= 1e-9,
              f"{label} 배선 일치: 재현은 합계 밖·여섯 몫만의 합계 1e-9")  # D-80: C-1·2·4·5 대상별 검사.
    rows = page.locator('#lg-outage-waterfall [data-out-step]')
    expected = ['previous'] + list(MONTHLY_NAMES) + ['actual']
    required(checks, [r.get_attribute('data-out-step') for r in rows.all()] == expected, f"{label} 폭포 전체 순서")
    raw, visible = {}, {}
    parts = {p['key']: p['value'] for p in a['parts']}
    expected_values = {'previous': baseline, **parts, 'actual': actual}
    for row in rows.all():
        k = row.get_attribute('data-out-step')
        raw[k] = float(row.get_attribute('data-out-value'))
        matches = VALUE.findall(row.inner_text())
        required(checks, len(matches) == 1, f"{label} {k} 표시 숫자 1개")
        visible[k] = float(matches[0].replace('−', '-').replace(',', ''))
        checks.ok(abs(raw[k] - expected_values[k]) <= 1e-9 and share_matches(visible[k], raw[k], a, k),  # D-80: C-1·2·4·5 대상별 검사.
                  f"{label} {k} API/DOM 원시값·반올림")
        number_format(checks, row, k, label, page)  # D-80: C-1·2·4·5 대상별 검사.
        track_drawn(checks, page, k, f"{label} {width}px {k} 실제 막대 칸")
    checks.ok(abs(sum(v for k,v in raw.items() if k != 'actual') - actual) <= 1e-9,
              f"{label} 배선 일치: 재현 제외 DOM 원시 합계 1e-9")
    assert_allocation_dom(checks, page, a, visible, label)
    waterfall = page.locator('#lg-outage-waterfall')
    aria = waterfall.get_attribute('aria-label') or ''
    aria_values = [float(v.replace('−','-').replace(',','')) for v in VALUE.findall(aria)]
    checks.ok(waterfall.get_attribute('role') == 'img' and aria_values == list(visible.values()) and
              all(name in aria for name in ('지난달 실제', *MONTHLY_NAMES.values(), '이번 달 실제')),
              f"{label} aria 요약 수치·이름 일치")
    candidates = page.locator('#lg-missed [data-missed], #lg-missed [data-out-other]').evaluate_all(
        "nodes => nodes.map(n=>n.dataset.missed || n.dataset.outOther)")
    checks.ok(candidates and all(k in MONTHLY_NAMES for k in candidates), f"{label} 되돌림·재현은 후보 밖")
    top = sorted((k for k in MONTHLY_NAMES if abs(raw[k]) >= part_min(a)), key=lambda k: abs(raw[k]), reverse=True)[:3]  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(multi == (len(top) >= 2) and cards.count() == (len(top) if multi else 0),
              f"{label} 유의미한 원인 2개 미만이면 카드 없이 한 줄 요약")
    if multi:
        ranked = sorted(a['parts'], key=lambda p: abs(p['value']), reverse=True)
        checks.ok(keys == [k for k in MONTHLY_NAMES if k in top],
                  f"{label} |몫|≥0.05%p 상위 최대3 집합·분해순(DOM 검산; 독립 계산은 Node32)")
        for card in cards.all():
            checks.ok(share_pattern(a).fullmatch(card.locator('.lg-out-size').inner_text()) is not None,  # D-80: C-1·2·4·5 대상별 검사.
                      f"{label} 월간 카드 숫자 형식")
        checks.ok([c.get_attribute('data-missed') for c in cards.all()] == keys, f"{label} 연 전후 카드 순서 고정")
        checks.ok(page.locator(f'[data-missed="{ranked[0]["key"]}"] [data-out-tag="largest"]').count() == 1,
                  f"{label} 공개 최대는 여섯 후보 중 최대")  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok('priorTrade' not in a and page.locator('#lg-outage-prior-trade').count() == 0 and
              '지난달 거래 되돌림' not in root.text_content() and
              page.locator('#lg-outage-replay').count() == int(abs(a['replay']) >= .005),  # D-80: C-1·2·4·5 대상별 검사.
              f"{label} 되돌림 폐기·재현 설명 0.005%p 문턱")
    order = page.locator('#lg-outage-order').inner_text()
    checks.ok('이번 달 계산 순서: ' + ' → '.join(MONTHLY_NAMES.values()) in order and
              '순서를 바꾸면 몫이 달라질 수 있는 추정이에요. 게임에서 정한 순서예요.' in order, f"{label} 실제 순서·순서 의존 안내")
    if a['grid']['waitingMW'] == 0:
        checks.ok('접속 대기' not in root.text_content(), f"{label} 0 MW 접속 대기 문장 생략")
    simulations = int(root.get_attribute('data-simulations'))
    expected_calls = 6 if a['grid']['waitingMW'] > 0 else 5
    checks.ok(simulations == expected_calls, f"{label} 월간 사본 재사용·대기에 따라 {expected_calls}회")
    before_calls = page.evaluate('window.__s7SimCalls')
    close_drawer(page); open_panel(page, 'result')
    checks.ok(current_attribution(page) == a and page.evaluate('window.__s7SimCalls') == before_calls,
              f"{label} 재열기 캐시 추가 실행 0")
    page.locator('#lg-outage-carry').click()
    saved = current_note(page)
    checks.ok(saved.get('missedCarry', {}).get('basis') == 'monthly' and
              saved.get('outageFrozen', {}).get('basis') == 'monthly', f"{label} 다음 달·고정 분해의 기준 보존")
    if multi:
        timeline = page.evaluate("""() => {
          const L=KCP.league.state(), V=L.snap || L.S, C=KCP.leagueCore;
          const rd=C.roundsOf(V)[V.round-1], prefix=`${rd.year}년 ${rd.month}월 `;
          const doc=new DOMParser().parseFromString(KCP.league.uiMath.trendHTML(V,L.team,true),'text/html');
          return [...doc.querySelectorAll('li,title')].filter(n=>n.textContent.startsWith(prefix)).map(n=>n.textContent).join(' / ');
        }""")
        leaders = [p for p in ranked if abs(rounded_share(p['value'], a)) == abs(rounded_share(ranked[0]['value'], a))]
        unique_match = len(leaders) == 1 and saved['missed'] == ranked[0]['key']
        maximum_text = "실제 가장 큰 몫과 같음(" if unique_match else f"가장 큰 몫: {MONTHLY_NAMES[ranked[0]['key']]}"
        checks.ok(f"내가 고른 원인: {MONTHLY_NAMES[saved['missed']]}" in timeline and
                  maximum_text in timeline,
                  f"{label} 월간 타임라인 선택·최대 이름 일치")
    checks.ok(len(requests) == before_requests, f"{label} 선택/공개/이어붙이기 HTTP 요청 증가 0")
    capture(checks, page, label, 'monthly-opened')
    # 재시험/새로고침 뒤 고정 경로도 월간 기준으로 검사한다.
    frozen_after_retrial(checks, page, label)
    return a


def previous_carry_names(checks, page, label):
    state = page.evaluate(STATE)
    note = device_data(page).get('interview', {}).get('months', {}).get(str(state['round'] - 1), {})
    saved = note.get('missedCarry')
    if not saved:
        return
    basis = saved.get('basis') or note.get('outageFrozen', {}).get('basis')
    names = LEGACY_MONTHLY_NAMES if basis == 'monthly' else LEGACY_NAMES  # D-80: C-4, carry의 gridImport 이름 보존.
    open_panel(page, 'journal')
    text = page.locator('#lg-missed-carry').inner_text()
    selected = saved.get('missed')
    if selected in ("차이 원인 없음(정전 자체는 큼)", "뚜렷한 원인 없음"):
        checks.ok(text == f"지난달 원인 고르기: {selected}", f"{label} 다음 달 원인 없음 기록 문자열 보존")
        checks.ok(selected in copy_worksheet(page) and "가장 큰 몫" not in text,
                  f"{label} 다음 달 일지에도 같은 기록·최대 몫 없음")
    if selected in names and not note.get('outageSingleShown'):
        checks.ok(f"지난달 내가 고른 원인: {names[selected]}" in text, f"{label} 지난달 선택 이름은 기록 basis 기준")
    largest = saved.get('largest')
    if largest:
        frozen_parts = note.get('outageFrozen', {}).get('parts', [])
        leaders = [p for p in frozen_parts if abs(rounded_share(p['value'], note['outageFrozen'])) ==
                   abs(rounded_share(largest['value'], note['outageFrozen']))]
        matched = len(leaders) == 1 and selected == largest['key']
        maximum_text = "실제 가장 큰 몫과 같음(" if matched else f"가장 큰 몫 {names[largest['key']]}"
        checks.ok(maximum_text in text, f"{label} 지난달 최대 이름·적중 표기는 기록 basis 기준")
    if basis != 'monthly':
        checks.ok('날씨·계절·운전 기간' not in text, f"{label} 시험 기록에 월간 이름 섞이지 않음")
    close_drawer(page)


def later_outage(checks, page, requests, label, width, hit=False, host=None):
    """혼자 하기 2·3월 또는 멀티 2월을 실제 UI로 진행. 자동 현금 달은 실패."""
    previous_carry_names(checks, page, label)
    state = page.evaluate(STATE)
    player = 'pyeongtaek'
    required(checks, state['econ']['cities'][player]['cash'] >= 0, f"{label} 정전·계통 약속 경로 유지(생략 금지)")  # D-80: 자동 현금 달로 우회하지 않는다.
    trial = plan_and_trial(page, renewable=True, change_after=False)
    if host:
        host.wait_for_function("() => !KCP.league.state().S.teams.pyeongtaek.plan.policies.includes('save')")
    forecast = expected_operation(host or page, player)  # D-80: 멀티는 진행자의 입력으로 세 주제 기대값을 미리 얻는다.
    baseline = state['results'][-1]['team'][player]['unsPct']
    expected = promise(page, trial, forecast, baseline=baseline, hit=hit)  # D-80: 화면 주제와 독립 기대 방향 보존.
    if host:
        host.wait_for_function("() => KCP.league.state().S.teams.pyeongtaek.ready")
        host.locator('#lg-next').click()
    page.wait_for_function(SYNC, arg=[state['round'], 'review'])
    open_panel(page, 'result')
    snapshots = snapshot_contract(checks, page, label)
    required(checks, snapshots[str(state['round']-1)]['unsPct'] == baseline, f"{label} 사본 정전율 = 지난달 공개 실제")  # D-80: 계통 약속과 사본 정전율 구별.
    if hit:
        promise_result(checks, page, expected, label)  # D-80: 3월 grid/uns 적중을 같은 의도로 검사한다.
        checks.ok(page.locator('#lg-outage-cards, #lg-outage-single, #lg-outage-waterfall').count() == 0,
                  f"{label} 월간 적중 달 원인 답 비노출")
        no_answer_records(checks, page, label)
        capture(checks, page, label, 'monthly-hit')
    else:
        a = monthly_scene(checks, page, requests, label, width, expected)  # D-80: 주제별 판정과 월간 S7 열림 검증.
        checks.ok(abs(a['trial'] - attribution_endpoints(page, a)[0]) <= 1e-9,  # D-80: 대상별 지난달 공개값.

                  f"{label} 분해 출발 = 대상별 지난달 공개값")  # D-80: 실제 정전 시 S6·S7 대상 차이를 허용하되 수치는 엄격히 검사.


def missing_snapshot_after_reload(checks, page, base, label):
    page.goto(base + '#league'); select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text('날씨·사건 · 연습 방식', exact=True).click()
    page.locator('#lg-solo-seed').select_option('fixed'); start_solo(page, months=12)
    page.wait_for_function(SYNC, arg=[1, 'plan'])
    trial = plan_and_trial(page, renewable=True)
    expected = promise(page, trial, expected_operation(page, 'pyeongtaek'))  # D-80: 사본 누락 검사 전에도 정상 오예측을 검증한다.
    page.wait_for_function(SYNC, arg=[1, 'review']); open_panel(page, 'result')
    promise_result(checks, page, expected, label + '-jan')  # D-80: grid도 의도한 오예측인지 확인.
    snapshot_contract(checks, page, label + '-jan')
    click_next(page, page.evaluate(STATE)); page.wait_for_function(SYNC, arg=[2, 'plan'])
    state = page.evaluate(STATE)
    trial = plan_and_trial(page, renewable=True, change_after=False)
    expected = promise(page, trial, expected_operation(page, 'pyeongtaek'), baseline=state['results'][-1]['team']['pyeongtaek']['unsPct'])  # D-80: grid는 독립 지난달 계통 기준 사용.
    page.wait_for_function(SYNC, arg=[2, 'review']); open_panel(page, 'result')
    promise_result(checks, page, expected, label + '-feb')  # D-80: 사본 삭제 전 월간 판정 의도 확인.
    required(checks, page.locator('#lg-missed').get_attribute('data-single') == 'false',
             f"{label} 사본 삭제 전 미공개 월간 복수 후보(고정 자료로 우회 금지)")
    page.reload(); page.wait_for_function(SYNC, arg=[2, 'review']); open_panel(page, 'result')
    before = public_state(page)
    # pagehide의 saveSolo가 메모리 사본을 다시 저장하므로 다음 문서에서 삭제한다.
    page.context.add_init_script("""(() => {
      const flag='s7-delete-outage-snapshot', previous=sessionStorage.getItem(flag);
      if (previous === null) return;
      const key='kcp-league-solo-v1', save=JSON.parse(localStorage.getItem(key));
      delete save.interview.outageSnapshots[previous];
      localStorage.setItem(key,JSON.stringify(save));
      sessionStorage.removeItem(flag);
    })();""")
    page.evaluate("previous => sessionStorage.setItem('s7-delete-outage-snapshot', String(previous))",
                  state['round'] - 1)
    page.reload(); page.wait_for_function(SYNC, arg=[2, 'review']); open_panel(page, 'result')
    required(checks, '지난달 운영 조건이 이 기기에 없어 나누지 못해요.' in page.locator('#lg-missed').text_content(),
             f"{label} 재로딩 후 localStorage 사본 삭제 지정 안내")
    checks.ok(page.locator('#lg-missed [data-missed], #lg-missed [data-out-other], #lg-outage-waterfall, #lg-outage-single, #lg-outage-open').count() == 0,
              f"{label} 사본 없으면 시험 대체·카드·폭포 없음")
    checks.ok('시험' not in page.locator('#lg-missed').text_content(), f"{label} 시험 대비 경로 없음")
    checks.ok(public_state(page) == before, f"{label} 사본 삭제가 공개 상태 변경하지 않음")
    no_answer_records(checks, page, label)
    capture(checks, page, label, 'missing-snapshot')


def isolated_branch(checks, page, base, label, correct):
    """독립 판: 적중 달 유출 금지 / 빈 배치의 고르기 생략과 다음 달 연결."""
    page.goto(base + "#league")
    select_mode(page, "solo")
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text("날씨·사건 · 연습 방식", exact=True).click()
    page.locator("#lg-solo-seed").select_option("fixed")
    start_solo(page, months=12)
    page.wait_for_function(SYNC, arg=[1, "plan"])
    trial = plan_and_trial(page, empty=not correct, change_after=False)
    player = read(page)["player"]
    forecast = expected_operation(page, player)  # D-80: 정전·계통 기대값을 모두 준비한다.
    actual = forecast["uns"]  # D-80: 정전 전용 요약 검사용 공개 정전율.
    if not correct:  # D-80: 기존 빈 배치를 재사용해 정전 전용 단언을 유지한다.
        required(checks, trial["unsPct"] >= .005, f"{label} 빈 배치 시험에 실제 정전 존재(uns 경로 유지)")  # D-80: 정전 fixture를 생략하지 않는다.
    expected = promise(page, trial, forecast, hit=correct)  # D-80: 정상 계획 적중은 grid, 빈 계획 오예측은 uns.
    page.wait_for_function(SYNC, arg=[1, "review"])
    open_panel(page, "result")
    promise_result(checks, page, expected, label)  # D-80: 두 분기의 저장·화면 판정과 공개 실제값 확인.
    if not correct:  # D-80: 정전 카드·높은 정전 요약의 전제 유지.
        required(checks, expected["topic"] == "uns" and actual >= .005, f"{label} 빈 배치 약속·실제 모두 정전 경로")  # D-80: grid 전환으로 정전 단언 우회 금지.
    attribution = current_attribution(page)
    required(checks, bool(attribution), f"{label} 같은 계획의 실제 시험 경로 분해 가능")
    checks.ok(math.isfinite(attribution["replay"]) and abs(attribution["replay"]) < .01,
              f"{label} 시험 뒤 계획 불변: 실제 UI 시험과 재현 차이 < 0.01%p")
    if correct:
        checks.ok("예상과 같음" in page.locator(f'[data-compare="{expected["topic"]}"]').inner_text(), f"{label} {expected['topic']} 예측 적중")  # D-80: 적중 달 S7 비노출 유지.
        checks.ok(page.locator("#lg-outage-cards, #lg-outage-single, #lg-outage-waterfall").count() == 0,
                  f"{label} 적중 달 원인 카드·요약 없음")
        no_answer_records(checks, page, label)
        for _ in range(25):
            state = read(page)["S"]
            if state["phase"] == "end":
                break
            click_next(page, state)
        page.wait_for_function(SYNC, arg=[12, "end"])
        open_panel(page, "result")
        checks.ok("가장 큰 몫" not in page.locator("#lg-timeline").text_content() and
                  page.locator('#lg-timeline [data-change="outage"]').count() == 0,
                  f"{label} 적중·건너뛴 달만 있는 끝 타임라인 유출 없음")
        checks.ok("가장 큰 몫" not in copy_worksheet(page), f"{label} 끝 활동지 유출 없음")
        capture(checks, page, label, "correct-end")
        return
    required(checks, "예상과 다름" in page.locator('[data-compare="uns"]').inner_text() and
             page.locator("#lg-missed").get_attribute("data-single") == "true" and
             shown(page, "#lg-outage-single"), f"{label} 빈 배치 오예측의 한 줄 요약 실제 표시")
    student_words(checks, page, label + " 첫 달 한 줄 요약")
    checks.ok(page.locator('#lg-outage-cards [data-missed], #lg-outage-open').count() == 0,
              f"{label} 요약 달 카드 고르기 생략")
    note = current_note(page)
    no_cause = all(abs(p["value"]) < part_min(attribution) for p in attribution["parts"])  # D-80: C-1·2·4·5 대상별 검사.
    checks.ok(note.get("outageSingleShown") is True and not note.get("outageOpened") and
              (not note.get("outageLargest") if no_cause else
               note.get("outageLargest", {}).get("key") in NAMES),
              f"{label} 표시 뒤 요약 기록·0.05%p 미만이면 최대 몫 저장 없음")
    if no_cause:
        expected_label = no_cause_summary(checks, page, label, trial['unsPct'], actual)
        text = page.locator("#lg-missed").inner_text()
        checks.ok(expected_label in text and "가장 큰 것:" not in text and
                  "가장 큰 몫" not in text and page.locator('[data-out-tag="largest"]').count() == 0,
                  f"{label} 모든 몫 < 0.05%p: 최대 몫 표시 없음")
    page.locator("#lg-outage-carry").click()
    carry_choice = current_note(page).get("missedCarry", {}).get("missed")
    checks.ok(carry_choice == (expected_label if no_cause else "고르기 생략"),
              f"{label} 요약 달 다음 달 기록을 학생의 선택으로 꾸미지 않음")
    if no_cause:
        checks.ok(not current_note(page).get("missedCarry", {}).get("largest"),
                  f"{label} 차이 원인 없는 달은 다음 달 최대 몫 저장 없음")
        html = page.evaluate("""() => {
          const L=KCP.league.state(); return KCP.league.uiMath.trendHTML(L.snap || L.S,L.team,true);
        }""")
        checks.ok(expected_label in html and "가장 큰 몫" not in html,
                  f"{label} 타임라인: 정전 크기를 구분한 차이 원인 없음")
        open_panel(page, "journal")
        worksheet = copy_worksheet(page)
        checks.ok(expected_label in worksheet and "가장 큰 몫" not in worksheet,
                  f"{label} 일지: 정전 크기를 구분한 차이 원인 없음")
        open_panel(page, "result")
    if label == "1280x900-light-solo-single":
        frozen_after_retrial(checks, page, label)
    click_next(page, read(page)["S"])
    page.wait_for_function(SYNC, arg=[2, "plan"])
    for suffix in ("", "-reload"):
        if suffix:
            page.reload()
            page.wait_for_function(SYNC, arg=[2, "plan"])
        open_panel(page, "journal")
        checks.ok((expected_label if no_cause else "지난달 원인 고르기: 건너뜀") in
                  page.locator("#lg-missed-carry").inner_text(),
                  f"{label}{suffix} 다음 달 학생이 고른 것처럼 표시하지 않음")
        if no_cause:
            text = page.locator("#lg-missed-carry").inner_text()
            checks.ok(text == f"지난달 원인 고르기: {expected_label}" and "가장 큰 몫" not in text,
                      f"{label}{suffix} 다음 달 줄: 정전 크기를 구분한 차이 원인 없음")
            checks.ok(expected_label in copy_worksheet(page), f"{label}{suffix} 다음 달 일지 같은 기록")
        capture(checks, page, label + suffix, "single-carry")


def solo(checks, page, requests, base, label, width):
    page.goto(base + "#league")
    select_mode(page, "solo")
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text("날씨·사건 · 연습 방식", exact=True).click()
    page.locator("#lg-solo-seed").select_option("fixed")
    start_solo(page, months=12)
    required(checks, page.evaluate(SYNC, [1, "plan"]), f"{label} 혼자 하기 1월 계획")
    # 1월에 접속 신청한 태양광이 2월에 연결돼 무사건 날씨 몫도 생긴다.
    trial = plan_and_trial(page, renewable=True)
    player = read(page)["player"]
    forecast = expected_operation(page, player)  # D-80: 같은 복제 운영에서 정전·계통 기대값을 얻는다.
    expected = promise(page, trial, forecast)  # D-80: 화면 주제에 맞는 오예측 선택.
    page.wait_for_function(SYNC, arg=[1, "review"])
    actual = read(page)["S"]["results"][-1]["team"][player]["unsPct"]
    checks.ok(actual == forecast["uns"], f"{label} 복제 운영 정전율과 실제 운영 일치")  # D-80: 기존 정전율 검사를 보존한다.
    open_panel(page, "result")  # D-80: S6 DOM과 저장 outcome이 렌더링된 뒤 검사한다.
    promise_result(checks, page, expected, label + "-jan")  # D-80: 계통 방향·수치·오예측도 독립 검증.
    snapshot_contract(checks, page, label + "-jan")
    picked = scene(checks, page, requests, label, width, trial, actual)
    # 실제 새 탭 이동도 확인하고 원래 판의 달·단계를 보존한다(I40).
    popup_events = {"error": [], "warning": [], "pageerror": []}

    def watch_popup(tab):
        tab.on("console", lambda m: popup_events[m.type].append(m.text)
               if m.type in ("error", "warning") else None)
        tab.on("pageerror", lambda error: popup_events["pageerror"].append(str(error)))

    page.context.once("page", watch_popup)
    with page.expect_popup() as popup:
        page.locator("#lg-y2022-result").click()
    popup.value.wait_for_url("**#y2022")
    checks.ok(popup.value.evaluate("window.opener === null"), f"{label} 새 탭 opener 없음")
    diagnostics(checks, popup_events, label + " 2022 새 탭")
    popup.value.close()
    checks.ok(page.evaluate(SYNC, [1, "review"]), f"{label} 2022 새 탭 뒤 진행 보존")
    observation = click_next(page, read(page)["S"])
    required(checks, observation["S"]["round"] == 2 and observation["S"]["phase"] == "plan", f"{label} 2월 계획")
    before = carry(checks, page, picked, label)
    page.reload()
    page.wait_for_function(SYNC, arg=[2, "plan"])
    checks.ok(carry(checks, page, picked, label + "-reload") == before,
              f"{label} 새로고침 뒤 기기 저장 유지 [I26]")
    later_outage(checks, page, requests, label + '-feb', width)
    click_next(page, read(page)['S'])
    page.wait_for_function(SYNC, arg=[3, 'plan'])
    later_outage(checks, page, requests, label + '-mar', width, hit=True)
    cash_checked = False
    for _ in range(25):
        state = read(page)["S"]
        if state["phase"] == "end":
            break
        # 현재 UI에는 주제 선택기가 없다. 실제 운영으로 음수 현금이 된 달에
        # 자동 현금 주제의 반대 예측을 고른다. 상태·현금·주제는 주입하지 않는다.
        if state["phase"] == "plan" and state["round"] < 12 and not cash_checked and state["econ"]["cities"][player]["cash"] < 0:
            trial = plan_and_trial(page)
            forecast = expected_operation(page, player)  # D-80: 운영 전 현금 대비 기대값도 같은 복제 운영에서 얻는다.
            expected = promise(page, trial, forecast, topic="cash")  # D-80: 화면이 cash가 아니면 실패한다.
            page.wait_for_function(SYNC, arg=[state["round"], "review"])
            open_panel(page, "result")
            promise_result(checks, page, expected, label + "-cash")  # D-80: 현금 판정·차이·저장 outcome 검증.
            checks.ok("예상과 다름" in page.locator('[data-compare="cash"]').inner_text(),
                      f"{label} 현금 주제 오예측 실제 진행")
            checks.ok(page.locator('#lg-outage-cards, #lg-outage-single, #lg-outage-waterfall, #lg-missed.lg-outage').count() == 0,
                      f"{label} 현금 오예측에 정전 원인 카드 없음")
            note = current_note(page)
            checks.ok(not any(note.get(k) for k in ("outageLargest", "outageOpened", "outageSingleShown")),
                      f"{label} 현금 달 최대 몫 저장 없음")
            capture(checks, page, label, "cash-miss")
            cash_checked = True
            continue
        click_next(page, state)
    if not cash_checked:
        print(f"미실행: {label} 음수 현금 달이 없어 현금 주제 UI 분기 미검증", flush=True)
    state = read(page)["S"]
    required(checks, state["phase"] == "end" and state["round"] == 12 and len(state["results"]) == 12,
             f"{label} 12달 실제 운영 완주")
    end_record(checks, page, picked, label)
    page.reload()
    page.wait_for_function(SYNC, arg=[12, "end"])
    end_record(checks, page, picked, label + "-reload")


def public_state(page):
    return page.evaluate("""() => {
      const L=KCP.league.state();
      const V=structuredClone(L.snap || KCP.leagueCore.publicView(L.S,0));
      delete V.now; return V;
    }""")


def private_fields(value):
    if isinstance(value, str):
        try:
            return private_fields(json.loads(value)) if value.lstrip().startswith(('{', '[')) else []
        except (ValueError, TypeError):
            return []
    if isinstance(value, dict):
        snapshot_shape = {"round", "plan", "seed", "days", "season", "mods", "unsPct", "isolatedUnsPct"}
        return (["운영 사본 객체"] if snapshot_shape <= value.keys() else []) + [
            k for k in value if re.search(r"missed|outageOpened|outageSingleShown|outageLargest|outageFrozen|outageNoCause|outCache|outageSnapshots|outageOperatingIntl|s1EvidenceValues|s1EvidenceNeighborId|nowValue", k, re.I)] + [
            k for v in value.values() for k in private_fields(v)]
    if isinstance(value, list):
        return [k for v in value for k in private_fields(v)]
    return []


def multiplayer(checks, context, base, label, width, pages, requests):
    host, he = monitored_page(context)
    pages.append((host, he, "host"))
    host.goto(base + "#league")
    select_mode(host, "host")
    host.locator('[data-preset="3"]').click()
    host.locator('[data-turns="12"]').click()
    host.locator("#lg-host-seed").select_option("fixed")
    host.locator("#lg-host").click()
    host.wait_for_selector("#lg-roomcode")
    room = host.locator("#lg-roomcode").inner_text()
    team, te = monitored_page(context)
    pages.append((team, te, "team"))
    team.goto(base + "#league")
    select_mode(team, "join")
    team.locator("#lg-code").fill(room)
    team.locator("#lg-join").click()
    confirm_seat(team, "pyeongtaek")
    host.locator("#lg-next").click()
    team.wait_for_function(SYNC, arg=[1, "plan"])
    trial = plan_and_trial(team)
    # 진행자가 실제로 받은 계획을 기다려 복제 운영의 입력을 확정한다.
    host.wait_for_function("() => KCP.league.state().S.teams.pyeongtaek.plan.policies.includes('save')")
    forecast = expected_operation(host, "pyeongtaek")  # D-80: 팀에는 비공개 운영 상태가 없어 진행자 복제 결과를 사용한다.
    expected = promise(team, trial, forecast)  # D-80: 실제 팀 화면의 grid/uns 주제로 오예측한다.
    host.wait_for_function("() => KCP.league.state().S.teams.pyeongtaek.ready")
    host.locator("#lg-next").click()
    team.wait_for_function(SYNC, arg=[1, "review"])
    host.wait_for_function(SYNC, arg=[1, "review"])
    actual = team.evaluate(STATE)["results"][-1]["team"]["pyeongtaek"]["unsPct"]
    open_panel(team, "result")  # D-80: 실제 진행자 운영을 받은 팀 화면에서 판정한다.
    promise_result(checks, team, expected, label + "-team-jan")  # D-80: 멀티 grid 오예측과 실제 공개값 대조.
    # 정기 공개 갱신 한 주기(4초)도 지나서 읽는다. now만 제외, 새 필드는 모두 비교.
    # '전' 값은 팀이 진행자의 최신 공개 상태를 받은 뒤에 찍는다. 운영 직후 진행자가 상태를 한 번 더 바꾸면
    # (S.rev 증가) 그 전송은 150ms 지연·서명 뒤에 도착하므로, 단계(review)만 맞춰 찍으면 팀 쪽 rev만 '후'에
    # 오른 것처럼 보인다(2026-10-20 재현: 진행자 diff 0, 팀 diff rev 7→8, 팀 요청 증가 0). 비교 대상은 그대로다.
    host_rev = host.evaluate("() => KCP.league.state().S.rev")
    team.wait_for_function("rev => KCP.league.state().snap?.rev === rev", arg=host_rev, timeout=12000)
    before_h, before_t = public_state(host), public_state(team)
    before_dom = json.dumps(host.locator("body").evaluate(SURFACE), ensure_ascii=False)
    snapshot_contract(checks, team, label + "-team-jan")
    chosen = scene(checks, team, requests, label + "-team", width, trial, actual)
    team.wait_for_timeout(4500)
    after_h, after_t = public_state(host), public_state(team)
    checks.ok(before_h == after_h and before_t == after_t,
              f"{label} 고르기·붙이기 뒤 진행자/팀 공개 스냅숏 불변 [I3/D-65]")
    checks.ok(not private_fields(after_h) and not private_fields(after_t), f"{label} 공개 상태에 사적 원인 필드 0")
    checks.ok(host.evaluate("location.hash") == "#league/host", f"{label} 진행자 경로 확인")
    surface = host.locator("body").evaluate(SURFACE)
    serialized = json.dumps(surface, ensure_ascii=False)
    checks.ok(not any(s in serialized for s in ("내가 고름", "지난달 내가 고른 원인", "지난달 원인 고르기", "nowValue", "missedCarry", "data-missed")),
              f"{label} 진행자 DOM·aria·data에 고른 원인 없음 [I3/D-65]")
    checks.ok(serialized.count(NAMES[chosen["picked"]]) <= before_dom.count(NAMES[chosen["picked"]]),
              f"{label} 진행자 DOM에 고른 범주 문구도 새로 나타나지 않음")
    capture(checks, host, label + "-host", "private")
    # 같은 팀 기기의 2월 월간 경로도 진행자 버튼으로 운영한다.
    host.locator('#lg-next').click()
    team.wait_for_function(SYNC, arg=[2, 'plan'])
    host.wait_for_function(SYNC, arg=[2, 'plan'])
    later_outage(checks, team, requests, label + '-team-feb', width, host=host)
    for p in (host, team):
        checks.ok(not private_fields(public_state(p)), f"{label} 월간 공개 상태에 사본/답 없음")
    # 진행자 버튼으로 마지막 달까지 운영. 팀 끝 연결도 확인한다.
    for _ in range(25):
        state = host.evaluate(STATE)
        if state["phase"] == "end":
            break
        host.locator("#lg-next").click()
        host.wait_for_function("([r,p]) => {const s=KCP.league.state().S;return s.round!==r||s.phase!==p;}",
                               arg=[state["round"], state["phase"]])
    host.wait_for_function(SYNC, arg=[12, "end"])
    team.wait_for_function(SYNC, arg=[12, "end"])
    link(checks, host, "#lg-y2022-host", False, label + " 진행자 끝")
    capture(checks, host, label + "-host", "end")
    end_record(checks, team, chosen, label + "-team")


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height, scheme in ((1280, 900, "light"), (1180, 820, "light"), (390, 844, "dark")):
                label = f"{width}x{height}-{scheme}"
                modes = ("solo", "solo-correct", "solo-single", "solo-missing")
                if width == 1280:
                    modes += ("multi",)
                for mode in modes:
                    context, external = context_for(browser, base, width, height, scheme)
                    requests, pages, wire = [], [], []
                    context.expose_binding("__s7ObserveWire", lambda source, message, sink=wire: sink.append(message))
                    context.add_init_script("""(() => {
                      const post=BroadcastChannel.prototype.postMessage;
                      BroadcastChannel.prototype.postMessage=function(message) {
                        window.__s7ObserveWire(structuredClone(message));
                        return post.call(this,message);
                      };
                    })();""")
                    context.on("request", lambda request, sink=requests: sink.append(
                        {"url": request.url, "body": request.post_data}))
                    try:
                        if mode.startswith("solo"):
                            page, events = monitored_page(context)
                            pages.append((page, events, "solo"))
                            if mode == "solo":
                                solo(checks, page, requests, base, label + "-solo", width)
                            elif mode == "solo-missing":
                                missing_snapshot_after_reload(checks, page, base, label + "-missing")
                            else:
                                isolated_branch(checks, page, base, label + "-" + mode,
                                                correct=mode == "solo-correct")
                        else:
                            multiplayer(checks, context, base, label, width, pages, requests)
                    except Exception as exc:
                        checks.ok(False, f"{label} {mode} {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
                        for page, _, role in pages:
                            screenshot(checks, page, f"s7-{label}-{role}-failure.png")
                    finally:
                        for page, events, role in pages:
                            diagnostics(checks, events, f"{label} {role}")
                            overflow(checks, page, f"{label} {mode} {role} final")
                        checks.ok(not private_fields(wire), f"{label} 모든 새로고침 전후 BroadcastChannel 요청/공개 메시지에 사본·사적 답 없음 [D-65]")
                        checks.ok(not private_fields(requests), f"{label} HTTP 요청 본문에 사본·사적 답 없음 [D-65]")
                        checks.ok(not external, f"{label} {mode} 외부 연결 시도 0: {external}")
                        context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:250]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
