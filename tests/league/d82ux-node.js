'use strict';
// D-82 결정 2·5차 판정 N2/N3/S8. 브라우저 없이 실제 화면 함수를 VM에서 실행한다.
// 빈 달에 대한 화면 건너뛰기도 자동 학습 기록을 남기므로 N3는 별도 가상 기록으로 검증한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let checks = 0, failures = 0;
function test(label, fn) {
  checks++;
  try { fn(); console.log('PASS ' + label); }
  catch (error) { failures++; console.error('FAIL ' + label + ': ' + error.message); }
}
const session = {}, storage = new Map();
const mem = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  localStorage: mem, sessionStorage: mem, addEventListener() {},
  document: { documentElement: {}, addEventListener() {}, getElementById: () => null },
  KCP: { route() {}, on() {}, gradeWords: String,
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    leagueNet: {} } });
ctx.window = ctx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../ui/${name}.js`), 'utf8'), ctx);
}
const source = fs.readFileSync(path.resolve(__dirname, '../../ui/league.js'), 'utf8');
assert.equal(source.split('let L = null;').length, 2);
assert.equal(source.split('KCP.league = {').length, 2);
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('KCP.league = {', 'globalThis.__hooks = { decisionsHTML, promiseResultHTML, promiseComparison, promiseVerdictShort, resultHTML, reasonStartsHTML, trialGoals, predictionHTML, gridFillHTML }; KCP.league = {'), ctx);
const api = ctx.__hooks, C = ctx.KCP.leagueCore, B = ctx.KCP.buildGame;
// 도시 식별자는 기존 자료에서 고른다. 사용자 이름·실제 회사 이름이 없는 가상 기록이다.
const ids = C.regionOf('south').teams.slice(0, 2).map(t => t.id), id = ids[0];
const S = C.newState('D82UXFIX', 'south', 0, ids, { turns: 12, seedMode: 'fixed' });
C.host(S, 'next', 0);
B.selectPack(C.teamDef(C.regionOf('south'), id).pack, 'league');
B.current = () => ({ builds: [], lines: [], policies: [], rq: [] });
let trial = null;
B.lastTrial = () => trial;
Object.assign(session, { role: 'solo', room: S.room, team: id, S, snap: S,
  interview: { docs: {}, journal: {}, interview: { months: {} } } });
const months = session.interview.interview.months;
function note(topic = 'grid') {
  const n = { topic, confirmed: true, evidence: { key: 'grid', value: 1, text: '가상 근거' }, pred: { [topic]: 'same' } };
  months[S.round] = n;
  return n;
}
function result(round, co2Cons, rawGrid = 7) {
  return { ...S.rounds[round - 1], round, days: 7,
    team: { [id]: { co2Cons, co2Prod: co2Cons - 10, unsPct: 0, isolated: { uns: rawGrid }, uns: 0, imp: 0, sub: 0, cost: { fuel:0, capex:0, total:0 } } } };
}
S.round = 12; S.phase = 'end';
for (let t = 1; t <= 12; t++) months[t] = t <= 6 ? { evidence: { text: '가상 근거 ' + t } } : {};
test('N3 빈 7~12월을 제외한 최근 기록은 4·5·6월', () => {
  const html = api.decisionsHTML(S), recent = html.split('<details')[0];
  assert.ok(!recent.includes('기기에 남은 결정 기록 없음'));
  assert.deepEqual([...recent.matchAll(/data-decision-month="(\d+)"/g)].map(m => +m[1]), [4, 5, 6]);
  assert.ok(html.includes('앞의 3달 기록'));
  assert.deepEqual([...html.split('<details')[1].matchAll(/data-decision-month="(\d+)"/g)].map(m => +m[1]), [1, 2, 3]);
});
Object.keys(months).forEach(t => { months[t] = {}; });
months[2] = { askReason: '가상 <선택>' };
session.interview.journal[5] = { next: '가상 일지' };
test('N3 이유·일지만 있는 달도 최근 기록이며 자유 서술은 이스케이프', () => {
  const html = api.decisionsHTML(S);
  assert.deepEqual([...html.matchAll(/data-decision-month="(\d+)"/g)].map(m => +m[1]), [2, 5]);
  assert.ok(html.includes('&lt;선택>') && !html.includes('<details') && !html.includes('기록 없음'));
});
months[2] = {}; session.interview.journal = {};
test('N3 내용이 하나도 없는 때만 기록 없음', () => {
  const html = api.decisionsHTML(S);
  assert.ok(html.includes('<li>기기에 남은 결정 기록 없음</li>') && !html.includes('<details'));
});
S.phase = 'review'; S.round = 2; S.results = [result(1, 140), result(2, 175, 7.75)];
// D-82 결정 1·화면 지시서: 월 길이가 다른 공개 값에서 하루 평균을 독립 검산한다.
test('S6 소비 기준 하루 평균·지난달 Δ, 상세 판정 줄 뒤', () => {
  const html = api.promiseResultHTML(S, note());
  // 175/7=25, 140/7=20 t/일, Δ +5. 월 합계는 175×28/7=700 t.
  // rev16 #72-1: 상세 섹션 안에서 판정 줄 뒤, 계산 줄 뒤 소비 CO₂. 숫자 검산 유지.
  // promiseResultHTML의 반환 경계는 section까지다. 바깥 details 포장은 브라우저에서 검사.
  assert.match(html, /id="lg-promise-result"[^]*?data-compare="grid"[^]*?id="lg-s6-co2cons"/);
  // rev11 R5: 소비 표지만 통일하고 하루 평균·차이·월 합계 검산 유지.
  assert.match(html, /CO₂ 소비\(계통 포함\) 하루 평균 25 t\/일 · 지난달 대비 Δ \+5 t\/일\(이번 달 합 700 t\)/);
  assert.ok(html.includes('계통에서 끌어온 전기도 우리 도시 소비 배출에 들어가요.'));
});
test('S6 월 합계가 달라도 소비 CO₂ 하루 평균이 같으면 Δ 0·상태와 저장 키 유지', () => {
  const r = S.results[1].team[id], old = r.co2Cons; r.co2Cons = 140;
  const n = note(), before = JSON.stringify([S, n, [...storage]]);
  try {
    assert.match(api.promiseResultHTML(S, n), /하루 평균 20 t\/일 · 지난달 대비 Δ 0 t\/일\(이번 달 합 560 t\)/);
    assert.equal(JSON.stringify([S, n, [...storage]]), before);
  } finally { r.co2Cons = old; }
});
test('S8 확정된 계통 주제는 하루 평균 1.11 MWh/일 칩·현금 칩 유지', () => {
  note();
  const html = api.reasonStartsHTML(S);
  assert.ok(html.includes('이번 달 계통이 메운 전기가 평균 1.11 MWh/일이어서 ')); // rev17 #55: 기준 7/7=1, 원값 7.75/7=1.107142… → 1.11 // 총괄 10-23 아르곤 문구(UX 갈래)
  assert.ok(html.includes('다음 달 시험에서 계통이 메운 전기가 줄어드는지 확인하고 '));
  assert.ok(html.includes('남은 돈(빚 한도 포함) ') && !html.includes('정전')); // rev9 R14 K10b
});
test('S8 계통 값 누락이면 정전 칩 유지', () => {
  const r = S.results[1].team[id], old = r.isolated; delete r.isolated;
  try { assert.ok(api.reasonStartsHTML(S).includes('이번 달 정전 0%라서 ')); }
  finally { r.isolated = old; }
});
test('S8 계통 0도 유효한 값이므로 계통 칩 유지', () => {
  const r = S.results[1].team[id], old = r.isolated;
  r.isolated = { uns: 0 };
  try { assert.ok(api.reasonStartsHTML(S).includes('이번 달 계통이 메운 전기가 평균 0.1 MWh/일 미만이어서 ')); } // 총괄 10-23 아르곤 문구(UX 갈래)
  finally { r.isolated = old; }
});
test('S8 계통 하루 평균은 기준 1인 달 소수 두 자리 표시', () => {
  const r = S.results[1].team[id], old = r.isolated;
  r.isolated = { uns: 8.0625 }; // rev17 #55: 기준 7/7=1, 8.0625/7=1.151785… → 1.15 MWh/일
  try { assert.ok(api.reasonStartsHTML(S).includes('이번 달 계통이 메운 전기가 평균 1.15 MWh/일이어서 ')); } // 총괄 10-23 아르곤 문구(UX 갈래)
  finally { r.isolated = old; }
});
test('정전 주제 S6에도 소비 CO₂ 한 줄(rev9 R9)·S8 정전 칩 유지', () => {
  const n = note('uns');
  assert.ok(api.promiseResultHTML(S, n).includes('lg-s6-co2cons')); // rev9 R9: 모든 주제
  assert.ok(api.reasonStartsHTML(S).includes('이번 달 정전 0%라서 '));
});
// D-82 결정 1·화면 지시서: 음수·소수 변화도 월 길이와 분리해 표시한다.
test('S6 소비 CO₂는 감소 Δ −0.1 t/일을 소수 한 자리로 표시', () => {
  const r = S.results[1].team[id], old = r.co2Cons;
  r.co2Cons = 139.3; // 139.3/7=19.9, 지난달140/7=20, 월 합계557.2→557 t.
  try { assert.match(api.promiseResultHTML(S, note()), /하루 평균 19\.9 t\/일 · 지난달 대비 Δ −0\.1 t\/일\(이번 달 합 557 t\)/); }
  finally { r.co2Cons = old; }
});
S.round = 1; S.results = [result(1, 175)];
trial = { map: C.teamDef(C.regionOf('south'), id).pack,
  scope: JSON.stringify([S.room, id]), ...S.rounds[0], days: 7, co2: 140, gridMWh: 7 };
test('S6 첫 달 기존 시험 소비 CO₂는 하루 평균 Δ +5 t\/일', () => {
  const n = note(); n.trial = { unsPct: 0, days: 7, gridMWh: 7 };
  const html = api.promiseResultHTML(S, n);
  // rev11 R5: 첫 달 시험도 같은 소비 표기를 사용한다.
  assert.match(html, /CO₂ 소비\(계통 포함\) 하루 평균 25 t\/일 · 시험 1주 대비 Δ \+5 t\/일\(이번 달 합 775 t\)/);
});
test('S6 약속 후 다른 시험이면 CO₂ Δ를 만들지 않음', () => {
  const n = note(); n.trial = { unsPct: 0, days: 7, gridMWh: 8 };
  // 비교하지 않는 이유를 '첫 결과'가 아니라 시험이 바뀐 것으로 밝힌다(독립 검토 minor 반영).
  assert.match(api.promiseResultHTML(S, n), /Δ 비교 없음\(약속 뒤 시험이 바뀜\)/);
});
test('S6 약속 때 남긴 시험 CO₂ 사본이 있으면 최신 시험 대신 그 값을 기준으로', () => {
  const n = note(); n.trial = { unsPct: 0, days: 7, gridMWh: 8, co2: 70 };
  assert.match(api.promiseResultHTML(S, n), /시험 1주 대비 Δ/);
  assert.doesNotMatch(api.promiseResultHTML(S, n), /Δ 비교 없음/);
});
trial = null;
test('S6 첫 달 시험 없는 기록은 하루 평균만 보이고 Δ 비교 없음', () => {
  const html = api.promiseResultHTML(S, note());
  assert.match(html, /Δ 비교 없음\(첫 결과\)/);
  assert.match(html, /실제 결과: 이번 달 하루 평균 1 MWh\/일\(비교 없음\(첫 결과\)\)/);
});
S.phase = 'plan';
// D-82 결정 1·화면 지시서: 성적표도 S4 계약의 계통 추가분을 읽고 수입 설비 출력은 제외한다.
trial = { map: C.teamDef(C.regionOf('south'), id).pack, scope: JSON.stringify([S.room, id]),
  ...S.rounds[0], seed: 1, days: 7, gridMWh: 70, co2: 140, unsPct: 0 };
test('N2 S3 7일 계통량→하루 평균→31일 합계·월 비용·생산/소비 설명', () => {
  // 수요 1,000 중 부족 0. 수입 설비630+계통 추가70=총수입700. 약속 기준은70/7=10이다.
  const info = api.trialGoals({ map: trial.map, seed: trial.seed, days: 7, tot: { dem: 1000, by: { import: 700 }, co2: 100 }, unsTotal: 0 });
  const line = info.notes.find(x => x.startsWith('바깥 계통'));
  assert.match(line, /시험 7일 70 MWh → 하루 평균 10 MWh\/일\(이번 달 31일이면 약 310 MWh · 비용 약/);
  assert.equal((line.match(/비용/g) || []).length, 1);
  const price = ctx.KCP.ECON_DATA.params.normalCost.v * ctx.KCP.ECON_DATA.params.gridImportMarkup.v;
  assert.ok(line.includes((310 * price).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '억'));
  const explanation = info.notes.find(x => x.includes('머리 칩'));
  // rev11 R5·총괄 결정: 생산 배출 설명을 유지하고 머리 칩의 소비 이름을 통일한다.
  assert.ok(explanation && explanation.includes('생산 배출') && explanation.includes('CO₂ 소비(계통 포함)') && explanation.includes('바깥 계통에서 받은 전기'));
  // 차이 줄도 S4·성적표와 같은 gridMWh(70)를 쓴다(독립 검토 minor: 계통 줄과 차이 줄의 출처 일치).
  assert.ok(explanation.includes((70 * ctx.KCP.ECON_DATA.params.normalCo2.v).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + ' t'));
});
// D-82 결정 1·화면 지시서: 판정과 같은 단위를 먼저 보여 월 길이 효과를 판정 근거처럼 읽지 않게 한다.
S.phase = 'review'; S.round = 2; trial = null;
S.results = [result(1, 140, 70), result(2, 140, 70)];
test('31→28일 하루 평균 같음: 판정·상세 모두 Δ 0 MWh/일·예상과 같음, 월 Δ 없음', () => {
  const html = api.promiseResultHTML(S, note()); // 70/7=10 MWh/일, 월 합계 310→280 MWh
  for (const text of [html.match(/id="lg-promise-summary"[^>]*>(.*?) <button/s)[1], html.match(/data-compare="grid">(.*?)<\/p>/s)[1]]) {
    assert.match(text, /실제 결과: 지난달 대비 같음\(±0\.5 안, 하루 평균 \+?0(?:\.0)? MWh\/일 변화\)/); // 총괄 10-23 아르곤 문구(UX 갈래)
    assert.ok(text.includes('예상과 같음') && text.includes('월 합계 280 MWh'));
    assert.doesNotMatch(text, /[−-]30 MWh/);
  }
});
S.round = 3;
S.results = [result(2, 140, 1053.4 * 7 / 28), result(3, 175, 1002.4 * 7 / 31)];
test('5차 3월 재현: 월 −51 MWh 대신 하루 평균 −5.3 MWh/일·예상과 다름', () => {
  const n = note(), html = api.promiseResultHTML(S, n);
  // 총괄 10-23 아르곤 문구(UX 갈래): 기준 이름→판정 낱말→괄호 안 Δ, 예상과 다름 뒤 월 합계·비용 보조.
  assert.match(html, /실제 결과: 지난달 대비 줄어듦\(하루 평균 −5\.3 MWh\/일 변화\) · 예상과 다름\(이번 달 하루 평균 32\.3 MWh\/일 · 월 합계 1,002\.4 MWh · 월 비용 약 [\d,.]+억\)/); // 총괄 10-23 아르곤 문구(UX 갈래)
  assert.doesNotMatch(html, /−51 MWh/);
  // rev16 #74-2: 숫자·단위 nowrap 포장만 허용하며 내용·순서는 동일하게 검산.
  assert.match(api.gridFillHTML(S, S.results[1], id).replace(/<\/?span\b[^>]*>/g, ''), /<dd>32\.3 MWh\/일<\/dd>.*지난달 대비 하루 평균 Δ −5\.3 MWh\/일 · 이번 달 합 1,002\.4 MWh · 비용 약/s);
});
test('S6 계통 칸은 하루 평균 표시 반 단위 0.05 MWh/일에서 나타남', () => {
  const r = S.results[1].team[id], old = r.isolated;
  try {
    r.isolated = { uns: .049 * 7 };
    assert.equal(api.gridFillHTML(S, S.results[1], id), '');
    r.isolated = { uns: .05 * 7 };
    assert.match(api.gridFillHTML(S, S.results[1], id), /<dd>0\.1 MWh\/일<\/dd>/);
  } finally { r.isolated = old; }
});
// D-82 결정 1·화면 지시서: 1자리 표시를 판정에 되먹이지 않음. 기준 2×5%=0.1 문턱 양쪽은 같은 표시여도 원값으로 판정.
test('S6 5% 문턱 양쪽의 표시 Δ가 같아도 반올림 전 값으로 판정', () => {
  const previous = S.results[0], current = S.results[1];
  const p = previous.team[id], r = current.team[id], oldP = p.isolated, oldR = r.isolated;
  try {
    p.isolated = { uns: 2 * 7 };
    for (const [change, verdict] of [[.06, '예상과 같음'], [.14, '예상과 다름']]) {
      r.isolated = { uns: (2 + change) * 7 };
      const html = api.promiseResultHTML(S, note());
      const summary = html.match(/id="lg-promise-summary"[^>]*>(.*?) <button/s)[1];
      assert.ok(summary.includes("하루 평균 +0.1 MWh/일") && summary.includes(verdict));
      assert.ok(summary.includes(`지난달 대비 ${verdict === '예상과 같음' ? '같음(±0.1 안, ' : '늘어남('}하루 평균 +0.1 MWh/일 변화)`)); // 총괄 10-23 아르곤 문구(UX 갈래)
    }
  } finally { p.isolated = oldP; r.isolated = oldR; }
});
test('S6 기준 1.5의 같음 범위 0.075와 Δ +0.06은 판정 줄에서 두 자리로 표시', () => { // 총괄 10-23 아르곤 문구(UX 갈래)
  const p = S.results[0].team[id], r = S.results[1].team[id], oldP = p.isolated, oldR = r.isolated; // 총괄 10-23 아르곤 문구(UX 갈래)
  try { // 총괄 10-23 아르곤 문구(UX 갈래)
    p.isolated = { uns: 1.5 * 7 }; // 총괄 10-23 아르곤 문구(UX 갈래)
    r.isolated = { uns: (1.5 + .06) * 7 }; // 총괄 10-23 아르곤 문구(UX 갈래)
    const html = api.promiseResultHTML(S, note()); // 총괄 10-23 아르곤 문구(UX 갈래)
    const summary = html.match(/id="lg-promise-summary"[^>]*>(.*?) <button/s)[1]; // 총괄 10-23 아르곤 문구(UX 갈래)
    assert.ok(summary.includes('지난달 대비 같음(±0.08 안, 하루 평균 +0.06 MWh/일 변화) · 예상과 같음')); // 총괄 10-23 아르곤 문구(UX 갈래)
  } finally { p.isolated = oldP; r.isolated = oldR; } // 총괄 10-23 아르곤 문구(UX 갈래)
}); // 총괄 10-23 아르곤 문구(UX 갈래)
S.round = 1; S.phase = 'plan'; S.results = [];
trial = { map: C.teamDef(C.regionOf('south'), id).pack, scope: JSON.stringify([S.room, id]),
  ...S.rounds[0], days: 7, co2: 140, unsPct: 0, gridMWh: 70 };
test('S4 시험 기준 하루 평균 = 성적표 하루 평균 = 70/7, 문턱은 0.05 MWh/일·5%', () => {
  const n = note(); n.trial = { unsPct: 0, days: 7, gridMWh: 70 };
  const html = api.predictionHTML(S), info = api.trialGoals({ map: trial.map, seed: trial.seed, days: 7, tot: { dem: 1000, by: { import: 700 }, co2: 100 }, unsTotal: 0 });
  assert.match(html, /비교 기준: 시험 1주 대비 · 하루 평균 10 MWh\/일\(이번 달 31일이면 약 310 MWh · [\d,.]+억\)/);
  assert.ok(info.notes.some(line => line.includes('시험 7일 70 MWh → 하루 평균 10 MWh/일(이번 달 31일이면 약 310 MWh')));
  assert.match(html, /하루 평균 변화가 0\.05 MWh\/일과 기준 하루 평균의 5% 중 큰 값 이하/);
  assert.ok(html.includes("판정은 표시 반올림 전 값으로 해요."));
});
S.round = 3; S.results = [result(2, 140, 1053.4 * 7 / 28)];
test('S4 지난달 기준은 지난달 평균 37.6과 지난달 28일·합계 1,053.4를 표시', () => {
  note();
  assert.match(api.predictionHTML(S), /지난달 대비 · 하루 평균 37\.6 MWh\/일\(지난달 28일 합 1,053\.4 MWh · [\d,.]+억\)/);
});
// 10-21 후속: 1자리 Δ로 판정 경계를 가리는 회귀, 작은 양을 0으로 보이는 회귀,
// CO₂ 월 길이 차이를 하루 평균 변화로 보이는 회귀를 실제 HTML 출력으로 잡는다.
S.phase = 'review'; S.round = 2; trial = null;
S.results = [result(1, 140, 37.62 * 7), result(2, 140)];
test('S6 기준 37.62의 경계: 요약·접힘 제목 −1.9 유지, 상세 −1.89/−1.88·문턱 ±1.88', () => {
  for (const [delta, detailed, verdict] of [[-1.886, '−1.89', '예상과 다름'], [-1.876, '−1.88', '예상과 같음']]) {
    S.results[1].team[id].isolated.uns = (37.62 + delta) * 7;
    const n = note(), before = JSON.stringify([S, n, [...storage]]);
    const html = api.promiseResultHTML(S, n);
    const summary = html.match(/id="lg-promise-summary"[^>]*>(.*?) <button/s)[1];
    assert.ok(summary.includes('하루 평균 −1.9 MWh/일') && summary.includes(verdict));
    assert.ok(summary.includes(`지난달 대비 ${verdict === '예상과 같음' ? '같음(±1.88 안, ' : '줄어듦('}하루 평균 −1.9 MWh/일 변화)`)); // spec-C §M6: 같음 범위는 판정 계산과 같은 소수 둘째 자리.
    assert.doesNotMatch(summary, /판정 계산|같음' 범위/);
    assert.ok(api.promiseVerdictShort(api.promiseComparison(S, n), n).includes('하루 평균 Δ −1.9 MWh/일'));
    assert.ok(html.includes(`<p data-compare="grid">${summary}</p><p id="lg-promise-grid-calc" class="lg-hint">판정 계산: 하루 평균 Δ ${detailed} MWh/일, '같음' 범위 ±1.88 MWh/일(기준 하루 평균 37.62의 5%와 0.05 중 큰 값)</p>`));
    assert.equal(JSON.stringify([S, n, [...storage]]), before);
  }
});
test('S6 2자리로도 같아 보이는 0.005 미만 경계는 정밀도를 늘리지 않고 원값 판정', () => {
  S.results[1].team[id].isolated.uns = (37.62 - 1.882) * 7; // 문턱 1.881과 차이 0.001.
  const html = api.promiseResultHTML(S, note());
  assert.match(html, /하루 평균 Δ −1\.88 MWh\/일, '같음' 범위 ±1\.88 MWh\/일/);
  assert.match(html, /지난달 대비 줄어듦\(하루 평균 −1\.9 MWh\/일 변화\) · 예상과 다름/); // 총괄 10-23 아르곤 문구(UX 갈래)
});
test('정전·현금 주제와 계통 비교 기준 없는 달은 상세 계산 줄 없음', () => {
  for (const topic of ['uns', 'cash']) assert.ok(!api.promiseResultHTML(S, note(topic)).includes('lg-promise-grid-calc'));
  S.results = [result(2, 140)];
  assert.ok(!api.promiseResultHTML(S, note()).includes('lg-promise-grid-calc'));
});
S.round = 1; S.results = [result(1, 140)];
trial = { map: C.teamDef(C.regionOf('south'), id).pack, scope: JSON.stringify([S.room, id]),
  ...S.rounds[0], days: 7, co2: 140, unsPct: 0, seed: 1 };
for (const [perDay, text] of [[0, '0.1 MWh/일 미만'], [.04, '0.1 MWh/일 미만'], [.05, '0.1 MWh/일'], [.06, '0.1 MWh/일'], [.15, '0.2 MWh/일']]) {
  test(`하루 평균 ${perDay}: 계획·시험 ${text}, 결과는 그 달 자릿수`, () => {
    // rev17 #55: 시험 기준=perDay<2. S6/S8만 두 자리, 계획·시험·비교 없음은 기존 한 자리.
    const shown = perDay < .05 ? text : perDay.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh/일';
    trial.gridMWh = perDay * 7;
    S.results[0].team[id].isolated.uns = perDay * 7;
    const n = note(); n.trial = { unsPct: 0, days: 7, gridMWh: perDay * 7 };
    S.phase = 'review';
    const verdict = api.promiseResultHTML(S, n);
    assert.ok(verdict.includes(`이번 달 하루 평균 ${shown} · 월 합계`));
    assert.ok(verdict.includes('시험 1주 대비 같음(±0.05 안, 하루 평균 0.00 MWh/일 변화) · 예상과 같음')); // rev14b A1·B: 같음 범위 < 0.1인 달의 S6 Δ는 소수 둘째 자리.
    assert.ok(api.reasonStartsHTML(S).includes(`이번 달 계통이 메운 전기가 평균 ${shown}이어서 `)); // 총괄 10-23 아르곤 문구(UX 갈래)
    assert.equal(api.gridFillHTML(S, S.results[0], id) === '', perDay < .05);
    S.phase = 'plan';
    assert.ok(api.predictionHTML(S).includes(`시험 1주 대비 · 하루 평균 ${text}(이번 달 31일이면 약`));
    const report = api.trialGoals({ map: trial.map, seed: trial.seed, days: 7, tot: { dem: 1000, by: { import: perDay * 7 }, co2: 100 }, unsTotal: 0 });
    assert.ok(report.notes.some(line => line.includes(`→ 하루 평균 ${text}(이번 달 31일이면 약`)));
    S.phase = 'review';
    delete n.trial;
    const savedTrial = trial; trial = null;
    try { assert.ok(api.promiseResultHTML(S, n).includes(`이번 달 하루 평균 ${text}(비교 없음(첫 결과))`)); }
    finally { trial = savedTrial; }
  });
}
trial = null; S.phase = 'review'; S.round = 2;
S.results = [result(1, 140), result(2, 140)];
S.results.forEach(res => { res.team[id].co2Prod = 140; });
function co2Cell(res = S.results.at(-1)) {
  // rev11 R5: 결과의 생산 표기 순서만 통일한다.
  // rev16 #74-2: Δ 숫자·단위의 nowrap span은 허용, 기존 글자·순서는 그대로 검산한다.
  return api.resultHTML(S, res).match(/<div><dt>CO₂ 생산\(이번 달\)<\/dt>(.*?)<\/div>/s)[1].replace(/<\/?span\b[^>]*>/g, '');
}
test('S6 계통 주제 CO₂: 31→28일 하루 평균 같으면 Δ 0, 월 합계 620→560은 보조', () => {
  months[1] = { topic: 'grid', confirmed: true }; note();
  const before = JSON.stringify([S, [...storage]]);
  assert.equal(co2Cell(S.results[0]), '<dd>20 t/일</dd><small>시험 1주 대비 Δ 비교 없음(시험 기록 없음) · 이번 달 합 620 t</small>');
  assert.equal(co2Cell(), '<dd>20 t/일</dd><small>지난달 대비 Δ 0 t/일(이번 달 합 560 t)</small>');
  // co2Prod=140/7=20 t/일, 총량은 140×31/7과 140×28/7.
  assert.equal(JSON.stringify([S, [...storage]]), before);
});
test('S6 CO₂는 현재 달·해당 결과 달의 약속 주제와 무관하게 하루 평균', () => {
  note('uns');
  assert.equal(co2Cell(S.results[0]), '<dd>20 t/일</dd><small>시험 1주 대비 Δ 비교 없음(시험 기록 없음) · 이번 달 합 620 t</small>');
  months[1] = { topic: 'uns', confirmed: true }; note();
  assert.equal(co2Cell(S.results[0]), '<dd>20 t/일</dd><small>시험 1주 대비 Δ 비교 없음(시험 기록 없음) · 이번 달 합 620 t</small>'); // spec-C §M1: 정전 주제도 하루 평균, 월 합계는 보조.
});
test('다음 달 계획 단계에서 약속 없는 지난 결과의 CO₂ 칸은 현재 달 주제로 다시 고르지 않음', () => {
  // spec-C §M1: 계획 단계·지난 약속 유무와 무관하게 해당 결과 기간의 하루 평균을 쓴다.
  const old = [S.phase, S.round, months[1], months[2], months[3]];
  try {
    S.phase = 'plan'; S.round = 3; months[1] = { topic: 'grid', confirmed: true }; months[2] = {}; months[3] = { topic: 'grid', confirmed: true };
    assert.equal(co2Cell(), '<dd>20 t/일</dd><small>지난달 대비 Δ 0 t/일(이번 달 합 560 t)</small>'); // spec-C §M1: 약속 없는 지난 결과도 하루 평균 Δ.
    months[2] = { topic: 'grid', confirmed: true };
    assert.equal(co2Cell(), '<dd>20 t/일</dd><small>지난달 대비 Δ 0 t/일(이번 달 합 560 t)</small>');
  } finally { [S.phase, S.round, months[1], months[2], months[3]] = old; }
});
test('S6 생산 CO₂는 지난달 1일·이번 달 7일 대표기간을 각각 나눠 Δ 0', () => {
  const previous = S.results[0], oldDays = previous.days, oldCo2 = previous.team[id].co2Prod;
  previous.days = 1; previous.team[id].co2Prod = 20;
  try { assert.equal(co2Cell(), '<dd>20 t/일</dd><small>지난달 대비 Δ 0 t/일(이번 달 합 560 t)</small>'); }
  finally { previous.days = oldDays; previous.team[id].co2Prod = oldCo2; }
});
test('S6 계통 주제 CO₂ 감소 Δ −0.1 t/일, 정전 시간 칸 유지', () => {
  const r = S.results[1].team[id]; r.co2Prod = 139.3; r.outH = 7;
  note();
  assert.equal(co2Cell(), '<dd>19.9 t/일</dd><small>지난달 대비 Δ −0.1 t/일(이번 달 합 557 t)</small>');
  assert.match(api.resultHTML(S, S.results[1]), /<dt>정전 시간\(이번 달\)<\/dt><dd>28시간<\/dd>/);
});
test('S6 정전·현금 주제와 약속 없는 달 CO₂는 하루 평균 t/일', () => {
  for (const topic of ['uns', 'cash', null]) {
    if (topic) note(topic); else delete months[S.round];
    assert.equal(co2Cell(), '<dd>19.9 t/일</dd><small>지난달 대비 Δ −0.1 t/일(이번 달 합 557 t)</small>'); // spec-C §M1: 모든 주제의 값·Δ는 하루 평균, 월 합계는 보조.
  }
});

// T F13: summary·folded title·grid cell share one precision; calculation is always two decimals.
for (const [base, delta, visible, calc] of [[1.5, .064, '+0.06', '+0.06'], [1.5, .106, '+0.11', '+0.11'], [1.5, -.064, '−0.06', '−0.06'], [2, .064, '+0.1', '+0.06'], [37.62, -1.886, '−1.9', '−1.89']]) {
  test(`T F13 grid precision base=${base}, delta=${delta}`, () => {
    S.phase = 'review'; S.round = 2; trial = null;
    S.results = [result(1, 140, base * 7), result(2, 140, (base + delta) * 7)];
    const n = note(), html = api.promiseResultHTML(S, n);
    const summary = html.match(/id="lg-promise-summary"[^>]*>(.*?) <button/s)[1];
    const detail = html.match(/data-compare="grid">(.*?)<\/p>/s)[1];
    for (const text of [summary, detail, api.promiseVerdictShort(api.promiseComparison(S, n), n), api.gridFillHTML(S, S.results[1], id)]) {
      assert.ok(text.includes(`${visible} MWh/일`), text);
    }
    assert.match(html, new RegExp(`id="lg-promise-grid-calc"[^>]*>판정 계산: 하루 평균 Δ ${calc.replace('+', '\\+').replace('.', '\\.')} MWh/일`));
  });
}
// T F3: 첫 결과의 단위/대표기간을 따로 계산한다. 옛 trial.co2(소비)는 생산 기준으로 재사용 금지.
for (const days of [7, 30]) for (const topic of ['uns', 'grid']) for (const legacy of [false, true]) {
  test(`T F3 first result ${days}days/${topic}/legacy=${legacy}`, () => {
    S.round = 1; S.phase = 'review'; S.results = [result(1, 175)];
    const r = S.results[0].team[id]; r.co2Prod = 70; r.outH = 2;
    trial = { map:C.teamDef(C.regionOf('south'), id).pack, scope:JSON.stringify([S.room, id]),
      ...S.rounds[0], days, unsPct:3, gridMWh:7, outH:days / 7, co2:9999,
      ...(!legacy ? { co2Prod:days * 8 } : {}) };
    const n = note(topic); n.trial = { ...trial };
    const html = api.resultHTML(S, S.results[0]), basis = days === 7 ? '시험 1주 대비' : `시험 ${days}일 대비`;
    // rev11 R5: 표지 순서 변경 뒤에도 세 결과 칸의 수치 계약을 그대로 검사한다.
    const cells = [...html.matchAll(/<div><dt>(정전\(이번 달\)|정전 시간\(이번 달\)|CO₂ 생산\(이번 달\))<\/dt>(.*?)<\/div>/gs)];
    assert.equal(cells.length, 3);
    cells.forEach(m => assert.ok(m[2].includes(basis), `${m[1]}: ${m[2]}`));
    // 2/7×31 − (days/7)/days×31 = 31/7 → 4.4시간.
    assert.ok(cells.find(m => m[1].startsWith('정전 시간'))[2].includes('Δ +4.4시간'));
    const co2 = cells.find(m => m[1] === 'CO₂ 생산(이번 달)')[2];
    assert.ok(co2.includes(legacy ? '비교 없음(시험 기록 없음)' : 'Δ +2 t/일'), co2); // spec-C §M1: 정전·계통 모두 생산 10−8=+2 t/일.
    assert.ok(!co2.includes('9999'), '시험 소비 배출을 생산 기준에 섞지 않음');
  });
}

console.log(`checks ${checks} fail ${failures}`);
process.exitCode = failures ? 1 : 0;
