'use strict';
// D-81 / RECAL-SPEC §8 #31 / D-72 독립 수용 검사. Node VM만 사용한다.
// 실행: node tests/league/review/38-d81-buildlead.js (Git 읽기만, 브라우저·네트워크 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { withoutD90, withoutGroupOwn } = require('./d90-public-contract');
const ROOT = path.resolve(__dirname, '../../..');
const BEFORE = '777805a', IMPLEMENTATION = '249a41b';
const plain = x => JSON.parse(JSON.stringify(x));
const clone = structuredClone;
let assertions = 0;
const failures = [];
const mutations = [];
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const eq = (actual, expected, label) => { assertions++; assert.deepEqual(plain(actual), plain(expected), label); };
function test(label, fn) {
  try { fn(); }
  catch (e) { failures.push({ label, error: e.message }); console.error(`FAIL ${label}: ${e.stack}`); }
}
const gitSource = (ref, name) => execFileSync('git', ['show', `${ref}:ui/${name}.js`],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const read = name => fs.readFileSync(path.join(ROOT, 'ui', `${name}.js`), 'utf8');

// 36-h03-h04.js와 같은 IIFE 노출 방식. 함수 본문은 바꾸지 않는다.
// build.js가 제공하는 실제 gradeWords를 사용하며 등급 대역은 넣지 않는다.
function engine(ref, overrides = {}) {
  const ctx = vm.createContext({ console, structuredClone, performance,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    KCP: { route() {}, on() {}, esc: String, leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("씨앗 없는 난수 금지"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core',
    ...(ref ? [] : ['league'])]) {
    let source = overrides[name] ?? (ref ? gitSource(ref, name) : read(name));
    if (name === 'league') {
      const end = /\}\)\(\);\s*$/;
      ok(end.test(source), 'league IIFE 노출 연결점');
      source = source.replace(end, 'KCP.__d81 = { speedsHTML, buildLeadHTML };\n})();');
    }
    vm.runInContext(source, ctx, { filename: `${ref || 'worktree'}/ui/${name}.js` });
  }
  return ctx.KCP;
}
function game(K) {
  const C = K.leagueCore, ids = C.regionOf('south').teams.map(t => t.id);
  return C.newState('D81FIXTURE', 'south', 0, ids, { turns: 24, seedMode: 'fixed' });
}
function line(html, id) { return html.match(new RegExp(`<p id="${id}">([^<]*)</p>`))?.[1]; }
function keyPaths(value, prefix = '', paths = new Set()) {
  if (Array.isArray(value)) value.forEach(v => keyPaths(v, `${prefix}[]`, paths));
  else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    paths.add(p); keyPaths(v, p, paths);
  }
  return [...paths].sort();
}
const K = engine(), D = K.ECON_DATA, U = K.__d81, C = K.leagueCore;
const S = game(K), E = plain(C.publicView(S, 0).econ);
const YEARS = { solar: 2, wind: 3, ess: 1, biomass: 4, diesel: 2, smr: 6 };
const KOREA = { lngMonths: [27, 32], windPermitYears: 10, gridYears: [5, 15] };
const NAMES = { solar: '태양광', wind: '육상풍력', ess: '배터리(ESS)', biomass: '바이오매스', diesel: '디젤', smr: 'SMR' };

test('params: 명세의 값·등급·자료 출처', () => {
  eq(D.params.buildLeadYears?.v, YEARS, 'EIA lead time 6종');
  eq(D.params.buildLeadYears.grade, 'P', 'EIA 가정값 등급');
  eq(D.params.buildLeadKorea?.v, KOREA, '한국 사례와 송전망 범위');
  eq(D.params.buildLeadKorea.grade, 'O*', '한국 사례 등급');
  ok(D.params.buildLeadYears.note.includes('EIA AEO2022'), 'EIA AEO2022 출처');
  ok(D.params.buildLeadYears.note.includes('W6-report.md'), 'W6 조사 문서 출처');
  ok(D.params.buildLeadKorea.note.includes('한국') && D.params.buildLeadKorea.note.includes('보도'), '한국 사례의 보도 근거');
  ok(D.params.buildLeadKorea.note.includes('IEA') && D.params.buildLeadKorea.note.includes('P'), '송전망은 별도 IEA P 근거');
});

function checkDisplay(years, korea, label) {
  const beforeE = clone(E), beforeD = clone(D), beforeT = clone(K.TECH_DATA.params);
  const html = U.speedsHTML(E), lead = line(html, 'lg-build-lead'), rule = line(html, 'lg-build-rule');
  eq((html.match(/id="lg-build-lead"/g) || []).length, 1, `${label}: 실제 기간 한 줄`);
  eq((html.match(/id="lg-build-rule"/g) || []).length, 1, `${label}: 게임 규칙 한 줄`);
  ok(/<details id="lg-speeds">[\s\S]*id="lg-build-lead"[\s\S]*id="lg-build-rule"[\s\S]*<\/details>/.test(html), `${label}: 배속표 안에 두 줄`);
  for (const [key, name] of Object.entries(NAMES)) ok(lead.includes(`${name} ${years[key]}년`), `${label}: ${key} 숫자`);
  ok(lead.includes(`LNG 복합 ${korea.lngMonths.join('~')}개월`), `${label}: 한국 LNG 범위`);
  ok(lead.includes(`육상풍력은 인허가까지 약 ${korea.windPermitYears}년`), `${label}: 한국 풍력 인허가`);
  ok(lead.includes(`미국 에너지정보청 가정값 · ${K.gradeWords('P')}`), `${label}: 미국 값 옆 P 낱말`);
  ok(lead.includes(`한국 사례 · ${K.gradeWords('O*')}: LNG 복합`), `${label}: 한국 사례 옆 O* 낱말`);
  ok(lead.includes(`송전망은 계획·인허가부터 완공까지 ${korea.gridYears.join('~')}년(국제에너지기구 · ${K.gradeWords('P')})`), `${label}: 송전망 값 옆 별도 P 낱말`);
  ok(!/\((?:O\*?|P|M|G)\)/.test(lead + rule), `${label}: 내부 등급 글자 노출 없음`);
  ok(rule.includes(`SMR만 공사 ${K.TECH_DATA.params.smrTurns.v}달`), `${label}: TECH_DATA SMR 달 수`);
  ok(rule.includes('다른 설비는 바로 지어져 전력망 접속만 기다려요'), `${label}: 다른 설비 공사 생략·접속 대기 공개`);
  ok(rule.includes('SMR이 현실보다 상대적으로 불리하게'), `${label}: 비대칭의 의미 공개`);
  ok(rule.includes(K.gradeWords('G')), `${label}: 게임 규칙 G 낱말`);
  eq(E, beforeE, `${label}: 입력 공개 경제 상태 불변`);
  eq(D, beforeD, `${label}: 표시가 자료를 바꾸지 않음`);
  eq(K.TECH_DATA.params, beforeT, `${label}: 표시가 기술 규칙을 바꾸지 않음`);
}
test('speedsHTML: 실제 params의 기간·근거·규칙 표시', () => checkDisplay(YEARS, KOREA, '기본'));
test('speedsHTML: 모든 기간 params와 TECH_DATA 변경을 즉시 반영', () => {
  const years = clone(D.params.buildLeadYears.v), korea = clone(D.params.buildLeadKorea.v);
  const turns = K.TECH_DATA.params.smrTurns.v;
  try {
    // 기본값과 겹치지 않는 값으로 하드코딩·서로 다른 항목의 오연결을 잡는다.
    const changedYears = { solar: 11, wind: 13, ess: 17, biomass: 19, diesel: 23, smr: 29 };
    const changedKorea = { lngMonths: [31, 47], windPermitYears: 37, gridYears: [41, 53] };
    D.params.buildLeadYears.v = changedYears; D.params.buildLeadKorea.v = changedKorea;
    K.TECH_DATA.params.smrTurns.v = 7;
    eq(E.speeds.smrTurns, 12, '옛 공개 speeds의 12달과 다른 기술값 7달 fixture');
    checkDisplay(changedYears, changedKorea, '변형');
  } finally {
    D.params.buildLeadYears.v = years; D.params.buildLeadKorea.v = korea;
    K.TECH_DATA.params.smrTurns.v = turns;
  }
});

// ECON_DATA.params 자체는 기존 경제 자료 계약이다. D-81의 새 항목이 없는 옛 자료와
// 각 항목의 v가 없는 경우에도 공사 기간 조각만 빈 문자열로 빠져야 한다.
for (const missing of [['buildLeadYears'], ['buildLeadKorea'], ['buildLeadYears', 'buildLeadKorea']]) {
  test(`기간 params 누락: ${missing.join('·')}`, () => {
    const saved = Object.fromEntries(missing.map(key => [key, D.params[key]]));
    try {
      for (const key of missing) delete D.params[key];
      eq(U.buildLeadHTML(), '', '누락이면 예외 없이 빈 문자열');
      const html = U.speedsHTML(E);
      ok(html.includes('id="lg-speeds"'), '기존 배속표는 유지');
      ok(!html.includes('id="lg-build-lead"') && !html.includes('id="lg-build-rule"'), '불완전한 기간·규칙 줄 생략');
    } finally { Object.assign(D.params, saved); }
  });
}
for (const key of ['buildLeadYears', 'buildLeadKorea']) test(`기간 값 누락: ${key}.v`, () => {
  const saved = D.params[key].v;
  try { delete D.params[key].v; eq(U.buildLeadHTML(), '', 'v 누락도 예외 없이 빈 문자열'); }
  finally { D.params[key].v = saved; }
});

test('D-81 커밋: smrTurns·공사 대기·발전 계산 코드 불변', () => {
  for (const name of ['tech-data', 'league-core', 'build']) {
    const before = gitSource(BEFORE, name);
    ok(gitSource(IMPLEMENTATION, name) === before, `${name}: D-81이 기존 규칙 코드를 바꾸지 않음`);
  }
  eq(K.TECH_DATA.params.smrTurns.v, 12, 'SMR 공사 12달 유지');
  // 작업 파일은 실제 착공→계획 재전송→대기→발전만 비교한다. HUD 등의 변경은
  // 이 계약과 무관하다. 양쪽 엔진 모두 같은 고정 씨앗의 합법 SMR 한 기를 운전한다.
  function smrTrace(runtime) {
    const core = runtime.leagueCore, bg = runtime.buildGame, state = game(runtime);
    const id = state.active[0], region = core.regionOf(state.region), token = 'd81-smr-trace';
    ok(core.host(state, 'next', 0), 'SMR 비교: 첫 달 시작');
    ok(core.reduce(state, { type: 'claim', team: id, token }, 0).ok, 'SMR 비교: 팀 입장');
    bg.selectPack(core.teamDef(region, id).pack, 'league');
    const anchor = bg.SITES.find(s => s.dem).tile;
    const tile = bg.TILES.find(t => !t.out && t.site < 0 && !bg.siteRule('smr', t) && bg.routePath(anchor, t.i));
    ok(tile, 'SMR 비교: 냉각수·내부 연결을 갖춘 입지');
    const plan = { builds: [{ t: 'smr', i: tile.i }], lines: [{ p: bg.routePath(anchor, tile.i) }] };
    // bg 인수 없이도 실제 reduce의 공사 등록을 사용한다(입지 검증은 위에서 수행).
    ok(core.reduce(state, { type: 'plan', team: id, token, rev: 1, plan }, 0).ok, 'SMR 비교: 착공');
    state.teams[id].research = { adopted: ['smr'] };
    const trace = [];
    for (const round of [1, 5, 12, 13, 14]) {
      state.round = round;
      if (round === 5) ok(core.reduce(state, { type: 'plan', team: id, token, rev: 2, plan }, 0).ok,
        'SMR 비교: 재전송에도 착공 기록 유지');
      const mods = core.modsFor(state, region, id);
      const sim = bg.simulate(bg.sanitize({ ...plan, season: 'winter', seed: 8101 }, 1e9), 1, { league: true, mods });
      const smrMWh = sim.tot.by.smr || 0;
      ok(round < 13 ? smrMWh === 0 : smrMWh > 0, `${round}달: 실제 SMR 완공 전 0·완공 후 발전`);
      trace.push({ round, construction: clone(state.teams[id].construction),
        disabledBuilds: mods.disabledBuilds || [], smrMWh, fuel: sim.tot.fuel, co2: sim.tot.co2 });
    }
    return trace;
  }
  eq(smrTrace(K), smrTrace(engine(BEFORE)), '777805a 대비 SMR 착공·readyRound·disabledBuilds·발전량·연료·CO₂ 불변');
});

// 천안의 실제 지도·기준 피크에서 2달째 태양광 한 기를 짓는다. 접속이 5달째
// 끝나므로 4달째부터 속도가 달라지는 회귀도 진행량과 가동 시점으로 검출한다.
// 경제·사건은 고정하고 reduce → gridStatus → modsFor → simulate를 매달 실행한다.
function solarTrace(runtime, plan) {
  const core = runtime.leagueCore, bg = runtime.buildGame, state = game(runtime);
  const id = 'cheonan', region = core.regionOf(state.region), token = 'd81-solar-trace';
  ok(core.host(state, 'next', 0), '태양광 비교: 첫 달 시작');
  ok(core.reduce(state, { type: 'claim', team: id, token }, 0).ok, '태양광 비교: 팀 입장');
  state.events = [];
  const trace = [];
  for (let round = 1; round <= 8; round++) {
    state.round = round;
    if (round === 2 || round === 4) {
      const out = core.reduce(state, { type: 'plan', team: id, token, rev: round, plan: clone(plan) }, 0, bg);
      ok(out.ok, `태양광 비교 ${round}달: ${round === 2 ? '착공' : '계획 재전송'} (${out.err || 'ok'})`);
      eq(state.teams[id].plan.builds.map(({ t, i }) => ({ t, i })), plan.builds, '실제 승인된 태양광 한 기');
    }
    state.grid[id] = core.gridStatus(state, region, bg, id, true);
    const mods = core.modsFor(state, region, id);
    const sim = bg.simulate(bg.sanitize({ ...(state.teams[id].plan || {}), season: 'winter', seed: 8101 }, 1e9),
      1, { league: true, mods });
    // 재생 발전은 by(급전 발전원별 집계)가 아니라 ren에 모인다. 이 계획의
    // 유일한 재생 설비가 태양광이므로 실제 태양광 발전량을 그대로 읽는다.
    const solarMWh = sim.tot.ren;
    trace.push({ round, construction: clone(state.teams[id].construction || {}),
      grid: clone(state.grid[id]), disabledBuilds: clone(mods.disabledBuilds || []),
      solarMWh, running: solarMWh > 0 });
  }
  return trace;
}
function assertSolarTrace(actual, expected) {
  assert.deepEqual(plain(actual), plain(expected), '777805a 대비 태양광 착공·접속 진행·disabledBuilds·가동 불변');
}
test('777805a 대비 태양광 8달: 즉시 건설·접속 대기·발전, 4달째 속도 변형 검출', () => {
  const previous = engine(BEFORE), bg = previous.buildGame, core = previous.leagueCore;
  bg.selectPack(core.teamDef(core.regionOf('south'), 'cheonan').pack, 'league');
  const anchor = bg.SITES.find(s => s.dem).tile;
  const tile = bg.TILES.find(t => !t.out && t.site < 0 && !bg.siteRule('solar', t) && bg.routePath(anchor, t.i));
  ok(tile, '태양광 비교: 합법 입지·내부 전선');
  // 기준 판에서 한 번 만든 동일 입력을 작업 판·변형 판에도 복사해 전달한다.
  const plan = { builds: [{ t: 'solar', i: tile.i }], lines: [{ p: bg.routePath(anchor, tile.i) }] };
  const baseline = solarTrace(previous, plan), current = solarTrace(K, plan);
  assertions++;
  assertSolarTrace(current, baseline);
  for (const step of current) {
    eq(step.construction, {}, `${step.round}달: 태양광 공사·readyRound 대기 없음`);
    eq(step.disabledBuilds, [], `${step.round}달: 태양광 공사 차단 없음`);
    eq(step.running, step.round >= 5, `${step.round}달: 전량 접속 전 대기·5달째부터 발전`);
    if (step.round >= 2 && step.round < 5) {
      ok(step.grid.entries[0].allocatedMW > 0 && step.grid.entries[0].allocatedMW < step.grid.entries[0].mw,
        `${step.round}달: 실제 부분 접속 진행`);
    }
  }

  const source = read('league-core');
  const speed = 'const monthlyMW = local.peakMW * (P.connPerMonthReal.v * P.eduConn.v);';
  eq(source.split(speed).length - 1, 1, '속도 변형 연결점 한 곳');
  const changed = source.replace(speed, speed.replace(';', ' * (S.round >= 4 ? 2 : 1);'));
  const mutant = solarTrace(engine(undefined, { 'league-core': changed }), plan);
  eq(mutant.slice(0, 3), baseline.slice(0, 3), '속도 변형은 첫 3달에 영향 없음');
  ok(mutant[3].grid.entries[0].allocatedMW > baseline[3].grid.entries[0].allocatedMW,
    '4달째 속도 2배 변형이 실제 접속 진행량을 바꿈');
  eq(mutant.find(step => step.running)?.round, 4, '속도 변형은 4달째 조기 가동');
  assertions++;
  assert.throws(() => assertSolarTrace(mutant, baseline), assert.AssertionError,
    '본 태양광 동작 비교가 소스 사본의 접속 속도 회귀를 거부');
  mutations.push({ kind: '4달째부터 접속 속도 2배', detected: true, baselineOnline: 5, mutantOnline: 4 });
});

test('공사 규칙 실행: SMR만 12달 대기·완공 경계', () => {
  const state = game(K), id = state.active[0], token = 'd81-core-fixture';
  ok(C.host(state, 'next', 0), '첫 달 시작');
  ok(C.reduce(state, { type: 'claim', team: id, token }, 0).ok, '가상 팀 입장');
  // 입지·예산은 이 검사의 대상이 아니다. bg 없이 실제 reduce의 공사 등록을 실행한다.
  const builds = ['smr', 'solar', 'wind', 'battery', 'biomass', 'diesel'].map((t, i) => ({ t, i: 100 + i }));
  const out = C.reduce(state, { type: 'plan', team: id, token, rev: 1, plan: { builds, lines: [] } }, 0);
  ok(out.ok, `공사 계획 반영: ${out.err || 'ok'}`);
  eq(state.teams[id].construction, { 'smr:100': { startRound: 1, readyRound: 13 } }, 'SMR만 1월 착공→13월 완공');
  for (const round of [1, 12, 13, 14]) {
    state.round = round;
    eq(C.modsFor(state, C.regionOf(state.region), id).disabledBuilds || [], round < 13 ? ['smr:100'] : [], `${round}달: 공사 대기 경계`);
  }
});

test('집단 전용 항: 승인 경로·모양만 정규화하고 원본과 다른 경로 보존', () => {
  const view = { sid: undefined, teams: { pyeongtaek: { groupOwn: 9, groupOwnLag: 8, hospRel: 7 } },
    econ: { cities: { pyeongtaek: { cash: 12, groupOwn: { senior: { complaint: -10, complaintN: 2, sitingN: 1 },
      youth: { hospital: -.29, outage: -2, share: .01, save: -1, unrest: -3, bounds: .02 } },
      groupOwnLag: { senior: { complaint: -1.52 } }, hospRel: -.29 } },
      before: { pyeongtaek: { groupOwn: 6 } } }, results: [{ econ: { groupOwn: 5 } }] };
  const original = clone(view), normalized = withoutGroupOwn(view);
  assertions++; assert.deepEqual(normalized, { sid: undefined, teams: original.teams,
    econ: { cities: { pyeongtaek: { cash: 12 } }, before: original.econ.before }, results: original.results });
  assertions++; assert.deepEqual(view, original, '검증·제거가 원본 상태를 바꾸지 않음');
  assertions++; assert.deepEqual(withoutGroupOwn({ econ: { cities: { pyeongtaek: { groupOwn: {}, hospRel: 0 } } } },
    { internal: true }), { econ: { cities: { pyeongtaek: { hospRel: 0 } } } }, '내부 상태의 빈 목표 객체만 승인');
  assertions++; assert.deepEqual(withoutGroupOwn(view, { internal: true }).econ.cities.pyeongtaek,
    { cash: 12, groupOwnLag: { senior: { complaint: -1.52 } }, hospRel: -.29 }, '내부 상태에서 공개 전용 예외로 확장하지 않음');

  const reject = (city, internal = false) => {
    assertions++;
    assert.throws(() => withoutGroupOwn({ econ: { cities: { pyeongtaek: city } } }, { internal }),
      assert.AssertionError, JSON.stringify(city));
  };
  for (const internal of [false, true]) {
    for (const bad of [null, [], 1, { unknown: { save: 1 } }, { senior: {} },
      { senior: { extra: 1 } }, { senior: { complaintN: 1 } }, { senior: { complaint: -1 } },
      { senior: { complaint: -1, complaintN: 0 } }, { senior: { complaint: -1, complaintN: 1.5 } },
      { senior: { complaint: -1, complaintN: 1, sitingN: 0 } },
      { senior: { complaint: -1, complaintN: 1, sitingN: 2 } }]) reject({ groupOwn: bad }, internal);
    for (const bad of [0, -0, .001, NaN, Infinity, '1', null]) reject({ groupOwn: { senior: { save: bad } } }, internal);
  }
  reject({ groupOwn: {} });
  for (const bad of [null, [], {}, { unknown: { save: 1 } }, { senior: {} },
    { senior: { other: 1 } }, { senior: { complaint: -1, complaintN: 1 } }]) reject({ groupOwnLag: bad });
  for (const bad of [0, .001, NaN, Infinity, '1', null]) {
    reject({ groupOwnLag: { senior: { save: bad } } }); reject({ hospRel: bad });
  }
});

test('777805a 대비 publicView·speeds 키 집합과 값 불변', () => {
  const previous = engine(BEFORE), oldC = previous.leagueCore, old = game(previous), current = game(K);
  // E1(10-21) 근사 표시 추가, 문장 비교 제외. speeds.items.note와 공개
  // 뉴스의 문장은 바뀔 수 있다. 공개 키 구조와 모든 숫자 값은 계속 비교한다.
  const numericValues = (value, prefix = '', values = {}) => {
    if (typeof value === 'number') values[prefix] = value;
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value))
      numericValues(child, `${prefix}.${key}`, values);
    return values;
  };
  eq(previous.TECH_DATA.params.smrTurns.v, K.TECH_DATA.params.smrTurns.v, '이전 SMR 달 수 동일');
  for (const phase of ['lobby', 'plan', 'review']) {
    if (phase === 'plan') {
      ok(oldC.host(old, 'next', 0) && C.host(current, 'next', 0), '양쪽 첫 달 시작');
    } else if (phase === 'review') {
      ok(!!oldC.run(old, previous.buildGame, 0) && !!C.run(current, K.buildGame, 0), '양쪽 실제 운영');
    }
    eq(current.phase, phase, `${phase}: 비교 단계`);
    const before = plain(oldC.publicView(old, 0)), rawAfter = plain(C.publicView(current, 0)),
      after = withoutGroupOwn(withoutD90(rawAfter));
    eq(keyPaths(after), keyPaths(before), `${phase}: 중첩 공개 키 집합 동일`);
    eq(Object.keys(after.econ.speeds).sort(), Object.keys(before.econ.speeds).sort(), `${phase}: speeds 키 집합 동일`);
    eq(after.econ.speeds.items.map(item => item.key), before.econ.speeds.items.map(item => item.key),
      `${phase}: speeds.items 키·순서 동일`);
    eq(numericValues(after), numericValues(before), `${phase}: 공개 상태 숫자 값도 동일`);
    if (phase === 'review') {
      const id = current.active[0];
      for (const [name, mutate] of [
        ['월 보수비 0→1', v => { v.results[0].team[id].cost.repair = 1; }],
        ['별도 세출 0→1', v => { v.econ.report.fiscal[id].exp.repair = 1; }],
        ['미승인 중첩 키', v => { v.results[0].team[id].cost.unapproved = 0; }],
        ['기존 현금 수치', v => { v.econ.cities[id].cash += 1; }],
        ['팀 상태쪽 repair 키', v => { v.teams[id].repair = 0; }],
        ...['groupOwn', 'groupOwnLag', 'hospRel'].map(key =>
          [`팀 상태쪽 ${key} 키`, v => { v.teams[id][key] = 0; }]),
        ['과거 상태쪽 groupOwn 키', v => { v.econ.before[id].groupOwn = {}; }],
        ['목표 전용 항 0 노출', v => { v.econ.cities[id].groupOwn = { senior: { save: 0 } }; }],
        ['반영 전용 항 정밀도', v => { v.econ.cities[id].groupOwnLag = { senior: { save: .001 } }; }],
        ['병원 몫 0 노출', v => { v.econ.cities[id].hospRel = 0; }]
      ]) {
        const changed = clone(rawAfter); mutate(changed);
        assertions++;
        assert.throws(() => {
          const normalized = withoutGroupOwn(withoutD90(changed));
          assert.deepEqual(keyPaths(normalized), keyPaths(before));
          assert.deepEqual(numericValues(normalized), numericValues(before));
        }, assert.AssertionError, `${name}: 승인 경로 예외로 가려지지 않음`);
        mutations.push({ kind: name, detected: true });
      }
    }
    const stateBefore = clone(current), dataBefore = clone(D);
    U.speedsHTML(after.econ);
    eq(current, stateBefore, `${phase}: 표시 후 게임 상태 불변`);
    eq(D, dataBefore, `${phase}: 표시 후 params 불변`);
  }
  const viewBefore = plain(C.publicView(current, 0)), years = D.params.buildLeadYears.v, korea = D.params.buildLeadKorea.v;
  try {
    D.params.buildLeadYears.v = { ...YEARS, solar: 99 };
    D.params.buildLeadKorea.v = { ...KOREA, windPermitYears: 88 };
    eq(C.publicView(current, 0), viewBefore, '기기 안 공사 기간 자료는 공개 상태에 추가되지 않음');
  } finally { D.params.buildLeadYears.v = years; D.params.buildLeadKorea.v = korea; }
});

// 팀 요청 경로를 명시한다. local·supabase의 send와 내부 전송 함수도 통째로 비교한다.
// bytes·secure·sessionId, algorithm·signing, MAX_BYTES·SEND_CAP·ACK_WAIT와 내보내기는
// 아래 나머지 소스 비교에 포함되어 서명 방식·순번·크기 제한의 변경도 실패한다.
const requestFunctions = {
  'league-core': ['reduce'],
  league: ['send', 'sendPlan'],
  'league-net': ['publicJWK', 'createIdentity', 'fingerprint', 'signEnvelope', 'verifyEnvelope',
    'requestBody', 'receiver', 'broadcastMessage', 'local', 'supabase']
};
function functionSource(source, name) {
  const pattern = new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}`, 'm');
  const found = source.match(pattern)?.[0];
  assert.ok(found, `${name}: 요청·축약 함수 비교 연결점`);
  return found;
}
function withoutSnapshotChanges(source) {
  for (const name of ['snapshotEnvelope', 'compactSnapshot', 'expandSnapshot'])
    source = source.replace(functionSource(source, name), `  function ${name} /* snapshot */`);
  // D-77의 경로 설명 주석과 새 상수 한 줄만 제외한다. snapshotRows 등은 계속 비교한다.
  return source.replace(/^  \/\/ D-77:[^\n]*\n(?:  \/\/[^\n]*\n)*/m, '')
    .replace(/^  const snapshotRefs = [^\n]*\n/m, '');
}
function assertRequestsUnchanged(current, previous) {
  for (const [name, functions] of Object.entries(requestFunctions)) for (const fn of functions)
    assert.equal(functionSource(current[name], fn), functionSource(previous[name], fn),
      `D-65 ${name}.${fn}: 팀 요청 생성·수신 형식 바이트 불변`);
  assert.equal(withoutSnapshotChanges(current['league-net']), withoutSnapshotChanges(previous['league-net']),
    'D-65 league-net: snapshotRefs·snapshotEnvelope·compactSnapshot·expandSnapshot 외 소스 바이트 불변');
}
const requestSources = Object.fromEntries(Object.keys(requestFunctions).map(name => [name, read(name)]));
const previousRequests = Object.fromEntries(Object.keys(requestFunctions).map(name => [name, gitSource('186e182', name)]));
test('D-65 팀→진행자 요청 형식은 D-90 이전과 동일', () => {
  assertRequestsUnchanged(requestSources, previousRequests); assertions++;
});
test('D-65 변이: 팀 요청 서명 함수 한 글자 변경을 거부', () => {
  const source = requestSources['league-net'], signature = functionSource(source, 'signEnvelope');
  const changed = signature.replace('n: identity.n', 'm: identity.n');
  ok(changed !== signature, '서명 요청 순번 키 n→m 한 글자 변이 연결점');
  assertions++;
  assert.throws(() => assertRequestsUnchanged({ ...requestSources,
    'league-net': source.replace(signature, changed) }, previousRequests),
  { name: 'AssertionError', message: /D-65 league-net\.signEnvelope/ }, '실제 요청 비교가 서명 함수 변이를 검출');
  mutations.push({ kind: '팀 요청 signEnvelope 순번 키 n→m 한 글자', detected: true });
});
test('D-65 변이: 비교에서 제외하지 않은 행 사전·크기 제한 변경을 거부', () => {
  for (const [from, to] of [['snapshotRows(view, row, packing)', 'snapshotRows(view, row, packinG)'],
    ['const SEND_CAP = 256000;', 'const SEND_CAP = 256001;']]) {
    const source = requestSources['league-net'];
    eq(source.split(from).length - 1, 1, `${from}: 변이 연결점 한 곳`);
    assertions++;
    assert.throws(() => assertRequestsUnchanged({ ...requestSources,
      'league-net': source.replace(from, to) }, previousRequests),
    { name: 'AssertionError', message: /snapshotRefs·snapshotEnvelope·compactSnapshot·expandSnapshot 외/ },
    '축약 함수 일부를 제외해도 나머지 소스 변경은 검출');
  }
});

console.log(JSON.stringify({ suite: '38-d81-buildlead', assertions, failures: failures.length, details: failures, mutations }));
process.exitCode = failures.length ? 1 : 0;
