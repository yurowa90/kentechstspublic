"""품질8 W6 끝 그래프 수용 검사. 브라우저 실행은 총괄 담당.

샌드박스 밖 로컬 실행:
  tests/.venv/bin/python tests/league/fx_end.py http://127.0.0.1:9430/index.html
새 컨텍스트에서 화면 버튼으로만 12달 진행한다. evaluate는 공개 상태·DOM
조회와 관측기 설치에 사용하며, 계통 누락 검사만 기기·탭 기록의 grid를 지웠다 복원한다.
엔진 실행, 계산값 주입, fxEnd.mount 재호출 없음.
캡처는 tests/results/fx-end-*.png. 마지막 줄: checks N fail M.
"""

import math
import re
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, HIDDEN_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, screenshot, shown)
from league_flow import (confirm_seat, pass_issue_check, select_mode, start_solo,
                         wait_unfolded)
from solo import CHANGED_JS, close_drawer, read


# W6 검토 반영: mount를 호출/교체하지 않고 init script에서 클래스 변경과 rAF를 기록한다.
# 혼자 하기는 같은 틱에 첫 블록이 제거될 수 있어 화면에 남은 DOM의 기록만 판정한다.
PROBE_JS = r"""(() => {
  const seen = new WeakMap(), records = [], roots = [];
  let frameNumber = 0;
  const tick = () => { frameNumber++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__w6End = records;
  const sample = (root, scope, start, target) => {
    const style = getComputedStyle(root);
    const meters = [...scope.querySelectorAll('#lg-rank .lg-scoreparts meter')].map(m => {
      const s = getComputedStyle(m), box = m.getBoundingClientRect();
      // W6는 native meter의 값·폭을 유지하고 clip-path로 표시 폭을 펼친다.
      // inset의 좌우 가림을 px로 환산해 마지막 표시 폭이 원래 폭인지 확인한다.
      let exposed = box.width;
      if (s.clipPath !== 'none') {
        const match = /^inset\(([^)]+)\)$/.exec(s.clipPath);
        if (!match) exposed = null;
        else {
          const p = match[1].split(/\s+/), px = v => parseFloat(v) * (v.endsWith('%') ? box.width / 100 : 1);
          const right = p[1] || p[0], left = p[3] || p[1] || p[0];
          exposed = Math.max(0, box.width - px(right) - px(left));
        }
      }
      return {team:m.closest('[data-team]')?.dataset.team,
        part:m.closest('[data-part]')?.dataset.part, value:m.value, min:m.min, max:m.max,
        width:box.width, exposed, clip:s.clipPath, opacity:s.opacity,
        entering:m.classList.contains('lg-fx-rank-enter')};
    });
    return {target, ms:performance.now()-start, connected:root.isConnected,
      transform:style.transform, opacity:style.opacity,
      lines:[...root.querySelectorAll('.lg-fx-line')].map(p => {
        const s = getComputedStyle(p);
        return {key:p.closest('[data-fx-metric]')?.dataset.fxMetric + ':' + p.dataset.fxSeries,
          dash:s.strokeDashoffset, clip:s.clipPath, solid:p.hasAttribute('pathLength')};
      }), meters};
  };
  const scan = () => {
    const L = window.KCP?.league?.state?.(), V = L?.S || L?.snap;
    if (V?.phase !== 'end') return;
    for (const root of document.querySelectorAll('.lg-fx-end')) {
      if (seen.has(root)) continue;
      const scope = root.closest('#lg-panel, #lg-host-rank') || root.parentElement;
      const start = performance.now(), record = {samples:[], frames:[], classes:[], done:false};
      seen.set(root, record);
      roots.push(root);
      records.push(record);
      record.samples.push(sample(root, scope, start, 0));
      const frame = () => {
        const s = sample(root, scope, start, 'raf');
        record.frames.push(s);
        if (!root.isConnected) return;
        if (s.ms < 1800) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      // 고정 시각은 종료 후 정지만 확인한다. 등장은 클래스 이력과 rAF로 판정한다.
      for (const target of [1500, 1800]) {
        const take = () => record.samples.push(sample(root, scope, start, target));
        setTimeout(take, target);
      }
      setTimeout(() => { record.done = true; }, 1850);
    }
  };
  new MutationObserver(changes => {
    scan();
    changes.forEach((change, i) => {
      if (change.type !== 'attributes') return;
      const el = change.target;
      const block = el.matches('.lg-fx-end') ? el : null;
      const meter = el.matches('#lg-rank .lg-scoreparts meter') ? el : null;
      if (!block && !meter) return;
      // 한 알림 안에서 붙었다 빠져도 다음 oldValue로 중간 클래스 상태를 복원한다.
      const next = changes.slice(i + 1).find(c => c.target === el && c.type === 'attributes');
      const before = change.oldValue || '', after = next ? next.oldValue || '' : el.getAttribute('class') || '';
      const scope = meter?.closest('#lg-panel, #lg-host-rank');
      const root = block || [...roots].reverse().find(r => r.isConnected && scope?.contains(r));
      const record = root && seen.get(root);
      if (!record) return;
      const name = block ? 'lg-fx-enter' : 'lg-fx-rank-enter';
      record.classes.push({kind:block ? 'block' : 'meter', frame:frameNumber,
        team:meter?.closest('[data-team]')?.dataset.team,
        part:meter?.closest('[data-part]')?.dataset.part,
        before:before.split(/\s+/).includes(name), after:after.split(/\s+/).includes(name)});
    });
  }).observe(document, {childList:true, subtree:true, attributes:true,
    attributeFilter:['class'], attributeOldValue:true});
  // Node를 반환하지 않고 현재 화면에 남아 있는 블록과 동일한 기록을 고른다.
  window.__w6CurrentEnd = () => [...roots].reverse().find(r => r.isConnected);
  window.__w6CurrentRecord = () => seen.get(window.__w6CurrentEnd());
})();"""

PUBLIC_JS = """() => {
  const L = KCP.league.state();
  // league.js finalHTML은 혼자 하기의 fxEnd.html에 snap + L.S.results 전체를 전달한다.
  // 원본 S.econ에는 score가 없다. 진행자 점수는 monthStep이 남긴 econRep.score를 읽는다.
  const V = L.role === 'host' ? {...L.S, econ:{...L.S?.econ, score:L.S?.econRep?.score}} :
    L.role === 'solo' ? {...L.snap, results:L.S?.results} : L.snap;
  const co2Saved = {};
  // 팀의 과거 공개 CO₂는 fx-end.js remember의 방·도시별 sessionStorage 사본만 보충한다.
  if (L.role === 'team') for (const id of V?.active || Object.keys(V?.teams || {})) {
    try {
      const data = JSON.parse(sessionStorage.getItem('kcp-fx-end-co2-v1:' + JSON.stringify([V.room,id])));
      co2Saved[id] = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { co2Saved[id] = {}; }
  }
  let gridSaved = {};
  if (L.role === 'team') {
    try {
      const data = JSON.parse(localStorage.getItem(`kcp-league-data-v1:${L.room}:${L.team}`));
      gridSaved = {[L.team]: data?.interview?.metrics || {}};
    } catch (_) { /* 기록이 없으면 공개값·탭 사본만 사용한다. */ }
  }
  return {V, team:L.team, role:L.role,
    co2Saved, gridSaved, words:['O','O*','P','M','G'].map(g => KCP.gradeWords(g)), evidence:KCP.gradeWords('M·G')};
}"""
NUMBER = r"[+−-]?\d[\d,]*(?:\.\d+)?"
DATE = r"\d{4}년\s+\d{1,2}월"
# fx-end.js METRICS: 주민은 원 인구가 아닌 시작 대비 비율이며 소수 1자리다.
METRICS = {'appr': ('지지', '%', 1), 'pop': ('주민 · 시작 대비 변화', '%', 1),
           'uns': ('정전', '%', 1), 'co2': ('CO₂ 생산', 't/일', 1),  # rev11 R5: 그래프 제목·낭독 이름.
           'grid': ('계통이 메운 전기', 'MWh/일', 1)}


def number(text, unit):
    match = re.search(rf'({NUMBER})\s*{re.escape(unit)}', text)
    return float(match[1].replace(',', '').replace('−', '-')) if match else None


def near(a, b, digits_a=1, digits_b=None):
    """fmt의 최대 소수 자릿수에 따른 반올림 오차만 허용한다.

    원본 대 표시: 0.5×10^-digits_a. 표시 대 표시: 양쪽 반올림 한계의 합.
    주민 교차 검산은 명수 표시의 오차를 시작 대비 %로 바꾸어 별도 반영한다.
    """
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (a, b)):
        return False
    tolerance = 0.5 * 10 ** -digits_a
    if digits_b is not None:
        tolerance += 0.5 * 10 ** -digits_b
    return abs(a - b) <= tolerance + 1e-7


def source_value(state, city, month, key, saved=None, saved_grid=None):
    """그래프용 helper를 호출하지 않고 공개 필드에서 독립적으로 읽는다."""
    if key in ('appr', 'pop'):
        city_data = state.get('econ', {}).get('cities', {}).get(city, {})
        hist = city_data.get('hist', [])
        point = next((h for h in hist if h.get('t') == month - 1), {})
        value = point.get(key)
        if key == 'pop':
            # fx-end.js read(pop)는 hist 첫 값이 아닌 cities[id].pop0로 나눈다.
            # 지역 전체 성장 보정 없이 같은 hist 인구 / pop0 × 100을 검산한다.
            start = city_data.get('pop0')
            # 2026-10-20 UX 요청 반영: 시작 대비 변화율(%) = (pop/pop0 − 1) × 100, 0이 기준선.
            return (value / start - 1) * 100 if finite(value) and finite(start) and start > 0 else None
        return value
    result = next((r for r in state.get('results', []) if r.get('round') == month), {})
    if key == 'grid':
        fields = result.get('team', {}).get(city, {})
        values = [fields.get('isolated', {}).get('uns'), fields.get('uns'),
                  fields.get('imp'), fields.get('sub')]
        representative = result.get('days')
        if all(finite(v) for v in values) and finite(representative) and representative > 0:
            isolated, uns, imp, sub = values
            return max(0, isolated - uns - imp + sub) / representative
        own = (saved_grid or {}).get(city, {}).get(str(month), {}).get('grid')
        rounds = state.get('rounds', [])
        days = (rounds[month - 1].get('mdays') if 0 < month <= len(rounds) else None) or representative
        if finite(own) and finite(days) and days > 0:
            return own / days  # 기기 기록은 월 환산 MWh다.
        cached = (saved or {}).get(city, {}).get(str(month), {})
        if not isinstance(cached, dict):
            return None
        value, representative = cached.get('grid'), cached.get('days')
        return value / representative if finite(value) and finite(representative) and representative > 0 else None
    value = result.get('team', {}).get(city, {}).get('unsPct' if key == 'uns' else 'co2Prod')
    if key == 'co2':
        # 팀은 현재 공개값을 우선하고 공개값이 빠진 달만 이 탭의 수신 사본을 쓴다.
        if not finite(value):
            cached = (saved or {}).get(city, {}).get(str(month), {})
            if not isinstance(cached, dict):
                return None
            value = cached.get('co2Prod')
            result = {'days': cached.get('days')}
        if not finite(value):
            return None
        # D-82: 월 환산 ÷ 그 달 일수 = 대표 기간 배출량 ÷ 대표 운전 일수.
        rounds = state.get('rounds', [])
        days = (rounds[month - 1].get('mdays') if 0 < month <= len(rounds) else None) or result.get('days')
        representative = result.get('days')
        if not finite(days) or not finite(representative) or representative <= 0:
            return None
        value /= representative
    return value


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def endpoints(label, unit):
    value = rf'(?:자료 없음|{NUMBER}\s*{re.escape(unit)})'
    match = re.search(rf'({DATE})\s+({value})\s*→\s*({DATE})\s+({value})', label)
    if not match:
        return None
    return {'dates': [match[1], match[3]], 'first': number(match[2], unit),
            'last': number(match[4], unit), 'neighbor': number(label.split('이웃 평균', 1)[-1], unit)
            if '이웃 평균' in label else None}


def dismiss_guide(page):
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()


def prepare(page):
    """solo.py의 준비 → 확인 카드 → 예측/건너뛰기 UI 흐름."""
    dismiss_guide(page)
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)
    # 어느 카드가 보이는지를 한 번의 페이지 안 판정으로 정한다. 예전에는 DOM에 생긴 것만 기다린 뒤 shown()으로
    # 다시 물었는데, shown()의 여러 왕복 사이에 진행자 snap이 서랍을 다시 그리면 떨어진 노드를 읽어 '안 보임'이
    # 되고, 그러면 아무것도 누르지 않고 돌아가 팀이 준비를 보내지 않았다(CI endgrid 멀티 30초 대기 초과, #56).
    kind = page.wait_for_function("""() => {
      const L=KCP.league.state(), V=L.S || L.snap;
      if (V.phase !== 'plan' || V.teams[L.team].ready) return 'done';
      const hidden=(""" + HIDDEN_JS + """);
      const seen=sel => [...document.querySelectorAll(sel)].some(el => !hidden(el) &&
        el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
      if (seen('#lg-predict-skip')) return 'skip';
      if (seen('#lg-ready-confirm')) return 'confirm';
      return false;
    }""").json_value()
    if kind == 'skip':
        page.locator('#lg-predict-skip').click()
    elif kind == 'confirm':
        page.locator('[data-evidence="evening"]').click()
        page.locator('[data-pred]').select_option('down')
        page.locator('[data-confidence="fairly"]').click()
        page.locator('#lg-ready-confirm').click()
    # 준비가 실제로 반영될 때까지(혼자 하기는 단계 전환, 팀은 진행자 snap의 ready) 이 도우미가 책임진다.
    page.wait_for_function("""() => {
      const L=KCP.league.state(), V=L.S || L.snap;
      return V.phase !== 'plan' || !!V.teams[L.team].ready;
    }""")


def solo_end(checks, page, base, label):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    checks.ok(page.evaluate('() => localStorage.length') == 0, label + ' 빈 저장소에서 시작')
    start_solo(page, months=12)
    dismiss_guide(page)
    reviews = set()
    for _ in range(40):
        state = read(page)['S']
        if state['phase'] == 'end':
            break
        wait_unfolded(page)
        previous = [state['round'], state['phase'], len(state.get('results', []))]
        if state['phase'] == 'plan':
            prepare(page)
        else:
            if state['phase'] == 'review':
                reviews.add(state['round'])
                # T F2: 마지막 달의 '최종 결과'도 같은 결과 단계 주 동작 계약이다.
                if state['round'] == 12:
                    styles = page.evaluate("""() => ({
                      ready:getComputedStyle(document.querySelector('#lg-ready')).backgroundColor,
                      trials:[...document.querySelectorAll('.bd-go[data-run]')].map(n=>{
                        const s=getComputedStyle(n);return [s.backgroundImage,s.boxShadow];})
                    })""")
                    checks.ok(styles['ready'] == 'rgb(236, 208, 131)' and bool(styles['trials']) and
                              all(x == ['none', 'none'] for x in styles['trials']),
                              label + ' F2 최종 결과 금색·시험 단추 보조')
            close_drawer(page)
            # 결과 뒤 혼자 하기의 준비 버튼은 다음 달/최종 결과 진행도 맡는다.
            button = page.locator('#lg-ready')
            if not button.count() or not button.is_visible() or not button.is_enabled():
                button = page.get_by_role('button', name=re.compile(
                    r'^(?:다음 (?:달|턴|라운드).*|최종 (?:결과|순위).*|리그 끝|끝내기)$')).first
            button.click()
        page.wait_for_function(CHANGED_JS, arg=previous)
        overflow(checks, page, f'{label} {state["round"]}달 {state["phase"]}')
    state = read(page)['S']
    complete = (state['phase'] == 'end' and state['round'] == 12 and
                len(state.get('results', [])) == 12 and state['econ']['t'] == 12)
    checks.ok(complete and reviews == set(range(1, 13)), label + ' 화면 조작으로 1~12달 완주')
    if not complete:
        raise AssertionError('12달 완주 실패')
    wait_unfolded(page)
    # 자동으로 열리지 않는 경우에도 기존 결과 버튼으로 진입한다.
    if not shown(page, '#lg-final-summary'):
        open_panel(page, 'result')
    page.wait_for_selector('#lg-panel .lg-fx-end')


def motion(checks, page, label, reduced):
    # W6 검토 반영: 제거된 첫 블록 대신 현재 연결된 블록의 관측 완료를 기다린다.
    page.wait_for_function("() => window.__w6CurrentRecord?.()?.done")
    record = page.evaluate('() => window.__w6CurrentRecord?.() || {}')
    samples, frames, changes = (record.get(key, []) for key in ('samples', 'frames', 'classes'))
    checks.ok(page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches") == reduced,
              label + ' 실제 reduced-motion 설정')
    # 키 누락은 관측 실패로 보고하고 후속 검사를 중단해 KeyError로 원인을 가리지 않는다.
    valid = (len(samples) == 3 and all(s.get('connected') for s in samples) and
             all(all(key in s for key in ('ms', 'transform', 'opacity', 'lines', 'meters')) and
                 all(all(key in p for key in ('key', 'dash', 'solid')) for p in s.get('lines', [])) and
                 all(all(key in m for key in ('team', 'part', 'value', 'min', 'max', 'width',
                                               'exposed', 'clip', 'opacity', 'entering'))
                     for m in s.get('meters', [])) for s in samples + frames))
    if not checks.ok(valid, label + ' 화면에 남은 끝 DOM의 시작·종료 관측 자료'):
        return
    checks.ok(all(s['lines'] and s['meters'] for s in samples), label + ' 같은 끝 DOM의 선·막대 표본 존재')
    first, final, later = samples

    def signature(s):
        return (s['transform'], s['opacity'], s['lines'],
                [(m['clip'], m['value'], m['width'], m['opacity'], m['entering']) for m in s['meters']])

    checks.ok(signature(final) == signature(later), label + ' 등장 1.5초 뒤 선·블록·막대 정지')
    final_transform = final['transform'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)')
    checks.ok(final_transform and float(final['opacity']) == 1 and
              all(float(p['dash'].removesuffix('px')) == 0 for p in final['lines']),
              label + ' 최종 transform·선 dashoffset·불투명도')
    if reduced:
        # 움직임 줄이기는 클래스 부여와 중간 프레임 변화 없이 처음부터 최종 상태다.
        checks.ok(all(signature(s) == signature(first) for s in samples + frames) and
                  not any(c.get('after') for c in changes),
                  label + ' reduce 삽입 직후·모든 rAF·종료 표본이 최종 상태')
    else:
        # fx-end.js mount: lg-fx-enter 부여 → 다음 rAF에 제거. 고정 시각 픽셀은 쓰지 않는다.
        def entered(kind, team=None, part=None):
            events = [c for c in changes if c.get('kind') == kind and
                      (kind == 'block' or (c.get('team'), c.get('part')) == (team, part))]
            added = next((i for i, c in enumerate(events) if not c.get('before') and c.get('after')), None)
            return added is not None and any(c.get('before') and not c.get('after') and
                                             c.get('frame') == events[added].get('frame', -2) + 1
                                             for c in events[added + 1:])

        checks.ok(entered('block'), label + ' 남은 블록 lg-fx-enter 부여 후 다음 프레임 제거')
        # 이웃 점선은 clip-path를 쓰므로 pathLength가 있는 실선의 dashoffset을 검증한다.
        solid = [p['key'] for p in final['lines'] if p.get('solid')]
        checks.ok(bool(solid) and all(
            any(p['key'] == key and abs(float(p['dash'].removesuffix('px'))) > 0
                for s in [first] + frames for p in s['lines']) and
            any(p['key'] == key and float(p['dash'].removesuffix('px')) == 0 for p in later['lines'])
            for key in solid), label + ' rAF 관측 실선 stroke-dashoffset 비영 → 0')
    trace = [{'ms': round(s['ms'], 1), 'transform': s['transform'], 'opacity': s['opacity'],
              'dash': [p['dash'] for p in s['lines']]} for s in samples]
    print(f'INFO {label} 등장 표본 {trace}, rAF {len(frames)}개, 클래스 변화 {len(changes)}개', flush=True)
    state = page.evaluate(PUBLIC_JS)['V']
    # 이전 관측의 KeyError 방지: score/parts 키가 없으면 None으로 검증을 실패시킨다.
    # 기대 키는 점수 데이터의 유무와 무관하게 모든 활성 도시 × 6항목을 유지한다.
    score = (state.get('econ', {}).get('score') or {}).get('by', {})
    active = state.get('active') or list(state.get('teams', {}))
    expected = {(city, part): ((score.get(city) or {}).get('parts') or {}).get(part)
                for city in active
                for part in ('pop', 'ind', 'fin', 'co2', 'appr', 'rel')}
    meters = final['meters']
    checks.ok(len(meters) == len(expected) and
              {(m['team'], m['part']) for m in meters} == set(expected), label + ' 모든 도시 6개 순위 막대')
    checks.ok(bool(meters) and all(
        near(m['value'], expected.get((m['team'], m['part'])), 7) and
        m['min'] == 0 and m['max'] == 100 and m['width'] > 0 and
        m['exposed'] is not None and abs(m['exposed'] - m['width']) < 0.01 and
        float(m['opacity']) == 1 and not m['entering'] for m in meters),
        label + ' 순위 meter의 점수값 일치·가림 0·최종 폭 도달')
    if not reduced:
        # W6 검토 반영: meter도 동일 DOM의 클래스 부여/제거 이력으로 등장 판정한다.
        checks.ok(bool(meters) and all(entered('meter', m.get('team'), m.get('part')) for m in meters),
                  label + ' 모든 순위 meter lg-fx-rank-enter 부여 후 다음 프레임 제거')


def reset_scroll(page):
    # 스크롤만 초기화한다. 숨김/높이/배치는 수정하지 않는다.
    page.evaluate("""() => {
      window.scrollTo(0,0);
      for (const s of document.querySelectorAll('#lg-panel, #lg-panel .lg-pbody')) s.scrollTop=0;
    }""")


def fifth_chart_layout(checks, page, label, selector):
    data = page.evaluate("""selector => {
      const charts=document.querySelector(selector), cards=charts?.querySelectorAll('.lg-fx-chart');
      if (!charts || cards.length !== 5) return {width:innerWidth};
      const first=cards[0].getBoundingClientRect(), fifth=cards[4].getBoundingClientRect(), box=charts.getBoundingClientRect();
      return {width:innerWidth, first:first.width, fifth:fifth.width,
        center:(fifth.left+fifth.right)/2, containerCenter:(box.left+box.right)/2};
    }""", selector)
    if data['width'] != 1280:
        return
    checks.ok(data.get('first', 0) > 0 and data.get('fifth', 0) > 0 and
              abs(data['fifth'] - data['first']) <= 1,
              f'{label} 1280폭 다섯째 그래프 폭 = 첫째 폭 ±1px: {data}')
    checks.ok('center' in data and abs(data['center'] - data['containerCenter']) <= 1,
              f'{label} 1280폭 다섯째 그래프 가운데 = 그래프 칸 가운데 ±1px: {data}')


def layout(checks, page, label, mobile):
    reset_scroll(page)
    data = page.evaluate("""() => {
      const body=document.querySelector('#lg-panel .lg-pbody');
      const selectors=['#lg-final-summary', '#lg-decisions', '.lg-fx-end'];
      const missing=selectors.filter(s=>!body?.querySelector(s));
      if (missing.length) return {missing};
      const [summary, decisions, graph]=selectors.map(s=>body.querySelector(s));
      const line=summary.querySelector('p');
      if (!line) return {missing:['#lg-final-summary p (내 최종 순위·점수 줄)']};
      const r=line.getBoundingClientRect(), b=body.getBoundingClientRect(), p=body.parentElement.getBoundingClientRect();
      const x=(Math.max(r.left,b.left)+Math.min(r.right,b.right))/2, y=(r.top+r.bottom)/2;
      const hit=document.elementFromPoint(x,y);
      // 총괄 결정(2026-10-21, V3A 5와 W6 충돌 해소 '가'): 요약 → 결정과 결과 → 그래프 순서(작업 줄기 단언).
      return {missing:[], first:body.firstElementChild===summary, adjacent:summary.nextElementSibling===decisions && !!decisions && decisions.nextElementSibling===graph,
        top:body.scrollTop, panelTop:body.parentElement.scrollTop, text:line.innerText,
        visible:r.top>=Math.max(0,b.top,p.top) && r.bottom<=Math.min(innerHeight,b.bottom,p.bottom) &&
          r.right>r.left && !!hit && line.contains(hit),
        // SVG font-size는 viewBox 축소 전 값이다. 실제 CTM 배율까지 곱해 화면 px를 잰다.
        fonts:[...graph.querySelectorAll('svg text, h4, h4 small, .lg-fx-values p')].map(n=>{
          const size=parseFloat(getComputedStyle(n).fontSize), m=n.getScreenCTM?.();
          return size * (m ? Math.hypot(m.c,m.d) : 1);}),
        boxes:[...graph.querySelectorAll('[data-fx-metric]')].map(n=>{
          const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};})};
    }""")
    if not checks.ok(not data['missing'],
                     f'{label} (a) 끝 화면 필수 요소 존재, 못 찾은 선택자: {data["missing"]}'):
        return
    fifth_chart_layout(checks, page, label, '#lg-panel .lg-fx-charts')
    state = page.evaluate(PUBLIC_JS)
    # 누락 점수는 순위 관측의 실패로 남긴다. 원래 KeyError가 다른 단언까지 막지 않도록 한다.
    score = (state['V'].get('econ', {}).get('score') or {}).get('by', {})
    own = score.get(state.get('team')) or {}
    match = re.search(rf'(\d+)위\s*·\s*({NUMBER})점', data['text'])
    # 총괄 결정·리그 기준 2 V3A 5: 요약 → 결정과 결과 → 끝 그래프.
    checks.ok(data['first'] and data['adjacent'] and bool(match) and
              int(match[1]) == own.get('rank') and near(number(match[2] + '점', '점'), own.get('score')),
              label + ' (a) 첫 블록 내 최종 순위·점수, 결정과 결과 다음 그래프')
    checks.ok(data['top'] == data['panelTop'] == 0 and data['visible'],
              label + ' (a) 서랍 스크롤 0 첫 화면에 내 순위 줄 표시')
    if mobile:
        # W6 총괄 결정(2026-10-20, UX 동의): 390px에서는 그래프 한 장을 서랍 폭 가까이(글자 11px 이상) 쓰고
        # 다섯 장은 그래프 칸 안에서 옆으로 넘긴다.
        boxes = sorted(data['boxes'], key=lambda b: b['x'])
        row = (len(boxes) == 5 and all(b['w'] >= 250 and b['h'] > 0 for b in boxes) and
               all(abs(b['y'] - boxes[0]['y']) < 2 for b in boxes) and
               all(b['x'] >= a['x'] + a['w'] - 1 for a, b in zip(boxes, boxes[1:])))
        checks.ok(row, f'{label} (b) 그래프 다섯 장 가로 한 줄·한 장 폭 250px 이상: {boxes}')
        swipe = page.evaluate("""() => {
          const c=document.querySelector('.lg-fx-end .lg-fx-charts'), root=document.documentElement;
          if (!c) return null;
          const page0=Math.max(root.scrollWidth, document.body.scrollWidth);
          const inner=c.scrollWidth > c.clientWidth + 1;
          c.scrollLeft=c.scrollWidth;
          const cards=c.querySelectorAll('.lg-fx-chart'), fifth=cards[4];
          if (!fifth) return null;
          const last=fifth.getBoundingClientRect(), box=c.getBoundingClientRect();
          const reached=cards.length === 5 && fifth.dataset.fxMetric === 'grid' &&
            last.left >= box.left - 1 && last.right <= box.right + 1;
          c.scrollLeft=0;
          return {inner, reached, pageSame: Math.max(root.scrollWidth, document.body.scrollWidth) === page0 && page0 <= innerWidth,
            region: c.getAttribute('role') === 'region' && c.tabIndex === 0 && !!c.getAttribute('aria-label')};
        }""")
        checks.ok(bool(swipe) and swipe['inner'] and swipe['reached'] and swipe['pageSame'] and swipe['region'],
                  f'{label} (b) 그래프 칸 안에서만 옆으로 넘겨 다섯째 계통 그래프까지 도달, 페이지 가로 스크롤 0, 넘김 칸에 이름·초점: {swipe}')
        checks.ok(bool(data['fonts']) and all(finite(size) and size >= 11 for size in data['fonts']),
                  f'{label} (b) 그래프 글자 실제 11px 이상: {min(data["fonts"], default=0):.2f}px')
    strip = page.evaluate("""() => {
      const s=document.querySelector('.lg-fx-strip'), root=document.documentElement;
      const width=()=>Math.max(root.scrollWidth,document.body.scrollWidth);
      const before=width(), x=window.scrollX, previous=s.scrollLeft;
      s.scrollLeft=s.scrollWidth;
      const after=width(), moved=s.scrollLeft;
      const controls=[...s.querySelectorAll('button,a[href],[role=button],input,[tabindex]')];
      const actions=controls.map(n=>{const r=n.getBoundingClientRect();return r.width>=44 && r.height>=44;});
      const passive=[...s.querySelectorAll('li')].every(n=>getComputedStyle(n).cursor!=='pointer');
      const result={before,after,page:root.clientWidth,overflow:s.scrollWidth>s.clientWidth,
        moved,unchanged:window.scrollX===x,inside:['auto','scroll'].includes(getComputedStyle(s).overflowX),
        controls:controls.length,targets:actions.every(Boolean),passive,
        months:s.querySelectorAll('[data-fx-month]').length};
      s.scrollLeft=previous; return result;
    }""")
    checks.ok(strip['months'] == 12, label + ' 12달 연대기 칸')
    # 한 열 그래프와 긴 띠가 있어도 페이지 가로 스크롤은 0, 띠 안에서만 이동한다.
    checks.ok(strip['before'] == strip['after'] == strip['page'] and strip['unchanged'] and
              (not strip['overflow'] or strip['inside'] and strip['moved'] > 0),
              f'{label} (b) 긴 연대기는 띠 내부에서만 가로 스크롤: {strip}')
    if mobile:
        checks.ok(strip['overflow'], label + ' (b) 390에서 실제 넘치는 연대기 띠로 검증')
    checks.ok(strip['targets'] if strip['controls'] else strip['passive'],
              label + ' (d) 띠 조작은 44px 이상, 비조작 칸은 버튼 커서 없음')
    overflow(checks, page, label + ' 끝 화면')


def graphs(checks, page, label, host=False):
    public = page.evaluate(PUBLIC_JS)
    state, team = public['V'], public.get('team')
    root = page.locator('#lg-host-rank .lg-fx-end' if host else '#lg-panel .lg-fx-end')
    checks.ok(root.locator('[role="img"]').count() == 5 and root.locator('[data-fx-metric]').count() == 5,
              label + ' (c) 지지·주민·정전·CO₂·계통 그래프 5개 role=img')
    checks.ok(root.locator('.lg-fx-charts').get_attribute('aria-label') ==
              '지표 그래프 5개 · 좁은 화면에서는 좌우로 넘겨요', label + ' 그래프 칸 aria 5개')
    if not host and page.viewport_size['width'] == 1280:
        # T F12: SVG 내부 font-size가 아닌 축소 뒤 화면 글자 높이로 확인한다.
        heights = root.locator('svg text').evaluate_all(
            'nodes => nodes.map(n => n.getBoundingClientRect().height)')
        checks.ok(bool(heights) and min(heights) >= 10,
                  label + ' F12 결과 서랍 끝 그래프 축 화면 높이 10px 이상')
        if public['role'] == 'solo':
            # 지시서 T 5번: 첫 달 score1.py에서 옮김. 월별 추이 글자가 0개면 실패한다.
            timeline_heights = page.locator('#lg-panel #lg-timeline svg text').evaluate_all(
                'nodes => nodes.map(n => n.getBoundingClientRect().height)')
            checks.ok(bool(timeline_heights) and min(timeline_heights) >= 10,
                      label + f' F12 결과 서랍 월별 추이 축 화면 높이 10px 이상(글자 {len(timeline_heights)}개)')
    text = root.text_content()
    naked = re.findall(r'(?<!\w)(?:O\*?|P|M|G)(?!\w)', text)
    # W6 검토 반영: 단일 G 표시에 그치지 않고 gradeWords("M·G")의 두 근거 말을 확인한다.
    checks.ok(not naked and public['evidence'] == '모형 계산 · 게임 가정' and public['evidence'] in text and
              all(word and word != grade for word, grade in zip(public['words'], ('O', 'O*', 'P', 'M', 'G'))),
              label + ' (e) 등급 낱글자 없음·모형 계산 · 게임 가정 표시')
    active = state.get('active') or list(state['teams'])
    month = 12
    rows = {}
    for key, (name, unit, precision) in METRICS.items():
        article = root.locator(f'[data-fx-metric="{key}"]')
        aria = article.locator('[role="img"]').get_attribute('aria-label') or ''
        # 주민 aria 이름·단위도 시작 대비 %이고, 모든 제목 근거는 M·G의 말 표현이다.
        checks.ok(aria.startswith(name + ',') and public['evidence'] in article.locator('h4').inner_text(),
                  label + f' {name} 이름·근거 말')
        for city in active if host else [team]:
            # 진행자 대안은 도시마다 "이름: 첫 달 → 마지막 달"을 나열한다.
            city_name = state['econ']['cities'][city]['name']
            segment = aria.split(city_name + ':', 1)[-1].split(';', 1)[0] if host else aria
            values = endpoints(segment, unit)
            saved = public.get('co2Saved', {})
            first, last = (source_value(state, city, t, key, saved, public.get('gridSaved')) for t in (1, month))
            rd0, rd1 = state['rounds'][0], state['rounds'][month - 1]
            dates = [f'{rd["year"]}년 {rd["month"]}월' for rd in (rd0, rd1)]
            valid = values is not None and values['dates'] == dates and (not host or city_name + ':' in aria)
            if valid:
                # 혼자 하기·진행자는 전체 결과, 팀은 공개 결과 + 이 탭 수신 사본이 기준이다.
                # 팀에서도 둘 다 없는 달만 '자료 없음'이며 임의 보간하지 않는다.
                valid = all(near(values[end], raw, precision) if finite(raw) else values[end] is None
                            for end, raw in (('first', first), ('last', last)))
            checks.ok(valid and finite(last) and unit in article.locator('svg').text_content(),
                      f'{label} {city_name} {name} aria 첫 달·마지막 달·단위 = 공개값')
            if host:
                checks.ok(article.locator(f'[data-fx-series="{city}"]').count() == 1,
                          f'{label} {city_name} {name} 실제 궤적')
            else:
                rows[key] = values or {'first': None, 'last': None, 'neighbor': None}
        if not host:
            # fxEnd/html/monthPoints 결과를 기대값으로 사용하지 않는다.
            # 주민 이웃 평균은 도시별 pop/pop0×100의 산술평균(인구 합의 비율이 아님)이다.
            neighbor_values = [source_value(state, other, month, key, public.get('co2Saved'), public.get('gridSaved'))
                               for other in active if other != team]
            neighbor_values = [v for v in neighbor_values if finite(v)]
            average = sum(neighbor_values) / len(neighbor_values) if neighbor_values else None
            checks.ok(bool(neighbor_values) and near(rows[key]['neighbor'], average, precision),
                      f'{label} {name} 활성 이웃 {len(neighbor_values)}도시 산술평균 '
                      f'{average} = aria {rows[key]["neighbor"]}')
            checks.ok(article.locator(f'[data-fx-series="{team}"]').count() == 1 and
                      article.locator('[data-fx-series="neighbors"][stroke-dasharray]').count() == 1,
                      label + f' {name} 내 선·이웃 점선 존재')
        if key == 'grid':
            grid_points(checks, article, public, label, host)
        if key == 'co2':
            # W6: 혼자 하기는 L.S.results 전체의 12달이 모두 있어야 한다.
            # 팀은 공개 두 달 + sessionStorage 보충 뒤에도 빠진 달이 있으면 안내해야 한다.
            monthly = {city: [source_value(state, city, t, key, public.get('co2Saved'))
                              for t in range(1, month + 1)] for city in active}
            missing = any(not finite(v) for values in monthly.values() for v in values)
            if public['role'] in ('solo', 'host'):
                checks.ok(not missing and len(state.get('results', [])) == 12,
                          label + ' CO₂ 전체 결과 12달 모두 값 존재')
            notice = article.locator('.lg-fx-note').all_text_contents()
            checks.ok(any('공개 상태에는 최근 두 달의 CO₂만 있어 빈 달이 있어요' in n
                          for n in notice) == missing,
                      label + ' CO₂ 보충 후 빠진 달 유무와 안내 문구 일치')
            series = {state['econ']['cities'][city]['name']: monthly[city] for city in active} if host else {
                '내 도시': monthly[team],
                '이웃 평균': [None if not (values := [monthly[other][i] for other in active
                                if other != team and finite(monthly[other][i])]) else sum(values) / len(values)
                            for i in range(month)]}
            titles = article.locator('circle title').all_text_contents()
            expected_count = sum(finite(v) for values in series.values() for v in values)
            checks.ok(len(titles) == expected_count, label + ' CO₂ 12달 수신값 수와 실제 점 수 일치')
            for series_name, values in series.items():
                for t, raw in enumerate(values, 1):
                    rd = state['rounds'][t - 1]
                    prefix = f'{series_name} {rd["year"]}년 {rd["month"]}월 '
                    matches = [title for title in titles if title.startswith(prefix)]
                    checks.ok((len(matches) == 1 and near(number(matches[0], unit), raw, precision))
                              if finite(raw) else not matches,
                              f'{label} CO₂ {series_name} {t}달 실제 점 = 공개/탭 수신값')
    return rows


def grid_points(checks, article, public, label, host=False):
    """공개 필드/기기 기록의 독립 계산과 매달 점·선·마지막 표시를 대조한다."""
    state, team = public['V'], public.get('team')
    active = state.get('active') or list(state['teams'])
    month = state['round']
    monthly = {city: [source_value(state, city, t, 'grid', public.get('co2Saved'),
                                  public.get('gridSaved')) for t in range(1, month + 1)]
               for city in active}
    series = [(city, state['econ']['cities'][city]['name'], monthly[city]) for city in active] if host else [
        (team, '내 도시', monthly[team]),
        ('neighbors', '이웃 평균', [sum(values) / len(values) if (values := [monthly[other][i]
            for other in active if other != team and finite(monthly[other][i])]) else None
            for i in range(month)])]
    # 진행자는 도시별 선, 팀은 내 도시·값 있는 이웃의 평균선에서만 결측을 판정한다.
    missing = any(not finite(v) for _, _, values in series for v in values)
    notice = article.locator('[data-fx-gap="grid"]')
    checks.ok(notice.count() == int(missing) and (not missing or notice.is_visible()),
              label + ' 계통 그린 선에 결측이면 안내 한 줄, 선이 이어지면 안내 없음')
    if public['role'] in ('solo', 'host'):
        checks.ok(not missing and len(state.get('results', [])) == month,
                  label + ' 계통 전체 결과 12달 모두 값 존재')
    titles = article.locator('circle title').all_text_contents()
    checks.ok(len(titles) == sum(finite(v) for _, _, values in series for v in values),
              label + ' 계통 유효한 달 수와 실제 점 수 일치')
    displayed = article.locator('.lg-fx-values p').all_inner_texts()
    checks.ok(len(displayed) == len(series), label + ' 계통 도시별 마지막 값 표시 수')
    for index, (city, name, values) in enumerate(series):
        for t, raw in enumerate(values, 1):
            rd = state['rounds'][t - 1]
            prefix = f'{name} {rd["year"]}년 {rd["month"]}월 '
            matches = [title for title in titles if title.startswith(prefix)]
            checks.ok((len(matches) == 1 and near(number(matches[0], 'MWh/일'), raw))
                      if finite(raw) else not matches,
                      f'{label} 계통 {name} {t}달 실제 점 = 독립 계산값, 없으면 비움')
        # 각 유효 달은 L, 결측 직후 달은 M이어야 한다. 결측 달을 가로질러 잇지 않는다.
        path = article.locator(f'[data-fx-series="{city}"]')
        commands = re.findall(r'[ML]', path.get_attribute('d') or '') if path.count() == 1 else None
        expected = ['L' if i and finite(values[i - 1]) else 'M'
                    for i, value in enumerate(values) if finite(value)]
        checks.ok(commands == expected, f'{label} 계통 {name} 결측 달에서 선 끊기')
        last = next(((i, v) for i, v in reversed(list(enumerate(values))) if finite(v)), None)
        text = displayed[index] if index < len(displayed) else ''
        rd = state['rounds'][last[0]] if last else {}
        checks.ok((text.startswith(f'{name} {rd["year"]}년 {rd["month"]}월 ') and
                   near(number(text, 'MWh/일'), last[1])) if last else text == name + ' 자료 없음',
                  f'{label} 계통 {name} 마지막 값 표시 = 독립 계산값')


def grid_drawer(checks, page, last, label):
    detail = page.locator('#lg-last-month')
    if not detail.evaluate('el => el.open'):
        detail.locator(':scope > summary').click()
    row = page.locator('#lg-last-month [data-grid-fill]')
    value = row.locator(':scope > dd:not(.lg-result-note)')
    public = page.evaluate(PUBLIC_JS)
    state = public['V']
    raw = source_value(state, public['team'], state['round'], 'grid',
                       public.get('co2Saved'), public.get('gridSaved'))
    if finite(raw) and 0 <= raw < 0.05:
        checks.ok(row.count() == 0 and finite(last) and 0 <= last < 0.05,
                  label + ' 계통 0.05 MWh/일 미만은 서랍 줄 없음 + 그래프 값 < 0.05')
    else:
        checks.ok(finite(raw) and raw >= 0.05 and value.count() == 1 and
                  near(last, number(value.inner_text(), 'MWh/일'), 1, 1),
                  label + ' 계통 마지막 그래프 = 같은 달 결과 서랍 MWh/일')


# #56: '주민 마지막 aria = 도시 서랍 현재값'은 CI에서만 두 번(1280 dark-motion, 390 light-motion) 실패했고 CI 로그에는
# FAIL 줄만 남아 원인을 가를 수 없었다. 같은 L.snap 안에서는 서랍 주민(econ.cities[팀].pop)과 그래프 마지막 점
# (hist의 t = 11 pop)이 같은 값이다(econ.js 이동 뒤 hist.push, league-core econView가 둘을 같은 객체에서 복사).
# 그래서 실패하면 (가) 두 값이 다른 공개 상태에서 왔는지, (나) 서랍 글이 읽는 순간 다시 그려지던 중이었는지,
# (다) 글 해석 문제인지를 가를 값을 단언 이름 끝에 붙인다. 혼자 하기는 room 씨앗이라 판마다 다른 게임이므로 방 코드·씨앗도 남긴다.
# 통과할 때는 이름이 그대로라 기준·단언 수가 같다.
CITY_PROBE_JS = """() => {
  const L=KCP.league.state(), V=L?.snap, c=V?.econ?.cities?.[L?.team], h=c?.hist?.at(-1), p=document.querySelector('#lg-panel');
  return {room:L?.room ?? null, seed:L?.S?.seedKey ?? null, snap:V?`${V.phase}/${V.round} rev=${V.rev}`:null, sT:L?.S?.econ?.t ?? null, pop:c?.pop ?? null, pop0:c?.pop0 ?? null,
    approval:c?.approval ?? null, hist:h?`t=${h.t} pop=${h.pop} appr=${h.appr}`:null, histN:c?.hist?.length ?? null,
    tab:p?.dataset.tab ?? null, folded:p?.dataset.folded ?? null, busy:!!document.querySelector('#lg-month-progress')};
}"""


def city_mismatch(page, div, rows, key, text, pop0):
    """실패 때만 부른다. 읽은 순간의 상태와 두 프레임 + 300ms 뒤 다시 읽은 서랍 글·상태를 한 줄로 남긴다."""
    def probe():
        try:
            return page.evaluate(CITY_PROBE_JS)
        except Exception as exc:
            return f'읽기 실패 {type(exc).__name__}'
    first = probe()
    try:
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))")
        again = div.locator('dd').inner_text(timeout=2000)
    except Exception as exc:
        again = f'다시 읽기 실패 {type(exc).__name__}'
    return (f'aria {rows.get(key)} 서랍 {text!r} 공개 pop0 {pop0} 읽을 때 {first} '
            f'다시 읽은 서랍 {again!r} 그때 {probe()}')


def crosscheck(checks, page, rows, label):
    # 같은 끝 결과 서랍에 이미 있던 추이의 첫·마지막 title을 대조한다.
    public = page.evaluate(PUBLIC_JS)
    city = public['V'].get('econ', {}).get('cities', {}).get(public['team'], {})
    pop0 = city.get('pop0')

    def population_matches(value, displayed, digits):
        # 기존 추이·도시 KPI는 명수 그대로다. 시작 대비 %로 환산하고 표시 오차도 환산한다.
        return (finite(pop0) and pop0 > 0 and finite(displayed) and finite(value) and
                abs(value - (displayed / pop0 - 1) * 100) <=
                0.5 * 10 ** -METRICS['pop'][2] + 0.5 * 10 ** -digits / pop0 * 100 + 1e-7)

    for key in ('appr', 'pop', 'uns'):
        name, unit, precision = METRICS[key]
        for month, end in ((1, 'first'), (12, 'last')):
            title = page.locator(f'#lg-timeline [data-trend="{key}"] circle[data-month="{month}"] title')
            text = title.text_content() if title.count() == 1 else ''
            # 주민 원 추이의 단위는 '명', 새 그래프의 단위는 '%'다.
            displayed = number(text, '명' if key == 'pop' else unit)
            checks.ok(population_matches(rows.get(key, {}).get(end), displayed, 1) if key == 'pop' else
                      near(rows.get(key, {}).get(end), displayed, precision, 1),
                      label + f' {name} {month}월 aria = 같은 결과 서랍 기존 추이')
    detail = page.locator('#lg-last-month')
    if not detail.evaluate('el => el.open'):
        detail.locator(':scope > summary').click()
    # rev11 R5: 같은 개념은 CO₂ 접두 뒤 생산으로 통일한다.
    for key, heading, old_precision in (('uns', '정전(이번 달)', 2), ('co2', 'CO₂ 생산(이번 달)', 0)):
        div = page.locator('#lg-result-deltas > div').filter(
            has=page.get_by_text(heading, exact=True))
        dd_text = div.locator('dd').inner_text()
        if key == 'co2':
            # spec-C §M1: 모든 주제의 S6 생산 CO₂는 하루 평균 t/일, 월 합계는 보조다.
            daily = re.fullmatch(rf'({NUMBER})\s+t/일', dd_text)
            daily_value = number(dd_text, 't/일') if daily else None
            checks.ok(bool(daily) and near(rows[key]['last'], daily_value, METRICS[key][2], 1),
                      label + ' CO₂ 마지막 aria = 같은 화면 S6 하루 평균 t/일')
            total = re.search(r'이번 달 합\s*([\d,.\-−]+)\s*t', div.locator('small').inner_text())
            shown_value = number(total.group(0), 't') if total else None
        else:
            shown_value = number(dd_text, METRICS[key][1])
        if key == 'co2':
            days = public['V']['rounds'][public['V']['round'] - 1]['mdays']
            # 월 합계 표시의 반올림 오차도 일수로 나눈다. 그래프는 소수 1자리다.
            matches = (finite(shown_value) and finite(days) and days > 0 and
                       finite(rows[key]['last']) and abs(rows[key]['last'] - shown_value / days) <=
                       0.5 * 10 ** -METRICS[key][2] + 0.5 * 10 ** -old_precision / days + 1e-7)
        else:
            matches = near(rows[key]['last'], shown_value, METRICS[key][2], old_precision)
        checks.ok(matches,
                  label + f' {METRICS[key][0]} 마지막 aria = 같은 화면 월 결과값')
    grid_drawer(checks, page, rows['grid']['last'], label)
    open_panel(page, 'city')
    for key, heading in (('appr', '지지율'), ('pop', '주민')):
        div = page.locator('#lg-city > .lg-kpi > div').filter(has=page.get_by_text(heading, exact=True))
        # 도시 주민 KPI는 정수 명수로 표시하므로 반올림 0.5명도 같은 pop0로 환산한다.
        text = div.locator('dd').inner_text()
        shown_value = number(text, '명' if key == 'pop' else METRICS[key][1])
        matched = (population_matches(rows.get(key, {}).get('last'), shown_value, 0) if key == 'pop' else
                   near(rows.get(key, {}).get('last'), shown_value, METRICS[key][2], METRICS[key][2]))
        checks.ok(matched, label + f' {heading} 마지막 aria = 도시 서랍 현재값' +
                  ('' if matched else ': ' + city_mismatch(page, div, rows, key, text, pop0)))
    overflow(checks, page, label + ' 도시 교차 확인')
    open_panel(page, 'result')
    reset_scroll(page)


def host_mobile_strip(checks, page, label):
    """진행자 allCities 띠와 낭독용 문구가 문서 가로 폭으로 새지 않아야 한다."""
    data = page.evaluate("""() => {
      const root=document.documentElement;
      const strip=document.querySelector('#lg-host-rank .lg-fx-end .lg-fx-strip');
      if (!strip) return null;
      const previous=strip.scrollLeft, pageX=window.scrollX;
      const sample=()=>{
        const sr=[...strip.querySelectorAll('.lg-sr')].map(el=>{
          const r=el.getBoundingClientRect(); let left=r.left, right=r.right;
          // 내부 스크롤·클리핑 후 실제로 페이지에 드러날 수 있는 가로 범위.
          for (let n=el.parentElement;n && n!==root;n=n.parentElement) {
            if (['auto','scroll','hidden','clip'].includes(getComputedStyle(n).overflowX)) {
              const b=n.getBoundingClientRect();
              left=Math.max(left,b.left); right=Math.min(right,b.right);
            }
          }
          return {left,right,contained:right<=left || left>=0 && right<=root.clientWidth};
        });
        return {excess:root.scrollWidth-root.clientWidth, width:root.scrollWidth,
          x:window.scrollX, sr};
      };
      strip.scrollLeft=0; const first=sample();
      strip.scrollLeft=strip.scrollWidth; const last=sample(), moved=strip.scrollLeft;
      strip.scrollLeft=previous;
      return {first,last,pageX,moved,overflow:strip.scrollWidth>strip.clientWidth,
        inside:['auto','scroll'].includes(getComputedStyle(strip).overflowX),
        months:strip.querySelectorAll('[data-fx-month]').length};
    }""")
    if not checks.ok(data is not None, label + ' 진행자 #lg-host-rank 안 연대기 띠 존재'):
        return
    samples = (data['first'], data['last'])
    checks.ok(all(s['excess'] <= 0 for s in samples),
              f'{label} 390 진행자 documentElement.scrollWidth - clientWidth <= 0: {samples}')
    checks.ok(data['months'] == 12 and data['overflow'] and data['inside'] and data['moved'] > 0 and
              all(s['x'] == data['pageX'] for s in samples) and
              data['first']['width'] == data['last']['width'],
              f'{label} 390 진행자 12달 띠 내부에서만 가로 스크롤: {data}')
    checks.ok(all(len(s['sr']) == 12 and all(r['contained'] for r in s['sr']) and
                        s['excess'] <= 0 for s in samples),
              f'{label} 띠 처음·끝의 .lg-sr 12개가 페이지 폭을 넓히지 않음: {samples}')


def grid_host_team(checks, host, page, full, city, label):
    """진행자의 전체 결과를 기준으로 같은 달의 두 화면을 대조한다."""
    host_chart = host.locator('#lg-host-rank [data-fx-metric="grid"]')
    team_chart = page.locator('#lg-panel [data-fx-metric="grid"]')
    host_titles = host_chart.locator('circle title').all_text_contents()
    team_titles = team_chart.locator('circle title').all_text_contents()
    name = full['econ']['cities'][city]['name']
    for month in range(1, 13):
        raw = source_value(full, city, month, 'grid')
        rd = full['rounds'][month - 1]
        date = f'{rd["year"]}년 {rd["month"]}월 '
        h = [number(t, 'MWh/일') for t in host_titles if t.startswith(name + ' ' + date)]
        own = [number(t, 'MWh/일') for t in team_titles if t.startswith('내 도시 ' + date)]
        checks.ok(len(h) == len(own) == 1 and near(h[0], raw) and near(own[0], raw) and
                  near(h[0], own[0], 1, 1),
                  f'{label} 계통 {month}달 진행자 전체 결과 = 진행자 점 = 내 도시 점')
    checks.ok(team_chart.locator('[data-fx-gap="grid"]').count() == 0,
              label + ' 계통 12달 기록이 모두 있으면 누락 안내 없음')


def grid_missing(checks, page, label):
    """같은 방에서 축약된 중간 달의 기기·탭 기록만 지우고 UI로 다시 그린다."""
    month = 6  # 최근 두 달 밖이며 양옆 점이 있어 선 끊김까지 검증할 수 있다.
    public = page.evaluate(PUBLIC_JS)
    city = public['team']
    direct = source_value(public['V'], city, month, 'grid')
    cached = public.get('co2Saved', {}).get(city, {}).get(str(month), {})
    own = public.get('gridSaved', {}).get(city, {}).get(str(month), {}).get('grid')
    if not checks.ok(direct is None and finite(own) and finite(cached.get('grid')) and
                     finite(cached.get('days')) and cached['days'] > 0,
                     label + ' 계통 누락 검사 전 공개 중간 달 축약·기기/탭 기록 존재'):
        return
    backup = page.evaluate("""month => {
      const L=KCP.league.state(), key=`kcp-league-data-v1:${L.room}:${L.team}`;
      const sessionKey='kcp-fx-end-co2-v1:' + JSON.stringify([L.room,L.team]);
      const data=JSON.parse(localStorage.getItem(key)), saved=JSON.parse(sessionStorage.getItem(sessionKey));
      const own=data.interview.metrics[month].grid, cached=saved[month].grid;
      delete data.interview.metrics[month].grid;
      localStorage.setItem(key, JSON.stringify(data));
      return {key, sessionKey, month, own, cached};
    }""", month)

    def redraw():
        close_drawer(page)
        open_panel(page, 'result')
        return page.locator('#lg-panel [data-fx-metric="grid"]')

    try:
        article = redraw()
        fallback = page.evaluate(PUBLIC_JS)
        checks.ok(fallback.get('gridSaved', {}).get(city, {}).get(str(month), {}).get('grid') is None,
                  label + ' 계통 해당 달의 기기 기록 grid 삭제 확인')
        checks.ok(near(source_value(fallback['V'], city, month, 'grid', fallback['co2Saved'],
                                    fallback['gridSaved']), cached['grid'] / cached['days'], 7),
                  label + ' 계통 기기 기록을 지운 달은 탭 사본으로 보충')
        grid_points(checks, article, fallback, label + '-session-only')
        page.evaluate("""({sessionKey, month}) => {
          const saved=JSON.parse(sessionStorage.getItem(sessionKey));
          delete saved[month].grid;
          sessionStorage.setItem(sessionKey, JSON.stringify(saved));
        }""", backup)
        article = redraw()
        missing = page.evaluate(PUBLIC_JS)
        checks.ok(source_value(missing['V'], city, month, 'grid', missing['co2Saved'],
                               missing['gridSaved']) is None,
                  label + ' 계통 공개값·기기 기록·탭 사본 없는 달은 결측')
        grid_points(checks, article, missing, label + '-missing')
        rd = missing['V']['rounds'][month - 1]
        prefix = f'내 도시 {rd["year"]}년 {rd["month"]}월 '
        checks.ok(not any(t.startswith(prefix) for t in article.locator('circle title').all_text_contents()) and
                  article.locator('[data-fx-gap="grid"]').count() == 1 and
                  article.locator('[data-fx-gap="grid"]').is_visible(),
                  label + ' 계통 기록 지운 달의 점 없음·누락 안내 표시')
    finally:
        # 다른 달·CO₂·일지 기록은 건드리지 않고 지운 두 필드만 원래 값으로 돌린다.
        page.evaluate("""({key, sessionKey, month, own, cached}) => {
          const data=JSON.parse(localStorage.getItem(key)), saved=JSON.parse(sessionStorage.getItem(sessionKey));
          data.interview.metrics[month].grid=own; saved[month].grid=cached;
          localStorage.setItem(key, JSON.stringify(data));
          sessionStorage.setItem(sessionKey, JSON.stringify(saved));
        }""", backup)
        article = redraw()
    grid_points(checks, article, page.evaluate(PUBLIC_JS), label + '-restored')
    checks.ok(article.locator('[data-fx-gap="grid"]').count() == 0,
              label + ' 계통 기록 복원 후 누락 안내 없음')


def host_end(checks, context, base, pages, label, mobile=False):
    host, events = monitored_page(context)
    pages.append((host, events, label))
    host.goto(base + '#league')
    host.wait_for_function(BOOT_JS)
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="12"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    active = host.evaluate('() => KCP.league.state().S.active')
    teams = {}
    for city in active:
        page, events = monitored_page(context)
        pages.append((page, events, label + '-' + city))
        page.goto(base + '#league')
        select_mode(page, 'join')
        page.locator('#lg-code').fill(room)
        page.locator('#lg-join').click()
        confirm_seat(page, city)
        dismiss_guide(page)
        teams[city] = page
    host.wait_for_function("""ids => ids.every(id =>
      !!KCP.league.state().S.teams[id]?.token)""", arg=active)
    host.locator('#lg-next').click()
    for month in range(1, 13):
        for city, page in teams.items():
            page.wait_for_function("""month => { const V=KCP.league.state()?.snap;
              return V?.round===month && V.phase==='plan'; }""", arg=month)
            wait_unfolded(page)
            prepare(page)
        host.wait_for_function("""ids => { const S=KCP.league.state().S;
          return S.phase!=='plan' || ids.every(id=>S.teams[id].ready); }""", arg=active)
        # 모든 팀 준비 뒤 자동 운영된 경우에도 같은 달을 두 번 운영하지 않는다.
        if host.evaluate("() => KCP.league.state().S.phase") == 'plan':
            host.locator('#lg-next').click()
        host.wait_for_function("""month => { const S=KCP.league.state().S;
          return S.round===month && S.phase==='review'; }""", arg=month)
        for page in teams.values():
            page.wait_for_function("""month => { const V=KCP.league.state().snap;
              return V?.round===month && V.phase==='review'; }""", arg=month)
        overflow(checks, host, f'{label} {month}달 결과')
        host.locator('#lg-next').click()
    host.wait_for_function("() => KCP.league.state().S.phase==='end'")
    state = host.evaluate(PUBLIC_JS)['V']
    checks.ok(state['round'] == 12 and len(state['results']) == 12 and len(state['active']) == 2,
              label + ' 2팀 화면 조작으로 12달 완주')
    host.wait_for_selector('#lg-host-rank .lg-fx-end')
    # rev11 R5: co2Prod를 보여 주는 장부 열 머리의 명세 이름.
    checks.ok('CO₂ 생산(t/월)' in host.locator('#lg-host-summary-table thead th').all_inner_texts(), label + ' 진행자 장부 머리 CO₂ 생산(t/월)')
    checks.ok('목표·평가선 벗어남(위험)' in host.locator('.lg-ledger-note').inner_text(), label + ' 진행자 장부 각주 목표·평가선 벗어남(위험)')
    checks.test(label + ' 움직임·순위 막대 관측 실행', lambda: motion(checks, host, label, False) is None)
    graphs(checks, host, label, host=True)
    fifth_chart_layout(checks, host, label, '#lg-host-rank .lg-fx-charts')
    if mobile:
        host_mobile_strip(checks, host, label)
    overflow(checks, host, label + ' 끝')
    host.locator('#lg-host-rank .lg-fx-end').scroll_into_view_if_needed()
    screenshot(checks, host, f'fx-end-{label}.png')
    # 팀도 12달을 화면으로 수신했으므로 공개 두 달 + 탭 사본의 실제 점을 같은 기준으로 검산한다.
    for city, page in teams.items():
        page.wait_for_function("() => KCP.league.state().snap?.phase === 'end'")
        wait_unfolded(page)
        open_panel(page, 'result')
        page.wait_for_selector('#lg-panel .lg-fx-end')
        team_label = label + '-team-' + city
        rows = graphs(checks, page, team_label)
        fifth_chart_layout(checks, page, team_label, '#lg-panel .lg-fx-charts')
        grid_host_team(checks, host, page, state, city, team_label)
        grid_drawer(checks, page, rows['grid']['last'], team_label)
        grid_missing(checks, page, team_label)


class MotionBrowser:
    def __init__(self, browser, reduced):
        self.browser, self.reduced = browser, reduced

    def new_context(self, **options):
        return self.browser.new_context(reduced_motion='reduce' if self.reduced else 'no-preference', **options)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                cases = ((1280, 900, 'light', False), (1280, 900, 'dark', False),
                         (390, 844, 'light', False), (1280, 900, 'light', True))
                for width, height, scheme, reduced in cases:
                    label = f'solo-{width}x{height}-{scheme}-' + ('reduce' if reduced else 'motion')
                    context, external = context_for(MotionBrowser(browser, reduced), base, width, height, scheme)
                    context.add_init_script(PROBE_JS)
                    page, events = monitored_page(context)
                    try:
                        solo_end(checks, page, base, label)
                        checks.test(label + ' 움직임·순위 막대 관측 실행',
                                    lambda: motion(checks, page, label, reduced) is None)
                        layout(checks, page, label, width == 390)
                        screenshot(checks, page, f'fx-end-{label}.png')
                        rows = graphs(checks, page, label)
                        crosscheck(checks, page, rows, label)
                    except Exception as exc:
                        checks.ok(False, f'{label} 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                        screenshot(checks, page, f'fx-end-{label}-failure.png')
                    finally:
                        diagnostics(checks, events, label)
                        overflow(checks, page, label + ' 마지막')
                        checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                        context.close()
                for width, height in ((1280, 900), (390, 844)):
                    label = f'host-{width}x{height}-light-motion'
                    context, external = context_for(MotionBrowser(browser, False), base, width, height, 'light')
                    context.add_init_script(PROBE_JS)
                    pages = []
                    try:
                        host_end(checks, context, base, pages, label, mobile=width == 390)
                    except Exception as exc:
                        checks.ok(False, f'{label} 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
                        if pages:
                            screenshot(checks, pages[0][0], f'fx-end-{label}-failure.png')
                    finally:
                        for page, events, page_label in pages:
                            # monitored_page가 수집한 console error·warning 및 pageerror 모두 0.
                            diagnostics(checks, events, page_label)
                            overflow(checks, page, page_label + ' 마지막')
                        checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                        context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
