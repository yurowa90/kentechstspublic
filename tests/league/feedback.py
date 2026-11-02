"""테스터 의견 보내기 수용 검사. 기대값 근거는 명세 §2~§8뿐이다.

허용된 로컬 실행 담당자:
  FEEDBACK_CAP=tests/results/feedback tests/.venv/bin/python tests/league/feedback.py \
    http://127.0.0.1:9430/index.html --only home,settings,league,pii,format,share,draft,layout,units
작성 세션에서는 python3 -m py_compile tests/league/feedback.py만 실행한다.
브라우저 통과·PNG 생성 여부는 문법 검사로 확인되지 않는다.
필수 장면·API 미확보는 실패이며 리그 장면 구성 실패는 BLOCKED다. SKIP은 없다.
"""

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import expect, sync_playwright
from econui import WAIT, context_for, diagnostics, local_address, monitored_page, open_panel
from fx_end import dismiss_guide
from league_flow import wait_unfolded
from rev14 import Checks
from rev15 import start, trial, promise, skip_replay
from solo import click_next, close_drawer


SECTIONS = ('home', 'settings', 'league', 'pii', 'format', 'share', 'draft', 'layout', 'units')
DRAFT_KEY = 'kcp:feedback-draft-v1'
DIALOG = '#kcp-feedback'
TEXT_IDS = ('good', 'hard', 'fix')
HEADER = '[켄텍 연습실 테스터 의견]'
SIZES = ((390, 844, 'light', True), (1280, 900, 'light', False),
         (820, 1180, 'light', True), (390, 844, 'dark', True))


class StopCase(Exception):
    """이미 기록한 필수 단언 실패 뒤 같은 절의 종속 조작을 멈춘다."""


class DeviceBrowser:
    """context_for의 차단·테마를 유지하며 실제 터치/모바일 컨텍스트를 만든다."""

    def __init__(self, browser, touch, mobile):
        self.browser, self.touch, self.mobile = browser, touch, mobile

    def new_context(self, **options):
        return self.browser.new_context(has_touch=self.touch, is_mobile=self.mobile, **options)


def require(checks, condition, label):
    if not checks.ok(condition, label):
        raise StopCase(label)


def focus(page, selector):
    expect(page.locator(selector)).to_be_focused()
    return True


def status(page, empty=False):
    # 명세 §6.1: 문구 검토로 바뀔 수 있는 상태 글은 빈 글 여부만 비교한다.
    page.wait_for_function("""empty => {
      const s=document.querySelector('#fb-status');
      return !!s && (s.textContent.trim()==='')===empty;
    }""", arg=empty)
    return True


def fields(page):
    return page.evaluate("""() => {
      const pick=n=>document.querySelector(`input[name="fb-${n}"]:checked`)?.value ?? '';
      return {role:pick('role'),easy:pick('easy'),fun:pick('fun'),
        good:document.querySelector('#fb-good').value,
        hard:document.querySelector('#fb-hard').value,fix:document.querySelector('#fb-fix').value};
    }""")


def output(page):
    return page.locator('#fb-out').input_value()


def choose_radio(page, key, value):
    # §5.1·§5.4: 누르는 대상은 감싼 label이다. 라디오 자체의 시각적 숨김은 허용한다.
    radio = page.locator(f'#fb-{key} input[type=radio][value="{value}"]')
    page.locator(f'#fb-{key} label').filter(
        has=page.locator(f'input[type=radio][value="{value}"]')).click()
    expect(radio).to_be_checked()


def api_ready(checks, page):
    for name in ('open', 'close', 'text', 'routeName', 'browserFamily', 'piiKinds', 'compose'):
        require(checks, page.evaluate("n => typeof window.KCP?.feedback?.[n]==='function'", name),
                '공개 API KCP.feedback.' + name)
    checks.ok(page.evaluate('() => KCP.feedback.DRAFT_KEY') == DRAFT_KEY, '공개 DRAFT_KEY')


def opened(checks, page):
    expect(page.locator(DIALOG)).to_be_visible()
    require(checks, page.locator(DIALOG).evaluate("e => e.tagName==='DIALOG' && e.open && e.matches(':modal')"),
            '의견 창 dialog open·:modal')


def home_open(checks, page):
    page.locator('footer.home-foot #fb-open-home').click()
    opened(checks, page)


def closed(checks, page, opener):
    expect(page.locator(DIALOG)).not_to_be_visible()
    checks.ok(not page.locator(DIALOG).evaluate('e => e.open'), '의견 창 닫힘')
    checks.test('연 단추로 초점 복귀 ' + opener, lambda: focus(page, opener))


def expected_text(info, values):
    """명세 §4.3 고정 줄머리·순서. 앱 compose나 출력에서 기대값을 만들지 않는다."""
    build = info['build']
    edition = '판: ' + build['label']
    if build['sha']:
        edition += ' · 커밋 ' + build['sha']
    if build['date']:
        edition += ' · ' + build['date']
    lines = [HEADER, '날짜: ' + info['date'], edition, '화면: ' + info['route'],
             '화면 크기: ' + info['size'], '터치: ' + info['touch'],
             '화면 밝기: ' + info['scheme'], '브라우저: ' + info['browser']]
    league = info.get('league')
    if league is not None:
        month = f"달: {league['month']}/{league['total']}"
        if league['monthLabel']:
            month += ' (' + league['monthLabel'] + ')'
        lines += ['리그 모드: ' + league['mode'], '도시: ' + (league['city'] or '없음'),
                  month, '단계: ' + league['phase'], '열린 서랍: ' + league['drawer']]
    roles = {'student': '학생', 'teacher': '교사', 'other': '기타', '': '고르지 않음'}
    rate = lambda n: values[n] + '/5' if values[n] else '고르지 않음'
    lines += ['', '역할: ' + roles[values['role']], '쉬웠나요: ' + rate('easy'),
              '재미있었나요: ' + rate('fun')]
    for key, heading in (('good', '좋았던 점:'), ('hard', '헷갈리거나 어려웠던 점:'),
                         ('fix', '고쳤으면 하는 점:')):
        lines += [heading, values[key].replace('\r\n', '\n').strip() or '(쓰지 않음)']
    return '\n'.join(lines)


def units(checks, page, base):
    api_ready(checks, page)
    # 테스터판 2 명세 §1: 저장소 기본값에 빈 배포 설정(시트 주소·Supabase)을 더한다.
    checks.ok(page.evaluate('() => KCP.BUILD') == {'label': '개발판', 'sha': '', 'date': '',
                                                   'feedbackUrl': '', 'supabase': None},
              '저장소 BUILD 기본값')
    # 도시 이름은 자료에서 읽는다(D-58·D-86, #78). 경로 뒤 한글 낱말을 버리는지 보는 입력값이다.
    city = page.evaluate("() => KCP.leagueCore.teamDef(KCP.leagueCore.regionOf('south'), 'pyeongtaek').name")
    routes = (('', '#home'), ('#home', '#home'), ('#y2022', '#y2022'),
              ('#league', '#league'), ('#league/solo', '#league/solo'),
              ('#league/j=eyJyIjoi', '#league/j'), ('#league/view/' + city, '#league/view'),
              ('#league/team?x=1', '#league/team'), ('#league/%ED%8F%89', '#league'))
    for value, wanted in routes:
        checks.ok(page.evaluate('s => KCP.feedback.routeName(s)', value) == wanted,
                  'routeName ' + repr(value))
    browsers = (
        ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 '
         '(KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5, 'Safari·iPadOS'),
        ('Mozilla/5.0 (Linux; Android 14; TestGalaxy) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 5, 'Chrome·Android'),
        ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 0, 'Chrome·macOS'),
        ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 0, 'Edge·Windows'),
        ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         '(KHTML, like Gecko) Chrome/130.0.0.0 Whale/4.0.0.0 Safari/537.36', 0, '웨일·Windows'),
        ('Mozilla/5.0 (Linux; Android 14; TestGalaxy) AppleWebKit/537.36 '
         '(KHTML, like Gecko) SamsungBrowser/26.0 Chrome/130.0.0.0 Mobile Safari/537.36',
         5, '삼성 인터넷·Android'),
        ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
         '(KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1', 5, 'Chrome·iOS'))
    for ua, touch, wanted in browsers:
        checks.ok(page.evaluate('a => KCP.feedback.browserFamily(...a)', [ua, touch]) == wanted,
                  'browserFamily ' + wanted)
    # 테스터판 2 명세 §4·§10.8: 5자리부터 확인하며 예시는 명백한 가상 값이다.
    pii = (('010-0000-0000', ['phone']), ('01000000000', ['digits', 'phone']),
           ('tester@example.com', ['email']), ('0000000', ['digits']), ('00000', ['digits']),
           ('0000', []), ('2026-10-31에 해 봤어요', []), ('3월 2/12달', []),
           ('1280×900', []), ('가상 학번 20513번', ['digits']))
    for value, wanted in pii:
        checks.ok(page.evaluate('s => KCP.feedback.piiKinds(s)', value) == wanted,
                  'piiKinds ' + repr(value))
    info = {'date': '2026-10-31', 'build': {'label': '개발판', 'sha': '', 'date': ''},
            'route': '#home', 'size': '1280×900', 'touch': '아니요',
            'scheme': '밝음', 'browser': 'Chrome·macOS'}
    blank = dict(role='', easy='', fun='', good='', hard='', fix='')
    for i, (sha, date) in enumerate((('', ''), ('0123456789ab', ''),
                                    ('', '2026-10-30'), ('0123456789ab', '2026-10-30'))):
        for with_league in (False, True):
            case = deepcopy(info)
            case['build'].update(sha=sha, date=date)
            values = dict(blank, role=('', 'student', 'teacher', 'other')[i],
                          easy=('', '1', '4', '5')[i], fun='5' if with_league else '',
                          good='  가상 첫 줄\r\n가상 둘째 줄  ' if with_league else '  ', hard='\n ')
            if with_league:
                case['league'] = dict(mode='혼자 하기', city='가상 도시' if i % 2 else '',
                                      month=2, total=12, monthLabel='2027년 2월' if i % 2 else '',
                                      phase='결과', drawer='도움말')
            actual = page.evaluate('a => KCP.feedback.compose(...a)', [case, values])
            checks.ok(actual == expected_text(case, values),
                      f'compose §4.3 전체 문자열 build 조합 {i} 리그 {with_league}')
    # 총괄 보강(재검토 minor 2, 명세 §9-4): label이 빠진 판 정보는 "개발판"으로 쓴다.
    for build, line in (({}, '판: 개발판'), ({'sha': '0123456789abcdef'}, '판: 개발판 · 커밋 0123456789ab')):
        case = dict(deepcopy(info), build=build)
        third = page.evaluate('a => KCP.feedback.compose(...a)', [case, blank]).split('\n')[2]
        checks.ok(third == line, 'label 없는 판 정보 기본 이름 ' + line)


def home(checks, page, base):
    entry = page.locator('footer.home-foot #fb-open-home')
    require(checks, entry.count() == 1, '홈 바닥줄 진입점 1개')
    checks.ok(entry.inner_text() == '테스터 의견 보내기', '홈 단추 고정 글')
    checks.ok(entry.evaluate("e => e.previousElementSibling?.id==='wipeAll'"), '모두 지우기 바로 뒤 진입점')
    checks.shot(page, 'entry-home', 'footer.home-foot #fb-open-home')
    home_open(checks, page)
    title = page.locator(DIALOG).get_attribute('aria-labelledby')
    checks.ok(title == 'kcp-feedback-title' and page.locator('#kcp-feedback-title').count() == 1 and
              bool(page.locator('#kcp-feedback-title').inner_text().strip()), '창 제목 aria-labelledby 연결·글')
    warn = page.locator('#fb-warn').inner_text()
    checks.ok(all(word in warn for word in ('이름', '학번', '학교', '연락처')), '경고 네 낱말')
    # 총괄 보강(재검토 minor 2, 명세 §9-3): 창을 열면 낭독기가 경고 줄을 함께 읽는다.
    checks.ok(page.locator(DIALOG).get_attribute('aria-describedby') == 'fb-warn', '창 aria-describedby=fb-warn')
    for key in TEXT_IDS:
        checks.ok(page.locator('#fb-' + key).evaluate("""e => e.tagName==='TEXTAREA' &&
          [...e.labels].some(l=>l.getAttribute('for')===e.id && l.textContent.trim())"""),
                  key + ' 연결된 label·비지 않은 글')
        checks.ok(page.locator('#fb-' + key).evaluate('e => e.maxLength===2000 && e.rows===3'),
                  key + ' 최대 2000자·3행')
    for key, wanted in (('role', ['student', 'teacher', 'other']),
                        ('easy', ['', '1', '2', '3', '4', '5']),
                        ('fun', ['', '1', '2', '3', '4', '5'])):
        node = page.locator('#fb-' + key)
        checks.ok(node.evaluate("e => e.tagName==='FIELDSET' && !!e.querySelector('legend')?.textContent.trim()"),
                  key + ' fieldset·legend')
        checks.ok(node.locator(f'input[type=radio][name="fb-{key}"]').evaluate_all(
            'es => es.map(e=>e.value)') == wanted, key + ' 라디오 개수·값·순서')
        checks.ok(node.locator('input[type=radio]').evaluate_all(
            'es => es.every(e=>e.closest("label")?.textContent.trim())'), key + ' 라디오 감싼 label')
        checked = node.locator('input:checked').evaluate_all('es=>es.map(e=>e.value)')
        checks.ok(checked == ([] if key == 'role' else ['']), key + ' 초기 선택')
    checks.ok(page.locator('#fb-status').evaluate(
        "e => e.getAttribute('role')==='status' && e.getAttribute('aria-live')==='polite'"), '상태 role=status·aria-live=polite')
    checks.ok(page.locator('#fb-out').evaluate('e => e.readOnly && e.rows===10'), '출력 읽기 전용·10행')
    page.locator(DIALOG + ' [data-v2-close]').click()
    closed(checks, page, '#fb-open-home')
    home_open(checks, page)
    page.keyboard.press('Escape')
    closed(checks, page, '#fb-open-home')
    # 총괄 보강(독립 검토 minor 7): §5.1 경로 변경 닫기·다시 그려진 단추로 초점, §5.3 storage:clear, §4.1 resize.
    home_open(checks, page)
    page.locator('#fb-good').fill('피드백검사-지우기신호')
    page.evaluate('() => KCP.emit("storage:clear", {})')
    checks.ok(page.locator('#fb-good').input_value() == '', 'storage:clear 뒤 열린 창 칸 비움')
    checks.ok(page.evaluate('k => localStorage.getItem(k)', DRAFT_KEY) is None, 'storage:clear 뒤 임시 저장 없음')
    page.set_viewport_size({'width': 1000, 'height': 800})
    page.wait_for_function("() => document.querySelector('#fb-out').value.split('\\n').includes('화면 크기: 1000×800')")
    checks.ok(True, 'resize 뒤 화면 크기 줄 갱신')
    page.set_viewport_size({'width': 1280, 'height': 900})
    old = page.locator('#fb-open-home').element_handle()
    page.evaluate('() => KCP.rerender()')
    expect(page.locator(DIALOG)).not_to_be_visible()
    checks.ok(not old.evaluate('e => e.isConnected'), '다시 그려 연 단추가 문서에서 빠짐')
    checks.test('경로 변경으로 닫힌 뒤 새 단추로 초점', lambda: focus(page, '#fb-open-home'))


def settings(checks, page, base):
    page.goto(base + '#y2022')
    page.locator('#tset').click()
    expect(page.locator('#timeset')).to_be_visible()
    checks.ok(True, '설정 창 보임')
    checks.shot(page, 'entry-settings', '#fb-open-settings')
    checks.ok(page.locator('#fb-open-settings').inner_text() == '테스터 의견 보내기', '설정 단추 고정 글')
    checks.ok(page.locator('#fb-open-settings').evaluate(
        "e => e.parentElement.matches('div.row.fb-entry') && e.parentElement.previousElementSibling?.id==='tm-url' && "
        "!e.parentElement.nextElementSibling && !!e.closest('#timeset')"), '설정 창 맨 끝(#tm-url 뒤) 진입점')
    page.locator('#fb-open-settings').click()
    opened(checks, page)
    checks.ok('화면: #y2022' in output(page).split('\n'), '설정에서 연 화면 #y2022')
    page.keyboard.press('Escape')
    closed(checks, page, '#fb-open-settings')
    checks.ok(page.locator('#timeset').is_visible(), 'Esc 뒤 설정 창 유지')
    # 총괄 보강(독립 검토 minor 7): 닫기 단추 경로도 설정 창을 그대로 둔다.
    page.locator('#fb-open-settings').click()
    opened(checks, page)
    page.locator(DIALOG + ' [data-v2-close]').click()
    closed(checks, page, '#fb-open-settings')
    checks.ok(page.locator('#timeset').is_visible(), '닫기 단추 뒤 설정 창 유지')


def league_state(page):
    return page.evaluate('() => { const L=KCP.league.state(); return L.S || L.snap; }')


def fill_private_notes(page, prefix, selector):
    """화면에 노출된 기기 안 글 칸에만 실제 입력한다. 숨긴 칸을 강제로 열지 않는다."""
    found = []
    nodes = page.locator(selector)
    for i in range(nodes.count()):
        node = nodes.nth(i)
        if node.is_visible():
            value = prefix + '-' + str(i)
            node.fill(value)
            node.blur()
            expect(node).to_have_value(value)
            found.append(value)
    return found


def league(checks, page, base):
    try:
        start(page, base, city='pyeongtaek')
        trial(page)
        promise(page)
        page.locator('#lg-ready').click()
        page.wait_for_function("() => KCP.league.state().S.phase==='review'")
        skip_replay(page)
        click_next(page, league_state(page))
        page.wait_for_function("""() => {const L=KCP.league.state(),V=L.S||L.snap;
          return V.round===2 && V.phase==='plan';}""")
        dismiss_guide(page)
        open_panel(page, 'journal')
        private = fill_private_notes(page, '피드백검사-일지문장-7Q', 'textarea[data-j]')
        notes = fill_private_notes(page, '피드백검사-이유문장-7Q', 'textarea[data-note]')
        if not private:
            raise AssertionError('2월 계획 일지 입력 칸 없음')
        trial(page)
        promise(page)
        notes += fill_private_notes(page, '피드백검사-약속문장-7Q', 'textarea[data-note]')
        private += notes
        page.locator('#lg-ready').click()
        page.wait_for_function("""() => {const L=KCP.league.state(),V=L.S||L.snap;
          return V.round===2 && V.phase==='review';}""")
        skip_replay(page)
        page.wait_for_function("() => KCP.fxTurn?.state?.()?.playing===false")
        wait_unfolded(page)
        # 총괄 보정: 2월 계획에는 data-note 이유 칸이 화면에 없다(일지 질문 data-j만 보임). 이유 칸은 결과 서랍의
        # '다음 달' 이유(data-note)로 나오므로 2월 결과 서랍에서도 보이는 기기 안 칸에 고유 문장을 써 둔다.
        notes += fill_private_notes(page, '피드백검사-결과이유-7Q', '#lg-panel textarea[data-note]')
        private += [v for v in notes if v not in private]
        if not notes:
            raise AssertionError('2월 약속·이유 기기 안 입력 칸 없음')
        # 기기 안 저장은 디바운스된다(D-64 저장 1초). 저장된 뒤에 복사 글에 없는지 봐야 의미가 있다.
        try:
            page.wait_for_function("""values => {const L=KCP.league.state();
              const s=Object.keys(localStorage).map(k => localStorage.getItem(k)||'').join('\\n');
              return values.every(v => s.includes(v));}""", arg=private, timeout=6000)
        except Exception:
            persisted = page.evaluate("""() => Object.keys(localStorage).map(k => k + '=' +
              (localStorage.getItem(k)||'').slice(0, 0)).join(',') + '\\n' +
              Object.keys(localStorage).map(k => localStorage.getItem(k)||'').join('\\n')""")
            missing = [v for v in private if v not in persisted]
            raise AssertionError('2월에 입력한 고유 문장 저장 미확보: ' + ','.join(missing))
        close_drawer(page)
        # 기존 onHelp 경로: 지도 도움말 단추의 실제 click으로 도움말 서랍을 연다.
        bar_help = page.locator('#lg-bar [data-panel="help"]')
        if bar_help.count() and bar_help.is_visible():
            bar_help.click()
        else:
            page.locator('#bd-help').click()
        expect(page.locator('#lg-panel #lg-help')).to_be_visible()
        scene = page.evaluate("""() => {const L=KCP.league.state(),V=L.S||L.snap;
          return {phase:V.phase,round:V.round,role:L.role,room:L.room,
            total:KCP.leagueCore.roundsOf(V).length,
            city:document.querySelector('#lg-bar .lg-bteam')?.textContent.trim(),
            playing:KCP.fxTurn.state().playing,panel:document.querySelector('#lg-panel:not([hidden])')?.dataset.tab};}""")
        if not (scene['phase'] == 'review' and scene['round'] == 2 and scene['total'] == 12 and
                scene['role'] == 'solo' and scene['panel'] == 'help' and scene['playing'] is False and
                scene['city'] and scene['room']):
            raise AssertionError('2월 결과·12달·혼자 하기·도시·방·도움말 장면 미확보')
    except Exception as exc:
        checks.blocked('리그 장면: ' + type(exc).__name__ + ': ' + str(exc).splitlines()[0][:180])
        return
    checks.ok(True, '리그 2월 결과·재생 끝·12달·혼자 하기·도움말 장면 확보')
    checks.ok(len(private) >= 2, '2월 기기 안 일지·이유 글 실제 입력')
    checks.ok(page.locator('#lg-feedback').evaluate("e => e.previousElementSibling?.id==='lg-build-help'"),
              '도움말 서랍 #lg-build-help 바로 뒤 진입점')
    checks.shot(page, 'entry-league', '#lg-feedback')
    checks.ok(page.locator('#lg-feedback').inner_text() == '의견 보내기(테스터)', '리그 단추 고정 글')
    page.locator('#lg-feedback').click()
    opened(checks, page)
    result = output(page)
    for line in ('리그 모드: 혼자 하기', '도시: ' + scene['city'], '단계: 결과',
                 '열린 서랍: 도움말', '화면: #league/solo'):
        checks.ok(line in result.split('\n'), '리그 출력 ' + line)
    checks.ok(any(line.startswith('달: 2/12') for line in result.split('\n')), '리그 달: 2/12')
    checks.ok(result == page.evaluate('() => KCP.feedback.text()'), '리그 출력 = text()')
    for label, copied in (('출력', result), ('text()', page.evaluate('() => KCP.feedback.text()'))):
        checks.ok(all(value not in copied for value in private), label + ' 기기 안 고유 문장 없음')
        checks.ok(scene['room'] not in copied, label + ' 방 코드 없음')
        checks.ok('pyeongtaek' not in copied, label + ' 도시 id 없음')
    checks.ok(page.evaluate("() => document.querySelector('#lg-panel:not([hidden])')?.dataset.tab") == 'help', '창 열어도 도움말 서랍 유지')
    page.keyboard.press('Escape')
    closed(checks, page, '#lg-feedback')
    checks.ok(page.locator('#lg-panel #lg-help').is_visible(), 'Esc 뒤 도움말 보임')
    checks.ok(page.evaluate("() => document.querySelector('#lg-panel:not([hidden])')?.dataset.tab") == 'help', 'Esc 뒤 도움말 상태 유지')
    # 총괄 보강(독립 검토 minor 7): 닫기 단추 경로도 도움말 서랍을 그대로 둔다.
    page.locator('#lg-feedback').click()
    opened(checks, page)
    page.locator(DIALOG + ' [data-v2-close]').click()
    closed(checks, page, '#lg-feedback')
    checks.ok(page.evaluate("() => document.querySelector('#lg-panel:not([hidden])')?.dataset.tab") == 'help', '닫기 단추 뒤 도움말 상태 유지')


def clipboard_equal(checks, page, label):
    page.wait_for_function("""async () => await navigator.clipboard.readText()===
      document.querySelector('#fb-out').value""")
    checks.ok(page.evaluate('() => navigator.clipboard.readText()') == output(page), label)


def pii(checks, page, base):
    marker = '피드백검사 클립보드 표지'
    page.evaluate('s => navigator.clipboard.writeText(s)', marker)
    home_open(checks, page)
    for key in TEXT_IDS:
        page.locator('#fb-' + key).fill('')
    page.locator('#fb-copy').click()
    checks.test('빈 글 상태 안내', lambda: status(page))
    checks.test('빈 글 첫 칸 초점', lambda: focus(page, '#fb-good'))
    checks.ok(page.evaluate('() => navigator.clipboard.readText()') == marker, '빈 글 클립보드 보존')
    page.locator('#fb-hard').fill('가상 전화번호 010-0000-0000을 적었어요')
    page.locator('#fb-copy').click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(True, '전화번호 확인 단계 보임')
    checks.ok(page.evaluate('() => navigator.clipboard.readText()') == marker, '확인 전 클립보드 보존')
    checks.test('확인 단계 고치러 가기 초점', lambda: focus(page, '#fb-pii-edit'))
    checks.shot(page, 'pii', '#fb-pii')
    page.locator('#fb-pii-edit').click()
    expect(page.locator('#fb-pii')).not_to_be_visible()
    checks.ok(True, '고치러 가기 확인 단계 숨김')
    checks.test('개인정보 모양 첫 칸 초점', lambda: focus(page, '#fb-hard'))
    page.locator('#fb-copy').click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(True, '다시 복사하면 다시 확인')
    page.locator('#fb-pii-go').click()
    clipboard_equal(checks, page, '그대로 복사 클립보드 = 출력')
    expect(page.locator('#fb-pii')).not_to_be_visible()
    checks.ok(True, '확인 뒤 단계 숨김')
    # 총괄 보강(독립 검토 minor 1): 숨은 단추에서 초점이 문서로 빠지지 않고 복사 단추로 돌아온다.
    checks.test('그대로 복사 뒤 초점 #fb-copy', lambda: focus(page, '#fb-copy'))
    for value, label in (('가상 이메일 tester@example.com', '이메일'),
                         ('가상 숫자 0000000', '7자리'), ('가상 숫자 00000', '5자리')):
        page.evaluate('s => navigator.clipboard.writeText(s)', marker)
        page.locator('#fb-hard').fill(value)
        page.locator('#fb-copy').click()
        expect(page.locator('#fb-pii')).to_be_visible()
        checks.ok(True, label + ' 확인 단계')
        checks.ok(page.evaluate('() => navigator.clipboard.readText()') == marker, label + ' 확인 전 복사 없음')
        checks.test(label + ' 확인 첫 초점', lambda: focus(page, '#fb-pii-edit'))
    page.locator('#fb-hard').fill('가상 숫자 0000')
    expect(page.locator('#fb-pii')).not_to_be_visible()
    checks.ok(True, '입력 수정하면 확인 단계 숨김')
    page.locator('#fb-copy').click()
    clipboard_equal(checks, page, '4자리 확인 없이 바로 복사')
    checks.ok(not page.locator('#fb-pii').is_visible(), '4자리 확인 단계 없음')


def format_case(checks, page, base, width, height, scheme, touch):
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    requests = []
    listener = lambda request: requests.append(request.resource_type)
    page.on('request', listener)
    try:
        home_open(checks, page)
        choose_radio(page, 'role', 'student')
        good = '가상 테스터 글 첫 줄\n가상 테스터 글 둘째 줄'
        page.locator('#fb-good').fill(good)
        choose_radio(page, 'easy', '4')
        page.locator('#fb-copy').click()
        clipboard_equal(checks, page, '복사 클립보드 = 출력')
        checks.test('복사 성공 상태', lambda: status(page))
        actual = output(page)
        checks.ok(actual == page.evaluate('() => KCP.feedback.text()'), '출력 = text()')
        today, browser = page.evaluate("""() => {const d=new Date();return [
          `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
          KCP.feedback.browserFamily(navigator.userAgent,navigator.maxTouchPoints)];}""")
        info = dict(date=today, build=dict(label='개발판', sha='', date=''), route='#home',
                    size=f'{width}×{height}', touch='예' if touch else '아니요',
                    scheme='어두움' if scheme == 'dark' else '밝음', browser=browser)
        values = dict(role='student', good=good, hard='', fix='', easy='4', fun='')
        checks.ok(actual == expected_text(info, values), '§4.3 전체 줄·순서·빈 줄·기기 정보 완전 일치')
        checks.ok(not re.search(r'\d{1,2}:\d{2}', actual), '시각 HH:MM 없음')
        checks.ok(not any(s.startswith(('리그 모드:', '도시:', '달:', '단계:', '열린 서랍:'))
                          for s in actual.split('\n')), '홈 출력 리그 줄 없음')
        checks.ok(not actual.endswith('\n'), '끝 줄바꿈 없음')
        if width == 1280:
            page.evaluate("""() => {const body=document.querySelector('#kcp-feedback .v2-modal-body'),
              field=document.querySelector('#fb-fix');
              body.scrollTop+=field.getBoundingClientRect().top-body.getBoundingClientRect().top-12;}""")
            checks.ok(page.evaluate("""() => {
              const b=document.querySelector('#kcp-feedback .v2-modal-body').getBoundingClientRect();
              const visible=id=>{const r=document.querySelector(id).getBoundingClientRect();
                return Math.min(r.bottom,b.bottom,innerHeight)>Math.max(r.top,b.top,0);};
              return visible('#fb-fix') && visible('#fb-out');
            }"""), '복사 캡처에 입력 칸·출력 함께 보임')
            checks.shot(page, 'copy')
            checks.shot(page, 'copy-out', '#fb-out')
        page.evaluate("""() => Object.defineProperty(navigator.clipboard,'writeText',
          {configurable:true,value:()=>Promise.reject(new DOMException('가상 복사 거부','NotAllowedError'))})""")
        page.locator('#fb-copy').click()
        checks.test('복사 실패 출력 초점', lambda: focus(page, '#fb-out'))
        checks.ok(page.locator('#fb-out').evaluate('e => e.selectionStart===0 && e.selectionEnd===e.value.length'),
                  '복사 실패 출력 전체 선택')
        checks.test('복사 실패 상태 안내', lambda: status(page))
    finally:
        checks.ok(not requests, f'창 열기~복사 끝 새 네트워크 요청 0: {requests}')
        page.remove_listener('request', listener)


NO_SHARE_JS = """Object.defineProperty(navigator,'share',{configurable:true,value:undefined});"""
SHARE_JS = """(() => {
  window.__feedbackShare={mode:'success',calls:[]};
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
    const p=window.__feedbackShare;p.calls.push({...data});
    if(p.mode==='abort')throw new DOMException('가상 취소','AbortError');
    if(p.mode==='error')throw new TypeError('가상 공유 실패');
  }});
})();"""


def share_absent(checks, page, base):
    home_open(checks, page)
    checks.ok(page.evaluate("() => typeof navigator.share!=='function'"), '공유 API 없는 컨텍스트')
    checks.ok(page.locator('#fb-share').evaluate('e=>e.hidden') and not page.locator('#fb-share').is_visible(),
              '공유 API 없으면 공유 숨김')


def share_present(checks, page, base):
    home_open(checks, page)
    expect(page.locator('#fb-share')).to_be_visible()
    checks.ok(True, '공유 API 있으면 공유 보임')
    page.locator('#fb-share').click()
    checks.test('빈 글 공유 상태', lambda: status(page))
    checks.test('빈 글 공유 초점', lambda: focus(page, '#fb-good'))
    checks.ok(page.evaluate('() => window.__feedbackShare.calls.length') == 0, '빈 글 공유 호출 없음')
    page.locator('#fb-good').fill('가상 공유 검사 글')
    for mode, count in (('success', 1), ('error', 2), ('abort', 3)):
        page.evaluate('m => {window.__feedbackShare.mode=m;}', mode)
        page.locator('#fb-share').click()
        page.wait_for_function('n => window.__feedbackShare.calls.length===n', arg=count)
        record = page.evaluate('() => window.__feedbackShare.calls.at(-1)')
        checks.ok(record['text'] == output(page), mode + ' 공유 text = 출력')
        checks.ok(record['title'] == '켄텍 연습실 테스터 의견', mode + ' 공유 title')
        checks.test(mode + ' 공유 상태', lambda m=mode: status(page, empty=m != 'error'))
    # §5.3: 확인 단계는 복사·공유 양쪽에 적용하고, 승인한 한 번만 공유한다.
    page.locator('#fb-good').fill('가상 이메일 tester@example.com')
    page.evaluate("() => {window.__feedbackShare.mode='success';}")
    page.locator('#fb-share').click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(page.evaluate('() => window.__feedbackShare.calls.length') == 3, '개인정보 확인 전 공유 없음')
    checks.test('공유 확인 초점', lambda: focus(page, '#fb-pii-edit'))
    page.locator('#fb-pii-go').click()
    page.wait_for_function('() => window.__feedbackShare.calls.length===4')
    # 총괄 보강(재검토 minor 1): 숨은 확인 단추에서 초점이 빠지지 않고 공유 단추로 돌아온다.
    checks.test('그대로 공유 뒤 초점 #fb-share', lambda: focus(page, '#fb-share'))
    checks.ok(page.evaluate('() => window.__feedbackShare.calls.at(-1).text') == output(page),
              '그대로 공유 text = 출력')
    page.locator('#fb-share').click()
    expect(page.locator('#fb-pii')).to_be_visible()
    checks.ok(page.evaluate('() => window.__feedbackShare.calls.length') == 4, '공유 승인은 한 번만 유효')


def draft(checks, page, base):
    home_open(checks, page)
    wanted = dict(role='teacher', good='가상 임시 글', hard='가상 어려운 점', fix='가상 제안', easy='2', fun='5')
    for key in TEXT_IDS:
        page.locator('#fb-' + key).fill(wanted[key])
    for key in ('role', 'easy', 'fun'):
        choose_radio(page, key, wanted[key])
    saved = page.evaluate('key => JSON.parse(localStorage.getItem(key))', DRAFT_KEY)
    checks.ok(saved == dict(v=1, **wanted), '임시 저장 JSON v:1·모든 칸·라디오')
    page.reload()
    home_open(checks, page)
    checks.ok(fields(page) == wanted, '새로고침 뒤 글·라디오 복원')
    page.locator('#fb-copy').click()
    clipboard_equal(checks, page, '임시 글 복사 성공')
    checks.ok(page.evaluate('key => JSON.parse(localStorage.getItem(key))', DRAFT_KEY) == saved,
              '복사 뒤 임시 저장 그대로')
    page.locator('#fb-clear').click()
    empty = dict(role='', easy='', fun='', good='', hard='', fix='')
    checks.ok(fields(page) == empty, '지우기 모든 칸·역할·별점 초기화')
    checks.ok(page.locator('#fb-role input:checked').count() == 0 and
              all(page.locator(f'#fb-{key} input:checked').input_value() == '' for key in ('easy', 'fun')),
              '지우기 역할 미선택·별점 빈 값 선택')
    checks.ok(page.evaluate('key => localStorage.getItem(key)', DRAFT_KEY) is None, '지우기 키 제거')
    checks.test('지우기 상태', lambda: status(page))
    checks.test('지우기 첫 칸 초점', lambda: focus(page, '#fb-good'))
    page.locator('#fb-good').fill('모두 지우기용 가상 글')
    page.keyboard.press('Escape')
    page.locator('#wipeAll').click()
    checks.ok('의견 보내기에 쓰던 글' in page.locator('#wipeConfirm').inner_text(), '모두 지우기 안내에 임시 글 포함')
    page.locator('#wipeYes').click()
    checks.ok(page.evaluate('key => localStorage.getItem(key)', DRAFT_KEY) is None, '모두 지우기 임시 키 제거')
    home_open(checks, page)
    checks.ok(fields(page) == empty, '모두 지우기 뒤 다시 열면 빈 칸')
    cases = (('{', empty),
             (json.dumps(dict(v=1, role='x', easy='9', fun='x', good=1, hard=None, fix={})), empty),
             (json.dumps(dict(v=1, role='', easy='', fun='', good='가' * 2005, hard='', fix='')),
              dict(empty, good='가' * 2000)))
    for i, (raw, expected) in enumerate(cases):
        page.keyboard.press('Escape')
        page.evaluate('a => localStorage.setItem(...a)', [DRAFT_KEY, raw])
        home_open(checks, page)
        checks.ok(fields(page) == expected, f'손상/잘못된 값/길이 검증 분기 {i}')


LAYOUT_JS = r"""() => {
  const d=document.querySelector('#kcp-feedback'),body=d.querySelector('.v2-modal-body');
  const rect=d.getBoundingClientRect();
  const visible=e=>e.checkVisibility({visibilityProperty:true}) && e.getClientRects().length>0;
  const targets=[...d.querySelectorAll('button,fieldset label')].filter(visible).map(e=>{
    const r=e.getBoundingClientRect();return {id:e.id||e.textContent.trim(),w:r.width,h:r.height};
  });
  // §5.4 허용 근사: 창 계산 배경(없으면 --ui-panel)을 불투명 처리한다.
  // 그 안 조상의 반투명 배경·전경 알파는 실제 순서로 합성한다.
  const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
    const p=ctx.getImageData(0,0,1,1).data;return [p[0]/255,p[1]/255,p[2]/255,p[3]/255];};
  const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
  const lum=c=>c.slice(0,3).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4)
    .reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  const contrasts=[...d.querySelectorAll('#fb-warn,legend,label,#fb-out')].filter(visible).map(e=>{
    const chain=[];for(let n=e;n && n!==d;n=n.parentElement)chain.unshift(n);
    let bg=rgba(getComputedStyle(d).backgroundColor);
    if(bg[3]===0)bg=rgba(getComputedStyle(d).getPropertyValue('--ui-panel').trim());
    bg[3]=1;for(const n of chain)bg=over(rgba(getComputedStyle(n).backgroundColor),bg);
    const fg=over(rgba(getComputedStyle(e).color),bg),a=lum(fg),b=lum(bg);
    return {id:e.id||e.textContent.trim().slice(0,40),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
  return {doc:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),width:innerWidth,
    dialog:[d.scrollWidth,d.clientWidth],body:body&&[body.scrollWidth,body.clientWidth],
    left:rect.left,right:rect.right,targets,contrasts};
}"""


def layout_case(checks, page, base, width, height, scheme, touch):
    home_open(checks, page)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    data = page.evaluate(LAYOUT_JS)
    checks.ok(data['doc'] <= data['width'], '문서 가로 넘침 0')
    checks.ok(data['dialog'][0] <= data['dialog'][1], '창 가로 넘침 0')
    require(checks, data['body'] is not None, '.v2-modal-body 존재')
    checks.ok(data['body'][0] <= data['body'][1], '창 본문 가로 넘침 0')
    checks.ok(data['left'] >= 0 and data['right'] <= width, '창 사각형 좌우 화면 안')
    require(checks, len(data['targets']) >= 18, '닫기·단추·라디오 label 측정 대상 확보')
    for target in data['targets']:
        checks.ok(target['w'] >= 44 and target['h'] >= 44,
                  f"44px 대상 {target['id']} ({target['w']:.2f}×{target['h']:.2f})")
    require(checks, len(data['contrasts']) >= 21, '경고·legend·label·출력 대비 대상 확보')
    for target in data['contrasts']:
        checks.ok(target['ratio'] >= 4.5, f"대비 {target['id']} {target['ratio']:.3f}:1 ≥4.5")
    # 총괄 보강(재검토 minor 2, 명세 §9-3): iOS 확대를 막는 글 칸 16px.
    checks.ok(page.evaluate("() => [...document.querySelectorAll('#kcp-feedback textarea')]"
                            ".every(e => getComputedStyle(e).fontSize === '16px')"), '글 칸 네 개 16px')
    name = 'dlg-dark-390' if scheme == 'dark' else f'dlg-{width}'
    checks.shot(page, name)


def run_case(checks, browser, base, label, action, width=1280, height=900,
             scheme='light', touch=False, clipboard=False, init=None):
    before = checks.count
    context = None
    page = None
    try:
        context, external = context_for(DeviceBrowser(browser, touch, touch and width == 390),
                                         base, width, height, scheme)
        # 총괄 보정(독립 검토): 리그 장면 대기는 다른 리그 검사와 같은 econui WAIT(KCP_WAIT)을 쓴다.
        context.set_default_timeout(WAIT)
        if clipboard:
            context.grant_permissions(['clipboard-read', 'clipboard-write'])
        if init:
            context.add_init_script(init)
        page, events = monitored_page(context)
        try:
            page.goto(base + '#home')
            expect(page.locator('footer.home-foot')).to_be_visible()
            action(checks, page, base)
        except StopCase:
            pass
        except Exception as exc:
            checks.ok(False, f'{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}')
        finally:
            diagnostics(checks, events, label)
            checks.ok(not external, f'{label} 외부 요청 0: {external}')
    except Exception as exc:
        checks.blocked(f'{label} 실행 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:180]}')
    finally:
        if context:
            context.close()
        print(f'INFO {label} assertions {checks.count - before}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='로컬 서버 index.html 주소')
    parser.add_argument('--only', default=','.join(SECTIONS), help='쉼표로 절 선택: ' + ','.join(SECTIONS))
    args = parser.parse_args()
    selected = set(args.only.split(','))
    if not selected or not selected <= set(SECTIONS):
        parser.error('--only는 ' + ','.join(SECTIONS) + ' 중 선택')
    checks = Checks(Path(os.environ.get('FEEDBACK_CAP', str(Path(__file__).resolve().parents[1] /
                                                          'results' / 'feedback'))))
    try:
        base = local_address(['feedback.py', args.url])
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for name in SECTIONS:
                    if name not in selected:
                        continue
                    print('INFO 절 ' + name, flush=True)
                    if name == 'format':
                        for w, h, scheme, touch in ((1280, 900, 'light', False), (390, 844, 'dark', True)):
                            run_case(checks, browser, base, f'format-{w}-{scheme}',
                                     lambda c, p, b, w=w, h=h, s=scheme, t=touch: format_case(c, p, b, w, h, s, t),
                                     w, h, scheme, touch, clipboard=True)
                    elif name == 'layout':
                        for w, h, scheme, touch in SIZES:
                            run_case(checks, browser, base, f'layout-{w}-{scheme}',
                                     lambda c, p, b, w=w, h=h, s=scheme, t=touch: layout_case(c, p, b, w, h, s, t),
                                     w, h, scheme, touch)
                    elif name == 'share':
                        run_case(checks, browser, base, 'share-absent', share_absent, init=NO_SHARE_JS)
                        run_case(checks, browser, base, 'share-present', share_present, init=SHARE_JS)
                    else:
                        run_case(checks, browser, base, name, globals()[name], clipboard=name in ('pii', 'draft'))
            finally:
                browser.close()
    except Exception as exc:
        checks.blocked(f'실행 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:180]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
