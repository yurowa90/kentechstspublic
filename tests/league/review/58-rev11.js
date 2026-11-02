'use strict';
// 기대값 근거: (비공개 작업 지시서) 및 rev11-testfix1 총괄 결정.
// 실행: node tests/league/review/58-rev11.js. 브라우저·네트워크·원본 수정 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(ROOT, 'ui', name + '.js'), 'utf8');
const sources = Object.fromEntries(['league', 'build', 'fx-end', 'fx-turn'].map(n => [n, read(n)]));
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
}

// R5: 주석/정규식은 문구가 아니다. 문자열과 중첩 템플릿만 수집한다.
// 치환식은 하나의 숫자 자리표시로 축약하고 안쪽 문자열도 별도 검사한다.
function literals(source) {
  const rows = []; let i = 0;
  function quoted() {
    const start = i, quote = source[i++]; let value = '', labelled = '';
    while (i < source.length) {
      const c = source[i++];
      if (c === '\\') { const escaped = source[i++] || ''; value += escaped; labelled += escaped; continue; }
      if (c === quote) break;
      if (quote === '`' && c === '$' && source[i] === '{') {
        i++; const expressionStart = i; code(true); value += '${…}';
        // R5: 종류를 두 문자열로 고르는 템플릿은 양쪽 모두 종류가 있을 때만 인정.
        // 조건의 계산/분기 결과는 읽지 않는다. 한쪽이 빈 문자열이면 그대로 실패한다.
        const expression = source.slice(expressionStart, i - 1);
        const branches = expression.match(/^.*\?\s*(["'])([^"']*)\1\s*:\s*(["'])([^"']*)\3\s*$/s);
        labelled += branches && /생산|소비/.test(branches[2]) && /생산|소비/.test(branches[4])
          ? branches[2] : '${…}';
      } else { value += c; labelled += c; }
    }
    rows.push({ value, labelled, start, end: i });
  }
  function code(expression = false) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i], n = source[i + 1];
      if ('\'"`'.includes(c)) { quoted(); continue; }
      if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i = source.indexOf('*/', i + 2); i = i < 0 ? source.length : i + 2; continue; }
      // 정규식 안 따옴표/역따옴표를 문자열 시작으로 오인하지 않는다.
      if (c === '/' && /[=(,:!&|?;{\[]$/.test(source.slice(0, i).trimEnd())) {
        i++; let bracket = false;
        while (i < source.length) {
          const r = source[i++];
          if (r === '\\') { i++; continue; }
          if (r === '[') bracket = true;
          if (r === ']') bracket = false;
          if (r === '/' && !bracket) break;
        }
        continue;
      }
      if (expression && c === '{') depth++;
      if (expression && c === '}') { i++; if (depth-- === 0) return; continue; }
      i++;
    }
  }
  code(); return rows;
}
const strings = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, literals(source)]));
const plain = text => text.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|le|ge);/g, ' ').replace(/\s+/g, ' ');

// R5 허용 목록: 총량의 생산/소비와 다른 정의만 허용한다. 줄 번호 대신 좁은 문구를 쓴다.
const ALLOW = [
  { file: 'league', pattern: /^바이오 CO₂ \$\{…\} t\(국가 총량 밖 · IPCC 정보 항목\)$/, reason: '바이오 배출은 국가 총량 밖 별도 IPCC 정보 항목이다.' },
  { file: 'league', pattern: /CO₂\(공급 1MWh당, 지연 평균\) \$\{…\} t\/MWh/, reason: '공급 전력당 배출 집약도이며 배출 총량이 아니다.' },
  { file: 'league', pattern: /^첫 달 목표\(계획 시작 때 확정\) · CO₂ ≤ \$\{…\} t · 기준:/, reason: 'R5가 명시적으로 유지하는 계획 시작 때 확정한 목표다.' },
  { file: 'league', pattern: /^이번 달 CO₂ 목표 ≤ \$\{…\} t · 계획 시작 때 확정/, reason: 'R5가 허용한 월 목표 칩 문구다.' },
  { file: 'league', pattern: /aria-label="CO₂ 목표와 \$\{…\}"/, reason: 'R5 목표 칩의 목표/실적 비교이며 도시 배출 카드가 아니다.' },
  { file: 'build', pattern: /CO₂ \$\{…\} t\/MWh/, reason: '설비/수입 전력의 단위 전력당 배출 계수다. t 총량과 구분한다.' },
  { file: 'build', pattern: /CO₂ \$\{…\}\) · 바이오매스/, reason: '설비 제원의 디젤 배출 계수와 바이오 총량 제외 설명이다.' },
  { file: 'league', pattern: /^석탄 CO₂ ×\$\{…\}, 출력 ×\$\{…\}$/, reason: 'CCU 기술의 배출/출력 배율이며 질량 t로 표시하는 배출 총량이 아니다.' },
  { file: 'build', pattern: /CO₂ 총량에는 \$\{…\}, 바이오 배출 \$\{…\} t\/MWh는 별도 정보/, reason: '바이오매스 제원의 총량 산입 계수와 t/MWh 별도 정보 계수다.' },
];
console.log(`R5 허용 목록 크기 ${ALLOW.length}`);
ALLOW.forEach((entry, i) => console.log(`ALLOW ${i + 1} ${entry.file}: ${entry.pattern} — ${entry.reason}`));

function unnamed(file, rows, source) {
  const bad = [];
  for (const row of rows) {
    const value = plain(row.labelled ?? row.value);
    for (const match of value.matchAll(/CO₂/g)) {
      const at = match.index, after = value.slice(at + 3);
      const nearby = value.slice(Math.max(0, at - 12), at + 3 + 12);
      // 숫자 자리 바로 앞 표지, 또는 가까운 숫자 뒤 질량 t와 결합된 표지.
      // it/cell/cmp/bar/지표 배열처럼 표지와 수치가 별도 인자인 경우도 확인한다.
      const tail = source.slice(row.end, row.end + 220);
      const splitLabel = /^CO₂$/.test(value) && /^\s*,/.test(tail) && /["']\s*t(?:\/일)?["']/.test(tail);
      const numeric = /^(?:[\s:≤≥×()+/·]|생산|소비|계통 포함|기준|이번 달|운영)*\$\{…\}/.test(after) ||
        /^[^.!?。]{0,90}?\$\{…\}\s*t(?:\b|\/)/.test(after) || splitLabel;
      if (!numeric || /생산|소비/.test(nearby)) continue;
      // 한 큰 템플릿에 계수와 총량이 함께 있어도 그 예외 구간의 CO₂만 허용한다.
      if (ALLOW.some(e => e.file === file && [...value.matchAll(new RegExp(e.pattern.source, 'g'))]
        .some(m => at >= m.index && at < m.index + m[0].length))) continue;
      const line = source.slice(0, row.start).split('\n').length;
      bad.push(`ui/${file}.js:${line}: ${value.slice(Math.max(0, at - 18), at + 100)}`);
    }
  }
  return bad;
}
// 검사 자체의 회귀: HTML/중첩 템플릿/분리 인자와 예외의 좁은 범위.
for (const [source, count] of [
  ['const x=`CO₂ ${fmt(n)} t`;', 1],
  ['const x=`CO₂ <b>${fmt(n)} t</b>`;', 1],
  ['const x=`CO₂ 소비(계통 포함) ${fmt(n)} t`;', 0],
  ['const x=`CO₂ 생산 ${fmt(n)} t`;', 0],
  ['const x=it("CO₂", fmt(n)+" t");', 1],
  ['// `CO₂ ${n} t`\nconst x="사건 CO₂";', 0],
  ['const x=`${yes ? `CO₂ ${n} t` : ""}`;', 1],
  ['const x=`CO₂ ${LG ? "생산" : "소비(계통 포함)"} ${n} t`;', 0],
  ['const x=`CO₂ ${LG ? "생산" : ""} ${n} t`;', 1],
  ['const x=`계수 CO₂ ${coef} t/MWh · CO₂ ${total} t`;', 1],
  ['const x=`석탄 CO₂ ×${factor}, 출력 ×${output}`;', 1], // build에는 CCU 예외가 없다.
]) test(`R5 훑기 자체검사 ${source}`, () => assert.equal(unnamed('build', literals(source), source).length, count));

// R5: 명세에 열거된 옛 표기는 원문에서 금지한다(공백/옵셔널 체인 차이도 잡는다).
const old = [
  ['league', /CO₂\(t\/월\)/, '장부 열 머리'],
  ['league', /CO₂ \$\{fmt\(e\.m\??\.co2\)\} t/, '활동지 건설 일지'],
  ['build', /CO₂가 \$\{[^}]+\} t 나왔는데/, 'C5 질문'],
  ['build', /CO₂ \$\{fmt\(R\.res\.co2\)\} t/, 'C6 낭독'],
  ['build', /CO₂ \$\{fmt\(e\.m\.co2\)\} t/, 'metricLine'],
  ['build', /it\(["']CO₂["']\s*,/, 'jStrip'],
  ['build', /CO₂ <b/, '일지 카드'],
  ['build', /cmp\([^\n]+["']CO₂["']\s*,/, '일지 비교'],
  ['fx-end', /\[\s*["']co2["']\s*,\s*["']CO₂["']\s*,\s*["'] t\/일["']\s*\]/, '끝 추이 지표'],
];
for (const [file, pattern, label] of old) test(`R5 옛 이름 없음 ${file}/${label}`, () => assert.doesNotMatch(sources[file], pattern));
for (const [file, text] of [['league', 'CO₂ 생산(t/월)'], ['league', 'CO₂ 소비(계통 포함)'],
  ['build', 'CO₂ 소비(계통 포함)'], ['fx-end', 'CO₂ 생산']])
  test(`R5 새 이름 ${file}/${text}`, () => assert.ok(sources[file].includes(text)));
for (const [file, pattern, label] of [
  ['league', /CO₂ 소비\(계통 포함\) \$\{fmt\(e\.m\??\.co2\)\} t/, '활동지 건설 일지'],
  ['build', /(?:const|function) metricLine\b[^\n]*CO₂ 소비\(계통 포함\)/, 'metricLine'],
  ['build', /it\(["']CO₂ 소비\(계통 포함\)["']\s*,/, 'jStrip'],
  ['build', /CO₂ 소비\(계통 포함\) <b[^>]*>\$\{fmt\(e\.m\.co2\)\} t/, '일지 카드'],
  ['build', /cmp\(e\.m\.co2,\s*p\.m\.co2,\s*["']CO₂ 소비\(계통 포함\)["']/, '일지 비교'],
]) test(`R5 자리별 새 이름 ${file}/${label}`, () => assert.match(sources[file], pattern));
test('R5 장부 셀 data-label도 CO₂ 생산', () => assert.match(sources.league,
  /(?:cell\(["']CO₂ 생산["']|data-label=["']CO₂ 생산["'])/));
for (const file of ['league', 'build', 'fx-end']) {
  test(`R5 ${file} 같은 개념 같은 낱말`, () => {
    const bad = unnamed(file, strings[file], sources[file]);
    assert.equal(bad.length, 0, '\n' + bad.join('\n'));
  });
  test(`R5 ${file} 생산/소비 표기 순서 통일`, () => {
    const bad = strings[file].filter(r => /생산 CO₂|소비 CO₂|CO₂ 소비 기준/.test(r.value));
    assert.equal(bad.length, 0, bad.map(r => r.value.slice(0, 180)).join('\n'));
  });
}

// REV11_COPY: 명세 표와 총괄 결정. C2a는 삭제하고 실제 단추의 aria-label 부재를 검사한다.
const COPY = {
  C1v: '코치 닫기', C1a: '첫 달 코치 닫기', C2v: '사건 닫기',
  C3: "기존 {설비}도 전선에 안 닿으면 운영에서 못 써요. {설비} 칸, {마을} 칸을 차례로 누르고 '연결'을 눌러야 넘어가요.",
  // rev12: 키·치환 계약 유지, 명세의 새 C4로 교체.
  C4: "이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.",
  C5: 'CO₂ 소비(계통 포함)가 {n} t인데 탄소세를 고르지 않았습니다. 왜였나요?',
  C6: '{d}일 운영 끝. 정전 {h}시간, 총비용 {c}억, CO₂ 소비(계통 포함) {n} t.',
};
for (const [key, text] of Object.entries(COPY)) {
  const file = key === 'C2v' ? 'fx-turn' : ['C5', 'C6'].includes(key) ? 'build' : 'league';
  test(`REV11_COPY ${file}/${key} 글자 그대로`, () => {
    // build/fx-turn은 동일 글자의 로컬 상수 또는 실제 JS 템플릿 모두 허용한다.
    const template = text.replace(/\{[^}]+\}/g, '${…}');
    assert.ok(strings[file].some(r => r.value === text || r.value === template), text);
  });
}
test('R2 사건 닫기 단추는 보이는 글자를 이름으로 쓰고 aria-label 없음', () => {
  // 기존 생성 구간을 최소 DOM으로 실행해 상수의 존재만으로 통과하지 않게 한다.
  const block = sources['fx-turn'].match(/const close = node\("button", "fx-turn-close",[^]*?(?=const row = node\()/);
  assert.ok(block, '.fx-turn-close 생성 구간 없음');
  const copy = sources['fx-turn'].match(/const REV11_COPY\s*=\s*\{[^]*?\};/)?.[0] || '';
  let button;
  vm.runInNewContext(copy + '\n' + block[0], { closeCards() {}, deck: { append() {} },
    node(tag, className, textContent) {
      button = { tag, className, textContent, attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, String(value)); }, addEventListener() {} };
      return button;
    } });
  assert.equal(button.textContent, '사건 닫기');
  assert.equal(button.attributes.has('aria-label'), false, '.fx-turn-close aria-label 없어야 함');
});
test('REV11_COPY 표와 접근 함수 존재', () => {
  assert.match(sources.league, /\bREV11_COPY\b/); assert.match(sources.league, /\brev11Copy\b/);
});
for (const text of ['살펴봐요. 이번 달', '도 이어야 넘어가요.'])
  test(`REV11_COPY 옛 문장 없음 ${text}`, () => assert.ok(!sources.league.includes(text)));

// R6: 39/57번 review와 같은 VM 로딩. UI 코드 본문/출력은 기대값 작성에 쓰지 않는다.
const storage = new Map();
const memory = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
const ctx = vm.createContext({ console, performance, structuredClone, URL,
  document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [] },
  addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
  localStorage: memory, sessionStorage: memory,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  KCP: { route() {}, on() {}, esc: String, gradeWords: String, leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
let bootError;
try {
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league'])
    vm.runInContext(sources[name] ?? read(name), ctx, { filename: `ui/${name}.js`, timeout: 10000 });
} catch (error) { bootError = error; }
test('R6 league VM 초기화', () => assert.ifError(bootError));
const calcDigits = ctx.KCP.league?.calcDigits;
test('R6 KCP.league.calcDigits 공개 함수 있음', () => assert.equal(typeof calcDigits, 'function', '함수 없음: KCP.league.calcDigits'));
function checkDigits(delta, tol, base, want) {
  assert.equal(typeof calcDigits, 'function', '함수 없음: KCP.league.calcDigits');
  const actual = calcDigits(delta, tol, base);
  assert.equal(actual, want, `delta=${delta}, tol=${tol}, base=${base}`);
  assert.ok(Number.isInteger(actual) && actual >= base && actual <= 4);
  assert.equal(calcDigits(delta, tol, base), actual, '같은 입력은 같은 자릿수');
  if (Math.abs(delta) === tol) assert.equal(actual, base, '실제 경계는 기본 자릿수 유지');
  else if (actual < 4) assert.notEqual(displayMagnitude(delta, actual), displayMagnitude(tol, actual), '표시 글자 구별');
}
// 총괄 R6: 부호 있는 표시를 먼저 반올림한다. abs를 먼저 취하면 −0.505의 반값 충돌을 놓친다.
function displayMagnitude(value, digits) {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Math.abs(rounded).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
for (const [delta, tol, base, want] of [[.4951, .5, 2, 3], [.5, .5, 2, 2], [.3, .5, 2, 2]])
  test(`R6 명세 예시 ${delta}/${tol}/${base} → ${want}`, () => checkDigits(delta, tol, base, want));
test('R6 현금 음수 반값 −0.505 / ±0.5는 표시 충돌을 풀어 3자리 이상', () => {
  assert.equal(displayMagnitude(-.505, 2), displayMagnitude(.5, 2), '기본 두 자리 표시가 같음');
  checkDigits(-.505, .5, 2, 3);
});
// 예시의 표시 글자도 독립 확인(반환 계약은 자릿수 정수).
test('R6 예시 표시 +0.495 / ±0.500', () => {
  assert.equal(typeof calcDigits, 'function', '함수 없음: KCP.league.calcDigits');
  const d = calcDigits(.4951, .5, 2);
  assert.equal('+' + (.4951).toFixed(d), '+0.495'); assert.equal('±' + (.5).toFixed(d), '±0.500');
});
// R6: 고정 씨앗, 양/음 Δ, 위/아래 경계, 정전(base 2)/현금(base 0·1·2), 4자리 상한.
let seed = 0x11c0ffee, equal = 0, below = 0, above = 0, capped = 0;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let i = 0; i < 2000; i++) {
  const base = i % 2 ? 2 : i % 3, quantum = 10 ** -base;
  const tol = (1 + Math.floor(random() * 900)) * quantum;
  const exact = i % 4 === 0, direction = i % 4 === 1 ? -1 : 1;
  const epsilon = quantum * (i % 7 === 0 ? .000001 : .01 + random() * .45);
  const absolute = exact ? tol : tol + direction * epsilon;
  const delta = (random() < .5 ? -1 : 1) * absolute;
  let want = base;
  // 명세의 최소 자릿수 조건을 표시 글자로 독립 계산한다(판정 로직 호출 없음).
  while (want < 4 && absolute !== tol && displayMagnitude(delta, want) === displayMagnitude(tol, want)) want++;
  if (exact) equal++; else if (absolute < tol) below++; else above++;
  if (want === 4) capped++;
  test(`R6 경계 무작위 ${i + 1}`, () => {
    assert.ok(exact || displayMagnitude(delta, base) === displayMagnitude(tol, base), '경계 fixture는 기본 표시가 같아야 함');
    checkDigits(delta, tol, base, want);
  });
}
console.log(`R6 무작위 2000건: 실제 같음 ${equal}, 아래 ${below}, 위 ${above}, 최대4자리 ${capped}`);

// R7: 기준판의 값/등급만 비교한다. note 내용의 기대값은 현재 구현에서 복제하지 않는다.
function economicData(source) {
  const context = vm.createContext({ window: { KCP: {} } });
  // 41번 review와 같은 선행 기술 자료: thermalFacts의 공개 text getter도 이를 참조한다.
  vm.runInContext(read('tech-data'), context, { timeout: 10000 });
  vm.runInContext(source, context, { timeout: 10000 });
  return structuredClone(context.window.KCP.ECON_DATA);
}
let before, after, dataError;
try {
  before = economicData(execFileSync('git', ['show', '2f0ff02:ui/econ-data.js'], { cwd: ROOT, encoding: 'utf8' }));
  after = economicData(read('econ-data'));
} catch (error) { dataError = error; }
test('R7 기준판 2f0ff02와 작업판 자료 로딩', () => assert.ifError(dataError));
for (const key of ['coalBuild', 'lngBuild']) {
  test(`R7 thermalFacts.${key} note 비어 있지 않음`, () => {
    assert.ifError(dataError);
    assert.ok(typeof after.params.thermalMW.note === 'string' && after.params.thermalMW.note.trim(), 'thermalMW.note 기준 필드');
    assert.ok(typeof after.thermalFacts[key].note === 'string' && after.thermalFacts[key].note.trim(), '같은 이름 note 필수');
  });
  test(`R7 thermalFacts.${key} 기준판 값·등급 불변`, () => {
    assert.ifError(dataError);
    const { note: oldNote, ...oldFact } = before.thermalFacts[key];
    const { note: newNote, ...newFact } = after.thermalFacts[key];
    assert.deepEqual(newFact, oldFact, 'note 외 필드 불변(값·등급 포함)');
  });
}
console.log(`assertions ${assertions} passes ${assertions - failures} failures ${failures}`);
process.exitCode = failures ? 1 : 0;
