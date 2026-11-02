'use strict';
// 기대값의 유일한 근거: rev16/spec.md 문구 표 및 #55·#64·#66.
const COPY = {
  R1: '바깥 계통이 전기를 메워 주지 않아요. 필요한 전기는 내 도시 발전과 이웃 연계선으로만 대야 해요. 돌아가는 발전 설비가 없으면 정전이 100%가 될 수 있어요(게임 가정).',
  R2: '지난달까지 지도에서 새로 짓거나 고친 것이 없어 지난달 운영 조건을 따로 남기지 않았어요. 그래서 이번 달은 지난달과의 차이를 원인별로 나누지 않아요.',
  R3: '시험·실제', R4: '정책·시험 결과', R5: '시험 결과', R6: '민원·전력망·시험·실제 렌즈',
  R7a: '{n}라운드 실제', R7b: '지난 라운드({n}라운드) 실제',
  R8a: '{n}월 결산', R8b: '{n}라운드 결산'
};
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { read } = require('./rev14b-vm.cjs');
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); } catch (e) {
    failures++;
    const values = Object.hasOwn(e, 'actual') ? ` actual=${JSON.stringify(e.actual)} expected=${JSON.stringify(e.expected)}` : '';
    console.log(`${e.message.includes('BLOCKED') ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message.split('\n')[0]}${values}`);
  }
}
let ctx;
test('실제 파일 VM 적재(build.js 포함)', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  ctx = vm.createContext({ console, performance, structuredClone, URL,
    document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame() {},
    localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    KCP: { route() {}, on() {}, esc: String, gradeWords: String, leagueNet: { expandSnapshot: x => x } }
  });
  ctx.window = ctx;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ',
    'league-data', 'league-core', 'league', 'fx-end'])
    vm.runInContext(read(name), ctx, { filename: `ui/${name}.js`, timeout: 10000 });
});
// 비공개 함수에 우회 연결하지 않는다. 명세의 공개 API가 없으면 개별 단언을 BLOCKED로 기록한다.
const call = (name, ...args) => {
  const fn = ctx?.KCP?.league?.uiMath?.[name];
  assert.equal(typeof fn, 'function', `BLOCKED 공개 uiMath.${name} 없음`);
  return fn(...args);
};
for (const name of ['gridLevelText', 'perDayText', 'gridDigitsFor', 'outageDigits', 'outageValue', 'outageMissingReason'])
  test(`공개 ${name}`, () => assert.equal(typeof ctx?.KCP?.league?.uiMath?.[name], 'function', `BLOCKED 공개 ${name} 없음`));

// #55-2: Δ 자릿수 경계(기준 2 미만/이상)와 S7 고정 소수·천 단위 형식.
// 기대 문자열은 Intl의 ko-KR 고정 자릿수로 독립 생성한다. 실제 함수끼리의 일치만으로 통과시키지 않는다.
const rows = [
  [0, 1.234, 2], [1.999999, 1.234, 2], [2, 1.234, 1], [125, 12345.678, 1],
  [1.5, .05, 2], [2, .05, 1], [0, 0, 2], [1.5, .049999, 2],
  [2, .049999, 1], [1.5, 1000, 2], [2, 1000, 1]
];
for (const [base, x, d] of rows) for (const source of ['shown', 'fallback']) {
  const grid = { perDay: x, base: { perDay: base + (source === 'shown' ? 10 : 0) },
    ...(source === 'shown' ? { shownBasePerDay: base } : {}) };
  const expected = x < .05 ? '0.1 MWh/일 미만' :
    `${x.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })} MWh/일`;
  const label = `#55 ${source} base=${base} actual=${x}`;
  test(label + ' Δ 자릿수', () => {
    assert.equal(call('gridDigitsFor', base), d);
    assert.equal(call('outageDigits', { target: 'grid', unit: 'MWh/일', trial: grid.shownBasePerDay ?? grid.base.perDay }), d);
  });
  test(label + ' 수준값 독립 문자열', () => assert.equal(call('gridLevelText', grid), expected));
  // #55-3: 0.05 미만은 별도 상한 문구이므로 S7 숫자 형식과 같다는 단언에서 제외한다.
  if (x >= .05) test(label + ' S7 실제 끝과 동일', () => {
    assert.equal(call('outageValue', x, 'MWh/일', false, d), expected);
    assert.equal(call('gridLevelText', grid), call('outageValue', x, 'MWh/일', false, d));
  });
}
// #55-3: 계획 카드/시험 노트용 perDayText의 기본 1자리 계약은 유지.
for (const [x, expected] of [[0, '0.1 MWh/일 미만'], [.049, '0.1 MWh/일 미만'],
  [.05, '0.1 MWh/일'], [1.234, '1.2 MWh/일'], [12345.678, '12,345.7 MWh/일']])
  test(`#55 기존 perDayText(${x})`, () => assert.equal(call('perDayText', x), expected));

// #66-1: (가) null/undefined, (나) 세 빈 배열, (다) 그 외의 사본 유실.
const empty = () => ({ builds: [], lines: [], policies: [] });
for (const [label, input, expected] of [
  ['null', { teamPlan: null }, 'empty'], ['undefined', {}, 'empty'],
  ['빈 운영 계획', { teamPlan: { builds: [{ t: 'solar', i: 1 }] }, prevOperatingPlan: empty() }, 'empty'],
  ['현재 빈 배열만으로 empty 아님', { teamPlan: empty() }, 'device'],
  ['이전 계획 없음', { teamPlan: { builds: [{ t: 'solar', i: 1 }] } }, 'device'],
  ['이전 builds', { teamPlan: {}, prevOperatingPlan: { ...empty(), builds: [{ t: 'solar', i: 1 }] } }, 'device'],
  ['이전 lines', { teamPlan: {}, prevOperatingPlan: { ...empty(), lines: [{ p: [1, 2] }] } }, 'device'],
  ['이전 policies', { teamPlan: {}, prevOperatingPlan: { ...empty(), policies: ['save'] } }, 'device'],
  // 명세 #66-1(나) 정정(문구 사실 검토): 연구 대기열(rq)만 바꾼 계획은 빈 계획이 아니다. rq 빈 배열은 empty.
  ['이전 rq만', { teamPlan: {}, prevOperatingPlan: { ...empty(), rq: ['bms'] } }, 'device'],
  ['이전 rq 빈 배열', { teamPlan: {}, prevOperatingPlan: { ...empty(), rq: [] } }, 'empty']
]) test('#66 ' + label, () => {
  const before = JSON.stringify(input);
  assert.equal(call('outageMissingReason', input), expected);
  assert.equal(JSON.stringify(input), before, '입력 불변');
});

// #64: 계절 카드가 자연 발생하지 않는 실행에서도 R8b가 실제 tag 생성 경로에 연결됐는지 정적 확인.
// 소스는 공개 문구 키/호출 연결 확인에만 사용한다. 기대 문구는 COPY에서만 읽는다.
test('#64 계절 결산 문구·tag 연결(브라우저 장면 부재 대안)', () => {
  const src = read('league'), match = src.match(/const\s+REV16_COPY\s*=\s*(\{[\s\S]*?\n\s*\});/);
  assert.ok(match, 'BLOCKED REV16_COPY 문구 표 없음');
  const table = vm.runInNewContext('(' + match[1] + ')');
  assert.equal(table.R8b, COPY.R8b);
  assert.equal(table.R8a, COPY.R8a);
  assert.match(src, /tag\s*:[^\n]*(?:R8a|R8b)/, 'BLOCKED 결산 tag의 문구 키 연결을 확인할 수 없음');
  assert.ok((src.match(/R8b/g) || []).length >= 2, 'R8b 선언 외 사용 없음');
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode = failures ? 1 : 0;
