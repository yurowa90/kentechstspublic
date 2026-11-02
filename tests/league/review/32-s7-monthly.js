'use strict';
const weatherShort = require('./v8-weather-contract');
const displayContract = require('./rev14b-contract.cjs'); // rev14b A1–A4: 명세의 완전 탐색 oracle.
// 기준: (비공개 작업 지시서) + V3B-fix4.md + V3B-fix3.md + V3B-fix2.md + C-fix3.md + V3B-s7.md(영상 3차), 여섯 단계·호출 상한·0.005%p 재현 문턱. // D-80: C-1·2·4·5 대상별 검사.
// 예상값은 S7 반환값/사본/호출 로그가 아니라 운영 직전 상태와 build/core 모델로 만든다.
// 잡는 회귀: 시험 기준 회귀, 단계 교환/입력 조기 변경, 재현의 합계/후보 혼입,
// 크기순 카드, 사본 공개/보관 누락, 캐시 재계산, 열기 전 기록 유출.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..'), clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x)); // D-80: 빠진 target도 JSON 오류 대신 단언 실패로 보고.
let id = 'pyeongtaek';
const ids = [id, 'dangjin'];
const names = { choice: '내 선택', weather: '날씨·계절·운전 기간', event: '사건·대응',
  progress: '접속·공사·기술 진행', growth: '도시 성장·연료 값', trade: '이웃 거래', gridImport: '계통 수입' };
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

const causes = ['choice', 'weather', 'event', 'progress', 'growth', 'trade']; // D-80: C-2·4, gridImport 이름은 옛 기록용으로만 보존.
const storage = new Map(), session = { room: 'S7MONTHLY', team: id, role: 'fixture', rev: 0 };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
  addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8'), ctx, { filename: name });
// 메모리에서만 세션과 수신 콜백 연결. 실제 onSnap의 사본 저장·삭제 경로를
// 실행한다. 수정4·5의 붙이기 처리·S4·일지 함수도 VM에서만 노출한다.
// 계산 함수 추출/교체나 원본 파일 변경은 없다. 실제 GUI 저장은 s7.py.
const source = fs.readFileSync(path.join(ROOT, 'ui/league.js'), 'utf8');
console.log(`S7 implementation sha256: ${require('node:crypto').createHash('sha256').update(source).digest('hex')}`);
assert.equal(source.split('let L = null;').length, 2);
assert.equal(source.split('state: () =>').length, 2);
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('state: () =>', '__receive: onSnap, __carryClick: econClick, __carryHTML: missedCarryHTML, __worksheet: worksheet, state: () =>'), ctx);
const { leagueCore: C, buildGame: B, ECON_DATA: D, league: U } = ctx.KCP, R = C.regionOf('south');
assert.equal(typeof U.uiMath.outageAttributionMonthly, 'function');
// 팀 역할 S7 사본은 별도 키(sec F3-9, 82efd92), 일지·답변·약속 기록은 팀 자료 키. 방이 바뀌는 사례가 있어 함수로 읽는다.
const key = () => `kcp-league-s7-v1:${session.room}:${id}`;
const teamKey = () => `kcp-league-data-v1:${session.room}:${id}`;
const teamData = () => JSON.parse(storage.get(teamKey()) || '{}');
const saveTeam = d => storage.set(teamKey(), JSON.stringify(d));
const data = () => JSON.parse(storage.get(key()) || '{}');
const save = d => storage.set(key(), JSON.stringify(d));
let checks = 0, failures = 0, orderDiffers = 0;
// 서로 다른 명세 위반을 모두 보고한다. 실패한 단언은 누적하고 exit=1을 유지한다.
function ok(value, label) {
  checks++;
  if (!value) { failures++; console.error(`FAIL ${label}`); }
  return !!value;
}
function eq(a, b, label) {
  checks++;
  try { assert.deepEqual(clone(a), clone(b), label); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
function near(a, b, label, tolerance = 1e-9) {
  ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${label}: ${a} / ${b}`);
}
// V3B-fix5: 독립 반올림 산식(백분율의 1/100 단위). UI 함수·상수는 읽지 않는다.
const shownHigh = value => Number.isFinite(value) && Math.round(value * 100) >= 500;
const noCauseLabel = (before, after) => shownHigh(before) && shownHigh(after) ?
  '차이 원인 없음(정전 자체는 큼)' : '뚜렷한 원인 없음';
// rev10 R5: 이 fixture의 운영 당시 계획에서 독립적으로 미연결 수를 센다.
function highOutageCopy(V, res) {
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = V.teams[id].plan;
  const n = plan ? B.network(B.sanitize(clone(plan),1e9)).nodes
    .filter(x=>x.kind!=='town'&&x.kind!=='import'&&!x.live).length : 0;
  // rev12 E5-a/C4: 운영 사본에서 센 n은 그대로.
  return n ? `이번 달 '전선에 안 닿은 설비'가 ${n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.` :
    '지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요';
}
function studentWords(html, label) {
  const text = html.replace(/<[^>]*>/g, ''); // #lg-missed 전체, 접힌 상세 포함
  ok(!text.includes('S7') && !text.includes('(G)'), `${label}: 학생 영역 내부 표기 미노출`);
}
// 구조·필드·단계는 엄격 비교하되, 독립 산식의 부동소수점 연산 순서 차이만 허용한다.
function inputEq(actual, expected, label) {
  checks++;
  function compare(a, b, at) {
    if (typeof b === 'number') {
      assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-12, `${at}: ${a} / ${b}`);
    } else if (b && typeof b === 'object') {
      assert.equal(Array.isArray(a), Array.isArray(b), at);
      assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), at);
      for (const k of Object.keys(b)) compare(a[k], b[k], `${at}.${k}`);
    } else assert.equal(a, b, at);
  }
  try { compare(actual, expected, label); }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`); }
}
function test(label, fn) { try { fn(); } catch (e) { failures++; console.error(`FAIL ${label}: ${e.stack}`); } }
const rawSimulate = B.simulate;
let calls = [];
B.simulate = (...args) => { calls.push(clone(args)); return rawSimulate(...args); };
function resetCache() { session.outCache = {}; session.outFailures = {}; session.outShownPending = null; }
function select() { B.selectPack(C.teamDef(R, id).pack, 'league'); }
function simulation(plan, seed, season, days, mods) {
  select();
  const p = B.sanitize(clone(plan), 1e9);
  Object.assign(p, { seed, season });
  if (mods.tax && !p.policies.includes('tax')) p.policies.push('tax');
  return rawSimulate(p, days, { league: true, mods: clone(mods) });
}
const uns = s => s.tot.dem > 0 ? 100 * s.unsTotal / s.tot.dem : 0;
const pct = (...args) => uns(simulation(...args));
const number = (v, sign = false, digits = 2, grouped = false) => {
  if (!Number.isFinite(v)) return '–';
  const rounded = Number(v.toFixed(digits)) + 0; // D-80: C-4.
  // D-80: MWh(한 자리)는 같은 카드의 단서 숫자처럼 천 단위 쉼표를 쓴다(검토 minor 2, 총괄 승인 전 리그 갈래 판단).
  const body = grouped || digits === 1 ? Math.abs(rounded).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : Math.abs(rounded).toFixed(digits);
  return `${rounded < 0 ? '−' : sign && rounded > 0 ? '+' : ''}${body}`; // D-80: C-4.
};
const publicMWh = r => Math.max(0, r.isolated.uns - r.uns - r.imp + r.sub); // D-80: 계약 A, 공개 필드만.
const periodDays = res => res.month ? new Date(Date.UTC(res.year, res.month, 0)).getUTCDate() : res.days; // D-80: 월 일수 독립 계산.
const resultValue = (res, target) => target === 'grid' ? publicMWh(res.team[id]) / res.days : res.team[id].unsPct; // D-82: 월 합계 환산을 빼고 공개 보충량/대표 일수로 독립 계산.
function filledValue(raw, target, mul) { // D-80: S7 대신 core 공개 모델로 검산.
  const filled = C.gridFill(raw); // D-80: 모든 단계 동일 계통 상한.
  return target === 'grid' ? (filled.tot.by.import - raw.tot.by.import) * mul : uns(filled); // D-80: C §2, 기존 수입 설비 제외.
} // D-80: 독립 단계 값.
const minPart = a => a?.target === 'grid' ? Math.max(Math.max(.05, .05 * Math.abs(a.trial ?? a.base)) / 10, .05) : .05; // D-82: 기준 하루 평균의 같음 문턱/10, 정전은 유지.
const unitNumber = (a, value, sign = false, rate = false) => a.target === 'grid' ? number(value, sign, displayContract.digits(a), true) + ' MWh/일' : number(value, sign) + (rate ? '%' : '%p'); // rev14b A1: 2자리 달도 모든 계통 숫자에 적용.
const eventText = (text, target) => target === 'grid' ? text.replaceAll('우리 도시 정전에 닿는', '우리 도시가 바깥 계통에 기댄 전기에 닿는') : text; // D-82: 명세 (b)의 표시 기대 문구, 사본 원문은 유지.
// V7 A: 카드에만 Δ의 5%를 더한다. 병목·재현·분해의 기존 눈금은 유지한다.
const cardMin = a => {
  const total = a.total ?? (a.actual - (a.trial ?? a.base));
  return Number.isFinite(total) ? Math.max(minPart(a), .05 * Math.abs(total)) : minPart(a);
};
// oracle의 판정 입력도 명세·합성 원값에서 구한다. 구현의 ranking/cardMin은 호출하지 않는다.
const displayRules = {
  outageCardMin: cardMin,
  outagePartRanking: a => {
    const candidates = a.parts.filter(p => Math.abs(p.value) >= cardMin(a));
    const d = displayContract.digits(a), maximum = Math.max(...candidates.map(p => Math.abs(p.value)));
    return { tied: candidates.filter(p => Math.abs(Number(p.value.toFixed(d))) === Number(maximum.toFixed(d))).map(p => p.key) };
  }
};
const topCards = (parts, a) => [...parts].filter(p => Math.abs(p.value) >= cardMin(a)) // D-80: 대상별 문턱.
  .sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 3);
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
  return { wind: wind('wind'), offshoreWind: wind('offshore'), renewable: s.tot.ren / s.days,
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
  const differentDays = old.days !== current.days;
  const hot = differentDays ? `무더위 ${Math.round(100 * before.hotDays / old.days)}% → ${Math.round(100 * after.hotDays / current.days)}% 날` :
    `무더위 ${before.hotDays} → ${after.hotDays}일`;
  weatherCoverage.add(differentDays ? 'hot-rate' : 'hot-count');
  const expected = [...physical, hot, ...winds,
    `계절 ${season[old.season]} → ${season[current.season]}`].join(' · ');
  ok(short === weatherShort(before, after, old, current), `날씨 짧은 단서 = 독립 수요·재생·기온·접속 풍력·순서: ${short} / ${expected}`);
  ok(full.startsWith(expected + ' · ') &&
    full.includes(`최대 수요 ${fmt(before.peakDemand, 2)} → ${fmt(after.peakDemand, 2)} MW`) &&
    full.includes(`하루 재생 공급량 ${fmt(before.renewable, 1)} → ${fmt(after.renewable, 1)} MWh/일`) &&
    full.includes(`대표 운전 ${old.days} → ${current.days}일`), '상세 물리량·대표 기간 독립 검산');
  ok(full.includes('28℃ 초과') && full.includes('단서 순서는 평균 수요·재생 공급 변화의 절댓값으로 정해요(게임 가정).') &&
    full.includes('재생 공급량은 접속 할당·출력제어를 반영해 실제 공급한 양이에요.'), '무더위 기준·단서 순서 추정 명시');
  ok(full.includes(`28℃ 초과 ${differentDays ? '날의 비율이에요' : '일수예요'}`),
    '상세 무더위 설명도 비교 기간에 맞는 비율/일수');
  ok(!/씨앗|%p/.test(short + full), '날씨 단서에 씨앗 번호·원인 몫 없음');
  eq(a.hasConnectedWind, [after.wind, after.offshoreWind].some(Number.isFinite),
    '저장 분해의 풍력 플래그 = 독립 연결·할당·풍속 계산');
}
function bottleneck(html, grid, label, a = {}) { // D-80: C-1·4·5, 같은 대상·단위·문턱의 반사실.
  const threshold = minPart(a), isGrid = a.target === 'grid'; // D-80: 독립 문턱.
  const box = html.match(/<aside\b[^>]*id="lg-outage-grid-bottleneck"[^>]*>([\s\S]*?)<\/aside>/);
  const show = grid.waitingMW > 0 && Number.isFinite(grid.value) && Math.abs(grid.value) >= threshold; // D-80: C-1·2·4·5 대상별 검사.
  eq(!!box, show, `${label}: 대기>0·|반사실|≥0.05%p일 때만 병목 상자`);
  eq(html.includes('id="lg-outage-single-grid"'), false, `${label}: 옛 병목 선택자 대체`);
  eq((html.match(/data-out-grid=/g) || []).length, Number(show), `${label}: 병목 수치 중복 없음`);
  const small = html.match(/<p\b[^>]*id="lg-outage-grid-small"[^>]*>([\s\S]*?)<\/p>/);
  const showSmall = grid.waitingMW > 0 && Number.isFinite(grid.value) && Math.abs(grid.value) < threshold; // D-80: C-1·2·4·5 대상별 검사.
  eq(!!small, showSmall, `${label}: 작은 대기 줄은 양의 대기·유한 효과·0.05%p 미만`);
  if (small) { // D-80: 계통 단위도 작은 효과 문구에서 검사.
    if (isGrid) ok(small[1].includes('MWh/일') && !small[1].includes('%p') && small[1].includes('접속 대기'), label + ': 작은 계통 효과 단위'); // D-82: 작은 반사실도 하루 평균 단위.
    else eq(small[1], `접속 대기 ${grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MW(효과 0.05%p 이하)`, label + ': 작은 정전 효과 원문'); // D-80: 기존 정전 문구 유지.
  } // D-80: 작은 효과.

  eq((html.match(/id="lg-outage-grid"/g) || []).length, Number(show), `${label}: grid 설명은 병목 상자 있을 때만`);
  if (!box) return small?.[0] || null;
  ok(box[1].includes('id="lg-outage-grid"'), `${label}: grid 설명은 병목 상자 안에만`);
  const raw = box[1].match(/data-out-grid="([^"]+)"[^>]*>([^<]+)<\/b>/);
  near(raw ? +raw[1] : NaN, grid.value, `${label}: 병목 DOM 값 = 독립 전량 연결−실제 고립`);
  eq(raw?.[2], unitNumber(a, grid.value, true), `${label}: 병목 숫자 형식`); // D-80: C-1·2·4·5 대상별 검사.
  ok(box[1].includes(`접속 대기 ${grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MW`) &&
    box[1].includes('대기가 없었다면') && box[1].includes(isGrid ? '계통' : '정전') && box[1].includes('분해 합계 밖'), `${label}: 병목량·반사실·합계 밖 설명`); // D-80: C-1·2·4·5 대상별 검사.
  ok(!/data-out-value=|data-missed=|data-out-tag=|가장 큰/.test(box[0]) &&
    (box[1].match(/[+−-]?\d[\d,]*\.\d+(?: MWh\/일|%p)/g) || []).join('') === unitNumber(a, grid.value, true), // D-82: 하루 평균 반사실 수치 하나만 허용.
    `${label}: 병목 상자는 반사실 수치만 공개, 카드 몫/정답 없음`);
  ok(html.indexOf(box[0]) < html.indexOf(html.includes('id="lg-outage-cards"') ? 'id="lg-outage-cards"' : 'id="lg-outage-single"'),
    `${label}: 카드/요약 위 별도 상자`);
  const textNumbers = box[1].replace(/<[^>]*>/g, '').match(/[+−-]?\d[\d,]*(?:\.\d+)?/g) || [];
  eq(textNumbers, [grid.waitingMW.toLocaleString('ko-KR', { maximumFractionDigits: 1 }), number(grid.value, true, displayContract.digits(a), isGrid)], // rev14b A1: 같은 달의 자릿수.
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
function privateFields(x) {
  if (!x || typeof x !== 'object') return [];
  if (['round', 'plan', 'seed', 'days', 'season', 'mods', 'unsPct', 'isolatedUnsPct'].every(k => Object.hasOwn(x, k)))
    return ['운영 사본 객체'];
  return Object.entries(x).flatMap(([k, v]) =>
    [/outageSnapshots|outageOperatingIntl|outageFrozen|outageLargest|outCache/i.test(k) ? k : [], privateFields(v)]).flat();
}
function game({ solarCount = 10, cityIds = ids, turns = 12 } = {}) {
  storage.clear(); resetCache(); session.snap = null;
  const S = C.newState(session.room, R.id, 0, cityIds, { turns, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  cityIds.forEach(city => { S.teams[city].plan = clone(D.normalStartPlans[city]); });
  select();
  const p = S.teams[id].plan, connected = new Set(p.lines.flatMap(l => l.p));
  const solar = B.TILES.filter(t => !t.out && t.site < 0 && !B.siteRule('solar', t) &&
    !p.builds.some(b => b.i === t.i) && t.nb.some(i => connected.has(i))).slice(0, solarCount);
  ok(solar.length === solarCount, '유효한 태양광 배치');
  for (const t of solar) { p.builds.push({ t: 'solar', i: t.i }); p.lines.push({ p: [t.nb.find(i => connected.has(i)), t.i] }); }
  return S;
}
function operate(S, { rememberIntl = true } = {}) {
  resetCache();
  if (rememberIntl) U.__receive(clone(C.publicView(S, 0))); // 운영 전 연료 저장도 실제 수신 경로로
  // 운영 접속 예약을 독립 복제에 적용. C.run이 쓰는 당시 주민/산업/연료/대응 보존.
  const beforeOperation = clone(S), operating = clone(S);
  C.refreshGrid(operating, B, true);
  select();
  const mods = clone(C.modsFor(operating, R, id));
  const normal = clone(C.modsFor({ ...operating, events: [] }, R, id));
  const res = C.run(S, B, 0), V = clone(C.publicView(S, 0));
  const isolated = pct(operating.teams[id].plan, res.seed, res.season, res.days, mods);
  const model = { plan: clone(operating.teams[id].plan), mods, normal, res: clone(res), isolated,
    pop: operating.econ.cities[id].pop, ind: operating.econ.cities[id].ind,
    fuel: operating.econ.intl.cur.fuelMul, grid: clone(operating.grid[id]),
    input: operating, beforeOperation };
  const before = JSON.stringify({ S, V });
  calls = [];
  U.__receive(V);
  eq(calls.length, res.round === 1 ? 1 : 6 + Number(model.grid.waitingMW > 0),
    '결과 수신: 첫 사본 1회, 월간 생성 포함 대기 없으면 6회·있으면 7회');
  eq(JSON.stringify({ S, V }), before, '사본 수신이 운영/공개 상태를 변경하지 않음');
  return { S, V, res, model };
}
function oracle(old, current, { legacyTies = false } = {}) {
  // 운영 직전 독립 상태만 사용한다. 사본/S7 반환값/호출 입력은 예상값에 쓰지 않는다.
  // C-fix3 §1: 이번 계획을 지난달 이웃 연결 상태에서 독립 운영한다.
  // S7의 사본/hostTies/할당 복원 코드 대신 운영 전 예약 상태와 core 접속 엔진을 사용.
  // 우리 쪽 reduce가 취소한 예약은 그대로 둔다(같은 키 재건설도 선택).
  const choiceInput = clone(current.beforeOperation);
  if (!legacyTies) {
    choiceInput.ties = clone(old.input.ties);
    for (const city of Object.keys(choiceInput.teams))
      if (city !== id) choiceInput.teams[city] = clone(old.input.teams[city]);
    choiceInput.teams[id].research = clone(old.input.teams[id].research || {});
  }
  C.refreshGrid(choiceInput, B, true);
  const choiceCap = C.modsFor(choiceInput, R, id).reCap;
  // ① 계획 교체: 우리 선택의 접속 감소와 공사 재시작은 여기로, 이웃 변화는 ④로.
  const buildKey = b => `${b.t}:${b.i}`;
  const previousKeys = new Set(old.plan.builds.map(buildKey));
  const choiceMods = clone(old.mods);
  const additions = current.plan.builds.map(buildKey).filter(k => !previousKeys.has(k));
  for (const key of additions) {
    if (Object.hasOwn(current.mods.reCap, key)) choiceMods.reCap[key] = current.mods.reCap[key];
    else delete choiceMods.reCap[key];
  }
  if (additions.length) choiceMods.disabledBuilds = [
    ...(old.mods.disabledBuilds || []).filter(k => !additions.includes(k)),
    ...(current.mods.disabledBuilds || []).filter(k => additions.includes(k))
  ];
  for (const key of current.plan.builds.map(buildKey).filter(k => previousKeys.has(k))) {
    if (Object.hasOwn(old.mods.reCap, key) || Object.hasOwn(current.mods.reCap, key))
      choiceMods.reCap[key] = Math.min(old.mods.reCap[key] || 0, choiceCap[key] || 0);
    if (!(old.mods.disabledBuilds || []).includes(key) && (current.mods.disabledBuilds || []).includes(key))
      choiceMods.disabledBuilds = [...new Set([...(choiceMods.disabledBuilds || []), key])];
  }
  // C-fix3 §2: ① 출력제어는 이번 계획·① 접속·지난달 기술로 modsFor 재계산.
  // ②에서는 같은 접속·기술을 유지하고 계절만 바꾼다.
  const curtailInput = clone(current.input);
  curtailInput.events = [];
  curtailInput.teams[id].research = { adopted: clone(old.mods.tech || []) };
  for (const entry of curtailInput.grid[id].entries) entry.allocatedMW = choiceMods.reCap[entry.key] || 0;
  const curtail = season => {
    const input = clone(curtailInput);
    input.rounds[input.round - 1].season = season;
    return C.modsFor(input, R, id).curtailP;
  };
  choiceMods.curtailP = curtail(old.res.season);
  const weatherMods = { ...clone(choiceMods), hydroMonth: current.mods.hydroMonth,
    curtailP: curtail(current.res.season) };
  // ③ 사건 배율만 교체. 기술 coalCapMul은 지난달 사건 없는 배율로 유지.
  const eventMods = clone(weatherMods);
  for (const knob of C.MUL) eventMods[knob] = (old.normal[knob] ?? 1) *
    ((current.mods[knob] ?? 1) / (current.normal[knob] ?? 1));
  for (const knob of ['demandHours', 'tax']) {
    delete eventMods[knob];
    if (Object.hasOwn(current.mods, knob)) eventMods[knob] = clone(current.mods[knob]);
  }
  // ④ 명세의 진행 키만 교체. 수요와 국제 연료는 여전히 지난달 값.
  const progressMods = clone(eventMods);
  for (const knob of ['reCap', 'disabledBuilds', 'tech', 'renewOutput', 'co2Mul',
    'h2Co2', 'drEffect', 'drCost', 'curtailP', 'essCap']) {
    delete progressMods[knob];
    if (Object.hasOwn(current.mods, knob)) progressMods[knob] = clone(current.mods[knob]);
  }
  // 사라진 사건 손잡이의 중립값(1)은 생략 표현과 같다. 진행 단계의
  // 전체 입력 대조에서도 이번 달 mods의 생략 표현을 사용한다.
  for (const knob of C.MUL)
    if (!Object.hasOwn(current.mods, knob) && progressMods[knob] === 1) delete progressMods[knob];
  // coalCapMul의 이번 달 사건분을 유지하며 기술분만 현재로 바꾼다.
  delete progressMods.coalCapMul;
  if (Object.hasOwn(current.mods, 'coalCapMul')) progressMods.coalCapMul = current.mods.coalCapMul;
  if (progressMods.fuelMul) delete progressMods.fuelMul.smr;
  if (current.mods.fuelMul?.smr != null)
    progressMods.fuelMul = { ...progressMods.fuelMul, smr: current.mods.fuelMul.smr };
  // ⑤ 주민·산업 수요와 국제 가격분만 교체.
  const growthMods = clone(progressMods);
  for (const knob of ['demandRes', 'demandInd', 'fuelMul']) {
    delete growthMods[knob];
    if (Object.hasOwn(current.mods, knob)) growthMods[knob] = clone(current.mods[knob]);
  }
  const prev = old.res, now = current.res;
  const stages = [
    [old.plan, prev.seed, prev.season, prev.days, old.mods],
    [current.plan, prev.seed, prev.season, prev.days, choiceMods],
    [current.plan, now.seed, now.season, now.days, weatherMods],
    [current.plan, now.seed, now.season, now.days, eventMods],
    [current.plan, now.seed, now.season, now.days, progressMods],
    [current.plan, now.seed, now.season, now.days, growthMods]
  ];
  const results = stages.map(args => simulation(...args)); // D-80: 독립 원시 시뮬레이션 유지.
  const target = prev.team[id].unsPct < .005 && now.team[id].unsPct < .005 ? 'grid' : 'uns'; // D-80: C 명세 §1.
  const values = results.map(raw => filledValue(raw, target, 1 / raw.days)); // D-82: 단계별 대표 일수로 나누어 달 길이가 몫에 섞이지 않게 독립 계산.
  const base = resultValue(prev, target), actual = resultValue(now, target); // D-80: 공개 필드 기준.
  const parts = values.slice(1).map((v, i) => ({ key: causes[i], value: v - values[i] }));
  parts.push({ key: 'trade', value: (actual - values.at(-1)) - (base - values[0]) }); // D-80: C-2의 월간 잔차, 계통 몫 없음.
  return { target, base, actual, stages, values, parts, weather: // D-80: 대상도 구현과 독립 계산.
     results.slice(1, 3).map((s, i) => weatherMetrics(s, stages[i + 1][0], stages[i + 1][4])) }; // D-80: C-1·2·4·5 대상별 검사.
}
function rows(html) {
  return [...html.matchAll(/data-out-step="([^"]+)" data-out-value="([^"]+)"[\s\S]*?<b>([^<]+)<\/b>/g)]
    .map(m => ({ key: m[1], raw: +m[2], visible: +m[3].replace(/ MWh(?:\/일)?|[,%p]/g, '').replace('−', '-') // D-82: 하루 평균 표시 숫자를 단위와 분리; 단위 자체는 별도 엄격 비교.
      })); // D-80: C-1·2·4·5 대상별 검사.
}
function cards(html, expectedParts, a) { // D-80: C-5.
  const keys = [...html.matchAll(/data-missed="([^"]+)"/g)].map(m => m[1]);
  const top = topCards(expectedParts, a).map(p => p.key); // D-80: C-5.
  eq(keys, top.length >= 2 ? causes.filter(k => top.includes(k)) : [], '카드 = 독립 |몫|≥max(minPart, |Δ|×5%) 상위 최대3 집합·분해순');
  eq(html.includes('data-single="true"'), top.length < 2, '유의미한 원인 2장 미만이면 한 줄 요약');
  if (top.length >= 2 && JSON.stringify(keys) !== JSON.stringify(top)) orderDiffers++;
}
function validate(old, current, replayOffset = 0, oracleOptions = {}) {
  const { V, res, model } = current, expected = oracle(old.model, model, oracleOptions);
  const d = data(), savedOld = d.outageSnapshots[res.round - 1];
  // 운영 입력·지난달 실제·이번 달 사본은 그대로 두고 지난달 저장 고립값만 바꾼다.
  const selectionBasis = { target: expected.target, trial: expected.base, actual: expected.actual, total: expected.actual - expected.base }; // V7: 카드 문턱도 모델의 독립 값으로 계산.
  const target = expected.target; // D-80: 시험값 대신 두 달 실제로 결정.
  const replayField = target === 'grid' ? 'gridMWh' : 'filledUnsPct'; // D-80: 새 사본의 계통 포함 진단값.
  savedOld[replayField] += replayOffset * (target === 'grid' ? old.res.days : 1); // D-82: 하루 평균 오프셋을 원래 대표기간 합계로 환산하여 사본 진단값만 변형.
  save(d); resetCache(); calls = [];
  const a = U.uiMath.outageAttributionMonthly(V, res, id);
  ok(a, '사본 있는 2월 이후 월간 분해');
  if (!a) return;
  eq(a.basis, 'monthly', '시험 분해로 우회하지 않음');
  eq(a.target, target, '대상은 두 달 실제의 0.005% 경계'); // D-80: C §1.
  if (target === 'grid') eq(a.unit, 'MWh/일', '월간 계통 S7 객체 단위'); // D-82: 계약의 리터럴 단위 대조.
  near(a.trial, expected.base, '분해 출발 = 대상별 지난달 실제'); // D-80: C-1.
  near(a.actual, expected.actual, '도착 = 대상별 이번 실제'); // D-80: C-1.
  near(a.total, expected.actual - expected.base, '지난달 → 이번 달 차이'); // D-80: C-1·2.
  ok(!Object.hasOwn(a, 'priorTrade'), 'priorTrade 필드 폐기');
  near(a.replay, -replayOffset, '동일조건 계통 포함 재현 − 사본 대상 값'); // D-80: C-1·2·3.
  eq(a.parts.map(p => p.key), causes, '①~⑥ 순서, 재현은 후보 밖'); // D-80: C-1·2·4·5 대상별 검사.
  expected.parts.forEach(p => near(a.parts.find(actual => actual.key === p.key)?.value, p.value, `${p.key} 독립 모델 몫`));
  eq(a.replayOutsideSum, true, '월간 재현은 합계 밖 진단');
  near(a.parts.reduce((sum, p) => sum + p.value, 0), a.total, '여섯 원인만의 합계 1e-9'); // D-80: C-1·2·4·5 대상별 검사.
  const waiting = model.grid.waitingMW > 0;
  eq(calls.length, waiting ? 6 : 5, '월간 사본 재사용: 접속 대기 없으면 5회·있으면 6회');
  eq(a.simulations, calls.length, '보고된 호출 수 = 실제');
  // ⑤는 검증된 이번 달 고립 사본을 재사용한다. 앞 5회 실제 실행 입력 전체를
  // 독립적으로 만든 단계와 비교하고 마지막 호출은 접속 대기 반사실로 확인한다.
  expected.stages.slice(0, 5).forEach(([p, seed, season, days, mods], i) => {
    const sanitized = B.sanitize(clone(p), 1e9); Object.assign(sanitized, { seed, season });
    if (mods.tax && !sanitized.policies.includes('tax')) sanitized.policies.push('tax');
    inputEq(calls[i], [sanitized, days, { league: true, mods }], `단계 ${i} 전체 입력`);
  });
  const full = Object.fromEntries(model.grid.entries.map(b => [b.key, b.mw]));
  const connectedPlan = B.sanitize(clone(model.plan), 1e9);
  Object.assign(connectedPlan, { seed: res.seed, season: res.season });
  if (model.mods.tax && !connectedPlan.policies.includes('tax')) connectedPlan.policies.push('tax');
  if (waiting) inputEq(calls.at(-1), [connectedPlan, res.days, { league: true, mods: { ...model.mods, reCap: full } }],
    '마지막 실제 실행 = 이번 조건 접속 대기 반사실');
  const expectedGrid = { waitingMW: model.grid.waitingMW,
    value: waiting ? filledValue(simulation(model.plan, res.seed, res.season, res.days, { ...model.mods, reCap: full }), target, 1 / res.days) - expected.values.at(-1) : 0 }; // D-82: 전량 접속 반사실도 대표기간 합계/일수.
  near(a.grid.waitingMW, expectedGrid.waitingMW, '대기량 = 독립 운영 접속 상태');
  near(a.grid.value, expectedGrid.value,
    '접속 대기 별도 반사실(합계 밖)');
  const count = calls.length;
  ok(U.uiMath.outageAttribution(V, res, id) === a, '기존 진입도 같은 월간 캐시');
  eq(calls.length, count, '캐시 추가 실행 0');
  const ranked = [...expected.parts].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  if (Math.abs(replayOffset) >= 1) ok(Math.abs(a.replay) >= 1, '큰 재현 차이 회귀 사례 실제 실행');
  weatherClue(a, ...expected.weather, old.res, res);
  const multi = topCards(expected.parts, selectionBasis).length >= 2; // D-80: C-5.
  const closed = U.uiMath.outageCardsHTML(V, res, id, {});
  studentWords(closed, `월간 열기 전/${multi ? '카드' : '한 줄 요약'}`);
  const closedBox = bottleneck(closed, expectedGrid, '열기 전', a); // D-80: C-1·2·4·5 대상별 검사.
  cards(closed, expected.parts, a); // D-80: C-5.
  if (multi) {
    const n = {}, html = U.uiMath.outageCardsHTML(V, res, id, n);
    hiddenClues(html); eq(n, {}, '닫힌 HTML 생성으로 기기 노트 변경 없음');
    const saved = teamData().interview?.months?.[res.round] || {};
    ok(!saved.outageLargest && !saved.outageFrozen, '닫힌 달 기기 기록에도 원인 크기/최대 없음');
    ok(!/data-out-value=|data-out-tag="largest"|가장 큰 몫|lg-outage-waterfall/.test(html), '닫힌 DOM·aria·data 수치/최대 비노출');
    ok(!session.outShownPending, '열기 전 최대 저장 대기 없음');
    const trend = U.uiMath.trendHTML(V, id, true);
    const shownMonths = Object.entries(teamData().interview?.months || {}).filter(([, n]) => n.outageOpened || n.outageSingleShown);
    eq((trend.match(/data-change="outage"/g) || []).length, shownMonths.length,
      '닫힌 현재 달을 타임라인에 추가하지 않음(이미 공개한 지난달은 유지)');
  }
  const note = { outageOpened: true, missed: ranked[0].key, evidence: { key: 'grid', text: '가상 근거' } };
  const html = U.uiMath.outageCardsHTML(V, res, id, note), rendered = rows(html);
  studentWords(html, `월간 열기 후/${multi ? '카드' : '한 줄 요약'}`);
  eq(bottleneck(html, expectedGrid, '열기 뒤', a), closedBox, '병목은 열기 전후 동일, 카드 정답과 무관'); // D-80: C-1·2·4·5 대상별 검사.
  cards(html, expected.parts, selectionBasis); // D-80: C-5.
  if (multi) for (const [label, text] of [['닫힘', closed], ['열림', html]])
    ok(text.includes(a.clues.weather) && text.includes(a.clueMore.weather),
      `${label}: 독립 tot.ren·절댓값 검산 단서 그대로 표시`);
  eq(rendered.map(r => r.key), ['previous', ...causes, 'actual'], '폭포 분해 순서');
  const expectedRows = { previous: expected.base, // D-80: C-4, 대상별 출발/도착.
    ...Object.fromEntries(expected.parts.map(p => [p.key, p.value])), actual: expected.actual }; // D-80: C-1·2.
  const displayInput = { target, unit: target === 'grid' ? 'MWh/일' : '%p', trial: expected.base,
    actual: expected.actual, total: expected.actual - expected.base, parts: expected.parts, replayOutsideSum: true };
  const allocation = displayContract.oracle(displayInput, displayRules);
  const { d: digits, s: scale } = allocation;
  rendered.forEach(r => {
    near(r.raw, expectedRows[r.key], `${r.key} 독립 기대값 vs DOM 원시값`);
    const index = expected.parts.findIndex(p => p.key === r.key);
    if (index >= 0 && allocation.best)
      ok(allocation.choices[index].includes(Math.round(r.visible * scale) + 0), `${r.key} 명세 표시 배분 눈금`);
    else near(r.visible, Number(expectedRows[r.key].toFixed(digits)), `${r.key} 명세 표시 배분/각자 반올림`);
  });
  for (const m of html.matchAll(/data-out-step="([^"]+)" data-out-value="([^"]+)"[\s\S]*?<b>([^<]+)<\/b>/g))
    eq(m[3], unitNumber(a, rendered.find(r => r.key === m[1]).visible, causes.includes(m[1]), !causes.includes(m[1])),
      `${m[1]} 대상별 소수 자릿수·유니코드 마이너스·단위 붙임`); // spec-C §M5: 배분된 표시값에도 기존 숫자 형식 엄격 비교 유지.
  near(rendered.filter(r => r.key !== 'actual').reduce((s, r) => s + r.raw, 0), expected.actual, '폭포 원시 합계 1e-9'); // D-80: 단위 전환에도 합계 정밀도 유지.
  const displayedParts = rendered.filter(r => causes.includes(r.key));
  // rev14b A2: 조합 전체의 c1~c3와 비용 최소를 검사한다. 같은 비용의 조합은 모두 허용한다.
  const ticks = displayedParts.map(r => Math.round(r.visible * scale) + 0);
  const gap = allocation.H - ticks.reduce((sum, t) => sum + t, 0);
  if (allocation.best) {
    ok(allocation.allowed(ticks), 'rev14b 표시 배분: 크기 순서·공동 최대·후보 1눈금 보존');
    eq(allocation.cost(ticks), allocation.best, 'rev14b 표시 배분 비용 사전순 최소');
    if (allocation.best[0] === 0)
      eq(ticks.reduce((sum, t) => sum + t, 0), allocation.H, 'rev14b 허용 조합으로 합을 맞출 수 있으면 표시 몫 합 = 머리');
    else ok(allocation.gaps.has(gap), 'rev14b 합을 맞출 수 없을 때만 최적 gap 허용');
  }
  const shownGap = allocation.guarded || allocation.invalid ? 0 : gap;
  eq((html.match(/data-round-note="w2"/g) || []).length, shownGap ? 1 : 0, 'rev14b 원값 합 가드·표시 어긋남 W2 조건');
  if (shownGap) ok(html.includes(`몫의 합(${unitNumber(displayInput, (allocation.H - gap) / scale, true)})이 차이(${unitNumber(displayInput, Number(displayInput.total.toFixed(digits)), true)})와 ${unitNumber(displayInput, Math.abs(gap) / scale)} 달라요.`), 'rev14b W2 합·차이·어긋남의 자릿수·부호·단위');
  ok(html.includes('약속 판정과 같은 기준(지난달 실제 → 이번 달 실제)'), '판정·분해 기준 안내');
  ok(!html.includes('lg-outage-prior-trade') && !html.includes('지난달 거래 되돌림') && !html.includes('시험 1주 대비'), '되돌림 줄·설명 폐기');
  eq(html.includes('id="lg-outage-replay"'), displayContract.replayShown(displayInput, a.replay), '대상별 재현 설명 표시 문턱'); // rev14b A2: 해당 달의 반 눈금, 정전 유지.
  ok(html.includes(`이번 달 계산 순서: ${causes.map(k => names[k]).join(' → ')}`) &&
    html.includes('순서를 바꾸면 몫이 달라질 수 있는 추정이에요. 게임에서 정한 순서예요.'), '실제 여섯 단계 계산 순서·순서 의존 안내'); // D-80: C-1·2·4·5 대상별 검사.
  for (const m of html.matchAll(/data-missed="([^"]+)"[^>]*><strong>([^<]+)<\/strong>/g))
    eq(m[2], names[m[1]], '카드 이름 = 월간 기준');
  const eventClue = html.match(/data-missed="event"[^>]*>[\s\S]*?<span class="lg-out-clue">([^<]+)<\/span>/)?.[1];
  if (eventClue) eq(eventClue, eventText(a.clues.event, target), '사건 카드에는 대상에 맞는 짧은 지난달→이번달 단서'); // D-82: 계통 대상 표시 문구; 정전 기대값은 원문 그대로.
  const monthlyMWh = (result, kind) => {
    const days = C.roundsOf(V)[result.round - 1]?.mdays || result.days;
    const amount = kind === 'imp' ? neighbor(result, id, 100).delivered : result.team[id][kind];
    return (amount * days / result.days).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  };
  ok(a.clues.trade.startsWith(`이웃 구매 ${monthlyMWh(old.res, 'imp')} → ${monthlyMWh(res, 'imp')} / 판매 ${monthlyMWh(old.res, 'exp')} → ${monthlyMWh(res, 'exp')} MWh(월 환산)`) && (target !== 'grid' || /이웃.*바깥 계통/.test(a.clues.trade)), // D-80: C §4 계통 대상의 이웃 보충 설명.
    '거래 단서는 두 달의 실제 구매·판매를 월 환산');
  ok(/^지난달 .+ → 이번 달 .+$/.test(a.clues.event) && html.includes(eventText(a.clueMore.event, target)), '사건 전체 단서는 대상에 맞는 문구로 단서 더 보기'); // D-82: 상세 사건 단서도 (b)의 표시 문구로 대조.
  const candidates = [...html.matchAll(/data-(?:missed|out-other)="([^"]+)"/g)].map(m => m[1]);
  ok(candidates.every(k => causes.includes(k)), '되돌림·재현은 카드/나머지 후보 밖');
  if (!model.grid.waitingMW) ok(!html.includes('접속 대기'), '0 MW 달 접속 대기 문장 없음');
  note.outageFrozen = clone(session.outShownPending.frozen);
  eq(session.outShownPending.largest?.key || null, Math.abs(ranked[0].value) < cardMin(selectionBasis) ? null : ranked[0].key, // D-80: C-5.
    '기기 저장 최대도 여섯 후보만(재현 제외)'); // D-80: C-1·2·4·5 대상별 검사.
  if (session.outShownPending.largest) note.outageLargest = clone(session.outShownPending.largest);
  const frozenData = teamData(); frozenData.interview ||= {}; frozenData.interview.months ||= {};
  frozenData.interview.months[res.round] = note; saveTeam(frozenData);
  // 연 뒤 시험 교체·캐시 제거에도 공개 당시 분해 고정.
  storage.set('kcp-build-trial-v1', '{}'); resetCache(); calls = [];
  const expectedFrozen = { ...clone(a), clues: { ...clone(a.clues), event: eventText(a.clues.event, target) }, clueMore: { ...clone(a.clueMore), event: eventText(a.clueMore.event, target) } }; // D-82: 표시 시 고정본에는 대상별 사건 문구가 보존됨; 수치는 독립 검산값 그대로.
  eq(U.uiMath.outageAttributionMonthly(V, res, id), expectedFrozen, '연 뒤 기기 저장 분해 고정'); // D-82: 문구 (b) 이외 모든 필드도 엄격 대조, 정전 기대값 유지.
  eq(calls.length, 0, '고정된 분해 재실행 0');
  const timeline = U.uiMath.trendHTML(V, id, true);
  if (note.outageLargest) {
    ok(timeline.includes(names[ranked[0].key]), '월간 타임라인 최대 이름 일치');
    for (const cause of causes) {
      const labelled = clone(frozenData); labelled.interview.months[res.round].missed = cause; saveTeam(labelled);
      ok(U.uiMath.trendHTML(V, id, true).includes(`내가 고른 원인: ${names[cause]}`), `${cause} 월간 타임라인 선택 이름 일치`);
    }
    saveTeam(frozenData);
  }
  console.log(JSON.stringify({ month: res.round, replayOffset, simulations: count, parts: a.parts }));
  return a;
}

const months = [];
test('실제 수신·사본 저장·2달 보관', () => {
  const S = game();
  for (let month = 1; month <= 4; month++) {
    if (month > 1) C.host(S, 'next', 0);
    S.teams[id].plan.policies = month % 2 ? [] : ['save'];
    const m = operate(S); months.push(m);
    ok(!Object.hasOwn(teamData(), 'outageSnapshots') && !Object.hasOwn(teamData(), 'outageOperatingIntl'),
      `${month}월 팀 자료 키에 S7 필드가 새로 생기지 않음`);
    const snapshots = data().outageSnapshots;
    eq(Object.keys(snapshots).map(Number), month === 1 ? [1] : [month - 1, month], `${month}월 최근2달만(3월에1월 삭제)`);
    const snap = snapshots[month];
    for (const field of ['round', 'plan', 'seed', 'days', 'season', 'mods', 'unsPct', 'isolatedUnsPct', 'filledUnsPct', 'gridMWh']) // D-80: C §3 새 사본 필드.
    ok(Object.hasOwn(snap, field), `사본 ${field}`); // D-80: C-1·2·4·5 대상별 검사.
    eq(snap.plan, B.sanitize(m.model.plan, 1e9), '사본 = 운영 계획');
    eq(snap.mods, m.model.mods, '사본 = 운영 당시 모든 배수(운영 직전 독립 상태)');
    near(snap.isolatedUnsPct, m.model.isolated, '사본 고립 값 독립 재현');
    const raw = simulation(m.model.plan, m.res.seed, m.res.season, m.res.days, m.model.mods); // D-80: S7 사본으로 기대값을 계산하지 않음.
    near(snap.filledUnsPct, filledValue(raw, 'uns', 1), '사본 계통 포함 정전율'); // D-80: C §3.
    near(snap.gridMWh, filledValue(raw, 'grid', 1), '사본 대표 기간 계통 보충량'); // D-80: C §3·계약 A.
    near(snap.unsPct, m.res.team[id].unsPct, '사본 실제');
    near(snap.facts.pop, m.model.pop, '운영 당시 주민'); near(snap.facts.ind, m.model.ind, '운영 당시 산업');
    near(snap.facts.fuel, m.model.fuel, '월말 갱신 전 연료');
    ok(!Object.hasOwn(snap, 'intlFallback'), '계획 국제 지수를 수신한 정상 사본에는 대체 표시 없음');
    ok(!privateFields(m.V).length && !privateFields(C.publicView(S, 0)).length, 'D-65 공개 상태 사본/분해 0');
    const before = clone(snap); U.__receive(clone(m.V)); eq(data().outageSnapshots[month], before, '결과 재수신 사본 고정');
    console.log(JSON.stringify({ month, snapshotBytes: Buffer.byteLength(JSON.stringify(snap), 'utf8') }));
    // 다음 달 입력을 독립 보존한 뒤 즉시 검사(보관기한 뒤 옛 사본 주입 없음).
    if (month > 1) validate(months.at(-2), m);
  }
});
test('영상 3차: 0.05%p 카드/병목 경계·숫자 형식·합계 밖', () => {
  // 계산은 위 oracle로 검사했다. 여기서는 정확한 양/음 경계를 저장 분해로 렌더링한다.
  const { V, res } = months.at(-1), base = clone(U.uiMath.outageAttribution(V, res, id));
  // D-80: C-2, 여섯 값의 정전 렌더링 픽스처로 기존 경계 검사 유지.
  for (const values of [
    [.049999, -.049999, 0, 0, 0, 0],
    [-3.5, .049999, 0, 0, 0, 0],
    [-3.5, .05, -.049999, 0, 0, 0],
    [-3.5, -.05, .050001, 0, 0, 0],
    [-3.5, 1.25, -.05, .050001, .8, 0]
  ]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      parts: causes.map((key, i) => ({ key, value: values[i] ?? 0 })) }; // D-80: C-1·2·4·5 대상별 검사.
    const html = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen });
    cards(html, frozen.parts, frozen);
    for (const m of html.matchAll(/data-missed="([^"]+)"[^>]*>[\s\S]*?<b class="lg-out-size">([^<]+)<\/b>/g)) {
      const p = frozen.parts.find(p => p.key === m[1]);
      eq(m[2], `${number(p.value, true)}%p`, `${p.key}: 카드 숫자 형식`);
    }
  }
  const parts = causes.map((key, i) => ({ key, value: [-3.5, 1.25, 0, 0, 0, 0, 0][i] }));
  for (const waitingMW of [0, 2]) for (const value of [0, .049999, .05, .050001, -.049999, -.05, -.050001, -8.76, NaN, Infinity, -Infinity]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      parts, trial: 6.65, actual: 4.4, total: -2.25, // D-80: C-1·2·4·5 대상별 검사.
      grid: { waitingMW, value } };
    const html = U.uiMath.outageCardsHTML(V, res, id,
      { outageOpened: true, outageFrozen: frozen, missed: 'weather' });
    bottleneck(html, frozen.grid, `대기 ${waitingMW}, 반사실 ${value}`);
    cards(html, parts, frozen);
    const rendered = rows(html);
    eq(rendered.map(p => p.key), ['previous', ...causes, 'actual'], '병목 크기와 무관하게 분해 후보/합계 줄 동일');
    near(rendered.filter(p => p.key !== 'actual').reduce((sum, p) => sum + p.raw, 0), 4.4, '병목을 더하지 않은 폭포 합계');
    ok(html.includes('>−3.50%p</b>') && html.includes('>4.40%</b>'), '끝자리 0·유니코드 마이너스 실제 표기');
    eq((html.match(/data-out-tag="largest"/g) || []).length, 1, '병목 −8.76도 카드 최대 꼬리표 하나');
    const tagged = [...html.matchAll(/<button\b[^>]*data-missed="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
      .filter(m => m[2].includes('data-out-tag="largest"')).map(m => m[1]);
    eq(tagged, ['choice'], '카드 최대는 병목 대신 choice −3.50');
  }
});
test('근거 5종 × 원인 6종 × 방향·풍력 플래그: 직접/같은 단계/간접·칭찬·반대 문구', () => {
  // 구현 표와 같음(회귀 고정): 표 전체의 모든 짝을 독립 명세로 주장하지 않는다.
  // 지시서의 grid→progress 직접, fuel 간접, 풍력 없음→간접,
  // evening→choice 같은 단계는 아래 별도 개별 단언으로 검사한다.
  const links = {
    evening: { choice: 'stage', weather: 'direct', event: 'direct', growth: 'direct' },
    wind: { weather: 'direct', event: 'direct' }, grid: { choice: 'stage', progress: 'direct' }, // 명세 A2.
    fuel: { event: 'indirect', growth: 'indirect' }, neighbor: { progress: 'indirect', trade: 'direct' }
  };
  const effect = { evening: 1, wind: -1, grid: 0, neighbor: 1 };
  eq((source.match(/const OUTAGE_EVIDENCE_LINKS\s*=/g) || []).length, 1, '근거 연결표를 한 상수로 선언');
  const { V, res } = months.at(-1), base = clone(U.uiMath.outageAttribution(V, res, id));
  const original = teamData();
  for (const [evidence, defaultLinks] of Object.entries(links))
    for (const windFlag of evidence === 'wind' ? [true, false, undefined] : [base.hasConnectedWind])
    for (const cause of causes)
    for (const largestSign of [-1, 1]) for (const mode of ['up', 'down', 'small', 'missing', 'fallback']) {
      const expectedLinks = evidence === 'wind' && !windFlag ?
        { weather: 'indirect', event: 'indirect' } : defaultLinks;
      const previous = mode === 'missing' ? {} : mode === 'fallback' ?
        { evidence: { key: evidence, value: 100 } } : { evidenceValues: { [evidence]: 100 } };
      const d = clone(original); d.interview ||= {}; d.interview.months ||= {};
      d.interview.months[res.round - 1] = previous; saveTeam(d);
      const value = mode === 'down' ? 97 : mode === 'small' ? 100.1 : 103;
      // 3%는 모든 비교 눈금(1~2%) 이상, 0.1%는 모든 눈금 미만이다.
      const evidenceSign = ['small', 'missing'].includes(mode) || !effect[evidence] ||
        (evidence === 'wind' && !windFlag) ? 0 :
        (mode === 'down' ? -1 : 1) * effect[evidence];
      const parts = causes.map((key, i) => ({ key, value: key === cause ? largestSign * 9.43 : (i + 1) / 10 }));
      const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      parts, grid: { waitingMW: 0, value: 0 } }; // D-80: C-1·2·4·5 대상별 검사.
      if (windFlag === undefined) delete frozen.hasConnectedWind;
      else frozen.hasConnectedWind = windFlag;
      const html = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen,
        missed: cause, evidence: { key: evidence, value, text: '가상 근거' } });
      const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
      const label = `${evidence}→${cause}, 최대 ${largestSign}, ${mode}, 풍력 ${windFlag}`;
      for (const kind of ['direct', 'stage', 'indirect']) {
        const connected = parts.filter(p => expectedLinks[p.key] === kind);
        const prefix = kind === 'stage' ? '같은 단계와 연결 — ' : `${kind === 'direct' ? '직접' : '간접'} 연결 — `;
        eq(text.includes(prefix), connected.length > 0, `${label}: ${kind} 구분`);
        if (connected.length) ok(text.includes(prefix + connected.map(p => `${names[p.key]} ${number(p.value, true)}%p`).join(' / ')),
          `${label}: ${kind}에 해당하는 몫만 순서대로 표시`);
      }
      for (const p of parts) eq(text.includes(`${names[p.key]} ${number(p.value, true)}%p`), !!expectedLinks[p.key],
        `${label}: ${p.key} 관련된 몫 표시`);
      const direct = expectedLinks[cause] === 'direct';
      eq(text.includes('고른 근거는 이번 차이의 가장 큰 몫과도 이어져요.'),
        direct && evidenceSign === largestSign, `${label}: 직접 연결·방향 일치일 때만 칭찬`);
      eq(text.includes('고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요.'),
        direct && evidenceSign !== 0 && evidenceSign !== largestSign, `${label}: 반대 방향 지정 문구`);
      const opposite = direct && evidenceSign !== 0 && evidenceSign !== largestSign;
      eq(text.endsWith('이 근거만으로 이번 차이의 방향을 설명하기는 어려워요.'), opposite,
        `${label}: 반대 방향 마무리`);
      if (opposite) ok(!/다음에는|살펴봐요/.test(text), `${label}: 반대 방향 재검토 권유 없음`);
      eq(text.endsWith(`고른 근거가 가장 큰 몫(${names[cause]})과 같은 이야기예요.`),
        direct && evidenceSign === 0, `${label}: 직접 연결·부호 0은 중립 마무리`);
      if (direct && evidenceSign === 0) ok(!/다음에는 .*살펴봐요/.test(text),
        `${label}: 이미 고른 직접 근거의 재검토 권유 없음`);
      eq(text.includes('간접 연결은 이 근거가 정전을 바꿨다는 뜻이 아니에요.'),
        Object.values(expectedLinks).includes('indirect'), `${label}: 간접 인과 한계`);
      ok(!text.includes('설명할 수 없어요'), `${label}: 근거 하나의 설명 불가 오판 없음`);
    }
  saveTeam(original);
});
test('지시서 근거 연결 짝: grid 직접·fuel/풍력 없음 간접·evening 같은 단계', () => {
  const { V, res } = months.at(-1), base = clone(U.uiMath.outageAttribution(V, res, id));
  const original = data();
  try {
    // V3B-fix2 §2·5, V3B-fix3 §2, 검사 4 지시서의 연료 간접 연결.
    for (const [evidence, cause, kind] of [['grid', 'progress', '직접'], ['grid', 'choice', '같은 단계와'], // 명세 A2.
      ['fuel', 'growth', '간접'], ['fuel', 'event', '간접'],
      ['wind', 'weather', '간접'], ['wind', 'event', '간접'], ['evening', 'choice', '같은 단계와']]) {
      const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      hasConnectedWind: false, // D-80: C-1·2·4·5 대상별 검사.
        parts: [{ key: cause, value: -3.5 }] };
      const html = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen,
        missed: cause, evidence: { key: evidence, value: 103, text: '가상 근거' } });
      const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
      ok(text.includes(`${kind} 연결 — ${names[cause]} −3.50%p`), `${evidence}→${cause}: 지시서 연결 종류`);
      // 명세 A2: progress 직접 연결은 유지하고 choice에만 다음 근거 꼬리.
      if (evidence === 'grid' && cause === 'choice') ok(!text.includes('같은 이야기') && /다음에는 .+도 근거로 살펴봐요/.test(text), 'grid→choice 같은 단계·다음 근거');
      if (evidence === 'grid' && cause === 'progress') {
        ok(text.endsWith('고른 근거가 가장 큰 몫(접속·공사·기술 진행)과 같은 이야기예요.'),
          'grid→progress 직접·부호 0의 마지막 문장');
        ok(!text.includes('다음에는') && !text.includes('살펴봐요'), 'grid→progress 재검토 권유 없음');
      }
      if (kind === '간접') ok(text.includes('간접 연결은 이 근거가 정전을 바꿨다는 뜻이 아니에요.'),
        `${evidence}→${cause}: 인과 한계`);
    }
  } finally { save(original); }
});
test('연료 지수만 변경: 비용은 바뀌지만 고립 정전 변화는 0', () => {
  let changedCosts = 0;
  for (const { model: m, res } of months) {
    const baseline = simulation(m.plan, res.seed, res.season, res.days, m.mods);
    for (const index of [.5, 1, 1.35, 2]) {
      const mods = clone(m.mods);
      mods.fuelMul = { ...mods.fuelMul, lng: index, diesel: index ** .6, coal: index ** .6 };
      const changed = simulation(m.plan, res.seed, res.season, res.days, mods);
      near(uns(changed) - uns(baseline), 0, `${res.round}월 연료 ${index}: 정전 변화 0(연료→growth는 간접)`);
      near(changed.unsTotal, baseline.unsTotal, '미공급 총량 불변');
      near(changed.tot.dem, baseline.tot.dem, '수요 불변');
      if (Math.abs(changed.cost.fuel - baseline.cost.fuel) > 1e-6) changedCosts++;
    }
  }
  ok(changedCosts > 0, '연료 지수 변경이 실제 연료비를 바꾸는 비자명한 사례');
});
test('비유한 숫자는 –: NaN·양/음 Infinity의 비율·몫', () => {
  const { V, res } = months.at(-1), base = U.uiMath.outageAttribution(V, res, id);
  for (const value of [NaN, Infinity, -Infinity]) {
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: value, actual: value, // D-80: C-1·2·4·5 대상별 검사.
      parts: causes.map((key, i) => ({ key, value: i === 0 ? value : i / 10 })) };
    const html = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true, outageFrozen: frozen });
    eq((html.match(/<b>–%<\/b>/g) || []).length, 2, `${value}: 두 정전율은 –%`);
    ok(/data-out-step="choice"[\s\S]*?<b>–%p<\/b>/.test(html), `${value}: 몫은 –%p`);
    ok(!/<b[^>]*>[+-]?(?:NaN|Infinity)/.test(html), `${value}: 숫자 텍스트에 비유한 원시 문자열 없음`);
  }
});
test('큰 재현 차이도 후보 밖·합계 밖', () => {
  const S = game(), first = operate(S); C.host(S, 'next', 0);
  S.teams[id].plan.policies = ['save']; const second = operate(S);
  const baseline = clone(U.uiMath.outageAttributionMonthly(second.V, second.res, id));
  const changed = validate(first, second, 25);
  eq(changed.parts, baseline.parts, '재현 −25에도 거래·성장 포함 여섯 몫 불변'); // D-80: C-1·2·4·5 대상별 검사.
  console.log(JSON.stringify({ regression: '재현 −25', manipulated: '지난달 사본 isolatedUnsPct +25',
    replay: changed.replay, trade: changed.parts.find(p => p.key === 'trade').value,
    growth: changed.parts.find(p => p.key === 'growth').value }));
});
test('이웃 거래 = 두 달의 계통 수입 전 이웃 보충 효과 변화', () => {
  const S = game();
  S.ties = R.ties.filter(t => ids.includes(t.a) && ids.includes(t.b))
    .map(t => ({ ...clone(t), id: C.tieId(t), st: 'built', cap: 4 }));
  ok(S.ties.length > 0, '자료에 있는 이웃 연계선');
  S.teams.dangjin.price = .005;
  const first = operate(S); C.host(S, 'next', 0);
  S.teams[id].plan.policies = ['save']; const second = operate(S);
  // D-74: imp/실제−고립에는 계통도 포함된다. 옛 혼합 효과 → 이웃 flow만의 양성 대조.
  const firstNeighbor = neighbor(first.res, id, first.model.isolated);
  ok(firstNeighbor.delivered > 0 || first.res.team[id].exp > 0, '지난달 이웃 구매/판매 MWh >0');
  ok(Math.abs(first.model.isolated - firstNeighbor.rate) > .05, '반올림보다 큰 지난달 이웃 거래 효과');
  validate(first, second);
});
test('계획 국제 지수 미수신: 지난달 nextIntl 대체 사본 표시·독립 재현', () => {
  const S = game(), first = operate(S);
  const previousIntl = clone(data().outageSnapshots[1].nextIntl);
  C.host(S, 'next', 0);
  ok(!data().outageOperatingIntl, '2월 계획 수신 전에는 운영 지수 저장 없음');
  eq(S.econ.intl.cur, previousIntl, '독립 운영의 실제 지수 = 지난달 다음 운영 지수');
  const second = operate(S, { rememberIntl: false }), snap = data().outageSnapshots[2];
  eq(snap.intlFallback, true, '계획 지수 미수신 사본에 intlFallback: true');
  near(snap.facts.fuel, previousIntl.fuelMul, '대체 경로는 이번 월말 지수 대신 지난달 nextIntl 사용');
  near(snap.facts.fuel, second.model.fuel, '대체 지수 = 독립 운영 직전 연료');
  eq(snap.mods, second.model.mods, '대체 사본 모든 배수 = 독립 운영 배수');
  near(snap.isolatedUnsPct, second.model.isolated, '대체 사본 고립값 독립 재현');
  validate(first, second);
  const before = clone(data().outageSnapshots[2]);
  U.__receive(clone(second.V));
  eq(data().outageSnapshots[2], before, '결과 재수신에도 대체 표시·사본 유지');
});
test('대응·수요·연료·기술 배수는 지정 단계에서만 변경', () => {
  const S = game();
  S.events = [{ id: 'heatwave_peak', round: 1, x: 1.2 }];
  const first = operate(S); C.host(S, 'next', 0);
  const event = C.eventDef(R, 'heatwave_peak');
  ok(event.opts?.some(o => o.dev !== 1), '자료의 효과를 줄이는 사건 대응');
  const response = event.opts.find(o => o.dev !== 1);
  S.events = [{ id: event.id, round: 2, x: .7 }];
  S.teams[id].resp = { ...S.teams[id].resp, [`2:${event.id}`]: response.id };
  S.teams[id].plan.policies = ['save'];
  S.econ.cities[id].pop *= 1.12; S.econ.cities[id].ind *= 1.1;
  S.econ.intl.cur.fuelMul = 1.35;
  S.teams[id].research = { queue: [], prog: {}, stage: { sic: 'done', ccu: 'done', h2mix: 'done', vpp: 'done', smr: 'done' },
    adoptR: { sic: 2, ccu: 2, h2mix: 2, vpp: 2, smr: 2 }, eureka: [], licensedFrom: {}, joint: {} };
  const second = operate(S);
  ok(['sic', 'ccu', 'h2mix', 'vpp', 'smr'].every(k => second.model.mods.tech.includes(k)), '이번 달 실제 도입 기술');
  for (const field of ['renewOutput', 'co2Mul', 'coalCapMul', 'h2Co2', 'drEffect', 'drCost'])
    ok(Object.hasOwn(second.model.mods, field), `${field} 기술 진행 입력 존재`);
  near(second.model.mods.fuelMul.smr, D.params.smrFuelMul.v, 'SMR 연료 기술분(국제 가격분과 분리)');
  ok(second.model.mods.demandRes > first.model.mods.demandRes || first.model.mods.demandRes == null, '실제 수요 배수 차이');
  near(second.model.mods.fuelMul.lng, 1.35, '실제 연료 배수 차이');
  validate(first, second);
});
test('월간 높은 정전 차이 원인 없음·고르기 생략', () => {
  const S = game();
  ids.forEach(city => { S.teams[city].plan = { builds: [], lines: [], policies: [] }; });
  S.events = [];
  const first = operate(S); C.host(S, 'next', 0); S.events = [];
  const second = operate(S);
  validate(first, second);
  const html = U.uiMath.outageCardsHTML(second.V, second.res, id, {});
  ok(html.includes(noCauseLabel(first.model.isolated, second.model.isolated)) && html.includes('data-single="true"'),
    '미미한 여섯 몫은 두 정전율에 맞는 한줄 요약'); // D-80: C-1·2·4·5 대상별 검사.
  near(first.model.isolated, 100, '빈 설비 지난달 독립 미공급/수요 100%');
  near(second.model.isolated, 100, '빈 설비 이번 달 독립 미공급/수요 100%');
  // D-74: 표시 고립100→100 → 계통 포함 실제50→50. 표시값은 거래 없는 C1의 독립 기대값.
  const filledEmpty = 100 * (1 - D.params.gridImportShare.v);
  near(first.res.team[id].unsPct, filledEmpty, '지난달 계통 반영 정전');
  near(second.res.team[id].unsPct, filledEmpty, '이번 달 계통 반영 정전');
  ok(html.includes(`지난달 ${number(filledEmpty)}% → 이번 달 ${number(filledEmpty)}%로 거의 같아요`),
    '월간 요약 숫자 = 독립 계산, 시험 → 실제로 되돌아가지 않음');
  ok(html.includes('정전 자체는 큼') && html.includes(highOutageCopy(second.V, second.res)) /* rev10 R5 */, '월간 높은 정전 부족·재점검 안내');
  ok(!html.includes('data-missed=') && !html.includes('data-out-tag="largest"'), '큰 보정으로 카드/최대 만들지 않음');
  ok(!teamData().interview.months[2].outageLargest, '최대 몫 기기 기록 없음');

  // 복제한 DOM 가시성 어댑터만 제공하고, 실제 econClick의 저장 분기를 실행한다.
  // 화면을 띄우지 않으므로 브라우저 클릭/레이아웃 검증으로 보고하지 않는다.
  const frozen = clone(U.uiMath.outageAttributionMonthly(second.V, second.res, id));
  const d = teamData();
  d.interview.months[2] = { outageSingleShown: true, outageFrozen: frozen, outageNoCause: true }; saveTeam(d);
  const getElement = ctx.document.getElementById;
  const panel = { querySelector: selector => selector === '#lg-outage-single' ? element : null };
  const element = { closest: () => null, parentElement: panel };
  const beforePublic = JSON.stringify({ S, V: second.V });
  try {
    ctx.document.getElementById = name => name === 'lg-panel' ? panel : null;
    eq(U.__carryClick({ target: { closest: selector => selector === '#lg-outage-carry' ? {} : null } }), true,
      '높은 정전 실제 붙이기 저장 처리 실행');
  } finally { ctx.document.getElementById = getElement; }
  const saved = clone(teamData().interview.months[2]);
  eq(saved.missedCarry, { basis: 'monthly', ...(frozen.target ? { target: frozen.target } : {}), missed: '차이 원인 없음(정전 자체는 큼)' }, // D-80: C-4 대상 보존.
    '높은 정전 붙이기 저장 문자열·월간 기준, 최대 몫 없음');
  eq(saved.outageFrozen, frozen, '붙이기는 독립 검산한 분해값을 보존');
  eq(JSON.stringify({ S, V: second.V }), beforePublic, '높은 정전 붙이기는 운영/공개 상태 불변');

  C.host(S, 'next', 0);
  const next = clone(C.publicView(S, 0)); session.snap = next;
  eq(next.round, 3, '실제 다음 달 계획 진입');
  for (const legacy of [false, true]) {
    const record = clone(saved);
    if (legacy) record.missedCarry.missed = '뚜렷한 원인 없음';
    const expectedLabel = legacy ? '뚜렷한 원인 없음' : '차이 원인 없음(정전 자체는 큼)';
    const stored = teamData(); stored.interview.months[2] = record; saveTeam(stored); resetCache();
    for (const reload of [false, true]) {
      if (reload) { saveTeam(clone(teamData())); resetCache(); } // 기기 저장 JSON 재독, 브라우저 재로딩은 s7.py
      const before = clone(teamData());
      const carry = U.__carryHTML(next), journal = U.__worksheet(next), trend = U.uiMath.trendHTML(next, id, true);
      eq(carry, `<p id="lg-missed-carry" class="lg-hint">지난달 원인 고르기: ${expectedLabel}</p>`,
        `${legacy ? '옛' : '새'} 기록/${reload}: S4 다음 달 줄 정확히 보존`);
      ok(journal.includes(expectedLabel) && trend.includes(expectedLabel),
        `${legacy ? '옛' : '새'} 기록/${reload}: 일지·타임라인 이어짐`);
      eq([carry, journal, trend].some(text => text.includes('정전 자체는 큼')), !legacy,
        `${legacy ? '옛' : '새'} 기록/${reload}: 옛 값은 높은 정전이어도 새 문구로 덮어쓰지 않음`);
      ok(![carry, journal, trend].some(text => text.includes('가장 큰 몫')),
        `${legacy ? '옛' : '새'} 기록/${reload}: 최대 원인 꾸미지 않음`);
      eq(teamData(), before, `${legacy ? '옛' : '새'} 기록/${reload}: 읽기가 기기 기록을 바꾸지 않음`);
    }
  }
});
test('월간 높은 정전 5% 경계·표시 반올림', () => {
  const S = game({ solarCount: 0 });
  ids.forEach(city => { S.teams[city].plan = { builds: [], lines: [], policies: [] }; });
  S.events = []; operate(S); C.host(S, 'next', 0); S.events = [];
  const second = operate(S), base = clone(U.uiMath.outageAttributionMonthly(second.V, second.res, id));
  // 정확한 정전율 경계만 넣은 렌더링 픽스처. 실제 수치의 독립 계산은 위 빈 설비 운영에서 검사한다.
  for (const [milliPct, shown, high] of [[4994, '4.99', false], [4995, '5.00', true],
    [4999, '5.00', true], [5000, '5.00', true]]) {
    eq(Math.floor((milliPct + 5) / 10), Number(shown) * 100, `${milliPct}: 표시값 독립 계산`);
    eq(shownHigh(milliPct / 1000), high, `${milliPct}: 5.00% 표시 경계`);
  }
  for (const [before, after] of [[100, 100], [5, 5], [5, 5.02], [5.02, 5],
    [4.99, 5.02], [5.02, 4.99], [4.99, 4.99], [4.999, 5.001], [5.001, 4.999],
    [4.994, 4.994], [4.995, 4.995], [4.994, 5], [5, 4.994], [4.995, 5], [5, 4.995],
    [4.999, 5], [5, 4.999]]) {
    const high = shownHigh(before) && shownHigh(after), actualHigh = shownHigh(after), label = `지난달 ${before}% → 이번 달 ${after}%`;
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: before, actual: after, total: after - before, replay: 0, // D-80: C-1·2·4·5 대상별 검사.
      parts: base.parts.map(p => ({ ...p, value: (after - before) / 6 })) };
    for (const opened of [false, true]) {
      const html = U.uiMath.outageCardsHTML(second.V, second.res, id,
        { outageSingleShown: true, outageOpened: opened, outageFrozen: frozen });
      studentWords(html, `${label}/${opened}`);
      ok(html.includes('data-single="true"') && html.includes(noCauseLabel(before, after)), `${label}: 경계 기록 문구`);
      ok(html.includes(`지난달 ${number(before)}% → 이번 달 ${number(after)}%로 거의 같아요`), `${label}: 두 달 숫자 인용`);
      eq(html.includes('정전 자체는 큼'), high, `${label}: 두 표시값 모두 5.00% 이상`);
      eq(html.includes(highOutageCopy(second.V, second.res)) /* rev10 R5 */, actualHigh, `${label}: 실제 표시값 기준 설비·접속 안내`);
      eq(html.includes(highOutageCopy(second.V, second.res)) /* rev10 R5 */, actualHigh, `${label}: 실제 표시값 기준 재점검 안내`);
      const unlinked = highOutageCopy(second.V, second.res).startsWith("이번 달 '전선에 안 닿은 설비'");
      eq(html.includes(unlinked ? '지난달에도 정전이 컸어요.' : '지난달에도 정전이 컸으니'), high, `${label}: 높은 기준값 전제`);
      eq(html.includes('이번 달 변화보다'), actualHigh && !unlinked, `${label}: 작은 차이·미연결 0일 때만 비교`);
      ok(!session.outShownPending.largest && !html.includes('data-out-tag="largest"'), `${label}: 최대 몫 없음`);
    }
  }
});
test('수정 5 사례 B: outageSingleShown + missed 고정본의 붙이기·선택 기록', () => {
  const S = game({ solarCount: 0 });
  S.events = []; operate(S); C.host(S, 'next', 0); S.events = [];
  const { V, res } = operate(S), base = clone(U.uiMath.outageAttributionMonthly(V, res, id));
  // 브라우저 없는 실제 핸들러 실행. getElementById는 null을 반환해 요약 DOM을 제공하지 않는다.
  for (const tiny of [0, .049999, -.049999]) for (const large of [0, 1]) {
    const label = `B 월간 고정본 선택 ${tiny}, 최대 ${large}`;
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      trial: 6, actual: 6 + large + tiny, total: large + tiny, replay: 0, // D-80: C-1·2·4·5 대상별 검사.
      parts: causes.map(key => ({ key, value: key === 'choice' ? large : key === 'trade' ? tiny : 0 })) };
    const note = { outageSingleShown: true, missed: 'trade', missedBasis: 'monthly', outageFrozen: frozen };
    const d = teamData(); d.interview ||= {}; d.interview.months ||= {};
    d.interview.months[res.round] = note; saveTeam(d);
    calls = [];
    const publicBefore = JSON.stringify({ S, V });
    const before = U.uiMath.outageCardsHTML(V, res, id, note);
    ok(before.includes('data-single="false"') && before.includes('data-opened="true"'), `${label}: 선택 카드 공개 유지`);
    ok(before.includes('내가 고른 것: 이웃 거래') && !before.includes('내가 고른 것: 고르기 생략'), `${label}: 화면에 실제 선택`);
    const picked = before.match(/<button\b[^>]*data-missed="trade"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    ok(picked.includes('aria-pressed="true"') && picked.includes('data-out-tag="picked"'), `${label}: 선택 카드·꼬리표 유지`);
    ok(/id="lg-outage-carry"\s*>/.test(before), `${label}: 붙이기 활성`);
    eq(U.__carryClick({ target: { closest: selector => selector === '#lg-outage-carry' ? {} : null } }), true,
      `${label}: 붙이기 핸들러 실행`);
    const saved = clone(teamData().interview.months[res.round]);
    eq(saved.missedCarry, { basis: 'monthly', ...(frozen.target ? { target: frozen.target } : {}), missed: 'trade', ...(large ? { largest: { key: 'choice', value: large } } : {}) },
      `${label}: 붙이기 클릭으로 선택 저장`);
    eq(saved.outageFrozen, frozen, `${label}: 고정 분해값 불변`);
    eq(saved.missed, 'trade', `${label}: 원래 선택 불변`);
    const after = U.uiMath.outageCardsHTML(V, res, id, saved);
    eq(after.split('<button type="button" class="v2-btn" id="lg-outage-carry"')[0],
      before.split('<button type="button" class="v2-btn" id="lg-outage-carry"')[0], `${label}: 붙인 뒤 카드·판정 불변`);
    ok(/id="lg-outage-carry" disabled/.test(after), `${label}: 붙이기 완료 표시`);
    const next = { ...clone(V), round: res.round + 1 };
    const carry = U.__carryHTML(next), journal = U.__worksheet(next), trend = U.uiMath.trendHTML(next, id, true);
    ok(carry.includes('지난달 내가 고른 원인: 이웃 거래') && journal.includes('내가 고른 원인: 이웃 거래') &&
      trend.includes('내가 고른 원인: 이웃 거래'), `${label}: 화면·S4·일지·타임라인 선택 일치`);
    ok(![carry, journal, trend].some(text => text.includes('고르기 생략')), `${label}: 기록을 고르기 생략으로 덮지 않음`);
    eq(teamData().interview.months[res.round], saved, `${label}: 재렌더/기록 읽기로 저장값 불변`);
    eq(JSON.stringify({ S, V }), publicBefore, `${label}: 공개·운영 상태 불변`);
    eq(calls.length, 0, `${label}: 고정본 저장·기록 읽기에 추가 시뮬레이션 없음`);
  }
});
test('사본 삭제·손상·중간 참가 = 안내만', () => {
  const S = game(); operate(S); C.host(S, 'next', 0); const { V, res } = operate(S), original = data();
  for (const kind of ['deleted', 'corrupt', 'mismatch']) {
    const d = clone(original);
    if (kind === 'deleted') delete d.outageSnapshots[1];
    if (kind === 'corrupt') d.outageSnapshots[1].mods = null;
    if (kind === 'mismatch') d.outageSnapshots[1].unsPct += 1;
    save(d); resetCache();
    eq(U.uiMath.outageAttribution(V, res, id), null, `${kind} 시험으로 대신하지 않음`);
    const html = U.uiMath.outageCardsHTML(V, res, id, {});
    ok(html.includes('지난달 운영 조건이 이 기기에 없어 나누지 못해요'), `${kind} 지정 안내`);
    ok(!/data-missed=|data-out-other=|data-out-step=|lg-outage-(?:cards|waterfall|single|open)/.test(html), `${kind} 카드/분해/폭포 0`);
  }
});
// 검토자 t1/t2/t2b/t5와 같은 종류의 배치를 독립적으로 생성한다.
// 3도시 정상 시작, 3월 SMR 착공(15월 완공), 태양광 6기 추가 후 다음 달 접속.
function addBuilds(S, kind, count) {
  select();
  const plan = S.teams[id].plan, connected = new Set(plan.lines.flatMap(l => l.p));
  const used = new Set(plan.builds.map(b => b.i));
  const tiles = B.TILES.filter(t => !t.out && t.site < 0 && !used.has(t.i) &&
    !B.siteRule(kind, t) && t.nb.some(i => connected.has(i))).slice(0, count);
  ok(tiles.length === count, `${kind} 독립 픽스처 합법 배치`);
  for (const t of tiles) {
    plan.builds.push({ t: kind, i: t.i });
    plan.lines.push({ p: [t.nb.find(i => connected.has(i)), t.i] });
  }
  return tiles.map(t => `${kind}:${t.i}`);
}
function connectWind(S, kind) {
  select();
  const plan = S.teams[id].plan, seen = new Map(plan.lines.flatMap(l => l.p).map(i => [i, null]));
  const queue = [...seen.keys()], used = new Set(plan.builds.map(b => b.i));
  let target;
  for (let j = 0; j < queue.length; j++) {
    const tile = B.TILES[queue[j]];
    if (!tile.out && tile.site < 0 && !used.has(tile.i) && !B.siteRule(kind, tile)) { target = tile.i; break; }
    for (const i of tile.nb) if (!B.TILES[i].out && !seen.has(i)) { seen.set(i, tile.i); queue.push(i); }
  }
  ok(target !== undefined, `${kind} 연결 가능한 합법 위치`);
  if (target === undefined) throw Error(`${kind} 배치 불가`);
  const route = [target];
  while (seen.get(route[0]) !== null) route.unshift(seen.get(route[0]));
  plan.builds.push({ t: kind, i: target });
  if (route.length > 1) plan.lines.push({ p: route });
  return `${kind}:${target}`;
}
test(`${C.teamDef(R, 'hwaseong').name} 정상 계획+육상풍력: 월 처리량으로 접속한 뒤 실제 플래그·직접 연결`, () => {
  const originalId = id;
  try {
    id = session.team = 'hwaseong';
    const S = game({ solarCount: 0, cityIds: [id, 'pyeongtaek'] }), windKey = connectWind(S, 'wind');
    let previous = operate(S), connected = false;
    for (let month = 2; month <= 12; month++) {
      C.host(S, 'next', 0);
      const current = operate(S), a = validate(previous, current);
      const metrics = oracle(previous.model, current.model).weather[1];
      if (Number.isFinite(metrics.wind)) {
        connected = true;
        eq(a.hasConnectedWind, true, `${C.teamDef(R, id).name} 실제 월간 결과에 연결 풍력 플래그 저장`);
        ok(current.model.mods.reCap[windKey] > 0, `${C.teamDef(R, id).name} 월 처리량으로 접속한 육상풍력 할당`);
        const html = U.uiMath.outageCardsHTML(current.V, current.res, id, {
          outageOpened: true, outageFrozen: a, evidence: { key: 'wind', value: 3, text: '가상 풍속' } });
        const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
        ok(text.includes('직접 연결 — 날씨·계절·운전 기간') && !text.includes('간접 연결 — '),
          `${C.teamDef(R, id).name} 실제 연결 풍력의 wind→weather/event 직접 연결`);
        break;
      }
      eq(a.hasConnectedWind, false, `${C.teamDef(R, id).name} 접속 대기 중에는 직접 풍속 효과 플래그 없음`);
      previous = current;
    }
    ok(connected, `${C.teamDef(R, id).name} 실제 접속 풍속 사례 실행(12달 상한)`);
  } finally { id = session.team = originalId; }
});
test('풍속은 실제 접속 풍력만: 육상·해상·혼합·접속 대기·전선 단절', () => {
  for (const kinds of [['wind'], ['offshore'], ['wind', 'offshore']]) {
    const S = game({ solarCount: 0, turns: 24 });
    const keys = kinds.map(kind => connectWind(S, kind));
    addBuilds(S, 'battery', 1); // 혼합 6 MW가 실제 hosting 상한 안에 들어가도록 ESS 배치
    let previous = operate(S), connected = false;
    for (let month = 2; month <= 12; month++) {
      C.host(S, 'next', 0); const current = operate(S);
      validate(previous, current);
      const expected = oracle(previous.model, current.model);
      connected = keys.every(k => expected.stages[1][4].reCap[k] > 0);
      previous = current;
      if (connected) break;
    }
    ok(connected, `${kinds}: 실제 접속 절차 후 ①에 유효 할당(상한 12달)`);
    // 설치·할당이 남아도 전선이 끊기면 두 날씨 결과 모두 풍속 단서에서 빠진다.
    C.host(S, 'next', 0); S.teams[id].plan.lines = [];
    const disconnected = operate(S); validate(previous, disconnected);
    ok(!U.uiMath.outageAttributionMonthly(disconnected.V, disconnected.res, id).clues.weather.includes('평균 풍속'),
      `${kinds}: 단절된 풍력의 육상/해상 풍속 생략`);
  }
  for (const branch of ['wind', 'offshoreWind', 'no-wind', 'no-offshoreWind', 'no-renewable', 'renewable', 'demand-first', 'renewable-first'])
    ok(weatherCoverage.has(branch), `날씨 단서 실제 계산 분기 실행: ${branch}`);
});
function noFalseCancellation(a, label) {
  const part = k => a.parts.find(p => p.key === k).value;
  const magnitude = Math.abs(part('choice')) + Math.abs(part('growth'));
  // D-82: 비율 상한은 choice·growth < 0인 ①/⑤ 역부호 상쇄에만 적용한다.
  // SMR 착공의 월 합계 +117.77 MWh는 지난달 하루 평균 P≈125.6 MWh/일에
  // 하루가 더해진 효과(31(P−0.2529)−30P = P−7.84)였다. 하루 평균 변화는
  // −0.2529로 작으며 choice=0이라 ①/⑤ 거짓 상쇄가 생길 수 없다.
  // D-74: |실제 변화|>0 고정 → 계통이 부족을 다 메우면 실제 변화=0도 정상.
  // 이때 비율 상한 적용은 부적절하다. ①/⑤ 사이의 거짓 상쇄는 계속 금지하고,
  // 자체 원인 전체를 계통 효과가 정확히 상쇄하는지 검사한다(대상 제외 아님).
  const ratio = Math.abs(a.total) > .05 ? magnitude / Math.abs(a.total) : null;
  if (ratio === null) {
    near(a.total, 0, `${label} 계통 보충으로 실제 변화0`);
    ok(part('choice') * part('growth') >= -1e-9, `${label} choice/growth 거짓 역방향 상쇄 없음`);
    near(a.parts.reduce((sum, p) => sum + p.value, 0), a.total, `${label} 여섯 원인의 합계 항등식`); // D-80: C-2, 별도 계통 상쇄 없음.
  } else {
    near(a.parts.reduce((sum, p) => sum + p.value, 0), a.total, `${label} 여섯 원인의 합계 항등식`);
    if (part('choice') * part('growth') < 0) {
      ok(Number.isFinite(ratio), `${label} 유한 비율`);
      ok(ratio <= 2, `${label} (|choice|+|growth|)/|total| ≤2: ${ratio}`);
    }
  }
  console.log(JSON.stringify({ regression: label, total: a.total, choice: part('choice'),
    progress: part('progress'), growth: part('growth'), ratio }));
}
test('거짓 상쇄 변이: ①/⑤ 역부호는 실패, choice=0인 날씨/성장 상쇄는 허용', () => {
  const capture = (a, label) => {
    const originalOk = ok, records = [];
    ok = (value, message) => { records.push({ passed: !!value, message }); return !!value; };
    try { noFalseCancellation(a, label); }
    finally { ok = originalOk; }
    return records;
  };
  // X=100, total=1: 여섯 몫의 합은 맞지만 ①/⑤가 실제 변화의 100배씩 거짓 상쇄한다.
  const opposite = capture({ total: 1, parts: [
    { key: 'choice', value: 100 }, { key: 'weather', value: 1 },
    { key: 'event', value: 0 }, { key: 'progress', value: 0 },
    { key: 'growth', value: -100 }, { key: 'trade', value: 0 }
  ] }, '합성 거짓 상쇄');
  ok(opposite.some(r => !r.passed), '①/⑤ 거짓 상쇄 객체는 실패를 1건 이상 기록');
  const weatherGrowth = capture({ total: -.25, parts: [
    { key: 'choice', value: 0 }, { key: 'weather', value: -100.25 },
    { key: 'event', value: 0 }, { key: 'progress', value: 0 },
    { key: 'growth', value: 100 }, { key: 'trade', value: 0 }
  ] }, '합성 SMR 착공 형태');
  ok(weatherGrowth.length > 0 && weatherGrowth.every(r => r.passed),
    'choice=0인 날씨/성장 상쇄 객체는 실제 단언을 실행하고 실패 없음');
});
test('SMR 착공·완공: 새 공사 키는 ①, 기존 공사 완료는 ④', () => {
  const S = game({ solarCount: 0, cityIds: [id, 'dangjin', 'asan'], turns: 24 });
  let previous, constructionKey;
  for (let month = 1; month <= 15; month++) {
    if (month > 1) C.host(S, 'next', 0);
    if (month === 3) {
      [constructionKey] = addBuilds(S, 'smr', 1);
      S.teams[id].construction = { [constructionKey]: { startRound: 3, readyRound: 15 } };
    }
    const current = operate(S);
    if (month === 3 || month === 15) {
      eq((current.model.mods.disabledBuilds || []).includes(constructionKey), month === 3, '착공은 미가동·15월은 완공');
      const a = validate(previous, current);
      noFalseCancellation(a, month === 3 ? 'SMR 착공' : 'SMR 완공');
      if (month === 3) near(a.parts.find(p => p.key === 'choice').value, 0, '미완공 SMR을 ①에서 최대 출력으로 돌리지 않음');
      else {
        near(a.parts.find(p => p.key === 'choice').value, 0, '기존 SMR 완공은 선택 몫 0');
        ok(Math.abs(a.parts.find(p => p.key === 'progress').value) > .05 && a.clues.progress.includes('공사 완료 1기'),
          '기존 SMR의 출력 변화·완공 단서는 ④');
      }
    }
    previous = current;
  }
});
test('태양광 추가·접속: 새 reCap은 ①, 기존 할당 진행은 ④', () => {
  const S = game({ solarCount: 0, cityIds: [id, 'dangjin', 'asan'] });
  let previous, added;
  for (let month = 1; month <= 4; month++) {
    if (month > 1) C.host(S, 'next', 0);
    if (month === 3) added = addBuilds(S, 'solar', 6);
    const current = operate(S);
    if (month >= 3) {
      const a = validate(previous, current);
      if (month === 4) {
        const gained = added.reduce((sum, k) => sum + (current.model.mods.reCap[k] || 0) -
          (previous.model.mods.reCap[k] || 0), 0);
        ok(gained > 0, `다음 달 실제 태양광 접속 증가: ${gained} MW`);
        near(a.parts.find(p => p.key === 'choice').value, 0, '기존 태양광 접속은 선택 몫 0');
        ok(Math.abs(a.parts.find(p => p.key === 'progress').value) > .05, '접속의 유의미한 몫은 ④');
        noFalseCancellation(a, '태양광 접속');
        const largest = [...oracle(previous.model, current.model).parts].sort((x, y) => Math.abs(y.value) - Math.abs(x.value))[0];
        eq(largest.key, 'progress', '4월 독립 최대 = 접속 진행');
        const html = U.uiMath.outageCardsHTML(current.V, current.res, id, { outageOpened: true, outageFrozen: a,
          evidence: { key: 'grid', text: '접속 여유' }, missed: 'progress' });
        const text = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1] || '';
        ok(text.includes(`접속·공사·기술 진행 ${unitNumber(a, largest.value, true)}`) && // D-80: C-4, 대상 단위.
          !text.includes('가장 큰 몫과도 이어져요') && !text.includes('설명할 수 없어요'),
          '4월 실제 접속 여유→progress: 방향 비교 자료 없이 칭찬하지 않고 직접 몫 표시');
      }
    }
    previous = current;
  }
});
test('계절 출력제어·운전 기간은 ②, 비계절 출력제어·기술은 ④', () => {
  const S = game({ solarCount: 20 });
  // 대표 운전 일수가 다른 유효 월 입력. 실제 core 운영부터 재현해 단계 입력을 대조한다.
  S.rounds[4].days = 5; S.rounds[5].days = 9;
  let previous;
  for (let month = 1; month <= 6; month++) {
    if (month > 1) C.host(S, 'next', 0);
    const current = operate(S);
    if (month === 6) {
      ok(previous.model.mods.curtailP > 0, '계절 계수 회귀가 0 배수로 무력화되지 않는 배치');
      eq([previous.res.season, current.res.season], ['spring', 'summer'], '봄→여름 실제 계절 전환');
      eq([previous.res.days, current.res.days], [5, 9], '실제 대표 운전 일수 차이');
      validate(previous, current);
    }
    previous = current;
  }
});
test('수정 3 무더위: 30일 중 9일 → 7일 중 2일, 같은 기간은 일수', () => {
  // 명세의 정확한 일수는 자연 날씨 씨앗에 맡기지 않는다. 실제 모델 결과의
  // 일 최고기온/무더위 플래그만 엔진 경계에서 통제한다(기온-수요 모형 검사는 아님).
  // 예상 비율은 S7의 요약/몫 대신 아래 일별 기온 배열을 28℃ 기준으로 세어 계산한다.
  for (const currentDays of [7, 30]) {
    const S = game({ solarCount: 0 });
    Object.assign(S.rounds[0], { days: 30, season: 'summer' });
    Object.assign(S.rounds[1], { days: currentDays, season: 'summer' });
    const temperatures = [Array.from({ length: 30 }, (_, i) => i < 9 ? 29 : 28),
      Array.from({ length: currentDays }, (_, i) => i < 2 ? 29 : 28)];
    const seeds = [101, 202], bySeed = new Map(seeds.map((seed, i) => [seed, temperatures[i]]));
    const spy = B.simulate;
    B.simulate = (...args) => {
      const s = spy(...args), input = bySeed.get(args[0].seed);
      if (input) s.wx.forEach((day, i) => { day.tmax = input[i]; day.hot = input[i] > 28; });
      return s;
    };
    try {
      S.salt = seeds[0] - (7000 + S.round * 13);
      const previous = operate(S);
      C.host(S, 'next', 0); S.salt = seeds[1] - (7000 + S.round * 13);
      const current = operate(S), a = U.uiMath.outageAttributionMonthly(current.V, current.res, id);
      const expected = oracle(previous.model, current.model).weather.map((metrics, i) =>
        ({ ...metrics, hotDays: temperatures[i].filter(tmax => tmax > 28).length }));
      eq([previous.res.days, current.res.days, ...expected.map(w => w.hotDays)],
        [30, currentDays, 9, 2], '기간·28℃ 초과 일수는 입력과 독립 검산');
      weatherClue(a, ...expected, previous.res, current.res);
      const rates = expected.map((w, i) => Math.round(100 * w.hotDays / temperatures[i].length));
      const hot = currentDays === 7 ? `무더위 ${rates[0]}% → ${rates[1]}% 날` : '무더위 9 → 2일';
      if (currentDays === 7) eq(rates, [30, 29], '9/30과 2/7을 독립 계산·정수 반올림');
      ok(a.clues.weather.includes(hot) && a.clueMore.weather.includes(hot),
        `${currentDays}일: 짧은·상세 단서의 무더위 ${hot}`);
      if (currentDays === 7) ok(!/무더위 9 → 2일/.test(a.clues.weather + a.clueMore.weather),
        '다른 기간을 보정 없이 일수로 비교하지 않음');
    } finally { B.simulate = spy; }
  }
  ok(weatherCoverage.has('hot-rate') && weatherCoverage.has('hot-count'), '기간별 무더위 비율·일수 두 분기 실행');
});
// 검토자 h2/h1.js의 월·선택 경로를 재현하되 기대값은 위 독립 oracle로 계산한다.
// 실제 plan reduce를 거쳐 같은 키의 접속 취소·공사 재시작·ESS 철거를 발생시킨다.
for (const scenario of ['rebuild', 'smrrebuild', 'ess']) test(`${scenario}: 같은 자리 재건설·ESS 철거는 ①`, () => {
  const S = game({ solarCount: 0, cityIds: [id, 'dangjin', 'asan'] });
  S.teams[id].token = 'tok-s7-fixture';
  if (scenario === 'smrrebuild') S.teams[id].research = { adopted: [], adoptR: { smr: 2 } };
  let previous, rev = 100;
  function submit(plan) {
    const result = C.reduce(S, { type: 'plan', team: id, token: S.teams[id].token,
      rev: ++rev, plan: clone(plan) }, 0, B);
    ok(result.ok, `${scenario} 실제 계획 reduce 승인`);
  }
  function add(kind, count) {
    const draft = clone(S); addBuilds(draft, kind, count); submit(draft.teams[id].plan);
  }
  for (let month = 1; month <= (scenario === 'ess' ? 8 : 6); month++) {
    if (month > 1) C.host(S, 'next', 0);
    if (month === 3) {
      if (scenario === 'ess') { add('solar', 12); add('battery', 3); }
      else add(scenario === 'rebuild' ? 'solar' : 'smr', 1);
      if (scenario === 'smrrebuild')
        Object.values(S.teams[id].construction).forEach(c => { c.readyRound = 4; });
    }
    const changedMonth = scenario === 'ess' ? 8 : 6;
    if (month === changedMonth) {
      const plan = clone(S.teams[id].plan);
      const removed = scenario === 'ess' ? plan.builds.filter(b => B.BLD[b.t].cls === 'bat') :
        [plan.builds.find(b => b.t === (scenario === 'rebuild' ? 'solar' : 'smr'))];
      ok(removed.length === (scenario === 'ess' ? 3 : 1), `${scenario} 실제 철거할 설비 존재`);
      const removeKeys = new Set(removed.map(b => `${b.t}:${b.i}`));
      submit({ ...plan, builds: plan.builds.filter(b => !removeKeys.has(`${b.t}:${b.i}`)) });
      if (scenario !== 'ess') submit(plan);
    }
    const current = operate(S);
    if (month === changedMonth) {
      const a = validate(previous, current), expected = oracle(previous.model, current.model);
      const part = k => a.parts.find(p => p.key === k).value;
      const decreased = previous.model.plan.builds.filter(b => current.model.plan.builds.some(c => c.t === b.t && c.i === b.i))
        .reduce((sum, b) => sum + Math.max(0, (previous.model.mods.reCap[`${b.t}:${b.i}`] || 0) -
          (current.model.mods.reCap[`${b.t}:${b.i}`] || 0)), 0);
      if (scenario === 'smrrebuild') {
        ok(part('choice') > 10, '완공 SMR 재건설의 큰 정전 증가가 내 선택');
        ok(a.clues.choice.includes('공사 재시작 1기') && a.clues.progress.includes('공사 완료 0기'),
          'SMR 재시작 단서는 선택, 완료로 꾸미지 않음');
      } else {
        ok(decreased > 0 && a.clues.choice.includes('접속 감소'), `${scenario} 접속 감소는 선택 단서`);
        ok(part('choice') > .05, `${scenario} 접속 감소의 유의미한 몫은 내 선택`);
      }
      if (scenario !== 'ess') near(part('progress'), 0, `${scenario} 재건설 달 자연 진행 몫 0`);
      else {
        near(part('progress'), 0, 'ESS 철거의 출력제어 변화도 ①로 가므로 진행 몫 0');
        ok(expected.stages[1][4].curtailP < previous.model.mods.curtailP,
          'ESS 철거의 ① 출력제어는 지난달 값을 복사하지 않고 실제로 감소');
        near(expected.stages[1][4].curtailP, current.model.mods.curtailP,
          'ESS 철거만 있는 달의 ① 출력제어 = 이번 접속의 독립 출력제어');
      }
      // 감소를 ④로 넘기는 회귀는 전체 단계 입력과 선택 독립 몫 대조가 함께 잡는다.
      near(part('choice'), expected.parts.find(p => p.key === 'choice').value, `${scenario} 독립 선택 몫`);
      ok(!/접속 −/.test(a.clues.progress), `${scenario} 진행 단서에 접속 감소 없음`);
      console.log(JSON.stringify({ regression: scenario, month, decreasedMW: decreased,
        choice: part('choice'), progress: part('progress'), growth: part('growth') }));
    }
    previous = current;
  }
});

// h3/tie.js를 실행하거나 사본을 가져오지 않는다. 정상 시작·3월 태양광 14기와
// 4 MW 연계선·8월 접속점 전선 삭제를 독립 생성한다. 이웃/우리 단절을 같은 조건으로 비교.
function cutTiePort(S, city, other) {
  B.selectPack(C.teamDef(R, city).pack, 'league');
  const ports = B.SITES.filter(s => s.kind === 'gridpt' && (s.to || []).includes(other)).map(s => s.tile);
  ok(ports.length > 0, '독립 지도에 상대 도시 연계선 접속점 존재');
  const cutTiles = new Set(ports.flatMap(i => [i, ...B.TILES[i].nb]));
  const plan = S.teams[city].plan, before = plan.lines.length;
  plan.lines = plan.lines.filter(l => !l.p.some(i => cutTiles.has(i)));
  ok(plan.lines.length < before, '실제 접속점 전선 삭제');
  select();
  return before - plan.lines.length;
}
for (const side of ['neighbor', 'own']) test(`${side} 연계선 접속점 전선 단절의 ①/④ 귀속`, () => {
  const S = game({ solarCount: 0, cityIds: [id, 'dangjin', 'asan'] });
  S.teams[id].token = 'tok-s7-tie-fixture';
  let previous, removedLines;
  for (let month = 1; month <= 8; month++) {
    if (month > 1) C.host(S, 'next', 0);
    if (month === 3) {
      const draft = clone(S); addBuilds(draft, 'solar', 14);
      ok(C.reduce(S, { type: 'plan', team: id, token: S.teams[id].token,
        rev: 101, plan: draft.teams[id].plan }, 0, B).ok, '연계선 회귀 실제 태양광 계획 승인');
      S.ties.push({ a: id, b: 'dangjin', cap: 4, st: 'built', round: 3 });
    }
    if (month === 8) removedLines = cutTiePort(S, side === 'neighbor' ? 'dangjin' : id,
      side === 'neighbor' ? id : 'dangjin');
    const current = operate(S);
    if (month === 8) {
      const saved = clone(data()), savedTeam = teamData(), a = validate(previous, current);
      const part = key => a.parts.find(p => p.key === key).value;
      const lostHost = previous.model.grid.hostMW - current.model.grid.hostMW;
      const lostConnected = previous.model.grid.connectedMW - current.model.grid.connectedMW;
      near(lostHost, 4 * D.params.hostTieMul.v, '연계선 단절로 독립 접속 상한 감소');
      ok(lostConnected > 0, '연계선 회귀 실제 기존 접속 감소');
      near(saved.outageSnapshots[7].hostMW, previous.model.grid.hostMW, '지난달 사본 접속 상한 보존');
      near(saved.outageSnapshots[7].tieHostMW, lostHost, '지난달 사본 실제 연계선 상한 몫');
      eq(saved.outageSnapshots[7].hostTies, [['dangjin', lostHost]], '지난달 사본 이웃 연결 상태·용량');
      if (side === 'neighbor') {
        eq(current.model.plan, previous.model.plan, '이웃 단절 전후 우리 계획 불변');
        eq(removedLines, 2, 'h3 재현과 같은 이웃 전선 2개 삭제');
        near(part('choice'), 0, '우리 계획 불변이면 이웃 단절 선택 몫 ≈ 0');
        ok(part('progress') > .05, '이웃 접속 감소의 유의미한 정전 증가가 ④');
        const neighborClue = a.clues.progress.match(/연계선 변화\(이웃 단절·새 연계선\)로 접속 −([\d.,]+) MW/);
        ok(neighborClue, '④ 단서에 이웃 연계선 감소 MW 명시');
        near(neighborClue ? +neighborClue[1].replaceAll(',', '') : NaN, lostHost,
          '④ 이웃 연계선 단서의 감소량 = 독립 접속 상한 감소');
        ok(!a.clues.choice.includes('접속 감소'), '이웃 단절을 우리 선택의 접속 감소로 표시하지 않음');
        // C-fix3: 연계선 정보가 없는 옛 사본은 실제 접속 할당의 min을 유지한다.
        for (const field of ['hostMW', 'tieHostMW', 'hostTies']) delete saved.outageSnapshots[7][field];
        save(saved); saveTeam(savedTeam); resetCache();
        const legacy = validate(previous, current, 0, { legacyTies: true });
        ok(legacy.parts.find(p => p.key === 'choice').value > .05, '옛 사본은 기존 접속 감소 계산으로 ①');
        near(legacy.parts.find(p => p.key === 'progress').value, 0, '옛 사본은 이웃 복원을 새로 추측하지 않음');
        ok(!legacy.clues.progress.includes('이웃 연계선'), '옛 사본은 이웃 상태 단서 생성 없음');
      } else {
        ok(part('choice') > .05, '우리 전선 단절의 유의미한 접속 감소는 ①');
        near(part('progress'), 0, '우리 전선 단절을 자연 진행 감소로 넘기지 않음');
        ok(a.clues.choice.includes('접속 감소') && a.clues.choice.includes(`전선 ${previous.model.plan.lines.length} → ${current.model.plan.lines.length}개`) /* rev10 R6 */,
          '우리 전선 단절은 선택의 접속 감소·전선 변경 단서');
        ok(!a.clues.progress.includes('이웃 연계선'), '우리 전선 단절을 이웃 단절로 꾸미지 않음');
      }
      console.log(JSON.stringify({ regression: `tie-${side}`, removedLines, lostHost, lostConnected,
        choice: part('choice'), progress: part('progress'), clue: a.clues.progress }));
    }
    previous = current;
  }
});

test('이번 달 사본 재사용 조건: unsPct·seed·days·season 불일치 시 재생성', () => {
  for (const waiting of [false, true]) {
    const S = game({ solarCount: waiting ? 10 : 0 }), first = operate(S);
    C.host(S, 'next', 0); const second = operate(S);
    eq(second.model.grid.waitingMW > 0, waiting, '재생성 호출 수의 대기 유무 픽스처');
    const original = data(), expected = oracle(first.model, second.model);
    for (const field of ['unsPct', 'seed', 'days', 'season']) {
      const d = clone(original), snap = d.outageSnapshots[2];
      snap[field] = field === 'season' ? 'summer' : snap[field] + 1;
      save(d); resetCache(); calls = [];
      const a = U.uiMath.outageAttributionMonthly(second.V, second.res, id);
      ok(a, `${field} 불일치 사본을 재생성해 분해`);
      eq(calls.length, waiting ? 7 : 6, `${field} 사본 생성은 월간 기준 +1회`);
      eq(a.simulations, calls.length, `${field} 보고 호출 수`);
      near(a.actual, resultValue(second.res, expected.target), `${field} 실제값은 공개 결과의 대상별 값`); // D-80: C-1.
      expected.parts.forEach(p => near(a.parts.find(x => x.key === p.key)?.value, p.value, `${field} ${p.key} 독립 몫`));
      const count = calls.length; U.uiMath.outageAttributionMonthly(second.V, second.res, id);
      eq(calls.length, count, `${field} 재생성 뒤 캐시 실행 0`);
    }
  }
});
test('월간 재현 표시 문턱: 양·음 0.004999/0.005/0.005001%p', () => {
  const S = game(), first = operate(S); C.host(S, 'next', 0); const second = operate(S);
  const base = U.uiMath.outageAttributionMonthly(second.V, second.res, id);
  for (const value of [.004999, .005, .005001, -.004999, -.005, -.005001]) {
    // 계산 픽스처와 분리한 저장 분해 렌더링 검사: 정확한 경계값을 전달한다.
    const frozen = { ...clone(base), target: 'uns', unit: undefined, // D-82: 정전 합성 기록에 계통 원본의 하루 평균 unit을 상속하지 않음; 정전 단언 유지.
      replay: value }; // D-80: C-1·2·4·5 대상별 검사.
    const html = U.uiMath.outageCardsHTML(second.V, second.res, id, { outageOpened: true, outageFrozen: frozen });
    eq(rows(html).some(r => r.key === 'replay'), false, `${value} 재현은 폭포 합계에 없음`);
    ok(!html.match(/aria-label="[^"]*재현 차이/), `${value} 폭포 aria 합계에서도 재현 제외`);
    eq(html.includes('id="lg-outage-replay"'), Math.abs(value) >= .005, `${value} 월간 재현 설명`);
  }
});
test('큰 재현 차이만으로 거래 후보·최대·고르기 분기가 바뀌지 않음', () => {
  const S = game({ solarCount: 0 });
  ids.forEach(city => { S.teams[city].plan = { builds: [], lines: [], policies: [] }; });
  S.events = [];
  const first = operate(S); C.host(S, 'next', 0); S.events = [];
  const second = operate(S), baseline = clone(U.uiMath.outageAttributionMonthly(second.V, second.res, id));
  const changed = validate(first, second, -25);
  const beforeTrade = baseline.parts.find(p => p.key === 'trade').value;
  const afterTrade = changed.parts.find(p => p.key === 'trade').value;
  near(afterTrade, beforeTrade, '재현 진단만 달라질 때 거래 후보 불변');
  eq(changed.parts, baseline.parts, '재현 진단만 달라질 때 성장 포함 여섯 몫 불변'); // D-80: C-1·2·4·5 대상별 검사.
  const html = U.uiMath.outageCardsHTML(second.V, second.res, id, {});
  ok(html.includes(noCauseLabel(first.model.isolated, second.model.isolated)),
    '큰 재현 보정만으로 거래가 최대 후보가 되지 않음(재현은 후보 밖)');
  ok(!session.outShownPending?.largest, '큰 재현 보정만으로 최대 원인 저장 금지(재현은 후보 밖)');
  console.log(JSON.stringify({ regression: '재현→거래 혼입', replay: changed.replay, beforeTrade, afterTrade,
    total: changed.total, sum: changed.parts.reduce((sum, p) => sum + p.value, 0) }));
});
test('열지 않은 월간 선택도 다음 달 타임라인 이름을 월간 기준으로 유지', () => {
  const S = game(); operate(S); C.host(S, 'next', 0); operate(S);
  const d = teamData();
  d.interview = { months: { 2: { missed: 'weather', missedBasis: 'monthly' } } }; saveTeam(d);
  // 실제 선택 저장의 missedBasis는 s7.py에서 클릭 직후 검사한다.
  C.host(S, 'next', 0); const current = operate(S);
  const before = clone(teamData().interview.months[2]);
  const html = U.uiMath.trendHTML(current.V, id, true);
  ok(html.includes('내가 고른 원인: 날씨·계절·운전 기간'), '옛 frozen 없이 missedBasis만으로 월간 이름');
  ok(!html.includes('내가 고른 원인: 날씨·운전 기간') && !html.includes('가장 큰 몫'),
    '열지 않은 선택을 시험 이름·최대 답으로 꾸미지 않음');
  eq(teamData().interview.months[2], before, '닫힌 선택의 다음 달 렌더링은 기록 불변');
});
test('분리 전 저장: S7 사본만 옮기고 일지·답변과 월간 분해 보존', () => {
  const S = game(); operate(S); C.host(S, 'next', 0); const { V, res } = operate(S);
  resetCache();
  const before = U.uiMath.outageAttributionMonthly(V, res, id);
  ok(before?.basis === 'monthly' && before.parts.length === 6, '이전 비교용 월간 분해 실제 생성'); // D-80: C-2.
  const beforeHTML = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true });
  const snapshots = data();
  snapshots.outageOperatingIntl = { round: res.round, intl: clone(V.econ.intl.cur || V.econ.intl) };
  const notes = { docs: { fixture: { journal: '가상 도시 일지' } }, journal: { fixture: '가상 일지' },
    interview: { months: { 2: { answer: '가상 답변', missed: 'weather', missedBasis: 'monthly' } } } };
  saveTeam({ ...clone(notes), ...clone(snapshots) }); storage.delete(key()); resetCache();
  ok(!storage.has(key()) && Object.hasOwn(teamData(), 'outageSnapshots') &&
    Object.hasOwn(teamData(), 'outageOperatingIntl'), '분리 전 팀 자료만 있고 별도 S7 키 없음');
  const afterHTML = U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true });
  eq(data(), snapshots, '첫 월간 그리기에서 두 S7 필드 원본 그대로 이전');
  eq(teamData(), notes, 'S7 필드 제거 후 팀 자료의 일지·답변 전체 보존');
  // 다시 계산한 실행 시간만 비교에서 제외한다. 수치·단서·호출 수는 그대로 비교한다.
  const withoutTiming = html => html.replace(/ data-ms="[^"]*"/, '');
  eq(withoutTiming(afterHTML), withoutTiming(beforeHTML), '이전 전후 월간 분해 화면 동일');
  const { ms: beforeMs, ...beforeResult } = before;
  const { ms: afterMs, ...afterResult } = U.uiMath.outageAttributionMonthly(V, res, id) || {};
  eq(afterResult, beforeResult, '이전 전후 월간 분해 결과 동일');
  resetCache();
  eq(withoutTiming(U.uiMath.outageCardsHTML(V, res, id, { outageOpened: true })), withoutTiming(beforeHTML), '다시 그려도 이전 결과 유지');
  eq(data(), snapshots, '다시 읽어도 S7 사본·운영 지수 유지');
  eq(teamData(), notes, '다시 읽어도 팀 자료에 S7 필드 재생성 없음');
});
test('크기 순위와 다른 카드 배치 실제 실행', () => ok(orderDiffers > 0, '크기순 회귀를 잡을 사례 존재'));
console.log(`S7 monthly: ${checks} assertions, ${failures} failures`);
process.exitCode = failures ? 1 : 0;
