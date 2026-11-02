'use strict';
// 총괄 10-22 녹화 전 점검: S6 방향·S8 결과 인용·S3/S4/S6 시험 기간 회귀.
// d82ux-node.js와 같이 전체 소스를 VM에서 실행하고 비공개 함수 진입점만 연다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let checks = 0, failures = 0;
function test(label, fn) {
  checks++;
  try { fn(); console.log('PASS ' + label); }
  catch (error) { failures++; console.error('FAIL ' + label + ': ' + error.message); }
}
const session = {}, storage = new Map();
const mem = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  localStorage: mem, sessionStorage: mem, addEventListener() {},
  document: { documentElement: {}, addEventListener() {}, getElementById: () => null },
  KCP: { route() {}, on() {}, gradeWords: String, esc: String, leagueNet: {} } });
ctx.window = ctx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../ui/${name}.js`), 'utf8'), ctx);
const source = fs.readFileSync(path.resolve(__dirname, '../../ui/league.js'), 'utf8');
assert.equal(source.split('let L = null;').length, 2);
assert.equal(source.split('KCP.league = {').length, 2);
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('KCP.league = {', 'globalThis.__hooks = { promiseResultHTML, learningVerdict, rememberLocalPlan, reasonStartsHTML, trialGoals, predictionHTML, outageBaseline, promiseGridBaseline, promiseGridReliance, gridReliance }; KCP.league = {'), ctx);
const api = ctx.__hooks, C = ctx.KCP.leagueCore, B = ctx.KCP.buildGame;
// 기존 자료의 식별자를 읽어 사용한다. 테스트에 도시·회사 이름을 직접 적지 않는다.
const region = C.regionOf('south'), ids = region.teams.slice(0, 2).map(t => t.id), id = ids[0];
const S = C.newState('PRERECFIX', region.id, 0, ids, { turns: 12, seedMode: 'fixed' });
C.host(S, 'next', 0);
B.selectPack(C.teamDef(region, id).pack, 'league');
B.current = () => ({ builds: [], lines: [], policies: [], rq: [] });
let trial = null;
B.lastTrial = () => trial;
Object.assign(session, { role: 'solo', room: S.room, team: id, S, snap: S,
  interview: { docs: {}, journal: {}, interview: { months: {} } } });
const months = session.interview.interview.months;
function result(round, unsPct, perDay = 3.37) {
  return { ...S.rounds[round - 1], round, days: 7,
    team: { [id]: { unsPct, outH: 2, co2Cons: 86.31, co2Prod: 70,
      isolated: { uns: perDay * 7 }, uns: 0, imp: 0, sub: 0 } } };
}
function note(topic = 'uns', key = 'grid', value = 153, wind) {
  const n = { topic, confirmed: true, evidence: { key, value, text: '가상 근거' }, pred: { [topic]: 'up' } };
  if (wind !== undefined) {
    n.outageOpened = true;
    n.outageFrozen = { basis: 'monthly', target: topic, unit: topic === 'grid' ? 'MWh/일' : '%p', round: S.round, id,
      hasConnectedWind: wind, base: 1, trial: 1, actual: 2, total: 1, replay: 0,
      parts: [{ key: 'weather', value: 1 }, { key: 'growth', value: 0 }],
      clues: { weather: '가상 날씨', growth: '가상 변화' }, grid: { value: 0, waitingMW: 0 } };
  }
  months[S.round] = n;
  return n;
}
function direction(n) {
  return api.promiseResultHTML(S, n).match(/id="lg-evidence-direction">([^<]*)<\/p>/)[1];
}
S.phase = 'review'; S.round = 2; S.results = [result(1, 2, 1), result(2, 4)];
months[1] = { evidenceValues: { grid: 100, fuel: 100, wind: 10, evening: 100, neighbor: 10 } };
for (const topic of ['uns', 'grid']) {
  test(`S6 ${topic} 접속 여유는 방향 비교 제외 이유`, () => {
    assert.ok(direction(note(topic)).endsWith('접속 여유는 이번 달 새 접속을 처리하기 전 값이라 결과와 방향을 비교하지 않아요'));
  });
  test(`S6 ${topic} LNG +53%도 변화 크기 대신 비용 연결 이유`, () => {
    assert.ok(direction(note(topic, 'fuel')).endsWith(`LNG 지수는 비용으로만 영향을 주어 이번 대상(${topic === 'uns' ? '정전' : '바깥 계통에 기댄 전기'})과 방향을 비교하지 않아요`)); // 총괄 10-23 아르곤 문구(UX 갈래)
  });
  test(`S6 ${topic} 접속 풍력 없음`, () => {
    assert.ok(direction(note(topic, 'wind', 20, false)).endsWith('우리 도시에 접속된 풍력 설비가 없어 풍속과 결과의 방향을 비교하지 않아요'));
  });
  // 독립 검토 major(10-22): 접속 자료를 계산하지 못한 달은 '설비가 없다'고 단정하지 않는다.
  test(`S6 ${topic} 풍력 접속 자료 없음도 직접 효과 인정 안 함`, () => {
    const text = direction(note(topic, 'wind', 20));
    assert.ok(text.includes('풍력 접속 자료를 계산하지 못해') && !text.includes('접속된 풍력 설비가 없어') && !/같은 방향|다른 방향/.test(text));
  });
  for (const [key, values] of [['wind', [5, 20]], ['evening', [153, 47]], ['neighbor', [20, 0]]]) {
    for (const [i, value] of values.entries()) test(`S6 ${topic} ${key} ${i ? '다른' : '같은'} 방향`, () => {
      assert.ok(direction(note(topic, key, value, key === 'wind' ? true : undefined))
        // rev9 R5: 근거 부호×효과 부호를 K2/K3 예상 화살표에 반영.
        .endsWith(`${{wind:'풍속',evening:'저녁 수요',neighbor:'이웃 정전'}[key]} ${value > months[1].evidenceValues[key] ? '↑' : '↓'} → ${topic === 'uns' ? '정전' : '바깥 계통에 기댄 전기'} ${i ? '↓' : '↑'} 쪽 예상 · 실제 ${topic === 'uns' ? '정전' : '바깥 계통에 기댄 전기'} ↑ → 근거가 가리킨 쪽과 ${i ? '반대' : '같음'}(게임 안 단순 비교)`));
    });
  }
}
test('S6 작은 변화와 지난달 값 없음은 서로 다른 이유', () => {
  assert.ok(direction(note('uns', 'evening', 100.01)).endsWith('근거 변화가 비교 눈금보다 작아 비교하지 않아요'));
  const old = months[1]; months[1] = {};
  try { assert.ok(direction(note('uns', 'evening', 153)).endsWith('지난달 값이 없어 비교하지 않아요')); }
  finally { months[1] = old; }
});
test('S6 현금 주제는 LNG만 기존 음의 효과, 다른 근거는 비교 제외', () => {
  S.econ.before ||= {}; S.econ.before[id] = { cash: S.econ.cities[id].cash - 10 };
  assert.ok(direction(note('cash', 'evening')).endsWith('이 근거는 이번 대상과 방향을 비교하지 않아요'));
  // rev9 R5: LNG의 현금 효과 −1은 K3(반대) 문장으로 검증.
  assert.ok(direction(note('cash', 'fuel', 153)).endsWith('LNG 지수 ↑ → 현금 ↓ 쪽 예상 · 실제 현금 ↑ → 근거가 가리킨 쪽과 반대(게임 안 단순 비교)'));
});
function mission(askReason, resultNumbers = ['3.4']) {
  return { operatingPlan: {}, followingPlanChanged: false, followingPlanBasis: 'ready', resultNumbers,
    evidence: { key: 'grid' }, topic: 'grid', pred: { grid: 'same' }, compared: true, answer: 'keep', askReason };
}
test('S8 계통 3.4 MWh/일 칩 + 유지 = achieved', () => {
  assert.equal(api.learningVerdict(mission('이번 달 계통이 메운 전기 하루 평균 3.4 MWh/일이라서 유지해요')), 'achieved');
});
test('S8 계통 단어도 결과 숫자도 없으면 uncited', () => {
  assert.equal(api.learningVerdict(mission('이번 달 메운 전기 하루 평균이 같아서 유지해요')), 'uncited');
});
test('S8 0.1 미만은 숫자 없이도 계통 단어로 achieved', () => {
  assert.equal(api.learningVerdict(mission('이번 달 계통이 메운 전기 하루 평균 0.1 MWh/일 미만이라서 유지해요', [])), 'achieved');
});
for (const unit of ['MWh/일', 'MWh', 't/일']) test(`S8 원인 단어 없이도 결과 숫자 3.4 ${unit} 인용`, () => {
  assert.equal(api.learningVerdict(mission(`3.4 ${unit}이라서 유지해요`)), 'achieved');
  assert.equal(api.learningVerdict(mission(`3.5 ${unit}이라서 유지해요`)), 'uncited');
});
test('S8 계통 하루 평균 0·1·2자리·소비 CO₂ 1자리를 resultNumbers에 추가', () => {
  const n = mission(''); months[2] = n;
  api.rememberLocalPlan(S);
  assert.ok(n.resultNumbers.includes('3.4') && n.resultNumbers.includes('12.3'));
  assert.ok(n.resultNumbers.includes('3.37') && n.resultNumbers.includes('3') && !n.resultNumbers.includes('12.33')); // rev17 #55: 기준 1, 계통만 0·1·2자리 인용
  assert.ok(api.reasonStartsHTML(S).includes('이번 달 계통이 메운 전기가 평균 3.37 MWh/일이어서 ')); // rev17 #55: 기준 1의 2자리 달. 총괄 10-23 아르곤 문구(UX 갈래)
});
test('S8 0.1 미만 표시값은 결과 숫자로 추가하지 않음', () => {
  const r = S.results[1].team[id], old = r.isolated; r.isolated = { uns: .02 * 7 };
  try {
    const n = mission(''); months[2] = n; api.rememberLocalPlan(S);
    assert.ok(!n.resultNumbers.includes('0.1'));
    assert.ok(api.reasonStartsHTML(S).includes('이번 달 계통이 메운 전기가 평균 0.1 MWh/일 미만이어서 ')); // 총괄 10-23 아르곤 문구(UX 갈래)
  } finally { r.isolated = old; }
});
test('S8 반올림 경계도 Intl 화면 숫자와 같은 값으로 인용', () => {
  const r = S.results[1].team[id], old = { isolated: r.isolated, co2Cons: r.co2Cons };
  r.isolated = { uns: .15 * 7 }; r.co2Cons = 86.45;
  try {
    const n = mission(''); months[2] = n; api.rememberLocalPlan(S);
    assert.ok(api.reasonStartsHTML(S).includes('이번 달 계통이 메운 전기가 평균 0.15 MWh/일이어서 ')); // rev17 #55: 기준 1의 2자리 달. 총괄 10-23 아르곤 문구(UX 갈래)
    assert.ok(api.promiseResultHTML(S, n).includes('하루 평균 12.4 t/일'));
    assert.ok(n.resultNumbers.includes('0.2') && n.resultNumbers.includes('12.4'));
  } finally { Object.assign(r, old); }
});
test('S8 정전 주제도 성적표 계통 숫자는 인용, 숨겨진 소비 CO₂ 숫자는 추가 안 함', () => {
  const n = { ...mission(''), topic: 'uns', pred: { uns: 'up' } }; months[2] = n;
  api.rememberLocalPlan(S);
  assert.ok(n.resultNumbers.includes('3.4') && !n.resultNumbers.includes('12.3'));
});
S.round = 1; S.phase = 'plan'; S.results = [];
const map = C.teamDef(region, id).pack;
function trialRecord(days = 7) {
  return { ...S.rounds[0], map, scope: JSON.stringify([S.room, id]), seed: 11, days,
    unsPct: 2, gridMWh: 7 * days, co2: 10 * days };
}
for (const mismatch of ['map', 'seed', 'days']) test(`S3 ${mismatch} 불일치 시험도 결과의 계통량·생산/소비 차이 표시`, () => {
  trial = trialRecord();
  const res = { map, seed: trial.seed, days: 7, tot: { dem: 1000, by: { import: 70 }, co2: 20 }, unsTotal: 0 };
  res[mismatch] = mismatch === 'map' ? 'fictional-map' : mismatch === 'seed' ? trial.seed + 1 : 30;
  const info = api.trialGoals(res);
  const line = info.notes.find(x => x.startsWith('바깥 계통이 메워 준 전기'));
  assert.ok(line && line.includes(`시험 ${res.days}일 70 MWh`));
  const amount = (70 * ctx.KCP.ECON_DATA.params.normalCo2.v).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  assert.ok(info.notes.some(x => x.includes('머리 칩') && x.includes(`${amount} t`)));
});
for (const days of [7, 9, 30, 90]) test(`S4/S6 ${days}일 기준 이름은 읽은 시험 기간`, () => {
  trial = trialRecord(days);
  const label = days === 7 ? '시험 1주 대비' : `시험 ${days}일 대비`;
  const n = note('grid'); n.pred.grid = 'same'; n.trial = { ...trial };
  assert.equal(api.outageBaseline(S, { ...S.rounds[0], round: 1 }, n).label, label);
  assert.equal(api.promiseGridBaseline(S, n).label, label);
  assert.ok(api.predictionHTML(S).includes(`비교 기준: ${label}`));
  S.phase = 'review'; S.results = [result(1, 2)];
  try {
    assert.equal(api.gridReliance(S, S.results[0], id).base.label, label);
    // 확정 사본의 기간이 나중 시험보다 우선한다.
    trial = trialRecord(days === 7 ? 30 : 7);
    assert.equal(api.promiseGridReliance(S, S.results[0], id, n).base.label, label);
    assert.equal(api.outageBaseline(S, S.results[0], n).label, label);
    const html = api.promiseResultHTML(S, n);
    assert.ok(html.includes(`${label} 줄어듦(하루 평균`) && html.includes(`${label} Δ`)); // 총괄 10-23 아르곤 문구(UX 갈래)
    assert.ok(api.promiseResultHTML(S, { ...n, topic: 'uns', pred: { uns: 'same' } }).includes(label));
  } finally { S.phase = 'plan'; S.results = []; }
});
console.log(`${checks - failures}/${checks} passed`);
if (failures) process.exitCode = 1;
