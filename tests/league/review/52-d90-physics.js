'use strict';
// 독립 D-90 계약: docs/DECISIONS.md D-90의 범위 정정 및 D90-design.md 끝 총괄 판정.
// 기대값은 결정의 숫자로 계산한다. UI/기존 검사 파일은 고치지 않는다.
// node tests/league/review/52-d90-physics.js (Node VM만, 브라우저·네트워크 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..'), BEFORE = '186e182';
const MODULES = ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league'];
// 도시 지도도 필요하다. 누락하면 해안·석탄·공장 사건이 양쪽 VM에서 같이 사라져 거짓 일치한다.
const DRAW_MODULES = ['build-maps', 'tech-data', 'econ-data', 'econ', 'league-data', 'league-core'];
const IDS = ['hwaseong', 'pyeongtaek', 'anseong', 'dangjin', 'asan', 'cheonan'], ID = 'hwaseong';
const BOARDS = 600, SUITE = '52-d90-physics';
const clone = structuredClone;
const empty = () => ({ builds: [], lines: [], policies: [], rq: [] });
// 독립 산술: 온도차에 사건 x를 한 번만 곱한다. 대응 dev는 여기에 들어가지 않는다.
const lngFactor = x => 1 - (0.226 / 30) * 3 * x;
const pvFactor = x => 1 - 0.004165 * 5 * x;
let assertions = 0, failures = 0;
const mutations = [];
const a = new Proxy(assert, { get(target, key) {
  return typeof target[key] === 'function' ? (...args) => { assertions++; return target[key](...args); } : target[key];
} });
function test(label, fn) {
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) { failures++; console.error(`FAIL ${label}\n${e.stack}`); }
}
function near(got, want, label, tolerance = 1e-8) {
  a.ok(Number.isFinite(got) && Math.abs(got - want) <= tolerance * Math.max(1, Math.abs(want)),
    `${label}: actual=${got}, expected=${want}`);
}
function replaceOne(source, from, to) {
  // 연결점이 사라진 변이는 하네스 실패다. 실행 예외를 검출 성공으로 세지 않는다.
  a.equal(source.split(from).length, 2, `VM 연결점이 정확히 하나: ${from}`);
  return source.replace(from, to);
}
const esc = value => String(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function load(sources, drawing = false) {
  const session = { role: 'solo', team: ID, room: 'd90-physics-fixture', interview: {} };
  const ctx = vm.createContext({ console, structuredClone, performance, URL, session,
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    document: { documentElement: {}, addEventListener() {} },
    KCP: { route() {}, on() {}, esc, gradeWords: String, leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("씨앗 없는 난수 금지"); };', ctx);
  for (const name of drawing ? DRAW_MODULES : MODULES) {
    let text = sources[name];
    if (!drawing && name === 'league-core') text = replaceOne(text, '  KCP.leagueCore = {',
      '  globalThis.physics = { repairOf, calibrateStart, recordCo2Attribution };\n  KCP.leagueCore = {');
    if (name === 'league') {
      text = replaceOne(text, 'let L = null;', 'let L = globalThis.session;');
      text = replaceOne(text, '  // 검사용\n', '  globalThis.cards = { evCards, evSize, outageAttribution };\n  // 검사용\n');
    }
    vm.runInContext(text, ctx, { filename: `VM:ui/${name}.js`, timeout: 5000 });
  }
  const K = ctx.KCP, C = K.leagueCore;
  return { ctx, K, C, B: K.buildGame, X: K.econ, D: K.ECON_DATA, R: C.regionOf('south'),
    private: ctx.physics, ui: ctx.cards, L: session };
}
function state(h, turns = 12, seed = 'd90-physics-fixture') {
  // 추첨·수식 fixture에서 시작 보정만 생략. 시작 보정 자체는 아래에서 실제 실행한다.
  const bg = h.K.buildGame;
  let S;
  try { delete h.K.buildGame; S = h.C.newState(seed, 'south', 0, IDS, turns ? { turns } : undefined); }
  finally { if (bg) h.K.buildGame = bg; }
  S.round = turns ? 7 : 2; S.phase = 'plan';
  delete S.grid;
  for (const id of IDS) Object.assign(S.teams[id], { plan: empty(), base: [], resp: {}, committed: 0 });
  S.events = [];
  return S;
}
function eventState(h, event, x = 1, response, turns = 12) {
  const S = state(h, turns);
  S.events = [{ id: event, round: S.round, x }];
  if (response) S.teams[ID].resp[`${S.round}:${event}`] = response;
  return S;
}
const bundle = id => id === 'heavy_rain' ? 'monsoon_cloud' : id;
const eventRows = S => Array.from(S.events.filter(e => e.round === S.round), e => ({ id: bundle(e.id), round: e.round, x: e.x }));
// Bin(n, .5)의 정확한 양측 중앙 99.9% 정수 범위. 정규근사나 구현의 q를 읽지 않는다.
function binomial999(n) {
  const p = Array(n + 1).fill(0), m = Math.floor(n / 2); p[m] = 1;
  for (let k = m; k > 0; k--) p[k - 1] = p[k] * k / (n - k + 1);
  for (let k = m; k < n; k++) p[k + 1] = p[k] * (n - k) / (k + 1);
  const total = p.reduce((sum, v) => sum + v, 0);
  let cdf = 0, low, high;
  for (let k = 0; k <= n; k++) {
    cdf += p[k] / total;
    if (low == null && cdf >= 0.0005) low = k;
    if (cdf >= 0.9995) { high = k; break; }
  }
  return [low, high];
}
function drawContract(h, old, turns, boards = BOARDS, report = true) {
  a.ok(IDS.every(id => h.K.BUILD_MAPS[id] && old.K.BUILD_MAPS[id]), '추첨 fixture 도시 지도 모두 로드');
  let heavy = 0, cloud = 0, simultaneous = 0, exclusions = 0, seasonalRain = 0;
  for (let game = 0; game < boards; game++) {
    const seed = `D90-independent-${turns || 'season'}-${game}`;
    const S = state(h, turns, seed), P = state(old, turns, seed);
    for (let round = 1; round <= (turns || 4); round++) {
      S.round = P.round = round;
      const previous = new Set(S.events.filter(e => e.round === round - 1).map(e => bundle(e.id)));
      h.C.drawEvents(S, h.R); old.C.drawEvents(P, old.R);
      const actual = S.events.filter(e => e.round === round), ids = actual.map(e => e.id);
      // x도 완전 일치해야 한다. 주 추첨 난수 한 번 소비도 이 단언이 잡는다.
      a.deepEqual(eventRows(S), eventRows(P), `draw-sequence ${turns || 4}턴 seed=${game} round=${round}`);
      heavy += ids.includes('heavy_rain'); cloud += ids.includes('monsoon_cloud');
      simultaneous += ids.includes('heavy_rain') && ids.includes('monsoon_cloud') ? 1 : 0;
      if (turns) exclusions += actual.filter(e => previous.has(bundle(e.id)) &&
        // 매달 강제 삽입하는 미세먼지 정책은 추첨 묶음 제외 대상이 아니다.
        e.id !== 'finedust_coal_cap').length;
      else {
        seasonalRain += ids.includes('heavy_rain') ? 1 : 0;
        a.equal(ids.includes('heavy_rain'), false, `season-no-rain seed=${game} round=${round}`);
      }
    }
  }
  a.equal(simultaneous, 0, '호우·먹구름 동시 발생 0');
  a.equal(exclusions, 0, '전월 묶음 제외 위반 0');
  if (turns) {
    a.ok(heavy + cloud >= 100, '호우 비율 검산에 충분한 장마 표본');
    const interval = binomial999(heavy + cloud);
    a.ok(heavy >= interval[0] && heavy <= interval[1], `Bin(n,.5) 99.9%: ${heavy}/${heavy + cloud}, range=${interval}`);
    if (report) console.log(JSON.stringify({ mode: `econ-${turns}`, boards, heavy, cloud,
      share: heavy / (heavy + cloud), binomial999: interval, exclusions, simultaneous }));
  } else if (report) console.log(JSON.stringify({ mode: 'season-4', boards, seasonalRain, cloud, simultaneous }));
}
function heatModsContract(h, x, response, dev) {
  const S = eventState(h, 'heatwave_peak', x, response), M = h.C.modsFor(S, h.R, ID);
  near(M.lngCapMul, lngFactor(x), `heat-lng x=${x}/${response || 'none'}`);
  near(M.solarHeatMul, pvFactor(x), `heat-pv x=${x}/${response || 'none'}`);
  near(M.demandMul, 1 + 0.12 * x * dev, `heat-demand x=${x}/${response || 'none'}`);
  a.deepEqual(Array.from(M.demandHours), [13, 19], '폭염 수요 시간 보존');
  near(h.private.repairOf(S, h.R, ID), 4 * x, `heat-repair x=${x}/${response || 'none'}`);
}
function generatorFixture(h, kind, existing = false) {
  const { B, R } = h, key = `d90_${kind}_${existing ? 'old' : 'new'}`;
  if (!B.PACKS[key]) {
    B.PACKS[key] = { id: key, name: '가상 출력검사', budget: 1e6, seed: 19,
      rows: ['bbbbbbb', 'bpbuubb', 'bbbbbbb'], legend: { b: 'beach', p: 'plain', u: 'urban' },
      climate: B.PACKS.pyeongtaek.climate, attachAny: true,
      goals: { costBase: 1e6, costPerDay: 1e6, co2Day: 1e6 },
      groups: [{ id: 'power', tools: ['solar', 'roof', 'diesel', 'biomass', 'coal', 'lng', 'smr'] }],
      sites: [{ kind: 'city', c: 3, r: 1, dem: { base: 1000 } },
        ...(existing ? [{ kind: 'plant', fuel: kind, cap: 2, c: 0, r: 1 }] : [])] };
    R.teams.push({ id: key, pack: key });
  }
  B.selectPack(key, 'league');
  const i = kind.endsWith('roof') ? 11 : kind === 'biomass' ? 8 : 9;
  const plan = B.sanitize({ ...empty(), builds: existing ? [] : [{ t: kind, i }],
    lines: [{ p: [7, 8, 9, 10, 11, 12, 13] }], seed: 73, season: 'summer' }, 1e6);
  a.equal(plan.builds.length, existing ? 0 : 1, `${kind} 실제 합법 설비 fixture`);
  return plan;
}
function simulate(h, plan, mods) { return h.B.simulate(plan, 2, { league: true, mods }); }
// tot.by는 화력 장부다. 재생만 한 기 있는 fixture는 실제 공급한 tot.ren으로 읽는다.
const production = (result, kind) => ['solar', 'roof', 'tandem', 'tandem_roof'].includes(kind) ? result.tot.ren : result.tot.by[kind];
function outputContract(h, kind, existing = false) {
  const S = eventState(h, 'heatwave_peak', 1.5, 'dr');
  const mods = h.C.modsFor(S, h.R, ID), plan = generatorFixture(h, kind, existing);
  // 수요·날씨·나머지 배수는 같은 채로 고온 배수만 제거한다.
  const control = simulate(h, plan, { ...mods, lngCapMul: 1, solarHeatMul: 1 });
  const treated = simulate(h, plan, mods);
  const reference = production(control, kind), actual = production(treated, kind);
  a.ok(reference > 0 && actual > 0, `${kind} 대조·폭염 양쪽 실제 발전`);
  near(treated.tot.dem, control.tot.dem, `${kind} 고온만 바꾼 대조의 수요 동일`);
  const factor = kind === 'lng' ? lngFactor(1.5) : ['solar', 'roof'].includes(kind) ? pvFactor(1.5) : 1;
  near(actual / reference, factor, `output-${kind}-${existing ? 'old' : 'new'}`);
}
function rainContract(h, x, response, dev) {
  const S = eventState(h, 'heavy_rain', x, response), M = h.C.modsFor(S, h.R, ID);
  near(M.solarMul, 1 - 0.4 * x, `rain-cloud ${x}/${response || 'none'} 한 번만`);
  for (const key of ['demandMul', 'lngCapMul', 'coalCapMul', 'solarHeatMul']) near(M[key] ?? 1, 1, `호우는 ${key} 변경 없음`);
  near(h.private.repairOf(S, h.R, ID), 12 * x * dev, `rain-repair ${x}/${response || 'none'}`);
  const plan = generatorFixture(h, 'solar'), control = simulate(h, plan, { ...M, solarMul: 1 });
  const actual = simulate(h, plan, M);
  a.ok(control.tot.ren > 0, '호우 대조 실제 PV 발전');
  near(actual.tot.ren / control.tot.ren, 1 - 0.4 * x, '호우 실제 PV 구름 손실 1회');
}
function noDisaster(mods, label) {
  near(mods.lngCapMul ?? 1, 1, `${label} LNG 고온 손실 0`);
  near(mods.solarHeatMul ?? 1, 1, `${label} PV 고온 손실 0`);
}
// 관찰만 하고 실제 시뮬레이터·보정·정산으로 계속 전달한다.
function observeSimulation(h, fn) {
  const calls = [], original = h.B.simulate;
  h.B.simulate = (plan, days, options) => {
    const result = original(plan, days, options);
    calls.push({ mods: clone(options?.mods || {}), result });
    return result;
  };
  try { fn(calls); } finally { h.B.simulate = original; }
}
function operatingRepairContract(h, event, response, expected) {
  for (const [days, mdays] of [[1, 28], [7, 31]]) {
    const S = eventState(h, event, 1.5, response);
    Object.assign(S.rounds[S.round - 1], { days, mdays });
    const result = h.C.runRound(S, h.B), row = result.team[ID];
    near(row.cost.repair, expected, `${event}/${response || 'none'} 月 보수비: 대표일수·달력 독립`);
    near(row.cost.opex, row.cost.fuel + row.cost.policy + row.cost.resp + row.cost.research + expected + row.cost.trade,
      '보수비는 운영 세출에 정확히 한 번', 1e-6);
    const input = h.C.econInput(S, h.R, ID, row, mdays / days);
    near(input.energy.repair, expected, '경제 입력 보수비에 mdays/days 배속 없음');
    near(input.energy.opex, Math.round(((row.cost.fuel + row.cost.policy) * mdays / days +
      row.cost.resp + row.cost.research + expected) * 100) / 100, '경제 입력에도 보수비 1회');
  }
}
function trialContract(h) {
  const S = eventState(h, 'heatwave_peak', 1.5, 'dr');
  S.events.push({ id: 'heavy_rain', round: S.round, x: 1.2 });
  const before = clone(S), mods = h.C.trialMods(S, h.R, ID);
  noDisaster(mods, 'trialMods'); near(mods.solarMul ?? 1, 1, '시험 구름 손실 0');
  near(mods.demandMul ?? 1, 1, '시험 폭염 수요 손실 0');
  near(h.private.repairOf({ ...S, events: [] }, h.R, ID), 0, '시험 무사건 입력 보수비 0');
  a.deepEqual(clone(S), before, '시험은 원본 사건·상태를 바꾸지 않음');
  const clear = { ...S, events: [] };
  noDisaster(h.C.modsFor(clear, h.R, ID), '무사건 운영');
  const result = h.C.runRound(clear, h.B);
  for (const id of IDS) near(result.team[id].cost.repair, 0, `${id} 무사건 실제 운영 보수비 0`);
}
function calibrationContract(h) {
  const S = eventState(h, 'heatwave_peak', 1.5);
  S.events.push({ id: 'heavy_rain', round: S.round, x: 1.3 });
  const original = h.X.calibrate; let input;
  h.X.calibrate = (econ, base, ...rest) => { input = base; return original(econ, base, ...rest); };
  try {
    observeSimulation(h, calls => {
      h.private.calibrateStart(S, h.R, h.B);
      a.equal(calls.length, IDS.length, '시작 보정 도시별 실제 운전');
      for (const call of calls) noDisaster(call.mods, '시작 보정');
    });
  } finally { h.X.calibrate = original; }
  a.ok(input, '실제 경제 보정 호출에 입력 전달');
  for (const id of IDS) near(input[id].energy.repair, 0, `${id} 시작 보정 보수비 0`);
}
function co2Contract(h) {
  const S = eventState(h, 'heatwave_peak', 1.5), result = h.C.runRound(S, h.B);
  observeSimulation(h, calls => {
    h.private.recordCo2Attribution(S, h.B, result);
    a.ok(calls.length >= IDS.length, 'CO2 반사실 도시별 실제 운전(공동목표 보정 운전 포함)');
    for (const call of calls) noDisaster(call.mods, 'CO2 반사실');
  });
  const clear = h.C.runRound({ ...S, events: [], results: [] }, h.B);
  for (const id of IDS) {
    near(clear.team[id].cost.repair, 0, `${id} CO2 반사실 보수비 0`);
    near(result.team[id].co2NoEvent, clear.team[id].co2Prod, `${id} 저장된 CO2 반사실이 무사건 운영과 일치`);
  }
}
function s7Contract(h) {
  const S = eventState(h, 'heatwave_peak', 1.5);
  S.round = 1; S.events[0].round = 1;
  Object.assign(S.rounds[0], { month: 7, season: 'summer', days: 1, mdays: 31 });
  const result = h.C.runRound(S, h.B);
  S.phase = 'review';
  S.econ.before = Object.fromEntries(IDS.map(id => [id, { pop: S.econ.cities[id].pop, ind: S.econ.cities[id].ind }]));
  Object.assign(h.L, { S, snap: S, outCache: {}, outFailures: {} });
  const trial = { map: h.C.teamDef(h.R, ID).pack, scope: JSON.stringify([h.L.room, ID]),
    plan: clone(S.teams[ID].plan), days: 1, seed: result.seed, year: result.year,
    month: result.month, season: result.season, unsPct: 100 };
  // 메모리 기록 조회만 고정한다. S7 분해와 네 번의 실제 운전은 원본 코드다.
  const oldTrial = h.B.lastTrial, oldMods = h.C.modsFor, inputs = [];
  h.B.lastTrial = () => trial;
  h.C.modsFor = (input, ...rest) => { inputs.push(input); return oldMods(input, ...rest); };
  try {
    observeSimulation(h, calls => {
      const out = h.ui.outageAttribution(S, result, ID, {});
      a.ok(out && out.simulations >= 4, '실제 S7 분해가 네 운영 단계를 실행');
      a.ok(calls.length >= 4, 'S7 실제 build 시뮬레이션 관찰');
      for (const call of calls.slice(0, 3)) noDisaster(call.mods, 'S7 시험·선택·날씨 반사실');
      near(calls[3].mods.lngCapMul, lngFactor(1.5), 'S7 사건 단계에는 실제 LNG 고온 손실');
      near(calls[3].mods.solarHeatMul, pvFactor(1.5), 'S7 사건 단계에는 실제 PV 고온 손실');
      const clear = inputs.filter(input => !input.events?.length);
      a.ok(clear.length >= 1, 'S7 원본 함수가 사건 제거 입력을 생성');
      for (const input of clear) near(h.private.repairOf(input, h.R, ID), 0, 'S7 무사건 입력 보수비 0');
    });
  } finally { h.B.lastTrial = oldTrial; h.C.modsFor = oldMods; }
}
function cardContract(h, id, response) {
  const S = eventState(h, id, 1.5, response);
  S.phase = 'review'; h.L.snap = S;
  const html = h.ui.evCards(S, S.round, ID, false), text = html.replace(/<[^>]*>/g, '');
  a.match(text, /특별교부세 10억:/, `${id} 실제 사건 카드 교부세 안내`);
  if (['heavy_rain', 'heatwave_peak'].includes(id)) a.match(text, /보수비에 먼저/, `${id} 보수비 우선 안내`);
  else { a.doesNotMatch(text, /보수비에 먼저/, `${id} 보수 없는 사건`); a.match(text, /남은 돈은 사라져요/, `${id} 잔액 소멸 안내`); }
  if (id === 'heatwave_peak' && response === 'dr') a.match(text, /우리 대응: 수요반응 계약 → 수요 \+9%/,
    '폭염 DR가 모든 효과 손잡이를 덮으면 evSize 수요 크기 복원');
}
function mutation(kind, sources, patch, contract, marker) {
  test(`변이 ${kind}`, () => {
    const changed = patch(sources); // 연결점·파싱·VM 준비 실패는 detected가 아니다.
    const h = load(changed, kind === 'a' || kind === 'd');
    let error;
    try { contract(h); } catch (e) { error = e; }
    const detected = error?.code === 'ERR_ASSERTION' && error.message.includes(marker);
    mutations.push({ kind, detected });
    a.equal(detected, true, `${kind} 의미 단언으로 검출해야 함: ${error?.stack || '변이 생존'}`);
    console.log(`DETECTED ${kind}: ${error.message.split('\n')[0]}`);
  });
  if (!mutations.some(m => m.kind === kind)) mutations.push({ kind, detected: false });
}
try {
  const sources = Object.fromEntries(MODULES.map(name => [name, fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8')]));
  // 이전 자료·규칙도 모두 해당 커밋에서 읽어 별도 VM에 올린다. 현재 자료와 섞지 않는다.
  const before = Object.fromEntries(DRAW_MODULES.map(name => [name, execFileSync('git',
    ['show', `${BEFORE}:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })]));
  const old = load(before, true), draws = load(sources, true), h = load(sources);
  for (const turns of [36, 12, 0]) test(`난수열·발생 ${turns || '계절4'} / ${BOARDS}판`, () => drawContract(draws, old, turns));
  for (const x of [1, 1.5]) for (const [response, dev] of [[undefined, 1], ['dr', .5], ['save', .8]])
    test(`폭염 수식 x=${x}/${response || 'none'}`, () => heatModsContract(h, x, response, dev));
  for (const kind of ['solar', 'roof', 'tandem', 'tandem_roof', 'coal', 'smr', 'diesel', 'biomass', 'lng'])
    test(`실제 출력 ${kind}`, () => outputContract(h, kind));
  test('실제 출력 기존 LNG', () => outputContract(h, 'lng', true));
  for (const x of [1, 1.5]) for (const [response, dev] of [[undefined, 1], ['inspect', .8], ['drain', .55]])
    test(`호우 손실·보수 x=${x}/${response || 'none'}`, () => rainContract(h, x, response, dev));
  for (const [event, response, amount] of [['heavy_rain', undefined, 18], ['heavy_rain', 'inspect', 14.4],
    ['heavy_rain', 'drain', 9.9], ['heatwave_peak', undefined, 6], ['heatwave_peak', 'dr', 6], ['heatwave_peak', 'save', 6]])
    test(`실제 운영 보수비 ${event}/${response || 'none'}`, () => operatingRepairContract(h, event, response, amount));
  test('시험 운전·무사건 경계', () => trialContract(h));
  test('시작 보정 경계', () => calibrationContract(h));
  test('CO2 무사건 반사실 경계', () => co2Contract(h));
  test('S7 실제 분해의 무사건 반사실 경계', () => s7Contract(h));
  for (const event of ['heavy_rain', 'heatwave_peak', 'typhoon_coast', 'heavy_snow_solar', 'coldwave_heating', 'spring_dust_haze'])
    test(`실제 카드 ${event}/대응 없음`, () => cardContract(h, event));
  test('실제 폭염 DR 결과 크기', () => cardContract(h, 'heatwave_peak', 'dr'));
  mutation('a', sources, s => ({ ...s, 'league-core': replaceOne(s['league-core'],
    'rng(hashStr((S.seedKey ?? S.room) + ":" + S.round + ":heavy_rain"))()', 'rnd()') }),
  m => drawContract(m, old, 12, BOARDS, false), 'draw-sequence');
  mutation('b', sources, s => ({ ...s, 'league-core': replaceOne(s['league-core'],
    'P.heatLngSlope.v * P.heatAirDelta.v * x', '0 * P.heatAirDelta.v * x') }),
  m => heatModsContract(m, 1.5, 'dr', .5), 'heat-lng');
  mutation('c', sources, s => ({ ...s, build: replaceOne(s.build,
    '["solar", "roof"].includes(g.kind) && MODS.solarHeatMul', '["solar", "roof", "tandem", "tandem_roof"].includes(g.kind) && MODS.solarHeatMul') }),
  m => outputContract(m, 'tandem'), 'output-tandem-new');
  mutation('d', sources, s => ({ ...s, 'league-core': replaceOne(s['league-core'],
    'if (S.econ && rain && rainIndex >= 0 &&', 'if (rain && rainIndex >= 0 &&') }),
  m => {
    // 계절 모드에서는 비교 단언보다 금지 단언이 먼저 실패하도록 직접 같은 추첨을 실행한다.
    for (let game = 0; game < BOARDS; game++) {
      const S = state(m, 0, `D90-independent-season-${game}`);
      for (let round = 1; round <= 4; round++) {
        S.round = round; m.C.drawEvents(S, m.R);
        a.equal(S.events.some(e => e.id === 'heavy_rain'), false, `season-no-rain seed=${game} round=${round}`);
      }
    }
  }, 'season-no-rain');
  mutation('e', sources, s => ({ ...s, 'league-core': replaceOne(s['league-core'],
    'o?.knobs?.includes("repair") ? o.dev ?? 1 : 1', 'o && typeof o.dev === "number" ? o.dev : 1') }),
  m => heatModsContract(m, 1.5, 'dr', .5), 'heat-repair');
} catch (e) { failures++; console.error(`FAIL 하네스\n${e.stack}`); }
// stdout 마지막 줄은 기계 판독 계약. 검출 실패는 종료 코드에도 반영한다.
for (const kind of ['a', 'b', 'c', 'd', 'e']) if (!mutations.some(m => m.kind === kind)) mutations.push({ kind, detected: false });
console.log(JSON.stringify({ suite: SUITE, assertions, failures, mutations }));
process.exitCode = failures ? 1 : 0;
