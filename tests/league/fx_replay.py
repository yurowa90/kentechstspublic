"""품질8 W1/W1b: 실제 달 재생의 엔진·기기 재계산과 공개 정산 일치 검사.

실행: python3 tests/league/fx_replay.py http://127.0.0.1:<포트>/index.html
브라우저 실행은 총괄이 샌드박스 밖 로컬에서 담당한다.

검사 목록: 빈 저장소·혼자 하기 12달, 1/2월 재생 자료의 시간별 부족 합과
정전 시간 검산, 기기 재계산 합계·정전 시간·무거래 시간별 비교,
진행자 1+팀 2의 엔진 없는 태블릿 재생·CPU rate 4 지연,
설비·내부 전선·연계선을 지은 달의 거래 및 양쪽 태블릿/진행자 합계 비교,
부분 거래의 imp·uns·outH 양수 및 고립 부족 감소, 평택 보정 재생 검산,
혼자 하기 1월 fx:replay start/end 횟수·Esc skipped·reduce 이벤트 없음,
결과 진입 직후 playing/ms/서랍, Esc 300ms 이내 건너뛰기,
자연 발생 사건의 결산+사건 카드와 Esc 닫기, 사건 없는 달의 카드 금지,
별도 reduce 컨텍스트의 재생 없음·즉시 최종 요약, 저장·상태·공개 스냅샷의
금지 키, 1280×900/390×844 가로 스크롤과 콘솔 error/warning/pageerror.

해석 기록(last.md 별도 작성이 허용되지 않으면 이 주석과 최종 보고 사용):
- solo.py의 진행 단추/약속·건너뛰기 절차를 따르되 결과 뒤 400ms 대기는
  생략한다. 결과 진입을 기다리는 동일 브라우저 평가에서 즉시 상태를 읽는다.
- 12달은 실제 완주한다. 사건은 내 도시 적중 여부와 무관하게 result.events로
  판정한다(명세의 cards 생성 기준). 사건을 주입하거나 씨앗을 바꾸지 않는다.
- 사건 없는 달은 요약 숫자 굴림 0.6초+표시 6초를 포함해 7초 동안 감시한다.
  사건을 못 만나면 SKIP 출력만 하며 Checks의 통과/검사 수에 더하지 않는다.
- 새 연출 DOM 선택자는 명세에 없어 실제 fx-turn.js의 공개 DOM 클래스를
  읽는다. 모바일은 한 장씩 보이므로 카드 수는 열린 덧층의 전체 article 수다.
- 요약 기대값은 결과 서랍과 같은 월 환산(mdays/대표 운전 days)과
  ko-KR fmt(1/2/0자리)를 쓴다. 엔진 uns/outH 검산에는 월 환산을 하지 않는다.
  reduce의 결과 진입 순간 DOM 숫자와 비교하므로 지연 뒤 최종값을 읽지 않는다.
  사건 카드가 이미 펼쳐졌으면 월/라운드 결산 카드의 요약도 최종 숫자로 검사한다(rev16 #64).
- 금지 키는 JSON 객체의 정확한 _res/del/replay 키를 재귀 탐색한다.
  멀티는 새 컨텍스트의 local BroadcastChannel 방으로 공개 결과 수신을 검사한다.
- 멀티 지연은 예측 입력을 마친 준비 확정 클릭부터 잰다. 서랍은 DOM 변경
  관찰자로 재계산 전 포착하고, playing도 관찰자/짧은 폴링으로 기록한다.
  관측값은 검사 전용 window 변수에만 두며 앱 상태·저장·전송에는 넣지 않는다.
  1분 부하가 준비 직전 또는 결과 직후 150 이상이면 시간 판정만 SKIP한다.
- 멀티 정전 문턱의 dem은 replayOf가 null이므로 공개 S7 공유 도우미
  replaySimulation의 hrDem을 쓴다. 실제 재생의 source/fallback/recomputeMs는
  검사용 recomputeReplay 호출 전에 보존한다(그 호출은 진단 시간을 갱신한다).
- 건설·거래는 별도 빈 방의 1월에 연계선을 먼저 수락하고 두 팀의 계획을
  공개 plan API로 보낸다. 평택은 태양광 1기, 당진은 태양광 4기·배터리 2기와
  기존 발전소를 연결한다. 실제 공개 imp가 0이면 진단을 출력하고 FAIL한다.
- 부분 거래는 평택 무설비·2 MW 연계선·당진 소규모 태양광으로 시작한다.
  평택 연결점 옆 기존 LNG도 전선과 접촉하지 않게 한다. 무설비만으로는
  기존 발전을 막지 못한다. 자체 발전 0·작은 거래로 시간별 부족을 수요의
  50%보다 크게 남겨 D-74 계통 수입 뒤에도 정전이 생기도록 한다.
  공개 imp/uns/outH > 0, isolated.uns−uns > 0.01을 먼저 확인하고, 미충족이면
  별도 빈 방에서 설비 구성을 바꿔 최대 3번 재시도한다. 진행자 정확값과
  기기 r의 합계·정전 시간은 단언하되 시간별 최대 차이는 INFO로만 출력한다.
- 이벤트는 준비 전에 구독한다. start 한 번·end 없음, Esc와 요약/카드 처리 뒤
  start/end 각 한 번 및 skipped를 확인한다. reduce는 전체 이벤트가 없어야 한다.
"""

import math
import os
import re
import sys
from time import perf_counter

from playwright.sync_api import sync_playwright

from econui import (Checks, WAIT, context_for, diagnostics, local_address,
                    monitored_page, overflow)
from league_flow import confirm_seat, select_mode, start_solo, pass_issue_check
from solo import CHANGED_JS, PROGRESS_OR_PREDICT_JS, close_drawer, settle_progress


# ui/league-core.js가 실제 내보내는 공개 객체는 KCP.leagueCore이다.
# 관측 evaluate는 조회/로컬 검산만 한다. 건설 사례만 팀 기기의 공개
# KCP.league.plan 시연 API로 계획을 보내고, 연계선·달 진행은 화면에서 조작한다.
OBSERVE_JS = r"""() => {
  const L = window.KCP?.league?.state?.(), S = L?.S || L?.snap;
  if (!S) return null;
  const result = S.results?.at(-1), team = result?.team?.[L.team];
  const visible = el => {
    if (!el || !el.getClientRects().length) return false;
    for (let n = el; n; n = n.parentElement) {
      const css = getComputedStyle(n);
      if (n.hidden || css.display === 'none' || css.visibility === 'hidden' ||
          css.visibility === 'collapse' || Number(css.opacity) === 0) return false;
    }
    return true;
  };
  const cardRoots = [...document.querySelectorAll('.fx-turn-cards')].filter(visible);
  const articles = cardRoots.flatMap(root => [...root.querySelectorAll('article')]);
  const summaryRoots = [...document.querySelectorAll('.fx-turn-summary-values'),
    // rev16 #64: R8a/R8b 꼬리표. 숫자·재생 계약은 그대로.
    ...articles.filter(el => /결산$/.test(el.querySelector('.fx-turn-tag')?.textContent.trim() || ''))]
    .filter(el => !el.closest('#lg-panel') && visible(el));
  const summaries = summaryRoots.map(el => ({
    // rev11 R5: 운영 요약의 이름이 'CO₂ 생산'으로 바뀌어 찾는 낱말만 맞춘다(값 co2Prod 기대 불변).
    numbers: ['정전 시간', '정전', 'CO₂ 생산'].map(label => {
      const match = el.innerText.match(new RegExp(label + '\\s*([-+−]?\\d[\\d,]*(?:\\.\\d+)?)'));
      return match ? match[1].replaceAll(',', '').replace('−', '-') : null;
    })}));
  const tags = articles.map(el => el.querySelector('.fx-turn-tag')?.textContent.trim());
  let replay = null, replayError = null;
  if (team && ['review', 'end'].includes(S.phase)) {
    try {
      const data = KCP.leagueCore?.replayOf?.(result.round, L.team);
      if (data) {
        const H = data.uns?.length, arrays = [data.uns, data.del, data.dem];
        const valid = !!data.res && Number.isInteger(H) && H > 0 &&
          H === data.days * 24 && arrays.every(a => a?.length === H &&
            Array.from(a).every(v => typeof v === 'number' && Number.isFinite(v)));
        let uns = 0, outH = 0;
        if (valid) for (let k = 0; k < H; k++) {
          const rem = data.uns[k] - data.del[k];
          uns += Math.max(0, rem);
          if (rem > Math.max(0.005, 0.02 * data.dem[k])) outH++;
        }
        replay = {valid, hours:H, days:data.days, uns, outH};
      }
    } catch (error) { replayError = error.name; }
  }
  const format = (v, digits) => typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('ko-KR', {maximumFractionDigits:digits,
        minimumFractionDigits:0}).replaceAll(',', '') : null;
  const panel = document.querySelector('#lg-panel');
  const rd = S.rounds?.[result?.round - 1];
  const mul = result ? (rd?.mdays || result.days) / result.days : 1;
  return {round:S.round, phase:S.phase, count:S.results?.length || 0,
    months:S.rounds?.length, player:L.team, resultRound:result?.round,
    role:L.role, events:result?.events || [],
    team:team ? {uns:team.uns, outH:team.outH, imp:team.imp} : null,
    expectedSummary:team ? [format(team.outH * mul, 1), format(team.unsPct, 2),
      format(team.co2Prod * mul, 0)] : [], summaries, cardTags:tags,
    fx:KCP.fxTurn?.state?.() || null, replay, replayError,
    panelOpen:visible(panel) &&
      document.querySelector('#lg-bar [data-panel="result"]')?.getAttribute('aria-expanded') === 'true'};
}"""

RESULT_JS = """round => {
  const L = window.KCP?.league?.state?.(), S = L?.S || L?.snap;
  return S && S.round === round && ['review', 'end'].includes(S.phase) &&
    S.results?.at(-1)?.round === round ? (""" + OBSERVE_JS + """)() : false;
}"""

REPLAY_EVENTS_JS = r"""() => {
  window.__q8ReplayEvents = [];
  KCP.on('fx:replay', d => window.__q8ReplayEvents.push({...d}));
}"""

# 시간별 값은 보정 규칙 G로 달라질 수 있다. 부분 거래의 시간별 비교는
# 진단용으로만 요청하고, 합계·정전 시간 일치만 단언한다.
HOST_REPLAY_JS = r"""([round, id, includeHours = false]) => {
  const data = KCP.leagueCore.replayOf(round, id);
  if (!data) return null;
  const H = data.days * 24;
  const valid = Number.isInteger(H) && H > 0 && !!data.res &&
    [data.uns, data.del, data.dem].every(a => a?.length === H &&
      Array.from(a).every(v => typeof v === 'number' && Number.isFinite(v)));
  let sum = 0, outH = 0;
  const remaining = [];
  if (valid) for (let k = 0; k < H; k++) {
    const r = data.uns[k] - data.del[k];
    if (includeHours) remaining.push(r);
    sum += Math.max(0, r);
    if (r > Math.max(0.005, 0.02 * data.dem[k])) outH++;
  }
  return {valid, sum, outH, ...(includeHours ? {remaining} : {})};
}"""

BUILD_TRADE_PLAN_JS = r"""options => {
  const {supplier, types, connectPlants = true, demandIds = null} =
    typeof options === 'boolean' ? {supplier:options} : options;
  const BG = KCP.buildGame, L = KCP.league.state();
  const other = supplier ? 'pyeongtaek' : 'dangjin';
  const gate = BG.SITES.find(s => s.kind === 'gridpt' && s.to?.includes(other));
  if (!gate) throw new Error('이웃 도시 연결점 없음: ' + other);
  const targets = BG.SITES.filter(s =>
    (s.dem && (!demandIds || demandIds.includes(s.id))) ||
    (supplier && connectPlants && s.kind === 'plant'));
  // network는 선의 인접 칸도 자동 접속한다. 특히 평택 LNG는 당진 연결점
  // 바로 옆이므로, connectPlants=false일 때 발전소와 이웃 칸까지 우회한다.
  const blocked = new Set(connectPlants ? [] : BG.SITES.filter(s => s.kind === 'plant')
    .flatMap(s => [s.tile, ...BG.TILES[s.tile].nb]));
  const start = blocked.has(gate.tile) ? BG.TILES[gate.tile].nb.find(i =>
    !blocked.has(i) && !BG.TILES[i].out) : gate.tile;
  if (start == null) throw new Error('발전소를 피해 연결점에 접속할 칸 없음');
  const connected = new Set([start]), lines = [];
  const route = (a, b) => {
    if (connectPlants) return BG.routePath(a, b);
    // 수요 시설 자체가 금지 칸이면 안전한 이웃 칸에서 자동 접속한다.
    const goals = new Set((blocked.has(b) ? BG.TILES[b].nb : [b])
      .filter(i => !blocked.has(i) && !BG.TILES[i].out));
    const queue = [a], prev = new Map([[a, null]]);
    for (let k = 0; k < queue.length; k++) {
      const u = queue[k];
      if (goals.has(u)) {
        const p = [];
        for (let v = u; v != null; v = prev.get(v)) p.unshift(v);
        return p;
      }
      for (const v of BG.TILES[u].nb) {
        if (blocked.has(v) || BG.TILES[v].out || prev.has(v)) continue;
        prev.set(v, u); queue.push(v);
      }
    }
    return null;
  };
  // 일반 건설은 기존 최소 비용 경로, 무발전 사례는 발전소를 피한 최단 칸 경로다.
  while (targets.length) {
    let best = null;
    for (const s of targets) for (const c of connected) {
      const a = BG.TILES[c], b = BG.TILES[s.tile];
      const distance = Math.hypot(a.X - b.X, a.Y - b.Y);
      if (!best || distance < best.distance) best = {s, c, distance};
    }
    const p = route(best.c, best.s.tile);
    if (!p) throw new Error('수요 시설 연결 경로 없음: ' + best.s.id);
    if (p.length > 1) lines.push({p});
    p.forEach(i => connected.add(i));
    targets.splice(targets.indexOf(best.s), 1);
  }
  const builds = [], used = new Set();
  const equipment = types ?? (supplier ?
    ['solar', 'solar', 'solar', 'solar', 'battery', 'battery'] : ['solar']);
  for (const t of equipment) {
    const candidates = BG.TILES.filter(x => !x.out && !blocked.has(x.i) &&
      x.site < 0 && !used.has(x.i) && !BG.siteRule(t, x));
    candidates.sort((a, b) => Number(connected.has(b.i)) - Number(connected.has(a.i)) ||
      Math.min(...[...connected].map(i => Math.hypot(BG.TILES[i].X - a.X, BG.TILES[i].Y - a.Y))) -
      Math.min(...[...connected].map(i => Math.hypot(BG.TILES[i].X - b.X, BG.TILES[i].Y - b.Y))));
    const tile = candidates[0];
    if (!tile) throw new Error('설비 건설 자리 없음: ' + t);
    if (!connected.has(tile.i)) {
      const nearest = [...connected].sort((a, b) =>
        Math.hypot(BG.TILES[a].X - tile.X, BG.TILES[a].Y - tile.Y) -
        Math.hypot(BG.TILES[b].X - tile.X, BG.TILES[b].Y - tile.Y))[0];
      const p = route(nearest, tile.i);
      if (!p) throw new Error('설비 연결 경로 없음: ' + t);
      lines.push({p}); p.forEach(i => connected.add(i));
    }
    builds.push({t, i:tile.i}); used.add(tile.i);
  }
  const accepted = KCP.league.plan(st => {
    Object.assign(st, {builds, lines, policies:[], rq:[], fab2:false, shed:'home'});
  });
  const net = BG.network(BG.sanitize(BG.current(), 1e9));
  const linked = net.nodes.some(n => n.kind === 'import' && n.live &&
    n.comp >= 0 && BG.SITES[n.si].to?.includes(other));
  const plants = net.nodes.filter(n => ['coal', 'lng'].includes(n.kind) &&
    n.live && n.comp >= 0).map(n => BG.SITES[n.si].id);
  return {accepted, linked, plants, builds, lines, cost:BG.capex(BG.current()),
    budget:L.snap.teams[L.team].budget};
}"""

# 재계산은 결과 직후 관측/지연 측정과 분리하여 명시적인 검산 때만 호출한다.
RECOMPUTE_JS = r"""includeHours => {
  const L = KCP.league.state(), S = L?.snap || L?.S;
  const result = S?.results?.at(-1), team = result?.team?.[L.team];
  const fxBefore = KCP.fxTurn?.state?.() || null;
  try {
    const engine = KCP.leagueCore?.replayOf?.(result.round, L.team);
    const data = KCP.fxTurn?.recomputeReplay?.(result.round, L.team);
    const fxAfter = KCP.fxTurn?.state?.() || null;
    if (!data) return {data:null, fxBefore, fxAfter, engineNull:engine === null};
    const r = data.r && Array.from(data.r);
    const dem = engine?.dem || KCP.league.uiMath.replaySimulation(S, result, L.team)?.hrDem;
    const H = result.days * 24;
    const valid = Array.isArray(r) && Number.isInteger(H) && H > 0 && r.length === H &&
      dem?.length === H && r.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) &&
      Array.from(dem).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    let sum = 0, countedOutH = 0, maxHourDiff = null;
    if (valid) {
      for (let k = 0; k < H; k++) {
        sum += r[k];
        if (r[k] > Math.max(0.005, 0.02 * dem[k])) countedOutH++;
      }
      if (engine?.uns?.length === H && engine?.del?.length === H &&
          [engine.uns, engine.del].every(a => Array.from(a).every(Number.isFinite))) {
        maxHourDiff = 0;
        for (let k = 0; k < H; k++)
          maxHourDiff = Math.max(maxHourDiff, Math.abs(r[k] - (engine.uns[k] - engine.del[k])));
      }
    }
    return {data:{valid, sum, reportedSum:data.sum, outH:data.outH, countedOutH,
      exactOutH:data.outH === team.outH, source:data.source, maxHourDiff,
      ...(includeHours ? {r} : {})},
      fxBefore, fxAfter, engineNull:engine === null, error:null};
  } catch (error) {
    return {data:null, fxBefore, fxAfter:KCP.fxTurn?.state?.() || null,
      error:error.name + ': ' + error.message};
  }
}"""

TIMING_JS = r"""selector => {
  window.__q8ReplayTiming?.dispose?.();
  const timing = {ready:null, drawer:null, playing:null, fx:null, done:false};
  window.__q8ReplayTiming = timing;
  const visible = el => {
    if (!el || !el.getClientRects().length) return false;
    for (let n = el; n; n = n.parentElement) {
      const css = getComputedStyle(n);
      if (n.hidden || css.display === 'none' || css.visibility === 'hidden' ||
          css.visibility === 'collapse' || Number(css.opacity) === 0) return false;
    }
    return true;
  };
  const sample = () => {
    if (timing.ready === null) return;
    const L = KCP.league.state(), S = L?.snap || L?.S;
    if (!['review', 'end'].includes(S?.phase) || S.results?.at(-1)?.round !== 1) return;
    const fx = KCP.fxTurn?.state?.();
    if (timing.drawer === null && visible(document.querySelector('#lg-panel')) &&
        document.querySelector('#lg-bar [data-panel="result"]')?.getAttribute('aria-expanded') === 'true')
      timing.drawer = performance.now();
    if (fx?.playing === true && timing.playing === null) timing.playing = performance.now();
    if (timing.drawer !== null && (timing.playing !== null || fx?.fallback)) {
      timing.fx = fx; timing.done = true; timing.dispose();
    }
  };
  const click = e => {
    if (timing.ready === null && e.target.closest(selector)) timing.ready = performance.now();
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.body, {subtree:true, childList:true, attributes:true,
    attributeFilter:['hidden', 'class', 'aria-expanded']});
  const poll = setInterval(sample, 10);
  document.addEventListener('click', click, true);
  timing.dispose = () => {
    observer.disconnect(); clearInterval(poll); document.removeEventListener('click', click, true);
  };
}"""

STORAGE_JS = r"""() => {
  const forbidden = new Set(['_res', 'del', 'replay']);
  const scan = (x, path, found) => {
    if (!x || typeof x !== 'object') return;
    for (const [key, value] of Object.entries(x)) {
      const next = path + '.' + key;
      if (forbidden.has(key)) found.push(next);
      scan(value, next, found);
    }
  };
  const keys = Object.keys(localStorage).filter(k => k.startsWith('kcp-league'));
  const found = [], invalid = [];
  for (const key of keys) {
    try { scan(JSON.parse(localStorage.getItem(key)), key, found); }
    catch (_) { invalid.push(key); }
  }
  const L = KCP.league.state(), live = [], snapshot = [];
  scan(JSON.parse(JSON.stringify(L.S)), 'S', live);
  scan(JSON.parse(JSON.stringify(L.snap)), 'snap', snapshot);
  return {solo:keys.includes('kcp-league-solo-v1'), invalid, found, live, snapshot};
}"""


def observe(page):
    return page.evaluate(OBSERVE_JS)


def start(page, base):
    page.goto(base + '#league')
    if page.evaluate('() => localStorage.length') != 0:
        raise AssertionError('새 컨텍스트의 시작 저장소가 비어 있지 않음')
    start_solo(page, months=12)
    page.wait_for_function("() => KCP.league.state()?.S?.phase === 'plan'")
    guide = page.locator('#lg-guide-close')
    if guide.count() and guide.is_visible():
        guide.click()
    page.evaluate(REPLAY_EVENTS_JS)
    return observe(page)


def click_progress(page, before):
    """solo.click_next의 화면 조작을 따르되 재생을 놓치는 고정 대기는 없다."""
    close_drawer(page)
    previous = [before['round'], before['phase'], before['count']]
    # rev15 #53: 앞 조작으로 달이 이미 넘어갔으면(계산 중·가드 중이라 단추가 꺼져 있던 경우) 다시 누르지 않는다.
    if settle_progress(page, previous):
        if before['phase'] == 'plan':
            return page.wait_for_function(RESULT_JS, arg=before['round'], polling='raf').json_value()
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
            button.click()
            if ready:
                # 품질8 UX U3: 준비 전 확인 카드(#lg-issue-check)는 공용 도우미로 '그대로 진행'.
                pass_issue_check(page)
            if ready and before['phase'] == 'plan':
                # 약속 방식/자유 실험 모두 화면에서 확정한다.
                page.wait_for_function("""args => {
                  const confirm = document.querySelector('#lg-ready-confirm');
                  return (""" + PROGRESS_OR_PREDICT_JS + """)(args) ||
                    !!(confirm && confirm.getClientRects().length);
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
                # 대기 완료와 같은 평가에서 playing/서랍/요약을 포착한다.
                return page.wait_for_function(RESULT_JS, arg=before['round'],
                                              polling='raf').json_value()
            page.wait_for_function(CHANGED_JS, arg=previous)
            return observe(page)
    raise AssertionError(f"{before['round']}월 {before['phase']}: 진행 버튼 없음")


def reach_result(page, month):
    state = observe(page)
    for _ in range(5):
        if state['round'] == month and state['phase'] in ('review', 'end'):
            return state
        state = click_progress(page, state)
    raise AssertionError(f'{month}월 결과 단계에 도달하지 못함')


def equality(checks, state, label):
    replay = state['replay']
    checks.ok(replay is not None and state['replayError'] is None,
              f'{label} replayOf({state["round"]}, 내 도시) != null')
    valid = bool(replay and replay['valid'])
    checks.ok(valid, f'{label} res·시간 배열·days×24 유효')
    team = state['team'] or {}
    checks.ok(valid and isinstance(team.get('uns'), (int, float)) and
              abs(replay['uns'] - team['uns']) <= 0.01,
              f'{label} Σ max(0, uns−del) = 엔진 uns (r2 허용차 ≤ 0.01): '
              f'재생={replay["uns"] if valid else None}, 엔진={team.get("uns")}')
    checks.ok(valid and replay['outH'] == team.get('outH'),
              f'{label} rem > max(0.005, 0.02×dem) 시간 수 = 엔진 outH: '
              f'재생={replay["outH"] if valid else None}, 엔진={team.get("outH")}')


def device_equality(checks, page, state, label, compare_engine=False, include_hours=False):
    probe = page.evaluate(RECOMPUTE_JS, include_hours)
    data = probe.get('data') or {}
    fallback = (probe.get('fxAfter') or {}).get('fallback')
    valid = data.get('valid') is True
    checks.ok(bool(data) and fallback is None and probe.get('error') is None,
              f'{label} recomputeReplay != null, fallback={fallback}, 오류={probe.get("error")}')
    checks.ok(valid and data.get('source') == 'device',
              f'{label} 기기 r·dem 유효, source=device: {data.get("source")}')
    team = state['team'] or {}
    target = team.get('uns')
    reported = data.get('reportedSum')
    checks.ok(valid and isinstance(target, (int, float)) and
              isinstance(reported, (int, float)) and math.isfinite(reported) and
              abs(reported - target) <= 0.01 and abs(data['sum'] - target) <= 0.01,
              f'{label} sum·Σr = 공개 uns (≤ 0.01): '
              f'sum={reported}, Σr={data.get("sum")}, 공개={target}')
    checks.ok(valid and data.get('exactOutH') is True,
              f'{label} 반환 outH === 공개 outH: '
              f'기기={data.get("outH")}, 공개={team.get("outH")}')
    checks.ok(valid and data.get('countedOutH') == team.get('outH'),
              f'{label} r > max(0.005, 0.02×dem) 시간 수 = 공개 outH: '
              f'검산={data.get("countedOutH")}, 공개={team.get("outH")}')
    if compare_engine:
        imports = team.get('imp')
        if imports == 0:
            difference = data.get('maxHourDiff')
            checks.ok(valid and difference is not None and difference <= 1e-6,
                      f'{label} imp=0 시간별 |r−(uns−del)| ≤ 1e-6: 최대={difference}')
        elif isinstance(imports, (int, float)) and math.isfinite(imports) and imports > 0:
            print(f'INFO {label} imp={imports}: 거래 달은 합계·정전 시간 비교',
                  flush=True)
        else:
            checks.ok(False, f'{label} 거래 유무 판정에 필요한 공개 imp 유효: {imports}')
    return probe


def storage(checks, page, label):
    data = page.evaluate(STORAGE_JS)
    checks.ok(data['solo'] and not data['invalid'], f'{label} 리그 저장 JSON 존재·유효')
    for key, name in (('found', '리그 저장'), ('live', '상태 S'),
                      ('snapshot', '공개 스냅샷 JSON')):
        checks.ok(not data[key], f'{label} {name} _res/del/replay 키 0: {data[key][:3]}')


def replay_events(checks, page, state, label, ended=False, reduced=False):
    events = page.evaluate('() => window.__q8ReplayEvents')
    starts = [event for event in events if event.get('state') == 'start']
    ends = [event for event in events if event.get('state') == 'end']
    checks.ok(len(starts) == (0 if reduced else 1),
              f'{label} fx:replay start {len(starts)}번 (기대 {0 if reduced else 1})')
    checks.ok(len(ends) == (1 if ended and not reduced else 0),
              f'{label} fx:replay end {len(ends)}번 '
              f'(기대 {1 if ended and not reduced else 0})')
    if reduced:
        checks.ok(not events, f'{label} fx:replay 이벤트 전체 0번')
        return
    checks.ok(all(event.get('state') in ('start', 'end') and
                  event.get('round') == 1 and event.get('team') == state['player'] and
                  event.get('ms') == 2200 and event.get('source') == 'engine' and
                  event.get('cancelled') is False for event in events) and bool(starts) and
              starts[0].get('skipped') is False,
              f'{label} 이벤트 round/team/ms/source/cancelled 및 start skipped=false')
    if ended:
        checks.ok(len(ends) == 1 and ends[0].get('skipped') is True and
                  [event.get('state') for event in events] == ['start', 'end'],
                  f'{label} Esc 뒤 end skipped=true, start→end 각 한 번')


def escape(checks, page, label, skipped=False):
    begin = perf_counter()
    page.keyboard.press('Escape')
    predicate = ("() => { const s=KCP.fxTurn?.state?.(); return !!s && "
                 + ("s.playing === false && s.skipped === true" if skipped
                    else "s.cardsOpen === false") + "; }")
    checks.test(f'{label} Esc → 300ms 이내 ' + ('재생 건너뛰기' if skipped else '카드 닫힘'),
                lambda: bool(page.wait_for_function(predicate, timeout=300,
                                                    polling='raf')) and
                perf_counter() - begin <= 0.3)


def cards(checks, page, state, label, expect_drawer=False):
    checks.ok(bool(state['fx']) and (bool(state['events']) or
              state['fx']['cardsOpen'] is False), f'{label} 사건 없는 달에 cardsOpen 금지')
    if state['events']:
        checks.test(f'{label} 자연 발생 사건 → cardsOpen', lambda: bool(
            page.wait_for_function('() => KCP.fxTurn?.state?.().cardsOpen === true',
                                   timeout=WAIT, polling='raf')))
        checks.test(f'{label} 카드 ≥ 2 (월/라운드 결산 + 사건)', lambda: bool(
            page.wait_for_function("""() => {
              const s = (""" + OBSERVE_JS + """)();
              // rev16 #64: 결과 달/라운드 결산 꼬리표로 변경.
              return s?.cardTags.length >= 2 && s.cardTags.some(t => /결산$/.test(t)) &&
                s.cardTags.includes('사건');
            }""", timeout=2000, polling='raf')))
        overflow(checks, page, label + ' 사건 카드')
        # D-83: Esc 한 번에 한 층. ⑤ 리그 서랍이 ⑥ 펼치지 않은 덱(1280 카드 모양, 390 접힌 띠)보다 위다.
        # 서랍이 열려 있고 덱이 펼쳐지지 않았으며 초점이 덱 밖이면 Esc는 서랍만 닫고, 다음 Esc가 카드를 닫는다.
        drawer = page.evaluate("""() => document.querySelector('#lg-panel')?.hidden===false &&
          !document.querySelector('.fx-turn-expand[aria-expanded="true"]') &&
          !document.activeElement?.closest('.fx-turn-cards')""")
        if expect_drawer:
            checks.ok(drawer, f'{label} Esc 전 결과 서랍 열림·펼치지 않은 덱·덱 밖 초점')
        if drawer:
            page.keyboard.press('Escape')
            checks.test(f'{label} Esc 결과 서랍만 닫힘·카드 유지(D-83)', lambda: bool(
                page.wait_for_function("""() => document.querySelector('#lg-panel')?.hidden!==false &&
                  KCP.fxTurn?.state?.().cardsOpen===true""", timeout=1000, polling='raf')))
        escape(checks, page, label)
        return True
    # 앱 상태/DOM에 기록하지 않는 읽기 전용 지역 관측이다.
    allowed = page.evaluate("""async () => {
      const end = performance.now() + 7000;
      do {
        const s = KCP.fxTurn?.state?.();
        if (!s || s.cardsOpen !== false) return false;
        await new Promise(resolve => requestAnimationFrame(resolve));
      } while (performance.now() < end);
      return true;
    }""")
    checks.ok(allowed, f'{label} 요약 종료까지 사건 없는 달 카드 열림 0')
    return False


def desktop(checks, page, base):
    state = start(page, base)
    checks.ok(state['months'] == 12, '1280×900 혼자 하기 12달 시작')
    saw_event = False
    for month in range(1, 13):
        state = reach_result(page, month)
        label = f'1280×900 {month}월'
        checks.ok(state['resultRound'] == month and state['count'] == month,
                  f'{label} 화면 단추 → 달별 엔진 결과')
        if month <= 2:
            equality(checks, state, label)
            fx = state['fx'] or {}
            checks.ok(fx.get('playing') is True and fx.get('replayed') is True,
                      f'{label} 결과 진입 직후 playing/replayed true')
            checks.ok(fx.get('ms') == (2200 if month == 1 else 2000),
                      f'{label} 재생 길이 {2200 if month == 1 else 2000}ms')
            checks.ok(state['panelOpen'], f'{label} 재생 시작 때 결과 서랍 이미 열림')
        overflow(checks, page, label + ' 결과 진입')
        if month == 1:
            replay_events(checks, page, state, label)
        # 1월의 Esc 검사를 포함해 나머지 달도 화면 조작으로 재생을 끝낸다.
        if month <= 2 or (state['fx'] or {}).get('playing'):
            escape(checks, page, label, skipped=True)
        if month <= 2:
            # 300ms Esc 판정은 재계산 비용과 분리한다. 여전히 같은 달 결과 단계다.
            device_equality(checks, page, state, label, compare_engine=True)
        storage(checks, page, label)
        saw_event = cards(checks, page, state, label, expect_drawer=month <= 2) or saw_event
        if month == 1:
            replay_events(checks, page, state, label, ended=True)
        if month < 12:
            next_state = click_progress(page, observe(page))
            checks.ok(next_state['round'] == month + 1 and next_state['phase'] == 'plan',
                      f'{label} 다음 달 화면 단추 → {month + 1}월 계획')
    final = observe(page)
    if final['phase'] == 'review':
        final = click_progress(page, final)
    checks.ok(final['round'] == 12 and final['count'] == 12 and final['phase'] == 'end',
              '1280×900 화면 단추만으로 12달 완주')
    if not saw_event:
        print('SKIP 사건 카드: 사건 없는 달만 진행', flush=True)


def first_month(checks, page, base, label, reduced=False):
    start(page, base)
    state = reach_result(page, 1)
    equality(checks, state, label)
    checks.ok(state['panelOpen'], f'{label} 1월 결과 서랍 즉시 열림')
    overflow(checks, page, label + ' 1월 결과')
    if reduced:
        fx = state['fx'] or {}
        checks.ok(fx.get('replayed') is False and fx.get('playing') is False,
                  f'{label} replayed/playing false')
        checks.ok(fx.get('ms') == 0, f'{label} 재생 길이 0ms')
        expected = state['expectedSummary']
        checks.ok(len(expected) == 3 and all(v is not None for v in expected) and
                  any(item['numbers'] == expected for item in state['summaries']),
                  f'{label} 결과 진입 순간 정전 시간·정전 %·CO₂ 요약 최종값')
    else:
        checks.ok((state['fx'] or {}).get('playing') is True,
                  f'{label} 1월 결과 진입 순간 재생 중')
        if (state['fx'] or {}).get('playing'):
            escape(checks, page, label, skipped=True)
        cards(checks, page, state, label, expect_drawer=True)
    storage(checks, page, label)
    if reduced:
        replay_events(checks, page, state, label, reduced=True)


def prepare_team(page):
    """예측 입력까지 화면에서 마치고, 시간 측정 대상인 준비 확정 버튼을 돌려준다."""
    guide = page.locator('#lg-guide-close')
    if guide.count() and guide.is_visible():
        guide.click()
    close_drawer(page)
    page.locator('#lg-ready').click()
    pass_issue_check(page)  # 품질8 UX U3 준비 전 확인 카드
    page.wait_for_selector('#lg-ready-confirm')
    page.locator('[data-evidence="evening"]').click()
    page.locator('[data-pred]').select_option('down')
    page.locator('[data-confidence="fairly"]').click()
    return page.locator('#lg-ready-confirm')


# 도시 이름은 자료에서 읽는다(D-58·D-86, #78). 이름표에만 쓰고 기대값에는 쓰지 않는다.
TEAM_NAMES_JS = """() => Object.fromEntries(
  KCP.leagueCore.regionOf('south').teams.map(t => [t.id, t.name]))"""


def team_names(page):
    return page.evaluate(TEAM_NAMES_JS)


def latency(checks, timing, load_before, load_after, label):
    def delta(start, end):
        a, b = timing.get(start), timing.get(end)
        return b - a if a is not None and b is not None else None

    drawer_ms = delta('ready', 'drawer')
    playback_ms = delta('drawer', 'playing')
    recompute_ms = (timing.get('fx') or {}).get('recomputeMs')
    print(f'INFO {label} CPU rate=4 준비 확정→결과 서랍 ms={drawer_ms}, '
          f'서랍→playing true ms={playback_ms}, recomputeMs={recompute_ms}, '
          f'load1 준비={load_before}, 결과={load_after}', flush=True)
    if max(load_before, load_after) >= 150:
        print(f'SKIP {label} 시간 판정: load1 ≥ 150 (검사·통과 수에 미포함)', flush=True)
        return
    values = (drawer_ms, playback_ms, recompute_ms)
    valid = all(isinstance(v, (int, float)) and math.isfinite(v) and v >= 0
                for v in values)
    checks.ok(valid and timing.get('done') is True and
              drawer_ms + recompute_ms <= 1000,
              f'{label} 결과 서랍 지연 + recomputeMs ≤ 1000ms: '
              f'{drawer_ms + recompute_ms if valid else None}')


def multiplayer(checks, context, base, pages):
    host, host_events = monitored_page(context)
    pages.append((host, host_events, '멀티 진행자'))
    host.goto(base + '#league')
    checks.ok(host.evaluate('() => localStorage.length') == 0,
              '멀티 새 컨텍스트의 시작 저장소 비어 있음')
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="12"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    teams = {}
    names = team_names(host)
    for city in ('pyeongtaek', 'dangjin'):
        name = names[city]
        page, events = monitored_page(context)
        pages.append((page, events, f'멀티 {name} 태블릿'))
        page.set_viewport_size({'width': 1024, 'height': 768})
        page.goto(base + '#league')
        select_mode(page, 'join')
        page.locator('#lg-code').fill(room)
        page.locator('#lg-join').click()
        confirm_seat(page, city, timeout=WAIT)
        teams[city] = page
        checks.ok(page.evaluate('() => KCP.league.state()?.role') == 'team',
                  f'멀티 {name} 독립 팀 페이지')
    host.wait_for_function("""() => {
      const S = KCP.league.state()?.S;
      return S && Object.keys(S.teams).length === 2 &&
        ['pyeongtaek', 'dangjin'].every(id => S.teams[id]?.token);
    }""")
    host.locator('#lg-next').click()
    for page in teams.values():
        page.wait_for_function("() => KCP.league.state()?.snap?.phase === 'plan'")

    # 당진을 먼저 준비시키고 평택의 최종 준비 클릭부터 자동 진행 시간을 잰다.
    prepare_team(teams['dangjin']).click()
    host.wait_for_function("() => KCP.league.state()?.S?.teams.dangjin.ready === true")
    tablet = teams['pyeongtaek']
    cdp = context.new_cdp_session(tablet)
    try:
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        ready = prepare_team(tablet)
        tablet.bring_to_front()
        tablet.evaluate(TIMING_JS, '#lg-ready-confirm')
        load_before = os.getloadavg()[0]
        ready.click()
        host.wait_for_function("""() => {
          const S = KCP.league.state()?.S;
          return ['pyeongtaek', 'dangjin'].every(id => S?.teams[id]?.ready === true);
        }""")
        host.locator('#lg-next').click()
        checks.test(f'멀티 {names["pyeongtaek"]} 서랍·재생 시작 또는 fallback 관측', lambda: bool(
            tablet.wait_for_function('() => window.__q8ReplayTiming?.done === true',
                                     timeout=WAIT, polling=10)))
        timing = tablet.evaluate("""() => {
          const t = window.__q8ReplayTiming;
          t?.dispose();
          return t ? {ready:t.ready, drawer:t.drawer, playing:t.playing,
            fx:t.fx, done:t.done} : {};
        }""")
        load_after = os.getloadavg()[0]
        latency(checks, timing, load_before, load_after, f'멀티 {names["pyeongtaek"]} 태블릿')
        checks.ok(timing.get('playing') is not None,
                  f'멀티 {names["pyeongtaek"]} 결과 뒤 playing true 관측')
        for city in ('pyeongtaek', 'dangjin'):
            name, page = names[city], teams[city]
            page.wait_for_function("""() => {
              const L = KCP.league.state(), fx = KCP.fxTurn?.state?.();
              return L.snap?.phase === 'review' && L.snap?.results?.at(-1)?.round === 1 &&
                (fx?.replayed === true || !!fx?.fallback);
            }""", polling=10)
            state = observe(page)
            label = f'멀티 {name} 태블릿 1월'
            # 검사용 재계산이 실제 자동 재생의 진단값을 덮어쓰기 전에 검사한다.
            fx = state['fx'] or {}
            checks.ok(state['count'] == 1 and state['resultRound'] == 1 and
                      state['player'] == city and state['team'] is not None,
                      f'{label} 자기 페이지에서 공개 결과 수신')
            checks.ok(state['replay'] is None and state['replayError'] is None,
                      f'{label} replayOf == null (엔진 재생 자료 없음)')
            checks.ok(fx.get('source') == 'device' and fx.get('fallback') is None and
                      fx.get('replayed') is True,
                      f'{label} 자동 재생 source=device, fallback={fx.get("fallback")}, '
                      f'replayed={fx.get("replayed")}')
            recompute_ms = fx.get('recomputeMs')
            print(f'INFO {label} 자동 재생 recomputeMs={recompute_ms}', flush=True)
            checks.ok(isinstance(recompute_ms, (int, float)) and
                      math.isfinite(recompute_ms) and recompute_ms >= 0,
                      f'{label} recomputeMs 유효')
            checks.ok(state['panelOpen'], f'{label} 결과 서랍 열림')
            probe = device_equality(checks, page, state, label)
            checks.ok(probe.get('engineNull') is True,
                      f'{label} 기기 검산 때도 replayOf === null')
            overflow(checks, page, label)
    finally:
        try:
            tablet.evaluate('() => window.__q8ReplayTiming?.dispose?.()')
        finally:
            try:
                cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
            finally:
                cdp.detach()


def built_trade_multiplayer(checks, context, base, pages, partial=None):
    """별도 빈 방에서 공개 계획·연계선 거래 뒤 재생 검산. 부분 거래는 후보 성공 여부 반환."""
    case = '부분 거래' if partial is not None else '건설·거래'
    cap = 2 if partial is not None else 4
    host, events = monitored_page(context)
    pages.append((host, events, f'{case} 진행자'))
    host.goto(base + '#league')
    checks.ok(host.evaluate('() => localStorage.length') == 0,
              f'{case} 새 컨텍스트의 시작 저장소 비어 있음')
    select_mode(host, 'host')
    host.locator('[data-preset="2"]').click()
    host.locator('#lg-mode-host [data-turns="12"]').click()
    host.locator('#lg-host').click()
    host.wait_for_selector('#lg-roomcode')
    room = host.locator('#lg-roomcode').inner_text()
    teams = {}
    names = team_names(host)
    for city in ('pyeongtaek', 'dangjin'):
        name = names[city]
        page, events = monitored_page(context)
        pages.append((page, events, f'{case} {name} 태블릿'))
        page.set_viewport_size({'width': 1024, 'height': 768})
        page.goto(base + '#league')
        select_mode(page, 'join')
        page.locator('#lg-code').fill(room)
        page.locator('#lg-join').click()
        confirm_seat(page, city, timeout=WAIT)
        teams[city] = page
    host.wait_for_function("""() => ['pyeongtaek', 'dangjin'].every(id =>
      !!KCP.league.state()?.S?.teams[id]?.token)""")
    host.locator('#lg-next').click()
    for page in teams.values():
        page.wait_for_function("() => KCP.league.state()?.snap?.phase === 'plan'")
        guide = page.locator('#lg-guide-close')
        if guide.count() and guide.is_visible():
            guide.click()

    # 연계선 몫을 먼저 확정해 계획 예산에 반영한다. 엔진 tie 요청은 직접 호출하지 않는다.
    buyer, seller = teams['pyeongtaek'], teams['dangjin']
    for page in (buyer, seller):
        close_drawer(page)
        page.locator('#lg-bar [data-panel="deal"]').click()
    buyer.locator(f'[data-tie="propose"][data-other="dangjin"][data-cap="{cap}"]:not([data-kind])').click()
    seller.locator('[data-tie="accept"][data-other="pyeongtaek"]').click()
    host.wait_for_function("""cap => KCP.league.state()?.S?.ties.some(t =>
      t.st === 'built' && t.round === 1 && t.cap === cap &&
      [t.a, t.b].includes('pyeongtaek') && [t.a, t.b].includes('dangjin'))""", arg=cap)
    checks.ok(True, f'{case} 화면 제안·수락 → 1월에 {cap} MW 연계선 건설')

    for city, page in teams.items():
        page.wait_for_function("""() => KCP.league.state()?.snap?.ties.some(t =>
          t.st === 'built' && t.round === 1)""")
        close_drawer(page)
        supplier = city == 'dangjin'
        options = ({'supplier':supplier, **partial[city]}
                   if partial is not None else supplier)
        plan = page.evaluate(BUILD_TRADE_PLAN_JS, options)
        checks.ok(plan['accepted'] is True and plan['linked'] is True,
                  f'{case} {city} 공개 plan API 성공·내부 전선 연결점 접속: '
                  f'accepted={plan["accepted"]}, linked={plan["linked"]}, '
                  f'계획 비용={plan["cost"]}, 예산={plan["budget"]}')
        # API 호출 성공만으로 진행자가 계획을 받았다고 판단하지 않는다.
        host.wait_for_function("""([id, expected]) => {
          const p = KCP.league.state()?.S?.teams[id]?.plan;
          return !!p && JSON.stringify(p.builds.map(b => ({t:b.t, i:b.i}))) ===
            JSON.stringify(expected.builds) && JSON.stringify(p.lines) === JSON.stringify(expected.lines);
        }""", arg=[city, plan], timeout=WAIT)
        count = len(plan['builds'])
        expected_types = (partial[city]['types'] if partial is not None else
                          (['solar'] * 4 + ['battery'] * 2 if supplier else ['solar']))
        checks.ok([b['t'] for b in plan['builds']] == expected_types,
                  f'{case} {city} 진행자 수신 설비 {count}개: 기대={expected_types}')
        if partial is not None and partial[city].get('connectPlants') is False:
            checks.ok(not plan['plants'],
                      f'{case} {city} 기존 발전소 자동 접속 없음: {plan["plants"]}')

    for city, page in teams.items():
        prepare_team(page).click()
        host.wait_for_function("id => KCP.league.state()?.S?.teams[id]?.ready === true",
                               arg=city)
    host.locator('#lg-next').click()
    host.wait_for_function("""() => {
      const S = KCP.league.state()?.S;
      return S?.phase === 'review' && S.results?.at(-1)?.round === 1;
    }""")
    public = host.evaluate("""() => {
      const S = KCP.league.state().S, res = S.results.at(-1);
      const team = Object.fromEntries(['pyeongtaek', 'dangjin'].map(id => {
        const t = res.team[id];
        return [id, Object.fromEntries(['uns', 'outH', 'imp', 'exp', 'dem', 'sub',
          'isolated', 'unlinked', 'grid'].map(key => [key, t[key]]))];
      }));
      return {round:res.round, team, flow:res.flow,
        ties:S.ties, grid:S.grid, events:res.events};
    }""")
    imports = public['team']['pyeongtaek'].get('imp')
    traded = isinstance(imports, (int, float)) and math.isfinite(imports) and imports > 0
    deficit = public['team']['pyeongtaek']
    isolated = (deficit.get('isolated') or {}).get('uns')
    if partial is not None:
        uns, out_h = deficit.get('uns'), deficit.get('outH')
        positive = lambda v: isinstance(v, (int, float)) and math.isfinite(v) and v > 0
        reduced = (positive(isolated) and positive(uns) and isolated - uns > 0.01)
        reasons = [reason for ok, reason in (
            (traded, 'imp > 0 미충족'), (positive(uns), 'uns > 0 미충족'),
            (positive(out_h), 'outH > 0 미충족'),
            (reduced, 'isolated.uns−uns > 0.01 미충족')) if not ok]
        # 공개 uns·outH는 gridSupply 적용 뒤 값이며 imp는 이웃 거래만 센다.
        print(f'INFO {case} 후보 공개 결과(계통 수입 후에도 남은 부족): '
              f'imp={imports}, uns={uns}, outH={out_h}, '
              f'isolated.uns={isolated}, '
              f'공개 수요 dem={deficit.get("dem")}, '
              f'사유={" / ".join(reasons) if reasons else "네 조건 충족"}, '
              f'설비={partial}, {names["dangjin"]}={public["team"]["dangjin"]}, '
              f'ties={public["ties"]}, flow={public.get("flow")}, '
              f'events={public.get("events")}', flush=True)
        if reasons:
            return False
        checks.ok(traded, f'{case} 공개 {names["pyeongtaek"]} imp > 0: {imports}')
        checks.ok(positive(uns), f'{case} 공개 {names["pyeongtaek"]} uns > 0 (U > 0): {uns}')
        checks.ok(positive(out_h), f'{case} 공개 {names["pyeongtaek"]} outH > 0 (N > 0): {out_h}')
        checks.ok(reduced, f'{case} 공개 isolated.uns−uns > 0.01: '
                  f'고립={isolated}, 거래 후={uns}')
    else:
        if not checks.ok(traded, f'건설·거래 지어진 달 공개 {names["pyeongtaek"]} imp > 0: {imports}'):
            # 빈 계획/무거래 결과를 성공 사례로 세지 않는다. 실제 공개 진단을 남기고 실패한다.
            print(f'INFO 건설·거래 재생 검산 중단: 1월 거래 미발생, '
                  f'{names["pyeongtaek"]}={public["team"]["pyeongtaek"]}, '
                  f'{names["dangjin"]}={public["team"]["dangjin"]}, ties={public["ties"]}, '
                  f'flow={public.get("flow")}, grid={public.get("grid")}, '
                  f'events={public.get("events")}', flush=True)
            return
    export = public['team']['dangjin'].get('exp')
    checks.ok(isinstance(export, (int, float)) and math.isfinite(export) and export > 0,
              f'{case} {names["dangjin"]} 판매 exp > 0: {export}')
    checks.ok(isinstance(isolated, (int, float)) and isolated - deficit['uns'] > 0.01,
              f'{case} {names["pyeongtaek"]} 부족 감소로 보정 규칙 G 사용: '
              f'고립={isolated}, 거래 후={deficit["uns"]}')

    replay_teams = ('pyeongtaek',) if partial is not None else ('pyeongtaek', 'dangjin')
    for city in replay_teams:
        name = names[city]
        page = teams[city]
        page.wait_for_function("""() => {
          const L = KCP.league.state(), fx = KCP.fxTurn?.state?.();
          return L.snap?.phase === 'review' && L.snap?.results?.at(-1)?.round === 1 &&
            (fx?.replayed === true || !!fx?.fallback);
        }""", polling=10)
        state = observe(page)
        label = f'{case} {name} 태블릿 1월'
        fx = state['fx'] or {}
        checks.ok(state['player'] == city and state['resultRound'] == 1 and
                  state['team'] == {key: public['team'][city][key] for key in ('uns', 'outH', 'imp')},
                  f'{label} 자기 도시·같은 달 공개 결과 수신')
        checks.ok(state['replay'] is None and state['replayError'] is None,
                  f'{label} replayOf == null (엔진 없음)')
        checks.ok(fx.get('source') == 'device' and fx.get('fallback') is None and
                  fx.get('replayed') is True,
                  f'{label} 실제 자동 재생 source=device, fallback={fx.get("fallback")}')
        probe = device_equality(checks, page, state, label, include_hours=partial is not None)
        checks.ok(probe.get('engineNull') is True, f'{label} 검산 때도 엔진 없음')
        exact = host.evaluate(HOST_REPLAY_JS, [public['round'], city, partial is not None])
        data = probe.get('data') or {}
        valid = bool(exact and exact.get('valid') and data.get('valid'))
        checks.ok(valid, f'{label} 진행자 replayOf(1, {city}) 정확값 유효')
        checks.ok(valid and abs(exact['sum'] - data['sum']) <= 0.01,
                  f'{label} 진행자 정확값 합계 = 태블릿 Σr (≤ 0.01): '
                  f'진행자={exact.get("sum") if exact else None}, 태블릿={data.get("sum")}')
        checks.ok(valid and exact['outH'] == data.get('outH') == data.get('countedOutH'),
                  f'{label} 진행자 정확값 정전 시간 = 태블릿 outH = r 검산 시간: '
                  f'진행자={exact.get("outH") if exact else None}, '
                  f'태블릿={data.get("outH")}, 검산={data.get("countedOutH")}')
        if partial is not None:
            hours = public['team'][city]
            checks.ok(valid and abs(exact['sum'] - hours['uns']) <= 0.01 and
                      exact['outH'] == hours['outH'],
                      f'{label} 진행자 정확값 합계·정전 시간 = 공개 uns·outH: '
                      f'합계={exact.get("sum") if exact else None}, 공개 uns={hours["uns"]}, '
                      f'정전 시간={exact.get("outH") if exact else None}, 공개 outH={hours["outH"]}')
            remaining, r = (exact or {}).get('remaining') or [], data.get('r') or []
            comparable = valid and len(remaining) == len(r) and bool(r)
            checks.ok(comparable, f'{label} 시간별 진단 배열 길이 일치: '
                      f'정확값={len(remaining)}, r={len(r)}')
            difference = max(abs(a - b) for a, b in zip(remaining, r)) if comparable else None
            print(f'INFO {label} 시간별 |(uns−del)−r| 최댓값={difference} '
                  '(보정 규칙 G: 시간별 차이는 단언하지 않음)', flush=True)
        overflow(checks, page, label + ' 결과')
    return True


def partial_trade_multiplayer(checks, browser, base):
    """첫 시도 + 최대 3번 재시도. 후보 조건 실패는 최종 소진 때만 FAIL한다."""
    suppliers = (
        # 작은 수요지 하나만 연결해 기존 석탄 발전 없이도 소규모 잉여를 만든다.
        {'types':['solar'], 'connectPlants':False, 'demandIds':['HOSP1']},
        {'types':['solar', 'battery'], 'connectPlants':False, 'demandIds':['HOSP1']},
        {'types':['solar', 'solar'], 'connectPlants':False, 'demandIds':['HOSP1']},
        # 재생 접속 대기·출력 부족이면 기존 발전소 연결로 공급 방법을 바꾼다.
        {'types':[], 'connectPlants':True},
    )
    for attempt, supplier in enumerate(suppliers, 1):
        # D-74는 이웃 거래 후 시간별 수요의 50%까지만 메운다. 평택의
        # 새 설비·기존 LNG를 모두 끄고 최소 연계선으로 거래량을 제한한다.
        partial = {'pyeongtaek':{'types':[], 'connectPlants':False}, 'dangjin':supplier}
        print(f'INFO 부분 거래 시도 {attempt}/{len(suppliers)}: '
              f'2 MW 연계선, pyeongtaek 자체 발전 0·시간별 수요 50% 초과 부족 설계, '
              f'설비·연결={partial}', flush=True)
        context, external = context_for(MotionBrowser(browser, False),
                                        base, 1280, 900, 'light')
        pages = []
        try:
            matched = built_trade_multiplayer(checks, context, base, pages, partial=partial)
        except Exception as exc:
            checks.ok(False, f'부분 거래 시도 {attempt} 진행 예외 {type(exc).__name__}: '
                      f'{str(exc).splitlines()[0][:200]}')
            matched = False
        finally:
            for page, events, label in pages:
                diagnostics(checks, events, label)
                overflow(checks, page, label)
            checks.ok(not external, f'부분 거래 시도 {attempt} 외부 연결 시도 0: {external}')
            context.close()
        if matched:
            return
    checks.ok(False, '부분 거래 최초 1회·재시도 3회 소진: '
              'imp > 0, uns > 0, outH > 0, isolated.uns−uns > 0.01인 달 생성 실패 '
              '(각 시도 사유·공개 값은 INFO/진행 예외 참조)')


class MotionBrowser:
    """공통 컨텍스트의 네트워크 격리에 생성 시 움직임 설정만 더한다."""

    def __init__(self, browser, reduced):
        self.browser = browser
        self.motion = 'reduce' if reduced else 'no-preference'

    def new_context(self, **options):
        return self.browser.new_context(reduced_motion=self.motion, **options)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height, reduced in ((1280, 900, False),
                                                (1280, 900, True), (390, 844, False)):
                    label = f'{width}×{height}' + (' reduce' if reduced else '')
                    context, external = context_for(MotionBrowser(browser, reduced),
                                                    base, width, height, 'light')
                    page, events = monitored_page(context)
                    try:
                        if width == 1280 and not reduced:
                            desktop(checks, page, base)
                        else:
                            first_month(checks, page, base, label, reduced)
                    except Exception as exc:
                        checks.ok(False, f'{label} 진행 예외 {type(exc).__name__}: '
                                  f'{str(exc).splitlines()[0][:200]}')
                    finally:
                        diagnostics(checks, events, label)
                        checks.ok(not external, f'{label} 외부 연결 시도 0: {external}')
                        context.close()
                context, external = context_for(MotionBrowser(browser, False),
                                                base, 1280, 900, 'light')
                pages = []
                try:
                    multiplayer(checks, context, base, pages)
                except Exception as exc:
                    checks.ok(False, f'멀티 태블릿 진행 예외 {type(exc).__name__}: '
                              f'{str(exc).splitlines()[0][:200]}')
                finally:
                    for page, events, label in pages:
                        diagnostics(checks, events, label)
                    checks.ok(not external, f'멀티 외부 연결 시도 0: {external}')
                    context.close()
                context, external = context_for(MotionBrowser(browser, False),
                                                base, 1280, 900, 'light')
                pages = []
                try:
                    built_trade_multiplayer(checks, context, base, pages)
                except Exception as exc:
                    checks.ok(False, f'건설·거래 태블릿 진행 예외 {type(exc).__name__}: '
                              f'{str(exc).splitlines()[0][:200]}')
                finally:
                    for page, events, label in pages:
                        diagnostics(checks, events, label)
                        overflow(checks, page, label)
                    checks.ok(not external, f'건설·거래 외부 연결 시도 0: {external}')
                    context.close()
                partial_trade_multiplayer(checks, browser, base)
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f'검사 실행 예외 {type(exc).__name__}: '
                  f'{str(exc).splitlines()[0][:200]}')
    return checks.finish()


if __name__ == '__main__':
    sys.exit(main())
