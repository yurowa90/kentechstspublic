"""rev16 독립 수용 검사. 기대값: 외부 rev16/spec.md 문구 표·#71~#74 해당 절만.

실행(허용된 샌드박스 밖 로컬 담당자):
 REV16_CAP=tests/results/rev16 tests/.venv/bin/python tests/league/rev16.py \
   http://127.0.0.1:<포트>/index.html [--only u71,u73,u64,u65,u66,u72,u67,u74]
작성 세션은 브라우저를 실행하지 않는다. 상태 입력은 기존 시작 fixture·계획 API와
#67 사건 렌더(공개 상태 사본)뿐. DOM/CSS/판정/결과/타이머를 바꾸지 않는다(u73 격자 측정 중 덧층
pointer-events만 잠시 바꾸고 되돌린다, u74 캔버스 pointerdown 수만 센다).
SKIP 경로 0: 필수 장면/API/관측을 못 얻으면 BLOCKED. #55는 총괄 결정 대기로 화면 연결을 보류해
u55를 실행 목록에서 뺐다(형식 함수는 64-rev16.js). #64 계절 카드가 없으면 같은
Node 검사의 정적 연결 확인으로 충족한다. 캡처는 REV16_CAP이 있을 때만.
"""
COPY = {
    'R1': '바깥 계통이 전기를 메워 주지 않아요. 필요한 전기는 내 도시 발전과 이웃 연계선으로만 대야 해요. 돌아가는 발전 설비가 없으면 정전이 100%가 될 수 있어요(게임 가정).',
    'R2': '지난달까지 지도에서 새로 짓거나 고친 것이 없어 지난달 운영 조건을 따로 남기지 않았어요. 그래서 이번 달은 지난달과의 차이를 원인별로 나누지 않아요.',
    'R3': '시험·실제', 'R4': '정책·시험 결과', 'R5': '시험 결과', 'R6': '민원·전력망·시험·실제 렌즈',
    'R7a': '{n}라운드 실제', 'R7b': '지난 라운드({n}라운드) 실제',
    'R8a': '{n}월 결산', 'R8b': '{n}라운드 결산',
}

import argparse
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
from econui import (BOOT_JS, WAIT, context_for, diagnostics, local_address, monitored_page,
                    open_panel, overflow, shown)
from fx_end import dismiss_guide
from fx_event import restore_fixture, seeded_fixtures
from league_flow import confirm_seat, pass_issue_check, select_mode, wait_unfolded
from rev11 import DOM
from rev14 import Checks as Rev14Checks, attempt
from rev15 import start, trial, promise, skip_replay
from score1 import frames, inside
from s7 import plan_and_trial
from s8n import answer, ready
from solo import click_next, close_drawer, read

SIZES = ((1280, 900), (1024, 768), (390, 844))
# u55(#55 수준값 자릿수)는 총괄 결정 대기로 앱 연결을 보류해 실행 목록에서 뺐다(함수는 결정 뒤 다시 쓴다).
ITEMS = ('u71', 'u73', 'u64', 'u65', 'u66', 'u72', 'u67', 'u74')
# README '새 브라우저 검사': 캡처/조건부 계절 카드 단언을 뺀 통과 실행 하한.
# single 공통 = diagnostics 3 + overflow 1 + external 1 = 5.
# season 공통 = 세 페이지 × (diagnostics 3 + overflow 1) + external 1 = 13.
# u71/u64는 restore_fixture의 고정 4단언 포함. SKIP 호출은 없다.
MINIMUM_BY_WIDTH = {
    1280: {'u71': 11, 'u73': 9, 'u64': 11, 'u65': 31,
           'u66': 7, 'u72': 16, 'u67': 22, 'u74': 19},
    1024: {'u71': 11, 'u73': 9, 'u64': 11, 'u65': 31,
           'u66': 7, 'u72': 16, 'u67': 22, 'u74': 19},
    390: {'u71': 16, 'u73': 12, 'u64': 11, 'u65': 31,
          'u66': 7, 'u72': 16, 'u67': 22, 'u74': 19},
}


class Checks(Rev14Checks):
    def __init__(self):
        out = os.environ.get('REV16_CAP')
        super().__init__(Path(out) if out else None)

    def shot(self, page, name, selector=None):
        if self.out is not None:
            super().shot(page, name, selector)

    def finish(self):
        print(f'checks {self.count} fail {self.failed} SKIP {len(self.skips)}', flush=True)
        return int(bool(self.failed))


def need(condition, label):
    # 장면 준비는 단언 수에 섞지 않는다. 실패 시 attempt가 BLOCKED 1건으로 남긴다.
    if not condition:
        raise AssertionError('BLOCKED ' + label)


def result(page):
    page.wait_for_function("() => ['review','end'].includes(KCP.league.state().S?.phase)")
    skip_replay(page)
    wait_unfolded(page)
    open_panel(page, 'result')
    frames(page)


def run_month(page):
    trial(page)
    ready(page)
    result(page)


def grant_plan(checks, page, base, fixture):
    # score1.solo_case와 같은 씨앗·2월 장면, 동일한 시험/약속/결과 후 다음 달.
    restore_fixture(checks, page, base, 'u71 fixture', fixture)
    dismiss_guide(page)
    run_month(page)
    answer(page, 'keep', '유지해요')  # score1.solo_case와 같은 입력(기준판 사각형 장면).
    page.wait_for_timeout(400)
    click_next(page, read(page)['S'])
    page.wait_for_function("() => {const S=KCP.league.state().S;return S.round===2&&S.phase==='plan';}")
    page.keyboard.press('Escape')
    close_drawer(page)
    frames(page)
    need(page.evaluate("() => {const L=KCP.league.state(),S=L.S;return KCP.leagueCore.grantOf(S,KCP.leagueCore.regionOf(S.region),L.team,KCP.buildGame).left>0;}"), '2월 교부세')


def u71(checks, page, base, width, fixture):
    grant_plan(checks, page, base, fixture)
    money = page.locator('[data-cap="budget"]')
    box = money.bounding_box()
    if width > 760:
        # #71-5: 지시서에 고정된 동일 장면 기준판 [left,top,폭,높이](총괄 실측 probe.py), ±1px.
        expected = {1024: (250.6, 17, 396.8, 48.2), 1280: (285.4, 17, 434.8, 48.8)}[width]
        actual = (box['x'], box['y'], box['width'], box['height'])
        checks.ok(all(abs(a-b) <= 1 for a, b in zip(actual, expected)), f'u71 {width} 기준판 칩 사각형 ±1px: {actual}')
        checks.ok(not shown(page, '.lg-money-info > summary'), f'u71 {width} ! 없음')
    else:
        summary = page.locator('.lg-money-info > summary')
        hit = summary.bounding_box()
        need(box and hit, '교부세 칩·summary 사각형')
        checks.ok(all(abs(box[k]-hit[k]) <= 1 for k in ('x', 'y', 'width', 'height')),
                  'u71 390 summary=칩 사각형(1px)')
        checks.ok(hit['width'] >= 44 and hit['height'] >= 44 and
                  inside(hit, {'x': 0, 'y': 0, **page.viewport_size}, tolerance=0), 'u71 390 화면 안 ≥44×44')
        dot = summary.evaluate(r"""el => {
          // 실제 요소 또는 점을 그린 가상 요소의 계산 스타일만 읽는다.
          for (const n of [el,...el.querySelectorAll('*')]) for (const pseudo of ['','::before','::after']) {
            const s=getComputedStyle(n,pseudo||null), r=n.getBoundingClientRect();
            if(pseudo && (!s.content || ['none','normal'].includes(s.content)||s.display==='none'))continue;
            let w=parseFloat(s.width),h=parseFloat(s.height);
            if(s.boxSizing!=='border-box') {
              w+=parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth);
              h+=parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth);
            }
            if(!(w>0&&w<=24&&h>0&&h<=24))continue;
            if(!pseudo)return {x:r.x+r.width/2,y:r.y+r.height/2,method:'element'};
            if(!['absolute','fixed'].includes(s.position))continue;
            let containing=n;
            while(containing&&getComputedStyle(containing).position==='static')containing=containing.parentElement;
            const origin=s.position==='fixed'?{left:0,top:0,width:innerWidth,height:innerHeight}:containing?.getBoundingClientRect();
            if(!origin)continue;
            const l=parseFloat(s.left),t=parseFloat(s.top),right=parseFloat(s.right),bottom=parseFloat(s.bottom);
            const x=Number.isFinite(l)?origin.left+l:origin.left+origin.width-right-w;
            const y=Number.isFinite(t)?origin.top+t:origin.top+origin.height-bottom-h;
            const matrix=s.transform==='none'?new DOMMatrixReadOnly():new DOMMatrixReadOnly(s.transform);
            const [ox,oy]=s.transformOrigin.split(' ').map(parseFloat);
            const center=new DOMPoint(w/2-ox,h/2-oy).matrixTransform(matrix);
            if(Number.isFinite(x)&&Number.isFinite(y))return {x:x+ox+center.x,y:y+oy+center.y,method:pseudo};
          }
          // 점을 독립 사각형으로 읽을 수 없는 경우 명세가 허용한 모서리 영역에서
          // 금색 원 배경을 가진 summary 자체(기준판 방식)의 중심을 사용한다.
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          if(r.width<=24&&r.height<=24&&s.backgroundColor!=='rgba(0, 0, 0, 0)')return {x:r.x+r.width/2,y:r.y+r.height/2,method:'summary'};
          return null;
        }""")
        need(dot, '점의 실제 요소/가상 요소 좌표를 계산할 수 없음(임의 좌표 대입 금지)')
        checks.ok(abs(dot['x']-107.8) <= 2 and abs(dot['y']-8) <= 2,
                  f'u71 390 금색 점 위치: {dot}')
        need(not summary.evaluate('e=>e.parentElement.open'), '탭 전 설명 닫힘')
        page.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']/2)
        checks.ok(summary.evaluate('e=>e.parentElement.open') and shown(page, '.lg-money-info .lg-info-pop'), 'u71 칩 탭 설명 열림')
        checks.ok(not page.evaluate("() => {const p=document.querySelector('#lg-panel');return p&&!p.hidden&&p.dataset.tab==='deal';}"), 'u71 칩 탭 사건·거래 서랍 안 열림')
        page.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']/2)
        checks.ok(not summary.evaluate('e=>e.parentElement.open'), 'u71 칩 재탭 설명 닫힘')
        money.focus()
        need(money.evaluate('e=>e===document.activeElement'), '칩 Tab 출발점')
        page.keyboard.press('Tab')
        checks.ok(summary.evaluate('e=>e===document.activeElement'), 'u71 칩에서 Tab 한 번 → summary')
    checks.shot(page, f'u71-{width}')


# #73-3: 첫 실제 표시 프레임은 MutationObserver와 rAF 양쪽에서 기록한다.
# 각 숫자 글자는 공개 .num의 textContent 전체로 보존(0→최종 굴림을 놓치지 않음).
SUMMARY_PROBE = r"""() => {
 const {visible,box,area}=(""" + DOM + r""");
 const p=window.__rev16Summary={first:null,frames:[],active:true};
 const scan=()=>{
  const e=document.querySelector('.fx-turn-summary');if(!visible(e))return;
  const values=[...e.querySelectorAll('.num')].map(n=>n.textContent.trim());
  if(!values.length)return;
  const r=box(e), row={values,rect:r,inView:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
   overlaps:['#bd-hud','.lg-bar'].map(s=>{const n=document.querySelector(s);return visible(n)?area(r,box(n)):0;}),
   panel:(n=>visible(n)?area(r,box(n)):0)(document.querySelector('#lg-panel')),
   summaryOver:e.closest('.fx-turn-layer')?.dataset.summaryOver==='true',
   drawer:visible(document.querySelector('#lg-panel'))&&document.querySelector('#lg-panel').dataset.folded!=='true',
   deck:[...document.querySelectorAll('.fx-turn-cards')].some(visible)};
  if(!p.first)p.first=row;p.frames.push(row);
 };
 p.observer=new MutationObserver(scan);p.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
 const frame=()=>{if(!p.active)return;scan();requestAnimationFrame(frame);};requestAnimationFrame(frame);
}"""


def begin_replay(page, base):
    start(page, base)
    trial(page)
    promise(page)
    page.evaluate(SUMMARY_PROBE)
    page.locator('#lg-ready').click()
    page.wait_for_function("() => !!document.querySelector('#bd-root.bd-replaying')", polling='raf', timeout=15000)


def u73(checks, page, base, width):
    start(page, base)
    # #73-1은 덱 없는 장면 계약. 공개 결과에 사건이 없는 실제 달을 찾는다.
    # 사건 있는 달을 검사의 실패/skip으로 세거나 사건 목록을 지우지 않는다.
    for _ in range(12):
        trial(page)
        promise(page)
        page.evaluate(SUMMARY_PROBE)
        page.locator('#lg-ready').click()
        page.wait_for_function("() => !!document.querySelector('#bd-root.bd-replaying')", polling='raf', timeout=15000)
        if not read(page)['S']['results'][-1].get('events'):
            break
        skip_replay(page)
        page.evaluate('() => {const p=__rev16Summary;p.active=false;p.observer.disconnect();}')
        result(page)
        answer(page, 'keep', '실제 결과의 정전과 비용을 확인하고 유지해요.')
        click_next(page, read(page)['S'])
    else:
        raise AssertionError('BLOCKED 사건 없는 요약 띠 달 미확보')
    page.locator('#bd-skip').click()
    page.wait_for_function('() => !!window.__rev16Summary.first', timeout=10000, polling='raf')
    wait_unfolded(page)
    frames(page)
    settled = page.evaluate('() => __rev16Summary.frames.length')  # 서랍이 펼쳐진 뒤 배치 재계산(rAF)까지 지난 첫 프레임
    page.wait_for_timeout(250)
    if width == 390:
        # 명세 #73 정정(2차 검토 major: 서랍이 펼쳐진 뒤 정정 상태에서 잰다): 요약 띠 격자점에서 맨 위에 그려지는 것이 요약 띠다(덧층은 pointer-events:none이라
        # 측정하는 동안만 auto로 바꾸고, 관찰자를 잠시 끊어 되먹임을 막는다).
        top = page.evaluate("""() => {const p=__rev16Summary;p.observer.disconnect();
          const e=document.querySelector('.fx-turn-summary'),L=e?.closest('.fx-turn-layer');if(!e||!L)return null;
          const a=L.style.pointerEvents,b=e.style.pointerEvents;L.style.pointerEvents='auto';e.style.pointerEvents='auto';
          const r=e.getBoundingClientRect();let hit=0,all=0;
          for(let i=1;i<5;i++)for(let j=1;j<3;j++){all++;const n=document.elementFromPoint(r.left+r.width*i/5,r.top+r.height*j/3);if(n&&(n===e||e.contains(n)))hit++;}
          L.style.pointerEvents=a;e.style.pointerEvents=b;
          p.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
          return {hit,all,over:L.dataset.over,summaryOver:L.dataset.summaryOver};}""")
        need(top, '요약 띠 표본')
        need(top['summaryOver'] == 'true', f'서랍이 펼쳐진 뒤 390 요약 띠가 지도 머리 아래 자리(data-summary-over): {top}')
        checks.ok(top['hit'] == top['all'], f"u73 390 요약 띠가 맨 위 층(격자 {top['hit']}/{top['all']})")
        checks.ok(top['over'] == 'false', f"u73 390 덱 펼침 data-over는 false 유지: {top}")
    open_panel(page, 'result')
    page.wait_for_timeout(650)  # 기존 400ms 굴림의 최종 문자열과 독립 비교.
    p = page.evaluate("() => {const p=__rev16Summary;p.active=false;p.observer.disconnect();return {first:p.first,frames:p.frames};}")
    # 배치 판정은 서랍이 펼쳐진 뒤의 안정 프레임만(펼쳐지는 중간 한 프레임은 배치 재계산 전이다). 숫자 판정은 모든 프레임.
    rows = [r for r in p['frames'][settled:] if r['drawer'] and not r['deck']]
    need(rows, '재생 끝·덱 없음·결과 서랍 펼침 요약 띠 표본')
    need(len(rows[-1]['values']) >= 3 and all(re.search(r'\d', s) for s in rows[-1]['values']), '최종 요약 숫자 3개 이상')
    checks.ok(all(r['inView'] for r in rows), f'u73 {width} 요약 띠 전체 화면 안')
    worst = max((max(r['overlaps']) for r in rows), default=0)
    checks.ok(all(all(a == 0 for a in r['overlaps']) for r in rows), f'u73 {width} HUD·위 막대 교차 0(최대 {worst:.1f}px², 마지막 {rows[-1]["rect"]})')
    # 명세 #73-1: 서랍이 펼쳐진 뒤 안정 프레임에서 서랍(#lg-panel)과 교차 0(모든 폭, 2차 검토 major로 허용 갈래 삭제).
    bad = [r for r in rows if r['panel'] > 0]
    checks.ok(not bad, f'u73 {width} 서랍과 교차 0: {bad[:1]}')
    if width == 390:
        checks.ok(all(r['rect']['width'] >= 240 for r in rows), 'u73 390 요약 띠 폭 ≥240')
    checks.ok(bool(p['first']['values']) and all(r['values'] == rows[-1]['values'] for r in p['frames']),
              f'u73 {width} 건너뛰기 첫 표시 숫자부터 최종 글자(모든 프레임)')
    checks.shot(page, f'u73-{width}')


def u55(checks, page, base, width):
    start(page, base)
    plan_and_trial(page, change_after=False)
    ready(page)
    result(page)
    summary = page.locator('#lg-promise-summary').inner_text()
    need('계통 예측:' in summary, '계통 약속 달')
    level = re.search(r'이번 달 하루 평균 ([\d,]+\.\d+ MWh/일(?: 미만)?)', summary)
    delta = re.search(r'하루 평균 ([+−-]?[\d,]+\.(\d+)) MWh/일 변화', summary)
    dd = page.locator('#lg-result-deltas [data-grid-fill] > dd').first.inner_text().strip()
    need(level and delta, 'S6 수준값·Δ 숫자')
    checks.ok(level[1] == dd, f'u55 {width} S6 이번 달 하루 평균 = 계통이 메운 전기 dd')
    checks.ok(len(level[1].split('.')[1].split()[0]) == len(delta[2]), f'u55 {width} 수준값과 Δ 자릿수 동일')
    checks.ok(len(delta[2]) in (1, 2), f'u55 {width} Δ 소수 1/2자리')
    print(f'INFO u55 {width} 화면 {len(delta[2])}자리, 2자리 경계·S7 형식은 64-rev16.js 표 검산', flush=True)
    checks.shot(page, f'u55-{width}')


def u64(checks, page, base, width, fixture):
    restore_fixture(checks, page, base, 'u64 fixture', fixture)
    dismiss_guide(page)
    # 씨앗 첫 달에 자연 사건이 있는 기존 fx_event 장면. 재생이 끝날 때까지 입력하지 않는다.
    trial(page)
    ready(page)
    # 1024·390은 카드가 띠·칩으로 접혀 카드 줄이 숨는다(fx_event의 compact/paged처럼 숨은 DOM을 읽는다).
    page.wait_for_selector('.fx-turn-card[data-forecast="false"] .fx-turn-tag', state='attached', timeout=30000)
    S = read(page)['S']
    res = S['results'][-1]
    need(res.get('events'), '결과 사건 있는 달')
    expected = COPY['R8a' if res.get('month') else 'R8b'].format(n=res.get('month') or res['round'])
    tags = page.locator('.fx-turn-card[data-forecast="false"] .fx-turn-tag').all_text_contents()
    checks.ok(tags[0].strip() == expected, f'u64 {width} 결과 첫 카드 꼬리표 {expected}')
    checks.ok(not any('지난달 결산' in t for t in tags), f'u64 {width} 지난달 결산 0')
    checks.shot(page, f'u64-{width}')


def supply_text(page):
    # #65-1 경제 문장은 명세의 고정 형식과 ECON_DATA.params 숫자로만 독립 생성.
    return page.evaluate("""() => {const P=k=>KCP.ECON_DATA.params[k].v;
      const f=(x,d=0)=>x.toLocaleString('ko-KR',{maximumFractionDigits:d});
      return `바깥 계통은 매시간 수요의 ${f(P('gridImportShare')*100)}%까지만 메워 줘요(기준 원가의 ${f(P('gridImportMarkup'),1)}배). 나머지는 내 도시 발전과 이웃 연계선으로 대야 해요(게임 가정).`;}""")


def seasonal(context, base, pages):
    # e2e3 로비 조작 그대로: 진행자 계절 4라운드 → 두 팀 참가 → 진행자 next.
    def new(name):
        p, ev = monitored_page(context)
        pages.append((p, ev, name))
        return p
    host = new('host')
    host.goto(base + '#league')
    host.wait_for_function(BOOT_JS)
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="0"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    teams = []
    for city in ('pyeongtaek', 'dangjin'):
        p = new(city)
        p.goto(base + '#league')
        p.wait_for_function(BOOT_JS)
        select_mode(p, 'join')
        p.locator('#lg-code').fill(room)
        p.locator('#lg-join').click()
        confirm_seat(p, city)
        teams.append(p)
    host.evaluate('() => KCP.league.next()')
    team = teams[0]
    team.wait_for_function("() => KCP.league.state().snap?.phase==='plan'")
    dismiss_guide(team)
    need(team.evaluate('() => !KCP.league.state().snap.econ'), '계절 판 econ 없음')
    return host, team


def check_supply(checks, page, expected, label, season=False):
    # 결과 서랍·도움말·준비 확인 카드의 문구 모두 검사. hidden infoTip도 textContent로 읽는다.
    content = page.locator('#lg-no-supply-cause .lg-info-pop').all_text_contents()
    checks.ok(expected in content, label + ' 결과 서랍 바깥 계통 문장 바이트 동일')
    page.locator('#bd-help').click()
    help_text = page.locator('#lg-help p').all_text_contents()
    checks.ok(expected in help_text, label + ' 도움말 바깥 계통 문장 바이트 동일')
    if season:
        supply = [t for t in content + help_text if '바깥 계통' in t]
        checks.ok(all('50%' not in t and '매시간 수요의' not in t for t in supply), label + ' 바깥 계통 문장 경제 상한 글자 0')


def u65(checks, page, base, width):
    # 경제 기본 판의 같은 자리 문장이 바이트 단위로 유지되는지도 검사.
    start(page, base)
    expected = supply_text(page)
    page.locator('#bd-help').click()
    paragraphs = page.locator('#lg-help p').all_text_contents()
    checks.ok(expected in paragraphs, f'u65 {width} 경제 도움말 문장 바이트 동일')
    close_drawer(page)
    trial(page)
    page.locator('#lg-ready').click()
    need(shown(page, '#lg-issue-check'), '경제 준비 전 공급 확인 카드')
    checks.ok(expected in page.locator('#lg-issue-check p').all_text_contents(), f'u65 {width} 경제 준비 전 문장 바이트 동일')
    page.locator('#lg-issue-fix').click()
    ready(page)
    result(page)
    check_supply(checks, page, expected, f'u65 {width} 경제')
    checks.shot(page, f'u65-econ-{width}')


# #82 독립 검토 minor(b): u65_season의 연이은 대기(진행자 팀 준비 수신 → 진행자 결과 → 팀 결과)와 2라운드 계획 대기는
# 시간을 넘기면 CI 로그에 'Page.wait_for_function: Timeout 30000ms' 한 줄만 남아 어느 대기인지 알 수 없었다.
# 대기마다 이름을 붙이고, 넘기면 진행자 phase·round·ready와 팀 snap phase·round를 붙여 BLOCKED로 다시 던진다.
# attempt는 예외 글의 첫 줄 260자만 남기므로 한 줄로 짧게 쓴다. 대기 조건·시간 한도는 그대로다(앞 셋 30초,
# 2라운드 계획은 문맥 기본 한도). 단언 수 불변.
HOST_PHASE_JS = """() => {const S=KCP.league.state().S;if(!S)return 'S 없음';
  const ids=S.active||Object.keys(S.teams||{});
  return `phase=${S.phase} round=${S.round} ready=${ids.map(id=>id+':'+(S.teams?.[id]?.ready?1:0)).join(',')}`;}"""
TEAM_PHASE_JS = """() => {const v=KCP.league.state().snap;return v?`phase=${v.phase} round=${v.round}`:'snap 없음';}"""


def peek(page, expression):
    try:
        return page.evaluate(expression)
    except Exception as exc:
        return f'읽기 실패({type(exc).__name__})'


def season_wait(name, page, expression, host, team, timeout=None):
    # timeout=None은 지금처럼 문맥 기본 한도(econui.WAIT, KCP_WAIT)를 쓴다.
    try:
        page.wait_for_function(expression, **({} if timeout is None else {'timeout': timeout}))
    except PlaywrightTimeoutError:
        # 낱말 'TimeoutError'를 남긴다: 바꾸기 전 줄('… TimeoutError: Page.wait_for_function: Timeout …')과 같은 낱말로
        # 대기 시간 초과임을 찾을 수 있고, CI 참고의 '검사 전체·TimeoutError' 규칙과도 같은 기준으로 읽힌다(rev16은 목록 밖).
        # rev16은 진행자·팀 상태를 30초(2라운드 계획은 문맥 기본 한도) 기다리는 상태 대기라, 실행기 속도만으로 끊기는 짧은 창
        # 검사가 아니어서 검사 전체 참고 대상이 아니다.
        limit = WAIT if timeout is None else timeout
        raise AssertionError(f'BLOCKED {name} 대기 {limit / 1000:g}초 안 미도달(TimeoutError): '
                             f'진행자 {peek(host, HOST_PHASE_JS)} / 팀 {peek(team, TEAM_PHASE_JS)}') from None
    except Exception as exc:
        # 시간 초과가 아닌 예외(판정식의 JS 오류, 닫힌 페이지 등)는 원래 첫 줄을 남긴다.
        raise AssertionError(f'BLOCKED {name} 대기 중 {type(exc).__name__}: {str(exc).splitlines()[0][:80]} · '
                             f'진행자 {peek(host, HOST_PHASE_JS)} / 팀 {peek(team, TEAM_PHASE_JS)}') from None


def u65_season(checks, context, base, width, pages):
    host, page = seasonal(context, base, pages)
    # 빈 계획은 정규 공개 계획 입력이다. 돌 설비 없음 확인 카드를 확실히 만든다.
    need(page.evaluate("() => KCP.league.plan(p=>Object.assign(p,{builds:[],lines:[],policies:[]}))"), '계절 빈 계획')
    trial(page)
    # 명세 #65-2(같은 종류, 총괄 추가): 지도 위 계획 문제 칩도 라운드 낱말.
    # 칩은 계획 단계에서 문제가 있을 때 채워진다. 폭에 따라 가려질 수 있어 글 자체를 본다(보임은 단언하지 않음).
    page.wait_for_function("() => (document.querySelector('#lg-plan-issues')?.textContent || '').includes('설비')", timeout=10000)
    chips = page.locator('#lg-plan-issues').text_content() or ''
    checks.ok('이번 라운드 돌 설비 없음' in chips and '이번 달' not in chips, f'u65 {width} 계절 계획 문제 칩 라운드 낱말: {chips!r}')
    page.locator('#lg-ready').click()
    need(shown(page, '#lg-issue-check'), '계절 준비 전 확인 카드')
    card = page.locator('#lg-issue-check').text_content()
    checks.ok(COPY['R1'] in page.locator('#lg-issue-check p').all_text_contents() and '이번 라운드' in card and '이번 달' not in card, f'u65 {width} 계절 준비 전 R1·라운드')
    checks.ok('50%' not in card and '매시간 수요의' not in card, f'u65 {width} 계절 준비 전 경제 문구 0')
    # #82 독립 검토 minor(a): 위에서 카드가 보였으므로 '그대로 진행'을 실제로 눌렀는지 확인한다.
    need(pass_issue_check(page), '계절 준비 확인 카드 그대로 진행')
    # 진행자가 팀의 빈 계획을 반영한 뒤에 운영한다. 팀은 계획 뒤에 준비를 보내고(서명 직렬), 진행자는 팀별 한 사슬에서
    # 받은 순서대로 검증·반영하므로 준비가 보이면 앞선 계획도 반영된 뒤다.
    season_wait('진행자 팀 준비 수신', host, "() => KCP.league.state().S.teams.pyeongtaek?.ready === true",
                host, page, timeout=30000)
    # 진행자 계획 단계의 공개 next 한 번이 운영부터 결과까지 끝낸다. 한 번만 누른다: 확인과 누르기 사이에
    # 운영이 끝나면 두 번째 next가 결과를 다음 라운드로 넘기고, 150ms 디바운스로 팀의 결과 공개가 사라진다.
    need(host.evaluate('() => KCP.league.state().S.phase') == 'plan', '진행자 계획 단계')
    host.evaluate('() => KCP.league.next()')
    season_wait('진행자 결과(review)', host, "() => KCP.league.state().S.phase==='review'", host, page, timeout=30000)
    season_wait('팀 결과(review)', page, "() => KCP.league.state().snap.phase==='review'", host, page, timeout=30000)
    skip_replay(page)
    wait_unfolded(page)
    open_panel(page, 'result')
    n = page.evaluate('() => KCP.league.state().snap.results.at(-1).round')
    map_text = page.locator('#lg-map-result').text_content() or ''  # 390 결과 단계는 서랍 아래로 숨을 수 있어 글 자체를 본다
    checks.ok(map_text.startswith(COPY['R7a'].format(n=n)) and '–월' not in map_text and '지난달(' not in map_text, f'u65 {width} 계절 결과 지도 머리 R7a: {map_text[:40]!r}')
    cause = page.locator('#lg-no-supply-cause').text_content().strip()
    checks.ok(cause.startswith('이번 라운드') and '달' not in cause, f'u65 {width} 계절 무설비 원인 라운드·달 낱말 0')
    tags = page.locator('.fx-turn-card[data-forecast="false"] .fx-turn-tag').all_text_contents()
    if tags:
        checks.ok(tags[0].strip() == COPY['R8b'].format(n=n), f'u64 {width} 계절 첫 카드 R8b')
    else:
        print(f'INFO u64 {width} 계절 카드 없음: 64-rev16.js 정적 R8b 연결 검사 사용', flush=True)
    check_supply(checks, page, COPY['R1'], f'u65 {width} 계절', season=True)
    close_drawer(page)
    host.evaluate('() => KCP.league.next()')
    season_wait('팀 2라운드 계획', page,
                "() => KCP.league.state().snap.phase==='plan'&&KCP.league.state().snap.round===2", host, page)
    map_text = page.locator('#lg-map-result').text_content() or ''  # 390 결과 단계는 서랍 아래로 숨을 수 있어 글 자체를 본다
    checks.ok(map_text.startswith(COPY['R7b'].format(n=n)) and '–월' not in map_text and '지난달(' not in map_text, f'u65 {width} 계절 다음 계획 지도 머리 R7b')
    checks.shot(page, f'u65-season-{width}')


def u66(checks, page, base, width):
    start(page, base)
    # 계획 API를 호출하지 않고 시험·약속·준비만: plan null인 자연 경로.
    run_month(page)
    answer(page, 'keep', '정전 결과를 확인했고 이번 배치를 유지해요.')
    click_next(page, read(page)['S'])
    run_month(page)
    missed = page.locator('#lg-missed').text_content()
    checks.ok(COPY['R2'] in missed, f'u66 {width} 무건설 2월 R2')
    checks.ok('지난달 운영 조건이 이 기기에 없어 나누지 못해요.' not in missed, f'u66 {width} device 안내 없음')
    checks.shot(page, f'u66-{width}')


CHARACTERS = r"""() => {
 const {visible}=(""" + DOM + r"""), root=document.querySelector('#lg-panel .lg-pbody');
 if(!root)throw Error('BLOCKED 결과 서랍 본문 없음');
 const pr=root.getBoundingClientRect(), clip={left:Math.max(0,pr.left),right:Math.min(innerWidth,pr.right),top:Math.max(0,pr.top),bottom:Math.min(innerHeight,pr.bottom)};
 const it=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),segments=new Intl.Segmenter('ko',{granularity:'grapheme'});let n,first=0,total=0;
 while(n=it.nextNode()) {
  const e=n.parentElement;if(!visible(e)||e.closest('script,style,.bd-sr,.lg-sr,[aria-hidden="true"]'))continue;
  for(const {index:i,segment} of segments.segment(n.data)) {
   if(/^\s+$/.test(segment))continue;total++;
   const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+segment.length);
   if([...r.getClientRects()].some(b=>b.width>0&&b.height>0&&Math.min(clip.right,b.right)>Math.max(clip.left,b.left)&&Math.min(clip.bottom,b.bottom)>Math.max(clip.top,b.top)))first++;
  }
 }
 return {first,total};
}"""


def u72(checks, page, base, width):
    start(page, base)
    run_month(page)
    details = page.locator('#lg-month-details, #lg-last-month').first
    need(details.count() == 1, '예측 자세히 details')
    if details.evaluate('e=>e.open'):
        details.locator(':scope > summary').click()
    page.locator('#lg-panel .lg-pbody').evaluate('e=>e.scrollTop=0')
    frames(page)
    summary = page.locator('#lg-promise-summary')
    summary_in_first = summary.evaluate("""e=>{const r=e.getBoundingClientRect(),p=e.closest('.lg-pbody').getBoundingClientRect();return r.top>=Math.max(0,p.top)&&r.bottom<=Math.min(innerHeight,p.bottom);}""")
    checks.ok(summary.is_visible() and summary_in_first and bool(re.search(r'\d', summary.inner_text())), f'u72 {width} 첫 화면 판정 줄·숫자')
    moved = page.locator('#lg-promise-cash-calc, #lg-promise-uns-calc, #lg-s6-co2cons, [data-fold="result-co2-consumption"]')
    need(moved.count() >= 1, '이동 대상 계산/소비 줄')
    checks.ok(moved.evaluate_all("ns=>ns.every(e=>e.closest('#lg-promise-result')&&e.closest('details')&&!e.closest('details').open)") and
              all(not moved.nth(i).is_visible() for i in range(moved.count())), f'u72 {width} 계산·소비 CO₂는 접힌 예측 자세히 안')
    outside = page.locator('#lg-evidence-direction, #lg-promise-also-outage')
    checks.ok(outside.evaluate_all("ns=>ns.every(e=>!e.closest('details')&&e.getClientRects().length>0)"), f'u72 {width} 근거 방향·정전 안내(있으면) 접힘 밖')
    closed = page.evaluate(CHARACTERS)['first']
    checks.shot(page, f'u72-first-{width}')
    page.locator('#lg-promise-summary [data-promise-details]').click()
    checks.ok(details.evaluate('e=>e.open') and all(moved.nth(i).is_visible() for i in range(moved.count())), f'u72 {width} 예측 자세히 입력 뒤 이동 줄 보임')
    checks.ok(moved.evaluate_all("""ns=>ns.every(e=>{
      const s=e.closest('#lg-promise-result'),v=s?.querySelector('[data-compare]'),co2=s?.querySelector('#lg-s6-co2cons');
      const afterVerdict=v&&!!(v.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING);
      const calcThenCo2=!e.matches('#lg-promise-cash-calc,#lg-promise-uns-calc')||!co2||!!(e.compareDocumentPosition(co2)&Node.DOCUMENT_POSITION_FOLLOWING);
      return afterVerdict&&calcThenCo2;
    })"""), f'u72 {width} 상세 판정 → 계산 → 소비 순서')
    expanded = page.evaluate(CHARACTERS)['total']
    print(f'MEASURE u72 {width} {closed} {expanded}', flush=True)
    overflow(checks, page, f'u72 {width} 결과 서랍')
    lens = page.locator('[data-lens="result"]')
    checks.ok(lens.inner_text().strip() == COPY['R3'], f'u72 {width} 렌즈 R3')
    checks.ok(lens.evaluate("e=>e.closest('[role=group]').getAttribute('aria-label')") == COPY['R6'], f'u72 {width} 렌즈 묶음 R6')
    pm = (page.locator('#bd-pm span').text_content() or '').strip()  # 390 결과 단계에서는 아래 막대가 서랍 뒤로 숨는다
    checks.ok(pm == COPY['R4'], f'u72 {width} 리그 도구 단추 R4: {pm!r}')
    close_drawer(page)
    page.locator('#bd-pm').click()
    checks.ok(page.locator('#bd-drawer [data-tab="result"] span').inner_text().strip() == COPY['R5'], f'u72 {width} 시험 결과 탭 R5')
    page.goto(base + '#build')
    page.wait_for_selector('#bd-pm')
    checks.ok(page.locator('#bd-pm span').inner_text().strip() == '정책·미션', f'u72 {width} 독립 build 이름 보존')


TARIFF_JS = r"""() => {
  // #67: 사건·거래 서랍이 쓰는 공개 렌더 함수(KCP.league.evCards)에 지금 공개 상태 사본 + 사건 하나를 넘긴다.
  // 상태 원본·방송은 건드리지 않는다(혼자 하기는 4초 방송이 없어 주입 뒤 서랍이 다시 그려지지 않는다).
  const L=KCP.league.state(), V=structuredClone(L.snap||L.S), C=KCP.leagueCore, R=C.regionOf(V.region), e=C.eventDef(R,'regional_tariff');
  if(!e) throw Error('BLOCKED regional_tariff 정의 없음');
  V.events=[{id:e.id,round:V.round,x:1}];
  const div=document.createElement('div'); div.innerHTML=KCP.league.evCards(V, V.round, L.team, false);
  return {text:div.textContent, econ:!!V.econ, names:R.teams.filter(t=>t.prov===e.scope.slice(5)).map(t=>t.name)};
}"""


def tariff(checks, page, label):
    data = page.evaluate(TARIFF_JS)
    need(data['names'], 'prov와 같은 도시 이름 자료')
    need('지역별 차등 전기요금' in data['text'], '사건 카드 렌더')
    checks.ok('prov:' not in data['text'], label + ' 사건 카드 내부 prov 꼬리표 0')
    checks.ok(all(name in data['text'] for name in data['names']), label + f' 사건 scope 도시 이름: {data["names"]}')
    return data


def u67(checks, page, base, width):
    start(page, base)
    data = tariff(checks, page, f'u67 {width} 경제')
    need(data['econ'], '경제 판')
    checks.shot(page, f'u67-econ-{width}')


def u67_season(checks, context, base, width, pages):
    host, team = seasonal(context, base, pages)
    data = team.evaluate(TARIFF_JS)
    need(not data['econ'], '계절 판')
    need(data['names'], '계절 scope 도시 자료')
    need('지역별 차등 전기요금' in data['text'], '계절 사건 카드 렌더')
    checks.ok('prov:' not in data['text'], f'u67 {width} 계절 prov 꼬리표 0')
    checks.ok(all(name in data['text'] for name in data['names']), f'u67 {width} 계절 사건 도시 이름')
    checks.shot(team, f'u67-season-{width}')


DELTA_LINES = r"""() => [...document.querySelectorAll('#lg-result-deltas small')].filter(e=>e.textContent.includes('Δ')).map(e=>{
 const walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),nodes=[];let n,text='';
 while(n=walk.nextNode()){nodes.push({n,start:text.length});text+=n.data;}
 const m=/Δ\s*([+−-]?\d[\d,]*(?:\.\d+)?)\s*(%p|t\/일|MWh\/일|시간)/.exec(text);
 if(!m)return {text,missing:!text.includes('비교 없음')};
 const begin=m.index+m[0].indexOf(m[1]),end=m.index+m[0].length-1;
 const rect=at=>{const q=nodes.findLast(x=>x.start<=at),r=document.createRange();r.setStart(q.n,at-q.start);r.setEnd(q.n,at-q.start+1);return r.getBoundingClientRect().top;};
 return {text,numberTop:rect(begin),unitTop:rect(end),missing:false,matched:true};
})"""


def u74(checks, page, base, width):
    # 독립 검토 major 5: 도구가 없으면 act()가 말풍선만 띄워 기준판 결함(잠금 알림)이 재현되지 않는다.
    # 계획 단계에서 철거 도구를 고른 채(설비 수를 바꾸지 않는 도구) 준비 → 재생 중 지도 누름.
    start(page, base)
    trial(page)
    promise(page)
    close_drawer(page)
    page.locator('[data-tool="remove"]').click()
    need(page.locator('[data-tool="remove"]').get_attribute('aria-pressed') == 'true', '철거 도구 선택')
    page.locator('#lg-ready').click()
    page.wait_for_function("() => !!document.querySelector('#bd-root.bd-replaying')", polling='raf', timeout=15000)
    need(page.evaluate("() => document.querySelector('[data-tool=\"remove\"]')?.getAttribute('aria-pressed')") == 'true', '재생 중 철거 도구 유지')
    before = page.evaluate('() => KCP.buildGame.current().builds.length')
    # 지도 정중앙 좌표 입력 한 번. locator.click은 잠금/재배치를 기다리므로 쓰지 않는다.
    canvas = page.locator('#bd-canvas').bounding_box()
    need(canvas, '지도 캔버스')
    page.evaluate("""() => {window.__rev16Lock=[];const scan=()=>{const t=document.querySelector('#bd-toast[data-show="true"]');if(t?.textContent.includes('지금은 운영·결과 단계'))__rev16Lock.push(t.textContent);};
      window.__rev16LockObserver=new MutationObserver(scan);__rev16LockObserver.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});scan();}""")
    x, y = canvas['x']+canvas['width']/2, canvas['y']+canvas['height']/2
    # 명세 #74-3: 건너뛴 누름은 지도 캔버스에 닿지 않는다. 캔버스 자신의 pointerdown 도달 수를 센다(상태는 바꾸지 않음).
    page.evaluate("() => {window.__rev16CanvasDown=0;document.querySelector('#bd-canvas').addEventListener('pointerdown',()=>{window.__rev16CanvasDown++;});}")
    if width == 390:
        page.touchscreen.tap(x, y)
    else:
        page.mouse.click(x, y)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=3000)
    frames(page)
    checks.ok(not page.evaluate("() => !!document.querySelector('#bd-root.bd-replaying')"), f'u74 {width} 지도 한 번 누름 재생 종료')
    checks.ok(page.evaluate('() => KCP.buildGame.current().builds.length') == before, f'u74 {width} 지도 건설 수 불변')
    locks = page.evaluate('() => {__rev16LockObserver.disconnect();return __rev16Lock;}')
    checks.ok(not locks, f'u74 {width} 건너뛰기 입력 잠금 토스트 0: {locks}')
    checks.ok(page.evaluate('() => window.__rev16CanvasDown') == 0, f'u74 {width} 건너뛴 누름은 지도 캔버스에 닿지 않음')
    # 명세 #74-3 '다음 누름부터는 평소대로': 재생이 끝난 뒤 같은 자리를 다시 누르면 캔버스가 받는다.
    page.wait_for_timeout(600)
    # 결과 서랍이 지도 가운데를 덮을 수 있으니(390·1024) 캔버스가 맨 위인 점을 찾는다.
    pt = page.evaluate("""() => {const c=document.querySelector('#bd-canvas'),r=c.getBoundingClientRect();
      for(let j=1;j<20;j++)for(let i=1;i<20;i++){const x=r.left+r.width*i/20,y=r.top+r.height*j/20;
        if(x>0&&y>0&&x<innerWidth&&y<innerHeight&&document.elementFromPoint(x,y)===c)return [x,y];}return null;}""")
    need(pt, '재생 뒤 지도 캔버스가 맨 위인 점')
    if width == 390:
        page.touchscreen.tap(*pt)
    else:
        page.mouse.click(*pt)
    frames(page)
    checks.ok(page.evaluate('() => window.__rev16CanvasDown') == 1, f'u74 {width} 재생 뒤 다음 누름은 지도 캔버스가 받음')
    wait_unfolded(page)
    open_panel(page, 'result')
    rows = page.evaluate(DELTA_LINES)
    need(rows and any(r.get('matched') for r in rows), 'Δ 숫자·단위 Range 표본')
    checks.ok(all(not r['missing'] and (not r.get('matched') or r['numberTop'] == r['unitTop']) for r in rows), f'u74 {width} Δ 숫자·단위 같은 줄: {rows}')
    checks.ok(page.locator('#lg-result-deltas').evaluate("e=>!e.textContent.includes('\u00a0')"), f'u74 {width} 결과 글자 NBSP 없음')
    checks.shot(page, f'u74-{width}')


def u74_reduce(checks, page, base, width):
    start(page, base)
    plan_and_trial(page, change_after=False)
    selectors = ('[data-cap="power"] [data-v]', '[data-cap="co2"] [data-v]')
    trial_hud = [page.locator(s).inner_text() for s in selectors]
    need(all(trial_hud), 'reduce 시험 HUD 값')
    # 시험 표시를 읽은 뒤 공개 계획 입력을 바꿔 운영한다(시험 값 주입 없음).
    need(page.evaluate("() => KCP.league.plan(p=>{p.policies=['save'];})"), 'reduce 운영 계획 변경')
    ready(page)
    result(page)
    actual_hud = [page.locator(s).inner_text() for s in selectors]
    checks.ok(bool(actual_hud[0]) and actual_hud[0] != trial_hud[0], f'u74 {width} reduce 정전 HUD 시험 표시 잔류 없음: {trial_hud[0]} → {actual_hud[0]}')
    checks.ok(bool(actual_hud[1]) and actual_hud[1] != trial_hud[1], f'u74 {width} reduce CO₂ HUD 시험 표시 잔류 없음: {trial_hud[1]} → {actual_hud[1]}')
    checks.shot(page, f'u74-reduce-{width}')


class Browser:
    def __init__(self, browser, width, reduce=False):
        self.browser, self.touch, self.reduce = browser, width == 390, reduce

    def new_context(self, **opts):
        return self.browser.new_context(has_touch=self.touch, reduced_motion='reduce' if self.reduce else 'no-preference', **opts)


def single(checks, browser, base, item, width, height, action, reduce=False, multi=False):
    context, external = context_for(Browser(browser, width, reduce), base, width, height, 'light')
    pages = []
    try:
        if multi:
            attempt(checks, f'{item} {width}', lambda: action(context, pages))
        else:
            page, events = monitored_page(context)
            page.on('dialog', lambda d: d.accept())
            pages.append((page, events, item))
            attempt(checks, f'{item} {width}', lambda: action(page))
    finally:
        for page, events, name in pages:
            diagnostics(checks, events, f'{item} {width} {name}')
            overflow(checks, page, f'{item} {width} {name}')
        checks.ok(not external, f'{item} {width} 외부 요청 0(차단됨): {external}')
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--only', default=','.join(ITEMS))
    parser.add_argument('--widths', default='', help='쉼표로 고른 폭만(진단용, 기본 전부)')
    args = parser.parse_args()
    widths = {int(w) for w in args.widths.split(',') if w}
    selected = set(args.only.split(','))
    if not selected or not selected <= set(ITEMS):
        parser.error('--only: ' + ','.join(ITEMS))
    checks = Checks()
    minimum = sum(v[k] for v in MINIMUM_BY_WIDTH.values() for k in selected)
    print(f'INFO 코드 기준 통과 하한 {minimum}, SKIP 가능 지점 0(캡처·선택적 계절 카드 별도)', flush=True)
    try:
        base = local_address(['rev16.py', args.base])
        fixtures = seeded_fixtures() if selected & {'u71', 'u64'} else None
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in SIZES:
                    if widths and width not in widths:
                        continue
                    for item in ITEMS:
                        if item not in selected:
                            continue
                        fn = globals()[item]
                        action = (lambda p, f=fn, w=width: f(checks, p, base, w, fixtures[0])) if item in ('u71', 'u64') else (lambda p, f=fn, w=width: f(checks, p, base, w))
                        single(checks, browser, base, item, width, height, action)
                        if item in ('u65', 'u67'):
                            fn = globals()[item + '_season']
                            single(checks, browser, base, item + '-season', width, height,
                                   lambda c, ps, f=fn, w=width: f(checks, c, base, w, ps), multi=True)
                        if item == 'u74':
                            single(checks, browser, base, 'u74-reduce', width, height,
                                   lambda p, w=width: u74_reduce(checks, p, base, w), reduce=True)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
