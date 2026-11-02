"""V5-s1-cards.md §1·3·4 수용 검사 초안. 작성 세션에서는 실행하지 않는다.

총괄의 샌드박스 밖 로컬 실행:
  tests/.venv/bin/python tests/league/s1cards.py http://127.0.0.1:9430/index.html
서버는 기존 tests/srv.py 사용. UI로 진행하되 390 접힘 검사만 지난달 기기 근거 메모를 조정한다.
"""

import sys
from urllib.parse import urljoin

from playwright.sync_api import expect, sync_playwright

from d82ux import click_tile, point
from econui import (Checks, context_for, diagnostics, local_address, monitored_page,
                    open_panel, overflow, screenshot, shown)
from fx_map import tool
from league_flow import select_mode, start_solo, wait_unfolded
from solo import click_next, close_drawer, read

# 2026-10-21 Node 검산: C.newState('S1CARDS','south',0,
# ['pyeongtaek','dangjin','asan'], {turns:12,seedMode:'fixed'}), 매달 host('next')
# → normalStartPlans → C.run. seedKey='0', 1월 반도체 증설+미세먼지 규제,
# 2·3월 finedust_coal_cap만, 4월 events=[], 5월 증설, 6월 events=[].
# 41-v5-s1.js의 독립 Node 검사도 2·3·4월을 재확인한다.
NO_EVENT_MONTH = 4
ORDER = ('저녁 수요', '풍속', '접속 여유', 'LNG', '이웃 정전')


def required(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError(label)


def current_note(page):
    return page.evaluate("""() => {
      const L=KCP.league.state(), save=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
      return save?.interview?.interview?.months?.[(L.S||L.snap).round] || {};
    }""")


def check_width(checks, page, label):
    overflow(checks, page, label)
    extra = page.locator('#lg-panel').evaluate('el => el.scrollWidth-el.clientWidth')
    required(checks, extra <= 0, label + ' 서랍 가로 넘침 0')


def card_key(card):
    text = card.text_content() or ''
    return next(name for name in ORDER if name in text)


def promise_text(short_name):
    # 명세의 짧은 단추 이름과 받침 규칙. 제품의 withParticle은 호출하지 않는다.
    name = 'LNG 지수' if short_name == 'LNG' else short_name
    last = ord(name[-1])
    if not 0xac00 <= last <= 0xd7a3:
        raise AssertionError('근거의 짧은 이름은 한글 음절로 끝나야 함')
    jongseong = (last - 0xac00) % 28
    particle = '로' if jongseong in (0, 8) else '으로'
    return f'{name}{particle} 약속하기'


def add_grid_connection(checks, page, label):
    # 3월에 화면으로 태양광 1기를 추가한다. 4월에는 지난달 접속 처리로
    # 접속 여유가 변하므로 grid 후보를 검증할 수 있다. 저장/결과 주입 없음.
    close_drawer(page)
    tool(page, 'solar')
    tiles = page.evaluate("""() => {
      const B=KCP.buildGame, used=new Set(B.current().builds.map(b=>b.i));
      return B.TILES.filter(t=>!t.out && t.site<0 && !used.has(t.i) &&
        !B.siteRule('solar',t)).map(t=>t.i);
    }""")
    required(checks, bool(tiles), label + ' 태양광 추가용 합법적 빈 칸')
    # 서랍 닫기·도구 선택 뒤 현재 화면에서 바로 누를 수 있는 칸을 우선한다.
    # 모두 가려진 경우에만 첫 후보를 click_tile의 지도 드래그로 드러낸다.
    tile = tiles[0]
    for candidate in tiles:
        xy = point(page, candidate)
        if page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.id==='bd-canvas'", xy):
            tile = candidate
            break
    count = page.evaluate('() => KCP.buildGame.current().builds.length')
    click_tile(page, tile)
    page.wait_for_function('n => KCP.buildGame.current().builds.length === n+1', arg=count)
    required(checks, page.evaluate('i => KCP.buildGame.current().builds.some(b=>b.i===i && b.t==="solar")', tile),
             label + ' 화면 조작으로 태양광 1기 추가')


def scenario(checks, page, base, width, label):
    page.goto(base + '#league')
    # 선택 버튼은 기존 로비 계약(data-select/data-value)을 사용한다.
    # 새 컨텍스트이므로 이어 하기·이전 선택 기록이 없다.
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    wanted = {'pyeongtaek', 'dangjin', 'asan'}
    for box in page.locator('[data-solo-city]').all():
        enabled = box.get_attribute('data-solo-city') in wanted
        if box.is_enabled():
            box.set_checked(enabled)
        else:
            required(checks, box.is_checked() == enabled, label + ' 고정 참가 도시 전제')
    settings = page.locator('#lg-solo .lg-extra-settings')
    settings.locator('summary').click()
    page.locator('#lg-solo-seed').select_option('fixed')
    page.locator('#lg-solo-practice').select_option('free')
    page.locator('[data-select="lg-solo-style"][data-value="balanced"]').click()
    start_solo(page, 12)
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()
    observation = read(page)
    required(checks, observation['S'].get('seedKey') == '0', label + ' 고정 씨앗 0')
    for _ in range(12):
        state = observation['S']
        if state['round'] == NO_EVENT_MONTH and state['phase'] == 'plan':
            break
        required(checks, state['round'] <= NO_EVENT_MONTH, label + ' 목표 달 이전의 정상 흐름')
        if state['round'] == NO_EVENT_MONTH - 1 and state['phase'] == 'plan':
            add_grid_connection(checks, page, label)
        observation = click_next(page, state)
    else:
        raise AssertionError('12번 진행 안에 사건 없는 4월 계획 단계에 도착하지 못함')
    state = observation['S']
    required(checks, not [e for e in state['events'] if e['round'] == state['round']],
             label + ' 4월 사건 0개(상수 전제 재확인)')
    if width <= 760:
        # 변화 0·연결 없음인 세 번째 후보를 빼는 새 규칙에서도 접힘을 검사한다.
        # 세 근거 모두 지난달과 다르게 하되 공개 상태·이번 달 관측값은 유지한다.
        # 앱을 먼저 떠나 pagehide 저장을 끝내야 수정한 기기 메모가 덮어써지지 않는다.
        page.goto(urljoin(base, 'README.md'))
        page.evaluate("""() => {
          const key='kcp-league-solo-v1', save=JSON.parse(localStorage.getItem(key));
          const months=save.interview.interview.months, round=save.state.round;
          const current=months[round], previous=months[round-1];
          for (const key of ['evening', 'grid', 'neighbor'])
            previous.s1EvidenceValues[key]=current.s1EvidenceValues[key]+1;
          previous.s1EvidenceNeighborId=current.s1EvidenceNeighborId;
          localStorage.setItem(key, JSON.stringify(save));
        }""")
        page.goto(base + '#league/solo')
        expect(page.locator('#lg-bar')).to_be_visible()
        if shown(page, '#lg-guide-close'):
            page.locator('#lg-guide-close').click()
    open_panel(page, 'deal')
    focus = page.locator('#lg-evidence-focus')
    expect(focus).to_be_visible()
    group = focus.get_by_role('group', name='근거 후보', exact=True)
    expect(group).to_be_visible()
    cards = group.get_by_role('button', include_hidden=True)
    count = cards.count()
    required(checks, count in (2, 3), label + ' 후보 2~3개')
    names = [card_key(cards.nth(i)) for i in range(count)]
    if width == 1280:
        required(checks, count == 2 and '이웃 정전' not in names,
                 label + ' 변화 0·연결 없음인 이웃 정전 제외 뒤 후보 2개')
    required(checks, not any(b['t'] in ('wind', 'offshore')
                             for b in page.evaluate('() => KCP.buildGame.current().builds')),
             label + ' 기본 혼자 계획에 육상·해상 풍력 없음')
    expect(group.locator('#lg-s1-wind')).to_have_count(0)
    required(checks, '풍속' not in names, label + ' 풍력 없는 계획에는 풍속 후보 없음')
    required(checks, names == sorted(set(names), key=ORDER.index), label + ' 후보 중복 없이 고정 순서')
    expect(group.locator('#lg-s1-grid')).to_have_count(1)
    basis = focus.locator('p#lg-s1-grid-basis')
    expect(page.locator('#lg-s1-grid-basis')).to_have_count(1)
    expect(basis).to_be_visible()
    required(checks, basis.evaluate('el => !el.closest("details, [role=group]")'),
             label + ' 접속 기준 문장은 카드 묶음·접힘 밖')
    s1_grid_basis = basis.text_content()
    required(checks, bool(s1_grid_basis) and '새 접속' in s1_grid_basis and '지도 칩' in s1_grid_basis,
             label + ' 접속 전 값·지도 칩 기준 설명')
    required(checks, '다를 수 있어요' in s1_grid_basis, label + ' S1 양방향 차이 설명 포함')
    required(checks, '더 작을 수' not in s1_grid_basis, label + ' S1 한 방향 설명 없음')
    required(checks, '보통' not in s1_grid_basis, label + ' S1 측정 근거 없는 빈도 설명 없음')
    expect(group.locator('#lg-s1-grid')).to_have_attribute('aria-describedby', 'lg-s1-grid-basis')
    required(checks, all(cards.nth(i).get_attribute('aria-pressed') == 'false' for i in range(count)),
             label + ' 처음에는 아무 카드도 고르지 않음')
    promise = focus.get_by_role('button', name='근거를 하나 고르면 약속으로 이어져요', exact=True)
    expect(promise).to_be_disabled()
    check_width(checks, page, label + ' 고르기 전')

    fold = focus.locator('details').filter(has=page.get_by_text('후보 하나 더', exact=True))
    if count == 2:
        expect(fold).to_have_count(0)
    if width <= 760:
        # 이 검산 판에서 3개가 나오지 않으면 접힘 검증을 통과로 처리하지 않는다.
        required(checks, count == 3, label + ' 좁은 화면 접힘 검증용 후보 3개')
        expect(fold).to_have_count(1)
        summary = fold.locator('summary')
        expect(summary).to_have_text('후보 하나 더')
        expect(summary).to_be_visible()
        expect(fold).not_to_have_attribute('open', '')
        expect(basis).to_be_visible()
        required(checks, basis.is_visible(), label + ' 390 접힘을 열기 전 기준 문장 표시')
        required(checks, summary.bounding_box()['height'] >= 44, label + ' summary 높이 44px')
        folded = fold.get_by_role('button', include_hidden=True)
        expect(folded).to_have_count(1)
        required(checks, card_key(folded) == names[-1], label + ' 고정 순서 마지막 카드만 접힘')
        expect(cards.nth(0)).to_be_visible()
        expect(cards.nth(1)).to_be_visible()
        expect(folded).to_be_hidden()
        summary.click()
        expect(fold).to_have_attribute('open', '')
        expect(folded).to_be_visible()
        check_width(checks, page, label + ' 후보 하나 더 펼친 뒤')
        chosen_index = count - 1
        chosen = folded
    else:
        if count == 3:
            expect(fold).to_have_count(1)
            summary = fold.locator('summary')
            expect(summary).to_have_text('후보 하나 더')
            expect(summary).to_be_hidden()
            expect(fold).to_have_attribute('open', '')
        for i in range(count):
            expect(cards.nth(i)).to_be_visible()
        chosen_index = 0
        chosen = cards.nth(chosen_index)

    chosen_name = card_key(chosen)
    chosen.click()
    # 다시 그려진 DOM에서 같은 공개 역할·문구를 조회한다.
    cards = page.locator('#lg-evidence-focus').get_by_role('group', name='근거 후보').get_by_role('button', include_hidden=True)
    required(checks, card_key(cards.nth(chosen_index)) == chosen_name, label + ' 선택한 카드 이름 유지')
    expect(cards.nth(chosen_index)).to_have_attribute('aria-pressed', 'true')
    required(checks, all(cards.nth(i).get_attribute('aria-pressed') == 'false'
                         for i in range(count) if i != chosen_index),
             label + ' 고른 카드만 true')
    promise_name = promise_text(chosen_name)
    promise = page.locator('#lg-evidence-focus').get_by_role('button', name=promise_name, exact=True)
    expect(promise).to_be_enabled()
    expect(promise).to_have_text(promise_name)
    pick = current_note(page).get('s1Pick')
    expected_pick = dict(zip(ORDER, ('evening', 'wind', 'grid', 'fuel', 'neighbor')))[chosen_name]
    required(checks, pick == expected_pick, label + ' 선택한 카드 키를 이 달 s1Pick에 저장')
    expect(page.locator('#lg-watch')).to_contain_text(chosen_name)
    check_width(checks, page, label + ' 카드 선택 뒤')
    screenshot(checks, page, f's1cards-{label}-picked.png')

    # 새로고침에도 같은 달 선택 유지. 실제 브라우저 저장·재시작 경로를 확인한다.
    page.reload()
    expect(page.locator('#lg-bar')).to_be_visible()
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()
    open_panel(page, 'deal')
    pressed = page.locator('#lg-evidence-focus [role="group"][aria-label="근거 후보"] button[aria-pressed="true"]')
    expect(pressed).to_have_count(1)
    required(checks, card_key(pressed) == chosen_name and current_note(page).get('s1Pick') == pick,
             label + ' 새로고침 뒤 선택 유지')
    page.locator('#lg-evidence-focus').get_by_role('button', name=promise_name, exact=True).click()
    wait_unfolded(page)
    expect(page.locator('#lg-panel')).to_have_attribute('data-tab', 'journal')
    s4_grid_basis = page.locator('#lg-evidence-grid-basis')
    expect(s4_grid_basis).to_have_count(1)
    s4_grid_basis_text = s4_grid_basis.text_content()
    required(checks, s4_grid_basis_text == s1_grid_basis,
             label + ' 같은 달 S1·S4 접속 기준 글자 완전 동일')
    required(checks, '다를 수 있어요' in s4_grid_basis_text, label + ' S4 양방향 차이 설명 포함')
    required(checks, '더 작을 수' not in s4_grid_basis_text, label + ' S4 한 방향 설명 없음')
    required(checks, '보통' not in s4_grid_basis_text, label + ' S4 측정 근거 없는 빈도 설명 없음')
    chip = page.locator(f'#lg-evidence [data-evidence="{pick}"]')
    expect(chip).to_have_attribute('aria-pressed', 'true')
    required(checks, (chip.get_attribute('aria-label') or '').endswith(' · S1에서 고름'),
             label + ' S4 선택 칩 접근성 이름에 S1 표지')
    required(checks, current_note(page).get('evidence', {}).get('key') == pick, label + ' 약속 근거 저장')
    expect(page.locator('#lg-evidence')).to_contain_text('S1에서 고름')
    check_width(checks, page, label + ' 일지 약속 연결 뒤')
    screenshot(checks, page, f's1cards-{label}-journal.png')
    close_drawer(page)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height, scheme in ((1280, 900, 'light'), (390, 844, 'dark')):
                label = f'{width}x{height}-{scheme}'
                context, external = context_for(browser, base, width, height, scheme)
                page, events = monitored_page(context)
                try:
                    scenario(checks, page, base, width, label)
                except Exception as exc:
                    checks.ok(False, f'{label} {type(exc).__name__}: {(str(exc) or repr(exc)).splitlines()[0][:250]}')
                    screenshot(checks, page, f's1cards-{label}-failure.png')
                finally:
                    diagnostics(checks, events, label)
                    checks.ok(not external, label + ' 외부 전송 0')
                    context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f'실행 환경: {type(exc).__name__}: {(str(exc) or repr(exc)).splitlines()[0][:250]}')
    raise SystemExit(checks.finish())


if __name__ == '__main__':
    main()
