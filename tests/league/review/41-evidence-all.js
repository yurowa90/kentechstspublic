'use strict';
// 독립 계약: 아래 기대값은 ECON-REFERENCES(REF)·ECON-RECAL-SPEC(SPEC)에서
// 전사했다. 구현은 VM으로 실행하고 키/스키마만 조사했다. 구현 값으로 기대값을
// 생성하지 않는다. 실행: node tests/league/review/41-evidence-all.js
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../..');
const references = fs.readFileSync(path.join(ROOT, 'docs/ECON-REFERENCES.md'), 'utf8');
const spec = fs.readFileSync(path.join(ROOT, 'docs/ECON-RECAL-SPEC.md'), 'utf8');
const context = vm.createContext({ window: { KCP: {} } });
// lib.js의 경제 시뮬레이션은 필요 없다. 실제 페이지와 같은 기술→경제 순서로
// 읽어 tech_ 합본도 검사한다. 파일이나 전역 객체에 쓰지 않는다.
for (const file of ['tech-data.js', 'econ-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui', file), 'utf8'), context, { filename: file });
}
// VM 배열의 prototype 차이가 가짜 deepEqual 실패를 만들지 않도록 정규화한다.
const D = structuredClone(context.window.KCP.ECON_DATA);
// 산업부 2019-03-05·2017-09-01 p.1 표(REF 18.2). 실제 params를 기대값으로 쓰지 않는다.
const pmFacts = { coalReference: .120, coalNew: .044, lngReference: .015, lngNew: .007 };
const newPM = { coal: 1 * pmFacts.coalNew / pmFacts.coalReference,
  lng: .05 * pmFacts.lngNew / pmFacts.lngReference };

// [값, 등급, REF 절, params 출처, 대장 전용 출처(선택)]. §1의 서지 목록에만 키가
// 있는 경우는 대응으로 인정하지 않는다. tech_는 합본 이름 공간일 뿐이다.
// SPEC §1.1/1.2의 개별 등급이 REF 절 전체의 혼합 등급보다 우선한다.
// 최신 정정: D-73(탄소), G7(FOAK 비용), G4(공사 기간) 순으로 반영했다.
const expected = {
  // REF §19.1 원문 대장: LNG 5→35℃ 출력 −22.6%, 실리콘 두 계수 가운데값.
  heatLngSlope: [.226 / 30, 'M', '19.1', ['D90-R1']],
  heatPvSlope: [.004165, 'P', '19.1', ['D90-R2']],
  // REF §18: 출처 ID는 새 대장의 D87-Rxx 표기다. params는 REF 절을 참조한다.
  thermalMW: [{ lng: 561, coal: 1040 }, 'O*', '18.1', ['D87-R04']],
  thermalCapex: [{ lng: 1275, coal: 1809 }, 'P', '18.1', ['D87-R01']],
  pmNewFuelW: [newPM, 'M', '18.2', ['D87-R02', 'D87-R03']],
  aiVollMul: [5, 'M', '5.8', ['L35', 'P37', 'S18', 'P15', 'P38']],
  curtailLossReal: [.018, 'M', '8.14', ['X25']],
  connPerMonthReal: [.00375, 'M', '8.12', ['S22', 'S21']],
  coopCo2Cut: [.4, 'O', '13.6', ['L12']],
  scoreCo2Best: [.25038, 'M', '13.5', ['S36', 'L12']],
  // 최악 기술 .82라는 정의값. I03의 일반 정규화 방법을 값의 출처로 요구하지 않는다.
  scoreCo2Worst: [.82, 'M', '13.5', []],
  scoreCo2RelCut: [.4, 'M', '13.5', ['L12']],
  cbamPhase: [{ 2026: .025, 2027: .05, 2028: .10, 2029: .225, 2030: .485,
    2031: .61, 2032: .735, 2033: .86, 2034: 1 }, 'O', '7.13', ['L34']],
  cbamDrop: [.046, 'P', '7.13', ['P52']],
  cbamEuShare: [.154, 'M', '7.13', ['S30']],
  indTaxLag: [12, 'O', '5.3', ['L01']],
  budgetToRevenue: [2.2, 'M', '6.12', ['X28']],
  // 표시용 빈도 배율은 REF 7.8·SPEC §5의 ×3이다(현실 연 .12회와 구분).
  // 숫자 근거가 있어도 이 별칭들의 대장 키 누락을 면제하지 않는다.
  lngSpikeFrequency: [3, 'M', '7.8', ['S16']],
  outageHoursPerPercent: [87.6, 'M', '5.10', []],
  koreaOutageHours2019: [.04, 'O', '5.10', ['S27']],
  researchYears: [[10, 30], 'P', '12.8', ['I09']],
  // REF §12.6: I13의 43/55/71개월 중 배속표 비교값 55개월(P).
  smrMonthsReal: [55, 'P', '12.6', ['I13']],
  // REF §1.3 I35의 설비별 값, §12.6 D-81의 키·등급에서 전사.
  buildLeadYears: [{ solar: 2, wind: 3, ess: 1, biomass: 4, diesel: 2, smr: 6 },
    'P', '12.6', ['I35']],
  // REF §12.6의 27~32개월·10년, §1.3 I36의 5~15년에서 전사.
  buildLeadKorea: [{ lngMonths: [27, 32], windPermitYears: 10, gridYears: [5, 15] },
    'O*', '12.6', ['X31', 'X32', 'X33', 'I36']],
  debtWarnRatio: [.55, 'M', '6.12', ['L07']],
  // 병행 작업에서 params로 옮긴 기존 문턱: REF 13.4·SPEC F14의 d=.40.
  debtCrisisRatio: [.40, 'M', '6.12, 13.4', ['L07']],
  svcCostSenior: [2e-5, 'M', '6.11', ['L05', 'S06', 'S11']],
  approvalMemoryReal: [.038, 'P', '11.6', ['P88', 'P87', 'P89']],
  lossAversion: [1.955, 'P', '3.8, 11.4', ['P18']],
  priceSteelMul: [4, 'M', '4.3', ['P25']],
  jobsJ: [3, 'M', '3.7', ['P06']],
  serviceCurve: [[-27, -20, 0, 10, 14], 'M', '3.8', ['P18', 'P84', 'P85']],
  taxPoints: [10, 'M', '3.10, 4.6', ['L01', 'P19', 'P46', 'P27']],
  priceWeightBase: [.1, 'M', '4.3', ['P25']],
  carbonWeight: [0, 'O', '7.15', ['L33']],
  // S19는 같은 절의 PRICE 거래 단가 범위 근거이고 기준 LNG 원가와 구분한다.
  normalCost: [.008, 'M', '7.11', ['S18', 'S16']],
  normalCo2: [.4173, 'O', '9.7', ['S36']],
  hostCapMul: [.4, 'M', '8.11', ['S21', 'X26']],
  hostEssMul: [1, 'M', '8.11', ['I13', 'X24']],
  curtailSlope: [1.3, 'M', '8.13', ['S22', 'X25', 'X26']],
  curtailKnee: [.64, 'M', '8.13', ['S22', 'X25', 'X26']],
  essCap: [.9, 'O', '8.8', ['X22', 'L27']], // 대장 §8.8을 W5 원문 대조(2026-10-17) 결과 O로 정정한 데 맞춤
  betaPopReal: [.12, 'M', '2.3', ['P06', 'P07']],
  startMix: [1, 'P', '2.5', ['P10', 'P01']],
  kappaPopReal: [.009, 'M', '2.2', ['P06', 'P07', 'P08']],
  betaIndReal: [.08, 'M', '2.7', ['P27', 'L01']],
  kappaIndReal: [.005, 'M', '2.8', ['S34']],
  // S01은 과거 anchor .9의 방향을 반박하는 비교 자료이고 1의 구조 근거는 P01.
  anchor: [1, 'P', '2.6', ['P01']],
  gpYear: [.01, 'M', '2.9', ['S01', 'S02']],
  giYear: [.012, 'M', '2.10', ['S04', 'S05']],
  wL: [{ rel: .26, price: .08, air: .04, jobs: .30, svc: .09, tax: .04, crowd: .19 },
    'M', '3.2', ['S03', 'P15', 'L32']],
  unsZeroA: [3, 'M', '4.1', ['P23', 'P37', 'P24', 'S17', 'X01', 'P15']],
  airSlope: [29, 'M', '9.10', ['P17']],
  kPM: [7e-6, 'M', '9.10', ['P61']],
  pmFuelW: [{ coal: 1, diesel: .8, biomass: .8, lng: .05 }, 'M', '9.10', ['I24', 'P60']],
  moneyScale: [28, 'M', '6.1', ['S06', 'X28']],
  facilityShare: [.65, 'O', '6.14', ['L06']],
  facilityRate: [{ coal: .7, lng: .6, smr: 1 }, 'O', '6.14', ['L01']],
  mwhToKwh: [1000, 'M', '5.9', []],
  wonPerEok: [1e8, 'M', '5.9', []],
  outageHomeWon: [3564, 'P', '5.9', ['P15']],
  outageIndustryUsd: [[.35, .80], 'P', '5.9', ['P37']],
  outageFx: [3564 / 2.76, 'M', '5.9', ['P15']],
  indTaxK: [1.7, 'M', '5.3', ['X08']],
  subRevenueRate: [.8, 'O', '6.5', ['L03', 'L05', 'S10']],
  taxStep: [.25, 'O', '6.4', ['L01']],
  svcCost: [3e-5, 'M', '6.11', ['L05', 'S06', 'S11']],
  svcStep: [.25, 'M', '6.11', ['L05', 'S06', 'S11']],
  approvalWindow: [12, 'P', '11.7', ['P89']],
  debtRate: [.0024, 'M', '6.13', ['S13']],
  debtCapRatio: [.88, 'M', '6.12', ['L07']],
  outRel: [.006, 'M', '5.1', ['P23', 'X08', 'P33', 'P34']],
  fxExport: [.1, 'M', '7.12', ['I26']],
  // 병행 작업의 새 별칭. 값·등급은 REF 7.5/7.6과 SPEC §1.3의
  // intl.theta / intl.sigma 새 값에서 전사했으며, 별칭 자체의 문서 누락도 센다.
  intlThetaLng: [.03, 'M', '7.5', ['S16', 'S28', 'P48']],
  intlThetaFx: [.015, 'M', '7.6', ['S29']],
  intlSigmaLng: [.07, 'M', '7.5', ['S28', 'S16']],
  intlSigmaFx: [.019, 'M', '7.6', ['S29']],
  co2IntRef: [.4173, 'O', '9.7', ['S36']],
  co2IntDef: [.4173, 'O', '9.7', ['S36']],
  reviewEvery: [12, 'O', '11.8', ['L30', 'L31']],
  seekRate: [.05, 'M', '4.10', ['S14', 'S15']],
  tech_roundSteps: [4.35, 'M', '12.7', []],
  tech_sicOutput: [1.015, 'P', '12.3', ['P95']],
  tech_tandemOutput: [1.2, 'P', '12.2', ['I21', 'X19', 'I13']],
  tech_h2Efficiency: [.35, 'P', '12.4', ['I17', 'I18']],
  tech_h2Cost: [28, 'M', '12.4', ['I17', 'I14']],
  tech_h2Co2: [.88, 'M', '9.12', ['S35', 'L14']],
  tech_ccuOutput: [.79, 'M', '12.5', ['I19', 'I07']],
  tech_smrMW: [4 * 170 / 230, 'M', '12.6', ['X16']],
  tech_smrCost: [(150 / 20) * (8000 / 4500) * (4 * 170 / 230), 'M', '12.6', ['I34']],
  // SPEC §1.3의 개별 근거 등급 P를 유지. G4가 정한 12턴 크기는 G이며,
  // REF §0의 '관계를 정하는 근거의 등급' 규칙에 따라 55개월 근거 P와 구분한다.
  tech_smrTurns: [12, 'P', '12.6', ['I13']],
  tech_smrFuel: [.002, 'M', '12.6', ['S33']],
  tech_fcstWidth: [.7, 'P', '12.7', ['P101']],
};

// 대장에 계산 결과가 그대로 없는 값은 입력 숫자와 정의식을 모두 확인한다.
// 구현에서 식·입력값을 역산하지 않는다. 단위 정의도 검사를 생략하지 않는다.
const definitions = {
  heatLngSlope: { inputs: [.226, 30], formula: /0\.226\s*\/\s*30/,
    value: () => .226 / (35 - 5) },
  pmNewFuelW: { inputs: Object.values(pmFacts),
    formula: /pmFuelW\.coal\s*×\s*0\.044\/0\.120[\s\S]*pmFuelW\.lng\s*×\s*0\.007\/0\.015/,
    value: () => newPM },
  outageHoursPerPercent: { inputs: [8760, 1], formula: /8,760시간\s*×\s*1%/,
    value: () => 8760 * .01 },
  mwhToKwh: { inputs: [1000], formula: /mwhToKwh=1000\(M,\s*정확한 단위 환산\)/,
    value: () => 1000 },
  wonPerEok: { inputs: [1e8], formula: /wonPerEok=1e8\(M,\s*정확한 단위 환산\)/,
    value: () => 1e8 },
  outageFx: { inputs: [3564, 2.76], formula: /outageFx=3564\s*\/\s*2\.76/,
    value: () => 3564 / 2.76 },
  tech_roundSteps: { inputs: [365.2425, 12, 7, 4.35], formula: /365\.2425\s*\/\s*12\s*\/\s*7\s*=\s*4\.35/,
    // 대장의 달력 평균은 소수 두 자리로 반올림한 4.35주다.
    value: () => Math.round(365.2425 / 12 / 7 * 100) / 100 },
  tech_smrMW: { inputs: [4, 170, 230], formula: /smrMW\s*=\s*4×170\/230/,
    value: () => 4 * 170 / 230 },
  tech_smrCost: { inputs: [150, 20, 8000, 4500], formula: /\(150\/20\)×\(8,000\/4,500\)/,
    value: () => (150 / 20) * (8000 / 4500) * (4 * 170 / 230) },
};

function sectionsIn(text) {
  const heads = [...text.matchAll(/^(#{1,6})\s+([^\n]+)$/gm)], sections = new Map();
  heads.forEach((head, i) => {
    const id = head[2].match(/^(\d+(?:\.\d+)*)(?![\d.])(?:\s|$)/)?.[1];
    if (!id) return;
    const end = heads.slice(i + 1).find(next => next[1].length <= head[1].length)?.index ?? text.length;
    sections.set(id, text.slice(head.index, end));
  });
  return sections;
}
const sourceIds = text => new Set([...text.matchAll(/\[((?:[A-Z]\d+|D(?:87|90)-R\d+))\]/g)].map(m => m[1]));
const baseKey = key => key.replace(/^tech_/, '');
const hasKey = (text, key) => new RegExp(`\\b${baseKey(key)}\\b`).test(text);
function numbersIn(text) {
  const notation = /(?<![A-Za-z0-9_.])[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![A-Za-z0-9_.])/gi;
  return new Set([...text.replaceAll('−', '-').replace(/(\d)(MW)\b/g, '$1 $2').matchAll(notation)].map(m => Number(m[0].replaceAll(',', ''))));
}
function numericLeaves(value, prefix) {
  return typeof value === 'number' ? [[prefix, value]]
    : Object.entries(value).flatMap(([key, child]) => numericLeaves(child, `${prefix}.${key}`));
}
function equalValue(actual, want, label) {
  if (typeof want === 'number') {
    // REF의 SMR 계산 결과는 소수9자리 표기다. 그 반올림 오차만 허용한다.
    assert.ok(Number.isFinite(actual) && Math.abs(actual - want) <= 1e-9,
      `${label}: 실제 ${actual}, 대장 ${want}`);
  } else {
    assert.ok(actual && typeof actual === 'object', `${label}: 객체/배열 필요`);
    assert.equal(Array.isArray(actual), Array.isArray(want), `${label}: 배열 여부`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(want).sort(), `${label}: 키 집합`);
    for (const key of Object.keys(want)) equalValue(actual[key], want[key], `${label}.${key}`);
  }
}
function check(result, group, key, fn) {
  const bucket = result.groups[group] ||= { pass: 0, fail: 0 };
  result.assertions++;
  try { fn(); bucket.pass++; }
  catch (error) { bucket.fail++; result.failures.push({ key, kind: group, error: error.message }); }
}
function inspect(data, refText = references, specText = spec) {
  const sections = sectionsIn(refText);
  // 모집단은 매번 실행 자료에서 수집한다. 대응표만 순회하면 새 키를 놓친다.
  const evidenceKeys = Object.keys(data.params).filter(key => data.params[key].grade !== 'G').sort();
  const result = { assertions: 0, groups: {}, failures: [], evidenceKeys,
    unmapped: evidenceKeys.filter(key => !Object.hasOwn(expected, key)), missingLedger: [] };
  check(result, '원천 값', 'thermalFacts.pm', () => {
    for (const [key, value] of Object.entries(pmFacts)) equalValue(data.thermalFacts?.pm?.[key], value, key);
    assert.equal(data.thermalFacts.pm.unit, 'kg/MWh');
    assert.equal(data.thermalFacts.pm.grade, 'O');
    assert.equal(data.thermalFacts.pm.sources.length, 2);
    for (const source of data.thermalFacts.pm.sources) {
      assert.ok(sections.get('18.2').includes(source), 'REF 18.2의 산업부 원문 출처');
    }
    assert.match(sections.get('18.2'), /2019-03-05[\s\S]*p\.1[\s\S]*2017-09-01[\s\S]*p\.1/);
  });
  for (const key of result.unmapped) check(result, '대장 대응', key, () => assert.fail('대장 대응 없음'));
  // 알려진 키가 G로 바뀌어 모집단에서 사라져도 값·등급 검사를 유지한다.
  const keys = [...new Set([...evidenceKeys, ...Object.keys(expected)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key)) continue;
    const [value, grade, section, refs, ledgerRefs = refs] = expected[key];
    const ids = section.split(/\s*,\s*/), bodies = ids.map(id => sections.get(id) || '').join('\n');
    const rows = specText.split('\n').filter(line => line.trim().startsWith('|') &&
      line.split('|')[1].trim().replaceAll('`', '') === baseKey(key)).join('\n');
    if (!hasKey(bodies + '\n' + rows, key)) result.missingLedger.push(key);
    check(result, '대장 키', key, () => {
      for (const id of ids) assert.ok(sections.has(id), `REF ${id} 절 없음`);
      assert.ok(hasKey(bodies + '\n' + rows, key), `REF ${section}·SPEC 해당 행에 키 없음`);
    });
    const inSection = sourceIds(bodies);
    check(result, '대장 출처', key, () => {
      assert.deepEqual(ledgerRefs.filter(ref => !inSection.has(ref)), [], `REF ${section}에 기대 출처 없음`);
    });
    check(result, '대장 값', key, () => {
      const definition = definitions[key];
      const want = definition ? definition.inputs.map((n, i) => [`입력${i}`, n]) : numericLeaves(value, key);
      const written = numbersIn(bodies + '\n' + rows);
      assert.deepEqual(want.filter(([, n]) => !written.has(n)), [], `REF ${section}·SPEC 해당 행에 기대 숫자 없음`);
      if (definition) {
        assert.match(bodies, definition.formula, `REF ${section}에 정의식 없음`);
        equalValue(definition.value(), value, `${key} 독립 정의식`);
      }
    });
    const param = data.params[key];
    check(result, '값', key, () => equalValue(param?.v, value, key));
    check(result, '등급', key, () => assert.equal(param?.grade, grade, `${key}: 대장 등급 ${grade}`));
    check(result, '출처', key, () => {
      assert.ok(Array.isArray(param?.refs), `${key}.refs 배열 필요`);
      assert.deepEqual(refs.filter(ref => !param.refs.includes(ref)), [], `${key}.refs 기대 번호 누락`);
      const noted = [...(param.note || '').matchAll(/\bREF\s+(\d+(?:\.\d+)+(?:\s*,\s*\d+(?:\.\d+)+)*)/g)]
        .flatMap(m => m[1].split(/\s*,\s*/));
      if (!refs.length) for (const id of ids) assert.ok(noted.includes(id), `${key}.note: REF ${id} 필요`);
      const allowed = new Set(inSection);
      for (const id of noted) {
        assert.ok(sections.has(id), `${key}.note: REF ${id} 절 없음`);
        for (const ref of sourceIds(sections.get(id))) allowed.add(ref);
      }
      assert.deepEqual(param.refs.filter(ref => !allowed.has(ref)), [], `${key}.refs 대장 절 밖 번호`);
    });
  }
  return result;
}

const snapshot = structuredClone(D), result = inspect(D), mutations = [];
check(result, '변형 확인', '신규 LNG 옛 직접비 0.007/0.120', () => {
  const copy = structuredClone(D);
  copy.params.pmNewFuelW.v.lng = .007 / .120;
  assert.ok(inspect(copy).failures.some(f => f.key === 'pmNewFuelW' && f.kind === '값'));
});
// 대응표 전체의 값·등급·출처를 각각 오염시키고 본 검사를 재실행한다.
// 기존 실패에 가려지지 않도록 사본의 대상 계약을 정상화한 뒤 변형한다.
for (const key of Object.keys(expected)) for (const kind of ['값', '등급', '출처']) {
  check(result, '변형 확인', `${key}/${kind}`, () => {
    const copy = structuredClone(D), [value, grade, section, refs] = expected[key];
    copy.params[key] = { v: structuredClone(value), grade, refs: [...refs], note: `REF ${section}` };
    const before = inspect(copy);
    assert.ok(!before.failures.some(f => f.key === key && f.kind === kind), '변형 전 대상 계약이 통과해야 함');
    const param = copy.params[key];
    if (kind === '값') {
      if (typeof param.v === 'number') param.v += 1;
      else {
        let object = param.v;
        while (typeof object[Object.keys(object)[0]] !== 'number') object = object[Object.keys(object)[0]];
        object[Object.keys(object)[0]] += 1;
      }
    } else if (kind === '등급') param.grade = grade === 'G' ? 'M' : 'G';
    else param.refs.push('P999999');
    const after = inspect(copy);
    assert.ok(after.failures.some(f => f.key === key && f.kind === kind), `${kind} 변형 검출 필요`);
    mutations.push({ key, kind, detected: true });
  });
}
for (const key of ['thermalMW', 'thermalCapex', 'pmNewFuelW', 'heatLngSlope', 'heatPvSlope']) check(result, '변형 확인', `${key}/대장 출처 삭제`, () => {
  const id = (expected[key][4] || expected[key][3])[0];
  const rerun = inspect(structuredClone(D), references.replaceAll(`[${id}]`, '[REMOVED_SOURCE]'));
  assert.ok(rerun.failures.some(f => f.key === key && f.kind === '대장 출처'));
});
check(result, '변형 확인', '새 근거 계수', () => {
  const copy = structuredClone(D);
  copy.params.syntheticEvidenceParam = { v: 123, grade: 'M', refs: ['P15'] };
  const rerun = inspect(copy);
  assert.ok(rerun.unmapped.includes('syntheticEvidenceParam'));
  assert.ok(rerun.failures.some(f => f.key === 'syntheticEvidenceParam' && f.kind === '대장 대응'));
});
for (const key of ['aiVollMul', 'smrMonthsReal']) check(result, '변형 확인', `${key}/대장 키 삭제`, () => {
  const pattern = new RegExp(`\\b${key}\\b`, 'g');
  const rerun = inspect(structuredClone(D), references.replace(pattern, 'REMOVED_KEY'),
    spec.replace(pattern, 'REMOVED_KEY'));
  assert.ok(rerun.missingLedger.includes(key));
  assert.ok(rerun.failures.some(f => f.key === key && f.kind === '대장 키'));
});
check(result, '변형 확인', '정의식 삭제', () => {
  const rerun = inspect(structuredClone(D), references.replace('8,760시간 × 1%', '정의식 삭제'));
  assert.ok(rerun.failures.some(f => f.key === 'outageHoursPerPercent' && f.kind === '대장 값'));
});
check(result, '변형 확인', '원본 자료 불변', () => assert.deepEqual(D, snapshot));
for (const f of result.failures) console.error(`FAIL ${f.kind} / ${f.key}: ${f.error}`);
console.log(JSON.stringify({ suite: '41-evidence-all', assertions: result.assertions,
  pass: result.assertions - result.failures.length, failures: result.failures.length,
  evidenceCount: result.evidenceKeys.length, mappedCount: Object.keys(expected).length,
  groups: result.groups, details: result.failures, missingLedger: result.missingLedger,
  unmapped: result.unmapped, mutations }));
process.exitCode = result.failures.length ? 1 : 0;
