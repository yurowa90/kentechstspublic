'use strict';
// D-82: 현재 구현에서 D-80 월 합계 계약의 보존과 추가 필드의 공존을 검사한다.
// 브라우저·네트워크·봇 장기 운전 없음. VM의 GUI 경계만 기존 35/36 방식으로 노출한다.
const assert = require('node:assert/strict');
const path = require('node:path'), vm = require('node:vm');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '../../..'), REV = 'working-tree'; // D-82: 과거 고정판 대신 현재 파일.
const plain = x => JSON.parse(JSON.stringify(x)), clone = structuredClone;
let assertions = 0;
const failures = [], observations = [];
const ok = (v, label) => { assertions++; assert.ok(v, label); };
const eq = (a, b, label) => { assertions++; assert.deepEqual(plain(a), plain(b), label); };
const near = (a, b, label, eps = 1e-9) => ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
  `${label}: ${a} / ${b} (±${eps})`);
function test(label, fn) {
  try { fn(); } catch (e) { failures.push({ label, error: e.message }); console.error(`FAIL ${label}: ${e.stack}`); }
}
function expose(source, code) {
  assert.match(source, /\}\)\(\);\s*$/);
  return source.replace(/\}\)\(\);\s*$/, `${code}\n})();`);
}
function load() {
  const storage = new Map();
  const ctx = vm.createContext({ console, structuredClone, performance,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    KCP: { route() {}, on() {}, esc: String, leagueNet: {}, gradeWords: x => x } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
    let source = fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8'); // D-82
    if (name === 'build') {
      const boundary = '// 화면용: 디젤 건물 번호 → 비트 위치';
      assert.equal(source.split(boundary).length, 2, '35와 같은 애니메이션 직전 경계');
      source = source.replace(boundary, `return res;\n    ${boundary}`);
      source = expose(source, `KCP.__trial = (st, opts) => {
        S = { st, opts, run: null, root: { querySelector: () => null }, alive: false };
        return startRun(7);
      };`);
    }
    if (name === 'league') source = expose(source, `
      KCP.__grid = (V, res, id) => {
        L = { room: V.room, team: id, role: 'solo', snap: V, interview: {} };
        return gridReliance(V, res, id);
      };
      KCP.__promiseGrid = (V, res, id, n) => {
        L = { room: V.room, team: id, role: 'solo', snap: V, interview: {} };
        return promiseGridReliance(V, res, id, n);
      };
      KCP.__gridSameTol = gridSameTol;
      KCP.__zeroOutagePct = ZERO_OUTAGE_PCT;
    `);
    vm.runInContext(source, ctx, { filename: `${REV}:ui/${name}.js` });
  }
  return { K: ctx.KCP, storage };
}
const { K, storage } = load(), B = K.buildGame, C = K.leagueCore, D = K.ECON_DATA;
const R = C.regionOf('south'), id = 'pyeongtaek', map = C.teamDef(R, id).pack;
const TRIAL_KEY = 'kcp-build-trial-v1', P = key => D.params[key].v;
const price = () => P('normalCost') * P('gridImportMarkup');
const scopeOf = (V, team = id) => JSON.stringify([V.room, team]);
function fixture(round = 1) {
  const rounds = [
    { year: 2027, month: 1, season: 'winter', days: 5, mdays: 31 },
    { year: 2027, month: 2, season: 'winter', days: 7, mdays: 28 },
    { year: 2027, month: 3, season: 'spring', days: 7, mdays: 31 }
  ];
  const res = { ...rounds[round - 1], round,
    team: { [id]: { uns: 3, imp: 11, sub: 2, isolated: { uns: 70 } } } };
  return { V: { room: 'D80-contract', region: R.id, round, rounds, results: [res] }, res };
}
function trialFor(V, res, extra = {}) {
  return { map, scope: scopeOf(V), year: res.year, month: res.month, season: res.season,
    days: 7, seed: 7013, unsPct: 0, outH: 0, co2: 1, cost: 2, gridMWh: 19, ...extra };
}
function putTrial(V, trial) {
  storage.set(TRIAL_KEY, JSON.stringify(trial ? { [JSON.stringify([scopeOf(V), map])]: trial } : {}));
}
// 기대값은 계약의 공개 4항목과 달력 일수로 구한다. 구현의 환산 함수는 호출하지 않는다.
function expectedMWh(r, days, representativeDays) {
  return Math.max(0, r.isolated.uns - r.uns - r.imp + r.sub) * days / representativeDays;
}
// rev14b B: 표시값은 월 환산을 거치지 않고 공개 gridFill 합계/대표 일수를 먼저 나눈다.
function shownExpectation(V, res, team, trial) {
  const perDay = result => {
    const r = result?.team?.[team];
    return r && [r.uns, r.imp, r.sub, r.isolated?.uns, result.days].every(Number.isFinite) && result.days > 0
      ? Math.max(0, r.isolated.uns - r.uns - r.imp + r.sub) / result.days : null;
  };
  const previous = V.results.find(r => r.round === res.round - 1);
  const validTrial = trial && trial.map === map && trial.scope === scopeOf(V, team) &&
    ['year', 'month', 'season'].every(k => trial[k] === res[k]) && Number.isFinite(trial.gridMWh) &&
    Number.isFinite(trial.days) && trial.days > 0;
  const base = previous ? perDay(previous) : validTrial ? trial.gridMWh / trial.days : null;
  const actual = perDay(res);
  return { base, delta: actual === null || base === null ? null : actual - base };
}
function inspectShown(a, expected, label) {
  // 연산 순서도 계약이므로 허용 오차 없이 비교한다.
  eq(a.shownBasePerDay, expected.base, `${label}: B 표시 기준 = 합계/원래 일수`);
  eq(a.shownDeltaPerDay, expected.delta, `${label}: B 표시 차이 = 이번 달 하루 평균 − 기준`);
}
function inspect(V, res, expected, team = id) {
  const before = JSON.stringify(V), saved = JSON.stringify([...storage]);
  const a = K.__grid(V, res, team), b = K.__grid(V, res, team);
  // D-82: 기존 월 합계 필드는 아래 산식 단언을 유지하고 일평균 필드만 추가한다.
  eq(Object.keys(a).sort(), ['mwh', 'cost', 'base', 'delta', 'deltaCost', 'tol',
    'days', 'perDay', 'deltaPerDay', 'deltaPerDayCost', 'tolPerDay', 'unit',
    'shownBasePerDay', 'shownDeltaPerDay'].sort(), 'D-82 반환 키'); // rev14b B 표시 전용 2키 추가.
  eq(Object.keys(a.base).sort(), ['kind', 'label', 'mwh', 'cost', 'days', 'perDay'].sort(), 'D-82 base 반환 키');
  eq(a, b, '같은 입력 두 번 호출 값 동일');
  eq(JSON.stringify(V), before, '호출 전후 V 직렬화 불변');
  eq(JSON.stringify([...storage]), saved, '호출 전후 시험 저장 불변');
  for (const key of ['mwh', 'cost', 'delta', 'deltaCost', 'tol']) {
    if (expected[key] === null) eq(a[key], null, `${key} null 규칙`);
    else near(a[key], expected[key], `${key} 계약 산식`);
  }
  eq(a.base.kind, expected.base.kind, '기준 kind');
  eq(a.base.label, expected.base.label, '기준 label');
  for (const key of ['mwh', 'cost']) {
    if (expected.base[key] === null) eq(a.base[key], null, `base.${key} null 규칙`);
    else near(a.base[key], expected.base[key], `base.${key} 계약 산식`);
  }
  const trial = Object.values(JSON.parse(storage.get(TRIAL_KEY) || '{}'))[0];
  const shown = shownExpectation(V, res, team, trial);
  inspectShown(a, shown, 'gridReliance');
  const promise = K.__promiseGrid(V, res, team, {});
  eq(Object.keys(promise).sort(), Object.keys(a).sort(), 'promiseGridReliance도 B 표시 전용 키 포함');
  inspectShown(promise, shown, 'promiseGridReliance');
  eq(JSON.stringify(V), before, '표시 전용 필드 호출 뒤 V 불변');
  eq(JSON.stringify([...storage]), saved, '표시 전용 필드 호출 뒤 저장 불변');
  return a;
}
function expectation(mwh, kind = null, label = '비교 없음(첫 결과)', baseMWh = null) {
  const cost = mwh == null ? null : mwh * price(), baseCost = baseMWh == null ? null : baseMWh * price();
  return { mwh, cost, base: { kind, label, mwh: baseMWh, cost: baseCost },
    delta: mwh == null || baseMWh == null ? null : mwh - baseMWh,
    deltaCost: cost == null || baseCost == null ? null : cost - baseCost,
    tol: baseMWh == null ? 1 : Math.max(1, .05 * Math.abs(baseMWh)) };
}
test('첫 달 시험 없음: 키·산식·순수성·null', () => {
  const { V, res } = fixture(); putTrial(V, null);
  inspect(V, res, expectation((70 - 3 - 11 + 2) * 31 / 5));
});
test('이번 달 시험 기준: trial.days로 이번 달 환산', () => {
  const { V, res } = fixture(), trial = trialFor(V, res, { days: 9 }); putTrial(V, trial);
  // 총괄 10-22 녹화 전 점검: 기준 이름은 실제로 읽은 시험 기록의 9일을 따른다.
  inspect(V, res, expectation(58 * 31 / 5, 'trial', '시험 9일 대비', 19 * 31 / 9));
});
test('rev14b B 첫 달 약속 시험 우선·각 시험 원래 일수', () => {
  const { V, res } = fixture(), saved = trialFor(V, res, { days: 9 });
  putTrial(V, saved);
  const n = { trial: { ...saved, days: 11, gridMWh: 13 } };
  const before = JSON.stringify({ V, n, storage: [...storage] });
  inspectShown(K.__grid(V, res, id), shownExpectation(V, res, id, saved), 'gridReliance 저장 시험');
  inspectShown(K.__promiseGrid(V, res, id, n), shownExpectation(V, res, id, n.trial), 'promiseGridReliance 약속 시험');
  eq(JSON.stringify({ V, n, storage: [...storage] }), before, '표시값 계산이 약속·시험·공개 결과를 바꾸지 않음');
});
test('옛 시험 gridMWh 누락: lastTrial 호환과 비교 불가', () => {
  const { V, res } = fixture(), trial = trialFor(V, res); delete trial.gridMWh; putTrial(V, trial);
  eq(B.lastTrial(map, scopeOf(V)), trial, '옛 기록 전체 그대로 반환');
  ok(!Object.hasOwn(B.lastTrial(map, scopeOf(V)), 'gridMWh'), '누락 필드를 0으로 만들지 않음');
  inspect(V, res, expectation(58 * 31 / 5, null, '비교 없음(시험 기록에 계통 값 없음)'));
});
for (const gridMWh of [0, null, '19']) test(`시험 gridMWh=${JSON.stringify(gridMWh)} 숫자만 사용`, () => {
  const { V, res } = fixture(); putTrial(V, trialFor(V, res, { gridMWh }));
  inspect(V, res, typeof gridMWh === 'number' ? expectation(58 * 31 / 5, 'trial', '시험 1주 대비', 0) :
    expectation(58 * 31 / 5, null, '비교 없음(시험 기록에 계통 값 없음)'));
});
for (const [key, value] of [['year', 2026], ['month', 2], ['season', 'summer'], ['scope', 'other-room'], ['map', 'cheonan']])
  test(`같은 방·도시·월·계절 아닌 시험 제외: ${key}`, () => {
    const { V, res } = fixture(); putTrial(V, trialFor(V, res, { [key]: value }));
    inspect(V, res, expectation(58 * 31 / 5));
  });
test('둘째 달: 지난달 우선, 양쪽의 다른 대표 일수·월 일수로 환산', () => {
  const { V, res } = fixture(2), prev = fixture().res;
  prev.team[id] = { uns: 1, imp: 2, sub: 3, isolated: { uns: 40 } };
  V.results = [res, prev]; putTrial(V, trialFor(V, res, { gridMWh: 999 }));
  inspect(V, res, expectation(58 * 28 / 7, 'last', '지난달 대비', 40 * 31 / 5));
});
test('셋째 달: 배열 순서와 무관하게 round−1만 기준', () => {
  const { V, res } = fixture(3), first = fixture().res, prev = fixture(2).res;
  prev.team[id].isolated.uns = 30;
  V.results = [prev, res, first]; putTrial(V, null);
  inspect(V, res, expectation(58 * 31 / 7, 'last', '지난달 대비', 18 * 28 / 7));
});
test('지난달 공개 값 누락: null 규칙과 전용 label', () => {
  const { V, res } = fixture(2), prev = fixture().res;
  delete prev.team[id].isolated;
  V.results.unshift(prev); putTrial(V, null);
  const before = JSON.stringify(V), a = K.__grid(V, res, id);
  eq(JSON.stringify(V), before, '지난달 자료 누락도 V 불변');
  near(a.mwh, 58 * 28 / 7, '이번 달은 계산 가능');
  eq(a.base.kind, null, '계산 불가능한 지난달을 last로 선택하지 않음');
  for (const value of [a.base.mwh, a.base.cost, a.delta, a.deltaCost]) eq(value, null, '기준 없으면 null');
  near(a.tol, 1, '기준 없으면 문턱 1');
  eq(a.base.label, '비교 없음(지난달 계통 값 없음)', '지난달 결과는 있으나 공개 값이 빠진 경우의 계약 label');
  const shown = shownExpectation(V, res, id, null);
  inspectShown(a, shown, 'gridReliance 지난달 값 누락');
  inspectShown(K.__promiseGrid(V, res, id, {}), shown, 'promiseGridReliance 지난달 값 누락');
});
test('normalCost와 gridImportMarkup은 params 변경을 읽음', () => {
  const { V, res } = fixture(); putTrial(V, trialFor(V, res));
  const old = [P('normalCost'), P('gridImportMarkup')];
  try {
    D.params.normalCost.v = .023; D.params.gridImportMarkup.v = 1.73;
    inspect(V, res, expectation(58 * 31 / 5, 'trial', '시험 1주 대비', 19 * 31 / 7));
  } finally { [D.params.normalCost.v, D.params.gridImportMarkup.v] = old; }
});
for (const [label, change] of [
  ['uns', r => { r.uns += 7; }], ['imp', r => { r.imp += 9; }],
  ['sub', r => { r.sub += 4; }], ['isolated.uns', r => { r.isolated.uns += 13; }],
  ['0으로 절단', r => { r.uns = 100; }]
]) test(`공개 필드만 바꾸어 산식 민감도: ${label}`, () => {
  const { V, res } = fixture(); putTrial(V, null);
  const initial = K.__grid(V, res, id).mwh;
  change(res.team[id]);
  const expected = expectedMWh(res.team[id], 31, 5);
  ok(expected !== initial, '해당 공개 필드 변경이 mwh를 실제로 바꾸는 fixture');
  inspect(V, res, expectation(expected));
});
for (const field of ['uns', 'imp', 'sub', 'isolated.uns']) test(`계산 불가 null: ${field} 누락`, () => {
  const { V, res } = fixture(); putTrial(V, trialFor(V, res));
  if (field === 'isolated.uns') delete res.team[id].isolated.uns; else delete res.team[id][field];
  inspect(V, res, expectation(null, 'trial', '시험 1주 대비', 19 * 31 / 7));
});
test('tol 절댓값·하한·null, ZERO_OUTAGE_PCT', () => {
  for (const [base, expected] of [[null, 1], [0, 1], [10, 1], [20, 1], [20.01, 1.0005], [100, 5], [-100, 5]])
    near(K.__gridSameTol(base), expected, `tol(${base})`);
  near(K.__zeroOutagePct, .005, '공통 정전 0 상수');
});

function game(monthly = true, plans = true) {
  // 혼자 하기도 엔진의 최소 2도시 조건을 따름. 4차와 같은 평택 플레이어, 12달, 날씨·사건 고정.
  const ids = R.teams.map(t => t.id);
  const S = C.newState('D80-fixed', R.id, 0, ids, monthly ? { turns: 12, seedMode: 'fixed' } : undefined);
  C.host(S, 'next', 0); S.events = [];
  for (const team of ids) S.teams[team].plan = plans ? clone(D.normalStartPlans[team]) : { builds: [], lines: [], policies: [] };
  return S;
}
function runTrial(S, team = id, mode = 'league') {
  B.selectPack(C.teamDef(R, team).pack, mode);
  const rd = C.roundsOf(S)[S.round - 1], V = C.publicView(S, 0);
  const plan = B.sanitize(clone(S.teams[team].plan), 1e9);
  Object.assign(plan, { seed: 7000 + S.round * 13, season: rd.season });
  const mods = C.trialMods(V, R, team), raw = B.simulate(clone(plan), 7, { league: true, mods });
  const calls = [], original = C.gridFill;
  C.gridFill = sim => {
    const before = sim.tot.by.import, filled = original(sim);
    calls.push({ before, after: filled.tot.by.import }); return filled;
  };
  let result;
  try {
    result = K.__trial(plan, { league: true, trialScope: scopeOf(V, team),
      leagueRound: () => rd, leagueMods: () => mods });
  } finally { C.gridFill = original; }
  const saved = B.lastTrial(C.teamDef(R, team).pack, scopeOf(V, team));
  return { result, raw, saved, calls, rd };
}
for (const team of [id, 'cheonan']) for (const plans of [false, true]) test(`A-2 경제 시험 ${team} ${plans ? '기준 배치' : '빈 계획'}`, () => {
  const S = game(true, plans), { result, raw, saved, calls } = runTrial(S, team);
  eq(calls.length, 1, '실제 startRun에서 gridFill 1회');
  ok(saved.gridMWh >= 0, '새 시험 기록의 gridMWh 비음수');
  near(saved.gridMWh, calls[0].after - calls[0].before, '실제 gridFill 뒤−앞 import');
  near(saved.gridMWh, result.tot.by.import - raw.tot.by.import, '같은 시험 입력의 수입 증가분');
  const expected = Array.from({ length: raw.H }, (_, k) => {
    let shortage = 0;
    for (let ti = 0; ti < raw.NT; ti++) shortage += raw.hrUns[k * raw.NT + ti];
    return Math.min(Math.fround(shortage), raw.hrDem[k] * P('gridImportShare'));
  }).reduce((a, b) => a + b, 0);
  near(saved.gridMWh, expected, '독립 시간별 min(부족, 수요×상한)의 합', 1e-7);
  ok(saved.gridMWh > 0, '0으로만 저장하는 결함을 검출할 양수 사례');
});
test('A-2 기존 수입 설비 출력과 gridFill 추가분을 분리', () => {
  // 리그 지도는 dispOf(import).cap=0이다. 원래 지도 모드에서 수입 접속점이
  // 실제 발전하는 평택을 선택하고 같은 리그 __trial 경로를 실행하는 통제 사례.
  // 발전·급전·기록 함수와 반환값은 조작하지 않는다.
  const { raw, result, saved, calls } = runTrial(game(), id, null);
  ok(raw.tot.by.import > 0, 'gridFill 전 지도 수입 설비 출력이 실제 양수');
  eq(calls.length, 1, '리그 경제 시험 보정 경로 실행');
  near(saved.gridMWh, result.tot.by.import - raw.tot.by.import, '지도 출력 제외 후 저장');
  near(saved.gridMWh, calls[0].after - calls[0].before, '실제 앞뒤 차이 일치');
  ok(saved.gridMWh > 0 && saved.gridMWh < result.tot.by.import, '두 종류 수입이 모두 존재하고 구별됨');
  observations.push({ case: 'map-import-control', rawImportMWh: raw.tot.by.import,
    totalImportMWh: result.tot.by.import, savedGridMWh: saved.gridMWh });
});
for (const round of [1, 2, 3, 4]) test(`A-2 계절 모드 ${round}라운드 gridMWh=0`, () => {
  const S = game(false); S.round = round;
  const { saved, calls } = runTrial(S);
  eq(calls.length, 0, '계절 시험은 gridFill 미호출');
  eq(saved.gridMWh, 0, '계절 시험 저장값 0');
});
test('실제 공개 결과에서 불필요한 필드 제거 후 동일', () => {
  const S = game(), res = C.run(S, B, 0), V = plain(C.publicView(S, 0)), publicRes = V.results.at(-1);
  putTrial(V, null);
  const expected = expectedMWh(res.team[id], 31, res.days), full = inspect(V, publicRes, expectation(expected));
  const r = publicRes.team[id];
  publicRes.team[id] = { uns: r.uns, imp: r.imp, sub: r.sub, isolated: { uns: r.isolated.uns } };
  const minimal = inspect(V, publicRes, expectation(expected));
  eq(minimal, full, '공개 4항목 이외를 모두 지워도 같은 값');
});
test('6: 4차 유사 조건 첫 달 시험/실제 월 환산 관측(일치 단언 없음)', () => {
  const S = game(), { result: trial, saved } = runTrial(S), res = C.run(S, B, 0), V = plain(C.publicView(S, 0));
  const actual = K.__grid(V, V.results.at(-1), id), trialMonthly = saved.gridMWh * 31 / saved.days;
  observations.push({ case: 'first-month-fixed-pyeongtaek', room: S.room, player: id,
    active: S.active, turns: 12, seed: res.seed, events: res.events, plan: 'normalStartPlans',
    trialUnsPct: 100 * trial.unsTotal / trial.tot.dem, actualUnsPct: res.team[id].unsPct,
    trialGridMWh: saved.gridMWh, trialMonthlyMWh: trialMonthly, actualMonthlyMWh: actual.mwh,
    trialSign: Math.sign(trialMonthly), actualSign: Math.sign(actual.mwh), ratio: actual.mwh / trialMonthly,
    trialOrder10: Math.floor(Math.log10(trialMonthly)), actualOrder10: Math.floor(Math.log10(actual.mwh)) });
});
console.log(JSON.stringify({ suite: '37-d80-grid', implementation: REV, assertions,
  failures: failures.length, details: failures, observations }));
process.exitCode = failures.length ? 1 : 0;
