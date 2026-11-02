"""S8N 명세 기반 수용 검사. 브라우저 실행은 샌드박스 밖 로컬 담당자 전용.

실행: tests/.venv/bin/python tests/league/s8n.py http://127.0.0.1:9430/index.html
기준: S8N-next.md:9–17, V3A-screen.md, V3A-fix1~3.md, 수정 3·4 last.md 판정 표, D-65:3,20.
기대값은 명세와 직접 한 조작에서 정한다. UI 계산/판정 함수는 호출하지 않는다.
시작 fixture의 rounds를 단축한다. 옛 저장본 검사만 낡은 false를 주입한다.
AUTO 문자열을 평가하지 않는다. 계획 변경은 공개 검사 API를 사용한다.
"""

from league_flow import finish_trial, map_key_visible
from league_flow import pass_issue_check
import re
import sys
from urllib.parse import urljoin, urldefrag

from playwright.sync_api import expect, sync_playwright
from econui import (Checks, context_for, diagnostics, local_address, monitored_page,
                   open_panel, overflow, screenshot, setup_pair, SEED_JS, shown,
                   mission_status, pending_mission, learning_note, confirmed_plan)
from league_flow import select_mode, start_solo
from solo import close_drawer, click_next

STATE = "() => {const l=KCP.league.state(); return l.S || l.snap;}"
SYNC = "([r,p]) => {const l=KCP.league.state(),s=l&&(l.S||l.snap);return s?.round===r&&s?.phase===p;}"
NOTES = """() => {
  const l=KCP.league.state();
  const d=l.role==='solo' ? JSON.parse(localStorage.getItem('kcp-league-solo-v1')).interview :
    JSON.parse(localStorage.getItem(`kcp-league-data-v1:${l.room}:${l.team}`));
  return d?.interview?.months || {};
}"""
PUBLIC = """() => {const l=KCP.league.state();
  const v=structuredClone(l.snap || KCP.leagueCore.publicView(l.S,0));delete v.now;return v;}"""
DIRECTIONS = {'up': '늘 것', 'down': '줄 것', 'same': '같을 것'}
REASON = '가상검사 사과나무 선택을 이어 간다'

# 관찰 전용 Canvas 계측: 실제 draw 명령과 measureText의 ink bounds를 기록.
# 선 위치를 재계산하거나 렌더러의 labelEdge/색상 상수를 복제하지 않는다.
CANVAS = """(() => {
  const p=CanvasRenderingContext2D.prototype, records=new WeakMap();
  window.__s8nCanvas=canvas=>records.get(canvas)||{texts:[],arrows:[]};
  const get=c=>{if(!records.has(c.canvas)) records.set(c.canvas,{texts:[],arrows:[]});return records.get(c.canvas);};
  for(const name of ['clearRect','beginPath','moveTo','lineTo','stroke','fill','fillText']) {
    const original=p[name];
    p[name]=function(...a) {
      if(this.canvas.id==='lg-mapc') {
        const r=get(this), m=this.getTransform(), pt=(x,y)=>{const q=new DOMPoint(x,y).matrixTransform(m);return [q.x,q.y];};
        if(name==='clearRect') {r.texts=[];r.arrows=[];r.path=[];r.last=null;}
        if(name==='beginPath') r.path=[];
        if(name==='moveTo'||name==='lineTo') (r.path ||= []).push(pt(a[0],a[1]));
        if(name==='stroke') r.last=(r.path||[]).map(q=>q.slice());
        if(name==='fill' && r.path?.length===3 && r.last?.length===2 &&
          Math.hypot(r.path[0][0]-r.last[1][0],r.path[0][1]-r.last[1][1])<.01) r.arrows.push(r.last);
        if(name==='fillText') {
          const t=this.measureText(a[0]), pad=this.lineWidth/2;
          const lo=pt(a[1]-t.actualBoundingBoxLeft-pad,a[2]-t.actualBoundingBoxAscent-pad);
          const hi=pt(a[1]+t.actualBoundingBoxRight+pad,a[2]+t.actualBoundingBoxDescent+pad);
          r.texts.push({text:String(a[0]),x:lo[0],y:lo[1],right:hi[0],bottom:hi[1]});
        }
      }
      return original.apply(this,a);
    };
  }
})();"""


def require(checks, value, label):
    if not checks.ok(value, label):
        raise AssertionError(label)


def restore_solo(page, saved, month, phase):
    # 먼저 앱을 떠나 pagehide 저장을 끝낸다. 이후 주입한 fixture는 덮어쓰지 않는다.
    base = urldefrag(page.url)[0]
    page.goto(urljoin(base, 'README.md'))
    page.evaluate("raw => localStorage.setItem('kcp-league-solo-v1', raw)", saved)
    page.goto(base + '#league/solo')
    page.wait_for_function(SYNC, arg=[month, phase])


def capture(checks, page, label):
    overflow(checks, page, label)
    screenshot(checks, page, 's8n-' + label + '.png')


def next_phase(page, month, phase):
    close_drawer(page)
    if page.evaluate("() => KCP.league.state().role") == 'solo':
        click_next(page, page.evaluate(STATE))
    else:
        page.locator('#lg-next').click()
    page.wait_for_function(SYNC, arg=[month, phase])


def trial(page):
    close_drawer(page)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    page.locator('#bd-drawer-x').click()


def ready(page, submit=True):
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm')
    if submit:
        page.locator('[data-evidence="grid"]').click()
        topic = page.locator('[data-pred]').first
        topic.select_option('down')
        page.locator('[data-confidence="fairly"]').click()
        page.locator('#lg-ready-confirm').click()


def answer(page, choice, reason):
    open_panel(page, 'result')
    page.locator('[data-compared]').check()
    page.locator(f'#lg-panel [data-answer="{choice}"]').click()
    page.locator('[data-note="askReason"]').fill(reason)
    page.locator('[data-note="askReason"]').press('Tab')


def drawer(checks, page, width, tab, result, label):
    open_panel(page, tab)
    box = page.locator('#lg-panel').bounding_box()
    require(checks, bool(box), label + ' 서랍 표시')
    if label.endswith('-끝') and page.locator('#lg-panel').get_attribute('data-tab') == 'result':
        viewport_width = page.evaluate('() => innerWidth')
        checks.ok(abs(box['x'] - 8) <= 2 and
                  abs(box['x'] + box['width'] - (viewport_width - 8)) <= 2 and
                  box['width'] >= viewport_width - 32,
                  label + ' 끝 결과 전폭 [17·V5]')
    elif width == 1180:
        if result:
            checks.ok(.45 <= box['width'] / width <= .55,
                      label + ' 결과·일지 폭 45~55% [17]')
        else:
            # 작업 전 CSS의 기존 계획 서랍 360px. 결과 폭과 같아지는 회귀도 탐지.
            checks.ok(abs(box['width'] - 360) <= 2, label + ' 계획 폭 기존 360px [17]')
    overflow(checks, page, label)
    return box['width']


def plan(page, kind):
    return page.evaluate("""kind => KCP.league.plan(st=>{
      const B=KCP.buildGame;
      if(kind==='empty') Object.assign(st,{builds:[],lines:[],policies:[]});
      else if(kind==='lines') {
        const id=KCP.league.state().team;
        Object.assign(st,{builds:[],lines:structuredClone(KCP.ECON_DATA.normalStartPlans[id].lines),policies:[]});
      } else {
        const used=new Set(st.builds.map(b=>b.i));
        const t=B.TILES.find(t=>!t.out && t.site<0 && !used.has(t.i) && !B.siteRule('diesel',t));
        if(!t) throw Error('합법적 설비 추가 칸 없음');
        st.builds.push({t:'diesel',i:t.i});
      }
    })""", kind)


def learning_details(checks, page, label):
    detail = page.locator('#lg-panel details').filter(
        has=page.locator('summary').filter(has_text='판정 상세 보기'))
    require(checks, detail.count() == 1, label + ' 터치로 여는 판정 상세 details 하나 [V3A A5]')
    if not detail.evaluate('el => el.open'):
        detail.locator(':scope > summary').click()
    text = detail.inner_text()
    checks.ok('단위' in text and '원인' in text and '정전' in text,
              label + ' 펼친 상세에 단위 조건·원인 예시 [V3A A5]')
    detail.locator(':scope > summary').click()
    checks.ok(not detail.evaluate('el => el.open'), label + ' 상세 다시 접기 [V3A A5]')


def reminder_geometry(checks, page, label, first_guide):
    close_drawer(page)
    # 실제 렌즈를 켜야 범례와 접속 정보 상자가 측정에서 빠지지 않는다.
    for lens in ('grid', 'complaints', 'result'):
        button = page.locator(f'[data-lens="{lens}"]')
        if button.get_attribute('aria-pressed') != 'true':
            button.click()
    # 첫 달 안내는 다음 달 이유 띠와 자연스럽게 공존하지 않는다.
    # 첫 화면에서 보관한 실제 DOM을 같은 부모에 재부착해 CSS 교차를 검사한다.
    require(checks, bool(first_guide), label + ' 첫 달 안내 DOM fixture 확보')
    # 품질8 UX U5(docs/QUALITY-ux.md 6절): 첫 달 안내는 코치 띠(#lg-coach)이고, 코치가 있으면 이유 띠를
    # 숨겨 둘이 함께 보이지 않게 했다. 겹침은 코치 없이 나머지 요소로 보고, 코치를 다시 붙였을 때
    # 이유 띠가 숨는지(공존 금지)를 따로 확인한다.
    page.locator('[data-lens="complaints"]').focus()
    page.wait_for_timeout(250)
    require(checks, shown(page, '#lg-plan-reminder'), label + ' 이유 띠 표시 [V3A 1]')
    chips = '#lg-watch' if page.viewport_size['width'] <= 760 else '#lg-hud-chips'
    for selector in ('#bd-hud .bd-cap', chips, '#lg-lens-grid', '.lg-lens-key',
                     '.lg-map-result'):
        nodes = page.locator(selector)
        # rev12 Q2: 접힌 두 줄의 같은 요소를 펼친 상태로 기존 가시성·교차 단언 유지.
        with map_key_visible(page, selector):
            require(checks, shown(page, selector), label + ' 겹침 검사 대상 표시 ' + selector)
            boxes = nodes.evaluate_all("""nodes => {
              const a=document.querySelector('#lg-plan-reminder').getBoundingClientRect();
              return nodes.filter(n=>n.checkVisibility()).map(n=>{
                const b=n.getBoundingClientRect();
                return {area:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
                  Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))};
              });
            }""")
            checks.ok(bool(boxes) and all(b['area'] == 0 for b in boxes),
                      label + ' 띠와 경계 상자 교차 면적 0 ' + selector)
    overflow(checks, page, label + ' 띠·렌즈')
    page.evaluate("""html => {
      document.querySelector('#bd-root').insertAdjacentHTML('beforeend',html);
      window.dispatchEvent(new Event('resize'));
    }""", first_guide)
    page.wait_for_timeout(150)
    checks.ok(not shown(page, '#lg-plan-reminder'), label + ' 첫 달 코치와 이유 띠 공존 없음(코치가 있으면 띠 숨김)')
    page.locator('#lg-coach').evaluate('el => el.remove()')
    open_panel(page, 'journal')
    checks.ok(not shown(page, '#lg-plan-reminder'), label + ' 서랍 열면 이유 띠 숨김 [V3A 1]')
    close_drawer(page)
    checks.ok(shown(page, '#lg-plan-reminder'), label + ' 서랍 닫으면 이유 띠 복귀 [V3A 1]')


def followup(checks, page, added, mission, reason, label, mismatch=False, neutral=False):
    ready(page, submit=False)
    # 품질8 UX ②(docs/QUALITY-ux.md 8.5): 약속 카드를 한 화면에 넣으려고 지난달 말·실제 변경·판정 규칙을
    # 펼치기(details)로 접었다. 내용은 그대로이므로 펼친 뒤 확인한다.
    if not page.locator('#lg-plan-followup').evaluate('el => el.tagName !== "DETAILS" || el.open'):
        page.locator('#lg-plan-followup > summary').click()
    text = page.locator('#lg-plan-followup').inner_text()
    checks.ok(all(s in text for s in ('말한 변경', '이번 달 실제 변경', reason)), label + ' 말·실제 변경 나란히 [10]')
    actual = page.locator('#lg-actual-change').inner_text()
    checks.ok(bool(re.search(rf'설비\s*{added}개\s*추가\s*·\s*0개\s*제거', actual)), label + f' 실제 설비 +{added}/-0 [10] (실제: {actual}) ' + str(page.evaluate("""() => {const L=KCP.league.state(),V=L.S||L.snap;
              const d=JSON.parse(localStorage.getItem('kcp-league-solo-v1')||'null');const m=d?.interview?.interview?.months||{};
              const ids=p=>(p?.builds||[]).map(b=>b.t+':'+b.i).join(',');
              return {round:V.round, prev:ids(m[V.round-1]?.operatingPlan), cur:ids(KCP.buildGame.current()), team:ids(V.teams[L.team].plan)};}""")))
    checks.ok(bool(re.search(r'전선\s*0\s*→\s*0', actual)) and '변경 없음' in actual,
              label + ' 전선·정책 변경 없음 [10]')
    expected = ('아직 바꾸지 않았어요' if neutral else
                '말과 지금 계획이 달라요 — 유지하겠다고 했어요' if mismatch else
                '달성' if mission else '미달성 예정 · 지난달 유지 이유에 결과 숫자나 원인이 없었어요(다음엔 넣어요)')  # 총괄 10-23 아르곤 문구(UX 갈래)
    mission_status(checks, page, expected,
                   label, '#lg-previous-mission', preview=True)
    checks.ok(('말과 지금 계획이 달라요' in text) == mismatch and '말과 실제 변경이 달라요' not in text,
              label + ' 현재 계획 어긋남 미리보기 [V3A-fix3]')
    month = str(page.evaluate(STATE)['round'] - 1)
    checks.ok(page.evaluate(NOTES)[month]['followingPlanChanged'] is None,
              label + ' 계획 미리보기는 followingPlanChanged:null 유지 [V3A-fix2]')
    confirmed_plan(checks, page, int(month), None, None, label)
    # 품질8 UX ②: 판정 줄·규칙은 접힌 '지난달 말과 실제 변경' 바깥(약속 카드 위)에 있다. 화면(서랍)에 보이는지 본다.
    rules = page.locator('#lg-panel').inner_text()
    checks.ok(all(s in rules for s in ('다음 달', '계획', '숫자', '원인', '유지', '달성')),
              label + ' 판정 규칙을 화면에 표시 [11]')
    overflow(checks, page, label + ' 준비 관문')
    learning_details(checks, page, label)
    close_drawer(page)


def end_checks(checks, page, width, label, missions):
    for attempt in range(2):
        if attempt:
            page.locator('#lg-panel .lg-pbody').evaluate('el => {el.scrollTop=el.scrollHeight; const p=el.closest("#lg-panel"); if (p) p.scrollTop=el.scrollHeight;}')  # 멀티 다시 그리기로 떼어진 요소면 조상이 없다(검토 반영)
            close_drawer(page)
        # 첫 진입은 자동으로 열린 결과를 그대로 측정한다. 아직 닫혀 있으면
        # 최초 클릭만 한다. 닫았다 열어 스크롤이 고쳐지는 경로와 구분한다.
        if page.locator('#lg-bar [data-panel="result"]').get_attribute('aria-expanded') != 'true':
            page.locator('#lg-bar [data-panel="result"]').click()
        page.wait_for_timeout(200)
        placement = page.locator('#lg-decisions').evaluate("""el => {
          const body=el.closest('.lg-pbody'), panel=el.closest('#lg-panel'), chart=document.querySelector('#lg-timeline');
          const a=el.getBoundingClientRect(), b=body.getBoundingClientRect(), c=chart.getBoundingClientRect(), p=panel.getBoundingClientRect();
          const h=el.querySelector('h3').getBoundingClientRect();
          return {scroll:body.scrollTop, panelScroll:panel.scrollTop, above:a.bottom<=c.top,
            first:!!(el.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING),
            visible:h.top>=Math.max(b.top,p.top,0) && h.bottom<=Math.min(b.bottom,p.bottom,innerHeight)};
        }""")
        checks.ok(placement['above'] and placement['first'], label + ' 결정과 결과가 추이 그래프 위 [V3A 5]')
        checks.ok(placement['scroll'] == 0 and placement['panelScroll'] == 0 and placement['visible'],
                  label + (' 끝 최초 진입' if not attempt else ' 끝 재열기') + ' 맨 위·결정 제목 첫 화면 [V3A 5]')
    drawer(checks, page, width, 'result', True, label + '-끝')
    notes = page.evaluate(NOTES)
    # 시나리오에서 직접 정한 기대값으로 확정 기록과 활동지 문구를 대조한다.
    page.evaluate("""() => {
      window.__s8nCopy=null;
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async text=>{window.__s8nCopy=text;}}});
    }""")
    page.locator('#lg-jcopy').click()
    page.wait_for_function('() => window.__s8nCopy !== null')
    worksheet = page.evaluate('window.__s8nCopy')
    page.locator('#lg-panel .lg-pbody').evaluate('el => {el.scrollTop=0;}')
    rounds = page.evaluate(STATE)['rounds']
    for month, (changed, status) in missions.items():
        checks.ok(notes[str(month)].get('followingPlanChanged', 'missing') is changed,
                  label + f' 끝 {month}달 확정 변경 여부 보존 [V3A-fix2]')
        confirmed_plan(checks, page, month, changed, 'result' if changed is not None else None,
                       label + f' 끝 {month}달')
        rd = rounds[month - 1]
        heading = f"■ {rd['year']}년 {rd['month']}월"
        sections = worksheet.split(heading, 1)
        section = sections[1].split('■ ', 1)[0] if len(sections) == 2 else ''
        match = re.search(r'학습 미션\s+([^\n]+)', section)
        actual = match[1].strip() if match else ''
        checks.ok(actual == status or (status == '미달성' and actual == '미달성 · 말과 실제 변경이 달라요'),
                  label + f' 활동지 {month}달 확정 판정 = {status} [V3A-fix2]')
    checks.ok('지금 계획 기준' not in worksheet and '아직 바꾸지 않았어요' not in worksheet,
              label + ' 활동지에 계획 미리보기 문구 없음 [V3A-fix2]')
    rows = page.locator('#lg-decisions [data-decision-month]')
    expected = {str(m): n for m, n in notes.items() if n.get('evidence') or n.get('pred') or n.get('askReason')}
    checks.ok(rows.count() == len(expected) and len(expected) >= 2, label + ' 기록 있는 달마다 한 행 [12]')
    checks.ok(any(n.get('outcome') for n in expected.values()), label + ' 판정 있는 달 실제 대조 [12]')
    for month, note in expected.items():
        row = page.locator(f'#lg-decisions [data-decision-month="{month}"]')
        require(checks, row.count() == 1, label + f' {month}달 행 유일 [12]')
        text = row.inner_text()
        if note.get('evidence'):
            checks.ok(note['evidence']['text'] in text, label + f' {month}달 근거=기기 기록 [12]')
        for topic, direction in note.get('pred', {}).items():
            # D-80 B-6: 정전 0인 달의 약속 주제 'grid'는 결정 목록에 '예측 계통 <방향>'으로 쓴다.
            checks.ok({'uns': '정전', 'grid': '계통'}.get(topic, '현금') + ' ' + DIRECTIONS[direction] in text,
                      label + f' {month}달 예측=기기 기록 [12]')
        outcome = note.get('outcome')
        if outcome:
            checks.ok(('예상과 같음' if outcome['hit'] else '예상과 다름') in text,
                      label + f' {month}달 판정=기기 기록 [12]')
        else:
            checks.ok('→ 판정' not in text, label + f' {month}달 없는 판정 생략 [12]')
        if note.get('askReason'):
            checks.ok(note['askReason'] in text, label + f' {month}달 이유=기기 기록 [12]')
        else:
            checks.ok('바꿀 이유' not in text and '유지할 이유' not in text,
                      label + f' {month}달 없는 이유 생략 [12]')
    definition = page.locator('#lg-final-causes').inner_text()
    checks.ok(all(s in definition for s in ('누적 정전', '도시 안 부족량의 합', '그 시각 도시 수요의 2%', '넘은 시간의 합')),
              label + ' 누적 정전 정의 [13]')
    geometry = page.locator('#lg-timeline [data-change] text').evaluate_all("""nodes=>{
      const boxes=nodes.map(n=>({kind:n.parentElement.dataset.change,r:n.getBoundingClientRect()}));
      let intersections=0;
      boxes.forEach((a,i)=>boxes.slice(i+1).forEach(b=>{
        if(Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left) &&
           Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top)) intersections++;
      })); return {kinds:boxes.map(b=>b.kind),intersections};
    }""")
    checks.ok(geometry['intersections'] == 0, label + ' 원/설/정 경계 상자 교차 0 [13]')
    capture(checks, page, label + '-끝')
    return geometry


def solo(checks, context, base, width, label, pages):
    page, events = monitored_page(context)
    pages.append((page, events, 'solo'))
    page.goto(base + '#league')
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.locator('#lg-solo .lg-extra-settings > summary').click()
    page.locator('#lg-solo-seed').select_option('fixed')
    start_solo(page)
    page.wait_for_function(SYNC, arg=[1, 'plan'])
    # 길이만 단축. 저장은 정상 계획 변경의 저장 경로로 수행한다.
    page.evaluate("() => {KCP.league.state().S.rounds.length=3;}")
    first_guide = page.locator('#lg-coach').evaluate('el => el.outerHTML')  # 품질8 UX U5: 첫 달 안내 = 코치 띠
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()
    require(checks, plan(page, 'empty'), label + ' 정전 관찰용 빈 계획')
    # 도시 이름은 자료에서 읽는다(D-58·D-86, #78). 이름표에만 쓴다.
    team_name = page.evaluate("() => KCP.leagueCore.teamDef(KCP.leagueCore.regionOf('south'), 'pyeongtaek').name")
    checks.ok(page.evaluate("() => KCP.league.state().team") == 'pyeongtaek', f'{label} {team_name}')
    checks.ok(page.evaluate(STATE)['seedMode'] == 'fixed', label + ' 고정 날씨·사건')
    drawer(checks, page, width, 'journal', False, label + '-첫계획')
    trial(page)
    ready(page)
    page.wait_for_function(SYNC, arg=[1, 'review'])
    answer(page, 'revise', REASON)
    pending_mission(checks, page, 1, label + ' 수정 약속 직후')
    drawer(checks, page, width, 'result', True, label + '-결과')
    drawer(checks, page, width, 'journal', True, label + '-일지')
    next_phase(page, 2, 'plan')
    require(checks, shown(page, '#lg-plan-reminder'), label + ' 건설 화면 지난달 띠 [9]')
    checks.ok(REASON in page.locator('#lg-plan-reminder').inner_text(), label + ' 띠에 직접 쓴 이유 [9]')
    reminder_geometry(checks, page, label, first_guide)
    capture(checks, page, label + '-다음달띠')
    page.locator('#lg-plan-reminder-close').click()
    page.reload()
    page.wait_for_function(SYNC, arg=[2, 'plan'])
    checks.ok(not shown(page, '#lg-plan-reminder'), label + ' 닫기 새로고침 뒤 유지 [9]')
    drawer(checks, page, width, 'journal', False, label + '-다음계획')
    # rev13 R3: ≤760px는 짧은 꼬리표, 나머지 폭은 기존 뜻/교부세 주석 유지.
    money_note = page.locator('[data-cap="budget"] [data-money-note], [data-cap="budget"] .lg-debt-note').filter(visible=True).first
    note_text = money_note.inner_text().strip()
    checks.ok(note_text == '+빚 한도' if width <= 760 else note_text.startswith('(빚 한도 포함)'),
              label + ' 머리 돈 칩 설명 [14] (rev13 R3 폭별 꼬리표)')
    state = page.evaluate(STATE)
    require(checks, state['results'][0]['team']['pyeongtaek']['unsPct'] > state['goals']['unsPct'],
            label + ' 실제 운영 정전 목표 초과 사례')
    power = page.locator('[data-cap="power"]')
    checks.ok('tone-mint' not in (power.get_attribute('class') or ''), label + ' 다음 달 설비/피크 초록 아님 [14]')
    checks.ok(power.evaluate("""el=>{
      const probe=document.createElement('span');probe.style.color='var(--ui-mint)';el.append(probe);
      const mint=getComputedStyle(probe).color,actual=getComputedStyle(el.querySelector('[data-v]')).color;
      probe.remove();return actual!==mint;
    }"""), label + ' 설비/피크 실제 글자색도 정상 초록 아님 [14]')
    followup(checks, page, 0, False, REASON, label + '-변경전', neutral=True)
    open_panel(page, 'journal')
    before = page.evaluate("() => KCP.buildGame.current().builds.length")
    require(checks, plan(page, 'add'), label + ' 설비 실제 추가')
    checks.ok(page.evaluate("() => KCP.buildGame.current().builds.length") == before + 1, label + ' 실제 설비 정확히 1기 증가')
    # 준비 관문을 다시 열기 전, 열린 계획 서랍 자체가 변경을 바로 반영해야 한다.
    expect(page.locator('#lg-previous-mission')).to_contain_text(re.compile(r'(?<!미)달성'))
    mission_status(checks, page, '달성', label + ' 설비 추가 직후 즉시 갱신',
                   '#lg-previous-mission', preview=True)
    followup(checks, page, 1, True, REASON, label + '-변경후')
    ready(page)
    page.wait_for_function(SYNC, arg=[2, 'review'])
    checks.ok(learning_note(page, 1).get('followingPlanChanged') is True,
              label + ' 준비 뒤 수정 약속·설비 추가 확정 저장 [V3A-fix2]')
    confirmed_plan(checks, page, 1, True, 'result', label + ' 솔로 운영 뒤')
    # basis 없는 옛 false: 직전 달은 실제 운영 계획으로 true를 복원하고,
    # 이번 달은 다음 운영이 없으므로 false를 확정값으로 취급하지 않는다.
    legacy = page.evaluate("""() => {
      const d=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
      for (const month of ['1','2']) {
        const n=d.interview.interview.months[month];
        n.followingPlanChanged=false; delete n.followingPlanBasis;
      }
      return JSON.stringify(d);
    }""")
    restore_solo(page, legacy, 2, 'review')
    confirmed_plan(checks, page, 1, True, 'result', label + ' 옛 false 실제 변경으로 재계산')
    confirmed_plan(checks, page, 2, None, None, label + ' 옛 이번 달 false는 미확정')
    # 같은 둘째 달 결과에서 분기한다. 결과·판정 필드를 만들거나 판정 함수를
    # 호출하지 않고 실제 답 입력 → 다음 달 진입 → 계획 확인을 매번 수행한다.
    value = page.evaluate(STATE)['results'][-1]['team']['pyeongtaek']['unsPct']
    saved = page.evaluate("() => localStorage.getItem('kcp-league-solo-v1')")
    normalized = f'{value:.1f}'
    cases = [(REASON, False), ('정전 결과를 확인하여 유지한다', True),
             (f'{round(value, 2):g} 결과를 확인하여 유지한다', False),
             (f'{round(value, 2):g}% 결과를 확인하여 유지한다', True),
             ('123456789% 결과를 확인하여 유지한다', False),
             ('0', False), ('0%', False)]
    cases += [(f'{number}% 결과를 확인하여 유지한다', True)
              for number in (normalized, normalized + '0')]
    cases.append(('정전 결과를 확인하여 유지한다', True))
    for i, (reason, expected) in enumerate(cases):
        if i:
            restore_solo(page, saved, 2, 'review')
        answer(page, 'keep', reason)
        pending_mission(checks, page, 2, label + f' 유지 이유 사례 {i} 응답 직후')
        next_phase(page, 3, 'plan')
        followup(checks, page, 0, expected, reason, label + f'-다음달 이유 사례 {i}')
    # 셋째 달에는 정책·설비 변경을 같이 만들어 타임라인 표지 겹침을 검사한다.
    require(checks, plan(page, 'add'), label + ' 셋째 달 설비 추가')
    followup(checks, page, 1, False, '정전 결과를 확인하여 유지한다',
             label + '-유지약속뒤변경', mismatch=True)
    open_panel(page, 'city')
    page.locator('[data-pol="taxRes"]').focus()
    page.locator('[data-pol="taxRes"]').press('ArrowRight')
    page.locator('[data-pol="taxRes"]').press('Tab')
    trial(page)
    ready(page)
    page.wait_for_function(SYNC, arg=[3, 'review'])
    checks.ok(learning_note(page, 2).get('followingPlanChanged') is True,
              label + ' 준비 뒤 유지 약속·실제 변경 확정 저장 [V3A-fix2]')
    confirmed_plan(checks, page, 2, True, 'result', label + ' 유지 약속 뒤 실제 변경')
    open_panel(page, 'result')
    if shown(page, '[data-missed]'):
        page.locator('[data-missed]').first.click()
        page.locator('#lg-outage-open').click()
    # 원인 요약/공개를 UI에서 실행한 뒤 기록과 끝 행을 직접 비교한다.
    cause_text = page.locator('#lg-missed').inner_text()
    answer(page, 'keep', '정전 결과를 확인하여 유지한다')
    pending_mission(checks, page, 3, label + ' 마지막 달', final=True)
    next_phase(page, 3, 'end')
    missions = {1: (True, '달성'), 2: (True, '미달성'), 3: (None, '마지막 달이라 판정 없음')}
    geometry = end_checks(checks, page, width, label, missions)
    checks.ok(set(geometry['kinds']) >= {'outage', 'build', 'policy'}, label + ' 원/설/정 세 표지 실제 검사 [13]')
    note = page.evaluate(NOTES)['3']
    text = page.locator('#lg-decisions [data-decision-month="3"]').inner_text()
    basis = (note.get('outageFrozen') or note.get('missedCarry') or {}).get('basis', note.get('missedBasis'))
    names = {'choice': '내 선택', 'weather': '날씨·계절·운전 기간' if basis == 'monthly' else '날씨·운전 기간',
             'event': '사건·대응', 'trade': '이웃 거래', 'grid': '접속 대기',
             'progress': '접속·공사·기술 진행', 'growth': '도시 성장·연료 값'}
    if note.get('missed'):
        name = names.get(note['missed'])
        checks.ok(name is not None and name in text and name in cause_text, label + ' 고른 원인 기록 연결 [12]')
    if note.get('outageLargest'):
        largest = note['outageLargest']
        name = names.get(largest.get('key'))
        # V8 3번 문구: 고른 원인이 크기가 같은 몫 없이 단독 최대이면 '실제 가장 큰 몫과 같음(+x%p…)'만 쓴다.
        parts = (note.get('outageFrozen') or {}).get('parts') or []
        tied = [p for p in parts if round(abs(p.get('value', 0)), 2) == round(abs(largest['value']), 2)]
        unique_match = note.get('missed') == largest.get('key') and len(tied) <= 1
        pattern = (r'실제 가장 큰 몫과 같음\(\s*([+−-]?[\d,.]+)\s*%p' if unique_match else
                   r'가장 큰 몫:\s*' + re.escape(name or '') + r'\s*([+−-]?[\d,.]+)\s*%p')
        match = re.search(pattern, text) if name is not None else None
        checks.ok(bool(match) and abs(float(match[1].replace(',', '').replace('−', '-')) - largest['value']) <= .0051,
                  label + ' 공개한 가장 큰 몫 이름·수치=기기 기록 [12]')
    elif note.get('outageSingleShown'):
        # V3B 수정 4(V3B-fix4.md 1항): 시험·실제(또는 지난달·이번 달) 정전이 둘 다 높으면 기록은
        # '차이 원인 없음(정전 자체는 큼)', 아니면 '뚜렷한 원인 없음'이다. 어느 쪽이든 최대 몫은 없다(병합 정리).
        checks.ok(('뚜렷한 원인 없음' in text or '차이 원인 없음(정전 자체는 큼)' in text) and '가장 큰 몫' not in text,
                  label + ' 미미한 원인은 요약 연결·없는 최대 몫 생략 [12]')
    page.reload()
    page.wait_for_function(SYNC, arg=[3, 'end'])
    end_checks(checks, page, width, label + '-새로고침', missions)


def private_keys(value):
    banned = {'askReason', 'outcome', 'pred', 'compared', 'answer', 'missed',
              'operatingPlan', 'followingPlanChanged', 'resultNumbers', 'outageLargest',
              's1EvidenceValues', 's1EvidenceNeighborId', 'followingPlanBasis',
              'followingPlanConfirmedChanged', 'nowValue'}
    if isinstance(value, dict):
        return [key for key in value if key in banned] + [key for v in value.values() for key in private_keys(v)]
    if isinstance(value, list):
        return [key for v in value for key in private_keys(v)]
    return []


def host_geometry(checks, host, label):
    details = host.locator('#lg-host-details')
    if not details.evaluate('el=>el.open'):
        details.locator(':scope > summary').click()
    cards = host.locator('[data-host-card]')
    require(checks, cards.count() > 0, label + ' 도시 상세 존재 [16]')
    for i in range(cards.count()):
        card = cards.nth(i)
        if card.evaluate('el=>el.open'):
            card.locator(':scope > summary').click()
        sizes = card.evaluate("""el=>({box:el.getBoundingClientRect().height,
          title:el.querySelector('summary').getBoundingClientRect().height})""")
        checks.ok(0 <= sizes['box'] - sizes['title'] <= 16, label + ' 닫힌 도시 상세=제목 높이±여백16px [16]')
    geometry = host.evaluate("""() => {
      const r=window.__s8nCanvas(document.querySelector('#lg-mapc'));
      const names=Object.values(KCP.ECON_DATA.start).map(c=>c.name);
      const boxes=r.texts.filter(t=>names.includes(t.text));
      // 도시 이름·아래 정전 글자의 합집합이 이름표의 관찰된 경계다.
      for(const b of boxes) for(const t of r.texts.filter(t=>/^정전 /.test(t.text))) {
        if(Math.abs((b.x+b.right-t.x-t.right)/2)<2 && t.y>=b.y && t.y-b.bottom<2*(b.bottom-b.y)) {
          b.x=Math.min(b.x,t.x);b.right=Math.max(b.right,t.right);b.bottom=Math.max(b.bottom,t.bottom);
        }
      }
      return {boxes,arrows:r.arrows};
    }""")
    require(checks, len(geometry['arrows']) > 0 and len(geometry['boxes']) >= 2,
            label + ' 실제 이주 화살표·도시 이름표 계측 [16]')
    inside = [(x, y) for arrow in geometry['arrows'] for x, y in arrow
              if any(b['x'] <= x <= b['right'] and b['y'] <= y <= b['bottom'] for b in geometry['boxes'])]
    checks.ok(not inside, label + ' 모든 이주선 양 끝점은 도시 이름표 밖 [16]')
    capture(checks, host, label + '-지도')


def multiplayer(checks, context, base, width, label, pages):
    context.add_init_script(CANVAS)
    # 6도시로 이름 가림 사례를 보장한다. 기존 setup_pair의 로컬 참가 흐름 재사용.
    seed = SEED_JS.replace("['pyeongtaek', 'dangjin']",
                          "['pyeongtaek', ...KCP.leagueCore.regionOf('south').teams.map(t=>t.id).filter(id=>id!=='pyeongtaek')]")
    seed = seed.replace('const net =', 'S.rounds.length=2; const net =')
    host, team, _ = setup_pair(context, base, 12, pages, seed)
    next_phase(host, 1, 'plan')
    team.wait_for_function(SYNC, arg=[1, 'plan'])
    if shown(team, '#lg-guide-close'):
        team.locator('#lg-guide-close').click()
    require(checks, plan(team, 'lines'), label + ' 송전선만 있는 계획 적용')
    count = team.evaluate('() => KCP.buildGame.current().lines.length')
    require(checks, count > 0, label + ' 송전선 fixture 개수 > 0')
    host.wait_for_function('n=>KCP.league.state().S.teams.pyeongtaek.plan?.lines.length===n', arg=count)
    host.locator('#lg-host-details > summary').click()
    host.locator('#lg-host-card-pyeongtaek > summary').click()
    expect(host.locator('#lg-host-card-pyeongtaek')).to_contain_text(f'설비 건설 없음(송전선 {count})')
    checks.ok(True, label + ' 송전선 전용 도시 카드 정확한 수 [16]')
    trial(team)
    ready(team)
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
    next_phase(host, 1, 'review')
    team.wait_for_function(SYNC, arg=[1, 'review'])
    open_panel(team, 'result')
    before_h, before_t = host.evaluate(PUBLIC), team.evaluate(PUBLIC)
    answer(team, 'revise', REASON)
    pending_mission(checks, team, 1, label + ' 멀티 수정 응답 직후')
    team.wait_for_timeout(4500)  # 정기 공개 갱신 한 주기까지 포함한다.
    after_h, after_t = host.evaluate(PUBLIC), team.evaluate(PUBLIC)
    checks.ok(before_h == after_h and before_t == after_t, label + ' 이유·비교·판정 후 공개 상태 불변 [D-65:3,20]')
    for public in (after_h, after_t):
        checks.ok(not private_keys(public), label + ' 공개 상태에 사적 이유·판정 필드 0 [D-65]')
    surface = host.locator('body').evaluate('el=>el.outerHTML')
    checks.ok(REASON not in surface and not any(s in surface for s in ('data-answer=', 'data-compared', 'askReason', '팀별 약속 판정')),
              label + ' 숨긴 DOM·속성에도 학생 이유·판정 없음 [D-65]')
    drawer(checks, team, width, 'result', True, label + '-결과')
    drawer(checks, team, width, 'journal', True, label + '-일지')
    host_geometry(checks, host, label)
    next_phase(host, 2, 'plan')
    team.wait_for_function(SYNC, arg=[2, 'plan'])
    # 지난달 운영 계획 기록이 없는 기기(오래된 저장본) 분기. 원본은 복구한다.
    stored = team.evaluate("""() => {const l=KCP.league.state(),key=`kcp-league-data-v1:${l.room}:${l.team}`;
      const raw=localStorage.getItem(key),d=JSON.parse(raw);delete d.interview.months[1].operatingPlan;
      localStorage.setItem(key,JSON.stringify(d));return {key,raw};}""")
    team.reload()
    team.wait_for_function(SYNC, arg=[2, 'plan'])
    ready(team, submit=False)
    if not team.locator('#lg-plan-followup').evaluate('el => el.tagName !== "DETAILS" || el.open'):
        team.locator('#lg-plan-followup > summary').click()  # 품질8 UX ②: 접힌 지난달 기록을 펼쳐 확인
    checks.ok(team.locator('#lg-actual-change').inner_text() == '지난달 계획 기록 없음', label + ' 없는 기기 계획 추측 금지 [10]')
    mission_status(checks, team, '지난달 운영 기록이 이 기기에 없어 판정하지 않아요',
                   label + ' 운영 기록 없음', '#lg-previous-mission')
    confirmed_plan(checks, team, 1, None, None, label + ' 운영 기록 없음')
    # 옛 형식은 세 필드 모두 없는 저장본. 원본의 나머지 약속 입력은 보존한다.
    team.evaluate("""({key,raw}) => {const d=JSON.parse(raw),n=d.interview.months[1];
      for(const k of ['operatingPlan','followingPlanChanged','resultNumbers']) delete n[k];
      localStorage.setItem(key,JSON.stringify(d));}""", stored)
    team.reload()
    team.wait_for_function(SYNC, arg=[2, 'plan'])
    ready(team, submit=False)
    mission_status(checks, team, '옛 기준 기록이라 판정하지 않아요',
                   label + ' 옛 형식', '#lg-previous-mission')
    checks.ok(all(k not in learning_note(team, 1) for k in
                  ('operatingPlan', 'followingPlanChanged', 'resultNumbers')),
              label + ' 옛 형식 미리보기가 확정 필드를 만들지 않음 [V3A-fix4]')
    team.evaluate('({key,raw})=>localStorage.setItem(key,raw)', stored)
    team.reload()
    team.wait_for_function(SYNC, arg=[2, 'plan'])
    ready(team, submit=False)
    mission_status(checks, team, '아직 바꾸지 않았어요', label + ' 멀티 수정 약속·변경 없음',
                   '#lg-previous-mission', preview=True)
    checks.ok('말과 실제 변경이 달라요' not in team.locator('#lg-plan-followup').inner_text(),
              label + ' 멀티 계획 시작 직후 어긋남 단정 없음 [V3A-fix2]')
    checks.ok(learning_note(team, 1).get('followingPlanChanged', 'missing') is None,
              label + ' 멀티 준비 전 판정 미확정 [V3A-fix2]')
    confirmed_plan(checks, team, 1, None, None, label + ' 멀티 계획')
    team.wait_for_timeout(4500)
    for public in (host.evaluate(PUBLIC), team.evaluate(PUBLIC)):
        checks.ok(not private_keys(public), label + ' 다음 달 미리보기 뒤 공개 사적 필드 0 [D-65]')
    checks.ok(REASON not in host.locator('body').evaluate('el => el.outerHTML'),
              label + ' 다음 달 미리보기 뒤 진행자 DOM에 학생 이유 없음 [D-65]')
    ready(team)
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => KCP.league.state().snap.teams.pyeongtaek.ready')
    checks.ok(learning_note(team, 1).get('followingPlanChanged') is False,
              label + ' 멀티 준비 때 변경 없음 확정 저장 [V3A-fix2]')
    confirmed_plan(checks, team, 1, False, 'ready', label + ' 멀티 준비')
    promise_keys = ('evidence', 'pred', 'confidence', 'topic', 'decision')
    promise = {k: learning_note(team, 2).get(k) for k in promise_keys}
    require(checks, all(promise[k] for k in ('evidence', 'pred', 'confidence', 'topic')),
            label + ' 재준비 검사 전 약속 입력 존재')
    close_drawer(team)
    team.locator('#lg-ready').click()
    checks.ok(not shown(team, '#lg-panel'), label + ' 준비 해제 직후 서랍 자동 열림 없음 [V3A-fix4]')
    host.wait_for_function('() => !KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => !KCP.league.state().snap.teams.pyeongtaek.ready')
    confirmed_plan(checks, team, 1, None, None, label + ' 멀티 준비 해제')
    checks.ok(not shown(team, '#lg-panel'), label + ' 해제 스냅 뒤 서랍 숨김 [V3A-fix4]')
    checks.ok({k: learning_note(team, 2).get(k) for k in promise_keys} == promise,
              label + ' 준비 해제 뒤 약속 입력 유지 [V3A-fix4]')
    team.locator('#lg-ready').click()  # ready()로 입력을 다시 채우면 회귀를 숨긴다.
    checks.ok(not shown(team, '#lg-panel'), label + ' 재준비 직후 서랍 자동 열림 없음 [V3A-fix4]')
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => KCP.league.state().snap.teams.pyeongtaek.ready')
    checks.ok(not shown(team, '#lg-panel'), label + ' 재준비 스냅 뒤 서랍 숨김 [V3A-fix4]')
    confirmed_plan(checks, team, 1, False, 'ready', label + ' 입력 없이 재준비')
    open_panel(team, 'journal')
    checks.ok({k: learning_note(team, 2).get(k) for k in promise_keys} == promise,
              label + ' 재준비·서랍 수동 열기 뒤 약속 입력 유지 [V3A-fix4]')
    checks.ok(team.locator(f'[data-evidence="{promise["evidence"]["key"]}"]').get_attribute('aria-pressed') == 'true'
              and team.locator(f'[data-pred="{promise["topic"]}"]').input_value() == promise['pred'][promise['topic']]
              and team.locator(f'[data-confidence="{promise["confidence"]}"]').get_attribute('aria-pressed') == 'true',
              label + ' 재준비 뒤 실제 근거·방향·확신 선택 표시 유지 [V3A-fix4]')
    close_drawer(team)
    team.locator('#lg-ready').click()
    host.wait_for_function('() => !KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => !KCP.league.state().snap.teams.pyeongtaek.ready')
    confirmed_plan(checks, team, 1, None, None, label + ' 재준비 후 다시 해제')
    require(checks, plan(team, 'add'), label + ' 준비 해제 뒤 실제 설비 추가')
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.plan.builds.length===1')
    confirmed_plan(checks, team, 1, None, None, label + ' 해제 뒤 수정·재준비 전')
    ready(team)
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => KCP.league.state().snap.teams.pyeongtaek.ready')
    confirmed_plan(checks, team, 1, True, 'ready', label + ' 해제 뒤 수정·재준비 확정 [V3A-fix4]')
    # 진행자가 준비 없이 운영한 경우의 기존 result 재확정 검사도 유지한다.
    close_drawer(team)
    team.locator('#lg-ready').click()
    host.wait_for_function('() => !KCP.league.state().S.teams.pyeongtaek.ready')
    team.wait_for_function('() => !KCP.league.state().snap.teams.pyeongtaek.ready')
    confirmed_plan(checks, team, 1, None, None, label + ' 수정 확정 뒤 다시 해제')
    next_phase(host, 2, 'review')
    team.wait_for_function(SYNC, arg=[2, 'review'])
    confirmed_plan(checks, team, 1, True, 'result', label + ' 진행자 넘김 실제 운영으로 재확정')
    operated = learning_note(team, 2)['operatingPlan']
    checks.ok(len(operated['builds']) == 1,
              label + ' 준비 뒤 바꾼 설비가 실제 운영 기록에 있음 [V3A-fix3]')
    answer(team, 'keep', '현금 결과를 확인하여 유지한다')
    pending_mission(checks, team, 2, label + ' 멀티 마지막 달', final=True)
    next_phase(host, 2, 'end')
    team.wait_for_function(SYNC, arg=[2, 'end'])
    end_checks(checks, team, width, label + '-팀',
               {1: (True, '달성'), 2: (None, '마지막 달이라 판정 없음')})
    checks.ok(host.locator('#lg-y2022-host').evaluate("""el=>{
      const cards=document.querySelector('#lg-debrief .lg-debriefcards');
      return !!cards && (cards.nextElementSibling===el || cards.nextElementSibling?.contains(el));
    }"""), label + ' 2022 링크는 디브리핑 질문 바로 뒤 [15]')
    open_panel(team, 'rank')
    masked = team.locator('#lg-rank [data-team]').filter(has_text='이름 가림')
    require(checks, masked.count() > 0, label + ' 이름 가린 순위 실제 사례 [15]')
    scores = host.evaluate(PUBLIC)['econ']['score']['by']
    for i in range(masked.count()):
        row = masked.nth(i)
        match = re.search(r'(\d+)위\s*([\d,.]+)점\s*\(이름 가림\)', row.inner_text())
        require(checks, bool(match), label + ' 이름 가린 순위에 점수 [15]')
        actual = scores[row.get_attribute('data-team')]
        checks.ok(int(match[1]) == actual['rank'] and abs(float(match[2].replace(',', '')) - actual['score']) <= .051,
                  label + ' 가린 점수=공개 점수(소수1자리) [15]')
    checks.ok(team.locator('#lg-rank').evaluate("""el=>![...el.querySelectorAll('h3,h4')].some(h=>
      /CBAM/.test(h.textContent) && !h.parentElement.textContent.replace(h.textContent,'').trim())"""),
              label + ' 내용 없는 CBAM 제목 없음 [15]')
    checks.ok(not private_keys(host.evaluate(PUBLIC)) and REASON not in host.locator('body').evaluate('el=>el.outerHTML'),
              label + ' 끝에서도 사적 이유·판정 비전송 [D-65]')
    capture(checks, team, label + '-순위')
    capture(checks, host, label + '-진행자끝')


def worksheet_mission(checks, page, month, expected, label):
    """공개된 복사 버튼으로 확정 문구를 읽는다. 판정 함수를 직접 호출하지 않는다."""
    open_panel(page, 'journal')
    page.evaluate("""() => {
      window.__s8nCopy=null;
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async text=>{window.__s8nCopy=text;}}});
    }""")
    page.locator('#lg-jcopy').click()
    page.wait_for_function('() => window.__s8nCopy !== null')
    rd = page.evaluate(STATE)['rounds'][month - 1]
    sections = page.evaluate('window.__s8nCopy').split(f"■ {rd['year']}년 {rd['month']}월", 1)
    section = sections[1].split('■ ', 1)[0] if len(sections) == 2 else ''
    match = re.search(r'학습 미션\s+([^\n]+)', section)
    actual = match[1].strip() if match else ''
    checks.ok(actual == expected, label + f' 확정 판정 {expected} (실제: {actual})')
    checks.ok('지금 계획 기준' not in section, label + ' 확정 문구에 미리보기 표지 없음')


def verdict_matrix(checks, context, base, width, label, pages):
    # 수정 3 last.md의 7행. 기대 문구는 표에서 직접 옮긴 상수다.
    cases = [
        ('유지·인용·불변', 'keep', '정전 결과를 확인하여 유지한다', False, True,
         '달성', '달성'),
        ('유지·인용 없음·불변', 'keep', REASON, False, True,
         '미달성 예정 · 지난달 유지 이유에 결과 숫자나 원인이 없었어요(다음엔 넣어요)', '미달성'),  # 총괄 10-23 아르곤 문구(UX 갈래)
        ('유지·변경', 'keep', '정전 결과를 확인하여 유지한다', True, True,
         '말과 지금 계획이 달라요 — 유지하겠다고 했어요', '미달성 · 말과 실제 변경이 달라요'),
        ('수정·불변', 'revise', REASON, False, True,
         '아직 바꾸지 않았어요', '미달성 · 말과 실제 변경이 달라요'),
        ('수정·변경', 'revise', REASON, True, True, '달성', '달성'),
        ('답 미선택', None, '정전 결과를 확인했다', False, True,
         '미달성 예정 · 지난달 유지·수정 답을 고르지 않았어요', '미달성'),
        ('필수 비교 부족', 'keep', '정전 결과를 확인하여 유지한다', False, False,
         '미달성 예정 · 지난달 근거·예측·비교·이유 기록이 부족해요', '미달성'),
    ]
    seed = SEED_JS.replace('const net =', 'S.rounds.length=8; const net =')
    host, team, _ = setup_pair(context, base, 12, pages, seed)
    next_phase(host, 1, 'plan')
    team.wait_for_function(SYNC, arg=[1, 'plan'])
    if shown(team, '#lg-guide-close'):
        team.locator('#lg-guide-close').click()
    require(checks, plan(team, 'empty'), label + ' 판정 표 빈 시작 계획')
    ready(team)
    host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
    next_phase(host, 1, 'review')
    team.wait_for_function(SYNC, arg=[1, 'review'])
    for month, (name, choice, reason, changed, compared, preview, final) in enumerate(cases, 1):
        case_label = label + ' ' + name
        open_panel(team, 'result')
        if choice:
            answer(team, choice, reason)
        else:
            team.locator('[data-compared]').check()
            team.locator('[data-note="askReason"]').fill(reason)
            team.locator('[data-note="askReason"]').press('Tab')
            require(checks, not learning_note(team, month).get('answer'), case_label + ' 답 미선택 fixture')
        if not compared:
            team.locator('[data-compared]').uncheck()
            require(checks, not learning_note(team, month).get('compared'), case_label + ' 비교 미완료 fixture')
        next_phase(host, month + 1, 'plan')
        team.wait_for_function(SYNC, arg=[month + 1, 'plan'])
        if changed:
            require(checks, plan(team, 'add'), case_label + ' 실제 설비 추가')
        before_preview = learning_note(team, month)
        ready(team, submit=False)
        mission_status(checks, team, preview, case_label,
                       '#lg-previous-mission', preview=True)
        confirmed_plan(checks, team, month, None, None, case_label + ' 미리보기')
        checks.ok(learning_note(team, month) == before_preview,
                  case_label + ' 정상 비교 미리보기는 지난달 저장값 불변 [V3A-fix4]')
        ready(team)
        host.wait_for_function('() => KCP.league.state().S.teams.pyeongtaek.ready')
        # ack → 스냅 사이의 그리기는 v3a-ready.js에서 순서를 고정해 검사한다.
        team.wait_for_function('() => KCP.league.state().snap.teams.pyeongtaek.ready')
        confirmed_plan(checks, team, month, changed, 'ready', case_label + ' 준비 뒤')
        worksheet_mission(checks, team, month, final, case_label + ' 준비 뒤')
        next_phase(host, month + 1, 'review')
        team.wait_for_function(SYNC, arg=[month + 1, 'review'])
        confirmed_plan(checks, team, month, changed, 'result', case_label + ' 운영 뒤')
        worksheet_mission(checks, team, month, final, case_label + ' 운영 뒤')


def main():
    checks = Checks()
    base = local_address(sys.argv)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height, scheme in ((1280, 900, 'light'), (1180, 820, 'light'), (390, 844, 'dark')):
            for mode, scenario in (('solo', solo), ('multi', multiplayer), ('verdicts', verdict_matrix)):
                label = f'{width}x{height}-{scheme}-{mode}'
                context, external = context_for(browser, base, width, height, scheme)
                pages = []
                try:
                    scenario(checks, context, base, width, label, pages)
                except Exception as exc:
                    checks.ok(False, f'{label} {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
                    for page, _, role in pages:
                        screenshot(checks, page, f's8n-{label}-{role}-failure.png')
                finally:
                    for page, events, role in pages:
                        diagnostics(checks, events, label + '-' + role)
                        overflow(checks, page, label + '-' + role)
                    checks.ok(not external, label + ' 외부 연결 시도 0')
                    context.close()
        browser.close()
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
