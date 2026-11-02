"""품질8 W4: 재현 가능한 자연 사건의 예보·확정 카드와 지도 분위기 검사.

실행(총괄의 샌드박스 밖 로컬 환경):
  tests/.venv/bin/python tests/league/fx_event.py http://127.0.0.1:9430/index.html
서버는 tests/srv.py를 쓴다. 작성 세션에서는 py_compile만 실행한다.

1280×900/390×844 밝음 × 일반/reduce마다 세 고정 방 코드로 12달 진행한다.
fx_event_seeds.js가 D-64 room 규칙으로 만든 lobby 시작 저장본만 기존
혼자 하기 복원 경로로 넣는다(s8n.py restore_solo와 같은 저장 형식).
사건·계획·라운드를 주입하지 않는다. Esc1 보조 판과 보류→예보 재로딩에서 monthStart의 실제
호출을 잠시 붙잡아 화면 조건을 만든 뒤 원래 인자로 풀고, 검사 후 함수를 복원한다.
분위기 표는 w4-event-cards.md 3절의 독립 기대값이다. 여러 사건은 자료
순서의 첫 유효 분위기를 비교한다. 9항목 모두 계획·실제 예보·결과/재생
검사를 수행해야 하며, 고정 판의 사건이 달라지거나 항목이 빠지면 실패한다.
명세 1절은 새로고침·재마운트를 포함해 같은 방·달의 재표시를 금지한다.
첫 해당 사건에서 Esc→서랍 왕복→새로고침을 확인하고 결과로 이어 간다.
DOM 관찰자는 앱 상태를 바꾸지 않고 첫 등장/180ms 뒤의 사각형·면을
기록한다. reduce는 두 시각 모두 움직임이 없고 처음부터 확정 면만 보여야
한다. 위치 변화는 배치 기준 요소의 크기 변화가 없을 때만 실패로 센다.
일반 동작의 겹침은 등장 애니메이션 후, reduce는 최초 표본에서도 검사한다.
390은 has_touch 컨텍스트에서 카드 전/후 결과 탭 터치, 서랍 안 터치·스크롤,
유지 선택 뒤 띠 유지, 지도 터치·Esc·10초 닫힘, 제목·초점·보류·예보를 검사한다.
기대값은 W4c와 총괄 추가 명세 1~9항(열린 서랍 안 누름은 닫지 않음)이다.
캡처는 econui 형식(tests/results/fx-event-*.png), 마지막 줄은 checks N fail M SKIP S.
"""

import json
from pathlib import Path
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, WAIT, Checks as BaseChecks, context_for, diagnostics,
                    local_address, monitored_page, overflow, screenshot)
from league_flow import pass_issue_check, wait_unfolded
from solo import CHANGED_JS, PROGRESS_OR_PREDICT_JS, close_drawer, settle_progress


class Checks(BaseChecks):
    """B: 미실행 보조 검사도 이름을 보존한다. SKIP은 실패/검사 수와 별도다."""

    def __init__(self):
        super().__init__()
        self.skipped = 0
        self.names = set()

    def ok(self, condition, label):
        self.names.add(label)
        return super().ok(condition, label)

    def skip(self, label, reason):
        self.names.add(label)
        self.skipped += 1
        print(f'SKIP {label} ({reason})', flush=True)

    def finish(self):
        print(f'checks {self.count} fail {self.failed} SKIP {self.skipped}', flush=True)
        return 1 if self.failed else 0


class ForecastProbeChecks(BaseChecks):
    """390 보조 판의 고정 이름 목록. 기존 helper의 기대식은 그대로 사용한다.

    helper가 이름 뒤에 붙이는 좌표/관측값은 INFO로 분리한다. 중도 반환,
    해당 사건 없음, 예외에도 finally에서 미실행 이름 전부를 SKIP으로 낸다.
    """

    def __init__(self, checks, label, reduced):
        self.parent = checks
        self.pending = {}
        self.reason = '선행 조건이 맞지 않아 이 단언까지 도달하지 않음'
        suffixes = [
            '예보 결과 서랍 #lg-panel이 열린 상태',
            '예보 W4c 2절 .fx-turn-layer[data-strip="true"]',
            '예보 W4c 1절 layer·카드·띠와 #lg-panel/#bd-drawer 사각형 교차 면적 0',
            '예보 자동 띠 가로 스크롤 0',
            '열린 서랍 앞 예보 state.strip true',
            '예보 띠 제목=첫 사건 제목(결산·월 아님)',
            '예보 사건 띠 기호=첫 사건 eventIcon(id), aria-hidden=true',
            '예보 남은 사건 0장일 때 외 0장 표기 없음',
            '서랍 접기 단추 터치 뒤 예보 유지',
            '서랍 펼치기 단추 터치 뒤 예보 유지',
            '예보 W4c 띠 안 펼치기 단추 1개',
            '예보 펼치기 전 aria-expanded=false',
            '예보 사용자 펼치기 뒤 aria-expanded=true·카드 표시',
            '예보 실제 표시 뒤 sessionStorage 소비 기록 있음',
        ]
        if reduced:
            suffixes.append('예보 W4c 7절 reduce 띠 애니메이션 없음')
        self.expected = [f'{label} {suffix}' for suffix in suffixes]
        self.health_name = label + ' 예보 보조 준비·검사 예외 0'
        self.health = True

    def ok(self, condition, label):
        name = next((name for name in self.expected if label == name or
                     label.startswith(name + ': ') or label.startswith(name + ' (')), None)
        if name is None:
            # helper의 이름이 달라져 조용히 누락되는 것을 허용하지 않는다.
            self.health = False
            print(f'INFO {self.health_name} 등록되지 않은 단언: {label}', flush=True)
        else:
            self.pending.setdefault(name, []).append((bool(condition), label))
        return bool(condition)

    def flush(self):
        self.parent.ok(self.health, self.health_name)
        for name in self.expected:
            values = self.pending.get(name)
            if values is None:
                self.parent.skip(name, self.reason)
            else:
                self.parent.ok(all(ok for ok, _ in values), name)
                for _, detail in values:
                    if detail != name:
                        print(f'INFO {name} 관측: {detail[len(name):].lstrip()}', flush=True)


# w4-event-cards.md 3절 + D-90 heavy_rain 명세. 구현에서 기대값을 읽지 않는다.
EVENT_MOOD = {
    'heatwave_peak': 'heat',
    'evening_peak_tropical_night': 'heat',
    'coldwave_heating': 'cold',
    'heavy_snow_solar': 'snow',
    'typhoon_coast': 'storm',
    'monsoon_cloud': 'cloud',
    'heavy_rain': 'rain',
    'spring_dust_haze': 'haze',
    'finedust_coal_cap': 'haze',
}

# D-90: 장마 중 집중호우와 장마 구름의 기호는 서로 다르다(독립 기대값).
EVENT_ICON = {'heavy_rain': '☂', 'monsoon_cloud': '☁'}

DOM_JS = r"""(() => {
  const visible = el => {
    if (!el || !el.getClientRects().length) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden' ||
          s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      if (n.tagName === 'DETAILS' && !n.open && !n.querySelector('summary')?.contains(el))
        return false;
    }
    return true;
  };
  const rect = el => {
    const r = el.getBoundingClientRect();
    return {x:r.x, y:r.y, width:r.width, height:r.height};
  };
  const overlap = (a, b) => Math.min(a.x+a.width, b.x+b.width) > Math.max(a.x,b.x) &&
    Math.min(a.y+a.height,b.y+b.height) > Math.max(a.y,b.y);
  const layout = () => [...document.querySelectorAll(
    // fx-turn place()가 피하는 요소 전부(#bd-hud·#bd-mapbar·#lg-map-result·.lg-map-guidance·#lg-plan-issues 포함).
    // 이 요소가 늦게 나타나 카드가 다시 놓이는 것은 배치 변화이지 움직임이 아니다(명세 W4 '움직임 줄이기').
    '.lg-bar, #lg-panel, #bd-dock, #bd-root, #bd-drawer, .bd-layers, #bd-hud, #bd-mapbar, ' +
    '#lg-map-result, .lg-map-guidance, #lg-plan-issues, #bd-subtools, [data-issue], #lg-issue-check, #lg-coach, .lg-map-keys')].map(el => {
      // 크기뿐 아니라 위쪽 위치(y)도 본다: #lg-map-result처럼 크기는 그대로인데 위치가 늦게 자리 잡는 요소가 있다.
      const {y, width, height} = rect(el);
      return {key:el.id || el.getAttribute('data-issue') || '.' + el.classList[0],
        y: Math.round(y * 8) / 8, width, height};
    });
  // T F9: 제목 글자는 장식 기호를 빼고 비교한다. 기호 자체는 별도 단언한다.
  const titleText = h => {
    if (!h) return null;
    const copy = h.cloneNode(true);
    copy.querySelectorAll('.bd-event-icon').forEach(n => n.remove());
    return copy.textContent.trim();
  };
  const headings = el => [...el.querySelectorAll('h3')].map(h => ({
    icons:[...h.querySelectorAll('span.bd-event-icon')].map(i => ({
      hidden:i.getAttribute('aria-hidden'), text:i.textContent.trim()})),
    titleSpans:[...h.children].filter(n => n.tagName === 'SPAN' && !n.classList.contains('bd-event-icon')).length
  }));
  const cards = () => [...document.querySelectorAll('.fx-turn-cards article')].map(el => {
    const box = rect(el), back = el.querySelector('.fx-turn-back');
    const front = el.querySelector('.fx-turn-front');
    const face = back || el.querySelector('.fx-turn-face') || el;
    const blockers = [...document.querySelectorAll(
      '.lg-bar, #lg-panel, #bd-dock, [data-issue], #lg-issue-check, #lg-coach')]
      .filter(visible);
    return {title:titleText(face.querySelector('h3')), headings:headings(el),
      tag:face.querySelector('.fx-turn-tag')?.textContent.trim(),
      body:face.querySelector('p')?.textContent.trim(),
      big:face.querySelector('.fx-turn-big')?.textContent.trim() || '',
      active:el.getAttribute('data-active'),
      visibility:getComputedStyle(el).visibility,
      layerOver:el.closest('.fx-turn-layer')?.getAttribute('data-over') ?? null,
      frontTitle:titleText(el.querySelector('.fx-turn-front h3')) || null,
      hasBack:!!back,
      frontVisible:visible(front),
      frontHidden:!!front && (front.hidden || getComputedStyle(front).display === 'none'),
      backFinal:!!back && !back.hidden && getComputedStyle(back).display !== 'none' &&
        getComputedStyle(back).transform === 'none',
      backVisible:visible(back), visible:visible(el), box,
      opacity:Number(getComputedStyle(el).opacity),
      transform:getComputedStyle(el).transform,
      animation:getComputedStyle(el).animationName,
      transition:getComputedStyle(el).transitionDuration,
      inside:box.x >= 0 && box.y >= 0 && box.x+box.width <= innerWidth &&
        box.y+box.height <= innerHeight && box.width > 0 && box.height > 0,
      overlaps:blockers.filter(b => overlap(box,rect(b)))
        .map(b => b.id || b.getAttribute('data-issue') || b.className),
      blockers:blockers.map(b => b.id || b.getAttribute('data-issue') || b.className)};
  });
  return {visible, cards, layout};
})()"""

OBSERVE_JS = r"""() => {
  const L = window.KCP?.league?.state?.(), S = L?.S || L?.snap;
  if (!S) return null;
  const C = KCP.leagueCore, R = C.regionOf(S.region), result = S.results?.at(-1);
  const events = (S.events || []).filter(ev => ev.round === S.round).map(ev => {
    const E = C.eventDef(R, ev.id);
    return {id:ev.id, name:E?.name || null, mine:!!E && C.hits(R,E,L.team)};
  });
  return {round:S.round, phase:S.phase, count:S.results?.length || 0,
    seedMode:S.seedMode, seedKey:S.seedKey, salt:S.salt, active:S.active,
    room:S.room, team:L.team, months:C.roundsOf(S).length, events,
    resultRound:result?.round, resultEvents:result?.events || [],
    fx:KCP.fxTurn?.state?.() || null,
    setMapMood:typeof KCP.buildGame?.setMapMood === 'function',
    cards:(""" + DOM_JS + r""").cards()};
}"""

# 첫 등장 시각은 Python의 locator 대기/스크린샷보다 먼저 수집한다.
# 한 카드 묶음당 한 번만 기록하며 localStorage/앱의 상태/함수는 수정하지 않는다.
PROBE_JS = r"""(() => {
  const seen = new WeakSet();
  window.__fxEventProbe = [];
  window.__fxPlanTransitions = [];
  const scan = () => {
    const live=window.KCP?.league?.state?.(), state=live?.S || live?.snap;
    if(state?.phase==='plan' && !window.__fxPlanTransitions.some(r=>r.round===state.round)) {
      const dom=(""" + DOM_JS + r""");
      window.__fxPlanTransitions.push({round:state.round, fx:{...KCP.fxTurn?.state?.()},
        // rev16 #64: 결산 꼬리표는 해당 월/라운드로 시작한다.
        oldCards:dom.cards().filter(c=>c.tag==='사건' || /결산$/.test(c.tag))});
    }
    for (const deck of document.querySelectorAll('.fx-turn-cards')) {
      if (seen.has(deck)) continue;
      seen.add(deck);
      const L=window.KCP?.league?.state?.(), S=L?.S || L?.snap;
      const dom=(""" + DOM_JS + r""");
      const sample=() => ({at:performance.now(), cards:dom.cards(), layout:dom.layout()});
      const record={round:S?.round, phase:S?.phase,
        forecast:KCP.fxTurn?.state?.().forecastOpen, first:sample(), later:null,
        firstVisibleAt:null, layoutChanges:[]};
      const displayed=()=>dom.visible(deck.closest('.fx-turn-layer')) &&
        (dom.cards().some(c=>c.visible) || dom.visible(deck.querySelector('.fx-turn-strip')));
      if(displayed()) record.firstVisibleAt=performance.now();
      window.__fxEventProbe.push(record);
      let previous=record.first.layout;
      const trackLayout = current => {
        if (JSON.stringify(previous) !== JSON.stringify(current))
          record.layoutChanges.push({at:performance.now(), before:previous, after:current});
        previous=current;
      };
      const frame = () => {
        if (!deck.isConnected) return;
        if (!record.firstVisibleAt && displayed()) record.firstVisibleAt=performance.now();
        if (!record.later) trackLayout(dom.layout());
        // 결과 덱도 실제로 보일 때까지 첫 표시 시각을 찾는다. 일반 카드는 opacity 0에서 80ms 뒤 .3초 페이드로
        // 나타나므로, 180ms(later)에서 고리를 끊으면 느린 실행기에서 기록을 놓친다(CI 5·7차 5월 결과, #56).
        if (!record.later || !record.firstVisibleAt) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      setTimeout(() => {
        if (!deck.isConnected) return;
        record.later=sample(); trackLayout(record.later.layout);
      },180);
    }
  };
  new MutationObserver(scan).observe(document,{childList:true,subtree:true});
})();"""


def observe(page):
    return page.evaluate(OBSERVE_JS)


def wait_state(page, round_number, phases):
    return page.wait_for_function("""([round, phases]) => {
      const s=(""" + OBSERVE_JS + """)();
      return s?.round === round && phases.includes(s.phase) ? s : false;
    }""", arg=[round_number, phases], timeout=WAIT, polling='raf').json_value()


def click_progress(page, before, preserve_drawer=False, after_progress=None, keyboard=False):
    """화면 단추로 진행한다. 보류 검사는 w4c2의 자리 없는 상태를 Enter 입력까지 유지한다."""
    if not preserve_drawer:
        close_drawer(page)
    previous = [before['round'], before['phase'], before['count']]
    # rev15 #53: 앞 조작으로 달이 이미 넘어갔으면(계산 중·가드 중이라 단추가 꺼져 있던 경우) 다시 누르지 않는다.
    if settle_progress(page, previous):
        if before['phase'] == 'plan':
            return wait_state(page, before['round'], ['review', 'end'])
        return observe(page)
    candidates = [page.locator('#lg-ready'), page.locator('#lg-next'),
                  page.get_by_role('button', name=re.compile(
                      r'^(?:준비(?: 완료)?|다음 (?:달|턴|라운드)(?:.*)?|'
                      r'최종 (?:결과|순위)(?:.*)?|리그 끝|끝내기|운영(?:.*)?)$'))]
    for buttons in candidates:
        for i in range(buttons.count()):
            button = buttons.nth(i)
            if not button.is_visible() or not button.is_enabled():
                continue
            ready = button.get_attribute('id') == 'lg-ready'
            if keyboard:
                # 보류 검사의 극소 창에서도 실제 진행 단추를 키보드로 활성화한다.
                # 클릭을 위해 창을 복원하면 지난달 보류가 먼저 풀리므로 Enter를 쓴다.
                button.press('Enter')
            else:
                button.click()
            if ready:
                pass_issue_check(page)
            if ready and before['phase'] == 'plan':
                page.wait_for_function("""args => {
                  const confirm=document.querySelector('#lg-ready-confirm');
                  return (""" + PROGRESS_OR_PREDICT_JS + """)(args) ||
                    !!confirm?.getClientRects().length;
                }""", arg=previous)
                if not page.evaluate(CHANGED_JS, previous):
                    skip = page.locator('#lg-predict-skip')
                    if skip.count() and skip.is_visible() and skip.is_enabled():
                        skip.click()
                    else:
                        page.locator('[data-evidence="evening"]').click()
                        page.locator('[data-pred]').select_option('down')
                        page.locator('[data-confidence="fairly"]').click()
                        page.locator('#lg-ready-confirm').click()
                return wait_state(page, before['round'], ['review', 'end'])
            if after_progress:
                after_progress()
            page.wait_for_function(CHANGED_JS, arg=previous)
            return observe(page)
    raise AssertionError(f"{before['round']}월 {before['phase']}: 진행 단추 없음")


def mood(checks, state, label, seen):
    ids = [ev['id'] for ev in state['events'] if ev['mine']]
    selected = next((key for key in ids if key in EVENT_MOOD), None)
    expected = EVENT_MOOD.get(selected)
    passed = checks.ok(state['fx'] is not None and 'mood' in state['fx'] and
                       state['fx']['mood'] == expected,
                       f"{label} 내 도시 사건 {ids} → mood {expected!r} "
                       f"(실제 {(state['fx'] or {}).get('mood')!r})")
    if selected and passed:
        seen.add(selected)
    return selected


def card_details(cards):
    # 브리프 3항: 실패한 바로 그 표본을 남긴다(이후 DOM을 다시 읽지 않는다).
    return [{key: c[key] for key in
             ('title', 'active', 'visibility', 'visible', 'box', 'layerOver')}
            for c in cards]


def geometry(checks, page, label, mobile, cards=None):
    cards = observe(page)['cards'] if cards is None else cards
    visible = [c for c in cards if c['visible']]
    details = card_details(cards)
    checks.ok(bool(visible), f'{label} 실제 보이는 카드 존재: {details}')
    checks.ok(bool(visible) and all(c['inside'] for c in visible),
              f'{label} 카드가 뷰포트 안의 양수 크기: {details}')
    # 기존 W4 대체 배치. W4c 모바일 결과는 자동 띠에서 별도로 교차 0을
    # 검사하고, 이 함수는 사용자 펼치기 뒤에만 호출한다(W4c 3절).
    # 명세 D1: 폭 761 이상은 data-over=true여도 열린 서랍 겹침을 허용하지 않는다.
    # 390의 사용자 펼치기 대체 배치와 막대·도구·문제 칩·코치 단언은 유지한다.
    wide = page.viewport_size['width'] >= 761
    collisions = []
    for c in visible:
        blocked = [key for key in c['overlaps']
                   if not (not wide and key == 'lg-panel' and c['layerOver'] == 'true')]
        if blocked:
            collisions.append((c['title'], blocked))
    checks.ok(bool(visible) and not collisions,
              f'{label} 막대·열린 서랍(760px 이하 펼치기 data-over=true만 제외)·도구·문제·코치 '
              f'겹침 0: {collisions}; 카드 {details}')
    if mobile:
        checks.ok(len(visible) == 1, f'{label} 390px 카드 한 장씩: {details}')
    overflow(checks, page, label)


def reduced_entry(checks, page, round_number, forecast, label, mobile, forecast_names):
    record = page.wait_for_function("""([round, forecast]) => {
      const r=window.__fxEventProbe.find(r => r.round===round && r.forecast===forecast);
      return r?.later ? r : false;
    }""", arg=[round_number, forecast], timeout=2000).json_value()
    first, later = record['first']['cards'], record['later']['cards']
    first_visible = [(i, c) for i, c in enumerate(first) if c['visible']]
    details = f'최초 {card_details(first)}; 180ms {card_details(later)}'
    # W4 소유와 금지/2절: reduce의 금지는 움직임이다. 막대 줄바꿈 등으로
    # 배치 기준 크기가 바뀐 재배치는 애니메이션으로 세지 않는다. 오차 허용은
    # 추가하지 않고 두 표본과 그 사이 프레임의 실제 크기 변화를 근거로 남긴다.
    moving = [(when, i, {key: c[key] for key in
                        ('transform', 'opacity', 'animation', 'transition')})
              for when, cards in (('최초', first), ('180ms', later))
              for i, c in enumerate(cards)
              if not (c['transform'] == 'none' and c['opacity'] == 1 and
                      all(v.strip() == 'none' for v in c['animation'].split(',')) and
                      all(v.strip() == '0s' for v in c['transition'].split(',')))]
    checks.ok(bool(first_visible) and not moving,
              f'{label} 두 시각 모두 transform none·opacity 1·animation none·'
              f'transition 0s: {moving}; 카드 {details}')
    changed_boxes = [(i, c['box'], later[i]['box']) for i, c in enumerate(first)
                     if i < len(later) and c['box'] != later[i]['box']]
    if changed_boxes:
        print(f"INFO {label} 카드 사각형 변화 {changed_boxes}; "
              f"배치 기준 최초 {record['first']['layout']}; "
              f"180ms {record['later']['layout']}; 중간 크기 변화 "
              f"{record['layoutChanges']}", flush=True)
    checks.ok(len(first) == len(later) and
              (not changed_boxes or bool(record['layoutChanges'])),
              f'{label} 배치 기준 크기 변화 없는 카드 위치·크기 변화 0; 카드 {details}')
    checks.ok(record['later']['at'] > record['first']['at'],
              f'{label} 서로 다른 두 시각의 표본')
    geometry(checks, page, label + ' 최초', mobile, first)
    if not forecast and forecast_names:
        # W4b 7항: 계획 때 예보로 본 내 도시 사건만 앞·뒷면을 갖는다.
        events = [c for c in first if c['tag'] == '사건' and
                  c['title'] in forecast_names]
        # compact의 아직 넘기지 않은 카드도 면 자체의 숨김/회전을 확인한다.
        checks.ok({c['title'] for c in events} == set(forecast_names) and
                  all(c['frontHidden'] and c['backFinal'] for c in events) and
                  all(c['frontHidden'] and c['backFinal']
                      for c in later if c['tag'] == '사건' and
                      c['title'] in forecast_names),
                  f'{label} 예보로 본 사건은 등장 즉시 예보 면 숨김·확정 면만; '
                  f'카드 {details}')


def inspect_cards(checks, page, names, forecast, label, mobile, reduced,
                  forecast_names=(), forecast_range_names=(), strip_expanded=False):
    state = observe(page)
    details = card_details(state['cards'])
    flag = 'forecastOpen' if forecast else 'cardsOpen'
    checks.ok((state['fx'] or {}).get(flag) is True,
              f'{label} {flag} === true; 카드 {details}')
    tag = '사건 예보' if forecast else '사건'
    cards = [c for c in state['cards'] if c['tag'] == tag]
    checks.ok(sorted(c['title'] for c in cards) == sorted(names),
              f'{label} 자료의 사건 제목과 카드 제목 일치: {names}; 카드 {details}')
    for card in state['cards']:
        event = card['tag'] in ('사건 예보', '사건')
        checks.ok(bool(card['headings']) and all(
            len(h['icons']) == 1 and h['icons'][0]['hidden'] == 'true' and
            bool(h['icons'][0]['text']) and h['titleSpans'] == 1 if event
            else not h['icons'] for h in card['headings']),
            f"{label} 사건 h3만 기호 span + 제목 span, 기호 aria-hidden=true: {card['title']}")
        if event:
            event_icon = page.evaluate("""title => {
              const L=KCP.league.state(), V=L.S||L.snap, C=KCP.leagueCore;
              const e=C.regionOf(V.region).events.find(e=>e.name===title);
              return {id:e?.id, icon:e && typeof KCP.fxTurn.eventIcon==='function' ? KCP.fxTurn.eventIcon(e.id) : null};
            }""", card['title'])
            expected_icon = EVENT_ICON.get(event_icon.get('id'), event_icon['icon'])
            checks.ok(bool(expected_icon) and event_icon['icon'] == expected_icon and all(
                h['icons'] and h['icons'][0]['text'] == expected_icon for h in card['headings']),
                f"{label} 사건 카드 기호=eventIcon(id): {card['title']}")
    if not forecast:
        # W4b 7항: 해당 여부는 결과 구현의 면 유무가 아니라 계획 단계에서
        # 실제 화면에 확인한 예보 제목으로 판정한다. 다른 도시 사건은 단면이다.
        predicted = [c for c in cards if c['title'] in forecast_names]
        # 이 브리프 2항: 일정 사건/fc 없는 사건은 evReveal의 예보→확정
        # 문장이 없다. 계획 때 실제 본 big에 ~ 또는 ±가 있던 사건만 검사한다.
        # 면 유무·제목 검사는 범위 없는 예보까지 기존대로 유지한다.
        ranged = [c for c in predicted if c['title'] in forecast_range_names]
        if forecast_range_names:
            checks.ok({c['title'] for c in ranged} == set(forecast_range_names) and
                      all('확정' in (c['body'] or '') for c in ranged),
                      f'{label} 범위 예보로 본 내 도시 사건의 확정 면 문장에 확정: '
                      f'{sorted(forecast_range_names)}; 카드 {details}')
        else:
            # 일정/fc 없는 사건에는 범위→확정 문장이 없다는 W4b 2항.
            # 범위 사례의 실행 보장은 run_case의 saw_range로 별도 단언한다.
            print(f'INFO {label} 범위 없는 예보: 범위→확정 문장 대상 아님',
                  flush=True)
        checks.ok(all(c['frontTitle'] == c['title'] for c in predicted) and
                  all(c['frontTitle'] is None and not c['hasBack']
                      for c in cards if c['title'] not in forecast_names),
                  f'{label} 예보로 본 사건은 앞·뒷면 제목 동일·나머지는 단면; '
                  f'카드 {details}')
    if reduced and not strip_expanded:
        reduced_entry(checks, page, state['round'], forecast, label, mobile, forecast_names)
    elif reduced:
        # W4c에서는 최초 자동 표시가 카드가 아닌 띠다. 사용자 펼치기 뒤의
        # 확정 면·무동작을 검사하며, 숨겨진 카드의 최초 관측을 재사용하지 않는다.
        checks.ok(bool(cards) and all(c['transform'] == 'none' and c['opacity'] == 1 and
                  all(v.strip() == 'none' for v in c['animation'].split(',')) and
                  all(v.strip() == '0s' for v in c['transition'].split(',')) for c in cards) and
                  all(c['frontHidden'] and c['backFinal'] for c in cards
                      if c['title'] in forecast_names),
                  f'{label} reduce 띠 펼친 직후 움직임 없음·예보한 사건은 확정 면만: {details}')

    # compact/paged는 결산 카드 다음에 사건 카드가 있다. 숨은 DOM만 읽고
    # 통과시키지 않고, 실제 이전/다음 단추로 모든 카드를 화면에 표시한다.
    count = len(state['cards'])
    reached, range_names = set(), set()
    current = state['cards']
    for step in range(count):
        page.wait_for_timeout((1100 + (count - 1) * 260 if step == 0 else 1000)
                              if not reduced else 40)
        current = observe(page)['cards']
        geometry(checks, page, f'{label} {step + 1}면', mobile, current)
        for c in current:
            if c['visible'] and c['tag'] == tag:
                reached.add(c['title'])
                if forecast and any(mark in c['big'] for mark in ('~', '±')):
                    range_names.add(c['title'])
                if reduced and not forecast and c['title'] in forecast_names:
                    checks.ok(c['backVisible'] and not c['frontVisible'],
                              f"{label} {c['title']} 확정 면만 표시; "
                              f'카드 {card_details(current)}')
        following = page.locator('.fx-turn-card:visible .fx-turn-card-nav').get_by_role(
            'button', name='다음', exact=True)
        visible_next = [following.nth(i) for i in range(following.count())
                        if following.nth(i).is_visible() and following.nth(i).is_enabled()]
        if not visible_next:
            break
        visible_next[0].click()
    checks.ok(reached == set(names),
              f'{label} 모든 사건 카드를 실제 화면에서 확인: {sorted(reached)}; '
              f'카드 {card_details(current)}')
    return reached, range_names


def remains_closed(page, milliseconds=500):
    return page.evaluate("""async ms => {
      const end=performance.now()+ms;
      do {
        if (KCP.fxTurn?.state?.().forecastOpen !== false) return false;
        await new Promise(resolve => requestAnimationFrame(resolve));
      } while (performance.now()<end);
      return true;
    }""", milliseconds)


def dismiss_forecast(checks, page, state, label, reload_check):
    # 총괄 결정(160fc06 검토): Esc 한 번에 하나만 닫힌다. 첫 달 코치가 열려 있으면 Esc1은 코치만 닫고
    # 예보는 남으며, Esc2가 예보를 닫는다.
    coach = page.locator('#lg-coach')
    if coach.count() and coach.is_visible():
        page.keyboard.press('Escape')
        checks.ok(not coach.is_visible() and
                  (observe(page)['fx'] or {}).get('forecastOpen') is True,
                  f'{label} 코치가 열린 첫 Esc는 코치만 닫고 예보 유지')
    page.keyboard.press('Escape')
    checks.test(f'{label} Esc로 예보 닫힘', lambda: bool(page.wait_for_function(
        '() => KCP.fxTurn?.state?.().forecastOpen === false', timeout=1000)))
    if not reload_check:
        return
    before = len(page.evaluate('() => window.__fxEventProbe'))
    page.locator('.lg-bar [data-panel="city"]').click()
    page.wait_for_function("() => document.querySelector('#lg-panel')?.hidden === false")
    checks.ok(remains_closed(page), f'{label} 같은 달 도시 서랍 열어도 재표시 0')
    close_drawer(page)
    checks.ok(remains_closed(page) and
              len(page.evaluate('() => window.__fxEventProbe')) == before,
              f'{label} 서랍 닫은 뒤에도 같은 달 새 카드 0')
    # 저장 지연은 (비공개 개발 설정)의 400ms를 따른다.
    page.wait_for_timeout(400)
    page.reload()
    page.wait_for_function(BOOT_JS)
    page.locator('#lg-bar').wait_for(state='visible', timeout=30000)
    restored = wait_state(page, state['round'], ['plan'])
    checks.ok(restored['room'] == state['room'] and restored['team'] == state['team'] and
              restored['count'] == state['count'] and restored['events'] == state['events'],
              f'{label} 새로고침 뒤 같은 방·도시·달·사건 복원')
    checks.ok(remains_closed(page) and not page.evaluate('() => window.__fxEventProbe.length'),
              f'{label} 명세 1절: 새로고침 뒤에도 예보 재표시 금지')
    # 재표시 회귀가 있어도 같은 사건의 결과 검사는 계속한다.
    if (observe(page)['fx'] or {}).get('forecastOpen'):
        page.keyboard.press('Escape')


def outside_click(checks, page, label):
    # W4 1절: 조작을 막지 않아야 한다. 자료 지도 단추는 리그의 닫힌
    # details.lg-map-views 안에 있으므로, 항상 보이는 도구 막대 단추로
    # force/dispatch_event 없이 원래 대상의 aria-expanded 변화를 확인한다.
    buttons = page.locator('#bd-pm')
    target = next((buttons.nth(i) for i in range(buttons.count())
                   if buttons.nth(i).is_visible() and buttons.nth(i).is_enabled()), None)
    if target is None:
        # rev16 #72-4: 리그 도구 단추 이름 변경. 선택자·클릭 전달 계약은 유지.
        checks.ok(False, f'{label} 클릭 전달 검사에 필요한 보이는 정책·시험 단추 없음')
        return
    before = target.get_attribute('aria-expanded')
    checks.ok((observe(page)['fx'] or {}).get('cardsOpen') is True,
              f'{label} 도구 막대 클릭 직전 사건 카드 열림')
    target.click()
    after = target.get_attribute('aria-expanded')
    checks.ok(before in ('true', 'false') and after in ('true', 'false') and after != before,
              f'{label} 카드 밖 도구 막대 #bd-pm 클릭이 원래 대상에 전달')
    checks.test(f'{label} 바깥 클릭으로 카드 닫힘', lambda: bool(page.wait_for_function(
        '() => KCP.fxTurn?.state?.().cardsOpen === false', timeout=1000)))
    if after != before:
        target.click()  # 검사에서 연 서랍은 같은 화면 단추로 원래 상태로 돌린다.


def strip_geometry(checks, page, label, reduced):
    """W4c 1·2절: 자동 표시는 data-over 여부와 관계없이 열린 서랍을 피한다."""
    data = page.evaluate("""() => {
      const dom=(""" + DOM_JS + """);
      const rect=el=>{const r=el.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*
        Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
      const blockers=[...document.querySelectorAll('#lg-panel, #bd-drawer')].filter(dom.visible);
      const layers=[...document.querySelectorAll('.fx-turn-layer')].filter(dom.visible);
      const boxes=layers.flatMap(layer=>[layer,...layer.querySelectorAll(
        'article, .fx-turn-cards, [data-strip]')]).filter(dom.visible).map(el=>({
          element:el.className,box:rect(el),
          overlaps:blockers.map(b=>({id:b.id,area:overlap(rect(el),rect(b))}))}));
      return {blockers:blockers.map(b=>b.id),boxes,
        layers:layers.map(el=>({strip:el.getAttribute('data-strip'),box:rect(el),
          animation:getComputedStyle(el).animationName,
          transition:getComputedStyle(el).transitionDuration}))};
    }""")
    checks.ok('lg-panel' in data['blockers'], f'{label} 결과 서랍 #lg-panel이 열린 상태: {data}')
    strip = checks.ok(len(data['layers']) == 1 and data['layers'][0]['strip'] == 'true',
                      f'{label} W4c 2절 .fx-turn-layer[data-strip="true"]: {data["layers"]}')
    checks.ok(bool(data['boxes']) and all(b['box']['width'] > 0 and b['box']['height'] > 0 and
              all(o['area'] == 0 for o in b['overlaps']) for b in data['boxes']),
              f'{label} W4c 1절 layer·카드·띠와 #lg-panel/#bd-drawer 사각형 교차 면적 0: {data}')
    if reduced:
        checks.ok(bool(data['layers']) and all(
            all(v.strip() == 'none' for v in layer['animation'].split(',')) and
            all(v.strip() == '0s' for v in layer['transition'].split(','))
            for layer in data['layers']), f'{label} W4c 7절 reduce 띠 애니메이션 없음')
    overflow(checks, page, label + ' 자동 띠')
    return strip


def strip_drawer_click(checks, page, label, reduced):
    """W4c 4절: 클릭 관측기 대신 실제 S8 선택의 aria-pressed 변화를 본다."""
    target = page.locator('#lg-panel [data-answer="keep"]')
    if not target.count() or not target.first.is_visible() or not target.first.is_enabled():
        return False  # 다른 자연 사건 달에서 다시 시도하며 마지막에 실행 여부를 단언한다.
    target = target.first
    target.scroll_into_view_if_needed()
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    strip_geometry(checks, page, label + ' 유지 단추 스크롤 뒤', reduced)
    before = target.get_attribute('aria-pressed')
    hit = target.evaluate("""el => {
      const r=el.getBoundingClientRect(), x=(r.left+r.right)/2, y=(r.top+r.bottom)/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,own:!!hit && (hit===el || el.contains(hit)),
        hit:hit ? {tag:hit.tagName,id:hit.id,cls:hit.className} : null};
    }""")
    clear = checks.ok(hit['own'] and before == 'false' and
                      (observe(page)['fx'] or {}).get('cardsOpen') is True and
                      page.locator('.fx-turn-layer[data-strip="true"]:visible').count() == 1,
                      f'{label} 띠 열린 채 유지 단추 미선택·elementFromPoint가 단추/자손: {hit}')
    # 실제 좌표 클릭. force/dispatch_event로 덧층의 가로채기를 우회하지 않는다.
    page.touchscreen.tap(hit['x'], hit['y'])
    pressed = checks.test(f'{label} 유지 단추 실제 동작: aria-pressed false → true',
                         lambda: bool(page.wait_for_function("""() =>
                           document.querySelector('#lg-panel [data-answer="keep"]')?.
                             getAttribute('aria-pressed') === 'true'""", timeout=1000)))
    kept = strip_stays_open(checks, page, label + ' 유지 터치 뒤')
    return clear and pressed and kept


def pointer_press(page, target, touch=True):
    """실제 hit-test를 거친 좌표 입력. 덧층을 우회하지 않는다."""
    target.scroll_into_view_if_needed()
    hit = target.evaluate("""el => {
      const r=el.getBoundingClientRect(), x=(r.left+r.right)/2, y=(r.top+r.bottom)/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,own:!!hit && (hit===el || el.contains(hit))};
    }""")
    if not hit['own']:
        raise AssertionError(f'포인터 대상이 덧층에 가려짐: {hit}')
    if touch:
        page.touchscreen.tap(hit['x'], hit['y'])
    else:
        page.mouse.click(hit['x'], hit['y'])


def strip_stays_open(checks, page, label):
    return checks.ok(page.evaluate("""() => {
      const dom=(""" + DOM_JS + """);
      const s=KCP.fxTurn?.state?.();
      return s?.strip===true && s.cardsOpen===true &&
        [...document.querySelectorAll('.fx-turn-layer[data-strip="true"]')].some(dom.visible);
    }"""), label + ' strip true·cardsOpen true·띠 실제 표시')


def deck_stays_open(checks, page, label):
    # D-83: 서랍을 닫는 Esc는 그 한 층만 닫는다. 서랍이 사라져 자리가 생기면 place()가 덱을
    # 카드로 다시 펼치는 것은 의도한 배치이고(총괄 판단 10-21, ui/fx-turn.js place의 drawers.length 분기),
    # 띠가 접힌 채 남아야 한다는 명세는 없다. 그래서 띠 모양은 묻지 않고 덱이 열려 실제로 보이는지만 본다.
    # 다시 배치된 카드가 움직임과 함께 나타나는 동안은 잠깐 보이지 않을 수 있어 1초 안의 조건 대기로 본다.
    # 그 사이 cardsOpen이 false가 되면(서랍과 함께 덱이 닫힌 회귀) 즉시 실패한다.
    return checks.test(label + ' cardsOpen true·덱 실제 표시(띠 또는 카드)', lambda: page.wait_for_function("""() => {
      const dom=(""" + DOM_JS + """);
      if (KCP.fxTurn?.state?.().cardsOpen!==true) throw Error('cardsOpen false: 덱이 서랍과 함께 닫힘');
      return dom.cards().some(c=>c.visible) ||
        [...document.querySelectorAll('.fx-turn-layer[data-strip="true"]')].some(dom.visible);
    }""", timeout=1000).json_value())


def strip_title(checks, page, label, forecast=False):
    # 총괄 추가 6항: 결산을 제외한 첫 사건 제목. DOM 순서는 표시 자료 순서이다.
    data = page.evaluate("""forecast => {
      const dom=(""" + DOM_JS + """);
      const events=dom.cards().filter(c=>c.tag===(forecast?'사건 예보':'사건'));
      const strip=document.querySelector('.fx-turn-strip');
      const L=KCP.league.state(), V=L.S||L.snap, C=KCP.leagueCore;
      const first=C.regionOf(V.region).events.find(e=>e.name===events[0]?.title);
      const icon=strip?.querySelector('.fx-turn-strip-icon');
      return {title:strip?.querySelector('.fx-turn-strip-title')?.textContent.trim(),
        text:strip?.textContent, events:events.map(c=>c.title), icon:icon?.textContent,
        hidden:icon?.getAttribute('aria-hidden'), id:first?.id,
        expected:first && typeof KCP.fxTurn.eventIcon==='function' ? KCP.fxTurn.eventIcon(first.id) : null};
    }""", forecast)
    checks.ok(bool(data['events']) and bool(data['title']) and data['title'] == data['events'][0] and
              '결산' not in data['title'] and not re.fullmatch(r'\d+월', data['title']),
              f'{label} 띠 제목=첫 사건 제목(결산·월 아님): {data}')
    expected_icon = EVENT_ICON.get(data.get('id'), data['expected'])
    checks.ok(bool(expected_icon) and data['expected'] == expected_icon and
              data['icon'] == expected_icon and data['hidden'] == 'true',
              f'{label} 사건 띠 기호=첫 사건 eventIcon(id), aria-hidden=true: {data}')
    if len(data['events']) == 1:
        checks.ok('외 0장' not in (data['text'] or ''),
                  f'{label} 남은 사건 0장일 때 외 0장 표기 없음: {data}')


def drawer_blank_touch(checks, page, label):
    # 총괄 추가 2(a)항과 최종 결정: 열린 서랍 본문은 띠 닫기 영역이 아니다.
    # 본문 여백/글자 중 조작 요소가 없는 실제 지점만 선택한다.
    point = page.evaluate("""() => {
      const body=document.querySelector('#lg-panel .lg-pbody');
      if (!body) return null;
      const r=body.getBoundingClientRect();
      for(let y=Math.max(0,r.top)+6;y<Math.min(innerHeight,r.bottom)-6;y+=12)
        for(let x=Math.max(0,r.left)+6;x<Math.min(innerWidth,r.right)-6;x+=12) {
          const el=document.elementFromPoint(x,y);
          if(el && body.contains(el) && !el.closest(
            'button,a,input,select,textarea,summary,[role="button"],[contenteditable]')) return {x,y};
        }
      return null;
    }""")
    if not checks.ok(point is not None, label + ' 서랍 본문의 비조작 지점 존재'):
        return False
    page.touchscreen.tap(point['x'], point['y'])
    touched = strip_stays_open(checks, page, label + ' 서랍 본문 첫 터치 뒤')
    page.mouse.move(point['x'], point['y'])
    page.mouse.wheel(0, 180)
    page.wait_for_timeout(100)
    scrolled = strip_stays_open(checks, page, label + ' 서랍 본문 wheel 뒤')
    return touched and scrolled


def result_closed(checks, page, label, milliseconds=500):
    # 재표시는 끝 표본만으로 판정하지 않고 매 프레임 상태·DOM을 관찰한다.
    checks.test(label + ' cardsOpen false·카드/띠 닫힘', lambda: bool(
        page.wait_for_function("""() => {
          const dom=(""" + DOM_JS + """);
          return KCP.fxTurn?.state?.().cardsOpen===false && !dom.cards().some(c=>c.visible) &&
            ![...document.querySelectorAll('.fx-turn-layer')].some(dom.visible);
        }""", timeout=1000)))
    checks.ok(page.evaluate("""async ms => {
      const dom=(""" + DOM_JS + """), end=performance.now()+ms;
      do {
        if(KCP.fxTurn?.state?.().cardsOpen!==false ||
          document.querySelector('.fx-turn-cards article') ||
          [...document.querySelectorAll('.fx-turn-layer')].some(dom.visible)) return false;
        await new Promise(r=>requestAnimationFrame(r));
      } while(performance.now()<end);
      return true;
    }""", milliseconds), label + f' {milliseconds}ms 재표시 0·사건 카드 DOM 0')


def map_touch(checks, page, label):
    # 총괄 추가 3항: 조작 단추를 대신 누르는 검사는 지도 터치 검사가 아니다.
    point = page.evaluate("""() => {
      const canvas=document.querySelector('#bd-canvas');
      if(!canvas) return null;
      const r=canvas.getBoundingClientRect();
      for(let y=Math.max(0,r.top)+8;y<Math.min(innerHeight,r.bottom)-8;y+=16)
        for(let x=Math.max(0,r.left)+8;x<Math.min(innerWidth,r.right)-8;x+=16)
          if(document.elementFromPoint(x,y)===canvas) return {x,y};
      return null;
    }""")
    if checks.ok(point is not None, label + ' 서랍·조작 단추 밖 지도 캔버스 hit-test'):
        page.touchscreen.tap(point['x'], point['y'])
        result_closed(checks, page, label + ' 지도 터치')


def deferred_probe(checks, page, label, recover=True):
    """w4c2 1절: 자리 없는 동안 숨기고, 자리 확보 뒤 다시 표시한다.

    열린 결과 서랍에서 320×48로 줄인다. place()의 상하 8px 여백을 빼면
    높이 32px이므로 최소 44px 띠·칩 자리도 없다. 보류는 상태 주입 없이
    창 크기로 만들며, 두 RAF 뒤 조건 대기로 재배치 결과를 확인한다.
    이 표본은 '보류 → 숨김 → 자리 확보 뒤 재표시' 상태 전환만 검사한다. place()의 자리
    탐색(막대 옆·막대 사이·결과 칩 자리)이 실제 기기 크기에서 보류를 맞게 고르는지와
    서랍 접기(#lg-panel-fold)로 되돌아오는 경로는 여기서 검사하지 않는다(남은 범위).
    """
    checks.ok(page.locator('#lg-panel').is_visible() and
              page.locator('#lg-panel').get_attribute('data-tab') == 'result',
              label + ' 보류 준비: 결과 서랍 열린 상태')
    page.set_viewport_size({'width': 320, 'height': 48})
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    page.wait_for_function('() => KCP.fxTurn?.state?.().deferred === true',
                           timeout=2000, polling='raf')
    fx = observe(page)['fx'] or {}
    checks.ok(fx.get('deferred') is True and fx.get('cardsOpen') is True,
              f'{label} 보류 중 deferred true·cardsOpen true: {fx}')
    checks.ok(page.evaluate("""() => {
      const dom=(""" + DOM_JS + """);
      return !dom.cards().some(c=>c.visible) &&
        ![...document.querySelectorAll('.fx-turn-layer')].some(dom.visible);
    }"""), label + ' 보류 중 덧층·카드 화면 표시 0')
    if not recover:
        return True  # 같은 작은 창에서 실제 '다음 달' 단추를 Enter로 누른다.
    # 복원 방식도 고정한다. 서랍은 유지하므로 띠·칩으로 복귀할 수 있다.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    checks.test(f'{label} 창 크기 복원 뒤 카드·띠 표시 복귀', lambda: bool(
        page.wait_for_function("""() => {
          const dom=(""" + DOM_JS + """);
          const fx=KCP.fxTurn?.state?.();
          return fx?.cardsOpen===true && fx.deferred===false &&
            (dom.cards().some(c=>c.visible) ||
             [...document.querySelectorAll('.fx-turn-strip')].some(dom.visible));
        }""", timeout=2000)))
    return True


def plan_cleanup(checks, page, month, label):
    sample = page.wait_for_function("""month =>
      window.__fxPlanTransitions.find(r=>r.round===month) || false""",
                                    arg=month, timeout=WAIT).json_value()
    checks.ok((sample['fx'] or {}).get('cardsOpen') is False and not sample['oldCards'],
              f'{label} 다음 달 계획 진입 때 cardsOpen false·지난달 사건/결산 DOM 0: {sample}')
    checks.ok(page.evaluate("""async () => {
      const dom=(""" + DOM_JS + """), end=performance.now()+500;
      do {
        // rev16 #64: 계획 단계에는 월/라운드 결산 카드가 남지 않는다.
        if(dom.cards().some(c=>c.tag==='사건' || /결산$/.test(c.tag))) return false;
        await new Promise(r=>requestAnimationFrame(r));
      } while(performance.now()<end);
      return true;
    }"""), label + ' 계획 진입 뒤 500ms 지난달 카드 재표시 0(새달 예보는 별도)')


def expand_strip(checks, page, label):
    # 새 구현의 클래스/내부 상태를 추측하지 않는다. W4c 2·5절의 data-strip과
    # 접근 가능한 단추 이름·aria-expanded만 계약으로 사용한다.
    buttons = page.locator('.fx-turn-layer[data-strip="true"]').get_by_role(
        'button', name=re.compile('펼치기'))
    if not checks.ok(buttons.count() == 1 and buttons.first.is_visible(),
                     f'{label} W4c 띠 안 펼치기 단추 1개'):
        return False
    button = buttons.first
    checks.ok(button.get_attribute('aria-expanded') == 'false',
              label + ' 펼치기 전 aria-expanded=false')
    button.click()
    return checks.test(label + ' 사용자 펼치기 뒤 aria-expanded=true·카드 표시',
                       lambda: bool(page.wait_for_function("""() => {
                         const dom=(""" + DOM_JS + """);
                         return !!document.querySelector('.fx-turn-layer button[aria-expanded="true"]') &&
                           dom.cards().some(c=>c.visible);
                       }""", timeout=1000)))


def close_expanded_strip(checks, page, label):
    page.keyboard.press('Escape')
    # W4c 3절: 접힌 띠로 돌아오면 실패. 500ms 동안 재표시도 없어야 한다.
    closed_js = """() => {
      const dom=(""" + DOM_JS + """);
      return KCP.fxTurn?.state?.().cardsOpen === false &&
        ![...document.querySelectorAll('.fx-turn-layer, [data-strip="true"]')].some(dom.visible) &&
        !dom.cards().some(c=>c.visible);
    }"""
    if not checks.test(label + ' Esc 뒤 카드·layer·띠 모두 닫힘', lambda: bool(
            page.wait_for_function(closed_js, timeout=1000))):
        return
    checks.ok(page.evaluate("""async () => {
      const closed=(""" + closed_js + """), end=performance.now()+500;
      do {
        if (!closed()) return false;
        await new Promise(r=>requestAnimationFrame(r));
      } while (performance.now()<end);
      return true;
    }"""), label + ' W4c 3절 펼친 뒤 Esc: 카드·layer·띠 완전 닫힘, 500ms 재표시 0')
    checks.ok(page.evaluate("""() => !!document.activeElement &&
      document.activeElement!==document.body && document.activeElement.isConnected"""),
              label + ' 펼치기→Esc 뒤 초점이 body가 아닌 연결된 요소에 복귀')


def strip_timeout(checks, page, label, shown_at):
    # 총괄 추가 4항: 띠는 motion/reduce 모두 최초 표시부터 10초.
    # 7초에 다시 누른 뒤 최초 시각+10초(실행기 여유 1초) 안에 닫혀야 한다.
    elapsed = page.evaluate('() => performance.now()') - shown_at
    page.wait_for_timeout(max(0, 7000 - elapsed))
    strip_stays_open(checks, page, label + ' 최초 표시 7초 뒤')
    drawer_blank_touch(checks, page, label + ' 7초 시점 재누름')
    elapsed = page.evaluate('() => performance.now()') - shown_at
    page.wait_for_timeout(max(0, 9500 - elapsed))
    strip_stays_open(checks, page, label + ' 10초 전(9.5초) 아직 표시')
    remaining = max(1, 11000 - (page.evaluate('() => performance.now()') - shown_at))
    checks.test(label + ' 서랍 안 재누름으로 연장 없이 최초 표시 10초 뒤 자동 닫힘 '
                '(실행기 대기 여유 1초)', lambda: bool(page.wait_for_function(
                    '() => KCP.fxTurn?.state?.().cardsOpen===false', timeout=remaining)))
    result_closed(checks, page, label + ' 자동 닫힘 뒤')


def open_result_by_pointer(checks, page, label, late=False, touch=True):
    # 총괄 추가 1·5항: 같은 결과 탭도 카드 등장 전/후의 기대 동작이 다르다.
    # 결과 단계는 자동으로 결과 서랍을 연다. Enter는 닫기 준비에만 쓰고,
    # 검사 대상인 열기는 반드시 mouse/touch로 한다. 키보드 열기로 우회하지 않는다.
    close = page.locator('#lg-panel .lg-px')
    if close.is_visible():
        close.press('Enter')
    checks.ok(not page.locator('#lg-panel').is_visible(), label + ' 결과 탭 입력 전 서랍 닫힘')
    if late:
        page.wait_for_function('() => KCP.fxTurn?.state?.().cardsOpen===true', timeout=WAIT)
    else:
        checks.ok((observe(page)['fx'] or {}).get('cardsOpen') is False,
                  label + ' 결과 탭 입력 직전 아직 카드 미표시')
    pointer_press(page, page.locator('#lg-bar [data-panel="result"]'), touch=touch)
    checks.test(label + ' 실제 포인터로 결과 서랍 열림', lambda: bool(
        page.wait_for_function("""() => {
          const p=document.querySelector('#lg-panel');
          return p && !p.hidden && p.dataset.tab==='result' && p.dataset.folded!=='true';
        }""", timeout=WAIT)))
    if late:
        result_closed(checks, page, label + ' 카드 표시 후 막대 결과 탭 터치')
        drawer_blank_touch_after_close(checks, page, label)


def drawer_blank_touch_after_close(checks, page, label):
    # 단추가 있는 서랍을 실제로 다시 조작해도 닫힌 카드가 재마운트되면 안 된다.
    pointer_press(page, page.locator('#lg-panel-fold'))
    pointer_press(page, page.locator('#lg-panel-fold'))
    result_closed(checks, page, label + ' 서랍 접기·펼치기 뒤')


def forecast_marks(page):
    # 키가 추가되는 형식과 같은 키의 값이 갱신되는 형식을 모두 관찰한다.
    return page.evaluate("""() => Object.fromEntries(Object.keys(sessionStorage)
      .filter(k=>k.startsWith('kcp-fx-forecast-v1:')).sort()
      .map(k=>[k,sessionStorage.getItem(k)]))""")


def forecast_before_visible(checks, page, label, month, previous_marks, reduced):
    """총괄 추가 9항: 숨은 예보는 소비하지 않고 같은 달 새로고침 뒤 다시 표시.

    monthStart를 붙잡은 동안 서랍을 닫고 작은 창을 유지한다. 서랍 없이
    보류된 예보는 Esc 한 번에 닫힌다(160fc06 'Esc 한 번에 한 겹').
    재로딩은 390×844에서 시작해 최초 표시도 일반 예보와 같은 배치 규칙으로
    검사한다. 성공하면 inspect_cards의 (면 이름, 범위 이름)을, 실패하면 None을 돌려준다.
    """
    page.wait_for_function("""month => {
      const fx=KCP.fxTurn?.state?.();
      return fx?.forecastOpen===true && fx.deferred===true &&
        window.__fxEventProbe.some(r=>r.round===month && r.forecast);
    }""", arg=month, timeout=WAIT, polling='raf')
    data = page.evaluate("""month => {
      const dom=(""" + DOM_JS + """);
      const record=window.__fxEventProbe.find(r=>r.round===month && r.forecast);
      return {fx:KCP.fxTurn?.state?.(), record,
        visible:dom.cards().some(c=>c.visible) ||
          [...document.querySelectorAll('.fx-turn-layer')].some(dom.visible)};
    }""", month)
    if not checks.ok(data['record'] is not None and
                     data['record']['firstVisibleAt'] is None and not data['visible'] and
                     not page.locator('#lg-panel').is_visible() and
                     not page.locator('#bd-drawer').is_visible(),
                     label + ' 서랍 없는 보류 예보: firstVisibleAt null·실제 표시 0'):
        return None
    checks.ok(forecast_marks(page) == previous_marks,
              label + ' 실제 표시 전 sessionStorage 예보 소비 기록 추가 0')
    page.keyboard.press('Escape')
    checks.test(label + ' 미표시 예보 Esc 닫힘', lambda: bool(page.wait_for_function(
        '() => KCP.fxTurn?.state?.().forecastOpen===false', timeout=1000)))
    return forecast_reload_shows(checks, page, label, month, previous_marks, reduced)


def forecast_reload_shows(checks, page, label, month, previous_marks, reduced):
    """총괄 추가 9항의 뒤 절반: 표시 전에 닫힌 예보는 소비 기록 없이 같은 달 새로고침 뒤 실제로 다시 뜬다.

    보류 경로(forecast_before_visible)와 보조 판의 '보이기 전 닫힘' 분기가 함께 쓴다.
    성공하면 inspect_cards의 (면 이름, 범위 이름)을, 실패하면 None을 돌려준다.
    """
    page.wait_for_timeout(400)
    # 이미 닫힌 예보를 복원 크기에서 새로 읽는다. 숨겨진 최초 표본을
    # reduce의 '처음부터 보이는 확정 면' 검사에 잘못 쓰지 않게 한다.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.reload()
    page.wait_for_function(BOOT_JS)
    page.locator('#lg-bar').wait_for(state='visible', timeout=30000)
    state = wait_state(page, month, ['plan'])
    if not checks.test(label + ' 표시 전에 닫은 예보가 같은 달 새로고침 뒤 실제 표시',
                       lambda: bool(page.wait_for_function("""() => {
                  const dom=(""" + DOM_JS + """);
                  return KCP.fxTurn?.state?.().forecastOpen===true &&
                    (dom.cards().some(c=>c.visible) ||
                    [...document.querySelectorAll('.fx-turn-strip')].some(dom.visible));
                }""", timeout=WAIT))):
        return None
    marks = forecast_marks(page)
    checks.ok(any(value != previous_marks.get(key) for key, value in marks.items()),
              label + ' 실제 예보 표시 뒤 sessionStorage 예보 소비 기록 생성')
    # 재로딩 직후에는 서랍이 닫혀 있어 띠 조건(열린 서랍)이 성립하지 않는다. 일반 카드 면으로 검사한다.
    # 면 이름과 범위 이름을 돌려줘 다음 달 결과 카드의 앞·뒷면·'범위→확정' 단언과 분위기 표 실적에 쓴다.
    return inspect_cards(checks, page, [e['name'] for e in state['events'] if e['mine']],
                         True, label + ' 재로딩 예보', True, reduced)


def inspect_forecast_strip(checks, page, label, reduced):
    fx = observe(page)['fx'] or {}
    if fx.get('forecastOpen') is not True or not page.locator('#lg-panel').is_visible():
        return False
    strip = strip_geometry(checks, page, label + ' 예보', reduced)
    checks.ok(fx.get('strip') is True, label + ' 열린 서랍 앞 예보 state.strip true')
    if not strip:
        return False
    strip_title(checks, page, label + ' 예보', forecast=True)
    # 서랍 안 단추 터치가 예보를 닫는 회귀를 검출한다.
    pointer_press(page, page.locator('#lg-panel-fold'))
    checks.ok((observe(page)['fx'] or {}).get('forecastOpen') is True,
              label + ' 서랍 접기 단추 터치 뒤 예보 유지')
    pointer_press(page, page.locator('#lg-panel-fold'))
    checks.ok((observe(page)['fx'] or {}).get('forecastOpen') is True,
              label + ' 서랍 펼치기 단추 터치 뒤 예보 유지')
    # #75: 서랍을 다시 펼치면 열린 서랍 앞이므로 W4c 2절대로 띠가 다시 놓여야 한다. 예전에는 펼친 직후
    # 재배치가 끝나기 전에 state.strip을 읽어, 맥에서는 늘 false라 아래 펼치기 단언 3개가 두 모드·두 달 모두
    # SKIP이었고(SKIP 14 중 12), 느린 CI에서만 가끔 돌았다. 재배치가 끝날 때까지 기다린 뒤 늘 펼치기를 검사한다.
    # 띠가 끝내 다시 놓이지 않으면 expand_strip의 첫 단언('띠 안 펼치기 단추 1개')이 실패로 잡는다.
    try:
        page.wait_for_function("""() => {
          const p=document.querySelector('#lg-panel'), fx=KCP.fxTurn?.state?.();
          return !!p && !p.hidden && p.dataset.folded!=='true' && fx?.forecastOpen===true && fx.strip===true;
        }""", timeout=2000, polling='raf')
    except Exception as exc:
        print(f'INFO {label} 서랍 다시 펼친 뒤 2초 안에 예보 띠 재배치 없음: '
              f'{type(exc).__name__} {observe(page)["fx"]}', flush=True)
    return expand_strip(checks, page, label + ' 예보')


def seeded_fixtures():
    helper = Path(__file__).with_name('fx_event_seeds.js')
    result = subprocess.run(['node', str(helper), '--json'], check=True,
                            capture_output=True, text=True, timeout=120)
    fixtures = json.loads(result.stdout)
    targets = [key for fixture in fixtures for key in fixture['targets']]
    if sorted(targets) != sorted(EVENT_MOOD):
        raise AssertionError(f'고정 시작본의 분위기 표 {len(EVENT_MOOD)}항목 누락/중복: {targets}')
    return fixtures


def restore_fixture(checks, page, base, label, fixture):
    page.goto(base + '#league')
    page.wait_for_function(BOOT_JS)
    checks.ok(page.evaluate('() => localStorage.length') == 0, f'{label} 빈 저장소')
    # 숫자 씨앗 UI는 없고 room/fixed 선택만 있다. league.js #lg-solo-start와
    # 같은 newState→claim의 lobby 저장본을 s8n.py처럼 K_SOLO로 복원한다.
    # 활성 판이 없는 로비에서 넣어 pagehide 저장의 덮어쓰기를 피한다.
    # 사건은 비어 있으며 첫 달부터 host(next)의 정상 추첨을 거친다.
    page.evaluate("save => localStorage.setItem('kcp-league-solo-v1', JSON.stringify(save))",
                  fixture['save'])
    page.reload()
    page.wait_for_function(BOOT_JS)
    page.locator('#lg-solo-resume').click()
    page.locator('#lg-bar').wait_for(state='visible', timeout=30000)
    state = wait_state(page, 1, ['plan'])
    # 도시 이름은 자료에서 읽는다(D-58·D-86, #78). 이름표에만 쓴다.
    names = page.evaluate("""ids => ids.map(id => KCP.leagueCore.teamDef(
      KCP.leagueCore.regionOf('south'), id).name).join('·')""", ['pyeongtaek', 'dangjin'])
    checks.ok(state['months'] == 12 and state['team'] == 'pyeongtaek' and
              state['active'] == ['pyeongtaek', 'dangjin'],
              f'{label} 혼자 하기 {names} 12달')
    checks.ok(state['room'] == fixture['room'] and state['seedMode'] == 'room' and
              state['salt'] == fixture['salt'] and state['seedKey'] == str(fixture['salt']),
              f"{label} D-64 room 소금/씨앗 {fixture['salt']} 복원(사건 주입 없음)")
    checks.ok(state['setMapMood'] and all(key in (state['fx'] or {})
              for key in ('forecastOpen', 'mood', 'cardsOpen')),
              f'{label} fxTurn 공개 상태와 buildGame.setMapMood 존재')
    return state


def run_case(checks, page, base, label, mobile, reduced, fixture, coverage):
    """W4 예보·결과와 w4c2 1절 자리 확보 뒤 재표시·w4c4 3의 작은 창 띠를 검사한다."""
    restore_fixture(checks, page, base, label, fixture)
    saw_forecast, saw_result, saw_empty, saw_range = False, False, False, False
    strip_click, strip_expand = False, False
    small_viewport = False  # 직전 달 보류→미표시 예보 재로딩 검사를 수행했는지
    reload_seen = None  # 그 재로딩 예보에서 inspect_cards가 돌려준 (면 이름, 범위 이름)
    for month in range(1, 13):
        small_carry, carried = small_viewport, reload_seen
        reload_seen = None
        state = wait_state(page, month, ['plan'])
        prefix = f'{label} {month}월'
        checks.ok([e['id'] for e in state['events']] ==
                  [e['id'] for e in fixture['months'][month - 1]['events']],
                  f'{prefix} Node 정상 운영과 자연 사건 목록·순서 일치')
        mine = [e['name'] for e in state['events'] if e['mine']]
        forecast_expanded = False
        if mine:
            # forecastStart는 배치 뒤 두 RAF에 실행된다. 단계 변경만 기다려
            # 이전 mood를 읽지 않고, 실제 예보가 열린 뒤 표를 검사한다.
            page.wait_for_function('() => KCP.fxTurn?.state?.().forecastOpen === true',
                                   timeout=WAIT)
            state = observe(page)
            if mobile:
                forecast_expanded = inspect_forecast_strip(checks, page, prefix, reduced)
                if forecast_expanded:
                    coverage['paths'].add('forecast-strip')
        forecast_names = set()
        forecast_range_names = set()
        selected = mood(checks, state, prefix + ' 계획', coverage['plan'])
        for key, target in fixture['targets'].items():
            if target == month:
                checks.ok(selected == key, f'{prefix} 필수 표 항목 {key}가 내 도시 우선 사건')
        if mine and small_carry:
            # 이전 반복 끝의 forecast_before_visible에서 재로딩 예보의 실제 면·배치를
            # 이미 검사했다. 그 결과로 면·범위 이름과 분위기 표 실적을 채우고(배정 달에 따라
            # 필수 표 항목이 이 달에만 있을 수 있다), 중복 순회 없이 같은 예보를 닫는다.
            forecast_names, forecast_range_names = carried or (set(), set())
            if selected and any(e['id'] == selected and e['name'] in forecast_names
                                for e in state['events'] if e['mine']):
                coverage['forecast'].add(selected)
            saw_range = saw_range or bool(forecast_range_names)
            dismiss_forecast(checks, page, state, prefix, False)
            mood(checks, observe(page), prefix + ' 예보 닫은 뒤', set())
        elif mine:
            forecast_names, forecast_range_names = inspect_cards(
                checks, page, mine, True, prefix + ' 예보', mobile, reduced,
                strip_expanded=forecast_expanded)
            if selected and any(e['id'] == selected and e['name'] in forecast_names
                                for e in state['events'] if e['mine']):
                coverage['forecast'].add(selected)
            saw_range = saw_range or bool(forecast_range_names)
            if not saw_forecast:
                screenshot(checks, page, f'fx-event-{label}-forecast.png')
            dismiss_forecast(checks, page, state, prefix, not saw_forecast)
            saw_forecast = True
            mood(checks, observe(page), prefix + ' 예보 닫은 뒤', set())
        else:
            checks.ok((state['fx'] or {}).get('forecastOpen') is False and
                      not any(c['tag'] == '사건 예보' for c in state['cards']),
                      f'{prefix} 내 도시 사건 없는 달 예보 열림 0')
            if not state['events']:
                saw_empty = True
        # 첫 달 코치도 최초 카드 겹침 검사에 포함한 다음 화면 단추로 닫는다.
        coach = page.locator('#lg-guide-close')
        if coach.count() and coach.is_visible():
            coach.click()
        result = click_progress(page, observe(page))
        checks.ok(result['round'] == month and result['resultRound'] == month and
                  result['count'] == month, f'{prefix} 화면 단추 → 같은 달 결과')
        # 일반 모드는 playing 중 표본이어야 한다. reduce는 재생 금지이므로
        # 즉시 결과 mood를 검사한다. 두 모드를 같은 실행 집계로 숨기지 않는다.
        if not reduced:
            page.wait_for_function('() => KCP.fxTurn?.state?.().playing === true',
                                   timeout=WAIT)
            result = observe(page)
        replay_state = (result['fx'] or {})
        replay_valid = checks.ok(
            (replay_state.get('playing') is False and replay_state.get('ms') == 0)
            if reduced else replay_state.get('playing') is True,
            f'{prefix} ' + ('reduce 재생 없이 결과 표시' if reduced else '실제 결과 재생 중 표본'))
        mood(checks, result, prefix + ' 결과/재생',
             coverage['result'] if replay_valid else set())
        next_with_cards = False
        small_viewport = False
        action = 'expand'
        if mobile and result['resultEvents']:
            # 첫 사건은 기존 펼치기 검사를 유지하고 이후 서로 다른 달을 배정한다.
            if strip_expand:
                action = next((name for name in
                               ('map', 'esc', 'timeout', 'late-tab', 'deferred-recover', 'deferred-next')
                               if name not in coverage['paths'] and
                               (month < 12 or not name.startswith('deferred')) and
                               (name != 'deferred-next' or
                                fixture['months'][month]['selected'] is not None)), 'expand')
            if reduced and action != 'late-tab' and (observe(page)['fx'] or {}).get('cardsOpen'):
                # 움직임 줄이기는 재생·결산 없이 카드가 즉시 뜬다(W4 reduce 계약). '카드가 뜨기 전에
                # 서랍 열기' 창이 없으므로, 결과 단계가 자동으로 연 결과 서랍 그대로 띠를 검사한다.
                # 마우스·터치로 여는 경로(총괄 지시)는 움직임 있음 경우에서 필수로 남긴다.
                checks.ok(page.locator('#lg-panel').is_visible(),
                          prefix + ' reduce: 결과 단계 자동 결과 서랍 열림')
                coverage['paths'].add('auto-open')
            else:
                open_result_by_pointer(checks, page, prefix, late=action == 'late-tab',
                                       touch=strip_expand)
                # 첫 달은 page.mouse, 다음 달부터 page.touchscreen 경로로 연다.
                coverage['paths'].add('mouse-open' if not strip_expand else 'touch-open')
        # 일반 재생은 Esc 한 번으로 끝내고 요약→카드는 자연 타이머로 기다린다.
        if not mobile and (result['fx'] or {}).get('playing'):
            page.keyboard.press('Escape')
        if result['resultEvents']:
            if action != 'late-tab':
                page.wait_for_function('() => KCP.fxTurn?.state?.().cardsOpen === true',
                                       timeout=WAIT)
            shown_at = page.evaluate("""month => {
              const record=window.__fxEventProbe.find(r=>r.round===month && !r.forecast);
              return record?.firstVisibleAt ?? performance.now();
            }""", month)
            wait_unfolded(page)
            names = [e['name'] for e in result['events'] if e['id'] in result['resultEvents']]
            if mine:
                checks.ok(all(name in names for name in mine),
                          f'{prefix} 예보한 내 도시 사건이 같은 달 결과에도 존재')
            if mobile and action == 'late-tab':
                coverage['paths'].add(action)
            elif mobile:
                page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                strip_ready = strip_geometry(checks, page, prefix + ' 자동 결과', reduced)
                strip_title(checks, page, prefix)
                if not saw_result:
                    screenshot(checks, page, f'fx-event-{label}-confirmed.png')
                if strip_ready:
                    drawer_blank_touch(checks, page, prefix)
                    if not strip_click:
                        strip_click = strip_drawer_click(checks, page, prefix, reduced)
                expanded = False
                if strip_ready and action == 'expand' and (observe(page)['fx'] or {}).get('cardsOpen') is True:
                    expanded = expand_strip(checks, page, prefix)
                if expanded:
                    strip_expand = True
                    if not saw_result:
                        screenshot(checks, page, f'fx-event-{label}-expanded.png')
                    # 명시적 펼치기 뒤에는 W4c 3절이 data-over를 허용한다.
                    inspect_cards(checks, page, names, False, prefix + ' 펼친 확정', mobile, reduced,
                                  forecast_names=forecast_names,
                                  forecast_range_names=forecast_range_names, strip_expanded=True)
                    close_expanded_strip(checks, page, prefix)
                elif strip_ready and action == 'map':
                    map_touch(checks, page, prefix)
                    coverage['paths'].add(action)
                elif strip_ready and action == 'esc':
                    drawer_open = page.locator('#lg-panel').is_visible()
                    page.keyboard.press('Escape')
                    if drawer_open:
                        checks.ok(not page.locator('#lg-panel').is_visible(),
                                  prefix + ' 별도 달 Esc1 서랍만 닫힘')
                        deck_stays_open(checks, page, prefix + ' 별도 달 Esc1 덱 유지')
                        page.keyboard.press('Escape')
                    result_closed(checks, page, prefix + ' 별도 달 Esc')
                    coverage['paths'].add(action)
                elif strip_ready and action == 'timeout':
                    strip_timeout(checks, page, prefix, shown_at)
                    coverage['paths'].add(action)
                elif strip_ready and action.startswith('deferred'):
                    deferred_probe(checks, page, prefix,
                                   recover=action == 'deferred-recover')
                    coverage['paths'].add(action)
                    coverage['paths'].add('deferred-observed')
                    small_viewport = action == 'deferred-next'
                    next_with_cards = True
                else:
                    page.keyboard.press('Escape')
            else:
                # W4c 6절: 1280×900의 기존 카드·겹침·바깥 클릭 단언은 그대로.
                inspect_cards(checks, page, names, False, prefix + ' 확정', mobile, reduced,
                              forecast_names=forecast_names,
                              forecast_range_names=forecast_range_names)
                if not saw_result:
                    screenshot(checks, page, f'fx-event-{label}-confirmed.png')
                    outside_click(checks, page, prefix)
                else:
                    page.keyboard.press('Escape')
            saw_result = True
        else:
            checks.ok((observe(page)['fx'] or {}).get('cardsOpen') is False,
                      f'{prefix} 사건 없는 결과 cardsOpen false')
            page.keyboard.press('Escape')
        if not small_viewport:
            overflow(checks, page, prefix + ' 결과')
        if month < 12:
            previous_marks = forecast_marks(page) if mobile else {}
            if next_with_cards:
                checks.ok((observe(page)['fx'] or {}).get('cardsOpen') is True,
                          prefix + ' 다음 달 단추 입력 직전 지난달 카드 열린 상태')
            if small_viewport:
                # Esc1 보조 판과 같은 호출 붙잡기. 다음 달의 실제 인자·receiver를
                # 보존하고, 작은 창·서랍 닫힘을 확인한 뒤 최초 예보를 마운트한다.
                page.evaluate("""() => {
                  const held={original:KCP.fxTurn.monthStart, calls:[]};
                  window.__fxDeferredMonthStart=held;
                  KCP.fxTurn.monthStart=function(...args) {
                    held.calls.push({receiver:this, args});
                  };
                }""")
                try:
                    click_progress(page, observe(page), preserve_drawer=True, keyboard=True)
                    plan_cleanup(checks, page, month + 1, prefix)
                    coverage['paths'].add('plan-cleanup')
                    page.wait_for_function("""month =>
                      window.__fxDeferredMonthStart.calls.some(c=>c.args[0]?.round===month)
                    """, arg=month + 1, timeout=WAIT)
                    # plan 전환은 결과 서랍과 건설 서랍을 닫는다. 예보 호출을 풀기
                    # 전에 그 조건을 기다려 Esc1이 서랍에 소비되지 않게 한다.
                    page.wait_for_function("""() =>
                      !document.querySelector('#lg-panel:not([hidden])') &&
                      !document.documentElement.classList.contains('bd-drawer-open')
                    """, timeout=2000)
                    page.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                    page.evaluate("""() => {
                      const held=window.__fxDeferredMonthStart;
                      KCP.fxTurn.monthStart=held.original;
                      for (const call of held.calls.splice(0))
                        held.original.apply(call.receiver, call.args);
                    }""")
                    reload_seen = forecast_before_visible(checks, page, prefix, month + 1,
                                                          previous_marks, reduced)
                    if reload_seen is not None:
                        coverage['paths'].add('forecast-reload')
                finally:
                    try:
                        page.evaluate("""() => {
                          const held=window.__fxDeferredMonthStart;
                          if (held) KCP.fxTurn.monthStart=held.original;
                          delete window.__fxDeferredMonthStart;
                        }""")
                    except Exception:
                        pass  # 재로딩 중 예외면 문맥이 사라졌다. 원래 예외를 가리지 않는다.
                    # 보류 단언이 실패해 일찍 돌아오면 320×48 창이 남아 뒤 달이 연쇄로 실패하고
                    # 원인을 가린다. 성공 경로는 forecast_reload_shows가 이미 되돌렸으므로 다를 때만 바꾼다.
                    if page.viewport_size != {'width': 390, 'height': 844}:
                        try:
                            page.set_viewport_size({'width': 390, 'height': 844})
                        except Exception:
                            pass  # 원래 예외를 가리지 않는다.
            else:
                click_progress(page, observe(page), preserve_drawer=next_with_cards)
                if next_with_cards:
                    plan_cleanup(checks, page, month + 1, prefix)
                    coverage['paths'].add('plan-cleanup')
    checks.ok(saw_forecast and saw_result,
              f'{label} 자연 사건 예보·확정·Esc·중복·새로고침·클릭 전달 실행')
    checks.ok(saw_range, f'{label} 실제 범위 예보→확정 문장 검사 실행')
    checks.ok(saw_empty, f'{label} 사건 없는 달 mood null 검사 실행')
    if mobile:
        checks.ok(strip_expand, f'{label} W4c 결과 띠 펼치기·Esc 검사 실행')
        checks.ok(strip_click, f'{label} W4c 결과 띠 열린 채 S8 유지 단추 클릭 전달 검사 실행')


def esc_one_layer(checks, page, base, label, reduced, fixture, coverage):
    """총괄 규칙 a~e: 한 Esc를 처리한 층 이외의 카드/서랍은 남아야 한다.

    첫 고정 방의 자연 사건 1·2·4·6월을 사용한다. 기대값은 규칙 문장에서
    정하며, monthStart 감싸기는 호출 시점만 고정하고 인자/상태는 바꾸지 않는다.
    """
    class TimedChecks(Checks):
        # 자동 닫힘과 구별할 수 없는 판은 FAIL을 출력하기 전에 통째로 제외한다.
        def __init__(self):
            self.pending = []
            self.shown_at = None
            self.sample_key = None

        def ok(self, condition, message):
            self.pending.append((bool(condition), message))
            return bool(condition)

        def start_clock(self, month, forecast):
            self.sample_key = [month, forecast]
            age_ms = page.wait_for_function("""([month, forecast]) => {
              const dom=(""" + DOM_JS + """);
              const fx=KCP.fxTurn?.state?.();
              const record=window.__fxEventProbe.find(
                r=>r.round===month && r.forecast===forecast);
              const shown=dom.cards().some(c=>c.visible) ||
                [...document.querySelectorAll('.fx-turn-strip')].some(dom.visible);
              if (!fx?.cardsOpen || fx.forecastOpen!==forecast || fx.playing ||
                  !shown || record?.firstVisibleAt==null) return false;
              return {age:performance.now()-record.firstVisibleAt};
            }""", arg=[month, forecast], timeout=WAIT).json_value()['age']
            # DOM 최초 표시 시각을 monotonic 시간축으로 옮긴다. locator 대기
            # 중 흐른 시간까지 포함해 마지막 단언까지의 8초를 판정한다.
            self.shown_at = time.monotonic() - age_ms / 1000

        def flush(self, prefix):
            if self.shown_at is None and self.sample_key is not None:
                # 대기 중 이미 자동으로 닫혀도 최초 표시 기록으로 시간을 복구한다.
                age_ms = page.evaluate("""([month, forecast]) => {
                  const record=window.__fxEventProbe.find(
                    r=>r.round===month && r.forecast===forecast);
                  return record?.firstVisibleAt==null ? null :
                    performance.now()-record.firstVisibleAt;
                }""", self.sample_key)
                if age_ms is not None:
                    self.shown_at = time.monotonic() - age_ms / 1000
            elapsed = (time.monotonic() - self.shown_at
                       if self.shown_at is not None else None)
            if elapsed is None and self.sample_key is not None:
                # 기록이 끝내 없으면 덱 기록 상태를 남겨 다음 간헐 실패를 로그만으로 가른다(#56).
                probe = page.evaluate("""([month, forecast]) => {
                  const r=window.__fxEventProbe.filter(r=>r.round===month && r.forecast===forecast).pop();
                  return r ? {first:r.first?.at, later:r.later?.at, firstVisibleAt:r.firstVisibleAt} : null;
                }""", self.sample_key)
                print(f'INFO {prefix} 첫 표시 기록 없음: {probe}', flush=True)
            if elapsed is not None and elapsed > 8:
                print(f'INFO {prefix} 표시 후 {elapsed:.2f}초 > 8초: '
                      '10초 자동 닫힘과 구별 불가하므로 이 판의 단언은 채점하지 않음', flush=True)
                return False
            for condition, message in self.pending:
                checks.ok(condition, message)
            return True

    city = page.locator('#lg-bar [data-panel="city"]')
    panel = page.locator('#lg-panel')
    touch = page.viewport_size['width'] == 390
    trials = {1: 'coach', 2: 'drawer', 4: 'focus', 6: 'dialog'}
    restore_fixture(checks, page, base, label + ' Esc1', fixture)
    try:
        for month in range(1, 7):
            state = wait_state(page, month, ['plan'])
            kind = trials.get(month)
            prefix = f'{label} Esc1 {month}월 {kind or "진행"}'
            timed = TimedChecks()
            forecast_strip = False
            try:
                if kind and month != 1:
                    page.wait_for_function("""month =>
                      window.__fxEscMonthStart?.calls.some(c=>c.args[0]?.round===month)
                    """, arg=month, timeout=WAIT)
                    pointer_press(page, city, touch=touch)
                    panel.wait_for(state='visible', timeout=1000)
                    timed.ok(panel.get_attribute('data-tab') == 'city',
                             prefix + ' 예보 마운트 전 실제 포인터로 도시 서랍 열림')
                    if kind == 'dialog':
                        # econui.u_plan_contract의 실제 도움말 열기 경로를 재사용.
                        page.locator('#bd-help').click()
                        page.locator('#lg-help').wait_for(state='visible')
                        page.locator('#lg-build-help').click()
                        page.locator('#bd-help-dlg[open]').wait_for(state='visible')
                    page.evaluate("""() => {
                      const held=window.__fxEscMonthStart;
                      for (const call of held.calls.splice(0))
                        held.original.apply(call.receiver, call.args);
                    }""")
                if kind:
                    timed.start_clock(month, True)
                    timed.ok((observe(page)['fx'] or {}).get('forecastOpen') is True,
                             prefix + ' 실제 예보 열린 상태에서 시작')
                    if kind == 'coach':
                        timed.ok(page.locator('#lg-coach').is_visible(),
                                 prefix + ' 첫 달 코치 보임')
                        # c: 기존 코치 Esc1/예보 Esc2 단언을 중복 작성하지 않는다.
                        dismiss_forecast(timed, page, state, prefix, False)
                    elif kind == 'drawer':
                        fx = observe(page)['fx'] or {}
                        if touch:
                            forecast_strip = (panel.is_visible() and fx.get('strip') is True and
                                              page.locator('.fx-turn-strip:visible').count() == 1)
                            timed.ok(forecast_strip, prefix + ' 도시 서랍 앞 예보 띠 실제 표시')
                        else:
                            # 1280은 서랍이 지도를 덮지 않아 띠가 아니라 카드로 보인다(맨 위 층 아님).
                            timed.ok(panel.is_visible() and fx.get('strip') is not True and
                                     page.locator('.fx-turn-card-row:visible').count() == 1,
                                     prefix + ' 도시 서랍과 함께 예보 카드 실제 표시')
                        # 덱 밖인 서랍 안에 초점을 두어 실제 복귀 동작까지 검출한다.
                        # 처음부터 도시 탭에 두면 복귀하지 않는 회귀를 놓치게 된다.
                        page.locator('#lg-panel-fold').focus()
                        timed.ok(page.locator('#lg-panel-fold').evaluate(
                            'el => el===document.activeElement'),
                            prefix + ' Esc 전 초점이 서랍 안·덱 밖')
                        page.keyboard.press('Escape')
                        timed.ok(not panel.is_visible() and
                                 (observe(page)['fx'] or {}).get('forecastOpen') is True,
                                 prefix + ' Esc1 도시 서랍만 닫히고 예보 유지')
                        timed.test(prefix + ' Esc1 도시 탭으로 초점 복귀', lambda: bool(
                            page.wait_for_function("""() => document.activeElement===
                              document.querySelector('#lg-bar [data-panel="city"]')
                            """, timeout=1000)))
                        page.keyboard.press('Escape')
                        timed.test(prefix + ' Esc2 예보 닫힘', lambda: bool(
                            page.wait_for_function("""() =>
                              KCP.fxTurn?.state?.().forecastOpen===false
                            """, timeout=1000)))
                    elif kind == 'focus':
                        # 펼치지 않고 덱 안의 실제 초점 가능 단추로 이동한다.
                        # 띠(390)는 펼치기 단추, 카드(1280)는 닫기 단추가 덱 안의 초점 가능 요소다.
                        target = page.locator('.fx-turn-cards ' +
                                              ('.fx-turn-expand' if touch else '.fx-turn-close'))
                        target.focus()
                        timed.ok(target.is_visible() and
                                 (not touch or target.get_attribute('aria-expanded') == 'false') and
                                 page.evaluate("""() => !!document.activeElement?.closest(
                                   '.fx-turn-cards')""") and panel.is_visible(),
                                 prefix + ' 펼치기 전 덱 안 초점·도시 서랍 열림')
                        page.keyboard.press('Escape')
                        timed.test(prefix + ' Esc 예보만 닫힘', lambda: bool(
                            page.wait_for_function("""() =>
                              KCP.fxTurn?.state?.().forecastOpen===false
                            """, timeout=1000)))
                        timed.ok(panel.is_visible() and panel.get_attribute('data-tab') == 'city',
                                 prefix + ' Esc 뒤 도시 서랍 유지')
                    else:
                        dialog = page.locator('#bd-help-dlg[open]')
                        timed.ok(dialog.is_visible(), prefix + ' 네이티브 dialog[open] 보임')
                        # close는 keydown보다 늦다. 기존 econui 검사처럼 이벤트까지 기다린다.
                        page.evaluate("""() => {
                          window.__fxEscHelpClosed=false;
                          document.querySelector('#bd-help-dlg').addEventListener('close',
                            () => { window.__fxEscHelpClosed=true; }, {once:true});
                        }""")
                        page.keyboard.press('Escape')
                        timed.test(prefix + ' Esc 대화상자만 닫힘', lambda: bool(
                            page.wait_for_function("""() => window.__fxEscHelpClosed &&
                              !document.querySelector('dialog[open]')""", timeout=1000)))
                        timed.ok((observe(page)['fx'] or {}).get('forecastOpen') is True,
                                 prefix + ' Esc 뒤 예보 유지(dialog에 양보)')
            except Exception as exc:
                timed.ok(False, f'{prefix} 예외 {type(exc).__name__}: '
                         f'{str(exc).splitlines()[0][:200]}')
            finally:
                timed.flush(prefix)
                # 실행 경로와 시간 안의 규칙 판정은 구분한다. 8초 초과 판도 실제로
                # 띠를 봤다면 경로는 실행했으므로 필수 coverage로 간접 실패시키지 않는다.
                if forecast_strip:
                    coverage['paths'].add('forecast-strip')
                page.evaluate("""() => {
                  const held=window.__fxEscMonthStart;
                  if (held) KCP.fxTurn.monthStart=held.original;
                  delete window.__fxEscMonthStart;
                }""")

            # 실패 뒤에도 다음 독립 자연 사건으로 진행하기 위한 화면 조작이다.
            if page.locator('dialog[open]').count():
                page.locator('dialog[open]').press('Escape')
            coach = page.locator('#lg-guide-close')
            if coach.count() and coach.is_visible():
                coach.click()
            if (observe(page)['fx'] or {}).get('forecastOpen'):
                page.locator('.fx-turn-cards button:visible').first.press('Escape')
            if month == 6:
                break
            result = click_progress(page, observe(page))
            if month == 1 or result['resultEvents']:
                timed = TimedChecks()
                prefix = f'{label} Esc1 {month}월 result'
                try:
                    timed.start_clock(month, False)
                    if month == 1:
                        fx = observe(page)['fx'] or {}
                        shown_cards = (fx.get('strip') is True and
                                       page.locator('.fx-turn-strip:visible').count() == 1 and
                                       not page.locator('.fx-turn-expand[aria-expanded="true"]').count()
                                       ) if touch else (fx.get('strip') is not True and
                                       page.locator('.fx-turn-card-row:visible').count() == 1)
                        timed.ok(panel.is_visible() and panel.get_attribute('data-tab') == 'result' and
                                 shown_cards,
                                 prefix + (' 결과 서랍·펼치지 않은 결과 띠 보임' if touch else
                                           ' 결과 서랍·결과 카드 보임'))
                        page.locator('#lg-bar [data-panel="result"]').focus()
                        page.keyboard.press('Escape')
                        timed.ok(not panel.is_visible(), prefix + ' Esc1 결과 서랍만 닫힘')
                        if touch:
                            deck_stays_open(timed, page, prefix + ' Esc1 결과 덱 유지')
                        else:
                            timed.ok((observe(page)['fx'] or {}).get('cardsOpen') is True and
                                     page.locator('.fx-turn-card-row:visible').count() == 1,
                                     prefix + ' Esc1 결과 카드 유지')
                        page.keyboard.press('Escape')
                        result_closed(timed, page, prefix + ' Esc2 결과 카드 닫힘')
                except Exception as exc:
                    timed.ok(False, f'{prefix} 예외 {type(exc).__name__}: '
                             f'{str(exc).splitlines()[0][:200]}')
                finally:
                    timed.flush(prefix)
                if (observe(page)['fx'] or {}).get('cardsOpen'):
                    page.locator('.fx-turn-cards button:visible').first.press('Escape')
            if month + 1 in trials:
                # 다음 달 진행 전에 포착한다. league는 호출마다 공개 함수를 찾는다.
                page.evaluate("""() => {
                  const held={original:KCP.fxTurn.monthStart, calls:[]};
                  window.__fxEscMonthStart=held;
                  KCP.fxTurn.monthStart=function(...args) {
                    held.calls.push({receiver:this, args});
                  };
                }""")
            click_progress(page, observe(page))
    finally:
        page.evaluate("""() => {
          const held=window.__fxEscMonthStart;
          if (held) KCP.fxTurn.monthStart=held.original;
          delete window.__fxEscMonthStart;
        }""")


def run_forecast_case(checks, page, base, label, reduced, fixture, coverage):
    """B: 최종 표시 상태를 기다리고, 예보 마운트 전 서랍을 확정한다.

    기존 Esc1과 같은 monthStart 붙잡기를 쓴다. 원래 receiver/인자와 실제
    화면 진행을 보존하며, 전환 중인 짧은 틱/playing===true를 기다리지 않는다.
    미표시 닫힘→재로딩 계약은 run_case의 필수 forecast-reload 경로에 그대로 있다.
    """
    probes = {month: ForecastProbeChecks(checks, f'{label} {month + 1}월', reduced)
              for month in (1, 2)}
    current = probes[1]
    try:
        restore_fixture(checks, page, base, label, fixture)
        coach = page.locator('#lg-guide-close')
        if coach.count() and coach.is_visible():
            coach.click()
        for month in (1, 2):
            current = probes[month]
            # 일반/reduce 공통으로 결과 재생이 끝난 최종 상태를 기다린다.
            page.keyboard.press('Escape')
            result = click_progress(page, observe(page))
            page.wait_for_function('() => KCP.fxTurn?.state?.().playing===false', timeout=WAIT)
            if result['resultEvents']:
                page.wait_for_function("""() => {
                  const D=""" + DOM_JS + """, fx=KCP.fxTurn?.state?.();
                  return fx?.cardsOpen===true && !fx.forecastOpen && !fx.playing &&
                    (D.cards().some(c=>c.visible)||
                     [...document.querySelectorAll('.fx-turn-strip')].some(D.visible));
                }""", timeout=WAIT)
            page.keyboard.press('Escape')
            previous_marks = forecast_marks(page)
            # 두 RAF 안에 서랍을 누르려던 경쟁을 없앤다. 사건/달을 주입하지 않는다.
            page.evaluate("""() => {
              const held={original:KCP.fxTurn.monthStart,calls:[]};
              window.__fxForecastProbeMonthStart=held;
              KCP.fxTurn.monthStart=function(...args){held.calls.push({receiver:this,args});};
            }""")
            state = click_progress(page, observe(page), after_progress=lambda: pointer_press(
                page, page.locator('#lg-bar [data-panel="city"]')))
            page.locator('#lg-panel').wait_for(state='visible', timeout=2000)
            page.wait_for_function("""month=>window.__fxForecastProbeMonthStart.calls.some(
              c=>c.args[0]?.round===month)""", arg=month + 1, timeout=WAIT)
            page.evaluate("""() => {
              const held=window.__fxForecastProbeMonthStart;
              KCP.fxTurn.monthStart=held.original;
              for(const call of held.calls.splice(0))held.original.apply(call.receiver,call.args);
              delete window.__fxForecastProbeMonthStart;
            }""")
            if not any(e['mine'] for e in state['events']):
                current.reason = '내 도시 예보가 없는 달'
                continue
            # reduce는 즉시 최종 상태가 된다. 중간 애니메이션/고정 200ms 대기를 요구하지 않는다.
            page.wait_for_function("""() => {
              const D=""" + DOM_JS + """,fx=KCP.fxTurn?.state?.();
              return fx?.forecastOpen===true && !fx.playing && !fx.deferred &&
                D.visible(document.querySelector('#lg-panel')) &&
                [...document.querySelectorAll('.fx-turn-layer')].some(D.visible);
            }""", timeout=WAIT)
            if inspect_forecast_strip(current, page, f'{label} {month + 1}월', reduced):
                coverage['paths'].add('forecast-strip')
            # #75: 사용자 펼치기 단언이 실제로 돌아 통과했는지 경로로 남긴다(main의 '경로 실행' 단언).
            expanded = current.pending.get(
                f'{label} {month + 1}월 예보 사용자 펼치기 뒤 aria-expanded=true·카드 표시')
            if expanded and all(ok for ok, _ in expanded):
                coverage['paths'].add('forecast-expand')
            marks = forecast_marks(page)
            current.ok(any(value != previous_marks.get(key) for key, value in marks.items()),
                       f'{label} {month + 1}월 예보 실제 표시 뒤 sessionStorage 소비 기록 있음')
            page.keyboard.press('Escape')
    except Exception as exc:
        current.health = False
        current.reason = f'{type(exc).__name__}: {str(exc).splitlines()[0][:200]}'
        print(f'INFO {label} 보조 예보 진행 예외: {current.reason}', flush=True)
    finally:
        # 예외 중에도 패치를 남기거나 다음 달 이름을 빠뜨리지 않는다.
        try:
            page.evaluate("""() => {
              const held=window.__fxForecastProbeMonthStart;
              if(held)KCP.fxTurn.monthStart=held.original;
              delete window.__fxForecastProbeMonthStart;
            }""")
        finally:
            for probe in probes.values():
                probe.flush()


class MotionBrowser:
    """econui의 밝음/네트워크 격리에 생성 시 reduced-motion 설정을 더한다."""

    def __init__(self, browser, reduced):
        self.browser = browser
        self.reduced = reduced

    def new_context(self, **options):
        if options.get('viewport', {}).get('width') == 390:
            options['has_touch'] = True
        return self.browser.new_context(
            reduced_motion='reduce' if self.reduced else 'no-preference', **options)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        fixtures = seeded_fixtures()
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in ((1280, 900), (390, 844)):
                    for reduced in (False, True):
                        label = f'{width}x{height}-light-' + ('reduce' if reduced else 'motion')
                        coverage = {stage: set() for stage in ('plan', 'forecast', 'result')}
                        coverage['paths'] = set()
                        for fixture in fixtures:
                            case_label = f"{label}-{fixture['room']}"
                            print(f"INFO {case_label} room 씨앗 {fixture['salt']} 자연 사건 12달",
                                  flush=True)
                            context, external = context_for(MotionBrowser(browser, reduced),
                                                            base, width, height, 'light')
                            context.add_init_script(PROBE_JS)
                            page, events = monitored_page(context)
                            try:
                                run_case(checks, page, base, case_label, width == 390,
                                         reduced, fixture, coverage)
                            except Exception as exc:
                                checks.ok(False, f'{case_label} 진행 예외 {type(exc).__name__}: '
                                          f'{str(exc).splitlines()[0][:200]}')
                                screenshot(checks, page, f'fx-event-{case_label}-failure.png')
                            finally:
                                overflow(checks, page, case_label + ' 마지막 화면')
                                diagnostics(checks, events, case_label)
                                checks.ok(not external, f'{case_label} 외부 연결 시도 0: {external}')
                                context.close()
                        # Esc 계층 검사는 각 크기·motion마다 별도 저장소에서 한 번 실행한다.
                        context, external = context_for(MotionBrowser(browser, reduced),
                                                        base, width, height, 'light')
                        context.add_init_script(PROBE_JS)
                        page, events = monitored_page(context)
                        try:
                            esc_one_layer(checks, page, base, label, reduced,
                                          fixtures[0], coverage)
                        except Exception as exc:
                            checks.ok(False, f'{label} Esc1 진행 예외 {type(exc).__name__}: '
                                      f'{str(exc).splitlines()[0][:200]}')
                        finally:
                            diagnostics(checks, events, label + ' Esc1')
                            checks.ok(not external, f'{label} Esc1 외부 연결 시도 0: {external}')
                            context.close()
                        if width == 390:
                            probe_label = label + '-forecast-probe'
                            context, external = context_for(MotionBrowser(browser, reduced),
                                                            base, width, height, 'light')
                            context.add_init_script(PROBE_JS)
                            page, events = monitored_page(context)
                            try:
                                run_forecast_case(checks, page, base, probe_label, reduced,
                                                  fixtures[0], coverage)
                            except Exception as exc:
                                checks.ok(False, f'{probe_label} 진행 예외 {type(exc).__name__}: '
                                          f'{str(exc).splitlines()[0][:200]}')
                            finally:
                                diagnostics(checks, events, probe_label)
                                checks.ok(not external, f'{probe_label} 외부 연결 시도 0: {external}')
                                context.close()
                        # 한 판에서 우연히 본 id나 결과만 본 id로 표 실행을 세지 않는다.
                        # 화면 크기·motion 각각에서 표의 모든 사건×3단계가 실행돼야 한다.
                        for key in EVENT_MOOD:
                            for stage in ('plan', 'forecast', 'result'):
                                checks.ok(key in coverage[stage],
                                          f'{label} 필수 분위기 표 {key} {stage} 실행')
                        if width == 390:
                            # 띠는 서랍이 지도를 덮는 좁은 화면의 모양이다. 1280은 같은 Esc 규칙을 카드로 판정한다.
                            checks.ok('forecast-strip' in coverage['paths'],
                                      f'{label} Esc1 forecast-strip 경로 실행')
                            opens = ('auto-open',) if reduced else ('mouse-open', 'touch-open')
                            for path in opens + ('map', 'esc', 'timeout',
                                         'late-tab', 'deferred-recover', 'deferred-next',
                                         'deferred-observed', 'forecast-reload', 'plan-cleanup',
                                         'forecast-expand'):
                                checks.ok(path in coverage['paths'], f'{label} {path} 경로 실행')
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
