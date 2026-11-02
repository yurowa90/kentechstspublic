"""품질8 W8 / V1: 도시 주민 변화와 지난달 정전의 정지 지도 표현.

총괄의 샌드박스 밖 로컬 환경에서만 실행:
  tests/.venv/bin/python tests/league/fx_town.py http://127.0.0.1:9430/index.html
작성 세션에서는 브라우저·서버를 실행하지 않는다. python3 -m py_compile만 수행.

기대값은 2026-10-21 승인 명세에서 온다. 기존 fx_replay의 혼자 하기·월 진행
도우미와 econui의 판정/진단/캡처 형식을 따른다. 마지막 줄은 checks N fail M.
1280×900와 390×844에서 빈 저장소로 시작해 실제로 두 달을 운영한다.
매달 재생 중에는 공개 townLook 상태를 읽기만 하고, 자연 종료 뒤와 다음 달
계획에서 실제 공개 unsPct로 도시 전체 창문 수의 반올림을 검산한다.

검사용 주입(실제 게임 흐름 아님):
* 1월 운영→2월 계획에서는 공개 사본 snap의 지난달 unsPct만 0으로,
  2월 운영→3월 계획에서는 50으로 바꾸고 buildGame.refresh()를 호출한다.
  설비로 0%/50%를 만들었다고 주장하지 않는다. 원본 S/저장/전송은 건드리지
  않고, finally에서 사본 값을 복원한다. 최근 결과는 원본과 객체를 공유할 수
  있으므로 주입 전에 snap.results 가지를 복사한다. 0.49%/100%도 검산한다.
* 주민 경계는 같은 공개 사본의 pop만 ±2%/±7%로 바꾸고 refresh한다.
  pop0와 원본 S는 수정하지 않는다. 집 기대값은 고정된 ±1/±3이다.
* 반올림은 Python round(은행가 반올림)가 아닌 floor(N*d + 0.5)이다.
  칸마다 반올림한 합을 정답으로 쓰지 않는다. 창문 개수 자체는 공개 관측값을
  사용하며 양수인지 별도로 확인한다. Canvas 캡처는 사람이 볼 증거로 남긴다.
"""

from league_flow import finish_trial, map_key_visible
import math
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, overflow, screenshot, shown)
from fx_replay import click_progress, observe, reach_result, start
from solo import close_drawer


SCALE_TEXT = '집 한 채 = 시작 주민 2%'
CITY_TEXT = '마을별 인구가 아니라 도시 전체 변화를 모든 마을에 똑같이 보인 것'

READ_JS = r"""() => {
  const L = KCP.league.state(), V = L?.snap, id = L?.team;
  const city = V?.econ?.cities?.[id], last = V?.results?.at(-1);
  const look = KCP.buildGame.townLook?.(), cv = document.querySelector('#bd-canvas');
  const key = document.querySelector('#bd-town-look-key');
  return {role:L?.role, round:V?.round, phase:V?.phase, count:V?.results?.length,
    pop:city?.pop, pop0:city?.pop0, unsPct:last?.team?.[id]?.unsPct ?? null,
    resultRound:last?.round, look:look ? {...look} : null,
    frozen:!!look && Object.isFrozen(look),
    playing:KCP.fxTurn?.state?.().playing === true,
    trial:document.documentElement.classList.contains('bd-running'),
    legendHidden:key?.hidden ?? null, legend:key?.textContent ?? '',
    aria:cv?.getAttribute('aria-description') ?? '',
    popPct:cv?.getAttribute('data-town-pop-pct'),
    unsData:cv?.getAttribute('data-town-uns-pct')};
}"""

# 기존 그리기/재생 함수를 바꾸지 않고 페이지의 관측 배열에만 기록한다.
# 시작 이벤트 내부 순서에 의존하지 않고 그리기 프레임에서 공개 상태를 읽는다.
WATCH_JS = r"""() => {
  const P = window.__w8Town = {samples:[], stopped:false};
  const tick = () => {
    if (P.stopped) return;
    const playing = KCP.fxTurn?.state?.().playing === true;
    const trial = document.documentElement.classList.contains('bd-running');
    if (playing || trial) {
      const look = KCP.buildGame.townLook?.();
      P.samples.push({playing, trial, look:look ? {...look} : null});
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""


def read(page):
    return page.evaluate(READ_JS)


def settle(page):
    # refresh()가 예약한 정적 층 그리기 뒤의 상태를 읽는다. 정답이 될 때까지 기다리지 않는다.
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def annotation(checks, page, state, label):
    with map_key_visible(page, '#bd-town-look-key'):  # rev12 Q2: ≤1100px 계획만 접힘.
        checks.ok(state['legendHidden'] is False and shown(page, '#bd-town-look-key'),
                  label + ' 범례 hidden=false·실제로 보임')
        checks.ok(page.locator('#bd-town-look-key').inner_text() == state['legend'],
                  label + ' 펼쳐도 같은 범례 글자')
    for key, text in (('legend', state['legend']), ('aria-description', state['aria'])):
        text = ' '.join(text.split())
        checks.ok(SCALE_TEXT in text, label + f' {key}: 집 한 채 = 시작 주민 2%')
        checks.ok(CITY_TEXT in text, label + f' {key}: 도시 전체 변화를 모든 마을에 동일 표시')


def static_lights(checks, page, label, native=False, expected_uns=None):
    settle(page)
    state = read(page)
    look = state['look']
    checks.ok(not state['playing'] and not state['trial'], label + ' 정지 지도')
    if not checks.ok(isinstance(look, dict), label + ' townLook() 공개 상태 존재'):
        return state
    checks.ok(state['frozen'], label + ' townLook() 반환값 동결')
    total, dark, uns = look.get('totalWins'), look.get('darkWins'), state['unsPct']
    valid = (type(total) is int and total > 0 and type(dark) is int and
             0 <= dark <= total and isinstance(uns, (int, float)) and math.isfinite(uns))
    checks.ok(valid, f'{label} 창문 총수 양수·정수, 0 ≤ 꺼진 창문 ≤ 전체: {look}')
    if expected_uns is not None:
        checks.ok(uns == expected_uns, f'{label} 공개 사본 정전 {expected_uns}%')
    if valid:
        share = min(1, max(0, uns / 100))
        expected = math.floor(total * share + 0.5)
        checks.ok(look.get('darkShare') == share, f'{label} 실제 공개 unsPct/100: {uns}%')
        checks.ok(dark == expected,
                  f'{label} 도시 전체 반올림: darkWins={dark}, 기대={expected}, totalWins={total}')
    annotation(checks, page, state, label)
    if native:
        # DOM 수치는 정상 흐름에서 확인한다. 검사용 사본 주입은 UI 갱신 이벤트가 아니다.
        def number(value):
            try:
                return float(value) if value else None
            except (TypeError, ValueError):
                return None
        checks.ok(number(state['unsData']) is not None and
                  math.isclose(number(state['unsData']), uns, abs_tol=0.011),
                  f'{label} data-town-uns-pct는 지난달 공개 %: {state["unsData"]}')
        expected_pop = (state['pop'] / state['pop0'] - 1) * 100
        checks.ok(number(state['popPct']) is not None and
                  math.isclose(number(state['popPct']), expected_pop, abs_tol=0.011),
                  f'{label} data-town-pop-pct는 시작 대비 주민 변화 %: {state["popPct"]}')
    return state


def samples(checks, page, kind, label):
    rows = page.evaluate('kind => __w8Town.samples.filter(s => s[kind])', kind)
    checks.ok(bool(rows), f'{label} 실제 {kind} 프레임 관측 {len(rows)}개')
    checks.ok(bool(rows) and all(isinstance(row['look'], dict) and
              row['look'].get('darkWins') == 0 for row in rows),
              f'{label} 실행 중 모든 표본의 정적 darkWins=0')


def inject(page, field, value):
    # 오직 공개 사본의 해당 필드만 수정한다. look 반환값·계산 API·그리기를 대체하지 않는다.
    page.evaluate("""([field,value]) => {
      const L = KCP.league.state(), V = L.snap;
      if (!V || V === L.S || V.econ === L.S?.econ)
        throw new Error('독립된 공개 사본이 필요함: 원본 상태 주입 금지');
      if (field === 'pop') {
        if (V.econ.cities === L.S?.econ?.cities ||
            V.econ.cities[L.team] === L.S?.econ?.cities?.[L.team])
          throw new Error('원본과 주민 객체를 공유함: pop 주입 금지');
        V.econ.cities[L.team].pop = value;
      } else if (field === 'unsPct') {
        V.results = structuredClone(V.results);
        V.results.at(-1).team[L.team].unsPct = value;
      } else throw new Error('허용되지 않은 주입 필드');
      KCP.buildGame.refresh();
    }""", [field, value])
    settle(page)


def population_boundaries(checks, page, label):
    original = read(page)
    try:
        for ratio, houses in ((0.98, -1), (1.02, 1), (0.93, -3), (1.07, 3)):
            inject(page, 'pop', original['pop0'] * ratio)
            state = read(page)
            checks.ok(state['look'] is not None and state['look']['houses'] == houses,
                      f'{label} 공개 사본 pop/pop0={ratio}: 집 {houses}채')
            static_lights(checks, page, f'{label} 주민 비율 {ratio}')
            screenshot(checks, page, f'fx-town-{label}-pop-{ratio}.png')
    finally:
        inject(page, 'pop', original['pop'])
    restored = read(page)
    checks.ok(restored['look'] == original['look'], label + ' 주민 주입 복원 뒤 외형 전체 복원')


def trial(checks, page, label):
    before = read(page)
    checks.ok(bool(before['look']) and before['look']['darkWins'] > 0,
              label + ' 50% 정지 지도에서 꺼진 창문 존재(공허한 복원 검사 방지)')
    close_drawer(page)
    page.evaluate('() => {__w8Town.samples = [];}')
    page.locator('[data-run="7"]').click()
    page.wait_for_function("() => document.documentElement.classList.contains('bd-running')")
    settle(page)
    state = read(page)
    checks.ok(state['trial'] and state['look'] is not None and state['look']['darkWins'] == 0,
              label + ' 시험 운전 중 정적 darkWins=0')
    screenshot(checks, page, f'fx-town-{label}-trial.png')
    overflow(checks, page, label + ' 시험 중')
    # 시험 운전은 화면의 결과 보기로 끝내고, 지난달 공개값 불빛으로 돌아와야 한다.
    finish_trial(page)
    page.wait_for_function("() => !document.documentElement.classList.contains('bd-running')")
    settle(page)
    samples(checks, page, 'trial', label)
    after = static_lights(checks, page, label + ' 시험 종료', expected_uns=50)
    checks.ok(after['look'] == before['look'], label + ' 시험 종료 뒤 기존 정적 불빛 전체 복원')


def solo(checks, page, base, label):
    start(page, base)
    page.wait_for_selector('#bd-canvas')
    settle(page)
    first = read(page)
    checks.ok(first['role'] == 'solo' and first['phase'] == 'plan' and first['count'] == 0,
              label + ' 결과 없는 혼자 하기 첫 달 계획')
    checks.ok(first['look'] is not None and first['look']['darkShare'] is None and
              first['look']['darkWins'] == 0, label + ' 운영 전 darkShare=null·darkWins=0')
    checks.ok(first['unsData'] == '', label + ' 운영 전 data-town-uns-pct 빈 문자열')
    annotation(checks, page, first, label + ' 첫 달')
    overflow(checks, page, label + ' 첫 달')
    page.evaluate(WATCH_JS)

    for month, fixed_uns in ((1, 0), (2, 50)):
        tag = f'{label}-month-{month}'
        page.evaluate('() => {__w8Town.samples = [];}')
        reach_result(page, month)
        current = read(page)
        checks.ok(current['resultRound'] == month and current['count'] == month,
                  tag + ' 실제 준비 버튼으로 이번 달 공개 결과 생성')
        checks.ok(current['playing'] and current['look'] is not None and
                  current['look']['darkWins'] == 0, tag + ' 결과 재생 중 정적 darkWins=0')
        screenshot(checks, page, f'fx-town-{tag}-replay.png')
        overflow(checks, page, tag + ' 재생 중')
        # Esc로 일찍 끝내지 않고 자연 종료를 기다린다. 시간 초과도 실패로 남긴다.
        page.wait_for_function('() => KCP.fxTurn.state().playing === false', timeout=8000)
        samples(checks, page, 'playing', tag)
        ended = static_lights(checks, page, tag + ' 재생 자연 종료', native=True)
        checks.ok(ended['resultRound'] == month and ended['count'] == month,
                  tag + ' 재생 종료 뒤에도 같은 달 결과로 복원')
        page.keyboard.press('Escape')  # 재생 후 사건/요약 덧층 닫기
        close_drawer(page)
        next_state = click_progress(page, observe(page))
        checks.ok(next_state['round'] == month + 1 and next_state['phase'] == 'plan',
                  tag + ' 다음 달 계획 화면으로 진행')
        native = static_lights(checks, page, tag + ' 다음 달 계획', native=True)
        screenshot(checks, page, f'fx-town-{tag}-plan.png')
        overflow(checks, page, tag + ' 다음 달 계획')

        original_uns = native['unsPct']
        try:
            # 실제 운영 결과를 확보한 뒤에만 0%/50% 시각 경계용 공개 사본을 만든다.
            inject(page, 'unsPct', fixed_uns)
            static_lights(checks, page, tag + f' 주입 {fixed_uns}%', expected_uns=fixed_uns)
            screenshot(checks, page, f'fx-town-{tag}-uns-{fixed_uns}.png')
            overflow(checks, page, tag + f' 주입 {fixed_uns}%')
            if fixed_uns == 50:
                population_boundaries(checks, page, tag)
                trial(checks, page, tag)
                for boundary in (0.49, 100):
                    inject(page, 'unsPct', boundary)
                    static_lights(checks, page, tag + f' 주입 {boundary}%', expected_uns=boundary)
        finally:
            inject(page, 'unsPct', original_uns)
        restored = static_lights(checks, page, tag + ' 원래 공개 결과 복원')
        checks.ok(restored['look'] == native['look'], tag + ' 주입 전 외형 전체 복원')


def standalone(checks, page, base, label):
    page.goto(base + '#build')
    page.wait_for_function(BOOT_JS)
    page.wait_for_selector('#bd-canvas')
    settle(page)
    checks.ok(page.evaluate('() => KCP.buildGame.townLook?.() === null'),
              label + ' #build 단독은 townLook=null')
    checks.ok(not shown(page, '#bd-town-look-key'), label + ' #build 단독은 리그 범례 없음')
    screenshot(checks, page, f'fx-town-{label}-standalone.png')
    overflow(checks, page, label + ' #build 단독')


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in ((1280, 900), (390, 844)):
                    label = f'{width}x{height}'
                    context, external = context_for(browser, base, width, height, 'light')
                    page, events = monitored_page(context)
                    page.emulate_media(reduced_motion='no-preference')
                    try:
                        solo(checks, page, base, label)
                        page.evaluate('() => {if (window.__w8Town) __w8Town.stopped = true;}')
                        standalone(checks, page, base, label)
                    except Exception as exc:
                        checks.ok(False, f'{label} 진행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                        screenshot(checks, page, f'fx-town-{label}-failure.png')
                    finally:
                        diagnostics(checks, events, label)
                        overflow(checks, page, label + ' 마지막')
                        checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
