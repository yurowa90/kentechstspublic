"""T3 짝 면접 수용 검사. 구현 대신 지시서와 확장 계약을 기준으로 한다.

각 t_ 함수의 컨텍스트는 harness가 새로 만든다. 이어쓰기 기준도 필요한
선행 사용자 조작을 함수 안에서 재현한다. D16의 원본 baseline 전체 실행은
이 파일의 범위 밖이다. 여기에는 정적 검사와 기존 선택자의 회귀 점검을 둔다.
"""

import re

from harness import Ctx, main


HABITS = [
    ("c", "기준을 먼저 말했다"),
    ("t", "얻는 것과 잃는 것을 함께 말했다"),
    ("r", "반문 뒤 답을 고치거나 유지하는 이유를 말했다"),
    ("d", "자료의 수치나 문장을 짚었다"),
]
NOTE = "무게는 말하지 않음"
OVERALL = "근거를 수치로 들었다"


def _hidden(c, selector, criterion):
    el = c.page.locator(selector)
    el.wait_for(state="attached")
    c.eq(el.count(), 1, f"{criterion} 숨김 대상 {selector}는 한 개다")
    c.expect(el.is_hidden(), f"{criterion} {selector}는 숨겨져 있다")
    c.expect(
        el.evaluate("e => e.hidden && getComputedStyle(e).display === 'none'"),
        f"{criterion} {selector}는 hidden 속성과 display:none으로 숨긴다",
    )


def _room(c, year, criterion):
    c.goto(f"#y{year}", wait="#strip")
    c.phase("room")
    c.page.locator("#pv-open").wait_for()
    c.check(f"{criterion} {year} 지원자 보기")


def _view(c, criterion):
    c.page.locator("#pv-open").click()
    c.page.locator("#pv-view").wait_for()
    c.check(f"{criterion} 면접위원 보기")


def _reflect(c, criterion):
    c.phase("reflect")
    c.page.locator("#pv-reflect").wait_for()
    c.check(f"{criterion} 성찰")


def _key(c, year, index):
    return c.page.evaluate(
        "([y, i]) => KCP.qkey(KCP.games[y].questions(KCP.load(y))[i])",
        [year, index],
    )


def _questions(c, year):
    return c.page.evaluate(
        "y => KCP.games[y].questions(KCP.load(y))", year
    )


def _saved_peer(c, year, criterion):
    c.wait_saved(400)
    state = c.ls(f"kcp:v1:{year}")
    c.expect(isinstance(state, dict), f"{criterion} 학년도 상태가 저장된다")
    peer = (state or {}).get("ext", {}).get("peer", {})
    c.expect(isinstance(peer, dict), f"{criterion} 짝 관찰 상태는 객체다")
    return peer


def _seed_observation(c, criterion, year="2022"):
    _room(c, year, criterion)
    _view(c, criterion)
    c.page.locator('[data-pv-h="c"]').click()
    c.page.locator("#pv-note").fill(NOTE)
    _saved_peer(c, year, criterion)


def _clipboard(c):
    c.page.evaluate("""() => {
      window.__clip = '';
      Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: text => {
          window.__clip = text;
          return Promise.resolve();
        }}, configurable: true
      });
    }""")


def _copy(c):
    c.page.evaluate("window.__clip = null")
    c.page.locator("#copyAll").click()
    c.page.wait_for_function("typeof window.__clip === 'string'")
    return c.page.evaluate("window.__clip")


def _peer_block(text):
    start = text.find("■ 짝 관찰")
    if start < 0:
        return ""
    end = text.find("\n■ ", start + 1)
    return text[start:] if end < 0 else text[start:end]


def _listen_probes(c):
    c.page.evaluate("""() => {
      window.__pp = [];
      KCP.on('peer:probe', p => window.__pp.push({
        id: p.id, key: p.key, year: p.year,
        s: typeof p.save === 'function', st: !!p.state
      }));
    }""")


def _inject(c, year, state):
    # 주입 전 이전 화면의 pending 저장을 반드시 소진한다.
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush && KCP.flush()")
    c.page.evaluate(
        "([y, s]) => localStorage.setItem('kcp:v1:' + y, JSON.stringify(s))",
        [year, state],
    )
    c.page.reload()
    c.page.wait_for_selector(".home-grid")


def t_D1_open(c: Ctx):
    _room(c, "2022", "D1")
    button = c.page.locator("#room-tools #pv-open")
    c.eq(button.count(), 1, "D1 도구 줄의 면접위원 보기 버튼은 한 개다")
    c.expect(button.is_enabled(), "D1 질문이 있으면 열기 버튼이 활성화된다")
    c.eq(button.inner_text().strip(), "면접위원 보기", "D1 열기 버튼 이름을 유지한다")
    c.eq(button.get_attribute("type"), "button", "D1 열기는 제출 버튼이 아니다")
    _hidden(c, "#pv-count", "D1")
    _hidden(c, "#room-alt", "D1")
    c.eq(c.page.locator("#room-alt").inner_html(), "", "D1 처음 대체 화면은 비어 있다")
    _view(c, "D1")
    _hidden(c, "#room-main", "D1")
    c.expect(c.page.locator("#room-alt").is_visible(), "D1 대체 화면이 보인다")
    c.eq(c.page.locator("#pv-view").count(), 1, "D1 면접위원 패널은 한 개다")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-title", "D1 열면 제목에 포커스를 둔다")
    c.expect(c.page.locator("#clock").is_visible(), "D1 위쪽 띠 시계가 보인다")
    c.eq(c.page.locator("#pv-guide").get_attribute("open"), None, "D1 진행 순서는 처음 접혀 있다")
    c.eq(c.page.locator("#pv-view .pv-head .tag-mine").inner_text(), "연습용 짝 면접", "D1 짝 면접 출처를 표시한다")
    c.eq(c.page.locator("#pv-view").get_attribute("aria-labelledby"), "pv-title", "D1 패널의 이름은 제목과 연결된다")


def t_D2_private_memo(c: Ctx):
    _room(c, "2022", "D2")
    question = c.page.locator(".qdeck .qcard .q").first.text_content().strip()
    c.page.locator('textarea[data-a="0"]').fill("지원자 메모 확인 문장")
    _view(c, "D2")
    c.eq(c.page.locator("#pv-q").text_content().strip(), question, "D2 질문은 지원자 화면의 첫 질문과 같다")
    visible_answers = c.page.locator("textarea[data-a]").evaluate_all(
        "els => els.filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none').length"
    )
    c.eq(visible_answers, 0, "D2 지원자의 답변 입력칸은 하나도 보이지 않는다")
    c.expect("지원자 메모 확인 문장" not in c.page.locator("body").inner_text(), "D2 지원자의 메모를 면접위원에게 노출하지 않는다")
    meta = c.page.locator("#pv-meta").inner_text()
    c.expect(meta.startswith("질문 1 / 5"), "D2 첫 질문의 번호와 전체 질문 수를 표시한다")
    c.expect("보고서 문항" in meta, "D2 보고서 문항의 출처를 표시한다")
    _hidden(c, "#pv-time", "D2")
    _hidden(c, "#pv-rec", "D2")


def t_D3_navigation_keyboard(c: Ctx):
    # D2의 선행 화면을 이 함수의 빈 컨텍스트에서 재현한다.
    _room(c, "2022", "D3")
    c.page.locator('textarea[data-a="0"]').fill("지원자 메모 확인 문장")
    _view(c, "D3")
    c.expect(c.page.locator("#pv-prev").is_disabled(), "D3 첫 질문에서는 이전으로 갈 수 없다")
    c.page.locator("#pv-next").focus()
    c.page.keyboard.press("ArrowRight")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 2 / 5"), "D3 오른쪽 화살표는 다음 질문으로 간다")
    c.eq(c.page.locator("#pv-live").inner_text(), "질문 2 / 5", "D3 질문 이동을 읽기 도구에 알린다")
    c.eq(c.page.locator('[data-pv-go="1"]').get_attribute("aria-current"), "true", "D3 현재 번호에만 현재 속성을 둔다")
    c.eq(c.page.locator('[data-pv-go="0"]').get_attribute("aria-current"), None, "D3 이전 번호의 현재 속성은 제거한다")
    c.page.keyboard.press("ArrowLeft")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 1 /"), "D3 왼쪽 화살표는 이전 질문으로 간다")
    c.page.locator('[data-pv-go="0"]').focus()
    c.page.keyboard.press("ArrowRight")
    c.eq(c.page.evaluate("document.activeElement.getAttribute('data-pv-go')"), "1", "D3 번호 버튼의 포커스는 새 현재 번호로 옮긴다")
    c.page.locator('[data-pv-go="3"]').click()
    c.page.locator("#pv-next").focus()
    c.page.keyboard.press("Enter")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 5 / 5"), "D3 마지막 질문으로 이동한다")
    c.expect(c.page.locator("#pv-next").is_disabled(), "D3 마지막 질문에서 다음 버튼은 비활성이다")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-prev", "D3 비활성화된 다음 버튼의 포커스를 이전으로 옮긴다")
    c.page.keyboard.press("ArrowRight")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 5 / 5"), "D3 끝에서 화살표를 눌러도 처음으로 돌지 않는다")
    c.page.locator("#pv-note").focus()
    c.page.keyboard.press("ArrowLeft")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 5 /"), "D3 입력 중 화살표는 질문을 옮기지 않는다")
    c.page.keyboard.press("Escape")
    c.expect(c.page.locator("#pv-view").is_visible(), "D3 입력 중 Escape는 면접위원 보기를 닫지 않는다")
    c.page.locator('[data-pv-go="2"]').click()
    c.expect("연습용 질문" in c.page.locator("#pv-meta").inner_text(), "D3 연습용 질문의 출처도 표시한다")
    # modifier와 defaultPrevented 이벤트도 계약상 무시한다.
    c.page.locator("#pv-title").focus()
    for key in ("Alt+ArrowRight", "Control+ArrowRight", "Meta+ArrowRight", "Shift+ArrowRight"):
        c.page.keyboard.press(key)
        c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 3 /"), "D3 보조 키가 눌린 화살표는 무시한다")
    c.page.evaluate("""() => {
      const e = new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true});
      e.preventDefault();
      document.querySelector('#pv-title').dispatchEvent(e);
    }""")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 3 /"), "D3 이미 처리된 키보드 이벤트는 무시한다")
    c.check("D3 질문 이동 후")


def t_D4_observation_storage(c: Ctx):
    _room(c, "2022", "D4")
    _view(c, "D4")
    buttons = c.page.locator("[data-pv-h]")
    c.eq(buttons.count(), 4, "D4 관찰 항목은 네 개다")
    expected = [name for _, name in HABITS]
    c.eq(buttons.all_text_contents(), expected, "D4 관찰 항목 이름과 순서는 계약과 같다")
    c.eq(c.page.evaluate("KCP.HABITS.map(h => h.n)"), expected, "D4 화면은 공통 습관 목록을 사용한다")
    c.page.locator('[data-pv-h="c"]').click()
    for key, _ in HABITS:
        c.eq(c.page.locator(f'[data-pv-h="{key}"]').get_attribute("aria-pressed"), "true" if key == "c" else "false", "D4 누른 항목만 선택 상태다")
    first = c.page.locator('[data-pv-go="0"]')
    c.expect("pv-has" in (first.get_attribute("class") or "").split(), "D4 관찰 있는 질문 번호에는 표시점 클래스를 둔다")
    c.eq(first.get_attribute("aria-label"), "질문 1, 관찰 있음", "D4 관찰 유무를 읽기 도구에도 알린다")
    c.expect("pv-has" not in (c.page.locator('[data-pv-go="1"]').get_attribute("class") or "").split(), "D4 관찰 없는 번호에는 표시점이 없다")
    c.page.locator("#pv-note").fill(NOTE)
    peer = _saved_peer(c, "2022", "D4")
    c.eq(sorted(peer), ["cur", "obs", "overall"], "D4 짝 관찰 상태의 최상위 키는 계약의 세 개뿐이다")
    key = _key(c, "2022", 0)
    c.eq(peer.get("obs", {}).get(key), {"q": c.page.locator("#pv-q").text_content(), "c": True, "t": False, "r": False, "d": False, "note": NOTE}, "D4 질문 고정 키에 질문 문장과 관찰을 저장한다")
    c.page.locator('[data-pv-h="c"]').click()
    c.page.locator("#pv-note").fill("")
    peer = _saved_peer(c, "2022", "D4")
    c.expect(key not in peer.get("obs", {}), "D4 표시와 메모를 모두 비우면 관찰 항목을 삭제한다")
    c.expect("pv-has" not in (first.get_attribute("class") or "").split(), "D4 삭제한 관찰의 번호 표시도 제거한다")
    _hidden(c, "#pv-count", "D4")
    c.page.locator('[data-pv-h="c"]').click()
    c.page.locator("#pv-note").fill(NOTE)
    _saved_peer(c, "2022", "D4")
    c.check("D4 관찰 입력 후")


def t_D5_probe_cards(c: Ctx):
    _room(c, "2022", "D5")
    _listen_probes(c)
    deck = c.page.evaluate("KCP.probeDeck(KCP.games['2022'].questions(KCP.load('2022'))[0].tag, '2022')")
    _view(c, "D5")
    _hidden(c, "#pv-probebox", "D5")
    c.eq(c.page.locator("#pv-probe").inner_text(), "반문 카드 보기", "D5 카드를 보기 전 버튼 문구다")
    c.expect("연습용 반문" in c.page.locator("#pv-view .tag-mine").all_text_contents(), "D5 반문은 연습용으로 표시한다")
    c.page.locator("#pv-probe").click()
    c.page.locator("#pv-probebox").wait_for()
    c.eq(c.page.locator("#pv-probetext").text_content(), deck[0]["text"], "D5 첫 카드는 공통 덱의 첫 문장이다")
    c.eq(c.page.locator("#pv-probetype").inner_text(), "반문 · " + deck[0]["typeName"], "D5 카드의 유형을 표시한다")
    c.eq(c.page.locator("#pv-probe").inner_text(), "다른 반문", "D5 카드가 보이면 다음 카드 버튼으로 바뀐다")
    c.eq(c.page.evaluate("window.__pp"), [{"id": deck[0]["id"], "key": _key(c, "2022", 0), "year": "2022", "s": True, "st": True}], "D5 반문 이벤트에 카드 식별자와 질문 및 저장 계약을 전달한다")
    c.page.locator("#pv-probe").click()
    c.eq(c.page.locator("#pv-probetext").text_content(), deck[1]["text"], "D5 두 번째 누르면 다음 카드를 보인다")
    c.eq(c.page.evaluate("window.__pp[1].id"), deck[1]["id"], "D5 두 번째 카드도 이벤트로 연결한다")
    c.page.locator("#pv-next").click()
    _hidden(c, "#pv-probebox", "D5")
    c.page.locator("#pv-prev").click()
    c.page.locator("#pv-probebox").wait_for()
    c.eq(c.page.locator("#pv-probetext").text_content(), deck[1]["text"], "D5 같은 질문으로 돌아오면 마지막 카드를 기억한다")
    peer = _saved_peer(c, "2022", "D5")
    c.eq(peer.get("obs"), {}, "D5 반문 보기만으로 관찰을 저장하지 않는다")
    c.check("D5 반문 카드 표시 후")


def t_D6_deck_2025(c: Ctx):
    _room(c, "2025", "D6")
    _view(c, "D6")
    _listen_probes(c)
    deck = c.page.evaluate("KCP.probeDeck(KCP.games['2025'].questions(KCP.load('2025'))[0].tag, '2025')")
    c.eq(len(deck), 8, "D6 2025년의 반문 덱은 여덟 장이다")
    for i in range(9):
        c.page.locator("#pv-probe").click()
        c.eq(c.page.locator("#pv-probetext").text_content(), deck[i % 8]["text"], "D6 2025년 덱을 순서대로 표시하고 순환한다")
    events = c.page.evaluate("window.__pp")
    ids = [event["id"] for event in events]
    c.eq(len(ids), 9, "D6 아홉 번 카드 보기마다 이벤트를 한 번 낸다")
    c.expect("T2" not in ids and "F2" not in ids, "D6 2025년에는 제외된 두 카드를 보이지 않는다")
    c.eq(ids, [deck[i % 8]["id"] for i in range(9)], "D6 아홉째 카드는 첫째 카드와 같다")
    c.check("D6 2025 반문 순환 후")


def t_D7_close_with_observation(c: Ctx):
    _seed_observation(c, "D7")
    c.page.locator("#pv-close").click()
    c.page.locator("#room-main").wait_for()
    _hidden(c, "#room-alt", "D7")
    c.eq(c.page.locator("#room-alt").inner_html(), "", "D7 닫으면 면접위원 화면을 비운다")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-open", "D7 닫으면 열기 버튼으로 포커스를 돌린다")
    c.expect(c.page.locator("#pv-count").is_visible(), "D7 관찰이 있으면 칩이 보인다")
    c.eq(c.page.locator("#pv-count").inner_text(), "짝 관찰 1개", "D7 칩은 관찰 있는 현재 질문 수다")
    c.page.locator(".toast").filter(has_text="관찰 기록은 성찰 단계에서 볼 수 있습니다").wait_for()
    _view(c, "D7")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-title", "D7 다시 열면 제목에 포커스를 둔다")
    c.page.keyboard.press("Escape")
    _hidden(c, "#room-alt", "D7")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-open", "D7 입력칸 밖 Escape는 닫고 포커스를 돌린다")
    c.check("D7 닫은 지원자 보기")


def t_D7_close_without_observation(c: Ctx):
    _room(c, "2022", "D7")
    _view(c, "D7")
    c.page.evaluate("""() => {
      window.__pvToasts = [];
      const collect = () => document.querySelectorAll('.toast').forEach(e => {
        window.__pvToasts.push(e.textContent);
      });
      new MutationObserver(collect).observe(document.body, {
        childList: true, subtree: true, characterData: true
      });
      collect();
    }""")
    c.page.locator("#pv-close").click()
    c.page.evaluate("window.__pvToastAt = Date.now()")
    _hidden(c, "#pv-count", "D7")
    _hidden(c, "#room-alt", "D7")
    c.page.wait_for_function("Date.now() - window.__pvToastAt >= 300")
    c.expect(not any("관찰 기록은 성찰 단계에서 볼 수 있습니다" in text for text in c.page.evaluate("window.__pvToasts")), "D7 관찰 없이 닫으면 300ms 동안 관찰 안내 토스트가 없다")
    c.check("D7 관찰 없이 닫기")


def t_D8_reload_restore(c: Ctx):
    _seed_observation(c, "D8")
    c.page.locator("#pv-close").click()
    _view(c, "D8")
    c.page.locator('[data-pv-go="2"]').click()
    peer = _saved_peer(c, "2022", "D8")
    c.eq(peer.get("cur"), 2, "D8 현재 질문 번호를 저장한다")
    c.page.reload()
    c.page.locator("#pv-open").wait_for()
    _hidden(c, "#room-alt", "D8")
    c.expect(c.page.locator("#room-main").is_visible(), "D8 새로고침은 지원자 보기에서 시작한다")
    c.check("D8 새로고침 후 지원자 보기")
    _view(c, "D8")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 3 /"), "D8 저장한 현재 질문에서 다시 연다")
    c.page.locator('[data-pv-go="0"]').click()
    c.eq(c.page.locator('[data-pv-h="c"]').get_attribute("aria-pressed"), "true", "D8 저장한 습관 표시를 복원한다")
    c.eq(c.page.locator("#pv-note").input_value(), NOTE, "D8 저장한 메모를 복원한다")


def t_D9_reflect_export_clear(c: Ctx):
    _seed_observation(c, "D9")
    c.page.locator('[data-pv-go="2"]').click()
    _saved_peer(c, "2022", "D9")
    c.page.reload()
    c.page.locator("#pv-open").wait_for()
    _view(c, "D9")
    c.page.locator('[data-pv-go="0"]').click()
    c.page.locator("#pv-overall").fill(OVERALL)
    c.page.locator("#pv-close").click()
    c.page.evaluate("""() => KCP.on('reflect:render', p => {
      window.__pvState = p.state;
      window.__pvRef = p.state.ext.peer;
    })""")
    _reflect(c, "D9")
    c.eq(c.page.locator("#reflect-left #pv-reflect").count(), 1, "D9 왼쪽 성찰 슬롯에 짝 관찰 패널을 한 개 붙인다")
    text = c.page.locator("#pv-reflect").inner_text()
    for expected in ("기준을 먼저 말했다: 질문 1개에서 표시", "얻는 것과 잃는 것을 함께 말했다: 표시 없음", NOTE, "총평: " + OVERALL):
        c.expect(expected in text, "D9 성찰에 현재 질문의 습관과 메모 및 총평을 표시한다")
    c.expect("준비실을 바꾸기 전 질문" not in text, "D9 현재 질문만 있으면 과거 질문 소제목을 만들지 않는다")
    _hidden(c, "#pv-clear-confirm", "D9")
    _clipboard(c)
    c.page.locator("textarea[id^=nextstep-]").fill("결론을 먼저 말한다")
    copied = _copy(c)
    block = _peer_block(copied)
    for expected in ("Q1. ", "기준을 먼저 말했다 / 메모: " + NOTE, "총평: " + OVERALL):
        c.expect(expected in block, "D9 복사 글의 짝 관찰 블록에 질문과 메모 및 총평을 넣는다")
    c.eq(copied.count("■ 짝 관찰"), 1, "D9 짝 관찰 블록을 한 번만 내보낸다")
    c.expect(0 <= copied.find("■ 자기 평가") < copied.find("■ 짝 관찰") < copied.find("■ 다음 연습 목표"), "D9 짝 관찰은 자기 평가 뒤와 다음 목표 앞에 놓는다")
    habit_lines = [f"- {name}: " + ("질문 1개에서 표시" if key == "c" else "표시 없음") for key, name in HABITS]
    c.eq(block.splitlines()[1:5], habit_lines, "D9 복사 블록의 앞 네 줄은 습관별 현재 질문 개수다")
    first_question = _questions(c, "2022")[0]["q"]
    short = first_question[:40] + ("…" if len(first_question) > 40 else "")
    c.expect(f"Q1. {short}: 기준을 먼저 말했다 / 메모: {NOTE}" in block, "D9 복사 질문은 앞 40자와 생략 기호로 표시한다")
    reflection_short = first_question[:60] + ("…" if len(first_question) > 60 else "")
    c.expect(f"Q1. {reflection_short}" in text, "D9 성찰 질문은 앞 60자와 생략 기호로 표시한다")
    c.page.locator("#pv-clear").click()
    c.page.locator("#pv-clear-confirm").wait_for()
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-clear-no", "D9 삭제 확인에서는 취소 버튼에 포커스를 둔다")
    c.page.locator("#pv-clear-no").click()
    _hidden(c, "#pv-clear-confirm", "D9")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-clear", "D9 취소하면 지우기 버튼으로 포커스를 돌린다")
    c.expect(NOTE in c.page.locator("#pv-rbody").inner_text(), "D9 삭제 취소는 관찰을 보존한다")
    c.page.locator("#pv-clear").click()
    c.page.locator("#pv-clear-yes").click()
    c.page.locator("#pv-empty").wait_for()
    c.eq(c.page.locator("#pv-clear").count(), 0, "D9 모두 지운 뒤 삭제 버튼도 제거한다")
    c.eq(c.page.evaluate("document.activeElement.id"), "pv-rtitle", "D9 모두 지운 뒤 성찰 제목에 포커스를 둔다")
    c.eq(_saved_peer(c, "2022", "D9"), {"cur": 0, "obs": {}, "overall": ""}, "D9 삭제한 짝 관찰은 기본값으로 저장한다")
    c.expect(c.page.evaluate("window.__pvRef === window.__pvState.ext.peer"), "D9 삭제할 때 짝 상태 객체의 참조를 유지한다")
    c.expect("■ 짝 관찰" not in _copy(c), "D9 비어 있는 짝 관찰 블록은 복사하지 않는다")
    c.check("D9 관찰 삭제 후 성찰")


def t_D10_current_and_stale(c: Ctx):
    _inject(c, "2022", {"phase": "reflect", "ext": {"peer": {"cur": 99, "obs": {"zz-old": {"q": "옛 질문 문장입니다", "c": True, "t": False, "r": False, "d": False, "note": "옛 메모"}, "bad": 5, "arr": [1]}, "overall": ""}}})
    c.goto("#y2022", wait="#pv-reflect")
    text = c.page.locator("#pv-reflect").inner_text()
    for expected in ("기준을 먼저 말했다: 표시 없음", "준비실을 바꾸기 전 질문", "옛 질문 문장입니다", "옛 메모"):
        c.expect(expected in text, "D10 이전 질문은 따로 보이고 현재 질문 개수에서는 뺀다")
    c.eq(c.page.locator("#pv-reflect .pv-list li").count(), 1, "D10 잘못된 저장 항목은 관찰 기록으로 표시하지 않는다")
    c.check("D10 과거 기록이 있는 성찰")
    c.phase("room")
    c.page.locator("#pv-open").wait_for()
    _hidden(c, "#pv-count", "D10")
    c.check("D10 과거 기록이 있는 지원자 보기")
    _view(c, "D10")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 5 / 5"), "D10 범위를 넘는 현재 번호는 마지막 질문으로 자른다")
    c.page.locator("#pv-close").click()
    _reflect(c, "D10")
    _clipboard(c)
    block = _peer_block(_copy(c))
    c.expect("(준비실을 바꾸기 전 질문)" in block, "D10 복사 글도 과거 질문을 따로 구분한다")
    c.expect("- 옛 질문 문장입니다: 기준을 먼저 말했다 / 메모: 옛 메모" in block, "D10 과거 질문 문장과 관찰 메모를 복사한다")
    c.expect("기준을 먼저 말했다: 표시 없음" in block, "D10 과거 관찰을 현재 습관 개수에 합산하지 않는다")


def t_D10_invalid_shapes(c: Ctx):
    _inject(c, "2022", {"phase": "room", "ext": {"peer": {"cur": "2", "obs": [], "overall": 7}}})
    c.goto("#y2022", wait="#pv-open")
    _view(c, "D10")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 1 /"), "D10 숫자가 아닌 현재 번호는 0으로 보정한다")
    c.eq(c.page.locator("#pv-overall").input_value(), "", "D10 문자열 아닌 총평은 비운다")
    c.eq(c.page.locator("#pv-note").input_value(), "", "D10 배열인 관찰 저장값은 빈 관찰로 보정한다")
    for key, _ in HABITS:
        c.eq(c.page.locator(f'[data-pv-h="{key}"]').get_attribute("aria-pressed"), "false", "D10 잘못된 관찰 값에서 선택 상태를 만들지 않는다")
    c.page.locator('[data-pv-h="d"]').click()
    peer = _saved_peer(c, "2022", "D10")
    c.eq(peer.get("cur"), 0, "D10 형 보정은 다음 사용자 저장 때 반영된다")
    c.eq(peer.get("overall"), "", "D10 총평 형 보정도 사용자 저장 때 반영된다")
    c.expect(isinstance(peer.get("obs"), dict), "D10 관찰 목록은 순수 객체로 저장된다")


def t_D11_stable_question_key(c: Ctx):
    _room(c, "2026", "D11")
    _view(c, "D11")
    c.page.locator('[data-pv-go="1"]').click()
    before = c.page.locator("#pv-q").text_content()
    key = _key(c, "2026", 1)
    c.page.locator('[data-pv-h="t"]').click()
    c.page.locator("#pv-close").click()
    c.phase("prep")
    c.page.locator('[data-pick="ml"]').wait_for()
    c.page.locator('[data-pick="ml"]').click()
    c.check("D11 2026 준비실 선택 변경")
    c.phase("room")
    c.page.locator("#pv-open").wait_for()
    _view(c, "D11")
    c.page.locator('[data-pv-go="1"]').click()
    c.expect(c.page.locator("#pv-q").text_content() != before, "D11 기술 선택에 따라 질문 문장이 바뀐다")
    c.eq(_key(c, "2026", 1), key, "D11 문장이 바뀌어도 같은 질문의 키는 유지된다")
    c.eq(c.page.locator('[data-pv-h="t"]').get_attribute("aria-pressed"), "true", "D11 문장이 바뀐 질문의 관찰을 고정 키로 복원한다")
    c.page.locator("#pv-close").click()
    _reflect(c, "D11")
    text = c.page.locator("#pv-reflect").inner_text()
    c.expect("얻는 것과 잃는 것을 함께 말했다: 질문 1개에서 표시" in text, "D11 바뀐 문장도 현재 질문의 관찰로 센다")
    c.expect("준비실을 바꾸기 전 질문" not in text, "D11 같은 질문의 이전 문장을 과거 질문으로 분리하지 않는다")


def t_D12_recommended_time(c: Ctx):
    _room(c, "2024", "D12")
    _view(c, "D12")
    c.expect(c.page.locator("#pv-time").is_visible(), "D12 권장 시간이 있는 질문은 시간 안내를 보인다")
    c.eq(c.page.locator("#pv-time").inner_text(), "권장 답변 시간: 약 2~4분", "D12 질문 객체의 권장 시간을 표시한다")
    # D-76(2024 공통 4 시간)으로 2024 질문은 모두 권장 시간을 갖게 됐다. 시간이 없는 질문은 질문 객체에서 찾아 확인한다.
    for year in ("2024", "2025", "2023", "2022", "2026"):
        if year != "2024":
            _room(c, year, "D12")
            _view(c, "D12")
        qs = _questions(c, year)
        blank = [i for i, question in enumerate(qs) if not question.get("time")]
        if blank:
            c.page.locator(f'[data-pv-go="{blank[0]}"]').click()
            _hidden(c, "#pv-time", "D12")
            break
    c.expect(bool(blank), "D12 권장 시간이 없는 질문이 적어도 하나 있다")
    c.check("D12 권장 시간 없는 질문")


def t_D12_report_recommendation(c: Ctx):
    _room(c, "2025", "D12")
    _view(c, "D12")
    qs = _questions(c, "2025")
    indices = [i for i, question in enumerate(qs) if question.get("rec")]
    c.expect(bool(indices), "D12 2025 질문에는 보고서 기준 메모가 있다")
    if not indices:
        return
    i = indices[0]
    c.page.locator(f'[data-pv-go="{i}"]').click()
    c.expect(c.page.locator("#pv-rec").is_visible(), "D12 보고서 기준 메모를 보인다")
    c.eq(c.page.locator("#pv-rec").text_content(), qs[i]["rec"], "D12 기준 메모는 원문 그대로 표시한다")
    c.expect("보고서의 면접 질문 기준" in c.page.locator("#pv-rec").inner_text(), "D12 보고서의 기준 메모임을 나타낸다")
    _hidden(c, "#pv-time", "D12")
    c.expect("권장 답변 시간" not in c.page.locator("#pv-view").inner_text(), "D12 기준 메모를 권장 답변 시간으로 바꾸지 않는다")
    c.check("D12 기준 메모 표시")


def t_D13_speak_stop_and_reset(c: Ctx):
    _room(c, "2022", "D13")
    c.page.evaluate("""() => {
      window.__end = null;
      const span = document.createElement('span');
      span.id = 'pv-test-speak';
      document.querySelector('.qcard').appendChild(span);
      KCP.speak(span, {onEnd: s => { window.__end = s; }});
    }""")
    c.page.locator("#pv-test-speak .speak-go").wait_for()
    c.page.locator("#pv-test-speak .speak-go").click()
    c.page.wait_for_timeout(1200)  # 수용 기준의 말하기 경과 시간 확인.
    _view(c, "D13")
    seconds = c.page.evaluate("window.__end")
    c.expect(isinstance(seconds, (int, float)) and seconds >= 1, "D13 면접위원 보기를 열면 진행 중인 말하기를 끝낸다")
    c.page.locator("#pv-probe").click()
    c.phase("room")
    c.page.locator("#pv-open").wait_for()
    _hidden(c, "#room-alt", "D13")
    c.expect(c.page.locator("#room-main").is_visible(), "D13 같은 단계 다시 그리기도 지원자 보기로 초기화한다")
    _view(c, "D13")
    _hidden(c, "#pv-probebox", "D13")
    c.goto("#home", wait=".home-grid")
    c.check("D13 홈 이동")
    c.goto("#y2022", wait="#pv-open")
    _hidden(c, "#room-alt", "D13")
    c.expect(c.page.locator("#room-main").is_visible(), "D13 라우트 복귀도 지원자 보기로 시작한다")
    _view(c, "D13")
    _hidden(c, "#pv-probebox", "D13")


def t_D14_records_stay_deleted(c: Ctx):
    _seed_observation(c, "D14")
    c.page.locator("#pv-close").click()
    _reflect(c, "D14")
    c.page.locator("#resetAll").click()
    c.page.locator("#doReset").wait_for()
    c.page.locator("#doReset").click()
    c.page.locator(".home-grid").wait_for()
    c.wait_saved(400)
    c.wait_saved(400)  # 600ms 이상 지나도 지연 저장으로 기록이 되살아나지 않아야 한다.
    c.eq(c.ls("kcp:v1:2022"), None, "D14 학년도 초기화 뒤 지연 저장이 기록을 복원하지 않는다")
    c.check("D14 학년도 초기화 후")
    _room(c, "2022", "D14")
    _view(c, "D14")
    c.page.locator('[data-pv-h="c"]').click()
    _saved_peer(c, "2022", "D14")
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.clearAll()")
    c.wait_saved(400)
    keys = c.page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('kcp:'))")
    c.eq(keys, [], "D14 전체 삭제 뒤 앱 저장 키는 하나도 남지 않는다")
    c.check("D14 전체 삭제 후 홈")
    _room(c, "2022", "D14")
    _hidden(c, "#pv-count", "D14")
    _view(c, "D14")
    c.eq(c.page.locator('[data-pv-h="c"]').get_attribute("aria-pressed"), "false", "D14 다시 들어와도 지운 관찰은 선택되지 않는다")


def _visible_below_strip(c, selector):
    return c.page.evaluate("""sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const strip = document.querySelector('#strip').getBoundingClientRect();
      return {top: r.top, bottom: strip.bottom, height: innerHeight};
    }""", selector)


def _layout_contrast(c, year):
    _room(c, year, "D15")
    _view(c, "D15")
    c.eq(c.page.locator("#pv-q").evaluate("e => getComputedStyle(e).fontSize"), "20px" if c.cfg.mobile else "34px", "D15 환경별 질문 글자 크기는 20px 또는 34px이다")
    bounds = c.page.evaluate("""() => {
      const right = document.querySelector('#pv-view').getBoundingClientRect().right;
      return [...document.querySelectorAll('[data-pv-go], [data-pv-h]')]
        .every(e => e.getBoundingClientRect().right <= right + 0.5);
    }""")
    c.expect(bounds, "D15 번호와 습관 버튼은 패널 오른쪽 밖으로 나가지 않는다")
    title = _visible_below_strip(c, "#pv-title")
    c.expect(title["top"] >= title["bottom"] - 1 and title["top"] < title["height"], "D15 제목은 실제 띠 높이 아래의 화면 안에 보인다")
    c.page.locator('[data-pv-h="c"]').click()
    for selector in ("#pv-q", "#pv-meta", '[data-pv-go][aria-current="true"]', '[data-pv-h="c"]'):
        contrast = c.contrast(selector)
        c.expect(contrast is not None and contrast >= 4.5, f"D15 {selector}의 실제 배경 대비는 4.5 이상이다")
    pressed = c.page.locator('[data-pv-h="c"]')
    plain = c.page.locator('[data-pv-h="t"]')
    c.expect(pressed.evaluate("e => getComputedStyle(e).backgroundColor") != plain.evaluate("e => getComputedStyle(e).backgroundColor"), "D15 선택한 습관은 다른 배경색으로 보인다")
    c.expect("✓" in pressed.evaluate("e => getComputedStyle(e, '::before').content"), "D15 선택한 습관은 색 외에 체크 기호로도 보인다")
    c.expect(c.page.locator('[data-pv-go="0"]').evaluate("e => getComputedStyle(e, '::after').backgroundColor === getComputedStyle(e).color"), "D15 관찰 점은 현재 번호의 글자색으로 보인다")
    c.check(f"D15 {year} 관찰 표시한 면접위원 보기")
    c.page.locator("#pv-close").click()
    c.page.locator("#pv-open").wait_for()
    button = _visible_below_strip(c, "#pv-open")
    c.expect(button["top"] >= button["bottom"] - 1 and button["top"] < button["height"], "D15 닫은 뒤 열기 버튼도 띠 아래 화면 안에 보인다")
    c.check(f"D15 {year} 닫은 지원자 보기")
    _reflect(c, "D15")
    c.page.locator("#pv-reflect li").first.wait_for()
    contrast = c.contrast("#pv-reflect li")
    c.expect(contrast is not None and contrast >= 4.5, "D15 내용 있는 성찰 목록의 배경 대비는 4.5 이상이다")


def t_D15_layout_2024(c: Ctx):
    _layout_contrast(c, "2024")


def t_D15_layout_2026(c: Ctx):
    _layout_contrast(c, "2026")


def _css_rules(source):
    """작은 블록 순회기: 중첩 @media를 포함해 일반 규칙을 돌려준다."""
    source = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group().count("\n"), source, flags=re.S)
    pos = 0
    while pos < len(source):
        opening = source.find("{", pos)
        if opening < 0:
            break
        header = source[pos:opening].strip()
        depth, quote, escaped = 1, None, False
        end = opening + 1
        while end < len(source) and depth:
            char = source[end]
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif quote:
                if char == quote:
                    quote = None
            elif char in ("'", '"'):
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            end += 1
        if depth:
            raise ValueError("D16 CSS 블록이 닫히지 않았다")
        body = source[opening + 1:end - 1]
        if header.startswith("@"):
            if "{" in body:
                yield from _css_rules(body)
        else:
            yield header, body
        pos = end


def t_D16_static_contract(c: Ctx):
    # 검사를 실행할 때 대상 주소의 실제 자산을 읽는다. 작성 중 구현을 읽지 않는다.
    assets = c.page.evaluate("""async () => {
      const paths = ['ext/peer.js', 'ext/peer.css'];
      return await Promise.all(paths.map(async path => {
        const response = await fetch(new URL(path, location.href));
        return {path, ok: response.ok, text: await response.text()};
      }));
    }""")
    for asset in assets:
        c.expect(asset["ok"], f"D16 대상 자산 {asset['path']}를 읽을 수 있다")
    js, css = assets[0]["text"], assets[1]["text"]
    c.expect(bool(js.strip()) and bool(css.strip()), "D16 두 모듈 자산이 비어 있지 않다")
    patterns = [
        (r"console\.|localStorage|answers", "콘솔과 직접 저장소 및 지원자 메모에 접근하지 않는다"),
        (r"[\"'](?:probe|jn|drill|settings|goal)[\"']", "다른 모듈의 상태와 저장소 이름을 사용하지 않는다"),
        (r"(^|[^a-z])(jn|pb|dr)-", "다른 모듈의 DOM 접두어에 접근하지 않는다"),
        (r"data-(?:v|k|a|tab|phase|mode|cell|tool|ov|del|node|hex|inc|toggle|match|fact|sel|slot|up|down|tot|pick|to|r1|note|qx|stale|tm|think)(?![a-z0-9-])", "회귀 선택자와 공통 data 속성을 새로 쓰지 않는다"),
    ]
    for pattern, message in patterns:
        c.expect(re.search(pattern, js, re.M) is None, "D16 " + message)
    c.expect(re.search(r"(^|[^a-z])(jn|pb|dr)-", css, re.M) is None, "D16 CSS는 다른 모듈 접두어를 사용하지 않는다")
    broad = r"^\s*(\.(seg|btn|desk|panel|field|chip|row|stack|note|hint|caution|small|muted|num|qcard|qdeck|speak|tag-official|tag-mine)\b|\[data-|:root|html\b|body\b|\*\s*\{)"
    c.expect(re.search(broad, css, re.M) is None, "D16 CSS의 전역 선택자 검색 결과는 0건이다")
    rules = list(_css_rules(css))
    c.expect(bool(rules), "D16 접두어 검사할 CSS 규칙이 있다")
    for selector, declarations in rules:
        parts = selector.split(",")
        c.expect(all(re.match(r"^(?:#pv-|\.pv-)[a-zA-Z0-9_-]+", part.strip()) for part in parts), "D16 모든 CSS 선택자 부분은 자기 접두어로 시작한다")
        c.expect(not re.search(r",[^\S\n]*\S", selector), "D16 쉼표로 이은 CSS 선택자는 한 줄에 하나씩 쓴다")
        c.expect(re.search(r"(?:^|;)\s*--[\w-]+\s*:", declarations) is None, "D16 모듈은 CSS 변수를 다시 정의하지 않는다")
    _room(c, "2022", "D16")
    _view(c, "D16")
    c.page.locator('[data-pv-h="c"]').click()
    c.page.locator("#pv-close").click()
    _reflect(c, "D16")
    c.page.locator("#pv-clear").click()
    c.page.locator("#pv-clear-confirm").wait_for()
    c.phase("room")
    c.page.locator("#pv-open").wait_for()
    _view(c, "D16")
    forbidden_classes = "pkg qcard qdeck reveal rubric supply best ext-slot qx stale timeset tmode tm-tip kcp-printing speak speak-go speak-t seg".split()
    violations = c.page.evaluate("""badClasses => {
      const roots = ['#pv-tools', '#pv-view'];
      const els = roots.flatMap(s => {
        const root = document.querySelector(s);
        return root ? [root, ...root.querySelectorAll('*')] : [];
      });
      return els.flatMap(e => {
        const bad = [];
        if (e.id && !e.id.startsWith('pv-')) bad.push('id:' + e.id);
        for (const cls of e.classList) if (badClasses.includes(cls)) bad.push('class:' + cls);
        for (const a of e.attributes) {
          if (a.name.startsWith('data-') && !['data-pv-go', 'data-pv-h'].includes(a.name)) bad.push(a.name);
        }
        return bad;
      });
    }""", forbidden_classes)
    c.eq(violations, [], "D16 새 면접위원 DOM은 기존 선택자와 충돌하지 않는다")
    _reflect(c, "D16")
    reflect_bad = c.page.locator("#pv-reflect").evaluate("""(root, badClasses) =>
      [root, ...root.querySelectorAll('*')].flatMap(e => [
        ...(e.id && !e.id.startsWith('pv-') ? ['id:' + e.id] : []),
        ...[...e.classList].filter(cls => badClasses.includes(cls)),
        ...[...e.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name)
      ])""", forbidden_classes)
    c.eq(reflect_bad, [], "D16 성찰 DOM도 기존 선택자와 충돌하지 않는다")


def t_D16_existing_selectors_smoke(c: Ctx):
    # 원본 baseline 전체의 대체가 아니다. 통합 환경에서도 유효한 선택자만 점검한다.
    for year in ("2022", "2023", "2024", "2025", "2026"):
        _room(c, year, "D16")
        qs = _questions(c, year)
        c.eq(c.page.locator(".qdeck .qcard").count(), len(qs), "D16 기존 질문 카드 선택자는 현재 질문만 찾는다")
        c.eq(c.page.locator("textarea[data-a]").count(), len(qs), "D16 기존 답변 선택자는 질문당 입력칸 한 개만 찾는다")
        c.expect(c.page.locator("#toReflect").is_visible(), "D16 기존 성찰 이동 버튼을 유지한다")
        c.page.locator('textarea[data-a="0"]').fill("가상 답변 회귀 확인")
        saved = _saved_peer(c, year, "D16")
        c.expect(isinstance(saved, dict), "D16 기존 답변 입력 후에도 짝 상태를 객체로 유지한다")
        state = c.ls(f"kcp:v1:{year}")
        c.eq(state.get("answers", {}).get("0"), "가상 답변 회귀 확인", "D16 기존 순번 키의 답변 저장을 보존한다")
        _view(c, "D16")
        c.page.locator("#pv-close").click()
        _reflect(c, "D16")
        c.expect(c.page.locator("table.rubric").is_visible(), "D16 기존 자기 평가 표를 유지한다")
        c.expect(c.page.locator(".seg button[data-v]").count() > 0, "D16 기존 자기 평가 버튼 선택자를 유지한다")
        c.eq(c.page.locator("#rsum").count(), 1, "D16 자기 평가 요약 선택자를 유지한다")
        c.eq(c.page.locator("textarea[id^=nextstep-]").count(), 1, "D16 다음 연습 목표 선택자를 유지한다")
        c.eq(c.page.locator("#copyAll").count(), 1, "D16 답안 복사 선택자를 유지한다")
        c.page.locator("#pv-empty").wait_for()
        c.eq(c.page.locator("#pv-clear").count(), 0, "D16 빈 성찰에는 짝 관찰 지우기를 만들지 않는다")


def t_D17_original_game(c: Ctx):
    # 실제 창작 게임이 없어도 등록 계약으로 s-test를 만든다. 파일과 다른 게임은 바꾸지 않는다.
    c.page.evaluate("""() => {
      if (!KCP.games['s-test']) {
        KCP.YEARS['s-test'] = {
          ...KCP.YEARS['2022'], title: '가상 창작 쟁점', original: true,
          topics: ['가상 에너지 선택'], concepts: ['판단 기준']
        };
        KCP.games['s-test'] = {
          ...KCP.games['2022'],
          questions: () => [{k: 's-test-q1', tag: '창작 쟁점', q: '가상 마을의 에너지 선택에서 어떤 기준을 먼저 보겠습니까?'}]
        };
        KCP.ORIGINAL_ORDER.push('s-test');
      }
    }""")
    _room(c, "s-test", "D17")
    _view(c, "D17")
    c.expect(c.page.locator("#pv-meta").inner_text().startswith("질문 1 /"), "D17 창작 게임에서도 면접위원 보기가 열린다")
    c.expect("연습용 질문" in c.page.locator("#pv-meta").inner_text(), "D17 창작 게임의 질문은 연습용으로 표시한다")
    key = _key(c, "s-test", 0)
    c.page.locator('[data-pv-h="c"]').click()
    c.page.locator("#pv-note").fill("가상 창작 관찰 메모")
    peer = _saved_peer(c, "s-test", "D17")
    obs = peer.get("obs", {}).get(key, {})
    c.eq(obs.get("c"), True, "D17 창작 게임 키에 습관 관찰을 저장한다")
    c.eq(obs.get("note"), "가상 창작 관찰 메모", "D17 창작 게임 키에 관찰 메모를 저장한다")
    c.eq(obs.get("q"), c.page.locator("#pv-q").text_content(), "D17 창작 질문의 문장도 함께 저장한다")
    _listen_probes(c)
    qs = _questions(c, "s-test")
    deck = c.page.evaluate("tag => KCP.probeDeck(tag, 's-test')", qs[0].get("tag", ""))
    c.page.locator("#pv-probe").click()
    c.eq(c.page.locator("#pv-probetext").text_content(), deck[0]["text"], "D17 모르는 창작 id는 일반 반문 덱을 사용한다")
    c.eq(c.page.evaluate("window.__pp[0].year"), "s-test", "D17 반문 연결에도 창작 게임 id를 전달한다")
    c.page.locator("#pv-close").click()
    c.eq(c.page.locator("#pv-count").inner_text(), "짝 관찰 1개", "D17 창작 게임에서도 현재 관찰 질문을 센다")
    _reflect(c, "D17")
    c.expect("가상 창작 관찰 메모" in c.page.locator("#pv-reflect").inner_text(), "D17 창작 게임의 성찰에도 관찰 기록을 보인다")
    _clipboard(c)
    c.expect("가상 창작 관찰 메모" in _peer_block(_copy(c)), "D17 창작 게임의 관찰을 답안 복사에 포함한다")


if __name__ == "__main__":
    main(globals())
