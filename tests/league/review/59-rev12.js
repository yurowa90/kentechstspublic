'use strict';
// 기대값 근거: rev12-fix/spec.md + 총괄 §3(모형 6회). e-audit 값은 VM의 엔진·자료에서 계산.
// 실행: node tests/league/review/59-rev12.js (브라우저·통신·원본 변경 없음).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(ROOT, 'ui', name + '.js'), 'utf8');
const sources = { league: read('league'), build: read('build') };
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
const COPY = {
  C4: "이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.",
  P1: '{기준}에도 정전이 컸어요.',
  K1v: '범례·여유', K1a: '범례·여유: 지도 범례와 접속 여유 보기',
  S1: '{설비}: {지형}만', A1: 'CO₂ 시험·소비, 시험 운전 소비 배출(계통 포함)',
};
for (const [key, text] of Object.entries(COPY)) test(`REV12_COPY ${key} 글자 그대로`, () => {
  const source = key === 'S1' ? sources.build : sources.league;
  assert.ok(source.includes(text), text);
});
test('REV12_COPY 표·접근 함수와 기존 C4 키 유지', () => {
  assert.match(sources.league, /\bREV12_COPY\b/);
  assert.match(sources.league, /\brev12Copy\b/);
  assert.match(sources.league, /\bREV11_COPY\b/);
  assert.match(sources.league, /\bC4\s*:/);
});
for (const [name, source] of Object.entries(sources)) {
  test(`REV12_COPY ${name} 옛 C4 없음`, () => assert.doesNotMatch(source, /있었으니 다음 달/));
  test(`REV12_COPY ${name} 확인하세요 없음`, () => assert.ok(!source.includes('확인하세요')));
}

// 58번 review의 실제 스크립트/의존 순서. VM의 DOM은 시작 화면을 그리지 않는다.
const storage = new Map();
const memory = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
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
} catch (e) { bootError = e; }
test('league VM 초기화', () => assert.ifError(bootError));
const league = ctx.KCP.league || {};
const hint = league.highOutageHintText;
test('E5-a 순수 함수 있음', () => assert.equal(typeof hint, 'function', '함수 없음: KCP.league.highOutageHintText'));
// 여덟 논리 조합을 모두 포함한다. monthly 두 값·unlinked 0/1/6의 고유 입력은
// 24개이며, 정확 문장과 순수성을 각각 검사해 48건이다.
for (const trialHigh of [false, true]) for (const smallDifference of [false, true])
  for (const monthly of [false, true]) for (const unlinked of [0, 1, 6]) {
    const input = { trialHigh, monthly, smallDifference, unlinked };
    test(`E5-a ${JSON.stringify(input)}`, () => {
      assert.equal(typeof hint, 'function', '함수 없음: KCP.league.highOutageHintText');
      const actual = hint(input), basis = monthly ? '지난달' : '시험';
      // (b)의 기준판 글자는 명세에 적힌 옛 조각만으로 구성한다.
      const tail = unlinked ? COPY.C4.replace('{n}', String(unlinked)) :
        '지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요';
      const prefix = unlinked ? (trialHigh ? `${basis}에도 정전이 컸어요. ` : '') :
        (trialHigh ? `${basis}에도 정전이 컸으니 ` : '') + (smallDifference ? '이번 달 변화보다 ' : '');
      assert.equal(actual, '. 정전 자체는 커요: ' + prefix + tail);
      if (unlinked) assert.doesNotMatch(actual, /이번 달 변화보다|있었으니|컸으니/);
      assert.doesNotMatch(actual, /\.\.|\.\s+\./, '마침표 중복 없음');
      // 호출자가 singleText.endsWith(".")로 붙일 마침표까지 합쳐서 확인.
      const singleText = '요약' + actual;
      assert.doesNotMatch(singleText + (singleText.endsWith('.') ? '' : '.'), /\.\.|\.\s+\./);
    });
    test(`E5-a 순수성 ${JSON.stringify(input)}`, () => {
      assert.equal(typeof hint, 'function', '함수 없음: KCP.league.highOutageHintText');
      const fresh = { trialHigh, monthly, smallDifference, unlinked };
      const before = structuredClone(fresh), first = hint(fresh);
      assert.deepEqual(fresh, before, '입력 변경 없음');
      assert.equal(hint(Object.freeze({ ...before })), first, '같은 입력은 같은 문장');
    });
  }
for (const monthly of [false, true]) test(`E5-a null은 0과 같은 문장 monthly=${monthly}`, () => {
  assert.equal(typeof hint, 'function', '함수 없음: KCP.league.highOutageHintText');
  const input = { trialHigh: true, smallDifference: true, monthly };
  assert.equal(hint({ ...input, unlinked: null }), hint({ ...input, unlinked: 0 }));
});

// E4: 비공개 함수를 같은 클로저 안에서 테스트용으로 노출. 파일은 고치지 않는다.
const calibration = sources.league.match(/^  function calibrationHTML\([^]*?^  }/m)?.[0];
test('E4 calibrationHTML 본문 있음·send 호출 없음', () => {
  assert.ok(calibration, 'calibrationHTML 함수 없음');
  assert.doesNotMatch(calibration, /\bsend\s*\(/);
});
let calibrationProbe, calibrationError;
try {
  const data = { interview: { months: { 1: { confidence: 'fairly', outcome: { hit: true } } } } };
  ctx.__rev12Session = { role: 'solo', room: 'REV12TEST', team: 'pyeongtaek', interview: data };
  storage.set('kcp-league-data-v1:REV12TEST:pyeongtaek', JSON.stringify(data));
  const marker = sources.league.lastIndexOf('})();');
  assert.ok(marker >= 0, 'IIFE 끝 확인 불가');
  const injected = sources.league.slice(0, marker) +
    '\nKCP.__rev12Calibration = (role,id) => { const old=L.role; try { L.role=role; return calibrationHTML(id); } finally { L.role=old; } };\n' +
    sources.league.slice(marker);
  // 기존 57번 review가 쓰는 세션 연결점만 바꾼다. 함수/역할 판정은 원본 그대로.
  assert.ok(injected.includes('let L = null;'), '기존 세션 연결점 없음');
  vm.runInContext(injected.replace('let L = null;', 'let L = globalThis.__rev12Session;'), ctx, { timeout: 10000 });
  calibrationProbe = ctx.KCP.__rev12Calibration;
  // 호출이 의존하는 기기 상태가 없으면 아래의 명세 허용 원문 검사로 간다.
  for (const role of ['host', 'solo', 'team', 'spectator']) calibrationProbe(role);
} catch (e) { calibrationError = e; }
if (!calibrationError && calibrationProbe) {
  for (const role of ['host', 'solo', 'team', 'spectator']) for (const id of ['lg-calibration','lg-final-calibration']) test(`E4 역할 ${role}/${id}`, () => {
    const html = calibrationProbe(role,id);
    if (role === 'solo' || role === 'team') {
      assert.ok(html.includes(id), 'solo·team 보정 내용 있어야 함');
      assert.ok(html.includes('내 확신 보정 · 기기에만'));
    } else assert.equal(html, '', 'host·기타 역할은 빈 문자열');
  });
} else {
  console.log(`INFO E4 VM 역할 호출 불가 → 원문 역할 가드 검사: ${calibrationError?.message}`);
  test('E4 원문 solo·team 허용, 나머지 빈 문자열', () => {
    assert.ok(calibration, 'calibrationHTML 함수 없음');
    assert.match(calibration, /if\s*\(\s*(?:L\.role\s*!==\s*["']solo["']\s*&&\s*L\.role\s*!==\s*["']team["']|!\s*\[\s*["']solo["']\s*,\s*["']team["']\s*\]\.includes\(L\.role\))\s*\)\s*return\s*["']["']\s*;/);
    assert.doesNotMatch(calibration, /if\s*\(L\.role\s*!==\s*["']solo["']\)\s*return/);
  });
}

// UX-E: 정렬 규칙·한글 이름은 명세에서 고정. B.ok는 입력 자료이며 기대 문구 함수는 호출하지 않는다.
const ORDER = ['plain', 'hill', 'forest', 'beach', 'urban', 'river', 'mount'];
const NAMES = { plain:'평지', hill:'언덕', forest:'숲', beach:'해안', urban:'도시', river:'하천', mount:'산 능선' };
const siteCopy = (name, keys) => `${name}: ${ORDER.filter(k => keys.includes(k)).map(k => NAMES[k]).join('·')}만`;
const examples = [
  ['diesel', '디젤', ['forest','plain','beach','hill'], '디젤: 평지·언덕·숲·해안만'],
  ['battery', '배터리', ['urban','beach','forest','hill','plain'], '배터리: 평지·언덕·숲·해안·도시만'],
  ['biomass', '바이오매스', ['forest','plain'], '바이오매스: 평지·숲만'],
];
for (const [, name, keys, want] of examples) test(`UX-E 명세 정렬 예 ${name}`, () => assert.equal(siteCopy(name, keys), want));
const bg = ctx.KCP.buildGame;
if (bg && typeof bg.siteRule === 'function') {
  test('UX-E build 공개 함수 준비', () => bg.selectPack('pyeongtaek', 'league'));
  for (const type of ['diesel','battery','biomass','wind','solar']) test(`UX-E 일반 분기 금지 지형 ${type}`, () => {
    const b = bg.BLD[type];
    assert.ok(b?.ok, `${type} 공개 BLD.ok 없음`);
    const keys = Array.isArray(b.ok) ? Array.from(b.ok) : Object.keys(b.ok);
    // 명세 UX-E는 앞 특수 분기를 유지한다. 산 능선·하천 등 특수 분기에 걸리지
    // 않는 합성 육지 지형을 B.ok 밖 입력으로 삼아 마지막 일반 분기만 검증한다.
    // 실제 도시 칸의 디젤 거절은 rev12.py에서 별도로 누른다.
    const forbidden = '__rev12_forbidden_land__';
    assert.ok(!keys.includes(forbidden), `${type} fixture 지형은 B.ok 밖이어야 함`);
    const seedTile = bg.TILES.find(t => !t.out && t.site < 0 && t.land);
    assert.ok(seedTile, '육지 칸 fixture 없음');
    const tile = { ...seedTile, t: forbidden, land: true, site: -1, out: false };
    const want = examples.find(row => row[0] === type)?.[3] ?? siteCopy(b.name, keys);
    assert.equal(bg.siteRule(type, tile), want);
  });
} else {
  console.log('INFO UX-E build VM 공개 함수 없음 → 명세 허용 원문·정렬 예 검사');
  test('UX-E 원문 S1 틀·일반 분기·정렬 키', () => {
    assert.ok(sources.build.includes(COPY.S1));
    assert.match(sources.build, /\bsiteRule\b/);
    for (const key of ORDER) assert.ok(sources.build.includes(`"${key}"`) || sources.build.includes(`'${key}'`), key);
    assert.match(sources.build, /\.ok\b/);
  });
}

// Q4: 함수가 아직 없으면 명세의 제안 이름으로 실패. 출력에서 기대값을 만들지 않는다.
const line = league.calcLineTexts, digits = league.calcDigits;
test('Q4 KCP.league.calcLineTexts 공개 함수 있음', () => assert.equal(typeof line, 'function', '함수 없음: KCP.league.calcLineTexts'));
test('Q4 KCP.league.calcDigits 공개 함수 있음', () => assert.equal(typeof digits, 'function', '함수 없음: KCP.league.calcDigits'));
function numeric(text) {
  assert.equal(typeof text, 'string');
  const cleaned = text.replace(/[,±+%\s]/g, '').replace(/[−–]/g, '-');
  assert.match(cleaned, /^-?\d+(?:\.\d+)?$/);
  return Number(cleaned);
}
function checkLine(delta, tol, base, topic) {
  assert.equal(typeof line, 'function', '함수 없음: KCP.league.calcLineTexts');
  const result = line(delta, tol, base, topic);
  assert.ok(result && Number.isInteger(result.digits) && result.digits >= base && result.digits <= 4, 'digits 범위');
  const d = numeric(result.delta), t = Math.abs(numeric(result.tol));
  // 순수 함수는 부호를 호출부에서 붙이는 형태도 허용(명세의 반환 꼴은 예시).
  const scale = 10 ** result.digits;
  assert.equal(t, Math.round(tol * scale) / scale, '허용 오차 표시값 유지');
  assert.equal(delta < 0 ? d < 0 : d > 0, true, 'Δ 부호 유지');
  if (Math.abs(delta) !== tol) {
    assert.notEqual(Math.abs(d), t, `표시 글자 충돌 ${result.delta}/${result.tol}`);
    assert.equal(Math.abs(d) < t, Math.abs(delta) < tol, `판정 방향 ${result.delta}/${result.tol}`);
  } else assert.equal(result.digits, base, '실제 같은 값은 기준 자릿수');
  return result;
}
for (const delta of [.49995,.49996,.49999,.4999999,-.49996,.50004,.5000001])
  for (const topic of ['uns','cash']) test(`Q4 수용 ${topic} Δ=${delta}`, () => checkLine(delta,.5,2,topic));
for (const [delta, want] of [[.49996,'+0.4999'],[-.49996,'−0.4999'],[.50004,'+0.5001']])
  test(`Q4 명세 네 자리 ${delta}`, () => {
    const result = checkLine(delta,.5,2,'uns');
    assert.equal(result.digits,4);
    const signed = result.delta.replace(/^[+]/, '').replace('-', '−');
    assert.equal(signed,want.replace(/^[+]/, ''));
    assert.equal(result.tol.replace(/^±/, ''),'0.5000');
  });
for (const [delta, want] of [[.4951,3],[.5,2],[.3,2]]) test(`Q4 기존 예 ${delta} → ${want}자리`, () => {
  assert.equal(typeof digits, 'function', '함수 없음: KCP.league.calcDigits');
  assert.equal(digits(delta,.5,2),want);
  assert.equal(checkLine(delta,.5,2,'uns').digits,want);
});
// 고정 씨앗·0.5 격자 tol: 기존 tol의 반값 반올림 방식은 명세 범위가 아니므로 섞지 않는다.
let seed=0x12c0ffee, below=0, above=0;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for (let i=0;i<2000;i++) {
  const tol=(1+Math.floor(random()*2000))/2;
  const direction=i%2 ? -1 : 1;
  const epsilon=(.000001+random()*.999999)*1e-4;
  const magnitude=tol+direction*epsilon, delta=(i%4<2 ? 1 : -1)*magnitude;
  if (direction<0) below++; else above++;
  test(`Q4 무작위 ${i+1} Δ=${delta} tol=${tol}`, () => {
    assert.ok(Math.abs(magnitude-tol)<=1e-4, '명세 경계 범위');
    checkLine(delta,tol,i%3,i%2 ? 'cash' : 'uns');
  });
}
console.log(`Q4 무작위 2000건: 아래 ${below} 위 ${above}, 고정 씨앗 0x12c0ffee`);

// Q6(a): 실제 toast/showTip 본문·타이머 선언을 VM에서 실행한다. 시계·DOM만 가짜다.
// 남은 수명 = 최초 표시+2200−현재 시각. 같은 문구의 새 알림은 별도 수명을 갖는다.
function toastClock() {
  const source = sources.build;
  const functions = ['showTip', 'toast'].map(name => {
    const body = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'))?.[0];
    assert.ok(body, `${name} 실제 본문 없음`);
    return body;
  });
  const start = source.indexOf('  let toastTimer =');
  const end = source.indexOf('  function toast(', start);
  assert.ok(start >= 0 && end > start, 'toast 타이머·차단 선언 연결점 없음');
  let now = 10000, next = 0, blocked = false;
  const pending = new Map(), scheduled = [];
  const tip = { hidden: true, style: {}, dataset: {}, offsetWidth: 100, offsetHeight: 60 };
  const toast = { dataset: {}, textContent: '' };
  const root = { querySelector: selector => selector.startsWith('.fx-turn-layer') && blocked ? {} : null };
  const state = { alive: true, opts: { league: true }, st: { builds: [] }, timers: [],
    root, canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  const sandbox = vm.createContext({
    S: state, TILES: [{ site: -1, t: 'plain', wind: 0, land: true }], TNAME: { plain: '평지' },
    BLD: {}, SITES: [], V: { W: 1280, H: 900, S: 10, area: { t: 0, b: 850 } },
    $: selector => selector === '#bd-tip' ? tip : selector === '#bd-toast' ? toast : null,
    esc: String, stepMul: () => 1, tileTop: () => [100, 200],
    topPoly: () => [[90, 190], [110, 210]], clamp: (n, lo, hi) => Math.max(lo, Math.min(n, hi)),
    syncResultToastPosition() {}, Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) {
      const id = ++next, timer = { id, fn, delay, at: now + delay };
      pending.set(id, timer); scheduled.push(timer); return id;
    },
    clearTimeout(id) { pending.delete(id); },
  });
  vm.runInContext(source.slice(start, end) + '\n' + functions.join('\n') +
    '\nglobalThis.api = { toast, showTip };', sandbox, { timeout: 1000 });
  function advance(elapsed) {
    const target = now + elapsed;
    for (;;) {
      const timer = [...pending.values()].filter(t => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!timer) break;
      pending.delete(timer.id); now = timer.at; timer.fn();
    }
    now = target;
  }
  return { api: sandbox.api, toast, state, scheduled, advance,
    block(value) { blocked = value; } };
}
function pendingPhaseFixture(age) {
  const clock = toastClock();
  clock.api.toast('못 지음');
  clock.advance(age);
  clock.block(true);
  clock.api.toast('계획 시작', { phase: 'plan' });
  assert.equal(clock.state.toastPending.msg, '계획 시작', '실제로 단계 알림 대기 중');
  clock.block(false);
  clock.api.showTip(0); // 실제 말풍선 코드가 대기 알림을 버리고 대체 타이머를 건다.
  assert.equal(clock.state.toastPending, null);
  assert.equal(clock.toast.dataset.show, 'true', '기존 피드백은 말풍선과 함께 표시');
  return clock;
}
for (const age of [0, 800, 2199, 2201]) test(`Q6(a) 대체 타이머 지연=남은 수명 age=${age}`, () => {
  // age=2201은 이미 수명 끝난 피드백을 대기 타이머가 붙잡고 있던 경우다.
  // 단계 알림을 먼저 대기시켜 원래 닫기 타이머를 취소한 뒤 시계를 진행한다.
  const clock = toastClock();
  clock.api.toast('못 지음');
  clock.block(true);
  clock.api.toast('계획 시작', { phase: 'plan' });
  clock.advance(age);
  clock.block(false);
  clock.api.showTip(0);
  assert.equal(clock.state.toastPending, null);
  assert.equal(clock.scheduled.at(-1).delay, Math.max(0, 2200 - age));
});
test('Q6(a) 대체 타이머는 기존 피드백을 최초 표시+2200에 닫음', () => {
  const clock = pendingPhaseFixture(800);
  assert.equal(clock.scheduled.at(-1).delay, 1400);
  clock.advance(1399);
  assert.equal(clock.toast.dataset.show, 'true', '2199ms에는 열림');
  clock.advance(1);
  assert.equal(clock.toast.dataset.show, 'false', '2200ms에 닫힘');
});
for (const offset of [0, 200, 1399]) test(`Q6(a) 같은 글자의 새 피드백 2200ms 보존 offset=${offset}`, () => {
  const clock = pendingPhaseFixture(800);
  clock.advance(offset);
  clock.api.toast('못 지음');
  clock.advance(2200 - 800 - offset); // 이전 대체 타이머 발화 시각(최초+2200).
  assert.equal(clock.toast.textContent, '못 지음');
  assert.equal(clock.toast.dataset.show, 'true', '이전 대체 타이머가 새 알림을 닫지 않음');
  clock.advance(800 + offset - 1);
  assert.equal(clock.toast.dataset.show, 'true', '새 알림은 2199ms에도 열림');
  clock.advance(1);
  assert.equal(clock.toast.dataset.show, 'false', '새 알림의 2200ms에 닫힘');
});
// e-audit: 원본 파일을 수정하지 않고 각 IIFE의 참조만 노출한다.
// 기대값에 EXPLAIN-AUDIT-model의 결론이나 문구 생성 함수를 재사용하지 않는다.
// 고장 변이는 메모리의 소스에만 적용하며 동일 검증기를 다시 실행한다.
const auditStart = assertions, auditCases = new Map(), auditFailed = new Set();
let auditMutations = 0;
const auditNames = ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league'];
const auditSources = Object.fromEntries(auditNames.map(name => [name, read(name)]));
function auditVM(change = {}) {
  const data = new Map(), mem = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const sandbox = vm.createContext({ console, performance, structuredClone, URL,
    document: { documentElement: {}, addEventListener() {}, querySelector: () => null,
      querySelectorAll: () => [], getElementById: () => null },
    addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
    localStorage: mem, sessionStorage: mem,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    KCP: { route() {}, on() {}, esc: String, gradeWords: String, leagueNet: { expandSnapshot: x => x } } });
  sandbox.window = sandbox;
  const expose = {
    build: `KCP.auditB = { cityOutageHours, rememberTrial, questions, renOut, renOut0, blankSlot, toolsOf,
      copy: rev11Copy, format: fmt,
      setState: x => S = x, nodes: () => globalThis.__auditNodes,
      withMods: (m, fn) => { const old=MODS; try { MODS=m; return fn(); } finally { MODS=old; } } };`,
    'league-core': `KCP.auditC = { outageFloor, isOutHour, modsFor, repairOf, econInput, gridFill };`,
    league: `KCP.auditU = { promiseComparison, promiseResultHTML, outageHoursDef, resultPeriod,
      resultHTML, resultsTable, trialGoals, coachSteps, operatingUnlinkedCount, outageCardsHTML, outageHigh,
      setState: x => L = x };`
  };
  for (const name of auditNames) {
    let src = change[name] ? change[name](auditSources[name]) : auditSources[name];
    // simulate0 내부 노드의 참조만 관찰한다. 출력·급전 계산·반환 자료는 그대로다.
    if (name==='build') src=replaceAudit(src,'const gens = N.nodes.filter(n => n.kind !== "town");',
      'globalThis.__auditNodes = N.nodes; const gens = N.nodes.filter(n => n.kind !== "town");');
    if (expose[name]) {
      assert.match(src, /\}\)\(\);\s*$/, `${name} VM 노출 연결점`);
      src = src.replace(/\}\)\(\);\s*$/, expose[name] + '\n})();');
    }
    vm.runInContext(src, sandbox, { filename: `ui/${name}.js`, timeout: 10000 });
  }
  const K = sandbox.KCP, B = K.buildGame, C = K.leagueCore, U = K.auditU;
  const id = 'pyeongtaek', S = C.newState('EAUDIT12','south',0,[id,'anseong'],{ turns:12 });
  S.round = 1; S.phase = 'review';
  const session = { role:'solo', room:'EAUDIT12', team:id, S, snap:S };
  U.setState(session); B.selectPack(id,'league');
  const st = K.auditB.blankSlot();
  K.auditB.setState({ st, opts:{ league:true, trialScope:'e-audit', leagueRound: () => C.roundsOf(S)[S.round-1] } });
  return { K, B, C, U, A:K.auditB, engine:K.auditC, P:K.ECON_DATA.params, S, st, id, session, data,
    buildSource:change.build?change.build(auditSources.build):auditSources.build };
}
const json = value => JSON.parse(JSON.stringify(value));
const textHTML = value => value.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
const nf = (n,d=0) => n.toLocaleString('ko-KR',{ maximumFractionDigits:d });
const close = (actual,want,label) => assert.ok(Math.abs(actual-want)<1e-8, `${label}: ${actual} != ${want}`);
function auditCase(group, label, check) {
  if (!auditCases.has(group)) auditCases.set(group,[]);
  auditCases.get(group).push(check);
  test(`e-audit ${group} ${label} [vm]`, () => {
    try { check(auditVM()); }
    catch (error) { auditFailed.add(group); throw error; }
  });
}
function replaceAudit(source, before, after) {
  assert.ok(source.includes(before), `변이 연결점 없음: ${before}`);
  return source.replace(before,after);
}
function auditMutant(group, file, before, after) {
  test(`e-audit ${group} 고장 변이 탐지 [vm]`, () => {
    assert.ok(!auditFailed.has(group),`${group} 기준 검사 실패로 변이 탐지 인정 불가`);
    // 문법 오류·초기화 오류는 탐지로 세지 않는다. 실제 단언 실패만 인정한다.
    const altered = auditVM({ [file]: src => replaceAudit(src,before,after) });
    let detected = false;
    for (const check of auditCases.get(group)) {
      try { check(altered); }
      catch (e) { if (e.code !== 'ERR_ASSERTION') throw e; detected = true; break; }
    }
    assert.ok(detected, `${group} 변이를 검사가 놓침`);
    auditMutations++;
  });
}

// M-E2/S18: 48달은 현실 비교 기준(4년×12)이며 note에서 계수를 역산하지 않는다.
for (const every of [12,10,7,16]) auditCase('M-E2',`reviewEvery=${every}`, h => {
  const { C,S,P }=h, before=json(C.econView(S));
  P.reviewEvery.v=every;
  const view=C.econView(S), item=view.speeds.items.find(x=>x.key==='reviewEvery');
  const months=4*12, ratio=Math.round(months/every*10)/10;
  assert.equal(item.note,`주민 평가는 ${every}턴마다: 현실 임기 4년(${months}달)을 ×${ratio} 압축`);
  if (every===12) assert.equal(item.note,'주민 평가는 12턴마다: 현실 임기 4년(48달)을 ×4 압축');
  const rest=v=>{ const x=json(v); delete x.speeds.reviewEvery; x.speeds.items=x.speeds.items.filter(i=>i.key!=='reviewEvery'); return x; };
  assert.deepEqual(rest(view),rest(before),'평가 간격 외 econView 불변');
});
auditCase('B16','기본 바이트·표시 풍속 2→3, 출력 8→27', h => {
  const wind = b => b.tips().find(s=>s.startsWith('풍속이 '));
  assert.equal(wind(h.B),'풍속이 2배면 풍력 출력은 약 8배(v³).');
  const ratio=3, changed=auditVM({ build:src=>replaceAudit(src,'const WIND_SPEED_EXAMPLE_RATIO = 2;',`const WIND_SPEED_EXAMPLE_RATIO = ${ratio};`) });
  assert.equal(wind(changed.B),`풍속이 ${ratio}배면 풍력 출력은 약 ${ratio**3}배(v³).`);
});

// N1·K5: 실제 promiseComparison과 실제 결과 renderer까지 통과한다.
for (const topic of ['uns','cash']) for (const tol of [.5,.7])
  for (const offset of [-.00004,0,.00004]) for (const sign of [-1,1])
    auditCase(topic==='uns'?'N1':'K5',`tol=${tol} offset=${offset} sign=${sign}`, h => {
      const {S,U,P,id}=h; P.promiseSameDelta.v=tol;
      const requested=sign*(tol+offset), baseline=topic==='uns'?12:100;
      S.econ.before={ [id]:{ cash:baseline } };
      S.econ.cities[id].cash=topic==='cash'?baseline+requested:100;
      const r={ unsPct:topic==='uns'?baseline+requested:12, co2Prod:137, co2Cons:359, cp:0 };
      S.results=[{ round:1,days:7,season:'winter',team:{ [id]:r } }];
      const n={ topic, confirmed:true, evidence:{ key:'fuel',value:1 }, pred:{ [topic]:'same' }, trial:{ days:7,unsPct:baseline } };
      const compared=U.promiseComparison(S,n), delta=(topic==='cash'?S.econ.cities[id].cash:r.unsPct)-baseline;
      close(compared.delta,delta,'엔진 Δ');
      const direction=Math.abs(delta)<tol?'same':delta>0?'up':'down';
      assert.equal(compared.actual,direction);
      const html=U.promiseResultHTML(S,n), key=topic==='uns'?'uns':'cash';
      const row=html.match(new RegExp(`<p id="lg-promise-${key}-calc"[^>]*>([^<]+)</p>`))?.[1];
      assert.ok(row,`${topic} 계산 줄 없음`);
      assert.ok(row.includes(topic==='uns'?'시험 1주 대비':'운영 전 대비'));
      const numbers=row.match(/Δ ([+−\-\d,.]+)(?:%p|억) · '같음' 범위 ±([\d,.]+)/);
      assert.ok(numbers,row);
      const shown=Number(numbers[1].replace(/,/g,'').replace('−','-')), shownTol=Number(numbers[2].replace(/,/g,''));
      close(shownTol,tol,'자료 tol');
      assert.equal(Math.sign(shown),Math.sign(delta),'Δ 부호');
      assert.equal(Math.abs(shown)<shownTol,Math.abs(delta)<tol,'표시값의 같음 경계');
      if (Math.abs(delta)!==tol) assert.notEqual(Math.abs(shown),shownTol,'경계 표시 충돌 없음');
    });

// 도시 합계 기준 정전 시간: 수요지 outTotal과 일부러 다르게 만든다.
auditCase('정전 정의','원장 문턱 바로 안/같음/밖 + 도시 시간', h => {
  const {engine,A,U,P}=h;
  for (const dem of [0,.125,10]) {
    const floor=Math.max(P.outageHourMinMW.v,P.outageHourShare.v*dem);
    close(engine.outageFloor(dem),floor,'정전 문턱');
    for (const epsilon of [-1e-6,0,1e-6]) {
      const shortage=floor+epsilon;
      assert.equal(engine.isOutHour([shortage],[0],[dem],0),shortage>floor);
      // dem-sup의 이진 오차를 피하고 정전 여부를 실제 입력으로 독립 계산한다.
      const res={ hrDem:[dem], hrSup:[dem-shortage],outTotal:17 };
      const expected=dem-res.hrSup[0]>floor?1:0;
      assert.equal(A.cityOutageHours(res),expected,'수요지 시간 합 대신 도시 시간');
    }
  }
  for (const [share,min] of [[P.outageHourShare.v,P.outageHourMinMW.v],[.035,.009]]) {
    P.outageHourShare.v=share; P.outageHourMinMW.v=min;
    close(engine.outageFloor(10),Math.max(min,share*10),'원장 변형');
    const sentence=U.outageHoursDef(31);
    assert.ok(sentence.includes(`${nf(share*100)}%`),sentence);
    assert.ok(sentence.includes(`${nf(min,3)} MW`),sentence);
    assert.ok(sentence.includes(`${nf(31*24)}시간`),sentence);
  }
});
auditCase('도시 시간','시험 기록·월 환산', h => {
  const {A,B,S,U,st,P,id}=h;
  const res=B.simulate(st,7,{league:true});
  const expected=Array.from(res.hrDem).reduce((n,dem,k)=>n+(dem-res.hrSup[k]>Math.max(P.outageHourMinMW.v,P.outageHourShare.v*dem)?1:0),0);
  assert.ok(res.outTotal>expected,'여러 수요지 동시 정전 fixture');
  A.rememberTrial(res,st,{year:2026,month:1},0,res.tot.co2);
  assert.equal(B.lastTrial(id,'e-audit').outH,expected);
  const record={round:1,days:7,team:{[id]:{outH:expected,co2Prod:137,co2Cons:359,ledger:{invest:0,opex:0}}}};
  const days=h.C.roundsOf(S)[0].mdays, html=textHTML(U.resultsTable(S,record));
  assert.ok(html.includes(nf(expected*days/7,1)),html);
});

// CO₂: gridFill의 정상 계통 배출 계수로 생산/소비가 다른 실제 시험을 만든다.
auditCase('CO₂ 이름','계통 수입·생산/소비 장부·표시 입력 변형', h => {
  const {A,B,engine,P,S,U,st,id}=h;
  const raw=B.simulate(st,7,{league:true}), filled=engine.gridFill(raw);
  const imports=filled.tot.by.import-raw.tot.by.import;
  assert.ok(imports>0,'계통 수입 fixture');
  close(filled.co2,raw.co2+imports*P.normalCo2.v,'계통 배출');
  assert.notEqual(filled.co2,raw.tot.co2,'생산 ≠ 소비');
  for (const [prod,cons] of [[137,359],[241,719]]) {
    const res={round:1,days:7,team:{[id]:{outH:2,co2Prod:prod,co2Cons:cons,ledger:{invest:0,opex:0}}}};
    const mul=h.C.roundsOf(S)[0].mdays/7;
    const html=textHTML(U.resultsTable(S,res));
    assert.ok(html.includes('CO₂ 생산 / CO₂ 소비(계통 포함)(t)'),html);
    assert.ok(html.includes(`${nf(prod*mul)}/${nf(cons*mul)}`),html);
    const cost={fuel:0,policy:0,inv:0};
    const input=engine.econInput(S,h.C.regionOf('south'),id,{...res.team[id],dem:100,uns:0,cost,imp:0,exp:0,earn:0,pay:0},mul);
    close(input.energy.co2Local,prod*mul,'경제 생산 장부');
    close(input.energy.co2,cons*mul,'경제 소비 장부');
  }
  A.rememberTrial(filled,st,{year:2026,month:1},imports,raw.tot.co2);
  const trial=B.lastTrial(id,'e-audit');
  close(trial.co2Prod,raw.tot.co2,'시험 생산 기록'); close(trial.co2,filled.co2,'시험 소비 기록');
});
auditCase('CO₂ 이름','실제 runRound → S6 결과 서랍의 일 평균·월 소비', h=>{
  const {S,C,B,U,id}=h;
  C.runRound(S,B);
  const res=S.results.at(-1), r=res.team[id], days=C.roundsOf(S)[0].mdays;
  assert.notEqual(r.co2Prod,r.co2Cons,'실제 엔진도 생산 ≠ 소비');
  for (const [prod,cons] of [[137,359],[241,719]]) {
    r.co2Prod=prod; r.co2Cons=cons;
    const V=C.publicView(S,0), rendered=U.resultHTML(V,res);
    const production=textHTML(rendered.match(/<div><dt>CO₂ 생산\(이번 달\)<\/dt>([^]*?)<\/div>/)?.[0]||'');
    assert.ok(production.includes(`${nf(prod/res.days,1)} t/일`),production);
    assert.ok(production.includes(`이번 달 합 ${nf(prod*days/res.days)} t`),production);
    assert.ok(textHTML(rendered).includes(`CO₂ 소비(계통 포함) ${nf(cons*days/res.days)} t`));
    const outage=textHTML(rendered.match(/<div><dt>정전 시간\(이번 달\)<\/dt>([^]*?)<\/div>/)?.[0]||'');
    assert.ok(outage.includes(`${nf(r.outH*days/res.days,1)}시간`),outage);
  }
});
auditCase('C3','기존 미연결 설비와 가까운 마을 이름', h => {
  const {B,A,U,st}=h;
  for (const map of ['pyeongtaek','dangjin']) {
    B.selectPack(map,'league'); A.setState({st,opts:{league:true}});
    const nodes=B.network(st).nodes.filter(n=>n.kind!=='town' && n.kind!=='import' && !n.live);
    assert.ok(nodes.length,'기존 미연결 fixture');
    const node=nodes[0], facility=B.BLD[node.kind]?.name || B.SITES[node.si].name, town=B.nearestTown(node.tile);
    const steps=U.coachSteps({unlinked:nodes.length,waiting:0});
    const sentence=steps.flat().find(s=>typeof s==='string' && s.startsWith('기존 '));
    assert.ok(sentence?.includes(`${facility} 칸, ${town.name} 칸`),sentence);
    assert.ok(sentence.includes('전선에 안 닿으면 운영에서 못 써요'),sentence);
  }
});
auditCase('C5','계통 포함 소비 배출 질문 변형', h => {
  const {B}=h, raw=B.simulate(h.st,7,{league:true});
  for (const co2 of [32109,45217]) {
    const res={...raw,co2,tot:{...raw.tot,co2:137},pol:{...raw.pol,tax:false}};
    const questions=h.A.questions(h.st,res,B.network(h.st));
    const q=questions.find(q=>q.q.startsWith('CO₂ 소비(계통 포함)'))?.q;
    assert.ok(q?.includes(`${nf(co2)} t`),q);
    assert.ok(!q.includes(`${nf(res.tot.co2)} t`),'생산과 섞이지 않음');
  }
});

// C6: 실제 finishRun 본문을 별도 VM에서 호출. Canvas·서랍 갱신만 대역이며,
// announce 인자·도시 시간·문구 치환·숫자 형식은 실제 함수 그대로다.
function auditAnnounce(h,res,leagueMode) {
  const body=h.buildSource.match(/^  function finishRun\([^]*?^  }/m)?.[0];
  assert.ok(body,'finishRun 본문 없음');
  let announced;
  const noOp=()=>{}, element={ focus:noOp }, state={ run:{res},opts:{league:leagueMode},doc:{},root:{querySelectorAll:()=>[]} };
  const isolated=vm.createContext({ S:state,LG:leagueMode,html:{classList:{remove:noOp}},$:()=>element,
    cityOutageHours:h.A.cityOutageHours,rev11Copy:h.A.copy,fmt:h.A.format,
    leagueEnded:()=>false,syncRunStrip:noOp,addEntry:()=>1,refreshHUD:noOp,placeBannerValues:noOp,
    renderDrawer:noOp,openDrawer:noOp,announce:value=>announced=value,request:noOp });
  vm.runInContext(body+'\nfinishRun({quiet:true});',isolated,{timeout:1000});
  return announced;
}
auditCase('C6','실제 운영 끝 낭독·값 변형·리그/단독', h=>{
  for (const [days,co2,hrSup] of [[7,32109,[0,2,0,4]],[3,45217,[0,0,0,4]]]) {
    const res={days,co2,hrDem:[1,2,3,4],hrSup,outTotal:17,tot:{co2:137},cost:{total:12.34}};
    const hours=res.hrDem.reduce((n,dem,k)=>n+(dem-hrSup[k]>Math.max(h.P.outageHourMinMW.v,h.P.outageHourShare.v*dem)?1:0),0);
    for (const lg of [false,true]) {
      const actual=auditAnnounce(h,res,lg);
      assert.equal(actual,`${days}일 운영 끝. 정전 ${lg?hours:res.outTotal}시간, 총비용 12.3억, CO₂ 소비(계통 포함) ${nf(co2)} t.`);
    }
  }
});

// C10: 문장에 적힌 설비의 실제 출력 감산과 시험/월말 비용 경계를 검증한다.
for (const x of [1,1.7]) auditCase('C10 출력',`사건 크기 ${x}`, h => {
  const {S,C,B,A,engine,P,id}=h, R=C.regionOf('south');
  S.events=[{id:'heatwave_peak',round:1,x}];
  const mods=engine.modsFor(S,R,id), trial=C.trialMods(S,R,id);
  const normalMods=engine.modsFor({...S,events:[]},R,id);
  const lng=Math.max(0,1-P.heatLngSlope.v*P.heatAirDelta.v*x);
  const pv=Math.max(0,1-P.heatPvSlope.v*P.heatModuleDelta.v*x);
  close(mods.lngCapMul,lng,'LNG 배수'); close(mods.solarHeatMul,pv,'실리콘 태양광 배수');
  assert.equal(trial.lngCapMul,undefined); assert.equal(trial.solarHeatMul,undefined);
  const tile=B.TILES.find(t=>t.land&&!t.out);
  const day={...B.weather(2026,'summer')[0],mult:2,noise:Array(24).fill(1)};
  const hotMods={...mods,reCap:{...mods.reCap}}, clearMods={...normalMods,reCap:{...normalMods.reCap}};
  for (const kind of ['solar','roof','tandem','tandem_roof','wind','offshore','tidal','hydro']) {
    const g={kind,tile:tile.i}; assert.ok(B.BLD[kind],kind);
    // 가상 출력 표본은 완전 접속시킨다. 다른 폭염 출력 배수는 지우지 않는다.
    for (const m of [hotMods,clearMods]) m.reCap[`${kind}:${tile.i}`]=B.BLD[kind].mw;
    const base=A.withMods(clearMods,()=>A.renOut(g,day,12,12));
    const actual=A.withMods(hotMods,()=>A.renOut(g,day,12,12));
    close(actual,base*(['solar','roof'].includes(kind)?pv:1),`${kind} 적용 범위`);
    assert.ok(base>0,`${kind} 비영 출력`);
  }
  // 실제 simulate의 급전 노드 cap: 기존 LNG·석탄과 추가 디젤·바이오·SMR.
  const used=new Set(), builds=['diesel','biomass','smr','coal'].map(t=>{
    const site=B.TILES.find(v=>!used.has(v.i)&&!v.out&&v.land&&v.site<0&&B.siteRule(t,v)==='');
    assert.ok(site,`${t} 급전 fixture 자리`); used.add(site.i); return {t,i:site.i};
  });
  const plan={...h.st,builds,lines:[]};
  const normal=B.simulate(plan,1,{league:true,mods:normalMods}), normalNodes=A.nodes();
  B.simulate(plan,1,{league:true,mods});
  for (const g of normalNodes.filter(g=>g.D)) {
    const changed=A.nodes().find(v=>v.kind===g.kind&&v.tile===g.tile);
    close(changed.D.cap,g.D.cap*(g.kind==='lng'?lng:1),`${g.kind} 급전 cap`);
  }
  assert.ok(normalNodes.some(g=>g.kind==='lng'&&g.D.cap>0),'LNG cap fixture');
  assert.ok(normalNodes.some(g=>g.kind==='coal'&&g.D.cap>0),'석탄 cap fixture');
  const goals=h.U.trialGoals(normal,id);
  assert.ok(goals.notes.some(note=>/시험에는.*폭염.*LNG·일반 태양광.*월말 공공시설 보수비/.test(note)),'실제 trialGoals C10');
});
auditCase('C10 비용','보수비 월 1회·1주 시험 제외·원장 변형', h => {
  const {S,C,B,engine,P,id}=h, R=C.regionOf('south');
  S.events=[{id:'heatwave_peak',round:1,x:1.5}];
  const before=B.simulate(h.st,7,{league:true,mods:C.trialMods(S,R,id)});
  for (const amount of [P.repairHeatwave.v,9]) {
    P.repairHeatwave.v=amount;
    const repair=engine.repairOf(S,R,id), wanted=amount*1.5;
    close(repair,wanted,'사건 보수비');
    const record={dem:100,uns:0,imp:0,exp:0,earn:0,pay:0,co2Prod:137,co2Cons:359,cost:{fuel:0,policy:0,repair,inv:0}};
    const inputs={};
    for (const city of Object.keys(S.teams)) inputs[city]=engine.econInput(S,R,city,record,31/7);
    close(inputs[id].energy.repair,wanted,'월 보수비 환산하지 않음');
    close(inputs[id].energy.opex,wanted,'월 비용에 한 번 포함');
    const step=h.K.econ.monthStep(S.econ,inputs,h.K.ECON_DATA);
    close(step.report.fiscal[id].exp.repair,wanted,'월말 장부');
    const after=B.simulate(h.st,7,{league:true,mods:C.trialMods(S,R,id)});
    assert.deepEqual(json(after.cost),json(before.cost),'보수비 원장 변형에도 1주 시험 비용 불변');
    assert.equal(after.cost.repair,undefined,'시험에 월말 보수비 없음');
  }
});

// C4·P1·S7: 운영 당시 계획과 현재 편집 지도를 다르게 둔다.
for (const monthly of [false,true]) for (const count of [0,1,3,null])
  auditCase('S7',`monthly=${monthly} 추가 미연결=${count}`, h => {
    const {B,A,S,U,st,id,data}=h;
    const lines=B.network(st).nodes.filter(n=>!['town','import'].includes(n.kind))
      .map(n=>({p:B.routePath(n.tile,B.nearestTown(n.tile).tile)}));
    const onLine=new Set(lines.flatMap(line=>line.p));
    const tiles=B.TILES.filter(t=>t.land&&!t.out&&t.site<0&&!onLine.has(t.i)&&B.siteRule('diesel',t)==='');
    const operating=count===null?null:{...st,lines,builds:tiles.slice(0,count).map(t=>({t:'diesel',i:t.i}))};
    const expected=operating?B.network(operating).nodes.filter(n=>!['town','import'].includes(n.kind)&&!n.live).length:null;
    assert.equal(expected,count,'0/1/여러 기 fixture');
    // 현재 지도에는 다른 설비 5기. 운영 계획을 쓰지 않으면 n이 달라진다.
    A.setState({st:{...st,builds:tiles.slice(0,5).map(t=>({t:'diesel',i:t.i}))},opts:{league:true}});
    const round=monthly?2:1;
    S.round=round;
    const res={round,days:7,team:{[id]:{unsPct:9}}}; S.results=[res];
    h.session.interview={interview:{months:{[round]:{operatingPlan:operating}}}};
    data.set('kcp-league-data-v1:EAUDIT12:pyeongtaek',JSON.stringify(h.session.interview));
    assert.equal(U.operatingUnlinkedCount(S,res,id),expected,'운영 당시 미연결 수');
    const keys=['event','weather','growth','progress','plan','gridImport'];
    const a={round,id,target:'uns',basis:monthly?'monthly':'trial',trial:9,actual:9,parts:keys.map(key=>({key,value:0})),clues:Object.fromEntries(keys.map(key=>[key,'가상 단서'])),replay:0,ms:0,simulations:0};
    const note={outageOpened:true,outageFrozen:a};
    const rendered=U.outageCardsHTML(S,res,id,note);
    const sentence=textHTML(rendered.match(/<p id="lg-outage-single">([^]*?)<\/p>/)?.[1]||'');
    assert.ok(sentence.includes('정전 자체는 커요'),sentence);
    if (expected>=1) {
      assert.ok(sentence.includes(`전선에 안 닿은 설비'가 ${expected}기`),sentence);
      assert.ok(sentence.includes(`${monthly?'지난달':'시험'}에도 정전이 컸어요. 이번 달`),sentence);
      assert.doesNotMatch(sentence,/이번 달 변화보다|있었으니|컸으니/);
    } else assert.ok(sentence.includes('지금 설비·접속이 수요를 못 따라가는 상태'),sentence);
    assert.doesNotMatch(sentence,/\.\.|\.\s+\./);
  });
auditCase('S7','유효 운영 사본이 메모의 다른 계획보다 우선', h=>{
  const {B,U,S,st,id}=h, round=1;
  const res={round,days:7,seed:7031,season:'winter',team:{[id]:{unsPct:9}}};
  const mods={essCap:1,hydroMonth:1,curtailP:0,reCap:{}};
  const snapshot={round,days:res.days,seed:res.seed,season:res.season,unsPct:9,isolatedUnsPct:9,waitingMW:0,
    plan:st,mods,normalMods:mods,eventMods:Object.fromEntries(h.C.MUL.map(key=>[key,1])),
    facts:{pop:100,ind:100,fuel:1,event:'가상 사건'},fullReCap:{}};
  const tile=B.TILES.find(t=>t.land&&!t.out&&t.site<0&&B.siteRule('diesel',t)==='');
  const edited={...st,builds:[{t:'diesel',i:tile.i}]};
  h.session.interview={outageSnapshots:{1:snapshot},interview:{months:{1:{operatingPlan:edited}}}};
  const count=plan=>B.network(plan).nodes.filter(n=>!['town','import'].includes(n.kind)&&!n.live).length;
  assert.notEqual(count(st),count(edited),'사본·메모 fixture가 서로 다름');
  assert.equal(U.operatingUnlinkedCount(S,res,id),count(st),'유효 사본 우선');
  snapshot.seed++;
  assert.equal(U.operatingUnlinkedCount(S,res,id),count(edited),'사본이 다른 운전이면 당시 메모로 대체');
});
auditCase('S7','높은 정전 안내 문턱·반올림·P1 입력 변형', h=>{
  const {P,U}=h, threshold=P.outageHighPct.v, digits=P.outageHighDigits.v;
  for (const actual of [threshold-1,threshold-.004,threshold,threshold+1]) {
    const high=Number(actual.toFixed(digits))>=threshold;
    assert.equal(U.outageHigh(actual),high);
    for (const monthly of [false,true]) {
      const sentence=h.K.league.highOutageHintText({trialHigh:high,monthly,smallDifference:true,unlinked:3});
      assert.equal(sentence.includes(`${monthly?'지난달':'시험'}에도 정전이 컸어요.`),high);
      assert.ok(sentence.includes("전선에 안 닿은 설비'가 3기"));
    }
  }
});

// siteRule: 지도별 실제 BLD.ok·일반 지형 낱말로 기대 목록 계산.
for (const map of ['island','pyeongtaek','anseong','dangjin','asan','cheonan','hwaseong'])
  auditCase('siteRule',`${map} 허용/금지·BLD 입력 변형`, h => {
    const {B}=h; B.selectPack(map,map==='island'?undefined:'league');
    const tile={...B.TILES.find(t=>!t.out&&t.land&&t.site<0),t:'__forbidden__',site:-1,out:false,water:false};
    let checked=0;
    for (const [type,b] of Object.entries(B.BLD)) {
      if (!b.ok || b.sea || b.roof || ['smr','lng','coal','hydro'].includes(type)) continue;
      const keys=Object.keys(b.ok), allowed=ORDER.filter(k=>keys.includes(k));
      if (!allowed.length || !h.A.toolsOf().includes(type)) continue; // 해당 지도 도구가 아님.
      checked++;
      const expected=`${b.name}: ${allowed.map(k=>NAMES[k]).join('·')}만`;
      assert.equal(B.siteRule(type,tile),expected);
      for (const terrain of allowed) assert.equal(B.siteRule(type,{...tile,t:terrain}),'',`${type}/${terrain} 허용`);
      const old=b.ok, name=b.name;
      try {
        b.name='가상 설비'; b.ok={urban:1,plain:1,forest:1};
        assert.equal(B.siteRule(type,tile),'가상 설비: 평지·숲·도시만');
        b.ok={}; assert.equal(B.siteRule(type,tile),'못 지음');
      } finally { b.ok=old; b.name=name; }
    }
    assert.ok(checked>0,'지도별 일반 분기 fixture');
    assert.equal(B.siteRule('__unknown__',tile),'못 지음');
  });

// 각 항목의 대표 고장 하나를 같은 검증기로 탐지한다(컴파일 성공 이후만 집계).
auditMutant('M-E2','league-core','REVIEW_TERM_MONTHS_DISPLAY / P.reviewEvery.v','REVIEW_TERM_MONTHS_DISPLAY / 12');
auditMutant('B16','build','WIND_SPEED_EXAMPLE_RATIO ** 3','WIND_SPEED_EXAMPLE_RATIO ** 2');
auditMutant('N1','league','rev10Copy("N1", { 기준: compared.comparison.label, Δ: calc.delta, tol: calc.tol })','rev10Copy("N1", { 기준: compared.comparison.label, Δ: calc.delta, tol: "9" })');
auditMutant('K5','league','rev9Copy("K5", { Δ: calc.delta, tol: calc.tol })','rev9Copy("K5", { Δ: calc.delta, tol: "9" })');
auditMutant('정전 정의','league-core','uns[k] - del[k] > outageFloor(dem[k])','uns[k] - del[k] >= outageFloor(dem[k])');
auditMutant('도시 시간','build','outH: cityOutageHours(res),','outH: res.outTotal,');
auditMutant('CO₂ 이름','league','fmt(r.co2Prod * mul))}/${esc(fmt(r.co2Cons * mul))','fmt(r.co2Cons * mul))}/${esc(fmt(r.co2Prod * mul))');
auditMutant('CO₂ 이름','league','value: res.team[id].co2Prod / res.days','value: res.team[id].co2Cons / res.days');
auditMutant('C3','league','마을: town.name','마을: facility.name');
auditMutant('C5','build','rev11Copy("C5", { n: fmt(R.co2) })','rev11Copy("C5", { n: fmt(R.tot.co2) })');
auditMutant('C10 출력','build','["solar", "roof"].includes(g.kind) && MODS.solarHeatMul','["solar", "roof", "tandem"].includes(g.kind) && MODS.solarHeatMul');
auditMutant('C10 비용','league-core','repair: c.repair || 0, capexNew','repair: (c.repair || 0) * wk, capexNew');
auditMutant('S7','league','rev11Copy("C4", { n: unlinked })','rev11Copy("C4", { n: unlinked + 1 })');
auditMutant('siteRule','build','.filter(key => Object.hasOwn(B.ok, key)).map(key => BASE_TNAME[key])','.filter(key => Object.hasOwn(B.ok, key)).reverse().map(key => BASE_TNAME[key])');
auditMutant('C6','build','h: LG ? cityOutageHours(R.res) : R.res.outTotal','h: R.res.outTotal');
console.log(`e-audit 신규 단언 ${assertions-auditStart} · 변이 탐지 ${auditMutations}/15 · 방법: 전 항목 vm(정규식 대체 0)`);
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures ? 1 : 0;
