"""테스터판 2 명세 §10의 시트 보내기 검사. 구현에서 기대값을 가져오지 않는다.

허용된 샌드박스 밖 로컬 실행 담당자:
  tests/.venv/bin/python tests/league/sheet.py http://127.0.0.1:9430/index.html
  --only units,off,feedback,league,result,team,supabase
작성 세션에서는 python3 -m py_compile로만 검사한다. 브라우저·네트워크 실행 금지.
SHEET_CAP 기본값은 tests/results/sheet. SKIP 없음, 장면 미확보는 FAIL BLOCKED.
혼자 하기 완주는 한 번이며 off 끝 화면은 그 저장값을 복제해 재사용한다.
"""

import argparse
import base64
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sys
import time

from playwright.sync_api import expect, sync_playwright
from econui import (BOOT_JS, WAIT, context_for, contrast, diagnostics, local_address,
                    monitored_page, open_panel, overflow)
from endgrid import team_end
from feedback import (DIALOG, DRAFT_KEY, DeviceBrowser, StopCase, choose_radio,
                      fill_private_notes, focus, home_open, league as february,
                      opened, require, SHARE_JS)
from fx_end import dismiss_guide, prepare, solo_end
from league_flow import select_mode, wait_unfolded
from rev14 import Checks
from rev15 import skip_replay
from solo import CHANGED_JS, close_drawer, read


SECTIONS = ('units', 'off', 'feedback', 'league', 'result', 'team', 'supabase')
SHEET_URL = 'https://script.google.com/macros/s/TEST_sheet-id_0/exec'
BUILD = dict(label='개발판', sha='', date='', feedbackUrl=SHEET_URL, supabase=None)
FEEDBACK_KEYS = ('판', '화면 경로', '화면 크기', '기기', '모드', '도시', '달', '단계',
                 '서랍', '역할', '좋았던 점', '헷갈리거나 어려웠던 점', '고쳤으면 하는 점',
                 '쉬웠나요', '재미있었나요')
RESULT_KEYS = ('판', '모드', '도시', '게임 길이(달)', '종합 점수', '순위', '참가 도시 수',
               '예측 맞은 달', '예측한 달', '확신 보정')
RT_KEYS = ('title', 'note', 'valuesLabel', 'button', 'sentButton', 'sending', 'sent', 'fail')
RESULT_TEXT_SELECTORS = ('#lg-sheet h3, #lg-sheet-note, #lg-sheet-values dt, '
                         '#lg-sheet-values dd, #lg-sheet-send, #lg-sheet-status')
SOLO_KEY = 'kcp-league-solo-v1'
NET_KEY = 'kcp-league-net-v1'
SB = dict(url='https://abcdefghijklmnopqrst.supabase.co', key='sb_publishable_TEST0000')
SAVED = dict(kind='supabase', url='https://zyxwvutsrqponmlkjihg.supabase.co',
             key='sb_publishable_SAVED000')


def inject_build(page, build):
    body = 'window.KCP = window.KCP || {};\nKCP.BUILD = ' + json.dumps(build, ensure_ascii=False) + ';\n'
    page.route('**/build-info.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript', body=body))


class SheetRequests:
    """페이지 경로가 context_for의 외부 차단 경로보다 먼저 가로채는지 검사한다."""

    def __init__(self):
        self.records = []
        self.fail = False
        self.hold = False
        self.pending = []
        self.finished = []
        self.aborted = 0

    def attach(self, page):
        page.route('https://script.google.com/macros/s/**', self.handle)
        for event in ('requestfinished', 'requestfailed'):
            page.on(event, lambda request: self.finished.append(request.url)
                    if request.url.startswith('https://script.google.com/macros/s/') else None)

    def wait_done(self, page, count):
        deadline = time.monotonic() + WAIT / 1000
        while len(self.finished) < count and time.monotonic() < deadline:
            page.wait_for_timeout(25)
        if len(self.finished) < count:
            raise AssertionError(f'시트 요청 종료 미확보: {len(self.finished)}/{count}')
        # 네트워크 종료 뒤 fetch의 후속 Promise와 DOM 상태 갱신까지 기다린다.
        page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

    def handle(self, route):
        request = route.request
        self.records.append(dict(method=request.method, url=request.url, body=request.post_data))
        if self.hold:
            self.pending.append(route)
        elif self.fail:
            self.aborted += 1
            route.abort()
        else:
            route.fulfill(status=200, body='')

    def release(self):
        self.hold = False
        for route in self.pending:
            route.fulfill(status=200, body='')
        self.pending.clear()


class Session:
    def __init__(self, checks, context, external, build):
        self.checks, self.context, self.external, self.build = checks, context, external, build
        self.pages = []
        self.requests = SheetRequests()
        self.aborted_logs = 0

    def page(self, build=None):
        # 총괄 보강: 실패 경로는 검사가 일부러 abort한 시트 요청이다. 브라우저가 그 자원에 남기는
        # 'Failed to load resource' 한 줄만 따로 세고(앱이 찍은 로그가 아님), 나머지 콘솔은 기존 진단 그대로.
        page = self.context.new_page()
        events = {"error": [], "warning": [], "pageerror": []}

        def on_console(message):
            if message.type not in ("error", "warning"):
                return
            where = (message.location or {}).get('url', '')
            if (message.type == 'error' and where.startswith('https://script.google.com/macros/s/') and
                    'Failed to load resource' in message.text):
                self.aborted_logs += 1
                return
            events[message.type].append(message.text)
        page.on("console", on_console)
        page.on("pageerror", lambda error: events["pageerror"].append(str(error)))
        self.pages.append((page, events))
        settings = self.build if build is None else build
        if settings is not False:
            inject_build(page, settings)
        self.requests.attach(page)
        return page

    def finish(self, label):
        for i, (_, events) in enumerate(self.pages):
            diagnostics(self.checks, events, f'{label} 화면 {i}')
        self.checks.ok(self.aborted_logs <= self.requests.aborted,
                       f'{label} 시트 자원 오류 줄은 일부러 막은 요청 수 이하: '
                       f'{self.aborted_logs}/{self.requests.aborted}')
        self.checks.ok(not self.external, f'{label} 시트 가로채기 밖 외부·웹소켓 요청 0: {self.external}')
        self.checks.ok(not any('script.google.com' in str(x) for x in self.external),
                       label + ' 페이지 시트 경로 우선: external에 시트 요청 없음')


@contextmanager
def session(checks, browser, base, label, build=BUILD, width=1280, height=900,
            scheme='light', touch=False, init=None, storage=None):
    before = checks.count
    context, external = context_for(DeviceBrowser(browser, touch, touch and width == 390),
                                     base, width, height, scheme)
    context.set_default_timeout(WAIT)
    if storage:
        context.add_init_script('(() => {if (!sessionStorage.getItem("sheet-fixture")) {' +
                                ''.join('localStorage.setItem(%s,%s);' %
                                        (json.dumps(k), json.dumps(v)) for k, v in storage.items()) +
                                'sessionStorage.setItem("sheet-fixture","1");}})();')
    if init:
        context.add_init_script(init)
    run = Session(checks, context, external, build)
    try:
        yield run
    except StopCase:
        pass
    except Exception as exc:
        checks.ok(False, f'{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}')
    finally:
        run.requests.release()
        run.finish(label)
        context.close()
        print(f'INFO {label} assertions {checks.count - before}', flush=True)


def ready(checks, page):
    for name in ('sheetUrl', 'buildLabel', 'send', 'sheetFields'):
        require(checks, page.evaluate("n => typeof KCP.feedback?.[n]==='function'", name),
                '공개 API KCP.feedback.' + name)
    require(checks, page.evaluate("() => !!KCP.feedback.RESULT_TEXT && typeof KCP.feedback.RESULT_TEXT==='object'"),
            '공개 RESULT_TEXT 객체')
    rt = page.evaluate('() => KCP.feedback.RESULT_TEXT')
    for key in RT_KEYS:
        checks.ok(isinstance(rt.get(key), str) and bool(rt[key].strip()), 'RESULT_TEXT.' + key + ' 비지 않음')


def settled_status(page, selector, previous=''):
    # 명세 §8: 고정 문안 대신 빈 글 여부·이전 상태와의 차이로 확인한다.
    page.wait_for_function("""([sel,old]) => {
      const s=document.querySelector(sel)?.textContent.trim(); return !!s && s!==old;
    }""", arg=[selector, previous])
    return page.locator(selector).inner_text().strip()


def count_requests(checks, page, requests, count, label):
    page.wait_for_function('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    checks.ok(len(requests.records) == count, label + f' 요청 정확히 {count}개')


def payload(checks, requests, kind, keys, index=-1):
    record = requests.records[index]
    checks.ok(record['method'] == 'POST', kind + ' POST')
    checks.ok(record['url'] == SHEET_URL, kind + ' 설정 주소 그대로·매개변수·해시 없음')
    data = json.loads(record['body'])
    checks.ok(list(data) == ['kind', 'fields'] and data['kind'] == kind, kind + ' 본문 봉투')
    checks.ok(list(data['fields']) == list(keys), kind + ' 열 이름·개수·순서 정확')
    checks.ok(all(type(v) in (str, int) for v in data['fields'].values()), kind + ' 문자열·정수만')
    return data['fields']


def privacy(checks, body, forbidden=(), feedback=False):
    checks.ok(all(value not in body for value in forbidden if value), '본문에 방·기기 안 고유 문장 없음')
    checks.ok('#league/j' not in body and 'j=' not in body, '본문에 참가 링크 없음')
    if feedback:
        checks.ok(not re.search(r'\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}', body), '의견 본문 날짜·시각 없음')


def layout(checks, page, selector, label):
    expect(page.locator(selector)).to_be_visible()
    box = page.locator(selector).bounding_box()
    checks.ok(box is not None and box['width'] >= 44 and box['height'] >= 44,
              label + ' 단추 44×44 이상')
    overflow(checks, page, label)
    root = DIALOG if selector == '#fb-send' else '#lg-sheet'
    checks.ok(page.locator(root).evaluate('e=>e.scrollWidth<=e.clientWidth'), label + ' 칸 내부 가로 넘침 0')


def units(checks, page, base):
    page.goto(base + '#home')
    ready(checks, page)
    valid = 'https://script.google.com/macros/s/AKfycbTEST_id-1/exec'
    urls = ((valid, valid), (' \n' + valid + '\t ', valid), ('', ''), (None, ''), (17, ''),
            ('http://script.google.com/macros/s/X/exec', ''),
            (valid + '?x=1', ''), (valid + '#x', ''),
            ('https://script.google.com/macros/s/X/dev', ''),
            ('https://script.google.com/a/macros/school.kr/s/X/exec', ''),
            ('https://example.com/macros/s/X/exec', ''),
            ('https://script.google.com.evil.kr/macros/s/X/exec', ''),
            ('https://script.google.com/macros/s//exec', ''))
    # 명세 §10.2·§2.1에서 허용한 sheetUrl 전용 설정 수정. 반드시 원상 복구한다.
    page.evaluate('() => {window.__sheetBuild=KCP.BUILD;window.__sheetUrl=KCP.BUILD.feedbackUrl;}')
    try:
        for value, wanted in urls:
            actual = page.evaluate('v=>{KCP.BUILD.feedbackUrl=v;return KCP.feedback.sheetUrl();}', value)
            checks.ok(actual == wanted, 'sheetUrl ' + repr(value))
        for value in (None, {}, {'feedbackUrl': []}):
            checks.ok(page.evaluate('v=>{KCP.BUILD=v;return KCP.feedback.sheetUrl();}', value) == '',
                      'sheetUrl 설정 없음·객체 아님·문자열 아님 ' + repr(value))
    finally:
        page.evaluate('''() => {KCP.BUILD=window.__sheetBuild;KCP.BUILD.feedbackUrl=window.__sheetUrl;
          delete window.__sheetBuild;delete window.__sheetUrl;}''')
    for build, wanted in (({}, '개발판'), ({'label': ''}, '개발판'),
                          ({'label': '가상판'}, '가상판'),
                          ({'sha': '0123456789abcdef'}, '개발판 · 커밋 0123456789ab'),
                          ({'label': '가상판', 'date': '가상 날짜'}, '가상판 · 가상 날짜'),
                          ({'label': '가상판', 'sha': 'abc', 'date': '가상 날짜'},
                           '가상판 · 커밋 abc · 가상 날짜')):
        checks.ok(page.evaluate('b=>KCP.feedback.buildLabel(b)', build) == wanted, 'buildLabel ' + repr(build))
        info = dict(build=build, date='', route='#home', size='1280×900', browser='가상 브라우저',
                    touch='아니요', scheme='밝음')
        empty = dict(role='', good='', hard='', fix='', easy='', fun='')
        checks.ok(page.evaluate('a=>KCP.feedback.compose(...a)', [info, empty]).split('\n')[2] == '판: ' + wanted,
                  'compose 셋째 줄 = buildLabel 계약')
    # 총괄 보강(독립 검토 minor 5): 주입 label이 기본값과 같으면 구별이 안 되므로 다른 값으로 바꿔 읽는지 본다.
    checks.ok(page.evaluate("""()=>{const old=KCP.BUILD;
      KCP.BUILD={...old,label:'가상 배포판',sha:'fedcba9876543210',date:'가상 날짜'};
      try{return KCP.feedback.buildLabel();}finally{KCP.BUILD=old;}}""") ==
              '가상 배포판 · 커밋 fedcba987654 · 가상 날짜', 'buildLabel 생략 → 지금 KCP.BUILD를 읽음')
    for i, role in enumerate(('', 'student', 'teacher', 'other', 'invalid', '')):
        for has_league in (False, True):
            info = dict(build={'label': '', 'sha': '0123456789abcdef', 'date': ''}, route='#home',
                        size='1280×900', browser='가상 브라우저', touch='예', scheme='밝음')
            values = dict(role=role, good='  가상 첫 줄\r\n가상 둘째 줄  ', hard=' \r\n ',
                          fix=' 가상 개선 ', easy=('', '1', '2', '3', '4', '5')[i], fun='5' if has_league else '')
            wanted = dict(zip(FEEDBACK_KEYS, ['개발판 · 커밋 0123456789ab', '#home', '1280×900',
                           '가상 브라우저 · 터치 예 · 밝음', '', '', '', '', '',
                           {'student': '학생', 'teacher': '교사', 'other': '기타'}.get(role, ''),
                           '가상 첫 줄\n가상 둘째 줄', '', '가상 개선',
                           int(values['easy']) if values['easy'] else '', 5 if has_league else '']))
            if has_league:
                info['league'] = dict(mode='혼자 하기', city='' if i % 2 else '가상 도시', month=2,
                                      total=12, monthLabel='' if i % 2 else '2027년 2월', phase='결과', drawer='도움말')
                wanted.update(모드='혼자 하기', 도시=info['league']['city'],
                              달='2/12달' + ('' if i % 2 else ' (2027년 2월)'), 단계='결과', 서랍='도움말')
            actual = page.evaluate('a=>KCP.feedback.sheetFields(...a)', [info, values])
            checks.ok(list(actual) == list(FEEDBACK_KEYS), f'sheetFields 열 순서 역할 {role} 리그 {has_league}')
            checks.ok(actual == wanted and all(type(actual[k]) is type(v) for k, v in wanted.items()),
                      f'sheetFields 값·정수 타입 역할 {role} 리그 {has_league}')
            checks.ok(not any(re.fullmatch(r'\d+/\d+', str(v)) for v in actual.values()), '날짜로 바뀔 숫자/숫자 단독 값 없음')
    for value, wanted in (('가상 전화 010-0000-0000', ['phone']), ('01000000000', ['digits', 'phone']),
                          ('tester@example.com', ['email']), ('0000000', ['digits']), ('00000', ['digits']),
                          ('0000', []), ('2026-10-31에 해 봤어요', []), ('3월 2/12달', []),
                          ('1280×900', []), ('가상 학번 20513번', ['digits'])):
        checks.ok(page.evaluate('s=>KCP.feedback.piiKinds(s)', value) == wanted, 'piiKinds ' + repr(value))
    # 명세 §2.3: fetch 옵션은 브라우저의 no-cors 헤더 가공 전 인자를 관측한다.
    result = page.evaluate("""async () => {
      const original=window.fetch, calls=[];
      try {
        window.fetch=async (...args)=>{calls.push(args);return {};};
        const yes=await KCP.feedback.send('feedback', {'가상 열':'가상 값'});
        window.fetch=async ()=>{throw new TypeError('가상 실패');};
        let no,threw=false;try {no=await KCP.feedback.send('result',{});}catch(e){threw=true;}
        return {yes,no,threw,calls};
      } finally {window.fetch=original;}
    }""")
    checks.ok(result['yes'] is True and result['no'] is False and not result['threw'], 'send 이행 true·거부 false·예외 없음')
    checks.ok(result['calls'] == [[SHEET_URL, dict(method='POST', mode='no-cors', credentials='omit',
              referrerPolicy='no-referrer', headers={'Content-Type': 'text/plain;charset=utf-8'},
              body='{"kind":"feedback","fields":{"가상 열":"가상 값"}}')]], 'send 정확히 한 번·fetch 옵션 전체')


def off(checks, page, base):
    page.goto(base + '#home')
    home_open(checks, page)
    require(checks, page.locator('#fb-send').count() == 1, '설정 없음 #fb-send 존재')
    checks.ok(not page.locator('#fb-send').is_visible(), '설정 없음 보내기 숨김')
    checks.ok('primary' in (page.locator('#fb-copy').get_attribute('class') or '').split(), '설정 없음 복사 주 단추')
    intro = page.locator('#fb-intro').inner_text()
    checks.ok('자동으로 보내지는 않아요' in intro, '설정 없음 자동 전송 아님 안내')
    checks.ok(page.evaluate("()=>KCP.feedback.sheetUrl()") == '', '설정 없음 sheetUrl 빈 값')
    before = page.evaluate('()=>localStorage.length')
    checks.ok(page.evaluate("()=>KCP.feedback.send('feedback',{})") is False, '설정 없음 send false')
    checks.ok(page.evaluate('()=>localStorage.length') == before, '설정 없음 send 저장 키 추가 없음')
    return dict(intro=intro, note=page.locator('#fb-out-note').inner_text())


def feedback(checks, run, base):
    # 명세 §8: 각 단독 실행도 설정 없는 판과 문구를 대조한다.
    baseline_page = run.page(build=False)
    baseline = off(checks, baseline_page, base)
    baseline_page.close()
    page = run.page()
    page.goto(base + '#home')
    ready(checks, page)
    home_open(checks, page)
    send = page.locator('#fb-send')
    expect(send).to_be_visible()
    checks.ok(bool(send.inner_text().strip()) and send.get_attribute('type') == 'button', '보내기 글·type')
    checks.ok(send.evaluate("e=>e.parentElement.matches('div.fb-actions') && e.parentElement.firstElementChild===e"), '보내기 단추 줄 맨 앞')
    checks.ok({'v2-btn', 'primary'} <= set(send.get_attribute('class').split()), '보내기 주 단추')
    checks.ok('primary' not in page.locator('#fb-copy').get_attribute('class').split(), '복사 보조 단추')
    checks.ok(page.locator('#fb-intro').inner_text() != baseline['intro'], '설정 있음 intro 다름')
    checks.ok(page.locator('#fb-out-note').inner_text() != baseline['note'], '설정 있음 out-note 다름')
    layout(checks, page, '#fb-send', '의견 1280 밝음')
    checks.shot(page, 'fb-send-1280', '#fb-send')
    send.click()
    checks.ok(bool(settled_status(page, '#fb-status')), '빈 글 상태 안내')
    checks.test('빈 글 첫 칸 초점', lambda: focus(page, '#fb-good'))
    count_requests(checks, page, run.requests, 0, '빈 글')
    for key, value in dict(good=' 가상 좋은 점 ', hard='가상 어려운 점', fix='가상 제안').items():
        page.locator('#fb-' + key).fill(value)
    for key, value in dict(role='student', easy='4', fun='5').items():
        choose_radio(page, key, value)
    draft = page.evaluate('k=>JSON.parse(localStorage.getItem(k))', DRAFT_KEY)
    keys_before = page.evaluate('()=>Object.keys(localStorage).sort()')
    # 명세 §2.3·§3.3: 보내는 동안 한 번 더 눌러 요청이 늘지 않는지도 본다.
    run.requests.hold = True
    before = page.locator('#fb-status').inner_text().strip()
    send.click()
    page.wait_for_function('()=>!!document.querySelector("#fb-status").textContent.trim()')
    sending = settled_status(page, '#fb-status', before)
    count_requests(checks, page, run.requests, 1, '보내기 시작')
    send.click()
    duplicate_pending = settled_status(page, '#fb-status', sending)
    count_requests(checks, page, run.requests, 1, '보내는 동안 중복')
    run.requests.release()
    run.requests.wait_done(page, 1)
    sent = settled_status(page, '#fb-status', duplicate_pending)
    checks.shot(page, 'fb-sent', '#fb-status')
    actual = payload(checks, run.requests, 'feedback', FEEDBACK_KEYS)
    expected = dict(zip(FEEDBACK_KEYS, ['개발판', '#home', '1280×900', actual['기기'],
                     '', '', '', '', '', '학생', '가상 좋은 점', '가상 어려운 점', '가상 제안', 4, 5]))
    checks.ok(actual == expected and type(actual['쉬웠나요']) is int and type(actual['재미있었나요']) is int,
              '홈 의견 입력·자동 정보·별점 정수 일치')
    # 앞 판 §4.3의 화면 출력 정보는 기존 도우미가 검사한다. 기기 열도 그 공개 표시와 대조한다.
    lines = page.locator('#fb-out').input_value().split('\n')
    info = {key: next(line[len(key) + 2:] for line in lines if line.startswith(key + ': '))
            for key in ('브라우저', '터치', '화면 밝기')}
    checks.ok(actual['기기'] == f"{info['브라우저']} · 터치 {info['터치']} · {info['화면 밝기']}", '기기 열 = 화면 자동 정보')
    privacy(checks, run.requests.records[-1]['body'], feedback=True)
    checks.ok(page.evaluate('k=>JSON.parse(localStorage.getItem(k))', DRAFT_KEY) == draft, '보낸 뒤 임시 저장 보존')
    send.click()
    dup = settled_status(page, '#fb-status', sent)
    checks.ok(dup == duplicate_pending, '대기 중·성공 뒤 같은 중복 상태')
    count_requests(checks, page, run.requests, 1, '30초 안 같은 글')
    checks.shot(page, 'fb-dup', '#fb-status')
    page.locator('#fb-fix').fill('가상 제안 수정')
    send.click()
    run.requests.wait_done(page, 2)
    settled_status(page, '#fb-status', dup)
    count_requests(checks, page, run.requests, 2, '한 칸 수정 즉시 재전송')
    # 명세 §3.3: 자동 정보만 바뀌면 같은 글이다. 새 창의 info는 열 때 갱신된다.
    page.keyboard.press('Escape')
    page.set_viewport_size(dict(width=1279, height=900))
    home_open(checks, page)
    send.click()
    checks.ok(settled_status(page, '#fb-status') == dup, '화면 크기만 바뀌어도 중복')
    count_requests(checks, page, run.requests, 2, '자동 정보 변경')
    page.set_viewport_size(dict(width=1280, height=900))
    run.requests.fail = True
    page.locator('#fb-fix').fill('가상 실패 검사 글')
    send.click()
    run.requests.wait_done(page, 3)
    failed = settled_status(page, '#fb-status', dup)
    page.wait_for_function('()=>document.querySelector("#fb-send").disabled!==true')
    count_requests(checks, page, run.requests, 3, '실패 전송')
    checks.ok(len({sent, dup, failed}) == 3, '성공·중복·실패 글 모두 다름')
    checks.shot(page, 'fb-fail', '#fb-status')
    send.click()
    run.requests.wait_done(page, 4)
    # 같은 실패 글로 돌아와도 요청 완료를 기다린다.
    page.wait_for_function('old=>document.querySelector("#fb-status").textContent.trim()===old', arg=failed)
    count_requests(checks, page, run.requests, 4, '실패 뒤 같은 글 바로 재시도')
    run.requests.fail = False
    page.locator('#fb-hard').fill('가상 번호 00000')
    send.click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(True, '5자리 개인정보 확인 단계')
    count_requests(checks, page, run.requests, 4, '개인정보 확인 전')
    checks.ok(page.locator('#fb-pii-go').inner_text().strip() not in ('', '그대로 복사'), '보내기용 확인 단추 글')
    checks.test('확인 고치기 초점', lambda: focus(page, '#fb-pii-edit'))
    page.locator('#fb-pii-go').click()
    expect(page.locator('#fb-pii')).not_to_be_visible()
    run.requests.wait_done(page, 5)
    settled_status(page, '#fb-status', failed)
    count_requests(checks, page, run.requests, 5, '개인정보 확인 뒤 한 번 전송')
    checks.test('확인 뒤 보내기 초점', lambda: focus(page, '#fb-send'))
    send.click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(True, '개인정보 확인은 그 한 번만 유효')
    count_requests(checks, page, run.requests, 5, '확인 재요구')
    page.locator('#fb-hard').fill('가상 숫자 0000')
    send.click()
    expect(page.locator('#fb-pii')).not_to_be_visible()
    run.requests.wait_done(page, 6)
    settled_status(page, '#fb-status', dup)
    count_requests(checks, page, run.requests, 6, '4자리 바로 전송')
    checks.ok(page.evaluate('()=>Object.keys(localStorage).sort()') == keys_before, '보내기 새 저장 키 없음')
    # 명세 §3.3: 복사·공유·지우기는 시트 요청 없이 기존 임시 저장 동작을 유지한다.
    page.locator('#fb-copy').click()
    page.wait_for_function('()=>typeof window.__sheetCopy===\'string\'')
    checks.ok(page.evaluate('()=>window.__sheetCopy') == page.locator('#fb-out').input_value(), '설정 있음 복사 글 = 출력')
    page.locator('#fb-share').click()
    page.wait_for_function('()=>window.__feedbackShare.calls.length===1')
    checks.ok(page.evaluate('()=>window.__feedbackShare.calls[0].text') == page.locator('#fb-out').input_value(), '설정 있음 공유 글 = 출력')
    page.locator('#fb-clear').click()
    checks.ok(page.evaluate('k=>localStorage.getItem(k)', DRAFT_KEY) is None, '설정 있음 지우기 임시 저장 삭제')
    count_requests(checks, page, run.requests, 6, '복사·공유·지우기')


def feedback_mobile(checks, run, base):
    page = run.page()
    page.goto(base + '#home')
    home_open(checks, page)
    layout(checks, page, '#fb-send', '의견 390 터치 어두움')
    checks.ok(page.evaluate('()=>navigator.maxTouchPoints>0'), '의견 390 실제 터치 컨텍스트')
    checks.shot(page, 'fb-send-390', '#fb-send')
    count_requests(checks, page, run.requests, 0, '390 창 열기')


class SceneChecks:
    """기존 장면 도우미의 단언은 유지하고 불필요한 별도 캡처만 생략한다."""

    def __init__(self, checks):
        self.checks = checks

    def __getattr__(self, name):
        return getattr(self.checks, name)

    def shot(self, *args, **kwargs):
        # 명세 §10 캡처 목록은 새 검사가 이름을 정해 별도로 만든다.
        return None


def league(checks, run, base):
    page = run.page()
    february(SceneChecks(checks), page, base)
    if not (page.locator('#lg-help').count() and page.locator('#lg-help').is_visible()):
        checks.blocked('2월 결과 도움말 장면 미확보')
        return
    scene = page.evaluate("""()=>{const L=KCP.league.state(),V=L.S||L.snap;
      return {room:L.room,phase:V.phase,round:V.round,city:document.querySelector('#lg-bar .lg-bteam').textContent.trim()};}""")
    require(checks, scene['phase'] == 'review' and scene['round'] == 2, '2월 결과 장면 재확인')
    page.locator('#lg-feedback').click()
    opened(checks, page)
    page.locator('#fb-good').fill('가상 리그 의견')
    count_requests(checks, page, run.requests, 0, '리그 의견 누르기 전')
    page.locator('#fb-send').click()
    run.requests.wait_done(page, 1)
    settled_status(page, '#fb-status')
    count_requests(checks, page, run.requests, 1, '리그 의견')
    actual = payload(checks, run.requests, 'feedback', FEEDBACK_KEYS)
    for key, value in dict(모드='혼자 하기', 도시=scene['city'], 단계='결과', 서랍='도움말').items():
        checks.ok(actual[key] == value, '리그 의견 ' + key)
    checks.ok(actual['달'].startswith('2/12달'), '리그 의견 달 2/12달')
    privacy(checks, run.requests.records[-1]['body'], [scene['room']], feedback=True)


class PromisePage:
    """solo_end의 로비 이동 직후 실제 UI로 약속 방식·평택을 고른다.

    이후 12달 진행은 solo_end와 그 안의 prepare 확인 경로를 그대로 쓴다.
    Python의 탐색·대기 호출만 감싸며 실제 Page 타입과 앱 API·엔진·저장값을 유지한다.
    """

    def __init__(self, page):
        self.page = page
        self.private = []
        self.note_scenes = set()
        self.original_goto = page.goto
        self.original_wait = page.wait_for_function

    def __enter__(self):
        self.page.goto = self.goto
        self.page.wait_for_function = self.wait_for_function
        return self

    def __exit__(self, *args):
        self.page.goto = self.original_goto
        self.page.wait_for_function = self.original_wait

    def goto(self, *args, **kwargs):
        response = self.original_goto(*args, **kwargs)
        self.page.wait_for_function(BOOT_JS)
        select_mode(self.page, 'solo')
        self.page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
        options = self.page.locator('#lg-solo .lg-extra-settings')
        if not options.evaluate('e=>e.open'):
            options.locator(':scope > summary').click()
        self.page.locator('#lg-solo-practice').select_option('promise')
        return response

    def wait_for_function(self, expression, **kwargs):
        value = self.original_wait(expression, **kwargs)
        if expression == CHANGED_JS:
            scene = self.page.evaluate('()=>{const S=KCP.league.state().S;return [S.round,S.phase];}')
            key = tuple(scene)
            if key == (2, 'plan') and key not in self.note_scenes:
                open_panel(self.page, 'journal')
                notes = fill_private_notes(self.page, '가상시트검사-일지-QX', 'textarea[data-j]')
                if not notes:
                    raise AssertionError('2월 계획 일지 입력 장면 없음')
                self.private.extend(notes)
                close_drawer(self.page)
            elif key == (2, 'review') and key not in self.note_scenes:
                skip_replay(self.page)
                open_panel(self.page, 'result')
                notes = fill_private_notes(self.page, '가상시트검사-이유-QX', '#lg-panel textarea[data-note]')
                if not notes:
                    raise AssertionError('2월 결과 이유 입력 장면 없음')
                self.private.extend(notes)
                close_drawer(self.page)
            self.note_scenes.add(key)
        return value


def result_scene(checks, page):
    """명세 §5.2의 오른쪽 표: 계산 엔진 대신 같은 화면의 표시값으로 대조한다."""
    require(checks, page.locator('#lg-sheet').count() == 1, '결과 보내기 섹션 정확히 1개')
    expect(page.locator('#lg-sheet')).to_be_visible()
    checks.ok(page.locator('#lg-sheet').evaluate("""e=>e.tagName==='SECTION' &&
      e.classList.contains('lg-sec') && e.previousElementSibling?.id==='lg-reflect' &&
      ![...e.parentElement.children].slice([...e.parentElement.children].indexOf(e)+1).some(n=>n.matches('section'))"""),
              '결과 칸은 끝 성찰 바로 뒤·끝 화면 마지막 섹션')
    rt = page.evaluate('()=>KCP.feedback.RESULT_TEXT')
    checks.ok(page.locator('#lg-sheet-values').get_attribute('aria-label') == rt['valuesLabel'], '보낼 값 dl 이름')
    checks.ok(page.locator('#lg-sheet-values').evaluate("e=>e.tagName==='DL'"), '보낼 값 dl 구조')
    nodes = page.locator('#lg-sheet-values [data-sheet-field]')
    names = nodes.evaluate_all('es=>es.map(e=>e.dataset.sheetField)')
    require(checks, names == list(RESULT_KEYS), '결과 10개 열 순서 정확')
    displayed = {}
    for key, node in zip(RESULT_KEYS, nodes.all()):
        checks.ok(node.locator('dt').inner_text() == key and node.locator('dd').count() == 1,
                  '결과 dt·dd ' + key)
        displayed[key] = node.locator('dd').inner_text()
    summary = page.locator('#lg-final-summary > p').first.inner_text().strip()
    match = re.match(r'(.+?)\s+(\d+)위\s*·\s*([\d,.]+)점', summary)
    require(checks, match is not None, '최종 요약 도시·순위·점수 표시 확보')
    for key, wanted in (('판', '개발판'), ('도시', match[1]), ('순위', match[2]), ('종합 점수', match[3])):
        checks.ok(displayed[key] == wanted, '결과 화면 대조 ' + key)
    mode = page.evaluate("()=>KCP.league.state().role")
    checks.ok(displayed['모드'] == {'solo': '혼자 하기', 'team': '팀'}[mode], '결과 모드')
    checks.ok(displayed['게임 길이(달)'] == '12', '결과 게임 길이 12달')
    checks.ok(displayed['참가 도시 수'] == str(page.locator('#lg-rank-chart .lg-rank-bar-row').count()), '참가 도시 수 = 화면 순위 줄 수')
    total, hits, parts = 0, 0, []
    for key, label in (('half', '반반'), ('fairly', '꽤'), ('sure', '확실')):
        line = page.locator(f'#lg-final-calibration [data-calibration="{key}"]').inner_text()
        count = re.search(r'·\s*(\d+)번', line)
        require(checks, count is not None, label + ' 확신 횟수 표시')
        n = int(count[1])
        rate = re.search(r'맞은 비율\s*([\d.]+)%', line)
        require(checks, n == 0 or rate is not None, label + ' 확신 적중 비율 표시')
        # 명세 §5.2: 표시 비율은 소수 한 자리로 반올림된다. 횟수와 곱해 정수 적중 수를 복원한다.
        win = round(float(rate[1]) * n / 100) if rate else 0
        checks.ok(0 <= win <= n and (n != 0 or '기록 없음' in line), label + ' 확신 표시 범위')
        total += n
        hits += win
        parts.append(f'{label} {win}/{n}')
    checks.ok(displayed['예측한 달'] == str(total), '예측한 달 = 화면 횟수 합')
    checks.ok(displayed['예측 맞은 달'] == str(hits), '예측 맞은 달 = 화면 비율×횟수 합')
    checks.ok(displayed['확신 보정'] == ' · '.join(parts), '확신 보정 이름·순서·분자·분모')
    if mode == 'solo':
        # 총괄 보강: 명세 §10.5는 예측을 남기며 완주할 것만 요구한다. 판정이 없는 달(행 없음)이 있을 수 있어
        # 12번 정확히 대신 1~12번으로 본다. 값 대조는 위 단언이 화면과 같은지로 맡는다.
        checks.ok(1 <= total <= 12, f'약속 확인 경로로 예측 남김(화면 {total}번)')
    button = page.locator('#lg-sheet-send')
    checks.ok(button.get_attribute('type') == 'button' and bool(button.inner_text().strip()), '결과 보내기 단추 글·type')
    checks.ok({'v2-btn', 'primary'} <= set(button.get_attribute('class').split()), '결과 보내기 주 단추')
    checks.ok(page.locator('#lg-sheet-status').get_attribute('role') == 'status' and
              page.locator('#lg-sheet-status').get_attribute('aria-live') == 'polite', '결과 상태 접근성 속성')
    return displayed


def expect_result_status(page, key):
    # 명세 §8: 초안 문구를 고정하지 않고 공개 RESULT_TEXT와 UI의 계약을 확인한다.
    page.wait_for_function("k=>document.querySelector('#lg-sheet-status')?.textContent===KCP.feedback.RESULT_TEXT[k]", arg=key)
    return page.locator('#lg-sheet-status').inner_text()


def result_payload(checks, run, page, displayed, forbidden):
    actual = payload(checks, run.requests, 'result', RESULT_KEYS)
    for key, wanted in displayed.items():
        checks.ok(str(actual[key]) == wanted, '전송 값 = 화면 dd ' + key)
    for key in ('게임 길이(달)', '순위', '참가 도시 수', '예측 맞은 달', '예측한 달'):
        checks.ok(type(actual[key]) is int, '결과 정수 열 ' + key)
    for key in ('판', '모드', '도시', '종합 점수', '확신 보정'):
        checks.ok(type(actual[key]) is str, '결과 문자열 열 ' + key)
    privacy(checks, run.requests.records[-1]['body'], forbidden)
    other = page.evaluate("""()=>{const L=KCP.league.state(),V=L.snap||L.S;
      return V.econ.score.rank.filter(x=>x.id!==L.team).map(x=>x.name);}""")
    checks.ok(all(name not in run.requests.records[-1]['body'] for name in other if name), '다른 도시 이름 없음')


def resume_end(page):
    page.reload()
    page.wait_for_function("()=>{const L=KCP.league.state();return (L?.S||L?.snap)?.phase==='end';}")
    wait_unfolded(page)
    open_panel(page, 'result')


def result(checks, run, base, saved_result, check_off):
    page = run.page()
    scene_page = PromisePage(page)
    try:
        with scene_page:
            solo_end(checks, page, base, '시트 혼자 하기')
    except Exception as exc:
        checks.blocked('혼자 하기 12달 장면: ' + type(exc).__name__ + ': ' + str(exc).splitlines()[0][:180])
        return
    ready(checks, page)
    # 명세 §10.5·앞 판 §9-2: 선택식 약속에 자유 글을 강제하지 않고 실제 보이는 기기 안 글 칸에 쓴다.
    end_notes = fill_private_notes(page, '가상시트검사-끝성찰-QX', '#lg-reflect textarea[data-end]')
    require(checks, bool(end_notes) and len(scene_page.private) >= 2, '일지·결과 이유·끝 성찰 고유 가상 문장 입력')
    private = scene_page.private + end_notes
    room = page.evaluate('()=>KCP.league.state().room')
    page.wait_for_function("""([key,values])=>{
      const raw=localStorage.getItem(key)||'';return values.every(v=>raw.includes(v));
    }""", arg=[SOLO_KEY, private], timeout=6000)
    displayed = result_scene(checks, page)
    count_requests(checks, page, run.requests, 0, '끝 화면 진입·입력 자동 전송 없음')
    # 세 뷰포트는 같은 완주 화면에서 확인한다. 390은 터치 컨텍스트에 저장된 같은 판을 읽힌다.
    layout(checks, page, '#lg-sheet-send', '결과 1280 밝음')
    contrast(checks, page, RESULT_TEXT_SELECTORS, '결과 밝음')
    checks.shot(page, 'result-1280', '#lg-sheet')
    for width, height, scheme in ((820, 1180, 'light'), (1280, 900, 'dark')):
        page.set_viewport_size(dict(width=width, height=height))
        page.emulate_media(color_scheme=scheme)
        page.evaluate('s=>{document.documentElement.dataset.theme=s;}', scheme)
        layout(checks, page, '#lg-sheet-send', f'결과 {width} {scheme}')
        contrast(checks, page, RESULT_TEXT_SELECTORS, f'결과 {width} {scheme}')
    page.set_viewport_size(dict(width=1280, height=900))
    page.emulate_media(color_scheme='light')
    page.evaluate("()=>{document.documentElement.dataset.theme='light';}")
    saved_result.update(page.evaluate('()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))'))
    if check_off:
        # 명세 §10.1: 설정 없는 새 페이지가 이미 완주한 같은 판을 복원한다. 두 번째 완주 없음.
        unconfigured = run.page(build=False)
        unconfigured.goto(base + '#league/solo')
        try:
            unconfigured.wait_for_function("()=>KCP.league.state()?.S?.phase==='end'")
            open_panel(unconfigured, 'result')
            checks.ok(unconfigured.locator('#lg-sheet').count() == 0, '설정 없는 혼자 하기 끝 화면 #lg-sheet 0개')
            count_requests(checks, unconfigured, run.requests, 0, '설정 없는 끝 화면')
        except Exception as exc:
            checks.blocked('설정 없는 끝 화면 복원: ' + str(exc).splitlines()[0][:180])
        unconfigured.close()
    button = page.locator('#lg-sheet-send')
    before_text = button.inner_text()
    checks.ok(button.get_attribute('aria-disabled') == 'false', '결과 처음 활성')
    keys_before = page.evaluate('()=>Object.keys(localStorage).sort()')
    run.requests.fail = True
    button.click()
    failed = expect_result_status(page, 'fail')
    count_requests(checks, page, run.requests, 1, '결과 첫 실패')
    checks.ok(button.get_attribute('aria-disabled') == 'false' and button.inner_text() == before_text,
              '결과 실패 뒤 단추 재활성·원래 글')
    checks.ok(page.evaluate('k=>JSON.parse(localStorage.getItem(k)).interview.sheetResultSent===true', SOLO_KEY) is False,
              '결과 실패는 보냄으로 저장하지 않음')
    result_payload(checks, run, page, displayed, [room, 'pyeongtaek', *private])
    run.requests.fail = False
    run.requests.hold = True
    button.click()
    expect_result_status(page, 'sending')
    checks.ok(button.get_attribute('aria-disabled') == 'true' and button.inner_text() == before_text,
              '결과 대기 중 aria-disabled·원래 글')
    count_requests(checks, page, run.requests, 2, '결과 성공 재시도 시작')
    button.click(force=True)  # 총괄 보강: aria-disabled 단추도 실제로 누른다(Playwright는 비활성으로 보고 기다림)
    count_requests(checks, page, run.requests, 2, '결과 대기 중 중복 없음')
    # 명세 §5.4: 서랍을 다시 그려도 보내는 중 상태를 유지한다.
    open_panel(page, 'journal')
    open_panel(page, 'result')
    checks.ok(button.get_attribute('aria-disabled') == 'true', '결과 서랍 다시 그려도 대기 중')
    expect_result_status(page, 'sending')
    run.requests.release()
    sent = expect_result_status(page, 'sent')
    checks.ok(sent != failed and bool(sent.strip()), '결과 성공·실패 상태 다름')
    checks.ok(button.inner_text() != before_text and button.get_attribute('aria-disabled') == 'true' and
              button.get_attribute('disabled') is None, '결과 성공 글 변경·aria-disabled·disabled 없음')
    checks.shot(page, 'result-sent', '#lg-sheet-status')
    result_payload(checks, run, page, displayed, [room, 'pyeongtaek', *private])
    button.click(force=True)  # 총괄 보강: aria-disabled 단추도 실제로 누른다(Playwright는 비활성으로 보고 기다림)
    count_requests(checks, page, run.requests, 2, '결과 성공 뒤 중복 없음')
    page.wait_for_function('k=>JSON.parse(localStorage.getItem(k)).interview.sheetResultSent===true', arg=SOLO_KEY)
    checks.ok(True, '혼자 하기 저장된 판 interview.sheetResultSent 참')
    checks.ok(page.evaluate('()=>Object.keys(localStorage).sort()') == keys_before, '결과 보내기 새 저장 키 없음')
    resume_end(page)
    checks.ok(button.inner_text() != before_text and button.get_attribute('aria-disabled') == 'true', '새로고침 뒤 보낸 결과 유지')
    checks.ok(result_scene(checks, page) == displayed, '새로고침 뒤 보낼 값 유지')
    button.click(force=True)  # 총괄 보강: aria-disabled 단추도 실제로 누른다(Playwright는 비활성으로 보고 기다림)
    count_requests(checks, page, run.requests, 2, '새로고침 뒤 중복 없음')
    replay(checks, run, page)


def play_to_end(page):
    """fx_end.solo_end의 달 진행 고리만(단언 없이). 같은 조건으로 다시 시작한 판을 끝까지 돌린다."""
    dismiss_guide(page)
    for _ in range(40):
        state = read(page)['S']
        if state['phase'] == 'end':
            return
        wait_unfolded(page)
        previous = [state['round'], state['phase'], len(state.get('results', []))]
        if state['phase'] == 'plan':
            prepare(page)
        else:
            close_drawer(page)
            button = page.locator('#lg-ready')
            if not button.count() or not button.is_visible() or not button.is_enabled():
                button = page.get_by_role('button', name=re.compile(
                    r'^(?:다음 (?:달|턴|라운드).*|최종 (?:결과|순위).*|리그 끝|끝내기)$')).first
            button.click()
        page.wait_for_function(CHANGED_JS, arg=previous)
    raise AssertionError('다시 한 판 12달 완주 실패')


def end_panel(page):
    wait_unfolded(page)
    if not page.locator('#lg-sheet-send').is_visible():
        open_panel(page, 'result')
    page.wait_for_selector('#lg-sheet-send')


def replay(checks, run, page):
    """총괄 보강(독립 검토 minor 1, 재검토 minor 1·2): '같은 조건으로 다시'는 방 코드가 같다.
    - 보내는 중에 리그를 떠났다 이어서 하면 보내는 중 상태가 그대로이고 요청이 하나만 나간다.
    - 보낸 뒤 새로고침 없이 다시 한 판은 보낸 상태·상태 글을 물려받지 않는다.
    - 보내는 중에 다시 시작해도 새 판에 보냄이 기록되지 않는다."""
    rt = page.evaluate('() => KCP.feedback.RESULT_TEXT')
    sent_flag = 'k=>JSON.parse(localStorage.getItem(k))?.interview?.sheetResultSent===true'
    before = len(run.requests.records)
    page.locator('#lg-solo-same').click()
    page.wait_for_function("()=>KCP.league.state().S.phase!=='end'")
    checks.ok(page.evaluate(sent_flag, SOLO_KEY) is False, '다시 한 판 저장값에 보냄 표시 없음')
    try:
        play_to_end(page)
        end_panel(page)
    except Exception as exc:
        checks.blocked('다시 한 판 끝 화면: ' + str(exc).splitlines()[0][:180])
        return
    button = page.locator('#lg-sheet-send')
    checks.ok(button.get_attribute('aria-disabled') == 'false' and button.inner_text() == rt['button'],
              '다시 한 판 결과 단추 처음 활성·원래 글')
    # 보내는 중에 홈으로 떠났다가 이어서 하기(같은 페이지 메모리, 리그 세션 객체는 새로 생김).
    run.requests.hold = True
    button.click()
    expect_result_status(page, 'sending')
    count_requests(checks, page, run.requests, before + 1, '다시 한 판 보내기 시작')
    try:
        page.evaluate("()=>{location.hash='#home';}")
        page.wait_for_selector('#fb-open-home')
        page.evaluate("()=>{location.hash='#league/solo';}")
        page.wait_for_function("()=>{const L=KCP.league.state();return L?.role==='solo'&&(L.S||L.snap)?.phase==='end';}")
        end_panel(page)
    except Exception as exc:
        run.requests.release()
        checks.blocked('보내는 중 떠났다 이어서 하기: ' + str(exc).splitlines()[0][:180])
        return
    checks.ok(button.get_attribute('aria-disabled') == 'true' and
              page.locator('#lg-sheet-status').inner_text() == rt['sending'],
              '떠났다 돌아와도 보내는 중 상태 유지')
    button.click(force=True)
    count_requests(checks, page, run.requests, before + 1, '떠났다 돌아온 뒤 다시 눌러도')
    run.requests.release()
    run.requests.wait_done(page, len(run.requests.records))
    expect_result_status(page, 'sent')
    checks.ok(button.inner_text() == rt['sentButton'] and button.get_attribute('aria-disabled') == 'true',
              '떠났다 돌아온 화면에 보낸 결과 반영')
    page.wait_for_function(sent_flag, arg=SOLO_KEY)
    checks.ok(True, '떠났다 돌아온 같은 판에 보냄 기록')
    # 보낸 직후 새로고침 없이 같은 조건으로 다시.
    before = len(run.requests.records)
    page.locator('#lg-solo-same').click()
    page.wait_for_function("()=>KCP.league.state().S.phase!=='end'")
    try:
        play_to_end(page)
        end_panel(page)
    except Exception as exc:
        checks.blocked('보낸 뒤 다시 한 판 끝 화면: ' + str(exc).splitlines()[0][:180])
        return
    checks.ok(button.get_attribute('aria-disabled') == 'false' and button.inner_text() == rt['button'],
              '보낸 뒤 다시 한 판 단추 활성·원래 글')
    checks.ok(page.locator('#lg-sheet-status').inner_text() == '', '보낸 뒤 다시 한 판 상태 글 물려받지 않음')
    run.requests.hold = True
    button.click()
    expect_result_status(page, 'sending')
    count_requests(checks, page, run.requests, before + 1, '다시 한 판 경합 보내기 시작')
    # 보내는 중에 또 같은 조건으로 다시 시작하고, 새 판이 먼저 끝난 뒤에 앞 판의 성공이 온다
    # (총괄 보강, 3차 검토 minor 1: 새 판이 끝 단계여도 앞 판의 늦은 성공을 새 판에 기록하면 안 된다).
    page.locator('#lg-solo-same').click()
    page.wait_for_function("()=>KCP.league.state().S.phase!=='end'")
    try:
        play_to_end(page)
        end_panel(page)
    except Exception as exc:
        run.requests.release()
        checks.blocked('경합 새 판 끝 화면: ' + str(exc).splitlines()[0][:180])
        return
    run.requests.release()
    run.requests.wait_done(page, len(run.requests.records))
    checks.ok(page.evaluate(sent_flag, SOLO_KEY) is False, '보내는 중 다시 시작한 새 판(먼저 끝남)에 보냄 기록 없음')
    count_requests(checks, page, run.requests, before + 1, '다시 시작 경합 요청')
    checks.ok(button.get_attribute('aria-disabled') == 'false' and button.inner_text() == rt['button'] and
              page.locator('#lg-sheet-status').inner_text() == '', '경합 새 판 단추 활성·상태 글 빈 글')
    button.click()
    expect_result_status(page, 'sent')
    count_requests(checks, page, run.requests, before + 2, '경합 새 판은 따로 보냄')
    page.wait_for_function(sent_flag, arg=SOLO_KEY)
    checks.ok(True, '경합 새 판 자기 보냄 기록')


def result_mobile(checks, run, base):
    page = run.page()
    page.goto(base + '#league/solo')
    try:
        page.wait_for_function("()=>KCP.league.state()?.S?.phase==='end'")
        wait_unfolded(page)
        open_panel(page, 'result')
    except Exception as exc:
        checks.blocked('390 끝 화면 복원: ' + str(exc).splitlines()[0][:180])
        return
    result_scene(checks, page)
    layout(checks, page, '#lg-sheet-send', '결과 390 터치 어두움')
    contrast(checks, page, RESULT_TEXT_SELECTORS, '결과 390 어두움')
    checks.ok(page.evaluate('()=>navigator.maxTouchPoints>0'), '결과 390 실제 터치 컨텍스트')
    checks.shot(page, 'result-390', '#lg-sheet')
    count_requests(checks, page, run.requests, 0, '같은 끝 화면 390 복원 자동 요청 없음')


class RoutedContext:
    """team_end가 만드는 진행자·두 팀 페이지에도 탐색 전에 페이지 경로를 붙인다."""

    def __init__(self, run):
        self.run = run

    def __getattr__(self, name):
        return getattr(self.run.context, name)

    def new_page(self):
        page = self.run.context.new_page()
        inject_build(page, self.run.build)
        self.run.requests.attach(page)
        return page


def team(checks, run, base):
    pages = []
    try:
        team_end(checks, RoutedContext(run), base, pages, '시트 멀티')
    except Exception as exc:
        checks.blocked('진행자 1·팀 2의 12달 장면: ' + type(exc).__name__ + ': ' + str(exc).splitlines()[0][:180])
        return
    finally:
        run.pages.extend((page, events) for page, events, _ in pages)
    require(checks, len(pages) == 3, '최소 멀티 묶음 진행자 1·팀 2')
    host = pages[0][0]
    checks.ok(host.locator('#lg-sheet').count() == 0, '진행자 결과 보내기 없음')
    count_requests(checks, host, run.requests, 0, '멀티 완주까지 자동 전송 없음')
    for index, (page, _, _) in enumerate(pages[1:]):
        displayed = result_scene(checks, page)
        checks.ok(displayed['모드'] == '팀', '멀티 팀 모드')
        checks.ok(page.locator('#lg-sheet-send').get_attribute('aria-disabled') == 'false', '다른 팀 보냄 여부와 독립')
        private = fill_private_notes(page, '가상시트검사-팀성찰-ZQ', '#lg-reflect textarea[data-end]')
        if index == 0:
            checks.shot(page, 'team-result', '#lg-sheet')
        room = page.evaluate('()=>KCP.league.state().room')
        page.locator('#lg-sheet-send').click()
        expect_result_status(page, 'sent')
        count_requests(checks, page, run.requests, index + 1, '멀티 각 팀 결과 한 번')
        result_payload(checks, run, page, displayed, [room, *private])
        saved = page.evaluate("""()=>{const L=KCP.league.state();
          return JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`));}""")
        checks.ok(saved.get('sheetResultSent') is True, '기존 팀 자료 키에 sheetResultSent 참')
        checks.ok(page.locator('#lg-sheet-send').get_attribute('aria-disabled') == 'true', '팀 성공 뒤 aria-disabled')
    checks.ok(host.locator('#lg-sheet').count() == 0, '팀 전송 뒤에도 진행자 결과 보내기 없음')


def fake_jwt(role):
    encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    return encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'ref': 'TEST0000'}) + '.TEST_SIGNATURE'


def supabase_cases():
    local = dict(kind='local', url='', key='')
    return (
        ('빈 저장소 공개 키', SB, None, dict(kind='supabase', **SB)),
        ('공백 제거', dict(url=' ' + SB['url'] + ' ', key=' ' + SB['key'] + ' '), None, dict(kind='supabase', **SB)),
        ('가상 anon JWT', dict(url=SB['url'], key=fake_jwt('anon')), None,
         dict(kind='supabase', url=SB['url'], key=fake_jwt('anon'))),
        ('저장된 local 빈 두 칸', SB, local, dict(kind='local', **SB)),
        ('저장된 supabase 빈 두 칸', SB, dict(kind='supabase', url=' \t', key=' '), dict(kind='supabase', **SB)),
        ('저장된 프로젝트 우선', SB, SAVED, SAVED),
        ('주소만 저장', SB, dict(kind='supabase', url=SAVED['url'], key=''), dict(kind='supabase', url=SAVED['url'], key='')),
        ('키만 저장', SB, dict(kind='local', url='', key=SAVED['key']), dict(kind='local', url='', key=SAVED['key'])),
        ('secret 키 거부', dict(url=SB['url'], key='sb_secret_TEST0000'), None, local),
        ('service_role JWT 거부', dict(url=SB['url'], key=fake_jwt('service_role')), None, local),
        ('잘못된 주소', dict(url='https://example.com', key=SB['key']), None, local),
        ('빈 키', dict(url=SB['url'], key='  '), None, local),
        ('숫자 키', dict(url=SB['url'], key=17), None, local),
        ('문자열 설정', '가상 설정', None, local),
        ('배열 설정', [], None, local),
        ('설정 null', None, None, local),
    )


def supabase(checks, run, base, label, expected, stored):
    page = run.page()
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    radio = page.locator('input[name="lg-net"]:checked')
    checks.ok(radio.input_value() == expected['kind'], label + ' 연결 방식')
    details = page.locator('details.lg-net')
    if not details.evaluate('e=>e.open'):
        details.locator(':scope > summary').click()
    checks.ok(page.locator('#lg-url').input_value() == expected['url'], label + ' 주소')
    checks.ok(page.locator('#lg-key').input_value() == expected['key'], label + ' 키')
    checks.ok(page.locator('.lg-sb').is_visible() == (expected['kind'] == 'supabase'), label + ' 온라인 칸 표시')
    checks.ok(not page.locator('#lg-err').inner_text().strip(), label + ' 기본값 거부로 비밀 키 안내 없음')
    raw = page.evaluate('k=>localStorage.getItem(k)', NET_KEY)
    checks.ok(raw is None if stored is None else json.loads(raw) == stored,
              label + ' 로비만 열어서는 연결 설정 새 저장·덮어쓰기 없음')
    count_requests(checks, page, run.requests, 0, label + ' 로비 전송 없음')
    if label == '빈 저장소 공개 키':
        checks.shot(page, 'lobby-sb', 'details.lg-net')
        select_mode(page, 'solo')
        page.locator('#lg-solo-start').click()
        try:
            page.wait_for_function("()=>KCP.league.state()?.role==='solo'")
            checks.ok(True, '온라인 기본값이 있어도 혼자 하기 진입')
            checks.ok(page.evaluate('k=>localStorage.getItem(k)', NET_KEY) is None, '혼자 하기도 연결 기본값 저장 없음')
            count_requests(checks, page, run.requests, 0, '온라인 기본값·혼자 하기 자동 전송 없음')
        except Exception as exc:
            checks.blocked('온라인 기본값이 있는 혼자 하기 진입: ' + str(exc).splitlines()[0][:160])


def off_end(checks, run, base):
    page = run.page()
    try:
        solo_end(checks, page, base, '설정 없는 끝 화면')
    except Exception as exc:
        checks.blocked('설정 없는 혼자 하기 완주: ' + str(exc).splitlines()[0][:180])
        return
    checks.ok(page.locator('#lg-sheet').count() == 0, '설정 없는 끝 화면 #lg-sheet 0개')
    count_requests(checks, page, run.requests, 0, '설정 없는 완주')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='로컬 서버 index.html 주소')
    parser.add_argument('--only', default=','.join(SECTIONS), help='쉼표로 절 선택: ' + ','.join(SECTIONS))
    args = parser.parse_args()
    selected = set(args.only.split(','))
    if not selected or not selected <= set(SECTIONS):
        parser.error('--only는 ' + ','.join(SECTIONS) + ' 중 선택')
    checks = Checks(Path(os.environ.get('SHEET_CAP', str(Path(__file__).resolve().parents[1] / 'results' / 'sheet'))))
    saved_result = {}
    try:
        base = local_address(['sheet.py', args.url])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for name in SECTIONS:
                    if name not in selected:
                        continue
                    print('INFO 절 ' + name, flush=True)
                    if name == 'units':
                        with session(checks, browser, base, name) as run:
                            units(checks, run.page(), base)
                            checks.ok(not run.requests.records, '순수 함수 검사 실제 시트 요청 없음')
                    elif name == 'off':
                        with session(checks, browser, base, name, build=False) as run:
                            off(checks, run.page(), base)
                            checks.ok(not run.requests.records, '설정 없는 의견 요청 0')
                            if 'result' not in selected:
                                off_end(checks, run, base)
                    elif name == 'feedback':
                        init = SHARE_JS + "\nObject.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__sheetCopy=t;}}});"
                        with session(checks, browser, base, name, init=init) as run:
                            feedback(checks, run, base)
                        with session(checks, browser, base, 'feedback-390', width=390, height=844,
                                     scheme='dark', touch=True) as run:
                            feedback_mobile(checks, run, base)
                    elif name == 'league':
                        with session(checks, browser, base, name) as run:
                            league(checks, run, base)
                    elif name == 'result':
                        with session(checks, browser, base, name) as run:
                            result(checks, run, base, saved_result, 'off' in selected)
                        if SOLO_KEY in saved_result:
                            with session(checks, browser, base, 'result-390', width=390, height=844,
                                         scheme='dark', touch=True, storage=saved_result) as run:
                                result_mobile(checks, run, base)
                        else:
                            checks.blocked('390 결과 장면에 재사용할 혼자 하기 저장값 없음')
                        if 'off' in selected and not saved_result:
                            checks.blocked('설정 없는 끝 화면 검사에 재사용할 완주 장면 없음')
                    elif name == 'team':
                        with session(checks, browser, base, name) as run:
                            team(checks, run, base)
                    elif name == 'supabase':
                        for label, default, stored, expected in supabase_cases():
                            storage = None if stored is None else {NET_KEY: json.dumps(stored)}
                            with session(checks, browser, base, name + '-' + label,
                                         build=dict(BUILD, supabase=default), storage=storage) as run:
                                supabase(checks, run, base, label, expected, stored)
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked('실행 환경: ' + type(exc).__name__ + ': ' + str(exc).splitlines()[0][:200])
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
