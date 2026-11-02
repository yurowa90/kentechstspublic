"""rev9 명세 R1·R2·R3·R6·R8·R9·R13·R15 독립 브라우저 검사.

작성 세션에서 실행 금지. 허용된 샌드박스 밖 로컬 담당자 실행:
  tests/.venv/bin/python tests/league/rev9.py http://127.0.0.1:<포트>/index.html
주소 필수(기본 포트 없음). 결과·DOM 주입 없음.
rev9-2 허용 fixture: 현금 시작값, R13 미확정 '줄 것' 메모와 실제 0 시험의
옛 저장 형식(gridMWh 누락)을 bundle/restore로 복원한다. 판정·알림은 주입하지 않는다.
계획/시험은 s7.plan_and_trial, 진행은 league_flow/solo의 기존 흐름을 재사용한다.
재현 못 한 필수 장면은 BLOCKED 실패. 끝줄 assertions N failures M.
"""

import copy
import json
import re
import sys
from decimal import Decimal

from playwright.sync_api import sync_playwright

from d80b import apply_plan, bundle, restore
from econui import (Checks as BaseChecks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, shown)
from fx_end import dismiss_guide
from league_flow import finish_trial, pass_issue_check, start_solo, wait_unfolded
from rev8c import Blocked, coach_step, r2_start, submit_r2_promise
from s7 import plan_and_trial
from solo import click_next, close_drawer, read
from ux_coach import NEAR_TOWN_JS
from ux_s2fix import reveal_tile
from ux_task import TILE_XY_JS


class Checks(BaseChecks):
    def __init__(self):
        super().__init__()
        self.blocked_count = 0
        self.blocked_r13 = 0

    def blocked(self, label):
        self.blocked_count += 1
        self.blocked_r13 += 'R13' in label
        self.ok(False, 'BLOCKED ' + label)

    def finish(self):
        print(f'blocked {self.blocked_count} (R13 {self.blocked_r13})', flush=True)
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


# rev9 R1·rev9-2 §4: 화면과 조상 overflow 안에서 실제 보이는 부분끼리 비교.
# 잘린 영역만 제외하며, 겹침 문턱·배지 scrollWidth 판정은 그대로 둔다.
HEADER_JS = r"""() => {
  const visible=e=>e && e.checkVisibility({visibilityProperty:true}) &&
    e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0;
  const box=e=>{
    const r=e.getBoundingClientRect(), b={l:Math.max(0,r.left),r:Math.min(innerWidth,r.right),
      t:Math.max(0,r.top),b:Math.min(innerHeight,r.bottom)};
    // rev10 총괄 수정: position:fixed 요소는 (transform·filter·contain 없는) 조상의 overflow에 잘리지 않는다.
    let fixed=getComputedStyle(e).position==='fixed';
    for(let p=e.parentElement;p&&!fixed;p=p.parentElement) {
      const s=getComputedStyle(p),q=p.getBoundingClientRect();
      if(s.position==='fixed') fixed=true;
      const sx=p.offsetWidth ? q.width/p.offsetWidth : 1,sy=p.offsetHeight ? q.height/p.offsetHeight : 1;
      const l=q.left+p.clientLeft*sx,t=q.top+p.clientTop*sy;
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowX)) {
        b.l=Math.max(b.l,l);b.r=Math.min(b.r,l+p.clientWidth*sx);
      }
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowY)) {
        b.t=Math.max(b.t,t);b.b=Math.min(b.b,t+p.clientHeight*sy);
      }
    }
    return b;
  };
  const painted=e=>{if(!visible(e)) return false;const b=box(e);return b.r>b.l && b.b>b.t;};
  const overlap=(a,b)=>Math.min(a.r,b.r)>Math.max(a.l,b.l) && Math.min(a.b,b.b)>Math.max(a.t,b.t);
  const badges=[...document.querySelectorAll('#lg-watch button')].filter(visible);
  const peers=[...document.querySelectorAll('#lg-bar .lg-status > *, #lg-bar .lg-actions > *')]
    .filter(e=>e.id!=='lg-watch' && painted(e));
  const collisions=badges.flatMap(b=>peers.filter(p=>overlap(box(b),box(p)))
    .map(p=>({badge:b.textContent,peer:p.id||p.className,a:box(b),b:box(p)})));
  const chip=document.querySelector('#lg-bar .lg-data-chip > span');
  // rev10 R4: 조상에 잘린 부분도 실패다. 잘린 가시 영역만 비교해서 통과시키지 않는다.
  return {badges:badges.map(e=>{const r=e.getBoundingClientRect(),v=box(e);return {
    text:e.textContent,scroll:e.scrollWidth,client:e.clientWidth,w:r.width,h:r.height,
    whole:r.left>=v.l&&r.right<=v.r&&r.top>=v.t&&r.bottom<=v.b};}),collisions,
    chipVisible:visible(chip),team:[...document.querySelectorAll('#lg-bar .lg-bteam')]
      .map(e=>({text:e.textContent,scroll:e.scrollWidth,client:e.clientWidth}))};
}"""


def header(checks, page, label):
    data = page.evaluate(HEADER_JS)
    if data['badges']:
        # rev10 R4: 오차 없이 scrollWidth ≤ clientWidth, 터치 크기와 조상 잘림 검사.
        checks.ok(all(b['scroll'] <= b['client'] and b['whole'] and b['w'] >= 44 and b['h'] >= 44 for b in data['badges']),
                  f'{label} R1 배지마다 말줄임 없음: {data["badges"]}')
        checks.ok(not data['collisions'], f'{label} R1 다른 머리 요소와 겹침 없음: {data["collisions"]}')
        checks.ok(not data['chipVisible'], label + ' R1 배지 있는 달 가상 글자 접기')
    else:
        checks.ok(data['chipVisible'], label + ' R1 배지 없는 달 가상 글자 유지')
    notice = page.locator('#lg-bar .lg-data-chip summary').filter(has_text='!')
    checks.ok(notice.count() == 1 and notice.is_visible() and
              '가상 데이터' in (notice.get_attribute('aria-label') or '') and
              notice.evaluate("""e=>!e.closest('[aria-hidden="true"]')"""),
              label + " R1 '!' 낭독 이름에 가상 데이터")
    # 팀 이름 말줄임은 권고 사항이므로 실패 수와 별도로 실제 측정값 보고.
    print(f'OBS {label} R1 팀 이름 말줄임 ' + str(data['team']), flush=True)
    overflow(checks, page, label + ' R1 390 가로 스크롤')
    return bool(data['badges'])


# rev9 R3: 말풍선 전체 사각형. 내부 스크롤이 생겨도 외곽 충돌을 허용하지 않는다.
TIP_JS = r"""() => {
  const vis=e=>e && e.checkVisibility({visibilityProperty:true}) &&
    e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0;
  const tip=document.querySelector('#bd-tip'),dock=document.querySelector('#bd-dock');
  if(!vis(tip)||!vis(dock)) return {missing:true};
  const box=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom};};
  const r=box(tip),overlap=e=>{const q=box(e);return Math.min(r.r,q.r)>Math.max(r.l,q.l) && Math.min(r.b,q.b)>Math.max(r.t,q.t);};
  const guides=[...new Set(document.querySelectorAll('.lg-map-guidance > *, #lg-plan-reminder'))].filter(vis);
  return {missing:false,rect:r,dock:box(dock),guides:guides.map(e=>({id:e.id||e.className,rect:box(e)})),
    collisions:guides.filter(overlap).map(e=>e.id||e.className),dockOverlap:overlap(dock),
    maxHeight:getComputedStyle(tip).maxHeight,overflow:getComputedStyle(tip).overflowY};
}"""


def tip_check(checks, page, label):
    page.wait_for_selector('#bd-tip', state='visible')
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    data = page.evaluate(TIP_JS)
    if data.get('missing') or not data.get('guides'):
        raise Blocked(label + ' R3 말풍선·도크·안내 묶음 측정 불가')
    checks.ok(not data['collisions'] and not data['dockOverlap'],
              f'{label} R3 말풍선이 안내·도크와 겹치지 않음: {data}')
    checks.ok(data['rect']['t'] >= max(g['rect']['b'] for g in data['guides']) and
              data['rect']['b'] <= data['dock']['t'], label + ' R3 말풍선이 안내 아래·도크 위')
    overflow(checks, page, label + ' R3')


def solar_tip(checks, page, month, label):
    """실제 태양광 도구로 위·아래 후보 미리보기와 설치 후 hover를 잰다."""
    close_drawer(page)
    page.mouse.move(1, 1)
    if page.locator('#bd-root').get_attribute('data-mode') != 'solar':
        if not shown(page, '[data-tool="solar"]'):
            page.locator('#bd-dock [data-group="ren"]').click()
        page.locator('[data-tool="solar"]').click()
    group = page.locator('#bd-dock [data-group="ren"]')
    if group.get_attribute('aria-expanded') == 'true':
        group.click()
    candidates = page.evaluate(NEAR_TOWN_JS, 'solar')
    if not candidates:
        raise Blocked(f'R3 {month}월 태양광 빈 칸 없음')
    tiles = sorted(candidates, key=lambda i: page.evaluate(TILE_XY_JS, i)[1])
    # 위로 피하는 경우와 아래 공간을 쓰는 경우를 각각 관찰한다.
    for position, tile in (('위', tiles[0]), ('아래', tiles[-1])):
        xy = page.evaluate(TILE_XY_JS, tile)
        if not xy:
            reveal_tile(page, False, tile, lambda: None)
            xy = page.evaluate(TILE_XY_JS, tile)
        if not xy:
            raise Blocked(f'R3 {month}월 태양광 후보 좌표 없음')
        page.mouse.move(*xy)
        tip_check(checks, page, f'{label} {month}월 {position} 미리보기')
    tile = tiles[-1]
    before = page.evaluate('() => KCP.buildGame.current().builds.length')
    page.mouse.click(*page.evaluate(TILE_XY_JS, tile))
    page.wait_for_timeout(200)
    if page.evaluate('() => KCP.buildGame.current().builds.length') == before:
        page.mouse.click(*page.evaluate(TILE_XY_JS, tile))
    if shown(page, '#bd-cf-ok'):
        page.locator('#bd-cf-ok').click()
    page.wait_for_timeout(300)
    if not page.evaluate('i => KCP.buildGame.current().builds.some(b=>b.i===i && b.t==="solar")', tile):
        raise Blocked(f'R3 {month}월 태양광 설치를 만들지 못함')
    page.mouse.move(1, 1)
    page.mouse.move(*page.evaluate(TILE_XY_JS, tile))
    tip_check(checks, page, f'{label} {month}월 배치 뒤')
    page.mouse.move(1, 1)
    page.keyboard.press('Escape')


def open_promise(page):
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    page.locator('#lg-predict [data-evidence]').first.click()
    return page.locator('#lg-predict [data-pred]')


# rev9 R6·R15: 같은 달 실제 UI의 S4 숫자를 저장하고 운영 뒤 S6 장부와 대조.
def submit(checks, page, label, expected_topic=None, require_capex=False):
    select = open_promise(page)
    topic = select.get_attribute('data-pred')
    if expected_topic is not None and topic != expected_topic:
        raise Blocked(f'{label} 약속 주제 {expected_topic} 미확보: 실제 {topic}')
    capex = None
    if topic == 'cash':
        text = page.locator('#lg-promise-baseline').inner_text()
        match = re.search(r' · 이번 달 건설비 ([\d,]+(?:\.\d+)?)억은 아직 안 빠지고 월말에 빠져요$', text)
        capex = Decimal(match[1].replace(',', '')) if match else None
        if require_capex:
            checks.ok(capex is not None and capex > 0, label + ' R15 건설비 > 0인 C1 꼬리 존재')
    select.select_option('up')
    page.locator('[data-confidence="fairly"]').click()
    page.locator('#lg-ready-confirm').click()
    page.wait_for_function("() => KCP.league.state().S.phase==='review'", timeout=180000)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying') && "
                           "!document.querySelector('#bd-run:not([hidden])')", timeout=30000)
    wait_unfolded(page)
    open_panel(page, 'result')
    if topic == 'cash':
        calc = page.locator('#lg-promise-cash-calc')
        checks.ok(calc.count() == 1, label + ' R6 현금 판정 계산 줄 존재')
        if calc.count():
            if not calc.is_visible() and shown(page, '[data-promise-details]'):
                page.locator('[data-promise-details]').click()
            # rev16 #72-1·3: 예측 자세히 안으로 이동, 계산 내용 계약은 유지.
            checks.ok(calc.is_visible() and calc.evaluate('e=>!!e.closest("#lg-promise-result") && !!e.closest("details[open]")'),
                      label + ' R6 계산 줄 펼친 예측 자세히 안에서 보임')
        for selector in ('#lg-month-details', '#lg-result-details'):
            details = page.locator(selector)
            if details.count() and details.get_attribute('open') is None:
                details.locator(':scope > summary').click()
        ledger_text = page.locator('#lg-result-ledger').inner_text()
        match = re.search(r'신규 투자 ([\d,]+(?:\.\d+)?)', ledger_text)
        if not match:
            raise Blocked(label + ' R15 S6 신규 투자 숫자 없음')
        invest = Decimal(match[1].replace(',', ''))
        if require_capex:
            checks.ok(invest > 0, label + ' R15 실제 운영 S6 신규 투자 > 0')
        if invest < Decimal('0.005'):
            checks.ok(capex is None, label + ' R15 신규 투자 0.005 미만이면 C1 꼬리 없음')
        else:
            checks.ok(capex is not None and abs(capex-invest) <= Decimal('0.01'),
                      f'{label} R15 S4 건설비 = 같은 달 S6 신규 투자 ±0.01: {capex} / {invest}')
    return topic


# rev9 R8: 정의 id는 한 번만, p.lg-hint로 details/infoTip 밖에 항상 노출.
def result_checks(checks, page, topic, label):
    open_panel(page, 'result')
    definition = page.locator('#lg-result-outage-def')
    checks.ok(definition.count() == 1, label + ' R8 정전 시간 정의 한 개')
    if definition.count() == 1:
        checks.ok(definition.is_visible() and definition.evaluate(
            'e=>e.tagName==="P" && e.classList.contains("lg-hint") && !e.closest("details, .lg-info, .lg-info-pop")'),
            label + ' R8 정전 시간 정의 접힘 밖에 보임')
    # rev9 R9: 정전·현금 달도 계통 달의 소비 CO₂ 하루 평균 설명을 공유.
    if topic in ('uns', 'cash'):
        co2 = page.locator('#lg-s6-co2cons')
        # rev16 #72-1·3: 소비 줄은 예측 자세히를 연 뒤 검산한다.
        if not co2.is_visible() and shown(page, '[data-promise-details]'):
            page.locator('[data-promise-details]').click()
        checks.ok(co2.count() == 1 and co2.is_visible() and
                  'CO₂ 소비(계통 포함)' in co2.inner_text() and '하루 평균' in co2.inner_text() and  # rev11 R5: 같은 소비 표기.
                  co2.evaluate('e=>!!e.closest("#lg-promise-result") && !!e.closest("details[open]")'),
                  label + f' R9 {topic} 주제 소비 CO₂ 하루 평균 보임')
    overflow(checks, page, label + ' S6')


# rev9 R2: 600ms만 사건을 열고 닫은 뒤에도 최초 완료를 기억해야 한다.
def quick_event(checks, page, label):
    page.wait_for_selector('#lg-coach[data-step="1"]', state='visible')
    page.locator('#lg-coach-action').click()
    page.wait_for_selector('#lg-panel', state='visible')
    page.wait_for_timeout(600)
    still_first = coach_step(page) == 1
    close_drawer(page)
    if not still_first:
        checks.blocked(label + ' R2 닫기 전에 이미 전진: 완료 기억 조건 미확보')
    try:
        page.wait_for_selector('#lg-coach[data-step="2"]', state='visible', timeout=8000)
        advanced = True
    except Exception:
        advanced = False
    checks.ok(advanced, label + ' R2 사건 0.6초 열고 닫아도 2/8로 전진')


def coach_memory(checks, page, base, label):
    # 코치를 닫는 plan_and_trial/dismiss_guide를 이 시나리오에서는 호출하지 않는다.
    r2_start(page, base)
    start_solo(page, months=12)
    quick_event(checks, page, label)
    submit_r2_promise(page)
    step = coach_step(page)
    checks.ok(step in (6, 7, 8), f'{label} R2 결과 진입 코치 6/8 이상: {step}')
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    step = coach_step(page)
    checks.ok(step in (6, 7, 8), f'{label} R2 결과 재생 뒤 계획 단계 가리키지 않음: {step}')


def outage_month(checks, page, base, label):
    """rev9-2 §2: 첫 달 무시험 약속으로 정전 주제를 확보하고 실제 운영한다."""
    r2_start(page, base)
    start_solo(page, months=12)
    dismiss_guide(page)
    if page.evaluate('() => KCP.buildGame.lastTrial()') is not None:
        raise Blocked(label + ' R9 첫 달 무시험 조건 미확보')
    topic = submit(checks, page, label, expected_topic='uns')
    result_checks(checks, page, topic, label)


def cash_month(checks, page, base, label):
    """rev9-2 §1: 음수 현금 시작 fixture + 새 설비로 R6·R9·R15를 검증."""
    r2_start(page, base)
    start_solo(page, months=12)
    dismiss_guide(page)
    page.wait_for_timeout(400)
    saved = bundle(page)
    player = saved['solo']['team']
    # d80b.cash와 같은 허용 상태 복원. 운영 전 현금만 -1억으로 둔다(C4).
    # 결과·주제·장부·알림은 생성하지 않고 실제 계획/약속/운영 경로를 탄다.
    saved['solo']['state']['econ']['cities'][player]['cash'] = -1
    restore(page, saved)
    before = page.evaluate('() => KCP.buildGame.current().builds')
    apply_plan(page, count=1)  # 정상 연결 배치에 합법적 디젤 1기와 전선을 새로 추가.
    after = page.evaluate('() => KCP.buildGame.current().builds')
    old = {(b['t'], b['i']) for b in before}
    if not any((b['t'], b['i']) not in old for b in after):
        raise Blocked(label + ' R15 현금 주제 달 새 설비 설치 미확보')
    if read(page)['S']['econ']['cities'][player]['cash'] >= 0:
        raise Blocked(label + ' R6·R15 운영 전 음수 현금 복원 미확보')
    topic = submit(checks, page, label, expected_topic='cash', require_capex=True)
    result_checks(checks, page, topic, label)


def run_months(checks, page, base, label):
    r2_start(page, base)
    start_solo(page, months=12)
    dismiss_guide(page)
    badges = False
    r3_attempted = set()
    try:
        for month in range(1, 13):
            wait_unfolded(page)
            badges |= header(checks, page, f'{label} {month}월 계획')
            # 기존 계획·시험 함수만 사용. 결과/현금/주제/DOM 주입 없음.
            plan_and_trial(page, renewable=month == 1)
            if month in (2, 3):
                r3_attempted.add(month)
                try:
                    solar_tip(checks, page, month, label)
                except Blocked as exc:
                    checks.blocked(f'{label}: {exc}')
            topic = submit(checks, page, f'{label} {month}월')
            result_checks(checks, page, topic, f'{label} {month}월')
            state = read(page)['S']
            click_next(page, state)
            if read(page)['S']['phase'] == 'end':
                break
    finally:
        if not badges:
            checks.blocked(label + ' R1 배지 있는 달 미확보')
        # R6·R9·R15의 필수 주제는 별도 컨텍스트 outage_month/cash_month에서 확보.
        for month in {2, 3} - r3_attempted:
            checks.blocked(f'{label} R3 {month}월 미리보기·배치 뒤 검증 미완료')


# rev9 R13·rev9-2 §3: 실제 '줄 것' 선택과 0 시험을 먼저 만들고,
# 주제가 바뀌면 허용된 미확정 메모/0 기준 복원으로 지움 동작을 관찰한다.
def down_cleared(checks, page, base, label):
    r2_start(page, base)
    start_solo(page, months=12)
    dismiss_guide(page)
    plan_and_trial(page, empty=True, change_after=False)
    select = open_promise(page)
    if select.get_attribute('data-pred') != 'uns' or not select.locator('option[value="down"]').is_enabled():
        raise Blocked(label + " R13 처음 '줄 것'을 고를 정전 기준 미확보")
    select.select_option('down')
    page.wait_for_timeout(400)
    selected = bundle(page)
    month = str(selected['solo']['state']['round'])
    selected_note = selected['solo']['interview']['interview']['months'][month]
    if selected_note.get('pred', {}).get('uns') != 'down' or selected_note.get('confirmed'):
        raise Blocked(label + " R13 미확정 '줄 것' 선택 저장 미확보")
    close_drawer(page)
    trial = plan_and_trial(page, renewable=True, change_after=False)
    if not trial or trial['unsPct'] >= .005:
        # d80b.zero_plan과 같이 정상 연결 배치+디젤 후보를 실제 시험한다.
        # 예산에 탐색이 잘리지 않게 시작 현금만 가상 fixture로 복원한다.
        funded = copy.deepcopy(selected)
        funded['solo']['state']['econ']['cities'][funded['solo']['team']]['cash'] = 100000
        for count in (*range(9), 12, 16, 24):
            restore(page, funded)
            apply_plan(page, count=count)
            page.locator('[data-run="7"]').click()
            trial = finish_trial(page)
            page.locator('#bd-drawer-x').click()
            print(f'OBS {label} R13 디젤 +{count} 실제 시험 정전 {trial["unsPct"]}%', flush=True)
            if trial['unsPct'] < .005:
                break
    if not trial or trial['unsPct'] >= .005:
        raise Blocked(label + ' R13 계획 변경·재시험 뒤 정전 기준 0 미재현')
    open_panel(page, 'journal')
    page.wait_for_timeout(400)
    current = page.locator('#lg-predict [data-pred]')
    if current.get_attribute('data-pred') != 'uns' or current.locator('option[value="down"]').is_enabled():
        saved = bundle(page)
        trials = json.loads(saved['trial'])
        matching = [value for value in trials.values() if all(
            value.get(key) == trial.get(key) for key in ('scope', 'map', 'year', 'month', 'seed'))]
        if len(matching) != 1 or matching[0].get('unsPct', 1) >= .005:
            raise Blocked(label + ' R13 복원할 실제 0 시험 기록 미확보')
        # 허용 fixture: 실제 0 시험을 계통 값이 없던 옛 저장 형식으로 복원.
        # 정전 수치는 실제 시험 그대로이며, gridMWh만 빠져 정전 주제가 유지된다.
        # 이미 UI에서 고른 pred.down/confirmed=false를 되살려 삭제 전 조건을 만든다.
        # downCleared·알림 DOM·결과·판정은 주입하지 않는다.
        matching[0].pop('gridMWh', None)
        saved['trial'] = json.dumps(trials, ensure_ascii=False)
        saved['solo']['interview']['interview']['months'][month] = copy.deepcopy(selected_note)
        restore(page, saved)
        open_panel(page, 'journal')
        page.wait_for_timeout(400)
        current = page.locator('#lg-predict [data-pred]')
        print(f'OBS {label} R13 실제 0 시험 + 옛 계통 값 누락 + 미확정 줄 것 메모 복원', flush=True)
    if current.get_attribute('data-pred') != 'uns' or current.locator('option[value="down"]').is_enabled():
        raise Blocked(label + ' R13 복원 뒤에도 주제 변경/활성 기준 비영: 지움 조건 미재현')
    checks.ok(current.input_value() == '', label + " R13 기준 0이면 고른 '줄 것'을 지움")
    notice = page.locator('#lg-promise-down-cleared')
    checks.ok(notice.count() == 1 and notice.is_visible(), label + " R13 '줄 것' 지움 알림 보임")
    if notice.count() != 1:
        return
    checks.ok(notice.inner_text() == "고른 '줄 것'을 지웠어요. 방향을 다시 골라 주세요." and
              notice.get_attribute('role') == 'status' and notice.get_attribute('aria-live') == 'polite',
              label + ' R13 K9·status·aria-live')
    checks.ok(notice.evaluate('e=>{const why=document.querySelector("#lg-promise-down-why");'
                             'return !!why && !!(e.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING);}'),
              label + ' R13 C5 문단 앞에 알림')
    page.locator('#lg-predict [data-pred]').select_option('up')
    page.wait_for_timeout(400)
    checks.ok(not shown(page, '#lg-promise-down-cleared'), label + ' R13 방향을 다시 고르면 알림 내림')
    overflow(checks, page, label + ' R13')


def main():
    checks = Checks()
    try:
        if len(sys.argv) != 2:
            raise ValueError('실행 주소 인자 하나가 필수입니다(기본 포트 없음)')
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for theme in ('light', 'dark'):
                    for run in (coach_memory, outage_month, cash_month, run_months, down_cleared):
                        label = f'390x844-{theme}-{run.__name__}' + (' R13' if run is down_cleared else '')
                        context, external = context_for(browser, base, 390, 844, theme)
                        page, events = monitored_page(context)
                        try:
                            run(checks, page, base, label)
                        except Blocked as exc:
                            checks.blocked(f'{label}: {exc}')
                        except Exception as exc:
                            checks.blocked(f'{label} 장면/조작 실패 {type(exc).__name__}: {str(exc).splitlines()[0]}')
                        finally:
                            diagnostics(checks, events, label)
                            overflow(checks, page, label)
                            checks.ok(not external, label + ' 외부 요청 0')
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'브라우저 실행/주소 환경 {type(exc).__name__}: {str(exc).splitlines()[0]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
