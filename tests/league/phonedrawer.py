"""품질8 UX C: 폰 결과 서랍 높이·접기 복원·S8 이유 자동 노출.

브라우저 실행은 총괄이 샌드박스 밖 로컬에서 담당한다:
  tests/.venv/bin/python tests/league/phonedrawer.py http://127.0.0.1:9430/index.html
새 컨텍스트에서 화면 조작으로 첫 달 결과와 다음 달 계획까지 진행한다.
evaluate는 DOM 측정·서랍 스크롤 배치·공개 상태 조회에만 사용한다.
"""

from league_flow import finish_trial
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, overflow)
from fx_end import dismiss_guide, prepare
from league_flow import pass_issue_check, select_mode, start_solo, wait_unfolded
from solo import click_next, close_drawer, read


class TouchBrowser:
    def __init__(self, browser):
        self.browser = browser

    def new_context(self, **options):
        touch = options['viewport']['width'] <= 768
        return self.browser.new_context(has_touch=touch, is_mobile=touch, **options)


def settle(page):
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def open_drawer(page, tab):
    # econui.open_panel은 결과 상세를 펼치므로 기본 접힘 배치를 검사할 때는 쓰지 않는다.
    wait_unfolded(page)
    button = page.locator(f'#lg-bar [data-panel="{tab}"]')
    if button.get_attribute('aria-expanded') != 'true':
        button.click()
    page.wait_for_function('''tab => {
      const p = document.querySelector('#lg-panel');
      return p && !p.hidden && p.dataset.tab === tab && p.dataset.folded !== 'true';
    }''', arg=tab)
    settle(page)


GEOMETRY = '''() => {
  const p = document.querySelector('#lg-panel'), dock = document.querySelector('#bd-dock');
  const r = p.getBoundingClientRect(), d = dock.getBoundingClientRect();
  const hit = document.elementFromPoint(d.x + d.width / 2, d.y + d.height / 2);
  const button = dock.querySelector('#bd-pm'), b = button.getBoundingClientRect();
  const buttonHit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return {gap: innerHeight - r.bottom, dockTop: d.top, height: innerHeight,
    dockVisible: getComputedStyle(dock).visibility === 'visible',
    coveredByPanel: !!hit && (hit === p || p.contains(hit)),
    dockHit: !!buttonHit && (buttonHit === button || button.contains(buttonHit)),
    resultDrawer: document.querySelector('#bd-root').dataset.resultDrawer};
}'''

REASON_VISIBLE = '''() => {
  const p = document.querySelector('#lg-panel'), body = p?.querySelector('.lg-pbody');
  const field = p?.querySelector('#lg-result-decision [data-note="askReason"]');
  if (!body || !field) return false;
  const label = field.closest('.lg-jq'), group = label.parentElement.querySelector('.lg-reason-starts');
  const b = body.getBoundingClientRect(), r = label.getBoundingClientRect();
  const s = (group || label).getBoundingClientRect(), f = field.getBoundingClientRect();
  const top = b.top + body.clientTop, bottom = top + body.clientHeight;
  return s.top >= top - 1 && r.bottom <= bottom + 1 &&
    f.left >= b.left - 1 && f.right <= b.left + body.clientWidth + 1;
}'''


def original_bottom(checks, page, width, label):
    g = page.evaluate(GEOMETRY)
    # d426c3e의 min-width:768 규칙: 열린 리그 서랍 bottom:8px.
    # 폰 계획 서랍은 bottom:calc(--bd-dock + 8px), build.layout이 dock top을 반올림한다.
    expected_gap = 8 if width >= 768 else round(g['height'] - g['dockTop']) + 8
    checks.ok(abs(g['gap'] - expected_gap) <= 1.5,
              f'{label} 기존 아래 끝 기대 {expected_gap}px, 실제 {g["gap"]:.1f}px')


def dock_available(checks, page, label):
    g = page.evaluate(GEOMETRY)
    checks.ok(g['dockVisible'] and g['dockHit'], label + ' dock 표시·단추 중심 hit')
    # rev16 #72-4: review에서도 정책·시험 열기는 가능하다(클릭 전달 계약 유지).
    page.locator('#bd-pm').click()
    page.wait_for_selector('#bd-drawer-body', state='visible')
    checks.ok(page.locator('#bd-pm').get_attribute('aria-expanded') == 'true',
              label + ' 정책·시험 실제 열기')
    page.locator('#bd-drawer-x').click()
    settle(page)


def decision(checks, page, label):
    compared = page.locator('#lg-result-decision [data-compared]')
    if compared.count():
        compared.check()
    # 선택만 보이고 이유는 아래로 잘린 상황. 클릭 이후에는 측정만 하며 자동 노출을 검증한다.
    page.locator('#lg-result-decision [data-answer="keep"]').evaluate('''el => {
      const b = el.closest('.lg-pbody'), r = b.getBoundingClientRect();
      b.scrollTop += el.getBoundingClientRect().bottom - (r.top + b.clientTop + b.clientHeight) + 4;
    }''')
    checks.ok(not page.evaluate(REASON_VISIBLE), label + ' 선택 전 이유 묶음 잘림 재현')
    before = page.evaluate('() => [scrollX, scrollY]')
    page.locator('#lg-result-decision [data-answer="keep"]').click()
    settle(page)
    checks.ok(page.evaluate(REASON_VISIBLE), label + ' 유지 선택 후 이유 칩·이유 칸 전체 노출')
    checks.ok(page.locator('#lg-result-decision [data-answer="keep"]').get_attribute('aria-pressed') == 'true',
              label + ' 다시 그리기 후 유지 선택 보존')
    checks.ok(page.evaluate('() => !document.activeElement.matches("input,textarea,select")'),
              label + ' 이유 입력 초점 이동 없음')
    checks.ok(page.evaluate('() => [scrollX, scrollY]') == before, label + ' 페이지 스크롤 불변')
    # 이미 보이는 경우에는 다른 선택·같은 선택 모두 서랍 위치를 유지해야 한다.
    for choice in ('revise', 'revise', 'keep'):
        button = page.locator(f'#lg-result-decision [data-answer="{choice}"]')
        button.scroll_into_view_if_needed()
        if page.evaluate(REASON_VISIBLE):
            position = page.locator('#lg-panel .lg-pbody').evaluate('el => el.scrollTop')
            button.click()
            settle(page)
            checks.ok(abs(page.locator('#lg-panel .lg-pbody').evaluate('el => el.scrollTop') - position) <= 1,
                      label + f' 이유가 보일 때 {choice} 선택 스크롤 불변')
        else:
            # 선택 버튼과 이유가 동시에 보이지 않는 낮은 서랍에서는 자동 노출을 다시 검사한다.
            button.click()
            settle(page)
            checks.ok(page.evaluate(REASON_VISIBLE), label + f' {choice} 선택 후 이유 전체 노출')


def scenario(checks, page, base, width, label):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator('#lg-solo .lg-extra-settings > summary').click()
    page.locator('#lg-solo-practice').select_option('promise')
    start_solo(page, months=12)
    dismiss_guide(page)
    state = read(page)['S']
    if state['phase'] == 'lobby':
        click_next(page, state)
    page.wait_for_function("() => KCP.league.state().S.phase === 'plan'")
    close_drawer(page)
    # S7과 약속의 비교 기준을 첫 달 시험으로 만든다.
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    page.locator('#bd-drawer-x').click()
    prepare(page)
    page.wait_for_function("() => KCP.league.state().S.phase === 'review'")
    wait_unfolded(page)
    open_drawer(page, 'result')
    g = page.evaluate(GEOMETRY)
    checks.ok(g['resultDrawer'] == 'true', label + ' 첫 달 결과 서랍 상태')
    if width <= 760:
        checks.ok(8 <= g['gap'] <= 24, label + f' 아래 여백 8~24px: {g["gap"]:.1f}px')
        checks.ok(not g['dockVisible'] and g['coveredByPanel'], label + ' dock 중심은 서랍이 덮음')
    else:
        original_bottom(checks, page, width, label + ' 결과')
    overflow(checks, page, label + ' 결과 펼침')
    if width <= 1024:
        decision(checks, page, label)
    page.locator('#lg-panel-fold').click()
    settle(page)
    checks.ok(page.locator('#lg-panel').get_attribute('data-folded') == 'true', label + ' 접힘 상태')
    dock_available(checks, page, label + ' 접기 후')
    overflow(checks, page, label + ' 접기')
    # review의 journal도 결과 서랍 높이를 사용해야 한다.
    open_drawer(page, 'journal')
    if width <= 760:
        g = page.evaluate(GEOMETRY)
        checks.ok(8 <= g['gap'] <= 24 and not g['dockVisible'] and g['coveredByPanel'],
                  label + ' 결과 단계 일지도 높이 확장·dock 가림')
    else:
        original_bottom(checks, page, width, label + ' 결과 일지')
    click_next(page, read(page)['S'])
    page.wait_for_function("() => KCP.league.state().S.round === 2 && KCP.league.state().S.phase === 'plan'")
    open_drawer(page, 'journal')
    checks.ok(page.evaluate(GEOMETRY)['resultDrawer'] == 'false', label + ' 다음 달 계획은 확장 제외')
    original_bottom(checks, page, width, label + ' 다음 달 계획')
    dock_available(checks, page, label + ' 다음 달 계획')
    overflow(checks, page, label + ' 다음 달 계획')
    # 계획의 약속 카드도 높이·dock 규칙을 보존한다. 제출은 하지 않는다.
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm')
    settle(page)
    checks.ok(page.evaluate(GEOMETRY)['resultDrawer'] == 'false', label + ' 약속 카드는 확장 제외')
    original_bottom(checks, page, width, label + ' 약속 카드')
    checks.ok(page.evaluate(GEOMETRY)['dockVisible'] and page.evaluate(GEOMETRY)['dockHit'],
              label + ' 약속 카드 dock 표시·hit')
    overflow(checks, page, label + ' 약속 카드')


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                # 761은 폰 규칙(max-width:760) 바로 바깥: 결과 서랍이 반폭이라 dock을 숨기면 안 된다(독립 검토 minor 1).
                for width, height in ((390, 844), (761, 844), (768, 1024), (1280, 900)):
                    label = f'{width}x{height}'
                    context, external = context_for(TouchBrowser(browser), base, width, height, 'light')
                    page, events = monitored_page(context)
                    try:
                        scenario(checks, page, base, width, label)
                    except Exception as exc:
                        checks.ok(False, f'{label} 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                    finally:
                        diagnostics(checks, events, label)
                        overflow(checks, page, label + ' 최종')
                        checks.ok(not external, label + f' 외부 연결 0: {external}')
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
