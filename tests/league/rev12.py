"""rev12 명세만으로 작성한 수용 검사. 작성 세션에서는 py_compile만 실행한다.

허용된 샌드박스 밖 로컬 담당자 실행:
  tests/.venv/bin/python tests/league/rev12.py http://127.0.0.1:<포트>/index.html \
    --out tests/results/rev12
기존 rev11의 주소·입력 환경·혼자 하기, econui의 멀티 도우미를 재사용한다.
결과/문구/스타일 주입 없음. Q6은 운영 전부터 읽기 전용 rAF로 관측한다.
SKIP: E5-a 화면 장면 미확보만 허용한다. 경고·끝 화면 미확보는 실패다.
"""
import argparse
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from econui import (Checks as BaseChecks, advance, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, setup_pair, shown)
from fx_end import dismiss_guide, prepare
from fx_replay import reach_result
from league_flow import finish_trial, wait_unfolded
from rev11 import DOM, InputBrowser, frames, press, start
from rev8c import coach_step, submit_r2_promise
from solo import close_drawer
from ux_coach import LINE_ENDS_JS, NEAR_TOWN_JS
from ux_s2fix import CANDIDATES_JS, reveal_tile
from ux_task import TILE_XY_JS


K1V = '범례·여유'
K1A = '범례·여유: 지도 범례와 접속 여유 보기'
A1 = 'CO₂ 시험·소비, 시험 운전 소비 배출(계통 포함)'
# TOWN_LOOK_KEY 값 자체는 명세에 적혀 있지 않다. 닫힌 DOM의 원래 글자를 보존 비교한다.
GRID_TEXT = r'접속 여유\s*[-−]?\d[\d,.]*\s*MW\s*·\s*대기\s*\d[\d,.]*\s*MW'
HIT = r"""e => {
  const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {clear:!!hit&&e.contains(hit),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
    width:r.width,height:r.height,hit:hit?.id||hit?.tagName};
}"""

# 새로운 Q2 id는 명세에 없다. 버튼은 K1a 접근 이름으로만 찾는다.
# DOM 감시도 같은 접근 이름을 사용한다. 결과 phase·실제 result 존재를 모두 요구한다.
PROBE = r"""(() => {
  window.__rev12={results:[],warnings:[]};
  const scan=()=>{
    const {visible,box,area}=(""" + DOM + r""");
    const L=window.KCP?.league?.state?.(),S=L?.S||L?.snap;
    const grid=document.querySelector('#lg-lens-grid');
    if(S?.phase==='plan'&&grid?.dataset.warn==='true') {
      const r=box(grid);
      __rev12.warnings.push({visible:visible(grid),outside:!grid.closest('details,[hidden]'),
        inside:!!r&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight});
    }
    const toast=document.querySelector('#bd-toast[data-phase="result"][data-show="true"]');
    if(['review','end'].includes(S?.phase)&&S?.results?.length&&visible(toast)) {
      const toggle=[...document.querySelectorAll('button,[role="button"],summary')]
        .find(e=>e.getAttribute('aria-label')==='범례·여유: 지도 범례와 접속 여유 보기');
      const rows=[grid,toggle].filter(visible),t=box(toast);
      __rev12.results.push({text:toast.textContent,phase:toast.dataset.phase,round:S.round,
        resultRound:S.results.at(-1)?.round,toast:t,targets:rows.map(e=>({id:e.id||'K1a',box:box(e),overlap:area(t,box(e))}))});
    }
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
})();"""


class Checks(BaseChecks):
    def __init__(self, out):
        super().__init__()
        self.out, self.skips = out, []

    def skip(self, label, reason):
        self.skips.append((label, reason))
        print(f'SKIP {label}: {reason}', flush=True)

    def shot(self, page, label):
        def capture():
            self.out.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(self.out / (label + '.png')), full_page=False)
            return True
        self.test('캡처 ' + label, capture)

    def finish(self):
        print(f'INFO SKIP {len(self.skips)}건 (단언 수에 넣지 않음)', flush=True)
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


def attempt(checks, label, action):
    try:
        action()
    except Exception as exc:
        checks.ok(False, f'{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')


def hit(checks, node, label, minimum=False):
    data = node.evaluate(HIT)
    checks.ok(data['clear'] and data['inside'], f'{label} 중심 elementFromPoint 자기 단추: {data}')
    if minimum:
        checks.ok(data['width'] >= 44 and data['height'] >= 44, f'{label} 누름 영역 ≥44×44: {data}')


def grid_on(page, touch):
    close_drawer(page)
    button = page.locator('[data-lens="grid"]')
    if button.get_attribute('aria-pressed') != 'true':
        press(page, '[data-lens="grid"]', touch)
    frames(page)


def legend_overlap(checks, page, label, required=()):
    """닫힌 !의 실제 사각형·중심점. 넓은 폭은 ! 숨김 계약도 함께 유지한다."""
    data = page.evaluate(r"""() => {
      const {visible,box,area}=(""" + DOM + r""");
      const toggle=document.querySelector('[aria-label="범례·여유: 지도 범례와 접속 여유 보기"]');
      // rev18 개정 3 R5: 자리 판단(2/8·3/8), 열린·고정된·코치가 짚는 범례는 유지한다.
      const legend=document.querySelector('#lg-map-key-info');
      const keep=!!legend?.open||legend?.dataset.pinned==='true'||
        !!legend?.closest('.lg-coach-target')||!!legend?.querySelector('.lg-coach-target');
      const narrow=innerWidth<=1100;
      const coach=document.querySelector('#lg-coach');
      const coachText=(coach?.querySelector('#lg-coach-task')?.textContent||coach?.textContent||'').trim();
      const siteJudgment=coachText.startsWith('자리 판단')||/\b[23]\s*\/\s*8\b/.test(coachText);
      const coachFolded=visible(coach)&&!siteJudgment&&
        !!document.querySelector('#bd-root[data-lg-phase="plan"]')&&!keep;
      const shown=visible(toggle),r=shown?box(toggle):null;
      return {shown,narrow,coachFolded,rows:['#bd-dock','#lg-coach','[data-run]','#bd-run'].map(selector=>({selector,
        areas:[...document.querySelectorAll(selector)].filter(visible).map(e=>area(r,box(e)))}))};
    }""")
    expected_shown = data['narrow'] and not data['coachFolded']
    checks.ok(data['shown'] == expected_shown, label + ' Q2 폭별 ! 표시')
    if expected_shown:
        hit(checks, page.locator(f'[aria-label="{K1A}"]'), label + ' Q2 ! 겹침 장면')
    elif data['narrow']:  # rev18 R5: 좁은 폭의 기존 hit 단언 1개를 숨김 단언으로 대체한다.
        checks.ok(not data['shown'], label + ' Q2 코치 동안 범례 숨김(rev18 R5)')
    for row in data['rows']:
        if row['selector'] in required:
            checks.ok(bool(row['areas']), label + ' Q2 겹침 대상 실제 표시 ' + row['selector'])
        checks.ok(all(area == 0 for area in row['areas']),
                  f"{label} Q2 !와 {row['selector']} 교차 면적 0: {row['areas']}")


def legend(checks, page, label, touch):
    grid_on(page, touch)
    narrow = page.viewport_size['width'] <= 1100
    # <summary>는 Chromium 접근성 트리에서 button role이 아니므로 접근 이름 속성으로 찾는다.
    toggle = page.locator(f'[aria-label="{K1A}"]')
    town = page.locator('#bd-town-look-key')
    grid = page.locator('#lg-lens-grid')
    original_town = town.text_content().strip()
    original_grid = grid.text_content().strip()
    legend_overlap(checks, page, label, required=('#bd-dock', '[data-run]'))
    if not narrow:
        checks.ok(shown(page, '#bd-town-look-key'), label + ' Q2 1280 범례 각주 펼침')
        checks.ok(shown(page, '#lg-lens-grid'), label + ' Q2 1280 접속 여유 펼침')
        checks.ok(toggle.count() == 0 or not toggle.is_visible(), label + ' Q2 1280 접기 단추 숨김')
    else:
        checks.ok(not shown(page, '#bd-town-look-key'), label + ' Q2 닫힌 범례 각주 숨김')
        warning = grid.count() and grid.get_attribute('data-warn') == 'true'
        checks.ok(bool(warning) or not shown(page, '#lg-lens-grid'), label + ' Q2 비경고 접속 여유 숨김')
        if warning:
            checks.ok(shown(page, '#lg-lens-grid'), label + ' Q2 경고 접속 여유는 닫힌 상자 밖에 펼침')
        toggle.wait_for(state='visible')
        checks.ok(K1V in toggle.inner_text() and '!' in toggle.inner_text(), label + ' Q2 ! ' + K1V)
        hit(checks, toggle, label + ' Q2 !', minimum=True)
        toggle.tap() if touch else toggle.click()
        frames(page)
    town.wait_for(state='visible')
    grid.wait_for(state='visible')
    text = town.inner_text()
    checks.ok(bool(original_town) and text.strip() == original_town,
              label + ' Q2 TOWN_LOOK_KEY 원래 글자 보존: ' + text)
    grid_text = grid.inner_text()
    checks.ok(bool(re.search(GRID_TEXT, grid_text)), label + ' Q2 접속 여유·대기 MW: ' + grid_text)
    checks.ok(grid_text.strip() == original_grid, label + ' Q2 접속 여유 같은 글자·숫자 보존')
    # 펼치기 전후 숫자 생성 함수를 호출하지 않고 같은 DOM 줄을 확인한다.
    checks.ok(town.count() == 1 and grid.count() == 1, label + ' Q2 기존 두 줄 중복 없음')
    overflow(checks, page, label + ' Q2 상자 펼침')
    checks.shot(page, label + '-legend')
    if narrow:
        toggle.tap() if touch else toggle.click()
        frames(page)
        checks.ok(not town.is_visible(), label + ' Q2 다시 누르면 닫힘')
        toggle.tap() if touch else toggle.click()
        page.keyboard.press('Escape')
        checks.ok(not town.is_visible(), label + ' Q2 Esc로 닫힘')
        toggle.tap() if touch else toggle.click()
        # 기존 범례 밖인 머리 단계 표지를 누른다. DOM/스타일 주입 없음.
        if page.locator('#lg-bphase').is_visible():
            page.locator('#lg-bphase').tap() if touch else page.locator('#lg-bphase').click()
        else:  # 390에서는 단계 표지가 숨겨진다. 지도 캔버스 오른쪽 가운데(상자 밖)를 누른다.
            vw, vh = page.viewport_size['width'], page.viewport_size['height']
            (page.touchscreen.tap if touch else page.mouse.click)(vw - 24, vh * 0.45)
        checks.ok(not town.is_visible(), label + ' Q2 바깥 누르면 닫힘')
    overflow(checks, page, label + ' Q2 닫힘')


def warning(checks, page, base, label, touch):
    """Q2: 실제 hostLimited 설비를 초기 접속 여유보다 많이 짓는다. 경고 주입 없음."""
    start(page, base)
    grid_on(page, touch)
    initial = page.evaluate("""() => {const L=KCP.league.state(),V=L.S||L.snap;
      return V.grid[L.team].headroomMW;}""")
    attempts, added_mw = [], 0
    try:
        group = page.locator('#bd-dock [data-group="ren"]')
        if group.count() and not shown(page, '[data-tool="solar"]'):
            press(page, '#bd-dock [data-group="ren"]', touch)
        press(page, '[data-tool="solar"]', touch)
        spec = page.evaluate("""() => {const B=KCP.buildGame,st=B.current(),b=B.BLD.solar;
          const used=new Set(st.builds.map(x=>x.i));
          return {hostLimited:b.hostLimited,mw:b.mw,indices:B.TILES
            .filter(t=>!used.has(t.i)&&!B.siteRule('solar',t))
            .sort((a,b)=>(a.t==='forest')-(b.t==='forest')||a.i-b.i).map(t=>t.i)};}""")
        if not spec['hostLimited'] or spec['mw'] <= 0:
            raise AssertionError('태양광이 양수 MW hostLimited 설비가 아님')
        for index in spec['indices'][:40]:
            before = page.evaluate('() => KCP.buildGame.current().builds.length')
            try:
                tile_press(page, index, touch)
                if touch and page.evaluate('() => KCP.buildGame.current().builds.length') == before:
                    tile_press(page, index, touch)
                if shown(page, '#bd-cf-ok'):
                    press(page, '#bd-cf-ok', touch)
                added = page.evaluate('() => KCP.buildGame.current().builds.length') > before
                attempts.append({'i': index, 'added': added, 'toast': page.locator('#bd-toast').text_content()})
                if added:
                    added_mw += spec['mw']
                if added_mw > initial:
                    break
            except Exception as exc:
                attempts.append({'i': index, 'error': str(exc).splitlines()[0][:160]})
        page.keyboard.press('Escape')  # 말풍선만 닫고 경고 줄은 닫힌 ! 밖에서 관측한다.
        frames(page)
        print(f'INFO {label} Q2 경고 장면: 초기 여유={initial} MW, 추가={added_mw} MW, 시도={attempts}', flush=True)
        checks.ok(added_mw > initial, label + ' Q2 실제 추가 hostLimited MW > 초기 접속 여유')
        grid = page.locator('#lg-lens-grid')
        # hidden 안 글자를 읽어 통과시키지 않는다. data-warn·가시성·상자 밖을 각각 요구한다.
        checks.ok(grid.get_attribute('data-warn') == 'true' and shown(page, '#lg-lens-grid'),
                  label + ' Q2 대기 경고 접속 여유 열지 않아도 보임')
        text = grid.inner_text()
        waiting = re.search(r'대기\s*([\d,.]+)\s*MW', text)
        checks.ok(bool(waiting) and float(waiting[1].replace(',', '')) > 0,
                  label + ' Q2 자연 배치로 대기 > 0: ' + text)
        checks.ok(grid.evaluate("e=>!e.closest('details,[hidden]')"), label + ' Q2 경고 줄은 접힌 상자 밖')
        toggle = page.locator(f'[aria-label="{K1A}"]')
        checks.ok(not toggle.evaluate("e=>!!e.closest('details')?.open") and
                  not shown(page, '#bd-town-look-key'), label + ' Q2 경고여도 범례 각주는 닫힘')
        frames(page)
        warnings = page.evaluate('() => __rev12.warnings')
        checks.ok(bool(warnings) and all(row['visible'] and row['outside'] and row['inside'] for row in warnings),
                  f'{label} Q2 경고 모든 관측 프레임 상자 밖·화면 안: {warnings[-3:]}')
        legend_overlap(checks, page, label + ' 경고', required=('#bd-dock', '[data-run]'))
        overflow(checks, page, label + ' Q2 경고')
        checks.shot(page, label + '-warning')
    except Exception as exc:
        # 시도와 원인을 출력하고 FAIL. 경고를 못 만든 경우는 SKIP하지 않는다.
        raise AssertionError(f'Q2 경고 장면 실패: 여유={initial}, 추가={added_mw}, 시도={attempts}; {exc}') from exc


def co2_name(checks, page, label):
    # 기존 공개 클래스와 명세 보이는 글자로 칩을 찾는다. 특정 새 role/id는 가정하지 않는다.
    visible = page.locator('[data-cap="co2"] .v2-cap-k')
    checks.ok(visible.count() == 1, label + ' Q5 보이는 CO₂ 칩 표지 1개')
    if visible.count() != 1:
        return
    shown_text = visible.evaluate("e => [...e.childNodes].filter(n => !(n.nodeType === 1 && n.classList.contains('bd-sr'))).map(n => n.textContent).join('').trim()")
    checks.ok(shown_text == 'CO₂ 시험·소비', label + ' Q5 보이는 글자 유지: ' + shown_text)
    checks.ok(visible.get_attribute('aria-label') is None, label + ' Q5 일반 span aria-label 없음')
    chip = page.locator('[data-cap="co2"]')
    snapshot = chip.aria_snapshot()
    checks.ok('CO₂ 시험·소비' in snapshot and '계통 포함' in snapshot,
              f'{label} Q5 접근성 트리 표지·계통 포함: {snapshot}')
    # role 요소는 접근 이름, 일반 요소는 접근성 트리의 텍스트 결합 경로를 허용한다.
    names = re.findall(r'^\s*-\s*[^"\n]+?\s+"([^"\n]+)"', snapshot, re.MULTILINE)
    text_rows = re.findall(r'^\s*-\s*(?:text|generic):\s*(.+)$', snapshot, re.MULTILINE)
    combined = re.sub(r'\s+', ' ', ' '.join(row.strip('"') for row in text_rows))
    checks.ok(any(name.startswith('CO₂ 시험·소비') and '계통 포함' in name for name in names) or
              combined.startswith('CO₂ 시험·소비') and '계통 포함' in combined,
              label + ' Q5 접근 이름은 보이는 글자로 시작')
    titles = chip.evaluate("e=>[e,...e.querySelectorAll('[title]')].map(n=>n.getAttribute('title')).filter(Boolean)")
    checks.ok(A1 in titles, f'{label} Q5 title A1: {titles}')


def result_toast(checks, page, label):
    # 시작 직전에 probe를 설치했으므로 짧은 알림이 Python 왕복 사이 사라져도 기록이 남는다.
    reach_result(page, 1)
    page.wait_for_function('() => __rev12.results.length > 0', timeout=30000)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    frames(page)
    samples = page.evaluate('() => __rev12.results')
    checks.ok(bool(samples), label + ' Q6(b) 실제 운영 결과 알림 관측 (1주 시험 제외)')
    targets = [row for sample in samples for row in sample['targets']]
    checks.ok(bool(targets), label + ' Q6(b) 알림과 동시에 보이는 접속 여유 또는 ! 있음')
    checks.ok(bool(targets) and all(row['overlap'] == 0 for row in targets),
              f'{label} Q6(b) 모든 관측 프레임 사각형 겹침 0: {targets[:3]} (프레임 {len(samples)})')
    checks.ok(all(s['phase'] == 'result' and s['resultRound'] == 1 for s in samples),
              label + ' Q6(b) 첫 달 실제 결과 확인')
    overflow(checks, page, label + ' Q6(b) 결과')


def map_and_result(checks, page, base, label, touch):
    start(page, base)
    attempt(checks, label + ' Q2', lambda: legend(checks, page, label, touch))
    attempt(checks, label + ' Q5', lambda: co2_name(checks, page, label))
    close_drawer(page)
    grid_on(page, touch)
    page.evaluate('() => { __rev12.results=[]; }')
    result_toast(checks, page, label)


def tile_press(page, index, touch):
    if page.evaluate(TILE_XY_JS, index) is None:
        reveal_tile(page, touch, index, lambda: None)
    xy = page.evaluate(TILE_XY_JS, index)
    if not xy:
        raise AssertionError(f'지도 칸 {index}의 가리지 않은 좌표 없음')
    (page.touchscreen.tap if touch else page.mouse.click)(*xy)
    frames(page)


def choose_diesel(page, touch):
    close_drawer(page)
    if not shown(page, '[data-tool="diesel"]'):
        press(page, '#bd-dock [data-group="fire"]', touch)
    press(page, '[data-tool="diesel"]', touch)


def site_reason(checks, page, base, label, touch):
    start(page, base)
    choose_diesel(page, touch)
    # 도시 빈 칸을 먼저 찾는다. 시설 점유/도구 없음의 '못 지음' 분기를 피한다.
    indices = page.evaluate("""() => {
      const B=KCP.buildGame,used=new Set(B.current().builds.map(b=>b.i));
      return B.TILES.filter(t=>!t.out&&t.site<0&&t.t==='urban'&&!used.has(t.i)).map(t=>t.i);
    }""")
    if not indices:
        raise AssertionError('UX-E 디젤을 누를 빈 도시 칸 없음')
    tile_press(page, indices[0], touch)
    if touch:  # 기존 터치 지도는 첫 탭 선택, 같은 칸의 둘째 탭 배치 시도.
        tile_press(page, indices[0], touch)
    toast = page.locator('#bd-toast')
    toast.wait_for(state='visible')
    want = '디젤: 평지·언덕·숲·해안만'
    checks.ok(want in toast.inner_text(), label + ' UX-E 토스트: ' + toast.inner_text())
    tip = page.locator('#bd-tip')
    checks.ok(tip.is_visible() and want in tip.inner_text(), label + ' UX-E 칸 말풍선도 같은 문장')
    overflow(checks, page, label + ' UX-E')


def coach(checks, page, base, label, touch):
    start(page, base, coach=True)
    page.wait_for_selector('#lg-coach[data-step="1"]')
    legend_overlap(checks, page, label + ' 코치 표시', required=('#lg-coach',))
    for _ in range(16):
        step = coach_step(page)
        overflow(checks, page, f'{label} 코치 {step}/8')
        if step == 1:
            press(page, '#lg-coach-action', touch)
        elif step == 2:
            press(page, '#lg-coach-action', touch)
            choose_diesel(page, touch)
            before = page.evaluate('() => KCP.buildGame.current().builds.length')
            for index in page.evaluate(NEAR_TOWN_JS, 'diesel'):
                tile_press(page, index, touch)
                if touch and page.evaluate('() => KCP.buildGame.current().builds.length') == before:
                    tile_press(page, index, touch)
                if shown(page, '#bd-cf-ok'):
                    press(page, '#bd-cf-ok', touch)
                if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
                    break
            else:
                raise AssertionError('코치 2/8 설비 설치 실패')
        elif step == 3:
            press(page, '#lg-coach-action', touch)
            for _ in range(4):
                ends = page.evaluate(LINE_ENDS_JS)
                if not ends:
                    break
                for index in ends:
                    tile_press(page, index, touch)
                if shown(page, '#bd-cf-ok'):
                    press(page, '#bd-cf-ok', touch)
            page.keyboard.press('Escape')
        elif step == 4:
            press(page, '#lg-coach-action', touch)
            page.locator('#bd-run').wait_for(state='visible')
            frames(page)
            legend_overlap(checks, page, label + ' 시험 운영 띠 표시', required=('#bd-run',))
            finish_trial(page)
        elif step == 5:
            submit_r2_promise(page)
            page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
            wait_unfolded(page)
        elif step == 6:
            target = page.locator('#lg-promise-summary [data-promise-details]')
            try:
                page.wait_for_function("() => !!document.querySelector('.lg-coach-target')", timeout=5000)
            except Exception:
                pass
            if target.count():
                checks.ok(target.evaluate("e=>e.classList.contains('lg-coach-target')||!!e.closest('.lg-coach-target')"), label + ' Q1 6/8 강조 대상 판정 줄 단추')
                named = page.get_by_role('button', name='예측 자세히', exact=True)
                action = page.locator('#lg-coach-action')
                checks.ok(action.inner_text().strip() == '예측 자세히', label + ' Q1 6/8 이름 예측 자세히')
                checks.ok(named.count() >= 1, label + ' Q1 강조 대상과 단추 낱말 일치')
            else:
                fallback = page.locator('#lg-bar [data-panel="result"]')
                checks.ok(fallback.evaluate("e=>e.classList.contains('lg-coach-target')||!!e.closest('.lg-coach-target')"),
                          label + ' Q1 대체 경로 강조 대상 결과')
                checks.ok(page.locator('#lg-coach-action').inner_text().strip() == '결과', label + ' Q1 대체 이름 결과')
            press(page, '#lg-coach-action', touch)
        elif step == 7:
            if page.locator('#lg-coach-action').inner_text().strip() == '원인 열기':
                cards = page.locator('#lg-outage-cards [data-missed]')
                if not cards.count():
                    raise AssertionError('코치 7/8 원인 카드 없음')
                cards.first.tap() if touch else cards.first.click()
                press(page, '#lg-outage-open', touch)
            else:
                press(page, '#lg-coach-action', touch)
        elif step == 8:
            return coach_eight(checks, page, label, touch)
        else:
            raise AssertionError(f'코치 8/8 전에 소실: {step}')
        page.wait_for_function("old=>Number(document.querySelector('#lg-coach')?.dataset.step)!==old",
                               arg=step, timeout=20000)
    raise AssertionError('코치 8/8 도달 실패')


def coach_eight(checks, page, label, touch):
    checks.ok(page.locator('#lg-coach-action').inner_text().strip() == '이유 쓰기', label + ' Q3 8/8 이유 쓰기')
    choices = page.locator('.lg-decision-actions [data-answer]')
    checks.ok(choices.count() == 2, label + ' Q3 유지·고침 단추 2개')
    checks.ok(all(n.get_attribute('aria-pressed') != 'true' for n in choices.all()), label + ' Q3 선택 전 상태')
    press(page, '#lg-coach-action', touch)
    # scroll_into_view_if_needed 금지: 코치가 만든 스크롤 결과 그대로 hit 검사.
    frames(page)
    for node in choices.all():
        hit(checks, node, label + ' Q3 ' + node.inner_text())
    checks.ok(page.locator('.lg-decision-actions').evaluate("e=>e.classList.contains('lg-coach-target')"),
              label + ' Q3 단추 줄 강조')
    checks.ok(choices.first.evaluate('e=>document.activeElement===e'), label + ' Q3 첫 단추 초점')
    checks.shot(page, label + '-choices')
    choices.first.tap() if touch else choices.first.click()
    checks.ok(choices.first.get_attribute('aria-pressed') == 'true', label + ' Q3 유지/고침 실제 선택')
    press(page, '#lg-coach-action', touch)
    frames(page)
    reason = page.locator('[data-note="askReason"]').first
    checks.ok(reason.evaluate("e=>e.classList.contains('lg-coach-target')||!!e.closest('.lg-coach-target')"),
              label + ' Q3 고른 뒤 이유 칸 강조')
    checks.ok(reason.evaluate('e=>document.activeElement===e'), label + ' Q3 고른 뒤 이유 칸 초점')
    hit(checks, reason, label + ' Q3 고른 뒤 이유 칸')
    overflow(checks, page, label + ' Q3')


def calibration(checks, context, base, label, pages):
    # 기존 시작본(상대는 컴퓨터)·진행자 한 탭과 사람 팀 한 탭을 그대로 재사용한다.
    host, team, _ = setup_pair(context, base, 12, pages)
    advance(host, team, 1, 'plan')
    dismiss_guide(team)
    team.locator('#bd-canvas').wait_for(state='visible')
    # 팀 기기 자체의 약속 confidence·실제 결과를 만들며 outcome은 주입하지 않는다.
    close_drawer(team)
    team.locator('[data-run="7"]').click()
    finish_trial(team)
    close_drawer(team)
    team.locator('#lg-ready').click()
    from league_flow import pass_issue_check
    pass_issue_check(team)
    team.locator('#lg-ready-confirm').wait_for(state='visible')
    team.locator('#lg-predict [data-evidence]').first.click()
    team.locator('#lg-predict [data-pred]').select_option('up')
    team.locator('[data-confidence="fairly"]').click()
    team.locator('#lg-ready-confirm').click()
    advance(host, team, 1, 'review')
    team.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    wait_unfolded(team)
    open_panel(team, 'result')
    node = team.locator('#lg-calibration')
    node.wait_for(state='visible')
    checks.ok(node.count() == 1 and '내 확신 보정 · 기기에만' in node.inner_text(), label + ' E4 팀 결과 확신 보정')
    checks.ok(host.locator('#lg-calibration, #lg-final-calibration').count() == 0, label + ' E4 진행자 두 보정 영역 없음')
    # 결과 렌더링이 팀 기기 기록에 outcome을 남겼는지 확인(새 키나 전송을 만들지 않는다).
    team.wait_for_timeout(1300)  # 기존 기기 저장 디바운스가 끝난 뒤 읽는다.
    outcomes = team.evaluate("""() => {
      const L=KCP.league.state(),raw=JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`)||'{}');
      return Object.values(raw.interview?.months||{}).filter(n=>n.confidence&&n.outcome).length;
    }""")
    checks.ok(outcomes >= 1, f'{label} E4 기존 팀 기기 저장본에 confidence·outcome 기록: {outcomes}건')
    for page, _, role in pages:
        overflow(checks, page, label + ' E4 ' + role)
    checks.shot(team, label + '-calibration')
    # endgrid.team_end와 같은 월 진행을 기존 멀티 도우미 advance·prepare로 이어 간다.
    # 첫 달 confidence/outcome을 유지한 채 실제 12달 결과를 만든다.
    for month in range(2, 13):
        advance(host, team, month, 'plan')
        wait_unfolded(team)
        prepare(team)
        advance(host, team, month, 'review')
        team.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        wait_unfolded(team)
    advance(host, team, 12, 'end')
    wait_unfolded(team)
    open_panel(team, 'result')
    final = team.locator('#lg-final-calibration')
    final.wait_for(state='visible')
    checks.ok(final.count() == 1 and '내 확신 보정 · 기기에만' in final.inner_text(),
              label + ' E4 팀 끝 화면 확신 보정')
    finished = host.evaluate('() => KCP.league.state().S')
    checks.ok(finished['phase'] == 'end' and finished['round'] == 12 and len(finished['results']) == 12,
              label + ' E4 실제 멀티 12달 완주')
    checks.ok(host.locator('#lg-calibration, #lg-final-calibration').count() == 0,
              label + ' E4 끝 화면 진행자 두 보정 영역 없음')
    for page, _, role in pages:
        overflow(checks, page, label + ' E4 끝 화면 ' + role)
    checks.shot(team, label + '-final-calibration')


def unlinked_summary(checks, page, base, label, touch):
    # E5-a 화면 재현 실패만 SKIP. 재현한 문장의 잘못은 보통 FAIL로 남긴다.
    try:
        start(page, base)
        choose_diesel(page, touch)
        candidates = page.evaluate(CANDIDATES_JS)
        if not candidates:
            raise RuntimeError('전선과 떨어진 디젤 후보 칸 없음')
        before = page.evaluate('() => KCP.buildGame.current().builds.length')
        tile_press(page, candidates[0], touch)
        if touch:
            tile_press(page, candidates[0], touch)
        if shown(page, '#bd-cf-ok'):
            press(page, '#bd-cf-ok', touch)
        if page.evaluate('() => KCP.buildGame.current().builds.length') <= before:
            raise RuntimeError('첫 달 미연결 설비 설치 미확보')
        unlinked = page.evaluate('() => KCP.buildGame.planIssues().unlinked.length')
        if unlinked < 1:
            raise RuntimeError('설치 뒤 전선 미연결 수가 0')
        close_drawer(page)
        press(page, '[data-run="7"]', touch)
        finish_trial(page)
        reach_result(page, 1)
        page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        open_panel(page, 'result')
        summary = page.locator('#lg-outage-single')
        if summary.count() != 1 or not summary.is_visible():
            raise RuntimeError('S7 한 줄 요약 대신 원인 카드/다른 분기')
        text = summary.inner_text()
        if '정전 자체는 커요' not in text:
            raise RuntimeError('정전이 큰 한 줄 요약 미확보')
    except Exception as exc:
        checks.skip(label + ' E5-a 화면', f'{type(exc).__name__}: {str(exc).splitlines()[0][:220]}')
        return
    checks.ok('이번 달 변화보다 이번 달' not in text and '있었으니' not in text,
              label + ' E5-a 화면 비문 없음: ' + text)
    checks.ok('있었어요. 다음 달 계획 지도 칩' in text and '확인해요.' in text,
              label + ' E5-a 화면 새 C4')
    overflow(checks, page, label + ' E5-a')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='tests/srv.py의 loopback 주소')
    parser.add_argument('--out', type=Path, default=Path('tests/results/rev12'))
    args = parser.parse_args()
    checks = Checks(args.out)
    try:
        base = local_address(['rev12.py', args.address])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                cases = [(w, h, t, run) for w, h, t in
                         ((1280, 900, False), (1024, 768, True), (390, 844, True))
                         for run in (map_and_result, coach, site_reason, unlinked_summary)]
                cases += [(1180, 820, False, calibration), (390, 844, True, calibration)]
                cases += [(1024, 768, True, warning), (390, 844, True, warning)]
                for width, height, touch, run in cases:
                    label = f'{width}x{height}-' + ('touch-' if touch else 'mouse-') + run.__name__
                    context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
                    context.add_init_script(PROBE)
                    pages = []
                    try:
                        if run is calibration:
                            run(checks, context, base, label, pages)
                        else:
                            page, logs = monitored_page(context)
                            pages.append((page, logs, '혼자'))
                            run(checks, page, base, label, touch)
                    except Exception as exc:
                        checks.ok(False, f'{label} 장면/조작: {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
                        for page, _, role in pages:
                            checks.shot(page, label + '-' + role + '-failure')
                    finally:
                        for page, logs, role in pages:
                            diagnostics(checks, logs, label + ' ' + role)
                            overflow(checks, page, label + ' ' + role + ' 마지막')
                        checks.ok(not external, f'{label} 외부 요청 0: {external}')
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'주소/브라우저 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
