"""T2 계약 기반 수용 검사. 구현 파일은 검사 작성 중 읽지 않았다.

모든 t_* 함수는 harness가 제공하는 새 컨텍스트와 네 환경에서 실행된다.
C2의 콘솔/페이지 오류 감시는 harness가 모든 함수에 자동 적용한다.
C3 함수는 주요 기존 선택자의 호환성 검사이며 원본 baseline.py 전체를
대체하지 않는다. 원본 실행은 통합 검증 담당자가 별도로 수행해야 한다.
C4는 실행 대상 서버의 파일을 읽어 검사한다. Node가 실행 환경에 필요하다.
"""

import re
import subprocess
from urllib.parse import urljoin

from harness import Ctx, main


WHY = "근거가 여전히 유효"
CLIPBOARD = """() => {
  window.__clip = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText: t => {window.__clip = t; return Promise.resolve();}},
    configurable: true
  });
}"""


def _room(c, year="2022", capture=False):
    if capture:
        c.page.evaluate("() => { KCP.on('room:render', p => {window.__rr = p;}); }")
    c.goto("#y" + year, wait='[data-phase="room"]')
    c.phase("room")
    c.page.wait_for_selector('#pb-speak-0 .speak-go')
    c.check(year + " 면접실")
    return c.page.evaluate("""year => {
      const qs = KCP.games[year].questions(KCP.load(year));
      return qs.map(q => ({q, key: KCP.qkey(q), deck: KCP.probeDeck(q.tag, year)}));
    }""", year)


def _open(c, i=0):
    button = c.page.locator(f'[data-pb-open="{i}"]')
    button.wait_for(state="visible")
    if button.get_attribute("aria-expanded") != "true":
        button.click()
    c.page.locator(f'#pb-box-{i} .pb-card').wait_for(state="visible")
    return c.page.locator(f'#pb-box-{i}')


def _choose(c, stance="keep", i=0):
    _open(c, i)
    c.page.locator(f'[data-pb-stance="{stance}"][data-pb-i="{i}"]').click()
    c.page.locator(f'[data-pb-why="{i}"]').wait_for(state="visible")


def _paired(c):
    info = _room(c)[0]
    _choose(c)
    c.page.locator('[data-pb-why="0"]').fill(WHY)
    c.page.locator('[data-pb-next="0"]').click()
    return info


def _reflect(c, label):
    c.page.locator('#toReflect').click()
    c.page.wait_for_selector('#reflect-left #pb-reflect')
    c.check(label)


def _state(c, year="2022"):
    c.wait_saved(400)
    # 저장은 페이지 안 250ms 지연 타이머(app.js schedule)다. 검사 쪽 400ms만 기다리면 렌더러가 밀릴 때
    # 타이머보다 읽기가 먼저 올 수 있다(10-13 desktop-dark A3 '실제 None' 1회, 재현은 못 함).
    # 페이지 시계로 300ms 타이머를 하나 더 기다리면 마감이 앞선 저장 타이머가 반드시 먼저 돈다.
    c.page.evaluate("() => new Promise(r => setTimeout(r, 300))")
    state = c.ls("kcp:v1:" + year)
    return state if isinstance(state, dict) else {}


def _probe(c, key, year="2022"):
    return _state(c, year).get("ext", {}).get("probe", {}).get(key)


def _copy(c):
    c.page.evaluate(CLIPBOARD)
    c.page.locator('#copyAll').click()
    # 비동기 clipboard.writeText 완료를 기다린다.
    c.page.wait_for_function("typeof window.__clip === 'string' && window.__clip.length > 0")
    return c.page.evaluate("window.__clip")


def _inject(c, year, state):
    # 저장 경쟁을 피하기 위해 홈 이동 → flush → 주입 → reload 순서를 지킨다.
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush && KCP.flush()")
    c.page.evaluate("""({year, state}) => {
      localStorage.setItem('kcp:v1:' + year, JSON.stringify(state));
    }""", {"year": year, "state": state})
    c.page.reload()
    c.page.wait_for_selector(".home-grid")


def _talk(c, i=0, ms=1200):
    button = c.page.locator(f'#pb-speak-{i} .speak-go')
    button.wait_for(state="visible")
    button.click()
    c.page.wait_for_function("""i => document.querySelector('#pb-speak-' + i + ' .speak-go')
      .getAttribute('aria-pressed') === 'true'""", arg=i)
    c.page.wait_for_timeout(ms)  # 타이머 확인에만 고정 대기를 사용한다.
    button.click()


def _emit_peer(c, card_id, **extra):
    c.page.evaluate("""({id, extra}) => {
      const p = window.__rr;
      KCP.emit('peer:probe', Object.assign({year: '2022', state: p.state,
        save: p.save, q: p.qs[0], key: KCP.qkey(p.qs[0]), id}, extra));
    }""", {"id": card_id, "extra": extra})


def t_A1_structure(c: Ctx):
    infos = _room(c)
    cards = c.page.locator('.qdeck .qcard')
    rows = c.page.locator('.qx .pb-row')
    c.eq(cards.count(), 5, "A1 새 2022 질문 카드는 다섯 개다")
    c.eq(rows.count(), cards.count(), "A1 질문마다 말하기와 반문 도구를 둔다")
    for i in range(cards.count()):
        row = c.page.locator(f'.qx[data-qx="{i}"] .pb-row')
        c.eq(row.locator('.speak-go').count(), 1, "A1 각 도구 줄의 말하기 버튼은 하나다")
        c.eq(row.locator('[data-pb-open]').count(), 1, "A1 각 도구 줄의 반문 버튼은 하나다")
        button = row.locator('[data-pb-open]')
        c.eq(button.get_attribute('aria-expanded'), 'false', "A1 처음에는 반문 상자가 닫혀 있다")
        c.eq(button.get_attribute('aria-controls'), f'pb-box-{i}', "A1 펼침 버튼과 상자 번호를 연결한다")
        box = c.page.locator(f'#pb-box-{i}')
        box.wait_for(state="attached")
        c.expect(box.is_hidden(), "A1 처음에는 모든 반문 상자를 숨긴다")
        c.eq(box.inner_html(), '', "A1 기록 없는 상자는 열기 전 비어 있다")
    note = c.page.locator('#room-tools #pb-note')
    c.eq(note.count(), 1, "A1 도구 안내는 한 번만 붙인다")
    c.expect('미리 정해 둔 문장' in note.inner_text() and '판정하지 않습니다' in note.inner_text(),
             "A1 반문 선택 방식과 시간 기록의 의미를 안내한다")
    c.expect(c.page.locator('textarea[data-a="0"]').evaluate(
        "el => el.nextElementSibling.matches('.qx')"), "A1 답변 입력 바로 뒤에 슬롯을 둔다")
    c.expect(c.page.locator('#room-tools').evaluate(
        "el => el.nextElementSibling.matches('.qdeck')"), "A1 도구 슬롯 바로 뒤에 질문 목록을 둔다")
    c.eq(c.page.locator('.qcard .who [id^="pb-"], .qcard .who [class*="pb-"]').count(), 0,
         "A1 질문 머리 안에는 반문 요소를 넣지 않는다")
    c.expect(c.page.locator('.qx, #room-tools').evaluate_all("""slots => slots.every(slot =>
      [...slot.children].every(el => /^(jn|pb|pv|dr)-/.test(el.id) ||
        [...el.classList].some(name => /^(jn|pb|pv|dr)-/.test(name))))"""),
             "A1 슬롯의 모든 자식은 배정된 모듈 접두어를 가진다")
    c.eq(len(infos), cards.count(), "A1 계약 질문 목록과 카드 수가 같다")


def t_A2_open_close(c: Ctx):
    info = _room(c)[0]
    box = _open(c)
    card = info['deck'][0]
    c.eq(c.page.locator('[data-pb-open="0"]').get_attribute('aria-expanded'), 'true',
         "A2 열림 상태를 접근성 속성으로 표시한다")
    c.expect('반문 · ' + card['typeName'] in box.locator('.pb-head').inner_text(), "A2 반문 유형을 표시한다")
    c.eq(box.locator('.pb-head .tag-mine').inner_text(), '연습용 반문', "A2 반문에는 연습용 태그를 붙인다")
    c.eq(box.locator('.pb-card').inner_text(), card['text'], "A2 덱의 첫 반문을 표시한다")
    for sel in ('[data-pb-why="0"]', '.pb-starters', '.pb-was'):
        c.expect(box.locator(sel).is_hidden(), "A2 선택 전 이유와 예시와 이전 카드 안내를 숨긴다")
    for stance in ('revise', 'keep'):
        c.eq(box.locator(f'[data-pb-stance="{stance}"]').get_attribute('aria-pressed'), 'false',
             "A2 선택 전 두 선택 버튼은 눌리지 않는다")
    c.expect('비판적 의견을 수용하고' in box.locator('.pb-crit').inner_text(), "A2 2022 관련 평가 기준을 표시한다")
    c.eq(box.locator('.pb-crit .tag-official').inner_text(), '평가 기준', "A2 실제 기준만 공식 태그로 표시한다")
    c.eq(box.locator('.pb-nocrit').count(), 0, "A2 관련 기준이 있으면 기준 없음 안내를 넣지 않는다")
    c.page.locator('[data-pb-open="0"]').click()
    c.expect(box.is_hidden(), "A2 닫은 반문 상자는 숨긴다")
    c.eq(c.page.locator('[data-pb-open="0"]').get_attribute('aria-expanded'), 'false', "A2 닫힌 상태 속성을 갱신한다")
    c.eq(_probe(c, info['key']), None, "A2 열고 닫기만으로 반문 기록을 만들지 않는다")
    c.check("A2 반문 상자 닫힘")


def t_A3_deck_cycle(c: Ctx):
    info = _room(c)[0]
    box = _open(c)
    c.page.locator('[data-pb-next="0"]').click()
    c.eq(box.locator('.pb-card').inner_text(), info['deck'][1]['text'], "A3 다음 반문의 문장을 표시한다")
    c.expect(info['deck'][1]['typeName'] in box.locator('.pb-head').inner_text(), "A3 다음 반문의 유형을 표시한다")
    entry = _probe(c, info['key']) or {}
    c.eq(entry.get('card'), 1, "A3 덱 위치를 저장한다")
    c.eq(entry.get('q'), info['q']['q'], "A3 현재 질문 문장을 저장한다")
    for _ in range(len(info['deck']) - 1):
        c.page.locator('[data-pb-next="0"]').click()
    c.eq(box.locator('.pb-card').inner_text(), info['deck'][0]['text'], "A3 전체 덱을 넘기면 첫 반문으로 돌아온다")
    c.check("A3 덱 순환")


def t_A4_stance_contrast(c: Ctx):
    _room(c)
    _choose(c)
    box = c.page.locator('#pb-box-0')
    starters = c.page.evaluate('KCP.STARTERS')
    for stance in ('keep', 'revise', 'keep'):
        _choose(c, stance)
        other = 'revise' if stance == 'keep' else 'keep'
        c.eq(box.locator(f'[data-pb-stance="{stance}"]').get_attribute('aria-pressed'), 'true', "A4 현재 선택만 눌린 상태다")
        c.eq(box.locator(f'[data-pb-stance="{other}"]').get_attribute('aria-pressed'), 'false', "A4 다른 선택은 눌리지 않는다")
        why = box.locator('[data-pb-why="0"]')
        expected = ('반문이 짚은 점을 어떻게 다루고, 그래도 유지하는 이유는 무엇인가요?'
                    if stance == 'keep' else '무엇을 놓쳤고, 답을 어떻게 바꾸나요?')
        c.eq(why.get_attribute('placeholder'), expected, "A4 선택별 이유 안내 문구를 사용한다")
        c.eq(why.input_value(), '', "A4 말 시작 예시를 이유 입력에 자동 삽입하지 않는다")
        c.expect(box.locator('.pb-starters').is_visible(), "A4 선택 후 말 시작 예시를 보인다")
        text = box.locator('.pb-starters').inner_text()
        for sentence in starters[stance]:
            c.expect(sentence in text, "A4 선택에 맞는 모든 말 시작 예시를 표시한다")
        c.expect(starters[other][0] not in text, "A4 다른 선택의 말 시작 예시는 숨긴다")
    for sel in ('#pb-box-0 .pb-card', '#pb-box-0 .pb-starters', '#pb-note'):
        ratio = c.contrast(sel)
        c.expect(ratio is not None and ratio >= 4.5, "A4 반문과 예시와 안내 글자의 대비는 4.5 이상이다")
    c.check("A4 선택과 이유 입력")


def t_A5_save_isolation(c: Ctx):
    info = _room(c)[0]
    _choose(c)
    c.page.locator('[data-pb-why="0"]').fill(WHY)
    state = _state(c)
    entry = state.get('ext', {}).get('probe', {}).get(info['key'], {})
    c.eq(entry.get('stance'), 'keep', "A5 유지 선택을 저장한다")
    c.eq(entry.get('why'), WHY, "A5 이유 입력을 저장한다")
    c.eq(entry.get('pid'), info['deck'][0]['id'], "A5 이유를 적을 때 본 반문 식별자를 저장한다")
    c.eq(state.get('answers'), {}, "A5 반문 기록으로 기존 답변 메모를 바꾸지 않는다")
    c.expect(set(state.get('ext', {})).issubset({'jn', 'probe', 'peer'}), "A5 배정된 확장 상태 이름만 사용한다")
    c.expect('probe' in state.get('ext', {}), "A5 반문 상태는 probe에 저장한다")


def t_A6_record_pairing(c: Ctx):
    info = _paired(c)
    box = c.page.locator('#pb-box-0')
    was = box.locator('.pb-was')
    c.expect(was.is_visible(), "A6 기록 후 카드를 넘기면 앞 반문 안내를 보인다")
    c.expect(info['deck'][0]['text'] in was.inner_text(), "A6 선택과 이유가 원래 반문에 연결됨을 안내한다")
    c.eq(box.locator('[data-pb-why="0"]').input_value(), WHY, "A6 카드를 넘겨도 이유는 유지한다")
    c.eq(box.locator('[data-pb-stance="keep"]').get_attribute('aria-pressed'), 'true', "A6 카드를 넘겨도 선택은 유지한다")
    box.locator('[data-pb-own="0"]').fill('반대 집단은 누구인가')
    c.expect(was.is_hidden(), "A6 짝 반문이 있으면 카드 연결 안내를 숨긴다")
    box.locator('[data-pb-own="0"]').fill('')
    c.expect(was.is_visible(), "A6 짝 반문을 지우면 앞 카드 안내를 다시 보인다")
    c.check("A6 앞 반문 안내")


def t_A7_restore_and_fresh(c: Ctx):
    info = _paired(c)
    _state(c)
    c.page.reload()
    c.page.wait_for_selector('#pb-box-0 .pb-card')
    box = c.page.locator('#pb-box-0')
    c.expect(box.is_visible(), "A7 선택 기록이 있으면 복원한 상자를 연다")
    c.eq(c.page.locator('[data-pb-open="0"]').get_attribute('aria-expanded'), 'true', "A7 복원한 상자의 펼침 속성이 참이다")
    c.eq(box.locator('[data-pb-stance="keep"]').get_attribute('aria-pressed'), 'true', "A7 유지 선택을 복원한다")
    c.eq(box.locator('[data-pb-why="0"]').input_value(), WHY, "A7 이유를 복원한다")
    c.eq(box.locator('.pb-card').inner_text(), info['deck'][1]['text'], "A7 지금 보는 카드를 복원한다")
    _talk(c)
    c.expect(re.fullmatch(r'방금 0:0[12]', c.page.locator('#pb-time-0').inner_text()) is not None,
             "A7 새 말하기 결과는 방금으로 표시한다")
    c.check("A7 복원한 면접실")


def t_A8_reflection(c: Ctx):
    info = _paired(c)
    _reflect(c, "A8 성찰")
    panel = c.page.locator('#reflect-left #pb-reflect')
    c.eq(panel.count(), 1, "A8 성찰 왼쪽에 반문 패널을 한 번 붙인다")
    c.expect('반문 뒤의 선택' in panel.locator('h3').inner_text(), "A8 성찰 패널 제목을 표시한다")
    c.eq(panel.locator('h3 .tag-mine').inner_text(), '연습용 기록', "A8 성찰은 연습용 기록으로 표시한다")
    items = panel.locator('.pb-item')
    c.eq(items.count(), 1, "A8 선택한 질문만 성찰 목록에 표시한다")
    text = items.first.inner_text()
    for expected in ('선택: 유지', '이유: ' + WHY,
                     '반문(카드 · ' + info['deck'][0]['typeName'] + '): ' + info['deck'][0]['text']):
        c.expect(expected in text, "A8 성찰에는 답한 반문과 선택과 이유를 표시한다")
    c.expect(info['deck'][1]['text'] not in text, "A8 나중에 넘긴 카드를 선택 기록과 잘못 짝짓지 않는다")
    c.eq(panel.locator('button, .seg').count(), 0, "A8 성찰 자기 평가 바인딩과 섞이는 버튼을 넣지 않는다")
    c.expect('%' not in panel.inner_text() and '점수' not in panel.inner_text(), "A8 반문 성찰에 비율이나 점수를 붙이지 않는다")
    c.eq(panel.locator('.pb-old').count(), 0, "A8 이전 질문 기록이 없으면 이전 목록을 만들지 않는다")


def t_A9_copy_order(c: Ctx):
    _paired(c)
    _talk(c)
    _reflect(c, "A9 복사할 성찰")
    c.page.locator('textarea[id^="nextstep-"]').fill('결론 먼저')
    text = _copy(c)
    for expected in ('■ 반문과 답 수정', '선택: 유지', '이유: ' + WHY, '■ 말한 시간', 'Q1. 0:0'):
        c.expect(expected in text, "A9 복사 글에 반문 기록과 말한 시간을 포함한다")
    positions = [text.find(s) for s in ('■ 자기 평가', '■ 반문과 답 수정', '■ 다음 연습 목표')]
    c.expect(all(p >= 0 for p in positions) and positions == sorted(positions), "A9 반문 기록은 자기 평가 뒤와 다음 목표 앞에 둔다")
    compare = text.find('■ 예시와 비교')
    if compare >= 0:
        c.expect(compare < positions[1], "A9 통합 화면의 예시 비교 블록 뒤에 반문 기록을 둔다")


def t_B1_talk_history(c: Ctx):
    info = _room(c)[0]
    button = c.page.locator('#pb-speak-0 .speak-go')
    button.click()
    c.page.wait_for_function("document.querySelector('#pb-speak-0 .speak-t').textContent.includes('권장 1~3분')", timeout=500)
    c.page.wait_for_timeout(1200)
    button.click()
    c.expect(re.fullmatch(r'방금 0:0[12]', c.page.locator('#pb-time-0').inner_text()) is not None,
             "B1 첫 말한 시간은 방금으로 표시한다")
    c.eq(c.page.locator('#pb-speak-0 .speak-t').inner_text(), '', "B1 말하기가 끝나면 위젯 시간 줄을 비운다")
    _talk(c)
    c.expect('지난번 0:0' in c.page.locator('#pb-time-0').inner_text(), "B1 두 번째 결과에 지난번 시간을 함께 표시한다")
    _talk(c, ms=200)
    entry = _probe(c, info['key']) or {}
    c.eq(len(entry.get('talk', [])), 2, "B1 일 초 미만 말하기는 기록에 추가하지 않는다")
    for name in ('stance', 'why', 'own'):
        c.eq(entry.get(name), '', "B1 말한 시간만 기록해도 선택과 이유와 짝 반문은 빈 값이다")
    c.page.reload()
    c.page.wait_for_selector('#pb-time-0')
    text = c.page.locator('#pb-time-0').inner_text()
    c.expect(text.startswith('최근 ') and '방금' not in text, "B1 새로고침 뒤에는 최근으로 표시한다")
    c.expect(c.page.locator('#pb-box-0').is_hidden(), "B1 시간 기록만 있으면 반문 상자는 닫힌 상태다")
    c.check("B1 시간 기록 복원")


def t_B2_recommendation(c: Ctx):
    _room(c, '2024')
    # AUDIT-2024 §2 / A-2024 작업 3: 공통 4도 문항카드의 약 2~4분.
    for i, rec in ((0, '약 2~4분'), (3, '약 2~4분')):
        button = c.page.locator(f'#pb-speak-{i} .speak-go')
        button.click()
        c.page.wait_for_function("""({i, rec}) => document.querySelector('#pb-speak-' + i + ' .speak-t')
          .textContent.includes('권장 ' + rec)""", arg={"i": i, "rec": rec}, timeout=500)
        c.expect('권장 ' + rec in c.page.locator(f'#pb-speak-{i} .speak-t').inner_text(), "B2 질문의 time 필드에 맞는 권장 시간을 표시한다")
        button.click()
    infos = _room(c, '2025')
    divergent = [i for i, info in enumerate(infos) if '발산' in info['q'].get('tag', '')]
    c.expect(bool(divergent), "B2 2025 발산적 사고 질문도 권장 시간 검사에 포함한다")
    for i in range(len(infos)):
        button = c.page.locator(f'#pb-speak-{i} .speak-go')
        button.click()
        c.page.wait_for_function("""i => document.querySelector('#pb-speak-' + i + ' .speak-t')
          .textContent.includes('권장 1~3분')""", arg=i, timeout=500)
        text = c.page.locator(f'#pb-speak-{i} .speak-t').inner_text()
        c.expect('권장 1~3분' in text and '보고서' not in text, "B2 2025 질문의 보고서 메모를 권장 시간으로 쓰지 않는다")
        button.click()
    c.check("B2 2025 권장 시간")


def t_B3_year_decks(c: Ctx):
    infos = _room(c, '2025')
    box = _open(c)
    deck = infos[0]['deck']
    c.eq(len(deck), 8, "B3 2025 반문 덱은 여덟 장이다")
    excluded = c.page.evaluate("KCP.PROBES.filter(p => ['T2', 'F2'].includes(p.id)).map(p => p.text)")
    c.eq(box.locator('.pb-card').inner_text(), deck[0]['text'], "B3 2025 전용 덱의 첫 반문을 표시한다")
    for i in range(8):
        text = box.locator('.pb-card').inner_text()
        c.eq(text, deck[i]['text'], "B3 2025 덱 순서대로 반문을 넘긴다")
        c.expect(text not in excluded, "B3 2025 덱에서는 T2와 F2를 제외한다")
        c.page.locator('[data-pb-next="0"]').click()
    c.eq(box.locator('.pb-card').inner_text(), deck[0]['text'], "B3 여덟 번 넘기면 처음으로 돌아온다")
    for year in ('2025', '2026'):
        if year != '2025':
            _room(c, year)
        box = _open(c)
        c.eq(box.locator('.pb-crit').count(), 0, "B3 관련 항목 없는 해에는 공식 기준 줄을 넣지 않는다")
        c.eq(box.locator('.pb-nocrit').inner_text(),
             '이 해의 평가 기준표에는 비판 수용이나 한계 인정 항목이 따로 없습니다.', "B3 관련 기준이 없다는 사실을 안내한다")
        c.eq(box.locator('.pb-nocrit .tag-official, .pb-nocrit .tag-mine').count(), 0, "B3 기준 없음 안내에는 태그를 붙이지 않는다")
        c.check("B3 " + year + " 기준 안내")
    _room(c, '2024')
    c.expect('한계점을 인정하고' in _open(c).locator('.pb-crit').inner_text(), "B3 2024에는 한계 인정 평가 기준을 표시한다")


def t_B4_peer_event(c: Ctx):
    info = _room(c, capture=True)[0]
    deck = info['deck']
    _emit_peer(c, deck[3]['id'])
    c.eq((_probe(c, info['key']) or {}).get('card'), 3, "B4 짝 면접 이벤트의 반문 위치를 저장한다")
    c.expect(c.page.locator('#pb-box-0').is_hidden(), "B4 짝 면접 이벤트로 닫힌 상자를 열지 않는다")
    box = _open(c)
    c.eq(box.locator('.pb-card').inner_text(), deck[3]['text'], "B4 나중에 열면 이벤트로 지정한 반문이 보인다")
    _choose(c)
    c.page.locator('[data-pb-why="0"]').fill(WHY)
    _emit_peer(c, deck[4]['id'])
    c.expect(box.is_visible(), "B4 열린 상자는 이벤트 뒤에도 열린 상태다")
    c.eq(box.locator('.pb-card').inner_text(), deck[4]['text'], "B4 열린 상자의 반문을 즉시 갱신한다")
    c.expect(deck[4]['typeName'] in box.locator('.pb-head').inner_text(), "B4 열린 상자의 유형도 갱신한다")
    c.expect(box.locator('.pb-was').is_visible(), "B4 다른 반문으로 바뀌면 앞 선택 안내를 갱신한다")
    _emit_peer(c, 'ZZ9')
    entry = _probe(c, info['key']) or {}
    c.eq(entry.get('card'), 4, "B4 잘못된 반문 식별자는 무시한다")
    c.eq(entry.get('pid'), deck[3]['id'], "B4 짝 면접 이벤트로 기존 선택의 반문 식별자를 바꾸지 않는다")
    c.check("B4 이벤트로 바뀐 반문")


def t_B5_malformed_old(c: Ctx):
    info = _room(c)[0]
    _inject(c, '2022', {"phase": "room", "ext": {"probe": {
        info['key']: {"card": 99, "talk": "x", "stance": "maybe", "own": 5},
        "zz-old": {"q": "예전 질문", "card": 0, "pid": "C1", "own": "", "stance": "revise", "why": "예전 이유", "talk": []},
        "bad": 5,
    }}})
    c.goto('#y2022', wait='#pb-speak-0 .speak-go')
    c.expect(c.page.locator('#pb-box-0').is_hidden(), "B5 잘못된 선택과 짝 반문은 열린 기록으로 보지 않는다")
    c.eq(c.page.locator('#pb-time-0').inner_text(), '', "B5 배열 아닌 시간 기록은 빈 값으로 본다")
    c.eq(_open(c).locator('.pb-card').inner_text(), info['deck'][0]['text'], "B5 범위 밖 덱 위치는 첫 카드로 보정한다")
    _reflect(c, "B5 예전 질문 성찰")
    panel = c.page.locator('#pb-reflect')
    c.expect(panel.locator('.pb-empty').is_visible(), "B5 현재 질문의 유효한 선택이 없으면 빈 안내를 보인다")
    c.eq(panel.locator('.pb-old').inner_text(), '준비실을 바꾸기 전 질문', "B5 현재 없는 질문은 별도 소제목 아래 보인다")
    c.expect(panel.evaluate("el => Boolean(el.querySelector('.pb-empty').compareDocumentPosition(el.querySelector('.pb-old')) & Node.DOCUMENT_POSITION_FOLLOWING)"),
             "B5 이전 질문 소제목은 현재 목록 안내 뒤에 둔다")
    text = panel.locator('.pb-item').inner_text()
    for expected in ('예전 이유', '선택: 고침', '반문(카드 · '):
        c.expect(expected in text, "B5 이전 질문의 선택과 이유와 반문을 보존한다")
    copied = _copy(c)
    c.expect(0 <= copied.find('(준비실을 바꾸기 전 질문)') < copied.find('예전 이유'), "B5 복사 글도 이전 질문을 별도로 구분한다")


def t_B6_no_stance(c: Ctx):
    _room(c)
    _open(c).locator('[data-pb-own="0"]').fill('짝이 묻는 가상 반문')
    _reflect(c, "B6 선택 없는 성찰")
    panel = c.page.locator('#pb-reflect')
    c.eq(panel.locator('.pb-item').count(), 0, "B6 짝 반문만 적은 기록은 선택 성찰에 넣지 않는다")
    c.expect(panel.locator('.pb-empty').is_visible(), "B6 선택이 없으면 빈 목록 안내를 보인다")
    text = _copy(c)
    c.expect('■ 반문과 답 수정' not in text and '■ 말한 시간' not in text, "B6 선택과 시간 기록이 없으면 복사 블록을 만들지 않는다")


def t_B7_clear_during_talk(c: Ctx):
    info = _room(c)[0]
    button = c.page.locator('#pb-speak-0 .speak-go')
    button.click()
    c.page.wait_for_function("document.querySelector('#pb-speak-0 .speak-go').getAttribute('aria-pressed') === 'true'")
    c.page.wait_for_timeout(1200)
    c.goto('#home', wait='.home-grid')
    c.eq(len((_probe(c, info['key']) or {}).get('talk', [])), 1, "B7 화면을 떠나며 끝난 말하기는 한 번 저장한다")
    _room(c)
    c.page.locator('#pb-speak-0 .speak-go').click()
    c.page.wait_for_function("document.querySelector('#pb-speak-0 .speak-go').getAttribute('aria-pressed') === 'true'")
    c.page.wait_for_timeout(1200)
    c.page.evaluate('KCP.clearAll()')
    c.wait_saved(400)
    keys = c.page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('kcp:'))")
    c.eq(keys, [], "B7 모두 지운 뒤 반문 처리기가 기록을 다시 저장하지 않는다")
    c.check("B7 모두 지운 면접실")


def t_C1_overflow(c: Ctx):
    for year in ('2022', '2025'):
        infos = _room(c, year)
        for i in range(len(infos)):
            _choose(c, i=i)
            c.page.locator(f'[data-pb-own="{i}"]').fill('긴가상반문' * 35)
            c.page.locator(f'[data-pb-why="{i}"]').fill('긴가상이유' * 35)
        c.check("C1 " + year + " 모든 반문과 이유 열림")
        c.expect(c.page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'),
                 "C1 모든 반문을 열어도 문서에 가로 스크롤이 없다")
        _reflect(c, "C1 " + year + " 긴 기록 성찰")
        c.expect(c.page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'),
                 "C1 긴 반문 기록의 성찰에도 가로 스크롤이 없다")
        if c.cfg.mobile:
            for sel in ('.pb-item',):
                c.expect(c.page.locator(sel).first.evaluate('el => el.getBoundingClientRect().right <= document.documentElement.clientWidth'),
                         "C1 모바일 성찰 기록이 화면 폭 안에 놓인다")


def t_C2_no_errors(c: Ctx):
    # 전체 시나리오의 오류/경고는 main(globals())가 수집한다.
    errors = []
    c.page.on('pageerror', lambda error: errors.append(str(error)))
    c.page.on('console', lambda msg: errors.append(msg.text)
              if msg.type in ('warning', 'error') and 'fonts.g' not in msg.text else None)
    info = _room(c, capture=True)[0]
    _emit_peer(c, 'ZZ9')
    _emit_peer(c, info['deck'][0]['id'], state=None)
    _emit_peer(c, info['deck'][0]['id'], save=None)
    _emit_peer(c, info['deck'][0]['id'], q=None)
    _emit_peer(c, info['deck'][0]['id'], key=None)
    _emit_peer(c, None)
    _open(c)
    c.eq(errors, [], "C2 없는 payload와 잘못된 식별자를 조용히 무시한다")
    c.eq(_probe(c, info['key']), None, "C2 잘못된 이벤트는 반문 항목을 만들지 않는다")
    c.check("C2 잘못된 이벤트 뒤 면접실")


def t_C3_core_compatibility(c: Ctx):
    """원본 baseline 전체 실행은 별도 필요. 통합 가능한 핵심 호환 검사."""
    _room(c)
    answer = '가상 답변 메모'
    c.page.locator('textarea[data-a="0"]').fill(answer)
    _choose(c)
    c.page.locator('[data-pb-why="0"]').fill('가상 반문 이유')
    c.eq(_state(c).get('answers', {}).get('0'), answer, "C3 기존 답변 메모 입력과 저장을 유지한다")
    _reflect(c, "C3 기존 자기 평가 화면")
    rubric = c.page.locator('table.rubric')
    rubric.wait_for(state='visible')
    c.expect(rubric.count() == 1, "C3 기존 자기 평가 표 선택자를 유지한다")
    buttons = c.page.locator('table.rubric .seg button[data-v]')
    c.expect(buttons.count() > 0, "C3 기존 자기 평가 선택 버튼을 유지한다")
    buttons.first.click()
    c.eq(buttons.first.get_attribute('aria-pressed'), 'true', "C3 반문 버튼과 기존 자기 평가 버튼 바인딩을 구분한다")
    c.expect(c.page.locator('#rsum').inner_text().startswith('점검 1/9'), "C3 통합 화면의 자기 평가 점검 표기를 유지한다")
    for sel in ('textarea[id^="nextstep-"]', '#copyAll', '#resetAll', '#clock', '#tgo', '#treset'):
        c.eq(c.page.locator(sel).count(), 1, "C3 기존 성찰과 타이머 선택자를 유지한다")
    c.page.locator('#resetAll').click()
    c.page.locator('#confirmReset').wait_for(state='visible')
    c.page.locator('#noReset').click()
    c.expect(c.page.locator('#confirmReset').is_hidden(), "C3 기존 기록 지우기 취소 동작을 유지한다")


def _css_selectors(source):
    """주석/문자열을 가리고 중첩 @media까지 각 규칙의 머리를 찾는다."""
    masked = re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group()), source, flags=re.S)
    masked = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
                    lambda m: ' ' * len(m.group()), masked)
    start = 0
    selectors = []
    at_rules = []
    for match in re.finditer(r'[{};]', masked):
        token = match.group()
        if token == '{':
            head = masked[start:match.start()].strip()
            if head.startswith('@'):
                at_rules.append(head)
            elif head:
                selectors.extend(part.strip() for part in head.split(','))
        start = match.end()
    return selectors, at_rules


def t_C4_static_contract(c: Ctx):
    js_response = c.page.request.get(urljoin(c.page.url, 'ext/probe.js'))
    css_response = c.page.request.get(urljoin(c.page.url, 'ext/probe.css'))
    c.eq(js_response.status, 200, "C4 대상 서버의 반문 자바스크립트 파일을 읽는다")
    c.eq(css_response.status, 200, "C4 대상 서버의 반문 스타일 파일을 읽는다")
    js, css = js_response.text(), css_response.text()
    try:
        result = subprocess.run(['node', '--check'], input=js, text=True, capture_output=True, timeout=15)
        c.eq(result.returncode, 0, "C4 반문 자바스크립트 문법 검사가 통과한다")
    except (OSError, subprocess.TimeoutExpired):
        c.expect(False, "C4 실행 환경에 Node가 없거나 문법 검사가 제한 시간 안에 끝나지 않았다")
    forbidden = r'console\.(log|warn|error)|getUserMedia|MediaRecorder|SpeechRecognition|localStorage|KCP\.store|setSettings|\.answers|\.rec\b'
    c.eq(re.findall(forbidden, js), [], "C4 금지된 로그와 녹음과 저장 및 답변 접근을 사용하지 않는다")
    attributes = r'data-(?:v|k|a|tab|phase|mode|cell|tool|ov|del|node|hex|inc|toggle|match|fact|sel|slot|up|down|tot|pick|to|r1|note|qx|stale|tm|think)\b'
    c.eq(re.findall(attributes, js), [], "C4 기존 회귀 선택자와 겹치는 데이터 속성을 새로 쓰지 않는다")
    selectors, at_rules = _css_selectors(css)
    c.expect(bool(selectors), "C4 반문 스타일에 실제 규칙이 있다")
    c.eq([s for s in selectors if not re.match(r'^[.#]pb-[a-zA-Z0-9_-]+', s)], [],
         "C4 쉼표로 나눈 모든 스타일 선택자는 반문 접두어로 시작한다")
    c.eq([a for a in at_rules if re.match(r'@(?:\w+-)?keyframes\b|@(?:font-face|property|import)\b', a)], [],
         "C4 전역 스타일과 키프레임을 선언하지 않는다")
    c.expect(re.search(r'--[\w-]+\s*:', css) is None, "C4 공통 색상 변수를 재정의하지 않는다")
    bad_lines = []
    for line in re.sub(r'/\*.*?\*/', '', css, flags=re.S).splitlines():
        if line.lstrip().startswith(('.pb-', '#pb-')) and ',' in line:
            parts = [p.strip() for p in line.split('{', 1)[0].split(',')]
            if sum(bool(p) for p in parts) > 1:
                bad_lines.append(line.strip())
    c.eq(bad_lines, [], "C4 쉼표로 이은 선택자는 줄마다 하나씩 작성한다")


def t_B2_divergent_report_guard(c: Ctx):
    """추가 요청: 2025 발산적 사고 카드의 rec를 시간으로 쓰지 않는다."""
    infos = _room(c, '2025')
    indices = [i for i, p in enumerate(infos) if '발산' in p['q'].get('tag', '')]
    c.expect(bool(indices), "B2 2025 발산적 사고 카드가 검사 대상에 존재한다")
    for i in indices:
        c.page.locator(f'#pb-speak-{i} .speak-go').click()
        c.page.wait_for_function("""i => document.querySelector('#pb-speak-' + i + ' .speak-t')
          .textContent.includes('말하는 중')""", arg=i, timeout=500)
        text = c.page.locator(f'#pb-speak-{i} .speak-t').inner_text()
        c.expect('보고서' not in text, "B2 발산적 사고 권장 표시에는 보고서 문구를 넣지 않는다")
        c.expect('권장 1~3분' in text, "B2 발산적 사고의 기본 권장 시간은 일 분에서 삼 분이다")
        c.page.locator(f'#pb-speak-{i} .speak-go').click()
    c.check("B2 발산적 사고 말해 보기")


def t_B3_original_s_test(c: Ctx):
    """추가 요청: 계약으로 등록한 가상 창작 게임에서도 같은 기능을 검사."""
    c.goto('#home', wait='.home-grid')
    c.page.evaluate("""() => {
      KCP.YEARS['s-test'] = Object.assign({}, KCP.YEARS['2022'], {
        title: '가상 창작 판단', format: '가상 자료 판단', desc: '수용 검사용 가상 게임',
        prep: 15, answer: 8, mode: '가상 연습',
        original: true, topics: [], concepts: []
      });
      KCP.games['s-test'] = Object.assign({}, KCP.games['2022'], {
        questions: () => [{k: 's-test-q1', tag: '판단', q: '가상 선택의 이유는 무엇인가요?'}]
      });
      if (!KCP.ORIGINAL_ORDER.includes('s-test')) KCP.ORIGINAL_ORDER.push('s-test');
    }""")
    infos = _room(c, 's-test')
    c.eq(len(infos), 1, "B3 가상 창작 게임의 질문을 면접실에 그린다")
    c.eq(len(infos[0]['deck']), 10, "B3 창작 게임에는 일반 열 장 덱을 사용한다")
    box = _open(c)
    c.eq(box.locator('.pb-card').inner_text(), infos[0]['deck'][0]['text'], "B3 창작 게임에서도 반문 상자를 연다")
    c.page.locator('[data-pb-next="0"]').click()
    c.eq(box.locator('.pb-card').inner_text(), infos[0]['deck'][1]['text'], "B3 창작 게임에서도 다음 반문으로 넘긴다")
    _choose(c, 'revise')
    c.page.locator('[data-pb-why="0"]').fill('가상 조건을 반영해 고친다')
    entry = _probe(c, 's-test-q1', 's-test') or {}
    c.eq(entry.get('stance'), 'revise', "B3 창작 게임의 반문 선택도 해당 게임 키에 저장한다")
    c.eq(entry.get('pid'), infos[0]['deck'][1]['id'], "B3 창작 게임에서도 답한 반문을 기록한다")
    _talk(c)
    c.expect(len((_probe(c, 's-test-q1', 's-test') or {}).get('talk', [])) == 1,
             "B3 창작 게임에서도 말한 시간을 기록한다")
    _reflect(c, "B3 창작 게임 성찰")
    c.expect('가상 조건을 반영해 고친다' in c.page.locator('#pb-reflect').inner_text(), "B3 창작 게임 성찰에도 이유를 표시한다")
    c.expect('■ 반문과 답 수정' in _copy(c), "B3 창작 게임에서도 반문 기록을 복사한다")


def t_A2_keyboard_labels(c: Ctx):
    _room(c)
    button = c.page.locator('[data-pb-open="0"]')
    button.focus()
    c.page.keyboard.press('Enter')
    c.page.locator('#pb-box-0 .pb-card').wait_for(state='visible')
    c.eq(button.get_attribute('aria-expanded'), 'true', "A2 키보드로 반문 상자를 열 수 있다")
    next_button = c.page.locator('[data-pb-next="0"]')
    next_button.focus()
    c.page.keyboard.press('Enter')
    next_button.press('Tab')
    c.eq(c.page.evaluate('document.activeElement.id'), 'pb-own-0', "A2 반문 넘기기 뒤 탭으로 짝 반문 입력에 간다")
    c.page.keyboard.type('가상 짝 반문')
    c.page.keyboard.press('Tab')
    c.expect(c.page.evaluate("document.activeElement.matches('[data-pb-stance=revise][data-pb-i=\"0\"]')"),
             "A2 짝 반문 입력 뒤 탭으로 수정 선택에 간다")
    c.page.keyboard.press('Space')
    c.page.locator('[data-pb-why="0"]').wait_for(state='visible')
    c.page.keyboard.press('Tab')
    c.page.keyboard.press('Tab')
    c.eq(c.page.evaluate('document.activeElement.id'), 'pb-why-0', "A2 두 선택 버튼 다음 탭으로 이유 입력에 간다")
    c.page.keyboard.type('가상 키보드 이유')
    c.eq(c.page.locator('[data-pb-why="0"]').input_value(), '가상 키보드 이유', "A2 키보드만으로 이유를 입력한다")
    box = c.page.locator('#pb-box-0')
    for field in ('own', 'why'):
        c.eq(box.locator(f'label[for="pb-{field}-0"]').count(), 1, "A2 각 입력은 연결된 레이블을 하나 가진다")
    c.eq(box.locator('[role="group"][aria-label="반문에 대한 내 선택"]').count(), 1,
         "A2 선택 버튼 그룹에 접근성 이름을 단다")
    c.eq(c.page.locator('.pb-row button:not([type="button"]), .pb-box button:not([type="button"])').count(), 0,
         "A2 반문과 말하기 버튼은 모두 일반 버튼이다")
    c.check("A2 키보드 반문 기록")


def t_B5_normalize_and_cap(c: Ctx):
    info = _room(c)[0]
    _inject(c, '2022', {"phase": "room", "ext": {"probe": {info['key']: {
        "q": 8, "card": -1, "pid": "ZZ9", "own": {}, "stance": None, "why": 5,
        "talk": [1.9, 600, 0, -1, 601, "7", None, 2.8, 3.4, 4.5, 5.9, 6.1],
    }}}})
    c.goto('#y2022', wait='#pb-speak-0 .speak-go')
    c.expect(c.page.locator('#pb-box-0').is_hidden(), "B5 보정된 선택 없는 항목은 상자를 열지 않는다")
    c.eq(c.page.locator('#pb-time-0').inner_text(), '최근 0:01 · 지난번 10:00', "B5 유효한 시간만 정수로 보정해 표시한다")
    box = _open(c)
    c.page.locator('[data-pb-next="0"]').click()
    entry = _probe(c, info['key']) or {}
    c.eq(entry.get('talk'), [1, 600, 2, 3, 4], "B5 시간 기록을 범위 검사하고 앞의 다섯 개로 제한한다")
    for field in ('pid', 'own', 'why', 'stance'):
        c.eq(entry.get(field), '', "B5 잘못된 문자열과 선택을 빈 값으로 보정한다")
    c.eq(entry.get('card'), 1, "B5 잘못된 덱 위치를 보정한 뒤 다음 카드로 기록한다")
    c.eq(entry.get('q'), info['q']['q'], "B5 기록 때 질문 문장을 현재 값으로 맞춘다")
    c.expect(box.locator('.pb-was').is_hidden(), "B5 유효한 이전 반문 기록이 없으면 앞 카드 안내를 숨긴다")
    _talk(c)
    entry = _probe(c, info['key']) or {}
    c.eq(len(entry.get('talk', [])), 5, "B5 새 말하기를 추가해도 시간 기록은 최대 다섯 개다")
    c.eq(entry.get('talk', [])[1:], [1, 600, 2, 3], "B5 새 시간은 앞에 넣고 가장 오래된 시간을 버린다")
    c.check("B5 보정한 기록")


def t_B5_fixed_question_key(c: Ctx):
    info = _room(c)[0]
    _choose(c)
    c.page.locator('[data-pb-why="0"]').fill('문장이 바뀌어도 이어질 가상 이유')
    _state(c)
    c.page.evaluate("""() => {
      const questions = KCP.games['2022'].questions;
      KCP.games['2022'].questions = state => questions(state).map((q, i) =>
        i === 0 ? Object.assign({}, q, {q: '숫자와 이름이 바뀐 가상 질문'}) : q);
      KCP.rerender();
    }""")
    c.page.wait_for_selector('#pb-box-0 .pb-card')
    c.eq(c.page.locator('[data-pb-why="0"]').input_value(), '문장이 바뀌어도 이어질 가상 이유',
         "B5 질문 문장이 바뀌어도 고정 키의 선택 기록을 이어 쓴다")
    c.page.locator('[data-pb-why="0"]').fill('바뀐 질문에서 적은 가상 이유')
    entry = _probe(c, info['key']) or {}
    c.eq(entry.get('q'), '숫자와 이름이 바뀐 가상 질문', "B5 같은 키의 다음 기록에 현재 질문 문장을 저장한다")
    c.eq(entry.get('stance'), 'keep', "B5 질문 문장이 바뀌어도 이전 선택을 유지한다")
    c.check("B5 문장이 바뀐 질문")


def t_A8_escape_and_own(c: Ctx):
    _room(c)
    _choose(c, 'revise')
    payload = '<svg onload="window.__pb_xss = 1"></svg>가상 입력'
    c.page.add_init_script('window.__pb_xss = 0')
    c.page.evaluate('window.__pb_xss = 0')
    c.page.locator('[data-pb-own="0"]').fill(payload)
    c.page.locator('[data-pb-why="0"]').fill(payload)
    _state(c)
    c.page.reload()
    c.page.wait_for_selector('#pb-box-0 .pb-card')
    c.eq(c.page.locator('[data-pb-own="0"]').input_value(), payload, "A8 짝 반문의 특수 문자를 원문 그대로 복원한다")
    c.eq(c.page.locator('[data-pb-why="0"]').input_value(), payload, "A8 이유의 특수 문자를 원문 그대로 복원한다")
    _reflect(c, "A8 특수 문자 기록 성찰")
    text = c.page.locator('#pb-reflect .pb-item').inner_text()
    c.expect('반문(짝): ' + payload in text and '이유: ' + payload in text,
             "A8 짝 반문과 이유를 실행 가능한 마크업으로 바꾸지 않는다")
    c.eq(c.page.locator('#pb-reflect .pb-item svg').count(), 0, "A8 입력한 태그가 성찰 요소로 삽입되지 않는다")
    c.eq(c.page.evaluate('window.__pb_xss'), 0, "A8 저장한 입력의 이벤트 코드를 실행하지 않는다")
    c.expect('반문(짝): ' + payload in _copy(c), "A8 복사 글은 짝 반문 원문을 보존한다")


if __name__ == '__main__':
    main(globals())
