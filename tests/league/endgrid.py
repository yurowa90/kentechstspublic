"""D-80 끝 순위의 계통 합계 검사. 브라우저 실행은 총괄 담당.

샌드박스 밖 로컬 실행:
  tests/.venv/bin/python tests/league/endgrid.py http://127.0.0.1:9430/index.html
화면 버튼으로만 운영한다. evaluate는 상태·DOM·기기 저장 조회만 사용한다.
계통 합계 누락, 월 환산/비용 오류, 팀의 옛 달 저장 누락, 중간 단계 노출을 잡는다.
"""

import calendar
import math
import re
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow)
from fx_end import dismiss_guide, prepare, solo_end
from league_flow import confirm_seat, select_mode, start_solo, wait_unfolded
from solo import CHANGED_JS


OWN = '#lg-rank [data-me="true"] [data-part="rel"] [data-grid-total]'
NUMBER = r'[\d,]+(?:\.\d+)?'
SOURCE_JS = """() => {
  const L=KCP.league.state(), p=KCP.ECON_DATA.params;
  return {S:L.S, team:L.team,
    normalCost:p.normalCost.v, markup:p.gridImportMarkup.v};
}"""


def expected(source, city):
    """화면 helper와 독립적으로 전체 규칙 상태에서 월 일수·대표 기간을 검산한다."""
    state = source['S']
    runs = [r for r in state['results'] if city in r['team']]
    values = {}
    for result in runs:
        row = result['team'][city]
        days = calendar.monthrange(result['year'], result['month'])[1]
        assert state['rounds'][result['round'] - 1]['mdays'] == days
        assert result['days'] > 0
        fields = (row['isolated']['uns'], row['uns'], row['imp'], row['sub'])
        assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in fields)
        isolated, uns, imp, sub = fields
        values[str(result['round'])] = max(0, isolated - uns - imp + sub) * days / result['days']
    mwh = sum(values.values())
    return {'months': len(values), 'mwh': mwh,
            'cost': mwh * source['normalCost'] * source['markup'], 'monthly': values}


def displayed_matches(text, want):
    if want['mwh'] < 0.1:
        return '계통이 메운 전기 없음' in text and '받지 못한' not in text
    match = re.search(rf'계통이 메운 전기 (\d+)달 합 ({NUMBER}) MWh\s*·\s*비용 약 ({NUMBER})억', text)
    if not match:
        return False
    mwh, cost = (float(match[i].replace(',', '')) for i in (2, 3))
    return (int(match[1]) == want['months'] and
            abs(mwh - want['mwh']) <= 0.05 + 1e-7 and
            abs(cost - want['cost']) <= 0.005 + 1e-7 and
            '받지 못한' not in text)


def rank_values(checks, page, source, label, team_only=False):
    if not checks.ok(page.locator(OWN).count() == 1, label + ' 내 신뢰 칸 계통 합계 정확히 1개'):
        return
    rows = page.locator('#lg-rank [data-team]')
    for row in rows.all():
        city = row.get_attribute('data-team')
        values = row.locator('[data-grid-total]')
        wanted = not team_only or city == source['team']
        checks.ok(values.count() == int(wanted), f'{label} {city} 합계 표시 범위')
        if wanted and values.count() == 1:
            text = values.inner_text()
            checks.ok(displayed_matches(text, expected(source, city)),
                      f'{label} {city} MWh(소수 1자리)·비용(소수 2자리) = 전체 결과 독립 검산')
            checks.ok('1년 평균' not in text, f'{label} {city} 12달 연평균 중복 없음')
    # 설명은 칸마다 반복하지 않고 순위 아래 한 번(UX 검토 minor 4 반영, D-80 각주 문구).
    note = page.locator('#lg-rank [data-grid-note]')
    checks.ok(note.count() == 1 and all(s in note.inner_text() for s in
              ('깎지 않아요', '비용은 재정 점수, 배출은 탄소 점수', '게임 가정')),
              label + ' 점수·근거 설명 한 번')
    # 모든 합계가 '없음'이면 MWh·비용 대조가 한 번도 돌지 않으므로, 0이 아닌 값이 하나 이상 있어야 한다.
    checks.ok(any(expected(source, row.get_attribute('data-team'))['mwh'] >= 0.1
                  for row in rows.all() if row.locator('[data-grid-total]').count()),
              label + ' 0이 아닌 계통 합계를 적어도 하나 대조')
    checks.ok(page.locator('[data-grid-total]').count() ==
              page.locator('#lg-rank [data-part="rel"] [data-grid-total]').count(),
              label + ' 계통 합계는 신뢰 칸에만 표시')
    overflow(checks, page, label + ' 끝 순위')


def midgame(checks, page, base, label):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    start_solo(page, months=12)
    prepare(page)
    page.wait_for_function(CHANGED_JS, arg=[1, 'plan', 0])
    page.wait_for_function("() => KCP.league.state().S.phase==='review'")
    wait_unfolded(page)
    open_panel(page, 'rank')
    page.wait_for_selector('#lg-rank')
    checks.ok(page.locator('[data-grid-total]').count() == 0,
              label + ' 1월 결과의 순위에는 계통 합계 없음')
    overflow(checks, page, label + ' 1월 순위')


def team_end(checks, context, base, pages, label):
    """fx_end.host_end와 같은 진행자+팀 흐름. 그래프 검사는 호출하지 않는다."""
    host, events = monitored_page(context)
    pages.append((host, events, label + '-host'))
    host.goto(base + '#league')
    host.wait_for_function(BOOT_JS)
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="12"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    ids = host.evaluate('() => KCP.league.state().S.active')
    teams = {}
    for city in ids:
        page, events = monitored_page(context)
        pages.append((page, events, label + '-' + city))
        page.goto(base + '#league')
        select_mode(page, 'join')
        page.locator('#lg-code').fill(room)
        page.locator('#lg-join').click()
        confirm_seat(page, city)
        dismiss_guide(page)
        teams[city] = page
    host.wait_for_function("""() => {const S=KCP.league.state().S;
      return S.active.every(id=>!!S.teams[id]?.token);}""")
    host.locator('#lg-next').click()
    for month in range(1, 13):
        for page in teams.values():
            page.wait_for_function("""month => {const V=KCP.league.state().snap;
              return V?.round===month && V.phase==='plan';}""", arg=month)
            wait_unfolded(page)
            prepare(page)
        host.wait_for_function("""() => {const S=KCP.league.state().S;
          return S.phase!=='plan' || S.active.every(id=>S.teams[id].ready);}""")
        if host.evaluate('() => KCP.league.state().S.phase') == 'plan':
            host.locator('#lg-next').click()
        host.wait_for_function("""month => {const S=KCP.league.state().S;
          return S.round===month && S.phase==='review';}""", arg=month)
        # 다음 달로 넘기기 전에 모든 팀이 결과를 실제로 받아 기록할 기회를 보장한다.
        for page in teams.values():
            page.wait_for_function("""month => {const V=KCP.league.state().snap;
              return V?.round===month && V.phase==='review';}""", arg=month)
        host.locator('#lg-next').click()
    host.wait_for_function("() => KCP.league.state().S.phase==='end'")
    source = host.evaluate(SOURCE_JS)
    checks.ok(len(source['S']['results']) == 12, label + ' 진행자 전체 12달 결과')
    host.wait_for_selector('#lg-rank [data-grid-total]')
    for row in host.locator('#lg-rank [data-team]').all():
        city = row.get_attribute('data-team')
        value = row.locator('[data-part="rel"] [data-grid-total]')
        checks.ok(value.count() == 1 and displayed_matches(value.inner_text(), expected(source, city)),
                  f'{label} 진행자 {city} 전체 합계 일치')
    for city, page in teams.items():
        page.wait_for_function("() => KCP.league.state().snap?.phase==='end'")
        wait_unfolded(page)
        open_panel(page, 'result')
        page.wait_for_selector(OWN)
        source['team'] = city
        snapshot = page.evaluate('() => KCP.league.state().snap')
        checks.ok(len(snapshot['results']) == 12 and all(
            'isolated' not in r['team'][city] for r in snapshot['results'][:-2]),
            f'{label} {city} 옛 10달의 공개 필드 축약 확인')
        saved = page.evaluate("""() => {
          const L=KCP.league.state();
          const d=JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`));
          return Object.fromEntries(Object.entries(d?.interview?.metrics || {}).map(([r,m])=>[r,m.grid]));
        }""")
        monthly = expected(source, city)['monthly']
        checks.ok(all(isinstance(saved.get(rd), (int, float)) and
                      math.isfinite(saved[rd]) and abs(saved[rd] - value) < 1e-7
                      for rd, value in monthly.items()),
                  f'{label} {city} 기존 metrics.grid에 월 환산 12달 저장')
        rank_values(checks, page, source, label + '-team-' + city, team_only=True)
        # 새로고침 뒤에도 축약된 옛 달은 기기에 보관한 metrics.grid로 보충해야 한다.
        page.reload()
        page.wait_for_function("() => KCP.league.state().snap?.phase==='end'")
        wait_unfolded(page)
        open_panel(page, 'result')
        page.wait_for_selector(OWN)
        rank_values(checks, page, source, label + '-reload-' + city, team_only=True)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in ((1280, 900), (390, 844)):
                    label = f'{width}x{height}'
                    for stage in ('midgame', 'solo', 'team'):
                        context, external = context_for(browser, base, width, height, 'light')
                        pages = []
                        case = label + '-' + stage
                        try:
                            if stage == 'team':
                                team_end(checks, context, base, pages, case)
                            else:
                                page, events = monitored_page(context)
                                pages.append((page, events, case))
                                if stage == 'midgame':
                                    midgame(checks, page, base, case)
                                else:
                                    solo_end(checks, page, base, case)
                                    rank_values(checks, page, page.evaluate(SOURCE_JS), case)
                        except Exception as exc:
                            checks.ok(False, f'{case} 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                        finally:
                            for page, events, page_label in pages:
                                diagnostics(checks, events, page_label)
                                overflow(checks, page, page_label + ' 마지막')
                            checks.ok(not external, case + ' 외부 연결 시도 0')
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
