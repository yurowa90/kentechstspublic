'use strict';
// D-82 결정 1 독립 계약 검사. 기대값 출처: 사용자 계약, DECISIONS D-80/D-82,
// D82-gridtol-report.md의 제안 max(0.05 MWh/일, |기준|×5%). 구현 상수/분해값을 oracle로 쓰지 않는다.
// VM 경계 노출과 의도적인 메모리 변형만 허용. 파일·브라우저·네트워크·Git 쓰기 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { withoutD90, withoutGroupOwn } = require('./d90-public-contract');
const ROOT = path.resolve(__dirname, '../../..'), OLD = '3dca4f9';
const source = fs.readFileSync(path.join(ROOT, 'ui/league.js'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x)), id = 'pyeongtaek', ids = [id, 'dangjin'];
const failures = [], observations = [], mutations = [];
let assertions = 0;
function ok(value, label) { assertions++; assert.ok(value, label); }
function eq(actual, expected, label) { assertions++; assert.deepEqual(clone(actual), clone(expected), label); }
function near(actual, expected, label, eps = 1e-9) {
  ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= eps,
    `${label}: ${actual} != ${expected} (±${eps})`);
}
function test(label, fn) {
  try { fn(); } catch (e) { failures.push({ label, error: e.message }); console.error(`FAIL ${label}: ${e.stack}`); }
}
const tol = base => Math.max(.05, .05 * Math.abs(base)); // 보고서의 상수 리터럴, UI 상수와 독립.
const fill = row => Math.max(0, row.isolated.uns - row.uns - row.imp + row.sub); // D-80 공개 4항목 계약.
const sum = a => a.parts.reduce((n, p) => n + p.value, 0);
// D82-gridtol-report.md 「입력·중복·정밀도」의 계통 표시 소수 첫째 자리(반 눈금 0.05).
// D-82의 비교 단위로 적용해 날씨·각 단계의 표시 허용폭은 0.05 MWh/일로 둔다.
// 원시 합계는 반올림하지 않으므로 1e-6만 허용한다(보고서의 반올림 합계 0.004보다 엄격).
const DISPLAY_HALF = .05, IDENTITY_EPS = 1e-6;

function load(leagueSource = source, revision = null) {
  const storage = new Map();
  const session = { room: 'D82-contract', team: id, role: 'solo', interview: {}, rev: 0 };
  const ctx = vm.createContext({ console, performance, structuredClone,
    document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
    addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    KCP: { route() {}, on() {}, esc: String, gradeWords: x => x,
      leagueNet: { expandSnapshot: x => x } } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
    let js = revision ? execFileSync('git', ['show', `${revision}:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8' })
      : name === 'league' ? leagueSource : fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8');
    if (name === 'league') {
      assert.match(js, /\}\)\(\);\s*$/);
      js = js.replace(/\}\)\(\);\s*$/, `KCP.__d82 = {
        bind: s => { L = s; }, grid: gridReliance, promise: promiseGridReliance,
        baseline: promiseGridBaseline, compare: promiseComparison, snapshot: outageSnapshot,
        attribution: outageAttribution, monthly: outageAttributionMonthly,
        total: gridTotal, totalText: gridTotalText, receive: onSnap
      };\n})();`);
    }
    vm.runInContext(js, ctx, { filename: `${revision || 'working-tree'}:ui/${name}.js` });
  }
  const K = ctx.KCP, C = K.leagueCore, B = K.buildGame, D = K.ECON_DATA, api = K.__d82;
  api.bind(session);
  return { storage, session, C, B, D, api, R: C.regionOf('south') };
}
function reset(h) {
  h.storage.clear(); h.session.interview = {}; h.session.snap = null;
  h.session.outCache = {}; h.session.outFailures = {}; delete h.session.S;
}
function use(h, V) { h.session.snap = V; h.session.outCache = {}; h.session.outFailures = {}; }
function game(h, empty = false) {
  reset(h);
  const S = h.C.newState(h.session.room, h.R.id, 0, ids, { turns: 12, seedMode: 'fixed' });
  h.C.host(S, 'next', 0); S.events = [];
  for (const city of ids) S.teams[city].plan = empty ? { builds: [], lines: [], policies: [] } : clone(h.D.normalStartPlans[city]);
  return S;
}
function record(h, V, res, values = {}) {
  const map = h.C.teamDef(h.R, id).pack, scope = JSON.stringify([V.room, id]);
  const t = { map, scope, year: res.year, month: res.month, season: res.season,
    unsPct: 0, gridMWh: 288.8, days: 7, seed: 1, outH: 0, co2: 0, cost: 0,
    plan: clone(V.teams[id].plan), ...values };
  h.storage.set('kcp-build-trial-v1', JSON.stringify({ [JSON.stringify([scope, map])]: t }));
  return t;
}
function first(h, empty = false) {
  const S = game(h, empty);
  h.C.run(S, h.B, 0);
  const V = clone(h.C.publicView(S, 0)), res = V.results.at(-1);
  use(h, V);
  return { S, V, res };
}
function note(topic = 'grid', prediction = 'same', trial) {
  return { topic, confirmed: true, pred: { [topic]: prediction }, ...(trial ? { trial } : {}) };
}
// 계획·시뮬레이터는 실제 엔진. 두 달 사본의 운전 조건을 동일하게 고정하고 달력 mdays만 바꾼다.
// 사본은 시험 입력이며, 그 수치나 UI 계산 결과를 기대값으로 복사하지 않는다.
function pair(h, previousDays, currentDays, previousMWh, currentMWh) {
  const f = first(h), old = h.api.snapshot(f.V, f.res, id);
  assert.ok(old, '통제 사례의 실제 운영 사본 생성');
  const months = { '31/28': [1, 2], '28/31': [2, 3], '30/31': [4, 5], '31/30': [3, 4] }[`${previousDays}/${currentDays}`];
  const previous = { ...clone(f.res), month: months[0] }, res = { ...clone(f.res), round: 2, month: months[1] };
  const V = clone(f.V); V.round = 2; V.results = [previous, res];
  V.rounds[0] = { ...V.rounds[0], month: months[0], mdays: previousDays };
  V.rounds[1] = { ...V.rounds[0], month: months[1], mdays: currentDays };
  // 공개 대표기간 총량으로 월 합계/하루 평균 입력을 독립 구성한다.
  if (previousMWh !== undefined) {
    for (const [r, mwh, days] of [[previous, previousMWh, previousDays], [res, currentMWh, currentDays]]) {
      Object.assign(r.team[id], { uns: 0, unsPct: 0, imp: 0, sub: 0, isolated: { uns: mwh * r.days / days } });
    }
  }
  h.session.interview.outageSnapshots = { 1: clone(old), 2: { ...clone(old), round: 2 } };
  use(h, V);
  return { V, res, previous };
}
function pairContract(h, from, to, previousMWh, currentMWh) {
  const f = pair(h, from, to, previousMWh, currentMWh), g = h.api.grid(f.V, f.res, id);
  const base = fill(f.previous.team[id]) / f.previous.days;
  const actual = fill(f.res.team[id]) / f.res.days;
  near(g.perDay, actual, '당월 일평균'); near(g.base.perDay, base, '전월 일평균');
  near(g.deltaPerDay, 0, '같은 하루 평균 차이');
  const pg = h.api.promise(f.V, f.res, id, note()), pb = h.api.baseline(f.V, note());
  eq(pg, g, '지난달이 있으면 약속 결과와 공개 비교 계약 동일');
  near(pb.perDay, base, '계획 기준 지난달 일평균'); eq(pb.days, from, '계획 기준 지난달 일수');
  eq(pb.unit, 'MWh/일', '계획 기준 지난달 단위');
  eq(h.api.compare(f.V, note()).actual, 'same', '달 길이만 다른 경우 같음');
  ok(Math.abs(g.delta) > 1, '옛 월 합계에는 실제 일수 효과 존재');
  const a = h.api.monthly(f.V, f.res, id);
  ok(a && a.target === 'grid', '월간 계통 S7 존재'); eq(a.unit, 'MWh/일', 'S7 단위');
  near(a.parts.find(p => p.key === 'weather').value, 0, '날씨 몫에 달 길이 효과 없음', DISPLAY_HALF);
  near(a.trial, base, 'S7 시작값'); near(a.actual, actual, 'S7 도착값');
  near(a.total, g.deltaPerDay, 'S7 전체 차이');
  near(sum(a), g.deltaPerDay, 'S7 몫 합', IDENTITY_EPS);
  // 각 단계 = 출발값 + 순서대로 더한 몫. 같은 물리 조건이면 모든 단계가 출발 일평균을 유지한다.
  let stage = a.base;
  near(stage, base, 'S7 재계산 출발 단계의 일평균', DISPLAY_HALF);
  for (const p of a.parts) { stage += p.value; near(stage, actual, `S7 ${p.key} 단계 일평균`, DISPLAY_HALF); }
  return { from, to, delta: g.delta, deltaPerDay: g.deltaPerDay, weather: a.parts.find(p => p.key === 'weather').value };
}
const h = load();
for (const [from, to] of [[31, 28], [28, 31], [30, 31], [31, 30]])
  test(`달 길이만 ${from}→${to}`, () => observations.push(pairContract(h, from, to)));

test('5차 2월: 1632.194/31와 같은 하루 평균의 날씨 몫', () => {
  const base = 1632.194 / 31, f = pair(h, 31, 28, 1632.194, base * 28);
  const a = h.api.monthly(f.V, f.res, id);
  near(h.api.grid(f.V, f.res, id).deltaPerDay, 0, '2월 하루 평균 차이');
  eq(h.api.compare(f.V, note()).actual, 'same', '2월 같음');
  near(a.parts.find(p => p.key === 'weather').value, 0, '2월 날씨 0', DISPLAY_HALF);
  near(1632.194 * (28 / 31 - 1), -157.954, '옛 날씨 몫의 달 길이 효과', .001);
});
test('5차 3월: 1053.4/28 → 1002.4/31는 약 14% 감소', () => {
  const f = pair(h, 28, 31, 1053.4, 1002.4), g = h.api.grid(f.V, f.res, id);
  near(g.deltaPerDay, 1002.4 / 31 - 1053.4 / 28, '3월 원시 일평균 차이');
  near(g.deltaPerDay / (1053.4 / 28), -.14, '3월 약 14% 감소', .001);
  eq(h.api.compare(f.V, note()).actual, 'down', '월 합계 같음 대신 줄어듦');
  const a = h.api.monthly(f.V, f.res, id);
  near(sum(a), g.deltaPerDay, '3월 S7 몫 합', IDENTITY_EPS);
});

test('첫 달 시험 원기간 평균·확정 기록 우선·월 합계 보존', () => {
  const { V, res } = first(h), t = record(h, V, res), n = note('grid', 'same', t);
  const price = h.D.params.normalCost.v * h.D.params.gridImportMarkup.v;
  const mwh = fill(res.team[id]) * 31 / res.days;
  for (const [name, g] of [['gridReliance', h.api.grid(V, res, id)], ['promiseGridReliance', h.api.promise(V, res, id, n)]]) {
    eq(g.unit, 'MWh/일', name + ' 단위'); eq(g.days, 31, name + ' 당월 일수');
    eq(g.base.days, 7, name + ' 시험 일수'); near(g.base.perDay, 288.8 / 7, name + ' 시험 직접 평균');
    near(g.mwh, mwh, name + ' 월 합계'); near(g.cost, mwh * price, name + ' 월 비용');
    near(g.base.mwh, 288.8 * 31 / 7, name + ' 기존 기준 월 합계');
    near(g.base.cost, 288.8 * 31 / 7 * price, name + ' 기존 기준 월 비용');
    near(g.delta, mwh - 288.8 * 31 / 7, name + ' 기존 월 차이');
    near(g.deltaCost, (mwh - 288.8 * 31 / 7) * price, name + ' 기존 월 비용 차이');
    near(g.tol, Math.max(1, .05 * 288.8 * 31 / 7), name + ' 기존 월 문턱');
    near(g.perDay, mwh / 31, name + ' 일평균');
    near(g.deltaPerDay, mwh / 31 - 288.8 / 7, name + ' 일평균 차이');
    near(g.deltaPerDayCost, (mwh / 31 - 288.8 / 7) * price, name + ' 일평균 비용 차이');
  }
  // 7일로 하드코딩한 월 환산 변형은 7일 사례만으로 잡을 수 없으므로 9일도 별도로 검사한다.
  const frozen = { unsPct: 0, gridMWh: 288.8, days: 9 }, frozenNote = note('grid', 'same', frozen); // 확정 시험의 최소 저장 형식.
  record(h, V, res, { gridMWh: 999, days: 7 });
  const pg = h.api.promise(V, res, id, frozenNote), pb = h.api.baseline(V, frozenNote);
  near(pg.base.perDay, 288.8 / 9, '확정 시험 9일 직접 평균, 재시험 무시');
  near(pg.base.mwh, 288.8 * 31 / 9, '확정 시험 기존 월 기준 보존');
  near(pb.perDay, 288.8 / 9, '계획 기준 확정 시험 직접 평균');
  near(pb.base.perDay, 288.8 / 9, '계획 기준 base 직접 평균');
  eq(pb.base.days, 9, '계획 기준 시험 일수'); eq(pb.days, 31, '계획 기준 당월 일수'); eq(pb.unit, 'MWh/일', '계획 기준 단위');
  for (const key of ['mwh', 'cost', 'base', 'delta', 'deltaCost', 'tol', 'days', 'perDay', 'deltaPerDay', 'deltaPerDayCost', 'tolPerDay', 'unit'])
    ok(Object.hasOwn(pb, key), 'promiseGridBaseline 필드 ' + key);
  const a = h.api.attribution(V, res, id, frozenNote);
  ok(a && a.target === 'grid', '첫 달 S7 계통'); eq(a.unit, 'MWh/일', '첫 달 S7 단위');
  near(a.trial, 288.8 / 9, '첫 달 S7도 확정 시험 평균');
  near(a.actual, mwh / 31, '첫 달 S7 실제 평균');
  near(sum(a) + a.replay, mwh / 31 - 288.8 / 9, '첫 달 몫+기존 재현 잔차', IDENTITY_EPS);
});
for (const days of [undefined, 0]) test(`옛 시험 days=${days}: 비교 없음`, () => {
  const { V, res } = first(h), t = record(h, V, res, { days });
  for (const g of [h.api.grid(V, res, id), h.api.promise(V, res, id, note('grid', 'same', t))]) {
    eq(g.base.kind, null, '기간 없는 시험 기준 없음');
    ok(g.base.label.startsWith('비교 없음'), '기간 없는 시험 label');
    for (const v of [g.base.perDay, g.base.days, g.deltaPerDay, g.deltaPerDayCost]) eq(v, null, '기간 없는 시험 null');
  }
  eq(h.api.compare(V, note('grid', 'same', t)).actual, null, '옛 시험의 방향 비교 없음');
  eq(h.api.baseline(V, note('grid', 'same', t)).perDay, null, '옛 시험 계획 기준 없음');
});
// D-82 정정: 확정 n.trial의 gridMWh 또는 유효 days가 없으면 3dca4f9처럼 matchingTrial로 대체한다.
// 최근 유효 시험도 없으면 비교 없음(바로 위 검사). 두 판에 같은 공개 결과·약속·최근 시험을 넣어 대조한다.
for (const days of [undefined, 0]) for (const method of ['promise', 'baseline', 'compare'])
  test(`옛 확정 시험 days=${days} / ${method}: 최근 유효 시험으로 대체`, () => {
    const { V, res } = first(h), n = note('grid', 'same', { unsPct: 0, gridMWh: 288.8, days });
    const old = load(null, OLD);
    for (const env of [h, old]) { use(env, V); record(env, V, res, { gridMWh: 999, days: 7 }); }
    if (method === 'promise') {
      const g = h.api.promise(V, res, id, n), previous = old.api.promise(V, res, id, n);
      near(g.base.perDay, 999 / 7, '옛 확정 시험 대신 최근 유효 시험의 하루 평균');
      eq(g.base.mwh, previous.base.mwh, '3dca4f9와 같은 입력의 약속 비교 기준');
    }
    if (method === 'baseline') {
      const g = h.api.baseline(V, n), previous = old.api.baseline(V, n);
      near(g.perDay, 999 / 7, '옛 확정 계획 기준 대신 최근 유효 시험의 하루 평균');
      near(g.mwh, previous.mwh, '3dca4f9와 같은 입력의 계획 비교 기준');
    }
    if (method === 'compare') {
      const actual = h.api.compare(V, n).actual;
      eq(actual, 'down', '옛 확정 약속도 최근 유효 시험 대비 감소 판정');
      eq(actual, old.api.compare(V, n).actual, '3dca4f9와 같은 입력의 방향 판정');
    }
  });
test('보고서 문턱: 하한·비율·≤ 양쪽 경계·증가/감소', () => {
  for (const base of [0, .2, 1, 10, 40]) {
    for (const delta of [0, tol(base), tol(base) + 1e-5, -tol(base), -tol(base) - 1e-5]) {
      if (base + delta < 0) continue;
      const f = pair(h, 28, 31, base * 28, (base + delta) * 31);
      const g = h.api.grid(f.V, f.res, id);
      near(g.tolPerDay, tol(base), '독립 보고서 문턱');
      // 이진 나눗셈 경계 흔들림을 피하려고 정확히 표현되는 0.05/0.5/2 경계는 첫 달 시험으로도 확인한다.
      if (Math.abs(Math.abs(delta) - tol(base)) > 1e-10 || delta === 0)
        eq(h.api.compare(f.V, note()).actual, Math.abs(delta) <= tol(base) ? 'same' : delta > 0 ? 'up' : 'down', '일평균 방향');
    }
  }
  const f = first(h);
  record(h, f.V, f.res, { gridMWh: 0, days: 7 });
  // res.days=1로 정확한 하한 경계를 구성한다. 기대값은 0.05 리터럴이다.
  f.res.days = 1; Object.assign(f.res.team[id], { uns: 0, imp: 0, sub: 0, isolated: { uns: .05 } });
  eq(h.api.compare(f.V, note()).actual, 'same', '하한 0.05 포함 경계');
  for (const [base, delta] of [[10, .5], [10, -.5], [40, 2], [40, -2]]) {
    const p = pair(h, 28, 31);
    for (const [r, value] of [[p.previous, base], [p.res, base + delta]]) {
      r.days = 1; Object.assign(r.team[id], { uns: 0, imp: 0, sub: 0, isolated: { uns: value } });
    }
    eq(h.api.compare(p.V, note()).actual, 'same', `비율 문턱 포함 경계 ${base} ${delta}`);
  }
});
test('끝 화면 12달 합과 월별 기기 저장은 월 합계', () => {
  const S = game(h); let total = 0;
  for (let month = 1; month <= 12; month++) {
    if (month > 1) h.C.host(S, 'next', 0);
    h.api.receive(clone(h.C.publicView(S, 0)));
    h.C.run(S, h.B, 0);
    const V = clone(h.C.publicView(S, 0)), res = V.results.at(-1);
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    const expected = fill(res.team[id]) * days / res.days; total += expected;
    h.api.receive(V);
    near(h.session.interview.interview.metrics[month].grid, expected, `${month}월 저장 월 합계`);
    if (month === 12) {
      h.session.S = S; // 실제 혼자 하기처럼 전체 운영 기록을 가진 세션에서 끝 합계를 읽는다.
      const g = h.api.total(V, id);
      eq(g.months, 12, '끝 합계 12달'); near(g.mwh, total, '끝 합계 월별 합');
      ok(h.api.totalText(V, g).includes('12달 합'), '끝 화면 합계 문구');
    }
  }
});
test('정전 회귀: 3dca4f9와 같은 입력의 첫 달/월간 판정·분해', () => {
  const old = load(null, OLD), S = game(h, true), oldS = game(old, true);
  // E1 의도 변경인 뉴스 배열과 시작 사건의 text만 제외하고 나머지 필드·원소 수는 계속 비교한다.
  const withoutDisplayText = results => {
    const copy = clone(results);
    for (const result of copy) {
      delete result.econ?.news;
      for (const started of result.econ?.intl?.started || []) delete started.text;
    }
    return copy;
  };
  eq(withoutGroupOwn(S, { internal: true }), oldS, '검증된 내부 groupOwn 외 두 판의 최초 입력 동일');
  for (let month = 1; month <= 2; month++) {
    if (month > 1) { h.C.host(S, 'next', 0); old.C.host(oldS, 'next', 0); }
    for (const [env, state] of [[h, S], [old, oldS]]) {
      env.api.receive(clone(env.C.publicView(state, 0)));
      env.C.run(state, env.B, 0);
      const V = clone(env.C.publicView(state, 0)), res = V.results.at(-1);
      use(env, V); record(env, V, res, { unsPct: 50 }); env.api.receive(V);
    }
    eq(withoutDisplayText(withoutGroupOwn(withoutD90(S), { internal: true }).results), withoutDisplayText(oldS.results),
      '검증된 D-90 정산·내부 집단 전용 항 외 두 판 공개 운전 결과 동일');
    const V = h.session.snap, ov = old.session.snap, res = V.results.at(-1), ores = ov.results.at(-1);
    const n = note('uns', 'same', { unsPct: 50, days: 7 });
    const a = h.api.attribution(V, res, id, n), b = old.api.attribution(ov, ores, id, n);
    ok(a && b && a.target === 'uns' && b.target === 'uns', '정전 S7 회귀 입력');
    for (const key of ['target', 'basis', 'base', 'trial', 'actual', 'total', 'replay', 'parts', 'grid'])
      eq(a[key] ?? null, b[key] ?? null, `정전 ${month}월 ${key}`);
    const ac = h.api.compare(V, n), bc = old.api.compare(ov, n);
    for (const key of ['topic', 'delta', 'actual', 'hit']) eq(ac[key], bc[key], `정전 ${month}월 판정 ${key}`);
  }
});

function replaceOnce(js, before, after) {
  assert.equal(js.split(before).length, 2, '변형 지점 정확히 하나: ' + before);
  return js.replace(before, after);
}
function mutation(name, mutate, probe) {
  test('변형 검출 ' + name, () => {
    const changed = mutate(source), env = load(changed);
    let error = null;
    try { probe(env); } catch (e) { error = e; }
    ok(error instanceof assert.AssertionError, `${name}: 하네스 오류가 아니라 계약 단언이 실패해야 함`);
    mutations.push({ name, detected: true, assertion: error.message });
  });
}
mutation('a 판정을 월 합계로 회귀', js => replaceOnce(js,
  'Math.abs(grid.deltaPerDay) <= grid.tolPerDay ? "same" : grid.deltaPerDay > 0',
  'Math.abs(grid.delta) <= grid.tol ? "same" : grid.delta > 0'), env => pairContract(env, 31, 28));
mutation('b S7 단계를 월 환산으로 회귀', js => {
  // 각 단계에 해당 월의 일수를 곱한다. 출발/선택은 지난달, 날씨 이후는 이번 달로 환산하는 옛 결함.
  for (const [before, after] of [
    ['const sim = (plan, seed, season, days, mods, weatherMetrics) => {',
      'const sim = (plan, seed, season, days, mods, weatherMetrics, calendarDays = resultPeriod(V, res).days) => {'],
    ['return outageStageValue(outageFilled(output.raw), target, days);',
      'return outageStageValue(outageFilled(output.raw), target, days) * (target === "grid" ? calendarDays : 1);'],
    ['const base = sim(old.plan, old.seed, old.season, old.days, old.mods);',
      'const base = sim(old.plan, old.seed, old.season, old.days, old.mods, undefined, resultPeriod(V, previousResult).days);'],
    ['const choice = sim(current.plan, old.seed, old.season, old.days, choiceMods, choiceWeather);',
      'const choice = sim(current.plan, old.seed, old.season, old.days, choiceMods, choiceWeather, resultPeriod(V, previousResult).days);'],
    ['outageStageValue(current, target, current.days) : sim(',
      'outageStageValue(current, target, current.days) * (target === "grid" ? resultPeriod(V, res).days : 1) : sim(']
  ]) js = replaceOnce(js, before, after);
  return js;
}, env => pairContract(env, 31, 28));
mutation('c 시험 기준을 ×days/7 월 환산으로 회귀', js => replaceOnce(js,
  'perDay = t.gridMWh / t.days;',
  'perDay = t.gridMWh * resultPeriod(V, res).days / 7;'), env => {
    const { V, res } = first(env), t = record(env, V, res, { days: 9 });
    near(env.api.promise(V, res, id, note('grid', 'same', t)).base.perDay, 288.8 / 9, '확정 시험 직접 평균');
  });
console.log(JSON.stringify({ suite: '40-d82-perday', assertions, failures: failures.length,
  details: failures, observations, mutations, baseline: OLD }));
process.exitCode = failures.length ? 1 : 0;
