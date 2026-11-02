"""rev18 명세(개정 3) 기반 독립 브라우저 수용 검사(A=R1, B=R2, C=R4, D=R5).

기대값은 명세와 ac00869의 화면 계약에서 정한다. 구현 중 ui 파일/diff는
읽지 않는다. 기존 공개 계획 입력·고정 시작본·UI 진행 도우미만 재사용하며
DOM/CSS/판정/타이머를 주입하지 않는다. 초점 해제와 첫 화면 scrollTop=0만
측정 조건으로 설정한다. R3의 S1~S8 전체 측정은 ux_task.py 담당이다.

허용된 샌드박스 밖 로컬 실행 담당자:
 tests/.venv/bin/python tests/league/rev18.py http://127.0.0.1:<포트>/index.html \\
   [--only A,B,C,D] [--widths 1280,1024,390]
REV18_CAP이 있을 때만 그 폴더에 PNG를 저장한다(단언 수에는 넣지 않음).
이 파일 작성 세션에서는 py_compile과 import만 수행한다. 장면/API 부재는
BLOCKED 실패이며 SKIP 경로는 없다. 기준판·수정판의 실제 브라우저 실행은
총괄 담당자가 수행해야 한다.
"""

import argparse
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright

from econui import (context_for, diagnostics, local_address, monitored_page,
                    overflow)
from fx_event import seeded_fixtures
from league_flow import finish_trial, pass_issue_check
from rev14 import Checks as Rev14Checks, attempt
from rev15 import start, trial, skip_replay
from rev17 import (Browser, Checks as Rev17Checks, PROMISE_VIEW, need,
                   next_month, restore, result)
from s7 import plan_and_trial
from s8n import ready
from score1 import frames
from ux_task import SCENE_JS


SIZES = ((1280, 900), (1024, 768), (390, 844))
ITEMS = tuple('ABCD')
DIAGNOSTICS = 5  # console error/warning/pageerror + 가로 넘침 + 외부 요청
# 정상 실행과 BLOCKED 실행 모두 고정 슬롯 수를 유지한다. 카드/칩 수에 따라
# checks.ok를 반복하지 않고, 각각의 전체 집합을 하나의 단언으로 판정한다.
A_PHASE = {1280: 3, 1024: 4, 390: 3}  # 한 줄/44/가로, 1024만 글자 자름
B_MONTH = 10  # 방향, 확신 위치, 확신44, 기준 내포/가로/hit, 고정, 확정, 근거, 가로
B_LATER_MONTH = B_MONTH - 2  # 2~12월 방향·확신 첫 화면/hit는 INFO만
B_H12 = B_MONTH + 11 * B_LATER_MONTH
C_PHASE = {1280: 6, 1024: 8}  # coach0/덱95/가로 + 코치3hit + 1024 Esc1/2
C_COACH_FOCUS = 2  # 1024 계획 별도 장면: 코치 내부 Esc1 코치 닫힘/덱 펼침 유지
# D 공통: 가로/조작 수/글자 수=3. 1280은 단추/칩/범례=3 추가.
# 좁은 폭은 초기 접힘8 + aria-controls1 + 펼침2 + 유지1 + 재접힘2
# + supply 보존1 + 자리 판단 2/8 범례/접힌 단추/칩3 + Esc 복원3
# =21 추가(공통3 포함 24).
D_BODY = {1280: 6, 1024: 24, 390: 24}
# 개정 2의 ac00869 실측. 현재 UI에서 기대값을 역산하지 않는다.
D_BASELINE = {1280: {'controls': 38, 'chars': 906},
              1024: {'controls': 40, 'chars': 821},
              390: {'controls': 39, 'chars': 633}}
MINIMUM_BY_WIDTH = {
    w: {
        'A': (1 if w == 390 else 2) * A_PHASE[w] + (2 if w == 1024 else 0) + DIAGNOSTICS,
        'B': B_MONTH + B_H12 + 2 * DIAGNOSTICS if w == 390 else 0,
        'C': (2 * (C_PHASE[w] + DIAGNOSTICS) +
              (C_COACH_FOCUS + DIAGNOSTICS if w == 1024 else 0)) if w in C_PHASE else 0,
        'D': D_BODY[w] + DIAGNOSTICS,
    } for w, _ in SIZES
}


class Checks(Rev17Checks):
    def __init__(self):
        out = os.environ.get('REV18_CAP')
        Rev14Checks.__init__(self, Path(out) if out else None)
        self.pending = None

    def ok(self, condition, label):
        if self.pending is not None:
            self.pending.append((bool(condition), label))
            return bool(condition)
        return super().ok(condition, label)

    def begin_scene(self):
        self.pending = []

    def end_scene(self, expected, label):
        rows, self.pending = self.pending, None
        # 마지막 측정 뒤 필수 운영/준비가 실패해도 별도 단언이 늘어나지 않게
        # 마지막 슬롯을 BLOCKED로 바꾼다. 정상 단언 수 오산도 조용히 통과하지 않는다.
        if len(rows) > expected:
            extra = '; '.join(text for _, text in rows[expected:])
            rows = rows[:expected - 1] + [(False, f'BLOCKED {label} 후속 오류/단언 초과: {extra}')]
        while len(rows) < expected:
            rows.append((False, f'BLOCKED {label} 필수 장면 미완료 슬롯 {len(rows)+1}/{expected}'))
        for condition, text in rows:
            self.ok(condition, text)

    def shot(self, page, name, selector=None):
        # rev17과 달리 선택 캡처를 단언 수에 넣지 않는다. 캡처 오류는 호출
        # 장면의 아직 남은 슬롯을 BLOCKED로 처리한다. 스크롤도 유발하지 않는다.
        if self.out is not None:
            self.out.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(self.out / (name + '.png')), full_page=False)


def info(label, value):
    print('INFO ' + label + ' ' + json.dumps(value, ensure_ascii=False, sort_keys=True), flush=True)


# 명세의 보임은 화면과 교차, 첫 화면은 전체 사각형과 모든 스크롤 조상
# 안(±1px, html/body 제외), hit는 자기 자신 또는 자손만 허용한다(조상 hit는 허용하지 않음).
# laid는 스크롤 아래에 있는 활성 근거 보존 검사용이며 화면 교차를 요구하지 않는다.
DOM = r"""(() => {
 const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,
  right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
 const laid=e=>{if(!e)return false;const r=box(e),s=getComputedStyle(e);
  return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const visible=e=>{if(!laid(e))return false;const r=box(e);
  return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;};
 const inside=(r,b,t=1)=>r.left>=b.left-t&&r.top>=b.top-t&&r.right<=b.right+t&&r.bottom<=b.bottom+t;
 const first=e=>{if(!visible(e))return false;const r=box(e);
  if(!inside(r,{left:0,top:0,right:innerWidth,bottom:innerHeight},0))return false;
  for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);
   if(p===document.body||p===document.documentElement)continue;
   if(/auto|scroll|hidden/.test(s.overflowX+' '+s.overflowY)&&!inside(r,box(p)))return false;}
  return true;};
 const hit=e=>{if(!visible(e))return false;const r=box(e),h=document.elementFromPoint(
  (r.left+r.right)/2,(r.top+r.bottom)/2);return !!h&&(h===e||e.contains(h));};
 const target=e=>e?{...box(e),visible:visible(e),laid:laid(e),first:first(e),hit:hit(e)}:
  {visible:false,laid:false,first:false,hit:false,width:0,height:0,bottom:null};
 return {box,laid,visible,inside,first,hit,target};
})()"""

BAR_VIEW = r"""() => {
 const {box,visible}=DOM_HELPERS,bar=document.querySelector('.bd-runs');
 if(!bar)return null;
 const controls=[...bar.querySelectorAll('#bd-pm,#bd-season,[data-run]')].filter(visible);
 const rows=controls.map(e=>{const r=box(e);
  const descendants=[e,...e.querySelectorAll('*')];
  return {...r,id:e.id||'run-'+e.dataset.run,text:e.textContent.trim(),
   unclipped:e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1&&
    descendants.every(n=>getComputedStyle(n).textOverflow!=='ellipsis')};});
 const panel=document.querySelector('#lg-panel'),p=visible(panel)?box(panel):null,b=box(bar);
 const overlap=p?Math.max(0,Math.min(b.right,p.right)-Math.max(b.left,p.left))*
  Math.max(0,Math.min(b.bottom,p.bottom)-Math.max(b.top,p.top)):null;
 return {rows,spread:rows.length?Math.max(...rows.map(r=>r.top))-Math.min(...rows.map(r=>r.top)):null,
  season:document.querySelector('#bd-season-t')?.textContent,bar:b,panel:p,overlap,
  panelTab:panel?.dataset.tab,panelFolded:panel?.dataset.folded,
  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
}""".replace('DOM_HELPERS', DOM)


def bar(checks, page, width, phase):
    frames(page)
    data = page.evaluate(BAR_VIEW)
    need(data and len(data['rows']) >= 2 and
         {'bd-pm', 'run-7'} <= {r['id'] for r in data['rows']}, f'A {width} {phase} 막대 필수 조작')
    if phase == 'result':
        need(data['panel'] and data['panelTab'] == 'result' and data['panelFolded'] != 'true',
             f'A {width} 결과 서랍 펼침')
    info(f'A {width} {phase} top 최대−최소(px)={data["spread"]:.3f}', data)
    checks.shot(page, f'A-{width}-{phase}')
    checks.ok(data['spread'] <= 4, f'A1 {width} {phase} 막대 한 줄 ≤4px')
    checks.ok(all(r['width'] >= 44 and r['height'] >= 44 for r in data['rows']),
              f'A2 {width} {phase} 보이는 막대 조작 모두 44px')
    if width == 1024:
        checks.ok(all(r['unclipped'] for r in data['rows']),
                  f'A3 {width} {phase} 조작 글자 자름·말줄임0')
    checks.ok(data['overflow'] <= 0, f'A {width} {phase} 가로 넘침0')
    return data


def A(checks, page, base, width):
    start(page, base)
    planning = bar(checks, page, width, 'plan')
    if width == 390:
        return  # 결과 서랍이 막대를 덮는 기준판 설계: 계획 단계만 측정한다.
    trial(page)
    ready(page)
    result(page)
    review = bar(checks, page, width, 'result')
    if width == 1024:
        checks.ok(bool(planning['season']) and planning['season'] == review['season'] and
                  all('bd-season' in {r['id'] for r in d['rows']} for d in (planning, review)),
                  'A4 1024 계획·결과 날짜 글자 동일·칩 표시')
        checks.ok(review['overlap'] == 0, 'A5 1024 결과 막대·펼친 결과 서랍 교차0')


PROMISE_TARGETS = r"""() => {
 const {box,target,laid}=DOM_HELPERS,body=document.querySelector('#lg-panel .lg-pbody');
 const evidence=[...document.querySelectorAll('#lg-predict [data-evidence]')].map(e=>({
  key:e.dataset.evidence,disabled:e.disabled,laid:laid(e),pressed:e.getAttribute('aria-pressed')==='true',
  s1:!!e.querySelector('.lg-s1-mark')}));
 return {direction:target(document.querySelector('#lg-predict [data-pred]')),
  confidence:[...document.querySelectorAll('#lg-predict [data-confidence]')].map(target),
  baseline:target(document.querySelector('#lg-promise-baseline')),
  confirm:target(document.querySelector('#lg-ready-confirm')),evidence,
  body:body?box(body):null,scroll:body?.scrollTop,windowScroll:scrollY,
  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
}""".replace('DOM_HELPERS', DOM)


def first_screen(page):
    page.locator('#lg-panel .lg-pbody').evaluate('e=>{e.scrollTop=0;}')
    page.evaluate('() => window.scrollTo(0,0)')
    frames(page)


def promise_measure(checks, page, width, month, path):
    first_screen(page)
    old, view = page.evaluate(PROMISE_VIEW), page.evaluate(PROMISE_TARGETS)
    need(old and old['topic'] and view['body'] and view['scroll'] == 0 and view['windowScroll'] == 0,
         f'B {path} {month}월 약속 첫 화면 구성')
    label = f'B {width} {path} {month}월'
    info(label + ' bottom', {'select': view['direction']['bottom'],
         'confidence': [e['bottom'] for e in view['confidence']], 'body': view['body']['bottom'],
         'topic': old['topic'], 'evidence': view['evidence']})
    checks.shot(page, f'B-{width}-{path}-{month:02d}')
    confidence = view['confidence']
    if month == 1:
        checks.ok(view['direction']['first'] and view['direction']['hit'], label + ' 방향 첫 화면·hit')
        checks.ok(len(confidence) == 3 and all(e['first'] and e['hit'] for e in confidence),
                  label + ' 확신 셋 첫 화면·hit')
    else:
        info(label + ' 방향·확신 첫 화면·hit(참고)',
             {'direction': view['direction'], 'confidence': confidence})
    checks.ok(len(confidence) == 3 and all(e['width'] >= 44 and e['height'] >= 44 for e in confidence),
              label + ' 확신 셋 모두 44px')
    checks.ok(old['inside'] and view['baseline']['first'], label + ' 비교 기준 전체 본문·첫 화면 안')
    checks.ok(old['noOverflow'], label + ' 비교 기준 가로 넘침0')
    checks.ok(old['hit'] and view['baseline']['hit'], label + ' 비교 기준 hit')
    checks.ok(old['fixed'], label + ' 확정 줄 서랍 아래 고정 ±2px')
    checks.ok(old['confirm'] and view['confirm']['visible'], label + ' 확정 단추 보임')
    # 이 고정 장면은 첫 달 네 근거, 이후 이웃의 지난달 정전까지 다섯 근거에
    # 값이 있다(ac00869의 공개 자료). 활성 칩 제거/비활성화를 함께 잡는다.
    # 값 없는 칩을 접는 구현에는 DOM 잔류를 강제하지 않는다.
    evidence = view['evidence']
    required = {'evening', 'wind', 'grid', 'fuel'} | ({'neighbor'} if month > 1 else set())
    active = [e for e in evidence if not e['disabled']]
    checks.ok(len(active) == len(required) and {e['key'] for e in active} == required and
              all(e['laid'] for e in evidence if not e['disabled'] or e['pressed'] or e['s1']),
              label + ' 활성 근거 모두 보존·숨김0(선택/S1 포함)')
    checks.ok(view['overflow'] <= 0, label + ' 가로 넘침0')
    return old['topic']


def B_first(checks, page, base):
    # 준비 → 준비 전 확인의 그대로 진행 → 약속. 첫 달 빈 계획 그대로이므로
    # 실제 이슈 확인 카드를 경유한다(s8n.ready → pass_issue_check).
    start(page, base)
    page.locator('#lg-ready').click()
    page.wait_for_selector('#lg-issue-check', state='visible')
    need(pass_issue_check(page), 'B first 준비 전 확인 그대로 진행')
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    promise_measure(checks, page, 390, 1, 'first')


def B_twelve(checks, page, base, fixture):
    restore(page, base, fixture)
    topics = set()
    for month in range(1, 13):
        plan_and_trial(page, empty=month in (3, 4), change_after=False)
        ready(page, submit=False)
        if month == 12:
            topic = page.locator('#lg-predict [data-pred]').get_attribute('data-pred')
            need({'uns', 'grid'} <= topics | {topic}, f'B H12 필수 주제 미확보: {sorted(topics)}')
        topics.add(promise_measure(checks, page, 390, month, 'H12'))
        # 첫 화면을 잰 다음에만 입력한다. Playwright 자동 스크롤이 측정을
        # 바꾸지 않는다. up은 정전0의 down 금지에도 안전한 실제 선택이다.
        page.locator('[data-evidence="grid"]').click()
        page.locator('#lg-predict [data-pred]').select_option('up')
        page.locator('[data-confidence="fairly"]').click()
        page.locator('#lg-ready-confirm').click()
        result(page)
        if month < 12:
            next_month(page)


DECK_VIEW = r"""() => {
 const {box,visible}=DOM_HELPERS,coach=document.querySelector('#lg-coach');
 const cards=[...document.querySelectorAll('.fx-turn-card')].filter(visible).map(card=>{
  const r=box(card),deck=card.closest('.fx-turn-cards'),style=getComputedStyle(card);
  const radii=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius',
   'borderBottomLeftRadius'].map(key=>{const parts=style[key].trim().split(/\s+/).map(parseFloat);
    return [parts[0],parts[1]??parts[0]];});
  // CSS는 인접 모서리 반지름의 합이 변 길이를 넘으면 네 모서리를 함께 줄인다.
  const scale=Math.min(1,r.width/(radii[0][0]+radii[1][0]),
   r.width/(radii[3][0]+radii[2][0]),r.height/(radii[0][1]+radii[3][1]),
   r.height/(radii[1][1]+radii[2][1]));
  const corners=radii.map(([rx,ry],i)=>{rx*=scale;ry*=scale;
   return {rx,ry,cx:i===0||i===3?r.left+rx:r.right-rx,
    cy:i<2?r.top+ry:r.bottom-ry,left:i===0||i===3,top:i<2};});
  let total=0,coachHits=0,deckHits=0,excludedRounded=0;
  for(let yi=0;yi<9;yi++)for(let xi=0;xi<9;xi++){
   const x=r.left+2+(r.width-4)*xi/8,y=r.top+2+(r.height-4)*yi/8;
   if(x<0||x>=innerWidth||y<0||y>=innerHeight)continue;
   if(corners.some(c=>c.rx>0&&c.ry>0&&(c.left?x<c.cx:x>c.cx)&&
    (c.top?y<c.cy:y>c.cy)&&((x-c.cx)/c.rx)**2+((y-c.cy)/c.ry)**2>1)){
    excludedRounded++;continue;}
   total++;const h=document.elementFromPoint(x,y);
   if(h&&coach&&(h===coach||coach.contains(h)))coachHits++;
   if(h&&deck&&(h===deck||deck.contains(h)))deckHits++;
  }
  return {box:r,radii,excludedRounded,total,coachHits,deckHits,ratio:total?deckHits/total:0};
 });
 return {coach:visible(coach),cards,over:!!document.querySelector('.fx-turn-layer[data-over="true"]'),
  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
}""".replace('DOM_HELPERS', DOM)

COACH_BUTTONS = ('#lg-coach-action', '#lg-coach-skip', '#lg-coach-close')


def body_focus(page):
    # body에 tabindex를 주입하거나 지도를 클릭하지 않는다(바깥 클릭은 덱을 닫음).
    page.evaluate('() => document.activeElement?.blur()')
    need(page.evaluate('() => document.activeElement===document.body'), 'C body 초점')


def expanded_deck(page, width, phase):
    key = 'forecastOpen' if phase == 'plan' else 'cardsOpen'
    page.wait_for_function('key => KCP.fxTurn.state()[key]===true', arg=key, timeout=15000)
    frames(page)
    expand = page.locator('.fx-turn-expand:visible')
    if width == 1024:
        need(expand.count() == 1, f'C {width} {phase} 펼치기 단추')
        expand.click()
    elif expand.count():
        expand.first.click()
    page.wait_for_selector('.fx-turn-card:visible', timeout=5000)
    page.wait_for_timeout(650)  # 카드 등장/뒤집기 애니메이션 뒤, 자동 닫힘(8~10초) 전
    frames(page)
    data = page.evaluate(DECK_VIEW)
    need(data['coach'] and data['cards'] and all(c['total'] > 0 for c in data['cards']),
         f'C {width} {phase} 코치·보이는 카드 표본점 확보')
    if width == 1024:
        need(data['over'], f'C {width} {phase} 학생이 펼친 덱 data-over=true')
    return data


def C(checks, page, base, width, fixture, phase):
    restore(page, base, fixture, guide=False)
    if phase == 'result':
        # trial()·plan_and_trial()은 코치를 닫으므로 여기서는 공개 시험 UI와
        # finish_trial만 쓴다. 결과도 코치가 붙은 실제 첫 달 운영으로 만든다.
        page.wait_for_function('() => KCP.fxTurn.state().forecastOpen', timeout=15000)
        page.locator('.fx-turn-close:visible, .fx-turn-strip-close:visible').first.click()
        page.locator('[data-run="7"]').click()
        finish_trial(page)
        page.locator('#bd-drawer-x').click()
        ready(page)
        page.wait_for_function("() => KCP.league.state().S.phase==='review'")
        skip_replay(page)
    data = expanded_deck(page, width, phase)
    label = f'C {width} {phase}'
    info(label + ' 9×9 표본점', data)
    checks.shot(page, f'C-{width}-{phase}')
    checks.ok(all(c['coachHits'] == 0 for c in data['cards']), label + ' 카드마다 코치 맞음0')
    checks.ok(all(c['ratio'] >= .95 for c in data['cards']), label + ' 카드마다 덱 hit 비율 ≥0.95')
    checks.ok(data['overflow'] <= 0, label + ' 가로 넘침0')
    if width == 1024:
        body_focus(page)
        page.keyboard.press('Escape')
        frames(page)
        after = page.evaluate(DECK_VIEW)
        checks.ok((not after['over'] or not after['cards']) and after['coach'],
                  label + ' body Esc1 펼침 닫힘·코치 남음')
    else:
        page.locator('.fx-turn-close:visible').click()
        frames(page)
    buttons = page.evaluate('sels => {const {target}=' + DOM +
                            ';return sels.map(s=>target(document.querySelector(s)));}', list(COACH_BUTTONS))
    for selector, button in zip(COACH_BUTTONS, buttons):
        checks.ok(button['visible'] and button['hit'], label + ' 덱 닫은 뒤 ' + selector + ' hit 복귀')
    if width == 1024:
        body_focus(page)
        page.keyboard.press('Escape')
        frames(page)
        checks.ok(not page.evaluate(DECK_VIEW)['coach'], label + ' body Esc2 코치 닫힘')


def C_coach_focus(checks, page, base, fixture):
    # body Esc 순서와 별도 컨텍스트에서 같은 첫 달 예보를 연다.
    restore(page, base, fixture, guide=False)
    before = expanded_deck(page, 1024, 'plan')
    page.locator('#lg-coach-action').focus()
    need(page.evaluate('() => document.activeElement===document.querySelector("#lg-coach-action")'),
         'C 1024 계획 코치 동작 단추 초점')
    page.keyboard.press('Escape')
    frames(page)
    after = page.evaluate(DECK_VIEW)
    info('C 1024 계획 코치 내부 초점 Esc1', after)
    checks.ok(not after['coach'], 'C 1024 계획 코치 내부 Esc1 코치 닫힘')
    checks.ok(after['over'] and len(after['cards']) == len(before['cards']),
              'C 1024 계획 코치 내부 Esc1 덱 펼침·보이는 카드 유지')


ISSUES_VIEW = r"""() => {
 const {target,visible}=DOM_HELPERS,fold=document.querySelector('#lg-plan-issues-fold');
 const chips=[...document.querySelectorAll('#lg-plan-issues [data-issue]')].map(e=>({
  key:e.dataset.issue,text:e.textContent.trim(),...target(e)}));
 const key=document.querySelector('#lg-map-key-info'),town=document.querySelector('#bd-town-look-key'),
  grid=document.querySelector('#lg-lens-grid');
 return {folds:[...document.querySelectorAll('#lg-plan-issues-fold')].filter(visible).length,
  fold:{...target(fold),text:(fold?.textContent||'').trim().replace(/\s+/g,' '),
   label:fold?.getAttribute('aria-label')??null,expanded:fold?.getAttribute('aria-expanded')??null,
   controls:fold?.getAttribute('aria-controls')??null},chips,
  legend:target(key),legendOpen:!!key?.open,legendPinned:key?.dataset.pinned,
  // ac00869의 1100 이하 범례 표시 조건. 내부 구현 함수는 호출하지 않는다.
  legendExpected:innerWidth<=1100&&!!town&&!!grid&&!(town.hidden&&(grid.hidden||grid.dataset.warn==='true')),
  coach:target(document.querySelector('#lg-coach')),step:document.querySelector('#lg-coach')?.dataset.step,
  task:document.querySelector('#lg-coach-task')?.textContent?.trim()||'',
  phase:(window.KCP?.league?.state?.()?.S||window.KCP?.league?.state?.()?.snap)?.phase,
  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
}""".replace('DOM_HELPERS', DOM)


def issue_input(page):
    # 칩을 DOM에서 제거하는 구현도 n을 줄여 기대값으로 삼지 못한다.
    # 공개 계획의 문제 종류로 ac00869의 1~3개 칩 집합을 독립적으로 정한다.
    p = page.evaluate('() => {const p=KCP.buildGame.planIssues();return '
                      '{unlinked:p.unlinked.length,waiting:p.waiting.length,supply:p.supplyMW};}')
    expected = {}
    if p['unlinked']:
        expected['line'] = f'전선에 안 닿은 설비 {p["unlinked"]}기'
    if p['waiting']:
        expected['wait'] = f'이번 달 접속 대기 {p["waiting"]}기'
    if p['supply'] == 0:
        expected['supply'] = '이번 달 돌 설비 없음'
    need(1 <= len(expected) <= 3, 'D 계획 확인 칩 1~3개 장면')
    return expected


def chips_match(view, expected):
    return len(view['chips']) == len(expected) and all(c['visible'] for c in view['chips']) and \
        {c['key']: c['text'] for c in view['chips']} == expected


def D(checks, page, base, width, fixture):
    restore(page, base, fixture, guide=False)
    page.wait_for_selector('#lg-coach[data-step="1"]')
    page.wait_for_timeout(1500)  # ux_task의 첫 달 코치 캡처와 같은 안정화 대기
    frames(page)
    expected = issue_input(page)
    view = page.evaluate(ISSUES_VIEW)
    need(view['coach']['visible'] and view['step'] == '1', f'D {width} 코치 1/8 계획 단계')
    scene = page.evaluate(SCENE_JS)
    info(f'D {width} 코치 1/8 SCENE_JS', scene)
    info(f'D {width} 계획 확인', view)
    checks.shot(page, f'D-{width}-coach-1')
    checks.ok(view['overflow'] <= 0, f'D {width} 코치 1/8 가로 넘침0')
    baseline = D_BASELINE[width]
    if width == 1280:
        checks.ok(scene['controls'] == baseline['controls'], 'D 1280 보이는 조작 수 =38')
        checks.ok(scene['chars'] == baseline['chars'], 'D 1280 보이는 글자 수 =906')
    else:
        checks.ok(scene['controls'] <= baseline['controls'] - 1,
                  f'D {width} 보이는 조작 수 ≤{baseline["controls"] - 1}')
        checks.ok(scene['chars'] <= baseline['chars'],
                  f'D {width} 보이는 글자 수 ≤{baseline["chars"]}')
    if width == 1280:
        checks.ok(view['folds'] == 0, 'D 1280 접힌 단추 없음/숨김')
        checks.ok(chips_match(view, expected), 'D 1280 기준판 칩 그대로 보임')
        checks.ok(not view['legend']['visible'], 'D 1280 기준판 범례 규칙(접힌 범례 단추 숨김)')
        return
    # ac00869의 planIssues/계획 확인 규칙: supplyMW==0이면 supply 경고가 있다.
    # 공개 계획과 실제 칩이 없는 장면으로 보존 검사를 통과시키지 않는다.
    need('supply' in expected and any(c['key'] == 'supply' for c in view['chips']),
         f'D {width} 공개 계획 공급0·supply 칩 장면 확보')
    folded_keys = set(expected) - {'supply'}
    need(folded_keys, f'D {width} supply 이외 접을 계획 확인 칩 확보')
    n, fold = len(folded_keys), view['fold']
    checks.ok(view['folds'] == 1, f'D1 {width} 접힌 단추 하나만 보임')
    checks.ok(not any(c['visible'] for c in view['chips'] if c['key'] in folded_keys),
              f'D2 {width} 접을 계획 확인 칩 안 보임(supply 제외)')
    checks.ok(fold['expanded'] == 'false', f'D3 {width} aria-expanded=false')
    checks.ok(fold['controls'] == 'lg-plan-issues', f'D {width} aria-controls=lg-plan-issues')
    checks.ok(fold['text'] == f'! 계획 확인 {n}개', f'D4 {width} R5a 보이는 글자·개수')
    checks.ok(fold['label'] == f'계획 확인 {n}개가 접혀 있어요. 누르면 펼쳐져요',
              f'D5 {width} R5b aria-label·개수')
    checks.ok(fold['width'] >= 44 and fold['height'] >= 44, f'D6 {width} 접힌 단추 44px')
    checks.ok(fold['hit'], f'D7 {width} 접힌 단추 hit')
    checks.ok(not view['legend']['visible'], f'D8 {width} 코치 중 닫힌 범례 숨김')
    # 기준판은 새 단추가 없다. 초기 실패/INFO를 모두 남긴 뒤 나머지 고정
    # 슬롯도 실패로 판정한다. 없는 단추를 대신 만들거나 SKIP하지 않는다.
    if fold['visible'] and fold['hit']:
        page.locator('#lg-plan-issues-fold').click()
        frames(page)
    expanded = page.evaluate(ISSUES_VIEW)
    checks.ok(chips_match(expanded, expected), f'D9 {width} 펼친 뒤 원래 칩 모두·글자 보존')
    checks.ok(expanded['fold']['expanded'] == 'true', f'D10 {width} 펼친 뒤 aria-expanded=true')
    page.wait_for_timeout(1100)  # 기존 500ms 갱신을 두 번 지나도 재접히지 않아야 한다.
    persistent = page.evaluate(ISSUES_VIEW)
    checks.ok(persistent['coach']['visible'] and chips_match(persistent, expected) and
              persistent['fold']['expanded'] == 'true', f'D11 {width} 코치 중 펼침 유지')
    if persistent['fold']['visible'] and persistent['fold']['hit']:
        page.locator('#lg-plan-issues-fold').click()
        frames(page)
    refolded = page.evaluate(ISSUES_VIEW)
    checks.ok(refolded['fold']['expanded'] == 'false', f'D {width} 다시 누르면 aria-expanded=false')
    checks.ok(not any(c['visible'] for c in refolded['chips'] if c['key'] in folded_keys),
              f'D {width} 다시 누르면 접을 칩 숨김(supply 제외)')
    need(any(c['key'] == 'supply' for c in refolded['chips']),
         f'D {width} 다시 접힌 장면 supply 칩 확보')
    checks.ok(all(any(c['key'] == 'supply' and c['text'] == expected['supply'] and c['visible']
                      for c in v['chips']) for v in (view, refolded)),
              f'D {width} 처음·다시 접힌 동안 supply 경고 글자·보임 유지')
    body_focus(page)
    page.keyboard.press('Escape')
    frames(page)
    closed = page.evaluate(ISSUES_VIEW)
    checks.ok(not closed['coach']['visible'] and chips_match(closed, expected),
              f'D12 {width} Esc 코치 닫힘·원래 칩 모두 복원')
    checks.ok(closed['folds'] == 0, f'D13 {width} 코치 닫으면 접힌 단추 없음/숨김')
    checks.ok(closed['legend']['visible'] == closed['legendExpected'],
              f'D14 {width} 코치 닫으면 기준판 범례 규칙 복귀')
    # 기존 접힌 상태의 Esc 복원 검사를 유지한 뒤 공개 도움말로 코치를 다시 연다.
    page.locator('#bd-help').click()
    page.locator('#lg-coach-again').click()
    page.wait_for_selector('#lg-coach[data-step="1"]', state='visible')
    # 건너뛰기는 내부 step 0→1, DOM data-step은 1→2로 바뀐다(ac00869).
    # 장면이 없으면 need/상위 attempt가 남은 고정 슬롯을 BLOCKED로 채운다.
    page.locator('#lg-coach-skip').click()
    page.wait_for_selector('#lg-coach[data-step="2"]', state='visible')
    frames(page)
    site = page.evaluate(ISSUES_VIEW)
    need(site['coach']['visible'] and site['step'] == '2' and site['phase'] == 'plan' and
         site['task'].startswith('자리 판단 · 2/8'),
         f'D {width} 건너뛰기 뒤 자리 판단 · 2/8(내부 step 1) 계획 장면 확보')
    info(f'D {width} 코치 2/8 자리 판단', site)
    # <summary>는 Chromium 접근성 트리에서 button role이 아니므로 접근 이름 속성으로 찾는다(rev12와 같음).
    legend = page.locator('[aria-label="범례·여유: 지도 범례와 접속 여유 보기"]')
    checks.ok(legend.count() == 1 and legend.evaluate('e => (' + DOM + ').visible(e)'),
              f'D {width} 자리 판단 2/8 범례 단추 접근 이름·보임')
    checks.ok(site['folds'] == 0, f'D {width} 자리 판단 2/8 접힌 단추 없음/숨김')
    checks.ok(chips_match(site, expected), f'D {width} 자리 판단 2/8 원래 칩 모두·글자 보존')


def single(checks, browser, base, item, width, height, body_count, action):
    """rev17.single의 격리/진단 구조 + 준비 실패 때 고정 BLOCKED 슬롯 채우기."""
    context, external = context_for(Browser(browser, width), base, width, height, 'light')
    page, events = monitored_page(context)
    page.on('dialog', lambda dialog: dialog.accept())
    checks.begin_scene()
    try:
        attempt(checks, f'{item} {width}', lambda: action(page))
    finally:
        # 준비 중단은 실패로 기록하며 다음 필수 장면은 계속 실행한다.
        checks.end_scene(body_count, f'{item} {width}')
        diagnostics(checks, events, f'{item} {width}')
        overflow(checks, page, f'{item} {width}')
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
        parser.error('--only: A,B,C,D')
    if not widths or not widths <= set(MINIMUM_BY_WIDTH):
        parser.error('--widths: 1280,1024,390')
    checks = Checks()
    minimum = sum(MINIMUM_BY_WIDTH[w][k] for w in widths for k in selected)
    if minimum == 0:
        parser.error('--only/--widths 조합에 명세 적용 장면이 없습니다')
    print(f'INFO 코드 기준 통과 하한 {minimum}, SKIP 가능 지점 0', flush=True)
    info('MINIMUM_BY_WIDTH', MINIMUM_BY_WIDTH)
    try:
        base = local_address(['rev18.py', args.base])
        fixture = None
        if 'D' in selected or ('C' in selected and widths & {1280, 1024}) or ('B' in selected and 390 in widths):
            fixture = next((f for f in seeded_fixtures() if f['room'] == 'FXW4AAA8'), None)
            need(fixture, 'FXW4AAA8 고정 시작본')
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in SIZES:
                    if width not in widths:
                        continue
                    for item in ITEMS:
                        if item not in selected or not MINIMUM_BY_WIDTH[width][item]:
                            continue  # 명세의 적용 폭 밖. SKIP 장면이 아님.
                        if item == 'A':
                            single(checks, browser, base, item, width, height,
                                   MINIMUM_BY_WIDTH[width][item] - DIAGNOSTICS,
                                   lambda p, w=width: A(checks, p, base, w))
                        elif item == 'B':
                            single(checks, browser, base, 'B-first', width, height, B_MONTH,
                                   lambda p: B_first(checks, p, base))
                            single(checks, browser, base, 'B-H12', width, height, B_H12,
                                   lambda p: B_twelve(checks, p, base, fixture))
                        elif item == 'C':
                            for phase in ('plan', 'result'):
                                single(checks, browser, base, 'C-' + phase, width, height, C_PHASE[width],
                                       lambda p, w=width, ph=phase: C(checks, p, base, w, fixture, ph))
                            if width == 1024:
                                single(checks, browser, base, 'C-plan-coach-focus', width, height,
                                       C_COACH_FOCUS, lambda p: C_coach_focus(checks, p, base, fixture))
                        else:
                            single(checks, browser, base, item, width, height, D_BODY[width],
                                   lambda p, w=width: D(checks, p, base, w, fixture))
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
