'use strict';
/*
 * 기대값의 근거: 이슈 #84, 결정 D-96, 기준판 142a6f1의 econ.js 보고 단계와
 * league-core.js의 econMonth·econView, league.js의 혼자 하기 진행 순서.
 * 이전 확정 뒤의 현재값·이력·보고·점수가 같은 달 장부를 읽어야 한다.
 * 표본 8판은 기준판 사본에서 골랐다. 2VQP3L을 제외하고 12월 확정 ≥ 1판,
 * 1~11월 확정 ≥ 3판, 12달 내내 확정 없음 ≥ 1판을 실제 뉴스로 다시 센다.
 * 진행자 모양은 기준판에서 26개 코드를 시도했으나 확정이 없어, 지시서의
 * 대안대로 빈 계획 6도시의 장부만 검사한다. 컴퓨터 계획은 호출하지 않는다.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_ROOMS = ['J6L2MP', 'TVHP7J', 'X4FXUU', 'QEU4YJ',
  '5NLBR9', 'YBKLME', 'THQ524', 'VU4CQ2'];
const HOST_ROOMS = ['J6L2MP'];
const PLAYER = 'pyeongtaek';
const HIST_KEYS = ['t', 'pop', 'ind', 'cash', 'appr'].sort();
// monthStep의 도시 보고 리터럴. 호스트는 여기에 필드를 덧붙이지 않는다.
const CITY_KEYS = ['pm25', 'causes', 'L', 'A', 'Lparts', 'Aparts', 'Leff', 'Aeff',
  'pop', 'ind', 'dPop', 'dInd', 'co2Intensity', 'bioCo2', 'out', 'demandMul', 'cash'].sort();
// monthStep의 보고 필드와 region·contrib·score, econMonth의 co2Attribution·grid.
const REPORT_KEYS = ['t', 'year', 'month', 'season', 'days', 'weekMul', 'flows', 'net',
  'fiscal', 'groups', 'cities', 'intl', 'offers', 'review', 'news', 'totals', 'region',
  'contrib', 'score', 'co2Attribution', 'grid'].sort();

let assertions = 0, failures = 0;
const started = performance.now();
function test(name, fn, blocked = false) {
  assertions++;
  try { fn(); return true; } catch (e) {
    failures++;
    console.log(`${blocked ? 'BLOCKED' : 'FAIL'} ${name}: ${String(e.message).split('\n')[0]}` +
      ` actual=${JSON.stringify(e.actual)} expected=${JSON.stringify(e.expected)}`);
    return false;
  }
}

let ctx, C, BG, R, ALL;
const loaded = test('엔진 여덟 파일 격리 적재와 평택 자리 준비', () => {
  ctx = vm.createContext({ console, structuredClone, performance,
    document: { documentElement: {} },
    KCP: { route() {}, on() {}, esc: x => x, gradeWords: String } });
  ctx.window = ctx;
  // 격리 맥락 자체의 표준 내장 객체를 그대로 쓴다. 반복적인 전역 조회만 줄인다.
  vm.runInContext('const Math = globalThis.Math, Object = globalThis.Object, ' +
    'Array = globalThis.Array, Number = globalThis.Number, JSON = globalThis.JSON;', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ',
    'league-data', 'league-core', 'league-ai']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui', `${name}.js`), 'utf8'), ctx,
      { filename: `ui/${name}.js` });
  }
  C = ctx.KCP.leagueCore;
  BG = ctx.KCP.buildGame;
  R = C.regionOf('south');
  ALL = Array.from(R.teams, t => t.id);
  assert.equal(ALL.length, 6, '남부 6도시');
  assert.equal(R.teams.find(t => t.id === PLAYER)?.name, '평택', '평택 식별자');
}, true);

function viewLedger(view, label) {
  for (const id of ALL) {
    const city = view.cities[id], last = city.hist.at(-1);
    test(`${label} ${id}] econView 이력 pop = 현재값`, () => assert.equal(last?.pop, city.pop));
    test(`${label} ${id}] econView 이력 ind = 현재값`, () => assert.equal(last?.ind, city.ind));
  }
}

function monthLedger(S, rep, before, label) {
  const view = C.econView(S);
  for (const id of ALL) {
    const c = S.econ.cities[id], h = c.hist.at(-1), report = rep.cities[id];
    const tag = `${label} ${id}]`;
    test(`${tag} hist 길이 정확히 1 증가`, () => assert.equal(c.hist.length, before[id].histLength + 1));
    test(`${tag} hist 마지막 행 t = 보고 달`, () => assert.equal(h?.t, rep.t));
    test(`${tag} hist 마지막 행 키 집합 유지`, () => assert.deepStrictEqual(Object.keys(h).sort(), HIST_KEYS));
    test(`${tag} hist 마지막 행 pop = 현재값`, () => assert.equal(h.pop, c.pop));
    test(`${tag} hist 마지막 행 ind = 현재값`, () => assert.equal(h.ind, c.ind));
    test(`${tag} report pop = 현재값`, () => assert.equal(report.pop, c.pop));
    test(`${tag} report ind = 현재값`, () => assert.equal(report.ind, c.ind));
    test(`${tag} report dPop = 현재값 − 달 시작값`, () => assert.equal(report.dPop, c.pop - before[id].pop));
    test(`${tag} report dInd = 현재값 − 달 시작값`, () => assert.equal(report.dInd, c.ind - before[id].ind));
    test(`${tag} report 도시 키 집합 유지`, () => assert.deepStrictEqual(Object.keys(report).sort(), CITY_KEYS));
  }
  test(`${label}] score 보고 = econView`, () => assert.deepStrictEqual(rep.score, view.score));
  test(`${label}] score 보고 = 현재 경제 점수`, () => assert.deepStrictEqual(rep.score, ctx.KCP.econ.score(S.econ)));
  test(`${label}] report 최상위 키 집합 유지`, () => assert.deepStrictEqual(Object.keys(rep).sort(), REPORT_KEYS));
  viewLedger(view, label);
}

function play(room, multi = false) {
  const mode = multi ? '진행자' : '혼자', label = `${room} ${mode}`;
  const boardStarted = performance.now(), accepted = [];
  let S;
  if (!test(`[${label}] 새 판과 6도시 자리 준비`, () => {
    S = C.newState(room, R.id, 0, ALL, { turns: 12, seedMode: 'room' });
    for (const id of ALL) {
      const result = C.reduce(S, { type: 'claim', team: id, token: `solo-city-${id}` }, 0, BG);
      assert.equal(result.ok, true, `${id} 자리 요청`);
    }
  }, true)) return null;

  for (let month = 1; month <= 12; month++) {
    const tag = `[${label} ${month}월`;
    let rep, before;
    if (!test(`${tag}] 달 시작·빈 계획·준비·운영 경로`, () => {
      assert.equal(C.host(S, 'next', 0), true, '달 시작');
      assert.equal(S.phase, 'plan', '계획 단계');
      if (!multi) {
        C.computerPlans(S, BG, PLAYER, 'balanced', false);
        C.computerPlans(S, BG, PLAYER, 'balanced', true);
      }
      for (const id of multi ? ALL : [PLAYER]) {
        const token = S.teams[id].token;
        const plan = C.reduce(S, { type: 'plan', team: id, token,
          rev: S.teams[id].rev + 1, plan: { builds: [], lines: [], policies: [], rq: [] } }, 0, BG);
        assert.equal(plan.ok, true, `${id} 빈 계획`);
        if (!multi) C.computerPlans(S, BG, PLAYER, 'balanced', true);
        const ready = C.reduce(S, { type: 'ready', team: id, token, ready: true }, 0, BG);
        assert.equal(ready.ok, true, `${id} 준비`);
      }
      before = Object.fromEntries(ALL.map(id => {
        const city = S.econ.cities[id];
        return [id, { pop: city.pop, ind: city.ind, histLength: city.hist.length }];
      }));
      rep = C.run(S, BG, 0)?.econ;
      assert.ok(rep, '월 보고 존재');
      assert.equal(rep.month, month, '보고 월');
      assert.equal(S.phase, 'review', '결산 단계');
    }, true)) return null;

    // 다음 달을 열기 전에 현재 장부를 검사한다. 확정이 없는 달도 같은 단언을 한다.
    monthLedger(S, rep, before, tag);
    const news = rep.news.filter(n => n.includes(' 이전 확정('));
    for (const line of news) accepted.push({ month, news: line });
    if (!multi && room === '2VQP3L' && month === 12) {
      test(`${tag}] 재현 장면 바이오 공장 당진 1,400명 확정`, () => {
        assert.ok(rep.news.includes('바이오 의약품 공장 → 당진 이전 확정(1,400명)'), '명세의 12월 이전 뉴스');
      }, true);
    }
  }
  test(`[${label} 끝] 마지막 결산 뒤 종료 단계`, () => {
    assert.equal(C.host(S, 'next', 0), true);
    assert.equal(S.phase, 'end');
  });
  viewLedger(C.econView(S), `[${label} 끝`);
  if (!multi && room === '2VQP3L') {
    test(`[${label} 끝 ${PLAYER}] 재현 장면 현재 주민 568,505명`, () => {
      assert.equal(S.econ.cities[PLAYER].pop, 568505, '이전 결과 보존');
    }, true);
  }
  console.log(`INFO ${label} 확정=${accepted.length ? accepted.map(o => `${o.month}월 ${o.news}`).join(' / ') : '없음'}` +
    ` 소요=${((performance.now() - boardStarted) / 1000).toFixed(2)}초`);
  return { room, accepted };
}

if (loaded) {
  play('2VQP3L');
  const samples = SAMPLE_ROOMS.map(room => play(room));
  test('[고정 표본 8판] 표본 완주와 코드 구분', () => {
    assert.equal(samples.filter(Boolean).length, 8);
    assert.equal(new Set(SAMPLE_ROOMS).size, 8);
    assert.ok(!SAMPLE_ROOMS.includes('2VQP3L'));
  }, true);
  const count = predicate => samples.filter(board => board && predicate(board.accepted)).length;
  const last = count(rows => rows.some(o => o.month === 12));
  const earlier = count(rows => rows.some(o => o.month >= 1 && o.month <= 11));
  const none = count(rows => rows.length === 0);
  test('[고정 표본 8판] 12월 이전 확정 판 ≥ 1', () => assert.ok(last >= 1, `관측 ${last}판`), true);
  test('[고정 표본 8판] 1~11월 이전 확정 판 ≥ 3', () => assert.ok(earlier >= 3, `관측 ${earlier}판`), true);
  test('[고정 표본 8판] 12달 이전 확정 없는 대조군 ≥ 1', () => assert.ok(none >= 1, `관측 ${none}판`), true);
  console.log(`INFO 고정 표본 덮개 12월=${last}판 1~11월=${earlier}판 확정없음=${none}판`);
  console.log('INFO 진행자 모양은 기준판 26개 코드에서 이전 확정이 없어 장부 단언만 적용');
  for (const room of HOST_ROOMS) play(room, true);
}
console.log(`INFO 전체 소요=${((performance.now() - started) / 1000).toFixed(2)}초`);
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode = failures ? 1 : 0;
