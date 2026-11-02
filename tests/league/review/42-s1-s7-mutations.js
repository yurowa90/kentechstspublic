'use strict';
// Node 전용 변이 확인. ui/ 원본에는 쓰지 않고 임시 사본만 하네스에 전달한다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const implementation = path.join(ROOT, 'ui/league.js'), econData = path.join(ROOT, 'ui/econ-data.js');
const original = fs.readFileSync(implementation), originalData = fs.readFileSync(econData);
const source = original.toString('utf8'), dataSource = originalData.toString('utf8');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'league-s1-s7-'));
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `변이 연결점 정확히 하나: ${from}`);
  return text.replace(from, to);
}
function removeThresholdCeiling(text) {
  // rev14b A1: 문턱 표시에도 자릿수 인수가 전달된다. 올림만 제거하고 그 인수는 보존한다.
  const pattern = /return outageValue\(rounded \+ epsilon < magnitude \? rounded \+ 1 \/ scale : rounded, unit(, false, (?:outageDigits\(a\)|digits|d))?\);/g;
  assert.equal([...text.matchAll(pattern)].length, 1, '변이 연결점 정확히 하나: 문턱 올림 outageValue');
  return text.replace(pattern, (_, suffix = '') => `return outageValue(rounded, unit${suffix});`);
}
const cases = [
  { name: 'T 비율 문턱 설명을 항상 최소 크기로', harness: '40-v5-s7.js', regression: 'V8 N2 grid/고르기 건너뜀 무작위·경계',
    mutate: s => replaceOnce(s, 'const shareThreshold = Number.isFinite(difference)', 'const shareThreshold = false && Number.isFinite(difference)') },
  { name: 'T 절댓값 설명에 부호 있는 차이 사용', harness: '40-v5-s7.js', regression: 'T S7 부호·기준 문구 trial/grid/negative',
    mutate: s => {
      // rev14b A1은 같은 호출에 자릿수 인수를 더한다. 절댓값 제거 변이는 그대로 유지한다.
      const pattern=/outageValue\(Math\.abs\(outageShownTotal\(a\)\), unit(?:, false, (?:outageDigits\(a\)|digits|d))?\)/g;
      const matches=[...s.matchAll(pattern)];assert.ok(matches.length>0,'변이 연결점: 요약 차이 절댓값');
      return s.replace(pattern,x=>x.replace('Math.abs(outageShownTotal(a))','outageShownTotal(a)'));
    } }, // rev13 R2: 차이 글자가 표시 합계로 바뀌어 변이 대상 식을 옮김
  { name: 'T 최소 크기 동률을 비율 쪽으로', harness: '40-v5-s7.js', regression: 'T S7 부호·기준 문구 trial/grid/equal',
    mutate: s => replaceOnce(s, 'params("outageCardShareMin") * Math.abs(difference) > outageMinPart(a)', 'params("outageCardShareMin") * Math.abs(difference) >= outageMinPart(a)') },
  { name: 'N2 문턱만 반올림으로 복귀', harness: '40-v5-s7.js', regression: 'V8 N2 grid/고르기 건너뜀 무작위·경계',
    mutate: removeThresholdCeiling },
  { name: 'N2 문장만 미만으로 복귀', harness: '40-v5-s7.js', regression: 'V8 N2 grid/고르기 건너뜀 무작위·경계',
    mutate: s => s.replaceAll(' 이하라', ' 미만이라') },
  { name: 'N1 S6 비교를 클릭 값·옛 지난달 값으로 복귀', harness: '40-v5-s7.js', regression: 'V8 N1 S6·S7 S1 값끼리 비교',
    mutate: s => replaceOnce(s,
      'const { value: evidenceValue, before: previousValue } = evidenceComparisonValues(n, previousNote);',
      'const evidenceValue = n.evidence?.nowValue ?? n.evidence?.value, previousValue = previousNote?.evidenceValues?.[n.evidence.key] ?? previousNote?.evidence?.value;') },
  { name: 'N1 S7 비교를 클릭 값·옛 지난달 값으로 복귀', harness: '40-v5-s7.js', regression: 'V8 N1 S6·S7 S1 값끼리 비교',
    mutate: s => replaceOnce(s,
      'const { value: evidenceValue, before: oldValue } = evidenceComparisonValues(n, previous);',
      'const evidenceValue = n.evidence?.nowValue ?? n.evidence?.value, oldValue = previous?.evidenceValues?.[key] ?? previous?.evidence?.value;') },
  { name: 'N1 덧붙임 줄 같음 조건 반대로', harness: '41-v5-s1.js', regression: 'V8 N1 S4 시작 3.65 → 지금 7.65/team',
    mutate: s => replaceOnce(s, 'fmt(start, 2) === fmt(nowValue, 2)', 'fmt(start, 2) !== fmt(nowValue, 2)') },
  { name: 'N2 이하를 미만·문턱 올림을 반올림으로 복귀', harness: '40-v5-s7.js', regression: 'V8 N2 grid/고르기 건너뜀 무작위·경계',
    mutate: s => removeThresholdCeiling(s).replaceAll(' 이하라', ' 미만이라').replaceAll(' 이하)</p>', ' 미만)</p>') },
  { name: 'N6 지난달 값 없는 후보를 세 장까지 채움으로 복귀', harness: '41-v5-s1.js', regression: 'V8 N6 두 장이면 지난달 값 없는 세 번째는 채우지 않음/team',
    mutate: s => replaceOnce(s, 'if (!Number.isFinite(item.before)) { missing.push(item); continue; }', '') },
  { name: '문구 14 꼬리말 길이 조건 제거', harness: '40-v5-s7.js', regression: 'V8 문구 14 꼬리말 71자 경계',
    mutate: s => replaceOnce(s, 'const short = withTail.length <= 70 ? withTail : body;', 'const short = withTail;') },

  { name: '풍력 조건 제거', harness: '41-v5-s1.js', regression: '계약 1·3·5 풍력 없으면',
    mutate: s => replaceOnce(s, 'const options = allOptions.filter(x => x.key !== "wind" || hasWind);', 'const options = allOptions;') },
  { name: 'LNG 조건 제거', harness: '41-v5-s1.js', regression: '계약 4 uns/outageFrozen/growth 미만/현금 0',
    mutate: s => replaceOnce(s, 'const includeFuel = growthCandidate || V.econ.cities[L.team].cash < 0 ||', 'const includeFuel = true ||') }, // spec-A §A3: D-91 조건이 더해진 HEAD에서도 기존 LNG 조건 제거 변이 유지.
  { name: '5단계를 고정 순서로 복귀', harness: '41-v5-s1.js', regression: '계약 5 남은 자리 변화율 순서가 고정 순서와 다름',
    mutate: s => replaceOnce(s,
      'const remaining = [...changed, ...options.filter(x => !Number.isFinite(x.before))];', 'const remaining = options;') },
  { name: '5단계 변화 0·연결 없음 건너뛰기 제거', harness: '41-v5-s1.js', regression: 'V7 G a 변화 0·연결 없음인 세 번째 후보 제외',
    mutate: s => replaceOnce(s,
      'if (noVisibleChange(item)) { skipped.push(item); continue; }', '') },
  { name: '보이는 변화 0 판정을 delta === 0만으로 복귀', harness: '41-v5-s1.js', regression: 'V7 보이는 변화 경계 변화율 +0.004%/남은 자리/team',
    mutate: s => replaceOnce(s,
      'const noVisibleChange = x => x.delta === 0 || Number((x.key === "neighbor" ? x.delta : x.ratio === null ? x.value : x.ratio * 100).toFixed(2)) === 0;',
      'const noVisibleChange = x => x.delta === 0;') },
  { name: '5단계 최소 두 장 보충 제거', harness: '41-v5-s1.js', regression: 'V7 G b 하나만 남으면 건너뛴 순서로 한 장 보충',
    mutate: s => replaceOnce(s,
      'for (const item of [...skipped, ...missing]) {\n      if (picked.size >= 2) break;\n      add(item, changeTag(item));\n    }', '') },
  { name: '같음 문장을 접속 대기 상자 뒤로 이동', harness: '40-v5-s7.js', regression: '22 S7 첫 줄 uns/같음·예측은 늘 것',
    mutate: s => replaceOnce(replaceOnce(s,
      '${subject} 변화의 원인 하나</h4>${same}', '${subject} 변화의 원인 하나</h4>'),
      '${comparisonNote}${gridBox}', '${comparisonNote}${gridBox}${same}') },
  { name: '약속 있는 달 같음 조건을 늘 참으로', harness: '40-v5-s7.js', regression: '22 S7 첫 줄 grid/늘 달·예측은 같을 것',
    mutate: s => replaceOnce(s, 'const same = comparison?.actual === "same"', 'const same = !!comparison') },
  { name: 'share를 0으로', harness: '40-v5-s7.js', regression: 'V7 A 4% 제외·6% 포함 trial/uns/1/fallback=false',
    mutate: s => s,
    mutateData: s => replaceOnce(s, 'outageCardShareMin: p(.05, G,', 'outageCardShareMin: p(0, G,') },
  { name: '카드 후보에만 minPart 사용', harness: '40-v5-s7.js', regression: 'V7 A 4% 제외·6% 포함 trial/uns/1/fallback=false',
    mutate: s => replaceOnce(s,
      'const outageCardCandidates = (parts, a) => [...parts].filter(p => Math.abs(p.value) >= outageCardMin(a))',
      'const outageCardCandidates = (parts, a) => [...parts].filter(p => Math.abs(p.value) >= outageMinPart(a))') },
  { name: '접속 대기 상자에 cardMin 사용', harness: '40-v5-s7.js', regression: 'V7 A 접속 상자는 minPart trial/uns/4',
    mutate: s => replaceOnce(s, 'Math.abs(a.grid.value) >= outageMinPart(a)', 'Math.abs(a.grid.value) >= outageCardMin(a)') },
  { name: 's1HasWind 무시', harness: '41-v5-s1.js', regression: 'V7 C team/wind/grid 시작 메모 저장',
    mutate: s => replaceOnce(s,
      'const hasWind = typeof n?.s1HasWind === "boolean" ? n.s1HasWind : (BG.current().builds || []).some(b => ["wind", "offshore"].includes(b.t));',
      'const hasWind = (BG.current().builds || []).some(b => ["wind", "offshore"].includes(b.t));') },
  { name: 's1Pick 보존 제거', harness: '41-v5-s1.js', regression: 'V7 C 옛 s1Pick 보존/team/wind',
    mutate: s => replaceOnce(s, 'if (selected && !picked.has(selected.key)) {', 'if (false && selected && !picked.has(selected.key)) {') },
  { name: '같음 주어를 1차 문구로', harness: '40-v5-s7.js', regression: 'V7 D 첫 달 시험 1주/grid',
    mutate: s => replaceOnce(s,
      '실제로는 ${comparison.topic === "grid" ? "바깥 계통에 기댄 전기가" : "정전이"} ${esc(withParticle(comparison.comparison.label.replace(/ 대비$/, ""), "과와"))} 거의 같았어요(판정: 같음).',
      '실제로는 거의 변하지 않았어요(같음).') },
  { name: '같음 조사를 늘 과로', harness: '40-v5-s7.js', regression: 'V7 D 첫 달 시험 1주/uns',
    mutate: s => replaceOnce(s,
      '${esc(withParticle(comparison.comparison.label.replace(/ 대비$/, ""), "과와"))}',
      '${esc(comparison.comparison.label.replace(/ 대비$/, ""))}과') },
  { name: '계통 고정본 선택을 원본 객체 동일성만으로 판정', harness: '40-v5-s7.js', regression: 'V7 A 고정본 4% 선택 보존 trial/grid',
    mutate: s => replaceOnce(s,
      'const frozenPicked = !!a && (a === n.outageFrozen || !!n.outageFrozen && OUTAGE_CLUE_SOURCE.get(a) === n.outageFrozen) && !!selected;',
      'const frozenPicked = a === n.outageFrozen && !!selected;') },
  { name: 'S1 원인 없음의 지난달 연결 제외 제거', harness: '41-v5-s1.js', regression: 'V7 E weather 원인 없음 연결 제외 trial/uns/1/outageLargest/team',
    mutate: s => replaceOnce(s,
      'const largest = old && outageNoCause(old) ? null : old?.outageLargest || old?.missedCarry?.largest;',
      'const largest = old?.outageLargest || old?.missedCarry?.largest;') },
  { name: 'S1 LNG 고정본 parts 방어 제거', harness: '41-v5-s1.js', regression: 'V7 F parts 없는 고정본/uns/team/현금 0/축약 growth false',
    mutate: s => replaceOnce(s,
      'const growthCandidate = frozen ? !!frozen.parts && outageCardCandidates(frozen.parts, frozen).some(p => p.key === "growth") :',
      'const growthCandidate = frozen ? outageCardCandidates(frozen.parts, frozen).some(p => p.key === "growth") :') }
];
function run(harness, file, dataFile) {
  const result = spawnSync(process.execPath, [path.join(__dirname, harness), file, ...(dataFile ? [dataFile] : [])],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /SyntaxError|ReferenceError|TypeError|BLOCKED/, '문법·하네스 오류를 변이 탐지로 세지 않음');
  assert.ok([0, 1].includes(result.status), `정상적인 단언 종료: ${result.status}`);
  return { status: result.status, failures: output.split('\n').filter(line => line.startsWith('FAIL ')) };
}
let detected = 0;
try {
  // 원본에서 이미 실패하는 단언은 탐지 증거가 아니다. 같은 회귀 단언이 새로 실패해야 한다.
  const baseline = new Map();
  for (const harness of new Set(cases.map(x => x.harness))) {
    const result = run(harness, implementation);
    baseline.set(harness, result);
    console.log(`BASELINE ${harness}: ${result.failures.length} failing cases`);
  }
  for (const [i, item] of cases.entries()) {
    assert.ok(!baseline.get(item.harness).failures.some(line => line.includes(item.regression)),
      `${item.name}: 표적 단언은 원본에서 통과해야 함`);
    const file = path.join(temporary, `mutation-${i}.js`);
    fs.writeFileSync(file, item.mutate(source));
    const dataFile = item.mutateData ? path.join(temporary, `econ-data-${i}.js`) : null;
    if (dataFile) fs.writeFileSync(dataFile, item.mutateData(dataSource));
    const result = run(item.harness, file, dataFile);
    assert.equal(result.status, 1, `${item.name}: 검사가 실패해야 함`);
    const target = result.failures.find(line => line.includes(item.regression));
    assert.ok(target, `${item.name}: 지정한 계약 단언에서 새 실패가 있어야 함\n${result.failures.join('\n')}`);
    detected++;
    console.log(`DETECTED ${item.name}: ${result.failures.length} failing cases; ${target}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  assert.deepEqual(fs.readFileSync(implementation), original, '원래 구현 diff의 바이트 보존');
  assert.deepEqual(fs.readFileSync(econData), originalData, '원래 파라미터 diff의 바이트 보존');
}
console.log(`S1/S7 mutations: ${detected}/${cases.length} detected; implementation unchanged; temporary copies removed`);
