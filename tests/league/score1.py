"""지시서 T F1~F13 화면 계약. 작성 세션은 실행하지 않고 py_compile만 수행한다.

실행 담당자: tests/.venv/bin/python tests/league/score1.py <loopback index.html 주소>
1280×900, 1024×768, 390×844. 도시/설비 이름과 사건은 자료/기존 씨앗에서만 읽는다.
F4 이름 목록 경계, F6 예산/규칙 후보/1600ms, F3 숫자·옛 기록, F13 자릿수 경계는
score1-node.js와 d82ux-node.js에서 합성 입력으로 검사한다. 해당 경계는 화면에서
예산·달력·후보 수를 동시에 조작해야 하므로 단위 검사로 분리했다.
"""

import json
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from econui import (BOOT_JS, Checks, advance, context_for, diagnostics, local_address,
                    mission_status, monitored_page, open_panel, overflow, setup_pair, shown)
from league_flow import finish_trial, pass_issue_check, wait_unfolded
from fx_event import restore_fixture, seeded_fixtures
from s8n import answer, ready
from solo import click_next, close_drawer, read


SCENES = ('근거 하나', '자리 판단', '자리 판단', '시험 1주', '약속',
          '예측 대 실제', '원인 하나', '다음 달')
UNCITED = '미달성 예정 · 지난달 유지 이유에 결과 숫자나 원인이 없었어요(다음엔 넣어요)'


def require(checks, condition, name):
    if not checks.ok(condition, name):
        raise AssertionError(name)


def frames(page):
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def inside(inner, outer, tolerance=1):
    return (bool(inner) and bool(outer) and inner['width'] > 0 and inner['height'] > 0 and
            inner['x'] >= outer['x'] - tolerance and inner['y'] >= outer['y'] - tolerance and
            inner['x'] + inner['width'] <= outer['x'] + outer['width'] + tolerance and
            inner['y'] + inner['height'] <= outer['y'] + outer['height'] + tolerance)


def area(page, left, right):
    return page.evaluate("""([left,right]) => {
      const a=document.querySelector(left), b=document.querySelector(right);
      if(!a || !b) throw Error('교차 검사 대상 없음: '+left+' / '+right);
      const x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
      return Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*
        Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
    }""", [left, right])


def arm_review(page):
    # F5 결과 직후를 Python 왕복 전에 관찰한다. 검사용 관찰자만 추가하며 상태는 바꾸지 않는다.
    page.evaluate("""() => {
      window.__score1FirstReview=null;
      const probe=()=>{
        const root=document.querySelector('#bd-root');
        if(root?.dataset.lgPhase==='review') {
          const a=document.querySelector('#lg-map-result'), b=document.querySelector('#bd-run');
          if(a && b) {
            const x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
            // 재생 중 내내 재생 패널과 하단 도구줄의 최대 교차를 기록한다(독립 검토 major 2).
            const dd=document.querySelector('#bd-dock')?.getBoundingClientRect();
            if(dd && !b.hidden && y.width>0 && y.height>0) window.__score1DockMax=Math.max(window.__score1DockMax||0,
              Math.max(0,Math.min(dd.right,y.right)-Math.max(dd.left,y.left))*Math.max(0,Math.min(dd.bottom,y.bottom)-Math.max(dd.top,y.top)));
            // F5는 결과 요약이 실제로 표시된 첫 순간을 검사한다(재생 중 visibility:hidden이면 아직 표시 전).
            if(!(x.width > 0 && x.height > 0) || getComputedStyle(a).visibility === 'hidden') return;
            // 독립 검토 major 2: 재생 패널이 하단 도구줄(#bd-dock)로 자리만 옮겨 덮지 않는지도 같은 순간에 잰다.
            const d=document.querySelector('#bd-dock')?.getBoundingClientRect();
            const runShown=!b.hidden && y.width>0 && y.height>0;
            window.__score1FirstReview={area:Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*
              Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)),mapHeight:x.height,
              runShown, dockArea: d && runShown ? Math.max(0,Math.min(d.right,y.right)-Math.max(d.left,y.left))*
              Math.max(0,Math.min(d.bottom,y.bottom)-Math.max(d.top,y.top)) : 0};
            observer.disconnect();
          }
        }
      };
      const observer=new MutationObserver(probe);
      observer.observe(document,{attributes:true,childList:true,subtree:true});
      probe();
      const B=KCP.buildGame, original=B.setViewInset;
      window.__score1Insets=[];
      window.__score1InsetAPI=typeof original==='function';
      if(typeof original==='function') B.setViewInset=function(value) {
        window.__score1Insets.push({...value});
        return original.apply(this,arguments);
      };
    }""")


def first_result(checks, page, tested, label, width):
    page.wait_for_selector('#bd-root[data-lg-phase="review"]')
    page.wait_for_function("() => !document.documentElement.classList.contains('bd-running')")
    wait_unfolded(page)
    frames(page)
    if width == 390:
        # 지시서 T 4번: 서랍을 다시 열기 전에 미리 기록한 첫 표시 프레임을 판정한다.
        try:
            page.wait_for_function('() => !!window.__score1ResultNotice', timeout=5000)
        except PlaywrightTimeoutError:
            pass  # 아래 단언에서 표본 없음 자체를 이름 있는 실패로 기록한다.
        notice = page.evaluate('window.__score1ResultNotice')
        if checks.ok(bool(notice) and len(notice['areas']) == 3,
                     label + ' T4 390 첫 결과 알림 표시 프레임 확보'):
            for target, overlap in zip(('결과 렌즈', '접기', '×'), notice['areas']):
                # 지시서 T 4번: 대상이 없거나 안 보이면 교차 0으로 처리하지 않고 실패한다.
                checks.ok(overlap == 0, label + f' T4 390 결과 알림/{target} 교차 0')
    if width == 1024:
        page.wait_for_function('() => !!window.__score1FirstReview')
        first = page.evaluate('window.__score1FirstReview')
        checks.ok(first['mapHeight'] > 0 and first['area'] == 0,
                  label + ' F5 결과 직후 지도 요약/재생 패널 교차 0')
        checks.ok(first.get('dockArea', 0) == 0 and (page.evaluate('window.__score1DockMax||0') == 0),
                  label + f" F5 결과 직후 재생 패널/하단 도구줄 교차 0 (재생 패널 표시 {first.get('runShown')})")
    open_panel(page, 'result')
    checks.ok(area(page, '#lg-map-result', '#bd-run') == 0,
              label + ' F5 결과 서랍 지도 요약/재생 패널 교차 0')
    # F5(나) '비교했어요' 이동은 적용하지 않았다(측정상 스크롤 수 증가, score1 갈래 보고) — 단언 없음.
    styles = page.evaluate("""() => {
      const r=getComputedStyle(document.querySelector('#lg-ready'));
      return {ready:r.backgroundColor, trials:[...document.querySelectorAll('.bd-go[data-run]')].map(n=>{
        const s=getComputedStyle(n);return {image:s.backgroundImage,shadow:s.boxShadow};})};
    }""")
    checks.ok(styles['ready'] == 'rgb(236, 208, 131)', label + ' F2 결과 주 동작 금색')
    checks.ok(bool(styles['trials']) and all(t['image'] == 'none' and t['shadow'] == 'none'
              for t in styles['trials']), label + ' F2 결과 시험 단추 그라데이션/그림자 없음')
    cells = page.locator('#lg-result-deltas > div').evaluate_all("""nodes => nodes.map(n=>({
      title:n.querySelector('dt')?.textContent, small:n.querySelector('small')?.textContent}))""")
    # rev11 R5: 생산/소비는 CO₂ 접두 뒤에 붙인다.
    headings = ('정전(이번 달)', '정전 시간(이번 달)', 'CO₂ 생산(이번 달)')
    basis = '시험 1주 대비' if tested['days'] == 7 else f"시험 {tested['days']}일 대비"
    checks.ok(all(sum(c['title'] == h for c in cells) == 1 for h in headings) and
              all(next(c for c in cells if c['title'] == h)['small'].startswith(basis) for h in headings),
              label + ' F3 첫 결과 세 기준 이름 일치/생산 CO₂ 이름')
    # co2(소비)만 있는 옛 시험과 신규 co2Prod 기준은 Node에서 별도 검산한다.
    require(checks, isinstance(tested.get('co2Prod'), (int, float)),
            label + ' F3 새 시험 기록은 생산 co2Prod 보존')
    if width == 1280:
        checks.ok(page.evaluate('window.__score1InsetAPI === true') and page.evaluate(
            'window.__score1Insets.some(v => Number.isFinite(v.right) && v.right > 0)'),
            label + ' F10 공개 setViewInset을 결과 서랍 열기에 호출')
        # 공개 API에 변환 뒤 viewport 경계 조회 함수가 없으므로 T 허용 대안인 존재/호출로 판정.
        # 사설 변수/그리기 수식에서 기대 좌표를 복제하지 않는다.
        # 지시서 T 5번: F12 월별 추이 축은 글자가 생기는 fx_end.py graphs()로 옮겼다.
    open_panel(page, 'rank')
    page.emulate_media(media='print')
    try:
        colors = page.locator('#lg-rank').evaluate("""el => {
          const s=getComputedStyle(el); return [s.backgroundColor,s.color];
        }""")
        checks.ok(colors == ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
                  label + ' F12 인쇄 순위 카드 흰 바탕/검은 글자')
    finally:
        page.emulate_media(media='screen')
    overflow(checks, page, label + ' 결과')


def grant(checks, page, before, label, width):
    close_drawer(page)
    frames(page)
    value = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.S||L.snap, C=KCP.leagueCore;
      return C.grantOf(V,C.regionOf(V.region),L.team,KCP.buildGame).left;
    }""")
    require(checks, value > 0, label + ' F1 자연 교부세 달 확보')
    # spec-C §M2: 우리 도시의 당월 교부세 사건에 repairParam이 있을 때만 보수비 꼬리.
    repair = page.evaluate('''() => {
      const L=KCP.league.state(), V=L.S||L.snap, C=KCP.leagueCore, R=C.regionOf(V.region);
      return (V.events||[]).some(ev => ev.round===V.round &&
        C.eventDef(R,ev.id)?.repairParam && C.grantAmount({...V,events:[ev]},R,L.team,V.round)>0);
    }''')
    tail = '(새 설비·선로·재난 대응, 남으면 보수비)' if repair else '(새 설비·선로·재난 대응, 남으면 사라져요)'
    text = f'이번 달 특별교부세 {value:g}억{tail}'
    chip = page.locator('[data-cap="budget"] [data-grant-chip]')
    if width <= 760:
        after = page.locator('#lg-bar').bounding_box()
        checks.ok(before == after, label + ' F1 390 교부세 유무 막대 사각형 불변')
        # 지시서 T 1번: 좁은 화면의 셋째 줄은 칩 안에 보이며, 금액은 독립 공개 잔액이다.
        require(checks, chip.count() == 1 and chip.is_visible(), label + ' F1b 390 교부세 셋째 줄 표시')
        checks.ok(chip.inner_text() == f'+{value:g}억 전용', label + ' F1b 390 교부세 셋째 줄 확정 문구')
        money = page.locator('[data-cap="budget"]').bounding_box()
        checks.ok(inside(chip.bounding_box(), money), label + ' F1b 셋째 줄 사각형은 남은 돈 칩 안(1px 허용)')
        tip = page.locator('details.lg-info.lg-money-info')
        require(checks, tip.count() == 1 and tip.is_visible(), label + ' F1 남은 돈 옆 설명')
        # 지시서 T 1번: DOM의 바로 다음 형제이며 키보드 Tab도 한 번만 이동한다.
        checks.ok(page.locator('[data-cap="budget"]').evaluate(
            "el => el.nextElementSibling?.matches('details.lg-info.lg-money-info') === true"),
            label + ' F1b !은 남은 돈 칩 바로 다음 형제')
        page.locator('[data-cap="budget"]').focus()
        # 지시서 T 1번: Tab 출발점이 실제로 칩인지 확인해 잘못된 포커스의 우연한 통과를 막는다.
        require(checks, page.locator('[data-cap="budget"]').evaluate('el => el === document.activeElement'),
                label + ' F1b 남은 돈 칩 포커스 가능')
        page.keyboard.press('Tab')
        checks.ok(tip.locator(':scope > summary').evaluate('el => el === document.activeElement'),
                  label + ' F1b 남은 돈 칩에서 Tab 한 번이면 ! summary')
        # rev16 #71-2: ! 글자를 summary 가상 요소로 그리는 방식도 허용한다.
        checks.ok(tip.locator(':scope > summary').evaluate('''e => e.textContent.trim()==='!' ||
          ['::before','::after'].some(p=>getComputedStyle(e,p).content.replace(/["']/g,'')==='!')'''),
                  label + ' F1 설명 summary !')
        tip.locator(':scope > summary').click()
        # 지시서 T 1번: 좁은 화면 설명은 용도 제한과 소멸을 포함한 문장 그대로다(문구는 아르곤 2차 확정안).
        # rev14 M2: 보수비 사건이 없는 재난 달(한파 등)은 보수비를 말하지 않는 갈래(textNoRepair, 아르곤 확정안)다.
        # 갈래는 위의 독립 판정 repair로 고르고, 구현 함수와의 일치는 따로 단언한다.
        checks.ok(page.evaluate('() => KCP.league.grantHasRepair()') == repair, label + ' F1 보수비 갈래 판정 일치')
        explanation = (f'남은 특별교부세 {value:g}억은 새 설비·선로·재난 대응에 써요. 계획에 쓰고 남은 돈은 이달 말 재난 보수비에 먼저 쓰이고, 그래도 남으면 사라져요.'
                       if repair else f'남은 특별교부세 {value:g}억은 새 설비·선로·재난 대응에 써요. 계획에 쓰고 남은 돈은 이달 말에 사라져요.')
        pop = tip.locator('.lg-info-pop')
        checks.ok(explanation == pop.inner_text(), label + ' F1 설명 확정 교부세 문구')
        # 지시서 T 1번: 설명 상자 전체가 viewport 안에 보인다(경계 오차 없음).
        checks.ok(pop.is_visible() and inside(pop.bounding_box(),
                  {'x': 0, 'y': 0, **page.viewport_size}, tolerance=0),
                  label + ' F1b ! 설명 상자 전체가 화면 안')
        # 독립 검토(묶음 2) blocker 1: is_visible은 가림을 보지 않는다. 상자 안 격자점에서 맨 위 요소가 상자 자신인지 잰다.
        covered = pop.evaluate("""el => { const r=el.getBoundingClientRect(); let hit=0, all=0;
          for (let i=1;i<10;i++) for (let j=1;j<5;j++) { all++; const n=document.elementFromPoint(r.left+r.width*i/10, r.top+r.height*j/5);
            if (n && (n===el || el.contains(n))) hit++; } return [hit, all]; }""")
        checks.ok(covered[0] == covered[1], label + f' F1b ! 설명 상자가 다른 요소에 가리지 않음({covered[0]}/{covered[1]})')
        money = page.locator('[data-cap="budget"]').bounding_box()
        summary = tip.locator(':scope > summary').bounding_box()
        # 지시서 T 1번: 기존 누름 영역 위치 검사를 x·y 중심점 기준으로 바로잡는다.
        checks.ok(bool(money) and bool(summary) and
                  money['x'] <= summary['x'] + summary['width']/2 <= money['x'] + money['width'] and
                  # 묶음 2(F1b): 셋째 줄 때문에 금액 줄이 올라와 누름 영역 가운데를 칩 위끝 3px 위까지 허용한다.
                  # rev16 #71: 칩 전체와 일치·44×44·화면 안 계약은 아래 단언이 지킨다.
                  money['y'] - 4 <= summary['y'] + summary['height']/2 <= money['y'] + money['height'],
                  label + ' F1 !은 남은 돈 칩 옆')
        # rev16 #71-1·6: 칩 전체가 누름 영역. 금액과 교차 0/화면 안 높이 30 계약을 대체한다.
        checks.ok(summary['height'] >= 44 and summary['width'] >= 44 and
                  inside(summary, {'x': 0, 'y': 0, **page.viewport_size}, tolerance=0),
                  label + ' F1b ! 누름 영역 전체 화면 안 ≥44×44px')
        checks.ok(all(abs(summary[k] - money[k]) <= 1 for k in ('x', 'y', 'width', 'height')),
                  label + ' F1 ! 누름 영역이 남은 돈 칩을 덮음(1px)')
        tip.locator(':scope > summary').click()
    else:
        checks.ok(text in page.locator('[data-cap="budget"] .lg-grant-note').inner_text(),
                  label + ' F1 760px 초과 칩 주석 유지')
        # 지시서 T 1번: 넓은 화면은 기존 주석을 쓰며 셋째 줄 칩은 숨긴다.
        checks.ok(not shown(page, '[data-grant-chip]'), label + ' F1b 760px 초과 교부세 셋째 줄 숨김')
    overflow(checks, page, label + ' 교부세 달')


def forecast(checks, page, label, width):
    page.wait_for_function('() => KCP.fxTurn?.state?.().forecastOpen === true')
    frames(page)
    cards = page.locator('.fx-turn-cards article[data-forecast="true"]')
    require(checks, cards.count() > 0, label + ' F9 2월 예보 카드 확보')
    if width == 1280:
        # Python 왕복 중 짧은 알림이 사라져 공허한 교차 0이 되지 않도록 미리 수집한 실제 프레임.
        page.wait_for_function('() => !!window.__score1PlanAreas')
        overlaps = page.evaluate('window.__score1PlanAreas')
        checks.ok(bool(overlaps) and all(x == 0 for x in overlaps), label + ' F9 2월 알림/예보 교차 0')
    for i in range(cards.count()):
        h = cards.nth(i).locator('h3')
        checks.ok(h.locator('span.bd-event-icon[aria-hidden="true"]').count() == 1 and
                  h.locator('span:not(.bd-event-icon)').count() == 1,
                  label + ' F9 예보 h3 기호/제목 span')


def arm_plan_notice(page):
    page.evaluate("""() => {
      window.__score1PlanAreas=null;
      const sample=()=>{
        const L=KCP.league.state(), V=L.S||L.snap, t=document.querySelector('#bd-toast');
        const cards=[...document.querySelectorAll('.fx-turn-cards article[data-forecast="true"]')];
        const visible=n=>n?.checkVisibility({opacityProperty:true,visibilityProperty:true}) &&
          n.getBoundingClientRect().width>0 && n.getBoundingClientRect().height>0;
        if(V.round===2 && V.phase==='plan' && visible(t) && cards.length &&
          cards.every(c=>visible(c) && Number(getComputedStyle(c).opacity)===1)) {
          const x=t.getBoundingClientRect();
          window.__score1PlanAreas=cards.map(c=>{
            const y=c.getBoundingClientRect();
            return Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*
              Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
          });
        } else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }""")


def arm_result_notice(page):
    # 지시서 T 4번: 준비 전에 설치해 알림이 실제로 보이는 첫 rAF 표본만 보존한다.
    page.evaluate("""() => {
      window.__score1ResultNotice=null;
      const visible=n=>n && !n.hidden &&
        n.checkVisibility({opacityProperty:true,visibilityProperty:true}) &&
        n.getBoundingClientRect().width>0 && n.getBoundingClientRect().height>0;
      const sample=()=>{
        const L=KCP.league.state(), V=L.S||L.snap;
        const t=document.querySelector('#bd-toast'), p=document.querySelector('#lg-panel');
        if(V.round===1 && V.phase==='review' && visible(p) && p.dataset.tab==='result' &&
          p.dataset.folded==='false' && visible(p.querySelector('.lg-pbody')) &&
          visible(t) && Number(getComputedStyle(t).opacity)===1) {
          const x=t.getBoundingClientRect();
          const selectors=['[data-lens="result"]', '#lg-panel .lg-ptabs #lg-panel-fold',
            '#lg-panel .lg-ptabs [data-pclose]'];
          window.__score1ResultNotice={areas:selectors.map(selector=>{
            const n=document.querySelector(selector);
            if(!visible(n)) return null;
            const y=n.getBoundingClientRect();
            return Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*
              Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
          })};
        } else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }""")


def solo_case(checks, context, base, fixture, width, pages):
    label = f'{width} score1'
    page, events = monitored_page(context)
    pages.append((events, label))
    restore_fixture(checks, page, base, label, fixture)
    # 코치의 전체 8장면·3단계 목록은 Node/ux_coach가 담당한다.
    coach = page.locator('#lg-coach')
    if coach.count():
        step = int(coach.get_attribute('data-step'))
        checks.ok(page.locator('#lg-coach-task').inner_text().startswith(f'{SCENES[step-1]} · {step}/8 '),
                  label + ' F4 첫 코치 장면 이름/순서')
        page.locator('#lg-coach-close').click()
    close_drawer(page)
    before = page.locator('#lg-bar').bounding_box()
    checks.ok(not shown(page, '.lg-money-info'), label + ' F1 교부세 없는 1월 설명 없음')
    # 지시서 T 1번: 교부세 없는 1월은 셋째 줄도 보이지 않아야 한다.
    checks.ok(not shown(page, '[data-grant-chip]'), label + ' F1b 교부세 없는 1월 셋째 줄 숨김')
    overflow(checks, page, label + ' 첫 계획')
    page.locator('[data-run="7"]').click()
    tested = finish_trial(page)
    page.locator('#bd-drawer-x').click()
    arm_review(page)
    if width == 390:
        arm_result_notice(page)
    ready(page)
    first_result(checks, page, tested, label, width)
    # 다음 달 계획에 지난달 이유를 고치라고 요구하지 않는 uncited 계약.
    answer(page, 'keep', '유지해요')
    page.wait_for_timeout(400)  # 저장 debounce 250ms; tests.md의 400ms 경계.
    state = read(page)['S']
    if width == 1280:
        arm_plan_notice(page)
    click_next(page, state)
    page.wait_for_function("() => KCP.league.state().S.round===2 && KCP.league.state().S.phase==='plan'")
    forecast(checks, page, label, width)
    # 예보 기호를 먼저 검사한 뒤 알림/카드 닫힘이 HUD 측정에 끼지 않게 실제 닫기 조작.
    page.keyboard.press('Escape')
    grant(checks, page, before, label, width)
    ready(page, submit=False)  # 지난달 미션은 다음 달 약속 카드의 계획 미리보기에서 읽는다.
    mission = page.locator('#lg-previous-mission')
    require(checks, mission.count() == 1, label + ' F13 지난달 미션 존재')
    mission_status(checks, page, UNCITED, label + ' F13 uncited 확정 문구', '#lg-previous-mission', preview=True)
    overflow(checks, page, label + ' 다음 달')


def ready_during_trial_case(checks, context, base, fixture, width, pages):
    label = f'{width} score1 재생 중 준비'
    page, events = monitored_page(context)
    pages.append((events, label))
    restore_fixture(checks, page, base, label, fixture)
    if shown(page, '#lg-coach'):
        page.locator('#lg-coach-close').click()
    close_drawer(page)
    # 지시서 T 2번: 실제 시험/준비 단추를 연속 클릭하며 재생 종료나 결과를 기다리지 않는다.
    require(checks, page.locator('[data-run="7"]').is_visible() and
            page.locator('[data-run="7"]').is_enabled() and
            page.locator('#lg-ready').is_visible() and page.locator('#lg-ready').is_enabled(),
            label + ' T2 시험·준비 단추 조작 가능')
    immediate = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.S||L.snap, calendar=KCP.leagueCore.roundsOf(V)[0];
      const round=V.round, phase=V.phase;
      window.__score1RaceStarted=performance.now();
      // 독립 검토(묶음 2) minor 5: 준비 뒤 실제 운영 재생이 시작됐는지 표본으로 남긴다.
      window.__score1RaceReplay=false;
      const watch=()=>{ if(document.querySelector('#bd-root.bd-replaying')) window.__score1RaceReplay=true;
        if(performance.now()-window.__score1RaceStarted<12000) requestAnimationFrame(watch); };
      requestAnimationFrame(watch);
      document.querySelector('[data-run="7"]').click();
      const playing=document.documentElement.classList.contains('bd-running');
      document.querySelector('#lg-ready').click();
      return {round,phase,calendar,playing,
        running:document.documentElement.classList.contains('bd-running'),
        trial:KCP.buildGame.lastTrial()};
    }""")
    # 지시서 T 2번: 이미 끝난 시험을 검사하는 공허 통과를 막는다.
    require(checks, immediate['round'] == 1 and immediate['phase'] == 'plan' and immediate['playing'],
            label + ' T2 첫 달 시험 재생 경합 전제')
    # 지시서 T 2번: 준비 클릭과 같은 JS 작업에서 즉시 종료/그 달 기록을 읽는다.
    checks.ok(not immediate['running'], label + ' T2 준비 직후 bd-running 해제')
    trial, calendar = immediate['trial'], immediate['calendar']
    checks.ok(bool(trial) and trial.get('days') == 7 and
              trial.get('year') == calendar['year'] and trial.get('month') == calendar['month'],
              label + ' T2 준비 직후 round 1 시험 기록 확정')
    # s8n.ready의 준비 클릭 뒤 흐름을 재사용한다. 준비를 두 번 누르거나 시험을 건너뛰지 않는다.
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm')
    page.locator('[data-evidence="grid"]').click()
    page.locator('[data-pred]').first.select_option('down')
    page.locator('[data-confidence="fairly"]').click()
    page.locator('#lg-ready-confirm').click()
    page.wait_for_selector('#bd-root[data-lg-phase="review"]')
    page.wait_for_function('() => performance.now() - window.__score1RaceStarted >= 10000')
    frames(page)
    late = page.evaluate("""() => {
      const L=KCP.league.state(), V=L.S||L.snap, p=document.querySelector('#lg-panel');
      const box=p?.getBoundingClientRect();
      return {elapsed:performance.now()-window.__score1RaceStarted, round:V.round, phase:V.phase,
        result:!!p && p.dataset.tab==='result' && !p.hidden &&
          p.checkVisibility({opacityProperty:true,visibilityProperty:true}) && box.width>0 && box.height>0,
        buildDrawer:document.documentElement.classList.contains('bd-drawer-open')};
    }""")
    # 지시서 T 2번: 늦은 시험 콜백까지 지난 뒤 결과가 유지되는지를 직접 관찰한다(서랍 재열기 없음).
    checks.ok(late['elapsed'] >= 10000 and late['round'] == 1 and late['phase'] == 'review',
              label + ' T2 시험 시작 10초 뒤 첫 결과 단계 유지')
    checks.ok(late['result'], label + ' T2 시험 시작 10초 뒤 결과 서랍 표시 유지')
    checks.ok(not late['buildDrawer'], label + ' T2 시험 시작 10초 뒤 건설 결과 서랍 닫힘')
    # 독립 검토(묶음 2) minor 5: 실제 운영 재생이 막히지 않고, 포커스가 건설 결과 제목으로 끌려가지 않는다.
    # 움직임 줄이기에서는 재생이 원래 없으므로 이 컨텍스트(기본 움직임)에서만 단언한다.
    checks.ok(page.evaluate('window.__score1RaceReplay === true'), label + ' T2 준비 뒤 실제 운영 재생 시작')
    checks.ok(page.evaluate("document.activeElement?.id !== 'bd-res-title'"), label + ' T2 포커스가 건설 결과 제목으로 가지 않음')


def lobby_path_guard(checks, context, base, fixture, width, pages):
    label = f'{width} score1 로비 경로'
    page, events = monitored_page(context)
    pages.append((events, label))
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    page.locator('#lg-solo-start').wait_for(state='visible')
    frames(page)
    # 지시서 T 6(가)번: 탭 클릭/scrollIntoView 없이 최초 로비의 선택과 좌표를 관찰한다.
    initial = page.evaluate("""() => ({
      solo:document.querySelector('.lg-modes [data-mode="solo"]')?.getAttribute('aria-pressed')==='true',
      scroll:window.scrollY
    })""")
    require(checks, initial['solo'] and initial['scroll'] == 0,
            label + ' T6(가) 혼자 하기 선택·첫 화면 스크롤 0')
    start = page.locator('#lg-solo-start').bounding_box()
    checks.ok(bool(start) and start['width'] > 0 and start['height'] > 0 and
              start['y'] >= 0 and start['y'] + start['height'] <= 844,
              label + ' T6(가) 혼자 시작 단추 아래끝 844px 이하')


def promise_path_guard(checks, context, base, fixture, width, pages):
    label = f'{width} score1 약속 경로'
    page, events = monitored_page(context)
    pages.append((events, label))
    restore_fixture(checks, page, base, label, fixture)
    if shown(page, '#lg-coach'):
        page.locator('#lg-coach-close').click()
    close_drawer(page)
    # 지시서 T 6(나)번: 문제 칩 줄이 있는 첫 달 계획·닫힌 코치 조건을 먼저 확보한다.
    require(checks, page.evaluate("() => {const L=KCP.league.state(), V=L.S||L.snap; return V.round===1 && V.phase==='plan';}") and
            shown(page, '#lg-plan-issues') and not shown(page, '#lg-coach'),
            label + ' T6(나) 첫 계획 문제 칩 표시·코치 닫힘')
    ready(page, submit=False)  # 준비 → 확인 카드가 있으면 그대로 진행 → 약속 서랍.
    frames(page)
    # 지시서 T 6(나)번: 확신 단추를 클릭/스크롤하기 전 본문 스크롤 상자 안인지 잰다.
    confidence = page.locator('[data-confidence="fairly"]')
    checks.ok(confidence.is_visible() and inside(confidence.bounding_box(),
              page.locator('#lg-panel .lg-pbody').bounding_box()),
              label + ' T6(나) fairly 확신 단추는 약속 본문 안(1px 허용)')


def host_start_during_trial_case(checks, context, base, pages):
    # 독립 검토(묶음 2) major 2: 팀이 시험 재생 중일 때 진행자가 운영을 시작하는 경로(팀은 준비를 누르지 않음).
    from econui import NEXT_JS, SYNC_JS
    pair = []
    try:
        host, team, _ = setup_pair(context, base, 12, pair)
        advance(host, team, 1, 'plan')
        if shown(team, '#lg-coach'):
            team.locator('#lg-coach-close').click()
        close_drawer(team)
        playing = team.evaluate("""() => { window.__score1T0=performance.now(); window.__score1HostReplay=false;
          const watch=()=>{ if(document.querySelector('#bd-root.bd-replaying')) window.__score1HostReplay=true;
            if(performance.now()-window.__score1T0<12000) requestAnimationFrame(watch); };
          requestAnimationFrame(watch);
          document.querySelector('[data-run="7"]').click();
          return document.documentElement.classList.contains('bd-running'); }""")
        require(checks, playing, '1280 진행자 운영 시작 경합 전제: 팀 시험 재생 중')
        host.evaluate(NEXT_JS)
        team.wait_for_function(SYNC_JS, arg=[1, 'review'])
        team.wait_for_function('() => performance.now() - window.__score1T0 >= 10000')
        late = team.evaluate("""() => { const p=document.querySelector('#lg-panel');
          return {result: !!p && !p.hidden && p.dataset.tab==='result',
            build: document.documentElement.classList.contains('bd-drawer-open'),
            running: document.documentElement.classList.contains('bd-running'),
            focus: document.activeElement?.id || '', replay: window.__score1HostReplay}; }""")
        checks.ok(late['result'] and not late['build'] and not late['running'],
                  '1280 진행자 운영 시작 경합: 10초 뒤 팀 결과 서랍 유지·건설 결과 서랍 닫힘')
        checks.ok(late['replay'], '1280 진행자 운영 시작 경합: 팀 실제 운영 재생 시작')
        checks.ok(late['focus'] != 'bd-res-title', '1280 진행자 운영 시작 경합: 포커스가 건설 결과 제목으로 가지 않음')
    finally:
        pages.extend((events, '진행자 경합 ' + label) for _, events, label in pair)


def host_case(checks, context, base, fixture, pages):
    # setup_pair의 도시 선택/로컬 연결 흐름을 재사용한다. 자료에서 만든 lobby 사본만 복원한다.
    saved = fixture['save']['state']
    spec = {'room': saved['room'], 'region': saved['region'], 'ids': list(saved['teams'])}
    seed = """() => {
      const spec=%s, C=KCP.leagueCore, ids=spec.ids, net={kind:'local'};
      const S=C.newState(spec.room,spec.region,Date.now(),ids,{turns:12,seedMode:'room'});
      // F7 글꼴 fixture: 첫 장부에도 위험 기호가 반드시 생기도록 가상 재정만 음수로 둔다.
      // 실제 사용자 자료/운영 저장소가 아닌 새 BrowserContext의 시작 사본이다.
      S.econ.cities[ids[0]].cash = -S.econ.cities[ids[0]].debtCap - 10000;
      C.reduce(S,{type:'claim',team:ids[1],token:'score1-fixture-computer'},Date.now(),KCP.buildGame);
      localStorage.setItem('kcp-league-net-v1',JSON.stringify(net));
      localStorage.setItem('kcp-league-host-v1',JSON.stringify({room:S.room,net,state:S}));
      return {room:S.room,ids,team:ids[0]};
    }""" % json.dumps(spec, ensure_ascii=False)
    pair = []
    try:
        host, team, _ = setup_pair(context, base, 12, pair, seed_js=seed)
        advance(host, team, 1, 'plan')
        advance(host, team, 1, 'review')
        host.locator('#lg-host-details').evaluate('el => {el.open=true}')
        for selector in ('.lg-warning-symbol', '.lg-evnote', '.lg-data-chip > span'):
            values = host.locator(selector).evaluate_all('nodes => nodes.map(n=>parseFloat(getComputedStyle(n).fontSize))')
            checks.ok(bool(values) and min(values) >= 14, f'1280 F7 진행자 {selector} 계산 글꼴 14px 이상')
        overflow(checks, host, '1280 진행자')
        overflow(checks, team, '1280 진행자에 연결한 팀')
    finally:
        pages.extend((events, '진행자 ' + label) for _, events, label in pair)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        fixture = seeded_fixtures()[0]  # 자연 추첨 1월 비지급/2월 폭설. 기대 사건은 기존 독립 씨앗 표.
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in ((1280,900),(1024,768),(390,844)):
                    context, external = context_for(browser, base, width, height, 'light')
                    pages = []
                    try:
                        checks.test(f'{width} 전체 장면 예외 0',
                                    lambda: (solo_case(checks,context,base,fixture,width,pages), True)[1])
                    finally:
                        for events, label in pages:
                            diagnostics(checks,events,label)
                        checks.ok(not external, f'{width} 외부 요청 0')
                        context.close()
                # 지시서 T 2·6번: 각 경합/경로는 별도 컨텍스트와 새 페이지에서 독립 실행한다.
                for width, height, case in ((1280,900,ready_during_trial_case),
                                            (390,844,ready_during_trial_case),
                                            (390,844,lobby_path_guard),
                                            (1024,768,promise_path_guard)):
                    context, external = context_for(browser, base, width, height, 'light')
                    pages = []
                    label = f'{width} {case.__name__}'
                    try:
                        checks.test(label + ' 예외 0',
                                    lambda: (case(checks,context,base,fixture,width,pages), True)[1])
                    finally:
                        for events, page_label in pages:
                            diagnostics(checks,events,page_label)
                        checks.ok(not external, label + ' 외부 요청 0')
                        context.close()
                context, external = context_for(browser, base, 1280, 900, 'light')
                pages = []
                try:
                    checks.test('진행자 운영 시작 경합 예외 0',
                                lambda: (host_start_during_trial_case(checks, context, base, pages), True)[1])
                finally:
                    for events, page_label in pages:
                        diagnostics(checks, events, page_label)
                    checks.ok(not external, '진행자 운영 시작 경합 외부 요청 0')
                    context.close()
                context, external = context_for(browser,base,1280,900,'light')
                pages = []
                try:
                    checks.test('진행자 장면 예외 0', lambda: (host_case(checks,context,base,fixture,pages),True)[1])
                finally:
                    for events,label in pages:
                        diagnostics(checks,events,label)
                    checks.ok(not external,'진행자 외부 요청 0')
                    context.close()
            finally:
                browser.close()
    except Exception as e:
        checks.ok(False,f'검사 준비 예외: {type(e).__name__}: {e}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
