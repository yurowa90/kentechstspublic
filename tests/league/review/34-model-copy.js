'use strict';
// W1: league.js 설명과 실제 엔진 결과 대조. 브라우저·네트워크 없이 실행한다.
// 실행: node tests/league/review/34-model-copy.js
const assert = require('node:assert/strict');
const lib = require('./lib');
const { load, history, view, runner, clone } = require('./33-model-explanations');
const { test, end } = runner('W1 copy');
const app = load({ ui: true }), { U, K, D, X, T, session } = app;
const rows = history(app), ids = rows[0].E.order;

// 동일 판정의 옛 구현도 실행한다. HEAD에는 approvalBelowLine 함수가 없으므로
// 그때의 hostRisk 판정을 읽는다. 엔진 기대값으로 옛 함수를 대신 구현하지 않는다.
const below = (V, res, id) => U.approvalBelowLine ? U.approvalBelowLine(V, res, id) :
  U.hostRisk(V, res, id).includes('지지율 평가선 미달');

// 엔진 groupTargets가 만든 실제 parts와 lagL이 여러 달·도시에서 같은 키를 찾는다.
// tax/air가 우연히 같아지는 중립 상태만 사용하지 않도록 세금·발전량을 변화시킨다.
const samples = rows.flatMap(row => ids.map(id => ({
  c: row.E.cities[id], parts: row.report.groups[id].parts || row.E.cities[id].groupParts
})));
const candidates = [...new Set(samples.flatMap(s => Object.keys(s.parts)))];
const lagKeys = candidates.filter(key => samples.every(({ c, parts }) =>
  Number.isFinite(c.lagL[key]) && parts[key] === c.lagL[key]));
test('[1] 엔진에서 발견한 지연 키 집합이 비어 있지 않음', () => assert.ok(lagKeys.length > 0));
for (const key of ['air', 'tax', 'taxI']) test(`[1] ${key}는 lagL 동일식 아님`, () =>
  assert.ok(!lagKeys.includes(key)));

function pendingKeys(html) {
  const keys = [];
  for (const match of html.matchAll(/<div>([^<]+)<meter\b[^>]*>[\s\S]*?<\/meter>([\s\S]*?)<\/div>/g)) {
    if (!match[2].includes('class="lg-pending"')) continue;
    // 화면 label은 키를 디코딩하는 용도로만 사용한다. 기대 집합은 위 엔진 산출물이다.
    const key = Object.keys(U.PART_NAMES).find(k => match[1].startsWith(`${U.PART_NAMES[k]} `));
    assert.ok(key, `알 수 없는 pending 항목: ${match[1]}`);
    keys.push(key);
  }
  return keys;
}
for (const row of [rows[1], rows[5], rows[11]]) for (const id of ids) {
  test(`[1] ${row.n}월 ${id} pending 키 = 엔진 지연 키`, () => {
    session.team = id;
    const c = row.E.cities[id], actual = new Set();
    for (const group of Object.keys(D.groups)) {
      pendingKeys(U.groupCauseHTML(c, group, row.report, null)).forEach(k => actual.add(k));
    }
    assert.deepEqual([...actual].sort(), lagKeys.slice().sort());
  });
}

// 모든 도시가 같은 정전 충격을 받는 실제 monthStep 경로. 집단 가중치를 전력
// 신뢰 하나로 통제하여 도시별 산업 구성·집단 비중이 서로 다른 효과를 제거한다.
const uniformData = clone(D);
for (const group of Object.keys(uniformData.params.groupW.v)) uniformData.params.groupW.v[group] = { rel: 1 };
let uniformE = X.initCities(ids, uniformData, { seed: 'W1-common-drop', months: 12 });
uniformE = X.calibrate(uniformE, lib.inputsFor(uniformE, () => ({})), uniformData);
const commonRows = [];
for (let n = 1; n <= 12; n++) {
  const step = X.monthStep(uniformE, lib.inputsFor(uniformE, () => ({ e: { uns: 100 } })), uniformData);
  uniformE = step.E;
  if ([2, 12].includes(n)) commonRows.push({ E: uniformE, report: step.report, n });
}
for (const row of commonRows) {
  const drops = ids.map(id => row.E.cities[id].approval - row.E.cities[id].approval0);
  test(`[2] 공통 충격 ${row.n}월 같은 하락 폭 픽스처`, () =>
    assert.ok(Math.max(...drops) - Math.min(...drops) < 1e-10));
  test(`[2] 공통 충격 ${row.n}월 절대 하락이 허용폭 초과`, () =>
    assert.ok(drops.every(d => d < -D.params.approvalDrop.v)));
}

function ledgerCell(html, id) {
  const row = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].find(m => m[1].includes(`data-host-city="${id}"`));
  const cell = row?.[1].match(/<td data-label="지지율" data-bad="(true|false)"[^>]*>([\s\S]*?)<\/td>/);
  assert.ok(cell, `지지율 장부 칸 ${id}`);
  return { bad: cell[1] === 'true', warning: cell[2].includes('▲') };
}
function approvalChip(html, name) {
  // 위험 칩은 목록(li)으로 바뀌었다(진행자 상황판 접근성 정리). span·li 둘 다 읽고 판정 단언은 그대로 둔다.
  const text = [...html.matchAll(/<(span|li) class="lg-risk-chip"[^>]*>([\s\S]*?)<\/\1>/g)]
    .find(m => m[2].includes(`<b>▲ ${name}</b>`) || m[2].includes(`<b>▲ 위험 · ${name}</b>`))?.[2].split('</b>')[1].replace(/<[^>]+>/g, '').trim() || '';
  // 같은 도시의 현금 위험 등이 함께 표시되어도 지지율 칩의 짧은 이름만 비교한다.
  return text.split(' · ').find(word => word.includes('지지율')) || '';
}
const scenarios = [
  ...[rows[1], rows[5], rows[11]].map(row => ({ label: '차등 충격', row })),
  ...commonRows.map(row => ({ label: '공통 충격', row }))
];
for (const { label, row } of scenarios) {
  const { V, res } = view(app, row), relative = K.__approvalRelative(row.E);
  const risks = U.hostRiskHTML(V, res), ledger = U.hostSummaryHTML(V, res);
  for (const id of ids) {
    const expected = row.report.review ? !row.report.review[id].pass : relative[id] < -D.params.approvalDrop.v;
    const tag = `${label} ${row.n}월 ${id}`;
    test(`[2] ${tag} ${row.report.review ? 'review.pass' : 'approvalRelative'} 대조`, () =>
      assert.equal(below(V, res, id), expected));
    if (label === '공통 충격') test(`[2] ${tag} 평가선 미달 아님`, () =>
      assert.equal(below(V, res, id), false));
    test(`[3] ${tag} 위험 칩 지지율 짧은 이름`, () =>
      assert.equal(approvalChip(risks, row.E.cities[id].name), expected ? '지지율' : ''));
    test(`[3] ${tag} 장부 data-bad = 엔진 판정`, () =>
      assert.equal(ledgerCell(ledger, id).bad, expected));
    test(`[3] ${tag} 장부 ▲ = 위험 칩 판정`, () =>
      assert.equal(ledgerCell(ledger, id).warning, approvalChip(risks, row.E.cities[id].name) === '지지율'));
  }
}

// 화면에 두 도시만 남아도 평균은 경제 상태 전체 도시를 사용한다.
{
  const row = rows[1], { V, res } = view(app, row);
  V.active = ids.slice(0, 2);
  const subset = clone(row.E); subset.order = V.active;
  const id = ids[0], allRelative = K.__approvalRelative(row.E)[id];
  const subsetRelative = K.__approvalRelative(subset)[id];
  // 실제 상태의 전체 평균과 화면 참가 도시 평균 사이에 평가선을 둬서
  // 잘못된 모집단을 쓰면 반드시 판정이 뒤집히도록 한다.
  const old = D.params.approvalDrop.v;
  D.params.approvalDrop.v = -(allRelative + subsetRelative) / 2;
  try {
    test('[2] 전체/화면 평균을 구별하는 평가선 픽스처', () =>
      assert.notEqual(allRelative < -D.params.approvalDrop.v, subsetRelative < -D.params.approvalDrop.v));
    test(`[2] ${id} 평균 모집단은 경제 도시 전체`, () =>
      assert.equal(below(V, res, id), allRelative < -D.params.approvalDrop.v));
    const legacy = clone(V); delete legacy.econ.scoreState;
    test('[2] scoreState 없는 옛 상태도 경제 도시 전체 평균', () =>
      assert.equal(below(legacy, res, id), allRelative < -D.params.approvalDrop.v));
  } finally { D.params.approvalDrop.v = old; }
}

// 평가 결과가 남은 상태에서 현재 지지율이 달라져도 해당 평가의 pass가 우선한다.
{
  const row = rows[11], { V, res } = view(app, row), id = ids[0];
  V.econ.cities[id].approval = 100;
  test('[2] 평가 달에는 현재값 재계산보다 report.review.pass 우선', () =>
    assert.equal(below(V, res, id), !row.report.review[id].pass));
  test('[2] result 없이 경제 report의 평가 결과 사용', () =>
    assert.equal(below(V, null, id), !row.report.review[id].pass));
}

function smrCopyChecks(label, text, value) {
  test(`[4] ${label} 시작 대비 하락폭 = eurekaApproval`, () =>
    assert.equal(Number(/시작보다\s*([\d.]+)%p/.exec(text)?.[1]), value));
  test(`[4] ${label} 시위 없음 대안 명시`, () => assert.match(text, /또는\s*시위 없음/));
}
smrCopyChecks('화면', U.techEurekaText('smr', {}), T.params.eurekaApproval.v);
smrCopyChecks('카드', T.eureka.smr, T.params.eurekaApproval.v);
const changed = load({ ui: true, techParam: { key: 'eurekaApproval', value: 7 } });
smrCopyChecks('param 7 화면', changed.U.techEurekaText('smr', {}), 7);
smrCopyChecks('param 7 카드', changed.T.eureka.smr, 7);

const airReason = U.migrationReason({ from: ids[0], to: ids[1], why: '공기가 나빠서', whyGrade: 'M' });
test('[8] 이주 공기 이유에 PM2.5 명시', () => assert.match(airReason, /PM2\.5/));
test('[8] 이주 공기 이유를 CO₂로 바꾸지 않음', () => assert.doesNotMatch(airReason, /CO₂|CO2/));
test('[8] 이주 이유의 공기 인과 유지', () => assert.match(airReason, /공기가 나빠서/));
end();
