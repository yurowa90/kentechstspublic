"""rev10 R1·R2·R3·R4·R5·R8 명세 수용 검사.

작성 세션에서는 브라우저 실행 금지. 허용된 샌드박스 밖 로컬 담당자 실행:
  tests/.venv/bin/python tests/league/rev10.py http://127.0.0.1:<포트>/index.html
주소는 인자로 받은 loopback 주소 하나만 쓴다. 결과·DOM 주입 없음.
계획/시험/약속은 s7.py, 코치 조작은 ux_coach.py의 흐름/좌표 함수를 재사용한다.
복원은 d80b.bundle/restore로 실제 저장 묶음만 되돌린다(결과/문구 주입 없음).
필수 장면을 재현하지 못하면 BLOCKED 실패. 끝줄 assertions N failures M.
"""
import re
import sys
from playwright.sync_api import sync_playwright
from d80b import bundle, restore
from econui import (Checks as BaseChecks, context_for, diagnostics, local_address,
                   monitored_page, open_panel, overflow, shown)
from fx_end import dismiss_guide
from league_flow import start_solo, wait_unfolded
from rev8c import Blocked, coach_step, r2_start
from s7 import (current_attribution, expected_operation, finish_trial, plan_and_trial, promise,
                STATE, SYNC)
from solo import click_next, close_drawer, read
from ux_coach import NEAR_TOWN_JS
from ux_task import TILE_XY_JS


class Checks(BaseChecks):
    def blocked(self, label):
        self.ok(False, 'BLOCKED ' + label)

    def finish(self):
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


# rev10 R1·R4·R8: 창·overflow 조상 안쪽 영역과 중심/모서리의 hit test를 측정한다.
# 실제 좌표만 읽는다. scrollIntoView/DOM 변경/스타일 변경은 측정 중 금지.
GEOMETRY_JS = r"""({selector, floorSelector, canvasOK=false}) => {
  const floor=floorSelector?document.querySelector(floorSelector)?.getBoundingClientRect().bottom:0;
  const box=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height};};
  return [...document.querySelectorAll(selector)].filter(e=>e.checkVisibility({visibilityProperty:true}) && e.getBoundingClientRect().width>0).map(e=>{
    const r=box(e);let l=0,t=0,right=innerWidth,bottom=innerHeight;
    // rev10 총괄 수정: position:fixed 요소는 (transform·filter·contain 없는) 조상의 overflow에 잘리지 않는다.
    // 고정 요소를 만나면 그 위 조상은 자르는 상자로 세지 않는다(서랍·머리·코치 띠가 고정 배치).
    let fixed=getComputedStyle(e).position==='fixed';
    for(let p=e.parentElement;p&&!fixed;p=p.parentElement) {
      const s=getComputedStyle(p),q=p.getBoundingClientRect();
      if(s.position==='fixed') fixed=true;
      const sx=p.offsetWidth?q.width/p.offsetWidth:1,sy=p.offsetHeight?q.height/p.offsetHeight:1;
      const x=q.left+p.clientLeft*sx,y=q.top+p.clientTop*sy;
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowX)) {l=Math.max(l,x);right=Math.min(right,x+p.clientWidth*sx);}
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowY)) {t=Math.max(t,y);bottom=Math.min(bottom,y+p.clientHeight*sy);}
    }
    const hits=[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].map(([x,y])=>{
      const hit=document.elementFromPoint(r.l+r.w*x,r.t+r.h*y);
      return !!hit&&(e.contains(hit)||canvasOK&&hit.tagName==='CANVAS');
    });
    const textRects=[],walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
    while(walk.nextNode()) if(walk.currentNode.textContent.trim()) {
      const range=document.createRange();range.selectNodeContents(walk.currentNode);textRects.push(...range.getClientRects());
    }
    const textFits=textRects.every(q=>q.left>=l&&q.right<=right&&q.top>=t&&q.bottom<=bottom);
    return {text:e.textContent,rect:r,floor,inside:r.l>=l&&r.r<=right&&r.t>=t&&r.b<=bottom,
      belowFloor:floor!=null&&r.t>=floor,uncovered:hits.every(Boolean),textFits,
      widthOK:e.scrollWidth<=e.clientWidth,heightOK:e.scrollHeight<=e.clientHeight,
      aria:e.getAttribute('aria-label')};
  });
}"""


def geometry(page, selector, floor=None, canvas=False):
    return page.evaluate(GEOMETRY_JS, {'selector': selector, 'floorSelector': floor, 'canvasOK': canvas})


def start(page, base, coach=False):
    r2_start(page, base)
    start_solo(page, months=12)
    if not coach:
        dismiss_guide(page)
    wait_unfolded(page)


def settle(page):
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying') && "
                           "!document.querySelector('#bd-run:not([hidden])')", timeout=30000)
    wait_unfolded(page)


# rev10 R3: 시험 뒤 실제 칩. finish_trial의 UI 경로로 이미 열린 결과를 다시 열어 읽는다.
def trial_chip(checks, page, label):
    if not shown(page, '#bd-again'):
        # 시험 결과 서랍은 정책 서랍과 다르다. 저장된 시험을 재실행해 결과 화면을 연다.
        close_drawer(page)
        page.locator('[data-run="7"]').click()
        from league_flow import finish_trial
        finish_trial(page)
    chip = page.locator('[data-cap="power"] [data-v]')
    match = re.fullmatch(r'정전\s+(\d+(?:\.\d+)?)h', chip.inner_text().strip())
    checks.ok(match is not None and 0 <= float(match[1]) <= 168,
              f'{label} R3 1주 시험 도시 정전 칩 ≤168h: {chip.inner_text()}')
    record = page.evaluate('() => KCP.buildGame.lastTrial()')
    checks.ok(bool(match and record) and record['days'] == 7 and float(match[1]) == record['outH'],
              label + ' R3 칩 = 저장 도시 기준 outH')
    if shown(page, '#bd-drawer-x'):
        page.locator('#bd-drawer-x').click()


# rev10 R4: 접힌 개수까지 더해 배지 3개 이상임을 확인한다. count만으로 통과시키지 않는다.
def badges(checks, page, label):
    close_drawer(page)
    buttons = page.locator('#lg-watch button:visible')
    texts = buttons.all_text_contents()
    more = [i for i, text in enumerate(texts) if re.fullmatch(r'\s*\+\s*\d+\s*', text)]
    hidden = int(re.search(r'\d+', texts[more[0]])[0]) if more else 0
    if len(texts) - len(more) + hidden < 3:
        return False

    def measure(stage, selector='#lg-watch button'):
        rows = geometry(page, selector)
        checks.ok(bool(rows) and all(r['inside'] and r['textFits'] and r['widthOK'] and r['heightOK'] and
                  r['rect']['w'] >= 44 and r['rect']['h'] >= 44 and r['uncovered'] for r in rows),
                  f'{label} R4 {stage} 배지 잘림·가림 없음/44×44: {rows}')
        collisions = page.evaluate(r"""selector => {
          const vis=e=>e.checkVisibility({visibilityProperty:true})&&e.getBoundingClientRect().width>0;
          const badges=[...document.querySelectorAll(selector)].filter(vis);
          const peers=[...document.querySelectorAll('#lg-bar .lg-status > *, #lg-bar .lg-actions > *, #lg-ready')]
            .filter(e=>e.id!=='lg-watch'&&!e.querySelector('#lg-watch')&&vis(e));
          const overlap=(a,b)=>{const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();
            return Math.min(r.right,q.right)>Math.max(r.left,q.left)&&Math.min(r.bottom,q.bottom)>Math.max(r.top,q.top);};
          return badges.flatMap((b,i)=>[...badges.slice(i+1),...peers].filter(p=>!p.contains(b)&&overlap(b,p))
            .map(p=>[b.textContent,p.id||p.textContent]));
        }""", selector)
        checks.ok(not collisions, f'{label} R4 {stage} 서로·머리 요소 겹침 0: {collisions}')
        overflow(checks, page, label + ' R4 ' + stage)

    measure('접힘')
    if more:
        toggle = buttons.nth(more[0])
        checks.ok(more[0] > 0, label + ' R4 첫 배지 유지')
        checks.ok(toggle.get_attribute('aria-label') == f'이번 달 볼 것 {hidden}개 더 보기' and
                  toggle.get_attribute('aria-expanded') == 'false', label + ' R4 N3·aria-expanded=false')
        first = texts[0].strip()
        controls = toggle.get_attribute('aria-controls')
        expanded_selector = '#lg-watch button'
        if controls:
            # R4는 머리 아래 별도 목록도 허용한다. 특정 새 id를 구현에서 베끼지 않는다.
            expanded_selector += ', ' + ', '.join(f'[id="{key}"] button' for key in controls.split())
        toggle.click()
        page.wait_for_timeout(150)
        checks.ok(toggle.get_attribute('aria-expanded') == 'true' and
                  len(geometry(page, expanded_selector)) >= len(texts) + hidden,
                  label + ' R4 누르면 접힌 배지가 모두 펼쳐짐')
        measure('펼침', expanded_selector)
        checks.ok(page.locator('#lg-watch button:visible').first.inner_text().strip() == first,
                  label + ' R4 펼친 뒤 첫 배지 순서 보존')
        page.keyboard.press('Escape')
        checks.ok(toggle.get_attribute('aria-expanded') == 'false' and
                  len(geometry(page, expanded_selector)) == len(texts), label + ' R4 Esc 닫힘')
    return True


# rev10 R1: s7.solo/later_outage의 정상 연결+태양광 10기, 시험 뒤 절전 정책을 재사용.
# 3장 여부는 실제 DOM으로 확인한다. 재현 못 하면 finally에서 BLOCKED를 남긴다.
def cards_and_badges(checks, page, base, label):
    found = {'R1': False, 'R4': False}
    start(page, base)
    try:
        for month in range(1, 13):
            found['R4'] |= badges(checks, page, f'{label} {month}월')
            trial = plan_and_trial(page, renewable=True, change_after=month == 1)
            player = read(page)['player']
            forecast = expected_operation(page, player)
            state = read(page)['S']
            before = state['results'][-1]['team'][player]['unsPct'] if state['results'] else None
            promise(page, trial, forecast, hit=False, baseline=before)
            page.wait_for_function(SYNC, arg=[month, 'review'], timeout=180000)
            settle(page)
            open_panel(page, 'result')
            cards = page.locator('#lg-outage-cards [data-missed]')
            if cards.count() == 3 and shown(page, '#lg-outage-open'):
                cards.first.click()
                page.locator('#lg-outage-open').click()
                # 클릭의 자동 스크롤이 끝난 다음 첫 화면만 측정. 추가 스크롤 금지.
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                found['R1'] = True
                heads = geometry(page, '#lg-outage-cards [data-missed]:first-child .lg-out-name, '
                                 '#lg-outage-cards [data-missed]:first-child .lg-out-size', '#lg-panel .lg-ptabs')
                # 기존 HEAD 카드 이름은 strong일 수도 있다. 의미상 같은 이름 요소만 보완한다.
                if len(heads) != 2:
                    heads = geometry(page, '#lg-outage-cards [data-missed]:first-child strong, '
                                     '#lg-outage-cards [data-missed]:first-child .lg-out-size', '#lg-panel .lg-ptabs')
                checks.ok(len(heads) == 2 and all(x['belowFloor'] and x['inside'] and x['uncovered'] for x in heads),
                          f'{label} R1 세 카드 열기 직후 첫 이름·몫 머리 아래/가림 없음: {heads}')
                actual = geometry(page, '#lg-outage-waterfall [data-out-step="actual"]', '#lg-panel .lg-ptabs')
                checks.ok(len(actual) == 1 and all(x['inside'] and x['uncovered'] and x['belowFloor'] and
                          x['rect']['b'] <= page.viewport_size['height'] for x in actual),
                          f'{label} R1 폭포 actual 줄 창 안/가림 없음: {actual}')
                overflow(checks, page, label + ' R1')
            if all(found.values()):
                break
            click_next(page, read(page)['S'])
            if read(page)['S']['phase'] == 'end':
                break
    finally:
        for key, value in found.items():
            if not value:
                checks.blocked(f'{label} {key} 필수 {"세 카드" if key=="R1" else "배지 셋 이상"} 달 미확보')


# rev10 R2: 빈 계획 실제 시험/운영은 정전 주제와 같은 판정을 재현한다.
def outage_verdict(checks, page, base, label):
    start(page, base)
    trial = plan_and_trial(page, empty=True, change_after=False)
    trial_chip(checks, page, label)
    forecast = expected_operation(page, read(page)['player'])
    expected = promise(page, trial, forecast, hit=False)
    if expected['topic'] != 'uns':
        raise Blocked(label + ' R2 정전 주제 미확보')
    page.wait_for_function(SYNC, arg=[1, 'review'], timeout=180000)
    settle(page)
    open_panel(page, 'result')
    calc = page.locator('#lg-promise-uns-calc')
    # rev16 #72-1·3: 판정 계산은 예측 자세히 안, 판정 줄 뒤에 둔다.
    if not calc.is_visible() and shown(page, '[data-promise-details]'):
        page.locator('[data-promise-details]').click()
    checks.ok(calc.count() == 1 and calc.is_visible() and calc.evaluate(
        'e=>!!e.closest("#lg-promise-result") && !!e.closest("details[open]")'), label + ' R2 계산 줄 펼친 예측 자세히 안')
    # rev10 총괄 수정: '첫 화면'은 결과 서랍 맨 위(scrollTop 0)다. 앞 단계 조작이 남긴 서랍 스크롤 위치를 지우고 잰다.
    page.evaluate('() => { const b = document.querySelector("#lg-panel .lg-pbody"); if (b) b.scrollTop = 0; }')
    page.wait_for_timeout(200)
    checks.ok(calc.evaluate('''e => {const p=e.closest('#lg-promise-result'), v=p?.querySelector('[data-compare]');
      return !!v && !!(v.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING); }'''),
              label + ' R2 상세 판정 줄 뒤 계산 줄')
    calc.scroll_into_view_if_needed()
    calc_boxes = geometry(page, '#lg-promise-uns-calc')
    checks.ok(len(calc_boxes) == 1 and calc_boxes[0]['inside'] and calc_boxes[0]['uncovered'],
              label + ' R2 펼친 상세 계산 줄 영역/가림 없음')
    verdict = page.locator('#lg-promise-result [data-compare="uns"]').inner_text()
    word = {'same': '같음', 'up': '늘어남', 'down': '줄어듦'}[expected['direction']]
    checks.ok(re.search(r'실제 결과: .*' + word + r'\(', verdict) is not None,
              f'{label} R2 S6 판정 낱말 {word}: {verdict}')
    first = page.locator('#lg-outage-same')
    checks.ok(first.count() == 1 and f'(판정: {word})' in first.inner_text(), label + ' R2 같은 달 S7 판정 일치')
    overflow(checks, page, label + ' R2')


# rev10 R5: 첫 시험 뒤 실제 전선을 모두 철거하고 운영. 결과/분해는 생성해 넣지 않는다.
def no_lines(checks, page, base, label):
    start(page, base)
    trial = plan_and_trial(page, change_after=False)
    assert page.evaluate('() => KCP.league.plan(st=>{st.lines=[];})'), '전선 철거 계획 실패'
    n = page.evaluate('() => KCP.buildGame.planIssues().unlinked.length')
    if n < 1:
        raise Blocked(label + ' R5 미연결 설비 달 미확보')
    page.wait_for_timeout(400)
    # rev10 총괄 수정: 명세 R5는 원인 카드로 나눌 몫이 없는(no-cause) 한 줄 요약의 꼬리다.
    # 시험 뒤에 철거하면 '내 선택'이 가장 큰 몫이 되어 그 분기가 나오지 않으므로, 철거한 계획으로 시험 1주를 다시 돌린다.
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    trial = page.evaluate("() => KCP.buildGame.lastTrial()")
    assert trial and trial["days"] == 7, '철거 뒤 1주 시험 저장 없음'
    page.locator("#bd-drawer-x").click()
    page.wait_for_timeout(400)
    # d80b 허용 저장 복원: 방금 만든 실제 계획/시험 전체 묶음을 그대로 복원한다.
    # 운영 결과·미연결 수·S7 문구를 주입하지 않는다.
    saved = bundle(page)
    restore(page, saved)
    forecast = expected_operation(page, read(page)['player'])
    promise(page, trial, forecast, hit=False)
    page.wait_for_function(SYNC, arg=[1, 'review'], timeout=180000)
    settle(page)
    open_panel(page, 'result')
    summary = page.locator('#lg-outage-single')
    if summary.count() != 1:
        raise Blocked(label + ' R5 선 없는 달 한 줄 요약 미확보')
    # rev12 C4: 운영 당시 n 근거는 유지.
    want = f"이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요."
    text = summary.inner_text()
    checks.ok(want in text and '정전 자체는 커요: ' in text, f'{label} R5 N2와 운영 당시 n={n}: {text}')
    # rev10 총괄 수정: 다음 달 계획 단계의 결과 서랍에는 지난달 S7 한 줄 요약이 다시 나오지 않아(빈 '결과')
    # 브라우저로는 '다음 달 지도 변경 뒤 n 유지'를 볼 자리가 없다. 운영 계획 사본에서 n을 읽는지는
    # Node 57-rev10.js R5(운영 계획 미연결 6기, 현재 지도와 다른 값)로 확인한다.
    a = current_attribution(page)
    checks.ok(a['round'] == 1, label + ' R5 실제 첫 달 분석 사본')
    overflow(checks, page, label + ' R5')


# rev10 R8: ux_coach 1→2→3 실제 도구/지도 조작. 3/8 행동 단추는 누르지 않는다.
def coach_labels(checks, page, base, label):
    start(page, base, coach=True)
    page.wait_for_selector('#lg-coach[data-step="1"]', state='visible')
    page.locator('#lg-coach-action').click()
    page.wait_for_timeout(2500)
    close_drawer(page)
    page.wait_for_selector('#lg-coach[data-step="2"]', state='visible')
    page.locator('#lg-coach-action').click()
    if shown(page, '[data-tool="diesel"]'):
        page.locator('[data-tool="diesel"]').click()
    kind = page.locator('#bd-root').get_attribute('data-mode') or 'diesel'
    before = page.evaluate('() => KCP.buildGame.current().builds.length')
    for tile in page.evaluate(NEAR_TOWN_JS, kind):
        xy = page.evaluate(TILE_XY_JS, tile)
        if not xy:
            continue
        page.mouse.click(*xy)
        if shown(page, '#bd-cf-ok'):
            page.locator('#bd-cf-ok').click()
        page.wait_for_timeout(150)
        if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
            break
    page.wait_for_selector('#lg-coach[data-step="3"]', state='visible')
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    if coach_step(page) != 3:
        raise Blocked(label + ' R8 3/8 단추 누르기 전 장면 미확보')
    rows = geometry(page, '.bd-coach-mark', '#lg-coach', canvas=True)
    checks.ok(len(rows) == 2 and all(r['inside'] and r['belowFloor'] and r['uncovered'] and r['textFits'] for r in rows),
              f'{label} R8 두 이름표 창 안/코치 아래/가림 없음: {rows}')
    overflow(checks, page, label + ' R8')


def main():
    checks = Checks()
    try:
        if len(sys.argv) != 2:
            raise ValueError('실행 주소 인자 하나 필수(기본 포트 없음)')
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height, theme in ((390, 844, 'light'), (390, 844, 'dark'),
                                              (1280, 900, 'light'), (1280, 900, 'dark')):
                    for run in (cards_and_badges, outage_verdict, no_lines, coach_labels):
                        label = f'{width}x{height}-{theme}-{run.__name__}'
                        context, external = context_for(browser, base, width, height, theme)
                        page, events = monitored_page(context)
                        try:
                            run(checks, page, base, label)
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
        checks.blocked(f'주소/브라우저 환경 {type(exc).__name__}: {str(exc).splitlines()[0]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
