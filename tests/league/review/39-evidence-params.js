'use strict';
// 근거 계수 계약: 기대값은 REFERENCES 해당 절 및 RECAL-SPEC §1.1/§1.2에서
// 독립적으로 전사했다. 구현 소스는 lib.js를 통해 실행할 뿐 기대값으로 읽지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { D } = require('./lib.js');
const ROOT = path.resolve(__dirname, '../../..');
const references = fs.readFileSync(path.join(ROOT, 'docs/ECON-REFERENCES.md'), 'utf8');
const spec = fs.readFileSync(path.join(ROOT, 'docs/ECON-RECAL-SPEC.md'), 'utf8');

// [값, 이후 등급, REF 절, 해당 계수의 출처 번호]. 한 절이 여러 계수를 다룰 때
// 공동 보너스/정전 목표/다른 계수의 출처까지 이 계수의 출처로 요구하지 않는다.
// 새 키의 개별 등급(예: indTaxLag O, coopCo2Cut O)은 SPEC §1.2를 따른다.
const expected = {
  aiVollMul: [5, 'M', '5.8', ['L35', 'P37', 'S18', 'P15', 'P38']],
  connPerMonthReal: [.00375, 'M', '8.12', ['S22', 'S21']],
  coopCo2Cut: [.40, 'O', '13.6', ['L12']],
  // REF §5.3: S10은 세원 감소 사례. 12달 과세 시차의 구조 근거는 L01만이다.
  indTaxLag: [12, 'O', '5.3', ['L01']],
  svcCostSenior: [2e-5, 'M', '6.11', ['L05', 'S06', 'S11']],
  // REF §11.6: P86은 악화 방향, 회복 속도 0.038의 근거가 아니다.
  approvalMemoryReal: [.038, 'P', '11.6', ['P88', 'P87', 'P89']],
  taxPoints: [10, 'M', '3.10, 4.6', ['L01', 'P19', 'P46', 'P27']],
  // SPEC §1.1 및 REF §7.15: 실제 CBAM은 0. 가상 사건의 0.3은 별도 G 값이다.
  carbonWeight: [0, 'O', '7.15', ['L33']],
  hostEssMul: [1, 'M', '8.11', ['I13', 'X24']],
  unsZeroA: [3, 'M', '4.1', ['P23', 'P37', 'P24', 'S17', 'X01', 'P15']],
  // REF §5.9 params 행: 정확한 단위 환산이므로 VoLL 문헌 번호를 요구하지 않는다.
  mwhToKwh: [1000, 'M', '5.9', []],
  wonPerEok: [1e8, 'M', '5.9', []],
  indTaxK: [1.7, 'M', '5.3', ['X08']],
  subRevenueRate: [.8, 'O', '6.5', ['L03', 'L05', 'S10']],
  taxStep: [.25, 'O', '6.4', ['L01']],
  svcStep: [.25, 'M', '6.11', ['L05', 'S06', 'S11']],
  // REF §11.7의 P는 평균 창 구조. 임기·소환·평가 문턱의 출처는 다른 계수다.
  approvalWindow: [12, 'P', '11.7', ['P89']],
  // REF §6.13: 이자율은 S13(연 2.853% ÷ 12), L07은 revYear 기준 연도의 근거다.
  debtRate: [.0024, 'M', '6.13', ['S13']],
  outRel: [.006, 'M', '5.1', ['P23', 'X08', 'P33', 'P34']],
  fxExport: [.1, 'M', '7.12', ['I26']],
  seekRate: [.05, 'M', '4.10', ['S14', 'S15']],
  // REF §3.2: I01은 전입 사유에 전력 신뢰 항목이 없다는 비교에 쓰인다.
  wL: [{ rel: .26, price: .08, air: .04, jobs: .30, svc: .09, tax: .04, crowd: .19 },
    'M', '3.2', ['S03', 'P15', 'L32']],
};
function test(result, group, label, fn, detail = {}) {
  const counts = result.groups[group] ||= { pass: 0, fail: 0 };
  result.assertions++;
  try { fn(); counts.pass++; }
  catch (e) {
    counts.fail++;
    result.failures.push({ label, ...detail, error: e.message });
  }
}

// 절 번호의 접두사 충돌이나 다음 같은 수준 절의 출처 혼입을 허용하지 않는다.
// 같은 수준 또는 상위 머리 전까지 자르고, 하위 머리는 해당 절에 포함한다.
function refSections(text) {
  const heads = [...text.matchAll(/^(#{1,6})\s+([^\n]+)$/gm)], sections = new Map();
  heads.forEach((head, i) => {
    const number = head[2].match(/^(\d+(?:\.\d+)*)(?![\d.])(?:\s|$)/)?.[1];
    if (!number) return;
    const end = heads.slice(i + 1).find(next => next[1].length <= head[1].length)?.index ?? text.length;
    sections.set(number, text.slice(head.index, end));
  });
  return sections;
}
function noteSections(note) {
  return [...(note || '').matchAll(/\bREF\s+(\d+(?:\.\d+)+(?:\s*,\s*\d+(?:\.\d+)+)*)/g)]
    .flatMap(match => match[1].split(/\s*,\s*/));
}
const sourceIds = text => new Set([...text.matchAll(/\[([A-Z]\d+)\]/g)].map(match => match[1]));
function numbersIn(text) {
  // .30/0.30, 1,000/1000, 2.0e-5/0.00002, 1e8 등을 수치로 대조한다.
  // P15·키 이름 안의 숫자나 0.00375의 일부를 별도 표기로 세지 않는다.
  const notation = /(?<![A-Za-z0-9_.])[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![A-Za-z0-9_.])/gi;
  return new Set([...text.replaceAll('−', '-').matchAll(notation)]
    .map(match => Number(match[0].replaceAll(',', ''))));
}
function numericLeaves(value, prefix) {
  return typeof value === 'number' ? [[prefix, value]]
    : Object.entries(value).flatMap(([key, child]) => numericLeaves(child, `${prefix}.${key}`));
}

// VM 객체도 같은 구조로 비교한다. 중첩된 실수에도 절대 오차 1e-12를 적용한다.
function equalValue(actual, want, label) {
  if (typeof want === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - want) <= 1e-12,
      `${label}: 실제 ${actual}, 대장 ${want}`);
  } else if (want && typeof want === 'object') {
    assert.ok(actual && typeof actual === 'object', `${label}: 객체/배열 필요`);
    assert.equal(Array.isArray(actual), Array.isArray(want), `${label}: 배열 여부`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(want).sort(), `${label}: 키 집합`);
    for (const key of Object.keys(want)) equalValue(actual[key], want[key], `${label}.${key}`);
  } else assert.deepEqual(actual, want, label);
}
// 현재 22개 키는 모두 REF 해당 절 또는 SPEC 해당 행에 숫자 표기가 있다.
// 계산값이라 문자 그대로 없는 키의 숫자 검사를 건너뛰는 예외는 현재 없다.
function inspect(data, refText = references, specText = spec) {
  const ledger = refText + '\n' + specText, sections = refSections(refText);
  const missingLedger = Object.keys(expected).filter(key => !new RegExp(`\\b${key}\\b`).test(ledger));
  const result = { assertions: 0, groups: {}, failures: [], missingLedger, numericSkips: [] };
  test(result, '대장', '대장 키 누락 없음', () => assert.deepEqual(missingLedger, []),
    { kind: '대장 키', actual: missingLedger, expected: [] });
  for (const [key, [value, grade, section, refs]] of Object.entries(expected)) {
    const ids = section.split(/\s*,\s*/), bodies = ids.map(id => sections.get(id) || '').join('\n');
    const inSection = sourceIds(bodies);
    test(result, '대장', `${key}: REF 절·기대 출처 대조`, () => {
      for (const id of ids) assert.ok(sections.has(id), `REF ${id} 절 없음`);
      assert.deepEqual(refs.filter(ref => !inSection.has(ref)), [], `${key}: 기대 출처가 REF ${section}에 없음`);
    }, { key, kind: '대장 출처', expected: refs });
    test(result, '대장', `${key}: 기대 숫자 표기 대조`, () => {
      // 표의 키 열이 정확히 일치하는 행만 허용한다. 다른 키의 숫자는 빌리지 않는다.
      const rows = specText.split('\n').filter(line => line.trim().startsWith('|') &&
        line.split('|')[1].trim().replaceAll('`', '') === key).join('\n');
      const written = numbersIn(bodies + '\n' + rows);
      const missing = numericLeaves(value, key).filter(([, number]) => !written.has(number));
      assert.deepEqual(missing, [], `${key}: 기대 숫자가 REF ${section}·SPEC 해당 행에 없음`);
    }, { key, kind: '대장 값', expected: value });

    const param = data.params[key];
    test(result, '값', `${key}: 값 (REF ${section})`, () => equalValue(param?.v, value, key),
      { key, kind: '값', actual: param?.v, expected: value });
    test(result, '등급', `${key}: 이후 등급`, () => assert.equal(param?.grade, grade),
      { key, kind: '등급', actual: param?.grade, expected: grade });
    test(result, '출처', `${key}: 출처`, () => {
      const actual = param?.refs;
      assert.ok(Array.isArray(actual), `${key}.refs 배열 필요`);
      const missing = refs.filter(ref => !actual.includes(ref));
      assert.deepEqual(missing, [], `${key}.refs 누락: ${missing.join(', ')}`);
      const noted = noteSections(param?.note);
      if (!refs.length) {
        for (const id of ids) assert.ok(noted.includes(id), `${key}.note: REF ${id} 필요`);
      }
      const allowed = new Set(inSection);
      for (const id of noted) {
        assert.ok(sections.has(id), `${key}.note: REF ${id} 절 없음`);
        for (const ref of sourceIds(sections.get(id))) allowed.add(ref);
      }
      const extra = actual.filter(ref => !allowed.has(ref));
      assert.deepEqual(extra, [], `${key}.refs: REF ${[...new Set([...ids, ...noted])].join(', ')}에 없는 번호: ${extra.join(', ')}`);
    }, { key, kind: '출처', actual: param?.refs, expected: refs });
  }
  return result;
}

const snapshot = structuredClone(D), result = inspect(D), mutations = [];
// 비교기만 직접 부르지 않는다. 키마다 구조 복제한 자료의 값·등급·출처를
// 각각 오염시킨 뒤 대장 대조를 포함한 본 검사 루프 전체를 다시 실행한다.
for (const key of Object.keys(expected)) {
  for (const kind of ['값', '등급', '출처']) test(result, '변형 확인', `${key}: ${kind} 사본 변형 검출`, () => {
    const copy = structuredClone(D), param = copy.params[key];
    assert.ok(param, `${key} 구현 계수 없음`);
    if (kind === '값') {
      if (typeof expected[key][0] === 'number') param.v = expected[key][0] + 1;
      else {
        param.v = structuredClone(expected[key][0]);
        param.v[Object.keys(param.v)[0]] += 1;
      }
    } else if (kind === '등급') param.grade = 'G';
    else param.refs = [...(param.refs || []), 'P999999'];
    const rerun = inspect(copy);
    const found = rerun.failures.find(f => f.key === key && f.kind === kind &&
      !result.failures.some(before => before.key === key && before.kind === kind && before.error === f.error));
    assert.ok(found, `${key}: 본 검사에서 ${kind} 변형의 새 실패 필요`);
    if (kind === '출처') assert.ok(found.error.includes('P999999'), '덧붙인 엉뚱한 번호를 검출');
    mutations.push({ key, kind, detected: true });
  });
}
test(result, '변형 확인', '대장에서 키가 사라져도 실패로 집계', () => {
  const rerun = inspect(structuredClone(D), references.replace(/\baiVollMul\b/g, 'REMOVED_KEY'),
    spec.replace(/\baiVollMul\b/g, 'REMOVED_KEY'));
  assert.ok(rerun.missingLedger.includes('aiVollMul'));
  assert.ok(rerun.failures.some(f => f.kind === '대장 키'), '누락 목록만 출력하고 통과하지 않음');
});
test(result, '변형 확인', '원본 자료 불변', () => assert.deepEqual(D, snapshot));
for (const failure of result.failures) console.error(`FAIL ${failure.label}: ${failure.error}`);
console.log(JSON.stringify({ suite: '39-evidence-params', assertions: result.assertions,
  pass: result.assertions - result.failures.length, failures: result.failures.length, groups: result.groups,
  details: result.failures, missingLedger: result.missingLedger, missingLedgerCount: result.missingLedger.length,
  numericSkips: result.numericSkips, mutations }));
process.exitCode = result.failures.length ? 1 : 0;
