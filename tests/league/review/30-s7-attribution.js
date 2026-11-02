'use strict';
const weatherShort = require('./v8-weather-contract');
const displayContract = require('./rev10-display-contract'); // rev10 R7
// V3B-fix5.md + V3B-fix4.md + V3B-fix3.md + V3B-fix2.md + C-fix2.md 호출 수·옛 frozen 호환 + S7-fix3.md + V3B-s7.md 영상 3차.
// D-80: §2 C-1·2 우선. 단계마다 계통 반영, 네 몫; gridImport는 옛 frozen에서만 유지.
// 실행: node tests/league/review/30-s7-attribution.js (브라우저 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x)); // D-80: 빠진 target도 JSON 오류 대신 단언 실패로 보고.
const storage = new Map();
const session = { room: 'S7FIXTURE', team: 'pyeongtaek', outCache: {} };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } }, addEventListener() {},
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: {} } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), ctx);
}
// DOM 없는 세션 어댑터는 메모리에서 L 초기값과 붙이기·S4·일지 경로를 연결한다.
// UI 원본·분해 함수를 수정/추출하지 않는다. 엔진 경계의 단서 픽스처는 아래 별도 표기.
const source = fs.readFileSync(path.resolve(__dirname, '../../../ui/league.js'), 'utf8');
assert.equal(source.split('let L = null;').length, 2, 'VM 세션 연결점 1개');
assert.equal(source.split('state: () =>').length, 2, 'VM 기록 경로 연결점 1개');
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('state: () =>', '__carryClick: econClick, __carryHTML: missedCarryHTML, __worksheet: worksheet, state: () =>'), ctx);
const { leagueCore: C, buildGame: B, ECON_DATA: D, league } = ctx.KCP;
assert.equal(typeof league.uiMath.outageAttribution, 'function', '공개 분해 검사 API');
const attribution = league.uiMath.outageAttribution;
const R = C.regionOf('south');
let id = session.team;
let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; }
function near(a, b, label) { ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-9, `${label}: ${a} / ${b}`); }
function equal(a, b, label) { assert.deepEqual(clone(a), clone(b), label); checks++; }
function sameParagraph(topic, days) {
  // 계약에서만 기대값을 계산한다. 이름·조사를 정하는 구현 함수는 읽거나 호출하지 않는다.
  const baselineLabel = days > 0 && days !== 7 ? `시험 ${days}일 대비` : '시험 1주 대비';
  const baseline = baselineLabel.replace(/ 대비$/, '');
  const particle = (baseline.charCodeAt(baseline.length - 1) - 0xac00) % 28 ? '과' : '와';
  return `<p id="lg-outage-same">실제로는 ${topic === 'grid' ? '바깥 계통에 기댄 전기가' : '정전이'} ${baseline}${particle} 거의 같았어요(판정: 같음).</p>`;
}
// V3B-fix5: 독립 반올림 산식(백분율의 1/100 단위). UI 함수·상수는 읽지 않는다.
const shownHigh = value => Number.isFinite(value) && Math.round(value * 100) >= 500;
const noCauseLabel = (before, after, target = 'uns') => target !== 'grid' && shownHigh(before) && shownHigh(after) ? // D-80: MWh를 높은 정전으로 해석하지 않음.
  '차이 원인 없음(정전 자체는 큼)' : '뚜렷한 원인 없음';
// rev10 R5(검토 반영, 총괄 수정): 이 fixture에는 운영 사본(outageSnapshots)도 operatingPlan도 없다.
// 명세 R5 '운영 당시 값을 얻을 수 없으면 원래 문장 유지'에 따라 현재 공개 계획으로 n을 세지 않고 원래 문장을 기대한다.
// 운영 사본이 있는 경로는 57-rev10.js R5·32-s7-monthly.js·s7.py가 본다.
function highOutageCopy() {
  return '지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요';
}
function studentWords(html, label) {
  const text = html.replace(/<[^>]*>/g, ''); // #lg-missed 전체, 접힌 상세 텍스트 포함
  ok(!text.includes('S7') && !text.includes('(G)'), `${label}: 학생 영역 내부 표기 미노출`);
}
const simulate = B.simulate;
let calls = [];
B.simulate = (...args) => { calls.push(clone(args)); return simulate(...args); };

function fixture({ changed = false, replayOffset = 0, sameWeather = false, noEvents = false, empty = false, month = 1, trialSeed, actualSeed, season, city = 'pyeongtaek', wind = false, fullConnection = false } = {}) {
  id = session.team = city;
  const ids = [id, id === 'pyeongtaek' ? 'dangjin' : 'pyeongtaek'];
  session.outCache = {};
  session.outFailures = {};
  session.outShownPending = null;
  delete session.interview;
  const S = C.newState(session.room, R.id, 0, ids, { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  for (const city of ids) S.teams[city].plan = clone(D.normalStartPlans[city]);
  // D-74: 수입으로 정상 시험 정전0이 될 수 있어 음수 재현 오프셋도 합법(0~100)인 빈 계획50%에 적용.
  if (empty || sameWeather && replayOffset) for (const city of ids) S.teams[city].plan = { builds: [], lines: [], policies: [] };
  B.selectPack(C.teamDef(R, id).pack, 'league');
  if (noEvents && !empty) {
    // 무사건이어도 선택·날씨의 두 몫이 생기도록 합법적인 연결 태양광 배치.
    const plan = S.teams[id].plan, connected = new Set(plan.lines.flatMap(l => l.p));
    const tiles = B.TILES.filter(t => !t.out && t.site < 0 && !B.siteRule('solar', t) &&
      t.nb.some(i => connected.has(i))).slice(0, 10);
    ok(tiles.length === 10, '무사건 카드 시나리오 태양광 배치 가능');
    for (const t of tiles) {
      plan.builds.push({ t: 'solar', i: t.i });
      plan.lines.push({ p: [t.nb.find(i => connected.has(i)), t.i] });
    }
  }
  if (wind) {
    // 정상 계획의 전선에서 합법 육상풍력 칸까지 BFS로 실제 연결한다.
    const plan = S.teams[id].plan, seen = new Map(plan.lines.flatMap(l => l.p).map(i => [i, null]));
    const queue = [...seen.keys()], used = new Set(plan.builds.map(b => b.i));
    let target;
    for (let j = 0; j < queue.length; j++) {
      const t = B.TILES[queue[j]];
      if (!t.out && t.site < 0 && !used.has(t.i) && !B.siteRule('wind', t)) { target = t.i; break; }
      for (const i of t.nb) if (!B.TILES[i].out && !seen.has(i)) { seen.set(i, t.i); queue.push(i); }
    }
    ok(target !== undefined, `${C.teamDef(R, id).name} 육상풍력 합법 연결 위치`);
    const route = [target];
    while (seen.get(route[0]) !== null) route.unshift(seen.get(route[0]));
    plan.builds.push({ t: 'wind', i: target });
    if (route.length > 1) plan.lines.push({ p: route });
  }
  // 시험 기준 풍력의 기할당 상태. 정상 월 처리량에 따른 접속은 32에서 검사한다.
  if (fullConnection) {
    C.refreshGrid(S, B);
    S.grid[id].entries.forEach(entry => { entry.allocatedMW = entry.mw; });
  }
  // 첫 달 새 재생 설비는 접속 대기. 다음 달 진입으로 실제 접속 절차를 거친다.
  for (let m = 1; m < month; m++) { C.run(S, B, 0); C.host(S, 'next', 0); }
  if (sameWeather || noEvents) S.events = [];
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = clone(S.teams[id].plan), rd = C.roundsOf(S)[S.round - 1];
  if (season) rd.season = season;
  if (actualSeed !== undefined) S.salt = actualSeed - (7000 + S.round * 13);
  const seed = trialSeed ?? (sameWeather ? 7013 : 1);
  // 이 픽스처는 재현 경로와 같은 C.trialMods로 시험을 만든다. 같은 계획의
  // replay=0은 구조상 성립하므로 실제 시험 경로의 독립 검증은 아니다.
  // s7.py가 UI로 시험한 뒤 계획을 유지한 달에 |replay| < 0.01%p를 검사한다.
  // D-74: 저장 시험도 수입 0→경제 모드 계통 수입 반영. 실제 시험 경로는 35번에서 별도 검사.
  const rawTrial = simulate({ ...B.sanitize(plan, 1e9), seed, season: rd.season }, 7, // D-80: C-1·2·4·5 대상별 검사.
    { league: true, mods: C.trialMods(S, R, id) }); // D-80: 계약 A, 기존 수입 설비는 별도로 뺀다.
  const s = C.gridFill(rawTrial); // D-80: 시험도 같은 계통 보충 정의.
  const scope = JSON.stringify([session.room, id]), map = C.teamDef(R, id).pack;
  const trial = { map, scope, year: rd.year, month: rd.month, season: rd.season,
    seed, days: 7, unsPct: 100 * s.unsTotal / s.tot.dem + replayOffset,
    gridMWh: s.tot.by.import - rawTrial.tot.by.import, // D-80: 계약 A의 대표 기간 보충량.
    outH: 0, co2: s.co2, cost: s.cost.total, plan };
  storage.set('kcp-build-trial-v1', JSON.stringify({ [JSON.stringify([scope, map])]: trial }));
  if (changed) S.teams[id].plan.policies = ['save'];
  // S7의 반환값·호출 기록 대신 운영 직전 복제 상태로 예상 단계를 만든다.
  const operating = clone(S);
  C.refreshGrid(operating, B, true);
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const normalMods = C.modsFor({ ...operating, events: [] }, R, id);
  const eventMods = C.modsFor(operating, R, id);
  const trialInput = clone(operating); trialInput.events = []; trialInput.teams[id].plan = clone(trial.plan);
  const trialMods = C.trialMods(trialInput, R, id);
  const res = C.run(S, B, 0), V = C.publicView(S, 0);
  const sim = (p, seed, days, mods) => {
    B.selectPack(C.teamDef(R, id).pack, 'league');
    const st = B.sanitize(clone(p), 1e9); Object.assign(st, { seed, season: res.season });
    if (mods.tax && !st.policies.includes('tax')) st.policies.push('tax');
    return simulate(st, days, { league: true, mods: clone(mods) });
  };
  const stages = [sim(trial.plan, trial.seed, trial.days, trialMods),
    sim(operating.teams[id].plan, trial.seed, trial.days, normalMods),
    sim(operating.teams[id].plan, res.seed, res.days, normalMods),
    sim(operating.teams[id].plan, res.seed, res.days, eventMods)];
  const pct = s => s.tot.dem > 0 ? 100 * s.unsTotal / s.tot.dem : 0;
  const target = trial.unsPct < .005 && res.team[id].unsPct < .005 ? 'grid' : 'uns'; // D-80: C-3.
  const stageValue = raw => filledValue(raw, target, 1 / raw.days); // D-82: 계통의 각 단계는 대표 운전량/그 단계 일수, 정전율은 그대로.
  const values = stages.map(stageValue), grid = operating.grid[id]; // D-80: 모든 단계에 계통 보충.
  const full = Object.fromEntries(grid.entries.map(b => [b.key, b.mw]));
  // 독립 시간별 C1: min(부족, 수요×상한). gridFill 반환값을 기대값으로 쓰지 않는다.
  const gridRate = raw => {
    let imports = 0;
    for (let k = 0; k < raw.H; k++) {
      let shortage = 0;
      for (let ti = 0; ti < raw.NT; ti++) shortage += raw.hrUns[k * raw.NT + ti];
      // 시간별 부족의 Float32 경계는 엔진 결과 배열의 정밀도와 맞춘다. 허용 오차 확대 없음.
      imports += Math.min(Math.fround(shortage), raw.hrDem[k] * D.params.gridImportShare.v);
    }
    return 100 * Math.max(0, raw.unsTotal - imports) / raw.tot.dem;
  };
  const filledBase = gridRate(stages[0]);
  const base = target === 'grid' ? trial.gridMWh / trial.days : trial.unsPct; // D-82: 저장 시험량/시험 일수로 독립 출발값.
  const actual = target === 'grid' ? publicMWh(res.team[id]) / res.days : res.team[id].unsPct; // D-82: 공개 보충량/실제 대표 일수로 도착값.
  const expected = { target, base, actual, replay: values[0] - base, rates: [filledBase, gridRate(stages[3])], // D-80: C-2 항등식.
    parts: ['choice', 'weather', 'event'].map((key, i) => ({ key, value: values[i + 1] - values[i] })),
    weather: stages.slice(1, 3).map(s => weatherMetrics(s, operating.teams[id].plan, normalMods)),
    grid: { waitingMW: grid.waitingMW, value: grid.waitingMW > 0 ?
      stageValue(sim(operating.teams[id].plan, res.seed, res.days, { ...eventMods, reCap: full })) - values[3] : 0 } }; // D-80: C-1, 반사실도 같은 대상.
  expected.parts.push({ key: 'trade', value: actual - values[3] }); // D-80: C-2, 계통 별도 잔차 폐기.
  calls = [];
  return { S, V, res, trial, expected };
}

// D-74: 옛 실제−고립(이웃+계통) → 이웃 부족 보충과 계통 부족 보충으로 분리.
// flow는 손실 후 도착량, sub는 부족 보충이 아닌 자체 화력 대체량(MWh)이다.
function neighbor(res, city, isolated) {
  let delivered = 0;
  for (const [edge, flow] of Object.entries(res.flow || {})) {
    const [from, to] = edge.split('~');
    if (to === city) delivered += flow.ab;
    if (from === city) delivered += flow.ba;
  }
  const replacedShortage = Math.max(0, delivered - res.team[city].sub);
  return { delivered, rate: Math.max(0, isolated - 100 * replacedShortage / res.team[city].dem) };
}

const names = { choice: '내 선택', weather: '날씨·운전 기간', event: '사건·대응', trade: '이웃 거래', gridImport: '계통 수입' };
const causes = ['choice', 'weather', 'event', 'trade']; // D-80: C-2·4, 이름 표에는 옛 기록 gridImport 보존.
const publicMWh = r => Math.max(0, r.isolated.uns - r.uns - r.imp + r.sub); // D-80: 계약 A 독립 산식.
function filledValue(raw, target, mul) { // D-80: S7을 사용하지 않는 core 모델 기준값.
  const filled = C.gridFill(raw); // D-80: C-1, 원래 수입 설비 출력 제외.
  return target === 'grid' ? (filled.tot.by.import - raw.tot.by.import) * mul : 100 * filled.unsTotal / filled.tot.dem; // D-80: C-1.
} // D-80: 독립 모델 끝.
const minPart = a => a.target === 'grid' ? Math.max(.05, .05 * Math.abs(a.trial)) / 10 : .05; // D-82: 하루 평균 같음 문턱(G)의 1/10, 정전 문턱 유지.
const unitNumber = (a, v, sign = false) => a.target === 'grid' ? number(v, sign, 1) + ' MWh/일' : number(v, sign) + '%p'; // D-82: 계통 표시도 하루 평균.
const number = (v, sign = false, digits = 2) => { // D-80: MWh 소수 첫째 자리.
  if (!Number.isFinite(v)) return '–';
  const rounded = Number(v.toFixed(digits)) + 0; // D-80: C-4.
  // D-80: MWh(한 자리)는 같은 카드의 단서 숫자처럼 천 단위 쉼표를 쓴다(검토 minor 2, 총괄 승인 전 리그 갈래 판단).
  const body = digits === 1 ? Math.abs(rounded).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : Math.abs(rounded).toFixed(digits);
  return `${rounded < 0 ? '−' : sign && rounded > 0 ? '+' : ''}${body}`; // D-80: C-4.
};
function weatherMetrics(s, plan, mods) {
  const climate = B.PACKS[s.map].climate, network = B.network(B.sanitize(clone(plan), 1e9));
  const connected = kind => network.nodes.some(n => n.kind === kind && n.live &&
    !(mods.disabledBuilds || []).includes(`${kind}:${n.tile}`) &&
    (!mods.reCap || (mods.reCap[`${kind}:${n.tile}`] || 0) > 0));
  const wind = kind => {
    if (!connected(kind)) return null;
    let total = 0;
    for (let k = 0; k < s.H; k++) {
      const month = s.wx[Math.floor(k / 24)].m;
      const baseline = kind === 'wind' ? climate.wind10_land[month] * climate.hub_factor_land : climate.wind100_sea[month];
      total += baseline * s.hrWind[k];
    }
    return total / s.H;
  };
  // UI의 요약 함수 대신 독립 시뮬레이션의 물리 결과를 읽는다.
  return { wind: wind('wind'), offshoreWind: wind('offshore'), renewable: s.tot.ren / s.days, available: s.tot.renAvail / s.days,
    demand: s.tot.dem / s.H, peakDemand: Math.max(...s.hrDem),
    hotDays: s.wx.filter(day => day.tmax > 28).length, uns: 100 * s.unsTotal / s.tot.dem };
}
const weatherCoverage = new Set();
function weatherClue(a, before, after, old, current) {
  const short = a.clues.weather, full = a.clueMore.weather;
  const fmt = (v, d) => v.toLocaleString('ko-KR', { maximumFractionDigits: d });
  const demand = `평균 수요 ${fmt(before.demand, 2)} → ${fmt(after.demand, 2)} MW`;
  let renewable;
  if (before.renewable === 0 && after.renewable === 0) {
    renewable = '재생 공급 없음'; weatherCoverage.add('no-renewable');
  } else if (before.renewable > 0) {
    const change = Number(((after.renewable / before.renewable - 1) * 100).toFixed(1)) + 0;
    renewable = `하루 재생 공급량 ${change > 0 ? '+' : ''}${fmt(change, 1).replace('-', '−')}%`;
    weatherCoverage.add('renewable');
  } else {
    renewable = `하루 재생 공급량 ${fmt(before.renewable, 1)} → ${fmt(after.renewable, 1)} MWh/일(이전 값 0)`;
    weatherCoverage.add('zero-before');
  }
  // S7의 몫·부호는 예상 순서에 사용하지 않는다. 실제 공급량을 MW로 환산한다.
  // 절댓값이 동률이면 수요가 먼저다(0 대 0 포함).
  const renewableFirst = Math.abs(after.renewable - before.renewable) / 24 >
    Math.abs(after.demand - before.demand);
  weatherCoverage.add(renewableFirst ? 'renewable-first' : 'demand-first');
  const physical = renewableFirst ? [renewable, demand] : [demand, renewable];
  const winds = [];
  for (const [key, label] of [['wind', '육상 허브 기준'], ['offshoreWind', '해상 100m 기준']]) {
    if (Number.isFinite(before[key]) && Number.isFinite(after[key])) {
      winds.push(`평균 풍속(${label}) ${fmt(before[key], 1)} → ${fmt(after[key], 1)} m/s`);
      weatherCoverage.add(key);
    } else weatherCoverage.add(`no-${key}`);
  }
  const season = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  const expected = [...physical, `무더위 ${before.hotDays} → ${after.hotDays}일`, ...winds,
    `계절 ${season[old.season]} → ${season[current.season]}`].join(' · ');
  ok(short === weatherShort(before, after, old, current), `날씨 짧은 단서 = 독립 수요·재생·기온·접속 풍력·순서: ${short} / ${expected}`);
  ok(full.startsWith(expected + ' · ') &&
    full.includes(`최대 수요 ${fmt(before.peakDemand, 2)} → ${fmt(after.peakDemand, 2)} MW`) &&
    full.includes(`하루 재생 공급량 ${fmt(before.renewable, 1)} → ${fmt(after.renewable, 1)} MWh/일`) &&
    full.includes(`대표 운전 ${old.days} → ${current.days}일`), '상세 물리량·대표 기간 독립 검산');
  ok(full.includes('28℃ 초과') && full.includes('단서 순서는 평균 수요·재생 공급 변화의 절댓값으로 정해요(게임 가정).') &&
    full.includes('재생 공급량은 접속 할당·출력제어를 반영해 실제 공급한 양이에요.'), '무더위 기준·단서 순서 추정 명시');
  ok(!/씨앗|%p/.test(short + full), '날씨 단서에 씨앗 번호·원인 몫 없음');
  equal(a.hasConnectedWind, [after.wind, after.offshoreWind].some(Number.isFinite),
    '저장 분해의 풍력 플래그 = 독립 연결·할당·풍속 계산');
}
function bottleneck(html, grid, label, a = {}) { // D-80: C-1·4·5, 같은 대상·단위·문턱의 반사실.
  const threshold = minPart(a), isGrid = a.target === 'grid'; // D-80: 독립 문턱.
  const box = html.match(/<aside\b[^>]*id="lg-outage-grid-bottleneck"[^>]*>([\s\S]*?)<\/aside>/);
  const show = grid.waitingMW > 0 && Number.isFinite(grid.value) && Math.abs(grid.value) >= threshold; // D-80: C-1·2·4·5 대상별 검사.
  equal(!!box, show, `${label}: 대기>0·|반사실|≥0.05%p일 때만 병목 상자`);
  equal(html.includes('id="lg-outage-single-grid"'), false, `${label}: 옛 병목 선택자 대체`);
  equal((html.match(/data-out-grid=/g) || []).length, Number(show), `${label}: 병목 수치 중복 없음`);
  const small = html.match(/<p\b[^>]*id="lg-outage-grid-small"[^>]*>([\s\S]*?)<\/p>/);
  const showSmall = grid.waitingMW > 0 && Number.isFinite(grid.value) && Math.abs(grid.value) < threshold; // D-80: C-1·2·4·5 대상별 검사.
  equal(!!small, showSmall, `${label}: 작은 대기 줄은 양의 대기·유한 효과·0.05%p 미만`);
  if (small) { // D-80: 계통 단위도 작은 효과 문구에서 검사.
    if (isGrid) ok(small[1].includes('MWh/일') && !small[1].includes('%p') && small[1].includes('접속 대기'), label + ': 작은 계통 효과 단위'); // D-82: 작은 반사실도 하루 평균 단위.
    else equal(small[1], `접속 대기 ${grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MW(효과 0.05%p 이하)`, label + ': 작은 정전 효과 원문'); // D-80: 기존 정전 문구 유지.
  } // D-80: 작은 효과.

  equal((html.match(/id="lg-outage-grid"/g) || []).length, Number(show), `${label}: grid 설명은 병목 상자 있을 때만`);
  if (!box) return small?.[0] || null;
  ok(box[1].includes('id="lg-outage-grid"'), `${label}: grid 설명은 병목 상자 안에만`);
  const raw = box[1].match(/data-out-grid="([^"]+)"[^>]*>([^<]+)<\/b>/);
  near(raw ? +raw[1] : NaN, grid.value, `${label}: 병목 DOM 값 = 독립 전량 연결−실제 고립`);
  equal(raw?.[2], unitNumber(a, grid.value, true), `${label}: 병목 숫자 형식`); // D-80: C-1·2·4·5 대상별 검사.
  ok(box[1].includes(`접속 대기 ${grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MW`) &&
    box[1].includes('대기가 없었다면') && box[1].includes(isGrid ? '계통' : '정전') && box[1].includes('분해 합계 밖'), `${label}: 병목량·반사실·합계 밖 설명`); // D-80: C-1·2·4·5 대상별 검사.
  ok(!/data-out-value=|data-missed=|data-out-tag=|가장 큰/.test(box[0]) &&
    (box[1].match(/[+−-]?\d[\d,]*\.\d+(?: MWh\/일|%p)/g) || []).join('') === unitNumber(a, grid.value, true), // D-82: 하루 평균 반사실 수치 하나만 허용.
    `${label}: 병목 상자는 반사실 수치만 공개, 카드 몫/정답 없음`);
  ok(html.indexOf(box[0]) < html.indexOf(html.includes('id="lg-outage-cards"') ? 'id="lg-outage-cards"' : 'id="lg-outage-single"'),
    `${label}: 카드/요약 위 별도 상자`);
  const textNumbers = box[1].replace(/<[^>]*>/g, '').match(/[+−-]?\d[\d,]*(?:\.\d+)?/g) || [];
  equal(textNumbers, [grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 }), number(grid.value, true, isGrid ? 1 : 2)], // D-80: C-1·2·4·5 대상별 검사.
    `${label}: 병목 텍스트 숫자는 대기 MW와 별도 반사실만`);
  ok([...box[0].matchAll(/\b(aria-[\w-]+|title|data-[\w-]+)="([^"]*)"/g)]
    .every(m => m[1] === 'data-out-grid' || !/\d|가장 큰|가장 큼/.test(m[2])),
    `${label}: 병목 aria/title/data에 숨은 카드 몫 없음`);
  return box[0];
}
function hiddenClues(html) {
  const clues = [...html.matchAll(/<span class="lg-out-clue">([\s\S]*?)<\/span>/g)].map(m => m[0]);
  for (const selector of ['others', 'more']) {
    const tag = selector === 'more' ? 'details' : 'p';
    const value = html.match(new RegExp(`<${tag}[^>]*id="lg-outage-${selector}"[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    if (value) clues.push(value[1]);
  }
  ok(clues.length > 0 && clues.every(text => !/%p|data-out-value=|가장 큼|가장 큰 몫|>[+−-]?\d+\.\d+</.test(text) &&
    [...text.matchAll(/\b(aria-[\w-]+|title|data-[\w-]+)="([^"]*)"/g)].every(m => !/\d/.test(m[2]))),
    '닫힌 카드·나머지·상세 단서의 DOM/aria/data에 몫·최대 없음');
}

let orderDiffersFromRank = 0, nonlargestCases = 0, noCauseCases = 0;
function cardOrder(html, ranked, label, a) { // D-80: 대상별 카드 문턱.
  const keys = [...html.matchAll(/data-missed="([^"]+)"/g)].map(m => m[1]);
  const top = ranked.filter(p => Math.abs(p.value) >= minPart(a)).slice(0, 3).map(p => p.key); // D-80: C-5.
  equal([...keys].sort(), top.length >= 2 ? [...top].sort() : [], `${label}: 독립 |몫|≥0.05%p 상위 최대 세 원인 집합`);
  equal(html.includes('data-single="true"'), top.length < 2, `${label}: 2장 미만이면 한 줄 요약`);
  equal(keys, causes.filter(key => keys.includes(key)), `${label}: 분해 순서의 부분열`);
  if (top.length >= 2 && JSON.stringify(keys) !== JSON.stringify(top)) orderDiffersFromRank++;
}
function rendered(a, html, label) {
  const rows = [...html.matchAll(/data-out-step="([^"]+)" data-out-value="([^"]+)"/g)];
  const hasReplay = Math.abs(a.replay) >= (a.target === 'grid' ? .05 : .005); // D-82: 표시 반 눈금(계통 0.1, 정전 0.01)의 재현 문턱.
  equal(rows.map(m => m[1]), ['trial', ...(hasReplay ? ['replay'] : []), ...causes, 'actual'],
    `${label}: 겹침 없이 시험 + 별도 재현 차이 + 네 원인 + 실제`); // D-80: C-1·2·4·5 대상별 검사.
  equal(html.includes('id="lg-outage-replay"'), hasReplay, `${label}: 0.005%p 미만 재현 설명 생략`);
  near(rows.filter(m => m[1] !== 'actual').reduce((s, m) => s + Number(m[2]), 0) + (hasReplay ? 0 : a.replay), a.actual, `${label}: 생략 재현 복원 뒤 폭포 합계 1e-9`); // D-80: 단위 전환에도 오차를 늘리지 않음.
  const candidateKeys = [...html.matchAll(/data-(?:missed|out-other)="([^"]+)"/g)].map(m => m[1]);
  ok(candidateKeys.every(k => causes.includes(k)), `${label}: 후보는 네 원인 안에서만`); // D-80: C-1·2·4·5 대상별 검사.
  ok(html.includes(`이번 달 계산 순서: ${causes.map(k => names[k]).join(' → ')}`) &&
    html.includes('순서를 바꾸면 몫이 달라질 수 있는 추정이에요. 게임에서 정한 순서예요.'), `${label}: 실제 계산 순서·순서 의존 안내`);
  for (const m of html.matchAll(/data-out-step="([^"]+)" data-out-value="([^"]+)"[\s\S]*?<b>([^<]+)<\/b>/g)) {
    const rate = ['trial', 'actual'].includes(m[1]);
    const value = rate ? +m[2] : displayContract(a).get(m[1]) ?? +m[2]; // rev10 R7
    equal(m[3], a.target === 'grid' ? unitNumber(a, value, !rate) : number(value, !rate) + (rate ? '%' : '%p'), // D-80: C-4.
      `${label}: ${m[1]} 소수 둘째 자리·마이너스·단위 붙임`); // D-80: C-1·2·4·5 대상별 검사.
  }
  ok(new RegExp('id="lg-outage-waterfall"[^>]*role="img"[^>]*aria-label="[^"]*시험 [\\d.,]+' + (a.target === 'grid' ? ' MWh/일' : '%')).test(html), // D-82: 접근성 요약도 하루 평균 단위.
    `${label}: 폭포 이미지 역할과 수치 요약`);
  const aria = html.match(/id="lg-outage-waterfall"[^>]*aria-label="([^"]+)"/)[1];
  for (const name of ['내 선택', '날씨·운전 기간', '사건·대응', '이웃 거래', '실제']) { // D-80: C-2, 새 폭포에 계통 수입 몫 없음.
    ok(aria.includes(name), `${label}: 접근성 요약에 ${name}`);
  }
  ok(/id="lg-outage-verdict"[^>]*tabindex="-1"/.test(html), `${label}: 판정 머리 초점 대상`);
  ok(html.includes('>2022 기출로 연습하기</a>'), `${label}: 2022 링크 문구`);
}

for (const options of [{ sameWeather: true }, { sameWeather: true, replayOffset: .0049 },
  { sameWeather: true, replayOffset: .0051 }, { sameWeather: true, replayOffset: .009 },
  { sameWeather: true, replayOffset: -.011 }, { sameWeather: true, replayOffset: .125 },
  { changed: true }]) {
  const { S, V, res, trial, expected } = fixture(options);
  const before = JSON.stringify({ S, V, trial });
  const a = attribution(V, res, id);
  ok(a, '당시 시험·공개 상태로 분해 가능');
  equal(a.target, expected.target, 'D-80 대상은 시험·실제 정전으로 결정'); // D-80: C-3.
  if (expected.target === 'grid') equal(a.unit, 'MWh/일', '계통 S7 객체 단위'); // D-82: 구현의 단위를 기대값 근거로 삼지 않고 계약과 대조.
  equal(a.parts.map(p => p.key), causes, '네 몫만, 재현 차이·계통 잔차는 후보 아님'); // D-80: C-2.
  expected.parts.forEach(p => near(a.parts.find(x => x.key === p.key).value, p.value, `${p.key} 독립 모델 몫`));
  ok(Number.isFinite(a.replay), '재현 차이는 별도 숫자');
  near(a.trial, expected.base, '대상별 시험 출발값'); // D-80: C-1·계약 A.
  near(a.actual, expected.actual, '대상별 실제 도착값'); // D-80: C-1.
  near(a.total, a.actual - a.trial, '정전율 차이 단위 %p');
  near(a.replay + a.parts.reduce((sum, p) => sum + p.value, 0), a.total, '재현 차이 + 네 원인 합계 항등식 1e-9'); // D-80: C-1·2·4·5 대상별 검사.
  const waiting = a.grid.waitingMW > 0;
  equal(calls.length, waiting ? 5 : 4, '시험 기준: 접속 대기 없으면 4회, 있으면 5회');
  equal(a.simulations, calls.length, '보고된 호출 수 = 실제 호출 수');
  equal(calls.map(([plan]) => plan.seed), [trial.seed, trial.seed, res.seed, res.seed, ...(waiting ? [res.seed] : [])],
    '13–15행: 재현·계획은 시험 씨앗, 이후 단계는 실제 씨앗');
  equal(calls.map(([, days]) => days), [trial.days, trial.days, res.days, res.days, ...(waiting ? [res.days] : [])],
    '13–15행: 날씨 단계부터 실제 운영 일수');
  equal(calls[0][0].policies, trial.plan.policies || [], '재현 단계에 시험 정책');
  equal(calls[1][0].policies, V.teams[id].plan.policies || [], '선택 단계에 실제 정책');
  ok(Number.isFinite(a.ms) && a.ms >= 0, '계산 시간 유한값(성능 합격선 없음)');
  ok(Number.isFinite(a.grid.value) && Number.isFinite(a.grid.waitingMW), '접속 대기 별도 반사실');
  near(a.grid.value, expected.grid.value, '독립 전량 연결−실제 고립 정전율');
  near(a.grid.waitingMW, expected.grid.waitingMW, '독립 운영 상태의 대기량');
  weatherClue(a, ...expected.weather, { ...res, days: trial.days }, res);
  const part = key => a.parts.find(p => p.key === key).value;
  if (options.sameWeather) {
    near(a.replay, expected.replay, '재현 차이 = 계통 반영 재계산 − 저장 시험'); // D-80: C-2.
    for (const key of ['choice', 'weather', 'event']) near(part(key), 0, `동일 계획·날씨·무사건 ${key}=0`);
  } else if (!options.noEvents && options.month !== 2) {
    ok(Math.abs(part('choice')) >= .05 && Math.abs(part('event')) >= .05,
      '정상 연결 배치 + 시험 뒤 절전 정책은 고르기 생략 대상이 아님');
  }
  // 반환값만 비교하면 재계산을 놓친다. 실제 엔진 호출 수와 참조 동일성도 검사한다.
  const count = calls.length;
  ok(attribution(V, res, id) === a, '같은 도시·달 결과 캐시 반환');
  equal(calls.length, count, '캐시 재열기 추가 시뮬레이션 0');
  equal(JSON.stringify({ S, V, trial }), before, '원래 운영·공개 상태·시험 자료 불변');
  const ranked = [...expected.parts].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const closedNote = {}, closed = league.uiMath.outageCardsHTML(V, res, id, closedNote);
  equal(closedNote, {}, 'HTML 생성만으로 열기·요약 표시·최대 몫 기록 금지');
  cardOrder(closed, ranked, '열기 전', a); // D-80: C-5.
  const closedBox = bottleneck(closed, expected.grid, '열기 전', a); // D-80: 반사실도 대상별 단위로 검증.
  if (ranked.slice(1).some(p => Math.abs(p.value) >= minPart(a))) { // D-80: C-1·2·4·5 대상별 검사.
    hiddenClues(closed);
    ok(!/data-out-value=|가장 큰 몫/.test(closed), '열기 전 원인 수치·최대 몫 비공개');
  }
  const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, missed: ranked[0].key });
  equal(bottleneck(html, expected.grid, '열기 뒤', a), closedBox, '병목은 열기 전후 동일, 카드 정답과 무관'); // D-80: 대상 제외 없이 검사.
  rendered(a, html, JSON.stringify(options));
  weatherDOM(V, res, a);
  if (ranked.slice(1).some(p => Math.abs(p.value) >= minPart(a))) { // D-80: C-1·2·4·5 대상별 검사.
    cardOrder(html, ranked, '열기 뒤', a); // D-80: C-5.
    const picked = ranked.slice(1, 3).find(p => minPart(a) <= Math.abs(p.value) && // D-80: C-1·2·4·5 대상별 검사.
      Math.abs(p.value) < Math.abs(ranked[0].value));
    ok(picked, '최대가 아닌 유의미한 카드 사례 존재');
    const wrong = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, missed: picked.key });
    ok(wrong.includes('몫은 있지만 가장 크지 않았어요'), '최대가 아닌 선택의 판정 분기');
    const tagged = tag => [...wrong.matchAll(/<button\b[^>]*data-missed="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
      .filter(m => m[2].includes(`data-out-tag="${tag}"`)).map(m => m[1]);
    equal(tagged('picked'), [picked.key], '내가 고름은 선택한 카드에만');
    equal(tagged('largest'), [ranked[0].key], '가장 큼은 다른 최대 카드에만');
    nonlargestCases++;
  }
  if (a.parts.every(p => Math.abs(p.value) < minPart(a))) { // D-80: C-1·2·4·5 대상별 검사.
    ok(closed.includes('data-single="true"') && closed.includes(noCauseLabel(trial.unsPct, res.team[id].unsPct, a.target)), // D-80: C-1·2·4·5 대상별 검사.
      '모든 몫 < 0.05%p이면 두 정전율에 맞는 차이 원인 없음');
    ok(!closed.includes('가장 큰 몫') && !closed.includes('data-out-tag="largest"'),
      '미미한 몫을 최대 원인으로 표시하지 않음');
    ok(session.outShownPending && !session.outShownPending.largest,
      '미미한 몫은 표시 후 저장 대기 자료에도 최대 몫 없음(실제 저장은 브라우저 검사)');
    noCauseCases++;
  }
  if (options.noEvents) {
    ok(closed.includes('data-single="false"'), '무사건 달에도 여러 원인의 카드 분기 실행');
    near(part('event'), 0, '사건 없는 달의 사건 몫 0');
    ok(html.includes('우리 도시에 해당하는 사건 없음'), '무사건 단서');
  }
  console.log(JSON.stringify({ options, ms: a.ms, simulations: a.simulations, replay: a.replay, parts: a.parts }));
}
ok(orderDiffersFromRank > 0, '크기 순위와 표시 순서가 실제로 다른 사례 실행');
ok(nonlargestCases > 0, '최대가 아닌 선택 사례 실행');
ok(noCauseCases > 0, '모든 몫 < 0.05%p 사례 실행');

// 물리 요약과 DOM이 열기 전후 동일한 단서를 사용한다.
function weatherDOM(V, res, a) {
  const trialSeeds = Object.values(JSON.parse(storage.get('kcp-build-trial-v1') || '{}')).map(t => t.seed);
  for (const opened of [false, true]) {
    const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: opened });
    // 한 줄 요약도 원인 단서/상세 단서를 표시하므로 같은 비공개 계약을 검사한다.
    const surface = html.replace(/<[^>]*>/g, '');
    studentWords(html, `${opened ? '열림' : '닫힘'}/${html.includes('data-single="true"') ? '한 줄 요약' : '카드'}`);
    // 짧은 씨앗(예: 1)은 정상 단서의 일수/개수와 구분할 수 없어 이름을 검사한다.
    ok(!/씨앗|seed/i.test(surface) && [res.seed, ...trialSeeds].filter(seed => seed >= 1000)
      .every(seed => !surface.includes(String(seed))),
      `${opened ? '열림' : '닫힘'}/${html.includes('data-single="true"') ? '한 줄 요약' : '카드'}: 화면에 씨앗 번호 없음`);
    if (html.includes('data-single="false"')) {
      ok(html.includes(a.clues.weather) && html.includes(a.clueMore.weather),
        `${opened ? '열림' : '닫힘'}: 독립 검산한 날씨 짧은·상세 단서 그대로 표시`);
    }
  }
}

// h4/order.js를 가져와 실행하는 대신 아산 정상 계획+태양광 20기를 독립 생성한다.
// 이 회귀는 접속 반사실: 원본과 같이 reCap만 전량으로 바꾸고 출력제어는 고정한다.
{
  id = session.team = 'asan';
  const S = C.newState(session.room, R.id, 0, ['asan', 'pyeongtaek'], { turns: 12, seedMode: 'fixed' });
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = clone(D.normalStartPlans[id]), connected = new Set(plan.lines.flatMap(l => l.p));
  const solar = B.TILES.filter(t => !t.out && t.site < 0 && !B.siteRule('solar', t) &&
    t.nb.some(i => connected.has(i))).slice(0, 20);
  equal(solar.length, 20, `h4 ${C.teamDef(R, id).name} 태양광 20기`);
  for (const t of solar) {
    plan.builds.push({ t: 'solar', i: t.i });
    plan.lines.push({ p: [t.nb.find(i => connected.has(i)), t.i] });
  }
  S.teams[id].plan = plan;
  const op = clone(S); C.refreshGrid(op, B, true);
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const mods = C.modsFor({ ...op, events: [] }, R, id);
  mods.reCap = Object.fromEntries(op.grid[id].entries.map(b => [b.key, b.mw]));
  const sample = seed => simulate({ ...B.sanitize(clone(plan), 1e9), seed, season: 'autumn' }, 7,
    { league: true, mods: clone(mods) });
  const samples = [sample(707), sample(714)], metrics = samples.map(s => weatherMetrics(s, plan, mods));
  const [before, after] = metrics;
  ok(after.available > before.available && after.renewable < before.renewable,
    `${C.teamDef(R, id).name} 가을 707→714: 가능량 증가·실제 공급 감소(출력제어/잉여 공급 반영)`);
  near(after.demand - before.demand, 0, 'h4 평균 수요 변화 0');
  equal(Number((after.uns - before.uns).toFixed(3)), 2.536, 'h4 보고된 정전 변화 +2.536%p 독립 재현');

  // 이미 독립 계산한 실제 모델 출력을 엔진 경계에 공급해 공개 API의 요약을 검사한다.
  // 통상 접속/분해 산식은 위 기본 사례와 32에서 실제 엔진 전체 입력으로 검증한다.
  const shares = [];
  for (const pair of [samples, [...samples].reverse()]) {
    const { V, res, trial } = fixture({ city: 'asan', sameWeather: true, season: 'autumn' });
    const spy = B.simulate; let index = 0, a;
    B.simulate = (...args) => { calls.push(clone(args)); return pair[index++ < 2 ? 0 : 1]; };
    try { a = attribution(V, res, id); } finally { B.simulate = spy; }
    const expected = pair.map(s => weatherMetrics(s, plan, mods));
    weatherClue(a, ...expected, { ...res, days: trial.days }, res);
    weatherDOM(V, res, a);
    ok(a.clues.weather.startsWith('하루 재생 공급량'), 'h4 양·음 몫 모두 절댓값이 큰 공급량 먼저');
    shares.push(a.parts.find(p => p.key === 'weather').value);
  }
  near(shares[0], -shares[1], '같은 모델의 씨앗 순서 역전: 같은 크기·반대 부호의 날씨 몫');
  console.log(JSON.stringify({ regression: `h4 ${C.teamDef(R, id).name} 가을 707→714`, metrics, shares }));

  // 단서 문구의 정확한 1 MW 동률 경계. 수요 +1 MW·공급 +1 MW가 서로 반대 효과다.
  // 몫의 부호만 반전해도 두 물리 단서와 순서는 동일해야 한다.
  const clues = [];
  for (const sign of [-1, 1]) {
    // D-74: 복제 결과에는 gridFill 보조자료가 없다. 같은 seed의 새 원본을 만들어
    // 물리 단서 동률 픽스처만 바꾼다(허용 오차/대상 제외 없이 원래 단서 검증 유지).
    const pair = [sample(707), sample(714)].map((s, i) => {
      const copy = s;
      copy.tot.dem = (10 + i) * copy.H;
      copy.tot.ren = (10 + i) * 24 * copy.days;
      copy.hrDem.fill(10 + i); // D-80: 총수요와 시간별 수요를 일치시킨다.
      copy.unsTotal = copy.tot.dem * (70 + i * sign * 5) / 100; // D-80: 매시간 50% 계통 상한 뒤 정전 20→20±5%.
      copy.hrUns.fill(copy.unsTotal / (copy.H * copy.NT)); // D-80: gridFill의 시간별 부족도 같은 합성 조건.
      return copy;
    });
    const { V, res, trial } = fixture({ sameWeather: true, empty: true }); // D-80: ±5%p 정전 표시 픽스처, 계통량 분기는 별도 검증.
    const spy = B.simulate; let index = 0, a;
    B.simulate = (...args) => { calls.push(clone(args)); return pair[index++ < 2 ? 0 : 1]; };
    try { a = attribution(V, res, id); } finally { B.simulate = spy; }
    const expected = pair.map(s => weatherMetrics(s, plan, mods));
    weatherClue(a, ...expected, { ...res, days: trial.days }, res);
    weatherDOM(V, res, a);
    near(a.parts.find(p => p.key === 'weather').value, sign * 5, '단서 부호 경계 ±5%p');
    ok(a.clues.weather.startsWith('평균 수요'), '1 MW 동률은 양·음 몫 모두 수요 먼저');
    clues.push(a.clues.weather);
  }
  equal(clues[0], clues[1], '같은 물리 변화·반대 부호에서도 닫힘/열림 단서 불변');
}

// 실제 계획에서 판정한 플래그와 저장 렌더링의 방향 검사를 분리한다.
for (const city of ['pyeongtaek', 'hwaseong']) {
  const { V, res, trial, expected } = fixture({ city, sameWeather: true,
    wind: city === 'hwaseong', fullConnection: city === 'hwaseong' });
  const base = attribution(V, res, id), connected = city === 'hwaseong';
  weatherClue(base, ...expected.weather, { ...res, days: trial.days }, res);
  equal(base.hasConnectedWind, connected, `${city}: 정상 계획${connected ? '+연결 육상풍력' : ''}의 실제 플래그`);
  if (connected) ok(Number.isFinite(expected.weather[1].wind), `${C.teamDef(R, city).name} 실제 육상 허브 풍속 유한값`);
  for (const legacy of [false, true]) for (const key of ['wind', 'grid', 'evening'])
    for (const cause of causes) for (const sign of [-1, 1]) for (const change of [-3, 3]) {
      const parts = causes.map(k => ({ key: k, value: k === cause ? sign * 9.43 : .1 }));
      const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      parts }; // D-80: C-1·2·4·5 대상별 검사.
      if (legacy) delete frozen.hasConnectedWind;
      const previous = { interview: { months: { [res.round - 1]: { evidenceValues: { [key]: 100 } } } } };
      storage.set(`kcp-league-data-v1:${session.room}:${id}`, JSON.stringify(previous));
      const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen,
        missed: cause, evidence: { key, value: 100 + change, text: '가상 근거' } });
      const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
      const links = key === 'wind' ? { weather: connected && !legacy ? 'direct' : 'indirect', event: connected && !legacy ? 'direct' : 'indirect' } :
        key === 'grid' ? { choice: 'stage' } // 명세 A2: 시험 기준 내 선택도 같은 단계.
        : { choice: 'stage', weather: 'direct', event: 'direct' };
      const direct = links[cause] === 'direct', label = `${city}/${legacy ? '옛 기록' : '새 기록'}/${key}→${cause}/${sign}/${change}`;
      for (const [kind, prefix] of [['direct', '직접 연결 — '], ['stage', '같은 단계와 연결 — '], ['indirect', '간접 연결 — ']]) {
        const linked = parts.filter(p => links[p.key] === kind);
        equal(text.includes(prefix), linked.length > 0, `${label}: ${kind} 연결`);
        if (linked.length) ok(text.includes(prefix + linked.map(p => `${names[p.key]} ${number(p.value, true)}%p`).join(' / ')), `${label}: 연결된 몫·순서`);
      }
      equal(text.includes('고른 근거는 이번 차이의 가장 큰 몫과도 이어져요.'),
        false, `${label}: 시험 기준은 월간 변화로 방향 칭찬하지 않음`);
      equal(text.includes('고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요.'),
        false, `${label}: 시험 기준은 월간 변화로 반대 방향 판정하지 않음`);
      equal(text.endsWith(`고른 근거가 가장 큰 몫(${names[cause]})과 같은 이야기예요.`),
        direct, `${label}: 직접 연결이면 중립 마무리`);
      // 명세 A2: grid→choice는 중립 칭찬 없이 다음 근거를 권한다.
      if (key === 'grid' && cause === 'choice') ok(!text.includes('같은 이야기') && /다음에는 .+도 근거로 살펴봐요/.test(text), `${label}: A2 다음 근거`);
      if (direct) ok(!/다음에는 .*살펴봐요/.test(text), `${label}: 이미 고른 직접 근거의 재검토 권유 없음`);
    }
}

// V3B-fix3 §3: 동일 근거 변화·몫에서 basis만 바꿔 판정 차이를 검증한다.
{
  const { V, res } = fixture({ sameWeather: true }), base = attribution(V, res, id);
  const previous = { interview: { months: { [res.round - 1]: { evidenceValues: { evening: 100 } } } } };
  storage.set(`kcp-league-data-v1:${session.room}:${id}`, JSON.stringify(previous));
  for (const sign of [-1, 1]) for (const basis of ['trial', 'monthly', undefined]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      basis, // D-80: C-1·2·4·5 대상별 검사.
      parts: causes.map(key => ({ key, value: key === 'weather' ? sign * 9.43 : .1 })) };
    if (basis === undefined) delete frozen.basis;
    const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen,
      missed: 'weather', evidence: { key: 'evening', value: 103, text: '가상 저녁 수요' } });
    const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
    const name = basis === 'monthly' ? '날씨·계절·운전 기간' : names.weather;
    equal(text.endsWith(`고른 근거가 가장 큰 몫(${name})과 같은 이야기예요.`),
      basis !== 'monthly', `${basis}/${sign}: trial·기준 누락본만 중립 연결`);
    equal(text.includes('고른 근거는 이번 차이의 가장 큰 몫과도 이어져요.'),
      basis === 'monthly' && sign > 0, `${basis}/${sign}: 월간 방향 일치`);
    equal(text.includes('고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요.'),
      basis === 'monthly' && sign < 0, `${basis}/${sign}: 월간 방향 반대`);
    equal(text.endsWith('이 근거만으로 이번 차이의 방향을 설명하기는 어려워요.'),
      basis === 'monthly' && sign < 0, `${basis}/${sign}: 반대 방향 마무리`);
    if (basis === 'monthly' && sign < 0) ok(!/다음에는|살펴봐요/.test(text),
      '직접 연결·반대 방향: 이미 고른 근거 재검토 권유 없음');
  }
}

// V3B-fix3 §4: 기준 없는 옛 고정본의 작은 선택을 다시 그려도 카드·꼬리표 보존.
{
  const { V, res } = fixture({ changed: true }), base = attribution(V, res, id);
  const later = { ...clone(V), round: 2 }, result = { ...clone(res), round: 2 };
  for (const tiny of [0, .049999, -.049999]) for (const large of [0, 1, 3]) {
    const old = { ...clone(base), // D-80: target 없는 옛 frozen 호환.
      round: 2, // D-80: C-1·2·4·5 대상별 검사.
      parts: causes.map((key, i) => ({ key, value: i < large ? 9 - i : key === 'trade' ? tiny : 0 })) };
    delete old.target; delete old.basis; // D-80: C-4, 구기록 호환.
    const before = JSON.stringify(old);
    calls = [];
    const html = league.uiMath.outageCardsHTML(later, result, id,
      { outageOpened: true, missed: 'trade', outageFrozen: old });
    const cards = [...html.matchAll(/<button\b[^>]*data-missed="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
    const expected = large === 3 ? ['choice', 'weather', 'trade'] : large === 1 ? ['choice', 'trade'] : ['trade'];
    equal(cards.map(m => m[1]), expected, `${large}/${tiny}: 최대 3장·분해 순서로 작은 선택 보존`);
    equal(cards.filter(m => m[2].includes('data-out-tag="picked"') && m[2].includes('내가 고름')).map(m => m[1]),
      ['trade'], `${large}/${tiny}: 내가 고름은 작은 선택 카드에 유지`);
    ok(!html.includes('data-single="true"') && !html.includes('data-out-other="trade"'),
      `${large}/${tiny}: 작은 선택을 요약/카드 밖 후보로 내리지 않음`);
    equal(JSON.stringify(old), before, '옛 고정본 불변');
    equal(calls.length, 0, '옛 작은 선택 재렌더링 추가 계산 0');
  }
}
// 총괄 10-22 녹화 전 점검: S6·S7 근거 부호 통일(옛 D-80 B-2 grid −1 분리 계약 대체).
// S6(promiseResultHTML)은 공개 API가 아니므로 공용 도우미 evidenceEffect를 소스에서 꺼내 VM으로 동작을 확인하고,
// 두 화면이 그 도우미 하나만 부르는지 소스 범위로 확인한다.
{
  const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a + 1);
    ok(a >= 0 && b > a, `소스 범위 찾기: ${from.trim()}`); return source.slice(a, b); };
  const promiseSource = slice('  function promiseResultHTML(', '  function newBuildCost(');
  const s7Source = slice('  function outageEvidenceText(', '  function outageTargetClues(');
  const effectSource = slice('  function evidenceEffect(', '  function promiseResultHTML(');
  ok(!promiseSource.includes('{ evening: 1, grid: -1, wind: -1, neighbor: 1 }'), 'S6: 옛 부호표(grid −1) 제거');
  ok(!s7Source.includes('{ evening: 1, grid: 0,'), 'S7: 따로 둔 부호표 제거');
  ok(/evidenceEffect\(n\.evidence\.key,/.test(promiseSource) && /effectSign = evidenceEffect\(key,/.test(s7Source),
    'S6·S7이 같은 도우미 evidenceEffect로 부호를 정함');
  ok(/고른 근거도 같은 쪽으로 움직였나요: \$\{esc\(evidenceText\)\}/.test(promiseSource) &&
    /const evidenceText = !effect\.sign \? effect\.reason/.test(promiseSource),
    'S6: 부호 0이면 같은/다른 방향 대신 비교하지 않는 이유를 보임');
  const effect = vm.runInNewContext(`${effectSource}; evidenceEffect`, {});
  for (const topic of ['uns', 'grid']) {
    const sign = (key, hasConnectedWind = false) => effect(key, { topic, hasConnectedWind }).sign;
    equal([sign('evening'), sign('neighbor'), sign('grid'), sign('grid', true), sign('wind', true), sign('wind', false), sign('fuel')],
      [1, 1, 0, 0, -1, 0, 0], `${topic}: 저녁 +1·이웃 +1·접속 여유 0·풍속(접속 풍력 있음 −1/없음 0)·LNG 0`);
    for (const key of ['grid', 'fuel', 'wind']) {
      const e = effect(key, { topic, hasConnectedWind: false });
      ok(e.sign === 0 && typeof e.reason === 'string' && e.reason.includes('비교하지 않아요') &&
        !/같은 방향|다른 방향/.test(e.reason), `${topic}/${key}: 부호 0이면 비교하지 않는 이유`);
    }
  }
}

// 수정 1의 재현: 재생 0·풍력 없음인데 무더위 수요로 정전이 늘어나는 두 씨앗.
{
  const { V, res, trial, expected } = fixture({ sameWeather: true, trialSeed: 7117, actualSeed: 11, season: 'summer' });
  const a = attribution(V, res, id);
  weatherClue(a, ...expected.weather, { ...res, days: trial.days }, res);
  ok(expected.weather.every(w => w.renewable === 0 && w.wind === null && w.offshoreWind === null),
    '씨앗 7117→11: 접속 재생·풍력 0의 실제 시뮬레이션');
  ok(expected.weather[1].demand > expected.weather[0].demand && expected.weather[1].hotDays > expected.weather[0].hotDays &&
    a.parts.find(p => p.key === 'weather').value > .05, '무더위·평균 수요 증가로 양의 날씨 몫(바람으로 설명하면 실패)');
  console.log(JSON.stringify({ regression: '재생0 수요 날씨', seeds: [trial.seed, res.seed], weather: expected.weather,
    weatherShare: a.parts.find(p => p.key === 'weather').value, clue: a.clues.weather }));
}
// 작은 대기 줄과 병목 설명 위치를 닫힘/열림 및 양·음 문턱에서 검사한다.
{
  const { V, res } = fixture({ changed: true }), base = attribution(V, res, id);
  for (const waitingMW of [0, 2]) for (const value of [0, .049999, .05, .050001, -.049999, -.05, -.050001, NaN, Infinity, -Infinity]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      grid: { waitingMW, value } }; // D-80: C-1·2·4·5 대상별 검사.
    session.outCache[base.trialIdentity] = frozen;
    const closed = league.uiMath.outageCardsHTML(V, res, id, {});
    const opened = league.uiMath.outageCardsHTML(V, res, id, { outageFrozen: frozen, outageOpened: true });
    equal(bottleneck(closed, frozen.grid, '닫힘'), bottleneck(opened, frozen.grid, '열림'), '병목/작은 대기 줄은 공개 상태와 무관');
  }
}

// 접속 대기 있는 첫 달은 연결 반사실 1회를 추가한다. 대기 없는 위 사례는 4회다.
{
  const { V, res, trial, expected } = fixture({ noEvents: true, sameWeather: true });
  const a = attribution(V, res, id);
  ok(a && a.grid.waitingMW > 0, '시험 기준 접속 대기 >0 픽스처');
  equal(calls.length, 5, '접속 대기 있는 시험 기준 정확히 5회');
  equal(a.simulations, calls.length, '접속 대기 있는 시험 보고 호출 수');
  equal(calls.map(([p]) => p.seed), [trial.seed, trial.seed, res.seed, res.seed, res.seed],
    '시험 기준 대기 반사실까지 실제 씨앗');
  equal(calls.map(([, days]) => days), [trial.days, trial.days, res.days, res.days, res.days],
    '시험 기준 대기 반사실까지 실제 운영 기간');
  ok(a.grid.value < -minPart(a), '접속 대기 연결 반사실이 대상 지표를 줄임'); // D-80: C-1·5.
  near(a.grid.value, expected.grid.value, '시험 기준 전량 연결−실제 고립 독립 검산');
  const html = league.uiMath.outageCardsHTML(V, res, id, {});
  bottleneck(html, expected.grid, '시험 기준 대기 병목', a); // D-80: C-1·4.
  weatherClue(a, ...expected.weather, { ...res, days: trial.days }, res);
  const count = calls.length;
  ok(attribution(V, res, id) === a, '접속 대기 있는 시험 캐시 반환');
  equal(calls.length, count, '접속 대기 있는 시험 캐시 추가 호출 0');
}

// 표시 문턱은 계산 경로와 분리해 정확한 양·음 경계값으로 검증한다.
{
  const { V, res } = fixture({ changed: true });
  const base = attribution(V, res, id);
  for (const replay of [.004999, .005, .005001, -.004999, -.005, -.005001]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      replay }; // D-80: C-1·2·4·5 대상별 검사.
    const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen });
    equal(html.includes('data-out-step="replay"'), Math.abs(replay) >= .005, `${replay} 시험 재현 줄 경계`);
    equal(html.includes('id="lg-outage-replay"'), Math.abs(replay) >= .005, `${replay} 시험 재현 설명 경계`);
  }
  // basis 없는 옛 기록은 2월 이후에도 시험 기준 이름·문구를 유지한다.
  const old = clone(base); delete old.target; delete old.basis; old.round = 2; // D-80: C-4, 구기록 호환.
  const later = { ...clone(V), round: 2 }, result = { ...clone(res), round: 2 };
  calls = [];
  const html = league.uiMath.outageCardsHTML(later, result, id,
    { outageOpened: true, missed: 'weather', outageFrozen: old });
  ok(html.includes('날씨·운전 기간') && !html.includes('날씨·계절·운전 기간') &&
    html.includes('약속 판정은 지난달 대비, 아래 나누기는 시험 대비예요.'),
    'basis 없는 옛 2월 기록도 시험 이름·기준 차이 안내');
  equal(calls.length, 0, '옛 고정 분해는 재계산 0');
}

// C-lastmonth.md §4: 첫 달 결과를 이 기기에서 받지 않은 2월에는 시험으로
// 대신하지 않는다. 사본이 있는 월간 경로·일곱 단계 검산은 32번에서 다룬다.
for (const noEvents of [false, true]) {
  const { V, res } = fixture({ changed: true, month: 2, noEvents });
  equal(res.round, 2, '실제 엔진으로 2월까지 진행');
  equal(attribution(V, res, id), null, '2월 시험이 있어도 지난달 사본 없으면 분해 불가');
  const html = league.uiMath.outageCardsHTML(V, res, id, {});
  ok(html.includes('지난달 운영 조건이 이 기기에 없어 나누지 못해요'), '사본 없는 달 안내');
  ok(!/data-missed=|data-out-other=|data-out-step=|id="lg-outage-(?:cards|waterfall|single|open)"/.test(html),
    '사본 없는 2월은 시험 대비 분해·카드·폭포 없음');
}

// 17행: 운영 뒤 바뀐 인구를 사용하면 분해가 달라지는 회귀를 잡는다.
{
  const { V, res } = fixture({ changed: true });
  const baseline = clone(attribution(V, res, id));
  session.outCache = {};
  V.econ.cities[id].pop *= 2;
  V.econ.cities[id].ind *= 2;
  const after = attribution(V, res, id);
  equal(after.parts, baseline.parts, '분해 수요는 econ.before의 운영 당시 주민·산업');
}

for (const kind of ['no-trial', 'plan-phase', 'later-month', 'missing-event-size', 'missing-before', 'zero-days']) {
  const { V, res } = fixture({ changed: true });
  if (kind === 'no-trial') storage.delete('kcp-build-trial-v1');
  if (kind === 'plan-phase') V.phase = 'plan';
  if (kind === 'later-month') V.round++;
  if (kind === 'missing-event-size') delete V.events[0].x;
  if (kind === 'missing-before') delete V.econ.before;
  if (kind === 'zero-days') res.days = 0;
  equal(attribution(V, res, id), null, `17–19행: ${kind}는 계산하지 않음`);
  equal(calls.length, 0, `${kind} 시뮬레이션 0`);
  if (['missing-before', 'missing-event-size', 'zero-days'].includes(kind)) {
    const html = league.uiMath.outageCardsHTML(V, res, id, {});
    ok(!html.includes('한 번 더 시도') && html.includes('이번 달은 원인 나누기를 표시하지 않아요'),
      `${kind}: 구조적 null은 재시도 약속 없이 이번 달 표시 불가 안내`);
  }
}
// 재현 차이가 가장 커도 후보 순위·고르기 생략 판정에 넣지 않는다.
{
  const { V, res, trial } = fixture({ sameWeather: true, replayOffset: .125 }); // D-80: 정전 대상(저장 시험 0.125%).
  const a = attribution(V, res, id); // D-80: 대상 확인.
  const html = league.uiMath.outageCardsHTML(V, res, id, {});
  ok(html.includes('data-single="true"') && html.includes('id="lg-outage-single"'),
    '다른 몫이 모두 0.05%p 미만이면 한 줄 요약');
  ok(!html.includes('data-missed=') && !html.includes('id="lg-outage-open"'),
    '한 원인 분기는 고르기 강요 없음');
  ok(!session.outShownPending.largest && html.includes(noCauseLabel(trial.unsPct, res.team[id].unsPct, a.target)), // D-80: C-1·2·4·5 대상별 검사.
    '재현 차이가 커도 모든 원인이 미미하면 최대 몫 저장 대기 없음');
}

// 열기 전 같은 결과 화면에서 시험이 바뀌면 새 시험 기준으로 다시 계산한다.
for (const field of ['seed', 'days', 'plan']) {
  const { V, res, trial } = fixture({ changed: true });
  const before = attribution(V, res, id), next = clone(trial);
  if (field === 'plan') next.plan.policies = ['save'];
  else next[field]++;
  const bucket = JSON.parse(storage.get('kcp-build-trial-v1'));
  bucket[Object.keys(bucket)[0]] = next;
  storage.set('kcp-build-trial-v1', JSON.stringify(bucket));
  calls = [];
  const after = attribution(V, res, id);
  ok(after && after !== before, `${field} 변경 시 새 분해`);
  equal(calls.length, after.grid.waitingMW > 0 ? 5 : 4, `${field} 변경 시 대기에 따른 정확한 시험 호출 수`);
  if (field !== 'plan') equal(field === 'seed' ? calls[0][0].seed : calls[0][1], next[field], `${field} 새 시험 입력`);
  else equal(calls[0][0].policies, next.plan.policies, '새 시험 계획 입력');
}

// V3B-fix4: 엔진으로 만든 첫 달 빈 설비. 표시 숫자는 독립 simulate의 총수요/미공급으로 검산.
{
  const { V, res, trial, expected } = fixture({ empty: true, noEvents: true });
  const a = attribution(V, res, id), [before, after] = expected.rates;
  // D-74: 빈 계획 시험/실제100→50%. 고립 원시 운전은 여전히100%.
  ok(Math.abs(before - 100 * (1 - D.params.gridImportShare.v)) < 1e-5, 'D-74 첫 달 빈 설비 시험 정전율(Float32 누적)');
  ok(Math.abs(after - 100 * (1 - D.params.gridImportShare.v)) < 1e-5, 'D-74 첫 달 빈 설비 실제 정전율(Float32 누적)');
  near(trial.unsPct, before, '실제 저장 시험 = 독립 미공급/수요');
  // D-74: 실제 공개 정전율은 소수 둘째 자리, 독립 시간별 수입은 Float32 누적.
  ok(Math.abs(res.team[id].unsPct - after) <= .0051, '거래 없는 실제 운영 = 독립 미공급/수요(공개 반올림)');
  ok(expected.parts.every(p => Math.abs(p.value) < .05), '빈 설비의 네 차이 몫은 미미함'); // D-80: C-1·2·4·5 대상별 검사.
  for (const opened of [false, true]) {
    const html = league.uiMath.outageCardsHTML(V, res, id, { outageOpened: opened });
    studentWords(html, `첫 달 극단/${opened}`);
    ok(html.includes(`시험 ${number(before)}% → 실제 ${number(after)}%로 거의 같아요`),
      '첫 달 요약 인용값 = 독립 시험·실제 정전율');
    ok(html.includes('차이 원인 없음(정전 자체는 큼)') && html.includes(highOutageCopy(V, res)) /* rev10 R5 */, '첫 달 높은 정전은 설비·접속 부족·재점검 안내');
    ok(!/data-missed=|id="lg-outage-open"|data-out-tag="largest"|가장 큰 몫/.test(html),
      '첫 달 높은 정전 요약은 선택·최대 몫을 꾸미지 않음');
  }
}

// 수정 5 사례 A와 변형: 합계 항등식을 만족하는 저장 분해 렌더링 픽스처.
// 큰 차이를 몫 0이나 높은 기준값의 전제로 설명하지 않는다. 0.05%p 비교 문턱도 별도로 검사.
{
  const { V, res } = fixture({ sameWeather: true }), base = clone(attribution(V, res, id));
  for (const [before, after, smallDifference] of [[6, 30, false], [1, 30, false],
    [8, 8.049999, true], [8, 8.05, false], [8, 8.050001, false]]) {
    const difference = after - before, label = `A 시험 ${before}% → 실제 ${after}%`;
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: before, actual: after, total: difference, replay: difference, // D-80: C-1·2·4·5 대상별 검사.
      parts: base.parts.map(p => ({ ...p, value: 0 })), grid: { waitingMW: 0, value: 0 } };
    near(frozen.replay + frozen.parts.reduce((sum, p) => sum + p.value, 0), difference,
      `${label}: 재현 차이 + 네 몫 = 실제 차이 독립 검산`); // D-80: C-1·2·4·5 대상별 검사.
    for (const opened of [false, true]) {
      const html = league.uiMath.outageCardsHTML(V, res, id,
        { outageSingleShown: true, outageOpened: opened, outageFrozen: frozen });
      const summary = html.match(/<p id="lg-outage-single">([\s\S]*?)<\/p>/)?.[1] || '';
      ok(summary.includes(`시험 ${number(before)}% → 실제 ${number(after)}%`), `${label}: 요약 수치`);
      equal(summary.includes('로 거의 같아요'), smallDifference, `${label}: 작은 차이만 거의 같음`);
      equal(summary.includes('차이의 대부분은 재현 차이(저장된 시험과 같은 조건 재계산의 차이)예요 — 원인 후보로 나눌 수 없어요'),
        !smallDifference, `${label}: 큰 차이의 재현 한계 설명`);
      equal(summary.includes('바뀐 조건 하나하나는 정전을 거의 바꾸지 않았어요'), smallDifference,
        `${label}: 큰 재현 차이에 작은 변화 설명 금지`);
      equal(summary.includes('이번 달 변화보다'), smallDifference, `${label}: 0.05%p 미만에만 비교`);
      equal(summary.includes('시험에도 정전이 컸으니'), before >= 5, `${label}: 기준값이 높을 때만 전제`);
      ok(summary.includes(highOutageCopy(V, res)) /* rev10 R5 */, `${label}: 실제 높은 정전 안내 유지`);
      ok(html.includes(noCauseLabel(before, after)) && !/data-missed=|data-out-tag="largest"|가장 큰 몫/.test(html),
        `${label}: 후보·최대 몫 없이 기록`);
      ok(!session.outShownPending.largest, `${label}: 최대 몫 저장 대기 없음`);
    }
  }
}

// 계산 픽스처와 분리한 저장 분해 렌더링 경계. 기록은 두 표시값, 안내는 실제 표시값 기준.
{
  const { V, res } = fixture({ sameWeather: true });
  const base = clone(attribution(V, res, id));
  for (const [milliPct, shown, high] of [[4994, '4.99', false], [4995, '5.00', true],
    [4999, '5.00', true], [5000, '5.00', true]]) {
    // 정수 천분율 → 정수 백분율: 구현의 toFixed/상수에 기대값을 맞추지 않는다.
    equal(Math.floor((milliPct + 5) / 10), Number(shown) * 100, `${milliPct}: 표시값 독립 계산`);
    equal(shownHigh(milliPct / 1000), high, `${milliPct}: 5.00% 표시 경계`);
  }
  for (const [before, after] of [[100, 100], [5, 5], [5, 5.02], [5.02, 5],
    [4.99, 5.02], [5.02, 4.99], [4.99, 4.99], [4.999, 5.001], [5.001, 4.999],
    [4.994, 4.994], [4.995, 4.995], [4.994, 5], [5, 4.994], [4.995, 5], [5, 4.995],
    [4.999, 5], [5, 4.999]]) {
    const high = shownHigh(before) && shownHigh(after), actualHigh = shownHigh(after), label = `시험 ${before}% → 실제 ${after}%`;
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: before, actual: after, total: after - before, replay: 0, // D-80: C-1·2·4·5 대상별 검사.
      parts: base.parts.map(p => ({ ...p, value: (after - before) / 4 })) };
    for (const opened of [false, true]) {
      const html = league.uiMath.outageCardsHTML(V, res, id,
        { outageSingleShown: true, outageOpened: opened, outageFrozen: frozen });
      studentWords(html, `${label}/${opened}`);
      ok(html.includes('data-single="true"') && html.includes(noCauseLabel(before, after)), `${label}: 경계 기록 문구`);
      ok(html.includes(`시험 ${number(before)}% → 실제 ${number(after)}%로 거의 같아요`), `${label}: 원시 입력 인용`);
      equal(html.includes('정전 자체는 큼'), high, `${label}: 두 표시값 모두 5.00% 이상`);
      equal(html.includes(highOutageCopy(V, res)) /* rev10 R5 */, actualHigh, `${label}: 실제 표시값 기준 설비·접속 안내`);
      equal(html.includes(highOutageCopy(V, res)) /* rev10 R5 */, actualHigh, `${label}: 실제 표시값 기준 재점검 안내`);
      equal(html.includes('시험에도 정전이 컸으니'), high, `${label}: 높은 기준값 전제`);
      equal(html.includes('이번 달 변화보다'), actualHigh, `${label}: 작은 차이일 때만 비교`);
      ok(!session.outShownPending.largest && !html.includes('data-out-tag="largest"'), `${label}: 최대 몫 없음`);
    }
  }
}

// 수정 5 사례 B: 실제 econClick 저장 분기. 브라우저/GUI 클릭 검증은 아니다.
// 요약 DOM을 제공하지 않아 옛 핸들러가 요약으로 오판하면 저장 단언이 실패한다.
{
  const { S, V, res } = fixture({ sameWeather: true }), base = clone(attribution(V, res, id));
  session.role = 'fixture'; session.snap = V;
  for (const tiny of [0, .049999, -.049999]) for (const large of [0, 1]) {
    const label = `B 시험 고정본 선택 ${tiny}, 최대 ${large}`;
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: 6, actual: 6 + large + tiny, total: large + tiny, replay: 0, // D-80: C-1·2·4·5 대상별 검사.
      parts: causes.map(key => ({ key, value: key === 'choice' ? large : key === 'trade' ? tiny : 0 })) };
    const note = { outageSingleShown: true, missed: 'trade', missedBasis: 'trial', outageFrozen: frozen };
    const storageKey = `kcp-league-data-v1:${session.room}:${id}`;
    storage.set(storageKey, JSON.stringify({ interview: { months: { [res.round]: note } } }));
    calls = [];
    const publicBefore = JSON.stringify({ S, V });
    const before = league.uiMath.outageCardsHTML(V, res, id, note);
    ok(before.includes('data-single="false"') && before.includes('data-opened="true"'), `${label}: 선택 카드 공개 유지`);
    ok(before.includes('내가 고른 것: 이웃 거래') && !before.includes('내가 고른 것: 고르기 생략'), `${label}: 화면에 실제 선택`);
    const picked = before.match(/<button\b[^>]*data-missed="trade"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    ok(picked.includes('aria-pressed="true"') && picked.includes('data-out-tag="picked"'), `${label}: 선택 카드·꼬리표 유지`);
    ok(/id="lg-outage-carry"\s*>/.test(before), `${label}: 붙이기 활성`);
    equal(league.__carryClick({ target: { closest: selector => selector === '#lg-outage-carry' ? {} : null } }), true,
      `${label}: 붙이기 핸들러 실행`);
    const saved = JSON.parse(storage.get(storageKey)).interview.months[res.round];
    equal(saved.missedCarry, { basis: 'trial', target: frozen.target, missed: 'trade', ...(large ? { largest: { key: 'choice', value: large } } : {}) },  // D-80: C-4, 다음 달 줄의 단위를 위해 대상도 기기 안에 남긴다.
      `${label}: 붙이기 클릭으로 선택 저장`);
    equal(saved.outageFrozen, frozen, `${label}: 고정 분해값 불변`);
    equal(saved.missed, 'trade', `${label}: 원래 선택 불변`);
    const after = league.uiMath.outageCardsHTML(V, res, id, saved);
    equal(after.split('<button type="button" class="v2-btn" id="lg-outage-carry"')[0],
      before.split('<button type="button" class="v2-btn" id="lg-outage-carry"')[0], `${label}: 붙인 뒤 카드·판정 불변`);
    ok(/id="lg-outage-carry" disabled/.test(after), `${label}: 붙이기 완료 표시`);
    const next = { ...clone(V), round: res.round + 1 };
    const carry = league.__carryHTML(next), journal = league.__worksheet(next), trend = league.uiMath.trendHTML(next, id, true);
    ok(carry.includes('지난달 내가 고른 원인: 이웃 거래') && journal.includes('내가 고른 원인: 이웃 거래') &&
      trend.includes('내가 고른 원인: 이웃 거래'), `${label}: 화면·S4·일지·타임라인 선택 일치`);
    ok(![carry, journal, trend].some(text => text.includes('고르기 생략')), `${label}: 기록을 고르기 생략으로 덮지 않음`);
    equal(JSON.parse(storage.get(storageKey)).interview.months[res.round], saved, `${label}: 재렌더/기록 읽기로 저장값 불변`);
    equal(JSON.stringify({ S, V }), publicBefore, `${label}: 공개·운영 상태 불변`);
    equal(calls.length, 0, `${label}: 고정본 저장·기록 읽기에 추가 시뮬레이션 없음`);
  }
}

// DOM 없는 검사는 렌더러가 만든 저장 대기 자료를 직렬화해 기기 메모에 연결한다.
// 실제 클릭 → localStorage 저장 → 1달 재시험 → 새로고침은 s7.py에서 별도로 검사한다.
for (const single of [false, true]) {
  const { V, res, trial } = fixture(single ? { sameWeather: true } : { changed: true });
  session.role = 'solo';
  const a = attribution(V, res, id);
  const ranked = [...a.parts].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const note = { evidence: { text: '가상 근거' }, pred: { uns: 'down' } };
  if (!single) Object.assign(note, { outageOpened: true, missed: ranked[1].key });
  const beforeHTML = league.uiMath.outageCardsHTML(V, res, id, note);
  const beforeSame = beforeHTML.match(/<p id="lg-outage-same">[^<]*<\/p>/)?.[0];
  equal(beforeSame, sameParagraph(note.topic, trial.days), '재시험 전 7일 기준은 시험 1주와');
  const pending = session.outShownPending;
  ok(pending?.frozen, `${single ? '요약' : '열기'}: 표시 시점 분해 저장 대기 자료 존재`);
  note.outageFrozen = clone(pending.frozen);
  if (single) note.outageSingleShown = true;
  if (pending.largest) note.outageLargest = clone(pending.largest);
  note.missedCarry = { missed: single ? '뚜렷한 원인 없음' : note.missed,
    ...(pending.largest ? { largest: clone(pending.largest) } : {}) };
  session.interview = { interview: { months: { [res.round]: note } } };
  const saved = clone(note);
  const bucket = JSON.parse(storage.get('kcp-build-trial-v1'));
  const retrial = { ...trial, days: 30, seed: trial.seed + 1 };
  bucket[Object.keys(bucket)[0]] = retrial;
  storage.set('kcp-build-trial-v1', JSON.stringify(bucket));
  session.outCache = {};
  calls = [];
  const after = attribution(V, res, id);
  const expectedFrozen = clone(a); // D-82: 표시 변경 (b)로 고정되는 사건 문구만 계약에 따라 변환, 숫자는 기존 독립 검산 유지.
  if (a.target === 'grid') for (const field of ['clues', 'clueMore']) expectedFrozen[field].event = a[field].event.replaceAll('우리 도시 정전에 닿는', '우리 도시가 바깥 계통에 기댄 전기에 닿는'); // D-82: 계통 사건 단서의 새 표시 문구, 정전 고정본은 그대로.
  equal(after, expectedFrozen, '공개 뒤 저장 시험·캐시가 바뀌어도 연 시점 분해 유지'); // D-82: 표시 시 고정한 문구를 포함해 모든 필드 엄격 비교.
  const afterHTML = league.uiMath.outageCardsHTML(V, res, id, note);
  const afterSame = afterHTML.match(/<p id="lg-outage-same">[^<]*<\/p>/)?.[0];
  equal(afterSame, sameParagraph(note.topic, retrial.days), '재시험 뒤 30일 기준은 시험 30일과');
  // 같음 기준 이름은 현재 저장 시험을 따르고, 카드 꼬리표·폭포·판정은 같아야 한다.
  const display = html => html.split('<button type="button" class="v2-btn" id="lg-outage-carry"')[0];
  equal(display(afterHTML), display(beforeHTML).replace(beforeSame, sameParagraph(note.topic, retrial.days)),
    '재시험 뒤 기준 이름·조사 변경 외 꼬리표·막대·판정 표시 불변');
  equal(note, saved, '재시험 뒤 기기 메모의 최대 몫·다음 달 기록 불변');
  equal(calls.length, 0, '이미 공개한 달의 재시험 뒤 분해 재시뮬레이션 0');
  if (single) {
    ok(!note.outageLargest && !note.missedCarry.largest, '미미한 몫의 기록에는 최대 몫 없음');
    const timeline = league.uiMath.trendHTML(V, id, true);
    ok(timeline.includes('뚜렷한 원인 없음') && !timeline.includes('가장 큰 몫'),
      '미미한 몫의 타임라인: 뚜렷한 원인 없음');
  }
}

// 렌더링 오류를 한꺼번에 보고하되 실패 종료를 유지한다. 문구 예외로 완화하지 않는다.
const failures = [];
for (const state of ['before-open', 'correct-prediction', 'opened', 'single-shown']) {
  const { V, res } = fixture({ changed: true });
  session.role = 'solo';
  const note = { evidence: { text: '가상 근거' }, pred: { uns: 'down' } };
  if (state === 'correct-prediction') note.outcome = { actual: 'down', hit: true };
  if (state === 'opened') note.outageOpened = true;
  if (state === 'single-shown') note.outageSingleShown = true;
  // 이전 버전에서 최대 몫만 저장한 기록도 표시 허가 없이는 유출되면 안 된다.
  note.outageLargest = { key: 'choice', value: 1.25 };
  session.interview = { interview: { months: { [res.round]: note } } };
  const html = league.uiMath.trendHTML(V, id, true);
  const allowed = state === 'opened' || state === 'single-shown';
  equal(html.includes('data-change="outage"'), allowed, `${state}: 허가된 달에만 원 표시`);
  equal(html.includes('viewBox="0 0 380 346"'), true, '타임라인 높이 346');
  if (allowed) {
    ok(html.includes('가장 큰 몫: 내 선택') && /y="310">원/.test(html), `${state}: 최대 몫·원 표시 위치`);
  } else {
    checks++;
    if (html.includes('가장 큰 몫')) failures.push(`${state}: 타임라인에 ‘가장 큰 몫’ 문구가 남음`);
  }
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`S7 attribution checks ${checks} fail ${failures.length}`);
if (failures.length) process.exitCode = 1;
