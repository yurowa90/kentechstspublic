"""rev11 명세 수용 검사: 기대값은 rev11-fix/spec.md와 rev11-testfix1 총괄 결정이다.

작성 세션은 python3 -m py_compile만 실행한다. 브라우저 실행은 금지되어 있다.
허용된 샌드박스 밖 로컬 담당자가 tests/srv.py 서버를 띄운 뒤 실행:
  tests/.venv/bin/python tests/league/rev11.py http://127.0.0.1:<포트>/index.html \
    --out tests/results/rev11
시작 저장본 이외 결과/문구/DOM/CSS 주입 없음. 장면 미확보는 BLOCKED 실패.
"""
import argparse
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, Checks as BaseChecks, advance, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, setup_pair, shown)
from fx_end import dismiss_guide
from fx_event import click_progress, expand_strip, observe
from fx_replay import reach_result
from league_flow import finish_trial, start_solo, wait_unfolded
from rev8c import r2_start
from rev8d import start as event_start, wait_deck
from solo import click_next, close_drawer, read


class Checks(BaseChecks):
    def __init__(self, out):
        super().__init__()
        self.out = out
        self.scenes = 0
        self.coach_copy = None

    def blocked(self, label):
        self.ok(False, 'BLOCKED ' + label)

    def shot(self, page, name, clip=None):
        def capture():
            self.out.mkdir(parents=True, exist_ok=True)
            options = {'clip': clip} if clip else {'full_page': False}
            page.screenshot(path=str(self.out / (name + '.png')), **options)
            return True
        self.test('캡처 ' + name, capture)

    def finish(self):
        print(f'INFO 필수 시나리오 {self.scenes}개 실행 시도', flush=True)
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


class InputBrowser:
    """econui의 로컬 요청 차단/테마 설정을 유지하고 터치 여부만 명시한다."""
    def __init__(self, browser, touch):
        self.browser, self.touch = browser, touch

    def new_context(self, **options):
        return self.browser.new_context(has_touch=self.touch, reduced_motion='no-preference', **options)


DOM = r"""(() => {
  const visible=e=>{
    if(!e || !e.getClientRects().length) return false;
    const r=e.getBoundingClientRect(); if(r.width<=0 || r.height<=0) return false;
    for(let p=e;p;p=p.parentElement) {
      const s=getComputedStyle(p);
      if(p.hidden || s.display==='none' || /hidden|collapse/.test(s.visibility) || +s.opacity===0) return false;
      if(p.tagName==='DETAILS' && !p.open && !p.querySelector('summary')?.contains(e)) return false;
    }
    return true;
  };
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const area=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
    Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  return {visible,box,area};
})()"""

# R8c: 2.2초 알림은 Python이 기다린 뒤 이미 사라질 수 있다. 시작 전부터 읽기만 한다.
# R8b: 재생 프레임마다 범례를 읽어 한 프레임의 숨김 실패도 남긴다.
PROBE = r"""(() => {
  window.__rev11={toasts:[],replay:[]};
  const scan=()=>{
    const {visible,box,area}=(""" + DOM + r""");
    const toast=document.querySelector('#bd-toast[data-show="true"]');
    const live=window.KCP?.league?.state?.(), state=live?.S||live?.snap;
    if(state?.phase==='plan' && visible(toast) && /\d+월 계획 시작/.test(toast.textContent)) {
      const rows=[...document.querySelectorAll('[data-run]')].filter(visible).map(box);
      __rev11.toasts.push({text:toast.textContent,round:state.round,phase:toast.dataset.phase,box:box(toast),rows,
        overlaps:rows.map(r=>area(box(toast),r))});
    }
    if(document.querySelector('#bd-root.bd-replaying')) {
      const key=document.querySelector('#bd-town-look-key');
      __rev11.replay.push({exists:!!key,hidden:key?.hidden,visible:visible(key)});
    }
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
})();"""


def frames(page):
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')


def start(page, base, coach=False):
    r2_start(page, base)
    start_solo(page, months=12)
    page.wait_for_selector('#bd-canvas')
    if not coach:
        dismiss_guide(page)


def press(page, selector, touch):
    node = page.locator(selector)
    node.tap() if touch else node.click()


def button_copy(checks, page, selector, visible, aria, label):
    node = page.locator(selector)
    node.wait_for(state='visible')
    checks.ok(node.inner_text().strip() == visible, label + ' 보이는 글자 = ' + visible)
    checks.ok(node.get_attribute('aria-label') == aria, label + f' aria-label = {aria!r}')
    if aria is not None:
        checks.ok(node.inner_text().strip() != node.get_attribute('aria-label'), label + ' 보이는 글자와 aria 구분')
    return node.inner_text().strip(), node.get_attribute('aria-label')


def attempt(checks, label, action):
    """독립 항목 하나의 재현 실패가 같은 화면의 다음 항목을 생략시키지 않게 한다."""
    try:
        action()
    except Exception as exc:
        checks.blocked(f'{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')


def dock(checks, page, base, label, touch):
    """R1·R2: 코치 행동 → 막대 화력 직접 입력. 강제 클릭/DOM 변경 없음."""
    start(page, base, coach=True)
    page.wait_for_selector('#lg-coach[data-step="1"]')
    checks.coach_copy = button_copy(checks, page, '#lg-coach-close', '코치 닫기', '첫 달 코치 닫기', label + ' R2 코치')
    if page.viewport_size['width'] == 390:
        size = page.locator('#lg-coach-close').bounding_box()
        checks.ok(bool(size) and size['width'] >= 44 and size['height'] >= 44, label + ' R2 코치 닫기 ≥44×44')
    press(page, '#lg-coach-action', touch)
    page.locator('#lg-panel').wait_for(state='visible')
    checks.ok(shown(page, '#lg-panel'), label + ' R1 코치 행동으로 서랍 열림')
    overflow(checks, page, label + ' R1 누르기 전')
    if page.viewport_size['width'] == 390:
        checks.shot(page, label + '-before')
    press(page, '#bd-dock [data-group="fire"]', touch)
    frames(page)
    checks.ok(page.locator('#lg-panel').evaluate('e=>e.hidden') is True, label + ' R1 화력 직접 누른 뒤 lg-panel hidden')
    tools = page.locator('#bd-subtools [data-tool]').evaluate_all(r"""nodes=>{
      const {visible,box}=(""" + DOM + r""");
      return nodes.filter(visible).map(e=>{
        const r=box(e), hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
        return {tool:e.dataset.tool,box:r,hit:!!hit&&e.contains(hit)};
      });
    }""")
    checks.ok(len(tools) == 5, f'{label} R1 보이는 화력 도구 5개: {tools}')
    checks.ok(bool(tools) and all(row['hit'] for row in tools), f'{label} R1 모든 도구 중심 hit가 자기 버튼 안: {tools}')
    overflow(checks, page, label + ' R1 누른 뒤')
    if page.viewport_size['width'] == 390:
        checks.shot(page, label + '-after')
    # R2: 문구 변경 뒤에도 실제 닫기 동작 유지.
    press(page, '#lg-coach-close', touch)
    page.locator('#lg-coach').wait_for(state='hidden')
    checks.ok(not shown(page, '#lg-coach'), label + ' R2 코치 닫기 동작')


def events(checks, page, base, label, touch):
    """R2: fx_event와 같은 자연 사건 시작본(FXW4AAA8), 사건/달 주입 없음."""
    event_start(page, base)
    wait_deck(page, True)
    if shown(page, '.fx-turn-expand[aria-expanded="false"]'):
        if not expand_strip(checks, page, label):
            raise AssertionError('R2 사건 묶음 펼침 실패')
    # 총괄 R2: C2a 삭제. 보이는 글자만 접근성 이름으로 사용한다.
    actual = button_copy(checks, page, '.fx-turn-close', '사건 닫기', None, label + ' R2 사건')
    named = page.get_by_role('button', name='사건 닫기', exact=True)
    checks.ok(named.count() == 1 and named.is_visible(), label + ' R2 사건 닫기 실제 접근성 이름')
    checks.ok(bool(checks.coach_copy) and actual[0] != checks.coach_copy[0] and
              (actual[1] or actual[0]) != (checks.coach_copy[1] or checks.coach_copy[0]),
              label + ' R2 실제 두 닫기 보이는 글자·접근성 이름 구분')
    overflow(checks, page, label + ' R2 사건 펼침')
    checks.shot(page, label + '-close')
    press(page, '.fx-turn-close', touch)
    page.wait_for_function('() => KCP.fxTurn?.state?.().cardsOpen === false')
    checks.ok(not shown(page, '.fx-turn-close'), label + ' R2 사건 닫기 동작')


def host_ledger(checks, context, base, label, pages):
    """R4: econui의 진행자+팀 준비/월 운영 경로, 결과 수치 주입 없음."""
    host, team, _ = setup_pair(context, base, 12, pages)
    advance(host, team, 1, 'plan')
    dismiss_guide(team)
    advance(host, team, 1, 'review')
    host.locator('#lg-host-summary-table').wait_for(state='visible')
    data = host.evaluate(r"""() => {
      const {box,visible}=(""" + DOM + r""");
      const table=document.querySelector('#lg-host-summary-table'),wrap=table.closest('.lg-tablewrap');
      const sizes=sel=>[...document.querySelectorAll(sel)].filter(visible).map(e=>parseFloat(getComputedStyle(e).fontSize));
      return {small:sizes('#lg-host-summary-table .lg-ledger-value small'),
        city:sizes('#lg-host-summary-table th[scope="row"] button'),next:sizes('#lg-next'),
        table:box(table),wrap:box(wrap),sw:wrap.scrollWidth,cw:wrap.clientWidth,
        host:document.documentElement.classList.contains('v2-league-host'),
        headings:[...table.querySelectorAll('thead th')].map(e=>e.textContent.trim())};
    }""")
    checks.ok(data['host'], label + ' R4 실제 진행자 화면')
    for key, minimum in (('small', 14), ('city', 18), ('next', 16)):
        checks.ok(bool(data[key]) and min(data[key]) >= minimum, f'{label} R4 {key} ≥{minimum}px: {data[key]}')
    checks.ok(data['table']['right'] <= data['wrap']['right'], f'{label} R4 표 오른쪽 ≤ 래퍼 오른쪽: {data}')
    checks.ok(data['sw'] <= data['cw'], f'{label} R4 래퍼 내부 가로 스크롤 0: {data["sw"]}/{data["cw"]}')
    checks.ok('CO₂ 생산(t/월)' in data['headings'], label + ' R5 장부 열 머리 CO₂ 생산(t/월)')
    overflow(checks, host, label + ' R4 운영 뒤')
    if host.viewport_size['width'] == 1920:
        checks.shot(host, label + '-ledger')


def consumption(checks, text, label):
    # R5: 값은 검사 근거로 복제하지 않는다. 가상 수치가 아니라 화면 이름과 단위만 본다.
    checks.ok('CO₂ 소비(계통 포함)' in text, label + ' CO₂ 소비(계통 포함) 표시')
    bare = re.findall(r'CO₂\s*[-+−]?\d[\d,.]*\s*t\b(?!/MWh)', text)
    checks.ok(not bare, f'{label} 이름 없는 CO₂ n t 없음: {bare}')


def expanded_strip(checks, page, label):
    """R8d: 390 실제 시험 재생을 펼친 상태. 스타일/재생 시간을 바꾸지 않는다."""
    page.locator('#bd-run').wait_for(state='visible')
    page.locator('#bd-run').get_by_role('button', name='그래프 열기', exact=True).click()
    frames(page)
    data = page.evaluate(r"""() => {
      const {visible,box}=(""" + DOM + r""");
      const run=document.querySelector('#bd-run'),canvas=document.querySelector('#bd-canvas');
      const r=box(run),c=box(canvas);let streak=0,longest=0;
      // 실제 hit test로 덮인 지도 줄을 제외한다. 단순 캔버스 DOM 높이를 쓰지 않는다.
      const top=Math.max(0,Math.ceil(c.top)),bottom=Math.min(innerHeight,Math.floor(c.bottom));
      for(let y=top;y<bottom;y++) {
        const open=[.15,.35,.5,.65,.85].some(f=>{
          const x=Math.max(0,c.left)+(Math.min(innerWidth,c.right)-Math.max(0,c.left))*f;
          return document.elementFromPoint(x,y)===canvas;
        });
        streak=open?streak+1:0;longest=Math.max(longest,streak);
      }
      const expanded=[...run.querySelectorAll('button')].some(b=>b.getAttribute('aria-expanded')==='true');
      return {visible:visible(run),expanded,run:r,canvas:c,mapVisibleHeight:longest,height:innerHeight};
    }""")
    checks.ok(data['visible'] and data['expanded'], f'{label} R8d 재생 중 운영 띠 실제 펼침: {data}')
    checks.ok(data['run']['height'] <= data['height'] * .45, f'{label} R8d 띠 높이 ≤45%: {data}')
    checks.ok(data['mapVisibleHeight'] >= data['height'] * .25, f'{label} R8d 지도 보이는 연속 높이 ≥25%: {data}')
    overflow(checks, page, label + ' R8d')
    checks.shot(page, label + '-expanded')


def build_trial(checks, page, base, label, touch):
    """R5: econui의 #build 평택 시작본·시험·일지 UI 경로."""
    page.goto(base + '#home')
    page.wait_for_function(BOOT_JS)
    page.evaluate("""() => localStorage.setItem('kcp-build-v1',
      JSON.stringify(KCP.buildGame.sanitizeDoc({map:'pyeongtaek'})))""")
    page.goto(base + '#build')
    page.wait_for_selector('#bd-canvas')
    # econui의 #build 경로: 미션 2개가 없으면 startRun은 시험 대신 미션 서랍을 연다.
    press(page, '#bd-pm', touch)
    page.locator('#bd-drawer-body').wait_for(state='visible')
    press(page, '[data-tab="mission"]', touch)
    page.locator('[data-mis]').first.wait_for(state='visible')
    for node in page.locator('[data-mis]').all()[:2]:
        node.tap() if touch else node.click()
    if shown(page, '#bd-drawer-x'):
        press(page, '#bd-drawer-x', touch)
    press(page, '[data-run="7"]', touch)
    page.wait_for_function("() => document.documentElement.classList.contains('bd-running') || "
                           "!!document.querySelector('#bd-j-dlg[open]')")
    # rev11-testfix2: 이미 끝난 시험에는 skip이 없으므로 결과 대화상자를 기다린다.
    if shown(page, '#bd-skip'):
        press(page, '#bd-skip', touch)
    page.locator('#bd-j-dlg[open]').wait_for(state='visible')
    consumption(checks, page.locator('#bd-j-dlg').inner_text(), label + ' R5 1주 뒤 일지 요약')
    overflow(checks, page, label + ' R5 일지 요약')
    checks.shot(page, label + '-journal-summary')
    page.locator('#bd-j-dlg').press('Escape')
    page.locator('#bd-res-title').wait_for(state='visible')
    consumption(checks, page.locator('#bd-drawer-body').inner_text(), label + ' R5 결과 카드')
    overflow(checks, page, label + ' R5 결과 카드')
    checks.shot(page, label + '-result')
    if not shown(page, '[data-tab="journal"]'):
        press(page, '#bd-pm', touch)
    press(page, '[data-tab="journal"]', touch)
    page.locator('.bd-jc-m').first.wait_for(state='visible')
    cards = page.locator('.bd-jc-m:visible').all_inner_texts()
    checks.ok(bool(cards), label + ' R5 건설 일지 카드 있음')
    for i, text in enumerate(cards):
        consumption(checks, text, f'{label} R5 건설 일지 카드 {i + 1}')
    overflow(checks, page, label + ' R5 건설 일지 카드')
    checks.shot(page, label + '-journal-card')


def league_strip(checks, page, base, label, touch):
    # R8d: 리그 전용 CSS/머리/도크와 공존하는 390 계획 지도에서 실제 1주 시험을 펼친다.
    start(page, base)
    close_drawer(page)
    press(page, '[data-run="7"]', touch)
    expanded_strip(checks, page, label)
    finish_trial(page)


def lens(checks, page, label):
    """R8a: 실제 렌즈 조작, 문제 칩과 범례 사각형/글자 hit 측정."""
    close_drawer(page)
    for key in ('grid', 'complaints'):
        button = page.locator(f'[data-lens="{key}"]')
        if button.get_attribute('aria-pressed') != 'true':
            button.click()
    page.locator('[data-lens="complaints"]').focus()
    page.locator('.lg-lens-key').wait_for(state='visible')
    frames(page)
    data = page.evaluate(r"""() => {
      const {visible,box,area}=(""" + DOM + r""");
      const keys=[...document.querySelectorAll('.lg-lens-key')].filter(visible);
      // 기존 fx_event의 문제 칩 선택자와 s8n의 폭별 문제 칩 줄을 함께 잰다.
      const selector='[data-issue], #lg-plan-issues, '+(innerWidth<=760?'#lg-watch':'#lg-hud-chips');
      const chips=[...document.querySelectorAll(selector)].filter(visible);
      return {chips:chips.map(e=>({id:e.id,text:e.textContent,box:box(e)})),keys:keys.map(e=>{
        const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const textHits=[];
        while(walker.nextNode()) {
          const node=walker.currentNode;if(!node.textContent.trim()||!visible(node.parentElement))continue;
          for(let at=0;at<node.textContent.length;at++) {
            if(/\s/.test(node.textContent[at]))continue;
            const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);
            for(const r of range.getClientRects()) {
              if(r.width<=0||r.height<=0)continue;
              const hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
              textHits.push({text:node.textContent[at],hit:!!hit&&e.contains(hit),
                inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight});
            }
          }
        }
        return {box:box(e),overlaps:chips.map(c=>area(box(e),box(c))),textHits};
      })};
    }""")
    checks.ok(bool(data['chips']) and bool(data['keys']), f'{label} R8a 문제 칩·범례 실제 표시: {data}')
    for i, row in enumerate(data['keys']):
        no_overlap = all(area == 0 for area in row['overlaps'])
        above = bool(row['textHits']) and all(hit['hit'] and hit['inside'] for hit in row['textHits'])
        checks.ok(bool(row['textHits']) and (no_overlap or above),
                  f'{label} R8a 범례 {i + 1} 겹침 0 또는 모든 범례 글자 위층: {row}')
    overflow(checks, page, label + ' R8a')
    checks.shot(page, label + '-lens')


def planning_toast(checks, page, label):
    # rev11-testfix2: 첫 1월에는 알림이 없다. rev9/10의 실제 UI 달 넘김으로 2월을 연다.
    reach_result(page, 1)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying') && "
                           "!document.querySelector('#bd-run:not([hidden])')", timeout=30000)
    wait_unfolded(page)
    for _ in range(3):
        if not page.evaluate('() => KCP.fxTurn?.state?.().cardsOpen'):
            break
        page.keyboard.press('Escape')
    close_drawer(page)
    page.mouse.move(0, 0)
    page.keyboard.press('Escape')
    page.locator('#bd-tip').wait_for(state='hidden')
    page.evaluate('() => {__rev11.toasts=[];}')
    click_next(page, read(page)['S'])
    page.wait_for_function("() => __rev11.toasts.some(row => row.round === 2 && /2월 계획 시작/.test(row.text))",
                           timeout=6000)
    before = page.evaluate(r"""() => {
      const {visible}=(""" + DOM + r""");
      const toast=document.querySelector('#bd-toast');
      return {toast:visible(toast)&&toast.dataset.show==='true',text:toast?.textContent,
        tip:visible(document.querySelector('#bd-tip'))};
    }""")
    if not before['toast'] or before['tip'] or not re.search(r'2월 계획 시작', before['text'] or ''):
        raise AssertionError(f'R8c 새 칸 말풍선을 열기 직전 2월 계획 알림 장면 미확보: {before}')
    # 실제 지도 키보드 입력으로 새 말풍선을 연다. 알림 수명 종료를 닫기 성공으로 세지 않는다.
    page.locator('#bd-canvas').press('ArrowRight')
    frames(page)
    # data-show 닫힘은 입력 직후 판정하고, 실제 숨김은 0.18초 CSS 전환 뒤 확인한다.
    closed = page.locator('#bd-toast').get_attribute('data-show') == 'false'
    if closed:
        page.wait_for_function('() => !(' + DOM + ').visible(document.querySelector("#bd-toast"))', timeout=1000)
    after = page.evaluate(r"""() => {
      const {visible}=(""" + DOM + r""");
      const toast=document.querySelector('#bd-toast');
      return {tip:visible(document.querySelector('#bd-tip')),toast:visible(toast),show:toast?.dataset.show};
    }""")
    samples = page.evaluate('() => __rev11.toasts')
    checks.ok(bool(samples) and all(row['round'] == 2 and re.search(r'2월 계획 시작', row['text']) for row in samples),
              label + ' R8c 1월 운영 뒤 2월 계획 시작 알림 관측')
    checks.ok(bool(samples) and all(row['phase'] == 'plan' for row in samples),
              label + ' R8c 계획 시작 알림 data-phase=plan')
    checks.ok(bool(samples) and all(row['rows'] and all(a == 0 for a in row['overlaps']) for row in samples),
              f'{label} R8c 보이는 동안 시험 단추 줄 겹침 0: 표본 {len(samples)}, '
              f'최대 {max((max(row["overlaps"], default=-1) for row in samples), default=-1)}px²')
    checks.ok(closed and after['tip'] and not after['toast'] and after['show'] == 'false',
              f'{label} R8c 새 칸 말풍선 표시 때 계획 시작 알림 닫힘: {after}')


def calc_digits(checks, page, label):
    # 총괄 R6: 표시 문자열 기준의 음수 반값. 공개 순수 함수만 호출하고 상태는 바꾸지 않는다.
    data = page.evaluate(r"""() => {
      const calc=KCP.league?.calcDigits;
      if(typeof calc!=='function') return {missing:true};
      const delta=-0.505,tol=0.5,base=2,digits=calc(delta,tol,base);
      const text=(x,d)=>Math.abs(Math.round(x*10**d)/10**d).toLocaleString('ko-KR',
        {minimumFractionDigits:d,maximumFractionDigits:d});
      return {digits,integer:Number.isInteger(digits),baseDelta:text(delta,base),baseTol:text(tol,base),
        delta:text(delta,digits),tol:text(tol,digits)};
    }""")
    checks.ok(not data.get('missing') and data['baseDelta'] == data['baseTol'],
              f'{label} R6 현금 −0.505 / ±0.5의 두 자리 표시 충돌 재현: {data}')
    checks.ok(not data.get('missing') and data['integer'] and 3 <= data['digits'] <= 4 and
              data['delta'] != data['tol'], f'{label} R6 음수 반값은 3자리 이상으로 구별: {data}')


def line_feedback(checks, page, base, label, touch):
    """총괄 R8c: 실제 송전선 입력 오류 알림은 칸 말풍선과 함께 표시한다."""
    start(page, base)
    close_drawer(page)
    if not shown(page, '[data-tool="line"]'):
        press(page, '#bd-dock [data-group="grid"]', touch)
    press(page, '[data-tool="line"]', touch)
    # 클릭 직후 확인한다. evaluate로 도구를 고르거나 속성을 주입하지 않는다.
    checks.ok(page.locator('#bd-root').get_attribute('data-line-tool') == 'true',
              label + ' R8c 송전선 도구 실제 클릭 직후 data-line-tool=true')

    def candidates():
        return page.evaluate(r"""() => {
          const B=KCP.buildGame,st=B.current(),cv=document.querySelector('#bd-canvas'),r=cv.getBoundingClientRect();
          const builds=new Set(st.builds.map(b=>b.i)),lines=new Set(st.lines.flatMap(l=>l.p));
          const rows=B.TILES.filter(t=>!t.out).map(t=>{
            const p=B.tileXY(t.c,t.r);if(!p)return null;
            const x=p[0]+r.left,y=p[1]+r.top;
            return document.elementFromPoint(x,y)===cv ? {i:t.i,x,y,
              start:t.site>=0||builds.has(t.i)||lines.has(t.i),
              sea:t.site<0&&!t.land&&!builds.has(t.i)&&!lines.has(t.i)} : null;
          }).filter(Boolean);
          return {starts:rows.filter(t=>t.start),ends:rows.filter(t=>t.sea)};
        }""")

    # 도구 선택의 자동 확대 뒤에도 실제 지도/도크 버튼만 써서 두 끝점을 확보한다.
    tiles = candidates()
    for _ in range(6):
        if tiles['starts'] and tiles['ends']:
            break
        press(page, '[data-zoom="-1"]', touch)
        frames(page)
        tiles = candidates()
    if not tiles['starts'] or not tiles['ends']:
        raise AssertionError('R8c 화면에서 송전선 시작점과 잘못된 바다 끝점 확보 실패')
    origin = tiles['starts'][0]
    click = page.touchscreen.tap if touch else page.mouse.click
    click(origin['x'], origin['y'])
    if page.evaluate('() => KCP.buildGame.lineState().start') != origin['i']:
        raise AssertionError('R8c 실제 클릭으로 송전선 시작점 선택 실패')
    frames(page)
    ends = candidates()['ends']
    if not ends:
        raise AssertionError('R8c 시작점 선택 뒤 말풍선에 가리지 않은 바다 끝점 없음')
    end = ends[0]
    click(end['x'], end['y'])
    frames(page)
    # #56: 알림은 data-show="true" 뒤 opacity 0에서 0.18초 전환으로 나타난다(build.css .bd-toast). 예전에는 두 rAF 뒤 한 번만
    # 읽어, 느린 공유 실행기에서 전환이 아직 진행되지 않은 프레임(opacity 0)을 읽으면 toast만 False가 됐다(CI 1280·390 줄,
    # 다른 측정값은 맥과 같음). 명세(이 함수 설명, 총괄 R8c)는 '알림을 칸 말풍선과 함께 표시한다'이다.
    # 그래서 말풍선·알림 표시(data-show)·글자·표지는 예전처럼 첫 읽기(클릭 + 두 rAF) 값으로 단언하고,
    # 투명도 전환만 기다린다: 첫 읽기에서 말풍선과 data-show가 이미 참일 때에 한해 1.5초(알림 수명 2.2초 안) 동안 매 프레임
    # 읽어 말풍선·알림이 함께 보이는 첫 프레임을 쓴다. 말풍선이나 data-show가 늦게 나타나는 회귀는 첫 읽기에서 실패한다.
    # 끝내 함께 보이지 않으면(말풍선이 먼저 사라져도) 실패다.
    # 결정적 조건(같은 '동시 표시' 단언 안, 단언 수 불변): 첫 읽기에서 늘 계산 스타일의 transitionDelay(opacity 또는 all 칸)가
    # 0s여야 하고, 그때 알림이 보이지 않으면 알림에 지연 0인 불투명도 전환·애니메이션이 진행 중(running 또는 pending)이어야
    # 한다(toast.getAnimations()). 맥 4·6배 감속 재현에서 옛 측정이 실패한 때는 모두 opacity '0'과 CSSTransition
    # {playState: running, startTime: null}(시작 대기)이었다. 지연이 생기거나 전환 없이 숨는 회귀는 창 안에서 보여도 실패다.
    data = page.evaluate(r"""async () => {
      const {visible}=(""" + DOM + r""");
      const read=()=>{const toast=document.querySelector('.bd-toast'),tip=document.querySelector('#bd-tip');
        return {tip:visible(tip),toast:visible(toast),phase:toast?.getAttribute('data-phase'),
          text:toast?.textContent.trim(),show:toast?.getAttribute('data-show')};};
      // 계산 스타일의 opacity(또는 all) 칸 transitionDelay가 0s인지는 첫 읽기에서 늘 본다. 진행 중 전환은 안 보일 때만 본다.
      const fade=visibleNow=>{
        const t=document.querySelector('.bd-toast');if(!t)return {ok:false,why:'알림 없음'};
        const s=getComputedStyle(t),props=s.transitionProperty.split(',').map(x=>x.trim()),
          delays=s.transitionDelay.split(',').map(x=>x.trim()),i=props.findIndex(p=>p==='opacity'||p==='all');
        const cssDelay=i<0?null:delays[i%delays.length],delayOk=cssDelay!==null&&parseFloat(cssDelay)===0;
        if(visibleNow)return {ok:delayOk,cssDelay};
        const anims=t.getAnimations().map(a=>{
          const kf=a.effect?.getKeyframes?.()||[];
          return {prop:a.transitionProperty??(kf.some(k=>'opacity' in k)?'opacity':(a.animationName??null)),
            state:a.playState,pending:a.pending,delay:a.effect?.getTiming?.().delay??null};});
        const live=anims.filter(a=>a.prop==='opacity'&&(a.state==='running'||a.pending)&&a.delay===0);
        return {ok:delayOk&&live.length>0,cssDelay,anims};
      };
      const start=performance.now(),first=read();
      first.fade=fade(first.toast);
      let d=first,frames=0;
      while(first.tip&&first.show==='true'&&!(d.tip&&d.toast&&d.show==='true')&&performance.now()-start<1500) {
        await new Promise(r=>requestAnimationFrame(r));frames++;d=read();
      }
      return {first,both:{tip:d.tip,toast:d.toast,show:d.show,frames,ms:Math.round(performance.now()-start)}};
    }""")
    first, both = data['first'], data['both']
    shown_first = {k: first.get(k) for k in ('tip', 'toast', 'phase', 'text', 'show')}
    checks.ok(first['tip'], f'{label} R8c 잘못된 끝점의 칸 말풍선 표시: {shown_first}')
    checks.ok(first['text'] == '끝점은 육지나 발전소' and first['phase'] is None,  # rev11 검토: 표지 없는 알림은 data-phase 자체가 없어야 한다
              f'{label} R8c 단계 표지 없는 송전선 피드백 알림: {shown_first}')
    fading = bool((first.get('fade') or {}).get('ok'))  # 지연 0s는 늘, 진행 중 전환은 첫 읽기에 안 보일 때만
    checks.ok(first['tip'] and first['show'] == 'true' and fading and
              both['tip'] and both['toast'] and both['show'] == 'true',
              f'{label} R8c 송전선 피드백 알림과 칸 말풍선 동시 표시: {first} → {both}')
    overflow(checks, page, label + ' R8c 송전선 피드백')
    checks.shot(page, label + '-line-feedback')


def map_overlays(checks, page, base, label, touch):
    start(page, base)
    attempt(checks, label + ' R6', lambda: calc_digits(checks, page, label))
    attempt(checks, label + ' R8a', lambda: lens(checks, page, label))
    close_drawer(page)
    # rev12 Q2: plan에서만 접히므로 review와 직접 비교하지 않는다.
    # 재생 뒤 다음 plan에서 같은 details 접힘 상태를 맞춰 원래 복원 단언을 유지한다.
    toggle = page.locator('[aria-label="범례·여유: 지도 범례와 접속 여유 보기"]')
    folded = page.viewport_size['width'] <= 1100
    baseline_open = toggle.evaluate("e=>!!e.closest('details')?.open") if folded else None
    baseline = page.locator('#bd-town-look-key').evaluate('e=>({hidden:e.hidden,visible:(' + DOM + ').visible(e)})')
    page.evaluate('() => {__rev11.replay=[];}')
    reach_result(page, 1)
    page.wait_for_selector('#bd-root.bd-replaying', timeout=8000)
    checks.ok(not shown(page, '#bd-town-look-key'), label + ' R8b 재생 중 마을 범례 숨김')
    canvas = page.locator('#bd-canvas').bounding_box()
    if not canvas:
        raise AssertionError('R8b 지도 캔버스 캡처 영역 없음')
    width, height = page.viewport_size['width'], page.viewport_size['height']
    bottom = min(height, canvas['y'] + canvas['height'])
    clip = {'x': max(0, canvas['x']), 'y': max(0, bottom - height * .4),
            'width': min(width - max(0, canvas['x']), 600), 'height': min(bottom, height * .4)}
    checks.shot(page, label + '-replay-lower-left', clip)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    frames(page)
    replay = page.evaluate('() => __rev11.replay')
    checks.ok(bool(replay) and all(row['exists'] and not row['visible'] for row in replay),
              f'{label} R8b 재생 모든 관측 프레임 숨김: {len(replay)}개')
    if folded:
        checks.ok(shown(page, '#bd-town-look-key'), label + ' R8b 재생 뒤 결과 단계 범례 펼침')
    else:  # ≥1101px는 기존 재생 직후 비교 그대로.
        restored = page.locator('#bd-town-look-key').evaluate('e=>({hidden:e.hidden,visible:(' + DOM + ').visible(e)})')
        checks.ok(restored == baseline, f'{label} R8b 재생 뒤 원래 hidden/표시 복원: {baseline} → {restored}')
    overflow(checks, page, label + ' R8b')
    attempt(checks, label + ' R8c', lambda: planning_toast(checks, page, label))
    if folded:
        checks.ok(read(page)['S']['phase'] == 'plan', label + ' R8b 복원 비교는 같은 계획 단계')
        if toggle.evaluate("e=>!!e.closest('details')?.open") != baseline_open:
            press(page, '[aria-label="범례·여유: 지도 범례와 접속 여유 보기"]', touch)
            frames(page)
        restored = page.locator('#bd-town-look-key').evaluate('e=>({hidden:e.hidden,visible:(' + DOM + ').visible(e)})')
        checks.ok(restored == baseline, f'{label} R8b 재생 뒤 원래 hidden/표시 복원: {baseline} → {restored}')


def end_graph(checks, page, base, label, touch):
    # R5: fx_end의 12달 UI 진행 방식만 재사용한다. 옛 F2 스타일 기대값은 가져오지 않는다.
    start(page, base)
    state = observe(page)
    for _ in range(40):
        if state['phase'] == 'end':
            break
        state = click_progress(page, state)
        page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        for _ in range(3):
            if not page.evaluate('() => KCP.fxTurn?.state?.().cardsOpen'):
                break
            page.keyboard.press('Escape')
        overflow(checks, page, f'{label} R5 {state["round"]}월 {state["phase"]}')
    complete = state['phase'] == 'end' and state['round'] == 12 and state['count'] == 12
    checks.ok(complete, label + ' R5 실제 UI로 12달 완주')
    if not complete:
        raise AssertionError('R5 12달 끝 화면 미확보')
    wait_unfolded(page)
    open_panel(page, 'result')
    graph = page.locator('#lg-panel [data-fx-metric="co2"]')
    graph.scroll_into_view_if_needed()
    checks.ok('CO₂ 생산' in graph.locator('h4').inner_text(), label + ' R5 끝 그래프 제목 CO₂ 생산')
    checks.ok((graph.locator('[role="img"]').get_attribute('aria-label') or '').startswith('CO₂ 생산,'),
              label + ' R5 끝 그래프 낭독 CO₂ 생산')
    overflow(checks, page, label + ' R5 끝 그래프')
    checks.shot(page, label + '-co2-production')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='tests/srv.py의 loopback 주소(기본 포트 없음)')
    parser.add_argument('--out', type=Path, default=Path('tests/results/rev11'))
    args = parser.parse_args()
    checks = Checks(args.out)
    try:
        base = local_address(['rev11.py', args.address])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                cases = [(390, 844, True, dock), (1024, 768, True, dock), (1280, 900, False, dock)]
                for run in (events, build_trial, map_overlays, line_feedback, end_graph):
                    cases += [(390, 844, True, run), (1280, 900, False, run)]
                cases.append((390, 844, True, league_strip))
                cases += [(1920, 1080, False, host_ledger), (1280, 900, False, host_ledger)]
                for width, height, touch, run in cases:
                    label = f'{width}x{height}-' + ('touch-' if touch else 'mouse-') + run.__name__
                    context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
                    context.add_init_script(PROBE)
                    pages = []
                    checks.scenes += 1
                    try:
                        if run is host_ledger:
                            run(checks, context, base, label, pages)
                        else:
                            page, logs = monitored_page(context)
                            pages.append((page, logs, label))
                            run(checks, page, base, label, touch)
                    except Exception as exc:
                        checks.blocked(f'{label} 장면/조작 실패 {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
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
        checks.blocked(f'주소/브라우저 환경 {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
