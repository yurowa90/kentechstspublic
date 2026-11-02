"""rev13 명세만으로 정한 수용 검사. 작성 세션에서는 py_compile만 실행한다.

허용된 샌드박스 밖 로컬 담당자 실행(브라우저 실행 금지 세션에서 실행하지 말 것):
  tests/.venv/bin/python tests/league/rev13.py http://127.0.0.1:<포트>/index.html
끝 줄 assertions N failures M. R1은 매 운영 직전 설치한 읽기 전용 rAF로 측정한다.
앱 결과/DOM/CSS/문구를 주입하지 않는다. 계획 수정은 기존 공개 plan API만 사용한다.
SKIP 허용: R2 S7 장면 미확보, R4 cash 주제 미확보, 같이2 고리의 공개 관측 수단 없음.
R1 프레임 0·R3 상태 미확보·R5 대상 미확보·실행 예외는 BLOCKED 실패다.
"""
import argparse
import json
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright
from d80b import apply_plan
from econui import (Checks as BaseChecks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, shown)
from fx_replay import reach_result
from league_flow import finish_trial, pass_issue_check, wait_unfolded
from rev11 import DOM, InputBrowser, frames, press, start
from rev12 import choose_diesel, tile_press
from rev8c import coach_step
from s7 import current_note, plan_and_trial
from solo import CHANGED_JS, click_next, close_drawer, read
from ux_coach import LINE_ENDS_JS, NEAR_TOWN_JS
from ux_s2fix import reveal_tile
from ux_task import TILE_XY_JS

# 선택자는 명세 및 기존 s7/rev11/rev12 검사에서 확인했다.
# 합계 줄에는 전용 id 계약이 없어 #lg-missed 안의 '차이 X' 문장을 읽는다.
VALUE = r'([+−-]?\d[\d,]*(?:\.\d+)?)\s*(MWh/일|%p)'
NUMBER = re.compile(VALUE)

# 알림이 보이기 전부터 첫 프레임·서랍 변화·소멸까지 끊김 없이 읽는다.
# show=true이고 계산 opacity>0.05인 프레임만 R1 집계한다. 실패 표본은 최대 8개.
RAF_PROBE = r"""month => {
  if(window.__rev13RAF) window.__rev13RAF.active=false;
  const p=window.__rev13RAF={month,active:true,seen:false,done:false,frames:0,drawerFrames:0,
    violations:0,maxArea:0,minLeft:null,maxRight:null,width:innerWidth,maxOverflow:0,
    lensArea:0,bodyArea:0,buttonArea:0,samples:[],error:null};
  const {visible,box,area}=(""" + DOM + r""");
  const scan=()=>{
    if(!p.active)return;
    try {
      p.maxOverflow=Math.max(p.maxOverflow,document.documentElement.scrollWidth-innerWidth,
        document.body ? document.body.scrollWidth-innerWidth : 0);
      const t=document.querySelector('#bd-toast[data-phase="result"]');
      const show=t?.dataset.show==='true', opacity=t ? +getComputedStyle(t).opacity : 0;
      if(show && visible(t) && opacity>0.05) {
        const r=box(t); p.seen=true;p.frames++;
        p.minLeft=p.minLeft===null?r.left:Math.min(p.minLeft,r.left);
        p.maxRight=p.maxRight===null?r.right:Math.max(p.maxRight,r.right);
        const panel=document.querySelector('#lg-panel');
        const drawer=document.querySelector('#bd-root')?.dataset.resultDrawer==='true' &&
          visible(panel) && panel.dataset.folded!=='true';
        if(drawer)p.drawerFrames++;
        const groups=[['lensArea','#lg-lens-grid, #lg-map-key-toggle'],
          ...(drawer ? [['bodyArea','#lg-panel .lg-pbody'],
            ['buttonArea','#lg-panel-fold, #lg-panel [data-pclose]']] : [])];
        let bad=r.left<0||r.right>innerWidth; const overlaps=[];
        for(const [key,selector] of groups) for(const target of document.querySelectorAll(selector)) {
          if(!visible(target))continue;
          const a=area(r,box(target));p[key]=Math.max(p[key],a);p.maxArea=Math.max(p.maxArea,a);
          if(a>0) {bad=true;overlaps.push({target:target.id||target.className,area:a});}
        }
        if(bad) {p.violations++;if(p.samples.length<8)p.samples.push({toast:r,drawer,overlaps});}
      }
      if(p.seen && (!t || (!show && opacity<=0.05))) {p.done=true;p.active=false;return;}
    } catch(e) {p.error=String(e);p.active=false;return;}
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
}"""


class Checks(BaseChecks):
    def __init__(self, out):
        super().__init__()
        self.out, self.skips = out, []

    def skip(self, label, reason):
        self.skips.append((label, reason))
        print(f'SKIP {label}: {reason}', flush=True)

    def blocked(self, label):
        self.ok(False, 'BLOCKED ' + label)

    def shot(self, page, path):
        def capture():
            path.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(path), full_page=False)
            return True
        self.test('캡처 ' + str(path), capture)

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


def debt_note(checks, page, label):
    data = page.evaluate(r"""() => {
      const {visible,box}=(""" + DOM + r""");
      const chip=document.querySelector('[data-cap="budget"]');
      const notes=chip ? [...chip.querySelectorAll('[data-money-note], .lg-debt-note')].filter(visible) : [];
      const note=notes.find(e=>/빚 한도/.test(e.innerText));
      const co2=document.querySelector('[data-cap="co2"]');
      const grant=chip&&chip.querySelector('[data-grant-chip]');
      const co2b=document.querySelector('[data-cap="co2"]');
      if(chip&&!note&&grant&&visible(grant))return {found:false,grantMonth:true,grantText:grant.innerText,title:chip.getAttribute('title'),
        noteHidden:[...chip.querySelectorAll('.lg-debt-note')].every(e=>e.hidden),chip:box(chip),co2:visible(co2b)?box(co2b):null};
      if(!chip||!note)return {found:false,chip:!!chip,notes:notes.map(e=>e.innerText)};
      const r=box(note),c=box(chip),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
      return {found:true,text:note.innerText.trim(),visible:visible(chip)&&visible(note),note:r,chip:c,
        hit:!!hit&&chip.contains(hit),noteScroll:note.scrollWidth,noteClient:note.clientWidth,
        chipScroll:chip.scrollWidth,chipClient:chip.clientWidth,title:chip.getAttribute('title'),
        co2:visible(co2)?box(co2):null,ellipsis:getComputedStyle(note).textOverflow};
    }""")
    if data.get('grantMonth') and page.viewport_size['width'] <= 760:
        # rev13 판단(총괄 확인 대상, score1 F1 회귀 해소): 좁은 칩의 셋째 줄이 교부세 '+n억 전용'인 달은 빚 꼬리표를 쉬어 칩 높이·'!' 자리를 지킨다.
        checks.ok(bool(re.match(r'^\+[\d.,]+억 전용$', data['grantText'] or '')), label + ' R3 교부세 달: 셋째 줄은 교부세 줄: ' + json.dumps(data, ensure_ascii=False))
        checks.ok(not data['title'] or '빚 한도 포함' in data['title'], label + ' R3 교부세 달: 칩 title에 빚 한도 포함 뜻')
        checks.ok(data['noteHidden'], label + ' R3 교부세 달: 빚 꼬리표는 hidden 속성으로 쉼(글자 깨짐이 아님)')
        checks.ok(data['co2'] is not None and data['chip']['bottom'] <= data['co2']['bottom'] + 1, label + ' R3 교부세 달: 머리 줄 높이 불변')
        return
    checks.ok(data['found'], label + ' R3 남은 돈 칩·빚 꼬리표 있음: ' + json.dumps(data, ensure_ascii=False))
    if not data['found']:
        return
    narrow = page.viewport_size['width'] <= 760
    checks.ok(data['visible'] and (data['text'] == '+빚 한도' if narrow else data['text'].startswith('(빚 한도 포함)')),
              f'{label} R3 폭별 보이는 글자: {data["text"]!r}')
    n, c = data['note'], data['chip']
    checks.ok(n['left'] >= c['left'] and n['right'] <= c['right'] and
              n['top'] >= c['top'] and n['bottom'] <= c['bottom'], label + ' R3 꼬리표 사각형이 칩 안')
    checks.ok(data['noteScroll'] <= data['noteClient'] + 1 and
              data['chipScroll'] <= data['chipClient'] + 1 and data['ellipsis'] != 'ellipsis',
              label + ' R3 꼬리표·칩 말줄임·가로 잘림 없음')
    checks.ok(data['hit'], label + ' R3 꼬리표 중심 elementFromPoint가 칩 안')
    if data['title']:
        checks.ok('빚 한도 포함' in data['title'], label + ' R3 칩 title에 빚 한도 포함 뜻')
    if narrow:
        checks.ok(data['co2'] is not None and c['bottom'] <= data['co2']['bottom'] + 1,
                  label + ' R3 남은 돈 아래 끝 ≤ CO₂ 시험·소비 칩 아래 끝 +1px')
    overflow(checks, page, label + ' R3')


def sample_result(checks, page, label):
    try:
        page.wait_for_function('() => __rev13RAF.done || __rev13RAF.error', timeout=30000)
    except Exception as exc:
        checks.blocked(label + ' R1 알림 소멸까지 관측 실패: ' + str(exc).splitlines()[0][:150])
    p = page.evaluate('() => {const p=__rev13RAF;p.active=false;return p;}')
    print('INFO ' + label + ' R1 rAF ' + json.dumps(p, ensure_ascii=False), flush=True)
    checks.ok(not p['error'], label + ' R1 측정기 오류 없음')
    checks.ok(p['frames'] > 0, f'BLOCKED {label} R1 측정 프레임 {p["frames"]} (0이면 수용 미검증)')
    checks.ok(p['done'], label + ' R1 첫 표시부터 사라질 때까지 관측 완료')
    checks.ok(p['violations'] == 0, f'{label} R1 위반 프레임 0: {p["violations"]}')
    for key in ('lensArea', 'bodyArea', 'buttonArea', 'maxArea'):
        checks.ok(p[key] == 0, f'{label} R1 {key} 최대 교차 넓이 0: {p[key]}')
    checks.ok(p['minLeft'] is not None and p['minLeft'] >= 0, f'{label} R1 최소 left ≥0: {p["minLeft"]}')
    checks.ok(p['maxRight'] is not None and p['maxRight'] <= p['width'],
              f'{label} R1 최대 right ≤innerWidth: {p["maxRight"]}')
    checks.ok(p['maxOverflow'] <= 0, label + ' R1 모든 관측 프레임 가로 넘침 0')
    if not p['drawerFrames']:
        print(f'INFO {label} R1 결과 서랍 열린 관측 프레임 없음; 본문·머리 단추 교차 조건 미관측', flush=True)


def promise_submit(page, touch):
    """기존 submit_r2_promise 흐름. 양방향 모두 허용되는 예측을 화면에서 고른다.

    확정 단추를 누른 뒤 달 전환(달·단계·결과 수 변화)까지 기다리고 돌아온다. 앱은 달 계산을
    한 프레임 미뤄 돌리므로(league.js deferMonthWork) 누른 직후의 상태는 아직 지난 '계획'이다.
    그 상태로 reach_result를 부르면 계산이 끝나 '다음 달'로 바뀐 같은 #lg-ready를 눌러
    1월 결과 단계를 건너뛰고, 1월 결과 단언이 2월 계획 화면에서 돌거나 RESULT_JS 대기가 끝나지 않는다.
    """
    S = read(page)['S']
    previous = [S['round'], S['phase'], len(S.get('results') or [])]
    close_drawer(page)
    press(page, '#lg-ready', touch)
    pass_issue_check(page)
    page.wait_for_selector('#lg-ready-confirm', state='visible')
    page.locator('#lg-predict [data-evidence]').first.click()
    select = page.locator('#lg-predict [data-pred]')
    topic = select.get_attribute('data-pred')
    select.select_option('up')
    press(page, '[data-confidence="fairly"]', touch)
    press(page, '#lg-ready-confirm', touch)
    page.wait_for_function(CHANGED_JS, arg=previous)
    return topic


def token(text, pattern=VALUE):
    match = re.search(pattern, text)
    return (match[1].replace('-', '−'), match[2]) if match else None


def s7_first(checks, page, label, touch):
    """수치를 재계산하지 않고 같은 달의 보이는 글자끼리 비교한다."""
    open_panel(page, 'result')
    summary = page.locator('#lg-outage-single')
    single = summary.inner_text() if shown(page, '#lg-outage-single') else ''
    if single and '가장 큰 몫' in single:
        share = token(single, r'가장 큰 몫[^()]*\(\s*' + VALUE)
        difference = token(single, r'(?:이번 )?차이\s*' + VALUE)
        checks.ok(share is not None and difference is not None, label + ' R2 요약 몫 X·차이 Y 추출: ' + single)
        # 단일 원인도 details 안 폭포가 있으면 실제 summary 조작으로 펼친다.
        waterfall = page.locator('#lg-outage-waterfall')
        if waterfall.count() and waterfall.evaluate("e=>!!e.closest('details:not([open])')"):
            waterfall.locator('xpath=ancestor::details[1]/summary').click()
        # 합계에는 고정 id가 없다. 요약을 제외한 공개 합계 문장/폭포 행을 선택한다.
        other = page.locator('#lg-missed').evaluate(r"""root => [...root.querySelectorAll('p, [data-out-step]')]
          .filter(e=>!e.closest('#lg-outage-single')&&!e.querySelector('#lg-outage-single'))
          .map(e=>e.innerText).filter(Boolean)""")
        totals = [token(text, r'차이\s*' + VALUE) for text in other if re.search(r'차이\s*' + VALUE, text)]
        saved = current_note(page)
        key = (saved.get('outageLargest') or saved.get('missedCarry', {}).get('largest') or {}).get('key')
        row = page.locator(f'#lg-outage-waterfall [data-out-step="{key}"]') if key else None
        if difference:
            # 원인 없음 분기가 아닌 한 줄 요약의 합계/폭포를 못 읽으면 누락으로 실패한다.
            checks.ok(difference in totals, f'{label} R2 요약 차이 = 카드 위 합계 글자: {difference}, {totals}')
        if share:
            checks.ok(row is not None and row.count() == 1 and row.is_visible() and token(row.inner_text()) == share,
                      f'{label} R2 요약 가장 큰 몫 = 같은 원인 폭포 글자: {key}, {share}')
    else:
        cards = page.locator('#lg-outage-cards [data-missed]')
        if not cards.count():
            checks.skip(label + ' R2', '첫 달 S7 최대 몫 요약·원인 카드 모두 없음(적중/원인 없음/다른 분기)')
            return None
        cards.first.tap() if touch else cards.first.click()
        if shown(page, '#lg-outage-open'):
            press(page, '#lg-outage-open', touch)
        leader = page.locator('#lg-outage-cards [data-missed]').filter(
            has=page.locator('[data-out-tag="largest"]')).first
        if not leader.count() or not leader.is_visible():
            checks.skip(label + ' R2', '카드는 열었으나 가장 큼 카드 장면 없음')
            return None
        share = token(leader.locator('.lg-out-size').inner_text())
        checks.ok(share is not None, label + ' R2 가장 큼 카드 크기 글자 추출')
        key = leader.get_attribute('data-missed')
        row = page.locator(f'#lg-outage-waterfall [data-out-step="{key}"]')
        checks.ok(row.count() == 1 and token(row.inner_text()) == share,
                  label + ' R2 가장 큼 카드 = 같은 원인 폭포 글자')
    if shown(page, '#lg-outage-carry'):
        press(page, '#lg-outage-carry', touch)
    else:
        checks.ok(False, label + ' R2 다음 달 기록 이어붙이기 단추 있음')
    return share


def carry_next(checks, page, label, share):
    if share is None:
        return
    open_panel(page, 'journal')
    carry = page.locator('#lg-missed-carry')
    text = carry.inner_text() if shown(page, '#lg-missed-carry') else ''
    got = token(text, r'가장 큰 몫[^+−\d]*' + VALUE)
    checks.ok(got == share, f'{label} R2 다음 달 carry 같은 몫 글자: {share} → {got}: {text}')
    close_drawer(page)


def cash_result(checks, page, label):
    # 판정 줄은 결과 맨 위 #lg-promise-summary에 보인다(#lg-promise-result 상세는 '예측 자세히' 뒤라 처음엔 안 보일 수 있다, 검토 반영).
    # 터치 화면은 결과 서랍이 아래로 스크롤돼 보이는지가 갈린다. 글자 자체는 DOM에서 읽는다(보임은 econui·rev12가 따로 본다, 검토 반영).
    text = page.evaluate("() => (document.querySelector('#lg-promise-summary') || document.querySelector('[data-compare=\"cash\"]'))?.textContent || ''")
    checks.ok(bool(re.search(r'운영 전 대비 (?:같음|늘어남|줄어듦)\(', text)), label + ' R4 현금 실제 방향 낱말: ' + text)
    if '운영 전 대비 같음(' in text:
        checks.ok('같음(±0.5억 안, ' in text, label + ' R4 같음 범위 ±0.5억 안, ')
    checks.ok(bool(re.search(r'· 예상과 (?:같음|다름)(?:\s|$)', text)), label + ' R4 적중 판정 유지')


def months(checks, page, base, label, touch):
    start(page, base)
    # 실제 정상 배치→시험→절전 계획은 s7 기존 도우미. 첫 달 오예측/S7 기회를 만든다.
    plan_and_trial(page)
    saved_lines, share, cash_seen = None, None, False
    for month in range(1, 13):
        state = read(page)['S']
        if state['round'] != month or state['phase'] != 'plan':
            raise AssertionError(f'{month}월 계획 미확보: {state["round"]}/{state["phase"]}')
        if month == 2 and page.viewport_size['width'] == 390:
            saved_lines = page.evaluate('() => structuredClone(KCP.buildGame.current().lines)')
            checks.ok(bool(saved_lines), label + ' R1 2월 철거 전 송전선 있음')
            checks.ok(page.evaluate('() => KCP.league.plan(st=>{st.lines=[];})'), label + ' R1 2월 모든 선 철거')
            page.wait_for_timeout(500)
        if month == 3 and page.viewport_size['width'] == 390:
            checks.ok(page.evaluate('() => KCP.buildGame.current().lines.length') == 0, label + ' R1 3월 선 없는 계획')
        if month == 4 and page.viewport_size['width'] == 390:
            checks.ok(page.evaluate('lines => KCP.league.plan(st=>{st.lines=structuredClone(lines);})', saved_lines),
                      label + ' R1 4월 기존 합법 선 다시 잇기')
            page.wait_for_timeout(500)
            checks.ok(page.evaluate('() => KCP.buildGame.current().lines.length') > 0, label + ' R1 4월 재연결 확인')
        debt_note(checks, page, f'{label} {month}월 계획')
        if month <= 5:
            # 첫 운영 직전 설치. prepare/reach_result 내부 대기 동안에도 계속 rAF가 돈다.
            page.evaluate(RAF_PROBE, month)
        if month == 1:
            topic = promise_submit(page, touch)
            reach_result(page, month)
        else:
            reach_result(page, month)
            topic = None
        if month <= 5:
            sample_result(checks, page, f'{label} {month}월')
        page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
        wait_unfolded(page)
        open_panel(page, 'result')
        debt_note(checks, page, f'{label} {month}월 결과')
        if topic == 'cash':
            cash_result(checks, page, label)
            cash_seen = True
        if month == 1:
            share = attempt(checks, label + ' R2 첫 달', lambda: s7_first(checks, page, label, touch))
        state = read(page)['S']
        # 결과 서랍의 S8 '이유를 남겼어요 · 다음 달로 가요' 경로가 이미 다음 달 계획으로 넘겼으면 다시 누르지 않는다(검토 반영).
        if state['round'] == month and state['phase'] in ('review', 'end'):
            click_next(page, state)
        if month == 1:
            attempt(checks, label + ' R2 다음 달', lambda: carry_next(checks, page, label, share))
    state = read(page)['S']
    checks.ok(state['phase'] == 'end' and len(state.get('results', [])) == 12, label + ' R3 실제 12달 뒤 끝 화면')
    open_panel(page, 'result')
    debt_note(checks, page, label + ' 끝 화면')
    if not cash_seen:
        print(f'INFO {label} R4 연속 운영에서 현금 예측 장면 없음; 별도 cash 시나리오 실행', flush=True)


def coach_tip(checks, page, base, label, touch):
    start(page, base, coach=True)
    page.wait_for_selector('#lg-coach[data-step="1"]')
    for _ in range(12):
        step = coach_step(page)
        if step == 3:
            break
        if step == 1:
            press(page, '#lg-coach-action', touch)
            page.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step)===2")
        elif step == 2:
            press(page, '#lg-coach-action', touch)
            choose_diesel(page, touch)
            before = page.evaluate('() => KCP.buildGame.current().builds.length')
            for index in page.evaluate(NEAR_TOWN_JS, 'diesel'):
                tile_press(page, index, touch)
                if touch and page.evaluate('() => KCP.buildGame.current().builds.length') == before:
                    tile_press(page, index, touch)
                if shown(page, '#bd-cf-ok'):
                    press(page, '#bd-cf-ok', touch)
                if page.evaluate('() => KCP.buildGame.current().builds.length') > before:
                    break
            else:
                raise AssertionError('코치 2/8 디젤 설치 실패')
            page.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step)===3")
        else:
            raise AssertionError(f'코치 3/8 이전 예상하지 않은 단계 {step}')
    if coach_step(page) != 3:
        raise AssertionError('코치 3/8 미도달')
    task = page.locator('#lg-coach-task').inner_text()
    checks.ok('LNG' in task, label + ' R5 첫 대상은 기존 LNG: ' + task)
    press(page, '#lg-coach-action', touch)
    ends = page.evaluate(LINE_ENDS_JS)
    if not ends:
        raise AssertionError('코치 첫 대상 끝점 없음')
    for index in ends:
        tile_press(page, index, touch)
    page.locator('#bd-cf-ok').wait_for(state='visible')
    press(page, '#bd-cf-ok', touch)
    # Escape/다른 지도 클릭 없이 바로 관측한다. 이 검사가 회귀의 핵심이다.
    if touch:
        checks.ok(page.locator('#bd-tip').evaluate('e=>e.hidden'), label + ' R5 첫 연결 직후 #bd-tip hidden')
        checks.ok('여기서 시작' not in page.locator('body').inner_text(), label + ' R5 화면에 여기서 시작 없음')
    page.wait_for_function("task => document.querySelector('#lg-coach-task')?.innerText!==task", arg=task)
    next_task = page.locator('#lg-coach-task').inner_text()
    checks.ok(coach_step(page) == 3 and next_task != task and '디젤' in next_task,
              label + ' R5 3/8 안 둘째 대상으로 전환: ' + next_task)
    second = page.evaluate(LINE_ENDS_JS)
    if not second:
        raise AssertionError('코치 둘째 대상 끝점 없음')
    if touch:
        tile_press(page, second[0], True)
        checks.ok(not page.locator('#bd-tip').evaluate('e=>e.hidden') and shown(page, '#bd-tip'),
                  label + ' R5 둘째 대상 칸 누르면 말풍선 다시 보임')
        if shown(page, '#lg-map-key-toggle'):
            press(page, '#lg-map-key-toggle', True)
            checks.ok(page.locator('#bd-tip').evaluate('e=>e.hidden'), label + ' R5 범례 ! 터치도 말풍선 닫기')
    else:
        xy = page.evaluate(TILE_XY_JS, second[0])
        if not xy:
            reveal_tile(page, False, second[0], lambda: None)
            xy = page.evaluate(TILE_XY_JS, second[0])
        if not xy:
            raise AssertionError('마우스 둘째 대상 가리지 않은 좌표 없음')
        page.mouse.move(*xy)
        page.locator('#bd-tip').wait_for(state='visible')
        checks.ok(shown(page, '#bd-tip'), label + ' R5 마우스 hover 말풍선 유지')
    overflow(checks, page, label + ' R5')


def site_hint(checks, page, base, label, touch):
    start(page, base)
    choose_diesel(page, touch)
    indices = page.evaluate("""() => {const B=KCP.buildGame, used=new Set(B.current().builds.map(b=>b.i));
      return B.TILES.filter(t=>!t.out&&t.site<0&&t.t==='urban'&&!used.has(t.i)).map(t=>t.i);}""")
    if not indices:
        raise AssertionError('디젤을 누를 도시 빈 칸 없음')
    tile_press(page, indices[0], True)
    tile_press(page, indices[0], True)
    text = page.locator('#bd-toast').inner_text()
    checks.ok('규칙상 가능한 가장 가까운 칸 표시' in text, label + ' 같이2 못 짓는 칸 안내: ' + text)
    observed = page.evaluate("""() => {
      const B=KCP.buildGame;
      // 명세에는 공개 관측 함수 이름이 없다. 존재하는 공개 상태/data 속성만 읽는다.
      const nodes=[...document.querySelectorAll('[data-site-hint]')];
      if(nodes.length)return {available:true,on:nodes.some(e=>e.dataset.siteHint!=='false'&&!e.hidden&&
        e.checkVisibility({visibilityProperty:true})),via:'data-site-hint'};
      if('siteHint' in B) {
        const value=typeof B.siteHint==='function'?B.siteHint():B.siteHint;
        return {available:true,on:value!==null&&value!==undefined&&value!==false,via:'KCP.buildGame.siteHint'};
      }
      const state=typeof B.state==='function'?B.state():null;
      if(state&&'siteHint' in state)return {available:true,on:!!state.siteHint,via:'KCP.buildGame.state().siteHint'};
      return {available:false,keys:Object.keys(B).filter(k=>/site.*hint|hint.*site/i.test(k))};
    }""")
    if observed['available']:
        checks.ok(observed['on'], label + ' 같이2 가능한 칸 고리 공개 상태: ' + str(observed))
    else:
        checks.skip(label + ' 같이2 고리', 'Canvas 고리의 공개 siteHint/data 속성 없음: ' + str(observed))
    checks.shot(page, Path('tests/results/rev13-site-hint-390.png'))
    overflow(checks, page, label + ' 같이2')


def cash_month(checks, page, base, label, touch):
    """rev9.cash_month의 정상 연결 디젤 배치로 cash 주제를 최대 4회 시도한다.

    결과/주제를 주입하지 않는다. 정전·계통 0의 실제 시험 장면을 못 만들면 SKIP한다.
    cash 주제가 확보된 후 조작/판정 실패는 BLOCKED이며 SKIP으로 숨기지 않는다.
    """
    start(page, base)
    found = False
    reasons = []
    for count in (4, 8, 12, 16):
        try:
            # 예측 서랍을 닫는 별도 계약이 없으므로 매 시도는 새 혼자 하기로 시작한다.
            # 정상 로비 시작 경로를 재사용하며 저장본/주제/결과를 덮어쓰지 않는다.
            if reasons:
                start(page, base)
            apply_plan(page, count=count)
            close_drawer(page)
            press(page, '[data-run="7"]', touch)
            trial = finish_trial(page)
            if shown(page, '#bd-drawer-x'):
                press(page, '#bd-drawer-x', touch)
            close_drawer(page)
            press(page, '#lg-ready', touch)
            pass_issue_check(page)
            page.wait_for_selector('#lg-ready-confirm', state='visible')
            topic = page.locator('#lg-predict [data-pred]').get_attribute('data-pred')
            reasons.append({'diesel':count,'topic':topic,'unsPct':trial.get('unsPct'),'gridMWh':trial.get('gridMWh')})
            if topic == 'cash':
                found = True
                break
        except Exception as exc:
            reasons.append({'diesel':count,'error':str(exc).splitlines()[0][:180]})
            break
    if not found:
        checks.skip(label + ' R4', '정전 0·계통 0 현금 주제 미확보: ' + json.dumps(reasons, ensure_ascii=False))
        return
    checks.ok(trial.get('unsPct') == 0 and trial.get('gridMWh') == 0, label + ' R4 정전·계통 0 시험으로 cash 주제 확보')
    page.locator('#lg-predict [data-evidence]').first.click()
    page.locator('#lg-predict [data-pred]').select_option('up')
    press(page, '[data-confidence="fairly"]', touch)
    # 390·1024 터치: 확인 단추가 서랍 아래에 있어 스크롤이 멈춘 뒤 눌러야 한다(검토 반영, 탭이 스크롤 중 빗나가 예측 없이 진행되던 검사 도우미 문제).
    page.locator('#lg-ready-confirm').scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    press(page, '#lg-ready-confirm', touch)
    page.wait_for_selector('#lg-ready-confirm', state='hidden', timeout=8000)
    reach_result(page, 1)
    page.wait_for_function("() => !document.querySelector('#bd-root.bd-replaying')", timeout=30000)
    wait_unfolded(page)
    open_panel(page, 'result')
    cash_result(checks, page, label)
    overflow(checks, page, label + ' R4')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address', help='tests/srv.py의 loopback 주소')
    parser.add_argument('--out', type=Path, default=Path('tests/results/rev13'))
    args = parser.parse_args()
    checks = Checks(args.out)
    try:
        base = local_address(['rev13.py', args.address])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height, touch in ((1280, 900, False), (1024, 768, True), (390, 844, True)):
                    for run in (months, coach_tip, cash_month) + ((site_hint,) if width == 390 else ()):
                        label = f'{width}x{height}-' + ('touch-' if touch else 'mouse-') + run.__name__
                        context, external = context_for(InputBrowser(browser, touch), base, width, height, 'light')
                        page, logs = monitored_page(context)
                        try:
                            attempt(checks, label, lambda: run(checks, page, base, label, touch))
                        finally:
                            diagnostics(checks, logs, label)
                            overflow(checks, page, label + ' 마지막')
                            checks.ok(not external, f'{label} 외부 요청 0: {external}')
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'주소/브라우저 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:260]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
