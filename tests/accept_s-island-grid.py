"""수정 명세만 근거로 만든 인수 검사. 브라우저 실행은 통합 담당이 수행한다.

ID: 12.1-1~6, 12.2-1~6, 12.3-1~8, 12.4-1~6, 12.5-1~3.
12.2는 입력/첫 시험/거부·승인/완료/수치표/표시·비용의 여섯 항목,
12.4·12.5는 명세의 글머리표 순서다. 공통 기준은 C-1~4로 표시한다.
검산표 전체와 고정 시드 물리 검사는 model_s-island-grid.mjs에도 있다.
실행: KCP_BASE=<index.html 주소> python tests/accept_s-island-grid.py
"""
import re

from accept_originals import assert_single_request
from harness import Ctx, main


ID = "s-island-grid"
KEY = "kcp:v1:" + ID
B = {"bat": [-1, -1, 0, 4, 4, -1, -2, -2],
     "n": [2, 2, 1, 0, 0, 2, 3, 3], "dr": [4, 5]}
A = {"bat": [0, 0, 0, 3, 2, 0, -2, -2],
     "n": [3, 2, 1, 1, 2, 3, 3, 3], "dr": [4, 5]}
# 답변 15분에 맞춘 일곱 문항: 공통 3 + 개별 2 + 반문 1 + 발산 1.
Q_B = ["ig-c1", "ig-c2-in", "ig-c3-hit", "ig-b-outage",
       "ig-b-correction", "ig-r-r2", "ig-storage-alt"]
LINE = "배출 감소를 얻는 대신 구름 날씨의 공급 여유를 잃었다."
LIMITATION = "사망자나 환자 수를 계산하지 않는 비교용 지수"
TOTAL_FIELDS = ["ch", "dis", "u", "heat", "diesel", "co2", "curt", "soc", "delta",
                "dcharge", "cost", "ext", "coop", "h", "starts", "corrections"]
# 6.2 두 표 전체를 그대로 전사. 표의 마지막 열은 보정 구간 목록이다.
TOTALS = {
    "Z": [
        [0,0,89.134200,9.489557,0,0,18.996000,8,0,0,0,13.297200,5.698800,0,0,[]],
        [0,0,119.144574,39.269100,0,0,10.752000,8,0,0,0,7.526400,3.225600,0,0,[]],
        [0,0,94.515000,40.858736,0,0,12.717600,8,0,0,0,8.902320,3.815280,0,0,[]]],
    "H": [
        [8.421053,0,0,0,122.992853,92.244639,53.433600,16,8,8.421053,135.413905,37.403520,16.030080,24,3,[]],
        [8.421053,0,0,0,139.503227,104.627420,31.689600,16,8,8.421053,151.924279,22.182720,9.506880,24,3,[]],
        [8.421053,0,.062400,.075771,128.311253,96.233439,47.155200,16,8,8.421053,140.732305,33.008640,14.146560,24,3,[]]],
    "A": [
        [8.421053,12,0,0,87.406200,65.554650,29.846947,3.368421,-4.631579,0,104.427253,20.892863,8.954084,18,5,[]],
        [8.421053,12,0,0,102.582174,76.936631,6.768547,3.368421,-4.631579,0,119.603227,4.737983,2.030564,18,5,[]],
        # dcharge .683453 → 0: 한계 기준 배정. 09–12시는 디젤 최소 출력·출력제한 중이라 충전해도 디젤이 늘지 않는다.
        [8.421053,12,0,0,89.801400,67.351050,20.582947,3.368421,-4.631579,0,106.822453,14.408063,6.174884,18,5,[]]],
    "B": [
        [15.069252,18,0,0,69.406200,52.054650,11.198748,3.368421,-4.631579,0,87.059663,11.198748,0,15,5,[3,5]],
        [10.752000,15.783680,9.484800,6.731148,86.313694,64.735270,1.437600,1.600000,-6.400000,0,103.640478,1.437600,0,15,5,[3,4]],
        [15.069252,19.651200,0,0,71.801400,53.851050,3.585948,1.630316,-6.369684,0,89.537423,3.585948,0,15,5,[3,5]]],
    "C": [
        [6,3,0,0,93.406200,70.054650,29.268000,10.542105,2.542105,0,109.856200,20.487600,8.780400,15,5,[]],
        [6,3,.484800,.588686,111.097374,83.323031,9.189600,10.542105,2.542105,0,127.547374,6.432720,2.756880,15,5,[]],
        [6,3,0,0,95.801400,71.851050,20.004000,10.542105,2.542105,0,112.251400,14.002800,6.001200,15,5,[]]],
    "Bp": [
        [15.069252,18,0,0,72.406200,54.304650,14.198748,3.368421,-4.631579,0,90.059663,14.198748,0,15,5,[3,5]],
        [10.752000,15.783680,.484800,.344052,95.313694,71.485270,1.437600,1.600000,-6.400000,0,112.640478,1.437600,0,15,5,[3,4]],
        [15.069252,19.651200,0,0,74.801400,56.101050,6.585948,1.630316,-6.369684,0,92.537423,6.585948,0,15,5,[3,5]]]
}


def _state(c):
    return c.page.evaluate("""() => {
      KCP.flush(); return KCP.load('s-island-grid');
    }""")


def _game(c):
    return _state(c)["game"]


def _text(c, selector):
    return c.page.locator(selector).inner_text()


def _words(c, selector, words, aid):
    text = _text(c, selector)
    for word in words:
        c.expect(word in text, f"{aid} {selector}에 {word!r} 표시")


def _hidden(c, selector, aid):
    c.expect(c.page.locator(selector).is_hidden(), f"{aid} {selector} 숨김")


def _disabled(c, selector, yes, aid):
    c.eq(c.page.locator(selector).is_disabled(), yes, f"{aid} {selector} 비활성 상태")


def _near(c, actual, expected, aid, name, tolerance=1e-6):
    c.expect(isinstance(actual, (int, float)) and abs(actual - expected) <= tolerance,
             f"{aid} {name}: 기대 {expected}, 실제 {actual}")


def _prep(c):
    c.goto("#ys-island-grid", wait="#ig-prep")
    c.phase("prep")
    c.page.wait_for_selector("#ig-bat-row")


def _cell(c, row, b):
    loc = c.page.locator(f"#ig-{row}-row")
    loc.focus()
    loc.press("Home")
    for _ in range(b):
        loc.press("ArrowRight")
    return loc


def _set_cell(c, row, b, value, aid):
    loc = _cell(c, row, b)
    old = int(_game(c)[row][b])
    for _ in range(abs(value - old)):
        loc.press("ArrowUp" if value > old else "ArrowDown")
    c.eq(int(_game(c)[row][b]), value, f"{aid} 키 입력으로 {row}[{b}]={value}")
    c.eq(loc.get_attribute("aria-valuenow"), str(value), f"{aid} {row} 화면 값과 상태 일치")


def _configure(c, plan=B, crit=("emission", "fair"), shed="R2", curt="C2",
               baseline=10, predict="S2", aid="12.2-1"):
    _prep(c)
    for row in ("bat", "n"):
        for b, v in enumerate(plan[row]):
            _set_cell(c, row, b, v, aid)
    for b in plan["dr"]:
        _set_cell(c, "dr", b, 1, aid)
    c.page.locator("#ig-crit1").select_option(crit[0])
    c.page.locator("#ig-crit2").select_option(crit[1])
    c.page.locator(f"#ig-shed-{shed}").click()
    c.page.locator(f"#ig-curt-{curt}").click()
    c.page.locator("#ig-baseline-s").select_option("S2")
    c.page.locator("#ig-baseline-limit").fill(str(baseline))
    c.page.locator(f"#ig-pred-{predict}").check()
    _disabled(c, "#ig-test", False, aid)
    return _game(c)


def _approve(c, aid="12.2-3"):
    # 무한 클릭을 막고 경고를 한 건씩 실제 버튼으로 승인한다.
    seen = []
    count_before = _game(c)["tests"]
    for _ in range(24):
        if c.page.locator("#ig-warning").is_hidden():
            break
        seen.append(_text(c, "#ig-warning"))
        c.page.locator("#ig-accept").click()
        c.page.wait_for_timeout(30)
        if c.page.locator("#ig-warning").is_visible():
            c.eq(_game(c)["tests"], count_before, f"{aid} 개별 승인만으로 시험 횟수 안 늘림")
    c.expect(c.page.locator("#ig-warning").is_hidden(), f"{aid} 모든 경고가 개별 승인 뒤 닫힘")
    return seen


def _test(c, aid="12.2-4"):
    c.page.locator("#ig-test").click()
    _approve(c, aid)
    c.expect(c.page.locator("#ig-results").is_visible(), f"{aid} 완결 시험 결과 표시")


def _lock(c):
    c.page.locator("#ig-lock").click()
    c.page.locator("#ig-one-line").fill(LINE)


def _questions(c):
    return assert_single_request(c, c.page.evaluate("KCP.games['s-island-grid'].questions(KCP.load('s-island-grid'))"))


def _keys(c):
    _state(c)
    return [q["k"] for q in _questions(c)]


def _complete_b(c, predict="S2", crit=("emission", "fair")):
    _configure(c, predict=predict, crit=crit)
    _test(c)
    _lock(c)


def _inject(c, state):
    # app.js의 대기 저장이 시험 주입을 덮지 않게 홈 이동·flush 뒤 주입.
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush()")
    c.page.evaluate("s => localStorage.setItem('kcp:v1:s-island-grid', JSON.stringify(s))", state)
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    _prep(c)


def t_12_1_registration(c: Ctx):
    aid = "12.1-1"
    c.goto("#home", wait=".home-grid")
    c.eq(c.page.locator('#home-originals .opkg[href="#ys-island-grid"]').count(), 1,
         "C-1 홈 창작 구역에 게임 카드 하나")
    c.eq(c.page.locator(".pkg").count(), 5, "C-1 기존 기출 카드 다섯 개 유지")
    meta = c.page.evaluate("""() => ({m: KCP.YEARS['s-island-grid'],
      order: KCP.ORDER, count: KCP.ORIGINAL_ORDER.filter(x=>x==='s-island-grid').length})""")
    c.eq(meta["m"]["original"], True, f"{aid} 창작 메타")
    c.eq([meta["m"]["prep"], meta["m"]["answer"]], [25, 15], f"{aid} 준비·답변 시간")
    c.eq(list(meta["m"]["rubric"]), ["발산적 사고력", "문제해결 능력", "인문적 통찰 역량"],
         f"{aid} 평가 영역 세 개")
    c.eq([len(v) for v in meta["m"]["rubric"].values()], [3, 3, 3], f"{aid} 영역마다 세 문장")
    c.eq(meta["count"], 1, f"{aid} 창작 순서 중복 없음")
    c.eq(meta["order"], ["2022", "2023", "2024", "2025", "2026"], f"{aid} 기출 순서 유지")
    _prep(c)
    _words(c, ".brief", ["창작 게임 · 가상 자료", "연습섬 IG-24"], "C-1")
    c.wait_saved(400)
    c.expect(c.ls(KEY) is not None, "C-4 400ms 뒤 저장 키 생성")
    c.eq(c.ls("kcp:v1:s-islandgrid"), None, f"{aid} 잘못된 별칭 키 없음")
    c.expect(not c.page.evaluate("Object.hasOwn(KCP.games,'s-islandgrid')"), f"{aid} 별칭 게임 없음")
    c.check("C-1 준비실")


def t_12_1_initial(c: Ctx):
    aid = "12.1-2"
    _prep(c)
    for sel in ("#ig-go", "#ig-lock", "#ig-test"):
        _disabled(c, sel, True, aid)
    for sel in ("#ig-results", "#ig-unlock"):
        _hidden(c, sel, aid)
    c.eq(c.page.locator('#ig-principles [aria-pressed="true"]').count(), 0,
         f"{aid} 원칙 미선택")
    c.eq([c.page.locator(sel).input_value() for sel in ("#ig-weight-f1", "#ig-weight-f2")],
         ["3", "1.5"], f"{aid} 가중치 기본값")
    g = _game(c)
    c.eq(g["crit"], ["", ""], f"{aid} 기준 빈 값")
    c.eq(g["baseline"], {"scenario": "", "limit": None}, f"{aid} 기준선 추천값 없음")
    c.expect("추천 원칙" not in _text(c, "body"), f"{aid} 추천 원칙 없음")
    c.page.locator("#ig-crit1").select_option("outage")
    c.expect(c.page.locator('#ig-crit2 option[value="outage"]').is_disabled(), f"{aid} 중복 기준 금지")
    for value in ("assets", "people", "model", "weather"):
        tab = c.page.locator(f"#ig-tab-{value}")
        tab.click()
        c.eq(tab.get_attribute("aria-selected"), "true", f"{aid} 자료 탭 {value} 선택")
        c.expect(c.page.locator(f"#ig-pane-{value}").is_visible(), f"{aid} 자료 패널 연결")
        c.check(f"{aid} 자료 탭 {value}")
    _words(c, "#ig-pane-weather", ["가정 출력", "35~50%", "정체 고기압", "크게 낮을 수"], aid)
    c.expect("바람이 약한 날을 설정" not in _text(c, "#ig-pane-weather"), f"{aid} 넉넉한 풍력을 약한 바람이라 부르지 않음")
    tab = c.page.locator("#ig-tab-weather")
    tab.focus()
    tab.press("ArrowLeft")
    c.eq(c.page.locator("#ig-tab-model").get_attribute("aria-selected"), "true", f"{aid} 탭 키보드 순환")
    c.page.locator("#ig-tab-model").press("Home")
    c.eq(c.page.locator("#ig-tab-weather").get_attribute("aria-selected"), "true", f"{aid} 탭 Home")
    c.page.locator("#ig-tab-weather").press("End")
    c.eq(c.page.locator("#ig-tab-model").get_attribute("aria-selected"), "true", f"{aid} 탭 End")


def t_12_1_keyboard(c: Ctx):
    aid = "12.1-3"
    _prep(c)
    row = _cell(c, "bat", 4)
    for _ in range(3):
        row.press("ArrowDown")
    g = _game(c)
    c.eq(g["activeB"]["bat"], 4, f"{aid} 활성 칸 b4")
    c.eq(g["bat"], [0, 0, 0, 0, -3, 0, 0, 0], f"{aid} b4만 방전3")
    c.expect("12–15시 방전 3 MW" in row.get_attribute("aria-valuetext"), f"{aid} 시간·방향·단위 읽기")
    row.press("Home")
    for _ in range(6):
        row.press("ArrowDown")
    c.eq(_game(c)["bat"][0], -4, f"{aid} 하한에서 정지")
    before = _game(c)["rev"]
    row.press("ArrowDown")
    c.eq(_game(c)["rev"], before, f"{aid} 범위 밖 입력은 revision 불변")
    row.press("End")
    row.press("ArrowRight")
    c.eq(_game(c)["activeB"]["bat"], 7, f"{aid} 구간 상한에서 정지")
    c.eq(c.page.locator('#ig-bat-row[tabindex="0"], #ig-n-row[tabindex="0"], #ig-dr-row[tabindex="0"]').count(), 3,
         f"{aid} 시간축의 탭 정지점 세 행")
    c.eq(c.page.locator('.ig-control-row [tabindex="0"]').count(), 0, f"{aid} 자식 탭 정지점 없음")
    c.eq(c.page.locator('.ig-cell[tabindex="0"]').count(), 0, f"{aid} 칸별 탭 정지점 없음")
    # slider의 자식은 보조기기에 노출되지 않으므로 칸별 aria-label을 두지 않고 행의 aria-valuetext로 읽힌다.
    c.eq(c.page.locator(".ig-cell[aria-label]").count(), 0, f"{aid} 읽히지 않는 칸별 aria-label 없음")
    c.expect(row.evaluate("e=>e===document.activeElement"), f"{aid} 조작 뒤 포커스 보존")


def t_12_1_diesel_dr(c: Ctx):
    aid = "12.1-4"
    _prep(c)
    row = _cell(c, "n", 0)
    for v in (1, 2, 3, 0):
        row.press("Enter")
        c.eq(_game(c)["n"][0], v, f"{aid} Enter로 디젤 {v}기")
    for b in (4, 5):
        _cell(c, "dr", b).press("Space")
    row = _cell(c, "dr", 6)
    y = c.page.evaluate("scrollY")
    row.press("Space")
    c.eq(c.page.evaluate("scrollY"), y, f"{aid} Space로 페이지 스크롤 안 함")
    g = _game(c)
    c.eq(g["dr"], [False, False, False, False, True, True, False, False], f"{aid} 세 번째 DR 거부")
    _words(c, "body", ["하루 2구간"], aid)


def t_12_1_mobile_access(c: Ctx):
    aid = "12.1-5"
    _prep(c)
    for row in ("bat", "n", "dr"):
        loc = _cell(c, row, 0)
        c.eq(loc.get_attribute("role"), "slider", f"{aid} {row} slider")
        c.eq(loc.get_attribute("aria-roledescription"), "시간축 조절", f"{aid} 조절 역할 설명")
        c.eq(loc.get_attribute("aria-keyshortcuts"), "ArrowLeft ArrowRight ArrowUp ArrowDown Home End", f"{aid} 키 안내")
        c.expect("ig-timeline-help" in (loc.get_attribute("aria-describedby") or ""), f"{aid} 고정 안내 연결")
        c.expect(bool(loc.get_attribute("aria-label") or loc.get_attribute("aria-labelledby")), f"{aid} 행 label")
        _words(c, "#ig-live", ["←→", "↑↓"], aid)
        if c.cfg.mobile:
            boxes = c.page.locator(f"#ig-{row}-row .ig-cell").evaluate_all(
                "es=>es.map(e=>{const r=e.getBoundingClientRect();return {y:r.y,right:r.right}})")
            c.eq(len(boxes), 8, f"{aid} {row} 8칸")
            c.expect(max(v["y"] for v in boxes)-min(v["y"] for v in boxes) <= 1, f"{aid} {row} 한 줄 유지")
            c.expect(boxes[-1]["right"] <= c.cfg.width + 1, f"{aid} 마지막 칸 viewport 안")
            bounds = c.page.locator(f"#ig-{row}-row .ig-cell").evaluate_all(
                "es=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})")
            c.expect(all(bounds[i]["right"] <= bounds[i+1]["left"]+1 for i in range(7)),
                     f"{aid} 좁은 화면에서 시간 칸 겹치지 않음")
    for sel in ("#ig-prev", "#ig-next", "#ig-plus", "#ig-minus"):
        box = c.page.locator(sel).bounding_box()
        c.expect(box["width"] >= 44 and box["height"] >= 44, f"{aid} {sel} 44px 조작 버튼")
    if c.cfg.mobile:
        c.page.locator('#ig-n-row .ig-cell[data-ig-b="4"]').tap()
        c.eq(_game(c)["n"][4], 1, f"{aid} 디젤 터치 탭")
        c.page.locator("#ig-plus").tap()
        c.eq(_game(c)["n"][4], 2, f"{aid} 큰 증가 버튼")
        c.page.locator("#ig-minus").tap()
        c.eq(_game(c)["n"][4], 1, f"{aid} 큰 감소 버튼")
        # 배터리 터치도 좌표를 SVG viewBox로 환산한 기대값에 대조.
        svg = c.page.locator("#ig-bat-row svg").first
        # 손가락은 화면에 보이는 막대만 누를 수 있다. sticky 띠 아래에 숨은 좌표를 누르지 않도록
        # 그래프를 화면 가운데로 옮긴 뒤, 누를 점이 실제로 그래프인지 먼저 확인한다.
        svg.evaluate("e=>e.scrollIntoView({block:'center'})")
        box = svg.bounding_box()
        x, y = box["x"]+box["width"]*4.5/8, box["y"]+box["height"]*18/180
        c.eq(c.page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.closest('#ig-bat-svg')?.id||null", [x, y]),
             "ig-bat-svg", f"{aid} 누를 점이 배터리 그래프")
        c.page.touchscreen.tap(x, y)
        c.eq(_game(c)["bat"][4], 4, f"{aid} 배터리 터치로 b4 충전4")
        c.page.locator("#ig-minus").tap()
        c.eq(_game(c)["bat"][4], 3, f"{aid} 배터리 큰 버튼 동일 조작")
        c.page.locator('#ig-dr-row .ig-cell[data-ig-b="2"]').tap()
        c.eq(_game(c)["dr"][2], True, f"{aid} DR 터치 지원")
    c.check(f"{aid} 시간축·버튼")


def t_12_1_baseline_message(c: Ctx):
    aid = "12.1-6"
    _configure(c, aid=aid)
    msg = c.page.locator("#ig-baseline-msg")
    _hidden(c, "#ig-baseline-msg", aid)
    for bad in ("1.25", "-1", "301"):
        c.page.locator("#ig-baseline-limit").fill(bad)
        c.expect(msg.is_visible(), f"{aid} {bad} 입력에 안내 표시")
        _disabled(c, "#ig-test", True, aid)
        c.eq(_game(c)["baseline"]["limit"], None, f"{aid} {bad}는 기준선으로 저장 안 함")
    _words(c, "#ig-baseline-msg", ["0.1 MWh 단위", "시험 운전"], aid)
    c.eq(c.page.locator("#ig-baseline-limit").get_attribute("aria-describedby"), "ig-baseline-msg", f"{aid} 입력과 안내 연결")
    c.page.locator("#ig-shed-R1").click()
    c.eq(c.page.locator("#ig-baseline-limit").input_value(), "301", f"{aid} 다른 조작 뒤에도 잘못된 입력을 지우지 않음")
    c.expect(msg.is_visible(), f"{aid} 다른 조작 뒤에도 안내 유지")
    c.page.locator("#ig-baseline-limit").fill("9.5")
    _hidden(c, "#ig-baseline-msg", aid)
    c.eq(_game(c)["baseline"]["limit"], 9.5, f"{aid} 올바른 값 저장")
    _disabled(c, "#ig-test", False, aid)
    c.check(f"{aid} 기준선 안내")


def t_12_2_b_consent(c: Ctx):
    _configure(c)
    before = _game(c)
    c.page.locator("#ig-test").click()
    aid = "12.2-2"
    g = _game(c)
    c.eq(g["firstPredict"], "S2", f"{aid} 첫 예측 고정")
    c.eq(g["tests"], 0, f"{aid} 승인 중 시험 미완료")
    for s in ("S1", "S2", "S3", "none"):
        _disabled(c, f"#ig-pred-{s}", True, aid)
    _words(c, "#ig-warning", ["S1", "09–12", "4.00", "3.58", "승인", "미확정"], aid)
    _hidden(c, "#ig-results", aid)
    for sel in ("#ig-lock", "#ig-go"):
        _disabled(c, sel, True, aid)
    c.page.locator("#ig-edit").click()
    aid = "12.2-3"
    c.eq(_game(c)["bat"], before["bat"], f"{aid} 거부 후 요청 배열 불변")
    c.eq(_game(c)["tests"], 0, f"{aid} 거부는 시험 횟수 안 늘림")
    c.expect(c.page.locator("#ig-bat-row").evaluate("e=>e===document.activeElement"), f"{aid} 해당 행 포커스")
    c.page.locator("#ig-test").click()
    warnings = _approve(c)
    c.eq(len(warnings), 6, f"{aid} 자동 일괄 승인 없이 경고 여섯 건")
    g = _game(c)
    expected = ["S1:3:charge:4", "S1:5:discharge:-1", "S2:3:charge:4",
                "S2:4:charge:4", "S3:3:charge:4", "S3:5:discharge:-1"]
    c.eq([v["key"] for v in g["latestRun"]["corrections"]], expected, f"{aid} 현재 보정 여섯 건과 순서")
    c.eq(g["bat"], B["bat"], f"{aid} 승인 뒤 정수 요청 보존")
    aid = "12.2-4"
    c.eq(g["tests"], 1, f"{aid} 완결 시 시험 한 회")
    c.eq(len(g["history"]), 1, f"{aid} history 하나")
    c.expect(g["firstRun"] is not None, f"{aid} 첫 완료 시험 저장")
    _hidden(c, "#ig-warning", aid)
    _disabled(c, "#ig-lock", False, aid)
    _disabled(c, "#ig-go", True, aid)
    _words(c, "#ig-baseline-result", ["S2", "10.00", "9.48", "기준선 이내"], aid)
    c.check(f"{aid} B 결과")


def t_12_2_b_values(c: Ctx):
    _configure(c)
    _test(c)
    aid = "12.2-5"
    values = {"u": [0, 9.4848, 0, 2.84544], "heat": [0, 6.73114838709677, 0, 2.01934451612903],
              "diesel": [69.4062, 86.313694, 71.8014, 74.9574882],
              "curt": [11.1987484764543, 1.4376, 3.5859484764543, 6.74784393351801],
              "delta": [-4.63157894736842, -6.4, -6.36968421052632, -5.50972631578947]}
    # 평균은 명세 5.3 확률×시나리오 결과의 독립 산술값이다.
    for metric, expected in values.items():
        for s, v in zip(("S1", "S2", "S3", "mean"), expected):
            sel = f'#ig-metric-{metric} [data-ig-s="{s}"]'
            _near(c, float(c.page.locator(sel).get_attribute("data-ig-value")), v, aid, f"{metric}/{s}")
    c.eq(c.page.locator("#ig-results .ig-metric").count(), 5, f"{aid} 전면 지표 정확히 다섯 묶음")
    _words(c, '#ig-metric-u [data-ig-s="S2"]', ["9.48", "MWh", "F3", "6.73", "F4", "2.75"], aid)
    c.expect(c.page.locator('#ig-metric-u [data-ig-s="S2"]').evaluate("e=>!e.closest('details')"), f"{aid} 급전선별 줄 details 밖")
    _words(c, '#ig-metric-u [data-ig-s="mean"]', ["2.85", "MWh"], aid)
    _words(c, '#ig-metric-diesel [data-ig-s="S2"]', ["86.31", "MWh", "CO₂", "64.74", "t"], aid)
    _words(c, '#ig-metric-curt [data-ig-s="S2"]', ["1.44", "MWh"], aid)
    _words(c, '#ig-metric-delta [data-ig-s="S2"]', ["끝", "1.60", "시작", "8.00", "변화", "−6.40", "MWh"], aid)
    _words(c, '#ig-metric-delta [data-ig-s="S3"]', ["1.63", "−6.37"], aid)
    _words(c, "#ig-metric-heat", [LIMITATION, "F4", "F3", "R2", "옳다는 뜻은 아닙니다"], aid)
    for detail in ("ig-detail", "ig-history", "ig-sensitivity"):
        c.eq(c.page.locator(f"#{detail}").evaluate("e=>e.open"), False, f"{aid} 상세 처음 닫힘")
    c.page.locator("#ig-detail summary").click()
    # 명세 4.5·12.2: 필요한 것은 각 부하/발전량 대비 백분율 표시다.
    # '비율'이라는 단어는 고정 문안이 아니므로 단어 단언은 제거하되,
    # 아래 독립 계산값에 %까지 붙여 실제 백분율 표시 검사는 유지한다.
    _words(c, "#ig-detail", ["충전하지 않았다면", "잔량(저장 에너지)"], aid)
    c.expect("SOC 시작" not in _text(c, "#ig-detail"), f"{aid} SOC 대신 잔량 용어")
    _words(c, "#ig-detail", ["F3", "6.73", "F4", "2.75", "87.06", "103.64", "11.90", "3.26",
                             "새", "5", "15", "디젤", "출력 여유", "수산물", "실제"], aid)
    # 분모를 각 급전선 하루 부하로 직접 계산해 표시된 비율에 대조한다.
    load_f3 = .4 * sum(d-1 for d in [6.7,7,9.2,11,12,11.6,9.9,8]) * 3
    load_f4 = .3 * sum(d-1 for d in [6.7,7,9.2,11,12,11.6,9.9,8]) * 3 - 9
    _words(c, "#ig-detail", [f"{100*6.73114838709677/load_f3:.2f}%",
                             f"{100*2.75365161290323/load_f4:.2f}%"], aid)
    c.check(f"{aid} 상세 펼침")


def t_12_2_display_cost(c: Ctx):
    _configure(c, crit=("cost", "fair"))
    _test(c)
    aid = "12.2-6"
    _words(c, "#ig-metric-diesel", ["운영비 지수", "87.06", "103.64", "89.54", "92.53", "돈이나 종합 점수가 아님"], aid)
    c.eq(c.page.locator("#ig-result-bars svg").count(), 1, f"{aid} 비교 SVG 하나")
    _words(c, "#ig-result-bars", ["S1", "S2", "S3"], aid)
    c.eq(c.page.locator("#ig-result-bars svg rect").count(), 3, f"{aid} 미공급 막대 세 개")
    for sel in ("#ig-data h3", "#ig-results h3"):
        _words(c, sel, ["가상 자료"], aid)
    shown = c.page.evaluate("[0,-0.004,0.004].map(KCP.games['s-island-grid'].model.display2)")
    c.eq(shown, ["0.00", "−0.01 미만", "0.01 미만"], f"{aid} 작은 수와 영 표시")
    c.expect(not re.search(r"[−-]0\.00", _text(c, "#ig-results")), f"{aid} 음수 영 없음")


def t_12_3_lock(c: Ctx):
    _configure(c)
    _test(c)
    c.page.locator("#ig-lock").click()
    aid = "12.3-1"
    before = _game(c)
    for row in ("bat", "n", "dr"):
        loc = c.page.locator(f"#ig-{row}-row")
        c.eq(loc.get_attribute("aria-disabled"), "true", f"{aid} {row} 잠금")
        c.eq(loc.get_attribute("tabindex"), "-1", f"{aid} {row} 탭 제외")
        loc.dispatch_event("keydown", {"key": "ArrowUp", "bubbles": True})
    c.eq(_game(c)["bat"], before["bat"], f"{aid} 강제 키 입력에도 배열 불변")
    c.eq(_game(c)["rev"], before["rev"], f"{aid} 강제 키 입력에도 revision 불변")
    for sel in ("#ig-test", "#ig-crit1", "#ig-crit2", "#ig-weight-f1", "#ig-weight-f2",
                "#ig-baseline-s", "#ig-baseline-limit", "#ig-plus", "#ig-minus"):
        _disabled(c, sel, True, aid)
    c.expect(c.page.locator("#ig-principles button").evaluate_all("es=>es.every(e=>e.disabled)"), f"{aid} 원칙 입력 잠금")
    _hidden(c, "#ig-lock", aid)
    c.expect(c.page.locator("#ig-unlock").is_visible(), f"{aid} 해제 버튼 표시")
    _disabled(c, "#ig-go", True, aid)
    c.page.locator("#ig-one-line").fill(LINE)
    _disabled(c, "#ig-go", False, aid)
    c.page.locator("#ig-one-line").fill("")
    _disabled(c, "#ig-go", True, aid)


def t_12_3_questions(c: Ctx):
    _complete_b(c)
    aid = "12.3-2"
    qs = _questions(c)
    c.eq([q["k"] for q in qs], Q_B, f"{aid} B 질문 순서")
    c.eq(len({q["k"] for q in qs}), 7, f"{aid} 질문 k 중복 없음")
    c.expect(all(set(q) == {"k", "tag", "q"} for q in qs), f"{aid} src·rec 없는 질문 객체")
    for word in ("S2", "9.48", "F3", "6.73", "12–15시", "11.90", "디젤을 한 대도 켜 두지 않았습니다"):
        c.expect(word in qs[3]["q"], f"{aid} 정전 질문에 {word}")
    c.page.locator("#ig-go").click()
    cards = c.page.locator(".qdeck .qcard")
    c.expect(6 <= cards.count() <= 9, "C-2 면접 질문 카드 6~9개")
    c.eq(cards.count(), 7, f"{aid} 확정 질문 정확히 일곱 개")
    c.expect("얻는 것과 잃는 것을 한 문장으로" in qs[0]["q"], f"{aid} 공통 1에 얻는 것·잃는 것 한 문장")
    c.expect(all("연습용 질문" in t for t in cards.all_text_contents()), "C-2 모든 카드 연습용 질문 표시")
    c.expect(all("보고서 문항" not in t for t in cards.all_text_contents()), "C-2 보고서 문항 표시 없음")
    c.check("C-2 면접실")


def t_12_3_prediction_miss(c: Ctx):
    _complete_b(c, predict="S1")
    c.eq(_keys(c)[2], "ig-c3-miss", "12.3-2 첫 예측 S1은 불일치 질문")


def t_12_3_first_prediction_stays(c: Ctx):
    aid = "12.3-4"
    _configure(c, predict="S2")
    c.page.locator("#ig-test").click()
    c.page.locator("#ig-edit").click()
    # 첫 시험 누름 후 A로 바꾸어 처음 완결한다. 이후 최신 B와 대조하면 오답.
    for row in ("bat", "n"):
        for b, value in enumerate(A[row]):
            _set_cell(c, row, b, value, aid)
    c.page.locator("#ig-shed-R1").click()
    c.page.locator("#ig-curt-C1").click()
    _test(c, aid)
    c.eq(_game(c)["firstPredict"], "S2", f"{aid} 승인 중 수정해도 첫 예측 보존")
    c.eq(_game(c)["firstRun"]["plan"]["bat"], A["bat"], f"{aid} 처음 완결한 A를 첫 시험으로 저장")
    for row in ("bat", "n"):
        for b, value in enumerate(B[row]):
            _set_cell(c, row, b, value, aid)
    c.page.locator("#ig-shed-R2").click()
    c.page.locator("#ig-curt-C2").click()
    _test(c, aid)
    _lock(c)
    c.eq(_keys(c)[2], "ig-c3-miss", f"{aid} S2 예측은 최신 B가 아닌 첫 A와 대조")
    c.phase("room")
    _words(c, ".recap", ["첫 시험 계획", "충전 3 MW"], aid)


def t_12_3_criteria_cancel(c: Ctx):
    _configure(c)
    _test(c)
    aid = "12.3-4"
    approved = _game(c)["approvals"]
    first = _game(c)["firstRun"]
    rev = _game(c)["rev"]
    c.page.locator("#ig-crit1").select_option("cost")
    c.eq(_game(c)["latestRun"], None, f"{aid} 기준 변경은 최근 시험 무효화")
    c.eq(_game(c)["rev"], rev, f"{aid} 판단 기준 변경은 물리 revision 안 올림")
    c.eq(_game(c)["approvals"], approved, f"{aid} 판단 기준 변경은 승인 보존")
    _disabled(c, "#ig-lock", True, aid)
    _test(c, aid)
    c.page.locator("#ig-baseline-limit").fill("9")
    _hidden(c, "#ig-results", aid)
    _disabled(c, "#ig-lock", True, aid)
    _test(c, aid)
    _lock(c)
    c.eq(_keys(c)[1], "ig-c2-over", f"{aid} 기준선 초과도 확정 허용")
    c.eq(_game(c)["firstRun"], first, f"{aid} 재시험은 첫 완료 결과 보존")
    c.eq(_game(c)["firstPredict"], "S2", f"{aid} 재시험은 첫 예측 보존")


def t_12_3_invalid_locked(c: Ctx):
    _complete_b(c)
    saved = _state(c)
    aid = "12.3-3"
    # 매 사례는 실제 화면으로 만든 원래 유효 저장본에서 시작한다.
    import copy
    cases = [
        ("모델 버전", lambda g: g["locked"].update(modelVersion="old")),
        ("확정 배열", lambda g: g["locked"]["plan"].update(bat=[0]*12)),
        ("첫 시험 없음", lambda g: g.update(firstRun=None)),
        ("보정 전후 값", lambda g: g["locked"]["corrections"][0].update(proposed=3.5)),
        ("승인 로그", lambda g: g.update(correctionLog=[{"key": "잘못된 키"}])),
        ("옛 승인", lambda g: g.update(approvals=[{"key": "rev:0:S1:3", "proposed": 3.584}]))]
    for label, corrupt in cases:
        state = copy.deepcopy(saved)
        corrupt(state["game"])
        _inject(c, state)
        c.eq(_game(c)["locked"], None, f"{aid} {label} 손상은 확정 무효화")
        c.eq(_keys(c), [], f"{aid} {label} 손상은 맞춤 질문 없음")
    state = copy.deepcopy(saved)
    state["game"]["bat"][0] = 4
    _inject(c, state)
    c.eq(_game(c)["bat"][0], 4, f"{aid} 유효 locked와 다른 draft 조용히 안 덮어씀")
    _words(c, "#ig-prep", ["확정 계획을 표시합니다"], aid)
    c.eq(_keys(c), Q_B, f"{aid} 화면과 질문은 유효 확정본 사용")
    c.page.locator("#ig-unlock").click()
    c.eq(_game(c)["bat"], B["bat"], f"{aid} 해제 시 확정본을 draft에 깊은 복사")


def t_12_3_restore(c: Ctx):
    _complete_b(c)
    aid = "12.3-3"
    c.wait_saved(400)
    saved = c.ls(KEY)
    c.expect(saved is not None, f"{aid} 게임 저장됨")
    before = saved["game"]
    c.page.reload()
    c.page.wait_for_selector("#ig-unlock")
    after = _game(c)
    for key in ("bat", "n", "dr", "locked", "oneLine", "tests"):
        c.eq(after[key], before[key], f"{aid} {key} 복원")
    c.eq(len(after["locked"]["corrections"]), 6, f"{aid} 보정 여섯 건 복원")
    c.eq(_keys(c), Q_B, f"{aid} 질문 일곱 개 복원")
    # 불신해야 하는 임의 결과 캐시를 주입. 입력 및 승인 스냅숏은 그대로 둔다.
    saved["game"]["locked"]["results"] = [{"u": 999, "soc": 999}] * 3
    saved["game"]["latestRun"]["u"] = 999
    _inject(c, saved)
    c.eq(_keys(c), Q_B, f"{aid} 임의 결과 숫자가 질문 바꾸지 않음")
    c.phase("room")
    _words(c, ".recap", ["9.48", "1.60"], aid)
    c.expect("999" not in _text(c, ".recap"), f"{aid} 결과 캐시 대신 재계산")


def t_12_3_unlock_reapprove(c: Ctx):
    _complete_b(c)
    aid = "12.3-4"
    c.page.locator("#ig-memo").fill("가상 계획의 분담을 다시 검토한다.")
    c.phase("room")
    c.page.locator('textarea[data-a="0"]').fill("가상 면접 답변을 보존한다.")
    c.phase("prep")
    before = _game(c)
    c.page.locator("#ig-unlock").click()
    after = _game(c)
    c.eq(after["locked"], None, f"{aid} locked 해제")
    c.eq(after["latestRun"], None, f"{aid} latestRun 해제")
    for k in ("bat", "n", "dr", "history", "firstPredict", "firstRun", "approvals"):
        c.eq(after[k], before[k], f"{aid} {k} 보존")
    c.eq(_state(c)["answers"]["0"], "가상 면접 답변을 보존한다.", f"{aid} 기존 답변 보존")
    c.eq(_state(c)["memo"], "가상 계획의 분담을 다시 검토한다.", f"{aid} 공통 메모 보존")
    _disabled(c, "#ig-lock", True, aid)
    _disabled(c, "#ig-go", True, aid)
    _set_cell(c, "n", 5, 1, aid)
    c.eq(_game(c)["rev"], before["rev"]+1, f"{aid} 실제 모형 변경만 revision 증가")
    c.eq(_game(c)["approvals"], before["approvals"], f"{aid} 변경 뒤 승인 목록 보존")
    _hidden(c, "#ig-results", aid)
    c.page.locator("#ig-test").click()
    _words(c, "#ig-warning", ["S1", "15–18", "0.56"], aid)
    # b3은 같은 제안이므로 넘어가고 b5의 같은 키·새 proposed는 재승인.
    c.eq(_game(c)["tests"], 1, f"{aid} 미승인 시험 횟수 불변")
    # 명세 7.2: 입력과 approvals는 공통 state가 아닌 state.game 안에 있다.
    # 명세 5.3·5.4: simulate에는 planSnapshot과 명시적인 승인 검증을 넘긴다.
    preview = c.page.evaluate("""() => {KCP.flush();
      const g=KCP.load('s-island-grid').game,m=KCP.games['s-island-grid'].model;
      return m.simulate(m.planSnapshot(g),'S1',q=>m.approvalMatches(g.approvals,q),{preview:true});}""")
    c.eq(len(preview["rows"])+1, 9, f"{aid} S1 SOC 경계 아홉 점")
    c.eq(preview["provisionalFrom"], 5, f"{aid} 첫 미승인 b5부터 임시")
    c.expect(c.page.locator('#ig-preview-soc svg [stroke-dasharray]').count() > 0, f"{aid} SOC 점선 표시")
    _words(c, "#ig-bat-row", ["확인"], aid)
    _approve(c, aid)
    c.eq(_game(c)["tests"], 2, f"{aid} 새 완결 시험만 횟수 증가")
    # 뒤 구간 변경은 앞선 b3의 제안 승인을 유지한다.
    approvals = _game(c)["approvals"]
    _set_cell(c, "n", 6, 2, aid)
    c.eq(_game(c)["approvals"], approvals, f"{aid} 뒤 구간 수정으로 앞 승인 안 지움")
    _disabled(c, "#ig-lock", True, aid)
    c.check(f"{aid} 미확정 준비실")


def t_12_3_rules_weights_cost(c: Ctx):
    _configure(c)
    _test(c)
    aid = "12.3-5"
    for shed, cut in (("R1", [.903314, 2.980937, 3.974583, 1.625966]),
                      ("R3", [0, 4.064914, 5.419886, 0])):
        c.page.locator(f"#ig-shed-{shed}").click()
        _test(c, aid)
        _words(c, '#ig-metric-u [data-ig-s="S2"]', [f"{v:.2f}" for v in cut], aid)
        _lock(c)
        c.eq(_keys(c)[5], f"ig-r-{shed.lower()}", f"{aid} {shed} 반문")
        c.page.locator("#ig-unlock").click()
    c.page.locator("#ig-shed-R2").click()
    _test(c, aid)
    approved = _game(c)["approvals"]
    c.page.locator("#ig-weight-f1").select_option("4")
    c.page.locator("#ig-weight-f2").select_option("1.2")
    _test(c, aid)
    c.eq(_game(c)["approvals"], approved, f"{aid} 가중치 변경은 물리 승인 보존")
    _near(c, float(c.page.locator('#ig-metric-u [data-ig-s="S2"]').get_attribute("data-ig-value")), 9.4848, aid, "미공급 불변")
    _words(c, '#ig-metric-delta [data-ig-s="S2"]', ["1.60"], aid)
    before = _game(c)
    c.page.locator("#ig-sensitivity summary").click()
    _words(c, "#ig-sensitivity", ["R1", "11.16", "R2", "6.73", "R3", "10.30"], aid)
    c.eq(_game(c), before, f"{aid} 민감도 펼침은 계획·시험·승인 불변")
    _lock(c)
    c.eq(_keys(c)[4], "ig-b-weights", f"{aid} 변경 가중치 질문 우선")
    c.page.locator("#ig-unlock").click()
    c.page.locator("#ig-weight-f1").select_option("3")
    c.page.locator("#ig-weight-f2").select_option("1.5")
    c.page.locator("#ig-crit1").select_option("cost")
    _disabled(c, "#ig-lock", True, aid)
    _test(c, aid)
    _words(c, "#ig-metric-diesel", ["운영비 지수", "92.53"], aid)
    _lock(c)
    c.eq(_keys(c)[4], "ig-b-cost", f"{aid} 비용 기준 질문")


def t_12_3_a_branch(c: Ctx):
    aid = "12.3-6"
    _configure(c, plan=A, crit=("outage", "fair"), shed="R1", curt="C1", baseline=0, predict="none", aid=aid)
    _test(c, aid)
    _lock(c)
    keys = _keys(c)
    c.eq(keys[3:5], ["ig-b-reserve", "ig-b-tomorrow"], f"{aid} A 개별 두 칸 우선순위")
    c.expect("ig-b-outage" not in keys and "ig-b-dcharge" not in keys and "ig-b-curtail" not in keys,
             f"{aid} 조건이 참이어도 추가 질문 만들지 않음")
    c.eq(len(keys), 7, f"{aid} 정확히 일곱 문항")


def t_12_3_boundary(c: Ctx):
    aid = "12.3-7"
    boundary = {"bat": [0]*8, "n": [2, 2, 2, 0, 0, 0, 0, 0], "dr": []}
    _configure(c, plan=boundary, crit=("outage", "fair"), shed="R1", curt="C1", aid=aid)
    _test(c, aid)
    _lock(c)
    keys = _keys(c)
    c.eq(keys[3:5], ["ig-b-outage", "ig-b-curtail"], f"{aid} 대체 질문으로 두 칸 충족")
    c.eq(len(keys), 7, f"{aid} 경계안도 일곱 문항")
    c.expect(all(re.fullmatch(r"ig-[a-z0-9-]+", k) for k in keys), f"{aid} k는 수치·날씨·보정 키 없는 고정 식별자")


def t_12_3_unlocked_bypass(c: Ctx):
    aid = "12.3-8"
    _prep(c)
    c.eq(_keys(c), [], f"{aid} 미확정 질문 없음")
    c.phase("room")
    c.eq(c.page.locator(".qcard").count(), 0, f"{aid} 셸 직접 이동에도 질문 없음")
    _words(c, ".recap", ["아직 확정하지 않음"], aid)
    c.check(f"{aid} 미확정 면접실")
    c.phase("reflect")
    c.page.locator("#skipEx").click()
    c.eq(c.page.locator("#ig-example-a, #ig-example-b, #ig-example-c").count(), 0, f"{aid} 미확정 예시 HTML 없음")
    _words(c, "#exwrap", ["계획을 확정한 뒤"], aid)
    c.check(f"{aid} 미확정 성찰")


def t_12_4_extreme_and_physics(c: Ctx):
    _prep(c)
    # 검산표 기대값은 명세 6.2. Node와 브라우저에 로드된 모형을 각각 검증한다.
    report = c.page.evaluate("""() => {
      const m=KCP.games['s-island-grid'].model;
      const mk=(bat,n,dr,shed,curt)=>({bat,n,dr:Array.from({length:8},(_,b)=>dr.includes(b)),shed,curt,weights:[3,1.5]});
      const ps={Z:mk(Array(8).fill(0),Array(8).fill(0),[],'R1','C1'),
        H:mk(Array(8).fill(4),Array(8).fill(3),[3,4],'R3','C1'),
        A:mk([0,0,0,3,2,0,-2,-2],[3,2,1,1,2,3,3,3],[4,5],'R1','C1'),
        B:mk([-1,-1,0,4,4,-1,-2,-2],[2,2,1,0,0,2,3,3],[4,5],'R2','C2'),
        C:mk([0,0,0,2,0,0,-1,0],[3,2,1,1,1,3,3,3],[4,5],'R3','C1'),
        Bp:mk([-1,-1,0,4,4,-1,-2,-2],[2,2,1,0,1,2,3,3],[4,5],'R2','C2')};
      return Object.fromEntries(Object.entries(ps).map(([k,p])=>{const rs=['S1','S2','S3'].map(s=>m.simulate(p,s,()=>true));
        return [k,{rs,mean:m.expected(rs)}]}));
    }""")
    aid = "12.4-1"
    for name, expected_rows in TOTALS.items():
        for si, expected in enumerate(expected_rows):
            actual = report[name]["rs"][si]
            for field, value in zip(TOTAL_FIELDS, expected):
                if field in ("h", "starts", "corrections"):
                    c.eq(actual[field], value, f"{aid} {name}/S{si+1}/{field}")
                else:
                    _near(c, actual[field], value, aid, f"{name}/S{si+1}/{field}", tolerance=.000000500001)
    for r in report["Z"]["rs"]:
        for key, value in (("diesel", 0), ("ch", 0), ("dis", 0), ("soc", 8)):
            _near(c, r[key], value, aid, f"Z/{key}")
    for r in report["H"]["rs"]:
        _near(c, r["soc"], 16, aid, "H SOC")
    _near(c, report["H"]["rs"][2]["u"], .0624, aid, "H S3 부족은 영 아님")
    _near(c, report["Bp"]["rs"][1]["u"], .4848, aid, "B′ S2")
    for key, value in (("u", .14544), ("diesel", 79.757488), ("co2", 59.818116)):
        _near(c, report["Bp"]["mean"][key], value, aid, f"B′ 평균 {key}")
    aid = "12.4-2"
    violations = []
    for name, item in report.items():
        for si, r in enumerate(item["rs"]):
            for row in r["rows"]:
                b = row["b"]
                ok = (1.6-1e-9 <= row["soc"] <= 16+1e-9 and 0 <= row["ch"] <= 4+1e-9
                      and 0 <= row["dis"] <= 4+1e-9 and row["ch"]*row["dis"] <= 1e-9
                      and abs(row["r"]-row["curt"]+row["dis"]+row["g"]-(row["L"]-row["u"]+row["ch"])) < 1e-9
                      and abs(row["soc"]-(row["before"]+row["ch"]*.95*3-row["dis"]*3/.95)) < 1e-9)
                if not ok:
                    violations.append(f"{name}/S{si+1}/b{b}")
    c.eq(violations, [], f"{aid} 대표 극단 입력의 SOC·전력·효율 보존")


def t_12_4_pending(c: Ctx):
    _prep(c)
    aid = "12.4-3"
    reports = c.page.evaluate("""() => {
      const m=KCP.games['s-island-grid'].model,p={bat:[-1,-1,0,4,4,-1,-2,-2],n:[2,2,1,0,0,2,3,3],
      dr:[false,false,false,false,true,true,false,false],shed:'R2',curt:'C2',weights:[3,1.5]};
      return {first:m.simulate(p,'S2'),next:m.simulate(p,'S2',q=>q.b===3),
        preview:m.simulate(p,'S1',()=>false,{preview:true}),done:m.simulate(p,'S2',()=>true)};
    }""")
    for key, b, ch in (("first", 3, 3.584), ("next", 4, 0)):
        r = reports[key]
        c.eq(r["complete"], False, f"{aid} {key} 미완료")
        c.eq(r["pending"]["b"], b, f"{aid} {key} 중단 구간")
        _near(c, r["pending"]["proposed"], ch, aid, f"{key} 제안")
        c.eq(len(r["rows"]), b, f"{aid} {key} 이후 SOC 안 반환")
        c.expect(not any(k in r for k in ("u", "soc", "heat", "diesel", "curt", "cost")), f"{aid} 미완료 하루 지표 없음")
    c.eq(reports["preview"]["complete"], False, f"{aid} 미리보기 완결 시험 아님")
    c.eq(len(reports["preview"]["rows"]), 8, f"{aid} 미리보기 끝까지 계산")
    c.eq(reports["preview"]["provisionalFrom"], 3, f"{aid} b3부터 임시")
    c.expect("u" not in reports["preview"], f"{aid} 미리보기 하루 결과 없음")
    _near(c, reports["done"]["u"], 9.4848, aid, "승인 뒤 부족 숨기지 않음")


def t_12_4_deep_snapshot(c: Ctx):
    _complete_b(c)
    aid = "12.4-4"
    result = c.page.evaluate("""() => {
      const s=KCP.load('s-island-grid'),g=KCP.games['s-island-grid'];
      const before={q:g.questions(s),r:g.recap(s)};
      s.game.bat[0]=4;s.game.n[4]=3;
      return {same:JSON.stringify(before)===JSON.stringify({q:g.questions(s),r:g.recap(s)}),
        lockedBat:s.game.locked.plan.bat[0],lockedN:s.game.locked.plan.n[4]};
    }""")
    c.eq(result, {"same": True, "lockedBat": -1, "lockedN": 0}, f"{aid} draft 별도 수정에도 질문·recap은 locked 읽음")


def t_12_4_corrupt_storage(c: Ctx):
    aid = "C-4"
    for game in ("손상 문자열", [], {"bat": [99]*8, "n": [-1]*8, "shed": "R9", "weights": [99,99]}):
        errors = len(c.rec["pageerrors"])
        _inject(c, {"phase": "prep", "memo": "가상 메모 유지", "game": game})
        c.expect(c.page.locator("#ig-prep").is_visible(), f"{aid} 손상 game에도 준비실 표시")
        c.eq(len(c.rec["pageerrors"]), errors, f"{aid} 손상 game 복구 페이지 예외 없음")
        c.eq(_state(c)["memo"], "가상 메모 유지", f"{aid} 유효 공통 메모 보존")
    aid = "12.4-5"
    for patch in ({"bat": [0]*12}, {"shed": "INVALID"}, {"weights": [4, 99]}):
        _inject(c, {"game": {"version": 2, "modelVersion": "ig-8-v2", **patch}})
        _words(c, "body", ["저장된 계획 형식이 달라 운영 계획을 초기화했습니다."], aid)
        c.eq(_game(c)["locked"], None, f"{aid} 손상 확정본 무효화")
    # JSON은 NaN을 표현하지 못하므로 외부 입력 정규화 경로도 별도로 검사.
    c.expect(c.page.evaluate("""() => {
      const m=KCP.games['s-island-grid'].model;
      try { m.normalize({version:2,modelVersion:'ig-8-v2',bat:[NaN,0,0,0,0,0,0,0],baseline:{scenario:'S2',limit:NaN}}); return true; }
      catch {return false;}
    }"""), f"{aid} NaN 입력 정규화 예외 없음")
    c.check(f"{aid} 손상 저장 복구")


def t_12_4_xss(c: Ctx):
    _complete_b(c)
    aid = "12.4-5"
    payload = '<img src=x onerror="window.__igXss=1">'
    c.page.evaluate("window.__igXss=0")
    c.page.locator("#ig-one-line").fill(payload)
    c.page.locator("#ig-memo").fill(payload)
    c.phase("room")
    _words(c, ".recap", [payload], aid)
    c.eq(c.page.locator(".recap img").count(), 0, f"{aid} 한 문장은 텍스트로만 표시")
    c.eq(c.page.evaluate("window.__igXss"), 0, f"{aid} 면접 표시 때 코드 실행 없음")
    c.phase("reflect")
    c.page.locator("#before-s-island-grid").fill(payload)
    c.page.locator("#openEx").click()
    c.eq(c.page.evaluate("window.__igXss"), 0, f"{aid} 성찰 열기 때 코드 실행 없음")
    c.wait_saved()
    c.page.reload()
    c.page.wait_for_selector("#before-s-island-grid")
    c.eq(c.page.locator("#before-s-island-grid").input_value(), payload, f"{aid} 기준 문자열 그대로 복원")
    c.eq(c.page.locator("#phase img[src='x']").count(), 0, f"{aid} 입력으로 DOM 이미지 안 생성")
    c.eq(c.page.evaluate("window.__igXss || 0"), 0, f"{aid} 코드 실행 없음")
    c.phase("prep")
    c.eq(c.page.locator("#ig-memo").input_value(), payload, f"{aid} 메모도 텍스트 복원")


def t_12_4_regression_css(c: Ctx):
    aid = "12.4-6"
    c.goto("#y2024", wait="#lock")
    c.expect(c.page.locator("#lock").is_visible(), f"{aid} 2024 확정 버튼 유지")
    c.eq(c.page.locator('[id^="ig-"]').count(), 0, f"{aid} 2024에 신규 DOM 선택자 없음")
    # 기존 수용 검사의 조작 경로로 기반 게임을 실제 확정·해제한다.
    cells = c.page.locator("[data-hex]")
    for i in range(min(cells.count(), 16)):
        cells.nth(i).click()
        if _text(c, "#tcount").startswith("4 /"):
            break
    for _ in range(3):
        c.page.locator("[data-inc]").first.click()
    for i in (0, 1):
        c.page.locator("[data-toggle]").nth(i).click()
    c.page.locator("#sim").click()
    c.page.locator("#lock").click()
    c.expect(c.page.locator("#unlock").is_visible(), f"{aid} 2024 해제 버튼 유지")
    c.page.locator("#unlock").click()
    c.expect(c.page.locator("#lock").is_visible(), f"{aid} 2024 재편집")
    c.goto("#y2026", wait="#score")
    c.eq(c.page.locator("#score select").count(), 20, f"{aid} 2026 평가판 유지")
    for tab in c.page.locator("[data-tab]").all():
        tab.click()
    c.eq(c.page.locator('[id^="ig-"]').count(), 0, f"{aid} 2026 자료 탭에 신규 DOM 없음")
    _prep(c)
    css = c.page.evaluate("""() => {
      const sheet=[...document.styleSheets].find(s=>(s.href||'').endsWith('/games/s-island-grid.css'));
      if(!sheet)return {present:false,bad:[]};
      const bad=[];
      const visit=rs=>{for(const r of rs){if(r.selectorText){for(const s of r.selectorText.split(','))
        if(!/^[.#]ig-/.test(s.trim()))bad.push(s.trim());}else if(r.cssRules)visit(r.cssRules);}};
      visit(sheet.cssRules);return {present:true,bad};
    }""")
    if css["present"]:  # 별도 CSS는 명세상 선택적이다.
        c.eq(css["bad"], [], f"{aid} 모든 신규 CSS 선택자 접두어")
    syntax = c.page.evaluate("""async () => {
      const u=new URL('games/s-island-grid.js',new URL('.',location.href));
      const source=await (await fetch(u)).text();
      try {new Function(source);return true;} catch {return false;}
    }""")
    c.expect(syntax, f"{aid} 게임 JavaScript 구문 유효")


def t_12_5_reflect_gate(c: Ctx):
    _complete_b(c)
    c.phase("reflect")
    aid = "12.5-1"
    _hidden(c, "#exwrap", aid)
    for size in (0, 9):
        c.page.locator("#before-s-island-grid").fill("가"*size)
        _disabled(c, "#openEx", True, aid)
    c.page.locator("#before-s-island-grid").fill("공급 안정과 지역 부담을 함께 보았다")
    _disabled(c, "#openEx", False, aid)
    c.page.locator("#openEx").click()
    c.expect(c.page.locator("#exwrap").is_visible(), "C-3 기준 10자 이상 입력 뒤 공통 성찰 내용 표시")
    c.expect(c.page.locator("#ig-example-a").is_visible(), f"{aid} A 예시 표시")
    c.eq(c.page.locator("#ig-reflect textarea, #ig-reflect button").count(), 0, f"{aid} 게임 추가 입력·관문 없음")
    c.expect(not c.page.evaluate("typeof KCP.games['s-island-grid'].afterReflect==='function'"), f"{aid} 게임 afterReflect 없음")
    _words(c, 'section.panel:has(#rsum) h3', ["연습용 평가 기준"], "C-3")
    c.eq(c.page.locator("#phase h3").filter(has_text="설계 의도").count(), 1, "C-3 설계 의도 머리")
    c.check("C-3 성찰")
    aid = "12.5-2"
    expected = ["ig-example-a", "ig-example-b", "ig-example-c", "ig-science", "ig-limits", "ig-values"]
    c.eq(c.page.locator("#ig-reflect details.reveal.ig-reveal").evaluate_all("es=>es.map(e=>e.id)"), expected,
         f"{aid} 같은 형식의 예시·해설 고정 순서")
    for ident in expected:
        detail = c.page.locator(f"#{ident}")
        summary = detail.locator("summary")
        c.eq(detail.evaluate("e=>e.open"), False, f"{aid} {ident} 처음 닫힘")
        summary.focus()
        summary.press("Enter")
        c.eq(detail.evaluate("e=>e.open"), True, f"{aid} {ident} Enter로 열기")
        summary.press("Space")
        c.eq(detail.evaluate("e=>e.open"), False, f"{aid} {ident} Space로 닫기")
    c.page.locator("#ig-values summary").click()
    _words(c, "#ig-values", ["2.85", "0.15", "74.96", "79.76", "56.22", "59.82"], "12.4-1")
    for ident, words in (("ig-example-a", ["계획 A · 구간별 요청", "충전 3 MW"]),
                         ("ig-example-b", ["계획 B · 구간별 요청", "11.90", "1.23"]),
                         ("ig-example-c", ["계획 C · 구간별 요청", "방전 1 MW"]),
                         ("ig-limits", ["1.23", "순환 정전", "필수 부하", "전날 밤 가동 대수를 0기"]),
                         ("ig-science", ["5.76×10¹⁰", "5.9만 톤"])):
        text = c.page.locator(f"#{ident}").text_content()
        for word in words:
            c.expect(word in text, f"{aid} {ident}에 {word!r}")
    c.eq(c.page.locator("#ig-reflect table.ig-table").count(), 3, f"{aid} 예시마다 계획 표 하나")
    c.wait_saved()
    saved = c.ls(KEY)
    c.eq(saved["compare"]["open"], True, f"{aid} 공통 compare에 열림 저장")
    c.expect(not any(k in saved["game"] for k in ("compare", "before", "afterReflect")), f"{aid} 게임에 관문 상태 중복 없음")
    c.page.reload()
    c.page.wait_for_selector("#ig-example-a")
    c.expect(c.page.locator("#exwrap").is_visible(), f"{aid} 공통 예시 열림 복원")
    c.eq(c.page.locator("#before-s-island-grid").input_value(), saved["compare"]["before"], f"{aid} 기준 문장 복원")
    c.check(f"{aid} 해설 복원")


def t_12_5_skip_gate(c: Ctx):
    _complete_b(c)
    c.phase("reflect")
    c.page.locator("#skipEx").click()
    c.expect(c.page.locator("#ig-example-a").is_visible(), "12.5-1 시연용 공통 우회 뒤 추가 관문 없음")


def t_12_5_visual(c: Ctx):
    _configure(c)
    aid = "12.5-3"
    # harness가 각 검사에 네 환경의 새 context를 제공한다.
    for selector in ("#ig-timeline-help", "#ig-weight-help", "#ig-data h3 .tag-mine"):
        ratio = c.contrast(selector)
        c.expect(ratio is not None and ratio >= 4.5, f"{aid} {selector} 실제 배경 대비 4.5 이상: {ratio}")
    c.page.locator("#ig-test").click()
    c.expect(c.contrast("#ig-warning") >= 4.5, f"{aid} 보정 경고 대비")
    c.page.emulate_media(color_scheme="dark" if c.cfg.scheme == "light" else "light")
    c.expect(c.page.locator("#ig-warning").is_visible(), f"{aid} 테마 전환 뒤 경고 유지")
    c.expect(c.contrast("#ig-warning") >= 4.5, f"{aid} 전환 테마 경고 대비")
    c.expect(c.page.locator("#ig-hatch").count() > 0, f"{aid} 전환 테마 빗금 유지")
    c.page.emulate_media(color_scheme=c.cfg.scheme, reduced_motion="reduce")
    marks = c.page.locator("#ig-bat-row .ig-cell").evaluate_all("""es=>es.filter(e=>/한도|확인/.test(e.textContent))
      .map(e=>{const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),sizes=[];
        while(w.nextNode())if(/한도|확인/.test(w.currentNode.textContent))sizes.push(parseFloat(getComputedStyle(w.currentNode.parentElement).fontSize));
        return {html:!e.closest('svg'),sizes};})""")
    c.expect(bool(marks) and all(m["html"] and m["sizes"] and min(m["sizes"]) >= 12 for m in marks),
             "12.1-5 한도·확인은 HTML 칸에서 12px 이상")
    c.eq(c.page.locator("#ig-bat-row svg text").filter(has_text=re.compile("한도|확인")).count(), 0,
         "12.1-5 상태 문구를 SVG text로 그리지 않음")
    c.expect(c.page.locator("#ig-hatch").count() > 0, f"{aid} 잔량 제한 빗금 패턴")
    _approve(c)
    for detail in ("ig-detail", "ig-history", "ig-sensitivity"):
        c.page.locator(f"#{detail} summary").click()
    for selector in ("#ig-metric-heat", "#ig-detail", "#ig-baseline-result"):
        ratio = c.contrast(selector)
        c.expect(ratio is not None and ratio >= 4.5, f"{aid} 결과 본문 대비: {selector}")
    svg_labels = c.page.locator('#ig-prep svg').evaluate_all("es=>es.map(e=>({role:e.getAttribute('role'),label:e.getAttribute('aria-label')}))")
    c.expect(all(v["role"] == "img" and v["label"] for v in svg_labels), f"{aid} 모든 그래프 접근성 이름")
    if c.cfg.mobile:
        c.expect(c.page.locator("#ig-prep table").evaluate_all("""es=>es.filter(e=>e.getBoundingClientRect().height)
          .every(e=>[...e.rows].every(r=>[...r.cells].reduce((n,c)=>n+c.colSpan,0)<=4))"""), f"{aid} 모바일 표 최대 네 열")
    # 실제 글자/수치가 내부 overflow에 숨겨지는 경우도 문서 가로 스크롤과 별도 확인.
    clipped = c.page.locator("#ig-prep p, #ig-prep button, #ig-prep dd, #ig-prep td").evaluate_all("""es=>es.filter(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return r.width&&r.height&&((e.scrollWidth>e.clientWidth+1&&['hidden','clip'].includes(s.overflowX))||
        (e.scrollHeight>e.clientHeight+1&&['hidden','clip'].includes(s.overflowY)));
    }).map(e=>e.id||e.textContent.slice(0,50))""")
    c.eq(clipped, [], f"{aid} 수치·버튼·힌트 잘림 없음")
    result_text = _text(c, "#ig-results").replace("돈이나 종합 점수가 아님", "")
    c.expect(not re.search("종합 점수|순위|합격|추천 정답|최적 운영 인증", result_text), f"{aid} 평가 결론·순위 없음")
    c.check(f"{aid} 준비실 전체 상세")
    # focus-visible의 실제 윤곽과 strip 밑 가림을 검사한다.
    row = _cell(c, "bat", 4)
    row.press("Tab")
    c.page.keyboard.press("Shift+Tab")
    focus = row.evaluate("""e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),strip=document.querySelector('#strip');
      return {width:parseFloat(s.outlineWidth),style:s.outlineStyle,top:r.top,bottom:strip?.getBoundingClientRect().bottom||0};}""")
    c.expect(focus["width"] >= 2 and focus["style"] != "none", f"{aid} 키보드 포커스 윤곽 2px")
    c.expect(focus["top"] >= focus["bottom"]-1, f"{aid} sticky 띠가 포커스 안 가림")
    _lock(c)
    c.phase("room")
    c.check(f"{aid} 면접실")
    c.phase("reflect")
    c.page.locator("#skipEx").click()
    for summary in c.page.locator("#ig-reflect summary").all():
        summary.click()
    _words(c, "#ig-reflect", [LIMITATION], aid)
    c.check(f"{aid} 성찰 전체 해설")


if __name__ == "__main__":
    main(globals())
