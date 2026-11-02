'use strict';
// D-80: 기대값 출처는 D80-gridtopic §1·§2 C, D80-C-s7 §1–8·11,
// D80-contract-A와 DECISIONS D-80. 구현을 추출하거나 분해 결과로 기대값을 만들지 않는다.
// 실행: node tests/league/review/39-d80-s7.js (DOM/브라우저/통신 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..'), clone = x => JSON.parse(JSON.stringify(x));
const id = 'pyeongtaek', ids = [id, 'dangjin'];
const storage = new Map(), session = { room: 'D80S7FIXTURE', team: id, role: 'fixture', rev: 0 };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
  addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8'), ctx, { filename: name });
const source = fs.readFileSync(path.join(ROOT, 'ui/league.js'), 'utf8');
console.log(`D80 implementation sha256: ${require('node:crypto').createHash('sha256').update(source).digest('hex')}`);
assert.equal(source.split('let L = null;').length, 2, '30번과 같은 VM 세션 연결점');
assert.equal(source.split('state: () =>').length, 2, '32번과 같은 수신 연결점');
// 메모리에서 세션·수신만 연결한다. 계산/렌더링은 공개 uiMath API를 그대로 쓴다.
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('state: () =>', '__receive: onSnap, state: () =>'), ctx);
const { leagueCore: C, buildGame: B, ECON_DATA: D, league: U } = ctx.KCP;
const R = C.regionOf('south'), M = U.uiMath;
// 도시 이름은 자료에서 읽는다(D-58·D-86, #78).
const CITY_NAME = C.teamDef(R, id).name;
const trialKeys = ['choice', 'weather', 'event', 'trade'];
const monthlyKeys = ['choice', 'weather', 'event', 'progress', 'growth', 'trade'];
const ZERO = .005; // D80-gridtopic §1: < 0.005%. 구현 상수를 기대값으로 쓰지 않는다.
const reset = () => { session.outCache = {}; session.outFailures = {}; session.outShownPending = null; };
const select = () => B.selectPack(C.teamDef(R, id).pack, 'league');
// 공개 uns·imp·sub·isolated.uns만 사용. UI의 gridFillMWh/gridReliance는 호출하지 않는다.
const fillMWh = row => Math.max(0, row.isolated.uns - row.uns - row.imp + row.sub);
// 월 일수는 core의 공개 라운드 표로 읽고 S7 resultPeriod를 기대값에 쓰지 않는다.
const monthDays = (V, res) => C.roundsOf(V)[res.round - 1].mdays;
const mul = (V, res) => monthDays(V, res) / res.days;
const actualMWh = f => fillMWh(f.res.team[id]) / f.res.days; // D-82: S7은 MWh/일.
const sameTol = base => Math.max(.05, .05 * Math.abs(base)); // D-82: 측정 보고서의 제안 식.
const minPart = base => Math.max(sameTol(base) / 10, .05); // D-82 수정 2(총괄 결정): S7 최소 몫 하한 = 표시 눈금 0.1의 절반.
const sum = a => a.parts.reduce((n, p) => n + p.value, 0);
let checks = 0, failures = 0;
function check(label, fn) {
  checks++;
  try { fn(); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
function near(actual, expected) {
  // D-82: 하루 평균과 순차 차분의 부동소수 누적만 허용한다(D-80 C-2 잔차 규칙 유지).
  // 화면 반올림이나 누락 잔차를 허용하는 값이 아니다. 원시값 항등식은 1e-6 MWh/일 또는 %p.
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-6,
    `${actual} != ${expected} (1e-6)`);
}
function keys(a, expected) { assert.deepEqual(clone(a.parts.map(p => p.key)), expected); }
function game({ empty = false } = {}) {
  storage.clear(); reset(); session.snap = null; delete session.interview;
  const S = C.newState(session.room, R.id, 0, ids, { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  for (const city of ids) S.teams[city].plan = empty ? { builds: [], lines: [], policies: [] } : clone(D.normalStartPlans[city]);
  return S;
}
function trial(S, seed = 1) {
  select();
  const rd = C.roundsOf(S)[S.round - 1], plan = clone(S.teams[id].plan);
  const raw = B.simulate({ ...B.sanitize(plan, 1e9), seed, season: rd.season }, 7,
    { league: true, mods: C.trialMods(S, R, id) });
  const originalImport = raw.tot.by.import, filled = C.gridFill(raw);
  const map = C.teamDef(R, id).pack, scope = JSON.stringify([session.room, id]);
  const record = { map, scope, year: rd.year, month: rd.month, season: rd.season,
    seed, days: 7, plan, unsPct: 100 * filled.unsTotal / filled.tot.dem,
    gridMWh: filled.tot.by.import - originalImport, outH: 0, co2: filled.co2, cost: filled.cost.total };
  storage.set('kcp-build-trial-v1', JSON.stringify({ [JSON.stringify([scope, map])]: record }));
  return B.lastTrial(map, scope);
}
function operate(S, t = null) {
  // 32번과 같은 실제 수신 경로로 월간 사본을 저장. 분해 반환값은 기대값에 쓰지 않는다.
  U.__receive(clone(C.publicView(S, 0)));
  const res = C.run(S, B, 0), V = clone(C.publicView(S, 0));
  U.__receive(V); reset();
  return { S, res, V, trial: t };
}
function fixture({ month = 1, trialSeed = 1, salt = 0, empty = false, season } = {}) {
  const S = game({ empty }); S.salt = salt;
  if (season) S.rounds[0].season = season;
  for (let m = 1; m < month; m++) { operate(S); C.host(S, 'next', 0); }
  return operate(S, trial(S, trialSeed));
}
function html(f, a, note = {}) {
  return M.outageCardsHTML(f.V, f.res, id,
    { outageOpened: true, missed: 'choice', outageFrozen: a, ...note });
}
function elementHTML(text, id) {
  const start = text.search(new RegExp('<[a-z]+\\b[^>]*id="' + id + '"'));
  if (start < 0) return '';
  const tokens = text.slice(start).matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi);
  let tag, depth = 0;
  for (const m of tokens) {
    tag ||= m[2];
    if (m[2] !== tag) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return text.slice(start, start + m.index + m[0].length);
  }
  throw Error('unclosed HTML region: ' + id);
}

function costs(label, a) {
  console.log(JSON.stringify({ report: '11-cost', label,
    simulations: a?.simulations ?? null, gridFills: a?.gridFills ?? null, ms: a?.ms ?? null }));
}

// 1·2: 평택 겨울·봄, 정상 시작 계획과 D-74 기본 상한. 대상·단위의 잘못된 분기를 잡는다.
for (const options of [{ season: 'winter', trialSeed: 1 }, { season: 'winter', trialSeed: 707, salt: 17 },
  { season: 'spring', trialSeed: 7117, salt: 29 }]) {
  const f = fixture(options);
  const label = JSON.stringify(options), a = M.outageAttribution(f.V, f.res, id);
  check(`1 ${label} fixture`, () => assert.ok(f.trial.unsPct < ZERO && f.res.team[id].unsPct < ZERO));
  check(`1 ${label} target`, () => assert.equal(a.target, 'grid'));
  check(`1 ${label} keys`, () => keys(a, trialKeys));
  check(`2 ${label} identity`, () => near(sum(a) + a.replay, a.total));
  check(`2 ${label} public actual`, () => near(a.actual, actualMWh(f)));
  check(`2 ${label} trial per day`, () => near(a.trial, f.trial.gridMWh / f.trial.days)); // D-82: 시험 원기간 직접 평균.
  check(`2 ${label} total`, () => near(a.total, actualMWh(f) - f.trial.gridMWh / f.trial.days)); // D-82
  check(`2 ${label} nonnegative`, () => assert.ok(a.actual >= 0 && a.trial >= 0));
  costs(label, a);
}

{
  const f = fixture(), bucket = JSON.parse(storage.get('kcp-build-trial-v1'));
  const t = B.lastTrial(f.trial.map, f.trial.scope); delete t.gridMWh;
  bucket[JSON.stringify([t.scope, t.map])] = t;
  storage.set('kcp-build-trial-v1', JSON.stringify(bucket)); reset();
  check('3 legacy lastTrial still valid', () => assert.ok(B.lastTrial(t.map, t.scope)));
  const a = M.outageAttribution(f.V, f.res, id);
  check('3 missing gridMWh decomposition', () => assert.ok(a));
  check('3 missing gridMWh target', () => assert.equal(a.target, 'grid'));
  check('3 missing gridMWh replay null', () => assert.equal(a.replay, null));
  check('3 missing gridMWh HTML', () => assert.ok(html(f, a).includes('시험 기록에 계통 값 없음')));
}
{
  const f = fixture({ empty: true }), a = M.outageAttribution(f.V, f.res, id);
  check('4 outage fixture', () => assert.ok(f.trial.unsPct >= ZERO || f.res.team[id].unsPct >= ZERO));
  check('4 outage target', () => assert.equal(a.target, 'uns'));
  check('4 outage keys', () => keys(a, trialKeys));
  check('4 outage identity', () => near(sum(a) + a.replay, a.total));
  check('4 outage actual', () => near(a.actual, f.res.team[id].unsPct));
  check('7 promised grid / actual outage notice', () => assert.ok(html(f, a, { topic: 'grid' })
    .includes('이번 달은 실제 정전이 생겨 원인은 정전으로 나눠요')));
  costs('outage', a);
}

// D-80 공통 계약의 엄격한 '<' 경계. 분해 대상만 통제하는 공개 입력 픽스처.
for (const side of ['trial', 'actual']) for (const value of [.004999, .005, .005001]) {
  const f = fixture(), bucket = JSON.parse(storage.get('kcp-build-trial-v1'));
  if (side === 'trial') {
    const record = bucket[JSON.stringify([f.trial.scope, f.trial.map])]; record.unsPct = value;
    storage.set('kcp-build-trial-v1', JSON.stringify(bucket));
  } else f.res.team[id].unsPct = value;
  reset();
  const a = M.outageAttribution(f.V, f.res, id);
  check('4 boundary ' + side + '=' + value, () => assert.equal(a.target, value < ZERO ? 'grid' : 'uns'));
}

// 5: 월간 대상은 두 달 실제로 결정. 빈 계획도 포함하여 대상을 제외하지 않는다.
for (const empty of [false, true]) {
  const S = game({ empty }), before = operate(S);
  C.host(S, 'next', 0);
  const f = operate(S, trial(S)), a = M.outageAttributionMonthly(f.V, f.res, id);
  const target = before.res.team[id].unsPct < ZERO && f.res.team[id].unsPct < ZERO ? 'grid' : 'uns';
  check(`5 ${empty} fixture target`, () => assert.equal(target, empty ? 'uns' : 'grid'));
  check(`5 ${empty} monthly target`, () => assert.equal(a.target, target));
  check(`5 ${empty} basis`, () => assert.equal(a.basis, 'monthly'));
  check(`5 ${empty} keys`, () => keys(a, monthlyKeys));
  check(`5 ${empty} monthly identity`, () => near(sum(a), a.total));
  check(`5 ${empty} replay outside sum`, () => assert.equal(a.replayOutsideSum, true));
  const base = target === 'grid' ? actualMWh(before) : before.res.team[id].unsPct;
  const actual = target === 'grid' ? actualMWh(f) : f.res.team[id].unsPct;
  check(`5 ${empty} base`, () => near(a.trial, base));
  check(`5 ${empty} actual`, () => near(a.actual, actual));
  check(`5 ${empty} total`, () => near(a.total, actual - base));
  costs(`monthly-${target}`, a);
}

// 합성 frozen은 표시 계약 전용. 수치·키는 새 구현 출력에서 복사하지 않는다.
function synthetic(f, target, values, base = 1000) {
  const parts = trialKeys.map((key, i) => ({ key, value: values[i] }));
  return { id, round: f.res.round, basis: 'trial', target, ...(target === 'grid' ? { unit: 'MWh/일' } : {}), trial: base, // D-82: 새 단위 고정본.
    actual: base + values.reduce((n, v) => n + v, 0), total: values.reduce((n, v) => n + v, 0),
    replay: 0, parts, simulations: 4, gridFills: 4, ms: 0,
    grid: { value: 0, waitingMW: 0 }, clues: Object.fromEntries(trialKeys.map(k => [k, '가상 단서'])),
    clueMore: Object.fromEntries(trialKeys.map(k => [k, '가상 상세 단서'])), hasConnectedWind: false };
}
{
  const f = fixture(), old = synthetic(f, 'uns', [1, -2, .5, .25], 10);
  delete old.target; old.parts.push({ key: 'gridImport', value: -3 });
  old.clues.gridImport = '가상 계통 수입 단서';
  old.total -= 3; old.actual -= 3;
  check('6 legacy frozen %p / gridImport name', () => {
    const text = html(f, old);
    assert.ok(text.includes('%p')); assert.ok(text.includes('계통 수입'));
  });
  const grid = synthetic(f, 'grid', [100, -40, 20, -10]);
  const text = html(f, grid);
  check('8 grid heading', () => assert.ok(text.includes('바깥 계통에 기댄 전기 변화의 원인 하나')));
  check('8 grid units', () => {
    // 접속 반사실 등 합계 밖 설명은 제외하고 카드·폭포·판정 영역을 각각 검사한다.
    for (const region of ['cards', 'waterfall', 'verdict']) {
      const area = elementHTML(text, 'lg-outage-' + region);
      assert.ok(area, region + ' exists');
      assert.ok(area.includes('MWh/일'), region + ' MWh/일'); // D-82
      assert.ok(!area.includes('%p'), region + ' no %p');
    }
    const sizes = [...text.matchAll(/class="lg-out-size"[^>]*>([^<]+)</g)];
    assert.ok(sizes.length >= 2);
    assert.ok(sizes.every(m => /[+−-]?[\d,]+\.\d MWh\/일/.test(m[1])), '몫 소수 첫째 자리 MWh/일'); // D-82
  });
  check('8 largest includes cost', () => assert.ok((text.match(/<p>가장 큰 것[^]*?<\/p>/)?.[0] || '').includes('억'), '최대 몫 판정 줄의 비용'));
  for (const base of [0, 10, 1000, -1000]) {
    const threshold = minPart(base), counts = [];
    for (const factor of [.999999, 1.000001]) {
      const a = synthetic(f, 'grid', [threshold * 3, threshold * factor, 0, 0], base);
      const closed = M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a });
      counts.push([...closed.matchAll(/data-missed="([^"]+)"/g)].length);
    }
    check(`9 threshold base=${base}`, () => assert.deepEqual(counts, [0, 2]));
  }
}

// 10·11: 판정·비용 자료만 출력. 달 수·최대 키 분포·시간에는 합격선을 두지 않는다.
{
  const S = game(), largestMonths = Object.fromEntries(monthlyKeys.map(key => [key, 0])), months = [];
  let gridMonths = 0, missingTargetMonths = 0;
  for (let month = 1; month <= 12; month++) {
    if (month > 1) C.host(S, 'next', 0);
    const f = operate(S, trial(S, 1)), a = M.outageAttribution(f.V, f.res, id);
    if (!a?.target) missingTargetMonths++;
    if (a?.target === 'grid') {
      gridMonths++;
      // MWh 소수 첫째 자리 표시값이 같으면 공동 최대(D-80 C-7).
      const rounded = a.parts.filter(p => Math.abs(p.value) >= minPart(a.trial))
        .map(p => ({ key: p.key, size: Math.round(Math.abs(p.value) * 10) }));
      const largest = Math.max(...rounded.map(p => p.size));
      if (rounded.length)
        for (const p of rounded.filter(p => p.size === largest)) largestMonths[p.key] = (largestMonths[p.key] || 0) + 1;
    }
    months.push({ month, target: a?.target ?? null, simulations: a?.simulations ?? null,
      gridFills: a?.gridFills ?? null, ms: a?.ms ?? null });
  }
  console.log(JSON.stringify({ report: '10-largest-months', fixture: `${CITY_NAME} 정상 시작 계획 유지, fixed salt=0, 시험 seed=1`,
    gridMonths, missingTargetMonths, largestMonths, note: '공동 최대는 각 키에 집계; 4차 계통 수입 9/10달과 비교할 자료' }));
  console.log(JSON.stringify({ report: '11-monthly-cost', months }));
}
console.log(`D80 S7: ${checks} checks, ${failures} failures`);
process.exitCode = failures ? 1 : 0;
