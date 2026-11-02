"""rev15 명세 #57·#58·#59·#53·#60 수용 검사(기대값은 spec.md만).

작성 세션에서는 브라우저를 실행하지 않고 python3 -m py_compile만 수행한다.
허용된 샌드박스 밖 로컬 담당자 실행:
 REV15_CAP=tests/results/rev15 tests/.venv/bin/python tests/league/rev15.py \
   http://127.0.0.1:<포트>/index.html --only u8,u9,u59,u53,u60
각 #53 판은 새 컨텍스트. 결과·DOM·CSS·타이머를 주입하지 않는다.
#60의 진행자 가짜 저장 fixture만 명세가 허용한 입력을 넣는다.
SKIP은 #59 모든 도시 1~2월 유입이 0인 화면 장면(이때 실제 공개 상태+고정 유입으로 함수 비교). API/장면/600ms 내 실제 입력
미확보는 BLOCKED 실패. PNG는 실행 시에만 생성되며 py_compile는 화면 검증이 아니다.
"""
import argparse
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import expect, sync_playwright
from econui import (BOOT_JS, advance, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, setup_pair, shown)
from fx_end import dismiss_guide
from league_flow import finish_trial, pass_issue_check, select_mode, start_solo, wait_unfolded
from phonedrawer import open_drawer, settle
from rev11 import DOM, InputBrowser, press
from rev14 import Checks, attempt
from solo import click_next, close_drawer, read

TRIAL_KEY = 'kcp-build-trial-v1'
SIZES = ((768, 1024), (810, 1080), (820, 1180), (834, 1194), (1024, 768), (1280, 900))


def require(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError('BLOCKED ' + label)


def start(page, base, fresh=True, city='pyeongtaek'):
    """기존 로비 선택자로 약속 방식을 명시한다. 상태·계산 결과를 주입하지 않는다."""
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator(f'[data-select="lg-solo-city"][data-value="{city}"]').click()
    options = page.locator('#lg-solo .lg-extra-settings')
    if not options.evaluate('e=>e.open'):
        options.locator(':scope > summary').click()
    page.locator('#lg-solo-practice').select_option('promise')
    start_solo(page, months=12)
    page.wait_for_selector('#bd-canvas')
    dismiss_guide(page)
    state = read(page)['S']
    if state['phase'] == 'lobby':
        click_next(page, state)
    page.wait_for_function("() => KCP.league.state().S.phase==='plan'")
    if fresh:
        assert read(page)['S']['round'] == 1, 'BLOCKED 새 판 1월 아님'


def trial(page):
    dismiss_guide(page)
    close_drawer(page)
    page.locator('[data-run="7"]').click()
    result = finish_trial(page)
    close = page.locator('#bd-drawer-x')
    if close.count() and close.is_visible():
        close.click()
    return result


def promise(page, touch=False):
    """약속 칸을 채우고 주 단추를 남긴다(#53은 confirm 단추로 운영하지 않는다)."""
    close_drawer(page)
    press(page, '#lg-ready', touch)
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    page.locator('#lg-predict [data-evidence]').first.click()
    page.locator('#lg-predict [data-pred]').select_option('up')
    press(page, '#lg-predict [data-confidence="fairly"]', touch)
    expect(page.locator('#lg-ready')).to_have_text('약속하고 준비')
    expect(page.locator('#lg-ready')).to_be_enabled()
    # 칸을 채운 뒤에는 서랍을 접거나 닫아 약속 상태를 바꾸지 않는다.
    page.locator('#lg-ready').scroll_into_view_if_needed()
    settle(page)


STRIP = r"""() => {
 const L=KCP.league.state(),S=L.S||L.snap,r=document.querySelector('#bd-run'),
  top=r?.querySelector('.bd-run-top'),wx=document.querySelector('#bd-run-wx'),
  panel=document.querySelector('#lg-panel');
 if(S?.round!==1||S.phase!=='review'||!document.querySelector('#bd-root.bd-replaying')||
    !r||!r.getClientRects().length||r.hidden||!top||!wx||panel?.hidden||
    panel?.dataset.tab!=='result'||panel?.dataset.folded==='true')return null;
 const b=r.getBoundingClientRect(),w=wx.getBoundingClientRect(),s=getComputedStyle(wx);
 if(b.width<=0||b.height<=0)return null;
 return {width:b.width,height:b.height,left:b.left,top:b.top,right:b.right,bottom:b.bottom,
  inlineWidth:parseFloat(r.style.width),narrow:r.dataset.narrow,
  columns:getComputedStyle(top).gridTemplateColumns.trim().split(/\s+/).length,
  weatherHeight:w.height,lineHeight:parseFloat(s.lineHeight),weather:wx.innerText,
  overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
}"""


def u8(checks, page, base, width, height):
    label = f'U8 {width}x{height}'
    start(page, base)
    # 독립 검토 minor 4: 명세 #57-4 '서랍을 닫아 띠가 넓은 경우는 한 줄 격자'. 화면 폭 기준 구현을 가른다.
    dismiss_guide(page)
    close_drawer(page)
    page.locator('[data-run="7"]').click()
    wide = page.wait_for_function(r"""() => { const r = document.querySelector('#bd-run'), top = r?.querySelector('.bd-run-top');
      if (!document.documentElement.classList.contains('bd-running') || !r || r.hidden || !r.getClientRects().length) return null;
      const b = r.getBoundingClientRect(); if (!(parseFloat(r.style.width) > 0)) return null;
      return {inlineWidth: parseFloat(r.style.width), narrow: r.dataset.narrow ?? null, height: b.height,
        columns: getComputedStyle(top).gridTemplateColumns.trim().split(/\s+/).length}; }""", timeout=15000).json_value()
    print(f'INFO {label} 시험 운전 중 {json.dumps(wide, ensure_ascii=False)}', flush=True)
    if width >= 761:
        checks.ok(wide['inlineWidth'] >= 480 and wide['narrow'] == 'false' and wide['columns'] == 5,
                  label + ' 시험 운전 중 넓은 띠(서랍 닫힘) = 기존 한 줄 5열')
    finish_trial(page)
    close = page.locator('#bd-drawer-x')
    if close.count() and close.is_visible():
        close.click()
    promise(page, width < 900)
    press(page, '#lg-ready', width < 900)
    page.wait_for_function("() => KCP.league.state().S.phase==='review'")
    button = page.locator('#lg-bar [data-panel="result"]')
    if button.get_attribute('aria-expanded') != 'true':
        button.click()
    # #57 검사 관점: 재생 중·결과 서랍 펼침이 동시에 참인 프레임만 측정한다.
    g = page.wait_for_function(STRIP, timeout=3000).json_value()
    print(f'INFO {label} {json.dumps(g, ensure_ascii=False)}', flush=True)
    require(checks, isinstance(g['inlineWidth'], (float, int)) and g['inlineWidth'] > 0, label + ' inline width px 확보')
    checks.ok(g['narrow'] == ('true' if g['inlineWidth'] < 480 else 'false'), label + ' data-narrow 문턱 480')
    if width < 900:
        checks.ok(g['columns'] == 3, label + ' 두 줄 3열')
        checks.ok(g['lineHeight'] > 0 and 0 < g['weatherHeight'] <= g['lineHeight'] * 1.5,
                  label + ' 날씨 한 줄 높이')
        checks.ok(g['height'] <= 110, label + ' 띠 높이 ≤110px')
    else:
        expected_width, expected_weather = (500, 29) if width == 1024 else (896, 16)
        checks.ok(g['columns'] == 5, label + ' 기존 5열')
        checks.ok(abs(g['height'] - 63) <= 1 and abs(g['width'] - expected_width) <= 1,
                  label + f' 기존 띠 {expected_width}×63 ±1px')
        checks.ok(abs(g['weatherHeight'] - expected_weather) <= 1,
                  label + f' 기존 날씨 높이 {expected_weather}±1px')
    checks.ok(g['overflow'] <= 0, label + ' 측정 프레임 가로 넘침 0')
    if width == 820:
        require(checks, page.evaluate("() => !!document.querySelector('#bd-root.bd-replaying') && !document.querySelector('#bd-run').hidden"),
                label + ' 캡처 순간 재생 중 띠 보임')
        checks.shot(page, 'u8-820')
    overflow(checks, page, label)


KEYS = r"""() => {
 const {visible,box,area}= (""" + DOM + r""");
 const a=document.querySelector('#bd-town-look-key'),b=document.querySelector('#lg-lens-grid');
 const node=e=>{if(!e)return null;const r=box(e),s=getComputedStyle(e);
  return {rect:r,visible:visible(e),hidden:e.hidden,inView:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
    position:s.position,top:s.top,bottom:s.bottom,left:s.left,zIndex:s.zIndex,
    popup:!!e.closest('.lg-info-pop')};};
 return {town:node(a),lens:node(b),area:a&&b?area(box(a),box(b)):null,
   team:document.querySelector('#bd-root')?.classList.contains('lg-team-map')};
}"""


def lens_on(page):
    button = page.locator('[data-lens="grid"]')
    if button.get_attribute('aria-pressed') != 'true':
        button.click()
    settle(page)


def keys_visible(checks, page, label):
    g = page.evaluate(KEYS)
    print(f'INFO {label} {json.dumps(g, ensure_ascii=False)}', flush=True)
    require(checks, bool(g['town'] and g['lens']), label + ' 범례·렌즈 요소 확보')
    checks.ok(g['lens']['visible'] and not g['lens']['hidden'] and g['lens']['inView'], label + ' 렌즈 글 보임·화면 안')
    checks.ok(g['town']['visible'] and g['area'] == 0, label + ' 범례 보임·교차 넓이 0')
    checks.ok(g['town']['position'] == g['lens']['position'] == 'static', label + ' 둘 다 static')
    return g


def u9(checks, context, base, pages):
    host, team, fixture = setup_pair(context, base, 12, pages)
    advance(host, team, 1, 'plan')
    close_drawer(team)
    dismiss_guide(team)
    lens_on(team)
    g = keys_visible(checks, team, 'U9 팀 1280')
    checks.ok(g['team'] is True, 'U9 팀 지도 선택자 확인')
    # #58 측정 표가 명시한 팀 1280 사각형과 계산값. 다른 UI에서 얻은 값으로 갱신하지 않는다.
    for key, rect in (('town', (8, 711, 428, 762)), ('lens', (8, 770, 185, 800))):
        actual = g[key]
        checks.ok(all(abs(actual['rect'][k] - value) <= 1 for k, value in zip(('left', 'top', 'right', 'bottom'), rect)),
                  f'U9 팀 {key} 사각형 ±1px')
        checks.ok(not actual['popup'], f'U9 팀 {key} 1280 팝업 밖 배치')
    checks.ok(g['town']['zIndex'] == '29', 'U9 팀 범례 계산 z-index 29 보존')
    team_before = g
    overflow(checks, team, 'U9 팀 1280')
    for width, height in ((1280, 900), (1024, 768), (390, 844)):
        host.set_viewport_size({'width': width, 'height': height})
        host.goto(base + '#league/view/' + fixture['team'])
        host.wait_for_selector('#bd-canvas')
        lens_on(host)
        g = keys_visible(checks, host, f'U9 진행자 {width}')
        checks.ok(g['team'] is False, f'U9 진행자 {width} .lg-team-map 없는 경로')
        overflow(checks, host, f'U9 진행자 {width}')
        if width in (1280, 390):
            checks.shot(host, f'u9-view-{width}')
    # 독립 검토 minor 7: 다른 page 비교는 늘 참이라 지우고, 팀 범례 두 요소의 top·bottom 계산값을 직접 단언한다.
    for key in ('town', 'lens'):
        checks.ok(team_before[key]['top'] == 'auto' and team_before[key]['bottom'] == 'auto',
                  f'U9 팀 {key} top·bottom 계산값 auto')


BENEFIT = r"""() => {
 if(typeof KCP.econ.serviceBase!=='function')throw Error('BLOCKED 함수 없음: KCP.econ.serviceBase');
 if(typeof KCP.league.uiMath?.fmt!=='function')throw Error('BLOCKED 함수 없음: KCP.league.uiMath.fmt');
 const L=KCP.league.state(),V=KCP.leagueCore.publicView(L.S,Date.now()),id=L.team,
  res=V.results.find(r=>r.round===V.round),rep=res?.econ||V.econ.report,
  city=V.econ.cities[id],P=k=>KCP.ECON_DATA.params[k].v,
  inflow=(rep?.flows?.pop||[]).filter(f=>f.to===id).reduce((n,f)=>n+f.n,0),
  share=Number.isFinite(city.shares?.senior)?city.shares.senior:0,
  service=KCP.econ.serviceBase({pop:inflow,groups:{senior:{share}}},KCP.ECON_DATA)*(1+P('svcStep')*(city.policy?.service||0)),
  tax=inflow*P('resTax')*(1+P('taxStep')*(city.policy?.taxRes||0)),
  node=document.querySelector('#lg-migration-benefit');
 return {round:V.round,inflow,share,expected:KCP.league.uiMath.fmt(service,2),tax:KCP.league.uiMath.fmt(tax,2),text:node?.innerText||''};
}"""


def u59(checks, page, base):
    # 총괄 보정(장면 준비만): 평택은 1~4월 순유출이라 유입 0. 로비의 도시를 차례로 골라 앞 두 달 안에
    # 실제 유입이 있는 장면을 찾는다. 기대값(명세 #59-2 식)과 화면 값 변조 없음은 그대로.
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    cities = page.evaluate("() => [...document.querySelectorAll('[data-select=\"lg-solo-city\"]')].map(e => e.dataset.value)")
    for city in cities:
        start(page, base, city=city)
        trial(page)
        for month in range(1, 3):
            promise(page)
            page.locator('#lg-ready').click()
            page.wait_for_function("m => {const S=KCP.league.state().S;return S.round===m&&S.phase==='review';}", arg=month)
            skip_replay(page)
            open_panel(page, 'result')
            b = page.evaluate(BENEFIT)
            print(f'INFO U59 {city} {json.dumps(b, ensure_ascii=False)}', flush=True)
            if b['inflow'] > 0:
                node = page.locator('#lg-migration-benefit')
                node.scroll_into_view_if_needed()
                require(checks, shown(page, '#lg-migration-benefit'), 'U59 이주 편익 화면 보임')
                checks.ok(f'서비스 +{b["expected"]}억/달' in node.inner_text(), 'U59 화면 서비스 = 명세 #59-2')
                checks.ok(f'주민세 +{b["tax"]}억/달' in node.inner_text(), 'U59 주민세 옛 식 보존')
                checks.ok(b['share'] > 0, 'U59 노년 몫 > 0(옛 식과 구별되는 장면)')
                overflow(checks, page, 'U59')
                if os.environ.get('REV15_CAP'):
                    checks.shot(page, 'u59-benefit')
                return
            if month < 2:
                click_next(page, read(page)['S'])
    checks.skip('U59 화면', '모든 도시의 1~2월 실제 유입이 0명. 공개 상태·화면 값을 변조하지 않음')
    # 독립 검토 minor 5: 실제 공개 상태(V.econ.cities[id].shares·policy)는 그대로 두고 결과 보고의 유입 흐름만
    # 고정값으로 넣어 화면 함수를 부른다(화면·저장은 바꾸지 않음). 기대값은 명세 #59-2 식.
    b = page.evaluate(r"""() => {
      const L = KCP.league.state(), V = KCP.leagueCore.publicView(L.S, Date.now()), id = L.team, P = k => KCP.ECON_DATA.params[k].v;
      const res = V.results.find(r => r.round === V.round), base = res.econ || V.econ.report, other = V.active.find(x => x !== id);
      const inflow = 12345, rep = {...base, flows: {...base.flows, pop: [{from: other, to: id, n: inflow}]}, net: {...base.net, [id]: {...base.net[id], pop: inflow}}};
      const html = KCP.league.uiMath.migrationBenefitHTML(V, {...res, econ: rep}, id), city = V.econ.cities[id];
      const share = city.shares?.senior, f = KCP.league.uiMath.fmt;
      const expected = inflow * (P('svcCost') + share * P('svcCostSenior')) * (1 + P('svcStep') * (city.policy?.service || 0));
      const old = inflow * P('svcCost') * (1 + P('svcStep') * (city.policy?.service || 0));
      return {html, share, expected: f(expected, 2), old: f(old, 2)}; }""")
    print(f'INFO U59 실제 공개 상태+고정 유입 {json.dumps(b, ensure_ascii=False)}', flush=True)
    checks.ok(b['share'] > 0 and f'서비스 +{b["expected"]}억/달' in b['html'], 'U59 실제 공개 상태 노년 몫으로 서비스 = 명세 #59-2')
    checks.ok(b['expected'] != b['old'], 'U59 실제 공개 상태에서 옛 식과 다른 숫자')


def skip_replay(page):
    button = page.locator('#bd-skip')
    if button.count() and button.is_visible():
        button.click()
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)


# 글자 전환 MutationObserver와 실제 날 입력 pointerdown을 같은 페이지 시계로 기록한다.
# 속도 변경·가짜 클릭·disabled 제거 없이 동작만 관측한다.
GUARD_PROBE = r"""() => {
 const p=window.__rev15Guard={changed:null,before:document.querySelector('#lg-ready')?.textContent.trim(),
   downs:[],skip:[],samples:[],active:true};
 const state=()=>{const L=KCP.league.state(),S=L.S||L.snap;return {round:S.round,phase:S.phase};};
 const scan=()=>{
  const e=document.querySelector('#lg-ready'),text=e?.textContent.trim();
  if(p.changed===null&&text!==p.before&&(text==='다음 달'||text==='최종 결과')){
    p.changed=performance.now();p.el=e;p.atChange={text,disabled:e.disabled,...state()};
  }
 };
 p.observer=new MutationObserver(scan);p.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});
 p.listener=e=>{
  if(p.changed===null)return;
  const row={at:performance.now(),dt:performance.now()-p.changed,x:e.clientX,y:e.clientY,
    ready:!!e.target.closest('#lg-ready'),skip:!!e.target.closest('#bd-skip'),...state()};
  if(row.skip)p.skip.push(row);else p.downs.push(row);
 };
 document.addEventListener('pointerdown',p.listener,true);
 const frame=()=>{
  if(!p.active)return;
  if(p.changed!==null){const b=document.querySelector('#lg-ready');
    p.samples.push({dt:performance.now()-p.changed,disabled:b?.disabled,same:b===p.el,text:b?.textContent.trim(),
      coach:document.querySelector('#lg-coach-action')?.hidden,...state()});}
  requestAnimationFrame(frame);
 };requestAnimationFrame(frame);
}"""


def stop_guard(page):
    return page.evaluate("""() => {const p=window.__rev15Guard;p.active=false;p.observer.disconnect();
      document.removeEventListener('pointerdown',p.listener,true);
      return {changed:p.changed,atChange:p.atChange,downs:p.downs,skip:p.skip,samples:p.samples};}""")


def tap_at(page, box, touch):
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    if touch:
        page.touchscreen.tap(x, y)
    else:
        page.mouse.click(x, y)


def u53(checks, page, base, width, touch, delay, target='ready'):
    # target='ready': 같은 자리 두 번째 누름(명세 #53 검사 관점). target='skip': 가드 안에 #bd-skip을 누름(#53-3).
    # 총괄 보정(첫 실행 뒤): 재생 중에는 화면 어디를 눌러도 재생이 끝나는 기존 동작(fx-turn.js 문서 pointerdown)이 있다.
    # 그래서 두 번째 누름 뒤 #bd-skip을 다시 찾지 않고, 두 번째 누름이 재생을 끝냈는지(기존 동작 보존)를 본다.
    label = f'U53 {width} {"터치" if touch else "마우스"} +{delay}ms {target}'
    start(page, base)
    trial(page)
    promise(page, touch)
    box = page.locator('#lg-ready').bounding_box()
    require(checks, bool(box), label + ' 주 단추 중심 좌표 확보')
    page.evaluate(GUARD_PROBE)
    press(page, '#lg-ready', touch)
    page.wait_for_function('() => window.__rev15Guard.changed!==null', timeout=15000)
    page.evaluate("""delay => new Promise(resolve=>setTimeout(resolve,
      Math.max(0,window.__rev15Guard.changed+delay-performance.now())))""", delay)
    replaying = page.evaluate("() => !!document.querySelector('#bd-root.bd-replaying')")
    # 명세 #53: 두 번째 입력에 locator.click/tap을 쓰면 enabled 대기로 재현이 사라진다.
    if target == 'ready':
        tap_at(page, box, touch)
        second = page.evaluate('() => window.__rev15Guard.downs.at(-1) || null')
        require(checks, bool(second) and second['ready'] and 0 <= second['dt'] < 600,
                label + f' 실제 두 번째 pointerdown 600ms 안 (미확보는 BLOCKED): {second}')
    else:
        skip = page.locator('#bd-skip')
        skip_box = skip.bounding_box() if replaying and skip.count() and skip.is_visible() else None
        require(checks, bool(skip_box), label + ' 가드 안 재생 건너뛰기 보임')
        tap_at(page, skip_box, touch)
        second = page.evaluate('() => window.__rev15Guard.skip.at(-1) || null')
        require(checks, bool(second) and 0 <= second['dt'] < 600,
                label + f' 건너뛰기 실제 pointerdown 가드 안: {second}')
    at_change = page.evaluate('() => window.__rev15Guard.atChange')
    checks.ok(at_change['disabled'], label + ' 글자 전환 즉시 disabled')
    checks.ok(page.locator('#lg-ready').is_disabled(), label + ' 입력 직후 가드 유지')
    if replaying:
        ended = page.evaluate("""() => new Promise(resolve => { const t0 = performance.now();
          const tick = () => { if (!document.querySelector('#bd-root.bd-replaying')) return resolve(true);
            if (performance.now() - t0 > 1500) return resolve(false); requestAnimationFrame(tick); }; tick(); })""")
        checks.ok(ended, label + (' #bd-skip 가드 중 작동(재생 끝남)' if target == 'skip'
                                  else ' 재생 중 누름 = 기존 재생 건너뛰기 동작 유지(재생 끝남)'))
    elif target == 'ready':
        checks.skip(label + ' 재생 건너뛰기', '두 번째 누름 때 재생이 돌지 않음')
    # 입력 뒤 최소 1초. Python 왕복 시간을 빼고 페이지 시계로 대기한다.
    page.evaluate("""at => new Promise(resolve=>setTimeout(resolve,Math.max(0,at+1000-performance.now())))""", second['at'])
    state = read(page)['S']
    checks.ok(state['round'] == 1 and state['phase'] == 'review', label + ' 1초 뒤 같은 달 review')
    checks.ok(page.locator('#lg-ready').inner_text().strip() == '다음 달', label + ' 글자 다음 달 유지')
    # 독립 검토 minor 3: 두 번째 누름이 결과 서랍을 닫는 회귀를 가리지 않게, 서랍을 다시 열기 전에 먼저 본다.
    wait_unfolded(page)
    checks.ok(shown(page, '#lg-promise-summary') and bool(page.locator('#lg-promise-summary').inner_text().strip()),
              label + ' 결과 서랍 S6 판정 보임(다시 열기 전)')
    open_drawer(page, 'result')
    if delay == 120 and target == 'ready' and width in (1280, 390):
        checks.shot(page, f'u53-{width}')
    probe = stop_guard(page)
    guard = [s for s in probe['samples'] if s['dt'] < 600]
    released = [s['dt'] for s in probe['samples'] if not s['disabled']]
    checks.ok(bool(guard) and all(s['disabled'] for s in guard), label + ' 관측된 가드 프레임(글자 전환 +600ms 안) 모두 disabled')
    checks.ok(any(s['dt'] >= 700 and not s['disabled'] for s in probe['samples']), label + ' 700ms 뒤 enabled')
    # 독립 검토 minor 1: 명세 #53-1·2(600ms, 재무장 없음). 관측 시각은 글자 전환 관측(작업 끝) 기준이라 600~750ms를 허용한다.
    # 재검토 minor 1: 재무장은 시간 상한이 아니라 같은 단추 요소가 해제까지 그대로인지로 본다(막대 재생성 없음).
    # 시간 상한은 느린 실행기를 위해 1000ms로 둔다(맥 로컬 관측 618~643ms).
    first_release = min(released) if released else None
    checks.ok(bool(released) and 600 <= first_release <= 1000, label + f' 가드 해제 600~1000ms(관측 {first_release})')
    checks.ok(all(s['same'] for s in probe['samples'] if first_release is None or s['dt'] <= first_release),
              label + ' 가드~해제 동안 같은 #lg-ready 요소(재생성·재무장 없음)')
    expect(page.locator('#lg-ready')).to_be_enabled(timeout=3000)
    page.locator('#lg-ready').click()
    page.wait_for_function("() => {const S=KCP.league.state().S;return S.round===2&&S.phase==='plan';}")
    checks.ok(True, label + ' 정상 속도 한 번 클릭으로 2월 계획')
    print(f'INFO {label} input={second["dt"]:.1f}ms replaying={replaying} firstEnabled={min(released) if released else None}', flush=True)
    overflow(checks, page, label)


STORE = r"""() => {
 const raw=localStorage.getItem('kcp-build-trial-v1');let values=null;
 try{values=JSON.parse(raw||'{}');}catch(_){}
 const rows=values&&typeof values==='object'?Object.entries(values).map(([key,value])=>{
   let scope=null;try{scope=JSON.parse(key)[0];}catch(_){}
   let room=null;try{room=JSON.parse(scope)[0];}catch(_){}
   return {key,scope,room,value};}):[];
 return {raw,rows,values};
}"""


def stored(page):
    return page.evaluate(STORE)


def room_entries(snapshot, room):
    return {r['key']: r['value'] for r in snapshot['rows'] if r['room'] == room}


def standalone_entries(snapshot):
    return {r['key']: r['value'] for r in snapshot['rows'] if r['scope'] == ''}


def u60(checks, page, base):
    # #60 검사 관점 순서: #build → A → B → 새로고침 → 진행자 fixture → 처음부터 → 손상.
    # 총괄 정정(명세 #60 정정): #build는 시험 기록을 저장하지 않는다(build.js startRun의 rememberTrial은 리그 모드만).
    # scope "" 항목은 trialScope 없이 띄운 리그 지도(계절 모드 관전 등)가 만든다. 그 모양의 항목을 넣어 보존을 본다.
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    page.evaluate("""() => { const all = JSON.parse(localStorage.getItem('kcp-build-trial-v1') || '{}');
      all[JSON.stringify(['', 'pyeongtaek'])] = {map: 'pyeongtaek', scope: '', year: null, month: null, season: 'summer', days: 7, seed: 1,
        unsPct: 0, outH: 0, outTotal: 0, co2: 1, cost: 1, capex: 0, opex: 1, loss: 0, idle: 0, gridMWh: 0, plan: {builds: [], lines: [], policies: []}};
      localStorage.setItem('kcp-build-trial-v1', JSON.stringify(all)); }""")
    build = standalone_entries(stored(page))
    require(checks, bool(build), 'U60 scope 빈 문자열 항목 준비')
    start(page, base)
    room_a = read(page)['S']['room']
    trial(page)
    require(checks, bool(room_entries(stored(page), room_a)), 'U60 판 A 실제 시험 기록 생성')
    start(page, base)
    room_b = read(page)['S']['room']
    require(checks, room_b != room_a, 'U60 새 판 B 방 코드 다름')
    trial(page)
    b = stored(page)
    keep_b = room_entries(b, room_b)
    checks.ok(not room_entries(b, room_a) and bool(keep_b), 'U60 B 시작 뒤 A 0개·B ≥1개')
    checks.ok(standalone_entries(b) == build, 'U60 B 시작 뒤 scope "" 항목 그대로')
    last_b = page.evaluate('() => KCP.buildGame.lastTrial()')
    page.reload()
    page.wait_for_function(BOOT_JS)
    page.wait_for_selector('#lg-bar')
    dismiss_guide(page)
    require(checks, read(page)['S']['room'] == room_b, 'U60 새로고침 이어서 하기 방 B')
    checks.ok(room_entries(stored(page), room_b) == keep_b, 'U60 새로고침 뒤 B 시험 기록 그대로')
    checks.ok(page.evaluate('() => KCP.buildGame.lastTrial()') == last_b, 'U60 새로고침 lastTrial 반환값 그대로')
    fixture = page.evaluate("""() => {
      const host={room:'REV15-HOST',net:{kind:'local'}},all=JSON.parse(localStorage.getItem('kcp-build-trial-v1'));
      const template=Object.values(all).find(t=>t.scope!==''),scope=JSON.stringify([host.room,'pyeongtaek']),
        key=JSON.stringify([scope,template.map]),value={...template,scope};
      all[key]=value;
      // #60-3 읽을 수 없는 scope는 리그 호출자가 보존해야 한다.
      const unknownScope='rev15-unreadable-scope',unknownKey=JSON.stringify([unknownScope,template.map]);
      all[unknownKey]={...template,scope:unknownScope};
      // 독립 검토 minor 3: 마지막 팀(localStorage)·이 탭(sessionStorage)의 room도 #60-3 남길 방이다.
      const team={room:'R15TEAM1',team:'pyeongtaek',net:{kind:'local'}},tabv={room:'R15TABRM',team:'asan',net:{kind:'local'}};
      const teamKey=JSON.stringify([JSON.stringify([team.room,'pyeongtaek']),template.map]),tabKey=JSON.stringify([JSON.stringify([tabv.room,'asan']),template.map]);
      all[teamKey]={...template,scope:JSON.stringify([team.room,'pyeongtaek'])};
      all[tabKey]={...template,scope:JSON.stringify([tabv.room,'asan'])};
      localStorage.setItem('kcp-league-host-v1',JSON.stringify(host));
      localStorage.setItem('kcp-league-team-v1',JSON.stringify(team));
      sessionStorage.setItem('kcp-league-tab-v1',JSON.stringify(tabv));
      localStorage.setItem('kcp-build-trial-v1',JSON.stringify(all));
      return {key,value,host:localStorage.getItem('kcp-league-host-v1'),unknownKey,unknownValue:all[unknownKey],
        teamKey,teamValue:all[teamKey],tabKey,tabValue:all[tabKey],team:localStorage.getItem('kcp-league-team-v1'),tab:sessionStorage.getItem('kcp-league-tab-v1')};
    }""")
    # 로비 처음부터는 B 저장을 지우는 경로. keepScope가 진행자 room·읽을 수 없는 scope를 보존한다.
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator('#lg-solo-reset').click()
    after_reset = stored(page)
    checks.ok(not room_entries(after_reset, room_b), 'U60 처음부터 뒤 B 기록 0개')
    checks.ok(standalone_entries(after_reset) == build, 'U60 처음부터 뒤 scope "" 항목 그대로')
    checks.ok(after_reset['values'].get(fixture['key']) == fixture['value'], 'U60 처음부터 뒤 진행자 room 기록 보존')
    # #60 검사 관점: 진행자 fixture를 넣은 뒤 새 판 시작에서도 보존을 확인한다.
    start(page, base)
    after_start = stored(page)
    checks.ok(after_start['values'].get(fixture['key']) == fixture['value'], 'U60 새 판 시작 뒤 진행자 room 기록 보존')
    checks.ok(after_start['values'].get(fixture['unknownKey']) == fixture['unknownValue'], 'U60 읽을 수 없는 scope 보존')
    checks.ok(page.evaluate("() => localStorage.getItem('kcp-league-host-v1')") == fixture['host'],
              'U60 진행자 저장 읽기 전용')
    for name, key, value in (('마지막 팀', 'teamKey', 'teamValue'), ('이 탭', 'tabKey', 'tabValue')):
        checks.ok(after_reset['values'].get(fixture[key]) == fixture[value], f'U60 처음부터 뒤 {name} room 기록 보존')
        checks.ok(after_start['values'].get(fixture[key]) == fixture[value], f'U60 새 판 시작 뒤 {name} room 기록 보존')
    checks.ok(page.evaluate("() => [localStorage.getItem('kcp-league-team-v1'), sessionStorage.getItem('kcp-league-tab-v1')]")
              == [fixture['team'], fixture['tab']], 'U60 팀·탭 저장 읽기 전용')
    checks.ok(standalone_entries(after_start) == build, 'U60 새 판 시작 뒤 scope "" 항목 그대로')
    page.evaluate("() => localStorage.setItem('kcp-build-trial-v1','{')")
    start(page, base)
    checks.ok(page.evaluate("() => localStorage.getItem('kcp-build-trial-v1')") == '{', 'U60 손상 저장 새 판 시작 뒤 그대로')
    checks.ok(read(page)['S']['phase'] == 'plan', 'U60 손상 저장에도 새 판 정상 진입')
    overflow(checks, page, 'U60')


def single(checks, browser, base, label, width, height, touch, action):
    context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
    page, events = monitored_page(context)
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        attempt(checks, label, lambda: action(page))
    finally:
        diagnostics(checks, events, label)
        overflow(checks, page, label + ' 최종')
        checks.ok(not external, label + f' 외부 요청 0(요청은 차단됨): {external}')
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', nargs='?', default='http://127.0.0.1:9430/index.html')
    parser.add_argument('--only', default='u8,u9,u59,u53,u60')
    args = parser.parse_args()
    selected = args.only.split(',')
    if not selected or any(s not in ('u8', 'u9', 'u59', 'u53', 'u60') for s in selected):
        parser.error('--only: u8,u9,u59,u53,u60 중 쉼표로 선택')
    checks = Checks(Path(os.environ.get('REV15_CAP', Path(__file__).resolve().parents[1] / 'results' / 'rev15')))
    try:
        base = local_address(['rev15.py', args.base])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                if 'u8' in selected:
                    for width, height in SIZES:
                        single(checks, browser, base, f'U8 {width}', width, height, width < 900,
                               lambda page, w=width, h=height: u8(checks, page, base, w, h))
                if 'u9' in selected:
                    context, external = context_for(InputBrowser(browser, False), base, 1280, 900, 'light')
                    pages = []
                    try:
                        attempt(checks, 'U9', lambda: u9(checks, context, base, pages))
                    finally:
                        for page, events, name in pages:
                            diagnostics(checks, events, 'U9 ' + name)
                            overflow(checks, page, 'U9 ' + name + ' 최종')
                        checks.ok(not external, f'U9 외부 요청 0(요청은 차단됨): {external}')
                        context.close()
                if 'u59' in selected:
                    single(checks, browser, base, 'U59', 1280, 900, False, lambda page: u59(checks, page, base))
                if 'u53' in selected:
                    for width, height, touch in ((1280, 900, False), (1024, 768, True), (390, 844, True)):
                        for delay, target in ((50, 'ready'), (120, 'ready'), (200, 'ready'), (120, 'skip')):
                            single(checks, browser, base, f'U53 {width}/{delay}/{target}', width, height, touch,
                                   lambda page, w=width, t=touch, d=delay, g=target: u53(checks, page, base, w, t, d, g))
                if 'u60' in selected:
                    single(checks, browser, base, 'U60', 1280, 900, False, lambda page: u60(checks, page, base))
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'검사 실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
