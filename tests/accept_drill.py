"""T4 계약에 따른 독립 수용 검사. 구현을 읽지 않고 작성했다.

실행 주소와 네 환경, 새 컨텍스트, 콘솔/페이지 오류 수집은 harness가 맡는다.
E24는 실행 시 제공되는 자산의 금지 패턴/CSS와 브라우저 JS 구문을 검사한다.
Node의 --check 및 원본 baseline.py 전체 실행(E25)은 헤드의 별도 검사다.
"""

from harness import Ctx, main


DRILL_KEY = "kcp:v1:x:drill"
GOAL_KEY = "kcp:v1:x:goal"
SETTINGS_KEY = "kcp:v1:x:settings"
IDS = ("planet", "heat", "island", "battery", "carbontax", "roadmap")
NAMES = {
    "planet": "테라-3 첫 정착지 주 전력원",
    "heat": "폭염 순환 단전 순서",
    "island": "소라섬 에너지 예산 100",
    "battery": "폐배터리 재활용 시설 입지",
    "carbontax": "탄소세 수입 사용처 공청회",
    "roadmap": "20년 에너지 전환 순서",
}
CRIT_PLAIN = "제가 판단 기준으로 삼은 것은 출력 안정성, 건설 기간입니다."
CRIT_WEIGHTED = (
    "제가 판단 기준으로 삼은 것은 출력 안정성, 건설 기간이고, "
    "출력 안정성을 가장 무겁게 두었습니다."
)
TRADE = "소형 원자로는 출력 안정성 면에서 유리하지만 건설 기간 면에서는 불리합니다."


def _visible(c, selector):
    loc = c.page.locator(selector).first
    loc.wait_for(state="visible")
    return loc


def _attached(c, selector):
    loc = c.page.locator(selector)
    loc.wait_for(state="attached")
    return loc


def _text(c, selector):
    return _visible(c, selector).inner_text().strip()


def _hidden(c, selector, criterion):
    c.expect(_attached(c, selector).is_hidden(), f"{criterion} {selector}는 숨겨진다")


def _wait_step(c, step, criterion):
    _visible(c, "#dr-body h3")
    c.page.wait_for_function(
        "s => document.querySelector('#dr-body h3').textContent.trim().startsWith(s + ' ')",
        arg=step,
    )
    c.expect(
        _text(c, "#dr-steps li[aria-current='step']").startswith(f"{step} "),
        f"{criterion} 현재 단계는 {step}단계다",
    )
    c.check(f"{criterion} {step}단계")


def _run(c, scenario, criterion):
    c.goto(f"#drill/{scenario}", wait="#dr-run")
    _visible(c, "#dr-body h3")
    c.check(f"{criterion} {scenario} 진행 화면")


def _next(c, step, criterion):
    _visible(c, "#dr-next").click()
    _wait_step(c, step, criterion)


def _to_trade(c, scenario, criterion):
    _run(c, scenario, criterion)
    _wait_step(c, 1, criterion)
    _next(c, 2, criterion)
    _visible(c, "[data-dchip]").first.click()
    _next(c, 3, criterion)


def _planet_trade(c, criterion):
    _run(c, "planet", criterion)
    _next(c, 2, criterion)
    _visible(c, "[data-dchip='출력 안정성']").click()
    _visible(c, "[data-dchip='건설 기간']").click()
    _visible(c, "[data-dw='0'][data-dwv='3']").click()
    _visible(c, "[data-dw='1'][data-dwv='2']").click()
    _next(c, 3, criterion)
    _visible(c, "[data-dopt='smr']").click()
    _visible(c, "#dr-gain").select_option(label="출력 안정성")
    _visible(c, "#dr-cost").select_option(label="건설 기간")


def _planet_summary(c, criterion):
    _planet_trade(c, criterion)
    _next(c, 4, criterion)
    _visible(c, "[data-dstance='revise']").click()
    _visible(c, "#dr-rv").fill("지진 대비 설계를 확인한 뒤 결정하겠습니다.")
    _next(c, 5, criterion)


def _saved(c, key, criterion):
    c.wait_saved(400)
    value = c.ls(key)
    c.expect(isinstance(value, dict), f"{criterion} {key}에 JSON 객체가 저장된다")
    return value if isinstance(value, dict) else {}


def _contrast(c, selector, criterion):
    _visible(c, selector)
    ratio = c.contrast(selector)
    c.expect(ratio is not None and ratio >= 4.5, f"{criterion} {selector} 글자 대비는 4.5 이상이다")


def _finish(c, criterion, goal=""):
    _planet_summary(c, criterion)
    if goal:
        _visible(c, "#dr-nextgoal").fill(goal)
    _visible(c, "#dr-finish").click()
    _visible(c, "#dr-after")
    c.check(f"{criterion} 마친 화면")


def _say(c, selector, rec, criterion):
    button = _visible(c, f"{selector} .speak-go")
    button.click()
    display = _text(c, f"{selector} .speak-t")
    c.eq(display.split(" · 권장 ")[-1], rec, f"{criterion} 말해 보기 권장은 {rec}이다")
    c.expect("20초" not in display and "1분" not in display,
             f"{criterion} 말해 보기 권장에 근거 없는 시간 수치가 없다")
    c.eq(button.get_attribute("aria-pressed"), "true", f"{criterion} 말하기 중 눌림 상태를 드러낸다")
    return button


def t_E1_home_entry(c: Ctx):
    c.goto("#home", wait="a.dr-entry")
    c.eq(c.page.locator("a.dr-entry").count(), 1, "E1 홈 진입 링크는 하나다")
    c.eq(c.page.locator("#home-slot > a.dr-entry[href='#drill']").count(), 1,
         "E1 홈 슬롯에 진입 링크를 덧붙인다")
    text = _text(c, "a.dr-entry")
    for word in ("짧은 판단 훈련장", "연습용 문항", "목표 8분"):
        c.expect(word in text, f"E1 홈 진입 링크에 {word}를 표시한다")
    c.eq(c.page.locator(".pkg").count(), 5, "E1 기존 기출 카드는 다섯 개다")
    c.eq(c.page.locator("a.dr-entry .pkg, a.dr-entry .chip.accent").count(), 0,
         "E1 진입 링크는 기존 카드 선택자와 겹치지 않는다")
    c.expect("형식 바꾸기" not in text and "분량" not in text,
             "E1 홈 진입 글에 금지된 형식 표현과 분량 추정이 없다")
    c.eq(_text(c, "a.dr-entry .dr-entry-d"),
         "겉모습이 다른 짧은 가상 과제에 같은 절차(기준 → 얻고 잃는 것 → 반문)를 적용해 봅니다.",
         "E1 홈 안내 문구가 계약과 같다")
    c.check("E1 홈")


def t_E2_lobby_focus(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    c.expect(_text(c, "#dr-title").startswith("짧은 판단 훈련장"), "E2 로비 제목을 표시한다")
    c.eq(c.page.title(), "짧은 판단 훈련장 · 켄텍 창의성 면접 연습실", "E2 문서 제목이 계약과 같다")
    notice = c.page.get_by_text("대학의 출제 경향을 예측한 문제가 아닙니다.", exact=True)
    notice.wait_for(state="visible")
    c.expect(notice.is_visible(),
             "E2 로비에서 출제 예측이 아니라는 안내가 보인다")
    c.eq(c.page.locator("#dr-lobby .dr-card").count(), 6, "E2 로비 카드는 여섯 개다")
    c.eq(c.page.locator("#dr-lobby a[href^='#ys-']").count(), 0,
         "E2 훈련장 로비에 창작 쟁점 게임 목록을 넣지 않는다")
    c.eq(c.page.locator("#dr-lobby .dr-count").all_text_contents(), ["해 본 횟수 0"] * 6,
         "E2 새 컨텍스트의 시나리오 횟수는 모두 0이다")
    c.eq(c.page.locator("#dr-resume-box").count(), 0, "E2 새 컨텍스트에는 이어 하기 상자가 없다")
    _hidden(c, "#dr-clear-confirm", "E2")
    c.eq(c.page.locator("[data-dfocus][aria-pressed='true']").count(), 1, "E2 범위 하나만 눌린다")
    c.eq(c.page.locator("[data-dfocus][aria-pressed='true']").get_attribute("data-dfocus"),
         "all", "E2 기본 범위는 전체 흐름이다")
    _visible(c, "[data-dfocus='crit']").click()
    c.eq(c.page.locator("[data-dfocus][aria-pressed='true']").count(), 1, "E2 범위 변경 후 하나만 눌린다")
    c.eq(c.page.locator("[data-dfocus][aria-pressed='true']").get_attribute("data-dfocus"),
         "crit", "E2 기준만 범위를 선택한다")
    c.eq(_saved(c, DRILL_KEY, "E2").get("focus"), "crit", "E2 선택 범위가 저장된다")
    c.page.reload()
    _visible(c, "#dr-lobby [data-dfocus='crit']")
    c.eq(c.page.locator("[data-dfocus='crit']").get_attribute("aria-pressed"), "true",
         "E2 새로고침 뒤에도 기준만 범위가 눌린다")
    c.check("E2 로비")


def t_E3_data_contract(c: Ctx):
    data = c.page.evaluate("KCP.DRILLS")
    c.expect(isinstance(data, list), "E3 시나리오 데이터는 배열이다")
    if not isinstance(data, list):
        return
    c.eq([d.get("id") for d in data], list(IDS), "E3 시나리오 순서와 식별자가 계약과 같다")
    c.eq([len(d.get("options", [])) for d in data], [4, 4, 4, 3, 3, 3], "E3 옵션 수가 계약과 같다")
    for d in data:
        ident = d.get("id", "?")
        options = d.get("options", [])
        c.eq(d.get("title"), NAMES.get(ident), f"E3 {ident} 제목이 계약과 같다")
        sources = {
            "task": d.get("task", ""), "setup": " ".join(d.get("setup", [])),
            "table": " ".join(str(x) for row in d.get("table", {}).get("rows", []) for x in row.get("cells", [])),
            "card": " ".join(o.get("d", "") for o in options),
            "quote": " ".join(q.get("say", "") for q in d.get("quotes", [])),
        }
        c.eq(len(d.get("comp", [])), 2, f"E3 {ident} 과제 파악 문항은 두 개다")
        for item in d.get("comp", []):
            c.eq(len(item.get("choices", [])), 3, f"E3 {ident} 과제 파악 선택지는 세 개다")
            answer = item.get("answer")
            c.expect(type(answer) is int and 0 <= answer < 3, f"E3 {ident} 정답 인덱스가 유효하다")
            quote = item.get("quote")
            c.expect(isinstance(quote, str) and bool(quote) and quote in sources.get(item.get("where"), ""),
                     f"E3 {ident} 인용이 지정된 자료 위치에 그대로 있다")
        pb = d.get("samplePb", [])
        c.expect(bool(pb) and all(type(i) is int and 0 <= i < len(d.get("pushbacks", [])) for i in pb),
                 f"E3 {ident} 가상의 답에 맞는 반문 번호가 유효하다")
        if d.get("kind") == "rank":
            c.eq(len(d.get("rankLabels", [])), len(options), f"E3 {ident} 순서 라벨 수가 옵션 수와 같다")
        if d.get("view") == "table":
            table = d.get("table", {})
            c.eq(sorted(r.get("opt") for r in table.get("rows", [])), sorted(o.get("id") for o in options),
                 f"E3 {ident} 표 행과 옵션의 식별자가 같다")
            c.expect(all(len(r.get("cells", [])) == len(table.get("cols", [])) - 1 for r in table.get("rows", [])),
                     f"E3 {ident} 자료 표의 칸 수가 맞다")
        note = d.get("teacherNote", "")
        c.expect(bool(note.strip()) and "성취기준" not in note and "10통과" not in note,
                 f"E3 {ident} 교사용 메모는 개념만 담는다")
    by_id = {d["id"]: d for d in data}
    if "battery" in by_id:
        c.eq([o["n"] for o in by_id["battery"]["options"]], ["가 후보지", "나 후보지", "다 후보지"],
             "E3 배터리 후보지 이름이 계약과 같다")
    if "planet" in by_id:
        rows = {r["opt"]: " ".join(r["cells"]) for r in by_id["planet"]["table"]["rows"]}
        c.expect("방사성 물질" in rows.get("smr", ""), "E3 소형 원자로 자료에 방사성 물질 위험이 있다")
        c.expect("충돌" in rows.get("wind", ""), "E3 풍력 자료에 생물 충돌 위험이 있다")


def t_E4_comp_order(c: Ctx):
    for ident in IDS:
        _run(c, ident, "E4")
        before = []
        for k in range(2):
            _visible(c, f"input[name='dr-c{k}']").first
            values = c.page.locator(f"input[name='dr-c{k}']").evaluate_all("els => els.map(e => e.value)")
            r = (sum(ord(ch) for ch in ident) + k) % 3
            c.eq(values, [str((i + r) % 3) for i in range(3)], f"E4 {ident} 문항 {k}는 정해진 순환 순서다")
            before.append(values)
        c.expect(any(values[0] != "0" for values in before), f"E4 {ident} 정답이 첫 자리에만 몰리지 않는다")
        c.page.reload()
        _visible(c, "#dr-run input[name='dr-c0']").first
        after = [c.page.locator(f"input[name='dr-c{k}']").evaluate_all("els => els.map(e => e.value)") for k in range(2)]
        c.eq(after, before, f"E4 {ident} 새로고침 뒤 선택지 순서가 같다")
        c.check(f"E4 {ident} 과제 파악")


def t_E5_comp_feedback(c: Ctx):
    _run(c, "planet", "E5")
    _hidden(c, "#dr-prev", "E5")
    _visible(c, "input[name='dr-c0'][value='0']").check()
    c.eq(_text(c, "#dr-fb-0"), "맞습니다. 과제 문장의 「주 전력원 하나를 고르고」 부분입니다.",
         "E5 첫 문항 정답 피드백이 계약과 같다")
    _visible(c, "input[name='dr-c1'][value='1']").check()
    c.eq(_text(c, "#dr-fb-1"), "다시 보세요. 상황 설명에서 「밤도 두 배로 길다」 부분을 찾아보세요.",
         "E5 둘째 문항 오답 피드백이 계약과 같다")
    _visible(c, "input[name='dr-c1'][value='0']").check()
    c.eq(_text(c, "#dr-fb-1"), "맞습니다. 상황 설명의 「밤도 두 배로 길다」 부분입니다.",
         "E5 다시 고르면 정답 피드백을 표시한다")
    _saved(c, DRILL_KEY, "E5")
    c.page.reload()
    _visible(c, "#dr-fb-0")
    c.expect(c.page.locator("#dr-c0-0").is_checked() and c.page.locator("#dr-c1-0").is_checked(),
             "E5 새로고침 뒤 과제 파악 선택이 복원된다")
    c.eq(_text(c, "#dr-fb-1"), "맞습니다. 상황 설명의 「밤도 두 배로 길다」 부분입니다.",
         "E5 새로고침 뒤 피드백이 복원된다")
    _next(c, 2, "E5")
    c.expect(c.page.evaluate("document.activeElement === document.querySelector('#dr-body h3')"),
             "E5 단계 이동 뒤 새 단계 제목에 포커스한다")


def t_E6_criteria_weights(c: Ctx):
    _run(c, "planet", "E6")
    _next(c, 2, "E6")
    c.expect(c.page.locator("#dr-next").is_disabled(), "E6 기준이 없으면 다음이 비활성이다")
    _hidden(c, "#dr-cwhint", "E6")
    for name in ("출력 안정성", "건설 기간"):
        _visible(c, f"[data-dchip='{name}']").click()
        c.eq(c.page.locator(f"[data-dchip='{name}']").get_attribute("aria-pressed"), "true",
             f"E6 {name} 기준 칩이 눌린다")
    c.eq(_text(c, "#dr-csent"), CRIT_PLAIN, "E6 미정 무게의 기준 문장이 계약과 같다")
    c.expect(c.page.locator("#dr-cwhint").is_visible(), "E6 두 기준의 무게가 미정이면 안내가 보인다")
    c.eq(c.page.locator("#dr-clist [data-dw][aria-pressed='true']").count(), 0,
         "E6 새 기준 무게는 미정이다")
    _visible(c, "[data-dw='0'][data-dwv='3']").click()
    _visible(c, "[data-dw='1'][data-dwv='2']").click()
    c.eq(_text(c, "#dr-csent"), CRIT_WEIGHTED, "E6 무게를 정한 기준 문장이 계약과 같다")
    _hidden(c, "#dr-cwhint", "E6")
    _visible(c, "[data-dchip='초기 비용']").click()
    _visible(c, "[data-dchip='안전']").click()
    c.eq(c.page.locator("#dr-clist li").count(), 3, "E6 기준은 세 개를 넘지 않는다")
    c.eq(c.page.locator("[data-dchip='안전']").get_attribute("aria-pressed"), "false",
         "E6 네 번째 칩은 선택되지 않는다")
    _visible(c, "[data-dchip='초기 비용']").click()
    c.eq(c.page.locator("#dr-clist li").count(), 2, "E6 다시 누른 기준을 뺀다")
    c.expect(c.page.locator("#dr-next").is_enabled(), "E6 기준이 있으면 다음이 활성이다")
    _visible(c, "#dr-speak-c .speak-go")
    c.check("E6 기준과 무게")


def t_E7_pick_trade(c: Ctx):
    _run(c, "planet", "E7")
    _next(c, 2, "E7")
    for name in ("출력 안정성", "건설 기간"):
        _visible(c, f"[data-dchip='{name}']").click()
    _next(c, 3, "E7")
    c.expect(c.page.locator("#dr-next").is_disabled(), "E7 고르기 전에는 다음이 비활성이다")
    _hidden(c, "#dr-gain-x", "E7")
    _hidden(c, "#dr-cost-x", "E7")
    _visible(c, "[data-dopt='smr']").click()
    c.eq(c.page.locator("[data-dopt][aria-pressed='true']").count(), 1, "E7 후보는 하나만 눌린다")
    c.eq(c.page.locator("[data-dopt='smr']").get_attribute("aria-pressed"), "true", "E7 소형 원자로가 눌린다")
    c.expect(c.page.locator("[data-dopt]:not([data-dopt='smr'])").evaluate_all(
        "els => els.every(e => e.getAttribute('aria-pressed') === 'false')"), "E7 다른 후보는 모두 눌리지 않는다")
    c.eq(_text(c, "#dr-picked"), "고른 것: 소형 원자로", "E7 고른 후보 이름을 표시한다")
    _visible(c, "#dr-gain").select_option(label="출력 안정성")
    _visible(c, "#dr-cost").select_option(label="건설 기간")
    c.eq(_text(c, "#dr-tsent"), TRADE, "E7 얻고 잃는 것 문장이 계약과 같다")
    c.expect("대가" not in _text(c, "#dr-tsent"), "E7 문장에 금지 용어가 없다")
    _visible(c, "#dr-cost").select_option("__other")
    _visible(c, "#dr-cost-x").fill("안전")
    c.eq(_text(c, "#dr-tsent"), "소형 원자로는 출력 안정성 면에서 유리하지만 안전 면에서는 불리합니다.",
         "E7 직접 적은 기준으로 문장을 바꾼다")
    _visible(c, "#dr-why").fill("지진 대비 설계를 전제로")
    c.expect(_text(c, "#dr-tsent").endswith(" 이유: 지진 대비 설계를 전제로"), "E7 고른 이유를 문장 뒤에 붙인다")
    c.check("E7 선택과 얻고 잃는 것")


def t_E8_pushback(c: Ctx):
    _planet_trade(c, "E8")
    _next(c, 4, "E8")
    c.eq(c.page.locator(".dr-sample").count(), 0, "E8 전체 흐름에는 가상의 학생 답을 만들지 않는다")
    c.expect("소형 원자로" in _text(c, "#dr-myans"), "E8 반문 단계에 내 답을 보여 준다")
    _hidden(c, "#dr-hinttext", "E8")
    _hidden(c, "#dr-rv-wrap", "E8")
    _hidden(c, "#dr-rv", "E8")
    _visible(c, "#dr-hint").click()
    _visible(c, "#dr-hinttext")
    c.eq(c.page.locator("#dr-hint").get_attribute("aria-expanded"), "true", "E8 힌트 열림을 드러낸다")
    _visible(c, "[data-dstance='revise']").click()
    c.eq(c.page.locator("[data-dstance='revise']").get_attribute("aria-pressed"), "true", "E8 고치기를 선택한다")
    c.eq(_text(c, "label[for='dr-rv']"), "고친 답", "E8 수정 입력의 라벨이 계약과 같다")
    c.expect(c.page.evaluate("KCP.STARTERS.revise[0]") in _text(c, "#dr-starters"), "E8 말 시작 예시는 힌트로 보인다")
    c.eq(_visible(c, "#dr-rv").input_value(), "", "E8 말 시작 예시를 답 입력칸에 넣지 않는다")
    _visible(c, "#dr-rv").fill("지진 대비 설계를 먼저 확인하겠습니다.")
    state = _saved(c, DRILL_KEY, "E8").get("cur", {})
    c.eq(state.get("rv"), "지진 대비 설계를 먼저 확인하겠습니다.", "E8 쓴 답이 저장된다")
    c.page.reload()
    _visible(c, "#dr-hinttext")
    c.eq(c.page.locator("#dr-hint").get_attribute("aria-expanded"), "true", "E8 복원 뒤 힌트가 열린 상태다")
    c.eq(_visible(c, "#dr-rv").input_value(), "지진 대비 설계를 먼저 확인하겠습니다.", "E8 쓴 답이 복원된다")
    c.check("E8 반문")


def t_E9_finish_copy(c: Ctx):
    _planet_summary(c, "E9")
    _hidden(c, "#dr-next", "E9")
    _hidden(c, "#dr-after", "E9")
    summary = _text(c, ".dr-sum")
    c.expect("제가 판단 기준으로 삼은 것은" in summary and "소형 원자로는" in summary,
             "E9 정리에 기준과 선택 문장이 있다")
    _visible(c, "[data-dsaid='c']").click()
    c.eq(c.page.locator("[data-dsaid='c']").get_attribute("aria-pressed"), "true", "E9 말로 해 본 기준을 표시한다")
    _visible(c, "#dr-nextgoal").fill("기준을 먼저 말한다")
    _visible(c, "#dr-finish").click()
    _visible(c, "#dr-after")
    state = _saved(c, DRILL_KEY, "E9")
    c.eq(len(state.get("runs", [])), 1, "E9 마친 기록 하나가 저장된다")
    c.eq(state.get("cur"), None, "E9 마치면 진행 중 기록은 비운다")
    if state.get("runs"):
        run = state["runs"][0]
        c.eq(run.get("id"), "planet", "E9 마친 시나리오 식별자가 맞다")
        c.eq(run.get("crit"), [{"n": "출력 안정성", "w": 3}, {"n": "건설 기간", "w": 2}],
             "E9 기준과 무게가 마친 기록에 남는다")
        c.eq(run.get("pick"), "smr", "E9 선택이 마친 기록에 남는다")
        c.expect(run.get("said", {}).get("c") is True, "E9 말로 해 본 항목이 기록에 남는다")
    c.wait_saved(400)
    goal = c.ls(GOAL_KEY) or {}
    for key, value in {"text": "기준을 먼저 말한다", "src": "drill",
                       "title": "짧은 판단 훈련장 · 테라-3 첫 정착지 주 전력원"}.items():
        c.eq(goal.get(key), value, f"E9 지난 목표의 {key} 값이 맞다")
    _hidden(c, "#dr-finish", "E9")
    _hidden(c, "#dr-nav", "E9")
    c.expect(c.page.locator("#dr-body input, #dr-body select, #dr-body textarea, #dr-body [aria-pressed]").evaluate_all(
        "els => els.filter(e => !e.closest('#dr-after')).every(e => e.disabled)"), "E9 마친 답의 입력과 토글을 비활성화한다")
    c.page.evaluate("""Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: t => {window.__clip = t; return Promise.resolve();}}, configurable: true
    })""")
    _visible(c, "#dr-copy").click()
    c.page.wait_for_function("typeof window.__clip === 'string'")
    clip = c.page.evaluate("window.__clip")
    c.expect(clip.startswith("[짧은 판단 훈련장 · 테라-3 첫 정착지 주 전력원] 연습용 문항, 가상 자료\n범위: 전체 흐름"),
             "E9 복사 글의 첫 두 줄이 계약과 같다")
    for block in ("■ 판단 기준", "■ 선택과 얻고 잃는 것", "■ 반문과 내 답", "■ 다음엔"):
        c.expect(block in clip, f"E9 복사 글에 {block} 블록이 있다")
    c.expect(clip.endswith("말로 해 본 것: 기준"), "E9 복사 글 끝에 말로 해 본 항목을 적는다")
    c.check("E9 마친 화면")
    _visible(c, "#dr-again").click()
    c.page.wait_for_selector("#dr-run #dr-title")
    c.page.wait_for_function("location.hash !== '#drill/planet'")
    c.expect(c.page.evaluate("location.hash") in ("#drill/heat", "#drill/island", "#drill/roadmap"),
             "E9 다른 유형 한 판은 하나 고르기를 피한다")


def t_E10_budget(c: Ctx):
    _to_trade(c, "island", "E10")
    c.expect(c.page.locator("#dr-next").is_disabled(), "E10 예산 배분 전에는 다음이 비활성이다")
    for ident, value in (("sol", 40), ("cable", 30), ("diesel", 20), ("save", 5)):
        _visible(c, f"[data-dbud='{ident}']").fill(str(value))
    c.eq(_text(c, "#dr-left"), "남은 예산 5", "E10 합계 95이면 남은 예산은 5다")
    c.expect(c.page.locator("#dr-next").is_disabled(), "E10 합계가 100 미만이면 진행하지 못한다")
    _visible(c, "[data-dbud='save']").fill("10")
    c.eq(_text(c, "#dr-left"), "남은 예산 0", "E10 합계 100이면 남은 예산은 0이다")
    c.expect(c.page.locator("#dr-next").is_enabled(), "E10 합계 100이면 다음이 활성이다")
    c.eq(_text(c, "#dr-picked"), "가장 많이 준 항목: 태양광과 저장장치 40", "E10 최대 배분 항목을 표시한다")
    _visible(c, "[data-dbud='save']").fill("30")
    c.eq(_text(c, "#dr-left"), "예산 20 초과", "E10 합계 120이면 초과 20을 표시한다")
    c.expect(c.page.locator("#dr-next").is_disabled(), "E10 합계가 100 초과면 진행하지 못한다")
    _visible(c, "[data-dbud='save']").fill("10")
    _visible(c, "#dr-gain").select_option(label="공급 안정")
    _visible(c, "#dr-cost").select_option(label="공급 안정")
    c.expect(_text(c, "#dr-tsent").startswith("이 배분은"), "E10 예산 문장의 주어는 이 배분이다")
    c.check("E10 예산 나누기")


def t_E11_rank(c: Ctx):
    _to_trade(c, "heat", "E11")
    c.eq(_text(c, "#dr-picked"), "1번(가장 먼저): 산업단지", "E11 기본 순서 첫 항목은 산업단지다")
    c.expect(c.page.locator("[data-dmove='0'][data-ddir='-1']").is_disabled(), "E11 첫 항목은 위로 옮길 수 없다")
    c.expect(c.page.locator("#dr-rank li").last.locator("[data-ddir='1']").is_disabled(),
             "E11 마지막 항목은 아래로 옮길 수 없다")
    _visible(c, "[data-dmove='1'][data-ddir='-1']").click()
    c.expect("고층 아파트 단지" in c.page.locator("#dr-rank li").first.inner_text(), "E11 선택 항목을 위로 옮긴다")
    c.eq(_text(c, "#dr-picked"), "1번(가장 먼저): 고층 아파트 단지", "E11 옮긴 뒤 첫 항목 표시를 갱신한다")
    c.expect(c.page.evaluate("document.activeElement.matches('#dr-rank button')"), "E11 옮긴 뒤 순서 버튼에 포커스를 유지한다")
    c.eq(c.page.evaluate("document.activeElement.getAttribute('data-ddir')"), "1",
         "E11 위로 버튼이 비활성인 첫 항목에서는 아래로 버튼에 포커스한다")
    _visible(c, "#dr-gain").select_option(label="생명·건강")
    _visible(c, "#dr-cost").select_option(label="생명·건강")
    sentence = _text(c, "#dr-tsent")
    c.expect(sentence.startswith("이 순서는") and "고층 아파트 단지는" not in sentence,
             "E11 순서 문장의 주어는 이 순서다")
    c.check("E11 순서 정하기")


def t_E12_resume(c: Ctx):
    _to_trade(c, "planet", "E12")
    _visible(c, "[data-dopt='smr']").click()
    _saved(c, DRILL_KEY, "E12")
    c.page.reload()
    _visible(c, "#dr-run")
    _wait_step(c, 3, "E12")
    c.eq(c.page.locator("[data-dopt='smr']").get_attribute("aria-pressed"), "true", "E12 고른 후보가 복원된다")
    c.goto("#drill", wait="#dr-resume-box")
    text = _text(c, "#dr-resume-box")
    c.expect("테라-3" in text and "3단계" in text, "E12 로비에 진행 중인 문항과 단계가 보인다")
    c.eq(_visible(c, "#dr-resume").get_attribute("href"), "#drill/planet", "E12 이어 하기 주소가 맞다")
    c.check("E12 이어 하기 로비")
    _visible(c, "#dr-discard").click()
    c.page.locator("#dr-resume-box").wait_for(state="detached")
    c.eq(c.page.locator("#dr-resume-box").count(), 0, "E12 버린 뒤 이어 하기 상자가 없다")
    c.eq(_saved(c, DRILL_KEY, "E12").get("cur"), None, "E12 버린 뒤 진행 중 기록은 null이다")


def t_E13_open_without_save(c: Ctx):
    _run(c, "battery", "E13")
    c.goto("#drill", wait="#dr-lobby")
    c.wait_saved(400)
    c.eq(c.page.locator("#dr-resume-box").count(), 0, "E13 열기만 한 판은 이어 하기 상자를 만들지 않는다")
    c.eq(c.ls(DRILL_KEY), None, "E13 열기만 하고 돌아오면 저장하지 않는다")
    c.check("E13 로비")


def t_E14_unknown_route(c: Ctx):
    c.goto("#drill/zzz", wait="#dr-lobby")
    c.eq(c.page.evaluate("location.hash"), "#drill", "E14 없는 문항 주소는 로비 주소로 바꾼다")
    c.eq(c.page.locator(".dr-card").count(), 6, "E14 없는 문항 대신 로비 여섯 카드를 그린다")
    c.page.get_by_text("없는 연습 문항입니다", exact=True).wait_for(state="visible")
    c.check("E14 잘못된 주소의 로비")


def t_E15_push_scope(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    _visible(c, "[data-dfocus='push']").click()
    _run(c, "battery", "E15")
    _wait_step(c, 4, "E15")
    c.eq(c.page.locator("li.dr-skip").count(), 3, "E15 반문만 범위는 세 단계를 건너뛴다")
    c.eq([text.strip().split()[0] for text in c.page.locator("li.dr-skip").all_text_contents()], ["1", "2", "3"],
         "E15 반문만 범위는 1·2·3단계를 건너뛴다")
    _hidden(c, "#dr-prev", "E15")
    data = c.page.evaluate("KCP.DRILLS.find(d => d.id === 'battery')")
    sample = _text(c, ".dr-sample")
    c.expect("가상의 답" in sample and data["sample"] in sample, "E15 반문만 범위에는 가상의 학생 답이 보인다")
    c.expect(_text(c, "#dr-pbq") in [data["pushbacks"][i]["q"] for i in data["samplePb"]],
             "E15 가상의 학생 답에 맞는 반문 가운데 하나를 고른다")
    _next(c, 5, "E15")
    c.eq(c.page.locator("[data-dsaid]").evaluate_all("els => els.map(e => e.dataset.dsaid)"), ["r"],
         "E15 반문만 정리에는 반문 뒤 답 토글만 있다")


def t_E15_crit_scope(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    _visible(c, "[data-dfocus='crit']").click()
    _run(c, "heat", "E15")
    _next(c, 2, "E15")
    _visible(c, "[data-dchip='생명·건강']").click()
    _next(c, 5, "E15")
    c.eq([text.strip().split()[0] for text in c.page.locator("li.dr-skip").all_text_contents()], ["3", "4"],
         "E15 기준만 범위는 3·4단계를 건너뛴다")
    text = _text(c, ".dr-sum")
    c.expect("선택과 얻고 잃는 것" not in text and "반문과 내 답" not in text,
             "E15 기준만 정리에는 다른 범위의 블록이 없다")
    c.eq(c.page.locator("[data-dsaid='t'], [data-dsaid='r']").count(), 0,
         "E15 기준만 정리에는 선택과 반문 말하기 토글이 없다")


def t_E15_all_scope(c: Ctx):
    _to_trade(c, "battery", "E15")
    _visible(c, "[data-dopt='a']").click()
    _next(c, 4, "E15")
    c.eq(c.page.locator(".dr-sample").count(), 0, "E15 전체 흐름에는 가상의 학생 답이 없다")
    c.eq(c.page.locator("li.dr-skip").count(), 0, "E15 전체 흐름은 건너뛰는 단계가 없다")


def t_E15_trade_scope(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    _visible(c, "[data-dfocus='trade']").click()
    _run(c, "planet", "E15")
    _wait_step(c, 2, "E15")
    _hidden(c, "#dr-prev", "E15")
    _visible(c, "[data-dchip='안전']").click()
    _next(c, 3, "E15")
    _visible(c, "[data-dopt='smr']").click()
    _next(c, 5, "E15")
    c.eq([text.strip().split()[0] for text in c.page.locator("li.dr-skip").all_text_contents()], ["1", "4"],
         "E15 얻고 잃는 것만 범위는 1·4단계를 건너뛴다")
    c.eq(c.page.locator("[data-dsaid='r']").count(), 0, "E15 얻고 잃는 것만 정리에는 반문 토글이 없다")


def t_E16_timer_real(c: Ctx):
    _run(c, "planet", "E16")
    c.eq(c.page.locator("[data-dtime='8']").get_attribute("aria-pressed"), "true", "E16 기본 시간은 8분이다")
    c.eq(_text(c, "#dr-clock"), "08:00", "E16 기본 시계는 08:00이다")
    _visible(c, "[data-dtime='6']").click()
    c.eq(_text(c, "#dr-clock"), "06:00", "E16 6분 선택으로 시계를 초기화한다")
    _visible(c, "#dr-tgo").click()
    c.eq(_text(c, "#dr-tgo"), "일시정지", "E16 시작하면 일시정지 버튼이 된다")
    c.page.wait_for_timeout(1500)  # 타이머 검증에만 고정 대기를 쓴다.
    first = _text(c, "#dr-clock")
    c.expect(first <= "05:59", "E16 시작 1.5초 뒤 시계가 줄어든다")
    _next(c, 2, "E16")
    c.eq(_text(c, "#dr-tgo"), "일시정지", "E16 단계 이동 뒤에도 타이머가 실행 중이다")
    c.page.wait_for_timeout(1500)
    c.expect(_text(c, "#dr-clock") < first, "E16 단계 이동 뒤에도 시계가 계속 줄어든다")
    _visible(c, "#dr-tgo").click()
    paused = _text(c, "#dr-clock")
    c.page.wait_for_timeout(1100)
    c.eq(_text(c, "#dr-clock"), paused, "E16 일시정지한 시계는 줄어들지 않는다")


def t_E16_timer_extended(c: Ctx):
    c.page.evaluate("KCP.setSettings({timeMode: 'ext'})")
    _run(c, "planet", "E16")
    c.eq(c.page.locator("[data-dtime='12']").get_attribute("aria-pressed"), "true", "E16 연장 모드 기본은 12분이다")
    c.eq(_text(c, "#dr-clock"), "12:00", "E16 연장 모드 시계는 12:00이다")
    c.goto("#home", wait="a.dr-entry")
    c.expect("목표 12분" in _text(c, "a.dr-entry"), "E16 연장 모드 홈 목표는 12분이다")
    c.check("E16 연장 모드 홈")


def t_E16_timer_free(c: Ctx):
    c.page.evaluate("KCP.setSettings({timeMode: 'free'})")
    _run(c, "planet", "E16")
    c.eq(c.page.locator("[data-dtime='0']").get_attribute("aria-pressed"), "true", "E16 제한 없음 기본은 시간 없음이다")
    _hidden(c, "#dr-clock", "E16")
    _hidden(c, "#dr-tgo", "E16")
    c.goto("#home", wait="a.dr-entry")
    c.expect("시간 제한 없음" in _text(c, "a.dr-entry"), "E16 제한 없음 홈 시간 표시가 맞다")
    c.check("E16 제한 없음 홈")


def t_E17_think_settings(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    c.eq(c.page.locator("[data-dthink='0']").get_attribute("aria-pressed"), "true", "E17 기본 생각 시간은 없음이다")
    _visible(c, "[data-dthink='10']").click()
    c.eq(c.page.locator("[data-dthink][aria-pressed='true']").count(), 1, "E17 생각 시간 하나만 눌린다")
    c.eq(c.page.locator("[data-dthink='10']").get_attribute("aria-pressed"), "true", "E17 10초가 눌린다")
    c.eq(c.page.evaluate("KCP.settings().think"), 10, "E17 전체 설정의 생각 시간이 10초다")
    settings = _saved(c, SETTINGS_KEY, "E17")
    c.eq(settings.get("think"), 10, "E17 생각 시간 10초가 저장된다")
    c.expect("fromUrl" not in settings, "E17 주소 유래 표시를 저장하지 않는다")
    _run(c, "planet", "E17")
    c.expect("10초" in _text(c, "#dr-thinknote"), "E17 진행 화면에 생각 10초를 안내한다")
    _next(c, 2, "E17")
    _visible(c, "#dr-speak-c .speak-go").click()
    c.expect(_text(c, "#dr-speak-c .speak-t").startswith("생각 "), "E17 말해 보기는 설정된 생각 단계부터 시작한다")
    c.eq(_text(c, "#dr-speak-c .speak-go"), "바로 말하기", "E17 생각 중 바로 말하기 버튼을 표시한다")
    c.check("E17 생각 단계")


def t_E18_print(c: Ctx):
    c.page.evaluate("window.print = () => {}")
    _run(c, "planet", "E18")
    _next(c, 2, "E18")
    _visible(c, "#dr-cnew").fill("ZZ비밀ZZ")
    _visible(c, "#dr-cadd").click()
    _saved(c, DRILL_KEY, "E18")
    c.goto("#drill", wait="#dr-lobby")
    c.expect(not _visible(c, "#dr-pnote").is_checked(), "E18 교사용 메모는 기본으로 꺼져 있다")
    _visible(c, "[data-dprint='planet']").click()
    sheet = _attached(c, "#printSheet")
    text = sheet.text_content()
    for word in ("테라-3", "이름", "대학의 출제 경향을 예측한 문제가 아닙니다.", "① 판단 기준과 무게", "고른 것"):
        c.expect(word in text, f"E18 과제지에 {word} 문구가 있다")
    c.expect(c.page.locator("#printSheet .dr-print-table").count() >= 1, "E18 과제지에 인쇄용 표가 있다")
    c.expect("ZZ비밀ZZ" not in text and "관련 개념" not in text, "E18 기본 과제지는 학생 입력과 교사용 메모를 넣지 않는다")
    c.eq(c.page.locator("#printSheet > .dr-print-sheet").count(), 1, "E18 과제지는 인쇄용 루트 하나다")
    _hidden(c, "#printSheet", "E18")
    c.expect(c.page.evaluate("document.documentElement.classList.contains('kcp-printing')"), "E18 계약 인쇄 함수를 사용한다")
    c.page.evaluate("window.dispatchEvent(new Event('afterprint'))")
    c.eq(sheet.text_content(), "", "E18 인쇄 종료 뒤 과제지를 비운다")
    c.expect(not c.page.evaluate("document.documentElement.classList.contains('kcp-printing')"), "E18 인쇄 종료 뒤 인쇄 상태를 해제한다")
    _visible(c, "#dr-pnote").check()
    _visible(c, "[data-dprint='planet']").click()
    c.expect("관련 개념" in sheet.text_content(), "E18 옵션을 켜면 교사용 메모를 인쇄한다")
    c.page.evaluate("window.dispatchEvent(new Event('afterprint'))")
    _visible(c, "[data-dprint='heat']").click()
    text = sheet.text_content()
    c.expect("1번(가장 먼저)" in text and "고른 것" not in text, "E18 순서 과제지는 순서 답안 틀을 사용한다")
    c.page.evaluate("window.dispatchEvent(new Event('afterprint'))")
    _visible(c, "[data-dprint='island']").click()
    c.expect("합계는 100" in sheet.text_content(), "E18 예산 과제지에 합계 100 조건을 적는다")
    c.page.evaluate("window.dispatchEvent(new Event('afterprint'))")
    c.check("E18 인쇄 뒤 로비")


def t_E19_clear_drill(c: Ctx):
    _finish(c, "E19", goal="기준을 먼저 말한다")
    _saved(c, DRILL_KEY, "E19")
    c.goto("#drill", wait="#dr-lobby")
    card = c.page.locator(".dr-card").filter(has=c.page.locator("a[href='#drill/planet']"))
    c.expect("해 본 횟수 1" in card.inner_text(), "E19 마친 뒤 planet 횟수는 1이다")
    _visible(c, "[data-dfocus='push']").click()
    _visible(c, "#dr-clear").click()
    _visible(c, "#dr-clear-confirm")
    _visible(c, "#dr-clear-no").click()
    _hidden(c, "#dr-clear-confirm", "E19")
    _visible(c, "#dr-clear").click()
    _visible(c, "#dr-clear-yes").click()
    _visible(c, "#dr-lobby")
    c.wait_saved(400)
    c.eq(c.ls(DRILL_KEY), None, "E19 지우면 훈련장 저장 키가 없다")
    c.eq(c.page.locator(".dr-count").all_text_contents(), ["해 본 횟수 0"] * 6, "E19 지우면 모든 횟수가 0이다")
    c.eq(c.page.locator("[data-dfocus='all']").get_attribute("aria-pressed"), "true", "E19 범위를 전체 흐름으로 초기화한다")
    goal = c.ls(GOAL_KEY) or {}
    c.eq(goal.get("text"), "기준을 먼저 말한다", "E19 훈련장 기록을 지워도 지난 목표 문장은 남는다")
    c.check("E19 지운 뒤 로비")


def t_E20_storage_clear(c: Ctx):
    _run(c, "planet", "E20")
    _next(c, 2, "E20")
    _visible(c, "[data-dchip='출력 안정성']").click()
    _visible(c, "#dr-tgo").click()
    _saved(c, DRILL_KEY, "E20")
    c.page.evaluate("KCP.clearAll()")
    c.page.wait_for_selector("#dr-run #dr-clock")
    c.page.wait_for_timeout(1500)
    c.wait_saved(400)
    c.eq(c.ls(DRILL_KEY), None, "E20 전체 지우기 뒤 훈련장 기록이 되살아나지 않는다")
    first = _text(c, "#dr-clock")
    c.page.wait_for_timeout(1000)
    c.eq(_text(c, "#dr-clock"), first, "E20 전체 지우기 뒤 훈련장 시계가 멈춘다")
    c.eq(_text(c, "#dr-tgo"), "시작", "E20 전체 지우기 뒤 시간 버튼은 시작이다")
    c.check("E20 전체 지우기 뒤 진행 화면")


def t_E21_entry_feedback_contrast(c: Ctx):
    c.goto("#home", wait="a.dr-entry")
    _contrast(c, "a.dr-entry .dr-entry-t", "E21")
    c.check("E21 홈 대비")
    _run(c, "planet", "E21")
    _visible(c, "input[name='dr-c0'][value='0']").check()
    _contrast(c, "#dr-fb-0", "E21")
    _visible(c, "input[name='dr-c0'][value='1']").check()
    _contrast(c, "#dr-fb-0", "E21")
    _contrast(c, "#dr-steps li[aria-current='step']", "E21")


def t_E21_skipped_hint_contrast(c: Ctx):
    c.goto("#drill", wait="#dr-lobby")
    _visible(c, "[data-dfocus='push']").click()
    _run(c, "battery", "E21")
    _contrast(c, "#dr-steps li.dr-skip", "E21")
    _contrast(c, "#dr-steps li[aria-current='step']", "E21")
    _visible(c, "#dr-hint").click()
    _contrast(c, "#dr-hinttext", "E21")
    _visible(c, "[data-dstance='revise']").click()
    _contrast(c, "#dr-starters", "E21")
    _visible(c, "[data-dstance='keep']").click()
    _contrast(c, "#dr-starters", "E21")
    c.check("E21 반문 안내 대비")


def t_E22_accessible_controls(c: Ctx):
    _run(c, "planet", "E22")
    for step in range(1, 6):
        _wait_step(c, step, "E22")
        c.expect(c.page.locator("#dr-step input, #dr-step select, #dr-step textarea").evaluate_all(
            "els => els.every(e => e.labels.length > 0 || Boolean(e.getAttribute('aria-label')))"),
            f"E22 {step}단계 입력 요소에 연결된 라벨이나 접근 가능한 이름이 있다")
        c.expect(c.page.locator("#dr-step button").evaluate_all(
            "els => els.every(e => e.getAttribute('type') === 'button')"),
            f"E22 {step}단계 버튼의 type은 button이다")
        if step == 2:
            _visible(c, "[data-dchip='출력 안정성']").click()
        if step == 3:
            _visible(c, "[data-dopt='smr']").click()
            _visible(c, "#dr-gain").select_option("__other")
            _visible(c, "#dr-gain-x").fill("환경")
        if step == 4:
            _visible(c, "[data-dstance='keep']").click()
            c.eq(_text(c, "label[for='dr-rv']"), "유지하는 이유", "E22 유지 선택 입력의 라벨이 맞다")
        if step < 5:
            _next(c, step + 1, "E22")


def t_E22_keyboard_flow(c: Ctx):
    _run(c, "planet", "E22")
    # focus 뒤 실제 키 입력으로 radio/group/버튼을 조작한다.
    _visible(c, "#dr-c0-0").focus()
    c.page.keyboard.press("Space")
    c.page.keyboard.press("ArrowRight")
    c.expect(c.page.locator("input[name='dr-c0']").evaluate_all("els => els.some(e => e.checked)"),
             "E22 라디오는 키보드로 고를 수 있다")
    _visible(c, "#dr-next").focus()
    c.page.keyboard.press("Enter")
    _wait_step(c, 2, "E22")
    c.page.keyboard.press("Tab")
    c.expect(c.page.evaluate("document.activeElement !== document.querySelector('#dr-body h3')"),
             "E22 단계 제목에서 Tab으로 조작 요소에 이동한다")
    _visible(c, "[data-dchip='출력 안정성']").focus()
    c.page.keyboard.press("Space")
    _visible(c, "#dr-next").focus()
    c.page.keyboard.press("Enter")
    _wait_step(c, 3, "E22")
    _visible(c, "[data-dopt='smr']").focus()
    c.page.keyboard.press("Space")
    _visible(c, "#dr-next").focus()
    c.page.keyboard.press("Enter")
    _wait_step(c, 4, "E22")
    _visible(c, "[data-dstance='keep']").focus()
    c.page.keyboard.press("Space")
    _visible(c, "#dr-rv").focus()
    c.page.keyboard.type("자료 조건을 다시 확인한다")
    _visible(c, "#dr-next").focus()
    c.page.keyboard.press("Enter")
    _wait_step(c, 5, "E22")
    _visible(c, "#dr-finish").focus()
    c.page.keyboard.press("Enter")
    _visible(c, "#dr-after")
    c.expect(c.page.locator("#dr-finish").is_hidden(), "E22 키보드 입력으로 다섯 단계를 마친다")
    c.check("E22 키보드로 마친 화면")


def t_E23_all_screens(c: Ctx):
    # 오류/경고/pageerror는 이 함수도 포함하여 harness가 네 환경에서 자동 수집한다.
    c.goto("#drill", wait="#dr-lobby")
    c.check("E23 로비")
    data = c.page.evaluate("KCP.DRILLS")
    for d in data:
        ident = d["id"]
        _run(c, ident, "E23")
        c.eq(c.page.title(), f"{d['title']} · 짧은 판단 훈련장 · 켄텍 창의성 면접 연습실",
             f"E23 {ident} 진행 화면 문서 제목이 맞다")
        layout = c.page.evaluate("""() => {
            const a = document.querySelector('#dr-data').getBoundingClientRect();
            const b = document.querySelector('#dr-step').getBoundingClientRect();
            return {stacked: b.top >= a.bottom - 1, side: b.left >= a.right - 1};
        }""")
        c.expect(layout["stacked"] if c.cfg.mobile else layout["side"],
                 f"E23 {ident} 화면 폭에 맞게 자료와 단계 패널을 배치한다")
        c.expect(c.page.locator("#dr-data table").evaluate_all(
            "els => els.every(el => Boolean(el.closest('.table-wrap')))"),
            f"E23 {ident} 자료 표는 자체 가로 스크롤 컨테이너에 있다")
        if d.get("view") == "table":
            c.expect(c.page.locator("#dr-data .table-wrap").evaluate_all(
                "els => els.every(e => e.scrollWidth <= e.clientWidth || ['auto','scroll'].includes(getComputedStyle(e).overflowX))"),
                f"E23 {ident} 넘치는 표는 table-wrap 안에서 가로로 움직인다")
        _wait_step(c, 1, "E23")
        _next(c, 2, "E23")
        _visible(c, "[data-dchip]").first.click()
        _next(c, 3, "E23")
        if d["kind"] == "pick":
            _visible(c, "[data-dopt]").first.click()
        elif d["kind"] == "budget":
            _visible(c, "[data-dbud]").first.fill("100")
        _next(c, 4, "E23")
        _visible(c, "#dr-hint").click()
        _visible(c, "[data-dstance='revise']").click()
        c.check(f"E23 {ident} 힌트와 수정 입력을 연 반문")
        _next(c, 5, "E23")
        _visible(c, "#dr-finish").click()
        _visible(c, "#dr-after")
        _hidden(c, "#dr-next", "E23")
        c.check(f"E23 {ident} 마친 화면")


def t_E24_static_assets(c: Ctx):
    # 작성 시에는 구현을 읽지 않는다. 검사를 실행할 때 대상 주소의 자산을 읽는다.
    # new Function은 브라우저 구문 검사일 뿐 node --check의 실행 결과가 아니다.
    result = c.page.evaluate(r"""async () => {
      const errors = [];
      for (const file of ['drill-data.js', 'drill.js']) {
        const response = await fetch(new URL('ext/' + file, document.baseURI));
        if (!response.ok) { errors.push(file + ': 자산 요청 실패'); continue; }
        const source = await response.text();
        try { new Function(source); } catch (_) { errors.push(file + ': JS 구문 오류'); }
        if (/console\.|jn-|pb-|pv-|#tset|timeset|tmode|tm-tip|getUserMedia|SpeechRecognition|MediaRecorder/.test(source))
          errors.push(file + ': 금지된 패턴');
      }
      const response = await fetch(new URL('ext/drill.css', document.baseURI));
      if (!response.ok) { errors.push('drill.css: 자산 요청 실패'); return errors; }
      const raw = await response.text();
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, '');
      if (/^\s*(\.(seg|btn|desk|panel|field|chip|row|stack|note|hint|caution|small|muted|num|qcard|qdeck|speak|tag-official|tag-mine)\b|\[data-|:root|html\b|body\b|\*\s*\{)/m.test(raw))
        errors.push('CSS: 공통 선택자로 시작하는 규칙');
      if (/!important|(?:^|[;{])\s*--[\w-]+\s*:/.test(source)) errors.push('CSS: important 또는 색 토큰 재정의');
      const sheet = new CSSStyleSheet();
      try { sheet.replaceSync(source); } catch (_) { errors.push('CSS: 구문 오류'); return errors; }
      const hintRules = new Set();
      const walk = rules => {
        for (const rule of Array.from(rules)) {
          if (rule.selectorText) {
            for (const selector of rule.selectorText.split(',')) {
              if (!/^(?:#dr-[\w-]+|\.dr-[\w-]+|#printSheet\s+\.dr-print-[\w-]+)/.test(selector.trim()))
                errors.push('CSS: 접두어 없는 선택자 ' + selector);
              if (['#dr-lobby .hint', '#dr-run .hint'].includes(selector.trim()) &&
                  rule.style.color.trim() === 'var(--ink-2)') hintRules.add(selector.trim());
            }
            if (rule.style.opacity) errors.push('CSS: opacity 사용');
            for (const key of Array.from(rule.style)) {
              if (/^(?:animation|transition)(?:-|$)/.test(key)) errors.push('CSS: 전환 또는 애니메이션');
            }
          } else if (rule.cssRules) walk(rule.cssRules);
        }
      };
      walk(sheet.cssRules);
      if (hintRules.size !== 2) errors.push('CSS: 로비와 진행 화면의 hint 색 규칙 누락');
      // 쉼표로 나뉜 다음 선택자는 새 줄에서 시작한다.
      if (/,[^\n{}]*\S[^\n{}]*\{/.test(source)) errors.push('CSS: 한 줄에 여러 선택자');
      return errors;
    }""")
    c.eq(result, [], "E24 제공되는 JS와 CSS 자산의 구문·금지 패턴·접두어 검사에 위반이 없다")


def t_E25_selector_compatibility(c: Ctx):
    c.goto("#home", wait="a.dr-entry")
    c.eq(c.page.locator(".pkg").count(), 5, "E25 기존 기출 카드는 다섯 개를 유지한다")
    c.eq(c.page.locator("a.dr-entry .pkg, a.dr-entry .chip.accent").count(), 0,
         "E25 훈련장 진입 요소는 기존 카드와 강조 칩 선택자에 걸리지 않는다")
    c.expect(c.page.locator("[id^='dr-'], .dr-entry").evaluate_all(
        "els => els.every(e => Boolean(e.closest('#home-slot')))"), "E25 홈의 훈련장 요소는 홈 슬롯 안에만 생긴다")
    c.check("E25 홈 회귀 선택자")
    forbidden = ["v", "k", "a", "tab", "phase", "mode", "cell", "tool", "ov", "del", "dec", "down",
                 "node", "hex", "inc", "toggle", "match", "fact", "sel", "slot", "up", "tot", "pick", "to",
                 "r1", "note", "qx", "stale", "stale-keep", "stale-clear", "tm", "think"]
    for ident in IDS:
        _run(c, ident, "E25")
        for step in range(1, 6):
            c.expect(c.page.locator("#dr-run *").evaluate_all(
                "(els, names) => els.every(e => names.every(n => !e.hasAttribute('data-' + n)))", forbidden),
                f"E25 {ident} {step}단계는 기존 게임의 data 선택자와 겹치지 않는다")
            c.eq(c.page.locator("#dr-run .pkg, #dr-run .chip.accent, #dr-run .qcard, #dr-run .qdeck, #dr-run .desk").count(),
                 0, f"E25 {ident} {step}단계는 기존 게임의 카드와 배치 선택자를 쓰지 않는다")
            if step == 2:
                _visible(c, "[data-dchip]").first.click()
            if step == 3:
                kind = c.page.evaluate("id => KCP.DRILLS.find(d => d.id === id).kind", ident)
                if kind == "pick":
                    _visible(c, "[data-dopt]").first.click()
                elif kind == "budget":
                    _visible(c, "[data-dbud]").first.fill("100")
            if step < 5:
                _next(c, step + 1, "E25")
    for year in range(2022, 2027):
        c.goto(f"#y{year}", wait="#prep-body")
        c.eq(c.page.locator("#dr-run, #dr-lobby, .dr-entry").count(), 0, f"E25 {year} 게임에 훈련장 루트와 홈 진입을 만들지 않는다")
        c.phase("room")
        _visible(c, ".qdeck .qcard")
        c.expect(c.page.locator("textarea[data-a]").count() > 0, f"E25 {year} 면접실의 기존 질문 입력 선택자가 남는다")
        c.check(f"E25 {year} 면접실")


def t_E6_manual_criterion(c: Ctx):
    _run(c, "planet", "E6")
    _next(c, 2, "E6")
    _visible(c, "#dr-cnew").fill("  정비 인력  ")
    c.page.locator("#dr-cnew").press("Enter")
    c.eq(c.page.locator("#dr-clist li").count(), 1, "E6 Enter로 직접 적은 기준을 추가한다")
    c.expect("정비 인력" in _text(c, "#dr-clist"), "E6 직접 기준의 앞뒤 공백을 다듬는다")
    _visible(c, "#dr-cnew").fill("정비 인력")
    _visible(c, "#dr-cadd").click()
    c.eq(c.page.locator("#dr-clist li").count(), 1, "E6 같은 이름의 기준은 중복 추가하지 않는다")
    _visible(c, "[data-drm='0']").click()
    c.eq(c.page.locator("#dr-clist li").count(), 0, "E6 빼기 버튼으로 직접 기준을 뺀다")


def t_E7_speaking_recommendations(c: Ctx):
    _run(c, "planet", "E7")
    _next(c, 2, "E7")
    _say(c, "#dr-speak-c", "한두 문장", "E7")
    _visible(c, "[data-dchip='출력 안정성']").click()
    c.eq(c.page.locator("#dr-speak-c .speak-go").get_attribute("aria-pressed"), "true",
         "E7 같은 단계에서 기준 입력은 말해 보기를 끊지 않는다")
    _next(c, 3, "E7")
    _say(c, "#dr-speak-t", "한두 문장", "E7")
    _visible(c, "[data-dopt='smr']").click()
    c.eq(c.page.locator("#dr-speak-t .speak-go").get_attribute("aria-pressed"), "true",
         "E7 같은 단계에서 선택 입력은 말해 보기를 끊지 않는다")
    _next(c, 4, "E7")
    _say(c, "#dr-speak-r", "두세 문장", "E7")
    c.check("E7 권장 문장 수")


if __name__ == "__main__":
    main(globals())
