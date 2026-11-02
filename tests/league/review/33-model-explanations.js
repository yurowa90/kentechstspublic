'use strict';
// W1: 엔진·자료 계약. 실행: node tests/league/review/33-model-explanations.js
// KCP_ROOT=<임시 폴더>로 HEAD의 ui 사본에도 같은 검사를 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lib = require('./lib');
const ROOT = process.env.KCP_ROOT || path.resolve(__dirname, '../../..');
const clone = x => JSON.parse(JSON.stringify(x));
const read = name => fs.readFileSync(path.join(ROOT, 'ui', `${name}.js`), 'utf8');

function runner(name) {
  const results = [];
  return {
    test(label, fn) {
      try { fn(); results.push({ label, pass: true }); }
      catch (e) { results.push({ label, pass: false }); console.error(`FAIL ${label}: ${e.message}`); }
    },
    end() {
      const failures = results.filter(r => !r.pass).length;
      console.log(`${name}: ${results.length} tests, ${failures} failures`);
      const groups = {};
      for (const r of results) {
        const key = /^\[(\d+)\]/.exec(r.label)?.[1] || 'fixture';
        groups[key] ||= { tests: 0, failures: 0 };
        groups[key].tests++; groups[key].failures += r.pass ? 0 : 1;
      }
      console.log(JSON.stringify({ suite: name, groups }));
      process.exitCode = failures ? 1 : 0;
    }
  };
}

// 30~32번처럼 전체 앱을 DOM 없는 vm에 적재한다. 비공개 함수는 IIFE 끝에서
// 참조만 노출한다. 함수 본문·계수·판정은 바꾸거나 복제하지 않는다.
function expose(source, expression) {
  assert.equal(source.match(/\}\)\(\);\s*$/g)?.length, 1, 'IIFE 노출 연결점');
  return source.replace(/\}\)\(\);\s*$/, `${expression}\n})();`);
}
function load({ ui = false, techParam } = {}) {
  const session = { room: 'W1FIXTURE', team: lib.IDS[0] };
  const ctx = vm.createContext({ console, structuredClone, __session: session,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
    let source = read(name);
    // 카드 문자열은 자료 적재 때 만들어지므로 param 생성 직후의 값만 바꾼다.
    if (name === 'tech-data' && techParam) {
      const pattern = new RegExp(`(${techParam.key}: p\\()([\\d.]+)`);
      assert.ok(pattern.test(source), '기술 param 연결점');
      source = source.replace(pattern, (_, prefix) => prefix + techParam.value);
    }
    if (name === 'econ') source = expose(source, 'KCP.__approvalRelative = approvalRelative;');
    if (name === 'league-core') source = expose(source, 'KCP.__core = { eurekaMet, fcxOf };');
    vm.runInContext(source, ctx, { filename: `ui/${name}.js` });
  }
  if (ui) {
    let source = read('league');
    assert.equal(source.split('let L = null;').length, 2, 'VM 세션 연결점');
    source = source.replace('let L = null;', 'let L = globalThis.__session;');
    source = expose(source, `KCP.__ui = { groupCauseHTML, PART_NAMES, hostRisk, hostRiskHTML,
      hostSummaryHTML, techEurekaText, migrationReason,
      approvalBelowLine: typeof approvalBelowLine === 'function' ? approvalBelowLine : null };`);
    vm.runInContext(source, ctx, { filename: 'ui/league.js' });
  }
  const K = ctx.KCP;
  return { K, C: K.leagueCore, B: K.buildGame, D: K.ECON_DATA, X: K.econ,
    T: K.TECH_DATA, U: K.__ui, session };
}

function history(app, months = 12) {
  const { X, D } = app;
  const ids = Object.keys(D.start);
  let E = X.initCities(ids, D, { seed: 'W1-months', months: 12 });
  E = X.calibrate(E, lib.inputsFor(E, () => ({})), D);
  const rows = [];
  for (let n = 1; n <= months; n++) {
    const inputs = lib.inputsFor(E, (id, c) => ({
      e: { uns: id === ids[0] ? 100 : n % 3, costMul: 1 + n / 10, ren: 10 + n },
      p: { taxRes: id === ids[0] ? 2 : -1, taxInd: id === ids[1] ? 2 : 0,
        service: id === ids[0] ? -2 : 1 }
    }));
    ids.forEach((id, i) => { inputs[id].energy.genMWh = { coal: 300 + n * 25 + i * 10 }; });
    const r = X.monthStep(E, inputs, D);
    E = r.E;
    rows.push({ E, report: r.report, n });
  }
  return rows;
}
function view(app, row) {
  const { C } = app, S = C.newState('W1FIXTURE', 'south', 0, row.E.order);
  S.econ = row.E; S.econRep = row.report; S.round = row.n; S.phase = 'review';
  S.rounds = C.monthRounds(12, row.report.year, 1);
  const res = { round: row.n, month: row.report.month, year: row.report.year,
    days: 7, econ: row.report, team: Object.fromEntries(row.E.order.map(id => [id, { unsPct: 0, co2Prod: 0 }])) };
  S.results = [res];
  return { S, V: C.publicView(S, 0), res };
}

function main() {
  const { test, end } = runner('W1 engine');
  const app = load(), { K, C, B, D, T, X } = app;
  const rows = history(app), row = rows.at(-1), { S } = view(app, row), id = row.E.order[0];
  const threshold = T.params.eurekaApproval.v;
  for (const offset of [-0.001, 0.001, 0]) for (const unrest of [0, 1]) {
    test(`[4] SMR 경계 ${offset}, 시위 ${unrest}`, () => {
      const state = clone(S), c = state.econ.cities[id];
      c.approval = c.approval0 - threshold + offset; c.unrest = unrest;
      assert.equal(K.__core.eurekaMet(state, C.regionOf(state.region), B, id, 'smr', {}, {}),
        offset >= 0 || unrest === 0);
    });
  }

  const forecast = clone(S);
  forecast.seedKey = 'W1-forecast'; forecast.round = 1;
  forecast.teams[id].research = { adopted: ['fcst'] };
  // W1-forecast:hwaseong:<사건>의 FNV-1a 나머지 = 118, 103, 434.
  // fc = .5, .5, .3 / x = 1, 1.2, .8. 중심은 각각 .8663, 1.06105,
  // .78614이고 반폭 .35, .35, .21을 더하고 뺀다. 마지막 하한은 .7로 자른다.
  // fcxOf 실행 결과나 화면 템플릿을 기대값으로 복사하지 않는다.
  const fixedForecast = [
    { id: 'heatwave_peak', x: 1, interval: [0.516, 1.216] },
    { id: 'evening_peak_tropical_night', x: 1.2, interval: [0.711, 1.411] },
    { id: 'monsoon_cloud', x: 0.8, interval: [0.7, 0.996] }
  ];
  forecast.events = fixedForecast.map(e => ({ id: e.id, round: 1, x: e.x }));
  test('[5] 고정 예보 검산 도시 ID', () => assert.equal(id, 'hwaseong'));
  for (const event of fixedForecast) test(`[5] ${event.id} 사전 계산 구간`, () =>
    assert.deepEqual(clone(K.__core.fcxOf(forecast, id)[event.id]), event.interval));
  test('[5] fcstWidth 기본값', () => assert.equal(T.params.fcstWidth?.v, 0.7));
  test('[5] fcstWidth 변경이 실제 fcxOf에 반영', () => {
    const before = clone(K.__core.fcxOf(forecast, id)), old = T.params.fcstWidth;
    try {
      T.params.fcstWidth = { ...old, v: 0.3 };
      assert.notDeepEqual(clone(K.__core.fcxOf(forecast, id)), before);
    } finally { if (old) T.params.fcstWidth = old; else delete T.params.fcstWidth; }
  });

  const expected = { lngSpikeFrequency: 3, outageHoursPerPercent: 87.6, koreaOutageHours2019: 0.04,
    islandLineLoss: 3, researchYears: [10, 30], complaintPoliticalEffect: [50, 200] };
  const speeds = C.publicView(S, 0).econ.speeds;
  test('[6] publicView speeds 전체 키 집합', () => assert.deepEqual(Object.keys(speeds).sort(), [
    'eduSpeed', 'eduMemory', 'reviewEvery', 'eduCbam', 'eduConn', 'eduCurtail', 'hazardFreq',
    'monthsPerTurn', 'smrConstruction', 'eduAir', 'eduAirSpecified', 'smrTurns',
    ...Object.keys(expected), 'note', 'items'
  ].sort()));
  for (const [key, value] of Object.entries(expected)) {
    test(`[6] ${key} 기본 숫자`, () => assert.deepEqual(clone(speeds[key]), value));
    test(`[6] ${key} 근거 등급`, () => assert.ok(['O', 'P', 'M', 'G'].includes(D.params[key]?.grade)));
    test(`[6] ${key} 근거 note`, () => assert.ok(D.params[key]?.note?.trim()));
    test(`[6] ${key} param 변경 반영`, () => {
      const old = D.params[key], changed = Array.isArray(value) ? value.map(x => x + 7) : value + 7;
      try {
        D.params[key] = { ...old, v: changed };
        assert.deepEqual(clone(C.publicView(S, 0).econ.speeds[key]), changed);
      } finally { if (old) D.params[key] = old; else delete D.params[key]; }
    });
  }

  // 기존 BMS params 계약·D-72 학생말 표시: 옛 정규식 literal 추출 → params를 바꾼 실제 simulate 결과 비교.
  // build는 bmsParams()를 읽는다. 설명의 93.30% 고정 → 왕복85→87%, 한 방향 약93.3%.
  B.selectPack(C.teamDef(C.regionOf('south'), 'pyeongtaek').pack, 'league');
  const batteryPlan = clone(D.normalStartPlans.pyeongtaek);
  const anchor = B.SITES.find(s => s.dem).tile;
  for (const kind of ['solar', 'battery']) {
    const tile = B.TILES.find(t => !t.out && !B.siteRule(kind, t) &&
      !batteryPlan.builds.some(b => b.i === t.i) && B.routePath(anchor, t.i));
    assert.ok(tile, `BMS ${kind} 연결 픽스처`);
    batteryPlan.builds.push({ t: kind, i: tile.i });
    batteryPlan.lines.push({ p: B.routePath(anchor, tile.i) });
  }
  const runBattery = () => B.simulate({ ...B.sanitize(batteryPlan, 1e9), seed: 7013, season: 'summer' },
    7, { league: true, mods: { tech: ['bms'] } });
  for (const [key, changed] of [['bmsEfficiency', .5], ['bmsFloor', .9]]) {
    test(`[7] ${key} 변경이 simulate의 실제 방전에 반영`, () => {
      const before = runBattery(), old = T.params[key];
      try {
        T.params[key] = { ...old, v: changed };
        const after = runBattery();
        assert.notEqual(after.tot.batOut, before.tot.batOut);
        assert.ok(after.tot.batOut < before.tot.batOut, '효율 하락/하한 상승은 방전량 감소');
      } finally { T.params[key] = old; }
    });
  }
  test('[7] BMS 왕복85→87%, 한 방향 약93.3%', () =>
    assert.match(B.bmsEffectText(), /왕복 효율 85%\s*→\s*87%\(한 방향 약 93\.3%\)/));
  test('[7] BMS 효과에 95.5 없음', () => assert.ok(!B.bmsEffectText().includes('95.5')));
  test('[9] 점수식에 0~100 자름 명시', () => assert.match(X.score(row.E).aggregation.formula, /0\s*[~～–-]\s*100\s*자름/));
  for (const city of row.E.order) test(`[9] ${city} 공동 보너스 150에서 100 상한`, () => {
    // 기하평균은 양수이므로 보너스 150만으로 자르기 전 점수 >100임이 보장된다.
    const E = clone(row.E); E.coop = 150;
    assert.equal(X.score(E).by[city].score, 100);
  });
  // D-79: 옛 손실.012·손실개선 문구 → 기본 손실·용량×1.5/건설비×1.3.
  test('[10] HVDC 손실은 기본 연계선과 같음', () => assert.equal(T.params.hvdcLoss.v, C.TIE_LOSS));
  test('[10] HVDC 용량·계통 제약 카드 문구', () => assert.equal(C.techCards().find(c => c.id === 'hvdc').eff,
    `연계선 용량 ×${T.params.hvdcCap.v}로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×${T.params.hvdcCost.v}`));
  end();
}

module.exports = { load, history, view, runner, clone, read };
if (require.main === module) main();
