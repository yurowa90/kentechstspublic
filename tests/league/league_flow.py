"""U5 로비·자리 선택의 공용 브라우저 조작. 엔진 API로 참가를 우회하지 않는다."""

import re
from contextlib import contextmanager

from playwright.sync_api import expect


@contextmanager
def map_key_visible(page, selector):
    """rev12 Q2: ≤1100px 계획에서만 같은 범례 줄을 펼쳐 검사하고 접힘을 복원한다.

    경고 접속 여유는 열지 않는다. 이때 기존 visible 단언이 상자 밖 표시를 검증한다.
    <summary>는 button role 대신 명세 K1a 속성으로 찾는다.
    """
    if selector not in ('#lg-lens-grid', '#bd-town-look-key'):
        yield
        return
    planning = page.evaluate("""() => { const L=KCP.league.state();
      return (L.S || L.snap)?.phase === 'plan'; }""")
    node = page.locator(selector)
    opened, previous_focus = None, None
    if (page.viewport_size['width'] <= 1100 and planning and
            not (selector == '#lg-lens-grid' and node.get_attribute('data-warn') == 'true')):
        toggle = page.locator('[aria-label="범례·여유: 지도 범례와 접속 여유 보기"]')
        expect(toggle).to_be_visible()
        if not toggle.evaluate("e => !!e.closest('details')?.open"):
            previous_focus = page.evaluate_handle('() => document.activeElement').as_element()
            # 시험 결과 서랍(#bd-drawer)이 열려 '!'를 덮는 장면이 있다(390 2월). 범례 글자 검사이므로 덮임과 무관하게 펼친다.
            toggle.dispatch_event('click')
            opened = toggle
    try:
        yield
    finally:
        if opened is not None and opened.evaluate("e => !!e.closest('details')?.open"):
            opened.dispatch_event('click')
        # 렌즈 도움말은 초점으로 표시된다. 기존 검사의 focus 상태도 함께 복원한다.
        if previous_focus is not None:
            if previous_focus.evaluate('e => e.isConnected'):
                previous_focus.focus()
            previous_focus.dispose()


def select_mode(page, mode):
    """숨겨진 설정을 조작하기 전에 상단 HUD에서 해당 모드를 연다."""
    tab = page.locator(f'.lg-modes [data-mode="{mode}"]')
    expect(tab).to_be_visible()
    tab.click()
    expect(tab).to_have_attribute("aria-pressed", "true")
    panel = "#lg-solo" if mode == "solo" else f"#lg-mode-{mode}"
    expect(page.locator(panel)).to_be_visible()


def confirm_seat(page, city_id, timeout=15000):
    """도시 선택은 미리보기이며, 확정 뒤에만 고른 도시의 팀 화면으로 간다."""
    seat = page.locator(f'[data-seat="{city_id}"]')
    expect(seat).to_be_enabled(timeout=timeout)
    confirm = page.locator("#lg-seat-confirm")
    expect(confirm).to_be_disabled()
    name = seat.locator("b").inner_text().strip()
    seat.click()
    expect(seat).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#lg-seat-info").get_by_role("heading", name=name, exact=True)).to_be_visible()
    expect(confirm).to_be_enabled()
    expect(confirm).to_contain_text(name)
    expect(page.locator("#lg-bar")).to_have_count(0)
    confirm.click()
    expect(page.locator("#lg-bar")).to_be_visible(timeout=timeout)
    expect(page.locator("#lg-bar .lg-bteam")).to_have_text(name)


def start_solo(page, months=12):
    """HUD → 기간 선택 → 시작. 숨겨진 select나 기본값에 의존하지 않는다."""
    select_mode(page, "solo")
    length = page.locator(f'[data-select="lg-solo-turns"][data-value="{months}"]')
    length.click()
    expect(length).to_have_attribute("aria-pressed", "true")
    page.locator("#lg-solo-start").click()
    expect(page).to_have_url(re.compile(r".*#league/solo$"))
    expect(page.locator("#lg-bar")).to_be_visible(timeout=15000)


def pass_issue_check(page):
    """품질8 UX U3(docs/QUALITY-ux.md 6절): 설비가 전선에 안 닿았거나 이번 달 돌 설비가 없으면
    준비를 누를 때 확인 카드(#lg-issue-check)가 달마다 한 번 먼저 뜬다. 기존 검사의 준비 흐름은
    '그대로 진행'(#lg-issue-go)으로 이어 간다. 카드는 클릭과 같은 틱에 그려지므로 기다리지 않는다."""
    card = page.locator("#lg-issue-check")
    if card.count() and card.first.is_visible():
        page.locator("#lg-issue-go").click()
        page.wait_for_timeout(150)
        return True
    return False


def wait_unfolded(page, timeout=8000):
    """품질8 UX U10(docs/QUALITY-ux.md 6절): 폭 760px 이하에서는 달 넘김 재생(2~4초) 동안 결과 서랍을
    접어 두었다가 끝나면 펼친다(최대 6초). 서랍 안을 읽는 검사는 펼쳐질 때까지 기다린다."""
    try:
        page.wait_for_function("() => document.getElementById('lg-panel')?.dataset.folded !== 'true'", timeout=timeout)
    except Exception:
        pass


def finish_trial(page, days=7, timeout=30000):
    """T: lastTrial은 시작 즉시 저장된다. 재생 종료와 정확한 기간을 함께 확인한다.

    호출 직전 data-run/코치 단추로 시험을 시작해야 한다. 예전 30/90일 기록의
    존재만 기다리거나 고정 시간으로 재생 종료를 추정하지 않는다.
    """
    page.wait_for_function("""() =>
      document.documentElement.classList.contains('bd-running') ||
      !!document.querySelector('#bd-res-title')""", timeout=timeout)
    skip = page.locator('#bd-skip')
    if skip.count() and skip.is_visible():
        skip.click()
    page.wait_for_function("""days =>
      !document.documentElement.classList.contains('bd-running') &&
      KCP.buildGame.lastTrial()?.days === days""", arg=days, timeout=timeout)
    expect(page.locator('#bd-res-title')).to_be_visible(timeout=timeout)
    trial = page.evaluate('() => KCP.buildGame.lastTrial()')
    assert trial and trial['days'] == days, f'{days}일 시험 기록 필요'
    return trial
