"""시멘트 공장의 탄소 장부: 구현 명세 v2(2026-10-02)의 브라우저 계약.

실행 주소·4환경·콘솔/페이지 오류는 harness가 관리한다. 이 작성 작업에서는
브라우저를 실행하지 않는다. 개별 ID가 없는 명세의 항목에 12.x-이름을 부여했다.
스크린샷은 파일을 쓰지 않고 rec['visual_review']에 담는다(KCP_RESULT로 보존 가능).
라벨 겹침과 시각적 비중의 최종 판독은 이 이미지의 사람 검토가 필요하다.
"""
import base64
import copy
import math
import re
import subprocess
from pathlib import Path

from accept_originals import assert_single_request
from harness import Ctx, main


ID = "s-cement-carbon"
KEY = "kcp:v1:" + ID
DEFAULT = dict(d=0, c=80, bio=0, elec=0, capture=0, mineral=0, syn=0,
               acct=0, support=False)
PLANS = {
    "A": dict(DEFAULT),
    "B": dict(DEFAULT, d=30, c=50, bio=40, elec=30, capture=90, mineral=100),
    "C": dict(DEFAULT, c=75, bio=20, capture=90, mineral=10, support=True),
    "D": dict(DEFAULT, d=30, c=50, bio=40, elec=30, support=True),
    "E": dict(DEFAULT, d=10, c=65, bio=30, elec=10, capture=60, mineral=20, support=True),
    "F": dict(DEFAULT, d=25, c=65, bio=30, elec=10, capture=60, mineral=20, support=True),
    "G0": dict(DEFAULT, c=75, capture=60, syn=80),
    "G1": dict(DEFAULT, c=75, capture=60, syn=80, acct=100),
    "C10": dict(DEFAULT, d=10, c=75, bio=20, capture=90, mineral=10, support=True),
    "D30": dict(DEFAULT, d=30, c=50, bio=40, elec=30, capture=30, support=True),
    "H": dict(DEFAULT, d=5, c=75, bio=20, elec=10, capture=90),
    "I": dict(DEFAULT, capture=60, syn=90),
}
FUT = {"smooth": (.45, .9, .15, .3, .00001),
       "scarce": (.15, .9, .25, .3, .00005),
       "delay": (.35, .6, .35, .1, .0005)}
BASE = 2 * .8 * .65 * 44 / 56 + 2 * .8 * 3.4 * .095
LINE = "확실한 감축을 먼저 보아 포집 의존을 줄이지만 생산 감소와 원료 부족의 비용을 함께 부담한다."


def _reference(p, future):
    """명세 5.3을 독립적으로 옮긴 수치/도형 기대값. 구현 함수는 호출하지 않는다."""
    supply, uptime, grid, emax, leakrate = FUT[future]
    P = 2 * (1 - p["d"] / 100)
    need = P * (1 - p["c"] / 100)
    scm = min(need, supply)
    clay = min(max(0, need - scm), .35)
    K = P - scm - clay
    e = min(p["elec"] / 100, emax)
    coalShare = 1 - p["bio"] / 100 - e
    H = K * 3.4
    process = K * .65 * 44 / 56
    coal = (H * coalShare + clay * 2) * .095
    bio = H * p["bio"] / 100 * .085
    G0, Hw, r = process + coal + bio, K * .8, p["capture"] / 100 * uptime
    X = max(0, .056 * (3 * r * G0 - Hw) / (1 - r * 3 * .056))
    G = G0 + X
    C = r * G
    stack = G - C
    mineral = min(C * p["mineral"] / 100, .1)
    overflow = max(0, C * p["mineral"] / 100 - .1)
    syn = C * p["syn"] / 100
    store = C * (100 - p["mineral"] - p["syn"]) / 100 + overflow
    leak = store * leakrate
    retained = store - leak
    h2 = syn * 6 / 44
    heatPower, compressPower, h2Power, basePower = H * e / 3.6, C * .1, h2 * 55, P * .1
    power = heatPower + compressPower + h2Power + basePower
    extra, indirect = power - .2, power * grid
    bioCredit = bio * .5 * (1 - r)
    ledger = stack - bioCredit + syn * (1 - p["acct"] / 100)
    reduction = 100 * (1 - ledger / BASE)
    gap, physical = reduction - 60, stack + syn + leak
    supportCost = 4 * P if p["support"] else 0
    price = (30 * C + 8 * store + 10 * mineral + 40 * syn + 10 * clay - 3 * scm
             + .3 * H * p["bio"] / 100 + 12 * heatPower + supportCost) / P + .6
    return locals()


def _fmt(x, digits):
    return f"{0 if abs(x) < .5 * 10 ** -digits else x:.{digits}f}"


def _signed(x, digits):
    # 학생 화면의 음수 기호는 −(U+2212)로 통일한다.
    return (("+" if x >= .5 * 10 ** -digits else "") + _fmt(x, digits)).replace("-", "−")


def _red(x):
    return (f"{math.floor(x * 100) / 100:.2f}" if 59.95 <= x < 60 - 1e-12 else _fmt(x, 1)).replace("-", "−")


def _physical_line(r):
    """명세 보완(물리 배출 기준선): 현재 대비 변화와 간접 배출 포함 합계를 독립적으로 만든다."""
    diff = r["physical"] - BASE
    rise = diff >= .0005
    note = " · 장부상 감축과 달리 실제 대기 배출은 늘어남" if rise and r["reduction"] > 0 else " · 현재보다 늘어남" if rise else ""
    return f"현재 {_fmt(BASE, 3)} 대비 {_signed(diff, 3)} Mt/년{note} · 전력 간접 배출을 더하면 {_fmt(r['physical'] + r['indirect'], 3)} Mt/년"


def _gap(x):
    return (f"{math.floor(x * 100) / 100:.2f}" if -.05 < x < -1e-12 else _signed(x, 1)).replace("-", "−")


def _text(c, selector):
    return c.page.locator(selector).inner_text().strip()


def _game(c):
    return c.page.evaluate("KCP.load('s-cement-carbon').game")


def _qs(c):
    return assert_single_request(c, c.page.evaluate("KCP.games['s-cement-carbon'].questions(KCP.load('s-cement-carbon'))"))


def _recap(c):
    return c.page.evaluate("KCP.games['s-cement-carbon'].recap(KCP.load('s-cement-carbon'))")


def _prep(c):
    c.goto("#ys-cement-carbon", wait="#phase")
    c.phase("prep")
    c.page.wait_for_selector("#cc-root")


def _snapshot(plan, predict="below", revisited=False, criteria=None):
    criteria = criteria or ["sure", "price"]
    prediction = dict(value=predict, plan=copy.deepcopy(plan))
    lock = dict(version=1, plan=copy.deepcopy(plan), criteria=criteria[:],
                prediction=prediction, oneLine=LINE, revisited=revisited)
    return dict(phase="prep", memo="가상 복구 메모", answers={"0": "가상 이전 답변"},
                answerQ={"0": "가상 이전 질문"},
                game=dict(version=1, plan=copy.deepcopy(plan), step=2, fut="smooth",
                          dataTab="baseline", criteria=criteria[:], predictDraft=predict,
                          prediction=copy.deepcopy(prediction), revisited=revisited,
                          oneLine=LINE, locked=lock))


def _inject(c, state):
    # 반드시 홈+flush 후 주입한다. 이전 화면의 debounce가 fixture를 덮지 않는다.
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush()")
    c.page.evaluate("([key,state])=>localStorage.setItem(key,JSON.stringify(state))", [KEY, state])
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    # 명세 7.4: 버전 불일치 안내는 손상 기록을 처음 복구해 여는 화면에서 확인한다.
    # 모든 fixture의 phase는 prep이다. _prep의 단계 재클릭은 이미 정규화된 상태를
    # 두 번째로 렌더링해 최초 복구 안내를 지우므로, 첫 렌더를 그대로 검사한다.
    c.goto("#ys-cement-carbon", wait="#cc-root")


def _key(c, field, key):
    loc = c.page.locator("#cc-" + field)
    loc.focus()
    c.page.keyboard.press(key)


def _range(c, field, value):
    # 실제 native 키보드 이벤트로만 범위를 바꾼다.
    minimum, step = {"d": (0, 5), "c": (50, 5), "bio": (0, 10), "elec": (0, 10),
                     "capture": (0, 30), "mineral": (0, 10), "syn": (0, 10), "acct": (0, 50)}[field]
    _key(c, field, "Home")
    for _ in range((value - minimum) // step):
        c.page.keyboard.press("ArrowRight")


def _ui_plan(c, name, predict="below", finish=True):
    _prep(c)
    p = PLANS[name]
    c.page.locator("#cc-crit1").select_option("sure")
    c.page.locator("#cc-crit2").select_option("price")
    for field in ("d", "c", "bio", "elec", "capture"):
        _range(c, field, p[field])
    c.page.locator("#cc-predict-" + predict).check()
    c.page.locator("#cc-stage1").click()
    _range(c, "mineral", p["mineral"])
    _range(c, "syn", p["syn"])
    _range(c, "acct", p["acct"])
    c.page.locator("#cc-support").set_checked(p["support"])
    if finish:
        c.page.locator("#cc-oneline").fill(LINE)
        c.page.locator("#cc-lock").click()
    c.wait_saved()


def _metrics(c, plan, future, aid):
    r = _reference(plan, future)
    expected = {"#cc-ledger-reduction": _red(r["reduction"]) + "%",
                "#cc-physical": _fmt(r["physical"], 3) + " Mt CO₂/년",
                "#cc-physical-delta": _physical_line(r),
                "#cc-gap": "목표 대비 차이 " + _gap(r["gap"]) + "%p",
                "#cc-power-total": _fmt(r["power"], 3) + " TWh/년",
                "#cc-power-extra": _signed(r["extra"], 3) + " TWh/년",
                "#cc-indirect": _fmt(r["indirect"], 3) + " Mt CO₂/년",
                "#cc-price": _signed(r["price"], 1) + "%"}
    for sel, value in expected.items():
        c.eq(_text(c, sel), value, f"{aid} {future}의 {sel} 표시값")


def _flows(c):
    return c.page.locator(".cc-flow[data-cc-flow]").evaluate_all("""els=>els.map(e=>({
      key:e.dataset.ccFlow,d:e.getAttribute('d'),width:e.getAttribute('stroke-width')}))""")


def _capture(c, aid, label):
    c.rec.setdefault("visual_review", []).append(dict(test=c.test, id=aid, label=label,
        png=base64.b64encode(c.page.screenshot(full_page=True)).decode("ascii")))


def t_12_1_registration(c: Ctx):
    aid = "12.1-메타"
    c.goto("#home", wait="#home-originals")
    c.eq(c.page.locator('#home-originals .opkg[href="#ys-cement-carbon"]').count(), 1,
         f"{aid} 홈에 이 게임 카드 하나가 있다")
    c.eq(c.page.locator(".pkg").count(), 5, f"{aid} 기출 카드는 다섯 개다")
    meta = c.page.evaluate("""() => {const id='s-cement-carbon',m=KCP.YEARS[id],g=KCP.games[id];
      return {methods:['brief','renderPrep','questions','recap','reflectExtra'].map(k=>typeof g[k]),
      original:m.original,prep:m.prep,answer:m.answer,rubric:Object.values(m.rubric).map(a=>a.length),
      intent:m.intent.length,order:KCP.ORDER,occurrences:KCP.ORIGINAL_ORDER.filter(x=>x===id).length,
      unique:new Set(KCP.ORIGINAL_ORDER).size===KCP.ORIGINAL_ORDER.length,after:'afterReflect' in g};} """)
    for k, value in dict(methods=["function"] * 5, original=True, prep=25, answer=15,
                         rubric=[3, 3, 3], intent=5, order=["2022", "2023", "2024", "2025", "2026"],
                         occurrences=1, unique=True, after=False).items():
        c.eq(meta[k], value, f"{aid} {k} 등록 계약")
    foreign = dict(phase="prep", memo="다른 게임 가상 기록", game={})
    c.page.evaluate("s=>localStorage.setItem('kcp:v1:2022',JSON.stringify(s))", foreign)
    _prep(c)
    c.expect("창작 게임 · 가상 자료" in _text(c, ".brief"), f"{aid} 상황에 창작·가상 표시가 있다")
    c.page.locator("#cc-memo").fill("가상 저장 확인")
    c.wait_saved(400)
    c.expect(c.ls(KEY) is not None, f"{aid} 400ms 뒤 전용 저장 키가 생성된다")
    c.eq(c.ls("kcp:v1:2022"), foreign, f"{aid} 다른 게임 저장 키를 보존한다")
    c.check(f"{aid} 준비실")


def t_12_1_initial_and_native(c: Ctx):
    aid = "12.1-초기·밸브"
    _prep(c)
    for field in ("next", "lock", "stage1", "future-scarce", "future-delay"):
        c.expect(c.page.locator("#cc-" + field).is_disabled(), f"{aid} 최초 {field} 비활성")
    for field in ("dest", "acct", "support"):
        c.expect(c.page.locator("#cc-valve-" + field).is_hidden(), f"{aid} 2단계 {field} 숨김")
    c.expect(c.page.locator("#cc-compare").is_hidden(), f"{aid} 숫자 비교표 숨김")
    c.eq(_qs(c), [], f"{aid} 확정 전 자동 질문 없음")
    c.page.locator("#cc-future-smooth").focus()
    for key in ("ArrowRight", "End", "ArrowLeft", "Home"):
        c.page.keyboard.press(key)
        c.eq(c.page.evaluate("document.activeElement.id"), "cc-future-smooth", f"{aid} 1단계 미래탭 {key}는 disabled 건너뜀")
    _metrics(c, DEFAULT, "smooth", aid)
    c.page.locator("#cc-crit1").select_option("local")
    c.expect(c.page.locator('#cc-crit2 option[value="local"]').is_disabled(), f"{aid} 같은 둘째 기준 금지")
    c.page.locator("#cc-crit2").evaluate("e=>{e.value='local';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    c.page.locator("#cc-predict-below").check()
    c.expect(c.page.locator("#cc-stage1").is_disabled(), f"{aid} 중복 기준으로 1단계 확정 불가")
    c.page.locator("#cc-crit1").select_option("sure")
    c.page.locator("#cc-crit2").select_option("price")
    _key(c, "capture", "Home")
    c.page.keyboard.press("ArrowRight")
    c.eq(c.page.locator("#cc-capture").input_value(), "1", f"{aid} 포집 range는 인덱스1")
    c.eq(_text(c, "#cc-capture-value"), "30%", f"{aid} 포집 output은 실제30%")
    c.expect("30%" in c.page.locator("#cc-capture").get_attribute("aria-valuetext"), f"{aid} 포집 퍼센트 낭독")
    _key(c, "bio", "End")
    _key(c, "elec", "End")
    c.eq(_text(c, "#cc-coal-value"), "30%", f"{aid} 연료 합100·석탄30%")
    for field, minimum, maximum, step in (("d", 0, 30, 5), ("c", 50, 80, 5),
                                        ("bio", 0, 40, 10), ("elec", 0, 30, 10), ("capture", 0, 3, 1)):
        _bounds(c, field, minimum, maximum, step, aid)
    c.page.locator("#cc-stage1").click()
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-mineral", f"{aid} 2단계 포커스 행선지")
    _key(c, "acct", "Home")
    c.page.keyboard.press("ArrowRight")
    c.eq(c.page.locator("#cc-acct").input_value(), "1", f"{aid} 장부 range 인덱스1")
    c.eq(_text(c, "#cc-acct-value"), "50%", f"{aid} 장부 output50%")
    c.expect("50%" in c.page.locator("#cc-acct").get_attribute("aria-valuetext"), f"{aid} 인정 퍼센트 낭독")
    _bounds(c, "acct", 0, 2, 1, aid)
    _bounds(c, "mineral", 0, 100, 10, aid)
    _key(c, "mineral", "Home")
    _bounds(c, "syn", 0, 100, 10, aid)
    old_live = _text(c, "#cc-live")
    c.page.locator("#cc-acct").focus()
    c.eq(_text(c, "#cc-live"), old_live, f"{aid} 포커스만으로 수치 낭독 없음")
    _key(c, "acct", "Home")
    c.page.keyboard.press("ArrowRight")
    live = _text(c, "#cc-live")
    c.expect("장부상 감축률" in live and "물리적 대기 배출" in live, f"{aid} change에 두 주요 지표 낭독")


def _bounds(c, field, minimum, maximum, step, aid):
    for key, target, button in (("Home", minimum, "minus"), ("End", maximum, "plus")):
        _key(c, field, key)
        c.eq(int(c.page.locator("#cc-" + field).input_value()), target, f"{aid} {field} {key} 경계")
        c.expect(c.page.locator(f"#cc-{field}-{button}").is_disabled(), f"{aid} {field} 경계 버튼 비활성")
        for _ in range(8):
            c.page.keyboard.press("ArrowLeft" if key == "Home" else "ArrowRight")
        c.eq(int(c.page.locator("#cc-" + field).input_value()), target, f"{aid} {field} 연타 경계 유지")
    _key(c, field, "Home")
    c.page.locator(f"#cc-{field}-plus").focus()
    c.page.keyboard.press("Enter")
    c.eq(int(c.page.locator("#cc-" + field).input_value()), minimum + step, f"{aid} {field} Enter 한 단계")
    c.page.locator(f"#cc-{field}-minus").focus()
    c.page.keyboard.press("Space")
    c.eq(int(c.page.locator("#cc-" + field).input_value()), minimum, f"{aid} {field} Space 한 단계")
    _key(c, field, "ArrowUp")
    c.eq(int(c.page.locator("#cc-" + field).input_value()), minimum + step, f"{aid} {field} 위쪽키도 한 단계")
    c.page.keyboard.press("ArrowDown")
    c.eq(int(c.page.locator("#cc-" + field).input_value()), minimum, f"{aid} {field} 아래쪽키도 한 단계")


def t_12_2_d_ui_and_shell(c: Ctx):
    aid = "12.2-D"
    _ui_plan(c, "D", finish=False)
    c.expect(c.page.locator("#cc-d").is_disabled(), f"{aid} 1단계 밸브 잠금")
    c.expect(c.page.locator("#cc-next").is_disabled(), f"{aid} 확정 전 이동 비활성")
    _metrics(c, PLANS["D"], "smooth", aid)
    c.expect("들어온 탄소 0.151 Mt C(= CO₂ 0.554 Mt × 12/44) = 대기로 간 탄소 0.151 + 저장 재고 증가 0.000 + 광물 0.000 Mt C"
             in _text(c, "#cc-balance"), f"{aid} 탄소 수지 세 항과 단위")
    c.page.locator("#cc-future-scarce").click()
    _metrics(c, PLANS["D"], "scarce", aid)
    c.expect("50.0% → 64.3%" in _text(c, "#cc-warn-clinker"), f"{aid} 원료 상한 경고")
    c.page.locator("#cc-future-delay").click()
    _metrics(c, PLANS["D"], "delay", aid)
    c.expect("30% → 10%" in _text(c, "#cc-warn-electric"), f"{aid} 전기 상한 경고")
    c.page.locator("#cc-future-smooth").click()
    c.expect(c.page.locator("#cc-lock").is_disabled(), f"{aid} 한 문장 없으면 확정 불가")
    c.page.locator("#cc-oneline").fill(LINE)
    c.page.locator("#cc-lock").click()
    c.expect(c.page.locator("#cc-next").is_enabled(), f"{aid} 유효 확정 뒤 이동 활성")
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-next", f"{aid} 확정 뒤 이동에 포커스")
    c.expect(c.page.locator("#cc-support").is_disabled(), f"{aid} 확정 뒤 지원 잠금")
    c.eq(c.page.locator("#cc-oneline").get_attribute("readonly"), "", f"{aid} 확정 문장 읽기 전용")
    c.page.locator("#cc-memo").fill("가상 예시 메모")
    c.wait_saved(400)
    c.page.reload()
    c.page.wait_for_selector("#cc-next")
    c.expect(c.page.locator("#cc-next").is_enabled(), f"{aid} 새로고침 후 확정 유지")
    c.eq(c.page.locator("#cc-memo").input_value(), "가상 예시 메모", f"{aid} 공통 메모 저장")
    qs = _qs(c)
    c.eq(len(qs), 7, f"{aid} 질문7개")
    c.eq([q["k"] for q in qs[5:]], ["cc-i-jobs-support", "cc-i-scm"], f"{aid} 후보 우선순위")
    c.expect("cc-c4-union" in [q["k"] for q in qs], f"{aid} 노조 반문")
    c.eq(qs[2]["k"], "cc-c3-match", f"{aid} 지원 토글은 예측 판정 불변")
    c.check(f"{aid} 준비실")
    c.page.locator("#cc-next").click()
    c.page.wait_for_selector(".qdeck .qcard")
    cards = c.page.locator(".qdeck .qcard")
    c.expect(6 <= cards.count() <= 7, f"{aid} 면접 카드6~7개")
    c.eq(cards.count(), 7, f"{aid} D 면접 카드7개")
    c.eq(sum("기준 먼저" in t or "고침·유지와 이유" in t for t in cards.locator(".who").all_text_contents()), 2, f"{aid} 핵심 습관 카드2개 표시")
    c.expect(all("연습용 질문" in s and "보고서 문항" not in s for s in cards.all_text_contents()),
             f"{aid} 모든 질문에 연습용 표시·보고서 표시 없음")
    c.check(f"{aid} 면접실")
    c.phase("reflect")
    c.page.wait_for_selector("#before-s-cement-carbon")
    panel = c.page.locator("section.panel").filter(has=c.page.locator("#rsum"))
    c.expect("연습용 평가 기준" in panel.locator("h3").inner_text(), f"{aid} 자기평가 제목")
    c.eq(c.page.locator("#phase h3").filter(has_text="설계 의도").count(), 1, f"{aid} 의도 제목")
    c.check(f"{aid} 성찰")


def t_12_3_account_and_support(c: Ctx):
    aid = "12.3-물리불변"
    _ui_plan(c, "G0", finish=False)
    _metrics(c, PLANS["G0"], "smooth", aid)
    paths = _flows(c)
    for value, reduction, qkey in ((0, "12.3%", "cc-i-ledger-0"),
                                   (50, "33.5%", "cc-i-ledger-50"), (100, "54.8%", "cc-i-ledger-100")):
        _range(c, "acct", value)
        c.eq(_flows(c), paths, f"{aid} 인정{value} 경로 key·d·폭·존재 불변")
        c.eq(_qs(c), [], f"{aid} 확정 전 인정{value} 질문 없음")
        c.eq(_text(c, "#cc-ledger-reduction"), reduction, f"{aid} 인정{value} 장부 표시")
        _metrics(c, dict(PLANS["G0"], acct=value), "smooth", aid)
        # 초안 대신 명세의 유효 스냅샷으로 질문 API의 세 배타적 k를 별도 확인한다.
        qs = c.page.evaluate("s=>KCP.games['s-cement-carbon'].questions(s)", _snapshot(dict(PLANS["G0"], acct=value)))
        c.expect(qkey in [q["k"] for q in qs], f"{aid} 인정{value} 질문 분기")
    c.page.locator("#cc-data-people").click()
    before = _text(c, "#cc-data-panel")
    before_results = [_text(c, x) for x in ("#cc-physical", "#cc-ledger-reduction", "#cc-power-total", "#cc-power-extra", "#cc-indirect")]
    c.wait_saved()
    p = _game(c)["plan"]
    old = c.page.evaluate("p=>KCP.games['s-cement-carbon'].model.calc(p,'smooth')", p)
    c.page.locator("#cc-support").check()
    c.wait_saved()
    new = c.page.evaluate("p=>KCP.games['s-cement-carbon'].model.calc(p,'smooth')", _game(c)["plan"])
    c.expect(abs(new["price"] - old["price"] - 4) <= 1e-12, f"{aid} 지원 가격 정확히+4%p")
    c.eq(_flows(c), paths, f"{aid} 지원 흐름 불변")
    c.eq([_text(c, x) for x in ("#cc-physical", "#cc-ledger-reduction", "#cc-power-total", "#cc-power-extra", "#cc-indirect")],
         before_results, f"{aid} 지원 장부·물리·전력 불변")
    after = _text(c, "#cc-data-panel")
    c.expect("현재 계획에는 공동 기금 비용이 없습니다" in before and "공동 기금의 가격 반영분은 +4.0%p" in after,
             f"{aid} 노동자 지원 안내 변경")
    off_note = "현재 계획에는 공동 기금 비용이 없습니다. 소득 보완과 재배치가 필요한 사람에게 누가 어떤 비용을 부담할지 별도로 제안해 주세요."
    on_note = "지원안을 골랐습니다. 공동 기금의 가격 반영분은 +4.0%p입니다. 교육 중 소득, 재배치의 선택권, 기금 관리에 노동자가 참여하는 방법까지 제안해 주세요."
    c.eq(before.replace(off_note, ""), after.replace(on_note, ""), f"{aid} 이해관계자에서 노동자 추가 문구만 변경")
    headings = ("시멘트 생산 업무:", "석회석 채굴·클링커 소성 업무:", "전환 설비·대체 원료 업무:")
    for heading in headings:
        c.expect(bool(_line(before, heading)), f"{aid} {heading} 상시 공개")
        c.eq(_line(before, heading), _line(after, heading), f"{aid} {heading} 지원 불변")
    c.expect("고용 유지" not in after, f"{aid} 지원의 자동 고용 보장 없음")
    c.page.locator("#cc-support").uncheck()
    c.eq(_text(c, "#cc-data-panel"), before, f"{aid} 지원 해제하면 원래 이해관계자 내용")


def _line(text, start):
    return next((line for line in text.splitlines() if line.strip().startswith(start)), "")


def t_12_3_caps_and_destinations(c: Ctx):
    aid = "12.3-상한·행선지"
    _ui_plan(c, "B", finish=False)
    c.expect("실제 저장 0.390 · 광물화 0.100 · 합성연료 0.000" in _text(c, "#cc-valve-dest"), f"{aid} B 실제 광물화·넘침 저장")
    c.eq(_text(c, "#cc-warn-mineral"), "광물화 상한: 넘친 0.390 Mt/년을 저장으로 보냈습니다.", f"{aid} 광물화 경고 전문")
    c.page.locator("#cc-future-scarce").click()
    c.expect("실제 저장 0.535 · 광물화 0.100" in _text(c, "#cc-valve-dest"), f"{aid} B 원료 물량")
    c.expect(c.page.locator("#cc-warn-clinker").is_visible(), f"{aid} 클링커 경고 표시")
    for valve, warn in (("clinker", "clinker"), ("dest", "mineral")):
        c.expect("cc-warn-" + warn in (c.page.locator("#cc-valve-" + valve).get_attribute("aria-describedby") or ""),
                 f"{aid} {valve} 경고 접근성 연결")
    for field in ("mineral", "syn"):
        c.eq(c.page.locator("#cc-" + field).get_attribute("max"), "100", f"{aid} {field} max100 고정")
    _key(c, "syn", "End")
    c.eq(c.page.locator("#cc-syn").input_value(), "0", f"{aid} mineral100에서 syn End를0으로 되돌림")
    c.eq(_text(c, "#cc-store-value"), "0%", f"{aid} 계획 잔여 저장0")
    c.expect(c.page.locator("#cc-syn-plus").is_disabled(), f"{aid} 잔여 없으면 syn+ 비활성")
    c.expect("남은 저장 몫이 없습니다. 다른 행선지를 먼저 줄이세요." in _text(c, "#cc-live"), f"{aid} 자름 안내 유지")
    note = "합성연료로 보낸 탄소가 없어 인정 비율을 바꿔도 장부가 바뀌지 않습니다."
    c.expect(note in _text(c, "#cc-valve-acct"), f"{aid} syn0 무변화 안내")
    _key(c, "mineral", "Home")
    _key(c, "syn", "End")
    _key(c, "mineral", "End")
    c.eq(c.page.locator("#cc-mineral").input_value(), "0", f"{aid} syn100에서 mineral End를0으로 되돌림")
    c.expect("남은 저장 몫이 없습니다. 다른 행선지를 먼저 줄이세요." in _text(c, "#cc-live"), f"{aid} 반대 방향 자름 안내")
    c.expect(note not in _text(c, "#cc-valve-acct"), f"{aid} syn양수 안내 제거")
    c.wait_saved()
    c.eq(_game(c)["plan"]["syn"], 100, f"{aid} 사용자 계획 비율을 물량 상한으로 덮지 않음")
    c.page.locator("#cc-back1").click()
    _key(c, "capture", "Home")
    keys = [x["key"] for x in _flows(c)]
    c.expect(not set(keys) & {"capture", "store", "mineral", "syn", "leak", "retained", "mineral-out", "syn-out"},
             f"{aid} 포집0 경로를 1px로 생성하지 않음")
    c.page.locator("#cc-predict-below").check()
    c.page.locator("#cc-stage1").click()
    c.expect("포집량 0: 비율을 바꿔도 현재 흐름은 없습니다." in _text(c, "#cc-valve-dest"), f"{aid} 포집0 행선지 편집 안내")
    c.expect(c.page.locator("#cc-syn").is_enabled(), f"{aid} 포집0에도 행선지 편집 가능")


def t_12_3_lock_and_revisit(c: Ctx):
    aid = "12.3-잠금·재예측"
    _ui_plan(c, "C")
    qs, recap, lock = _qs(c), _recap(c), _game(c)["locked"]
    c.expect(not qs[2]["q"].startswith("결과를 본 뒤"), f"{aid} 최초 예측 접두문 없음")
    c.page.locator("#cc-future-delay").click()
    c.eq(_qs(c), qs, f"{aid} 탭 선택과 질문 독립")
    c.eq(_recap(c), recap, f"{aid} 탭 선택과 recap 독립")
    c.page.evaluate("""() => {
      for(const e of document.querySelectorAll('#cc-root input:disabled,#cc-root select:disabled,#cc-root textarea[readonly]')) {
        if(e.type==='checkbox'||e.type==='radio') e.checked=!e.checked;
        else if(e.tagName==='SELECT') e.value='risk'; else e.value=e.type==='range'?e.min:'훼손 시도';
        for(const t of ['input','change']) e.dispatchEvent(new Event(t,{bubbles:true}));
      }
    }""")
    c.wait_saved()
    c.eq(_game(c)["locked"], lock, f"{aid} disabled 인위 이벤트에도 snapshot 불변")
    c.eq(_qs(c), qs, f"{aid} 인위 이벤트에도 질문 불변")
    # 화면에 보이는 disabled 값까지 훼손했으므로 저장된 권위 원본으로 다시 렌더한다.
    c.page.reload()
    c.page.wait_for_selector("#cc-unlock")
    c.phase("room")
    c.page.locator('textarea[data-a="0"]').fill("가상 보존할 이전 답변")
    # 고정 400ms 뒤 원본을 읽지 않고 답변이 저장소에 반영될 때까지 기다린다(250ms 지연 저장과 부하 경합).
    c.page.wait_for_function("key => (JSON.parse(localStorage.getItem(key)).answers || {})['0'] === '가상 보존할 이전 답변'", arg=KEY)
    answers = c.ls(KEY)["answers"]
    answer_q = c.ls(KEY)["answerQ"]
    c.phase("prep")
    c.page.locator("#cc-memo").fill("가상 재계획 메모")
    c.wait_saved()
    c.page.locator("#cc-unlock").click()
    c.expect(c.page.locator("#cc-next").is_disabled(), f"{aid} 해제 즉시 이동 비활성")
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-d", f"{aid} 해제 포커스 수요")
    c.wait_saved()
    g = _game(c)
    for key, expected in dict(locked=None, step=1, prediction=None, predictDraft="", fut="smooth", revisited=True,
                              plan=PLANS["C"], oneLine=LINE).items():
        c.eq(g[key], expected, f"{aid} 해제 뒤 {key}")
    c.eq(c.page.locator("#cc-memo").input_value(), "가상 재계획 메모", f"{aid} 메모 유지")
    c.eq(c.ls(KEY)["answers"], answers, f"{aid} 해제해도 이전 답변 유지")
    c.eq(c.ls(KEY)["answerQ"], answer_q, f"{aid} 해제해도 이전 질문 기록 유지")
    c.expect("다시 계획하면 질문이 달라질 수 있습니다. 기존 답변 메모는 남습니다." in _text(c, "#cc-root"), f"{aid} 질문 변경·답변 보존 안내")
    c.expect("다시 계획하기: 앞서 결과를 본 뒤의 재예측입니다." in _text(c, "#cc-prediction"), f"{aid} 결과 노출 사실 안내")
    c.expect("예측에 포함되는 현재 설정:" in _text(c, "#cc-prediction"), f"{aid} 행선지·인정·지원 재예측 안내")
    c.phase("room")
    c.eq(c.page.locator(".qdeck .qcard").count(), 0, f"{aid} 공통 탭 우회해도 질문0")
    c.expect(any("아직 확정하지 않았습니다" in x["d"] for x in _recap(c)), f"{aid} 우회 시 미확정 안내")
    c.phase("prep")
    c.page.locator("#cc-predict-below").check()
    c.page.locator("#cc-stage1").click()
    c.page.locator("#cc-back1").click()
    c.wait_saved()
    c.expect(_game(c)["revisited"] is True, f"{aid} back1도 revisited=true")
    c.page.reload()
    c.page.wait_for_selector("#cc-stage1")
    c.expect(_game(c)["revisited"] is True, f"{aid} back1 재예측 상태도 새로고침 유지")
    c.page.locator("#cc-predict-below").check()
    c.page.locator("#cc-stage1").click()
    c.page.locator("#cc-lock").click()
    c.wait_saved()
    c.page.reload()
    c.page.wait_for_selector("#cc-next")
    c.expect(_game(c)["locked"]["revisited"] is True, f"{aid} locked 재예측 저장·새로고침 유지")
    c.expect(_qs(c)[2]["q"].startswith("결과를 본 뒤 다시 한 예측입니다."), f"{aid} 재예측 질문 접두문")
    c.expect(next(x["d"] for x in _recap(c) if x["t"] == "예측 확인").endswith("(다시 계획한 뒤의 예측)"), f"{aid} recap 재예측 접미문")


def t_12_3_prediction_snapshot(c: Ctx):
    aid = "12.3-예측복제"
    _ui_plan(c, "G0", finish=False)
    c.wait_saved()
    prediction = copy.deepcopy(_game(c)["prediction"])
    # 최초 stage1의 저장100 예측과 이후 합성연료80·인정50 결과를 구분한다.
    _range(c, "acct", 50)
    c.page.locator("#cc-oneline").fill("가격 부담을 보아 장부 규칙을 바꾸지만 물리 배출은 줄지 않는다.")
    c.page.locator("#cc-lock").click()
    c.wait_saved()
    c.eq(_game(c)["locked"]["prediction"], prediction, f"{aid} 행선지·장부 변경 뒤 예측 snapshot 보존")
    expected = _red(_reference(prediction["plan"], "delay")["reduction"])
    final = _red(_reference(dict(PLANS["G0"], acct=50), "delay")["reduction"])
    c.expect(expected != final, f"{aid} 비교 fixture의 예측값·최종값은 서로 다름")
    question = _qs(c)[2]["q"]
    # 명세 8절 cc-c3: 예측 당시 계획과 최종 계획의 감축률을 구분한다(수치 기대값은 독립 계산).
    c.expect(f"예측 당시 계획의 장부상 감축률은 {expected}%" in question and f"최종 계획을 기술 지연 상황에 적용한 장부상 감축률은 {final}%" in question,
             f"{aid} predicted와 final을 각각 계산")
    recap = next(x["d"] for x in _recap(c) if x["t"] == "예측 확인")
    c.expect(f"예측 당시 기술 지연 장부상 감축률 {expected}%" in recap and f"최종 계획 {final}%" in recap,
             f"{aid} recap도 두 계산을 구분")


def t_12_3_undermet_and_plain_recap(c: Ctx):
    aid = "12.3-미도달·문자열"
    _ui_plan(c, "A", finish=False)
    c.page.locator("#cc-oneline").fill("   ")
    c.expect(c.page.locator("#cc-lock").is_disabled(), f"{aid} 공백 문장 확정 불가")
    c.eq(c.page.locator("#cc-oneline").get_attribute("maxlength"), "300", f"{aid} 문장300자 상한")
    line = '<img src=x onerror="window.__cc_unwanted=true">가상 입력'
    c.page.locator("#cc-oneline").fill(line)
    c.page.locator("#cc-lock").click()
    c.expect(c.page.locator("#cc-next").is_enabled(), f"{aid} 60% 미도달이어도 유효 계획 확정")
    c.wait_saved()
    recap = _recap(c)
    c.eq([x["t"] for x in recap], ["계획 상태", "기준의 순서", "생산과 소재", "가마와 포집", "행선지와 장부",
                                    "전환 지원", "순조로운 전환", "원료 부족", "기술 지연", "예측 확인", "한 문장 정리"],
         f"{aid} recap11항목 순서")
    c.eq(recap[-1]["d"], line, f"{aid} 입력은 HTML처럼 보여도 plain 원문")
    c.eq(recap[-1].get("text"), line, f"{aid} 복사용 text 같은 원문")
    c.expect(all(isinstance(x["d"], str) for x in recap), f"{aid} recap d는 모두 문자열")
    c.page.locator("#cc-next").click()
    c.page.wait_for_selector(".qcard")
    c.phase("reflect")
    c.expect(c.page.evaluate("window.__cc_unwanted===undefined"), f"{aid} 학생 입력을 코드로 실행하지 않음")
    c.eq(c.page.locator('#phase img[src="x"]').count(), 0, f"{aid} 학생 입력 이미지 DOM 생성 없음")


def t_12_3_recovery(c: Ctx):
    aid = "12.3-복구"
    foreign = {"phase": "prep", "memo": "다른 게임 가상 보존", "answers": {"0": "가상 답"}}
    c.page.evaluate("s=>localStorage.setItem('kcp:v1:2022',JSON.stringify(s))", foreign)
    cases = [
        ("문자열 game", "훼손", dict(DEFAULT), 1), ("배열 game", [], dict(DEFAULT), 1),
        ("빈 객체", {}, dict(DEFAULT), 1),
        ("version", dict(version=99, plan=PLANS["B"]), dict(DEFAULT), 1),
        ("범위 밖", dict(version=1, plan=dict(DEFAULT, d=999)), dict(DEFAULT), 1),
        ("문자 숫자", dict(version=1, plan=dict(DEFAULT, d="30", capture="90")), dict(DEFAULT), 1),
        ("격자 밖", dict(version=1, plan=dict(DEFAULT, c=53)), dict(DEFAULT), 1),
        ("NaN 구조", dict(version=1, plan=dict(DEFAULT, d={"nan": True}, bio=None)), dict(DEFAULT), 1),
        ("행선지 합초과", dict(version=1, plan=dict(DEFAULT, mineral=100, syn=10)), dict(DEFAULT), 1),
        ("잘못된 미래", dict(version=1, plan=DEFAULT, fut="unknown", dataTab="bad"), dict(DEFAULT), 1),
        ("비boolean", dict(version=1, plan=dict(DEFAULT, support="true"), revisited="true"), dict(DEFAULT), 1),
        ("step2 예측없음", dict(version=1, plan=PLANS["E"], step=2, fut="delay"), PLANS["E"], 1),
    ]
    for label, game, plan, step in cases:
        state = dict(phase="prep", game=game, memo="가상 보존 메모", answers={"0": "가상 보존 답"}, answerQ={"0": "가상 질문"})
        errors = len(c.rec["pageerrors"])
        _inject(c, state)
        c.expect(c.page.locator("#cc-root").is_visible(), f"{aid} {label}에서 준비실 렌더")
        c.eq(len(c.rec["pageerrors"]), errors, f"{aid} {label} 페이지 오류 없음")
        # renderPrep 정규화 결과는 사용자 입력의 save를 거쳐 저장 계약으로 확인한다.
        # N1: 고정 시간 뒤 저장을 추측하지 않고 메모 입력이 반영된 저장 완료를 기다린다.
        recovery_memo = f"가상 보존 메모 — {label}"
        c.page.evaluate("() => new Promise(resolve => setTimeout(resolve, 0))")
        c.page.locator("#cc-memo").fill(recovery_memo)
        c.page.wait_for_function("([key, memo]) => JSON.parse(localStorage.getItem(key)).memo === memo", arg=[KEY, recovery_memo])
        saved = c.ls(KEY)
        c.eq(saved["game"]["plan"], plan, f"{aid} {label} 필드별 기본값 복구")
        c.eq(saved["game"]["step"], step, f"{aid} {label} 단계 복구")
        c.eq(saved["answers"], state["answers"], f"{aid} {label} 답변 보존")
        c.eq(saved["answerQ"], state["answerQ"], f"{aid} {label} 질문 메모 보존")
        c.eq(c.ls("kcp:v1:2022"), foreign, f"{aid} {label} 다른 게임 저장 키 보존")
        c.eq(saved["game"]["revisited"], False, f"{aid} {label} 비정상 revisited 기본값")
        if label == "version":
            c.expect("이 기록은 현재 계산 규칙과 맞지 않아 계획을 초기값으로 열었습니다." in _text(c, "#cc-root"), f"{aid} 버전 복구 안내")
    for field in ("d", "c", "bio", "elec", "capture", "mineral", "syn", "acct"):
        for bad in (str(DEFAULT[field]), 999):
            plan = dict(DEFAULT, d=10)
            plan[field] = bad
            expected = dict(DEFAULT, d=10)
            expected[field] = DEFAULT[field]
            _inject(c, dict(phase="prep", game=dict(version=1, plan=plan), memo="가상 메모"))
            # N1과 같은 이유: 고정 400ms 뒤 localStorage 원본을 읽으면 부하로 250ms 지연 저장이 밀릴 때
            # 주입한 훼손값을 그대로 읽는다(저장 타이머를 700ms로 늦춘 변형에서 16건 재현). 메모 반영을 기다린다.
            field_memo = f"가상 필드 복구 메모 — {field} {bad!r}"
            c.page.locator("#cc-memo").fill(field_memo)
            c.page.wait_for_function("([key, memo]) => JSON.parse(localStorage.getItem(key)).memo === memo", arg=[KEY, field_memo])
            c.eq(c.ls(KEY)["game"]["plan"], expected, f"{aid} {field}의 {bad!r}는 형·격자 검사로 복구")
    long_line = "가상 문장" * 70
    _inject(c, dict(phase="prep", game=dict(version=1, plan=DEFAULT, oneLine=long_line)))
    c.eq(c.page.locator("#cc-oneline").input_value(), long_line[:300], f"{aid} 초안 문자열은300자까지 복구")
    for bad in ("true", None, 1):
        state = _snapshot(PLANS["C"])
        state["game"]["locked"]["revisited"] = bad
        _inject(c, state)
        c.eq(_qs(c), [], f"{aid} 비boolean locked.revisited={bad!r} snapshot 폐기")
    state = _snapshot(PLANS["C"])
    del state["game"]["locked"]["revisited"]
    _inject(c, state)
    c.eq(_qs(c), [], f"{aid} locked.revisited 누락 snapshot 폐기")
    state = _snapshot(PLANS["C"])
    state["game"].update(plan=PLANS["A"], criteria=["bad", "bad"], oneLine="초안 훼손", step=1)
    _inject(c, state)
    _metrics(c, PLANS["C"], "smooth", aid)
    c.eq(c.page.locator("#cc-oneline").input_value(), LINE, f"{aid} 유효 locked가 권위 원본")
    c.expect(c.page.locator("#cc-next").is_enabled(), f"{aid} 유효 locked로 step2 복원")
    for label, path, bad in (("locked 숫자 문자열", ("locked", "plan", "d"), "0"),
                             ("locked 기준 중복", ("locked", "criteria"), ["sure", "sure"]),
                             ("locked 잘못된 예측", ("locked", "prediction", "value"), "unknown"),
                             ("locked 빈 문장", ("locked", "oneLine"), " "),
                             ("locked 행선지 합초과", ("locked", "plan", "syn"), 100)):
        state = _snapshot(PLANS["C"])
        target = state["game"]
        for part in path[:-1]:
            target = target[part]
        target[path[-1]] = bad
        _inject(c, state)
        c.eq(_qs(c), [], f"{aid} {label} snapshot 전체 폐기")
    state = _snapshot(PLANS["E"])
    state["game"].update(locked=None, criteria=["sure", "sure"], revisited="true")
    state["game"]["prediction"]["plan"]["capture"] = "60"
    _inject(c, state)
    c.expect(c.page.locator("#cc-next").is_disabled(), f"{aid} 훼손 예측으로 이동 활성화 안 됨")
    # 위 필드 반복과 같은 이유로 고정 대기 대신 메모 반영을 기다린 뒤 원본을 읽는다.
    c.page.locator("#cc-memo").fill("가상 복구 메모 수정")
    c.page.wait_for_function("([key, memo]) => JSON.parse(localStorage.getItem(key)).memo === memo", arg=[KEY, "가상 복구 메모 수정"])
    g = c.ls(KEY)["game"]
    c.eq(g["criteria"], ["", ""], f"{aid} 중복 기준 둘 다 초기화")
    c.eq(g["prediction"], None, f"{aid} 예측 필드 하나 훼손되어도 snapshot 전체 폐기")
    c.eq(g["step"], 1, f"{aid} 훼손 예측 뒤 1단계 복구")
    c.eq(g["fut"], "smooth", f"{aid} 1단계 복구 미래 smooth")
    c.eq(g["plan"], PLANS["E"], f"{aid} 유효 초안은 1단계 복구에도 유지")
    # 게임 메서드 자체도 normalize해야 한다. 공통 load의 game 방어와 별도로 검사한다.
    for game in ("문자열", [], dict(version=1, plan=dict(DEFAULT, syn=500))):
        result = c.page.evaluate("s=>({q:KCP.games['s-cement-carbon'].questions(s),r:KCP.games['s-cement-carbon'].recap(s)})", dict(game=game))
        c.eq(result["q"], [], f"{aid} questions 직접 진입도 손상값 복구")
        c.expect("아직 확정하지 않았습니다" in result["r"][0]["d"], f"{aid} recap 직접 진입도 손상값 복구")


def t_12_3_storage_blocked(c: Ctx):
    aid = "12.3-저장차단"
    # 접근 차단은 다음 문서부터 적용해 공통 엔진과 게임의 예외 처리를 함께 검사한다.
    c.page.add_init_script("""for(const name of ['getItem','setItem','removeItem'])
      Storage.prototype[name]=function(){throw new DOMException('검사용 저장 차단','SecurityError');};""")
    c.page.reload()
    _ui_plan(c, "D")
    _metrics(c, PLANS["D"], "smooth", aid)
    c.expect(c.page.locator("#cc-next").is_enabled(), f"{aid} 저장 불가여도 계산·조작·확정 동작")


def t_12_3_question_fixtures(c: Ctx):
    aid = "12.3-질문·조사"
    fixtures = [(name, PLANS[name], "below", False) for name in ("A", "B", "C", "D", "E", "F", "G0", "G1")]
    fixtures += [("바이오30", dict(DEFAULT, bio=30), "below", False),
                 ("수요15", dict(DEFAULT, d=15), "below", False),
                 ("광물화100", dict(DEFAULT, mineral=100), "below", False),
                 ("C10", PLANS["C10"], "reach", False), ("D30", PLANS["D30"], "reach", False),
                 ("H", PLANS["H"], "reach", False), ("I", PLANS["I"], "below", False),
                 ("D재예측", PLANS["D"], "below", True),
                 ("수요30 포집0", dict(DEFAULT, d=30, c=50, support=True), "below", False)]
    # 면접 부담 조정: 공통 5개 + 개별 최대 2개. 목표 미달이면 목표 대비 차이 질문이 개별의 맨 앞.
    expected = {
        "A": (6, "cc-c4-choice", ["cc-i-gap"]),
        "B": (7, "cc-c4-union", ["cc-i-jobs-nosupport", "cc-i-scm"]),
        "C": (7, "cc-c4-env", ["cc-i-capture", "cc-i-storage"]),
        "D": (7, "cc-c4-union", ["cc-i-jobs-support", "cc-i-scm"]),
        "G0": (7, "cc-c4-env", ["cc-i-gap", "cc-i-ledger-0"]),
        "G1": (7, "cc-c4-env", ["cc-i-gap", "cc-i-ledger-100"]),
        "C10": (7, "cc-c4-env", ["cc-i-capture", "cc-i-storage"]),
        "D30": (7, "cc-c4-union", ["cc-i-jobs-support", "cc-i-scm"]),
        "H": (7, "cc-c4-env", ["cc-i-capture", "cc-i-storage"]),
        "I": (7, "cc-c4-env", ["cc-i-gap", "cc-i-ledger-0"]),
        "D재예측": (7, "cc-c4-union", ["cc-i-jobs-support", "cc-i-scm"]),
        "수요30 포집0": (7, "cc-c4-union", ["cc-i-gap", "cc-i-jobs-support"]),
    }
    for label, plan, predict, revisited in fixtures:
        _inject(c, _snapshot(plan, predict, revisited))
        qs = _qs(c)
        keys = [q["k"] for q in qs]
        c.expect(6 <= len(qs) <= 7, f"{aid} {label} 질문6~7개")
        c.eq(len(keys), len(set(keys)), f"{aid} {label} k 유일")
        c.expect(all("src" not in q and not re.search(r"NaN|undefined|<[^>]*>", q["q"]) for q in qs), f"{aid} {label} src·비정상 문구·HTML 없음")
        c.eq(keys[4], "cc-c5-outside", f"{aid} {label} 고정 발산 질문")
        if _reference(plan, "smooth")["reduction"] < 60 - 1e-12:
            c.eq(keys[5], "cc-i-gap", f"{aid} {label} 목표 미달이면 목표 대비 차이 질문 우선")
        if label in expected:
            count, c4, individual = expected[label]
            c.eq(len(qs), count, f"{aid} {label} 명세 문항수")
            c.eq(keys[3], c4, f"{aid} {label} 반문 우선순위")
            c.eq(keys[5:], individual, f"{aid} {label} 개별 우선순위")
        reached = _reference(plan, "delay")["reduction"] >= 60 - 1e-12
        c.eq(keys[2], "cc-c3-match" if (predict == "reach") == reached else "cc-c3-diff", f"{aid} {label} 예측 k")
        c.expect(_red(_reference(plan, "delay")["reduction"]) + "%" in qs[2]["q"], f"{aid} {label} 예측 수치")
        c.eq(qs[2]["q"].startswith("결과를 본 뒤 다시 한 예측입니다."), revisited, f"{aid} {label} 재예측 문구")
        if label == "I":
            c.expect("장부상 감축률은 1.6%, 목표 대비 차이는 −58.4%p" in qs[5]["q"], f"{aid} I 목표 대비 차이 우선")
        if label == "C":
            c.expect("순조 81.1%, 기술 지연 55.9%로 25.2%p 낮아집니다" in next(q["q"] for q in qs if q["k"] == "cc-i-capture"), f"{aid} C 하락 분기")
        if label == "수요30 포집0":
            c.expect("장부상 감축률은 52.7%, 목표 대비 차이는 −7.3%p" in qs[5]["q"], f"{aid} 포집 없는 미달 계획 목표 차이 질문")
        if label == "바이오30":
            c.expect("cc-i-bio" in keys, f"{aid} 바이오만30 후보")
        if label == "수요15":
            c.expect("cc-i-jobs-nosupport" in keys, f"{aid} 수요15 지원끔 후보")
    for key, title, wa, ul in (("sure", "확실한 감축", "과", "을"), ("local", "일자리·지역 경제", "와", "를"),
                               ("price", "가격 부담", "과", "을"), ("risk", "기술 위험 분산", "과", "을"),
                               ("honest", "장부와 실제의 일치", "와", "를")):
        other = "price" if key == "sure" else "sure"
        # 명세 8절 cc-c1·12.3의 다섯 기준 조사 검증 + 요청 하나 개정: 둘째는 병렬 명사구 뒤 “가운데”.
        for criteria, suffix in (([key, other], wa), ([other, key], " 가운데 어떤 기준을 앞세웠는지 먼저 밝히고")):
            qs = c.page.evaluate("s=>KCP.games['s-cement-carbon'].questions(s)", _snapshot(PLANS["A"], criteria=criteria))
            c.expect(title + "’" + suffix in qs[0]["q"], f"{aid} 실제 KCP.josa {key} {'첫째' if criteria[0] == key else '둘째'}")


def t_12_3_physical_baseline(c: Ctx):
    aid = "12.3-물리 기준선"
    # 장부상 감축은 목표를 넘지만 물리적 대기 배출은 현재보다 늘어나는 계획이 주 화면에서 드러나야 한다.
    p = dict(DEFAULT, capture=90, syn=100, acct=100)
    _inject(c, _snapshot(p))
    r = _reference(p, "smooth")
    c.eq(_red(r["reduction"]), "79.2", f"{aid} 역전 계획 장부상 감축률")
    c.eq(_text(c, "#cc-physical-delta"), _physical_line(r), f"{aid} 현재 대비·간접 포함 표시")
    c.expect("+0.127" in _text(c, "#cc-physical-delta") and "장부상 감축과 달리 실제 대기 배출은 늘어남" in _text(c, "#cc-physical-delta")
             and "2.840 Mt/년" in _text(c, "#cc-physical-delta"), f"{aid} 역전 사실 문구")
    c.expect(c.page.locator("#cc-physical-delta").is_visible(), f"{aid} 주 지표 아래 상시 표시")
    c.eq(_text(c, "#cc-warn-physical"), "장부와 실제의 엇갈림: 장부상 감축률은 79.2%이지만 물리적 대기 배출은 현재보다 0.127 Mt/년 많습니다.", f"{aid} 결과 경고에 엇갈림")
    compare = _text(c, "#cc-compare-smooth")
    c.expect("물리적 대기 배출 현재 대비" in compare and "+0.127 Mt CO₂/년" in compare and "2.840 Mt CO₂/년" in compare, f"{aid} 세 미래 비교에도 표시")
    c.expect("(현재 대비 +0.127)" in next(x["d"] for x in _recap(c) if x["t"] == "순조로운 전환"), f"{aid} recap 현재 대비")
    c.expect("현재 대비 +0.127" in (c.page.locator("#cc-mini").text_content() or ""), f"{aid} 요약 띠 현재 대비")
    c.expect("포집 기여 몫: " in (c.page.locator("#cc-capture-share").text_content() or ""), f"{aid} 포집 기여 표시")
    c.page.locator("#cc-future-scarce").click()
    c.eq(c.page.locator("#cc-warn-physical").count(), 1, f"{aid} 원료 부족에서도 엇갈림 경고")
    # 포집이 장부 배출을 늘리는 계획: 음의 백분율 대신 늘어난 양.
    _inject(c, _snapshot(dict(DEFAULT, d=5, elec=10, capture=90, syn=100)))
    share = c.page.locator("#cc-capture-share").text_content() or ""
    c.eq(share, "포집 기여 몫: 포집이 장부 배출을 0.113 Mt/년 늘림(포집만 끈 같은 계획 대비)", f"{aid} 포집 증가 계획 표시")
    c.expect(not re.search(r"[−-]\d[\d.]*%", share), f"{aid} 음의 백분율 없음")
    c.eq(c.page.locator("#cc-warn-physical").count(), 0, f"{aid} 물리 배출이 현재보다 줄어든 계획은 엇갈림 경고 없음")
    scope = _text(c, "#cc-price-scope")
    c.expect("수요 감축의 비용" in scope and "t당 고정비" in scope, f"{aid} 가격 모형의 수요 감축 비용 제외 공개")
    c.check(f"{aid} 준비실")


def t_12_3_boundary_and_work(c: Ctx):
    aid = "12.3-경계·업무"
    _ui_plan(c, "H", predict="reach")
    c.page.locator("#cc-future-delay").click()
    _metrics(c, PLANS["H"], "delay", aid)
    c.expect("59.99%" in _text(c, "#cc-mini"), f"{aid} 요약 띠 경계 표시")
    c.expect("59.99%" in _text(c, "#cc-compare-delay") and "−0.01%p" in _text(c, "#cc-compare-delay"), f"{aid} 미래 비교 경계 표시")
    c.expect("59.99%" in next(x["d"] for x in _recap(c) if x["t"] == "기술 지연"), f"{aid} recap 경계 표시")
    c.eq(_qs(c)[2]["k"], "cc-c3-diff", f"{aid} H reach는 예측 불일치")
    # 잠긴 결과에서도 낭독이 갱신되면 경계 표시를 지켜야 한다. 조작 낭독은 별도 초안으로 검사.
    state = _snapshot(PLANS["H"], "reach")
    state["game"]["locked"] = None
    state["game"]["fut"] = "delay"
    _inject(c, state)
    c.page.locator("#cc-acct").focus()
    c.page.keyboard.press("ArrowRight")
    c.expect("59.99%" in _text(c, "#cc-live") and "물리적 대기 배출" in _text(c, "#cc-live"), f"{aid} live 경계 표시")
    exact = c.page.evaluate("""() => {const m=KCP.games['s-cement-carbon'].model;
      return [m.fmtRed(60),m.fmtGap(0),m.reaches({reduction:60})];}""")
    c.eq(exact, ["60.0", "0.0", True], f"{aid} 정확한 목표 경계")
    p = dict(DEFAULT, c=50)
    _inject(c, _snapshot(p))
    c.page.locator("#cc-data-people").click()
    for future in FUT:
        c.page.locator("#cc-future-" + future).click()
        text = _text(c, "#cc-data-panel")
        K = _reference(p, future)["K"]
        c.expect("시멘트 생산 업무: 유지" in text and "석회석 채굴·클링커 소성 업무: 줄어듦" in text and "전환 설비·대체 원료 업무: 늘어남" in text,
                 f"{aid} {future} 세 업무 방향")
        c.expect(f"선택 미래 클링커 {_fmt(K, 3)} Mt/년, 현재 1.600" in text, f"{aid} {future} 실제 K와 현재 비교")
        c.expect("세 업무의 규모와 필요한 숙련이 달라 순고용 증감은 계산하지 않습니다." in text, f"{aid} 순고용 한계 공개")
    c.expect(abs(_reference(p, "smooth")["K"] - 1.2) < 1e-12, f"{aid} 상한 적용 실제 클링커1.200")


def t_12_3_reflect_gate_examples(c: Ctx):
    aid = "12.3-성찰"
    _ui_plan(c, "D")
    c.phase("reflect")
    c.page.wait_for_selector("#before-s-cement-carbon")
    c.expect(c.page.locator("#exwrap").is_hidden(), f"{aid} 입력 전 예시 숨김")
    c.page.locator("#before-s-cement-carbon").fill("짧은 기준")
    c.expect(c.page.locator("#openEx").is_disabled(), f"{aid} 10자 미만 열기 불가")
    # 명세 10·12.3: 실제 사용자 입력 → native 버튼 클릭으로 공통 관문을 검사한다.
    # dispatch_event는 disabled 버튼의 native 클릭 제한을 우회하므로 제외한다.
    # 인위 이벤트 방어는 성찰 관문에 명시되지 않았다. 짧은 입력의 disabled와
    # 예시 숨김은 유지하고, 10자 이상 입력한 다음 실제 click으로 열기를 검증한다.
    c.expect(c.page.locator("#exwrap").is_hidden(), f"{aid} 짧은 입력에서 예시 숨김")
    c.page.locator("#before-s-cement-carbon").fill("나는 지역의 전환 비용을 먼저 고려한다")
    c.page.locator("#openEx").click()
    c.expect(c.page.locator("#exwrap").is_visible(), f"{aid} 공통 관문 통과 뒤 내용 보임")
    c.eq(c.page.locator("#openEx").count(), 1, f"{aid} 열기 버튼 공통 하나")
    c.eq(c.page.locator('.cc-reflect button,.cc-reflect textarea,.cc-reflect input').count(), 0, f"{aid} 게임 자체 관문·추천 입력 없음")
    examples = c.page.locator("#exwrap details.reveal.cc-example")
    c.eq(examples.count(), 3, f"{aid} 예시3개 같은 details 클래스")
    bodies, lengths, styles = [], [], []
    labels = ["기준과 무게.", "선택.", "얻는 것과 잃는 것.", "비용과 약점.", "반문 뒤의 판단.", "조건이 달라지면."]
    for i in range(examples.count()):
        ex = examples.nth(i)
        c.expect(ex.get_attribute("open") is None, f"{aid} 예시{i+1} 접힌 채 시작")
        c.eq(ex.locator(":scope > p").count(), 6, f"{aid} 예시{i+1} 여섯 문단")
        c.eq(ex.locator(":scope > p > b:first-child").all_text_contents(), labels, f"{aid} 예시{i+1} 같은 구조")
        paragraphs = ex.locator(":scope > p").all_text_contents()
        lengths.append(sum(len(p) for p in paragraphs))
        bodies.append(" ".join(paragraphs))
        styles.append(ex.evaluate("e=>{const s=getComputedStyle(e);return [s.fontSize,s.fontWeight,s.backgroundColor,s.borderColor,s.padding];}"))
    # N1·N2: 예시 B의 중복 원단위 문장 삭제 후 실제 본문 길이. 비율 계약 1.05는 유지한다.
    c.eq(lengths, [906, 928, 890], f"{aid} 태그 제외 본문 글자 수")
    c.expect(max(lengths) / min(lengths) <= 1.05, f"{aid} 해설 길이 비중")
    c.expect(styles[0] == styles[1] == styles[2], f"{aid} 동일한 예시 타이포·배경·테두리")
    for i, fragments in enumerate((["60.6%", "0.544 Mt/년", "+18.3%", "1.800 Mt/년"],
                                    ["63.6%"], ["63.2%", "0.519 Mt/년", "+13.5%", "1.500 Mt/년"])):
        c.expect(all(x in bodies[i] for x in fragments), f"{aid} 예시{i+1} C10/D30/F 조건부 수치")
    # 경계 공정성: 포집 예시도 전력·간접 배출을 밝히고, 수요 예시는 경계에 따른 순위 역전과 가격 누락을 밝힌다.
    c.expect("0.052·0.091·0.114 Mt/년" in bodies[2], f"{aid} 단계적 예시 간접 배출")
    c.expect("0.311·0.316·0.271 TWh/년" in bodies[0] and "0.047·0.079·0.095 Mt/년" in bodies[0], f"{aid} 포집 예시 전력·간접 배출")
    c.expect("0.690 대 0.703 Mt/년" in bodies[1] and "t당 고정비" in bodies[1], f"{aid} 수요 예시 경계 역전·가격 누락")
    limits = c.page.locator("#exwrap .cc-limits").text_content() or ""
    # 결함 2: 생산량이 다른 총량 비교와 같은 수요·원단위 비교를 구분한다.
    c.expect(all(v in limits for v in ("2.000 Mt", "1.400 Mt", "0.482 Mt/년", "0.352", "0.493")), f"{aid} 생산량·원단위 비교")
    c.expect("0.703 Mt/년" in limits and "0.690 Mt/년" in limits and "총량인지 원단위인지" in limits, f"{aid} 한계에 경계별 순위 역전")
    c.expect("t당 고정비" in limits and "43%" in limits, f"{aid} 한계에 가격 누락·재탄산화 규모")
    reflect = c.page.locator("#exwrap .cc-reflect").text_content() or ""
    c.expect("계획(C)" not in reflect and "G0·G1" not in reflect, f"{aid} 내부 검사 이름 노출 없음")
    c.expect("IPCC" in reflect and "5배·50배" in reflect, f"{aid} 저장 누출률의 실제 평가 맥락")
    c.eq(c.page.locator("table.rubric tbody tr").count(), 9, f"{aid} 공통 자기평가9개")
    before = _game(c)["locked"]
    c.page.locator('.seg button[data-v="3"]').first.click()
    c.wait_saved()
    c.eq(_game(c)["locked"], before, f"{aid} 자기평가와 계산 계획 독립")
    c.expect(not re.search("정답|최적안|합격|종합 점수", " ".join(examples.locator("summary").all_text_contents())), f"{aid} 예시 정답 배지 없음")
    c.check(f"{aid} 성찰")
    _capture(c, aid, "세 예시의 동등한 비중과 공통 성찰 관문")


def t_12_4_keyboard_focus(c: Ctx):
    aid = "12.4-키보드"
    _prep(c)
    c.page.evaluate("window.__cc_range_node=document.querySelector('#cc-d')")
    _key(c, "d", "ArrowRight")
    c.expect(c.page.evaluate("document.querySelector('#cc-d')===window.__cc_range_node"), f"{aid} input에 밸브 DOM 전체 교체 없음")
    c.page.locator("#cc-crit1").focus()
    visited = []
    for _ in range(70):
        focused = c.page.evaluate("document.activeElement.id")
        visited.append(focused)
        if focused == "cc-crit1" and len(visited) > 1:
            break
        c.page.keyboard.press("Tab")
    c.expect("cc-crit2" in visited and "cc-d" in visited and "cc-predict-reach" in visited,
             f"{aid} Tab으로 기준·밸브·예측 도달")
    c.expect(not set(visited) & {"cc-mineral", "cc-syn", "cc-acct", "cc-support"}, f"{aid} 숨긴 2단계 입력 Tab 제외")
    c.page.locator("#cc-crit1").select_option("sure")
    c.page.locator("#cc-crit2").select_option("price")
    c.page.locator("#cc-predict-below").check()
    c.page.locator("#cc-stage1").focus()
    c.page.keyboard.press("Enter")
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-mineral", f"{aid} Enter로2단계 이동")
    _key(c, "syn", "ArrowRight")
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-syn", f"{aid} range input 뒤 같은 포커스")
    c.page.locator("#cc-acct").focus()
    c.eq(c.page.locator(".cc-flow.cc-emphasis").count(), 0, f"{aid} 장부 포커스 탄소 경로 강조 없음")
    c.expect("이 조작은 탄소 흐름을 바꾸지 않습니다." in _text(c, "#cc-mini"), f"{aid} 장부 무변화 안내")
    c.page.locator("#cc-memo").fill("가상 커서 보존")
    c.page.locator("#cc-memo").evaluate("e=>{e.focus();e.setSelectionRange(2,5);}")
    # 실제 클릭이면 탭으로 포커스가 옮겨지는 것이 정상. 포커스를 빼앗지 않는 렌더 계약은
    # 프로그램으로 click 이벤트만 보내어 자료 갱신 중 커서 보존을 검사한다.
    c.page.locator("#cc-data-tech").dispatch_event("click")
    c.eq(c.page.evaluate("[document.activeElement.id,document.activeElement.selectionStart,document.activeElement.selectionEnd]"),
         ["cc-memo", 2, 5], f"{aid} 자료 갱신이 메모 포커스·커서를 보존")
    for prefix, panel in (("future", "future-panel"), ("data", "data-panel")):
        tabs = c.page.locator("#cc-futures [role=tab]" if prefix == "future" else "#cc-materials [role=tab]")
        c.expect(tabs.count() >= 3, f"{aid} {prefix} role tab")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            c.eq(tab.get_attribute("aria-controls"), "cc-" + panel, f"{aid} tab-controls 연결")
        tabs.first.focus()
        y_before = c.page.evaluate("window.scrollY")
        c.page.keyboard.press("End")
        c.eq(c.page.evaluate("document.activeElement.id"), tabs.last.get_attribute("id"), f"{aid} 탭 End·포커스 유지")
        c.page.keyboard.press("Home")
        c.eq(c.page.evaluate("document.activeElement.id"), tabs.first.get_attribute("id"), f"{aid} 탭 Home")
        c.page.keyboard.press("ArrowLeft")
        c.eq(c.page.evaluate("document.activeElement.id"), tabs.last.get_attribute("id"), f"{aid} 탭 좌우 순환")
        c.eq(c.page.locator("#cc-" + panel).get_attribute("aria-labelledby"), tabs.last.get_attribute("id"), f"{aid} tabpanel-labelledby")
        c.eq(sum(tab == "0" for tab in tabs.evaluate_all("es=>es.map(e=>e.getAttribute('tabindex'))")), 1, f"{aid} 선택 탭만 tabindex0")
        if y_before > 20:
            c.expect(c.page.evaluate("window.scrollY") > 0, f"{aid} 탭 활성화가 세로스크롤을 상단으로 초기화하지 않음")
    # 2단계 DOM 순서대로 Tab을 진행하며 문장·확정·면접 이동을 키보드로 완료한다.
    c.page.locator("#cc-mineral").focus()
    seen = set()
    for _ in range(100):
        focused = c.page.evaluate("document.activeElement.id")
        seen.add(focused)
        if focused == "cc-oneline":
            c.page.keyboard.insert_text(LINE)
        if focused == "cc-lock":
            c.page.keyboard.press("Enter")
            break
        c.page.keyboard.press("Tab")
    c.expect({"cc-mineral", "cc-syn", "cc-acct", "cc-support", "cc-oneline", "cc-lock"} <= seen, f"{aid} Tab만으로 행선지→정리→확정")
    c.eq(c.page.evaluate("document.activeElement.id"), "cc-next", f"{aid} 최종 이동 포커스")
    c.page.keyboard.press("Enter")
    c.page.wait_for_selector(".qcard")
    c.check(f"{aid} 키보드로 도달한 면접실")


def t_12_4_layout_theme_sticky(c: Ctx):
    aid = "12.4-배치·테마"
    _ui_plan(c, "C", finish=False)
    c.check(f"{aid} 준비실")
    c.expect(c.page.evaluate("document.documentElement.scrollWidth<=window.innerWidth"), f"{aid} 문서 가로 스크롤 없음")
    pair = c.page.locator("#cc-ledger-reduction,#cc-physical").evaluate_all("""es=>es.map(e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();return [s.fontSize,s.fontWeight,r.width];})""")
    # 명세 4.5·7.1·11·12.4: 동등한 시각적 비중. 글꼴·굵기는 정확히 같아야 한다.
    # 동일한 1fr 열도 브라우저의 subpixel 배분으로 1/64 CSS px 차이가 날 수 있다.
    # 폭만 1/32 CSS px까지 허용해 격자 반올림을 수용하며 실제 폭 차이는 계속 검출한다.
    c.eq(pair[0][:2], pair[1][:2], f"{aid} 두 지표 같은 글꼴·굵기")
    c.expect(abs(pair[0][2] - pair[1][2]) <= 1 / 32,
             f"{aid} 두 지표 같은 폭(허용 1/32 CSS px, 실제 {pair[0][2]}, {pair[1][2]})")
    c.eq(c.page.locator("#cc-flow-svg").get_attribute("viewBox"), "0 0 360 660", f"{aid} 고정 viewBox")
    c.eq(c.page.locator("#cc-flow-svg").get_attribute("role"), "img", f"{aid} SVG 이미지 역할")
    c.eq(c.page.locator("#cc-flow-svg").get_attribute("aria-labelledby"), "cc-flow-title cc-flow-desc", f"{aid} SVG 제목·설명 연결")
    c.eq(c.page.locator("#cc-flow-svg [tabindex],#cc-flow-svg[tabindex]").count(), 0, f"{aid} SVG Tab 진입 없음")
    c.eq(c.page.locator("#cc-flow-svg #cc-power-chart").count(), 0, f"{aid} 전력 막대는 탄소 SVG 밖")
    c.eq(c.page.locator(".cc-flow-table tbody tr").count(), 15, f"{aid} 같은15흐름 대체 표")
    c.expect(c.page.locator("#cc-balance").is_visible(), f"{aid} 탄소 수지 접기 밖 상시 표시")
    if c.cfg.mobile:
        _mobile_sticky(c, aid)
    else:
        c.expect(c.page.locator("#cc-mini").is_hidden(), f"{aid} 980px 이상 요약 띠 숨김")
    for theme in ("light", "dark"):
        c.page.evaluate("t=>document.documentElement.dataset.theme=t", theme)
        c.expect((c.contrast("#cc-valve-capture legend") or 0) >= 4.5, f"{aid} 강제{theme} 밸브 글자 대비")
        c.expect((c.contrast("#cc-results") or 0) >= 4.5, f"{aid} 강제{theme} 결과 글자 대비")
        color = c.page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim()")
        c.expect(bool(color), f"{aid} 강제{theme} 공통 변수 적용")
        if theme == "light":
            light = color
        else:
            c.expect(color != light, f"{aid} 테마별 배경 변수 변경")
    c.page.evaluate("delete document.documentElement.dataset.theme")
    colors = []
    for scheme in ("light", "dark"):
        c.page.emulate_media(color_scheme=scheme, reduced_motion="reduce")
        colors.append(c.page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim()"))
    c.expect(colors[0] != colors[1], f"{aid} prefers-color-scheme 변수 적용")
    c.page.emulate_media(color_scheme=c.cfg.scheme)
    c.page.locator("#cc-oneline").fill(LINE)
    c.page.locator("#cc-lock").click()
    c.page.locator("#cc-next").click()
    c.page.wait_for_selector(".qcard")
    c.check(f"{aid} 면접실")
    c.phase("reflect")
    c.check(f"{aid} 성찰")


def _mobile_sticky(c, aid):
    c.page.locator("#cc-back1").click()
    c.page.locator("#cc-capture").scroll_into_view_if_needed()
    _key(c, "capture", "Home")
    before = _text(c, "#cc-mini")
    c.page.keyboard.press("ArrowRight")
    after = _text(c, "#cc-mini")
    c.expect(before != after and "포집" in after, f"{aid} input마다 관련 포집 흐름 갱신")
    dims = c.page.evaluate("""() => {const m=document.querySelector('#cc-mini'),r=m.getBoundingClientRect(),
      strip=document.querySelector('#strip').getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,h:innerHeight,w:innerWidth,
        stripBottom:strip.bottom,topCss:parseFloat(getComputedStyle(m).top),stripHeight:document.querySelector('#strip').offsetHeight,
        parent:m.parentElement.id,sticky:getComputedStyle(m).position,overflow:m.scrollWidth>m.clientWidth};}""")
    c.expect(dims["top"] >= dims["stripBottom"] - 1 and dims["bottom"] <= dims["h"] and dims["left"] >= 0 and dims["right"] <= dims["w"], f"{aid} capture 조작 중 요약 띠는 strip 아래 뷰포트 안")
    c.eq(dims["parent"], "cc-future-panel", f"{aid} 요약 띠·밸브 같은 패널")
    c.eq(dims["sticky"], "sticky", f"{aid} 요약 띠 sticky")
    c.expect(not dims["overflow"], f"{aid} 요약 띠 숫자·단위 잘림 없음")
    c.expect(abs(dims["topCss"] - dims["stripHeight"]) <= 1, f"{aid} sticky top=strip 높이")
    c.page.locator("#strip").evaluate("e=>e.style.minHeight=(e.offsetHeight+24)+'px'")
    c.page.wait_for_timeout(100)
    c.expect(c.page.evaluate("Math.abs(parseFloat(getComputedStyle(document.querySelector('#cc-mini')).top)-document.querySelector('#strip').offsetHeight)<=1"), f"{aid} ResizeObserver로 top 재계산")
    c.page.locator("#strip").evaluate("e=>e.style.minHeight=''")
    c.page.locator("#cc-predict-below").check()
    c.page.locator("#cc-stage1").click()


def t_12_4_svg_ports_and_screens(c: Ctx):
    aid = "12.4-산키"
    for label, p, future in (("A", PLANS["A"], "smooth"), ("C", PLANS["C"], "smooth"),
                              ("합성연료100 원료부족", dict(DEFAULT, capture=90, syn=100), "scarce")):
        _inject(c, _snapshot(p))
        c.page.locator("#cc-future-" + future).click()
        r = _reference(p, future)
        values = dict(limestone=r["process"], coal=r["coal"], bio=r["bio"], gas=r["X"], total=r["G"],
                      stack=r["stack"], capture=r["C"], store=r["store"], mineral=r["mineral"], syn=r["syn"],
                      leak=r["leak"], retained=r["retained"])
        values.update({"stack-out": r["stack"], "mineral-out": r["mineral"], "syn-out": r["syn"]})
        paths = {a["key"]: a for a in _flows(c)}
        flow_order = ["limestone", "coal", "bio", "gas", "total", "stack", "capture", "store", "mineral", "syn",
                      "stack-out", "leak", "retained", "mineral-out", "syn-out"]
        c.eq(list(paths), [k for k in flow_order if values[k] > 0], f"{aid} {label} 양수 경로·그리기 순서")
        for key, path in paths.items():
            c.expect(abs(float(path["width"]) - max(1, 36 * values[key])) < 1e-9, f"{aid} {label}.{key} 공통36px/Mt 척도")
            loc = c.page.locator("#cc-flow-" + key)
            c.eq(loc.get_attribute("stroke-linecap"), "butt", f"{aid} {key} 접점 butt")
            if key in ("leak", "syn-out"):
                c.eq(loc.get_attribute("stroke-dasharray"), "4 3", f"{aid} {key} 재배출 점선")
        for center, keys, endpoint in ((180, ["limestone", "coal", "bio", "gas"], "end"),
                                       (180, ["stack", "capture"], "start"), (220, ["store", "mineral", "syn"], "start")):
            positive = [k for k in keys if values[k] > 0]
            widths = [max(1, 36 * values[k]) for k in positive]
            left = center - sum(widths) / 2
            for key, width in zip(positive, widths):
                nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:e[+-]?\d+)?", paths[key]["d"], re.I)]
                expected = left + width / 2
                port, control = (nums[-2], nums[-4]) if endpoint == "end" else (nums[0], nums[2])
                c.expect(abs(port - expected) < 1e-6 and abs(control - expected) < 1e-6, f"{aid} {label}.{key} 누적 포트와 제어점 일치")
                left += width
        bounds = c.page.locator("#cc-flow-svg text,.cc-flow[data-cc-flow]").evaluate_all("""es=>es.map(e=>{
          const b=e.getBBox();return {id:e.id,x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height};})""")
        c.expect(all(b["x"] >= -.1 and b["y"] >= -.1 and b["right"] <= 360.1 and b["bottom"] <= 660.1 for b in bounds), f"{aid} {label} text·경로 viewBox 내부")
        outlined = c.page.locator("#cc-flow-svg text").evaluate_all("es=>es.every(e=>{const s=getComputedStyle(e);return s.paintOrder.includes('stroke')&&parseFloat(s.strokeWidth)>=4;})")
        c.expect(outlined, f"{aid} {label} 라벨 바탕색 테두리로 판독 보조")
        legend = _text(c, ".cc-legend")
        c.expect(all(x in legend for x in ("청록:", "회색:", "점선:", "빗금:", "생물 기원 탄소 50%")), f"{aid} 색·점선·빗금 범례")
        c.expect("아주 작은 흐름은 1px로 표시하여 폭의 합이 정확히 맞지 않을 수 있습니다. 보존은 수치로 확인하세요." in _text(c, "#cc-workbench"), f"{aid} 1px 하한 안내")
        if r["bio"] > 0:
            c.eq(c.page.locator("#cc-bio-hatch").count(), 1, f"{aid} 바이오 빗금 pattern")
            c.eq(c.page.locator(".cc-hatch[data-cc-flow]").count(), 0, f"{aid} overlay는 물량 경로에 중복 안 됨")
        c.expect(not re.search(r"\d\.\d{12}|개발 검사|assert", _text(c, "#cc-root")), f"{aid} 학생 화면 개발 오차·assert 없음")
        _capture(c, aid, f"{label} · {c.cfg.scheme} · 라벨 겹침/대비 판독")
        c.check(f"{aid} {label} 준비실")


def t_12_4_static_contract(c: Ctx):
    aid = "12.4-정적계약"
    root = Path(__file__).resolve().parents[1]
    js = root / "games/s-cement-carbon.js"
    css = root / "games/s-cement-carbon.css"
    result = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True, check=False)
    c.eq(result.returncode, 0, f"{aid} 게임 JS 구문 검사 {result.stderr.strip()}")
    source = js.read_text()
    # 계산/문구를 기대값으로 읽지 않는다. 여기서는 금지된 API·개발 assert 유무만 검사.
    c.expect(not re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|https?://", source), f"{aid} 게임의 신규 외부 요청 없음")
    c.expect(bool(re.search(r"\bassert\b|throw\s+new\s+Error", source)), f"{aid} 개발 탄소 수지 assert 존재(수치 조건은 Node 전수 검증)")
    text = re.sub(r"/\*.*?\*/", "", css.read_text(), flags=re.S)
    selectors = []
    # @media/@supports를 제외하고 각 규칙의 선언 앞 선택자만 검사한다.
    for match in re.finditer(r"([^{}]+)\{", text):
        selector = match.group(1).strip()
        if selector.startswith("@"):
            continue
        selectors.extend(s.strip() for s in selector.split(","))
    c.expect(bool(selectors) and all(re.match(r"[.#]cc-", s) for s in selectors), f"{aid} 모든 신규 CSS 선택자 cc- 시작")
    c.expect(not re.search(r"#[\da-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(|@font-face|url\s*\(", text), f"{aid} 새 색·외부 폰트·배경 이미지 없음")
    c.expect(not re.search(r"\banimation\s*:|@keyframes", text), f"{aid} 흐름 애니메이션 없음")
    _prep(c)
    sizes = c.page.locator(".cc-stepper,.cc-range").evaluate_all("""es=>es.filter(e=>e.getClientRects().length).map(e=>{
      const r=e.getBoundingClientRect();return [e.id,r.width,r.height,e.matches('.cc-stepper')];})""")
    c.expect(all(h >= 44 and (not button or w >= 44) for _, w, h, button in sizes), f"{aid} 버튼44×44·range높이44 누르기 영역")
    _key(c, "d", "Home")
    outline = c.page.locator("#cc-d").evaluate("e=>{const s=getComputedStyle(e);return [s.outlineWidth,s.outlineOffset,s.outlineStyle];}")
    c.eq(outline, ["2px", "3px", "solid"], f"{aid} 키보드 focus-visible 윤곽")
    c.expect(c.page.locator("#cc-memo").is_visible(), f"{aid} 모바일도 메모 숨김 없음")


if __name__ == "__main__":
    main(globals())
