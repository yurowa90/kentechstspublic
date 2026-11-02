"""rev19 #90 명세(개정 2) 기반 브라우저 수용 검사. 작성 세션에서는 브라우저 실행 금지.

샌드박스 밖 로컬 실행 담당자:
 tests/.venv/bin/python tests/league/rev19.py http://127.0.0.1:<포트>/index.html \
   [--only A1,A2,B,C] [--widths 1280,1024,390]
REV19_CAP이 있을 때만 장면-너비 PNG를 쓴다. 필수 장면/API 부재는 BLOCKED.
A의 기준판 비교는 같은 기기의 실제 저장 상태를 reload하여 수행한다. 이때만
ui JS/CSS 응답을 git show 577adb1의 원문으로 대체한다. 결과/문구/DOM/CSS를
합성하거나 구현 중 작업 폴더 ui를 읽지 않는다. 기준판도 같은 콘솔/외부 요청 감시 안이다.
"""
import argparse
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, context_for, diagnostics, local_address, monitored_page,
                    open_panel, overflow, shown)
from league_flow import finish_trial, pass_issue_check, select_mode, start_solo
from rev14 import Checks as Rev14Checks, attempt
from rev17 import Browser, need, result
from rev18 import Checks as Rev18Checks, info
from s7 import plan_and_trial
from score1 import frames
from solo import close_drawer
from ux_task import CAND_JS, TILE_XY_JS

BASE = '577adb1'
ROOT = Path(__file__).resolve().parents[2]
SIZES = ((1280, 900), (1024, 768), (390, 844))
ITEMS = ('A1', 'A2', 'B', 'C')
TERMS = {
    'pp': '%p(퍼센트포인트): 두 비율(%)의 차이(예: 정전 2%→5%면 +3%p)',
    'delta': 'Δ(델타): 비교 기준과 견준 차이(이번 값 − 기준 값, +증가·−감소)',
    'wait': '접속 대기: 전력망 접속 순서를 기다리는 설비 용량(MW). 이번 달엔 발전하지 않아요.',
}
TERM_LABEL = '설명 보기: 기호·낱말 풀이'
# 장면 본문 고정 호출 수. 진단은 error/warning/pageerror/넘침/외부 요청=5.
# A1=3+folding6+기준판2, A2=13+folding6+기준판3,
# B=term_phase11×2+info_button7+직접8. C=14+민원최소/숲제외2+설치후프레임2.
# C는 평택 모든 너비 + 화성 1280 독립 장면(진단도 따로 5). BLOCKED도 슬롯 수를 유지한다.
BODY_COUNTS = {'A1': 12, 'A2': 22, 'B': 37, 'C': 18}
DIAGNOSTICS = 5
MINIMUM_BY_WIDTH = {
    w: {k: (n + DIAGNOSTICS) * (2 if k == 'C' and w == 1280 else 1)
        for k, n in BODY_COUNTS.items()} for w, _ in SIZES
}


class Checks(Rev18Checks):
    def __init__(self):
        out = os.environ.get('REV19_CAP')
        Rev14Checks.__init__(self, Path(out) if out else None)
        self.pending = None


# 닫힌 details의 summary 및 summary 자손만 예외로 보인다. 부모/자식의
# checkVisibility 지원 여부에 기대지 않고 명세의 rectangle/display/visibility로 잰다.
DOM = r"""(() => {
 const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,
  right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
 const closed=e=>{for(let p=e;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open){
  const s=[...p.children].find(c=>c.tagName==='SUMMARY');if(!s||!(s===e||s.contains(e)))return true;}return false;};
 const laid=e=>{if(!e||closed(e))return false;const r=box(e),s=getComputedStyle(e);
  return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const overlaps=(a,b)=>a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;
 const screen={left:0,top:0,right:innerWidth,bottom:innerHeight};
 const visible=e=>laid(e)&&overlaps(box(e),screen);
 const inside=(r,b)=>r.left>=b.left-1&&r.top>=b.top-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1;
 const hit=e=>{if(!visible(e))return false;const r=box(e),h=document.elementFromPoint(
  (r.left+r.right)/2,(r.top+r.bottom)/2);return !!h&&(h===e||e.contains(h));};
 const target=e=>e?{...box(e),visible:visible(e),hit:hit(e),text:e.textContent.trim(),
  inside:inside(box(e),screen)}:{visible:false,hit:false,inside:false,text:''};
 const texts=root=>{let out='';if(!root)return out;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){const n=w.currentNode;if(n.textContent.trim()&&visible(n.parentElement))out+=n.textContent;}return out;};
 return {box,closed,laid,visible,overlaps,inside,hit,target,texts};
})()"""

S7_VIEW = r"""() => {
 const {box,closed,laid,visible,inside,overlaps,target}=DOM_HELPERS;
 const body=document.querySelector('#lg-panel .lg-pbody'),root=document.querySelector('#lg-missed');
 if(!body||!root)return null;
 const r=box(body),win={left:Math.max(0,r.left),top:Math.max(0,r.top),
  right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};
 let chars=0;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(w.nextNode()){const n=w.currentNode,p=n.parentElement,s=getComputedStyle(p),b=box(p);
  // 명세: 글자 수에는 부모 높이>0 조건이 없고 너비>0만 있다.
  if(n.textContent.trim()&&b.width>0&&s.display!=='none'&&s.visibility!=='hidden'&&!closed(p)&&overlaps(b,win))
   chars+=n.textContent.trim().length;}
 const t=sel=>{const e=document.querySelector(sel);return {...target(e),first:!!e&&inside(box(e),win)};};
 const fold=document.querySelector('#lg-outage-more');
 const paragraphs=['lg-outage-others','lg-outage-card-clues'].map(id=>{
  const e=document.getElementById(id);return {id,exists:!!e,...target(e),inMore:!!e&&fold?.contains(e),
   attrs:e?[...e.querySelectorAll('[data-out-other]')].map(n=>({key:n.dataset.outOther,value:n.dataset.outValue,text:n.textContent})):[]};});
 const largest=[...root.querySelectorAll('#lg-outage-cards [data-missed]')].filter(c=>c.querySelector('[data-out-tag="largest"]'))
  .map(c=>({name:c.querySelector('strong')?.textContent,size:c.querySelector('.lg-out-size')?.textContent}));
 const head=root.querySelector('h4')?.closest('.lg-info-line'),lead=root.querySelector('#lg-outage-lead'),wf=root.querySelector('#lg-outage-waterfall');
 const content=fold?[...fold.children].filter(e=>e.tagName!=='SUMMARY'):[];
 return {chars,win,body:r,overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,aligned:Math.abs(box(root).top-r.top)<=1&&scrollY===0,
  panel:{...document.querySelector('#lg-panel')?.dataset},root:{...root.dataset},
  lead:t('#lg-outage-lead'),single:t('#lg-outage-single'),largest,paragraphs,
  leadOrder:!!lead&&head?.nextElementSibling===lead&&!!wf&&!!(lead.compareDocumentPosition(wf)&Node.DOCUMENT_POSITION_FOLLOWING),
  fold:!!fold,open:!!fold?.open,summary:fold?.querySelector(':scope>summary')?.textContent.trim(),
  summaryFirst:fold?.firstElementChild?.tagName==='SUMMARY',
  firstContent:content[0]?.id,
  cardHint:root.querySelector('#lg-outage-cards')?.previousElementSibling?.textContent.trim(),
  cardClues:[...root.querySelectorAll('#lg-outage-cards .lg-out-clue')].map(e=>({
   key:e.closest('[data-missed]')?.dataset.missed,name:e.closest('[data-missed]')?.querySelector('strong')?.textContent,
   text:e.textContent,visible:visible(e),laid:laid(e)}))};
}""".replace('DOM_HELPERS', DOM)


def close_guide(page):
    for sel in ('#lg-coach-close', '#lg-guide-close'):
        if shown(page, sel):
            page.locator(sel).click()


def lobby(page, base, city=None, fixed=False, coach=False):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    select_mode(page, 'solo')
    if city:
        page.locator(f'[data-select="lg-solo-city"][data-value="{city}"]').click()
    options = page.locator('#lg-solo .lg-extra-settings')
    if not options.evaluate('e=>e.open'):
        options.locator(':scope > summary').click()
    page.locator('#lg-solo-practice').select_option('promise')
    if fixed:
        page.locator('#lg-solo-seed').select_option('fixed')
    start_solo(page, months=12)
    page.wait_for_selector('#bd-canvas')
    page.wait_for_function("() => KCP.league.state().S.phase==='plan'")
    need(page.evaluate('() => KCP.league.state().S.round===1'), '첫 달 새 판')
    if not coach:
        close_guide(page)
    frames(page)


def tap(page, selector, width):
    if width == 390:
        page.locator(selector).tap()
    else:
        page.locator(selector).click()


def put_tile(page, kind, tile, width):
    before = page.evaluate('() => KCP.buildGame.current().builds.length')
    for _ in range(2 if width == 390 else 1):
        xy = page.evaluate(TILE_XY_JS, tile)
        need(xy, f'{kind} 칸 {tile} 중심 캔버스 hit')
        if width == 390:
            page.touchscreen.tap(*xy)
        else:
            page.mouse.click(*xy)
        page.wait_for_timeout(300)
        if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
            return True
        if shown(page, '#bd-cf-ok'):
            tap(page, '#bd-cf-ok', width)
            page.wait_for_timeout(300)
            if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
                return True
    return False


def submit(page, width, direction='down'):
    close_drawer(page)
    tap(page, '#lg-ready', width)
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    evidence = page.locator('[data-evidence]:visible:enabled').first
    evidence.click()
    option = page.locator(f'#lg-predict [data-pred] option[value="{direction}"]')
    need(option.count() == 1 and option.get_attribute('disabled') is None, '약속 방향 선택 가능')
    page.locator('#lg-predict [data-pred]').select_option(direction)
    tap(page, '[data-confidence="fairly"]', width)
    tap(page, '#lg-ready-confirm', width)
    result(page)


def single_month(page, base, width):
    """ux_task.month_one S1~S7와 같은 첫 달 UI 경로. 결과/계획 주입 없음."""
    lobby(page, base)  # ux_task와 같은 로비 기본 도시·room 씨앗
    tap(page, '#lg-bar [data-panel="deal"]', width)
    page.wait_for_timeout(400)
    response = page.locator('.lg-evopt[data-resp]:visible:enabled')
    if response.count():
        response.first.click()
    close_drawer(page)
    if not shown(page, '[data-tool="solar"]'):
        tap(page, '[data-group="ren"]', width)
    tap(page, '[data-tool="solar"]', width)
    if shown(page, '[data-lens="complaints"]'):
        tap(page, '[data-lens="complaints"]', width)
    candidates = page.evaluate(CAND_JS, 'solar')[:6]
    need(candidates, 'ux_task S2 태양광 후보 칸')
    need(any(put_tile(page, 'solar', i, width) for i in candidates), 'ux_task S2 실제 태양광 설치')
    if width != 390:
        page.keyboard.press('Escape')
    tap(page, '[data-run="7"]', width)
    finish_trial(page)
    page.locator('#bd-drawer-x').click()
    submit(page, width)
    need(page.locator('#lg-missed[data-single="true"]').count() == 1, 'ux_task 첫 달 한 줄 요약')


def card_month(page, base, width):
    lobby(page, base, city='pyeongtaek', fixed=True)
    plan_and_trial(page, renewable=True, change_after=True)
    # 실제는 늘어남(고정 씨앗 1월 계통 +8.7 MWh/일): 빗나간 예측이어야 S7 카드가 나온다(총괄 수정).
    submit(page, width, direction='down')
    need(page.locator('#lg-missed[data-single="false"][data-opened="false"]').count() == 1,
         '시험 뒤 절전 정책의 열기 전 카드 달')
    need(2 <= page.locator('#lg-outage-cards [data-missed]').count() <= 3, '카드 2~3장')


def first_screen(page, s7=False):
    page.evaluate('() => window.scrollTo(0,0)')
    body = page.locator('#lg-panel .lg-pbody')
    if s7:
        body.evaluate("e=>{e.scrollTop+=document.querySelector('#lg-missed').getBoundingClientRect().top-e.getBoundingClientRect().top;}")
    else:
        body.evaluate('e=>{e.scrollTop=0;}')
    frames(page)
    if s7:
        view = page.evaluate(S7_VIEW)
        need(view and view['aligned'] and view['panel'].get('tab') == 'result' and
             view['panel'].get('folded') != 'true', 'S7 첫 화면 정렬·펼친 결과 서랍')
        return view


@lru_cache(maxsize=None)
def baseline_source(relative):
    need(relative.startswith('ui/') and relative.endswith(('.js', '.css')) and '..' not in relative,
         '기준판 UI 경로')
    return subprocess.check_output(['git', 'show', f'{BASE}:{relative}'], cwd=ROOT, text=True)


def baseline_page(page, base):
    """동일 실제 저장본으로 기준판을 읽는다. 기준판 전용 응답은 이 page에만 적용."""
    def route(r):
        p = urlsplit(r.request.url).path
        marker = '/ui/'
        if marker in p and p.endswith(('.js', '.css')):
            relative = 'ui/' + p.split(marker, 1)[1]
            r.fulfill(status=200, content_type='text/css' if p.endswith('.css') else 'text/javascript',
                      body=baseline_source(relative))
        else:
            r.fallback()
    # 실제 저장 상태가 pagehide 전에 확정됐는지 문자열 전체를 기록/출력하지 않고 확인한다.
    saved = page.evaluate("() => JSON.parse(localStorage.getItem('kcp-league-solo-v1')||'null')")
    need(saved and saved['state']['phase'] in ('review', 'end'), '실제 운영 저장본')
    page.route('**/ui/*', route)
    page.reload()
    page.wait_for_selector('#bd-canvas')
    close_guide(page)
    result(page)
    fold = page.locator('#lg-outage-more')
    if fold.count() and fold.evaluate('e=>e.open'):
        fold.locator(':scope>summary').click()
    return first_screen(page, s7=True)


def folding(checks, page, width, item):
    view = first_screen(page, s7=True)
    clue_id = 'lg-outage-others' if item == 'A1' else 'lg-outage-card-clues'
    clue = next(p for p in view['paragraphs'] if p['id'] == clue_id)
    # 개정 1: 카드 수·너비와 관계없이 원인 단서가 more 첫 본문에 있어야 한다.
    checks.ok(view['fold'] and not view['open'] and view['summary'] == '단서 더 보기', item + ' 닫힌 단서 더 보기')
    checks.ok(clue['exists'] and clue['inMore'] and view['summaryFirst'] and view['firstContent'] == clue_id,
              item + ' 원인 단서 more 맨 앞')
    checks.ok(not clue['visible'] and all(not p['visible'] for p in view['paragraphs'] if p['text'].startswith('원인 단서:')) and
              clue['text'].startswith('원인 단서: '),
              item + ' 접힌 원인 단서 비가시')
    checks.shot(page, f'{item}-{width}-first')
    info(f'{item} {width} S7 첫 화면 글자 수', view['chars'])
    more = page.locator('#lg-outage-more')
    need(more.count() == 1, item + ' 필수 more DOM')
    more.locator(':scope > summary').click()
    need(page.locator('#' + clue_id).count() == 1, item + ' 필수 원인 단서 문단')
    page.locator('#' + clue_id).scroll_into_view_if_needed()
    frames(page)
    opened = page.evaluate(S7_VIEW)
    expanded = next(p for p in opened['paragraphs'] if p['id'] == clue_id)
    checks.ok(opened['open'] and expanded['visible'],
              item + ' 단서 펼치면 보임')
    checks.ok(expanded['text'] == clue['text'] and expanded['attrs'] == clue['attrs'], item + ' 열어도 단서·data-out-other 보존')
    checks.ok(view['overflow'] <= 0 and opened['overflow'] <= 0, item + ' 접힘·펼침 모두 가로 넘침0')
    dom_text = more.text_content()
    clues_preserved = all(p['text'] in dom_text for p in view['cardClues'])
    return view, clue, clues_preserved


def compare_baseline(checks, page, base, width, item, view, clue, unopened=None):
    original = baseline_page(page, base)
    old_clue = next(p for p in original['paragraphs'] if p['id'] == clue['id'])
    if item == 'A2':
        # 기준판의 1·2장 달에는 문단이 없다. 기준판 카드의 이름·짧은 단서로 원문을 독립 구성한다.
        expected = '원인 단서: ' + ' · '.join(f"{p['name']}: {p['text']}" for p in original['cardClues'])
        old_text = old_clue['text'] if old_clue['exists'] else expected
        identity = lambda rows: [(p['key'], p['name'], p['text']) for p in rows]
        checks.ok(unopened['cardHint'] == original['cardHint'] and
                  identity(unopened['cardClues']) == identity(original['cardClues']),
                  'A2 열기 전 안내·카드 단서 기준판 동일')
        same = (bool(original['cardClues']) and clue['exists'] and clue['text'] == expected == old_text and
                clue['attrs'] == old_clue['attrs'])
    else:
        same = (clue['exists'] == old_clue['exists'] and clue['text'] == old_clue['text'] and
                clue['attrs'] == old_clue['attrs'])
    checks.ok(same, item + ' 기준판 단서 원문·속성 동일')
    checks.ok(view['chars'] < original['chars'], item + ' S7 첫 화면 글자 수 기준판보다 감소')
    info(f'{item} {width} S7 글자 수 비교', {'baseline': original['chars'], 'current': view['chars']})


def A1(checks, page, base, width):
    single_month(page, base, width)
    view = first_screen(page, s7=True)
    checks.ok(view['root']['single'] == 'true', 'A1 한 줄 요약 달')
    checks.ok(view['single']['visible'] and (view['single']['first'] if width != 390 else
              view['win']['top']-1 <= view['single']['top'] <= view['win']['bottom']+1), 'A1 요약 S7 첫 화면 안')
    checks.ok(not page.locator('#lg-outage-lead').count(), 'A1 별도 lead 없음')
    # 총괄 추가: 정전 주제 판정 줄의 %p는 abbr.lg-term(pp)로 감싼다(대체 없음, 개정 2).
    summary = page.locator('#lg-promise-summary')
    checks.ok('%p' in summary.text_content() and summary.locator('abbr.lg-term[data-term="pp"]').count() >= 1,
              'A1 판정 줄 %p abbr 필수')
    view, clue, _ = folding(checks, page, width, 'A1')
    compare_baseline(checks, page, base, width, 'A1', view, clue)


def A2(checks, page, base, width):
    card_month(page, base, width)
    checks.ok(page.locator('#lg-outage-lead').count() == 0, 'A2 열기 전 lead 없음')
    sizes = page.locator('#lg-outage-cards .lg-out-size').all_text_contents()
    checks.ok(2 <= len(sizes) <= 3 and all(s == '?' for s in sizes), 'A2 열기 전 카드 크기 ?')
    unopened = first_screen(page, s7=True)
    visible_clues = []
    for card_clue in page.locator('#lg-outage-cards .lg-out-clue').all():
        card_clue.scroll_into_view_if_needed()
        visible_clues.append(card_clue.evaluate('e=>('+DOM+').visible(e)'))
    checks.ok(len(visible_clues) == len(sizes) and all(visible_clues), 'A2 열기 전 카드 단서 보임')
    checks.ok('단서만 보고 하나를 골라요.' in unopened['cardHint'] and '. 후보 ' in unopened['cardHint'],
              'A2 열기 전 고르기 안내 문장 유지')
    page.locator('#lg-outage-cards [data-missed]').first.click()
    tap(page, '#lg-outage-open', width)
    page.wait_for_selector('#lg-missed[data-opened="true"][data-single="false"]')
    view = first_screen(page, s7=True)
    checks.ok(len(view['cardClues']) == len(sizes) and all(not p['laid'] for p in view['cardClues']) and
              [(p['key'], p['name'], p['text']) for p in view['cardClues']] ==
              [(p['key'], p['name'], p['text']) for p in unopened['cardClues']],
              'A2 열린 뒤 모든 너비에서 카드 단서 span 유지·CSS 비가시')
    checks.ok(view['cardHint'] == unopened['cardHint'].split('. 후보 ', 1)[0] + '.' and
              '단서만 보고 하나를 골라요' not in view['cardHint'],
              'A2 열린 뒤 고르기 안내 제거·비교 기준과 합계 유지')
    largest = view['largest']
    need(largest and all(p['name'] and p['size'] for p in largest), 'A2 최대 카드·이름·크기')
    expected = '가장 큰 몫: ' + ' · '.join(f"{p['name']}({p['size']})" for p in largest)
    checks.ok(view['lead']['visible'] and view['lead']['first'], 'A2 lead 보임·S7 첫 화면 전체 안')
    checks.ok(view['lead']['hit'], 'A2 lead 중심 hit')
    checks.ok(view['lead']['text'] == expected,
              'A2 최대 몫 카드 이름·크기와 lead 일치(비용 꼬리 없음)')
    checks.ok(view['leadOrder'], 'A2 머리 줄 바로 아래·폭포 앞')
    lead_pp = page.locator('#lg-outage-lead abbr.lg-term[data-term="pp"]')
    checks.ok('%p' not in expected or (lead_pp.count() >= 1 and all(
        p.text_content() == '%p' and p.get_attribute('title') == TERMS['pp'] for p in lead_pp.all())),
        'A2 %p 몫이면 lead의 %p도 명세 title로 감싸기')
    view, clue, preserved = folding(checks, page, width, 'A2')
    checks.ok(preserved, 'A2 모든 너비의 숨긴 카드 단서 원문은 more DOM에 보존')
    checks.ok(page.locator('#lg-outage-others-fold').count() == 1 and
              not page.locator('#lg-outage-others-fold').evaluate('e=>e.open'), 'A2 나머지 원인 접힘 유지')
    compare_baseline(checks, page, base, width, 'A2', view, clue, unopened)


TERMS_VIEW = r"""() => {
 const {visible,texts}=DOM_HELPERS,tokens={pp:'%p',delta:'Δ',wait:'접속 대기'};
 const regions=['#lg-promise-summary','#lg-result-deltas','#lg-missed'].map(sel=>{
  const root=document.querySelector(sel),text=texts(root);
  return {sel,text,terms:Object.fromEntries(Object.entries(tokens).map(([key,word])=>[key,{
   present:text.includes(word),abbr:root?[...root.querySelectorAll('abbr.lg-term[data-term="'+key+'"]')]
    .filter(visible).map(e=>({text:e.textContent,title:e.title})):[]}]))};});
 const all=[...document.querySelectorAll('#lg-promise-summary abbr.lg-term,#lg-result-deltas abbr.lg-term,#lg-missed abbr.lg-term')];
 const styles=all.map(e=>{const s=getComputedStyle(e),p=getComputedStyle(e.parentElement);
  return {key:e.dataset.term,title:e.title,text:e.textContent,
   underline:s.textDecorationLine.includes('underline'),dotted:s.textDecorationStyle==='dotted',help:s.cursor==='help',
   inherited:s.color===p.color&&s.fontSize===p.fontSize&&s.lineHeight===p.lineHeight};});
 const deltas=document.querySelector('#lg-result-deltas');
 const rows=deltas?[...deltas.children].filter(e=>e.textContent.includes('Δ')):[];
 const deltaRows=rows.length>0&&rows.every(e=>[...e.querySelectorAll('abbr.lg-term[data-term="delta"]')].some(a=>a.textContent==='Δ'));
 const outage=rows.find(e=>e.querySelector('dt')?.textContent==='정전(이번 달)');
 const pp=!!outage&&[...outage.querySelectorAll('.lg-result-delta-value abbr.lg-term[data-term="pp"]')].some(e=>e.textContent==='%p');
 const wait=['#lg-outage-grid-bottleneck','#lg-outage-grid-small'].map(sel=>{
  const e=document.querySelector(sel);return !e||!e.textContent.includes('접속 대기')||
    [...e.querySelectorAll('abbr.lg-term[data-term="wait"]')].some(a=>a.textContent==='접속 대기');}).every(Boolean);
 return {regions,styles,deltaRows,pp,wait,plain:{promise:document.querySelector('#lg-promise-summary')?.textContent,
  deltas:deltas?.textContent}};
}""".replace('DOM_HELPERS', DOM)


def term_phase(checks, page, phase):
    first_screen(page, s7=phase == 'S7')
    data = page.evaluate(TERMS_VIEW)
    for region in data['regions']:
        for key, token in (('pp', '%p'), ('delta', 'Δ'), ('wait', '접속 대기')):
            term = region['terms'][key]
            checks.ok(not term['present'] or any(a['text'] == token and a['title'] == TERMS[key] for a in term['abbr']),
                      f'B {phase} {region["sel"]} 보이는 {token} 풀이')
    checks.ok(all(s['key'] in TERMS and s['title'] == TERMS[s['key']] and
                  s['underline'] and s['dotted'] and s['help'] and s['inherited'] for s in data['styles']),
              f'B {phase} 모든 abbr title·점선·help·색/크기/줄간격 상속')
    checks.ok(page.evaluate('() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth'),
              f'B {phase} 가로 넘침0')
    return data


def info_button(checks, page, width):
    key = 'result-terms'
    sel = f'[data-info-key="{key}"]'
    btn = page.locator(sel)
    data = page.evaluate('sel=>{const e=document.querySelector(sel),h=e?.closest(".lg-info-line"),'
        'heading=document.querySelector("#lg-result-heading"),body=document.querySelector("#lg-panel .lg-pbody");'
        'return {count:document.querySelectorAll(sel).length,'
        'label:e?.getAttribute("aria-label"),...(('+DOM+').target(e)),line:h?.textContent,'
        'inHead:!!h&&h.id==="lg-result-head"&&!!heading&&heading.closest(".lg-info-line")===h&&'
        'body?.firstElementChild===h};}', sel)
    checks.ok(data['count'] == 1 and data['inHead'], 'B result-terms 서랍 맨 위 result-head에서 결과 제목과 같은 줄에 하나')
    checks.ok(data['count'] == 1 and data['label'] == TERM_LABEL, 'B ' + key + ' aria-label')
    checks.ok(data['count'] == 1 and data.get('width', 0) >= 44 and data.get('height', 0) >= 44,
              'B ' + key + ' 44×44')
    checks.ok(data['count'] == 1 and data['visible'] and data['hit'], 'B ' + key + ' 첫 화면 보임·중심 hit')
    need(btn.count() == 1, 'B 필수 ' + key + ' ! 단추')
    tap(page, sel, width)
    frames(page)
    popup = btn.locator('xpath=ancestor::details[1]').locator('.lg-info-pop')
    need(popup.count() == 1, 'B 필수 result-terms 풀이 상자')
    popup.scroll_into_view_if_needed()
    frames(page)
    paragraphs = btn.evaluate('e=>[...e.closest("details").querySelectorAll(".lg-info-pop p")].map(p=>({text:p.textContent,visible:('+DOM+').visible(p)}))')
    checks.ok([p['text'] for p in paragraphs] == list(TERMS.values()) and all(p['visible'] for p in paragraphs) and
              page.evaluate('() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth'),
              'B ' + key + ' 풀이 상자 스크롤 뒤 B1·B2·B3 세 p 순서·보임')
    tap(page, sel, width)
    frames(page)
    checks.ok(not btn.evaluate('e=>e.closest("details").open'), 'B ' + key + ' 다시 누르면 닫힘')
    tap(page, sel, width)
    btn.focus()
    need(btn.evaluate('e=>e.closest("details").open&&e.closest("details").contains(document.activeElement)'),
         'B Esc 전 풀이 열림·내부 초점')
    page.keyboard.press('Escape')
    checks.ok(not btn.evaluate('e=>e.closest("details").open'), 'B ' + key + ' Esc 닫힘')


def B(checks, page, base, width):
    # 접속 대기를 실제로 관측할 수 있는 연결 태양광 10기 장면을 재사용한다.
    card_month(page, base, width)
    page.locator('#lg-outage-cards [data-missed]').first.click()
    tap(page, '#lg-outage-open', width)
    page.wait_for_selector('#lg-missed[data-opened="true"][data-single="false"]')
    s6 = term_phase(checks, page, 'S6')  # 11
    checks.shot(page, f'B-{width}-S6')
    info_button(checks, page, width)  # 7
    s7 = term_phase(checks, page, 'S7')  # 11
    checks.shot(page, f'B-{width}-S7')
    # 총괄 수정(rev19 개정 2 뒤): 이 장면 판정 줄(계통 주제)에는 %p·Δ·접속 대기가 없다. 낱말이 있을 때만 abbr 필수, 없으면 0.
    summary_text = page.locator('#lg-promise-summary').text_content()
    summary_abbr = page.locator('#lg-promise-summary abbr.lg-term').count()
    checks.ok(summary_abbr >= 1 if any(t in summary_text for t in ('%p', 'Δ', '접속 대기')) else summary_abbr == 0,
              'B 판정 줄 abbr 필수(! 대체 없음, 낱말 있을 때)')
    checks.ok(page.locator('[data-info-key="outage-terms"]').count() == 0, 'B outage-terms 단추 없음')
    checks.ok(s6['deltaRows'] and s7['deltaRows'], 'B 각 결과 줄·계통이 메운 전기 Δ 필수 감싸기')
    checks.ok(s6['pp'] and s7['pp'], 'B 정전 Δ 값 %p 필수 감싸기')
    checks.ok(s6['wait'] and s7['wait'], 'B 병목·작은 대기 상자 접속 대기 필수 감싸기')
    seen = {key for d in (s6, s7) for r in d['regions'] for key, v in r['terms'].items() if v['present']}
    checks.ok(seen == set(TERMS), 'B 첫 화면들에서 %p·Δ·접속 대기 실제 관측')
    baseline_page(page, base)
    old = page.evaluate(TERMS_VIEW)
    checks.ok(s6['plain']['promise'] == old['plain']['promise'], 'B 판정 줄 textContent 기준판 동일')
    checks.ok(s6['plain']['deltas'] == old['plain']['deltas'], 'B 결과 모든 줄 textContent 기준판 동일')


SITE_ORACLE = r"""() => {
 const B=KCP.buildGame,st=B.current(),used=new Set(st.builds.map(b=>b.i));
 const cube=t=>{const x=t.c-(t.r-(t.r&1))/2;return [x,-x-t.r,t.r];};
 const dist=(a,b)=>Math.max(...cube(a).map((v,i)=>Math.abs(v-cube(b)[i])));
 // 민원은 게임의 공개 모형으로만 읽는다. 후보·거리·동점은 검사에서 계산한다.
 if(typeof B.complaints!=='function'||typeof B.sanitize!=='function')throw Error('BLOCKED C 공개 민원/정리 API');
 const candidates=B.TILES.filter(t=>!used.has(t.i)&&t.t!=='forest'&&B.siteRule('diesel',t)==='').map(t=>{
  const plan=B.sanitize({...structuredClone(st),builds:[...structuredClone(st.builds),{t:'diesel',i:t.i}]},1e9);
  const bi=plan.builds.findIndex(b=>b.t==='diesel'&&b.i===t.i);
  if(bi<0)throw Error('BLOCKED C sanitize가 후보 디젤 제거');
  const score=B.complaints(plan,null).items.filter(x=>x.bi===bi).reduce((s,x)=>s+x.pts,0);
  return {i:t.i,score,d:Math.min(...B.TOWNS.map(w=>dist(t,B.TILES[w.tile])))};
 }).sort((a,b)=>a.score-b.score||a.d-b.d||a.i-b.i);
 const marks=JSON.parse(document.querySelector('#bd-banners')?.dataset.coachMarks||'[]');
 const expected=B.BLD.diesel.name+' 놓을 수 있는 칸';
 const chosen=marks.find(m=>m.text===expected),candidate=candidates.find(t=>t.i===chosen?.tile);
 const labels=[...document.querySelectorAll('.bd-coach-mark')].filter(e=>e.textContent===expected);
 const {box,target,overlaps}=DOM_HELPERS,coach=document.querySelector('#lg-coach');
 return {oracle:candidates[0]?.i??null,api:typeof B.coachSiteTile==='function'?B.coachSiteTile('diesel'):'MISSING',
  expected,marks,labels:labels.map(e=>({...target(e),fits:e.scrollWidth<=e.clientWidth+1,
   noCoach:!!coach&&!overlaps(box(e),box(coach))})),
  minScore:candidates.length?Math.min(...candidates.map(t=>t.score)):null,
  chosenScore:candidate?.score??null,chosenTerrain:chosen?B.TILES[chosen.tile]?.t:null,
  task:document.querySelector('#lg-coach-task')?.textContent,
  phase:KCP.league.state().S.phase,overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
  center:(()=>{const i=candidates[0]?.i,t=B.TILES[i];if(!t)return false;const p=B.tileXY(t.c,t.r);
   return !!p&&p[0]>=0&&p[0]<innerWidth&&p[1]>=0&&p[1]<innerHeight&&document.elementFromPoint(...p)===document.querySelector('#bd-canvas');})()};
}""".replace('DOM_HELPERS', DOM)


INSTALL_WATCH = r"""({expected}) => {
 const before=KCP.buildGame.current().builds.length,trace={frames:[],mutations:[]};
 const read=()=>{
  if(KCP.buildGame.current().builds.length<=before)return null;
  const step=Number(document.querySelector('#lg-coach')?.dataset.step);
  if(step>3)return null;
  const marks=JSON.parse(document.querySelector('#bd-banners')?.dataset.coachMarks||'[]')
   .filter(m=>m.text===expected).map(m=>m.tile);
  const labels=[...document.querySelectorAll('.bd-coach-mark')].filter(e=>e.textContent===expected).length;
  return {step,marks,labels};
 };
 const observer=new MutationObserver(records=>{const s=read();if(!s)return;trace.mutations.push(s);
  // 한 작업 안에서 새 표지를 만들었다 지워도 dataset의 옛 값 기록으로 잡는다.
  for(const r of records)if(r.type==='attributes'&&r.attributeName==='data-coach-marks'){
   const marks=JSON.parse(r.oldValue||'[]').filter(m=>m.text===expected).map(m=>m.tile);
   trace.mutations.push({step:s.step,marks});
  }
 });
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,
  attributeOldValue:true,characterData:true});
 let active=true,raf;
 const tick=()=>{if(!active)return;const s=read();if(s)trace.frames.push(s);raf=requestAnimationFrame(tick);};
 raf=requestAnimationFrame(tick);
 window.__rev19InstallWatch=()=>{active=false;cancelAnimationFrame(raf);observer.disconnect();return trace;};
}"""


def C(checks, page, base, width, city='pyeongtaek'):
    lobby(page, base, city=city, fixed=True, coach=True)
    page.wait_for_selector('#lg-coach[data-step="1"]', state='visible')
    # 시계는 single에서 문서를 열기 전에 설치한다. 2/8 진입 전 멈추고 명시적으로
    # 진행해 설치 첫 프레임이 반드시 3/8 전이도록 한다(실행기 속도로 공허하게 통과 금지).
    for retry in range(5):
        try:
            page.clock.pause_at(page.evaluate('() => Date.now()') / 1000 + 0.05)
            break
        except Exception as exc:
            if 'past' not in str(exc) or retry == 4:
                raise
    # 1/8 건너뛰기는 2/8로만 간다. 코치를 닫거나 2/8 action으로 초점 이동하지 않는다.
    tap(page, '#lg-coach-skip', width)
    page.wait_for_selector('#lg-coach[data-step="2"]', state='visible')
    page.clock.run_for(64)
    data = page.evaluate(SITE_ORACLE)
    need(data['oracle'] is not None and data['task'] and '디젤' in data['task'], 'C 디젤 immediate 2/8 장면')
    checks.ok(data['phase'] == 'plan' and data['task'].startswith('자리 판단 · 2/8'), 'C 계획 코치 2/8')
    checks.ok(data['overflow'] <= 0, 'C 2/8 가로 넘침0')
    checks.ok(len(data['labels']) == 1, 'C C1 표지 정확히 하나')
    diesel = [m for m in data['marks'] if m['text'] == data['expected']]
    checks.ok(len(diesel) == 1 and diesel[0]['tile'] == data['oracle'], 'C 표지 칸 = 공개 민원·독립 cube 거리·번호 계산')
    checks.ok(data['api'] == data['oracle'], 'C coachSiteTile = 독립 계산')
    checks.ok(data['chosenScore'] is not None and data['chosenScore'] == data['minScore'],
              f'C {city} 고른 디젤 민원 점수 = 전체 후보 최솟값')
    checks.ok(data['chosenTerrain'] is not None and data['chosenTerrain'] != 'forest',
              f'C {city} 고른 칸 숲 제외(훼손 확인 없음)')
    checks.ok(bool(diesel) and data['marks'][0] == diesel[0], 'C 디젤 표지가 목록 맨 앞')
    checks.ok(data['center'], 'C 고른 칸 중심 화면 안·캔버스 hit')
    checks.ok(len(data['labels']) == 1 and data['labels'][0]['visible'] and data['labels'][0]['inside'], 'C 이름표 보임·창 안')
    checks.ok(len(data['labels']) == 1 and data['labels'][0]['noCoach'], 'C 이름표 코치와 겹침0')
    checks.ok(len(data['labels']) == 1 and data['labels'][0]['fits'], 'C 이름표 글자 안 잘림')
    # 500ms 계획/코치 갱신 두 번 뒤에도 두 함수가 표지를 덮어쓰지 않아야 한다.
    page.clock.run_for(1100)
    later = page.evaluate(SITE_ORACLE)
    checks.ok(later['marks'] == data['marks'] and len(later['labels']) == 1, 'C 반복 갱신 표지 유지')
    checks.shot(page, f'C-{city}-{width}-step2')
    # 표지를 만드는 것과 구분해 실제 학생의 도구 선택·지도 입력으로 설치한다.
    if not shown(page, '[data-tool="diesel"]'):
        tap(page, '[data-group="fire"]', width)
    if page.locator('#bd-root').get_attribute('data-mode') != 'diesel':
        tap(page, '[data-tool="diesel"]', width)
    group = page.locator('[data-group="fire"]')
    if group.get_attribute('aria-expanded') == 'true':
        tap(page, '[data-group="fire"]', width)
    # put_tile의 300ms 대기 전에 설치 첫 프레임부터 관측한다. 같은 입력 재그리기는 사용하지 않는다.
    page.evaluate(INSTALL_WATCH, {'expected': data['expected']})
    installed = put_tile(page, 'diesel', data['oracle'], width)
    checks.ok(installed and page.evaluate('i=>KCP.buildGame.current().builds.some(b=>b.t==="diesel"&&b.i===i)', data['oracle']),
              'C 짚은 칸에 실제 디젤 설치')
    page.clock.run_for(32)  # 설치 뒤 첫 두 프레임. 아직 2/8의 1500ms 미만.
    page.clock.run_for(1600)  # 500ms 갱신 주기를 거쳐 3/8에 도달한다.
    page.wait_for_selector('#lg-coach[data-step="3"]', state='visible')
    page.clock.resume()
    frames(page)
    trace = page.evaluate('() => window.__rev19InstallWatch()')
    first = trace['frames'][0] if trace['frames'] else None
    checks.ok(first is not None and first['step'] == 2 and not first['marks'] and first['labels'] == 0,
              'C 설치 직후 첫 프레임부터 C1 표지 사라짐')
    checks.ok(bool(trace['frames']) and any(s['step'] == 3 for s in trace['frames']) and
              all(not s['marks'] and s['labels'] == 0 for s in trace['frames']) and
              all(all(i == data['oracle'] for i in s['marks']) for s in trace['mutations']),
              'C 설치부터 3/8 전환까지 매 프레임 C1 없음·중간 DOM에도 새 칸 C1 없음')
    checks.ok(page.locator('.bd-coach-mark').evaluate_all('(es,t)=>es.every(e=>e.textContent!==t)', data['expected']),
              'C 3/8로 전진·디젤 C1 표지 사라짐')
    rows = page.locator('.bd-coach-mark').evaluate_all('es=>es.map(e=>('+DOM+').target(e))')
    checks.ok(len(rows) == 2 and all(r['visible'] and r['inside'] for r in rows), 'C rev10 R8 3/8 두 이름표 유지')
    checks.shot(page, f'C-{city}-{width}-step3')


def single(checks, browser, base, item, width, height, city=None):
    context, external = context_for(Browser(browser, width), base, width, height, 'light')
    page, events = monitored_page(context)
    page.on('dialog', lambda d: d.accept())
    if item == 'C':
        page.clock.install()
    checks.begin_scene()
    label = f'{item} {width}' + (f' {city}' if city else '')
    try:
        attempt(checks, label, lambda: (C(checks, page, base, width, city) if city else
                                      globals()[item](checks, page, base, width)))
    finally:
        checks.end_scene(BODY_COUNTS[item], label)
        diagnostics(checks, events, label)
        overflow(checks, page, label)
        checks.ok(not external, f'{label} 외부 요청0(차단됨): {external}')
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
        parser.error('--only: A1,A2,B,C')
    if not widths or not widths <= set(MINIMUM_BY_WIDTH):
        parser.error('--widths: 1280,1024,390')
    checks = Checks()
    minimum = sum(MINIMUM_BY_WIDTH[w][k] for w in widths for k in selected)
    print(f'INFO 코드 기준 통과 하한 {minimum}, SKIP 가능 지점 0', flush=True)
    info('MINIMUM_BY_WIDTH', MINIMUM_BY_WIDTH)
    try:
        base = local_address(['rev19.py', args.base])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in SIZES:
                    if width in widths:
                        for item in ITEMS:
                            if item in selected:
                                single(checks, browser, base, item, width, height)
                                if item == 'C' and width == 1280:
                                    single(checks, browser, base, item, width, height, city='hwaseong')
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
