"""rev17 명세 기반 독립 수용 검사.

기대값 근거: 명세 문구 표, #55(A), #74-3 측정 정의(B), #74-5·#76-2(C),
#74-6(D), #29(F), #33(G), #28(H)의 기대 동작·완료 조건·검사 계획.
#20(옛 E 장면)은 명세 개정 3으로 보류해 장면이 없다(V3A 5와 충돌).
기준판 48d7d98의 공개 데이터/장면 도우미만 재사용한다. 구현 중 UI의 글자는
기대값으로 쓰지 않는다. 공개 계획 입력은 장면 구성에만 쓰고 결과/DOM은 주입하지 않는다.

실행(브라우저 실행이 허용된 로컬 담당자):
 REV17_CAP=tests/results/rev17 tests/.venv/bin/python tests/league/rev17.py \\
   http://127.0.0.1:<포트>/index.html [--only A,B,C,D,F,G,H] \\
   [--widths 1280,1024,390]
캡처는 REV17_CAP이 있을 때만. 필수 장면/API/관측 부재는 BLOCKED, SKIP 경로 0.
장면 준비(선택자·진입 타이밍·고정 방의 2자리/S7/주제/카드 장수, seat 연결, rAF 계획 전환과
계획 알림 수명 안 서랍 열림)는 맥 로컬 Chromium에서 확인했다. F의 서랍 누르기 직전·누른 뒤 시각(ms)은
INFO로만 남긴다(누른 뒤 잰 시각은 click 동기 처리를 포함하며 CI에서 308·331ms였다, 개정 4). reduce에서는 기준판 계약대로 재생 자체가 없어
C2는 일반 동작에서만 관측하고, C1·C3은 두 동작에서 각각 관측한다.
"""
COPY = {
    'M1': '지도에 덧입힌 옅은 색은 사건 종류 표시(효과 크기 무관)',
    'Q1': '미연결 설비: {목록}', 'Q2': '외 {n}기',
}

import argparse
import json
import math
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, context_for, diagnostics, local_address, monitored_page,
                    open_panel, overflow, shown)
from fx_end import dismiss_guide
from fx_event import seeded_fixtures, restore_fixture
from league_flow import finish_trial, select_mode, pass_issue_check, wait_unfolded
from rev14 import Checks as Rev14Checks, attempt
from rev15 import start, trial, promise, skip_replay
from rev16 import seasonal
from s7 import plan_and_trial, expected_operation
from s8n import answer, ready
from score1 import frames
from solo import click_next, close_drawer, read
from rev12 import CANDIDATES_JS


def fill(key, **values):
    return re.sub(r'\{([^}]+)\}', lambda m: str(values[m[1]]), COPY[key])


SIZES = ((1280, 900), (1024, 768), (390, 844))
ITEMS = tuple('ABCDFGH')
# 통과 실행의 고정 호출만 센다(준비는 Prep/need, 단언 수에 넣지 않음).
# 공통 진단=error/warning/pageerror 3 + overflow 1 + external 1 = 5.
# D는 2페이지이므로 9, F 계절은 3페이지이므로 13. C는 일반/reduce 각각 5.
# A:4+5. B:3장면×(R/카드 치수/전체 제목=3, 1280만 위치3)+5.
# C:일반4(C1,C2,C3 링크수/DOI), reduce3(C1,C3×2)+10.
# D:기존4화면+solo 내 도시6개=10장면×(출력/교차/내포/거리/부가글=5).
# 1280은 원위치10+진단9=69, 390은 누름1+진단9=60.
# F:경제4(교차2/화면1/기준자리1)+390의 표시1+5, 390 계절5+13.
# G:4배치×7(이름/도구/수/글/중심/1기해결/전체해결)+G7의3+5.
# H:390은12달×5(내포/가로/hit/고정/확정)+5, 나머지는5+순서1+5. 주제 확보는 준비(need).
# A 1자리·0.05 미만 달 INFO·재시도, B 학생 펼침 INFO, 선택 캡처는 하한 밖.
MINIMUM_BY_WIDTH = {
    1280: {'A': 9, 'B': 23, 'C': 17, 'D': 69, 'F': 9, 'G': 36, 'H': 11},
    1024: {'A': 0, 'B': 14, 'C': 0, 'D': 0, 'F': 9, 'G': 0, 'H': 11},
    390: {'A': 9, 'B': 0, 'C': 0, 'D': 60, 'F': 28, 'G': 36, 'H': 65},
}


class Checks(Rev14Checks):
    def __init__(self):
        out = os.environ.get('REV17_CAP')
        super().__init__(Path(out) if out else None)

    def shot(self, page, name, selector=None):
        if self.out is not None:
            super().shot(page, name, selector)

    def finish(self):
        print(f'checks {self.count} fail {self.failed} SKIP {len(self.skips)}', flush=True)
        return int(bool(self.failed))


def need(condition, label):
    if not condition:
        raise AssertionError('BLOCKED ' + label)


class Prep:
    """기존 도우미의 준비 판정은 하한에서 제외. 실패는 attempt가 1건 기록."""
    def ok(self, condition, label):
        need(condition, label)
        return True

    def test(self, label, fn):
        return self.ok(fn(), label)


def restore(page, base, fixture, guide=True):
    restore_fixture(Prep(), page, base, 'rev17 고정 시작', fixture)
    # 첫 달 코치 닫기 단추는 덱 밖 누름이라 이미 열린 1월 예보 덱을 닫는다(fx-turn 바깥 누름 닫기 계약).
    # 예보·카드를 1월에 재는 장면(B·C)은 guide=False로 복원하고 덱을 잰 뒤 코치를 닫는다.
    if guide:
        dismiss_guide(page)


def result(page):
    page.wait_for_function("() => ['review','end'].includes((KCP.league.state().S||KCP.league.state().snap).phase)")
    skip_replay(page)
    wait_unfolded(page)
    open_panel(page, 'result')
    frames(page)


def next_month(page):
    answer(page, 'keep', '계통 결과를 확인하고 유지해요.')
    page.wait_for_timeout(400)
    click_next(page, read(page)['S'])
    page.wait_for_function("() => KCP.league.state().S.phase==='plan'")
    dismiss_guide(page)


# #55 2자리 달 장면: 평택 기본 연결(normalStartPlans)만으로는 계통이 메운 하루 평균이 40~50 MWh/일이라
# 비교 기준이 늘 2 MWh/일 이상(1자리 달)이다. 연결된 디젤 한 기를 더하면 FXW4AAA8의 월 운영 값이
# 1월 1.93·2월 3.26·3월 0.90 MWh/일(fx_event_seeds 로더로 Node 재현)이다. 1월 기준(1주 시험)이 2 미만이면 1월,
# 아니면 2월(기준 = 1월 실제 1.93)이 2자리 달이다(맥 로컬 Chromium 1280·390은 1월). 두 기면 0이 되어 주제가
# 현금으로 바뀐다. 디젤 자리는 연결된 칸 옆 첫 적법 칸(칸 번호 순)이다.
ONE_DIESEL = r"""() => KCP.league.plan(st => {
  const id=KCP.league.state().team, B=KCP.buildGame;
  Object.assign(st, structuredClone(KCP.ECON_DATA.normalStartPlans[id]), {policies:[]});
  const connected=new Set(st.lines.flatMap(l=>l.p));
  const t=B.TILES.find(t=>!t.out && t.site<0 && !B.siteRule('diesel',t) && t.nb.some(i=>connected.has(i)));
  if (!t) throw Error('연결 디젤 칸 없음');
  st.builds.push({t:'diesel',i:t.i});
  st.lines.push({p:[t.nb.find(i=>connected.has(i)),t.i]});
})"""


def diesel_trial(page):
    # s7.plan_and_trial(change_after=False)와 같은 순서(코치·서랍 닫기 → 계획 → 1주 시험 → 서랍 닫기).
    dismiss_guide(page)
    close_drawer(page)
    need(page.evaluate(ONE_DIESEL), 'A 기본 연결 + 디젤 한 기 계획')
    page.wait_for_timeout(500)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    need((page.evaluate('() => KCP.buildGame.lastTrial()') or {}).get('days') == 7, 'A 1주 시험 저장')
    page.locator('#bd-drawer-x').click()
    page.wait_for_timeout(500)


def A(checks, page, base, width, fixture):
    # FXW4AAA8은 D-64 room salt와 첫 3달 사건이 고정된다. rev16 u55의 시작·시험·준비·결과 흐름에
    # 디젤 한 기를 더해 2자리 달(2월)을 만든다(위 ONE_DIESEL 주석).
    restore(page, base, fixture)
    chosen = None
    for month in range(1, 4):
        diesel_trial(page)
        ready(page, submit=False)
        topic = page.locator('[data-pred]').first.get_attribute('data-pred')
        page.locator('[data-evidence="grid"]').click()
        # 첫 달부터 복제 엔진 원값으로 결과와 다른 방향을 고른다. S7이 없으면
        # 다음 달 같은 절차로 재시도한다. 복제 운영은 원본 상태를 바꾸지 않는다.
        live = read(page)
        forecast = expected_operation(page, live['player'])
        if topic == 'grid':
            previous = live['S'].get('results', [])
            if previous:
                r = previous[-1]['team'][live['player']]
                baseline = max(0, r['isolated']['uns']-r['uns']-r['imp']+r['sub']) / previous[-1]['days']
            else:
                baseline = page.evaluate('() => KCP.buildGame.lastTrial().gridMWh/KCP.buildGame.lastTrial().days')
            delta = forecast['grid']/forecast['days']-baseline
            choice = 'same' if abs(delta) > max(.05, baseline*.05) else 'up'
        elif topic == 'cash':
            choice = 'same' if abs(forecast['cash']) > .5 else 'up'
        else:
            choice = 'same' if forecast['uns'] > .5 else 'up'
        page.locator('[data-pred]').first.select_option(choice)
        page.locator('[data-confidence="fairly"]').click()
        page.locator('#lg-ready-confirm').click()
        result(page)
        text = page.locator('#lg-promise-summary').inner_text()
        level = re.search(r'이번 달 하루 평균 ([\d,]+(?:\.\d+)?) MWh/일( 미만)?', text)
        delta = re.search(r'하루 평균 [＋+−-]?[\d,]+\.(\d+) MWh/일 변화', text)
        # 개정 2-4(c): 미만 달은 후보/1자리 INFO에서 제외하고 공통 다음 달 경로로 간다.
        if topic == 'grid' and level and level[2]:
            print(f'INFO A {width} {month}월 0.05 미만 수준값={level[0]!r}, 다음 달 재시도', flush=True)
        elif topic == 'grid' and level and delta:
            value_dd = page.locator('#lg-result-deltas [data-grid-fill] > dd:not(.lg-result-note)').first
            dd = value_dd.inner_text().strip() if value_dd.count() else ''
            chips = page.locator('[data-reason-start]').all_text_contents()
            need(chips, 'A S8 이유 시작 칩')
            if len(delta[1]) == 2:
                if shown(page, '#lg-outage-open'):
                    candidates = page.locator('#lg-outage-cards [data-missed]')
                    if candidates.count():
                        candidates.first.click()
                    if page.locator('#lg-outage-open').is_enabled():
                        page.locator('#lg-outage-open').click()
                        frames(page)
                actual = page.locator('[data-out-step="actual"] b').first.inner_text().strip() if shown(page, '[data-out-step="actual"] b') else None
                chosen = {'month': month, 'level': level[1], 'digits': len(delta[1]), 'dd': dd, 'actual': actual, 'chips': chips}
                checks.shot(page, f'A-{width}')
                if actual is not None:
                    break
            else:
                # 1자리 달은 끝 0 없는 기존 perDayText 계약을 INFO로만 기록.
                res = read(page)['S']['results'][-1]
                r = res['team'][live['player']]
                value = max(0, r['isolated']['uns']-r['uns']-r['imp']+r['sub']) / res['days']
                per_day = page.evaluate('v=>KCP.league.uiMath.perDayText(v)', value)
                same = level[1]+' MWh/일' == dd == per_day and any('평균 '+per_day+'이어서' in c for c in chips)
                print(f'INFO A {width} {month}월 1자리 perDayText 일치={same} 기대={per_day!r} X={level[1]!r} dd={dd!r} 칩={chips}', flush=True)
        if month < 3:
            next_month(page)
    need(chosen, f'A {width} 3달 안 계통 2자리 달 미확보')
    x = chosen['level']
    # 네 단언은 모두 같은 달의 한 수준값을 기준으로 비교한다.
    checks.ok(len(x.partition('.')[2]) == chosen['digits'], f'A1 {width} {chosen["month"]}월 수준값·Δ 2자리')
    checks.ok(chosen['dd'] == x+' MWh/일', f'A2 {width} 결과 dd = S6 수준값')
    if chosen['actual'] is None:
        checks.blocked(f'A3 {width} 3달 안 S7 필수 장면 없음')
    else:
        checks.ok(chosen['actual'] == x+' MWh/일', f'A3 {width} S7 실제 끝 = S6 수준값')
    checks.ok(any('평균 '+x+' MWh/일이어서' in c for c in chosen['chips']), f'A4 {width} S8 칩 = S6 수준값')


# 명세 #74-3: 범례는 제외 목록에 넣지 않는다. viewport∩canvas의 8px 격자.
GEOMETRY = r"""() => {
 const visible=e=>!!e&&!e.hidden&&e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility==='visible'&&Number(getComputedStyle(e).opacity)>0;
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
 const hit=(p,r)=>p.x>=r.x&&p.x<r.x+r.w&&p.y>=r.y&&p.y<r.y+r.h;
 const area=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 const canvas=document.querySelector('#bd-canvas');if(!canvas)return null;const map=box(canvas);
 const strip=document.querySelector('.fx-turn-strip'),cards=document.querySelector('.fx-turn-cards');
 const deck=visible(strip)?strip:visible(cards)?cards:null;if(!deck)return null;
 const d=box(deck), exclusions=[...document.querySelectorAll('#bd-hud,.lg-bar,#bd-mapbar,.lg-map-guidance,#lg-issue,#lg-issue-check,#bd-dock,#bd-run,#lg-panel')];
 if(document.documentElement.classList.contains('bd-drawer-open'))exclusions.push(document.querySelector('#bd-drawer'));
 const blocked=exclusions.filter(visible).map(box);let total=0,covered=0;
 for(let y=Math.max(0,map.y)+4;y<Math.min(innerHeight,map.y+map.h);y+=8)for(let x=Math.max(0,map.x)+4;x<Math.min(innerWidth,map.x+map.w);x+=8){const p={x,y};if(blocked.some(b=>hit(p,b)))continue;total++;if(hit(p,d))covered++;}
 const articles=[...document.querySelectorAll('.fx-turn-card')].filter(visible).map(e=>({
  overflow:e.scrollHeight>e.clientHeight+1,
  body:[...e.querySelectorAll('p')].filter(visible).map(p=>parseFloat(getComputedStyle(p).fontSize)),
  heads:[...e.querySelectorAll('h3')].filter(visible).map(p=>parseFloat(getComputedStyle(p).fontSize))}));
 const close=[...document.querySelectorAll('.fx-turn-cards button')].find(e=>visible(e)&&/닫기/.test(e.textContent+' '+e.getAttribute('aria-label')));
 const overlaps=[...document.querySelectorAll('#lg-panel,#bd-drawer,.lg-bar,#bd-hud,#lg-coach')].filter(visible).map(e=>area(d,box(e)));
 return {R:total?covered/total:null,total,strip:deck===strip,map,deck:d,articles,close:close?box(close):null,overlaps};
}"""


def deck_check(checks, page, width, kind, expected):
    page.wait_for_function("() => KCP.fxTurn.state().cardsOpen || KCP.fxTurn.state().forecastOpen", timeout=15000)
    frames(page)
    page.wait_for_timeout(420)  # 등장 애니메이션 뒤, 자동 닫힘 전.
    data = page.evaluate(GEOMETRY)
    need(data and data['total'] > 0 and data['R'] is not None, f'B {kind} 자동 덱·지도 표본')
    checks.ok(data['R'] <= .40, f'B1 {width} {kind} 자동 R={data["R"]:.4f} ≤0.40')
    auto = data
    if data['strip']:
        # 띠의 펼치기 단추 접근 이름은 '<사건 이름> 펼치기'(aria-label)라 글자 '펼치기'만으로는 찾지 못한다.
        page.locator('.fx-turn-strip .fx-turn-expand').click()
        frames(page)
        data = page.evaluate(GEOMETRY)
        need(data and not data['strip'], 'B 띠 펼치기 뒤 카드')
        print(f'INFO B5 {width} {kind} 학생 펼침 R={data["R"]}', flush=True)
    cards, close = data['articles'], data['close']
    checks.ok(bool(cards) and all(not c['overflow'] and c['body'] and min(c['body']) >= 13 and c['heads'] and min(c['heads']) >= 17 for c in cards)
              and close is not None and close['w'] >= 44 and close['h'] >= 44,
              f'B2 {width} {kind} 카드 넘침 0·본문13·제목17·닫기44')
    seen = set()
    for _ in range(len(expected) + 1):
        titles = page.locator('.fx-turn-card:visible h3:visible').all_text_contents()
        seen.update(t.strip() for t in titles)
        buttons = page.locator('.fx-turn-card:visible').get_by_role('button', name='다음', exact=True)
        enabled = [buttons.nth(i) for i in range(buttons.count()) if buttons.nth(i).is_visible() and buttons.nth(i).is_enabled()]
        if not enabled:
            break
        enabled[0].click()
        frames(page)
    checks.ok(all(any(title in s for s in seen) for title in expected), f'B3 {width} {kind} 모든 카드 제목 접근: {sorted(seen)} / {expected}')
    if width == 1280:
        m, d = auto['map'], auto['deck']
        checks.ok(0 <= d['x']-m['x'] <= 24, f'B4 {kind} 지도 왼쪽 24px 안')
        checks.ok(d['x']+d['w']/2 <= m['x']+m['w']/3, f'B4 {kind} 가운데가 지도 1/3 안')
        checks.ok(all(a == 0 for a in auto['overlaps']), f'B4 {kind} 서랍·막대·HUD·코치 교차0')


def event_names(page, mine=True):
    return page.evaluate("""mine => {const L=KCP.league.state(),S=L.S||L.snap,C=KCP.leagueCore,R=C.regionOf(S.region);
      return (S.events||[]).filter(e=>e.round===S.round).map(e=>C.eventDef(R,e.id)).filter(e=>!mine||C.hits(R,e,L.team)).map(e=>e.name);}""", mine)


def B(checks, page, base, width, fixture):
    # FXW4AAA8 1월 계절관리제, 2월 폭설. 장수는 자연 추첨 결과로 확인(주입 없음).
    # 1월 예보는 복원 직후 열리고 8초 뒤 닫힌다. 코치 닫기(덱 밖 누름)보다 먼저 잰다.
    restore(page, base, fixture, guide=False)
    captured = False
    found = set()
    for month in range(1, 5):
        names = event_names(page)
        if names and 'forecast' not in found:
            attempt(checks, f'B {width} 예보', lambda: deck_check(checks, page, width, '계획 예보', names))
            found.add('forecast')
        page.keyboard.press('Escape')
        trial(page)
        ready(page)
        page.wait_for_function("() => KCP.league.state().S.phase==='review'")
        skip_replay(page)
        # 결과 자동 덱을 열기 전에 다음 조작/서랍 전환을 하지 않는다.
        page.wait_for_function("() => KCP.fxTurn.state().cardsOpen", timeout=15000)
        names = event_names(page, mine=False)
        count = len(names) + 1
        key = {3: 'three', 2: 'two'}.get(count)
        if key and key not in found:
            # 기준판 league.js 5363: 첫 카드 title=monthLabel, 나머지 title=eventDef.name.
            # 결산 제목의 연도 유무는 표시 원문을 기대값으로 복사하지 않고 월로 대조한다.
            expected = [f'{month}월'] + names
            attempt(checks, f'B {width} {key}', lambda: deck_check(checks, page, width, key, expected))
            found.add(key)
            if not captured:
                checks.shot(page, f'B-{width}')
                captured = True
        if found == {'forecast', 'three', 'two'}:
            break
        result(page)
        next_month(page)
    for missing in sorted({'forecast', 'three', 'two'} - found):
        checks.blocked(f'B {width} 고정 방 필수 {missing} 장면 미확보')


# 리그의 재생 note(#bd-replay-note)는 운영 띠의 접힌 부분(#bd-run-detail, 기본 hidden)에 있어 학생이
# '그래프 열기'를 눌러야 보인다(build.js mountRunStrip, 기준판부터). 재생이 시작된 프레임에 그 단추를 눌러
# 펼친 뒤 보이는 note만 모은다. 이 단추는 재생을 끝내지 않는다(fx-turn stripControl).
REPLAY_NOTE = r"""() => {
 const p=window.__rev17Replay={notes:[],active:true,toggled:false};
 const scan=()=>{if(!p.active)return;const e=document.querySelector('#bd-replay-note');
  if(document.querySelector('#bd-root.bd-replaying')){
   const t=document.querySelector('#bd-run-toggle'),d=document.querySelector('#bd-run-detail');
   if(!p.toggled&&t&&d&&d.hidden&&t.getClientRects().length){t.click();p.toggled=true;}
   if(e&&!e.hidden&&e.getClientRects().length)p.notes.push(e.textContent.trim());
  }
  requestAnimationFrame(scan);};
 requestAnimationFrame(scan);
}"""


def C(checks, page, base, width, fixture, reduce=False):
    # fx_event_seeds: FXW4AAA8의 4월 spring_dust_haze 자연 발생을 독립 고정표로 보장.
    # 1월 예보 카드(계절관리제, 분위기 haze)의 note를 코치 닫기 전에 읽는다(B와 같은 까닭).
    restore(page, base, fixture, guide=False)
    card_seen = False
    replay_seen = reduce  # reduce는 기준판 계약상 재생 없음(C2는 일반 동작만).
    for month in range(1, 5):
        if not card_seen:
            page.wait_for_selector('.fx-turn-mood-note', state='attached', timeout=15000)
            texts = page.locator('.fx-turn-mood-note').all_text_contents()
            need(texts, 'C 분위기 달 카드')
            checks.ok(all(t.strip() == COPY['M1'] for t in texts), f'C1 {reduce=} 카드 M1')
            card_seen = True
        page.keyboard.press('Escape')
        trial(page)
        if not replay_seen:
            page.evaluate(REPLAY_NOTE)
        ready(page)
        if not replay_seen:
            page.wait_for_function('() => __rev17Replay.notes.length>0', timeout=15000, polling='raf')
            notes = page.evaluate('() => {__rev17Replay.active=false;return __rev17Replay.notes;}')
            checks.ok(bool(notes) and all(COPY['M1'] in n for n in notes), 'C2 일반 재생 띠 note M1')
            replay_seen = True
        result(page)
        if month == 4:
            ids = read(page)['S']['results'][-1].get('events', [])
            need('spring_dust_haze' in ids, 'C3 고정 방 4월 spring_dust_haze')
            open_panel(page, 'deal')
            source = page.locator('[data-event-source="spring_dust_haze"]')
            need(source.count() == 1, 'C3 사건 자료·출처 서랍')
            if not source.evaluate('e=>e.open'):
                source.locator('summary').click()
            # 이 사건은 재난 특별교부세(grant)가 있어 같은 details에 교부세 '출처:' 줄(법령 링크 2개)이 하나 더 있다.
            # 명세 #76-2의 '화면 출처 줄'은 사건 자신의 첫 '출처:' 줄이다.
            line = source.locator('p').filter(has_text=re.compile(r'^\s*출처:'))
            need(line.count() >= 1, 'C3 사건 출처 줄')
            links = line.first.locator('a').all()
            checks.ok(len(links) == 2, f'C3 {reduce=} 사건 출처 링크 2개')
            checks.ok(len(links) >= 2 and links[1].get_attribute('href') == 'https://doi.org/10.1088/1748-9326/ab905b', f'C3 {reduce=} 둘째 DOI')
        else:
            next_month(page)


def label_distance(row):
    return math.hypot(max(row['x']-row['ax'], 0, row['ax']-row['x']-row['w']),
                      max(row['y']-row['ay'], 0, row['ay']-row['y']-row['h']))


def label_check(checks, page, selector, mode, width, tag=''):
    scene = f'{width} {mode}' + (f' {tag}' if tag else '')
    cv = page.locator(selector)
    cv.wait_for(state='visible')
    frames(page)
    raw = cv.get_attribute('data-preview-labels')
    try:
        rows = json.loads(raw) if raw else []
        valid = len(rows) == 6 and all(all(k in r for k in ('id', 'x', 'y', 'w', 'h', 'ax', 'ay', 'moved', 'sub')) for r in rows)
    except (ValueError, TypeError):
        rows, valid = [], False
    # 명세가 정한 출력 부재는 FAIL, 장면 준비 BLOCKED로 바꾸지 않는다.
    checks.ok(valid, f'D {scene} data-preview-labels 6도시 출력')
    bounds = cv.bounding_box()
    pair_clear = valid and all(not (a['x'] < b['x']+b['w']+2 and b['x'] < a['x']+a['w']+2 and
                                    a['y'] < b['y']+b['h']+2 and b['y'] < a['y']+a['h']+2)
                               for i, a in enumerate(rows) for b in rows[i+1:])
    checks.ok(pair_clear, f'D1 {scene} 이름표 쌍 2px 간격 교차0')
    checks.ok(valid and all(r['w'] > 0 and r['h'] > 0 and r['x'] >= 0 and r['y'] >= 0 and
                           r['x']+r['w'] <= bounds['width'] and r['y']+r['h'] <= bounds['height'] for r in rows), f'D2 {scene} 캔버스 안')
    checks.ok(valid and all(not r['moved'] or label_distance(r) <= 64 for r in rows), f'D3 {scene} 기준점–상자 ≤64')
    state = page.evaluate("""mode=>{
      if(mode==='seat'){const L=KCP.league.state(),S=L.snap;return {active:S.active,player:document.querySelector('[data-seat][aria-pressed="true"]')?.dataset.seat,taken:Object.keys(S.teams).filter(id=>S.teams[id].seated)};}
      const active=mode==='host'?[...document.querySelectorAll('.lg-pickc input:checked')].map(e=>e.value):mode==='solo'?[...document.querySelectorAll('[data-solo-city]:checked')].map(e=>e.dataset.soloCity):KCP.leagueCore.regionOf('south').teams.map(t=>t.id);
      return {active,player:mode==='solo'?document.querySelector('#lg-solo-city').value:null,taken:[]};
    }""", mode)
    def sub(r):
        city = r['id']
        if mode == 'seat':
            return '이번 방 아님' if city not in state['active'] else '다른 팀' if city in state['taken'] else '고른 도시' if city == state['player'] else '비어 있음'
        return '내 도시' if city == state['player'] else '제외' if city not in state['active'] else '컴퓨터' if mode == 'solo' else '참가 도시'
    checks.ok(valid and all(r['sub'] == sub(r) for r in rows), f'D4 {scene} 상태별 부가 글자')
    if width == 1280:
        checks.ok(valid and all(r['moved'] is False for r in rows), f'D5 {scene} 모두 원위치')
    return rows if valid else []


def D(checks, context, base, width, pages):
    page, ev = monitored_page(context)
    pages.append((page, ev, 'lobby-host'))
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    for mode in ('solo', 'host', 'join'):
        select_mode(page, mode)
        rows = label_check(checks, page, '#lg-lobby-map', mode, width)
        if mode == 'solo' and width == 390:
            moved = [r for r in rows if r['moved']]
            if not rows:
                checks.ok(False, 'D6 data-preview-labels 부재로 이름표 누름 판정 불가')
            else:
                need(moved, 'D6 390 옮겨진 이름표')
                r, b = moved[0], page.locator('#lg-lobby-map').bounding_box()
                page.touchscreen.tap(b['x']+r['x']+r['w']/2, b['y']+r['y']+r['h']/2)
                frames(page)
                checks.ok(page.locator('#lg-solo-city').input_value() == r['id'], 'D6 옮긴 이름표 누름 → 내 도시')
        if mode == 'solo':
            checks.shot(page, f'D-{width}')
            cities = page.evaluate("() => KCP.leagueCore.regionOf('south').teams.map(t=>t.id)")
            need(len(cities) == 6, f'D {width} solo south 6도시')
            for city in cities:
                page.locator('#lg-solo-city').select_option(city)
                label_check(checks, page, '#lg-lobby-map', mode, width, tag=f'city={city}')
    select_mode(page, 'host')
    page.locator('[data-preset="2"]').click()
    page.locator('#lg-host').click()
    page.wait_for_selector('#lg-roomcode')
    room = page.locator('#lg-roomcode').inner_text()
    guest, ev = monitored_page(context)
    pages.append((guest, ev, 'seat'))
    guest.goto(base + '#league')
    guest.wait_for_function(BOOT_JS)
    select_mode(guest, 'join')
    guest.locator('#lg-code').fill(room)
    guest.locator('#lg-join').click()
    guest.wait_for_selector('#lg-seat-map', timeout=20000)
    guest.wait_for_function("() => !!KCP.league.state()?.snap")
    guest.locator('[data-seat]:not([disabled])').first.click()
    label_check(checks, guest, '#lg-seat-map', 'seat', width)


# 계획 전환 전에 설치한다. rAF에서 UI 단추를 누르므로 Python 왕복/기존 next의
# 400ms 대기가 끼지 않는다. 앱 함수·타이머·DOM 속성은 바꾸지 않는다.
# 이 검사에서는 명세의 '진행 뒤 300ms 안'을 '계획 시작 알림(수명 2.2초, ui/build.js toast)이 살아 있는 동안
# 서랍을 연다'로 해석한다(개정 4). 예보 닫기 시도(190ms 전) 뒤, 200ms가 지나고 서랍 없는 알림 프레임을 하나 이상
# 본 첫 프레임에 누른다. 그러면 알림 수명이 약 2초 남는다. 누른 뒤 잰 시각(click 동기 처리 포함)이 CI에서
# 308·331ms였으므로 장면 준비는 벽시계가 아니라 '알림 수명 안(data-show) 서랍이 열린 프레임 ≥1(aliveOpen)'로
# 본다. 표시 여부와 무관한 조건이라 390에서 알림이 서랍 뒤에 보이는지는 F2 단언이 판정한다(toast_check).
TOAST_PROBE = r"""() => {
 const p=window.__rev17Toast={active:true,start:null,clickAt:null,opened:null,rows:[],baseline:[],hidden:0,openFrames:0,aliveOpen:0,error:null};
 const visible=e=>!!e&&!e.hidden&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
 const area=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 const scan=()=>{
  if(!p.active)return;
  try {
   const L=window.KCP?.league?.state?.(),S=L?.S||L?.snap;
   if(S?.phase==='plan') {
    if(p.start===null)p.start=performance.now();
    const elapsed=performance.now()-p.start;
    // 자연 예보를 UI 닫기로 닫아 알림의 기존 보류 규칙을 존중한다.
    if(elapsed<190)for(const e of document.querySelectorAll('.fx-turn-close,.fx-turn-strip-close'))if(visible(e)) {e.click();break;}
    const panel=document.querySelector('#lg-panel'),drawer=document.querySelector('#bd-drawer'),e=document.querySelector('#bd-toast');
    const open=visible(panel)&&panel.dataset.tab==='deal';if(open)p.openFrames++;
    // 장면 조건(제품 표시와 무관): 계획 알림이 수명 안(data-show)인 동안 서랍이 열린 프레임. visibility·opacity는 보지 않는다.
    if(open&&e&&e.dataset.phase==='plan'&&e.dataset.show==='true')p.aliveOpen++;
    if(e&&visible(e)&&Number(getComputedStyle(e).opacity)>.05) {
     const b=box(e),s=getComputedStyle(e),root=document.querySelector('#bd-root'),rs=getComputedStyle(root);
     const value=(key,fallback)=>{const v=parseFloat(rs.getPropertyValue(key));return Number.isFinite(v)?v:fallback;};
     const row={box:b,panel:visible(panel)?area(b,box(panel)):0,drawer:visible(drawer)?area(b,box(drawer)):0,
      inside:b.x>=0&&b.y>=0&&b.x+b.w<=innerWidth&&b.y+b.h<=innerHeight,open,phase:e.dataset.phase};
     p.rows.push(row);
     if(!open&&p.opened===null&&e.dataset.phase==='plan')p.baseline.push({left:parseFloat(s.left),top:parseFloat(s.top),expected:Math.max(value('--lg-map-info-top',value('--lg-mapbar-bottom',210)),value('--lg-guidance-bottom',0))});
    } else p.hidden++;
    // 서랍 없는 계획 알림(F3 표본)을 한 프레임 이상 본 뒤에 연다. CPU 10배 1280에서 228ms 프레임에도 알림
    // opacity가 0(페이드인 0.18초)이었고, 그 프레임에 열면 F3 표본이 0이었다.
    if(elapsed>=200&&p.opened===null&&p.baseline.length) {
     const button=document.querySelector('#lg-bar [data-panel="deal"]');
     if(button){p.clickAt=performance.now()-p.start;button.click();p.opened=performance.now()-p.start;}
    }
   }
  }catch(e){p.error=String(e);}
  requestAnimationFrame(scan);
 };requestAnimationFrame(scan);
}"""


def toast_check(checks, page, width, label):
    page.wait_for_function('() => __rev17Toast.start!==null', timeout=20000)
    page.wait_for_timeout(11000)  # 예보에 보류된 알림도 원래 수명 전체까지 관측.
    p = page.evaluate('() => {__rev17Toast.active=false;return __rev17Toast;}')
    need(p['error'] is None, f'F 표본기 오류: {p["error"]}')
    need(p['opened'] is not None, f'F {label} 진행 뒤 서랍 열기: {p["opened"]}')
    # 진단용: 아래 aliveOpen 조건이 이것을 포함한다. 서랍이 아예 열리지 않은 경우를 따로 알리려고 남긴다.
    need(p['openFrames'] > 0, f'F {label} 거래 서랍 열림 관측')
    rows = [r for r in p['rows'] if r['phase'] == 'plan']
    need(rows, f'F {label} 계획 알림 rAF 관측')
    timing = f'누르기 직전 {p["clickAt"]:.1f}ms·누른 뒤 {p["opened"]:.1f}ms'
    # 장면 조건(모든 폭, 제품 표시와 무관): 계획 알림 수명 안에 서랍이 열린 프레임이 있어야 한다(개정 4).
    need(p['aliveOpen'] > 0, f'F {label} 알림 수명 안 서랍 열린 프레임 ≥1({timing})')
    shown_open = sum(1 for r in rows if r['open'])
    if width != 390:
        # 넓은 폭에는 '서랍 옆에 보이는 알림' 단언이 없으므로 F1이 서랍 없는 프레임만으로 공허하게 통과하지
        # 않게 장면 조건으로 둔다. 390은 같은 내용을 F2 단언이 판정한다(숨김이면 BLOCKED가 아니라 FAIL).
        need(shown_open > 0, f'F {label} 알림이 보이는 계획 프레임 중 서랍 열린 프레임 ≥1({timing})')
    checks.ok(all(r['panel'] == 0 for r in rows), f'F1 {width} {label} 모든 표시 프레임 panel 교차0')
    checks.ok(all(r['drawer'] == 0 for r in rows), f'F1 {width} {label} 모든 표시 프레임 build 서랍 교차0')
    checks.ok(all(r['inside'] for r in rows), f'F1 {width} {label} 모든 표시 프레임 화면 안')
    if width == 390:
        checks.ok(any(r['open'] for r in rows), f'F2 390 {label} 서랍 뒤 보이는 알림 ≥1프레임')
    # 진단용: 표본기는 이 표본을 본 뒤에만 서랍을 누르므로 opened가 있으면 늘 참이다.
    need(p['baseline'], f'F3 {label} 서랍 없는 계획 시작 알림 관측')
    checks.ok(all(abs(r['left']-8) <= 1 and abs(r['top']-r['expected']) <= 1 for r in p['baseline']), f'F3 {width} {label} 지도 안내 끝 아래·left8 기준판 자리')
    print(f'INFO F {width} {label} 표시 {len(rows)} 숨김 {p["hidden"]} {timing} 수명 안 서랍 {p["aliveOpen"]} 서랍과 함께 표시 {shown_open}', flush=True)
    checks.shot(page, f'F-{label}-{width}')


def F(checks, page, base, width, fixture):
    restore(page, base, fixture)
    trial(page)
    ready(page)
    result(page)
    answer(page, 'keep', '계통 결과를 확인하고 유지해요.')
    page.wait_for_timeout(400)
    close_drawer(page)
    # FXW4AAA8 2월: 폭설+계절관리제. next를 누르기 전에 표본기를 건다.
    page.evaluate(TOAST_PROBE)
    click_next(page, read(page)['S'])
    need(read(page)['S']['round'] == 2 and bool(event_names(page)), 'F 경제 사건 있는 2월')
    toast_check(checks, page, width, '경제')


def F_season(checks, context, base, width, pages):
    from fx_end import prepare
    host, team = seasonal(context, base, pages)
    for p, _, role in pages:
        if role != 'host':
            prepare(p)
    host.wait_for_function('() => Object.values(KCP.league.state().S.teams).filter(t=>t.seated).every(t=>t.ready)')
    host.evaluate('() => KCP.league.next()')
    team.wait_for_function("() => KCP.league.state().snap.phase==='review'")
    skip_replay(team)
    wait_unfolded(team)
    close_drawer(team)
    team.evaluate(TOAST_PROBE)
    host.evaluate('() => KCP.league.next()')
    team.wait_for_function("() => KCP.league.state().snap.phase==='plan' && KCP.league.state().snap.round===2")
    toast_check(checks, team, width, '계절')


def issue_line(unlinked):
    groups = {}
    for item in unlinked:
        name = item['name']
        groups[name] = groups.get(name, 0) + 1
    chunks = [name if n == 1 else f'{name} {n}기' for name, n in list(groups.items())[:3]]
    remaining = sum(list(groups.values())[3:])
    listing = ', '.join(chunks) + (' ' + fill('Q2', n=remaining) if remaining else '')
    return fill('Q1', 목록=listing) if groups else ''


def issue_setup(page, kinds):
    # rev12.unlinked_summary의 전선 밖 후보 칸 방식 + 공개 plan 입력.
    # 결과·이슈 목록·표지에는 손대지 않는다. 이름은 planIssues 공개 name으로만 읽는다.
    need(page.evaluate("() => KCP.league.plan(p=>Object.assign(p,{builds:[],lines:[],policies:[]}))"), 'G 빈 계획')
    close_drawer(page)
    frames(page)
    candidates = page.evaluate(CANDIDATES_JS)
    need(len(candidates) >= len(kinds), 'G 전선 밖 후보 칸')
    selected = page.evaluate("""({kinds,candidates})=>{
      const B=KCP.buildGame,used=new Set(),builds=[];
      for(const kind of kinds){const i=candidates.find(i=>!used.has(i)&&B.siteRule(kind,B.TILES[i])==='');if(i===undefined)return null;used.add(i);builds.push({t:kind,i});}
      return builds;
    }""", {'kinds': kinds, 'candidates': candidates})
    need(selected is not None, 'G 네 종류 설비의 적법한 후보 칸')
    need(page.evaluate('builds=>KCP.league.plan(p=>{p.builds=builds;})', selected), 'G 미연결 계획')
    page.wait_for_function('n=>KCP.buildGame.planIssues().unlinked.length===n', arg=len(kinds))
    return page.evaluate('() => KCP.buildGame.planIssues().unlinked')


def marks(page):
    return [s.strip() for s in page.locator('.bd-coach-mark').all_text_contents()]


def G(checks, page, base, width):
    # 평택 지도에는 기존 LNG(SITES plant)가 있어 빈 계획(선 0)에서 그것이 미연결 1기로 늘 끼고, '돌 설비 없음만'(G7)도
    # 만들 수 없다. 기존 발전소가 없는 안성으로 시작하면 빈 계획 = 미연결 0·공급 0이고 지은 설비만 미연결로 센다.
    start(page, base, city='anseong')
    for index, kinds in enumerate((['diesel'], ['diesel', 'diesel'], ['diesel', 'solar', 'solar', 'wind', 'biomass'],
                                   ['solar', 'wind', 'biomass', 'diesel', 'diesel']), 1):
        unlinked = issue_setup(page, kinds)
        need(len(unlinked) == len(kinds), 'G 정확한 미연결 기 수')
        need(index != 2 or len({b['name'] for b in unlinked}) == 1, 'G2 같은 이름 2기')
        need(index != 3 or len({b['name'] for b in unlinked}) == 4, 'G3 5기 4종')
        if index == 4:
            groups = list(dict.fromkeys(b['name'] for b in unlinked))
            need(len(groups) == 4 and sum(b['name'] == groups[3] for b in unlinked) == 2,
                 'G3b 넷째 배치 이름 4종·넷째 묶음 2기')
        page.locator('#lg-ready').click()
        page.wait_for_selector('#lg-issue-check', state='visible')
        names = page.locator('#lg-issue-check #lg-issue-names')
        checks.ok(names.count() == 1 and names.inner_text().strip() == issue_line(unlinked), f'{("G1", "G2", "G3", "G3b")[index - 1]} {width} 미연결 {len(kinds)}기 이름 독립 조립')
        page.locator('#lg-issue-fix').click()
        frames(page)
        checks.ok(page.locator('[data-tool="line"]').get_attribute('aria-pressed') == 'true', f'G4 {width} {index} 송전선 도구 눌림')
        data = marks(page)
        checks.ok(len(data) == min(len(unlinked), 4), f'G4 {width} {index} 표지 수 min(n,4)')
        checks.ok(data == [b['name'] for b in unlinked[:4]], f'G4 {width} {index} 표지 이름·순서')
        points = page.evaluate("""items=>{const B=KCP.buildGame,c=document.querySelector('#bd-canvas'),r=c.getBoundingClientRect();return items.map(b=>{const t=B.TILES[b.i],p=B.tileXY(t.c,t.r);return !!p&&p[0]>=Math.max(0,r.left)&&p[1]>=Math.max(0,r.top)&&p[0]<=Math.min(innerWidth,r.right)&&p[1]<=Math.min(innerHeight,r.bottom)&&document.elementFromPoint(p[0],p[1])===c;});}""", unlinked[:4])
        checks.ok(bool(points) and all(points), f'G5 {width} {index} 표지 대상 칸 중심 지도 안')
        if index == 3:
            checks.shot(page, f'G-{width}')
        first = unlinked[0]['i']
        need(page.evaluate('i=>KCP.league.plan(p=>{p.builds=p.builds.filter(b=>b.i!==i);})', first), 'G 한 기 철거 계획')
        disappeared = True
        try:
            page.wait_for_function("expected=>JSON.stringify([...document.querySelectorAll('.bd-coach-mark')].map(e=>e.textContent.trim()))===JSON.stringify(expected)", arg=[b['name'] for b in unlinked[1:4]], timeout=1200)
        except Exception:
            disappeared = False
        checks.ok(bool(data) and disappeared and marks(page) == [b['name'] for b in unlinked[1:4]], f'G6 {width} {index} 한 기 철거 뒤 1.2초 안 해제')
        need(page.evaluate('() => KCP.league.plan(p=>{p.builds=[];})'), 'G 모두 철거')
        try:
            page.wait_for_function("() => document.querySelectorAll('.bd-coach-mark').length===0", timeout=1200)
        except Exception:
            pass
        checks.ok(bool(data) and len(marks(page)) == 0, f'G6 {width} {index} 모두 해결 표지0')
    page.locator('#lg-ready').click()
    page.wait_for_selector('#lg-issue-check', state='visible')
    need(page.evaluate('() => {const p=KCP.buildGame.planIssues();return p.unlinked.length===0&&p.supplyMW===0;}'), 'G7 돌 설비 없음만')
    checks.ok(page.locator('#lg-issue-names').count() == 0, f'G7 {width} 미연결0 이름 줄 없음')
    page.locator('#lg-issue-fix').click()
    frames(page)
    checks.ok(page.locator('[data-tool="diesel"]').get_attribute('aria-pressed') == 'true', f'G7 {width} 디젤 도구')
    checks.ok(page.locator('.bd-coach-mark').count() == 0, f'G7 {width} 표지0')


PROMISE_VIEW = r"""() => {
 const body=document.querySelector('#lg-panel .lg-pbody'),e=document.querySelector('#lg-promise-baseline'),panel=document.querySelector('#lg-panel'),actions=document.querySelector('.lg-promise-actions'),button=document.querySelector('#lg-ready-confirm'),evidence=document.querySelector('#lg-evidence');
 if(!body||!e||!panel||!actions||!button||!evidence)return null;
 const b=e.getBoundingClientRect(),p=body.getBoundingClientRect(),a=actions.getBoundingClientRect(),d=panel.getBoundingClientRect(),c=button.getBoundingClientRect(),hit=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);
 const field=s=>{const el=document.querySelector(s);if(!el)return false;const r=el.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;};
 return {scroll:body.scrollTop,inside:b.top>=p.top-.5&&b.bottom<=p.bottom+.5&&b.left>=p.left-.5&&b.right<=p.right+.5,
  noOverflow:e.scrollWidth<=e.clientWidth+1,hit:!!hit&&(hit===e||e.contains(hit)),fixed:Math.abs(a.bottom-d.bottom)<=2,
  confirm:!button.hidden&&getComputedStyle(button).visibility==='visible'&&c.width>0&&c.height>0&&c.top>=0&&c.bottom<=innerHeight,
  afterEvidence:b.top>evidence.getBoundingClientRect().bottom,topic:document.querySelector('[data-pred]')?.dataset.pred,
  direction:field('.lg-field'),confidence:field('.lg-promise-confidence')};
}"""


def H(checks, page, base, width, fixture):
    # FXW4AAA8 고정 12달: 사건은 fixture 표, 주제는 실제 약속 창의 data-pred로 관측.
    # 첫 2달은 완비 계획(s7 normalStartPlans), 뒤 2달은 빈 계획, 이후 완비 계획.
    # 기준판 promiseTopic은 지난달 정전과 이번 시험 모두 0일 때 grid이므로 연속 두 달로
    # grid/uns를 얻는다. 원값 주제는 주입하지 않는다. 발생 여부는 브라우저 미확인.
    # 주제가 안 나오면 BLOCKED. 달 수는 항상 12(390)/1(데스크톱).
    restore(page, base, fixture)
    topics = set()
    months = 12 if width == 390 else 1
    for month in range(1, months+1):
        plan_and_trial(page, empty=month in (3, 4), change_after=False)
        ready(page, submit=False)
        page.locator('#lg-panel .lg-pbody').evaluate('e=>{e.scrollTop=0;}')
        frames(page)
        p = page.evaluate(PROMISE_VIEW)
        need(p and p['scroll'] == 0 and p['topic'], f'H {width} {month}월 약속 첫 화면')
        topics.add(p['topic'])
        checks.ok(p['inside'], f'H1 {width} {month}월 기준 줄 전체 본문 안')
        checks.ok(p['noOverflow'], f'H2 {width} {month}월 기준 줄 가로 넘침0')
        checks.ok(p['hit'], f'H3 {width} {month}월 기준 줄 가운데 hit')
        checks.ok(p['fixed'], f'H4 {width} {month}월 확정 줄 서랍 아래 고정 ±2')
        checks.ok(p['confirm'], f'H4 {width} {month}월 확정 단추 보임')
        if width != 390:
            checks.ok(p['afterEvidence'], f'H5 {width} 비교 기준은 근거 단추 아래')
        print(f'INFO H {width} {month}월 주제={p["topic"]} 방향 첫화면={p["direction"]} 확신 첫화면={p["confidence"]}', flush=True)
        if month == (2 if width == 390 else 1):
            checks.shot(page, f'H-{width}')
        page.locator('[data-evidence="grid"]').click()
        page.locator('[data-pred]').first.select_option('up')
        page.locator('[data-confidence="fairly"]').click()
        page.locator('#lg-ready-confirm').click()
        result(page)
        if month < months:
            next_month(page)
    if width == 390:
        need({'uns', 'grid'} <= topics, f'H 390 12달 필수 주제 미확보: {sorted(topics)}')


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
        checks.ok(not external, f'{item} {width} 외부 요청0(차단됨): {external}')
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--only', default=','.join(ITEMS))
    parser.add_argument('--widths', default='1280,1024,390')
    args = parser.parse_args()
    selected = set(args.only.split(','))
    try:
        widths = {int(w) for w in args.widths.split(',')}
    except ValueError:
        parser.error('--widths는 쉼표로 구분한 정수')
    if not selected or not selected <= set(ITEMS):
        parser.error('--only: ' + ','.join(ITEMS))
    if not widths or not widths <= set(MINIMUM_BY_WIDTH):
        parser.error('--widths: 1280,1024,390')
    checks = Checks()
    minimum = sum(MINIMUM_BY_WIDTH[w][k] for w in widths for k in selected)
    print(f'INFO 코드 기준 통과 하한 {minimum}, SKIP 가능 지점 0', flush=True)
    try:
        base = local_address(['rev17.py', args.base])
        fixtures = seeded_fixtures() if selected & set('ABCFH') else []
        fixture = next((f for f in fixtures if f['room'] == 'FXW4AAA8'), None)
        if selected & set('ABCFH'):
            need(fixture, '고정 방 FXW4AAA8 시작본')
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in SIZES:
                    if width not in widths:
                        continue
                    for item in ITEMS:
                        if item not in selected or MINIMUM_BY_WIDTH[width][item] == 0:
                            continue
                        fn = globals()[item]
                        if item == 'D':
                            single(checks, browser, base, item, width, height,
                                   lambda c, ps, w=width: D(checks, c, base, w, ps), multi=True)
                        else:
                            def action(p, f=fn, k=item, w=width):
                                return f(checks, p, base, w, fixture) if k in 'ABCFH' else f(checks, p, base, w)
                            single(checks, browser, base, item, width, height, action)
                        if item == 'C':
                            single(checks, browser, base, 'C-reduce', width, height,
                                   lambda p: C(checks, p, base, 1280, fixture, reduce=True), reduce=True)
                        if item == 'F' and width == 390:
                            single(checks, browser, base, 'F-season', width, height,
                                   lambda c, ps: F_season(checks, c, base, 390, ps), multi=True)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
