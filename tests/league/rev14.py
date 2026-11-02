"""rev14 명세 수용 검사. 작성 세션은 python3 -m py_compile만 실행한다.

브라우저는 허용된 샌드박스 밖 로컬 실행 담당자가 실행:
  REV14_CAP=tests/results/rev14 tests/.venv/bin/python tests/league/rev14.py \
    http://127.0.0.1:<포트>/index.html
결과/문구/DOM/CSS를 주입하지 않는다. M2/m4만 기존 events.push fixture 방식으로
해당 달 사건 입력을 바꾼다(결과 계산 전). M1은 로비 기본 room 씨앗으로 실제 12달 진행.
M1에서 2~11월에 원인 카드 달이 하나도 없는 방(씨앗)이면 새 컨텍스트·새 방으로 최대 3번 다시 시작한다(#63).
SKIP 허용: M2 사건·교부세 생성 불가, M3 무더위 날 없음. 나머지 미확보는 BLOCKED.
캡처 파일의 존재/브라우저 통과는 py_compile로 확인되지 않는다.
"""
import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, Checks as BaseChecks, context_for, diagnostics,
                    local_address, monitored_page, open_panel, overflow, shown)
from fx_end import dismiss_guide
from fx_replay import reach_result
from league_flow import pass_issue_check, select_mode, start_solo, wait_unfolded
from rev11 import DOM, InputBrowser, press
from s7 import plan_and_trial, current_attribution, assert_allocation_dom
from solo import click_next, close_drawer, read

G1 = '남은 특별교부세 {n}억은 새 설비·선로·재난 대응에 써요. 계획에 쓰고 남은 돈은 이달 말에 사라져요.'
H1 = '오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄며 공공시설 보수비가 한 번 들어요. 재난이라 특별교부세가 나와요.'
T1, T2 = '(내 예측과 같은 쪽)', '(내 예측과 반대쪽)'
VALUE = r'([+−-]?\d[\d,]*(?:\.\d+)?)\s*(MWh/일|%p)'
HEADER = r'(?:지난달 실제\s*→\s*이번 달 실제|시험\s*→\s*실제)\s*' + VALUE
# 기존 fx_end 검사에서 확인한 본문 카드. 끝 화면의 다른 펼친 카드도 함께 측정한다.
# .lg-end-more는 접힘 감싸개이므로 본문 장애물은 그 안의 .lg-sec/section/article이다.
END_CARDS = ('#lg-final-summary, #lg-decisions, .lg-fx-end, #lg-rank, #lg-trends, .lg-end-more > *, '
             '#lg-panel .lg-pbody section, #lg-panel .lg-pbody article, '
             '#lg-panel .lg-pbody .lg-sec')

END_PROBE = r"""selector => {
  if(window.__rev14End) window.__rev14End.active=false;
  const p=window.__rev14End={active:true,seen:false,done:false,endSeen:false,frames:0,
    bodyFrames:0,maxArea:0,violations:0,minLeft:null,maxRight:null,width:innerWidth,
    selectors:selector,targets:[],samples:[],error:null};
  const {visible,box,area}=(""" + DOM + r""");
  const scan=()=>{
    if(!p.active)return;
    try {
      const state=KCP.league.state(), V=state?.S||state?.snap;
      const ended=V?.phase==='end'&&visible(document.querySelector('#lg-final-summary'));
      if(ended) {
        p.endSeen=true;
        const toast=document.querySelector('#bd-toast');
        const opacity=toast?+getComputedStyle(toast).opacity:0;
        if(visible(toast)&&opacity>0.05) {
          const r=box(toast);p.seen=true;p.frames++;
          p.minLeft=p.minLeft===null?r.left:Math.min(p.minLeft,r.left);
          p.maxRight=p.maxRight===null?r.right:Math.max(p.maxRight,r.right);
          const cards=[...document.querySelectorAll(selector)].filter(visible);
          if(cards.length)p.bodyFrames++;
          let bad=r.left<0||r.right>innerWidth;const overlaps=[];
          for(const card of cards) {
            const key=card.id||card.className;
            if(!p.targets.includes(key))p.targets.push(key);
            const a=area(r,box(card));p.maxArea=Math.max(p.maxArea,a);
            if(a>0){bad=true;overlaps.push({target:key,area:a});}
          }
          if(bad){p.violations++;if(p.samples.length<8)p.samples.push({toast:r,overlaps});}
        } else if(p.seen) {p.done=true;p.active=false;return;}
      }
    } catch(e){p.error=String(e);p.active=false;return;}
    requestAnimationFrame(scan);
  };requestAnimationFrame(scan);
}"""

# 운영 중 0.1초마다 읽는다. Python 도우미가 동기 대기 중이어도 관측은 계속된다.
BAND_PROBE = r"""() => {
  if(window.__rev14Band) clearInterval(window.__rev14Band.timer);
  const p=window.__rev14Band={samples:0,hot:0,heat:0,firstHot:null,texts:[]};
  p.timer=setInterval(()=>{
    const active=!!document.querySelector('#bd-root.bd-replaying') ||
      document.documentElement.classList.contains('bd-running');
    const el=document.querySelector('#bd-run-wx');
    if(!active||!el||!el.getClientRects().length)return;
    const text=el.innerText;p.samples++;
    if(p.texts.length<20&&!p.texts.includes(text))p.texts.push(text);
    if(text.includes('무더위')){p.hot++;p.firstHot??=performance.now();}
    if(text.includes('폭염'))p.heat++;
  },100);
}"""


class Checks(BaseChecks):
    def __init__(self, out):
        super().__init__()
        self.out, self.skips = out, []

    def blocked(self, text):
        self.ok(False, 'BLOCKED ' + text)

    def skip(self, label, reason):
        self.skips.append((label, reason))
        print(f'SKIP {label}: {reason}', flush=True)

    def shot(self, page, name, selector=None):
        def save():
            self.out.mkdir(parents=True, exist_ok=True)
            if selector:
                page.locator(selector).first.scroll_into_view_if_needed()
            page.screenshot(path=str(self.out / (name + '.png')), full_page=False)
            return True
        self.test('캡처 ' + name, save)

    def finish(self):
        print(f'INFO SKIP {len(self.skips)}건 (통과 단언에 넣지 않음)', flush=True)
        print(f'assertions {self.count} failures {self.failed}', flush=True)
        return int(bool(self.failed))


def attempt(checks, label, action):
    try:
        return action()
    except Exception as exc:
        checks.blocked(f'{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
        return None


def number(text, pattern=VALUE):
    found = re.search(pattern, text)
    if not found:
        return None
    return Decimal(found[1].replace('−', '-').replace(',', '')), found[2]


def text(page, selector):
    node = page.locator(selector)
    return node.first.inner_text().strip() if node.count() else ''


def start_room(checks, page, base):
    """rev11.start의 시작 도우미를 재사용하되 fixed 선택을 하지 않는다."""
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    checks.ok(page.locator('#lg-solo-seed').input_value() == 'room', 'M1 로비 기본 room 씨앗')
    start_solo(page, months=12)
    page.wait_for_selector('#bd-canvas')
    dismiss_guide(page)
    state = read(page)['S']
    print(f'INFO room={state.get("room")} seedMode={state.get("seedMode")} (로비 기본)', flush=True)


def submit(page, touch):
    close_drawer(page)
    press(page, '#lg-ready', touch)
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    page.locator('#lg-predict [data-evidence]').first.click()
    select = page.locator('#lg-predict [data-pred]')
    topic = select.get_attribute('data-pred')
    select.select_option('up')
    press(page, '[data-confidence="fairly"]', touch)
    page.locator('#lg-ready-confirm').scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    press(page, '#lg-ready-confirm', touch)
    page.wait_for_selector('#lg-ready-confirm', state='hidden')
    return topic


def evidence(checks, page, label, s6, target):
    summary = text(page, '#lg-outage-evidence summary')
    checks.ok(bool(summary), label + ' m3 접힘 제목 존재')
    if not summary:
        return
    prediction = re.search(r'(계통[^:]*|정전|현금) 예측:\s*(늘 것|줄 것|같을 것)', s6)
    direct = number(summary, r'직접 연결 몫[^+−\d]*' + VALUE)
    expected = ''
    if prediction and direct:
        topic = 'grid' if prediction[1].startswith('계통') else 'uns' if prediction[1] == '정전' else 'cash'
        direction = {'늘 것': 1, '줄 것': -1, '같을 것': 0}[prediction[2]]
        part = (direct[0] > 0) - (direct[0] < 0)
        matched = topic == target and topic in ('grid', 'uns')
        if direction and part and matched:
            expected = T1 if direction == part else T2
    if '직접 연결 몫' in summary:
        checks.ok(prediction is not None and direct is not None,
                  label + ' m3 화면에서 예측 방향·직접 연결 표시 몫 추출: ' + s6 + ' / ' + summary)
    checks.ok(bool(re.search(re.escape(' ' + expected) + r'(?: 외 \d+개)?$', summary)) if expected else T1 not in summary and T2 not in summary,
              f'{label} m3 꼬리 {expected or "없음"}: {summary}')
    return summary


def compare_month(checks, page, month, width, touch, capture):
    label = f'{width} {month}월'
    open_panel(page, 'result')
    s6 = text(page, '#lg-promise-summary')
    head = number(text(page, '#lg-missed'), HEADER)
    delta = number(s6, r'하루 평균\s*(?:Δ\s*)?' + VALUE)
    # 정전 S6는 '하루 평균'을 붙이지 않는 기존 판정 줄도 허용한다.
    if not delta:
        delta = number(s6, r'(?:하루 평균\s*)?Δ\s*' + VALUE)
    if not delta and '%p' in s6:
        # 정전 판정: '지난달 대비 늘어남(+X%p)'의 괄호 숫자.
        verdict = re.search(r'실제 결과:[^()]*?(?:같음|늘어남|줄어듦)\(([^)]*)\)', s6)
        values = list(re.finditer(VALUE, verdict[1])) if verdict else []
        # 같음 괄호 안 첫 값은 ±0.5%p 범위다. 실제 Δ는 마지막 값이다.
        delta = number(values[-1][0]) if values else None
    cards = page.locator('#lg-outage-cards [data-missed]')
    share, card_month = None, cards.count() > 0
    if card_month:
        checks.ok(delta is not None and head is not None, label + ' M1 S6 Δ·S7 머리 숫자 추출: ' + s6)
        if delta and head:
            checks.ok(delta == head, f'{label} M1 S6 = S7: {delta} / {head}')
        first = cards.first
        first.scroll_into_view_if_needed()
        first.tap() if touch else first.click()
        if shown(page, '#lg-outage-open'):
            press(page, '#lg-outage-open', touch)
        checks.ok(shown(page, '#lg-outage-waterfall'), label + ' M1 카드 선택 뒤 폭포 표시')
        rows = page.locator('#lg-outage-waterfall [data-out-step]').evaluate_all(
            'ns=>ns.map(n=>({key:n.dataset.outStep,text:n.innerText}))')
        parts = [number(row['text']) for row in rows if row['key'] not in ('previous', 'trial', 'actual')]
        checks.ok(bool(parts) and all(p is not None for p in parts), label + ' M1 폭포 모든 몫 숫자 추출')
        if head and parts and all(p is not None for p in parts):
            visible = {row['key']: number(row['text'])[0] for row in rows if number(row['text'])}
            assert_allocation_dom(checks, page, current_attribution(page), visible, label)
        leader = page.locator('#lg-outage-cards [data-missed]').filter(
            has=page.locator('[data-out-tag="largest"]')).first
        checks.ok(leader.count() > 0, label + ' M1 가장 큰 것 카드 있음')
        if leader.count():
            share = number(leader.locator('.lg-out-size').inner_text())
            checks.ok(share is not None, label + ' M1 가장 큰 것 숫자 추출')
        evidence(checks, page, label, s6, 'grid' if head and head[1] == 'MWh/일' else 'uns')
        if not capture['summary']:
            checks.shot(page, 'm3-summary', '#lg-outage-evidence summary')
            capture['summary'] = True
    elif page.locator('#lg-outage-single').count():
        single = text(page, '#lg-outage-single')
        diff = number(single, r'(?:이번 )?차이\s*' + VALUE)
        # rev14b A1: 두 자리 계통 달도 S6/S7 같은 숫자다.
        if diff is None and '카드 최소 크기' in single:
            # 문턱이 '차이의 5%'가 아니라 카드 최소 크기인 달은 요약에 차이 숫자가 없다(비교 대상 없음).
            print(f'INFO {label} M1 단일 요약에 차이 숫자 없음(카드 최소 크기 문턱): {single}', flush=True)
        else:
            checks.ok(bool(single) and diff is not None and delta is not None and
                      diff == (abs(delta[0]), delta[1]),
                      label + ' M1 카드 없는 달 차이 = S6 Δ 절댓값: ' + single + ' / ' + s6)
    else:
        # rev14 검사 고침 지시 2: 카드·단일 요약이 모두 없는 달은 비교 대상이 없다.
        print(f'INFO {label} M1 원인 비교 제외: #lg-outage-single 없음, 원인 카드 없음', flush=True)
    w1 = shown(page, '#lg-outage-round-note[data-round-note="w1"]')
    if w1:
        capture['w1'] += 1
    chosen = card_month and (not capture['kind'] or w1 and capture['kind'] != 'W1')
    if chosen:
        capture['kind'], capture['month'] = 'W1' if w1 else 'card', month
        checks.shot(page, f'm1-{width}-s6', '#lg-promise-summary')
        checks.shot(page, f'm1-{width}-s7', '#lg-outage-waterfall')
    if share:
        checks.ok(shown(page, '#lg-outage-carry'), label + ' M1 다음 달 이어붙이기 단추')
        if shown(page, '#lg-outage-carry'):
            press(page, '#lg-outage-carry', touch)
    overflow(checks, page, label)
    return {'share': share, 'capture': bool(chosen)}


def carry_values(carry):
    """다음 달 carry 줄의 '가장 큰 몫' 값들. 크기가 같은 가장 큰 몫이 여럿이면 앱이 ' / '로 모두 적는다
    (league.js missedCarryHTML의 largestParts). 비용(억/일)은 VALUE 단위가 아니라 잡히지 않는다."""
    found = re.search(r'가장 큰 몫(.*)', carry)
    return [number(m[0]) for m in re.finditer(VALUE, found[1])] if found else []


def next_carry(checks, page, width, month, result):
    if not result or not result['share']:
        return
    open_panel(page, 'journal')
    carry = text(page, '#lg-missed-carry')
    values = carry_values(carry)
    # 공동 가장 큼이면 카드의 '가장 큰 것'(첫 공동 카드)이 carry에 적힌 공동 몫 가운데 하나여야 한다.
    checks.ok(result['share'] in values if len(values) > 1 else values[:1] == [result['share']],
              f'{width} {month}월 M1 가장 큰 것 = 다음 달 carry: {result["share"]} / {values}: {carry}')
    if result['capture']:
        checks.shot(page, f'm1-{width}-next', '#lg-missed-carry')
    close_drawer(page)


def finish_end(checks, page, width):
    state = read(page)['S']
    if state['phase'] != 'end':
        click_next(page, state)
    page.wait_for_selector('#lg-final-summary', state='visible')
    if width == 1280:
        checks.shot(page, 'o1-end-1280')
    try:
        page.wait_for_function('() => window.__rev14End?.done || window.__rev14End?.error', timeout=8000)
    except Exception:
        pass
    p = page.evaluate('() => {const p=window.__rev14End;p.active=false;return p;}')
    print(f'INFO {width} O1 선택자={END_CARDS} 측정={json.dumps(p, ensure_ascii=False)}', flush=True)
    checks.ok(p['error'] is None, f'{width} O1 rAF 오류 없음')
    if not p['frames']:
        checks.blocked(f'{width} O1 측정 프레임 0')
    checks.ok(p['done'] and p['bodyFrames'] == p['frames'] and bool(p['targets']),
              f'{width} O1 끝 화면 본문 관측·알림 소멸까지 완료')
    checks.ok(p['violations'] == 0 and p['maxArea'] == 0, f'{width} O1 모든 프레임 교차 넓이 0')
    checks.ok(p['minLeft'] is not None and p['minLeft'] >= 0 and
              p['maxRight'] is not None and p['maxRight'] <= p['width'], f'{width} O1 좌우 화면 안')


# room 씨앗에 따라 2~11월에 원인 카드 달이 한 번도 없는 방이 있다(모든 달이 단일 요약이거나 비교 대상 없음).
# 카드 장면은 이 검사의 핵심이므로 SKIP으로 넘기지 않고 새 방으로 다시 시작한다. 마지막 시도에서도 없으면 실패.
M1_TRIES = 3


def months(checks, page, base, width, touch, last=True):
    start_room(checks, page, base)
    plan_and_trial(page)
    capture = {'kind': None, 'month': None, 'w1': 0, 'summary': False}
    compared = 0
    for month in range(1, 13):
        state = read(page)['S']
        if state['phase'] != 'plan' or state['round'] != month:
            raise AssertionError(f'{month}월 계획 미확보: {state["round"]}/{state["phase"]}')
        if month == 12:
            page.evaluate(END_PROBE, END_CARDS)
        submit(page, touch)
        reach_result(page, month)
        page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        wait_unfolded(page)
        result = None
        if 2 <= month <= 11:
            result = attempt(checks, f'{width} {month}월 M1/m3',
                             lambda: compare_month(checks, page, month, width, touch, capture))
            compared += result is not None
        if month == 12:
            finish_end(checks, page, width)
            break
        state = read(page)['S']
        if state['round'] == month:
            click_next(page, state)
        attempt(checks, f'{width} {month}월 다음 carry', lambda: next_carry(checks, page, width, month, result))
    checks.ok(compared >= (10 if width == 390 else 3), f'{width} M1 월별 검사 확보 수 {compared}')
    # 달 비교가 예외(BLOCKED)로 빠진 실행은 씨앗 탓이 아니므로 다시 시작하지 않는다.
    if capture['kind'] is None and compared == 10 and not last:
        print(f'INFO {width} M1 원인 카드 달 없음(room 씨앗) — 새 방으로 다시 시작', flush=True)
        return False
    checks.ok(capture['kind'] is not None and capture['summary'], f'{width} M1 카드·m3 캡처 장면 확보')
    print(f'INFO {width} M1 W1 보인 달 수 {capture["w1"]}, 캡처 {capture["month"]}월/{capture["kind"]}', flush=True)
    overflow(checks, page, f'{width} 끝 화면')
    return True


# 기존 tests/league/econui.py·bots36.py의 사건 입력 fixture 방법. 엔진 실행 전에만 적용.
FORCE_EVENT = r"""id => {
  const L=KCP.league.state(), S=L.S, C=KCP.leagueCore;
  if(!S||S.phase!=='plan')return {ok:false,reason:'실제 혼자 하기 계획 상태 없음'};
  const R=C.regionOf(S.region), E=C.eventDef(R,id);
  if(!E||!C.hits(R,E,L.team))return {ok:false,reason:'우리 도시 적용 사건 없음'};
  S.events=S.events.filter(e=>e.round!==S.round);
  S.events.push({id,round:S.round,x:1});
  if(L.snap&&L.snap!==S){L.snap.events=L.snap.events.filter(e=>e.round!==S.round);
    L.snap.events.push({id,round:S.round,x:1});}
  return {ok:true,round:S.round,name:E.name};
}"""


def reach_plan(page, month, touch):
    for current in range(1, month):
        submit(page, touch)
        reach_result(page, current)
        page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        click_next(page, read(page)['S'])


def event_case(checks, page, base, event, month):
    start_room(checks, page, base)
    reach_plan(page, month, True)
    made = page.evaluate(FORCE_EVENT, event)
    if not made['ok']:
        if event == 'heatwave_peak':
            checks.blocked('m4 폭염 사건 생성 불가: ' + made['reason'])
        else:
            checks.skip('M2 ' + event, made['reason'])
        return
    # 공개 계획 경로로 화면을 정상 갱신한다. 결과·문구는 주입하지 않는다.
    page.evaluate('() => KCP.league.plan(() => {})')
    page.wait_for_timeout(500)
    if event == 'heatwave_peak':
        open_panel(page, 'deal')
        # 사건 서랍의 heatwave 자료 블록을 기준으로 카드 본문을 찾는다. 기존 id를 사용한다.
        source = page.locator('[data-event-source="heatwave_peak"]')
        checks.ok(source.count() > 0, 'm4 사건 서랍 heatwave 카드 존재')
        if not source.count():
            checks.blocked('m4 카드 앞면 선택자 미확보: [data-event-source="heatwave_peak"]')
            return
        card = source.first.locator('xpath=ancestor::li[contains(concat(" ", normalize-space(@class), " "), " lg-ev ")][1]')
        if not card.count():
            checks.blocked('m4 카드 선택자 미확보: .lg-ev')
            return
        front = card.evaluate(r"""el=>[...el.querySelectorAll('p,span')]
          .filter(e=>!e.closest('details')&&!e.children.length).map(e=>e.innerText.trim())""")
        checks.ok(H1 in front, 'm4 폭염 사건 카드 앞면 H1 글자 그대로: ' + repr(front))
        checks.ok(card.evaluate('e=>e.scrollWidth<=e.clientWidth && e.getBoundingClientRect().left>=0 && e.getBoundingClientRect().right<=innerWidth'),
                  'm4 폭염 카드 가로 넘침 0')
        card.scroll_into_view_if_needed()
        checks.shot(page, 'm4-heat-card')
        overflow(checks, page, 'm4 폭염 사건 카드')
        return
    close_drawer(page)
    button = page.locator('.lg-money-info summary')
    if not button.count():
        checks.skip('M2 ' + event, '강제 사건 뒤 남은 교부세 ! 칩 생성 불가')
        return
    # n은 잔액 칩의 화면 숫자로 읽는다. 원문 기대값에 앱 formatter를 쓰지 않는다.
    chip = text(page, '[data-grant-chip]')
    amount = re.search(r'\+([\d,.]+)억', chip)
    if not amount:
        checks.skip('M2 ' + event, '남은 특별교부세 금액 화면 미확보: ' + chip)
        return
    expected = page.evaluate('() => KCP.ECON_DATA.disasterFacts.grant.text') if event == 'heavy_rain' else G1
    button.tap()
    pop = page.locator('.lg-money-info .lg-info-pop')
    checks.ok(pop.is_visible() and pop.inner_text().strip() == expected.replace('{n}', amount[1]),
              f'M2 {event} ! 팝업 글자 = 지정 문구, n={amount[1]}: ' + pop.inner_text())
    title = page.locator('[data-cap="budget"]').get_attribute('title') or ''
    checks.ok(('남으면 보수비' in title) if event == 'heavy_rain' else ('남으면 사라져요' in title and '남으면 보수비' not in title),
              'M2 칩 title도 같은 보수비 갈래: ' + title)
    checks.shot(page, 'm2-rain' if event == 'heavy_rain' else 'm2-cold')
    overflow(checks, page, 'M2 ' + event)


def summer(checks, page, base):
    start_room(checks, page, base)
    reach_plan(page, 7, True)
    page.evaluate(BAND_PROBE)
    submit(page, True)
    # reach_result는 준비 다음 운영을 누른다. Python 대기와 독립된 0.1초 관측기 사용.
    reach_result(page, 7)
    shot = False
    for _ in range(350):
        current = page.evaluate("() => ({text:document.querySelector('#bd-run-wx')?.innerText||'', active:!!document.querySelector('#bd-root.bd-replaying')})")
        if '무더위' in current['text'] and current['active'] and not shot:
            checks.shot(page, 'm3-band', '#bd-run-wx')
            shot = True
        if not current['active']:
            break
        page.wait_for_timeout(100)
    p = page.evaluate('() => {const p=window.__rev14Band;clearInterval(p.timer);return p;}')
    if current['active']:
        checks.blocked('M3 여름 운영 재생 종료까지 관측하지 못함')
    if not p['samples']:
        checks.blocked('M3 여름 운영 0.1초 표본 0')
        return
    checks.ok(p['samples'] > 0, 'M3 여름 운영 0.1초 표본 있음')
    checks.ok(p['heat'] == 0, 'M3 운영 띠 폭염 0회: ' + json.dumps(p, ensure_ascii=False))
    if not p['hot']:
        checks.skip('M3', '여름 대표 날씨에 무더위 날 없음: ' + repr(p['texts']))
    else:
        checks.ok(p['hot'] > 0, f'M3 무더위 관측 {p["hot"]}회')
        checks.ok(shot, 'M3 무더위가 보이는 순간 캡처')
    overflow(checks, page, 'M3 여름')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='tests/srv.py의 loopback 주소')
    args = parser.parse_args()
    checks = Checks(Path(os.environ.get('REV14_CAP', 'tests/results/rev14/')))
    try:
        base = local_address(['rev14.py', args.address])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                runs = [(390, 844, True, 'M1/O1', M1_TRIES, lambda p, last: months(checks, p, base, 390, True, last)),
                        (1280, 900, False, 'M1/O1', M1_TRIES, lambda p, last: months(checks, p, base, 1280, False, last)),
                        (390, 844, True, 'M2 rain', 1, lambda p, last: event_case(checks, p, base, 'heavy_rain', 7)),
                        (390, 844, True, 'M2 cold', 1, lambda p, last: event_case(checks, p, base, 'coldwave_heating', 1)),
                        (390, 844, True, 'M3', 1, lambda p, last: summer(checks, p, base)),
                        (390, 844, True, 'm4', 1, lambda p, last: event_case(checks, p, base, 'heatwave_peak', 7))]
                for width, height, touch, task, tries, run in runs:
                    for n in range(tries):
                        label = f'{width}x{height} {task}' + (f' (시도 {n + 1}/{tries})' if n else '')
                        # 다시 시작은 새 컨텍스트에서 한다(저장된 혼자 하기 판이 남지 않게).
                        context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
                        page, logs = monitored_page(context)
                        try:
                            done = attempt(checks, label, lambda: run(page, n == tries - 1))
                        finally:
                            diagnostics(checks, logs, label)
                            attempt(checks, label + ' 가로 넘침', lambda: overflow(checks, page, label))
                            checks.ok(not external, label + ' 외부 요청 0: ' + repr(external))
                            context.close()
                        if done is not False:
                            break
                    if tries > 1:
                        print(f'INFO {width}x{height} {task} M1 시도 {n + 1}회', flush=True)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'주소/브라우저 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
