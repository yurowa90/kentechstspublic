"""spec-C M4·M5·M7 및 C5 r2 R1·R2·R4 독립 브라우저 검사. 작성 세션 실행 금지.

허용된 샌드박스 밖 로컬 담당자 실행:
  python3 tests/srv.py 9430 .
  tests/.venv/bin/python tests/league/rev8c.py http://127.0.0.1:9430/index.html

HEAD의 기존 공개 계획·시험·약속 흐름을 사용한다. 결과/원인/DOM 배치 주입 없음.
세 카드 달을 확보하지 못하면 BLOCKED 실패. 끝줄 assertions N failures M.
"""

import json
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks as BaseChecks, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, shown)
from fx_end import dismiss_guide, reset_scroll, solo_end
from league_flow import (finish_trial, pass_issue_check, select_mode, start_solo,
                         wait_unfolded)
from s7 import (expected_operation, period_days, plan_and_trial, public_grid_mwh)
from solo import CHANGED_JS, click_next, close_drawer, read
from ux_coach import LINE_ENDS_JS, NEAR_TOWN_JS
from ux_s2fix import reveal_tile
from ux_task import TILE_XY_JS


class Blocked(Exception):
    pass


class Checks(BaseChecks):
    def finish(self):
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


# 실제 글자 사각형으로 두 줄·말줄임·세로 자르기를 함께 판정한다.
TITLE_JS = r"""e => {
  const box=e.getBoundingClientRect(), style=getComputedStyle(e), rects=[];
  const walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
  while(walk.nextNode()) {
    const n=walk.currentNode;
    for(let i=0;i<n.length;i++) if(n.textContent[i].trim()) {
      const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+1);
      rects.push(...r.getClientRects());
    }
  }
  const lines=[];
  for(const r of rects) if(!lines.some(y=>Math.abs(y-r.top)<1)) lines.push(r.top);
  return {text:e.textContent,scroll:e.scrollWidth,client:e.clientWidth,lines:lines.length,
    ellipsis:style.textOverflow==='ellipsis',visible:box.width>0 && box.height>0,
    clipped:rects.some(r=>r.left<box.left-1 || r.right>box.right+1 ||
      r.top<box.top-1 || r.bottom>box.bottom+1)};
}"""

# '가상 데이터'라는 DOM 문자열만 남고 글자는 display:none인 회귀도 잡는다.
CHIP_JS = r"""e => {
  const box=e.getBoundingClientRect(), walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
  while(walk.nextNode()) {
    const n=walk.currentNode, at=n.textContent.indexOf('가상');
    if(at<0) continue;
    const range=document.createRange(); range.setStart(n,at); range.setEnd(n,at+2);
    const rects=[...range.getClientRects()];
    if(rects.length>0 && rects.every(r=>r.width>0 && r.height>0 &&
      r.left>=Math.max(0,box.left) && r.right<=Math.min(innerWidth,box.right) &&
      r.top>=Math.max(0,box.top) && r.bottom<=Math.min(innerHeight,box.bottom) &&
      e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)))) return true;
  }
  return false;
}"""

LAST_ROW_JS = r"""() => {
  const e=document.querySelector('#lg-outage-waterfall [data-out-step="actual"]');
  if(!e) return {missing:true};
  const r=e.getBoundingClientRect(); let left=0,right=innerWidth,top=0,bottom=innerHeight;
  for(let p=e.parentElement;p;p=p.parentElement) {
    const s=getComputedStyle(p),q=p.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(s.overflowX)) {left=Math.max(left,q.left);right=Math.min(right,q.right);}
    if(/auto|scroll|hidden|clip/.test(s.overflowY)) {top=Math.max(top,q.top);bottom=Math.min(bottom,q.bottom);}
  }
  return {missing:false,text:e.innerText,top:r.top,bottom:r.bottom,clipBottom:bottom,
    inside:r.width>0 && r.height>0 && r.left>=left && r.right<=right && r.top>=top && r.bottom<=bottom,
    uncovered:[.2,.5,.8].every(t=>e.contains(document.elementFromPoint(r.left+r.width*t,(r.top+r.bottom)/2)))};
}"""


def mobile_copy(checks, page, label):
    title = page.locator('.lg-promise-direction')
    if title.count() != 1:
        raise Blocked('M7 S4 방향 제목 하나를 만들지 못함')
    title.scroll_into_view_if_needed()
    data = title.evaluate(TITLE_JS)
    checks.ok(data['visible'] and data['scroll'] <= data['client'] and
              1 <= data['lines'] <= 2 and not data['clipped'],
              f'{label} M7 S4 제목 말줄임 없음·두 줄 이내: {data}')
    # rev9 R1: 480px 이하 머리에 배지가 있을 때만 가상 글자를 접는다.
    compact = page.viewport_size['width'] <= 480 and shown(page, '#lg-watch button')
    chips = page.locator('#lg-bar .lg-data-chip').all()
    checks.ok(bool(chips) and (all(not chip.evaluate(CHIP_JS) for chip in chips) if compact else
              any(chip.is_visible() and chip.evaluate(CHIP_JS) for chip in chips)),
              label + ' R1 배지 있는 모바일 머리만 가상 글자 접기')
    overflow(checks, page, label + ' S4')


def predict(checks, page, trial, label):
    """s7.promise와 같은 UI 경로에서 S4를 측정하고 실제 방향의 반대를 고른다."""
    player = read(page)['player']
    forecast = expected_operation(page, player)
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm')
    page.locator('[data-evidence="grid"]').click()
    mobile_copy(checks, page, label)
    select = page.locator('#lg-predict [data-pred]')
    topic = select.get_attribute('data-pred')
    state = read(page)['S']
    previous = next((r for r in state['results'] if r['round'] == state['round'] - 1), None)
    if topic == 'grid':
        baseline = (public_grid_mwh(previous, player) / period_days(previous) if previous
                    else trial['gridMWh'] / trial['days'])
        delta = forecast['grid'] / forecast['days'] - baseline
    elif topic == 'uns':
        baseline = previous['team'][player]['unsPct'] if previous else trial['unsPct']
        delta = forecast['uns'] - baseline
    elif topic == 'cash':
        delta = forecast['cash'] - state['econ']['cities'][player]['cash']
    else:
        raise Blocked(f'알 수 없는 S4 주제 {topic}')
    # down이 0 바닥값 때문에 금지된 경우에도 반대 예측을 강제로 넣지 않는다.
    select.select_option('down' if delta > 0 and select.locator('option[value="down"]').is_enabled() else 'up')
    page.locator('[data-confidence="fairly"]').click()
    page.locator('#lg-ready-confirm').click()
    page.wait_for_function("() => KCP.league.state().S.phase==='review'")
    wait_unfolded(page)


def mobile(checks, page, base, label):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text('날씨·사건 · 연습 방식', exact=True).click()
    page.locator('#lg-solo-seed').select_option('fixed')
    start_solo(page, months=12)
    dismiss_guide(page)
    found = False
    for month in range(1, 12):
        wait_unfolded(page)
        trial = plan_and_trial(page, renewable=month == 1)
        predict(checks, page, trial, f'{label} {month}월')
        open_panel(page, 'result')
        cards = page.locator('#lg-outage-cards [data-missed]')
        button = page.locator('#lg-outage-open')
        if cards.count() == 3 and button.count() and button.is_visible():
            cards.first.click()
            button.click()
            # M5: 공개 뒤에는 스크롤/폭포 locator 조작 없이 두 프레임 직후 측정한다.
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            row = page.evaluate(LAST_ROW_JS)
            checks.ok(not row.get('missing') and '이번 달 실제' in row.get('text', '') and
                      row.get('inside') and row.get('uncovered'),
                      f'{label} M5 세 카드 공개 직후 폭포 마지막 줄 화면 안: {row}')
            checks.ok(cards.count() == 3 and all(c.is_visible() and c.locator('strong').is_visible()
                                                for c in cards.all()),
                      label + ' M5 공개 뒤 카드 앞면 유지')
            overflow(checks, page, label + ' S7 공개 직후')
            found = True
            break
        if button.count() and button.is_visible() and cards.count():
            cards.first.click()
            button.click()
        click_next(page, read(page)['S'])
    if not found:
        raise Blocked('M5 390에서 세 카드 달 공개 상태를 만들지 못함(1~11월 고정 씨앗)')


def desktop(checks, page, base, label):
    solo_end(checks, page, base, label)
    reset_scroll(page)
    # M4: grid item이 늘어나도 빈칸을 숨겨 통과하지 않도록 요약의 마지막 내용부터 잰다.
    data = page.evaluate("""() => {
      const s=document.querySelector('#lg-final-summary'),rank=document.querySelector('#lg-rank');
      if(!s?.lastElementChild || !rank) return {missing:true};
      const a=s.getBoundingClientRect(),b=s.lastElementChild.getBoundingClientRect(),r=rank.getBoundingClientRect();
      return {missing:false,gap:r.top-b.bottom,sx:a.left,rx:r.left,sw:a.width,rw:r.width};
    }""")
    checks.ok(not data.get('missing') and 0 <= data['gap'] <= 48 and
              abs(data['sx'] - data['rx']) <= 1 and data['sx'] < 640 and
              0 < data['sw'] <= 640 and 0 < data['rw'] <= 640,
              f'{label} M4 왼쪽 요약 아래 빈칸 48px 이하·순위 같은 칸: {data}')
    checks.ok(page.get_by_role('heading', name='내 순위', exact=True).count() == 1 and
              page.locator('#lg-final-summary').get_by_role('heading', name='내 순위', exact=True).count() == 1,
              label + ' M4 요약 제목 내 순위 한 개')
    checks.ok(page.get_by_role('heading', name=re.compile(r'^최종 순위(?:\s|$)')).count() == 1 and
              page.locator('#lg-rank').get_by_role('heading', name=re.compile(r'^최종 순위(?:\s|$)')).count() == 1,
              label + ' M4 순위 그래프 제목 최종 순위 한 개')


# C5 기대값 근거: review8-mobile-r2.md §3.1·2·4 및 검사 지시서 C5.
# UI의 배치/코치/포맷 함수를 기대값으로 호출하지 않는다. 아래 JS는 관찰만 한다.
R1_TILES_JS = r"""() => {
  const B=KCP.buildGame, canvas=document.querySelector('#bd-canvas');
  const tiles=B.TILES.filter(t=>!t.out).map(t=>({i:t.i,p:B.tileXY(t.c,t.r)}))
    .filter(t=>t.p && t.p[0]>0 && t.p[0]<innerWidth && t.p[1]>0 && t.p[1]<innerHeight);
  if(!tiles.length) return [];
  const top=Math.min(...tiles.map(t=>t.p[1])),bottom=Math.max(...tiles.map(t=>t.p[1]));
  const mid=(top+bottom)/2;
  return tiles.filter(t=>document.elementFromPoint(...t.p)===canvas)
    .map(t=>({...t,half:t.p[1]<mid ? '위쪽' : '아래쪽'})).sort((a,b)=>a.p[1]-b.p[1]);
}"""

R1_TIP_JS = r"""() => {
  const visible=e=>e && e.checkVisibility({visibilityProperty:true,opacityProperty:true}) &&
    e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0;
  const tip=document.querySelector('#bd-tip');
  if(!visible(tip)) return {missing:true};
  const box=e=>{const r=e.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
  const r=box(tip),overlap=q=>Math.min(r.right,q.right)>Math.max(r.left,q.left) ?
    Math.max(0,Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)) : 0;
  // 띠가 묶음 밖에 놓이는 DOM에서도 같은 학생용 안내를 빠뜨리지 않는다.
  const guidance=[...document.querySelectorAll('.lg-map-guidance *, #lg-plan-reminder')]
    .filter(visible).map(e=>({id:e.id||e.className,rect:box(e),overlap:overlap(box(e))}));
  const keys=document.querySelector('.lg-map-keys');
  const legendOverlap=visible(keys) && overlap(box(keys))>0;
  const rects=[],walk=document.createTreeWalker(tip,NodeFilter.SHOW_TEXT);
  while(walk.nextNode()) {
    const n=walk.currentNode;
    if(!n.textContent.trim()) continue;
    const range=document.createRange();range.selectNodeContents(n);
    rects.push(...[...range.getClientRects()].filter(q=>q.width>0 && q.height>0));
  }
  const bottom=Math.max(...rects.map(q=>q.bottom));
  const last=rects.filter(q=>Math.abs(q.bottom-bottom)<=1);
  const point=last.length ? [(Math.min(...last.map(q=>q.left))+Math.max(...last.map(q=>q.right)))/2,
    (Math.min(...last.map(q=>q.top))+bottom)/2] : null;
  const hit=point && document.elementFromPoint(...point);
  return {missing:false,tip:r,innerHeight,guidance,legendOverlap,point,
    hit:hit?.id||hit?.tagName,uncovered:!!hit && tip.contains(hit)};
}"""

# 100ms 주기 원자료 + DOM 전환 시각을 함께 보관한다. 40ms 단계도 전환 기록에는 남는다.
# 애플리케이션 상태·DOM은 수정하지 않고 테스트 전용 window 자료만 쓴다.
R2_RECORD_JS = r"""() => {
  const log=window.__rev8cCoach={samples:[],edges:[]};
  const frame=()=>{
    const c=document.querySelector('#lg-coach');
    const step=c?.checkVisibility({visibilityProperty:true}) ? Number(c.dataset.step)||0 : 0;
    return [performance.now(),step,!!document.querySelector('#bd-root.bd-replaying')];
  };
  const edge=()=>{
    const f=frame(),last=log.edges.at(-1);
    if(!last || last[1]!==f[1] || last[2]!==f[2]) log.edges.push(f);
  };
  log.timer=setInterval(()=>{log.samples.push(frame());edge();},100);
  log.observer=new MutationObserver(edge);
  log.observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,
    attributeFilter:['data-step','class','hidden','style']});
  edge();
}"""


def r2_start(page, base):
    """ux_coach와 같은 빈 저장소의 로비 → 혼자 하기 → 첫 달 코치 경로."""
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.get_by_text('날씨·사건 · 연습 방식', exact=True).click()
    page.locator('#lg-solo-seed').select_option('fixed')


def construction_tool(page):
    close_drawer(page)
    group = page.locator('[data-group="fire"]')
    # 도구 단추는 토글이므로 이미 든 도구를 다시 눌러 해제하지 않는다.
    if page.locator('#bd-root').get_attribute('data-mode') != 'diesel':
        if not shown(page, '[data-tool="diesel"]'):
            group.click()
        page.locator('[data-tool="diesel"]').click()
    if group.get_attribute('aria-expanded') == 'true':
        group.click()
    page.wait_for_function("() => document.querySelector('#bd-root')?.dataset.mode==='diesel'")


def r1_tooltips(checks, page, month, label):
    state = read(page)['S']
    if state['round'] != month or state['phase'] != 'plan':
        raise Blocked(f'R1 {month}월 계획 단계 아님')
    if month == 1:
        page.wait_for_selector('#lg-coach', state='visible')
    else:
        page.wait_for_selector('#lg-map-result', state='visible')
        page.wait_for_selector('#lg-plan-reminder', state='visible')
        checks.ok('지난달' in page.locator('#lg-map-result').inner_text() and
                  '고치겠다' in page.locator('#lg-plan-reminder').inner_text(),
                  label + ' R1 2월 지난달 결과 줄·고치겠다 띠 실제 표시')
    construction_tool(page)
    for half in ('위쪽', '아래쪽'):
        # 이전 말풍선의 hit 영역을 후보에서 제외하는 일을 피하도록 먼저 포인터를 뺀다.
        page.mouse.move(1, 1)
        page.wait_for_timeout(150)
        candidates = [t for t in page.evaluate(R1_TILES_JS) if t['half'] == half]
        if not candidates:
            raise Blocked(f'R1 {month}월 {half} 지도 칸을 가리킬 수 없음')
        tile = candidates[0] if half == '위쪽' else candidates[-1]
        page.mouse.move(*tile['p'])
        page.wait_for_selector('#bd-tip', state='visible')
        # 두 프레임 뒤 말풍선·안내·범례·hit-test를 같은 evaluate에서 측정한다.
        page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        data = page.evaluate(R1_TIP_JS)
        if data.get('missing') or not data['guidance']:
            raise Blocked(f'R1 {month}월 {half} 말풍선/보이는 안내 자식 없음')
        required = ('lg-coach',) if month == 1 else ('lg-map-result', 'lg-plan-reminder')
        if not all(any(g['id'] == key for g in data['guidance']) for key in required):
            raise Blocked(f'R1 {month}월 {half} 측정 순간 필수 안내가 보이지 않음: {required}')
        detail = f'{label} R1 {month}월 {half} 칸 {tile["i"]}'
        collisions = [g for g in data['guidance'] if g['overlap'] > 1]
        # C5 R1(a)의 명시 허용값: 겹침 높이 ≤1px. 다른 위치 오차에 전용하지 않는다.
        checks.ok(not collisions, f'{detail} (a) 안내 자식과 겹침 ≤1px: {collisions}')
        checks.ok(not data['legendOverlap'] or data['uncovered'],
                  f'{detail} (b) 범례 겹침 시 아랫줄 중앙 hit-test: {data}')
        checks.ok(0 <= data['tip']['top'] and data['tip']['bottom'] <= data['innerHeight'],
                  f'{detail} (c) 말풍선 화면 세로 안: {data["tip"]}')
        overflow(checks, page, detail)


def r4_approval(checks, page, month, label):
    open_panel(page, 'city')
    cell = page.locator('#lg-city .lg-kpi > div').filter(
        has=page.locator('dt').filter(has_text=re.compile(r'^지지율$')))
    if cell.count() != 1:
        raise Blocked('R4 지지율 dt의 KPI 칸 하나를 찾지 못함')
    cell.scroll_into_view_if_needed()
    text = cell.inner_text()
    checks.ok(bool(re.search(r'다음 평가 \d+달 뒤', text)),
              f'{label} R4 {month}월 다음 평가 n달 뒤 유지: {text}')
    # 엔진 내부 상태/표시 함수를 사용하지 않는다. 공개 경제의 같은 도시 두 값만 읽는다.
    values = page.evaluate("""() => {
      const L=KCP.league.state(),V=L.snap||L.S,id=L.team;
      return {now:V.econ?.cities?.[id]?.approval,before:V.econ?.before?.[id]?.approval ?? null};
    }""")
    if month == 1:
        checks.ok(values['before'] is None and '지난달' not in text,
                  f'{label} R4 1월 이전 값·지난달 변화 글자 없음: {text}')
    else:
        if values['before'] is None or values.get('now') is None:
            raise Blocked(f'R4 {month}월 공개 지지율 전후 값 없음: {values}')
        delta = Decimal(str(values['now'])) - Decimal(str(values['before']))
        rounded = abs(delta).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        sign = '' if rounded == 0 else '+' if delta > 0 else '−'  # U+2212
        expected = f'지난달 {sign}{rounded:.1f}%p'
        matches = re.findall(r'지난달 [＋+−-]?\d+(?:\.\d+)?%p', text)
        checks.ok(matches == [expected],
                  f'{label} R4 {month}월 공개 지지율 차의 부호·한 자리 %p: '
                  f'expected={expected!r}, actual={matches}, public={values}')
    overflow(checks, page, f'{label} R4 {month}월 도시')
    close_drawer(page)


def submit_r2_promise(page):
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    page.locator('#lg-predict [data-evidence]').first.click()
    page.locator('#lg-predict [data-pred]').select_option('up')
    page.locator('[data-confidence="fairly"]').click()
    page.locator('#lg-ready-confirm').click()
    page.wait_for_function("() => (KCP.league.state().S||KCP.league.state().snap).phase==='review'",
                           timeout=180000)


def r2_map_city(checks, page, base, label):
    """R1·R4: 실제 UI로 1월 시험/운영/고치겠다를 거쳐 2월 장면을 만든다."""
    r2_start(page, base)
    start_solo(page, months=12)
    r1_tooltips(checks, page, 1, label)
    r4_approval(checks, page, 1, label)
    dismiss_guide(page)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    if shown(page, '#bd-drawer-x'):
        page.locator('#bd-drawer-x').click()
    submit_r2_promise(page)
    # 실제 운영 재생이 끝난 결과를 이용한다(중간에 건너뛰지 않는다).
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying') && "
                           "!document.querySelector('#bd-run:not([hidden])')", timeout=30000)
    wait_unfolded(page)
    open_panel(page, 'result')
    page.locator('[data-answer="revise"]:visible').first.click()
    reason = page.locator('[data-note="askReason"]:visible').first
    reason.fill('태양광 위치를 고치고 다음 달 시험으로 결과를 확인하겠다')
    reason.press('Tab')
    page.wait_for_timeout(400)
    click_next(page, read(page)['S'])
    page.wait_for_function("() => {const L=KCP.league.state(),V=L.S||L.snap;"
                           "return V.round===2 && V.phase==='plan';}")
    page.wait_for_timeout(2500)  # 계획 시작 알림이 사라진 뒤 고정 안내와 말풍선을 잰다.
    r1_tooltips(checks, page, 2, label)
    r4_approval(checks, page, 2, label)


def coach_step(page):
    return page.evaluate("() => Number(document.querySelector('#lg-coach')?.dataset.step)||0")


def coach_tile(page, i):
    if page.evaluate(TILE_XY_JS, i) is None:
        reveal_tile(page, False, i, lambda: None)
    xy = page.evaluate(TILE_XY_JS, i)
    if not xy:
        raise Blocked(f'R2 코치 지시 지도 칸 {i}를 누를 수 없음')
    page.mouse.click(*xy)
    page.wait_for_timeout(150)


def coach_trace_checks(checks, page, label):
    trace = page.evaluate("""() => {
      const l=window.__rev8cCoach;clearInterval(l.timer);l.observer.disconnect();
      return {samples:l.samples,edges:l.edges,idle:l.idle||null};
    }""")
    print(label + ' R2 trace [performance.now ms, data-step, bd-replaying] ' +
          json.dumps(trace, ensure_ascii=False), flush=True)
    # 재생 시작/종료만 다른 중복 step을 합쳐 실제 단계별 연속 노출 시간을 잰다.
    steps = []
    for edge in trace['edges']:
        if not steps or edge[1] != steps[-1][1]:
            steps.append(edge)
    short = [(a[1], b[0] - a[0], b[1]) for a, b in zip(steps, steps[1:])
             if a[1] and b[1] > a[1] and b[0] - a[0] < 1400]
    checks.ok(not short, f'{label} R2(a) 건너뛰기 없이 자동 전진 전 1400ms 이상 노출: {short}')
    frames = trace['samples'] + trace['edges']
    replay = [f for f in frames if f[2]]
    checks.ok(bool(replay) and all(f[1] <= 6 for f in replay),
              f'{label} R2(b) 실제 운영 재생 표본 있음·재생 중 단계 ≤6: '
              f'{[f for f in replay if f[1] > 6][:10]}')
    idle = trace['idle']
    idle_frames = [f for f in trace['samples'] if idle and idle['start'] <= f[0] <= idle['end']]
    checks.ok(bool(idle and idle['end'] - idle['start'] >= 10000) and bool(idle_frames) and
              all(f[1] == 6 and not f[2] for f in idle_frames) and idle['step'] == 6,
              f'{label} R2(c) 재생 종료 뒤 무조작 10초 내내 6단계: {idle}')
    sampled = {f[1] for f in trace['samples']}
    checks.ok({6, 7} <= sampled, f'{label} R2(d) 100ms 기록에 6·7단계 각각 존재: {sorted(sampled)}')
    checks.ok(set(range(1, 9)) <= sampled,
              f'{label} R2 1단계부터 건너뛰기 없이 8단계 도달: {sorted(sampled)}')


def r2_coach(checks, page, base, label):
    r2_start(page, base)
    page.evaluate(R2_RECORD_JS)  # 시작 단추를 누르기 전부터 관찰하여 1단계 누락 방지.
    try:
        start_solo(page, months=12)
        page.wait_for_selector('#lg-coach[data-step="1"]', state='visible')
        for _ in range(16):
            step = coach_step(page)
            overflow(checks, page, f'{label} R2 코치 {step}단계')
            if step == 1:
                page.locator('#lg-coach-action').click()
            elif step == 2:
                page.locator('#lg-coach-action').click()
                construction_tool(page)
                before = page.evaluate('() => KCP.buildGame.current().builds.length')
                for i in page.evaluate(NEAR_TOWN_JS, 'diesel'):
                    coach_tile(page, i)
                    if page.evaluate('() => KCP.buildGame.current().builds.length') == before:
                        coach_tile(page, i)
                    if shown(page, '#bd-cf-ok'):
                        page.locator('#bd-cf-ok').click()
                    if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
                        break
                else:
                    raise Blocked('R2 2단계 설비 설치를 만들지 못함')
            elif step == 3:
                page.locator('#lg-coach-action').click()
                for _ in range(4):
                    ends = page.evaluate(LINE_ENDS_JS)
                    if not ends:
                        break
                    coach_tile(page, ends[0])
                    coach_tile(page, ends[1])
                    if shown(page, '#bd-cf-ok'):
                        page.locator('#bd-cf-ok').click()
                page.keyboard.press('Escape')
            elif step == 4:
                page.locator('#lg-coach-action').click()
                finish_trial(page)
            elif step == 5:
                submit_r2_promise(page)
                page.wait_for_function("() => window.__rev8cCoach.samples.some(f=>f[2])",
                                       timeout=30000)
                page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')",
                                       timeout=30000)
                page.evaluate("() => {window.__rev8cCoach.idle={start:performance.now()};}")
                page.wait_for_timeout(10000)  # 학생 조작 없음. 결과 서랍도 건드리지 않는다.
                page.evaluate("""() => Object.assign(window.__rev8cCoach.idle,
                  {end:performance.now(),step:Number(document.querySelector('#lg-coach')?.dataset.step)||0})""")
                if coach_step(page) != 6:
                    raise Blocked('R2 재생 종료 뒤 무조작 10초 후 6단계가 아님')
                continue
            elif step == 6:
                # C5 R2(d): 학생이 판정 줄의 '예측 자세히'를 직접 누른다.
                if not shown(page, '#lg-promise-summary [data-promise-details]'):
                    open_panel(page, 'result')
                page.locator('#lg-promise-summary [data-promise-details]').click()
            elif step == 7:
                action = page.locator('#lg-coach-action')
                text = action.inner_text().strip()
                if text == '원인 열기':
                    cards = page.locator('#lg-outage-cards [data-missed]')
                    if not cards.count():
                        raise Blocked('R2 7단계 원인 열기인데 고를 카드 없음')
                    cards.first.click()
                    page.locator('#lg-outage-open').click()
                elif text == '확인하고 다음':
                    action.click()
                else:
                    raise Blocked(f'R2 7단계 원인 열기/확인하고 다음 단추 없음: {text!r}')
            elif step == 8:
                page.wait_for_timeout(1500)
                return
            else:
                raise Blocked(f'R2 코치 1~8단계 소실: {step}')
            # 코치 건너뛰기는 누르지 않는다. 다음 단계가 너무 빨리 뜨는 버그도 기록한다.
            page.wait_for_function("old => Number(document.querySelector('#lg-coach')?.dataset.step)!==old",
                                   arg=step, timeout=15000)
        raise Blocked('R2 코치 8단계에 도달하지 못함')
    finally:
        coach_trace_checks(checks, page, label)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height, run in ((1280, 900, desktop), (390, 844, mobile),
                                           (1280, 900, r2_map_city), (390, 844, r2_map_city),
                                           (1280, 900, r2_coach), (390, 844, r2_coach)):
                    for theme in ('light', 'dark'):
                        label = f'{width}x{height}-{theme}-{run.__name__}'
                        context, external = context_for(browser, base, width, height, theme)
                        page, events = monitored_page(context)
                        try:
                            run(checks, page, base, label)
                        except Blocked as exc:
                            checks.ok(False, f'BLOCKED {label}: {exc}')
                        except Exception as exc:
                            checks.ok(False, f'BLOCKED {label} 필수 장면/조작 실패 {type(exc).__name__}: {str(exc).splitlines()[0]}')
                        finally:
                            diagnostics(checks, events, label)
                            overflow(checks, page, label)
                            checks.ok(not external, label + ' 외부 요청 0')
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'BLOCKED 브라우저 실행 환경 {type(exc).__name__}: {str(exc).splitlines()[0]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
