"""명세 D(시각 V6) D1~D4 독립 브라우저 검사.

샌드박스 밖 로컬 실행(작성 세션은 브라우저 실행 금지):
  python3 tests/srv.py 9430 .
  tests/.venv/bin/python tests/league/rev8d.py http://127.0.0.1:9430/index.html

기대값: (비공개 작업 지시서) 구현의 배치 숫자를 사용하지 않는다.
진입/진행은 HEAD의 fx_event.py·fx_end.py 방식이다. FXW4AAA8 lobby 저장본만
복원하고 사건·결과·라운드는 주입하지 않는다. monthStart를 잠시 보류해 실제
서랍을 연 뒤 원래 인자로 호출한다(fx_event.py의 예보 서랍 검사와 같은 방식).
UI 소스는 읽지 않는다. 상태 생성 불가/예외는 SKIP 없이 BLOCKED 실패로 센다.
마지막 줄: assertions N failures M.
"""

import math
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks as BaseChecks, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, shown)
from fx_event import click_progress, observe, wait_state
from fx_end import dismiss_guide
from league_flow import pass_issue_check, wait_unfolded
from solo import close_drawer


class Checks(BaseChecks):
    def finish(self):
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return 1 if self.failed else 0


class Blocked(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Blocked(message)


def attempt(checks, label, action):
    try:
        action()
    except Exception as exc:
        detail = str(exc).splitlines()[0][:240]
        checks.ok(False, f'BLOCKED {label}: {type(exc).__name__}: {detail}')


# fx_event_seeds.js의 첫 고정 방 코드. 시작본 외 엔진 진행/사건 주입은 없다.
SEED_JS = """() => {
  const C=KCP.leagueCore, B=KCP.buildGame, ids=['pyeongtaek','dangjin'];
  const S=C.newState('FXW4AAA8','south',0,ids,{turns:12,seedMode:'room'});
  for (const team of ids) {
    const result=C.reduce(S,{type:'claim',team,token:'solo-city-'+team},0,B);
    if (!result.ok) throw Error('시작 도시 claim 실패');
  }
  if (S.phase!=='lobby' || S.round!==0 || S.events.length) throw Error('lobby 시작본 아님');
  const save={v:1,state:S,initial:structuredClone(S),team:ids[0],style:'balanced',
    interview:{docs:{},journal:{},freeExperiment:true},aiRound:0};
  localStorage.setItem('kcp-league-solo-v1',JSON.stringify(save));
}"""

HOLD_FORECAST_JS = """() => {
  const fx=KCP.fxTurn;
  if (typeof fx?.monthStart!=='function') throw Error('monthStart 없음');
  const held=window.__rev8dForecast={original:fx.monthStart,calls:[]};
  fx.monthStart=function(...args) { held.calls.push({receiver:this,args}); return true; };
}"""

RELEASE_FORECAST_JS = """() => {
  const held=window.__rev8dForecast;
  if (!held) return;
  KCP.fxTurn.monthStart=held.original;
  for (const call of held.calls.splice(0)) held.original.apply(call.receiver,call.args);
  delete window.__rev8dForecast;
}"""

DOM_JS = """(() => {
  const visible=el => {
    if (!el || !el.getClientRects().length) return false;
    for (let n=el;n;n=n.parentElement) {
      const s=getComputedStyle(n);
      if (n.hidden || s.display==='none' || s.visibility==='hidden' ||
          s.visibility==='collapse' || Number(s.opacity)===0) return false;
      if (n.tagName==='DETAILS' && !n.open && !n.querySelector('summary')?.contains(el)) return false;
    }
    const b=el.getBoundingClientRect();
    return b.width>0 && b.height>0;
  };
  const rect=el => {
    if (!el) return null;
    const b=el.getBoundingClientRect();
    return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};
  };
  const overlap=(a,b) => !!a && !!b &&
    Math.min(a.right,b.right)>Math.max(a.left,b.left) &&
    Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
  return {visible,rect,overlap};
})()"""

DECK_JS = """() => {
  const {visible,rect,overlap}=(""" + DOM_JS + """);
  const decks=[...document.querySelectorAll('.fx-turn-cards')].filter(visible);
  const blockers=[...document.querySelectorAll('.lg-map-keys,#lg-panel,#lg-bar,#lg-coach,'+
    '#bd-hud,#bd-mapbar,#bd-dock,#bd-subtools')].filter(visible);
  return {map:rect(document.querySelector('#bd-canvas')),
    fx:KCP.fxTurn?.state?.(), decks:decks.map(el => {
      const box=rect(el), layer=el.closest('.fx-turn-layer');
      return {box,strip:layer?.dataset.strip,
        stripVisible:visible(el.querySelector('.fx-turn-strip')),
        rowVisible:visible(el.querySelector('.fx-turn-card-row')),
        expanded:!!el.querySelector('[aria-expanded="true"]'),
        overlaps:blockers.filter(b=>overlap(box,rect(b))).map(b=>b.id||b.className),
        keys:blockers.filter(b=>b.matches('.lg-map-keys')).map(rect)};
    })};
}"""


def frames(page):
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def start(page, base, drawer_before_forecast=False):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    require(page.evaluate('() => localStorage.length') == 0, '빈 컨텍스트 필요')
    page.evaluate(SEED_JS)
    page.reload()
    page.wait_for_function(BOOT_JS)
    if drawer_before_forecast:
        page.evaluate(HOLD_FORECAST_JS)
    try:
        page.locator('#lg-solo-resume').click()
        page.locator('#lg-bar').wait_for(state='visible')
        state = wait_state(page, 1, ['plan'])
        # 도시 이름은 자료에서 읽는다(D-58·D-86, #78).
        team_name = page.evaluate("() => KCP.leagueCore.teamDef(KCP.leagueCore.regionOf('south'), 'pyeongtaek').name")
        require(state['team'] == 'pyeongtaek' and state['months'] == 12,
                f'{team_name} 12달 시작 실패')
        require(any(e['mine'] for e in state['events']), '1월 자연 예보 사건 없음')
        if drawer_before_forecast:
            page.wait_for_function('() => window.__rev8dForecast.calls.length > 0')
            open_panel(page, 'city')
        else:
            page.wait_for_function('() => KCP.fxTurn?.state?.().forecastOpen===true')
    finally:
        if drawer_before_forecast:
            page.evaluate(RELEASE_FORECAST_JS)
    return state


def wait_deck(page, forecast):
    page.wait_for_function("""forecast => {
      const {visible}=(""" + DOM_JS + """);
      const f=KCP.fxTurn?.state?.();
      return !!f && !f.playing && f.cardsOpen && f.forecastOpen===forecast &&
        [...document.querySelectorAll('.fx-turn-cards')].some(visible) &&
        [...document.querySelectorAll('.fx-turn-card-row,.fx-turn-strip')].some(visible);
    }""", arg=forecast, timeout=20000)
    # 화면에 나타난 뒤 유한 등장 애니메이션이 끝난 사각형을 잰다.
    page.wait_for_function("""() => [...document.querySelectorAll('.fx-turn-cards')].every(el =>
      el.getAnimations({subtree:true}).every(a => a.playState!=='running' ||
        a.effect?.getTiming().iterations===Infinity))""", timeout=5000)
    frames(page)


def deck_geometry(checks, page, label, mobile):
    data = page.evaluate(DECK_JS)
    require(len(data['decks']) == 1, f'표시된 덱 1개 필요: {data}')
    deck = data['decks'][0]
    if mobile:
        checks.ok(deck['strip'] == 'true' and deck['stripVisible'] and
                  not deck['rowVisible'] and not deck['expanded'] and
                  data['fx'].get('strip') is True,
                  f'{label} D1 390 자동 띠 모드 유지: {deck}')
    else:
        m, d = data['map'], deck['box']
        require(m is not None and m['width'] > 0 and m['height'] > 0, '#bd-canvas 영역 없음')
        # 명세 D1 개정(총괄 갈래, 10-26): 캔버스가 화면 전체라 '아래 1/2'은 덱 높이(약 330px)로 채울 수 없다(1280×900 실측).
        # 덱 사각형 전체가 지도 왼쪽 1/3 안에 있고, 지도 핵심부(가운데 1/3 × 가운데 1/3)와 겹치지 않으면 통과.
        core = {'left': m['left'] + m['width'] / 3, 'right': m['left'] + 2 * m['width'] / 3,
                'top': m['top'] + m['height'] / 3, 'bottom': m['top'] + 2 * m['height'] / 3}
        hits_core = d['left'] < core['right'] and d['right'] > core['left'] and d['top'] < core['bottom'] and d['bottom'] > core['top']
        if label.startswith('1280'):
            # 개정 2: 카드 두 장(520px)은 기존 폭을 유지한다(넓은 화면 펼침·소리 계약, test-fx-turn-audio).
            # 그래서 덱은 왼쪽 가장자리(왼쪽 끝이 지도 왼쪽에서 24px 안)에 붙고 덱 가운데가 왼쪽 1/3 안이면 통과.
            checks.ok(d['width'] > 0 and d['height'] > 0 and m['left'] <= d['left'] <= m['left'] + 24 and
                      (d['left'] + d['right']) / 2 <= m['left'] + m['width'] / 3 and d['bottom'] <= m['bottom'],
                      f'{label} D1 지도 왼쪽 가장자리·덱 가운데 왼쪽 1/3: map={m} deck={d} core={hits_core}')
            checks.ok(deck['strip'] != 'true' and deck['rowVisible'], label + ' D1 데스크톱 카드 모드')
        # 범례는 자리가 없을 때 덮을 수 있다(명세 D1 개정: 지도 핵심부보다 우선순위가 낮음). 서랍·막대·코치는 겹치면 안 된다.
        checks.ok(not [o for o in deck['overlaps'] if 'lg-map-keys' not in str(o)],
                  f'{label} D1 서랍·막대·코치 겹침 0: {deck}')
    overflow(checks, page, label)


def clear_overlays(page):
    dismiss_guide(page)
    # D-83 동작은 기존 검사에서 유지한다. 여기서는 다음 상태를 만들기 위한 입력만 한다.
    for _ in range(4):
        if not (observe(page)['fx'] or {}).get('cardsOpen'):
            break
        page.keyboard.press('Escape')
        frames(page)
    page.wait_for_function('() => !KCP.fxTurn?.state?.().cardsOpen')
    close_drawer(page)
    frames(page)


BANNERS_JS = """() => {
  const {visible,rect,overlap}=(""" + DOM_JS + """);
  const p=document.querySelector('#lg-panel'), panel=visible(p)?rect(p):null;
  const banners=[...document.querySelectorAll('#bd-banners .bd-banner')].filter(el=>{
    if (!visible(el)) return false;
    const b=rect(el);
    return b.right>0 && b.left<innerWidth && b.bottom>0 && b.top<innerHeight;
  });
  return {panel,count:banners.length,
    overlaps:banners.filter(el=>overlap(rect(el),panel)).map(el=>({text:el.textContent,box:rect(el)}))};
}"""


def result_banners(checks, page, label):
    open_panel(page, 'result')
    frames(page)
    opened = page.evaluate(BANNERS_JS)
    require(opened['panel'] is not None, 'D2 결과 서랍 열기 실패')
    checks.ok(not opened['overlaps'], f'{label} D2 결과 서랍과 이름표 겹침 0: {opened}')
    close_drawer(page)
    frames(page)
    closed = page.evaluate(BANNERS_JS)
    require(closed['panel'] is None, 'D2 결과 서랍 닫기 실패')
    checks.ok(closed['count'] > 0 and closed['count'] >= opened['count'],
              f'{label} D2 닫은 뒤 이름표 수 복원: open={opened["count"]} closed={closed["count"]}')


def event_case(checks, page, base, width):
    label = f'{width} D1'
    start(page, base, drawer_before_forecast=True)
    wait_deck(page, True)
    deck_geometry(checks, page, label + ' 달 시작 예보', width == 390)
    if width != 390 and shown(page, '#lg-coach'):
        # 코치가 범례를 숨기는 상태만 검사하지 않는다. 포인터의 바깥 누름으로
        # 예보를 닫지 않도록 코치에 초점을 둔 Esc로 코치만 닫고 다시 측정한다.
        page.locator('#lg-coach-close').focus()
        page.keyboard.press('Escape')
        page.locator('#lg-coach').wait_for(state='hidden')
        wait_deck(page, True)
        deck_geometry(checks, page, label + ' 코치 닫은 뒤 예보·범례', False)
    clear_overlays(page)
    result = click_progress(page, observe(page))
    require(result['phase'] == 'review' and result['resultEvents'], '1월 결과 사건 생성 실패')
    # 결과 서랍 자동 표시가 끝난 뒤 덱을 재며, 모바일에서는 자동 띠를 펼치지 않는다.
    wait_unfolded(page)
    require(shown(page, '#lg-panel'), '결과 덱과 함께 열린 서랍 필요')
    wait_deck(page, False)
    deck_geometry(checks, page, label + ' 결과 사건', width == 390)


def banners_case(checks, page, base):
    # D1 실패로 D2 실행이 빠지지 않도록 별도 컨텍스트에서 결과를 만든다.
    start(page, base)
    clear_overlays(page)
    result = click_progress(page, observe(page))
    require(result['phase'] == 'review' and result['count'] == 1, 'D2 1월 결과 생성 실패')
    wait_deck(page, False)
    clear_overlays(page)
    result_banners(checks, page, '1280')


BAR_JS = """() => {
  const {visible,rect,overlap}=(""" + DOM_JS + """);
  const journal=document.querySelector('#lg-bar [data-panel="journal"]');
  const ready=document.querySelector('#lg-ready'), j=rect(journal), r=rect(ready);
  const hit=j && document.elementFromPoint((j.left+j.right)/2,(j.top+j.bottom)/2);
  return {journal:visible(journal)?j:null,ready:visible(ready)?r:null,
    overlap:overlap(j,r),hit:!!hit && (hit===journal || journal.contains(hit)),
    promise:document.querySelector('#bd-root')?.dataset.promiseOpen,
    buttons:[...document.querySelectorAll('#lg-bar button')].filter(visible)
      .map(el=>({label:el.getAttribute('aria-label')||el.textContent,box:rect(el)}))};
}"""


def bar_geometry(checks, page, label, promise):
    frames(page)
    data = page.evaluate(BAR_JS)
    require(data['journal'] is not None and data['ready'] is not None, '일지/준비 단추 표시 실패')
    require((data['promise'] == 'true') == promise, f'약속 단계 불일치: {data["promise"]}')
    checks.ok(not data['overlap'], f'{label} D3 일지·준비 사각형 겹침 0: {data}')
    checks.ok(data['hit'], label + ' D3 일지 가운데 elementFromPoint가 단추 또는 자식')
    checks.ok(bool(data['buttons']) and all(b['box']['width'] >= 44 and b['box']['height'] >= 44
                                           for b in data['buttons']),
              f'{label} D3 모든 표시 막대 단추 가로·세로 44px 이상: {data["buttons"]}')
    overflow(checks, page, label + ' D3')


def mobile_bar_case(checks, page, base, scheme):
    start(page, base)
    page.wait_for_function('() => KCP.fxTurn?.state?.().forecastOpen===true')
    clear_overlays(page)
    bar_geometry(checks, page, f'390 {scheme} 계획', False)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    page.wait_for_function("() => document.querySelector('#bd-root')?.dataset.promiseOpen==='true'")
    page.locator('#lg-ready-confirm').wait_for(state='visible')
    bar_geometry(checks, page, f'390 {scheme} 약속', True)


FONT_JS = """nodes => {
  const {visible}=(""" + DOM_JS + """);
  return nodes.map(el=>{
    const m=el.getScreenCTM(), font=parseFloat(getComputedStyle(el).fontSize);
    return {text:el.textContent,visible:visible(el),height:el.getBoundingClientRect().height,
      // D4 허용 측정법: 글자 세로 방향의 실제 화면 배율 × 계산된 font-size.
      px:m ? Math.hypot(m.c,m.d)*font : null};
  });
}"""


def fonts(checks, page, selector, label, width):
    svgs = page.locator(selector)
    require(svgs.count() > 0, label + ' SVG 없음')
    for i in range(svgs.count()):
        svg = svgs.nth(i)
        # 숨겨진 그래프 수치로 통과하지 않도록 접힘을 실제 summary 클릭으로 연다.
        for _ in range(12):
            ancestor = svg.locator('xpath=ancestor::details[not(@open)]').first
            if not ancestor.count():
                break
            ancestor.locator(':scope > summary').click()
        require(svg.is_visible(), f'{label} SVG {i + 1} 펼치기 실패')
        svg.scroll_into_view_if_needed()
        page.evaluate('() => document.fonts.ready.then(() => true)')
        frames(page)
        values = svg.locator('text').evaluate_all(FONT_JS)
        require(bool(values) and all(v['visible'] for v in values), f'{label} 글자 표시 실패: {values}')
        valid = all(isinstance(v['px'], (int, float)) and math.isfinite(v['px']) and
                    v['px'] >= 10 and (width == 390 or v['px'] <= 16) for v in values)
        checks.ok(valid, f'{label} D4 SVG {i + 1} 화면 글자 ' +
                  ('10px 이상' if width == 390 else '10~16px') + f': {values}')


def end_case(checks, page, base, width):
    start(page, base)
    reviews = set()
    for _ in range(30):
        state = observe(page)
        if state['phase'] == 'end':
            break
        wait_unfolded(page)
        clear_overlays(page)
        if state['phase'] == 'review':
            reviews.add(state['round'])
        click_progress(page, observe(page))
    state = observe(page)
    require(state['phase'] == 'end' and state['round'] == 12 and state['count'] == 12 and
            reviews == set(range(1, 13)), f'12달 화면 진행 실패: {state["phase"]} {state["round"]}')
    open_panel(page, 'result')
    attempt(checks, f'{width} D4 월별 추이',
            lambda: fonts(checks, page, '#lg-timeline svg', f'{width} 끝 화면 월별 추이', width))
    attempt(checks, f'{width} D4 궤적',
            lambda: fonts(checks, page, '.lg-fx-end svg', f'{width} 끝 화면 궤적', width))
    overflow(checks, page, f'{width} D4 끝 화면')


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                cases = [
                    ('D1-1280', 1280, 900, 'light', lambda p: event_case(checks, p, base, 1280)),
                    ('D1-1024', 1024, 768, 'light', lambda p: event_case(checks, p, base, 1024)),
                    ('D1-390', 390, 844, 'light', lambda p: event_case(checks, p, base, 390)),
                    ('D2-1280', 1280, 900, 'light', lambda p: banners_case(checks, p, base)),
                    ('D3-390-light', 390, 844, 'light', lambda p: mobile_bar_case(checks, p, base, 'light')),
                    ('D3-390-dark', 390, 844, 'dark', lambda p: mobile_bar_case(checks, p, base, 'dark')),
                    ('D4-1280', 1280, 900, 'light', lambda p: end_case(checks, p, base, 1280)),
                    ('D4-390', 390, 844, 'light', lambda p: end_case(checks, p, base, 390)),
                ]
                for label, width, height, scheme, action in cases:
                    context, external = context_for(browser, base, width, height, scheme)
                    page, events = monitored_page(context)
                    try:
                        attempt(checks, label, lambda: action(page))
                    finally:
                        diagnostics(checks, events, label)
                        overflow(checks, page, label + ' 마지막')
                        checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'BLOCKED 검사 실행: {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
