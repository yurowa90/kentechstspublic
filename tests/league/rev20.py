"""rev20 #93 명세(개정 1) 기반 독립 브라우저 수용 검사. 기준판 a86c343.

허용된 샌드박스 밖 로컬 실행 담당자:
 tests/.venv/bin/python tests/league/rev20.py http://127.0.0.1:<포트>/index.html \
   [--only A,E,M,D] [--widths 1280,1024,390]
REV20_CAP이 있을 때만 장면·너비 PNG를 저장한다. 필수 장면/API 부재는
BLOCKED 실패이며 SKIP은 없다. UI 응답 대체, 결과·DOM·CSS·타이머 주입 없음.
계획도 UI로만 바꾼다. 첫 화면 측정의 scrollTop/scrollY=0만 직접 설정한다.
작성 세션에서는 브라우저를 실행하지 않는다.
"""
import argparse
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from econui import context_for, diagnostics, local_address, monitored_page, overflow, shown
from league_flow import finish_trial, pass_issue_check
from rev14 import Checks as Rev14Checks, attempt
from rev17 import Browser as Rev17Browser, need
from rev18 import Checks as Rev18Checks, info
from rev19 import DOM, lobby
from rev12 import K1A, grid_on
from score1 import frames
from solo import close_drawer
from ux_coach import LINE_ENDS_JS, NEAR_TOWN_JS
from ux_s2fix import reveal_tile
from ux_task import CFG, TILE_XY_JS

SIZES = ((1280, 900), (1024, 768), (390, 844))
ITEMS = ('A', 'E', 'M', 'D')
E2 = '철거 도구: 지도에서 지은 것을 누르면 철거하고 돈을 돌려받아요'
E3 = '되돌리기: 방금 놓은 것을 되돌리고 돈을 모두 돌려받아요'
SHORT = r'(?:[\d,]+(?:\.\d+)?억 모자라요(?:\(설비 [\d,]+(?:\.\d+)?억 · 남은 돈 [\d,]+(?:\.\d+)?억\))?|예산 부족\([\d,]+(?:\.\d+)?억\))'
COACH_READY = '약속 · 5/8 준비 → 근거·방향·확신 고르고 약속해요'
# A=5/8 4 + S6 13 + 8/8 1. E 기존=최초13 + undo3 + remove3 + undo없음3=22.
# 개정 1 E 추가: Tab 도달2 + 동작 후 초점2 + 기존 닫힘의 data-actions2
# + 이미 고른 철거4 + 싼 설비 설치로 닫힘2 + 10초 만료2 = 14.
# 1024/390은 열린 일지 서랍에서 단계·서랍/알림/undo hit/remove hit/교차0=5 추가.
# M=넓은 폭 접기 9×2 + 경고3, 좁은 폭 계획3 + 결과2.
# D=1/2/화력/5/6 다섯 표본×6(390), 다른 폭은 INFO+경로 성립1.
# 모든 장면의 진단은 error/warning/pageerror/가로 넘침/외부 요청 5개.
BODY_COUNTS = {w: {'A': 18, 'E': 36 if w == 1280 else 41, 'M': 21 if w == 1280 else 5,
                   'D': 30 if w == 390 else 1} for w, _ in SIZES}
MINIMUM_BY_WIDTH = {w: {k: n + 5 for k, n in rows.items()}
                    for w, rows in BODY_COUNTS.items()}


class Checks(Rev18Checks):
    def __init__(self):
        out = os.environ.get('REV20_CAP')
        Rev14Checks.__init__(self, Path(out) if out else None)
        self.pending = None


class Browser(Rev17Browser):
    """rev17의 어댑터를 확장: 명세의 태블릿도 touch+mobile이다."""
    def new_context(self, **opts):
        cfg = CFG['desktop' if self.width == 1280 else 'tablet' if self.width == 1024 else 'mobile']
        return self.browser.new_context(**{k: v for k, v in cfg.items() if k != 'viewport'},
                                        reduced_motion='no-preference', **opts)

    def __init__(self, browser, width):
        super().__init__(browser, width)
        self.width = width


def press(page, selector, width):
    node = page.locator(selector).first
    (node.click if width == 1280 else node.tap)()
    frames(page)


def target(page, selector):
    return page.evaluate('(sel)=>(' + DOM + ').target(document.querySelector(sel))', selector)


def clipped(page, selector):
    return page.locator(selector).evaluate('e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1')


def tile(page, index, width):
    if page.evaluate(TILE_XY_JS, index) is None:
        reveal_tile(page, width != 1280, index, lambda: None)
    xy = page.evaluate(TILE_XY_JS, index)
    need(xy, f'지도 칸 {index} 중심 hit')
    (page.mouse.click if width == 1280 else page.touchscreen.tap)(*xy)
    page.wait_for_timeout(250)


def select_tool(page, kind, width):
    if not shown(page, f'[data-tool="{kind}"]'):
        groups = page.locator('#bd-tools [data-group]').evaluate_all('es=>es.map(e=>e.dataset.group)')
        for group in groups:
            press(page, f'[data-group="{group}"]', width)
            if shown(page, f'[data-tool="{kind}"]'):
                break
    need(shown(page, f'[data-tool="{kind}"]') and page.locator(f'[data-tool="{kind}"]').is_enabled(),
         f'{kind} 도구 사용 가능')
    if page.locator(f'[data-tool="{kind}"]').get_attribute('aria-pressed') != 'true':
        press(page, f'[data-tool="{kind}"]', width)


def count(page):
    return page.evaluate('() => KCP.buildGame.current().builds.length')


def money(page):
    return page.locator('#bd-hud [data-cap="budget"] [data-v]').inner_text().strip()


def shortage_text(page):
    # 새 알림의 단추 글자를 부족 문장에 합치지 않는다. 기준판은 span이 없다.
    msg = page.locator('#bd-toast .bd-toast-msg')
    return (msg if msg.count() else page.locator('#bd-toast')).text_content().strip()


def place_attempt(page, kind, index, width):
    before = count(page)
    toast_seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
    tile(page, index, width)
    if width != 1280 and count(page) == before and (
            page.locator('#bd-toast').get_attribute('data-toast-seq') == toast_seq or
            not re.fullmatch(SHORT, shortage_text(page))):
        tile(page, index, width)
    if shown(page, '#bd-cf-ok'):
        press(page, '#bd-cf-ok', width)
    frames(page)
    return count(page) > before


def candidates(page, kind):
    # 적법성·점유만 읽는다. 예산/판정 값은 바꾸지 않는다.
    return page.evaluate('''kind=>{const B=KCP.buildGame,used=new Set(B.current().builds.map(b=>b.i));
      return B.TILES.filter(t=>!used.has(t.i)&&!B.siteRule(kind,t))
       .sort((a,b)=>(a.t==='forest')-(b.t==='forest')||a.i-b.i).map(t=>t.i);}''', kind)


FONT_VIEW = r"""() => {
 const {visible,box,inside,overlaps}=DOM_HELPERS;
 const task=document.querySelector('#lg-coach-task');
 const names=[...document.querySelectorAll('#bd-tools .bd-tool-n,#bd-undo>span,#bd-subtools .bd-tool-n')].filter(visible);
 const coach=[...document.querySelectorAll('#lg-coach button')].filter(visible);
 const buttons=[...new Set(names.map(e=>e.closest('button'))),...coach];
 const row=e=>({text:e.textContent.trim(),size:parseFloat(getComputedStyle(e).fontSize),
  fits:e.scrollWidth<=e.clientWidth+1,inside:inside(box(e),box(e.closest('button'))),
  keep:getComputedStyle(e).wordBreak==='keep-all'});
 return {names:names.map(row),coach:coach.map(e=>({size:parseFloat(getComputedStyle(e).fontSize)})),
  task:{size:task?parseFloat(getComputedStyle(task).fontSize):0,
   fits:!!task&&task.scrollHeight<=task.clientHeight+1&&task.scrollWidth<=task.clientWidth+1},
  sizes:buttons.map(e=>box(e)),noOverlap:buttons.every((e,i)=>buttons.slice(i+1).every(f=>!overlaps(box(e),box(f)))),
  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
}""".replace('DOM_HELPERS', DOM)


def font_sample(checks, page, width, label, measure):
    if label == '화력 하위':
        need(page.locator('#bd-subtools .bd-tool-n:visible').count() > 0,
             'D 화력 하위 이름 실제 표시')
    v = page.evaluate(FONT_VIEW)
    info(f'D {width} {label} 글자', v)
    if measure and width == 390:
        # 결과 서랍이 도구 이름을 가린 6/8은 보이는 이름의 공집합을 허용한다.
        checks.ok((label == '6/8' or bool(v['names'])) and bool(v['coach']) and v['task']['size'] >= 14 and
                  all(r['size'] >= 14 for r in v['names'] + v['coach']), label + ' 이름·코치 글자≥14')
        checks.ok(all(r['fits'] and r['inside'] for r in v['names']), label + ' 이름 잘림0·단추 안')
        checks.ok(v['task']['fits'], label + ' 코치 문장 잘림0')
        checks.ok(bool(v['sizes']) and all(r['width'] >= 44 and r['height'] >= 44 for r in v['sizes']), label + ' 단추44')
        checks.ok(v['noOverlap'] and all(r['keep'] for r in v['names']), label + ' 단추 교차0·keep-all')
        checks.ok(v['overflow'] <= 0, label + ' 가로 넘침0')
    if measure:
        checks.shot(page, f'D-{width}-{label.replace("/", "-").replace(" ", "-")}')


def step(page, n):
    page.wait_for_selector(f'#lg-coach[data-step="{n}"]', state='visible', timeout=30000)
    frames(page)


def operate(page, width):
    close_drawer(page)
    press(page, '#lg-ready', width)
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    press(page, '#lg-predict [data-evidence]:enabled', width)
    field = page.locator('#lg-predict [data-pred]').first
    down = field.locator('option[value="down"]')
    field.select_option('down' if down.count() and down.get_attribute('disabled') is None else 'same')
    press(page, '[data-confidence="fairly"]', width)
    press(page, '#lg-ready-confirm', width)
    # 서랍을 수동으로 열지 않는다. 자동 열림과 재생 완료를 기다린다.
    page.wait_for_function("() => KCP.league.state().S.phase==='review'", timeout=180000)
    page.wait_for_selector('#lg-panel[data-tab="result"]:not([data-folded="true"]) #lg-promise-summary',
                           state='visible', timeout=30000)
    page.wait_for_timeout(4500)
    frames(page)


RESULT_VIEW = r"""() => {
 const {box,visible,inside,overlaps,hit,target}=DOM_HELPERS;
 const panel=document.querySelector('#lg-panel'),body=panel?.querySelector('.lg-pbody');
 if(!body)return null;
 const b=box(body),win={left:Math.max(0,b.left),top:Math.max(0,b.top),right:Math.min(innerWidth,b.right),bottom:Math.min(innerHeight,b.bottom)};
 const get=s=>{const e=document.querySelector(s);return {...target(e),first:!!e&&inside(box(e),win)};};
 const coach=document.querySelector('#lg-coach'),map=document.querySelector('#lg-map-result');
 const cs=['#lg-coach-action','#lg-coach-skip','#lg-coach-close'].map(s=>get(s));
 const ids=['#lg-result-head','#lg-result-deltas','#lg-promise-summary','#lg-missed'];
 const order=ids.map(s=>document.querySelector(s));
 return {win,body:b,scroll:body.scrollTop,y:scrollY,tab:panel.dataset.tab,folded:panel.dataset.folded,
  head:get(ids[0]),deltas:get(ids[1]),summary:get(ids[2]),detail:get('#lg-promise-summary [data-promise-details]'),
  order:order.every(Boolean)&&order.slice(1).every((e,i)=>!!(order[i].compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)),
  coachOK:!!coach&&(!overlaps(box(coach),box(panel))||(cs.every(r=>r.hit)&&get('#lg-promise-summary [data-promise-details]').hit)),
  mapOK:!visible(map)||!overlaps(box(map),box(panel))};
}""".replace('DOM_HELPERS', DOM)


def coach_flow(checks, page, base, width, acceptance=False, fonts=False):
    lobby(page, base, city='pyeongtaek', coach=True)
    step(page, 1)
    font_sample(checks, page, width, '1/8', fonts)
    press(page, '#lg-coach-action', width)  # 사건 보기
    step(page, 2)
    close_drawer(page)
    font_sample(checks, page, width, '2/8', fonts)
    press(page, '#lg-coach-action', width)
    if not shown(page, '[data-tool="diesel"]'):
        press(page, '[data-group="fire"]', width)
    font_sample(checks, page, width, '화력 하위', fonts)
    select_tool(page, 'diesel', width)
    before = count(page)
    near = page.evaluate(NEAR_TOWN_JS, 'diesel')
    need(near and any(place_attempt(page, 'diesel', i, width) for i in near), '코치 디젤 1기')
    need(count(page) == before + 1, '디젤 정확히 1기')
    step(page, 3)
    press(page, '#lg-coach-action', width)
    for _ in range(5):
        ends = page.evaluate(LINE_ENDS_JS)
        if not ends:
            break
        tile(page, ends[0], width)
        tile(page, ends[1], width)
        if shown(page, '#bd-cf-ok'):
            press(page, '#bd-cf-ok', width)
    step(page, 4)
    press(page, '#lg-coach-action', width)
    finish_trial(page)
    step(page, 5)
    # 성적표를 읽기 위해 필요할 때만 열고 측정 전에 닫는다.
    if not shown(page, '#bd-league-goals'):
        press(page, '#bd-pm', width)
    rows = page.locator('#bd-league-goals .bd-mis-row').evaluate_all(
        'es=>es.map(e=>({text:e.textContent.trim(),ok:e.dataset.ok}))')
    row = next((r for r in rows if r['text'].startswith('정전')), None)
    need(row and row['ok'] in ('true', 'false'), '1월 정전 목표 성적표')
    nums = re.search(r'시험 ([\d,.]+)%\s*/\s*목표 ≤ ([\d,.]+)%', row['text'])
    need(nums, '성적표 시험·목표 숫자')
    if shown(page, '#bd-drawer-x'):
        press(page, '#bd-drawer-x', width)
    font_sample(checks, page, width, '5/8', fonts)
    if acceptance:
        # 개정 1: 기준판 coach done[3]은 시험 뒤 #bd-again 표시를 요구한다.
        # 건너뛰기 없는 시험 전 5/8 경로는 없어 독립 '시험 없음' 장면은 생략한다.
        # 성적표가 목표 안이면 같은 고정 슬롯에서 원래 글자를 검사한다.
        expected = (COACH_READY if row['ok'] == 'true' else
                    f"약속 · 5/8 시험 정전 {nums[1]}%가 목표 {nums[2]}%보다 커요 · "
                    "설비·송전선을 더해 다시 시험하거나, 그대로 '준비'를 눌러도 돼요")
        label = '목표 안 원래 문구' if row['ok'] == 'true' else '성적표 숫자·확정 문구'
        checks.ok(page.locator('#lg-coach-task').text_content() == expected, 'A1 5/8 ' + label)
        checks.ok(not clipped(page, '#lg-coach-task'), 'A1 코치 문장 잘림0')
        checks.ok(page.evaluate("() => KCP.league.state().S.phase==='plan'"), 'A1 계획 단계')
        checks.ok(page.evaluate('() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth'), 'A1 가로 넘침0')
    if acceptance:
        checks.shot(page, f'A1-{width}')
    # 목표 안 문구를 관측했더라도 필수 '목표 초과' 장면을 대체하지 않는다.
    need(row['ok'] == 'false', 'A1 디젤 1기·기존 LNG 연결 뒤 목표 초과 장면')
    operate(page, width)
    step(page, 6)
    page.evaluate("() => {window.scrollTo(0,0);document.querySelector('#lg-panel .lg-pbody').scrollTop=0;}")
    frames(page)
    font_sample(checks, page, width, '6/8', fonts)
    if acceptance:
        v = page.evaluate(RESULT_VIEW)
        need(v, '자동 열린 결과 서랍')
        info(f'A3 {width} 판정·본문·첫 화면 창', v)
        topic = re.match(r'^(정전|현금|계통) 예측:', v['summary']['text'])
        checks.ok(bool(topic), 'A2 판정 줄 주제·접두사')
        expected = (f"예측 대 실제 · 6/8 운영 끝 · 숫자 칸 아래 '{topic[1] if topic else '?'} 예측' 줄에서 "
                    '내 예측과 실제를 비교해요')
        checks.ok(page.locator('#lg-coach-task').text_content() == expected, 'A2 6/8 주제·확정 문구')
        checks.ok(v['tab'] == 'result' and v['folded'] != 'true' and v['scroll'] == 0 and v['y'] == 0, 'A3 첫 화면 조건')
        checks.ok(v['summary']['visible'] and v['summary']['first'], 'A3 판정 줄 전체 첫 화면 안')
        checks.ok(v['detail']['visible'] and v['detail']['hit'], 'A3 예측 자세히 hit')
        checks.ok(v['head']['visible'] and v['head']['first'], 'A3 제목 전체 첫 화면 안')
        checks.ok(v['deltas']['visible'] and v['deltas']['first'], 'A3 숫자 칸 전체 첫 화면 안')
        checks.ok(v['order'], 'A3 제목→숫자→판정→원인 순서')
        checks.ok(v['coachOK'], 'A3 코치·서랍 교차 시 네 단추 hit')
        checks.ok(v['mapOK'], 'A3 지도 결과 한 줄·서랍 교차0')
        checks.ok(not clipped(page, '#lg-coach-task'), 'A3 코치 문장 잘림0')
        checks.ok(page.locator('#lg-coach-action').text_content() == '예측 자세히', 'A2 행동 유지')
        checks.ok(page.evaluate('() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth'), 'A3 가로 넘침0')
    if acceptance:
        checks.shot(page, f'A3-{width}')
    # ux_coach와 같은 7→8 경로. skip은 호출하지 않는다.
    press(page, '#lg-coach-action', width)
    step(page, 7)
    if page.locator('#lg-missed[data-single="true"]').count() == 0:
        cards = page.locator('#lg-outage-cards [data-missed]')
        if cards.count():
            press(page, '#lg-outage-cards [data-missed]', width)
    press(page, '#lg-coach-action', width)
    step(page, 8)
    if acceptance:
        checks.ok(page.locator('#lg-coach').get_attribute('data-step') == '8', 'A 8/8 도달·건너뛰기0')
    if fonts and width != 390:
        checks.ok(page.locator('#lg-coach').get_attribute('data-step') == '8', 'D 넓은 폭 경로·글자 INFO 완료')


def A(checks, page, base, width):
    coach_flow(checks, page, base, width, acceptance=True)


def D(checks, page, base, width):
    coach_flow(checks, page, base, width, fonts=True)


TOAST_VIEW = r"""() => {
 const {box,visible,hit,inside,overlaps,target}=DOM_HELPERS,t=document.querySelector('#bd-toast');
 const btn=s=>{const e=document.querySelector(s);return {...target(e),aria:e?.getAttribute('aria-label'),
  contained:!!e&&!!t&&inside(box(e),box(t)),pointer:e?getComputedStyle(e).pointerEvents:null};};
 const blocks=[...document.querySelectorAll('#bd-dock,[data-run],#lg-coach')].filter(visible);
 const controls=[...document.querySelectorAll('#bd-dock button,[data-run],#lg-coach button,'+
  '#lg-panel-fold,#lg-panel [data-pclose],#bd-drawer-x')].filter(visible);
 const parts=[...document.querySelectorAll('#bd-toast .bd-toast-msg,#bd-toast-undo,#bd-toast-remove')].filter(visible);
 const collisions=parts.flatMap(e=>controls.filter(c=>overlaps(box(e),box(c))).map(c=>({
  part:e.id||e.className,control:c.id||c.getAttribute('data-tool')||c.textContent.trim(),
  area:(Math.min(box(e).right,box(c).right)-Math.max(box(e).left,box(c).left))*
       (Math.min(box(e).bottom,box(c).bottom)-Math.max(box(e).top,box(c).top))})));
 return {toast:target(t),open:!!t&&t.dataset.show==='true'&&visible(t)&&+getComputedStyle(t).opacity>0,
  phase:t?.dataset.phase,actions:t?.dataset.actions,collisions,controls:controls.length,
  focused:!!t?.contains(document.activeElement),
  msg:document.querySelector('#bd-toast .bd-toast-msg')?.textContent.trim(),
  msgSpan:t?.querySelector('.bd-toast-msg')?.tagName==='SPAN',
  acts:t?.querySelector('.bd-toast-acts')?.tagName==='SPAN'&&
   [...t.querySelectorAll('#bd-toast-undo,#bd-toast-remove')].every(e=>e.closest('.bd-toast-acts')),
  pointer:t?getComputedStyle(t).pointerEvents:null,
  undo:btn('#bd-toast-undo'),remove:btn('#bd-toast-remove'),
  overlap:!!t&&blocks.some(e=>overlaps(box(t),box(e)))};
}""".replace('DOM_HELPERS', DOM)


def budget_tools(page, width):
    """실제 열린 도구 목록의 잠기지 않은 설비만 공개 BLD 비용순으로 읽는다."""
    kinds = set()

    def collect():
        kinds.update(page.locator('[data-tool]').evaluate_all('''es=>{
          const D=DOM_HELPERS,B=KCP.buildGame;
          return es.filter(e=>D.visible(e)&&!e.disabled&&B.BLD[e.dataset.tool])
            .map(e=>e.dataset.tool);
        }'''.replace('DOM_HELPERS', DOM)))

    collect()
    groups = page.locator('#bd-tools [data-group]').evaluate_all('es=>es.map(e=>e.dataset.group)')
    for group in groups:
        press(page, f'#bd-tools [data-group="{group}"]', width)
        collect()
    tools = page.evaluate('''kinds=>kinds.map(kind=>({kind,cost:KCP.buildGame.BLD[kind].cost}))
      .sort((a,b)=>b.cost-a.cost||a.kind.localeCompare(b.kind))''', sorted(kinds))
    tools = [t for t in tools if candidates(page, t['kind'])]
    info(f'E {width} 설치 가능 도구·비용', tools)
    need(tools, 'E 적법 후보가 있는 잠기지 않은 설비 도구')
    return tools


def budget_info(page, width, stage, kind, attempts=0, installed=0):
    info(f'E {width} {stage}', {'tool': kind, 'attempts': attempts, 'installed': installed,
                               'builds': count(page), 'money': money(page)})


def placement_costs(page, tools):
    # 새 배열의 후보 계획으로 비용만 읽는다. 실제 계획에는 쓰지 않는다.
    return page.evaluate('''tools=>{const B=KCP.buildGame,s=B.current(),used=new Set(s.builds.map(b=>b.i));
      return tools.flatMap(({kind})=>B.TILES.filter(t=>!used.has(t.i)&&!B.siteRule(kind,t))
        .map(t=>({kind,index:t.i,cost:B.capex({...s,builds:[...s.builds,{t:kind,i:t.i}]})-B.capex(s)})))
        .sort((a,b)=>b.cost-a.cost||a.index-b.index);}''', tools)


def cash_value(text):
    return float(text.replace(',', '').replace('억', '').replace('−', '-'))


def keyboard_activate(checks, page, selector):
    """focus()/합성 click 없이 실제 Tab 순회 뒤 Enter로 고침 단추를 누른다."""
    need(target(page, selector)['visible'], 'E 키보드 고침 단추 표시')
    # 숨긴 입력까지 포함한 유한 상한. 반복 횟수와 관계없이 단언은 하나다.
    limit = page.locator('a[href],button,input,select,textarea,[tabindex]').count() + 2
    reached = False
    for _ in range(limit):
        page.keyboard.press('Tab')
        if page.evaluate('s=>document.activeElement?.matches(s)===true', selector):
            reached = True
            break
    checks.ok(reached, 'E Tab으로 ' + selector + ' 초점 도달')
    need(reached, 'E Tab 순회로 고침 단추에 도달하지 못함')
    page.keyboard.press('Enter')
    frames(page)


def repeat_shortage(page, width, rejected, journal=False):
    """직전 거절 도구로 재현하되, 폰의 열린 서랍에서는 직접 누를 수 있는 칸만 쓴다."""
    kind, index = rejected
    need(index in candidates(page, kind), 'E 다시 거절할 칸이 여전히 비어 있고 적법함')
    select_tool(page, kind, width)
    if journal:
        press(page, '#lg-bar [data-panel="journal"]', width)
        need(target(page, '#lg-panel[data-tab="journal"]:not([hidden]):not([data-folded="true"])')['visible'],
             'E 부족을 만들기 전에 열린 일지 서랍')
        if width == 390:
            cash = cash_value(money(page))
            # HUD 반올림 오차보다 비싼 적법·빈 칸만 고른다. 서랍 아래 칸을
            # reveal_tile로 옮기려 하지 않고 현재 중심의 실제 지도 hit를 읽는다.
            choices = page.evaluate('''choices=>{const B=KCP.buildGame,canvas=document.querySelector('#bd-canvas');
              return choices.filter(({index})=>{const t=B.TILES[index],p=B.tileXY(t.c,t.r);
                return p&&canvas&&document.elementFromPoint(...p)===canvas;});
            }''', [c for c in placement_costs(page, [{'kind': kind}]) if c['cost'] > cash + 0.1])
            if choices:
                index = choices[0]['index']
                info(f'E {width} 일지 부족 경로', {'route': '서랍 열림에서 노출 칸 거절',
                     'tool': kind, 'index': index, 'cost': choices[0]['cost'], 'money': cash})
            else:
                info(f'E {width} 일지 부족 경로', {'route': '부족 알림 뒤 서랍 열기',
                     'tool': kind, 'index': index, 'money': cash})
                close_drawer(page)
                repeat_shortage(page, width, rejected)
                seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
                press(page, '#lg-bar [data-panel="journal"]', width)
                need(page.locator('#bd-toast').get_attribute('data-toast-seq') == seq and
                     not toast_closed(page) and re.fullmatch(SHORT, shortage_text(page)),
                     'E 일지 서랍 열기는 계획 변경이 아니므로 같은 부족 알림 유지')
                return
    seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
    installed = place_attempt(page, kind, index, width)
    need(not installed and page.locator('#bd-toast').get_attribute('data-toast-seq') != seq and
         not toast_closed(page) and re.fullmatch(SHORT, shortage_text(page)),
         'E 새 부족 알림 재현·설비 설치 거절')
    frames(page)


def changed_shortage(checks, page, width, tools, rejected):
    repeat_shortage(page, width, rejected)
    cash = cash_value(money(page))
    affordable = sorted((t for t in placement_costs(page, tools)
                         if t['index'] != rejected[1] and 0 < t['cost'] < cash - 0.1),
                        key=lambda t: (t['cost'], t['index'], t['kind']))
    need(affordable, 'E 부족 알림 중 다른 칸에 설치할 싼 설비·자금')
    choice = affordable[0]
    before = count(page)
    seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
    select_tool(page, choice['kind'], width)
    need(not toast_closed(page) and page.locator('#bd-toast').get_attribute('data-toast-seq') == seq,
         'E 도구만 고른 뒤에도 같은 부족 알림 유지')
    installed = place_attempt(page, choice['kind'], choice['index'], width)
    need(installed and count(page) == before + 1, 'E 다른 칸의 싼 설비 실제 설치 성공')
    checks.ok(toast_closed(page), 'E 계획 변경·싼 설비 설치로 부족 알림 닫힘')
    checks.ok(page.locator('#bd-toast').get_attribute('data-actions') == 'false',
              'E 계획 변경 뒤 data-actions=false')


def journal_shortage(checks, page, width, rejected):
    repeat_shortage(page, width, rejected, journal=True)
    v = page.evaluate(TOAST_VIEW)
    info(f'E-1 {width} 열린 일지 서랍·알림 교차', v)
    checks.ok(page.evaluate("() => KCP.league.state().S.phase==='plan'") and
              target(page, '#lg-panel[data-tab="journal"]:not([hidden]):not([data-folded="true"])')['visible'],
              'E-1 부족 뒤에도 계획·일지 서랍 열림 유지')
    checks.ok(v['open'] and v['phase'] == 'plan' and v['actions'] == 'true',
              'E-1 일지 서랍 열림에서도 단추 알림 보임·계획 자리')
    checks.ok(v['undo']['visible'] and v['undo']['hit'], 'E-1 일지 열림 되돌리기 보임·hit')
    checks.ok(v['remove']['visible'] and v['remove']['hit'], 'E-1 일지 열림 철거 도구 보임·hit')
    checks.ok(v['controls'] > 0 and not v['collisions'],
              'E-1 문장·단추와 도크·시험·코치·서랍 머리 단추 교차 면적0')
    checks.shot(page, f'E-journal-{width}')
    close_drawer(page)


def exhaust(page, width, tools):
    """디젤 1기로 이력을 만든 뒤 고가 설비의 모든 적법 후보를 UI로 시도한다."""
    budget_info(page, width, '준비 시작', 'diesel')
    select_tool(page, 'diesel', width)
    last_money = None
    for attempt_no, i in enumerate(candidates(page, 'diesel'), 1):
        cash = money(page)
        if place_attempt(page, 'diesel', i, width):
            last_money = cash
            budget_info(page, width, '되돌릴 디젤 1기 설치', 'diesel', attempt_no, 1)
            break
    need(last_money is not None, 'E 되돌릴 디젤 1기 설치 가능')
    totals = {'diesel': 1}
    for tool in tools:
        kind = tool['kind']
        select_tool(page, kind, width)
        indices = candidates(page, kind)  # 80칸 같은 임의 상한 없이 전부 시도한다.
        installed = 0
        budget_info(page, width, f'후보 {len(indices)}칸·단가 {tool["cost"]}억', kind)
        for attempt_no, i in enumerate(indices, 1):
            cash = money(page)
            if place_attempt(page, kind, i, width):
                last_money = cash
                installed += 1
                totals[kind] = totals.get(kind, 0) + 1
                budget_info(page, width, '설치', kind, attempt_no, installed)
            elif not toast_closed(page) and re.fullmatch(SHORT, shortage_text(page)):
                budget_info(page, width, '예산 거절', kind, attempt_no, installed)
                info(f'E {width} 준비 설치 합계', totals)
                return last_money, (kind, i)
        budget_info(page, width, '모든 후보 소진', kind, len(indices), installed)
    need(False, f'E 모든 사용 가능 설비·적법 후보 소진 후에도 부족 없음: 남은 돈 {money(page)}, 설치 {totals}')


def no_undo_shortage(page, width, tools, initial_money, expensive):
    """단일 설비가 초기 자금보다 비싸지 않으면 저장 계획 재열기로 이력만 비운다."""
    if expensive:
        undone = 0
        while page.locator('#bd-undo').is_enabled():
            before = count(page)
            press(page, '#bd-undo', width)
            need(count(page) < before, 'E 조건4 되돌리기마다 설비 감소')
            undone += 1
            budget_info(page, width, '조건4 되돌림', 'undo', undone)
        need(money(page) == initial_money, 'E 조건4 되돌리기로 초기 자금 복원')
        choice = expensive[0]
        select_tool(page, choice['kind'], width)
        place_attempt(page, choice['kind'], choice['index'], width)
        budget_info(page, width, '조건4 초기 자금 초과 단일 설비', choice['kind'], 1)
    else:
        # 기준판 mount의 undo=[]와 리그 save/load 경로. 저장소/계획을 직접 쓰지 않는다.
        # 전액 되돌리면 초기 자금이 돌아와 고가 설비도 살 수 있으므로 계획은 유지한다.
        before_count, before_money = count(page), money(page)
        round_before = page.evaluate('() => KCP.league.state().S.round')
        budget_info(page, width, '조건4 저장 계획 새로고침 전', 'reload')
        page.reload()
        page.wait_for_selector('#bd-canvas')
        page.wait_for_function("() => KCP.buildGame.current() && KCP.league.state().S.phase==='plan'")
        frames(page)
        close_drawer(page)
        need(count(page) == before_count and money(page) == before_money and
             page.evaluate('() => KCP.league.state().S.round') == round_before,
             f'E 조건4 단일 설비가 초기 {initial_money}보다 비싸지 않고 재열기 시 같은 달 계획·돈 유지 실패')
        need(not page.locator('#bd-undo').is_enabled(),
             f'E 조건4 단일 설비가 초기 {initial_money}보다 비싸지 않고 재열기 후에도 되돌리기 이력 있음')
        budget_info(page, width, '조건4 저장 계획 재열기·되돌리기 없음', 'reload')
        made = False
        for tool in tools:
            kind = tool['kind']
            select_tool(page, kind, width)
            for attempt_no, i in enumerate(candidates(page, kind), 1):
                installed = place_attempt(page, kind, i, width)
                budget_info(page, width, '조건4 거절 시도', kind, attempt_no, int(installed))
                need(not installed, 'E 조건4 저장된 부족 계획에서 예상 밖 설치 성공')
                if not toast_closed(page) and re.fullmatch(SHORT, shortage_text(page)):
                    made = True
                    break
            if made:
                break
        need(made, f'E 조건4 초기 {initial_money} 초과 단일 설비 없음·저장 계획 재열기 후 부족 재현 실패')
    need(not page.locator('#bd-undo').is_enabled() and not toast_closed(page) and
         re.fullmatch(SHORT, shortage_text(page)), 'E 되돌릴 것 없는 상태의 실제 부족')


def toast_closed(page):
    # 기준판은 opacity로 숨긴다. 사각형이 남아도 data-show=false면 닫힘이다.
    return page.locator('#bd-toast').get_attribute('data-show') != 'true'


def E(checks, page, base, width):
    lobby(page, base, city='pyeongtaek', fixed=True)
    close_drawer(page)
    initial_money = money(page)
    tools = budget_tools(page, width)
    # 설치 전에 초기 자금 초과 단일 설비 유무부터 확인한다.
    # capex는 새 배열을 가진 후보 계획을 읽기만 한다. 숲 정리비도 포함한다.
    costs = placement_costs(page, tools)
    initial = cash_value(initial_money)
    expensive = [t for t in costs if t['cost'] > initial + 0.1]  # HUD 반올림 경계는 재열기 경로로
    info(f'E {width} 조건4 초기 자금·단일 설비 비교',
         {'initialMoney': initial_money, 'maxCost': costs[0]['cost'] if costs else None,
          'moreExpensive': expensive[:1]})
    previous, rejected = exhaust(page, width, tools)
    n = count(page)
    focus = page.evaluate('() => document.activeElement?.id')
    v = page.evaluate(TOAST_VIEW)
    checks.ok(v['msgSpan'] and bool(v['msg']) and bool(re.fullmatch(SHORT, v['msg'] or '')), 'E 부족 글자 span·기준판 형식')
    checks.ok(v['acts'], 'E 알림 단추 묶음')
    checks.ok(v['undo']['visible'] and v['undo']['hit'], 'E 되돌리기 보임·hit')
    checks.ok(v['remove']['visible'] and v['remove']['hit'], 'E 철거 도구 보임·hit')
    checks.ok(v['undo']['text'] == '되돌리기' and v['undo']['aria'] == E3, 'E 되돌리기 문구·aria')
    checks.ok(v['remove']['text'] == '철거 도구' and v['remove']['aria'] == E2, 'E 철거 문구·aria')
    checks.ok(all(r.get('width', 0) >= 44 and r.get('height', 0) >= 44 for r in (v['undo'], v['remove'])), 'E 두 단추44')
    checks.ok(v['undo']['contained'] and v['remove']['contained'], 'E 단추 알림 안')
    checks.ok(not v['overlap'], 'E 알림·도구·시험·코치 교차0')
    checks.ok(v['pointer'] == 'none' and all(r['pointer'] == 'auto' for r in (v['undo'], v['remove'])), 'E 단추만 pointer auto')
    page.wait_for_timeout(3100)
    later = page.evaluate(TOAST_VIEW)
    checks.ok(later['open'] and later['remove']['hit'], 'E 3초 뒤 유지')
    checks.ok(not v['focused'] and not later['focused'] and
              page.evaluate('() => document.activeElement?.id') == focus, 'E 알림 초점 강탈0·대기 중 초점 유지')
    checks.ok(page.evaluate('() => Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth'), 'E 가로 넘침0')
    checks.shot(page, f'E-{width}')
    # 기준판에서 없는 단추를 기다리며 후속을 거짓 통과시키지 않는다.
    need(v['undo']['visible'], 'E 고침 단추 필요')
    keyboard_activate(checks, page, '#bd-toast-undo')
    budget_info(page, width, '알림 되돌리기 후', 'undo', 1)
    checks.ok(count(page) == n - 1, 'E 되돌리기 설비수−1')
    checks.ok(money(page) == previous, 'E 되돌리기 마지막 설치 전 남은 돈 복원')
    checks.ok(toast_closed(page), 'E 되돌리기 알림 닫힘')
    checks.ok(page.locator('#bd-toast').get_attribute('data-actions') == 'false', 'E-2 되돌리기 뒤 data-actions=false')
    focus_target = '#bd-undo' if page.locator('#bd-undo').is_enabled() else '[data-tool="remove"]'
    checks.ok(page.evaluate('s=>document.activeElement?.matches(s)===true', focus_target),
              'E-3 키보드 되돌리기 뒤 켜진 되돌리기·아니면 철거 도구로 초점')
    _, rejected = exhaust(page, width, tools)
    n, cash = count(page), money(page)
    keyboard_activate(checks, page, '#bd-toast-remove')
    budget_info(page, width, '알림 철거 도구 선택 후', 'remove', 1)
    checks.ok(page.locator('[data-tool="remove"][aria-pressed="true"]').count() == 1, 'E 철거 도구 선택')
    checks.ok(toast_closed(page), 'E 철거 선택 알림 닫힘')
    checks.ok(count(page) == n and money(page) == cash, 'E 철거 도구 선택만으로 지도·돈 불변')
    checks.ok(page.locator('#bd-toast').get_attribute('data-actions') == 'false', 'E-2 철거 선택 뒤 data-actions=false')
    checks.ok(page.evaluate('() => document.activeElement?.matches(\'[data-tool="remove"]\')===true'),
              'E-3 키보드 철거 도구 선택 뒤 철거 도구로 초점')
    repeat_shortage(page, width, rejected)
    seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
    select_tool(page, 'remove', width)
    need(page.locator('[data-tool="remove"][aria-pressed="true"]').count() == 1 and
         not toast_closed(page) and page.locator('#bd-toast').get_attribute('data-toast-seq') == seq,
         'E 철거 도구가 이미 골라진 상태·같은 부족 알림')
    n, cash = count(page), money(page)
    press(page, '#bd-toast-remove', width)
    checks.ok(page.locator('[data-tool="remove"][aria-pressed="true"]').count() == 1,
              'E 이미 고른 철거 도구는 알림 단추를 눌러도 선택 유지')
    checks.ok(toast_closed(page), 'E 이미 고른 철거 도구 알림 닫힘')
    checks.ok(page.locator('#bd-toast').get_attribute('data-actions') == 'false',
              'E-2 이미 고른 철거 뒤 data-actions=false')
    checks.ok(count(page) == n and money(page) == cash, 'E 이미 고른 철거 단추로 지도·돈 불변')
    changed_shortage(checks, page, width, tools, rejected)
    if width in (1024, 390):
        journal_shortage(checks, page, width, rejected)
    no_undo_shortage(page, width, tools, initial_money, expensive)
    v = page.evaluate(TOAST_VIEW)
    checks.ok(page.locator('#bd-toast-undo').count() == 0, 'E 되돌릴 것 없으면 단추 생성0')
    checks.ok(v['remove']['visible'] and v['remove']['hit'] and v['acts'], 'E 철거 단추만 보임·hit')
    checks.ok(bool(re.fullmatch(SHORT, v['msg'] or '')), 'E 되돌릴 것 없는 부족 문구')
    checks.shot(page, f'E-no-undo-{width}')
    need(v['open'] and v['remove']['visible'], 'E-2 수명 측정할 실제 단추 알림')
    seq = page.locator('#bd-toast').get_attribute('data-toast-seq')
    # 앱 시계/타이머를 주입하지 않고 같은 알림의 실제 10초 수명을 기다린다.
    page.wait_for_timeout(10100)
    checks.ok(page.locator('#bd-toast').get_attribute('data-toast-seq') == seq and toast_closed(page),
              'E-2 다른 알림으로 교체 없이 10초 수명 뒤 닫힘')
    checks.ok(page.locator('#bd-toast').get_attribute('data-actions') == 'false',
              'E-2 수명 종료 뒤 data-actions=false')


def key_phase(checks, page, width, phase):
    grid_on(page, width != 1280)
    v = page.evaluate('''()=>{const town=document.querySelector('#bd-town-look-key'),grid=document.querySelector('#lg-lens-grid');
      return {town:town?.textContent.trim(),grid:grid?.textContent.trim(),warn:grid?.dataset.warn,
       contained:!!town?.closest('#lg-map-key-info')&&!!grid?.closest('#lg-map-key-info')};}''')
    need(v['warn'] != 'true', 'M 비경고 접기 장면')
    if width != 1280:
        checks.ok(not target(page, '#bd-town-look-key')['visible'] if phase == 'plan' else target(page, '#bd-town-look-key')['visible'], f'M {phase} 좁은 폭 범례')
        checks.ok(target(page, '#lg-map-key-toggle')['visible'] if phase == 'plan' else target(page, '#lg-lens-grid')['visible'], f'M {phase} 좁은 폭 토글/여유')
        if phase == 'plan':
            checks.ok(v['contained'], 'M 좁은 폭 계획 같은 DOM 상자 안')
        return
    t = target(page, '#lg-map-key-toggle')
    checks.ok(not target(page, '#bd-town-look-key')['visible'] and not target(page, '#lg-lens-grid')['visible'], f'M {phase} 두 줄 기본 접힘')
    checks.ok(t['visible'] and t['hit'], f'M {phase} 토글 보임·hit')
    checks.ok(t['text'] == '! 범례·여유' and page.locator('#lg-map-key-toggle').get_attribute('aria-label') == K1A, f'M {phase} 토글 문구·aria')
    checks.ok(t.get('width', 0) >= 44 and t.get('height', 0) >= 44, f'M {phase} 토글44')
    checks.ok(v['contained'] and bool(v['town']) and bool(v['grid']), f'M {phase} 같은 DOM·글자 비어있지 않음')
    checks.ok(page.evaluate('''()=>{const D=DOM_HELPERS,t=document.querySelector('#lg-map-key-toggle');
      return !!t&&[...document.querySelectorAll('#bd-dock,[data-run],#lg-coach')].filter(D.visible)
       .every(e=>!D.overlaps(D.box(t),D.box(e)));}'''.replace('DOM_HELPERS', DOM)), f'M {phase} 토글 교차0')
    need(t['visible'], 'M 넓은 화면 토글')
    press(page, '#lg-map-key-toggle', width)
    checks.ok(target(page, '#bd-town-look-key')['visible'] and target(page, '#lg-lens-grid')['visible'], f'M {phase} 한 번 눌러 두 줄 보임')
    checks.ok(page.locator('#bd-town-look-key').text_content().strip() == v['town'] and
              page.locator('#lg-lens-grid').text_content().strip() == v['grid'], f'M {phase} 펼친 글자·숫자 보존')
    press(page, '#lg-map-key-toggle', width)
    checks.ok(not target(page, '#bd-town-look-key')['visible'] and not target(page, '#lg-lens-grid')['visible'], f'M {phase} 다시 접힘')
    checks.shot(page, f'M-{phase}-{width}')


def M(checks, page, base, width):
    lobby(page, base, city='pyeongtaek', fixed=True)
    close_drawer(page)
    # 각 phase 실패가 다음 phase/경고 관측을 막지 않도록 독립 슬롯 묶음.
    attempt(checks, 'M 계획', lambda: key_phase(checks, page, width, 'plan'))
    operate(page, width)
    attempt(checks, 'M 결과', lambda: key_phase(checks, page, width, 'review'))
    if width == 1280:
        # 별도의 새 판 대신 같은 페이지의 저장소를 비우지 않고 새 로비에서 새 게임.
        page.goto(base + '#league')
        lobby(page, base, city='pyeongtaek', fixed=True)
        grid_on(page, False)
        initial = page.evaluate('() => {const L=KCP.league.state();return L.S.grid[L.team].headroomMW;}')
        select_tool(page, 'solar', width)
        added = 0
        mw = page.evaluate('() => KCP.buildGame.BLD.solar.mw')
        for i in candidates(page, 'solar')[:40]:
            if place_attempt(page, 'solar', i, width):
                added += mw
            if added > initial:
                break
        frames(page)
        grid = target(page, '#lg-lens-grid')
        checks.ok(added > initial, 'M 실제 추가 재생 용량>접속 여유')
        checks.ok(grid['visible'] and page.locator('#lg-lens-grid').get_attribute('data-warn') == 'true', 'M 경고 접속 여유 보임')
        checks.ok(page.locator('#lg-lens-grid').evaluate("e=>!e.closest('#lg-map-key-info')") and
                  bool(re.search(r'대기\s*[\d,.]*[1-9][\d,.]*\s*MW', grid['text'])), 'M 대기>0·경고 상자 밖')
        checks.shot(page, f'M-warning-{width}')


def single(checks, browser, base, item, width, height):
    context, external = context_for(Browser(browser, width), base, width, height, 'light')
    page, events = monitored_page(context)
    page.on('dialog', lambda d: d.accept())
    label = f'{item} {width}'
    checks.begin_scene()
    try:
        attempt(checks, label, lambda: globals()[item](checks, page, base, width))
    finally:
        checks.end_scene(BODY_COUNTS[width][item], label)
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
        parser.error('--widths: 1280,1024,390')
    if not selected or not selected <= set(ITEMS):
        parser.error('--only: A,E,M,D')
    if not widths or not widths <= set(MINIMUM_BY_WIDTH):
        parser.error('--widths: 1280,1024,390')
    checks = Checks()
    minimum = sum(MINIMUM_BY_WIDTH[w][k] for w in widths for k in selected)
    print(f'INFO 코드 기준 통과 하한 {minimum}, SKIP 가능 지점 0', flush=True)
    info('MINIMUM_BY_WIDTH', MINIMUM_BY_WIDTH)
    try:
        base = local_address(['rev20.py', args.base])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in SIZES:
                    if width in widths:
                        for item in ITEMS:
                            if item in selected:
                                single(checks, browser, base, item, width, height)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
