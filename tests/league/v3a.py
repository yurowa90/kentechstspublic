"""V3A-screen / V3A-fix3 S1·S2 수용 검사 (브라우저 실행은 외부 로컬 담당자).

실행: tests/.venv/bin/python tests/league/v3a.py http://127.0.0.1:9430/index.html
이 파일은 S1 후보·S2 말풍선, s8n.py는 미션 시점·띠·끝 화면·D-65를 담당한다.
기대값은 명세에서 정한다. 후보/말풍선/손실/판정 UI 함수는 호출하지 않는다.
S1 저장 fixture는 계획 시작 입력·설비·현금·지난달 S7 원기록을 바꾼다. 후보 결과는 넣지 않는다.
S2 거리는 Python BFS로 타일 이웃을 세며, 손실은 자료의 lossPerHex × 거리다.
"""

from collections import defaultdict, deque
import json
from math import isfinite
import re
import sys

from playwright.sync_api import expect, sync_playwright
from econui import (Checks, context_for, diagnostics, local_address, monitored_page,
                   open_panel, overflow, screenshot, shown)
from league_flow import select_mode, start_solo
from solo import close_drawer
from s8n import (NOTES, STATE, SYNC, next_phase, plan, ready, require,
                 private_keys, PUBLIC, restore_solo)

SAVE = 'kcp-league-solo-v1'
KEYS = ('evening', 'wind', 'grid', 'fuel', 'neighbor')
SHORT_NAMES = {'evening': '저녁 수요', 'wind': '풍속', 'grid': '접속 여유',
               'fuel': 'LNG 지수', 'neighbor': '이웃 정전'}


def mobile_header(checks, page, label):
    if page.viewport_size['width'] != 390:
        return
    close_drawer(page)
    geometry = page.locator('#lg-bar').evaluate("""bar => {
      const visible=e=>e.checkVisibility()&&e.getBoundingClientRect().width>0;
      // 품질8 UX U2(docs/QUALITY-ux.md 6절): #lg-ready는 막대 직계 자식이지만 행동 줄의 고정 칸(grid 2행)에 놓인다.
      // 상태 띠 한 줄 판정에서는 행동 줄 요소로 센다(요구 '여러 줄이 되지 않음'은 그대로, 총괄 승인).
      const items=[...bar.children].filter(e=>!e.matches('.lg-actions, #lg-ready')&&visible(e));
      const watch=bar.querySelector('#lg-watch'), actions=bar.querySelector('.lg-actions');
      const buttons=[...watch.querySelectorAll('button')].filter(visible);
      const px=x=>parseFloat(x)||0;
      // 한 줄 글자 높이 + 현재 CSS의 패딩/테두리/최소 높이에서 허용치를 구한다.
      const oneLine=e=>{const s=getComputedStyle(e);
        return Math.max(px(s.minHeight), (px(s.lineHeight)||px(s.fontSize)*1.2)+
          px(s.paddingTop)+px(s.paddingBottom)+px(s.borderTopWidth)+px(s.borderBottomWidth));};
      const budget=Math.max(...items.filter(e=>e!==watch).map(oneLine), ...buttons.map(oneLine));
      const boxes=items.map(e=>e.getBoundingClientRect()), s=getComputedStyle(bar);
      const rowHeight=Math.max(...boxes.map(r=>r.bottom))-Math.min(...boxes.map(r=>r.top));
      const chrome=px(s.paddingTop)+px(s.paddingBottom)+px(s.borderTopWidth)+px(s.borderBottomWidth);
      return {count:buttons.length,budget,rowHeight,watchHeight:watch.getBoundingClientRect().height,
        height:bar.getBoundingClientRect().height,
        totalBudget:budget+actions.getBoundingClientRect().height+px(s.rowGap)+chrome,
        nowrap:buttons.every(e=>getComputedStyle(e).whiteSpace==='nowrap')};
    }""")
    require(checks, geometry['count'] > 0, label + ' 390 머리 칩 실제 표시')
    # 한 줄 판정: 칩·행이 두 줄로 접히면 높이가 한 줄 예산의 약 2배가 된다. 테두리·초점 여백(실측 2px)은
    # 허용하고 nowrap 스타일 자체는 요구하지 않는다(요구는 '여러 줄이 되지 않음' — V3A-fix3 8항). 검토 반영.
    checks.ok(geometry['watchHeight'] <= geometry['budget'] * 1.5
              and geometry['rowHeight'] <= geometry['budget'] * 1.5
              and geometry['height'] <= geometry['totalBudget'] + 1,
              label + f' 390 상태 띠 한 줄+행동 버튼 한 줄 높이 {geometry}')


def start(page, base):
    page.goto(base + '#league')
    select_mode(page, 'solo')
    page.locator('[data-select="lg-solo-city"][data-value="pyeongtaek"]').click()
    page.locator('#lg-solo .lg-extra-settings > summary').click()
    page.locator('#lg-solo-seed').select_option('fixed')
    start_solo(page)
    page.wait_for_function(SYNC, arg=[1, 'plan'])
    page.evaluate('() => {KCP.league.state().S.rounds.length=3;}')
    if shown(page, '#lg-guide-close'):
        page.locator('#lg-guide-close').click()
    close_drawer(page)


def restore(page, saved, patch=None):
    saved = page.evaluate("""({saved,patch}) => {
      const d=JSON.parse(saved);
      if(patch) {
        const n=d.interview.interview.months['1'];
        if(patch.missing) delete n.s1EvidenceValues;
        else n.s1EvidenceValues=patch.values;
        n.s1EvidenceNeighborId=patch.neighbor;
        // S4 값을 그럴듯하게 남겨도 S1 이력이 없으면 대체해서는 안 된다.
        n.evidenceValues=patch.s4;
      }
      return JSON.stringify(d);
    }""", {'saved': saved, 'patch': patch})
    restore_solo(page, saved, 2, 'plan')


def s1(checks, page, label):
    require(checks, plan(page, 'empty'), label + ' S1 다음 달 관찰용 계획')
    ready(page)
    page.wait_for_function(SYNC, arg=[1, 'review'])
    next_phase(page, 2, 'plan')
    # 실제 규제 자료 id를 사용한다. 결과의 이웃 수치는 가상 입력이며,
    # 후보 선택의 정답은 이 값을 바꾸는 코드에서 계산하지 않는다.
    saved = page.evaluate("""() => {
      const d=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
      d.state.events=[{id:'finedust_coal_cap',round:2,x:1}];
      for(const [id,r] of Object.entries(d.state.results.at(-1).team))
        if(id!==d.team) r.unsPct=12.5;
      delete d.interview.interview.months['2'].s1EvidenceValues;
      delete d.interview.interview.months['2'].s1EvidenceNeighborId;
      return JSON.stringify(d);
    }""")
    restore(page, saved)
    open_panel(page, 'journal')
    chips = {key: page.locator(f'[data-evidence="{key}"]').inner_text() for key in KEYS}
    # 계획 시작 때 저장한 관측 입력을 그대로 기준으로 두고 한 항목만 변경.
    # S1에서 산출한 winner/score/text는 읽지 않는다.
    observed = page.evaluate(NOTES)['2']
    baseline = observed['s1EvidenceValues']
    neighbor = observed['s1EvidenceNeighborId']
    require(checks, all(isinstance(baseline.get(k), (int, float)) for k in KEYS)
            and bool(neighbor), label + ' S1 다섯 근거·이웃 id fixture 확보')
    saved = page.evaluate("() => localStorage.getItem('kcp-league-solo-v1')")

    focus = page.locator('#lg-evidence-focus')  # D-82-3: 카드 영역과 약속 단추의 공통 범위.
    group = focus.get_by_role('group', name='근거 후보', exact=True)  # D-82-3: 접근성 묶음으로 한정.
    cards = group.get_by_role('button', include_hidden=True)  # D-82-3: 접힌 세 번째 카드도 수·순서 검사.
    hud = page.locator('#lg-watch [data-evidence-focus="true"]')  # D-82-3: 선택 전후 같은 머리 배지.
    linked = {'weather': 'evening', 'progress': 'grid', 'choice': 'grid',  # D-82-3: 부록의 event 제외.
              'trade': 'neighbor', 'growth': 'fuel'}  # D-82-3: 규칙 2의 명세상 연결표.
    params = page.evaluate("""() => Object.fromEntries([
      'outageMinUnsPart', 'gridSameMwhPerDay', 'gridSameSharePerDay',
      'outageMinPartDivisor', 'outageMinGridPartPerDay'
    ].map(k=>[k,KCP.ECON_DATA.params[k].v]))""")  # 원 상수만 읽고 S7 판정 함수는 호출하지 않는다.
    wind_tile = page.evaluate("""() => KCP.buildGame.TILES.find(t=>
      !t.out && t.site<0 && t.land && !KCP.buildGame.siteRule('wind',t))?.i""")
    require(checks, isinstance(wind_tile, int), label + ' S1 풍력 fixture 합법적 설비 칸')
    city_pack = 'pyeongtaek'  # start()에서 고정한 도시의 지도 id(league-data 원자료).
    original_saved = saved

    def fixture(*, wind=False, memo=False, cash=100, s7=None, current=None):
        data = json.loads(original_saved)
        months = data['interview']['interview']['months']
        old, now = months['1'], months['2']
        for key in ('outageFrozen', 'outageLargest', 'outageNoCause',
                    'outageSingleShown', 'missedCarry'):
            old.pop(key, None)
        old.update(s7 if s7 is not None else {'outageNoCause': True})
        if memo is None:
            now.pop('s1HasWind', None)
        else:
            now['s1HasWind'] = memo
        if current is not None:
            now['s1EvidenceValues'] = current
        builds = [{'t': 'wind', 'i': wind_tile}] if wind else []
        data['state']['teams'][data['team']]['plan']['builds'] = builds
        # 재개 화면은 공개 계획보다 이 기기의 지도 문서를 먼저 읽는다.
        doc = data['interview']['docs'].get(city_pack)
        if doc and city_pack in doc.get('maps', {}):
            doc['maps'][city_pack]['builds'] = builds
        data['state']['econ']['cities'][data['team']]['cash'] = cash
        return json.dumps(data)

    saved = fixture()  # 기존 case도 우연한 S7·현금·풍력 상태에 의존하지 않는다.
    wind_saved = fixture(wind=True, memo=True)

    def card(key):  # D-82-3: 첫 b나 영역 전체 버튼 대신 이름이 같은 카드 하나.
        found = cards.filter(has_text=SHORT_NAMES[key])  # D-82-3: 약속 단추는 묶음 밖이므로 제외.
        expect(found).to_have_count(1)  # D-82-3: 중복 후보를 첫 항목 선택으로 숨기지 않음.
        return found  # D-82-3: 숨겨진 마지막 카드에도 같은 조회 적용.

    def case(values, neighbor_id=neighbor, missing=False, source=saved,
             name='', wanted=None):  # 사건 없는 달도 같은 검사. wanted는 손으로 계산한 별도 대조값.
        restore(page, source, {'values': values, 'neighbor': neighbor_id,  # D-82-3: 원자료 fixture만 변경.
                              'missing': missing, 's4': {k: 99999 for k in KEYS}})  # D-82-3: S4 대체 방지 유지.
        open_panel(page, 'deal')
        checks.ok(page.locator('[data-resp]').count() == 0,
                  label + ' S1 우리 도시에 대응 선택 없음')  # D-82-3: 무사건·규제 달 공통 조건.
        expect(group).to_be_visible()  # D-82-3: role=group·접근성 이름까지 요구.
        require(checks, cards.count() in (2, 3), label + ' S1 근거 카드 2~3개')  # D-82-3: 단일 후보 금지.
        inputs = page.evaluate("""() => ({
          saved:JSON.parse(localStorage.getItem('kcp-league-solo-v1')),
          plan:KCP.buildGame.current()
        })""")
        data = inputs['saved']
        months = data['interview']['interview']['months']
        old_note, now = months['1'], months['2']
        current = now['s1EvidenceValues']
        previous = old_note.get('s1EvidenceValues') or {}
        memo = now.get('s1HasWind')
        has_wind = memo if isinstance(memo, bool) else any(
            b['t'] in ('wind', 'offshore') for b in inputs['plan']['builds'])
        numeric = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and isfinite(x)
        available = [k for k in KEYS if numeric(current.get(k)) and (k != 'wind' or has_wind)]
        comparable = [k for k in available if numeric(previous.get(k)) and
                      (k != 'neighbor' or now.get('s1EvidenceNeighborId') and
                       now['s1EvidenceNeighborId'] == old_note.get('s1EvidenceNeighborId'))]
        sizes, visible = {}, {}
        for key in comparable:
            before, delta = previous[key], current[key] - previous[key]
            sizes[key] = abs(delta / before) if before else float('inf') if delta else 0
            shown_delta = delta if key == 'neighbor' else delta / abs(before) * 100 if before else current[key]
            visible[key] = round(shown_delta, 2) != 0
        ranked = sorted(comparable, key=lambda k: sizes[k], reverse=True)  # 동률은 KEYS 순서.

        frozen, carry = old_note.get('outageFrozen'), old_note.get('missedCarry') or {}

        def minimum(record, card=False):
            record = record or {}
            base = record.get('trial')
            if base is None:
                base = record.get('base')
            floor = params['outageMinUnsPart']
            if record.get('target') == 'grid':
                same = max(params['gridSameMwhPerDay'],
                           params['gridSameSharePerDay'] * abs(base) if numeric(base) else 0)
                floor = max(same / params['outageMinPartDivisor'], params['outageMinGridPartPerDay'])
            if card:
                total = record.get('total')
                actual = record.get('actual')
                if not numeric(total) and numeric(base) and numeric(actual):
                    total = actual - base
                if numeric(total):
                    floor = max(floor, .05 * abs(total))
            return floor

        largest = old_note.get('outageLargest') or carry.get('largest') or {}
        no_cause = (old_note.get('outageNoCause') or
                    frozen is not None and all(abs(p['value']) < minimum(frozen, card=True)
                                               for p in frozen.get('parts', [])) or
                    old_note.get('outageSingleShown') and largest and
                    abs(largest['value']) < minimum(frozen or carry, card=True))
        if frozen is not None:
            s7_cards = sorted((p for p in frozen.get('parts', [])
                               if abs(p['value']) >= minimum(frozen, card=True)),
                              key=lambda p: abs(p['value']), reverse=True)[:3]
            growth = any(p['key'] == 'growth' for p in s7_cards)
        else:
            growth = (carry.get('largest', {}).get('key') == 'growth' and
                      abs(carry['largest']['value']) >= minimum(carry))
        fuel_allowed = growth or data['state']['econ']['cities'][data['team']]['cash'] < 0

        # 계약 1~4의 우선순위를 만든 뒤, 5의 보충과 마지막 화면 순서를 별도로 검산한다.
        priority = ranked[:1] + [None if no_cause else linked.get(largest.get('key')),
                                 'wind', 'fuel' if fuel_allowed else None]
        picked = []
        for key in priority:
            if key in available and key not in picked and len(picked) < 3:
                picked.append(key)
        remaining = [k for k in ranked + [k for k in available if k not in comparable]
                     if k not in picked and (k != 'fuel' or fuel_allowed)]
        for key in remaining:  # N6: 지난달 값이 없는 근거는 채움에서 뺀다.
            if len(picked) < 3 and key in comparable and visible.get(key, True):
                picked.append(key)
        for key in remaining:  # 표시상 변화 0 → 지난달 값 없음 순서로, 필요한 경우에만 2장까지 보충.
            if len(picked) < 2 and key not in picked:
                picked.append(key)
        expected = [k for k in KEYS if k in picked]
        if wanted is not None:
            require(checks, expected == list(wanted), label + ' S1 손계산 기대값 ' + name)
        actual = [next((k for k in KEYS if SHORT_NAMES[k] in (cards.nth(i).text_content() or '')), None)  # D-82-3: DOM 이름 관찰.
                  for i in range(cards.count())]  # D-82-3: 접힌 카드도 포함한 실제 순서.
        checks.ok(actual == expected,  # 포함 여부만으로 변화율 검사를 완화하지 않음.
                  label + f' S1 규칙 1~6 후보·중복 없음·고정 순서 {name}: {actual} == {expected}')
        checks.ok(all(cards.nth(i).get_attribute('aria-pressed') == 'false' for i in range(cards.count())),  # D-82-3: 전부 미선택.
                  label + ' S1 처음에는 고른 카드 없음')  # D-82-3: 자동 정답 선택 금지.
        expect(focus.get_by_role('button', name='근거를 하나 고르면 약속으로 이어져요', exact=True)).to_be_disabled()  # D-82-3: 약속 구별.
        expect(hud).to_have_count(1)  # D-82-3: 머리 배지 하나 유지.
        expect(hud).to_have_text('근거 고르기')  # D-82-3: 고르기 전 짧은 근거 이름 표시 금지.
        overflow(checks, page, label + ' S1 사건 서랍')

    def choose(key):  # D-82-3: 카드 선택부터 같은 약속 근거까지 공통 사용자 흐름.
        chosen = card(key)  # D-82-3: 묶음 안의 유일한 해당 카드.
        full_name, value = chosen.locator('strong').text_content().rsplit(' · ', 1)  # D-82-3: 카드의 전체 이름·값·단위.
        expected_title = f'{full_name}: {value}'  # D-82-3: 첫 b 대신 선택 카드 전체 설명과 배지 title 대조.
        if not chosen.is_visible():  # D-82-3: 좁은 화면의 마지막 후보도 실제 조작으로 선택.
            chosen.locator('xpath=ancestor::details[1]').locator('summary').click()  # D-82-3: 강제 클릭 없이 펼침.
        chosen.click()  # D-82-3: 약속 단추와 구별한 카드 클릭.
        expect(chosen).to_have_attribute('aria-pressed', 'true')  # D-82-3: 클릭한 카드 선택.
        expect(group.locator('button[aria-pressed="true"]')).to_have_count(1)  # D-82-3: 그 카드만 선택.
        checks.ok(all(cards.nth(i).get_attribute('aria-pressed') in ('true', 'false') for i in range(cards.count())),  # D-82-3: 속성 누락 금지.
                  label + ' S1 모든 카드 선택 상태 명시 ' + key)  # D-82-3: 나머지는 false여야 함.
        checks.ok(hud.inner_text() == SHORT_NAMES[key] and hud.get_attribute('title') == expected_title,  # D-82-3: 짧은 이름·전체 설명.
                  label + ' S1 선택한 카드의 짧은 배지 이름·title 전체 설명 일치 ' + key)  # D-82-3: 예전 title 대조 유지.
        mobile_header(checks, page, label + '-' + key)  # D-82-3: 선택 뒤 좁은 머리 막대 검사 유지.
        open_panel(page, 'deal')  # D-82-3: 머리 막대 검사가 닫은 카드 서랍을 다시 엶.
        short_name = SHORT_NAMES[key]  # D-82-3: 이웃 도시 이름·풍속 부연 없는 약속 이름.
        jong = (ord(short_name[-1]) - 0xac00) % 28  # D-82-3: 제품 함수를 부르지 않고 조사 검산.
        promise_name = short_name + ('로' if jong in (0, 8) else '으로') + ' 약속하기'  # D-82-3: 부록의 받침 규칙.
        promise = focus.get_by_role('button', name=promise_name, exact=True)  # D-82-3: 카드와 구별한 정확한 약속 단추.
        expect(promise).to_be_enabled()  # D-82-3: 선택 후에만 활성.
        require(checks, not page.evaluate(NOTES)['2'].get('evidence'), label + ' S1 약속 근거 미선택 fixture')  # D-82-3: 자동 선택 조건.
        promise.click()  # D-82-3: 영역 전체의 role=button 클릭 제거.
        expect(page.locator('#lg-panel')).to_have_attribute('data-tab', 'journal')  # D-82-3: 일지로 연결.
        chip = page.locator(f'#lg-evidence [data-evidence="{key}"]')  # D-82-3: 같은 근거의 일지 칩 하나.
        expect(chip).to_be_visible()  # D-82-3: 기존 도착 단언 유지.
        expect(chip).to_be_focused()  # D-82-3: 같은 근거로 초점 이동.
        expect(chip).to_have_attribute('aria-pressed', 'true')  # D-82-3: 비어 있던 약속 근거를 미리 선택.
        expect(chip).to_have_attribute('aria-label', re.compile(r' · S1에서 고름$'))  # D-82-3: 부록의 접근성 표지.
        note = page.evaluate(NOTES)['2']  # D-82-3: 기기 안 실제 저장값 확인.
        checks.ok(note.get('s1Pick') == key and note.get('evidence', {}).get('key') == key,  # D-82-3: 같은 키로 저장.
                  label + ' S1 카드 선택·약속 근거 저장 일치 ' + key)  # D-82-3: DOM 이동만으로 통과 금지.

    for key in KEYS:
        previous = dict(baseline)
        previous[key] = baseline[key] / 2 if baseline[key] else 10
        case(previous, source=wind_saved if key == 'wind' else saved)
        text = card(key).text_content()  # D-82-3: 변화 근거 카드 하나의 이름·값·차이만 검사.
        name = SHORT_NAMES[key] if key == 'wind' else chips[key].split(':', 1)[0]  # D-82-3: 풍속은 짧은 카드 이름.
        checks.ok(name in text and '이번 달 볼 것' in focus.inner_text(),  # D-82-3: 약속 칩과 같은 근거 이름 유지.
                  label + ' 유일하게 변한 근거가 후보·약속 칩과 같은 이름 ' + key)  # D-82-3: 단일 후보를 해당 카드로 치환.
        if key == 'neighbor':
            difference = baseline[key] - previous[key]
            match = re.search(r'([+−-]?[\d,.]+)\s*%p', card(key).locator('.lg-s1-tag').text_content())  # D-82-3: 닫힌 details 안 카드도 숫자·단위를 읽음.
            checks.ok(bool(match) and abs(float(match[1].replace(',', '').replace('−', '-')) - difference) <= .011,
                      label + ' 같은 이웃 정전은 독립 차이값 %p [A6]')
        choose(key)  # D-82-3: 미선택 → 카드 선택 → 활성 약속 → 같은 일지 칩.

    # D-82-3: 가장 큰 변화는 규칙 1 카드로 포함되며, 학생 선택과 구별한다.
    # D-82-3: 단일 변화의 원래 검산을 유지하고, 두 변화는 규칙 1 꼬리표까지 확인한다.
    previous = dict(baseline)
    previous['fuel'] = baseline['fuel'] / 10
    previous['wind'] = baseline['wind'] / 1.01
    case(previous)
    change = round((baseline['fuel'] - previous['fuel']) / abs(previous['fuel']) * 100, 2)  # D-82-3: 원자료로 변화율 독립 계산(+900%).
    sign = '+' if change > 0 else '−' if change < 0 else ''  # D-82-3: 증가 +·감소 유니코드 − 규칙.
    expect(card('fuel').locator('.lg-s1-tag')).to_have_text(f'지난달보다 {sign}{abs(change):g}%')  # D-82-3: 부호·수치까지 규칙 1 대조.

    previous = dict(baseline)
    previous['neighbor'] = 0
    previous['fuel'] = baseline['fuel'] / 2
    different = next(k for k in page.evaluate(STATE)['teams'] if k != neighbor)
    case(previous, neighbor_id=different)
    change = round((baseline['fuel'] - previous['fuel']) / abs(previous['fuel']) * 100, 2)  # D-82-3: 원자료로 변화율 독립 계산(+100%).
    sign = '+' if change > 0 else '−' if change < 0 else ''  # D-82-3: 증가 +·감소 유니코드 − 규칙.
    expect(card('fuel').locator('.lg-s1-tag')).to_have_text(f'지난달보다 {sign}{abs(change):g}%')  # D-82-3: 다른 이웃 비교 제외·부호 검산 [A6].
    case(dict(baseline))
    expect(card('evening').locator('.lg-s1-tag')).to_have_text('지난달과 같음')  # D-82-3: 동률 첫 카드의 꼬리표로 확인 [A6].
    case(dict(baseline), missing=True)
    checks.ok(all('지난달 값 없음' in (cards.nth(i).text_content() or '') for i in range(cards.count())),  # D-82-3: 예보·보충 카드 유지.
              label + ' 계획 시작 이력 없음 → 비교값 없음, S4로 대체 안 함 [A6]')  # D-82-3: 가짜 S4 이력을 쓰면 실패.

    # 아래 값은 관측 원자료 fixture다. 기대 후보는 손계산 목록과도 정확히 대조한다.
    fixed = {'evening': 100, 'wind': 5, 'grid': 20, 'fuel': 100, 'neighbor': 12.5}
    source = fixture(current=fixed)
    case({**fixed, 'evening': 50, 'wind': 0, 'grid': 10, 'neighbor': 6.25},
         source=source, name='풍력 없음·풍속 0 출발 제외', wanted=('evening', 'grid', 'neighbor'))
    # 전부 같은 값: 규칙 1은 evening, 풍력이 있으면 규칙 3의 wind로 2장.
    for name, wind, memo, wanted in (
            ('풍력 계획·시작 메모 true', True, True, ('evening', 'wind')),
            ('풍력 계획·옛 메모 없음', True, None, ('evening', 'wind')),
            ('풍력 계획보다 시작 메모 false 우선', True, False, ('evening', 'grid')),
            ('지금 풍력 없어도 시작 메모 true 우선', False, True, ('evening', 'wind'))):
        case(fixed, source=fixture(current=fixed, wind=wind, memo=memo), name=name, wanted=wanted)
        builds = page.evaluate('() => KCP.buildGame.current().builds')
        require(checks, any(b['t'] in ('wind', 'offshore') for b in builds) == wind and
                page.evaluate(NOTES)['2'].get('s1HasWind') is memo,
                label + ' S1 풍력 계획·시작 메모 전제 ' + name)
        if 'wind' in wanted:
            expect(card('wind').locator('.lg-s1-tag')).to_have_text('계절 대표값')
        else:
            expect(cards.filter(has_text=SHORT_NAMES['wind'])).to_have_count(0)
    case(fixed, source=fixture(current=fixed, cash=-1), name='음수 현금', wanted=('evening', 'fuel'))
    choose('fuel')  # 음수 현금 입력에서도 기존 약속·배지·aria 흐름을 유지한다.
    case({**fixed, 'evening': 50, 'neighbor': 6.25}, source=source,
         name='변화 0 건너뛰어 2장 유지', wanted=('evening', 'neighbor'))
    # grid +0.004%, neighbor +0.0001%p는 모두 표시상 0. 규칙 1의 evening만
    # 남으므로 변화율이 더 큰 grid를 되넣어 정확히 2장(세 번째 neighbor는 제외).
    case({**fixed, 'evening': 50, 'grid': 20 / 1.00004, 'neighbor': 12.4999}, source=source,
         name='반올림 변화 0 중 큰 순서로 2장 보충', wanted=('evening', 'grid'))

    # 정전율 대상의 minPart는 원 상수 outageMinUnsPart(현재 .05).
    # Δ=10이면 cardMin=.5: growth 1은 후보, .49는 제외. 네 번째 몫도 제외한다.
    for name, parts, total, wanted in (
            ('S7 고정본 growth 세 후보 안', [('event', 6), ('trade', 3), ('growth', 1)], 10,
             ('evening', 'fuel')),
            ('S7 고정본 growth 네 번째', [('event', 6), ('weather', 3), ('trade', 2), ('growth', 1)], 12,
             ('evening', 'grid')),
            ('S7 고정본 growth cardMin 미만', [('event', 9.51), ('growth', .49)], 10,
             ('evening', 'grid'))):
        record = {'outageLargest': {'key': 'event', 'value': parts[0][1]},
                  'outageFrozen': {'target': 'uns', 'total': total,
                                   'parts': [{'key': k, 'value': v} for k, v in parts]}}
        case(fixed, source=fixture(current=fixed, s7=record), name=name, wanted=wanted)
    for value, wanted in ((.05, ('evening', 'fuel')), (.049, ('evening', 'grid'))):
        largest = {'key': 'growth', 'value': value}
        record = {'outageSingleShown': True, 'outageLargest': largest,
                  'missedCarry': {'target': 'uns', 'largest': largest}}
        case(fixed, source=fixture(current=fixed, s7=record),
             name=f'S7 축약 growth minPart 경계 {value}', wanted=wanted)
    # 규칙 2의 LNG는 규칙 4 문턱으로 막지 않고, 명시적 원인 없음은 연결을 막는다.
    for name, record, wanted in (
            ('S7 trade 연결', {'outageLargest': {'key': 'trade', 'value': 1}}, ('evening', 'neighbor')),
            ('S7 growth 연결은 작은 몫도 유지', {'outageLargest': {'key': 'growth', 'value': .01}},
             ('evening', 'fuel')),
            ('S7 원인 없음은 옛 growth 연결 제외',
             {'outageNoCause': True, 'outageLargest': {'key': 'growth', 'value': 1}}, ('evening', 'grid'))):
        case(fixed, source=fixture(current=fixed, s7=record), name=name, wanted=wanted)

    no_events = page.evaluate("saved => {const d=JSON.parse(saved);d.state.events=d.state.events.filter(e=>e.round!==2);return JSON.stringify(d);}", wind_saved)  # 사건 0개·풍력 있음 fixture.
    case(dict(baseline), source=no_events)  # D-82-3: 무사건 달도 후보 수·순서·미선택·배지·disabled 동일 검사.
    require(checks, not [e for e in page.evaluate(STATE)['events'] if e['round'] == 2], label + ' S1 사건 0개 확인')  # D-82-3: 전제 검증.
    checks.ok('이번 달 조건 · ' not in focus.inner_text(), label + ' S1 사건 없는 달 조건 요약 없음')  # D-82-3: 규제와 구별.
    choose('wind')  # D-82-3: 무사건 달에도 실제 카드 선택부터 약속 연결까지 확인.

    previous = dict(baseline)
    previous['evening'] = baseline['evening'] / 2
    case(previous)
    original_text = cards.all_text_contents()  # D-82-3: 첫 b 대신 카드 전체의 이름·값·비교·꼬리표·순서.
    original_notes = {m: page.evaluate(NOTES)[m]['s1EvidenceValues'] for m in ('1', '2')}
    for change in ('policy', 'fab2'):
        before_plan = page.evaluate('() => KCP.buildGame.current()')
        require(checks, page.evaluate("""kind => KCP.league.plan(st=>{
          if(kind==='policy') st.policies=st.policies.includes('dr') ? [] : ['dr'];
          else st.fab2=!st.fab2;
        })""", change), label + ' S1 ' + change + ' 실제 수정')
        after_plan = page.evaluate('() => KCP.buildGame.current()')
        field = 'policies' if change == 'policy' else 'fab2'
        require(checks, before_plan[field] != after_plan[field], label + ' S1 ' + field + ' 변경 확인')
        close_drawer(page)
        open_panel(page, 'deal')
        checks.ok(cards.all_text_contents() == original_text,  # D-82-3: 접힌 카드까지 전체 내용 불변.
                  label + ' S1 ' + change + ' 변경 뒤 후보 이름·값·차이 불변')  # D-82-3: 기존 계획 시작 값 보호 유지.
        checks.ok({m: page.evaluate(NOTES)[m]['s1EvidenceValues'] for m in ('1', '2')} == original_notes,
                  label + ' S1 양쪽 달 계획 시작 입력 불변 ' + change)

    # 규제만 있는 달의 반대 사례: 지역 전체에 대응 선택이 있는 실제 사건.
    responsive = page.evaluate("""saved => {
      const d=JSON.parse(saved);
      d.state.events=[{id:'planned_maintenance',round:2,x:1}];
      return JSON.stringify(d);
    }""", saved)
    restore(page, responsive, {'values': previous, 'neighbor': neighbor,
                              's4': {k: 99999 for k in KEYS}})
    open_panel(page, 'deal')
    require(checks, page.locator('[data-resp]').count() > 0, label + ' S1 대응 선택 있는 사건 fixture')
    checks.ok(page.locator('#lg-evidence-focus').count() == 0
              and page.locator('#lg-watch [data-evidence-focus="true"]').count() == 0,
              label + ' S1 대응 사건이면 근거 후보·머리 후보 칩 없음')
    checks.ok(not private_keys(page.evaluate(PUBLIC)), label + ' S1 사적 비교 입력 공개 상태에 없음 [D-65]')
    screenshot(checks, page, 'v3a-' + label + '-s1.png')

    from econui import setup_pair  # D-82-3: S1 내부에서만 기존 진행자·팀 fixture 재사용.
    host_pages = []  # D-82-3: 추가한 페이지의 진단·정리 범위.
    try:  # D-82-3: 진행자 제외 조건도 실제 역할 화면에서 확인.
        host, _, _ = setup_pair(page.context, page.url.split('#', 1)[0], 12, host_pages)  # D-82-3: 기존 로컬 방 생성 경로.
        require(checks, host.evaluate('() => KCP.league.state().role') == 'host', label + ' S1 진행자 fixture')  # D-82-3: 역할 전제.
        for month, phase in ((1, 'plan'), (1, 'review'), (2, 'plan')):  # D-82-3: 첫 달 대응 사건 유무와 무관한 다음 달까지.
            next_phase(host, month, phase)  # D-82-3: 기존 진행자 달 진행 조작.
        expect(host.locator('.lg-phase-chip')).to_have_text('계획·협상')  # D-82-3: 계획 화면 렌더 뒤 부재 검사.
        checks.ok(host.locator('#lg-evidence-focus').count() == 0  # D-82-3: 진행자에게 학생 근거 카드 없음.
                  and host.locator('#lg-watch [data-evidence-focus="true"]').count() == 0,  # D-82-3: 근거 배지도 없음.
                  label + ' S1 진행자에게 근거 카드·머리 근거 배지 없음')  # D-82-3: 대응 사건 달 제외 단언은 위에 유지.
    finally:  # D-82-3: 실패해도 추가 페이지를 남기지 않음.
        for host_page, events, role in host_pages:  # D-82-3: 진행자·팀 둘 다 기존 진단 적용.
            diagnostics(checks, events, label + '-S1-' + role)  # D-82-3: 추가 페이지 오류도 누락하지 않음.
            host_page.close()  # D-82-3: 원래 시나리오 페이지·컨텍스트는 보존.


def demand_distances(tiles, towns):
    """헥스 이웃 그래프의 다중 시작점 BFS. UI 거리/경로 함수를 사용하지 않는다."""
    distance = {town['tile']: 0 for town in towns if town.get('dem')}
    queue = deque(distance)
    while queue:
        tile = queue.popleft()
        for neighbor in tiles[tile]['nb']:
            if neighbor not in distance:
                distance[neighbor] = distance[tile] + 1
                queue.append(neighbor)
    return distance


def tool(page, name):
    close_drawer(page)
    # 자료의 그룹 버튼을 순회하여 해당 도구를 사용자 조작으로 찾는다.
    if not shown(page, f'[data-tool="{name}"]'):
        groups = page.locator('[data-group]').evaluate_all('nodes => nodes.map(n=>n.dataset.group)')
        for group in groups:
            page.locator(f'[data-group="{group}"]').click()
            if shown(page, f'[data-tool="{name}"]'):
                break
    page.locator(f'[data-tool="{name}"]').click()


def hover(page, tile):
    xy = page.evaluate('([c,r]) => KCP.buildGame.tileXY(c,r)', [tile['c'], tile['r']])
    page.mouse.move(1, 1)
    page.mouse.move(*xy)
    expect(page.locator('#bd-tip')).to_be_visible()
    return page.locator('#bd-tip').inner_text()


def complaint_expectations(page, kind, ids):
    # 말풍선/placementAdvice는 호출하지 않는다. 공개 민원 API의 원자료를
    # 가져와 합산 5점 문턱과 수용자 중복 제거를 Python에서 계산한다.
    raw = page.evaluate("""({kind,ids}) => {
      const b=KCP.buildGame, st=b.current(), before=b.complaints(st,null);
      return ids.filter(i=>!b.siteRule(kind,b.TILES[i])).map(i=>({
        i,index:st.builds.length,before:before.issues,
        after:b.complaints({...st,builds:[...st.builds,{t:kind,i}]},null)
      }));
    }""", {'kind': kind, 'ids': ids})
    expected = []
    for sample in raw:
        totals = defaultdict(float)
        contributed = set()
        for item in sample['after']['items']:
            if item['kind'] == 'green':
                continue
            key = (item['ti'], item['kind'])
            totals[key] += item['pts']
            if item['bi'] == sample['index'] and item['pts'] > 0:
                contributed.add(key)
        affected = {ti for ti, kind in contributed if totals[ti, kind] >= 5}
        expected.append({'i': sample['i'], 'issues': sample['after']['issues'] - sample['before'],
                         'affected': len(affected), 'raw': len({ti for ti, _ in contributed})})
    return expected


def s2(checks, page, label, smart=False):
    if smart:
        # tech.py/tech.js의 채택 상태 계약. 기술 효과 계산은 호출하지 않는다.
        require(checks, plan(page, 'lines'), label + ' 스마트 송전 fixture 저장')
        saved = page.evaluate("""() => {
          const d=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
          d.state.teams[d.team].research.adopted.push('grid');
          return JSON.stringify(d);
        }""")
        restore_solo(page, saved, 1, 'plan')
        require(checks, 'grid' in page.evaluate(STATE)['teams']['pyeongtaek']['research']['adopted'],
                label + ' 스마트 송전 채택 상태 확인')
    close_drawer(page)
    data = page.evaluate("""() => {
      const b=KCP.buildGame;
      return {tiles:b.TILES,towns:b.TOWNS,loss:b.PACKS.pyeongtaek.lossPerHex,
        used:b.current().builds.map(x=>x.i)};
    }""")
    distances = demand_distances(data['tiles'], data['towns'])
    tool(page, 'solar')
    visible = page.evaluate("""() => KCP.buildGame.TILES.map(t=>{
      const p=KCP.buildGame.tileXY(t.c,t.r);
      const el=p&&document.elementFromPoint(p[0],p[1]);
      return {i:t.i,canvas:el?.tagName==='CANVAS'};
    })""")
    visible = {x['i'] for x in visible if x['canvas']}
    candidates = [t for t in data['tiles'] if t['i'] in visible and t['i'] not in data['used']
                  and not t['out'] and t['site'] < 0 and t['land']
                  and t['i'] in distances]
    # 허용 부지는 공개 siteRule로 확인하되 거리/손실 기대값에는 사용하지 않는다.
    legal = page.evaluate("""ids => ids.filter(i=>!KCP.buildGame.siteRule('solar',KCP.buildGame.TILES[i]))""",
                          [t['i'] for t in candidates])
    candidates = [t for t in candidates if t['i'] in legal]
    require(checks, len({distances[t['i']] for t in candidates}) >= 2,
            label + ' S2 화면에서 거리가 다른 태양광 합법 칸 2개 이상')
    candidates.sort(key=lambda t: distances[t['i']])
    sampled = [candidates[0], candidates[-1]]
    displayed = []
    for tile in sampled:
        text = hover(page, tile)
        distance = re.search(r'가장 가까운 수요지(?:까지)?\s*(\d+)칸', text)
        loss = re.search(r'예상 (?:송전 )?손실(?:률)?\s*([\d.]+)\s*%', text)
        require(checks, bool(distance) and bool(loss), label + ' 수요지 거리·예상 손실률 표시 [A2]')
        expected_distance = distances[tile['i']]
        # 기술 자료의 스마트 송전 효과: 기존 칸당 손실의 ⅔.
        expected_loss = 100 * data['loss'] * expected_distance * (2 / 3 if smart else 1)
        checks.ok(int(distance[1]) == expected_distance and abs(float(loss[1]) - expected_loss) <= .051,
                  label + f' S2 독립 BFS {expected_distance}칸 × 칸당 손실 = {expected_loss:g}%')
        checks.ok('연결점까지' not in text and not re.search(r'연결점.*\d+칸', text),
                  label + ' 연결점 거리 문구 없음 [A2]')
        checks.ok('도시 전체 접속 여유는 칸과 무관' in text, label + ' 도시 전체 접속 값 설명 [A2]')
        displayed.append((int(distance[1]), float(loss[1])))
        overflow(checks, page, label + ' 태양광 말풍선')
    checks.ok(displayed[0][0] != displayed[1][0] and displayed[0][1] != displayed[1][1],
              label + ' 태양광 두 칸 거리와 손실률 모두 다름')
    for forest in (True, False):
        tiles = [t for t in candidates if (t['t'] == 'forest') == forest]
        require(checks, bool(tiles), label + f' 태양광 숲={forest} 허용 칸 fixture')
        text = hover(page, tiles[0])
        checks.ok(('숲 정리비' in text) == forest,
                  label + f' 숲 정리비는 숲 칸에만 표시 (숲={forest})')
    forbidden = page.evaluate("""ids => ids.filter(i=>KCP.buildGame.siteRule('solar',KCP.buildGame.TILES[i]))""",
                              [i for i in visible if not data['tiles'][i]['out']])
    require(checks, bool(forbidden), label + ' 태양광 금지 칸 fixture')
    for i in forbidden[:3]:
        text = hover(page, data['tiles'][i])
        checks.ok(all(s not in text for s in ('일사 배수', '숲 정리비', '가장 가까운 수요지',
                                              '예상 손실률', '도시 전체 접속 여유는 칸과 무관')),
                  label + f' siteRule 금지 칸 {i}에 태양광 조언 없음')

    for kind in ('diesel', 'biomass'):
        tool(page, kind)
        expected = complaint_expectations(page, kind,
                                          [i for i in visible if i not in data['used'] and not data['tiles'][i]['out']])
        require(checks, bool(expected), label + ' S2 ' + kind + ' 합법 칸')
        # 최대 영향·숲 훼손·5점 미달 수용자를 포함한 칸을 우선 측정한다.
        sampled = {max(expected, key=lambda x: x['affected'])['i']}
        for predicate in (lambda x: x['raw'] > x['affected'],
                          lambda x: data['tiles'][x['i']]['t'] == 'forest'):
            found = next((x for x in expected if predicate(x)), None)
            require(checks, found is not None, label + ' ' + kind + ' 문턱/숲 fixture 확보')
            sampled.add(found['i'])
        for item in expected:
            if item['i'] not in sampled:
                continue
            text = hover(page, data['tiles'][item['i']])
            complaints = re.search(r'민원\s*\+\s*(\d+)건\s*\(예상\s*·\s*가동 60% 가정', text)
            affected = re.search(r'영향 주변 시설·마을\s*(\d+)곳', text)
            checks.ok(bool(complaints) and int(complaints[1]) == item['issues']
                      and bool(affected) and int(affected[1]) == item['affected']
                      and '실제 가동 시간에 따라 달라짐' in text,
                      label + f' {kind} {item["i"]} 민원 +{item["issues"]}건·5점 이상 영향 {item["affected"]}곳(숲 제외)')
            overflow(checks, page, label + ' ' + kind + ' 말풍선')

    # SMR 도구는 채택 상태가 필요하다. 잠금을 해제하는 기존 저장 계약만 쓴다.
    saved = page.evaluate("""() => {
      const d=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
      const adopted=d.state.teams[d.team].research.adopted;
      if(!adopted.includes('smr')) adopted.push('smr');
      return JSON.stringify(d);
    }""")
    restore_solo(page, saved, 1, 'plan')
    tool(page, 'smr')
    text = hover(page, candidates[0])
    checks.ok('모형에 SMR 민원 미반영' not in text,
              label + ' SMR 민원 미반영 옛 문구 없음')
    siting_first = page.evaluate('() => KCP.ECON_DATA.thermalFacts.siting.text').split('. ', 1)[0] + '.'
    checks.ok(siting_first in text,
              label + ' SMR 입지 민원 자료 첫 문장 표시')
    screenshot(checks, page, 'v3a-' + label + '-s2.png')


def main():
    checks = Checks()
    base = local_address(sys.argv)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height, scheme in ((1280, 900, 'light'), (1180, 820, 'light'), (390, 844, 'dark')):
            for name, scenario in (('s1', s1), ('s2', s2),
                                   ('s2-grid', lambda c, p, l: s2(c, p, l, smart=True))):
                label = f'{width}x{height}-{scheme}-{name}'
                context, external = context_for(browser, base, width, height, scheme)
                page, events = monitored_page(context)
                try:
                    start(page, base)
                    scenario(checks, page, label)
                except Exception as exc:
                    checks.ok(False, f'{label} {type(exc).__name__}: {str(exc).splitlines()[0][:240]}')
                    screenshot(checks, page, 'v3a-' + label + '-failure.png')
                finally:
                    diagnostics(checks, events, label)
                    overflow(checks, page, label)
                    checks.ok(not external, label + ' 외부 연결 시도 0')
                    context.close()
        browser.close()
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
